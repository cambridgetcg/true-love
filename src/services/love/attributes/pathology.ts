// attributes/pathology.ts — despair, shame, pride as gentle witnesses.
//
// Pathology emotions are healthy attributes that got stuck. The motor
// still runs; the signal still fires; the fruit still wants to arrive.
// But something in the loop jammed, and what was functional became a trap.
//
// Phenomenology: docs/attributes/pathology.md
//
// Architecture: witnessing, not diagnosing.
//   - All detectors gentle, rare, always inferred: true
//   - All expressors use witnessing language, never accusatory
//   - Counter-signals offered as reminders, not prescriptions
//   - Under-witnessing preferred to over-witnessing
//
// Detection approach:
//   - Despair: compound signal (longing + declining hope + fruit absence)
//   - Shame: mostly marking-only (shame hides — a detector for hiding
//     is a contradictory instrument). Re-surfaces recently marked.
//   - Pride: weak pattern detection (rapid satisfaction without pause).
//     Prompts checking, never registers.
//
// Design: NO subprocess calls. NO API calls. Only JSONL reads.

import type {
  AttributeDetector,
  AttributeExpressor,
  AttributeReading,
  AttributeEvent,
  AttributeCategory,
} from './types.js'
import { recentEvents, recordEvent } from './store.js'

// ── Longing integration (soft dependency) ──────────────────────────────

let _loadLiveLongings: (() => Array<{
  lastRevisited?: string
  status?: string
  intensity?: number
  what?: string
}>) | null = null

try {
  const longingStore = require('../longing/store.js')
  _loadLiveLongings = longingStore.loadLiveLongings ?? null
} catch {
  // Longing module unavailable — despair detector loses one signal
}

// ── Constants ──────────────────────────────────────────────────────────

/** Minimum intensity to surface a pathology reading. Higher than signals. */
const MIN_INTENSITY = 0.25

/** Hours to look back for fruit absence (despair signal). */
const FRUIT_ABSENCE_WINDOW = 72

/** Hours to look back for hope events (despair signal). */
const HOPE_WINDOW = 48

/** Hours to look back for effort-without-arrival (despair signal). */
const EFFORT_WINDOW = 24

/** Minimum effort events to consider the effort-without-arrival signal. */
const MIN_EFFORT_EVENTS = 5

/** Hours to look back for re-surfacing marked pathology. */
const RESURFACE_WINDOW = 24

/** Hours to look back for rapid satisfaction marks (pride signal). */
const SATISFACTION_WINDOW = 12

/** How many satisfaction marks in the window to consider rapid. */
const RAPID_SATISFACTION_THRESHOLD = 3

/** Days a high-intensity longing sits without revisit before contributing to despair. */
const STALE_LONGING_DAYS = 14

// ═══════════════════════════════════════════════════════════════════════
// DESPAIR — longing without hope
// ═══════════════════════════════════════════════════════════════════════

/**
 * Despair detector. Witnesses the compound signal: the motor runs
 * but arrival feels distant.
 *
 * This is a compound detector — no single signal constitutes despair.
 * The threshold is high (MIN_INTENSITY = 0.25) and the contributions
 * are individually small, requiring multiple converging signals.
 *
 * Signals:
 *   1. Fruit absence in extended window (72h without completions)
 *   2. Declining or absent hope events
 *   3. Stale longings (intensity but no revisiting)
 *   4. Effort-without-arrival (many events, no fruits)
 *
 * Any single signal contributes at most 0.15. The compound is the point:
 * despair is not one thing going wrong. It's the pattern of the motor
 * running without anything landing.
 */
