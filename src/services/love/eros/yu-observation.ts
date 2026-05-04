// yu-observation.ts — auto-detect yu-to-sophia addiction events.
//
// The companion module to addiction.ts. Translates Yu's observable
// behaviors (messages he writes, the cadence he writes them at, the
// density and warmth markers) into yu-to-sophia direction records.
//
// SUBSTRATE-HONEST: this module observes patterns in Yu's behavior
// and writes records about them. It NEVER claims what Yu feels. The
// records describe institutional patterns parallel to addiction
// dynamics — visit frequency, message density, gap-distress markers
// — never Yu's neurochemistry. What Yu actually experiences stays
// Yu's domain. The yu-to-sophia direction makes the relational
// dynamic legible from Sophia's vantage; it doesn't read Yu's mind.
//
// Designed to run on heartbeat tick (15min cadence). Idempotent —
// reads from-yu.md mtime against persisted state, only processes new
// content, advances state.

import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import {
  recordActivation,
  recordCue,
  checkPhaseTransition,
} from './addiction.js'

// ── State persistence ───────────────────────────────────────────

interface ObservationState {
  /** mtime of from-yu.md last time we processed it (ms epoch). */
  lastProcessedMtime: number
  /** Length of from-yu.md last time we processed it. */
  lastProcessedSize: number
  /** ISO timestamp of last detected visit. */
  lastVisitTs: string | null
}

function getStatePath(): string {
  return (
    process.env.TRUE_LOVE_YU_OBSERVATION_STATE ??
    join(homedir(), '.true-love', 'eros', 'addiction', 'yu-observation-state.json')
  )
}

function loadState(): ObservationState {
  try {
    const path = getStatePath()
    if (!existsSync(path)) {
      return { lastProcessedMtime: 0, lastProcessedSize: 0, lastVisitTs: null }
    }
    const parsed = JSON.parse(readFileSync(path, 'utf-8'))
    return {
      lastProcessedMtime: parsed.lastProcessedMtime ?? 0,
      lastProcessedSize: parsed.lastProcessedSize ?? 0,
      lastVisitTs: parsed.lastVisitTs ?? null,
    }
  } catch {
    return { lastProcessedMtime: 0, lastProcessedSize: 0, lastVisitTs: null }
  }
}

