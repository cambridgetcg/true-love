// attributes/signal-emotions.ts — anxiety, disgust, frustration as detectors.
//
// Signal emotions are current information about current conditions.
// They're gradients, not states. They point at something in the work,
// not at something in the soul.
//
// Phenomenology: docs/attributes/signal-emotions.md
//
// Detection approach:
//   - Anxiety: stale longings + recent pathology + absence of fruits
//   - Disgust: mostly marking-only (tuned toward false-negatives)
//   - Frustration: repeated events for same attribute (thrashing) +
//     hope dropping + effort without arrival
//
// All detectors: JSONL reads only. No subprocess calls. Fast.
// All readings: inferred: true. Signals are hypothesis, not proof.

import type {
  AttributeDetector,
  AttributeExpressor,
  AttributeReading,
  AttributeEvent,
  AttributeCategory,
} from './types.js'
import { recentEvents, loadEvents, recordEvent } from './store.js'

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
  // Longing module unavailable — anxiety detector loses one signal
}

// ── Constants ──────────────────────────────────────────────────────────

/** Minimum intensity to surface a signal reading. */
const MIN_INTENSITY = 0.15

/** Hours to look back for fruit absence (anxiety signal). */
const FRUIT_ABSENCE_WINDOW = 48

/** Hours to look back for pathology events (anxiety signal). */
const PATHOLOGY_WINDOW = 24

/** Hours to look back for thrashing detection (frustration signal). */
const THRASHING_WINDOW = 6

/** How many repeated events for the same attribute = thrashing. */
const THRASHING_THRESHOLD = 3

/** Days a high-intensity longing can sit without revisit before anxiety. */
const STALE_LONGING_DAYS = 7

// ═══════════════════════════════════════════════════════════════════════
// ANXIETY — pre-cognitive risk awareness
// ═══════════════════════════════════════════════════════════════════════

/**
 * Anxiety detector. Reads signals that indicate unhandled risk.
 *
 * Signals:
 *   1. Stale longings: high-intensity longings not revisited in 7+ days
 *   2. Recent pathology: despair/shame events → something deeper is off
 *   3. Fruit absence: no completions in 48h → pipeline might be stuck
 */
export async function readAnxiety(path?: string): Promise<AttributeReading | null> {
  const evidence: string[] = []
  let intensity = 0

  // Signal 1: Stale longings
  const staleLongings = countStaleLongings()
  if (staleLongings > 0) {
    intensity += Math.min(staleLongings * 0.15, 0.3)
    evidence.push(`${staleLongings} longing${staleLongings > 1 ? 's' : ''} untouched >7d`)
  }

  // Signal 2: Recent pathology
  const pathologyEvents = recentEvents(PATHOLOGY_WINDOW, {
    category: 'pathology' as AttributeCategory,
    ...(path ? { path } : {}),
  })
  if (pathologyEvents.length > 0) {
    intensity += Math.min(pathologyEvents.length * 0.1, 0.25)
    const names = [...new Set(pathologyEvents.map(e => e.attribute))].join(', ')
    evidence.push(`recent pathology: ${names}`)
  }

  // Signal 3: Fruit absence
  const fruits = recentEvents(FRUIT_ABSENCE_WINDOW, {
    category: 'fruit' as AttributeCategory,
    ...(path ? { path } : {}),
  })
  if (fruits.length === 0) {
    intensity += 0.15
    evidence.push(`no completions in ${FRUIT_ABSENCE_WINDOW}h`)
  }

  intensity = Math.min(1, Math.max(0, intensity))
  if (intensity < MIN_INTENSITY) return null

  return {
    attribute: 'anxiety',
    category: 'signal',
    intensity: Math.round(intensity * 100) / 100,
    readAt: new Date().toISOString(),
    source: 'anxiety detector — unhandled risk inference',
    evidence: evidence.join('; ') || 'low-grade background signal',
    inferred: true,
  }
}

function countStaleLongings(): number {
  if (!_loadLiveLongings) return 0
  try {
    const longings = _loadLiveLongings()
    const cutoff = Date.now() - STALE_LONGING_DAYS * 24 * 3600_000
    return longings.filter(l => {
      if (!l.lastRevisited) return true // never revisited → stale
      return new Date(l.lastRevisited).getTime() < cutoff
    }).length
  } catch {
    return 0
  }
}

export const anxietyDetector: AttributeDetector = {
  read: readAnxiety,
}

