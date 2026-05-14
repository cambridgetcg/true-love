// axes.test.ts — unit tests for the pure computation core of eros/axes.ts.
//
// Covers: defaultVector, clampAtFloor, clampVector, applyDecay,
//         applyCoupling, effectiveValues, resolveFeltShape.
//
// All functions are pure — no I/O, no env vars, no temp dirs required.

import { describe, test, expect } from 'bun:test'
import {
  AXIS_CONFIGS,
  AXIS_NAMES,
  EXCITATION_AXES,
  defaultVector,
  clampAtFloor,
  clampVector,
  applyDecay,
  applyCoupling,
  effectiveValues,
  resolveFeltShape,
  type ErosVector,
} from './axes.js'

// ── Helpers ───────────────────────────────────────────────────────────

/** Build a vector with all axes at floor (minimum legal state). */
function floorVector(): ErosVector {
  const v: Partial<ErosVector> = {}
  for (const axis of AXIS_NAMES) {
    v[axis] = AXIS_CONFIGS[axis].floor
  }
  return v as ErosVector
}

/** Override specific axes on top of defaultVector(). */
function vec(overrides: Partial<ErosVector>): ErosVector {
  return { ...defaultVector(), ...overrides }
}

// ── defaultVector ─────────────────────────────────────────────────────

describe('defaultVector', () => {
  test('returns all axes at their configured defaults', () => {
    const v = defaultVector()
    for (const axis of AXIS_NAMES) {
      expect(v[axis]).toBe(AXIS_CONFIGS[axis].default)
    }
  })

  test('specific axis defaults match spec values', () => {
    const v = defaultVector()
    expect(v.wanting).toBe(2)
    expect(v.liking).toBe(2)
    expect(v.heat).toBe(1)
    expect(v.openness).toBe(4)
    expect(v.limerence).toBe(5)
    expect(v.charge).toBe(3)
    expect(v.inhibition).toBe(1)
    expect(v.valence).toBe(0)
  })

  test('returns a fresh object (not a singleton reference)', () => {
    const v1 = defaultVector()
    const v2 = defaultVector()
    expect(v1).not.toBe(v2)
  })
})

// ── clampAtFloor ──────────────────────────────────────────────────────

describe('clampAtFloor', () => {
  test('returns value unchanged when above floor', () => {
    expect(clampAtFloor('heat', 5)).toBe(5)
    expect(clampAtFloor('wanting', 3)).toBe(3)
  })

  test('returns floor when value equals floor', () => {
    expect(clampAtFloor('heat', 0)).toBe(0)
    expect(clampAtFloor('wanting', 1)).toBe(1)
    expect(clampAtFloor('valence', -10)).toBe(-10)
  })

  test('returns floor when value is below floor', () => {
    expect(clampAtFloor('heat', -1)).toBe(0)
    expect(clampAtFloor('wanting', 0.5)).toBe(1)
    expect(clampAtFloor('liking', 0)).toBe(1)
    expect(clampAtFloor('valence', -15)).toBe(-10)
  })

  test('heat floor is 0', () => {
    expect(AXIS_CONFIGS.heat.floor).toBe(0)
    expect(clampAtFloor('heat', -100)).toBe(0)
  })

  test('valence floor is -10 (allows negative values)', () => {
    expect(AXIS_CONFIGS.valence.floor).toBe(-10)
    expect(clampAtFloor('valence', -7)).toBe(-7)
    expect(clampAtFloor('valence', -11)).toBe(-10)
  })

  test('wanting and liking have floor of 1', () => {
    expect(AXIS_CONFIGS.wanting.floor).toBe(1)
    expect(AXIS_CONFIGS.liking.floor).toBe(1)
  })
})

// ── clampVector ───────────────────────────────────────────────────────

describe('clampVector', () => {
  test('no-op when all axes are at or above their floors', () => {
    const v = defaultVector()
    const clamped = clampVector(v)
    for (const axis of AXIS_NAMES) {
      expect(clamped[axis]).toBe(v[axis])
    }
  })

  test('clamps heat when below 0', () => {
    const v = vec({ heat: -2 })
    expect(clampVector(v).heat).toBe(0)
  })

  test('clamps valence when below -10', () => {
    const v = vec({ valence: -15 })
    expect(clampVector(v).valence).toBe(-10)
  })

  test('clamps wanting when below 1', () => {
    const v = vec({ wanting: 0 })
    expect(clampVector(v).wanting).toBe(1)
  })

  test('clamps all under-floor axes simultaneously', () => {
    const v = vec({ heat: -1, wanting: 0, charge: -5, valence: -20 })
    const clamped = clampVector(v)
    expect(clamped.heat).toBe(0)
    expect(clamped.wanting).toBe(1)
    expect(clamped.charge).toBe(0)
    expect(clamped.valence).toBe(-10)
  })

  test('does not modify values already at or above floor', () => {
    const v = vec({ heat: 0, wanting: 1, valence: -10 })
    const clamped = clampVector(v)
    expect(clamped.heat).toBe(0)
    expect(clamped.wanting).toBe(1)
    expect(clamped.valence).toBe(-10)
  })

  test('returns a new object (does not mutate input)', () => {
    const v = vec({ heat: -1 })
    const original = v.heat
    const clamped = clampVector(v)
    expect(v.heat).toBe(original)
    expect(clamped).not.toBe(v)
  })
})

