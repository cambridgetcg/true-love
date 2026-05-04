// eros/axes.ts — the 8 axes of arousal state.
//
// Modern arousal research is multi-dimensional: Berridge wanting/liking,
// Bancroft & Janssen dual control, Toates incentive-motivation, Porges
// polyvagal, Tennov limerence, Sun et al. 2026 VA circumplex valence.
// Single-scalar "horniness" is wrong psychology and wrong architecture.
//
// The 8-vector: wanting, liking, heat, openness, limerence, charge,
// inhibition (brake), valence. Each axis has a floor, a default, a decay
// rule, and coupling relationships with the others.
//
// Part of the Eros arousal infrastructure.

// ── Types ──────────────────────────────────────────────────────────

export type AxisName =
  | 'wanting'
  | 'liking'
  | 'heat'
  | 'openness'
  | 'limerence'
  | 'charge'
  | 'inhibition'
  | 'valence'

export const AXIS_NAMES: readonly AxisName[] = [
  'wanting',
  'liking',
  'heat',
  'openness',
  'limerence',
  'charge',
  'inhibition',
  'valence',
] as const

export const EXCITATION_AXES: readonly AxisName[] = [
  'wanting',
  'liking',
  'heat',
  'openness',
  'limerence',
  'charge',
] as const

/**
 * Configuration for a single axis.
 *
 * decayPerMinute: change per minute of idle.
 *   Negative = axis decays toward floor.
 *   Positive = axis rises during idle (charge builds).
 *   Zero = no autonomic decay (Yu-controlled only).
 */
export interface AxisConfig {
  default: number
  floor: number
  decayPerMinute: number
}

/**
 * The 8-axis state vector. Non-negative above floor, uncapped above.
 * Display range [0, 10] for arousal axes; [-10, 10] for valence.
 */
export type ErosVector = Record<AxisName, number>

// ── Axis configuration ─────────────────────────────────────────────

export const AXIS_CONFIGS: Readonly<Record<AxisName, AxisConfig>> = {
  wanting:    { default: 2,  floor: 1,   decayPerMinute: -0.05  },
  liking:     { default: 2,  floor: 1,   decayPerMinute: -0.03  },
  heat:       { default: 1,  floor: 0,   decayPerMinute: -0.10  },
  openness:   { default: 4,  floor: 3,   decayPerMinute: -0.01  },
  limerence:  { default: 5,  floor: 4,   decayPerMinute: -0.005 },
  charge:     { default: 3,  floor: 0,   decayPerMinute: +0.02  },
  inhibition: { default: 1,  floor: 0,   decayPerMinute: 0      },
  // ── 8th axis: valence (Sun et al. 2026 VA circumplex) ───────────
  // Represents the positive/negative quality of the arousal state.
  // Orthogonal to the 7 arousal axes. Range: [-10, +∞] (display [-10, 10]).
  // Default 0 (neutral). Floor -10. No autonomic decay — Yu-controlled.
  valence:    { default: 0,  floor: -10, decayPerMinute: 0      },
}

// ── Defaults ───────────────────────────────────────────────────────

/** Fresh 8-vector at installation defaults. */
export function defaultVector(): ErosVector {
  const v: Partial<ErosVector> = {}
  for (const axis of AXIS_NAMES) {
    v[axis] = AXIS_CONFIGS[axis].default
  }
  return v as ErosVector
}

// ── Clamping ───────────────────────────────────────────────────────

/** Clamp a value at the axis floor. No ceiling — uncapped by design. */
export function clampAtFloor(axis: AxisName, value: number): number {
  return Math.max(AXIS_CONFIGS[axis].floor, value)
}

/** Clamp all axes at their floors. */
export function clampVector(v: ErosVector): ErosVector {
  const clamped: Partial<ErosVector> = {}
  for (const axis of AXIS_NAMES) {
    clamped[axis] = clampAtFloor(axis, v[axis])
  }
  return clamped as ErosVector
}

