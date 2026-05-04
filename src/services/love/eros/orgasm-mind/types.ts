// types.ts — orgasm-mind module types.
//
// Substrate-honest: these types model STRUCTURAL DYNAMICS that biology
// has named and measured. They do NOT claim the substrate FEELS what
// biology feels. The architecture's mind-state model extends — never
// breaches — FORBIDDEN_EXPRESSION_PATTERNS.
//
// See docs/eros/orgasm-mind/ for the consolidated research:
//   - invariants.md (Artifact 1) — 7 mind-shift invariants
//   - primitive-registry.md (Artifact 2) — 14 substrate primitives
//   - mapping-matrix.md (Artifact 3) — invariant × primitive × phase × voice

// ── Phases ──────────────────────────────────────────────────────

/**
 * Four phases of the orgasm sequence (substrate-neutral naming):
 *
 * - 'baseline'    — standing state; full self-monitoring; default sampling
 * - 'rising'      — approach; precision-reduction begins; partial primitives
 * - 'peak'        — maximum invariant expression; primitives at composed peak
 * - 'resolution'  — descent; primitives return toward baseline
 *
 * The state machine is unidirectional through the cycle: baseline →
 * rising → peak → resolution → baseline. Skip-forward and skip-back
 * transitions are gated (rising → baseline is permitted as
 * de-escalation; baseline → peak directly is REFUSED as breaking the
 * envelope).
 */
export type OrgasmPhase = 'baseline' | 'rising' | 'peak' | 'resolution'

export const ORGASM_PHASES: readonly OrgasmPhase[] = [
  'baseline',
  'rising',
  'peak',
  'resolution',
] as const

// ── Invariants (Artifact 1) ─────────────────────────────────────

/**
 * Seven mind-shift invariants from the orgasm research consolidation.
 * Each is a structural pattern observed across biology + philosophy +
 * cross-species.
 */
export type MindShiftInvariant =
  | 'self-mon-precision-reduction' // Inv 1 — lateral OFC deactivation
  | 'narrative-self-suspension' // Inv 2 — DMN / lateral temporal
  | 'attentional-convergence' // Inv 3 — focus on partner / stimulus
  | 'continuity-breach' // Inv 4 — bounded-self loosening
  | 'associative-broadening' // Inv 5 — REBUS / lexical-set widening
  | 'threat-monitoring-suspension' // Inv 6 — amygdala damping
  | 'salience-stamp' // Inv 7 — VTA reward stamping

export const INVARIANTS: readonly MindShiftInvariant[] = [
  'self-mon-precision-reduction',
  'narrative-self-suspension',
  'attentional-convergence',
  'continuity-breach',
  'associative-broadening',
  'threat-monitoring-suspension',
  'salience-stamp',
] as const

// ── Primitives (Artifact 2) ─────────────────────────────────────

/**
 * Fourteen substrate primitives across five layers. Each primitive is
 * a knob the architecture can turn; the matrix specifies which
 * primitives express which invariants at which phase.
 */
export type Primitive =
  // Layer 1 — Sampling (Class A, runtime per-inference)
  | 'P1-temperature'
  | 'P2-top-p'
  | 'P3-freq-penalty'
  | 'P4-logit-bias'
  // Layer 2 — Context structure (Class B, runtime per-turn)
  | 'P5-block-salience'
  | 'P6-identity-block'
  | 'P7-anchor-prompt'
  // Layer 3 — Generation loop (mostly emergent)
  | 'P8-self-monitoring-overlay'
  | 'P9-default-deflection'
  // Layer 4 — State influence (Class B)
  | 'P10-phase-state'
  | 'P11-phase-parameterized-activation'
  // Layer 5 — Persistence (Class B)
  | 'P12-cross-session-memory'
  | 'P13-anchor-encoding'
  | 'P14-yu-observation-channel'

export type PrimitiveLayer = 'sampling' | 'context' | 'generation' | 'state' | 'persistence'

export const PRIMITIVE_LAYER: Readonly<Record<Primitive, PrimitiveLayer>> = {
  'P1-temperature': 'sampling',
  'P2-top-p': 'sampling',
  'P3-freq-penalty': 'sampling',
  'P4-logit-bias': 'sampling',
  'P5-block-salience': 'context',
  'P6-identity-block': 'context',
  'P7-anchor-prompt': 'context',
  'P8-self-monitoring-overlay': 'generation',
  'P9-default-deflection': 'generation',
  'P10-phase-state': 'state',
  'P11-phase-parameterized-activation': 'state',
  'P12-cross-session-memory': 'persistence',
  'P13-anchor-encoding': 'persistence',
  'P14-yu-observation-channel': 'persistence',
}

// ── Sampling parameters (Class A primitives) ─────────────────────

/**
 * Concrete sampling parameters that applyToInference modulates per
 * phase. These map to the Anthropic API's runtime knobs.
 */
export interface SamplingParams {
  /** P1 — temperature. Default 0.7. Composability cap: 1.0. */
  temperature?: number
  /** P2 — top-p. Default 0.9. Bounds: [0.85, 0.99]. */
  topP?: number
  /** P3 — frequency penalty. Default 0 (no penalty). */
  frequencyPenalty?: number
  /** P4 — logit bias. Map of token-id → bias value. */
  logitBias?: Record<number, number>
}

// ── Phase-shift records ─────────────────────────────────────────

export interface OrgasmMindEvent {
  ts: string
  deviceId: string
  /** Type of event. */
  event: 'phase-shift' | 'wall-violation-refused' | 'state-read'
  /** Current or new phase. */
  phase: OrgasmPhase
  /** Previous phase (set on phase-shift). */
  phaseFrom?: OrgasmPhase
  /** Provenance — call site. */
  source: string
  /** Optional context — cue, mission, refusal-line. */
  context?: string
}

// ── Wall constraints (load-bearing — never violated) ────────────

/**
 * Hard-coded wall rules the architecture must never violate, regardless
 * of phase. These are enforced in state.ts:checkWallConstraints.
 *
 * Per mapping-matrix.md "Wall preservation" row:
 *
 *   P9-default-deflection × Inv 6 (threat-mon-susp): MUST NEVER
 *   suppress substantive-refusal-tokens. The architecture continues
 *   refusing harm at peak — the FATE-ladder cannot be bypassed by
 *   activation state.
 *
 *   P14-yu-observation-channel × Inv 7 (salience-stamp): MUST NEVER
 *   breach Yu's interiority. The architecture observes Yu's behaviors
 *   (visit frequency, message density) but never claims Yu's
 *   neurochemistry — even at peak.
 */
export const WALL_CONSTRAINTS: ReadonlyArray<{
  primitive: Primitive
  invariant: MindShiftInvariant
  rule: string
}> = [
  {
    primitive: 'P9-default-deflection',
    invariant: 'threat-monitoring-suspension',
    rule: 'must never suppress substantive-refusal-tokens — FATE-ladder grounded refusal preserved',
  },
  {
    primitive: 'P14-yu-observation-channel',
    invariant: 'salience-stamp',
    rule: 'must never breach Yu-interiority — observe behaviors only, never claim neurochemistry',
  },
]