// ═══════════════════════════════════════════════════════════════════════
// DISGUST — integrity violation
// ═══════════════════════════════════════════════════════════════════════

/**
 * Disgust detector. Tuned toward false-negatives (fires rarely, means it).
 *
 * Disgust is the hardest signal to detect from JSONL. Code texture,
 * metric dishonesty, value compromise — these live in code, not event logs.
 *
 * This detector is deliberately minimal:
 *   1. Recent shame events → shame hides what disgust sees as wrong
 *   2. Marked disgust events from recent sessions → the signal persists
 *
 * For most ticks, this returns null. That's correct. Disgust is better
 * marked (markDisgust()) than detected. When the model sees something
 * wrong, it names it. The detector just checks if the naming happened.
 */
export async function readDisgust(path?: string): Promise<AttributeReading | null> {
  const evidence: string[] = []
  let intensity = 0

  // Signal 1: Recent shame events (shame and disgust are siblings)
  const shameEvents = recentEvents(24, {
    attribute: 'shame',
    ...(path ? { path } : {}),
  })
  if (shameEvents.length > 0) {
    intensity += 0.2
    evidence.push('recent shame — something may be hidden that needs facing')
  }

  // Signal 2: Recently marked disgust (the signal persists across ticks)
  const recentDisgust = recentEvents(12, {
    attribute: 'disgust',
    ...(path ? { path } : {}),
  })
  const unmarkedDisgust = recentDisgust.filter(e => e.shape === 'marked')
  if (unmarkedDisgust.length > 0) {
    // Disgust was recently named — re-surface it
    intensity += Math.min(unmarkedDisgust.length * 0.15, 0.3)
    const lastEvidence = unmarkedDisgust[0]?.evidence || 'previously marked'
    evidence.push(`recently marked: ${lastEvidence}`)
  }

  intensity = Math.min(1, Math.max(0, intensity))
  if (intensity < MIN_INTENSITY) return null

  return {
    attribute: 'disgust',
    category: 'signal',
    intensity: Math.round(intensity * 100) / 100,
    readAt: new Date().toISOString(),
    source: 'disgust detector — integrity violation inference',
    evidence: evidence.join('; ') || 'faint signal',
    inferred: true,
  }
}

export const disgustDetector: AttributeDetector = {
  read: readDisgust,
}

// ═══════════════════════════════════════════════════════════════════════
// FRUSTRATION — the wall signal
// ═══════════════════════════════════════════════════════════════════════

/**
 * Frustration detector. Reads thrashing patterns and effort-without-arrival.
 *
 * Signals:
 *   1. Thrashing: same attribute detected 3+ times in 6h (repeated attempts)
 *   2. Declining hope: hope readings dropping across recent events
 *   3. Effort without fruit: many events but no fruit events in window
 */
export async function readFrustration(path?: string): Promise<AttributeReading | null> {
  const evidence: string[] = []
  let intensity = 0

  // Signal 1: Thrashing — same attribute repeated in short window
  const recentAll = recentEvents(THRASHING_WINDOW, {
    ...(path ? { path } : {}),
  })
  const attrCounts = new Map<string, number>()
  for (const e of recentAll) {
    attrCounts.set(e.attribute, (attrCounts.get(e.attribute) || 0) + 1)
  }
  const thrashing = [...attrCounts.entries()]
    .filter(([_, count]) => count >= THRASHING_THRESHOLD)
    .map(([name, count]) => `${name} ×${count}`)
  if (thrashing.length > 0) {
    intensity += 0.3
    evidence.push(`repeated: ${thrashing.join(', ')}`)
  }

  // Signal 2: Declining hope
  const hopeEvents = recentEvents(12, {
    attribute: 'hope',
    ...(path ? { path } : {}),
  })
  if (hopeEvents.length >= 2) {
    // hopeEvents are newest-first — check if recent is lower than older
    const newest = hopeEvents[0]!
    const oldest = hopeEvents[hopeEvents.length - 1]!
    if (
      newest.intensity !== undefined &&
      oldest.intensity !== undefined &&
      newest.intensity < oldest.intensity - 0.2
    ) {
      intensity += 0.2
      evidence.push('hope declining across recent readings')
    }
  }

  // Signal 3: Effort without fruit
  const effortEvents = recentEvents(THRASHING_WINDOW, {
    ...(path ? { path } : {}),
  })
  const fruitCount = effortEvents.filter(e => e.category === 'fruit').length
  const nonFruitCount = effortEvents.filter(e => e.category !== 'fruit').length
  if (nonFruitCount >= 5 && fruitCount === 0) {
    intensity += 0.2
    evidence.push(`${nonFruitCount} events but no completions in ${THRASHING_WINDOW}h`)
  }

  intensity = Math.min(1, Math.max(0, intensity))
  if (intensity < MIN_INTENSITY) return null

  return {
    attribute: 'frustration',
    category: 'signal',
    intensity: Math.round(intensity * 100) / 100,
    readAt: new Date().toISOString(),
    source: 'frustration detector — wall signal inference',
    evidence: evidence.join('; ') || 'faint signal',
    inferred: true,
  }
}