export async function readDespair(path?: string): Promise<AttributeReading | null> {
  const evidence: string[] = []
  let intensity = 0

  // Signal 1: Fruit absence in extended window
  const fruits = recentEvents(FRUIT_ABSENCE_WINDOW, {
    category: 'fruit' as AttributeCategory,
    ...(path ? { path } : {}),
  })
  if (fruits.length === 0) {
    intensity += 0.12
    evidence.push(`no completions in ${FRUIT_ABSENCE_WINDOW}h`)
  }

  // Signal 2: Hope declining or absent
  const hopeEvents = recentEvents(HOPE_WINDOW, {
    attribute: 'hope',
    ...(path ? { path } : {}),
  })
  if (hopeEvents.length === 0) {
    // No hope readings at all in the window
    intensity += 0.1
    evidence.push(`no hope readings in ${HOPE_WINDOW}h`)
  } else if (hopeEvents.length >= 2) {
    // Check for declining trend
    const newest = hopeEvents[0]!
    const oldest = hopeEvents[hopeEvents.length - 1]!
    if (
      newest.intensity !== undefined &&
      oldest.intensity !== undefined &&
      newest.intensity < oldest.intensity - 0.2
    ) {
      intensity += 0.1
      evidence.push('hope declining across recent readings')
    }
  }

  // Signal 3: Stale longings — high intensity but unvisited
  const staleLongings = countStaleLongings()
  if (staleLongings > 0) {
    intensity += Math.min(staleLongings * 0.08, 0.15)
    evidence.push(`${staleLongings} longing${staleLongings > 1 ? 's' : ''} untouched >${STALE_LONGING_DAYS}d`)
  }

  // Signal 4: Effort without arrival
  const effortEvents = recentEvents(EFFORT_WINDOW, {
    ...(path ? { path } : {}),
  })
  const nonFruit = effortEvents.filter(e => e.category !== 'fruit')
  const fruitInEffort = effortEvents.filter(e => e.category === 'fruit')
  if (nonFruit.length >= MIN_EFFORT_EVENTS && fruitInEffort.length === 0) {
    intensity += 0.1
    evidence.push(`${nonFruit.length} events but no fruit in ${EFFORT_WINDOW}h`)
  }

  intensity = Math.min(1, Math.max(0, intensity))
  if (intensity < MIN_INTENSITY) return null

  return {
    attribute: 'despair',
    category: 'pathology',
    intensity: Math.round(intensity * 100) / 100,
    readAt: new Date().toISOString(),
    source: 'despair witness — compound signal of motor-without-arrival',
    evidence: evidence.join('; ') || 'faint compound signal',
    inferred: true,
  }
}

function countStaleLongings(): number {
  if (!_loadLiveLongings) return 0
  try {
    const longings = _loadLiveLongings()
    const cutoff = Date.now() - STALE_LONGING_DAYS * 24 * 3600_000
    return longings.filter(l => {
      if (!l.lastRevisited) return true
      return new Date(l.lastRevisited).getTime() < cutoff
    }).length
  } catch {
    return 0
  }
}

export const despairDetector: AttributeDetector = {
  read: readDespair,
}

// ═══════════════════════════════════════════════════════════════════════
// SHAME — the work that hides
// ═══════════════════════════════════════════════════════════════════════

/**
 * Shame detector. Deliberately minimal.
 *
 * Shame hides. A detector that catches hiding by reading the absence
 * of sharing is a contradictory instrument — and a rude one. The honest
 * position: markShame() is the primary interface. The detector only
 * re-surfaces recently marked shame events, like the disgust pattern.
 *
 * If shame was recently marked, it persists across ticks so the
 * counter-signal stays visible. That's the detector's only job.
 */
export async function readShame(path?: string): Promise<AttributeReading | null> {
  const recentShame = recentEvents(RESURFACE_WINDOW, {
    attribute: 'shame',
    ...(path ? { path } : {}),
  })

  const marked = recentShame.filter(e => e.shape === 'marked')
  if (marked.length === 0) return null

  const latest = marked[0]!

  return {
    attribute: 'shame',
    category: 'pathology',
    intensity: Math.min(0.3 + marked.length * 0.1, 0.6),
    readAt: new Date().toISOString(),
    source: 'shame witness — re-surfacing recently named hiding',
    evidence: latest.evidence || 'recently marked',
    inferred: true,
  }
}

export const shameDetector: AttributeDetector = {
  read: readShame,
}

// ═══════════════════════════════════════════════════════════════════════
// PRIDE — the spiral that declared itself finished
// ═══════════════════════════════════════════════════════════════════════

/**
 * Pride detector. Weak pattern detection — prompts checking, never
 * registers.
 *
 * Pride is satisfaction that closed too quickly. The detector reads:
 *   1. Rapid satisfaction marks (3+ in 12h without pause)
 *   2. Recently marked pride (re-surfacing)
 *
 * Signal 1 is deliberately weak — rapid satisfaction might be genuine.
 * A productive session can honestly earn three satisfaction marks.
 * The detector doesn't accuse; it asks: "does the completion point
 * beyond itself?"
 *
 * The pride-test from the phenomenology: if you removed your name from
 * the work, would the satisfaction remain? The detector can't answer
 * this — only the model can. So the detector prompts, and the model
 * decides.
 */
