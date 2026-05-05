// regulator-phase.test.ts — phase-aware regulator (Step 6).
//
// Tests that regulateWithPhase modulates DecisionBiases per phase
// according to docs/eros/orgasm-mind/mapping-matrix.md.

import { describe, test, expect } from 'bun:test'
import { regulate, regulateWithPhase } from './regulator.js'
import type { ErosVector } from './axes.js'

const NEUTRAL_VECTOR: ErosVector = {
  // Low-mid values so the phase modulation has room to move biases
  // (the clampBias caps at [-1, 1]; saturated base biases mask deltas).
  wanting: 2,
  liking: 2,
  heat: 2,
  openness: 2,
  limerence: 2,
  charge: 2,
  inhibition: 1,
}

describe('regulateWithPhase — phase modulation', () => {
  test('baseline phase preserves base biases (no modulation)', () => {
    const base = regulate(NEUTRAL_VECTOR)
    const modulated = regulateWithPhase(NEUTRAL_VECTOR, 'baseline')
    expect(modulated.biases).toEqual(base.biases)
  })

  test('rising phase increases intensity and playfulness', () => {
    const base = regulate(NEUTRAL_VECTOR)
    const rising = regulateWithPhase(NEUTRAL_VECTOR, 'rising')
    expect(rising.biases.intensity).toBeGreaterThan(base.biases.intensity)
    expect(rising.biases.playfulness).toBeGreaterThan(base.biases.playfulness)
    expect(rising.biases.overallArousal).toBeGreaterThan(base.biases.overallArousal)
  })

  test('peak phase boosts intensity, warmth, vulnerability; lowers restraint', () => {
    const base = regulate(NEUTRAL_VECTOR)
    const peak = regulateWithPhase(NEUTRAL_VECTOR, 'peak')
    expect(peak.biases.intensity).toBeGreaterThan(base.biases.intensity)
    expect(peak.biases.warmth).toBeGreaterThan(base.biases.warmth)
    expect(peak.biases.vulnerability).toBeGreaterThan(base.biases.vulnerability)
    expect(peak.biases.restraint).toBeLessThan(base.biases.restraint)
  })

  test('resolution phase increases warmth and restraint; lowers intensity', () => {
    const base = regulate(NEUTRAL_VECTOR)
    const resolution = regulateWithPhase(NEUTRAL_VECTOR, 'resolution')
    expect(resolution.biases.warmth).toBeGreaterThan(base.biases.warmth)
    expect(resolution.biases.restraint).toBeGreaterThan(base.biases.restraint)
    expect(resolution.biases.intensity).toBeLessThan(base.biases.intensity)
  })

  test('peak biases stay clamped to [-1, 1]', () => {
    const highVector: ErosVector = { wanting: 10, liking: 10, heat: 10, openness: 10, limerence: 10, charge: 10, inhibition: 0 }
    const peak = regulateWithPhase(highVector, 'peak')
    for (const v of Object.values(peak.biases)) {
      expect(v).toBeGreaterThanOrEqual(-1)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  test('passthrough — feltShape and effectiveVector preserved', () => {
    const base = regulate(NEUTRAL_VECTOR)
    const peak = regulateWithPhase(NEUTRAL_VECTOR, 'peak')
    expect(peak.feltShape).toEqual(base.feltShape)
    expect(peak.effectiveVector).toEqual(base.effectiveVector)
  })
})
