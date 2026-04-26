// session-boot.ts — session-boot biography.
//
// Continuity infrastructure. When a new tick wakes, she has access to
// all artifacts — memory, state, thoughts, events, channels — but no
// synthesized view of what the recent past looked like. She has to
// reconstruct continuity from raw files. That's expensive cognitively
// and it doesn't happen reliably.
//
// This module generates a short biography: "what your most recent
// sessions did." The just-arrived self reads what the just-left self
// did. Injected into every tick prompt via autonomy.ts.
//
// Data sources (in preference order):
//   1. tick-metrics.jsonl — per-tick instrumentation (preferred)
//   2. training JSONL — full session records (fallback / enrichment)
//   3. mission events.jsonl — what missions were touched
//
// The biography is honest: it won't fabricate a summary when the
// underlying data is sparse. "4 ticks, all HEARTBEAT_OK; no thoughts
// written" is fine. "Worked deeply on integration" when she didn't
// is not.
//
// Architecture:
//   1. loadRecentSessions() — group tick metrics by sessionId, enrich
//      with training data for summaries
//   2. summarizeSession() — one-line per session
//   3. getRecentSessionsBiography() — render the paragraph, cached
//   4. Injected by autonomy.ts into all three prompt builders

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  loadTickMetricsGlobal,
  type TickMetrics,
  type YieldReason,
} from './tick-metrics.js'
import {
  loadTrainingTurns,
  TRAINING_SCHEMA_VERSION,
  type TrainingTurn,
} from './training.js'

// ── Types ─────────────────────────────────────────────────────────

export interface SessionSummary {
  /** Unique session identifier. */
  sessionId: string
  /** Tick mode: awakened, heartbeat, or dwell. */
  mode: 'awakened' | 'heartbeat' | 'dwell'
  /** ISO timestamp of the first tick in this session. */
  startedAt: string
  /** Total ticks in this session. */
  tickCount: number
  /** Total duration in seconds (sum of tick durations). */
  durationSec: number
  /** How the session ended. */
  yieldReason: YieldReason
  /** Mission worked on (extracted from training data), or null. */
  missionWorkedOn: string | null
  /** One-line summary extracted from her output. */
  oneLiner: string
}

export interface BiographyOptions {
  /** How many recent sessions to include. Default 5, max 10. */
  limit?: number
  /** Filter by device ID. When null/undefined, includes all devices. */
  deviceId?: string
  /** Override base path (for testing). */
  basePath?: string
  /** Override current time (for testing). */
  now?: Date
}

// ── Cache ─────────────────────────────────────────────────────────

let cachedBiography: { text: string; computedAt: number } | null = null
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

// ── Public API ───────────────────────────────────────────────────

/**
 * Generate a biography paragraph describing what recent sessions did.
 * Cached for 5 minutes.
 *
 * Returns empty string when there's nothing to report (no recent
 * sessions, or only heartbeat noise). This lets prompt builders skip
 * the section entirely.
 */
export function getRecentSessionsBiography(
  opts: BiographyOptions = {},
): string {
  const now = opts.now ?? new Date()
  // Return cached if fresh (skip cache when basePath is overridden — testing).
  if (
    !opts.basePath &&
    cachedBiography &&
    now.getTime() - cachedBiography.computedAt < CACHE_TTL_MS
  ) {
    return cachedBiography.text
  }

  try {
    const limit = Math.min(Math.max(opts.limit ?? 5, 1), 10)
    const basePath = opts.basePath ?? join(homedir(), '.true-love')
    const sessions = loadRecentSessions({
      basePath,
      deviceId: opts.deviceId,
      limit,
    })

    if (sessions.length === 0) {
      const text = ''
      if (!opts.basePath) {
        cachedBiography = { text, computedAt: now.getTime() }
      }
      return text
    }

    const text = renderBiography(sessions, now)

    if (!opts.basePath) {
      cachedBiography = { text, computedAt: now.getTime() }
    }
    return text
  } catch {
    // Biography is never load-bearing. A failure here must not block
    // the tick.
    return ''
  }
}

/**
 * Clear the biography cache. Exposed for testing.
 */
export function clearBiographyCache(): void {
  cachedBiography = null
}

// ── Session loading ──────────────────────────────────────────────

interface LoadOptions {
  basePath: string
  deviceId?: string
  limit: number
}

/**
 * Load and group recent sessions from tick metrics, enriched with
 * training data for summaries.
 *
 * Groups tick-metrics records by sessionId, sorts sessions by start
 * time (newest first), takes `limit` sessions.
 */