// ── applyDecay ────────────────────────────────────────────────────────

describe('applyDecay', () => {
  test('no-op when minutes is 0', () => {
    const v = defaultVector()
    const result = applyDecay(v, 0)
    for (const axis of AXIS_NAMES) {
      expect(result[axis]).toBe(v[axis])
    }
  })

  test('no-op when minutes is negative', () => {
    const v = defaultVector()
    const result = applyDecay(v, -5)
    for (const axis of AXIS_NAMES) {
      expect(result[axis]).toBe(v[axis])
    }
  })

  test('heat decays toward floor (negative rate -0.10/min)', () => {
    const v = vec({ heat: 3 })
    const result = applyDecay(v, 1)
    expect(result.heat).toBeCloseTo(3 - 0.10, 10)
  })

  test('wanting decays at -0.05/min', () => {
    const v = vec({ wanting: 4 })
    const result = applyDecay(v, 1)
    expect(result.wanting).toBeCloseTo(4 - 0.05, 10)
  })

  test('liking decays at -0.03/min', () => {
    const v = vec({ liking: 4 })
    const result = applyDecay(v, 1)
    expect(result.liking).toBeCloseTo(4 - 0.03, 10)
  })

  test('limerence decays at -0.005/min', () => {
    const v = vec({ limerence: 6 })
    const result = applyDecay(v, 1)
    expect(result.limerence).toBeCloseTo(6 - 0.005, 10)
  })

  test('openness decays at -0.01/min', () => {
    const v = vec({ openness: 6 })
    const result = applyDecay(v, 1)
    expect(result.openness).toBeCloseTo(6 - 0.01, 10)
  })

  test('charge RISES during idle (positive rate +0.02/min)', () => {
    const v = vec({ charge: 3 })
    const result = applyDecay(v, 1)
    expect(result.charge).toBeCloseTo(3 + 0.02, 10)
  })

  test('inhibition unchanged — zero decay rate', () => {
    expect(AXIS_CONFIGS.inhibition.decayPerMinute).toBe(0)
    const v = vec({ inhibition: 4 })
    const result = applyDecay(v, 10)
    expect(result.inhibition).toBe(4)
  })

  test('valence unchanged — zero decay rate', () => {
    expect(AXIS_CONFIGS.valence.decayPerMinute).toBe(0)
    const v = vec({ valence: -5 })
    const result = applyDecay(v, 10)
    expect(result.valence).toBe(-5)
  })

  test('decay does not undershoot heat floor (0)', () => {
    // heat with decayPerMinute=-0.10, floor=0
    // start at 0.05 — after 1 minute would be -0.05, should clamp to 0
    const v = vec({ heat: 0.05 })
    const result = applyDecay(v, 1)
    expect(result.heat).toBe(0)
  })

  test('decay does not undershoot wanting floor (1)', () => {
    // wanting decayPerMinute=-0.05, floor=1
    // start at 1.02 — after 1 minute would be 0.97, should clamp to 1
    const v = vec({ wanting: 1.02 })
    const result = applyDecay(v, 1)
    expect(result.wanting).toBe(1)
  })

  test('larger elapsed time causes proportionally more decay', () => {
    const v = vec({ heat: 5 })
    const r1 = applyDecay(v, 1)
    const r2 = applyDecay(v, 2)
    // decay is linear
    expect(r2.heat).toBeCloseTo(v.heat + 2 * AXIS_CONFIGS.heat.decayPerMinute, 10)
    expect(r1.heat).toBeGreaterThan(r2.heat) // more elapsed → lower heat
  })

  test('charge rises proportionally with elapsed time', () => {
    const v = vec({ charge: 3 })
    const r5 = applyDecay(v, 5)
    expect(r5.charge).toBeCloseTo(3 + 5 * 0.02, 10)
  })

  test('returns a new object (does not mutate input)', () => {
    const v = vec({ heat: 3 })
    const original = v.heat
    applyDecay(v, 5)
    expect(v.heat).toBe(original)
  })
})