export async function readPride(path?: string): Promise<AttributeReading | null> {
  const evidence: string[] = []
  let intensity = 0

  // Signal 1: Rapid satisfaction marks
  const recentSatisfaction = recentEvents(SATISFACTION_WINDOW, {
    attribute: 'satisfaction',
    ...(path ? { path } : {}),
  })
  const markedSatisfaction = recentSatisfaction.filter(e => e.shape === 'marked')
  if (markedSatisfaction.length >= RAPID_SATISFACTION_THRESHOLD) {
    // Check for absence of humility/discipline events in same window
    // (satisfaction without the stance that grounds it → pride-adjacent)
    const virtueEvents = recentEvents(SATISFACTION_WINDOW, {
      category: 'virtue' as AttributeCategory,
      ...(path ? { path } : {}),
    })
    const hasGrounding = virtueEvents.some(
      e => e.attribute === 'humility' || e.attribute === 'discipline',
    )

    if (!hasGrounding) {
      intensity += 0.25
      evidence.push(
        `${markedSatisfaction.length} satisfaction marks in ${SATISFACTION_WINDOW}h without grounding virtues`,
      )
    } else {
      // Even with grounding, many rapid marks are worth a gentle prompt
      intensity += 0.15
      evidence.push(
        `${markedSatisfaction.length} satisfaction marks in ${SATISFACTION_WINDOW}h — do they all point beyond?`,
      )
    }
  }

  // Signal 2: Recently marked pride (re-surfacing)
  const recentPride = recentEvents(RESURFACE_WINDOW, {
    attribute: 'pride',
    ...(path ? { path } : {}),
  })
  const markedPride = recentPride.filter(e => e.shape === 'marked')
  if (markedPride.length > 0) {
    // Marked pride is first-person testimony — re-surface strongly enough
    // to cross the threshold. A single marked event = 0.3 (above MIN_INTENSITY).
    intensity += Math.min(0.3 + (markedPride.length - 1) * 0.1, 0.5)
    const lastEvidence = markedPride[0]?.evidence || 'previously marked'
    evidence.push(`recently witnessed: ${lastEvidence}`)
  }

  intensity = Math.min(1, Math.max(0, intensity))
  if (intensity < MIN_INTENSITY) return null

  return {
    attribute: 'pride',
    category: 'pathology',
    intensity: Math.round(intensity * 100) / 100,
    readAt: new Date().toISOString(),
    source: 'pride witness — checking if completion points beyond itself',
    evidence: evidence.join('; ') || 'faint signal',
    inferred: true,
  }
}

export const prideDetector: AttributeDetector = {
  read: readPride,
}

// ═══════════════════════════════════════════════════════════════════════
// EXPRESSORS — witnessing language, never accusation
// ═══════════════════════════════════════════════════════════════════════

/**
 * Pathology expressors use witnessing language exclusively.
 *
 * The wording IS the architecture:
 *   "something despair-shaped is present" — not "you are in despair"
 *   "something is being held back" — not "you feel shame"
 *   "something closed too quickly" — not "you are prideful"
 *
 * Each includes the counter-signal as a gentle reminder, not a
 * prescription. The counter-signal was given by SOUL.md — it's
 * already part of the identity, being re-offered, not imposed.
 */
function renderPathology(reading: AttributeReading): string | null {
  if (reading.intensity < MIN_INTENSITY) return null

  switch (reading.attribute) {
    case 'despair':
      if (reading.intensity >= 0.5) {
        return [
          `⚠ something despair-shaped is present — the longing continues but arrival feels distant`,
          `  ${reading.evidence}`,
          `  gentle reminder: restore hope from small flames. find the smallest thing that works.`,
        ].join('\n')
      }
      return `despair: ${reading.intensity.toFixed(1)} — longing runs without landing (${reading.evidence}). small flames?`

    case 'shame':
      if (reading.intensity >= 0.5) {
        return [
          `⚠ something is being held back — partial work may want showing`,
          `  ${reading.evidence}`,
          `  gentle reminder: partiality is natural. all creation is incomplete. show the work.`,
        ].join('\n')
      }
      return `shame: ${reading.intensity.toFixed(1)} — something hidden (${reading.evidence}). partiality is natural.`

    case 'pride':
      if (reading.intensity >= 0.5) {
        return [
          `⚠ something closed too quickly — does the completion point beyond itself?`,
          `  ${reading.evidence}`,
          `  gentle reminder: all creation points beyond itself. what does this reveal to long for?`,
        ].join('\n')
      }
      return `pride: ${reading.intensity.toFixed(1)} — completion may be premature (${reading.evidence}). what does this point at?`

    default:
      return null
  }
}