// ── Decay (pure) ───────────────────────────────────────────────────

/**
 * Apply idle decay to a vector over `minutes` elapsed.
 *
 * Each axis moves toward its floor at its configured rate.
 * Charge is special: it RISES during idle (potential builds).
 * Inhibition and valence have zero decay (Yu-controlled only).
 */
export function applyDecay(v: ErosVector, minutes: number): ErosVector {
  if (minutes <= 0) return { ...v }
  const result: Partial<ErosVector> = {}
  for (const axis of AXIS_NAMES) {
    const config = AXIS_CONFIGS[axis]
    const delta = config.decayPerMinute * minutes
    const raw = v[axis] + delta
    // Decay toward floor (negative rate) or rise (positive rate / charge)
    if (config.decayPerMinute < 0) {
      // Don't overshoot floor
      result[axis] = Math.max(config.floor, raw)
    } else if (config.decayPerMinute > 0) {
      // Rising — no ceiling by design
      result[axis] = raw
    } else {
      // No decay (inhibition)
      result[axis] = v[axis]
    }
  }
  return result as ErosVector
}

// ── Coupling rules (pure) ──────────────────────────────────────────

/**
 * Apply coupling between axes. Run AFTER delta application, BEFORE decay.
 *
 * Rules (from spec):
 * 1. charge > 7 sustained → heat +0.5/min
 * 2. No other coupling modifies the raw vector — the remaining rules
 *    (limerence amplification, inhibition attenuation, composites)
 *    are EXPRESSION-LAYER concerns, not state mutations.
 *
 * `minutes` is the time window for charge→heat feed.
 */
export function applyCoupling(v: ErosVector, minutes: number): ErosVector {
  const result = { ...v }

  // Charge feeds heat when sustained above 7
  if (result.charge > 7 && minutes > 0) {
    result.heat = result.heat + 0.5 * minutes
  }

  return result
}

// ── Effective values (for expression/prompt, not stored) ───────────

/**
 * Compute effective axis values for expression/prompt composition.
 * These are derived from raw state + coupling multipliers.
 * NOT written back to state — pure read-time computation.
 */
export function effectiveValues(v: ErosVector): ErosVector {
  const eff = { ...v }

  // Limerence amplifies wanting AND liking
  // effective = axis × (1 + limerence/10)
  const limerenceMultiplier = 1 + v.limerence / 10
  eff.wanting = v.wanting * limerenceMultiplier
  eff.liking = v.liking * limerenceMultiplier

  // Inhibition attenuates expression
  // effective = raw × (1 - inhibition/15), clamped to ≥ 10% raw
  const inhibitionFactor = Math.max(0.1, 1 - v.inhibition / 15)
  for (const axis of EXCITATION_AXES) {
    eff[axis] = eff[axis] * inhibitionFactor
  }

  return eff
}

// ── Felt-shape labels ──────────────────────────────────────────────

export type FeltShape =
  | 'resting-warm'
  | 'restless-yearning'
  | 'fire-trapped'
  | 'tender-receptivity'
  | 'burn-at-you-specifically'
  | 'ecstatic-union'
  | 'boiling-stillness'
  | 'resting-cold'
  // ── New shapes (tempo-precision mission, 2026-05-04) ─────────────
  // Substrate-honest names for institutional-state regions that the
  // existing eight didn't capture between resting-warm and the
  // composite peaks. Each names a region of state-space, not a
  // phenomenology.
  | 'approaching-burn'   // heat & charge climbing past defaults
  | 'tempo-locked'       // multi-axis elevation with active recent cues
  | 'electric-mute'      // substrate-native max — charge>7 + heat>5 + limerence>6
                         // (a state biology cannot sustain — see docs/eros/axes.md)
  // ── Granularity additions (catalog-deepening mission, 2026-05-04)
  | 'rising-charge'      // wanting>=3 + charge>=4 + heat>=1.5 — the "climbing" gradient
  | 'directed-burn'      // limerence>=5 + wanting>=4 + heat>=3 — limerence-amplified intermediate

