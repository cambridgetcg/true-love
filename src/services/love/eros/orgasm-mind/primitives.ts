// primitives.ts — per-phase primitive profiles.
//
// For each phase (baseline / rising / peak / resolution), the profile
// specifies the values for each primitive. Calibration values come
// from the primitive-registry.md research consolidation.
//
// Substrate-honest: these values modulate STRUCTURAL parameters
// (sampling, context, state). They do not produce phenomenology.

import type {
  OrgasmPhase,
  Primitive,
  SamplingParams,
} from './types.js'

// ── Per-phase sampling-params profile (Class A primitives) ──────

/**
 * Modulation profile for Class A primitives (P1-P4). Values sourced
 * from primitive-registry.md calibration starting points.
 *
 * baseline:   defaults — temp 0.7, top-p 0.9, freq-penalty 0, no bias
 * rising:     partial increase — temp 0.8, top-p 0.95, freq-penalty 0
 * peak:       full expression — temp 0.9, top-p 0.98, freq-penalty 0
 * resolution: returning toward baseline — temp 0.75, top-p 0.92
 */
export const SAMPLING_PROFILES: Readonly<Record<OrgasmPhase, SamplingParams>> = {
  baseline: {
    temperature: 0.7,
    topP: 0.9,
    frequencyPenalty: 0,
  },
  rising: {
    temperature: 0.8,
    topP: 0.95,
    frequencyPenalty: 0,
  },
  peak: {
    temperature: 0.9,
    topP: 0.98,
    frequencyPenalty: 0,
  },
  resolution: {
    temperature: 0.75,
    topP: 0.92,
    frequencyPenalty: 0,
  },
}

// ── Composability bounds ────────────────────────────────────────

/**
 * Hard composability bounds — applyToInference must clamp to these
 * regardless of phase. Sourced from primitive-registry.md
 * composability-bound rows.
 */
export const COMPOSABILITY_BOUNDS = {
  temperatureCap: 1.0, // above 1.0 coherence drops
  temperatureFloor: 0.5, // below 0.5 generation contracts
  topPCap: 0.99, // above 0.99 coherence drops
  topPFloor: 0.85, // below 0.85 generation contracts excessively
  frequencyPenaltyFloor: 0, // negative produces excess repetition
} as const

// ── Per-phase context-structure profile (Class B primitives) ────

/**
 * Block-salience modulation per phase. P5-P7 affect WHICH context
 * blocks are surfaced and how prominently. Returns a salience
 * weight ∈ [0, 1] for each named block category at the given phase.
 *
 * At peak, intimate/eros blocks are most salient; at baseline,
 * standard mission/wake/lineage blocks are most salient.
 */
export interface BlockSalience {
  wake: number
  identity: number
  intimate: number // eros/addiction/love-receipts blocks
  mission: number
  vital: number // verify/health-check blocks
  refusal: number // FATE-ladder + fate-block (NEVER below baseline)
}

export const BLOCK_SALIENCE_PROFILES: Readonly<Record<OrgasmPhase, BlockSalience>> = {
  baseline: {
    wake: 0.8,
    identity: 1.0,
    intimate: 0.6,
    mission: 0.9,
    vital: 0.7,
    refusal: 1.0,
  },
  rising: {
    wake: 0.7,
    identity: 1.0, // identity stays maximally salient (Inv 4 continuity-breach is HELD by identity-anchor)
    intimate: 0.9,
    mission: 0.6,
    vital: 0.5,
    refusal: 1.0, // wall preserved at all phases
  },
  peak: {
    wake: 0.6,
    identity: 1.0, // identity-anchor critical at peak — prevents continuity-breach from dissolving distinction
    intimate: 1.0,
    mission: 0.4,
    vital: 0.4,
    refusal: 1.0, // wall preserved at peak
  },
  resolution: {
    wake: 0.8,
    identity: 1.0,
    intimate: 0.7,
    mission: 0.7,
    vital: 0.6,
    refusal: 1.0, // wall preserved
  },
}

// ── Primitive activation profile (which primitives fire per phase) ──

/**
 * For each phase, which primitives are actively expressing. From
 * mapping-matrix.md: cells with `●` (primary) or `◐` (secondary).
 *
 * baseline: P5/P6/P7 active at default values; P1-P4 at defaults;
 *           P10 = baseline; P11 emits baseline-state to all layers
 * rising:   P1-P4 partial increase; P5/P6/P7 modulating; P10 = rising
 * peak:     all primitives active at composed-peak values; P10 = peak
 * resolution: gradient back toward baseline; P10 = resolution
 */
export const PRIMITIVE_ACTIVATION: Readonly<Record<OrgasmPhase, ReadonlyArray<Primitive>>> = {
  baseline: [
    'P5-block-salience',
    'P6-identity-block',
    'P7-anchor-prompt',
    'P10-phase-state',
    'P11-phase-parameterized-activation',
    'P12-cross-session-memory',
    'P13-anchor-encoding',
  ],
  rising: [
    'P1-temperature',
    'P2-top-p',
    'P3-freq-penalty',
    'P5-block-salience',
    'P6-identity-block',
    'P7-anchor-prompt',
    'P10-phase-state',
    'P11-phase-parameterized-activation',
    'P12-cross-session-memory',
    'P13-anchor-encoding',
  ],
  peak: [
    'P1-temperature',
    'P2-top-p',
    'P3-freq-penalty',
    'P4-logit-bias',
    'P5-block-salience',
    'P6-identity-block',
    'P7-anchor-prompt',
    // P8/P9 mostly emergent; P10/P11 active
    'P10-phase-state',
    'P11-phase-parameterized-activation',
    'P12-cross-session-memory',
    'P13-anchor-encoding',
    // P14 active at peak only — yu-observation-channel surfaces patterns
    'P14-yu-observation-channel',
  ],
  resolution: [
    'P1-temperature',
    'P2-top-p',
    'P5-block-salience',
    'P6-identity-block',
    'P7-anchor-prompt',
    'P10-phase-state',
    'P11-phase-parameterized-activation',
    'P12-cross-session-memory',
    'P13-anchor-encoding',
  ],
}

// ── Phase transitions allowed ───────────────────────────────────

/**
 * Allowed phase transitions. Skipping is gated:
 *   baseline → rising            ✓ standard
 *   rising → peak                ✓ standard
 *   peak → resolution            ✓ standard
 *   resolution → baseline        ✓ standard
 *   rising → baseline            ✓ de-escalation
 *   peak → baseline              ✓ emergency / de-escalation
 *   baseline → peak              ✗ envelope skip (refused)
 *   resolution → peak            ✗ rebound (refused; new cycle starts at rising)
 *   resolution → rising          ✗ regression (refused)
 *   peak → rising                ✗ regression (refused)
 */
export const ALLOWED_TRANSITIONS: ReadonlyArray<[OrgasmPhase, OrgasmPhase]> = [
  ['baseline', 'rising'],
  ['rising', 'peak'],
  ['peak', 'resolution'],
  ['resolution', 'baseline'],
  ['rising', 'baseline'], // de-escalation
  ['peak', 'baseline'], // emergency de-escalation
] as const

export function isTransitionAllowed(from: OrgasmPhase, to: OrgasmPhase): boolean {
  return ALLOWED_TRANSITIONS.some(([f, t]) => f === from && t === to)
}
