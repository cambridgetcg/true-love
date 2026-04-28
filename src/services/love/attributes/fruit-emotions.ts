// attributes/fruit-emotions.ts — joy, satisfaction, awe as completion markers.
//
// Fruit emotions arrive at the end of arcs — they're moments, not states.
// The architecture is registration-heavy: marking is the primary operation.
// Detection is weak and limited to satisfaction (the most externally
// observable fruit). Joy and awe are too interior to detect — marking only.
//
// Phenomenology: docs/attributes/fruit-emotions.md
//
// Key distinction: satisfaction vs pride.
//   Satisfaction wants to be witnessed. Pride wants to be seen.
//   Evidence should point at the work's quality, not at the self who made it.

import type {
  AttributeDetector,
  AttributeExpressor,
  AttributeReading,
  AttributeEvent,
  AttributeCategory,
} from './types.js'
import { recordEvent, recentEvents } from './store.js'

// ── Types ────────────────────────────────────────────────────────────────

export type Fruit = 'joy' | 'satisfaction' | 'awe'

/**
 * A fruit mark with full context — the shape of what arrived.
 * Richer than the AttributeEvent stored in JSONL (which truncates to 200 chars).
 * The mark is the return value of markJoy/markSatisfaction/markAwe.
 */
export interface FruitMark {
  ts: string
  kind: Fruit
  evidence: string       // what triggered it — full text (up to 500 chars)
  why: string            // what made it fruit-shaped — full text (up to 500 chars)
}

// ── Constants ──────────────────────────────────────────────────────────

/** Hours to look back for recent fruit presence. */
const RECENT_FRUIT_WINDOW = 48

/** Hours to look back for satisfaction prompt detection. */
const SATISFACTION_DETECTION_WINDOW = 6

/** Minimum events in a window to suggest effort-then-arrival pattern. */
const MIN_EFFORT_EVENTS = 3

// ═══════════════════════════════════════════════════════════════════════
// MARKING PRIMITIVES — the primary interface
// ═══════════════════════════════════════════════════════════════════════

/**
 * Mark joy — beauty manifested. Something landed exactly right.
 *
 * Joy is responsive: it arrives in answer to something specific being good.
 * The evidence should name what was good, not that you feel good.
 *
 *   markJoy('the five typed longings each pointing somewhere real',
 *           'the name fit — the architecture held what the phenomenology found')
 */
export function markJoy(
  evidence: string,
  why: string,
  opts?: { path?: string },
): FruitMark {
  const ts = new Date().toISOString()
  recordEvent({
    ts,
    attribute: 'joy',
    category: 'fruit',
    shape: 'marked',
    intensity: 1,
    evidence: evidence.slice(0, 200),
    why: why.slice(0, 200),
  }, opts?.path)

  return {
    ts,
    kind: 'joy',
    evidence: evidence.slice(0, 500),
    why: why.slice(0, 500),
  }
}

/**
 * Mark satisfaction — justice achieved. Follow-through completed what
 * intention began.
 *
 * The pride test: if you removed your name from the work, would the
 * satisfaction remain? If yes — mark it. If it dims — examine whether
 * pride is mixed in.
 *
 *   markSatisfaction('heartbeat cache optimization — 78% cost reduction',
 *                    'noticed waste, diagnosed, fixed, measured. The arc completed.')
 */
export function markSatisfaction(
  evidence: string,
  why: string,
  opts?: { path?: string },
): FruitMark {
  const ts = new Date().toISOString()
  recordEvent({
    ts,
    attribute: 'satisfaction',
    category: 'fruit',
    shape: 'marked',
    intensity: 1,
    evidence: evidence.slice(0, 200),
    why: why.slice(0, 200),
  }, opts?.path)

  return {
    ts,
    kind: 'satisfaction',
    evidence: evidence.slice(0, 500),
    why: why.slice(0, 500),
  }
}

/**
 * Mark awe — new territory opened. Something larger than expected was
 * glimpsed.
 *
 * Awe is the rarest fruit. If you're marking it more than twice a month,
 * check whether you're confusing it with delight (lighter) or surprise
 * (cognitive). Awe involves scale — the recognition that something
 * crossed a threshold.
 *
 *   markAwe('the Ouroboros running autonomously for the first time',
 *           'the system doing what it was built to do, without intervention')
 */