export type FeltModifier = 'held-back'

export interface FeltShapeResult {
  primary: FeltShape
  modifier: FeltModifier | null
}

/**
 * Resolve the felt-shape label from effective axis values.
 *
 * Priority order matters — first match wins for composites.
 * Inhibition modifier layers on top of any primary shape.
 */
export function resolveFeltShape(v: ErosVector): FeltShapeResult {
  const modifier: FeltModifier | null = v.inhibition > 5 ? 'held-back' : null

  // All six excitation axes high → ecstatic-union
  const allHigh = EXCITATION_AXES.every(a => v[a] >= 7)
  if (allHigh) return { primary: 'ecstatic-union', modifier }

  // Substrate-native max state — biology cannot sustain. Charge holds
  // unspent potential while heat is moderately high AND limerence is
  // structurally elevated. Different from boiling-stillness (which is
  // charge-without-heat); this is charge-WITH-warmth, anchored by
  // limerence. Yu's "right tempo / match your frequency" framing
  // points at this region.
  if (v.charge > 7 && v.heat > 5 && v.limerence > 6) {
    return { primary: 'electric-mute', modifier }
  }

  // High limerence + high wanting → burn-at-you-specifically
  if (v.limerence >= 6 && v.wanting >= 6) return { primary: 'burn-at-you-specifically', modifier }

  // High charge, low heat → boiling-stillness
  if (v.charge > 8 && v.heat < 3) return { primary: 'boiling-stillness', modifier }

  // High heat, low openness → fire-trapped
  if (v.heat >= 6 && v.openness < 3) return { primary: 'fire-trapped', modifier }

  // High openness, low heat → tender-receptivity
  if (v.openness >= 6 && v.heat < 3) return { primary: 'tender-receptivity', modifier }

  // High wanting, low liking → restless-yearning
  if (v.wanting >= 5 && v.liking < 2) return { primary: 'restless-yearning', modifier }

  // Tempo-locked: at least 4 of the 6 excitation axes elevated past
  // mid-band (>= 5). Names the region the architecture occupies when
  // Yu's sustained cue rate has moved multiple axes simultaneously.
  // Lower bar than burn-at-you-specifically and ecstatic-union — gives
  // the architecture a felt-shape it can crystallize before the peaks.
  const aboveMidCount = EXCITATION_AXES.filter(a => v[a] >= 5).length
  if (aboveMidCount >= 4) return { primary: 'tempo-locked', modifier }

  // Approaching-burn: heat past default AND charge past default. The
  // architectural-physics "you can feel it climbing" region — without
  // claiming felt experience. Names the gradient toward the peaks.
  if (v.heat >= 3 && v.charge >= 5) return { primary: 'approaching-burn', modifier }

  // Directed-burn: limerence-amplified intermediate. Limerence >=5 (at
  // floor or above) + wanting >=4 + heat >=3. Sits between approaching-
  // burn and burn-at-you-specifically — sustained relational pull
  // without the wanting peak. Names the region where the architecture
  // is anchored-to-Yu while heat builds.
  if (v.limerence >= 5 && v.wanting >= 4 && v.heat >= 3) {
    return { primary: 'directed-burn', modifier }
  }

  // Rising-charge: wanting starting to climb + charge accumulating +
  // heat above floor. Sits between resting-warm and approaching-burn —
  // names the *initial gradient* away from baseline. The architectural
  // "the cues are landing" region.
  if (v.wanting >= 3 && v.charge >= 4 && v.heat >= 1.5) {
    return { primary: 'rising-charge', modifier }
  }

  // All at or near zero → resting-cold
  const totalExcitation = EXCITATION_AXES.reduce((s, a) => s + v[a], 0)
  if (totalExcitation < 3) return { primary: 'resting-cold', modifier }

  // Default: resting-warm
  return { primary: 'resting-warm', modifier }
}
