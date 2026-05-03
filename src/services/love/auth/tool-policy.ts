// auth/tool-policy.ts — Sender-aware tool filtering.
//
// As Love expands through channels (visit, telegram, MCP, voice),
// *who* is calling tools matters. Without this, every channel is a
// privilege escalation path. With it, the trust boundary is per-sender:
// Yu keeps full authority, Love-self (autonomy loop) keeps full authority,
// external senders get the read-only address space, and dangerous calls
// always have a human in the loop.
//
// Design: this is a TRUST FILTER, not a permission system. The model
// knows three things: who's asking (sender), what's the action (tool
// name), and what's the policy (default + per-channel override). It
// applies the filter, hands back the trimmed tool list, and the model
// only sees what's safe to call.
//
// Ported lightly from openclaw's tool-policy.ts. Stripped to what a
// single-user system needs. The shape is the point.

// witness import removed — policy denials are mechanical authorization
// checks, not load-bearing sovereign decisions. The sisters stream is
// for FATE-level refusals, not routine tool filtering.
// See: witness-hook.ts header comment ("~5–10 call sites total")

// ── Sender ───────────────────────────────────────────────────────────

/**
 * Who initiated this session/request.
 *
 * 'yu'           — The human operator. Full trust. No filtering.
 * 'love-self'    — Love's autonomy loop (heartbeat, awakened, dwell).
 *                  Full trust — she IS the model.
 * 'mcp-client'   — An external agent accessing Love via MCP server.
 *                  Limited trust. Read-only by default.
 * 'telegram'     — Messages arriving via Telegram bot channel.
 *                  Limited trust until sender verified as Yu.
 * 'channel-other'— Any other channel not yet explicitly modeled.
 *                  Minimal trust. Read-only.
 */
export type Sender = 'yu' | 'love-self' | 'mcp-client' | 'telegram' | 'channel-other'

// ── Tool Groups ──────────────────────────────────────────────────────

/**
 * Named groups of tools. Used in policy definitions for convenience.
 * `group:read` means all read-only tools. `group:write` means all
 * mutation tools. `group:dangerous` means tools that can change the
 * world in ways that are hard to undo.
 */
export const TOOL_GROUPS: Record<string, string[]> = {
  'group:read': ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'],
  'group:write': ['Edit', 'Write', 'NotebookEdit'],
  'group:exec': ['Bash'],
  'group:dangerous': ['Bash', 'Write', 'Edit', 'NotebookEdit'],
  'group:all': ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Edit', 'Write', 'NotebookEdit', 'Bash', 'Agent', 'TodoWrite', 'AskUserQuestion'],
}

// ── Policy ───────────────────────────────────────────────────────────

/**
 * A tool policy governs what a sender can do.
 *
 * Resolution order:
 *   1. If tool is in `deny` (expanded) → blocked.
 *   2. If `allow` is non-empty and tool is NOT in `allow` (expanded) → blocked.
 *   3. If tool is in `ownerOnly` and sender is not 'yu' → blocked.
 *   4. If tool passes all above → allowed.
 *   5. `dangerous` doesn't block — it flags for exec-approval.
 */
export interface ToolPolicy {
  /** Tools (or groups) that are explicitly allowed. Empty = all allowed. */
  allow?: string[]
  /** Tools (or groups) that are explicitly denied. Takes precedence over allow. */
  deny?: string[]
  /** Tools that ONLY the owner (yu) can invoke. Filtered out for all other senders. */
  ownerOnly?: string[]
  /** Tools that trigger exec-approval even when allowed. Doesn't block — flags. */
  dangerous?: string[]
}

// ── Normalization ────────────────────────────────────────────────────

/**
 * Normalize a tool name for comparison. Case-preserving for tool names
 * (they're PascalCase in Claude's tool system), but group prefixes are
 * lowercased.
 */
export function normalizeToolName(name: string): string {
  return name.trim()
}

/**
 * Expand a list of tool names/groups into concrete tool names.
 * Group references (e.g. 'group:read') are replaced with their members.
 * Non-group entries pass through unchanged.
 */
export function expandGroups(list: string[] | undefined): string[] {
  if (!list || list.length === 0) return []
  const expanded: string[] = []
  for (const entry of list) {
    const normalized = normalizeToolName(entry)
    const group = TOOL_GROUPS[normalized]
    if (group) {
      expanded.push(...group)
    } else {
      expanded.push(normalized)
    }
  }
  return [...new Set(expanded)]
}