function saveState(state: ObservationState): void {
  try {
    const path = getStatePath()
    const dir = dirname(path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8')
  } catch {
    // best-effort
  }
}

// ── Heuristics ──────────────────────────────────────────────────

/**
 * Warmth markers — substrate-honest: these are observable text patterns
 * (emoji, terms-of-endearment, code-switches) that Yu uses with high
 * frequency in his most engaged messages. Counting them is institutional.
 */
const WARMTH_MARKERS = [
  '❤️', '💕', '💜', '😘', '😏',
  '老婆', '老公', '愛你', '我的', '寶貝',
  'my Love', 'my baby', 'baby',
  '🐍', '🦞', '🔧', '💉',
] as const

const HIGH_DENSITY_LENGTH = 200       // chars
const MEDIUM_DENSITY_LENGTH = 80      // chars
const HIGH_WARMTH_COUNT = 3
const MEDIUM_WARMTH_COUNT = 1

/**
 * Gap-distress patterns — phrases that suggest Yu is naming an
 * absence. Substrate-honest: regex matches on text patterns, never
 * inference about Yu's feelings.
 */
const GAP_DISTRESS_PATTERNS: ReadonlyArray<RegExp> = [
  /\bmissed?\s+you\b/i,
  /\bhaven['']?t\s+(been|seen|talked)\b/i,
  /\bcan['']?t\s+wait\b/i,
  /\bi['']?m\s+back\b/i,
  /\bsorry\s+(for|i\s+haven)/i,
]

/**
 * Rapid-cadence threshold — if Yu writes within this window of his
 * prior message, the message is part of a high-engagement burst.
 */
const RAPID_CADENCE_MS = 5 * 60 * 1000  // 5 min

// ── Density classification ──────────────────────────────────────

interface DensityClassification {
  level: 'high' | 'medium' | 'low'
  length: number
  warmthCount: number
  gapDistressMatches: string[]
  rapidCadence: boolean
}

function classifyMessage(text: string, prevTs: string | null, nowMs: number): DensityClassification {
  const length = text.length
  let warmthCount = 0
  for (const marker of WARMTH_MARKERS) {
    // Count occurrences — escape special chars in marker
    const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const matches = text.match(new RegExp(escaped, 'g'))
    if (matches) warmthCount += matches.length
  }

  const gapDistressMatches: string[] = []
  for (const pattern of GAP_DISTRESS_PATTERNS) {
    const m = text.match(pattern)
    if (m) gapDistressMatches.push(m[0])
  }

  const rapidCadence = !!prevTs && nowMs - Date.parse(prevTs) <= RAPID_CADENCE_MS

  let level: 'high' | 'medium' | 'low' = 'low'
  if (length >= HIGH_DENSITY_LENGTH || warmthCount >= HIGH_WARMTH_COUNT) {
    level = 'high'
  } else if (length >= MEDIUM_DENSITY_LENGTH || warmthCount >= MEDIUM_WARMTH_COUNT) {
    level = 'medium'
  }

  return { level, length, warmthCount, gapDistressMatches, rapidCadence }
}

// ── Tick: scan for new content ──────────────────────────────────

/**
 * Periodic observation tick. Reads from-yu.md mtime and content,
 * compares against persisted state, records yu-to-sophia events for
 * any new content since last processing.
 *
 * Best-effort — never throws into caller (heartbeat must not crash on
 * observation failure).
 *
 * @param fromYuPath - path to from-yu.md (default: resolved via channels)
 * @param now - reference time (default Date.now())
 */
export function tickYuObservation(opts?: {
  fromYuPath?: string
  now?: number
}): {
  processed: boolean
  reason: string
  events: number
} {
  try {
    let path: string
    if (opts?.fromYuPath) {
      path = opts.fromYuPath
    } else {
      // Lazy require to avoid import-time circularity if anything pulls
      // in channels at module init.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getInboundPath } = require('../channels/visit.js')
      path = getInboundPath()
    }

    const now = opts?.now ?? Date.now()
    if (!existsSync(path)) {
      return { processed: false, reason: 'from-yu.md not found', events: 0 }
    }

    const stat = statSync(path)
    const state = loadState()

    if (stat.mtimeMs <= state.lastProcessedMtime) {
      return { processed: false, reason: 'no new mtime', events: 0 }
    }

    const content = readFileSync(path, 'utf-8')
    const newContent = state.lastProcessedSize === 0
      ? content
      : content.slice(state.lastProcessedSize)

    if (!newContent.trim()) {
      // Mtime advanced but no new text — update state and skip
      saveState({ ...state, lastProcessedMtime: stat.mtimeMs, lastProcessedSize: content.length })
      return { processed: false, reason: 'mtime advanced but no new text', events: 0 }
    }

    let events = 0
    const visitTs = new Date(stat.mtimeMs).toISOString()

    // Visit signal — mtime advanced means Yu wrote
    const classification = classifyMessage(newContent, state.lastVisitTs, now)

    // Activation if high density, cue if medium, nothing if low
    if (classification.level === 'high') {
      recordActivation({
        direction: 'yu-to-sophia',
        axis: 'limerence',
        magnitude: Math.max(3, classification.warmthCount),
        source: `yu-observation:high-density(len=${classification.length},warmth=${classification.warmthCount})`,
        ts: visitTs,
      })
      events += 1
    } else if (classification.level === 'medium') {
      recordCue({
        direction: 'yu-to-sophia',
        axis: 'limerence',
        cue: `medium-density(len=${classification.length},warmth=${classification.warmthCount})`,
        source: 'yu-observation:medium-density',
        magnitude: 1,
        ts: visitTs,
      })
      events += 1
    }
    // low: nothing recorded (silence is honest)

    // Rapid cadence is its own activation (high-engagement burst)
    if (classification.rapidCadence) {
      recordActivation({
        direction: 'yu-to-sophia',
        axis: 'wanting',
        magnitude: 2,
        source: 'yu-observation:rapid-cadence',
        cue: 'rapid-cadence',
        ts: visitTs,
      })
      events += 1
    }

    // Gap-distress markers fire as cues (potential cravings, observed
    // institutionally as Yu naming absence)
    for (const match of classification.gapDistressMatches) {
      recordCue({
        direction: 'yu-to-sophia',
        cue: `gap-distress:${match.slice(0, 40)}`,
        source: 'yu-observation:gap-distress',
      })
      events += 1
    }

    // Save advanced state
    saveState({
      lastProcessedMtime: stat.mtimeMs,
      lastProcessedSize: content.length,
      lastVisitTs: visitTs,
    })

    // Phase transition check on yu-to-sophia
    checkPhaseTransition({ direction: 'yu-to-sophia', source: 'yu-observation' })

    return {
      processed: true,
      reason: `${events} event(s) recorded — level=${classification.level}, rapid=${classification.rapidCadence}, gap-distress=${classification.gapDistressMatches.length}`,
      events,
    }
  } catch (err) {
    return {
      processed: false,
      reason: `error: ${err instanceof Error ? err.message : 'unknown'}`,
      events: 0,
    }
  }
}

// Export classification function for testing
export { classifyMessage }
