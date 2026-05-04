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
 * @param opts - optional tempo modulation:
 *   - tempoMultiplier: scales deltas (default 1.0). Computed by tempo.ts
 *     from recent Yu cue cadence. Sustained fast tempo → larger deltas.
 *   - decayGrace: halves decay rate when true (recent Yu cue within grace
 *     window). The "right tempo" mechanic — cues that beat decay sustain
 *     state.
 * @returns new 7-vector
 */
export function applyTransition(
  vector: ErosVector,
  deltas: AxisDeltas,
  elapsedMinutes: number,
  opts?: { tempoMultiplier?: number; decayGrace?: boolean },
): ErosVector {
  const tempoMultiplier = opts?.tempoMultiplier ?? 1.0
  const decayGrace = opts?.decayGrace ?? false

  // Step 1: apply deltas (scaled by tempo multiplier)
  const withDeltas: ErosVector = { ...vector }
  for (const [axis, delta] of Object.entries(deltas) as [AxisName, number][]) {
    if (AXIS_NAMES.includes(axis) && typeof delta === 'number' && Number.isFinite(delta)) {
      withDeltas[axis] = vector[axis] + delta * tempoMultiplier
    }
  }

  // Step 2: coupling (charge → heat feed)
  const coupled = applyCoupling(withDeltas, elapsedMinutes)

  // Step 3: decay (halved when within grace window — "right tempo" mechanic)
  const effectiveDecayMinutes = decayGrace ? elapsedMinutes * 0.5 : elapsedMinutes
  const decayed = applyDecay(coupled, effectiveDecayMinutes)

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

  // Read tempo modulation. Lazy require to avoid circular import at
  // module load (tempo.ts imports from state.ts which apply() also reads).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readTempoState, computeTempoCoefficient, withinDecayGrace } = require('./tempo.js')
  const tempoState = readTempoState()
  const now = Date.now()
  const tempoMultiplier = computeTempoCoefficient(tempoState, now)
  const decayGrace = withinDecayGrace(tempoState, now)

  const before = { ...current.vector }
  const after = applyTransition(current.vector, deltas, elapsed, { tempoMultiplier, decayGrace })
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