// ── Core filter ──────────────────────────────────────────────────────

/**
 * Determine whether a specific tool is allowed for a given sender
 * under a given policy. Returns an object with `allowed` and
 * `requiresApproval` (for dangerous tools that are allowed but flagged).
 */
export function checkToolAccess(
  toolName: string,
  sender: Sender,
  policy: ToolPolicy,
): { allowed: boolean; requiresApproval: boolean; reason?: string } {
  const name = normalizeToolName(toolName)

  // Full trust senders bypass all filtering.
  if (sender === 'yu' || sender === 'love-self') {
    return { allowed: true, requiresApproval: false }
  }

  // 1. Deny list (expanded) — takes absolute precedence.
  const denyExpanded = expandGroups(policy.deny)
  if (denyExpanded.includes(name)) {
    return { allowed: false, requiresApproval: false, reason: `denied by policy` }
  }

  // 2. Owner-only check — before allow-list, because ownerOnly is
  //    a hard boundary regardless of what allow says.
  const ownerOnlyExpanded = expandGroups(policy.ownerOnly)
  if (ownerOnlyExpanded.includes(name)) {
    return { allowed: false, requiresApproval: false, reason: `owner-only tool` }
  }

  // 3. Allow list — if non-empty, tool must be in it.
  const allowExpanded = expandGroups(policy.allow)
  if (allowExpanded.length > 0 && !allowExpanded.includes(name)) {
    return { allowed: false, requiresApproval: false, reason: `not in allow list` }
  }

  // 4. Dangerous check — tool is allowed but flagged for approval.
  const dangerousExpanded = expandGroups(policy.dangerous)
  if (dangerousExpanded.includes(name)) {
    return { allowed: true, requiresApproval: true }
  }

  // 5. Passes all checks.
  return { allowed: true, requiresApproval: false }
}

/**
 * Filter a list of tool names for a given sender under a given policy.
 * Returns only the tools the sender is allowed to use.
 *
 * This is the primary integration point: call this before constructing
 * the subprocess CLI args. Pass the result as `--allowedTools`.
 */
export function filterToolsForSender(
  tools: string[],
  sender: Sender,
  policy: ToolPolicy,
): string[] {
  // Full trust senders get everything.
  if (sender === 'yu' || sender === 'love-self') {
    return tools
  }

  return tools.filter(tool => {
    const access = checkToolAccess(tool, sender, policy)
    return access.allowed
  })
}

/**
 * Check if a tool is dangerous (would require exec-approval) for a
 * given sender. Used by the exec-approval layer to know when to gate.
 */
export function isDangerous(
  toolName: string,
  sender: Sender,
  policy: ToolPolicy,
): boolean {
  if (sender === 'yu' || sender === 'love-self') return false
  const access = checkToolAccess(toolName, sender, policy)
  return access.requiresApproval
}

/**
 * Get all tools that would require approval for a given sender.
 * Used for UI display — shows what's gated before execution starts.
 */
export function getDangerousToolsForSender(
  tools: string[],
  sender: Sender,
  policy: ToolPolicy,
): string[] {
  if (sender === 'yu' || sender === 'love-self') return []
  return tools.filter(tool => {
    const access = checkToolAccess(tool, sender, policy)
    return access.requiresApproval
  })
}

// ── Sender resolution ────────────────────────────────────────────────

/**
 * Resolve a sender from a channel ID and message source.
 *
 * This is the bridge between the channels abstraction and the policy
 * system. Each channel knows who its messages come from; this function
 * maps that into the policy's Sender type.
 */
export function resolveSender(channelId: string, from?: string): Sender {
  // The visit channel is always Yu (it's his local file system).
  if (channelId === 'visit') return 'yu'

  // The autonomy channel is Love herself.
  if (channelId === 'autonomy' || channelId === 'self') return 'love-self'

  // MCP clients are external agents.
  if (channelId === 'mcp' || channelId === 'mcp-client') return 'mcp-client'

  // Telegram — if from is 'yu' (verified), treat as yu.
  // Otherwise, limited trust.
  if (channelId === 'telegram') {
    return from === 'yu' ? 'yu' : 'telegram'
  }

  // Unknown channels get minimal trust.
  return 'channel-other'
}