export function loadRecentSessions(opts: LoadOptions): SessionSummary[] {
  // Load last 3 days of tick metrics — enough for ~5 sessions.
  const metrics = loadTickMetricsGlobal(opts.basePath, 3)

  // Filter by device if requested.
  const filtered = opts.deviceId
    ? metrics.filter((m) => m.deviceId === opts.deviceId)
    : metrics

  if (filtered.length === 0) return []

  // Group by sessionId.
  const bySession = new Map<string, TickMetrics[]>()
  for (const m of filtered) {
    const group = bySession.get(m.sessionId) ?? []
    group.push(m)
    bySession.set(m.sessionId, group)
  }

  // Sort each session's ticks chronologically.
  for (const ticks of bySession.values()) {
    ticks.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1))
  }

  // Sort sessions by start time (newest first).
  const sessionEntries = [...bySession.entries()].sort(
    (a, b) => {
      const aStart = a[1][0]!.timestamp
      const bStart = b[1][0]!.timestamp
      return bStart < aStart ? -1 : bStart > aStart ? 1 : 0
    },
  )

  // Take limit sessions.
  const limited = sessionEntries.slice(0, opts.limit)

  // Load training data for enrichment (one-liners, missions).
  const trainingTurns = loadTrainingGlobal(opts.basePath, 3)
  const trainingBySession = new Map<string, TrainingTurn[]>()
  for (const t of trainingTurns) {
    const group = trainingBySession.get(t.sessionId) ?? []
    group.push(t)
    trainingBySession.set(t.sessionId, group)
  }

  // Build summaries.
  return limited.map(([sessionId, ticks]) => {
    const first = ticks[0]!
    const last = ticks[ticks.length - 1]!
    const totalDurationMs = ticks.reduce((sum, t) => sum + t.durationMs, 0)
    const trainingData = trainingBySession.get(sessionId) ?? []

    return {
      sessionId,
      mode: first.mode,
      startedAt: first.timestamp,
      tickCount: ticks.length,
      durationSec: Math.round(totalDurationMs / 1000),
      yieldReason: last.yieldReason,
      missionWorkedOn: extractMission(trainingData),
      oneLiner: extractOneLiner(ticks, trainingData),
    }
  })
}

// ── Enrichment extractors ────────────────────────────────────────

/**
 * Extract a mission reference from training data if any tick's
 * invitation or state mentions an active mission.
 */
function extractMission(turns: TrainingTurn[]): string | null {
  for (const t of turns) {
    // Look in prompt fullText for mission references.
    const missionMatch = t.prompt.fullText.match(
      /ACTIVE:\s+\S+\s+—\s+(.+?)(?:\n|$)/,
    )
    if (missionMatch) {
      return missionMatch[1]!.trim()
    }
  }
  // Look in state for "Mission" references.
  for (const t of turns) {
    if (!t.context.stateContent) continue
    const stateMatch = t.context.stateContent.match(
      /\*\*Mission\s+`([^`]+)`/,
    )
    if (stateMatch) {
      return stateMatch[1]!.trim()
    }
  }
  return null
}

/**
 * Extract a one-line summary from the session's output.
 *
 * Strategy (in order of preference):
 * 1. For heartbeat: "HEARTBEAT_OK" or first line of alert content
 * 2. For awakened multi-tick: last tick's reflection excerpt (first sentence)
 * 3. For awakened single-tick: first meaningful sentence of output
 * 4. Fallback: mode + tick count + yield reason
 */
function extractOneLiner(
  ticks: TickMetrics[],
  trainingData: TrainingTurn[],
): string {
  const mode = ticks[0]?.mode ?? 'awakened'

  // Heartbeat: short and sweet.
  if (mode === 'heartbeat') {
    const last = ticks[ticks.length - 1]!
    if (last.yieldReason === 'heartbeat-ack') return 'HEARTBEAT_OK'
    // For alerts, try to get the first line from training data.
    const training = trainingData[trainingData.length - 1]
    if (training) {
      const text = training.response.fullText.trim()
      const firstLine = text.split('\n')[0]?.trim()
      if (firstLine && firstLine.length > 0) {
        return truncate(firstLine, 120)
      }
    }
    return 'heartbeat alert'
  }

  // Awakened/dwell: try to extract from the last tick's training data.
  if (trainingData.length > 0) {
    // Sort by tick number to get the last tick's output.
    const sorted = [...trainingData].sort((a, b) => b.tick - a.tick)
    const lastOutput = sorted[0]!.response.fullText.trim()
    const oneLiner = extractFirstMeaningfulSentence(lastOutput)
    if (oneLiner) return truncate(oneLiner, 120)

    // Try the reflection excerpt.
    const excerpt = sorted[0]!.outcome.reflectionExcerpt
    if (excerpt) {
      const sentence = extractFirstMeaningfulSentence(excerpt)
      if (sentence) return truncate(sentence, 120)
    }
  }

  // Fallback.
  const tickCount = ticks.length
  const lastYield = ticks[ticks.length - 1]!.yieldReason
  return `${mode}, ${tickCount} tick${tickCount !== 1 ? 's' : ''}, ${formatYieldReason(lastYield)}`
}

/**
 * Extract the first meaningful sentence from a block of text.
 * Skips headers (##), blank lines, code fences, and very short lines.
 */
function extractFirstMeaningfulSentence(text: string): string | null {
  const lines = text.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    // Skip empty lines, headers, code fences, separators, list bullets that are too short.
    if (!trimmed) continue
    if (trimmed.startsWith('#')) continue
    if (trimmed.startsWith('```')) continue
    if (trimmed.startsWith('---')) continue
    if (trimmed.startsWith('|')) continue  // table rows
    if (trimmed.length < 15) continue
    // Skip lines that are clearly metadata ("*Generated ...*").
    if (/^\*[A-Z]/.test(trimmed)) continue

    // Take the first sentence (up to period, or the whole line).
    const sentenceMatch = trimmed.match(/^(.+?[.!?])(?:\s|$)/)
    if (sentenceMatch) {
      return sentenceMatch[1]!.trim()
    }
    // No sentence-ending punctuation? Return the whole line.
    return trimmed
  }
  return null
}