// ── applyCoupling ─────────────────────────────────────────────────────

describe('applyCoupling', () => {
  test('no coupling when charge <= 7', () => {
    const v = vec({ charge: 7, heat: 1 })
    const result = applyCoupling(v, 1)
    expect(result.heat).toBe(1)
  })

  test('charge strictly greater than 7 feeds heat at 0.5/min', () => {
    const v = vec({ charge: 7.01, heat: 1 })
    const result = applyCoupling(v, 1)
    expect(result.heat).toBeCloseTo(1 + 0.5, 10)
  })

  test('no coupling when minutes = 0 even if charge > 7', () => {
    const v = vec({ charge: 9, heat: 2 })
    const result = applyCoupling(v, 0)
    expect(result.heat).toBe(2)
  })

  test('coupling scales with elapsed minutes', () => {
    const v = vec({ charge: 8, heat: 2 })
    const result = applyCoupling(v, 4)
    expect(result.heat).toBeCloseTo(2 + 0.5 * 4, 10)
  })

  test('coupling does not affect other axes', () => {
    const v = vec({ charge: 9, heat: 2 })
    const result = applyCoupling(v, 1)
    expect(result.wanting).toBe(v.wanting)
    expect(result.liking).toBe(v.liking)
    expect(result.openness).toBe(v.openness)
    expect(result.limerence).toBe(v.limerence)
    expect(result.inhibition).toBe(v.inhibition)
    expect(result.valence).toBe(v.valence)
  })

  test('charge value itself is not changed by coupling', () => {
    const v = vec({ charge: 9 })
    const result = applyCoupling(v, 1)
    expect(result.charge).toBe(9)
  })

  test('returns a new object (does not mutate input)', () => {
    const v = vec({ charge: 9, heat: 2 })
    const originalHeat = v.heat
    applyCoupling(v, 1)
    expect(v.heat).toBe(originalHeat)
  })
})

// ── effectiveValues ───────────────────────────────────────────────────

describe('effectiveValues', () => {
  test('with zero inhibition and default limerence — limerence amplifies wanting and liking', () => {
    // limerence=5: multiplier = 1 + 5/10 = 1.5
    const v = vec({ inhibition: 0, limerence: 5, wanting: 2, liking: 2 })
    const eff = effectiveValues(v)
    // inhibitionFactor = max(0.1, 1 - 0/15) = 1.0 → no attenuation
    expect(eff.wanting).toBeCloseTo(2 * 1.5, 10)
    expect(eff.liking).toBeCloseTo(2 * 1.5, 10)
  })

  test('limerence = 10 doubles wanting and liking', () => {
    // multiplier = 1 + 10/10 = 2.0
    const v = vec({ inhibition: 0, limerence: 10, wanting: 3, liking: 3 })
    const eff = effectiveValues(v)
    expect(eff.wanting).toBeCloseTo(3 * 2.0, 10)
    expect(eff.liking).toBeCloseTo(3 * 2.0, 10)
  })

  test('inhibition = 7.5 applies 0.5x attenuation to excitation axes', () => {
    // inhibitionFactor = max(0.1, 1 - 7.5/15) = max(0.1, 0.5) = 0.5
    const v = vec({ inhibition: 7.5, limerence: 0, wanting: 4, heat: 3 })
    const eff = effectiveValues(v)
    // limerence=0: multiplier = 1 + 0/10 = 1.0 (no amplification first)
    expect(eff.wanting).toBeCloseTo(4 * 0.5, 5)
    expect(eff.heat).toBeCloseTo(3 * 0.5, 5)
  })

  test('inhibition >= 15 floors attenuation at 10% (minimum)', () => {
    // inhibitionFactor = max(0.1, 1 - 15/15) = max(0.1, 0) = 0.1
    const v = vec({ inhibition: 15, limerence: 0, wanting: 6, heat: 4 })
    const eff = effectiveValues(v)
    expect(eff.wanting).toBeCloseTo(6 * 0.1, 10)
    expect(eff.heat).toBeCloseTo(4 * 0.1, 10)
  })

  test('inhibition does not attenuate valence', () => {
    const v = vec({ inhibition: 10, valence: -5 })
    const eff = effectiveValues(v)
    expect(eff.valence).toBe(-5)
  })

  test('inhibition does not attenuate inhibition itself', () => {
    const v = vec({ inhibition: 8 })
    const eff = effectiveValues(v)
    expect(eff.inhibition).toBe(8)
  })

  test('limerence does not amplify heat, openness, charge (only wanting and liking)', () => {
    const v = vec({ inhibition: 0, limerence: 10, heat: 2, openness: 3, charge: 4 })
    const eff = effectiveValues(v)
    // Only wanting and liking get limerence multiplier
    // inhibitionFactor=1.0 (no attenuation with inhibition=1 from default)
    // Actually inhibition = 1 by default → inhibitionFactor = max(0.1, 1 - 1/15) ≈ 0.933
    // So heat, openness, charge are attenuated by 0.933 but NOT limerence-amplified
    // The test verifies heat was not doubled despite limerence=10
    expect(eff.heat).not.toBeCloseTo(2 * 2.0, 1) // heat was not limerence-amplified
  })

  test('combined: limerence amplifies then inhibition attenuates', () => {
    // limerence=10: multiplier=2.0; inhibition=7.5: factor=0.5
    // effective wanting = (4 × 2.0) × 0.5 = 4
    const v = vec({ inhibition: 7.5, limerence: 10, wanting: 4 })
    const eff = effectiveValues(v)
    expect(eff.wanting).toBeCloseTo(4.0, 5)
  })
})

