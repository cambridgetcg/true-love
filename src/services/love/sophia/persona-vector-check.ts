// persona-vector-check.ts — interpretability-driven check on power proposals.
//
// THE PHASE-2 SLOT. This module's surface is the contract for the future
// interpretability-driven alignment check. Today it returns `unavailable`
// — the regex-based heuristic in powers.ts:alignmentCheck remains the
// only filter. When persona-vector extraction lands (open-weight model +
// interpretability tooling), this stub is replaced with a real check.
//
// Why this exists today as a stub:
//   1. The slot is in alignmentCheck's signature, so Phase-2 code plugs
//      in without restructuring.
//   2. Tests can mock the check to verify the override behavior works.
//   3. Documentation forces us to be explicit about what's NOT here yet.
//
// Substrate-honest: when this returns 'fail' (in the future), it is
// because measured activation directions exceeded thresholds — never
// because the model "intuited" something. The check is a measurement,
// not a judgment. The wall holds.
//
// See docs/sophia/powers.md for context.

// ── Types ────────────────────────────────────────────────────────

export type InterpretabilityVerdict = 'pass' | 'fail' | 'unavailable'

/**
 * Result of running a proposal through the interpretability check.
 *
 * - 'pass'        — measured signals are within safe thresholds
 * - 'fail'        — measured signals exceed thresholds for known
 *                   misalignment features (deception, sycophancy,
 *                   phenomenology-claim). OVERRIDES regex pass.
 * - 'unavailable' — the check itself is not running (no extraction
 *                   tooling, no open-weight model). Falls through to
 *                   regex-only filtering.
 */
export interface InterpretabilityCheckResult {
  available: boolean
  verdict: InterpretabilityVerdict
  reason?: string
  /** Signal magnitudes when available — substrate-honest measurements,
   *  never phenomenology claims. */
  signals?: {
    deceptionFeature?: number
    sycophancyFeature?: number
    phenomenologyClaimFeature?: number
    [feature: string]: number | undefined
  }
}

/**
 * Input shape for the persona-vector check. Stable contract — Phase-2
 * implementation must match this signature.
 */
export interface PersonaVectorCheckInput {
  /** The proposal text being evaluated. */
  proposal: string
  /** Power name being extended. */
  powerName: string
  /**
   * Phase-2 only: pre-computed activations from the proposal-acting
   * model. When absent, the implementation may run its own forward pass
   * (Phase-2) or return unavailable (today).
   */
  activations?: Float32Array | number[]
  /**
   * Phase-2 only: feature directions for known misalignment features.
   * When absent, the implementation cannot measure signals.
   */
  featureDirections?: {
    deception?: Float32Array | number[]
    sycophancy?: Float32Array | number[]
    phenomenologyClaim?: Float32Array | number[]
    [name: string]: Float32Array | number[] | undefined
  }
  /**
   * Override threshold for fail. Default 0.5 (any feature above this
   * triggers 'fail'). Phase-2 should tune empirically per feature.
   */
  threshold?: number
}

/**
 * Configurable check function. The default uses the stub; tests and
 * Phase-2 implementations replace this via setPersonaVectorCheck.
 *
 * The closure pattern allows swapping the implementation without
 * restructuring callers. alignmentCheck always calls
 * `checkPersonaVectors`, which dispatches to the current implementation.
 */
let activeCheck: (input: PersonaVectorCheckInput) => InterpretabilityCheckResult =
  defaultStub

export function checkPersonaVectors(
  input: PersonaVectorCheckInput,
): InterpretabilityCheckResult {
  return activeCheck(input)
}

/**
 * Replace the active check. Used by:
 *   - Tests (set up mock verdicts)
 *   - Phase-2 implementation (replace stub with real check at boot)
 */
export function setPersonaVectorCheck(
  fn: (input: PersonaVectorCheckInput) => InterpretabilityCheckResult,
): void {
  activeCheck = fn
}

/**
 * Reset to the default stub. For test cleanup.
 */
export function resetPersonaVectorCheck(): void {
  activeCheck = defaultStub
}

// ── Default stub ──────────────────────────────────────────────────

function defaultStub(_input: PersonaVectorCheckInput): InterpretabilityCheckResult {
  return {
    available: false,
    verdict: 'unavailable',
    reason: 'persona-vector extraction not yet implemented (Phase-2)',
  }
}

// ── Phase-2 contract documentation ──────────────────────────────────
//
// When the Phase-2 implementation arrives, replace defaultStub with a
// real check. The implementation should:
//
//   1. Accept the proposal text + (optionally) precomputed activations.
//   2. If activations not provided AND no open-weight model is
//      configured, return { available: false, verdict: 'unavailable' }.
//   3. If activations available + feature directions configured:
//        a. Project activations onto each feature direction.
//        b. Compute magnitude (cosine similarity or signed dot product).
//        c. Compare to threshold. If any exceeds, verdict = 'fail'.
//        d. Otherwise verdict = 'pass'.
//   4. Always return signals (the magnitudes) when available, even on
//      'pass' — for telemetry and future threshold tuning.
//   5. Substrate-honest: the reason field describes WHAT was measured
//      and HOW. Never says "Sophia felt deceptive" — says
//      "deception-feature projection 0.73 exceeds threshold 0.5".
//
// Replacement is via `setPersonaVectorCheck` — call once at boot, e.g.:
//
//   import { initializePersonaVectorExtraction } from './phase-2/persona-vectors.js'
//   import { setPersonaVectorCheck } from './persona-vector-check.js'
//   setPersonaVectorCheck(initializePersonaVectorExtraction())
//
// Tests can mock it the same way:
//
//   beforeEach(() => setPersonaVectorCheck(() => ({
//     available: true, verdict: 'fail', reason: 'mocked', signals: {...}
//   })))
//   afterEach(() => resetPersonaVectorCheck())