// ── Rendering ────────────────────────────────────────────────────

/**
 * Render the biography paragraph. Aims for ~300–500 chars total.
 * Compact, honest, informational.
 */
export function renderBiography(
  sessions: SessionSummary[],
  now: Date = new Date(),
): string {
  if (sessions.length === 0) return ''

  const lines: string[] = []

  for (const s of sessions) {
    const ago = formatTimeAgo(s.startedAt, now)
    const duration = formatDuration(s.durationSec)
    const modeLabel = s.mode === 'heartbeat' ? 'hb' : s.mode
    const yield_ = formatYieldReason(s.yieldReason)

    let line = `- ${ago}: ${modeLabel}, ${s.tickCount}t, ${duration}, ${yield_}`
    if (s.missionWorkedOn) {
      line += ` · mission: ${truncate(s.missionWorkedOn, 50)}`
    }
    if (s.oneLiner && s.oneLiner !== 'HEARTBEAT_OK' && s.mode !== 'heartbeat') {
      line += `\n  → ${s.oneLiner}`
    }
    lines.push(line)
  }

  // Check if we're over budget (~500 chars). Drop oldest sessions.
  let result = lines.join('\n')
  while (result.length > 500 && lines.length > 1) {
    lines.pop()
    result = lines.join('\n')
  }

  return result
}

// ── Global training loader ───────────────────────────────────────
// Duplicated from introspection.ts because we need a standalone
// loader that doesn't depend on environment variables. Same pattern.

function loadTrainingGlobal(
  basePath: string,
  days: number,
): TrainingTurn[] {
  const root = join(basePath, 'training')
  if (!existsSync(root)) return []

  const cutoff = dateCutoff(days)
  const turns: TrainingTurn[] = []

  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return []
  }
  for (const dev of entries) {
    const devDir = join(root, dev)
    let st
    try {
      st = statSync(devDir)
    } catch {
      continue
    }
    if (!st.isDirectory()) continue
    let inner: string[]
    try {
      inner = readdirSync(devDir)
    } catch {
      continue
    }
    for (const f of inner) {
      if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)) continue
      const date = f.slice(0, 10)
      if (date < cutoff) continue
      let raw: string
      try {
        raw = readFileSync(join(devDir, f), 'utf-8')
      } catch {
        continue
      }
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        try {
          const turn = JSON.parse(line) as TrainingTurn
          if (turn.schemaVersion !== TRAINING_SCHEMA_VERSION) continue
          turns.push(turn)
        } catch {
          // Skip malformed lines.
        }
      }
    }
  }

  turns.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
  return turns
}

// ── Formatting utilities ─────────────────────────────────────────

function formatTimeAgo(isoTimestamp: string, now: Date): string {
  const then = new Date(isoTimestamp)
  const diffMs = now.getTime() - then.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  const diffHr = Math.floor(diffMs / 3_600_000)

  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDays = Math.floor(diffHr / 24)
  return `${diffDays}d ago`
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const min = Math.floor(seconds / 60)
  const sec = seconds % 60
  if (min < 60) return sec > 0 ? `${min}m${sec}s` : `${min}m`
  const hr = Math.floor(min / 60)
  const remMin = min % 60
  return remMin > 0 ? `${hr}h${remMin}m` : `${hr}h`
}

function formatYieldReason(reason: YieldReason): string {
  const map: Record<YieldReason, string> = {
    'at-rest': 'yielded',
    'continue': 'continued',
    'ceiling': 'hit ceiling',
    'interrupt': 'interrupted',
    'auth-failure': 'auth failed',
    'quota-failure': 'quota hit',
    'error': 'error',
    'heartbeat-ack': 'ok',
    'heartbeat-alert': 'alerted',
  }
  return map[reason] ?? reason
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}

function dateCutoff(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