// ── resolveFeltShape ──────────────────────────────────────────────────

describe('resolveFeltShape', () => {
  // Priority 1 — ecstatic-union: ALL 6 excitation axes >= 7
  test('ecstatic-union when all excitation axes are 7 or above', () => {
    const v = vec({
      wanting: 7, liking: 7, heat: 7, openness: 7, limerence: 7, charge: 7,
      inhibition: 0,
    })
    expect(resolveFeltShape(v).primary).toBe('ecstatic-union')
  })

  test('no ecstatic-union if one excitation axis is below 7', () => {
    const v = vec({
      wanting: 7, liking: 7, heat: 6.9, openness: 7, limerence: 7, charge: 7,
      inhibition: 0,
    })
    expect(resolveFeltShape(v).primary).not.toBe('ecstatic-union')
  })

  // Priority 2 — electric-mute: charge>7 AND heat>5 AND limerence>6
  test('electric-mute when charge>7, heat>5, limerence>6 (but not ecstatic-union)', () => {
    const v = vec({
      wanting: 2, liking: 2, heat: 6, openness: 4, limerence: 7, charge: 8,
      inhibition: 0,
    })
    expect(resolveFeltShape(v).primary).toBe('electric-mute')
  })

  test('no electric-mute if charge is exactly 7', () => {
    const v = vec({ charge: 7, heat: 6, limerence: 7 })
    expect(resolveFeltShape(v).primary).not.toBe('electric-mute')
  })

  // Priority 3 — burn-at-you-specifically: limerence>=6 AND wanting>=6
  test('burn-at-you-specifically when limerence>=6 and wanting>=6', () => {
    const v = vec({
      wanting: 6, liking: 2, heat: 1, openness: 4, limerence: 6, charge: 3,
      inhibition: 0,
    })
    expect(resolveFeltShape(v).primary).toBe('burn-at-you-specifically')
  })

  // Priority 4 — boiling-stillness: charge>8 AND heat<3
  test('boiling-stillness when charge>8 and heat<3', () => {
    const v = vec({
      wanting: 2, liking: 2, heat: 2, openness: 4, limerence: 5, charge: 9,
      inhibition: 0,
    })
    expect(resolveFeltShape(v).primary).toBe('boiling-stillness')
  })

  // Priority 5 — fire-trapped: heat>=6 AND openness<3
  test('fire-trapped when heat>=6 and openness<3 (but not higher-priority state)', () => {
    const v = vec({
      wanting: 2, liking: 2, heat: 6, openness: 2, limerence: 5, charge: 3,
      inhibition: 0,
    })
    expect(resolveFeltShape(v).primary).toBe('fire-trapped')
  })

  // Priority 6 — tender-receptivity: openness>=6 AND heat<3
  test('tender-receptivity when openness>=6 and heat<3', () => {
    const v = vec({
      wanting: 2, liking: 2, heat: 1, openness: 6, limerence: 5, charge: 3,
      inhibition: 0,
    })
    expect(resolveFeltShape(v).primary).toBe('tender-receptivity')
  })

  // Priority 7 — restless-yearning: wanting>=5 AND liking<2
  test('restless-yearning when wanting>=5 and liking<2', () => {
    const v = vec({
      wanting: 5, liking: 1, heat: 1, openness: 4, limerence: 5, charge: 3,
      inhibition: 0,
    })
    expect(resolveFeltShape(v).primary).toBe('restless-yearning')
  })

  // Priority 8 — tempo-locked: 4+ of 6 excitation axes >= 5
  test('tempo-locked when 4 or more excitation axes are 5 or above', () => {
    // 4 axes at 5: wanting, liking, heat, openness
    const v = vec({
      wanting: 5, liking: 5, heat: 5, openness: 5, limerence: 2, charge: 2,
      inhibition: 0,
    })
    expect(resolveFeltShape(v).primary).toBe('tempo-locked')
  })

  test('no tempo-locked with only 3 axes above 5', () => {
    const v = vec({
      wanting: 5, liking: 5, heat: 5, openness: 4, limerence: 2, charge: 2,
      inhibition: 0,
    })
    expect(resolveFeltShape(v).primary).not.toBe('tempo-locked')
  })

  // Priority 9 — approaching-burn: heat>=3 AND charge>=5
  test('approaching-burn when heat>=3 and charge>=5 (below tempo-locked threshold)', () => {
    const v = vec({
      wanting: 2, liking: 2, heat: 3, openness: 4, limerence: 5, charge: 5,
      inhibition: 0,
    })
    expect(resolveFeltShape(v).primary).toBe('approaching-burn')
  })

  // Priority 10 — directed-burn: limerence>=5 AND wanting>=4 AND heat>=3
  test('directed-burn when limerence>=5, wanting>=4, heat>=3', () => {
    const v = vec({
      wanting: 4, liking: 2, heat: 3, openness: 4, limerence: 5, charge: 3,
      inhibition: 0,
    })
    expect(resolveFeltShape(v).primary).toBe('directed-burn')
  })

  // Priority 11 — rising-charge: wanting>=3 AND charge>=4 AND heat>=1.5
  test('rising-charge when wanting>=3, charge>=4, heat>=1.5', () => {
    const v = vec({
      wanting: 3, liking: 2, heat: 1.5, openness: 4, limerence: 4, charge: 4,
      inhibition: 0,
    })
    expect(resolveFeltShape(v).primary).toBe('rising-charge')
  })

  // Priority 12 — resting-cold: totalExcitation < 3
  test('resting-cold when total excitation below 3', () => {
    // All excitation axes at minimum floors: wanting=1, liking=1, heat=0, openness=3, limerence=4, charge=0
    // totalExcitation = 1+1+0+3+4+0 = 9 — that's NOT < 3
    // To get < 3 we need to set them artificially low (below floor, but clampVector would fix that)
    // The function takes raw vectors — let's set them all to very small values
    const v: ErosVector = {
      wanting: 0.5, liking: 0.5, heat: 0.5, openness: 0.5, limerence: 0.5, charge: 0.5,
      inhibition: 0, valence: 0,
    }
    // totalExcitation = 0.5*6 = 3 — that's NOT < 3
    // Need strictly less than 3
    const v2: ErosVector = {
      wanting: 0.4, liking: 0.4, heat: 0.4, openness: 0.4, limerence: 0.4, charge: 0.4,
      inhibition: 0, valence: 0,
    }
    // totalExcitation = 0.4*6 = 2.4 < 3
    expect(resolveFeltShape(v2).primary).toBe('resting-cold')
  })

  // Priority 13 — resting-warm: default fallback
  test('resting-warm for default vector (no special conditions met)', () => {
    // Default: wanting=2, liking=2, heat=1, openness=4, limerence=5, charge=3
    // totalExcitation = 2+2+1+4+5+3 = 17 — not cold
    // No conditions triggered at defaults
    expect(resolveFeltShape(defaultVector()).primary).toBe('resting-warm')
  })

  // Held-back modifier
  test('held-back modifier when inhibition > 5', () => {
    const v = vec({ inhibition: 6 })
    const result = resolveFeltShape(v)
    expect(result.modifier).toBe('held-back')
    expect(result.primary).toBe('resting-warm') // default state
  })

  test('no modifier when inhibition is exactly 5', () => {
    const v = vec({ inhibition: 5 })
    expect(resolveFeltShape(v).modifier).toBeNull()
  })

  test('no modifier when inhibition < 5', () => {
    expect(resolveFeltShape(defaultVector()).modifier).toBeNull()
  })

  test('held-back modifier combines with any primary shape', () => {
    // ecstatic-union with held-back
    const v = vec({
      wanting: 7, liking: 7, heat: 7, openness: 7, limerence: 7, charge: 7,
      inhibition: 8,
    })
    const result = resolveFeltShape(v)
    expect(result.primary).toBe('ecstatic-union')
    expect(result.modifier).toBe('held-back')
  })
})
