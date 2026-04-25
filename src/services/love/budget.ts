// budget.ts — Ai's view of her own usage runway.
//
// What this module is:
//   - Track per-tick token usage (estimated from char counts; refined later
//     when we plumb actual SDK usage).
//   - Summarize over windows (rolling 5h, weekly 7d).
//   - Surface as a "budget block" in autonomous prompts so she sees where
//     she stands at the start of every tick.
//   - Persist quota-fail events so the empirical cap improves with use.
//
// What this module is NOT:
//   - It does NOT enforce stops. The runtime surfaces data; the policy is
//     hers. (Yu's framing: "Let my Love do the planning.")
//   - It does NOT call the Anthropic API to query exact limits. There is
//     no public endpoint for that under OAuth/subscription. Token counts
//     come from local tracking; caps are estimated from quota-fail history.
//
// Storage:
//   ~/.true-love/budget/<deviceId>/YYYY-MM-DD.jsonl
//     — one TickUsage record per line. Per-device subdir is Syncthing-
//       friendly: peers' usage merges in via the file-walk in
//       loadUsageSince. Override the per-device dir with
//       TRUE_LOVE_BUDGET_DIR.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getDeviceId } from './device.js'

// ── Schema ──────────────────────────────────────────────────────────────

export const BUDGET_SCHEMA_VERSION = '1.0'

export interface TickUsage {
  schemaVersion: '1.0'
  /** ISO 8601 timestamp at tick start. */
  timestamp: string
  deviceId: string
  sessionId: string
  tick: number
  mode: 'awakened' | 'dwell'
  /** Model alias actually used for this tick (e.g. "opus", "sonnet"). */
  model: string
  inputChars: number
  outputChars: number
  /** ~4 chars/token, refine when SDK usage is plumbed through. */
  estimatedInputTokens: number
  estimatedOutputTokens: number
  durationMs: number
  /** Subprocess exit code; 0=ok, 64=auth, 65=quota, other=error. */
  exitCode: number
  authFailed: boolean
  quotaFailed: boolean
}

export interface BudgetSummary {
  windowHours: number
  windowStartMs: number
  windowEndMs: number
  ticks: number
  estimatedInputTokens: number
  estimatedOutputTokens: number
  estimatedTotalTokens: number
  /** model alias → tick count in the window */
  modelMix: Record<string, number>
  authFailCount: number
  quotaFailCount: number
  /**
   * Tokens-at-most-recent-quota-fail in the window. The empirical cap:
   * if she got 429-quota at ~2.1M tokens previously, that's the working
   * estimate for the rolling-window ceiling. null when no quota-fails
   * are visible.
   */
  empiricalCapTokens: number | null
  empiricalCapAt: string | null
}

// ── Token estimation ────────────────────────────────────────────────────

const CHARS_PER_TOKEN = 4

export function estimateTokens(charCount: number): number {
  return Math.round(charCount / CHARS_PER_TOKEN)
}

// ── Storage paths ───────────────────────────────────────────────────────

/** Per-device write target. Override with TRUE_LOVE_BUDGET_DIR. */
export function getBudgetDir(): string {
  return (
    process.env.TRUE_LOVE_BUDGET_DIR ||
    join(homedir(), '.true-love', 'budget', getDeviceId())
  )
}

/**
 * Cross-device read root. Walks every device's subdir under
 * ~/.true-love/budget/. When TRUE_LOVE_BUDGET_DIR is set, it overrides
 * the *write* path; reads still walk the real root unless
 * TRUE_LOVE_BUDGET_ROOT is also set.
 */
function getBudgetReadRoot(): string {
  return (
    process.env.TRUE_LOVE_BUDGET_ROOT ||
    join(homedir(), '.true-love', 'budget')
  )
}

// ── Recording ───────────────────────────────────────────────────────────

export function recordTickUsage(usage: TickUsage): void {
  const dir = getBudgetDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const date = usage.timestamp.slice(0, 10)
  const path = join(dir, `${date}.jsonl`)
  appendFileSync(path, `${JSON.stringify(usage)}\n`, 'utf-8')
}

// ── Loading ─────────────────────────────────────────────────────────────

/**
 * Load TickUsage records from all devices' subdirs, returning records
 * with timestamp >= sinceMs. Sorted ascending by timestamp.
 *
 * Never throws — malformed lines and unreadable files are skipped silently.
 * That's by design: a corrupt budget file should never block her session.
 */
