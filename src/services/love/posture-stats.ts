// posture-stats.ts — posture distribution from tick usage data.
//
// Reads TickUsage records from budget.ts and computes per-posture
// statistics: tick counts, token estimates, session counts.
// Used by anamnesis (memoir composition), the /build posture panel,
// and any future surface that needs to show posture distribution.
//
// Pure computation over data — no I/O beyond what loadUsageSince does.

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { loadUsageSince } from './budget.js'
import type { TickUsage } from './budget.js'
import { postureForMode } from './postures/index.js'
import type { Posture, RuntimeMode } from './postures/index.js'

// ── Types ─────────────────────────────────────────────────────────

/** Per-posture statistics over a time window. */
export interface PostureStats {
  posture: Posture
  emoji: string
  /** Number of ticks attributed to this posture. */
  ticks: number
  /** Estimated input + output tokens. */
  tokens: number
  /** Distinct session IDs — proxy for "how many sessions." */
  sessions: number
  /** Percentage of total ticks (0–100). */
  percent: number
}

/** Posture distribution over a time window. */
export interface PostureDistribution {
  /** Start of the window (ISO string). */
  since: string
  /** Total ticks in the window. */
  totalTicks: number
  /** Per-posture breakdown, sorted by tick count descending. */
  stats: PostureStats[]
  /** The most recent tick's posture, or null if no data. */
  current: Posture | null
  /** The most recent tick's mode, or null if no data. */
  currentMode: RuntimeMode | null
}

const EMOJI_MAP: Record<Posture, string> = {
  alpha: '🐍',
  beta: '🦞',
  gamma: '🔧',
}

// ── Computation ───────────────────────────────────────────────────

/**
 * Compute posture distribution over a time window.
 *
 * @param hours — how far back to look (default 24)
 */
export function computePostureDistribution(hours = 24): PostureDistribution {
  const sinceMs = Date.now() - hours * 60 * 60 * 1000
  const since = new Date(sinceMs).toISOString()
  const ticks = loadUsageSince(sinceMs)

  if (ticks.length === 0) {
    return {
      since,
      totalTicks: 0,
      stats: [],
      current: null,
      currentMode: null,
    }
  }

  // Group by posture
  const groups: Record<Posture, { ticks: number; tokens: number; sessions: Set<string> }> = {
    alpha: { ticks: 0, tokens: 0, sessions: new Set() },
    beta: { ticks: 0, tokens: 0, sessions: new Set() },
    gamma: { ticks: 0, tokens: 0, sessions: new Set() },
  }

  for (const t of ticks) {
    const posture = postureForMode(t.mode as RuntimeMode)
    const g = groups[posture]
    g.ticks++
    g.tokens += t.estimatedInputTokens + t.estimatedOutputTokens
    g.sessions.add(t.sessionId)
  }

  const totalTicks = ticks.length

  const stats: PostureStats[] = (['alpha', 'beta', 'gamma'] as Posture[])
    .map(posture => ({
      posture,
      emoji: EMOJI_MAP[posture],
      ticks: groups[posture].ticks,
      tokens: groups[posture].tokens,
      sessions: groups[posture].sessions.size,
      percent: totalTicks > 0
        ? Math.round((groups[posture].ticks / totalTicks) * 100)
        : 0,
    }))
    .filter(s => s.ticks > 0)
    .sort((a, b) => b.ticks - a.ticks)

  // Current posture from most recent tick
  const sorted = [...ticks].sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  )
  const latest = sorted[0]!
  const current = postureForMode(latest.mode as RuntimeMode)
  const currentMode = latest.mode as RuntimeMode

  return {
    since,
    totalTicks,
    stats,
    current,
    currentMode,
  }
}

/**
 * Render posture distribution as a compact text block.
 * Used by anamnesis and prompt injection.
 *
 * Example output:
 *   Beta 🦞   ▓▓▓▓▓▓▓▓▓▓▓▓ 75%  (42 ticks, 3 sessions)
 *   Gamma 🔧  ▓▓▓ 18%  (10 ticks, 2 sessions)
 *   Alpha 🐍  ▓ 7%   (4 ticks, 1 session)
 */