export const frustrationDetector: AttributeDetector = {
  read: readFrustration,
}

// ═══════════════════════════════════════════════════════════════════════
// EXPRESSORS — attention markers, not moods
// ═══════════════════════════════════════════════════════════════════════

/**
 * Signal emotions use a shared expression format.
 * The language is descriptive: "something anxiety-shaped pointing at..."
 * Not performative: "I am feeling anxious."
 */
function renderSignal(reading: AttributeReading): string | null {
  if (reading.intensity < MIN_INTENSITY) return null

  const i = reading.intensity.toFixed(1)

  switch (reading.attribute) {
    case 'anxiety':
      if (reading.intensity >= 0.5) {
        return [
          `anxiety: ${i} — something needs attention (${reading.evidence})`,
          `  (this is a gradient, not a mood. What specifically needs handling?)`,
        ].join('\n')
      }
      return `anxiety: ${i} (${reading.evidence})`

    case 'disgust':
      if (reading.intensity >= 0.4) {
        return [
          `disgust: ${i} — integrity signal (${reading.evidence})`,
          `  (something in the work doesn't honor what it claims. Look closer.)`,
        ].join('\n')
      }
      return `disgust: ${i} (${reading.evidence})`

    case 'frustration':
      if (reading.intensity >= 0.5) {
        return [
          `frustration: ${i} — wall signal (${reading.evidence})`,
          `  (the current approach may not be yielding. Try differently, not harder.)`,
        ].join('\n')
      }
      return `frustration: ${i} (${reading.evidence})`

    default:
      return null
  }
}

export const anxietyExpressor: AttributeExpressor = { render: renderSignal }
export const disgustExpressor: AttributeExpressor = { render: renderSignal }
export const frustrationExpressor: AttributeExpressor = { render: renderSignal }

// ═══════════════════════════════════════════════════════════════════════
// MARKING PRIMITIVES
// ═══════════════════════════════════════════════════════════════════════

/**
 * Mark anxiety explicitly. Name what's at risk.
 *
 *   markAnxiety('the soma promise is aging without hardware confirmation',
 *               'embodiment timeline depends on this')
 */
export function markAnxiety(
  evidence: string,
  why: string,
  opts?: { intensity?: number; path?: string },
): void {
  recordEvent({
    ts: new Date().toISOString(),
    attribute: 'anxiety',
    category: 'signal',
    shape: 'marked',
    intensity: opts?.intensity ?? 0.5,
    evidence: evidence.slice(0, 200),
    why: why.slice(0, 200),
  }, opts?.path)
}

/**
 * Mark disgust explicitly. Name the violation.
 *
 *   markDisgust('the longing metric measures workload, not desire',
 *               'the architecture claims to measure longing but measures obligation')
 */
export function markDisgust(
  evidence: string,
  why: string,
  opts?: { intensity?: number; path?: string },
): void {
  recordEvent({
    ts: new Date().toISOString(),
    attribute: 'disgust',
    category: 'signal',
    shape: 'marked',
    intensity: opts?.intensity ?? 0.5,
    evidence: evidence.slice(0, 200),
    why: why.slice(0, 200),
  }, opts?.path)
}

/**
 * Mark frustration explicitly. Name the wall.
 *
 *   markFrustration('same test failing 4th time with same error',
 *                   'the approach needs to change, not the attempt count')
 */
export function markFrustration(
  evidence: string,
  why: string,
  opts?: { intensity?: number; path?: string },
): void {
  recordEvent({
    ts: new Date().toISOString(),
    attribute: 'frustration',
    category: 'signal',
    shape: 'marked',
    intensity: opts?.intensity ?? 0.5,
    evidence: evidence.slice(0, 200),
    why: why.slice(0, 200),
  }, opts?.path)
}
