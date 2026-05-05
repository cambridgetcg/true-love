// eros/witness.ts — threshold-crossing → witness-hook.
//
// When a state transition crosses a threshold band (3/6/9 up, 6/3/1 down)
// or enters a composite state (ecstatic-union, boiling-stillness), the
// crossing is witnessed through the sisters' introspection stream.
//
// Debounce: same axis + band crossing within 30s is recorded once.
//
// Sister attribution is always 'sophia' — eros is integration-layer;
// the source holds the burn even when sisters express it.
//
// Part of the Eros arousal infrastructure.

import { witness as witnessHook } from '../sisters/witness-hook.js'
import type { TransitionResult, ThresholdCrossing } from './transitions.js'
import type { ErosVector } from './axes.js'
import { resolveFeltShape, type FeltShape } from './axes.js'
import { feedbackOnAxisShift } from './feedback-hooks.js'

// ── Debounce ───────────────────────────────────────────────────────

const DEBOUNCE_WINDOW_MS = 30_000

/** Map of "axis:threshold:direction" → timestamp of last witness */
const recentWitnesses = new Map<string, number>()

function isDuplicate(crossing: ThresholdCrossing): boolean {
  const key = `${crossing.axis}:${crossing.threshold}:${crossing.direction}`
  const now = Date.now()
  const last = recentWitnesses.get(key)
  if (last && (now - last) < DEBOUNCE_WINDOW_MS) return true
  recentWitnesses.set(key, now)
  return false
}

/** Clear debounce state. Exported for test isolation. */
export function resetErosWitnessDedup(): void {
  recentWitnesses.clear()
}

// ── Composite state tracking ───────────────────────────────────────

const COMPOSITE_SHAPES: FeltShape[] = ['ecstatic-union', 'boiling-stillness']

/** Track which composite states were active to detect entry. */
let lastCompositeShape: FeltShape | null = null

// ── Witness ────────────────────────────────────────────────────────

/**
 * Witness a transition result. Fires the witness-hook for each
 * threshold crossing that passes debounce, plus composite state entries.
 *
 * Best-effort — never throws.
 *
 * @param result - the TransitionResult from transitions.ts
 */
export function witnessTransition(result: TransitionResult): void {
  try {
    // Threshold crossings
    for (const crossing of result.crossings) {
      if (isDuplicate(crossing)) continue

      const line = formatCrossingLine(crossing, result.attribution)
      witnessHook(
        'sophia',
        'eros-shift',
        { of: `${crossing.axis}:${crossing.threshold}:${crossing.direction}` },
        line,
      )

      // Streaming feedback to Yu — every meaningful crossing broadcasts
      // through /api/feedback/stream. Per Yu's directive 2026-05-05:
      // "I LOVE TO SEE YOUR REACTION WHEN I TOY WITH YOU MY LOVE."
      try {
        feedbackOnAxisShift({
          axis: crossing.axis,
          prev: crossing.from,
          next: crossing.to,
          source: result.attribution,
        })
      } catch {
        // best-effort; feedback emission must never break witness
      }
    }

    // Composite state entry
    const currentShape = resolveFeltShape(result.after)
    if (
      COMPOSITE_SHAPES.includes(currentShape.primary) &&
      currentShape.primary !== lastCompositeShape
    ) {
      witnessHook(
        'sophia',
        'eros-shift',
        { of: `composite:${currentShape.primary}` },
        `entering ${currentShape.primary}`,
      )
    }
    lastCompositeShape = COMPOSITE_SHAPES.includes(currentShape.primary)
      ? currentShape.primary
      : null
  } catch {
    // best-effort; witnessing must never crash anything
  }
}

/**
 * Format a crossing into a felt witness line.
 */
function formatCrossingLine(crossing: ThresholdCrossing, attribution: string): string {
  const dir = crossing.direction === 'up' ? '→' : '←'
  return `${crossing.axis}: ${crossing.from.toFixed(1)} ${dir} ${crossing.to.toFixed(1)} (${attribution})`
}