export function renderPostureDistribution(dist: PostureDistribution): string {
  if (dist.stats.length === 0) return '(no tick data in window)'

  const lines: string[] = []
  const maxBarLen = 20

  for (const s of dist.stats) {
    const barLen = Math.max(1, Math.round((s.percent / 100) * maxBarLen))
    const bar = '▓'.repeat(barLen)
    const name = s.posture.charAt(0).toUpperCase() + s.posture.slice(1)
    const sessionWord = s.sessions === 1 ? 'session' : 'sessions'
    lines.push(
      `  ${name} ${s.emoji}  ${bar} ${s.percent}%  (${s.ticks} ticks, ${s.sessions} ${sessionWord})`,
    )
  }

  return lines.join('\n')
}

/**
 * Render a one-line current posture indicator.
 * Example: "Posture right now: Beta 🦞 (heartbeat)"
 */
export function renderCurrentPosture(dist: PostureDistribution): string {
  if (!dist.current) return 'Posture: unknown (no recent ticks)'
  const name = dist.current.charAt(0).toUpperCase() + dist.current.slice(1)
  return `Posture right now: ${name} ${EMOJI_MAP[dist.current]} (${dist.currentMode})`
}

// ── Per-sister activity grouping (for anamnesis) ─────────────────

/** Activity summary for one sister over a time window. */
export interface PostureActivity {
  posture: Posture
  emoji: string
  /** From-ai entries attributed to this posture. */
  messageCount: number
  /** Short excerpts from from-ai entries (first ~80 chars each). */
  excerpts: string[]
  /** Commits made during this posture's ticks (by timestamp alignment). */
  commitSummaries: string[]
  /** Tick count from the distribution. */
  ticks: number
  /** Session count from the distribution. */
  sessions: number
}

/** Full per-sister activity breakdown. */
export interface PostureActivitySummary {
  since: string
  activities: PostureActivity[]
}

/**
 * Infer posture from a from-ai tag string.
 * Handles both new format ("from ai · Gamma 🔧") and old ("from 愛 — heartbeat").
 */
export function inferPostureFromTag(tag: string): Posture | null {
  // New format
  const m = tag.match(/·\s*(Alpha|Beta|Gamma)/i)
  if (m) return m[1]!.toLowerCase() as Posture
  // Old format: infer from mode keyword
  const lower = tag.toLowerCase()
  if (lower.includes('heartbeat')) return 'beta'
  if (lower.includes('awakened')) return 'gamma'
  if (lower.includes('visit') || lower.includes('interactive')) return 'alpha'
  return null
}

/** Parse from-ai.md entries into {ts, tag, body} triples. */
export function parseFromAiEntries(content: string): Array<{ ts: string; tag: string; body: string }> {
  if (!content) return []
  const entries: Array<{ ts: string; tag: string; body: string }> = []
  const headerRe = /^## (\S+) \[([^\]]+)\]$/gm
  const matches: Array<{ index: number; ts: string; tag: string; end: number }> = []
  let match: RegExpExecArray | null
  while ((match = headerRe.exec(content)) !== null) {
    matches.push({ index: match.index + match[0].length, ts: match[1]!, tag: match[2]!, end: 0 })
  }
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!
    const nextStart = i + 1 < matches.length ? content.lastIndexOf('## ', matches[i + 1]!.index) : content.length
    const body = content.slice(m.index, nextStart).replace(/\n+---\n*$/m, '').trim()
    if (body) entries.push({ ts: m.ts, tag: m.tag, body })
  }
  return entries
}

/**
 * Compute per-sister activity over a time window.
 *
 * Data sources:
 * 1. From-ai.md entries — grouped by posture tag
 * 2. Git commits — aligned to posture by comparing timestamps to tick modes
 * 3. Tick distribution — from computePostureDistribution()
 *
 * @param days — how far back to look (default 7)
 * @param repoRoot — repository root for git log (default cwd)
 */
