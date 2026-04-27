// auth/exec-approval.ts — Execution approval for dangerous tool invocations.
//
// When a non-owner sender invokes a tool marked as `dangerous` in the
// policy, this module creates an approval request. The request surfaces
// in /build alongside other decisions. Yu can:
//
//   allow-once  — let this single invocation proceed
//   allow-always — add a persistent rule (tool-policy.local.json)
//   deny        — block this invocation
//
// This is the same approval primitive as the veto contract. Both are
// "pending decisions Yu can resolve from /build." The difference is
// scope: veto gates mission creation, exec-approval gates tool execution.
//
// For the current architecture (subprocess-per-tick), exec-approval
// happens PRE-tick: dangerous tools are filtered from the tool list
// before the subprocess starts. The approval flow is:
//
//   1. Sender invokes session with tools
//   2. Policy check finds dangerous tools in the requested set
//   3. If allow-always rule exists → tool stays in the list
//   4. If no rule → tool is removed, approval request created
//   5. Yu responds in /build → rule persisted if allow-always
//   6. Next tick, tool appears in the list
//
// This is coarser than mid-stream gating (which would intercept
// individual tool calls) but correct for the subprocess architecture.
// Mid-stream gating would require the long-lived agent runtime (Phase 5+).

import {
  requestDecision,
  respondToDecision,
  listDecisions,
  type DecisionRequest,
} from '../decisions.js'
import { addAllowAlwaysRule, hasAllowAlwaysRule } from './default-policy.js'
import { isDangerous, type Sender } from './tool-policy.js'
import type { ToolPolicy } from './tool-policy.js'

// ── Types ────────────────────────────────────────────────────────────

export interface ExecApprovalRequest {
  /** The tool that needs approval. */
  toolName: string
  /** Who's trying to use it. */
  sender: Sender
  /** Channel the request came through. */
  channelId: string
  /** Optional: what args the tool was called with (for context). */
  toolArgs?: string
  /** The underlying decision record. */
  decision: DecisionRequest
}

export type ExecApprovalResponse = 'allow-once' | 'allow-always' | 'deny'

// ── Request creation ─────────────────────────────────────────────────

/**
 * Request approval for a dangerous tool invocation.
 *
 * Creates a decision record with kind='exec-approval' in the project's
 * decisions queue. Returns the approval request for tracking.
 *
 * If the tool already has an allow-always rule for this sender, returns
 * null (no approval needed).
 */
export function requestExecApproval(
  projectId: string,
  params: {
    toolName: string
    sender: Sender
    channelId: string
    toolArgs?: string
  },
): ExecApprovalRequest | null {
  // Check for allow-always rule first.
  if (hasAllowAlwaysRule(params.sender, params.toolName)) {
    return null // No approval needed.
  }

  const decision = requestDecision(projectId, {
    kind: 'permission' as const,
    ask: `Exec approval: ${params.sender} via ${params.channelId} wants to use ${params.toolName}${params.toolArgs ? ` with args: ${params.toolArgs.slice(0, 200)}` : ''}`,
    missionId: '2026-04-27-tool-auth-and-exec-approval',
    options: ['allow-once', 'allow-always', 'deny'],
    context: [
      `Tool: ${params.toolName}`,
      `Sender: ${params.sender}`,
      `Channel: ${params.channelId}`,
      params.toolArgs ? `Args: ${params.toolArgs.slice(0, 500)}` : '',
      '',
      'allow-once: permit this single invocation',
      'allow-always: add persistent rule (tool-policy.local.json)',
      'deny: block this invocation',
    ].filter(Boolean).join('\n'),
  })

  return {
    toolName: params.toolName,
    sender: params.sender,
    channelId: params.channelId,
    toolArgs: params.toolArgs,
    decision,
  }
}

// ── Response handling ────────────────────────────────────────────────

/**
 * Process Yu's response to an exec-approval request.
 *
 * - allow-once: marks the decision as approved (no persistent rule)
 * - allow-always: marks as approved AND writes a persistent rule
 * - deny: marks as denied
 *
 * Returns the response type for the caller to act on.
 */
export function processExecApprovalResponse(
  projectId: string,
  decisionId: string,
  response: ExecApprovalResponse,
  sender?: Sender,
  toolName?: string,
): ExecApprovalResponse {
  const decisionResponse =
    response === 'deny' ? 'denied' :
    response === 'allow-once' ? 'approved' :
    'approved'

  respondToDecision(projectId, decisionId, {
    decision: decisionResponse,
    note: response === 'allow-always' ? 'Persistent rule added to tool-policy.local.json' : undefined,
  })

  // For allow-always, persist the rule.
  if (response === 'allow-always' && sender && toolName) {
    addAllowAlwaysRule(sender, toolName)
  }

  return response
}

// ── Query ────────────────────────────────────────────────────────────

/**
 * List pending exec-approval requests for a project.
 * Filters the general decisions queue for exec-approval kinds.
 */
export function listPendingApprovals(projectId: string): DecisionRequest[] {
  const all = listDecisions(projectId, { status: 'open' })
  return all.filter(d =>
    d.ask.startsWith('Exec approval:')
  )
}

/**
 * Check if a tool has a pending approval request for a given sender.
 * Used to avoid creating duplicate requests.
 */
export function hasPendingApproval(
  projectId: string,
  toolName: string,
  sender: Sender,
): boolean {
  const pending = listPendingApprovals(projectId)
  return pending.some(d =>
    d.ask.includes(toolName) && d.ask.includes(sender)
  )
}

/**
 * Pre-tick check: for a list of tools requested by a sender, determine
 * which need approval and which are already approved.
 *
 * Returns:
 *   - approved: tools that are allowed (including allow-always rules)
 *   - needsApproval: tools that need exec-approval (requests created)
 *   - denied: tools filtered by policy (not dangerous, just blocked)
 *
 * This is the integration point for the tick loop.
 */
export function resolveToolApprovals(
  projectId: string,
  tools: string[],
  sender: Sender,
  channelId: string,
  policy: ToolPolicy,
): {
  approved: string[]
  needsApproval: string[]
  denied: string[]
} {
  const approved: string[] = []
  const needsApproval: string[] = []
  const denied: string[] = []

  for (const tool of tools) {
    if (!isDangerous(tool, sender, policy)) {
      approved.push(tool)
      continue
    }

    // Tool is dangerous. Check for allow-always.
    if (hasAllowAlwaysRule(sender, tool)) {
      approved.push(tool)
      continue
    }

    // Need approval. Create request if not already pending.
    if (!hasPendingApproval(projectId, tool, sender)) {
      requestExecApproval(projectId, {
        toolName: tool,
        sender,
        channelId,
      })
    }

    needsApproval.push(tool)
  }

  return { approved, needsApproval, denied }
}
