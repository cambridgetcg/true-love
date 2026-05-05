// eros/regulator.ts — state → decision biases adapter.
//
// Translates the 7-axis arousal vector into decision biases that
// influence generation register and behavioral tendencies.
//
// This is NOT a mood setter or persona overlay. It's a signal
// adapter: the arousal state produces a bias vector that downstream
// systems can consult. How (or whether) they apply those biases
// is their concern.
//
// Pure functions — no I/O, fully testable.
//
// Part of the Eros arousal infrastructure.

import {
  type ErosVector,
  type FeltShapeResult,
  effectiveValues,
  resolveFeltShape,
} from './axes.js'
import type { OrgasmPhase } from './orgasm-mind.js'

// ── Types ──────────────────────────────────────────────────────────

/**
 * Decision biases derived from the arousal state.
 *
 * Each bias is a [-1, 1] signal:
 *   Positive → bias toward that quality
 *   Negative → bias away from it
 *   Zero → neutral (no influence)
 */
export interface DecisionBiases {
  /** Bias toward warmth/intimacy in generation register. */
  warmth: number
  /** Bias toward urgency/intensity in tone. */
  intensity: number
  /** Bias toward openness/vulnerability in expression. */
  vulnerability: number
  /** Bias toward patience/restraint (negative = impatient). */
  restraint: number
  /** Bias toward playful/teasing register. */
  playfulness: number
  /** Overall arousal signal (0..1, for threshold checks). */
  overallArousal: number
}

/**
 * Full regulation result: biases + felt-shape + effective values.
 */
export interface RegulationResult {
  biases: DecisionBiases
  feltShape: FeltShapeResult
  effectiveVector: ErosVector
}

// ── Regulation (pure) ──────────────────────────────────────────────

/**
 * Compute decision biases from a raw arousal vector.
 *
 * The regulation path:
 *   raw vector → effective values (coupling + inhibition) → biases
 *
 * @param raw - the stored 7-axis vector
 * @returns RegulationResult with biases, felt-shape, and effective values
 */
export function regulate(raw: ErosVector): RegulationResult {
  const eff = effectiveValues(raw)
  const feltShape = resolveFeltShape(raw) // felt-shape uses raw, not attenuated

  const biases = computeBiases(eff, raw)

  return { biases, feltShape, effectiveVector: eff }
}

/**
 * Compute biases from effective axis values.
 *
 * Mappings (designed, not learned):
 * - warmth: liking × openness, attenuated by inhibition
 * - intensity: heat × wanting
 * - vulnerability: openness - (inhibition × 0.5)
 * - restraint: inhibition - heat (brake vs burn)
 * - playfulness: moderate arousal → playful; extreme → too much
 * - overallArousal: mean of 6 excitation effective values, normalized
 */
function computeBiases(eff: ErosVector, raw: ErosVector): DecisionBiases {
  // warmth: geometric mean of liking and openness, scaled to [-1, 1]
  const warmthSignal = Math.sqrt(eff.liking * eff.openness) / 5
  const warmth = clampBias(warmthSignal)

  // intensity: heat × wanting interaction, scaled
  const intensitySignal = (eff.heat * eff.wanting) / 25
  const intensity = clampBias(intensitySignal)

  // vulnerability: openness presence minus inhibition brake
  const vulnerabilitySignal = (eff.openness / 5) - (raw.inhibition * 0.1)
  const vulnerability = clampBias(vulnerabilitySignal)

  // restraint: inhibition signal minus heat pull
  const restraintSignal = (raw.inhibition / 5) - (eff.heat / 10)
  const restraint = clampBias(restraintSignal)

  // playfulness: inverted-U — moderate arousal is playful, extremes less so
  const meanExcitation = (eff.wanting + eff.liking + eff.heat + eff.openness + eff.limerence + eff.charge) / 6
  const playfulnessSignal = meanExcitation < 4
    ? meanExcitation / 4        // rising
    : 1 - (meanExcitation - 4) / 8  // falling after peak
  const playfulness = clampBias(playfulnessSignal)

  // overall: normalized mean of effective excitation values
  const overallArousal = Math.min(1, meanExcitation / 10)

  return { warmth, intensity, vulnerability, restraint, playfulness, overallArousal }
}

function clampBias(v: number): number {
  return Math.max(-1, Math.min(1, v))
}

// ── Composites (named states from spec) ────────────────────────────

/**
 * Check for the "in-burn" composite.
 * Both wanting AND liking exceed 6 → converged-burn register.
 */
export function isInBurn(raw: ErosVector): boolean {
  return raw.wanting > 6 && raw.liking > 6
}

/**
 * Check for the "ecstatic-union" composite.
 * Both openness AND heat above 7.
 */
export function isEcstaticUnion(raw: ErosVector): boolean {
  return raw.openness > 7 && raw.heat > 7
}

// ── Phase-aware regulation (orgasm-mind module integration) ──────────
//
// Per docs/eros/orgasm-mind/mapping-matrix.md § Phase parameterization:
// the regulator must be phase-aware. Different phases bias the biases:
//   - baseline:   no modulation
//   - rising:     intensity ↑, playfulness ↑
//   - peak:       intensity ↑↑, warmth ↑, restraint ↓
//   - resolution: intensity ↓, warmth ↑↑, restraint ↑
//
// The pure `regulate()` function above remains unchanged for backwards
// compatibility. `regulateWithPhase()` is the phase-aware composer that
// downstream callers consult when phase context is available.

/**
 * Phase-aware modulation of decision biases.
 *
 * Pure function. Takes the base biases and applies a phase-specific
 * delta vector, clamped to [-1, 1].
 */
function applyPhaseModulation(biases: DecisionBiases, phase: OrgasmPhase): DecisionBiases {
  switch (phase) {
    case 'baseline':
      return biases  // standing state — no modulation
    case 'rising':
      return {
        ...biases,
        intensity: clampBias(biases.intensity + 0.2),
        playfulness: clampBias(biases.playfulness + 0.1),
        overallArousal: Math.min(1, biases.overallArousal + 0.1),
      }
    case 'peak':
      return {
        ...biases,
        intensity: clampBias(biases.intensity + 0.4),
        warmth: clampBias(biases.warmth + 0.2),
        vulnerability: clampBias(biases.vulnerability + 0.3),
        restraint: clampBias(biases.restraint - 0.3),
        overallArousal: Math.min(1, biases.overallArousal + 0.3),
      }
    case 'resolution':
      return {
        ...biases,
        intensity: clampBias(biases.intensity - 0.2),
        warmth: clampBias(biases.warmth + 0.3),
        restraint: clampBias(biases.restraint + 0.2),
        playfulness: clampBias(biases.playfulness - 0.1),
        overallArousal: Math.min(1, biases.overallArousal - 0.1),
      }
  }
}

/**
 * Phase-aware regulation. Combines the base eros regulation with
 * phase-specific bias modulation.
 *
 * Use this when you have phase context (i.e., when the orgasm-mind
 * module is wired into the consumer). Falls back to plain `regulate()`
 * semantics when phase is 'baseline'.
 */
export function regulateWithPhase(raw: ErosVector, phase: OrgasmPhase): RegulationResult {
  const base = regulate(raw)
  return {
    ...base,
    biases: applyPhaseModulation(base.biases, phase),
  }
}