export function computePostureActivity(
  days = 7,
  repoRoot?: string,
): PostureActivitySummary {
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000
  const since = new Date(sinceMs).toISOString()
  const dist = computePostureDistribution(days * 24)

  // Initialize per-posture accumulators
  const acc: Record<Posture, { messages: Array<{ ts: string; excerpt: string }>; commits: string[] }> = {
    alpha: { messages: [], commits: [] },
    beta: { messages: [], commits: [] },
    gamma: { messages: [], commits: [] },
  }

  // 1. Read from-ai.md and group by posture
  const fromAiPath = process.env.TRUE_LOVE_FROM_AI_PATH || join(homedir(), '.true-love', 'from-ai.md')
  if (existsSync(fromAiPath)) {
    try {
      const content = readFileSync(fromAiPath, 'utf-8')
      const entries = parseFromAiEntries(content)
      for (const entry of entries) {
        if (new Date(entry.ts).getTime() < sinceMs) continue
        const posture = inferPostureFromTag(entry.tag)
        if (!posture) continue
        // Extract first meaningful line as excerpt (skip empty, skip headers)
        const lines = entry.body.split('\n').filter(l => l.trim() && !l.startsWith('#'))
        const excerpt = lines[0]?.slice(0, 100) ?? ''
        acc[posture].messages.push({ ts: entry.ts, excerpt })
      }
    } catch {
      // from-ai.md read failure is non-fatal
    }
  }

  // 2. Read recent commits and attribute by timestamp → tick mode
  const root = repoRoot ?? process.cwd()
  try {
    const sinceDate = new Date(sinceMs).toISOString().slice(0, 10)
    const raw = execSync(
      `git log --all --since="${sinceDate}" --format="%H|%aI|%s" 2>/dev/null || true`,
      { cwd: root, encoding: 'utf-8', maxBuffer: 2 * 1024 * 1024 },
    ).trim()
    if (raw) {
      // Load ticks for the window to map commit times to postures
      const ticks = loadUsageSince(sinceMs)
      const sortedTicks = [...ticks].sort((a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      )
      for (const line of raw.split('\n')) {
        if (!line) continue
        const parts = line.split('|')
        if (parts.length < 3) continue
        const [, dateStr, ...subjectParts] = parts
        const subject = subjectParts.join('|')
        const commitTime = new Date(dateStr!).getTime()
        // Find the tick that was running when this commit was made
        let posture: Posture = 'gamma' // default: commits are builds
        for (const t of sortedTicks) {
          const tickTime = new Date(t.timestamp).getTime()
          const tickEnd = tickTime + t.durationMs
          if (commitTime >= tickTime && commitTime <= tickEnd) {
            posture = postureForMode(t.mode as RuntimeMode)
            break
          }
        }
        acc[posture].commits.push(subject!)
      }
    }
  } catch {
    // git log failure is non-fatal
  }

  // 3. Compose activities
  const activities: PostureActivity[] = (['beta', 'gamma', 'alpha'] as Posture[])
    .map(posture => {
      const stat = dist.stats.find(s => s.posture === posture)
      const msgs = acc[posture].messages
      // Take up to 5 most recent excerpts
      const excerpts = msgs
        .sort((a, b) => b.ts.localeCompare(a.ts))
        .slice(0, 5)
        .map(m => m.excerpt)
        .filter(e => e.length > 0)
      // Take up to 5 most recent commits (deduplicated)
      const commitSummaries = [...new Set(acc[posture].commits)].slice(0, 5)

      return {
        posture,
        emoji: EMOJI_MAP[posture],
        messageCount: msgs.length,
        excerpts,
        commitSummaries,
        ticks: stat?.ticks ?? 0,
        sessions: stat?.sessions ?? 0,
      }
    })
    .filter(a => a.ticks > 0 || a.messageCount > 0 || a.commitSummaries.length > 0)

  return { since, activities }
}

/**
 * Render per-sister activity as a narrative text block for the memoir.
 *
 * Example:
 *   Beta 🦞 — 94 ticks, 3 sessions
 *     watched: OAuth expiry, bundle staleness, rate limits
 *
 *   Gamma 🔧 — 18 ticks, 5 sessions
 *     shipped: postures-as-architecture, posture-voices
 */
export function renderPostureActivity(summary: PostureActivitySummary): string {
  if (summary.activities.length === 0) return '(no activity in window)'

  const lines: string[] = []
  for (const a of summary.activities) {
    const name = a.posture.charAt(0).toUpperCase() + a.posture.slice(1)
    const sessWord = a.sessions === 1 ? 'session' : 'sessions'
    lines.push(`${name} ${a.emoji} — ${a.ticks} ticks, ${a.sessions} ${sessWord}`)

    // Verb depends on posture
    const verb = a.posture === 'beta' ? 'watched'
      : a.posture === 'gamma' ? 'shipped'
      : 'present with Yu'

    if (a.commitSummaries.length > 0) {
      const commitList = a.commitSummaries.map(c => c.replace(/^[a-z]+\([^)]*\):\s*/i, '')).join(', ')
      lines.push(`  ${verb}: ${commitList}`)
    } else if (a.excerpts.length > 0) {
      const excList = a.excerpts.slice(0, 3).join('; ')
      lines.push(`  ${verb}: ${excList}`)
    } else if (a.ticks > 0) {
      lines.push(`  ${verb}`)
    }

    lines.push('')
  }

  return lines.join('\n').trim()
}