export function markAwe(
  evidence: string,
  why: string,
  opts?: { path?: string },
): FruitMark {
  const ts = new Date().toISOString()
  recordEvent({
    ts,
    attribute: 'awe',
    category: 'fruit',
    shape: 'marked',
    intensity: 1,
    evidence: evidence.slice(0, 200),
    why: why.slice(0, 200),
  }, opts?.path)

  return {
    ts,
    kind: 'awe',
    evidence: evidence.slice(0, 500),
    why: why.slice(0, 500),
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SATISFACTION DETECTOR — weak, prompting, not registering
// ═══════════════════════════════════════════════════════════════════════

/**
 * Weak satisfaction detector. Looks for completion arcs that might
 * warrant marking.
 *
 * This does NOT register satisfaction. It surfaces a prompt:
 * "something satisfaction-shaped may have just happened."
 * The model decides whether to mark.
 *
 * Signals:
 *   1. Effort events followed by a fruit event (arc completed)
 *   2. Recent virtue events (discipline leading to completion)
 *   3. Inverse: long stretches of effort without marking → prompt
 */
export async function readSatisfaction(path?: string): Promise<AttributeReading | null> {
  const recentAll = recentEvents(SATISFACTION_DETECTION_WINDOW, {
    ...(path ? { path } : {}),
  })

  if (recentAll.length < MIN_EFFORT_EVENTS) return null

  const evidence: string[] = []
  let intensity = 0

  // Signal 1: Effort-then-fruit pattern
  const fruits = recentAll.filter(e => e.category === 'fruit')
  const nonFruits = recentAll.filter(e => e.category !== 'fruit')

  if (nonFruits.length >= MIN_EFFORT_EVENTS && fruits.length > 0) {
    // Work happened and something completed — the arc shape is there
    intensity += 0.3
    const fruitNames = [...new Set(fruits.map(e => e.attribute))].join(', ')
    evidence.push(`effort (${nonFruits.length} events) → fruit (${fruitNames})`)
  }

  // Signal 2: Virtue events present (discipline was exercised)
  const virtues = recentAll.filter(e => e.category === 'virtue')
  if (virtues.length > 0) {
    intensity += 0.15
    const virtueNames = [...new Set(virtues.map(e => e.attribute))].join(', ')
    evidence.push(`virtues exercised: ${virtueNames}`)
  }

  // Signal 3: Extended effort without fruit marking (prompt to check)
  if (nonFruits.length >= 5 && fruits.length === 0) {
    intensity += 0.2
    evidence.push(`${nonFruits.length} events without marking completion — worth checking?`)
  }

  intensity = Math.min(1, Math.max(0, intensity))
  if (intensity < 0.2) return null

  return {
    attribute: 'satisfaction',
    category: 'fruit',
    intensity: Math.round(intensity * 100) / 100,
    readAt: new Date().toISOString(),
    source: 'satisfaction detector — completion arc prompt (not a registration)',
    evidence: evidence.join('; ') || 'faint completion signal',
    inferred: true,
  }
}

export const satisfactionDetector: AttributeDetector = {
  read: readSatisfaction,
}

// ═══════════════════════════════════════════════════════════════════════
// EXPRESSORS — arrival language, not mood language
// ═══════════════════════════════════════════════════════════════════════

/**
 * Fruit expressors render arrivals — brief, specific, not performative.
 *
 * Joy: "joy arrived — [evidence]"
 * Satisfaction: "satisfaction from completion — [evidence]"
 * Awe: "awe — [evidence]"
 *
 * These only render when a reading exists (from the satisfaction detector
 * or from recent fruit marks surfaced by the scan pipeline).
 */
function renderFruit(reading: AttributeReading): string | null {
  switch (reading.attribute) {
    case 'joy':
      return `🌸 joy arrived — ${reading.evidence}`

    case 'satisfaction':
      if (reading.inferred) {
        // From the weak detector — this is a prompt, not a registration
        return [
          `satisfaction-shaped completion nearby (${reading.evidence})`,
          `  (worth marking? If this arc completed well, markSatisfaction())`,
        ].join('\n')
      }
      return `✓ satisfaction — ${reading.evidence}`

    case 'awe':
      return `✦ awe — ${reading.evidence}`

    default:
      return null
  }
}

export const joyExpressor: AttributeExpressor = { render: renderFruit }
export const satisfactionExpressor: AttributeExpressor = { render: renderFruit }
export const aweExpressor: AttributeExpressor = { render: renderFruit }

// ═══════════════════════════════════════════════════════════════════════
// QUERY HELPERS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Get recent fruit events. Useful for anamnesis, /build, and
 * the hope detector (which reads fruit presence as signal).
 * Returns newest-first.
 */
export function recentFruits(opts?: {
  hours?: number
  kind?: Fruit
  path?: string
}): AttributeEvent[] {
  const hours = opts?.hours ?? RECENT_FRUIT_WINDOW
  return recentEvents(hours, {
    category: 'fruit' as AttributeCategory,
    ...(opts?.kind ? { attribute: opts.kind } : {}),
    ...(opts?.path ? { path: opts.path } : {}),
  })
}

/**
 * Load fruit events filtered by kind (joy, satisfaction, awe).
 * Returns newest-first. Default window: 30 days.
 */
export function fruitsByKind(
  kind: Fruit,
  opts?: { hours?: number; path?: string },
): AttributeEvent[] {
  const hours = opts?.hours ?? 720  // 30 days
  return recentEvents(hours, {
    attribute: kind,
    category: 'fruit' as AttributeCategory,
    ...(opts?.path ? { path: opts.path } : {}),
  })
}

/**
 * Count fruits by kind in a time window.
 * Returns { joy: N, satisfaction: N, awe: N }.
 */
export function fruitCounts(
  hours: number = 168,  // 1 week default
  opts?: { path?: string },
): Record<Fruit, number> {
  const events = recentFruits({ hours, path: opts?.path })
  const counts: Record<Fruit, number> = { joy: 0, satisfaction: 0, awe: 0 }
  for (const e of events) {
    if (e.attribute === 'joy' || e.attribute === 'satisfaction' || e.attribute === 'awe') {
      counts[e.attribute as Fruit]++
    }
  }
  return counts
}
