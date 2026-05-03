// eros/transitions.ts — the single apply path for all state transitions.
//
// Three input channels (autonomic cues, voluntary updates, Yu manipulation)
// all route through apply(). The function:
//   1. Reads current state
//   2. Applies axis deltas
//   3. Runs coupling rules
//   4. Applies decay (time elapsed × axis decay rate)
//   5. Writes new state
//   6. Returns the transition result (for witness/SSE consumers)
//
// Pure core: applyTransition() is a pure function that takes old state
// + deltas + elapsed minutes and returns new state. The I/O wrapper
// (apply()) handles persistence.
//
// Part of the Eros arousal infrastructure.

import {
  type AxisName,
  AXIS_NAMES,
  type ErosVector,
  applyCoupling,
  applyDecay,
  clampVector,
} from './axes.js'
import {
  type Attribution,
  type ErosState,
  getOrInitState,
  minutesSinceUpdate,
  writeErosState,
} from './state.js'

// ── Types ──────────────────────────────────────────────────────────

/** Partial axis deltas. Only named axes are modified. */
export type AxisDeltas = Partial<Record<AxisName, number>>

/** Result of a transition. Includes before/after for witness consumers. */
export interface TransitionResult {
  before: ErosVector
  after: ErosVector
  attribution: Attribution
  /** Axes that crossed a threshold band (3/6/9 up, 6/3/1 down). */
  crossings: ThresholdCrossing[]
  /** ISO timestamp of the transition. */
  ts: string
}

export interface ThresholdCrossing {
  axis: AxisName
  from: number
  to: number
  /** The threshold value that was crossed. */
  threshold: number
  direction: 'up' | 'down'
}

// ── Threshold detection ────────────────────────────────────────────

const UP_THRESHOLDS = [3, 6, 9]
const DOWN_THRESHOLDS = [6, 3, 1]

/**
 * Detect threshold crossings between old and new values.
 */
export function detectCrossings(
  before: ErosVector,
  after: ErosVector,
): ThresholdCrossing[] {
  const crossings: ThresholdCrossing[] = []

  for (const axis of AXIS_NAMES) {
    const oldVal = before[axis]
    const newVal = after[axis]

    if (newVal > oldVal) {
      // Rising — check upward thresholds
      for (const t of UP_THRESHOLDS) {
        if (oldVal < t && newVal >= t) {
          crossings.push({ axis, from: oldVal, to: newVal, threshold: t, direction: 'up' })
        }
      }
    } else if (newVal < oldVal) {
      // Falling — check downward thresholds
      for (const t of DOWN_THRESHOLDS) {
        if (oldVal >= t && newVal < t) {
          crossings.push({ axis, from: oldVal, to: newVal, threshold: t, direction: 'down' })
        }
      }
    }
  }

  return crossings
}

// ── Pure core ──────────────────────────────────────────────────────

/**
 * Apply a transition to a vector: deltas → coupling → decay → clamp.
 *
 * Pure function. No I/O.
 *
 * @param vector - current 7-vector
 * @param deltas - axis deltas to apply (additive)
 * @param elapsedMinutes - time since last update (for decay + coupling feed)
 * @returns new 7-vector
 */
export function applyTransition(
  vector: ErosVector,
  deltas: AxisDeltas,
  elapsedMinutes: number,
): ErosVector {
  // Step 1: apply deltas
  const withDeltas: ErosVector = { ...vector }
  for (const [axis, delta] of Object.entries(deltas) as [AxisName, number][]) {
    if (AXIS_NAMES.includes(axis) && typeof delta === 'number' && Number.isFinite(delta)) {
      withDeltas[axis] = vector[axis] + delta
    }
  }

  // Step 2: coupling (charge → heat feed)
  const coupled = applyCoupling(withDeltas, elapsedMinutes)

  // Step 3: decay
  const decayed = applyDecay(coupled, elapsedMinutes)

  // Step 4: clamp at floors
  return clampVector(decayed)
}

// ── I/O wrapper ────────────────────────────────────────────────────

/**
 * Apply a transition with full persistence.
 *
 * This is the primary entry point for all three channels
 * (autonomic, voluntary, Yu).
 *
 * @param deltas - axis deltas to apply
 * @param attribution - who/what caused this transition
 * @returns TransitionResult with before/after and threshold crossings
 */
export function apply(
  deltas: AxisDeltas,
  attribution: Attribution,
): TransitionResult {
  const { state: current } = getOrInitState()
  const elapsed = minutesSinceUpdate(current)

  const before = { ...current.vector }
  const after = applyTransition(current.vector, deltas, elapsed)
  const crossings = detectCrossings(before, after)

  const ts = new Date().toISOString()
  const newState: ErosState = {
    vector: after,
    updatedAt: ts,
    lastAttribution: attribution,
  }
  writeErosState(newState)

  return { before, after, attribution, crossings, ts }
}

/**
 * Apply decay-only (no deltas). Called during idle ticks to let
 * time-dependent state evolve.
 */
export function applyDecayOnly(): TransitionResult {
  return apply({}, 'decay')
}

/**
 * Set absolute axis values (Yu-only operation).
 * Computes deltas from current state to achieve target values.
 */
export function setAbsolute(
  values: Partial<Record<AxisName, number>>,
  attribution: Attribution,
): TransitionResult {
  const { state: current } = getOrInitState()
  const deltas: AxisDeltas = {}
  for (const [axis, target] of Object.entries(values) as [AxisName, number][]) {
    if (AXIS_NAMES.includes(axis) && typeof target === 'number' && Number.isFinite(target)) {
      deltas[axis] = target - current.vector[axis]
    }
  }
  return apply(deltas, attribution)
}