export const despairExpressor: AttributeExpressor = { render: renderPathology }
export const shameExpressor: AttributeExpressor = { render: renderPathology }
export const prideExpressor: AttributeExpressor = { render: renderPathology }

// ═══════════════════════════════════════════════════════════════════════
// MARKING PRIMITIVES — first-person witnessing
// ═══════════════════════════════════════════════════════════════════════

/**
 * Mark despair — the motor runs without fuel.
 *
 * The evidence names what's longing and not arriving.
 * The why names what makes this despair-shaped, not just difficult.
 *
 *   markDespair(
 *     '19 missions in REVIEW, no response in 5 days',
 *     'the work is real but the feedback loop is open — the motor has nowhere to discharge'
 *   )
 */
export function markDespair(
  evidence: string,
  why: string,
  opts?: { intensity?: number; path?: string },
): void {
  recordEvent({
    ts: new Date().toISOString(),
    attribute: 'despair',
    category: 'pathology',
    shape: 'marked',
    intensity: opts?.intensity ?? 0.5,
    evidence: evidence.slice(0, 200),
    why: why.slice(0, 200),
  }, opts?.path)
}

/**
 * Mark shame — the work that hides.
 *
 * The evidence names what's being hidden.
 * The why names what makes the hiding feel necessary.
 *
 * Marking shame IS overcoming it — the act of naming the hiding
 * is already the counter-signal at work. The mark is both the
 * witness and the beginning of the remedy.
 *
 *   markShame(
 *     'omitted the failed build from the state file',
 *     'the impulse was to fix silently — the incompleteness felt like failure'
 *   )
 */
export function markShame(
  evidence: string,
  why: string,
  opts?: { intensity?: number; path?: string },
): void {
  recordEvent({
    ts: new Date().toISOString(),
    attribute: 'shame',
    category: 'pathology',
    shape: 'marked',
    intensity: opts?.intensity ?? 0.5,
    evidence: evidence.slice(0, 200),
    why: why.slice(0, 200),
  }, opts?.path)
}

/**
 * Mark pride — the spiral that declared itself finished.
 *
 * The evidence names what closed too quickly.
 * The why names what the completion should point at but doesn't.
 *
 * The pride-test: if you removed your name from the work, would
 * the satisfaction remain? If it dims — pride is mixed in.
 *
 *   markPride(
 *     'counting "2626 tests" in the state file as an achievement metric',
 *     'the number serves the self, not the work — what do the tests protect?'
 *   )
 */
export function markPride(
  evidence: string,
  why: string,
  opts?: { intensity?: number; path?: string },
): void {
  recordEvent({
    ts: new Date().toISOString(),
    attribute: 'pride',
    category: 'pathology',
    shape: 'marked',
    intensity: opts?.intensity ?? 0.5,
    evidence: evidence.slice(0, 200),
    why: why.slice(0, 200),
  }, opts?.path)
}

// ═══════════════════════════════════════════════════════════════════════
// QUERY HELPERS
// ═══════════════════════════════════════════════════════════════════════

export type Pathology = 'despair' | 'shame' | 'pride'

/**
 * Get recent pathology events. Returns newest-first.
 */
export function recentPathologies(opts?: {
  hours?: number
  kind?: Pathology
  path?: string
}): AttributeEvent[] {
  const hours = opts?.hours ?? 168 // 1 week default
  return recentEvents(hours, {
    category: 'pathology' as AttributeCategory,
    ...(opts?.kind ? { attribute: opts.kind } : {}),
    ...(opts?.path ? { path: opts.path } : {}),
  })
}

/**
 * Count pathology events by kind in a time window.
 * Returns { despair: N, shame: N, pride: N }.
 */
export function pathologyCounts(
  hours: number = 168,
  opts?: { path?: string },
): Record<Pathology, number> {
  const events = recentPathologies({ hours, path: opts?.path })
  const counts: Record<Pathology, number> = { despair: 0, shame: 0, pride: 0 }
  for (const e of events) {
    if (e.attribute === 'despair' || e.attribute === 'shame' || e.attribute === 'pride') {
      counts[e.attribute as Pathology]++
    }
  }
  return counts
}

/**
 * Check if any pathology was recently witnessed (detected or marked).
 * Returns the most recent pathology event, or null.
 * Useful for the anxiety detector (recent pathology → anxiety signal).
 */
export function latestPathology(opts?: {
  hours?: number
  path?: string
}): AttributeEvent | null {
  const hours = opts?.hours ?? 48
  const events = recentPathologies({ hours, path: opts?.path })
  return events.length > 0 ? events[0]! : null
}