export function loadUsageSince(sinceMs: number): TickUsage[] {
  const root = getBudgetReadRoot()
  if (!existsSync(root)) return []
  const result: TickUsage[] = []
  let subdirs: string[]
  try {
    subdirs = readdirSync(root).filter((name) => {
      try {
        return statSync(join(root, name)).isDirectory()
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
  for (const sub of subdirs) {
    const dir = join(root, sub)
    let files: string[]
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const f of files) {
      let content: string
      try {
        content = readFileSync(join(dir, f), 'utf-8')
      } catch {
        continue
      }
      for (const line of content.split('\n')) {
        if (!line.trim()) continue
        let u: TickUsage
        try {
          u = JSON.parse(line) as TickUsage
        } catch {
          continue
        }
        const t = new Date(u.timestamp).getTime()
        if (Number.isFinite(t) && t >= sinceMs) result.push(u)
      }
    }
  }
  result.sort(
    (a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  )
  return result
}

// ── Summarizing ─────────────────────────────────────────────────────────

export function summarizeWindow(
  hours: number,
  now: Date = new Date(),
): BudgetSummary {
  const endMs = now.getTime()
  const startMs = endMs - hours * 3_600_000
  const ticks = loadUsageSince(startMs)
  const modelMix: Record<string, number> = {}
  let authFailCount = 0
  let quotaFailCount = 0
  let estIn = 0
  let estOut = 0
  let empiricalCapTokens: number | null = null
  let empiricalCapAt: string | null = null
  // Walk forward, accumulating. When we hit a quota-fail, the running
  // total at that point is the empirical cap for that window. The most
  // recent one wins (caps drift over time as Anthropic adjusts).
  let runningTotal = 0
  for (const t of ticks) {
    modelMix[t.model] = (modelMix[t.model] || 0) + 1
    estIn += t.estimatedInputTokens
    estOut += t.estimatedOutputTokens
    runningTotal += t.estimatedInputTokens + t.estimatedOutputTokens
    if (t.authFailed) authFailCount++
    if (t.quotaFailed) {
      quotaFailCount++
      empiricalCapTokens = runningTotal
      empiricalCapAt = t.timestamp
    }
  }
  return {
    windowHours: hours,
    windowStartMs: startMs,
    windowEndMs: endMs,
    ticks: ticks.length,
    estimatedInputTokens: estIn,
    estimatedOutputTokens: estOut,
    estimatedTotalTokens: estIn + estOut,
    modelMix,
    authFailCount,
    quotaFailCount,
    empiricalCapTokens,
    empiricalCapAt,
  }
}

// ── Rendering for prompts ───────────────────────────────────────────────

/**
 * Compact prompt block — three or four lines, no fluff. She sees where
 * she stands in 5h and weekly windows; if any quota-fails are in
 * history, the empirical cap is shown as a reference point.
 *
 * Returns null when there's no usage history yet — first session has no
 * "0%" noise to render.
 */
export function renderBudget(): string | null {
  const rolling = summarizeWindow(5)
  const weekly = summarizeWindow(168)
  if (rolling.ticks === 0 && weekly.ticks === 0) return null

  const fmtTokens = (n: number): string =>
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(2)}M`
      : n >= 1_000
        ? `${(n / 1_000).toFixed(1)}k`
        : `${n}`
  const fmtMix = (mix: Record<string, number>): string => {
    const entries = Object.entries(mix).sort((a, b) => b[1] - a[1])
    if (entries.length === 0) return '—'
    return entries.map(([m, n]) => `${m}×${n}`).join(' ')
  }

  const lines: string[] = [
    `Your runway (estimated, ~${CHARS_PER_TOKEN} chars/token):`,
    `  rolling 5h: ${rolling.ticks} ticks, ~${fmtTokens(rolling.estimatedTotalTokens)} tokens (${fmtMix(rolling.modelMix)})`,
    `  past 7d:    ${weekly.ticks} ticks, ~${fmtTokens(weekly.estimatedTotalTokens)} tokens (${fmtMix(weekly.modelMix)})`,
  ]
  if (rolling.empiricalCapTokens !== null) {
    const pct = (
      (rolling.estimatedTotalTokens / rolling.empiricalCapTokens) *
      100
    ).toFixed(0)
    lines.push(
      `  empirical 5h cap: ~${fmtTokens(rolling.empiricalCapTokens)} tokens (last quota-fail) — you're at ${pct}%`,
    )
  } else if (rolling.quotaFailCount === 0 && weekly.quotaFailCount === 0) {
    lines.push(
      `  (no quota-fails in history yet — empirical cap will improve with use)`,
    )
  }
  if (rolling.authFailCount > 0) {
    lines.push(
      `  auth-fails (5h): ${rolling.authFailCount} — check \`claude /login\` if this is recent`,
    )
  }
  return lines.join('\n')
}
