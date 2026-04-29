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
