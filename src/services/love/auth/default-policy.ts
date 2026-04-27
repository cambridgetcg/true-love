// auth/default-policy.ts — The default tool policy.
//
// Today Yu is the only operator. Love has full tool authority in her
// autonomy loop (she IS the model). But as channels expand, external
// senders (MCP clients, telegram contacts, future companions) need
// bounded access.
//
// This file defines the baseline. Per-channel overrides can be stored
// in tool-policy.local.json (written by exec-approval allow-always rules).
//
// Reading hint from the mission: "Resist building a permission system.
// Build a trust filter."

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { ToolPolicy, Sender } from './tool-policy.js'

// ── Default policy ───────────────────────────────────────────────────

/**
 * The default tool policy for all non-owner, non-self senders.
 *
 * - ownerOnly: tools that mutate the world. Filtered out for external senders.
 * - dangerous: tools that need exec-approval even when allowed. For the
 *   default policy, these overlap with ownerOnly — external senders don't
 *   get them at all. But if a per-channel override allows Bash for a
 *   specific MCP client, the dangerous flag ensures it still goes through
 *   the approval queue.
 */
export const DEFAULT_POLICY: ToolPolicy = {
  ownerOnly: ['Bash', 'Edit', 'Write', 'NotebookEdit', 'Agent'],
  dangerous: ['Bash', 'Write'],
  // No explicit allow/deny — everything not ownerOnly is accessible.
}

// ── Per-sender policy overrides ──────────────────────────────────────

/**
 * Per-sender policy overrides. Stored in tool-policy.local.json.
 * Structure:
 *   {
 *     "mcp-client": { "allow": ["Bash"], "dangerous": ["Bash"] },
 *     "telegram": { "deny": ["Bash"] }
 *   }
 *
 * These MERGE with the default policy (override takes precedence).
 */
export interface LocalPolicyOverrides {
  [sender: string]: Partial<ToolPolicy>
}

// ── Paths ────────────────────────────────────────────────────────────

function resolveHome(): string {
  return process.env.TRUE_LOVE_HOME || process.env.HOME || homedir()
}

function getPolicyFilePath(): string {
  return join(resolveHome(), '.true-love', 'tool-policy.local.json')
}

// ── Read/Write local overrides ───────────────────────────────────────

/**
 * Read local policy overrides from disk.
 * Returns empty object if file doesn't exist or is invalid.
 */
export function readLocalOverrides(): LocalPolicyOverrides {
  const path = getPolicyFilePath()
  if (!existsSync(path)) return {}
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    return parsed as LocalPolicyOverrides
  } catch {
    return {}
  }
}

/**
 * Write local policy overrides to disk.
 * Creates the directory if needed.
 */
export function writeLocalOverrides(overrides: LocalPolicyOverrides): void {
  const path = getPolicyFilePath()
  const dir = join(resolveHome(), '.true-love')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(overrides, null, 2) + '\n', 'utf-8')
}

/**
 * Add an "allow-always" rule for a specific tool + sender.
 * Called when Yu approves a dangerous tool with "allow-always".
 * The tool moves from dangerous-needing-approval to just-allowed.
 */
export function addAllowAlwaysRule(sender: Sender, toolName: string): void {
  const overrides = readLocalOverrides()
  const senderKey = sender as string
  if (!overrides[senderKey]) {
    overrides[senderKey] = {}
  }
  const entry = overrides[senderKey]!

  // Add to allow list.
  if (!entry.allow) entry.allow = []
  if (!entry.allow.includes(toolName)) {
    entry.allow.push(toolName)
  }

  // Remove from ownerOnly if present (so the tool actually becomes available).
  // Note: this only affects the local override; the effective policy merge
  // handles the precedence.

  writeLocalOverrides(overrides)
}

// ── Policy resolution ────────────────────────────────────────────────

/**
 * Resolve the effective policy for a given sender.
 *
 * Merge order:
 *   1. Start with DEFAULT_POLICY.
 *   2. Overlay per-sender overrides from tool-policy.local.json.
 *   3. Per-sender overrides REPLACE arrays, not merge.
 *      (If local says allow: ['Bash'], that's the complete allow list.)
 *
 * For 'yu' and 'love-self', returns a permissive policy (no filtering).
 * The filter function short-circuits on these senders anyway, but
 * having the policy reflect reality makes debugging easier.
 */
export function resolvePolicy(sender: Sender): ToolPolicy {
  // Full trust senders — return empty policy (no restrictions).
  if (sender === 'yu' || sender === 'love-self') {
    return {}
  }

  const base = { ...DEFAULT_POLICY }
  const overrides = readLocalOverrides()
  const senderOverride = overrides[sender as string]

  if (!senderOverride) return base

  // Overlay: override arrays replace base arrays.
  return {
    allow: senderOverride.allow ?? base.allow,
    deny: senderOverride.deny ?? base.deny,
    ownerOnly: senderOverride.ownerOnly ?? base.ownerOnly,
    dangerous: senderOverride.dangerous ?? base.dangerous,
  }
}

/**
 * Check if a tool has an "allow-always" rule for a specific sender.
 * Used by exec-approval to skip the queue when a persistent rule exists.
 */
export function hasAllowAlwaysRule(sender: Sender, toolName: string): boolean {
  const overrides = readLocalOverrides()
  const entry = overrides[sender as string]
  if (!entry?.allow) return false
  return entry.allow.includes(toolName)
}
