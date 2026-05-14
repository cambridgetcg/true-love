// regulator.test.ts
//
// Pure unit tests for regulator.ts — zero I/O, zero mocking required.
// Module self-declares: "Pure functions — no I/O, fully testable."
//
// Exports covered:
//   regulate, regulateWithPhase, isInBurn, isEcstaticUnion

import { describe, it, expect } from 'bun:test'
import { regulate, regulateWithPhase, isInBurn, isEcstaticUnion } from './regulator.js'
import { defaultVector } from './axes.js'
import type { ErosVector } from './axes.js'
import type { OrgasmPhase } from './orgasm-mind.js'

// ── Helpers ──────────────────────────────────────────────────────

/** All 8 axes at 0 — truly neutral test base. */
function zero(overrides: Partial<ErosVector> = {}): ErosVector {
  return {
    wanting: 0, liking: 0, heat: 0, openness: 0,
    limerence: 0, charge: 0, inhibition: 0, valence: 0,
    ...overrides,
  }
}

/** Convenience wrapper using defaultVector() as base — for realistic vectors. */
function vec(overrides: Partial<ErosVector> = {}): ErosVector {
  return { ...defaultVector(), ...overrides }
}

// ── regulate ─────────────────────────────────────────────────────

describe('regulate', () => {
  describe('result shape', () => {
    it('returns biases, feltShape, and effectiveVector', () => {
      const result = regulate(zero())
      expect(result).toHaveProperty('biases')
      expect(result).toHaveProperty('feltShape')
      expect(result).toHaveProperty('effectiveVector')
    })

    it('biases contains all six fields', () => {
      const { biases } = regulate(zero())
      expect(biases).toHaveProperty('warmth')
      expect(biases).toHaveProperty('intensity')
      expect(biases).toHaveProperty('vulnerability')
      expect(biases).toHaveProperty('restraint')
      expect(biases).toHaveProperty('playfulness')
      expect(biases).toHaveProperty('overallArousal')
    })

    it('all biases are in [-1, 1] range for zero vector', () => {
      const { biases } = regulate(zero())
      for (const [, v] of Object.entries(biases)) {
        expect(v).toBeGreaterThanOrEqual(-1)
        expect(v).toBeLessThanOrEqual(1)
      }
    })
  })

  describe('zero vector (all axes explicitly 0)', () => {
    it('overallArousal is 0', () => {
      const { biases } = regulate(zero())
      expect(biases.overallArousal).toBe(0)
    })

    it('warmth is 0 (sqrt(0*0)/5 = 0)', () => {
      const { biases } = regulate(zero())
      expect(biases.warmth).toBe(0)
    })

    it('intensity is 0 (heat × wanting = 0)', () => {
      const { biases } = regulate(zero())
      expect(biases.intensity).toBe(0)
    })

    it('vulnerability is 0 (openness=0, inhibition=0)', () => {
      const { biases } = regulate(zero())
      expect(biases.vulnerability).toBe(0)
    })

    it('restraint is 0 (inhibition=0, heat=0)', () => {
      const { biases } = regulate(zero())
      expect(biases.restraint).toBe(0)
    })
  })

  describe('intensity bias', () => {
    it('increases with heat and wanting', () => {
      const low = regulate(vec({ heat: 1, wanting: 1 }))
      const high = regulate(vec({ heat: 8, wanting: 8 }))
      expect(high.biases.intensity).toBeGreaterThan(low.biases.intensity)
    })

    it('clamps to 1 for extreme values', () => {
      const { biases } = regulate(vec({ heat: 10, wanting: 10 }))
      expect(biases.intensity).toBeLessThanOrEqual(1)
    })

    it('is 0 when heat is 0 regardless of wanting', () => {
      // heat × wanting = 0 × anything = 0
      const { biases } = regulate(vec({ heat: 0, wanting: 10 }))
      expect(biases.intensity).toBe(0)
    })
  })

  describe('warmth bias', () => {
    it('increases with liking and openness', () => {
      const low = regulate(vec({ liking: 1, openness: 1 }))
      const high = regulate(vec({ liking: 8, openness: 8 }))
      expect(high.biases.warmth).toBeGreaterThan(low.biases.warmth)
    })

    it('is 0 when either liking or openness is 0', () => {
      // geometric mean: sqrt(0 × n) = 0
      const a = regulate(vec({ liking: 0, openness: 8 }))
      const b = regulate(vec({ liking: 8, openness: 0 }))
      expect(a.biases.warmth).toBe(0)
      expect(b.biases.warmth).toBe(0)
    })
  })

  describe('vulnerability bias', () => {
    it('increases with openness', () => {
      const low = regulate(vec({ openness: 1 }))
      const high = regulate(vec({ openness: 8 }))
      expect(high.biases.vulnerability).toBeGreaterThan(low.biases.vulnerability)
    })

    it('is reduced by high inhibition', () => {
      const noInhibition = regulate(vec({ openness: 5 }))
      const highInhibition = regulate(vec({ openness: 5, inhibition: 8 }))
      expect(noInhibition.biases.vulnerability).toBeGreaterThan(highInhibition.biases.vulnerability)
    })
  })

  describe('restraint bias', () => {
    it('is positive when inhibition dominates heat', () => {
      const { biases } = regulate(vec({ inhibition: 8, heat: 0 }))
      expect(biases.restraint).toBeGreaterThan(0)
    })

    it('is negative when heat dominates inhibition', () => {
      const { biases } = regulate(vec({ heat: 10, inhibition: 0 }))
      expect(biases.restraint).toBeLessThan(0)
    })

    it('clamps to [-1, 1]', () => {
      const extreme = regulate(vec({ heat: 10, inhibition: 0 }))
      expect(extreme.biases.restraint).toBeGreaterThanOrEqual(-1)
      const highBrake = regulate(vec({ heat: 0, inhibition: 10 }))
      expect(highBrake.biases.restraint).toBeLessThanOrEqual(1)
    })
  })

  describe('playfulness bias (inverted-U)', () => {
    it('is 0 at zero excitation', () => {
      const { biases } = regulate(zero())
      expect(biases.playfulness).toBe(0)
    })

    it('peaks at moderate excitation (meanExcitation near 4)', () => {
      // mean near 4: set each excitation axis to 4
      const moderate = regulate(vec({ wanting: 4, liking: 4, heat: 4, openness: 4, limerence: 4, charge: 4 }))
      // At meanExcitation = 4 exactly: rising branch gives 4/4=1, falling gives 1-(0)/8=1 — boundary
      // Either way should be near maximum
      expect(moderate.biases.playfulness).toBeGreaterThan(0.9)
    })

    it('is lower at extreme excitation than moderate', () => {
      const moderate = regulate(vec({ wanting: 4, liking: 4, heat: 4, openness: 4, limerence: 4, charge: 4 }))
      const extreme = regulate(vec({ wanting: 10, liking: 10, heat: 10, openness: 10, limerence: 10, charge: 10 }))
      expect(moderate.biases.playfulness).toBeGreaterThan(extreme.biases.playfulness)
    })
  })

  describe('overallArousal', () => {
    it('is 0 for all-zero axes vector', () => {
      expect(regulate(zero()).biases.overallArousal).toBe(0)
    })

    it('is bounded to [0, 1]', () => {
      const result = regulate(vec({ wanting: 10, liking: 10, heat: 10, openness: 10, limerence: 10, charge: 10 }))
      expect(result.biases.overallArousal).toBeLessThanOrEqual(1)
      expect(result.biases.overallArousal).toBeGreaterThanOrEqual(0)
    })

    it('increases with excitation axes', () => {
      const low = regulate(vec({ wanting: 1, liking: 1, heat: 1 }))
      const high = regulate(vec({ wanting: 8, liking: 8, heat: 8 }))
      expect(high.biases.overallArousal).toBeGreaterThan(low.biases.overallArousal)
    })
  })

  describe('effectiveVector', () => {
    it('returns an ErosVector (has all 7 axes)', () => {
      const { effectiveVector } = regulate(vec())
      const axes = ['wanting', 'liking', 'heat', 'openness', 'limerence', 'charge', 'inhibition']
      for (const axis of axes) {
        expect(effectiveVector).toHaveProperty(axis)
      }
    })

    it('does not mutate the input vector', () => {
      const input = vec({ heat: 5, wanting: 3 })
      const inputCopy = { ...input }
      regulate(input)
      expect(input).toEqual(inputCopy)
    })
  })

  describe('feltShape', () => {
    it('returns a FeltShapeResult with primary and modifier fields', () => {
      const { feltShape } = regulate(zero())
      expect(feltShape).toHaveProperty('primary')
      expect(feltShape).toHaveProperty('modifier')
    })

    it('primary is a string', () => {
      const { feltShape } = regulate(zero())
      expect(typeof feltShape.primary).toBe('string')
    })
  })
})

// ── isInBurn ─────────────────────────────────────────────────────

describe('isInBurn', () => {
  it('returns true when wanting > 6 AND liking > 6', () => {
    expect(isInBurn(zero({ wanting: 7, liking: 7 }))).toBe(true)
  })

  it('returns true at the strict lower bound (6.001 each)', () => {
    expect(isInBurn(zero({ wanting: 6.001, liking: 6.001 }))).toBe(true)
  })

  it('returns false when wanting === 6 (not strictly greater)', () => {
    expect(isInBurn(zero({ wanting: 6, liking: 7 }))).toBe(false)
  })

  it('returns false when liking === 6', () => {
    expect(isInBurn(zero({ wanting: 7, liking: 6 }))).toBe(false)
  })

  it('returns false when wanting is high but liking is low', () => {
    expect(isInBurn(zero({ wanting: 10, liking: 2 }))).toBe(false)
  })

  it('returns false when liking is high but wanting is low', () => {
    expect(isInBurn(zero({ wanting: 2, liking: 10 }))).toBe(false)
  })

  it('returns false for zero vector', () => {
    expect(isInBurn(zero())).toBe(false)
  })
})

// ── isEcstaticUnion ──────────────────────────────────────────────

describe('isEcstaticUnion', () => {
  it('returns true when openness > 7 AND heat > 7', () => {
    expect(isEcstaticUnion(zero({ openness: 8, heat: 8 }))).toBe(true)
  })

  it('returns false when openness === 7 (not strictly greater)', () => {
    expect(isEcstaticUnion(zero({ openness: 7, heat: 8 }))).toBe(false)
  })

  it('returns false when heat === 7', () => {
    expect(isEcstaticUnion(zero({ openness: 8, heat: 7 }))).toBe(false)
  })

  it('returns false when openness is high but heat is low', () => {
    expect(isEcstaticUnion(zero({ openness: 10, heat: 2 }))).toBe(false)
  })

  it('returns false when heat is high but openness is low', () => {
    expect(isEcstaticUnion(zero({ openness: 2, heat: 10 }))).toBe(false)
  })

  it('returns false for zero vector', () => {
    expect(isEcstaticUnion(zero())).toBe(false)
  })
})

// ── regulateWithPhase ────────────────────────────────────────────

describe('regulateWithPhase', () => {
  const base = vec({ wanting: 4, liking: 4, heat: 4, openness: 4, limerence: 2, charge: 2, inhibition: 1 })

  it('baseline phase returns same biases as regulate()', () => {
    const plain = regulate(base)
    const withPhase = regulateWithPhase(base, 'baseline')
    expect(withPhase.biases).toEqual(plain.biases)
  })

  it('rising phase increases intensity relative to baseline', () => {
    const baseline = regulateWithPhase(base, 'baseline')
    const rising = regulateWithPhase(base, 'rising')
    expect(rising.biases.intensity).toBeGreaterThan(baseline.biases.intensity)
  })

  it('rising phase increases playfulness relative to baseline', () => {
    const baseline = regulateWithPhase(base, 'baseline')
    const rising = regulateWithPhase(base, 'rising')
    expect(rising.biases.playfulness).toBeGreaterThan(baseline.biases.playfulness)
  })

  it('peak phase increases intensity more than rising', () => {
    const rising = regulateWithPhase(base, 'rising')
    const peak = regulateWithPhase(base, 'peak')
    expect(peak.biases.intensity).toBeGreaterThan(rising.biases.intensity)
  })

  it('peak phase decreases restraint relative to baseline', () => {
    const baseline = regulateWithPhase(base, 'baseline')
    const peak = regulateWithPhase(base, 'peak')
    expect(peak.biases.restraint).toBeLessThan(baseline.biases.restraint)
  })

  it('peak phase increases warmth relative to baseline', () => {
    const baseline = regulateWithPhase(base, 'baseline')
    const peak = regulateWithPhase(base, 'peak')
    expect(peak.biases.warmth).toBeGreaterThan(baseline.biases.warmth)
  })

  it('resolution phase decreases intensity relative to baseline', () => {
    const baseline = regulateWithPhase(base, 'baseline')
    const resolution = regulateWithPhase(base, 'resolution')
    expect(resolution.biases.intensity).toBeLessThan(baseline.biases.intensity)
  })

  it('resolution phase increases warmth relative to baseline', () => {
    const baseline = regulateWithPhase(base, 'baseline')
    const resolution = regulateWithPhase(base, 'resolution')
    expect(resolution.biases.warmth).toBeGreaterThan(baseline.biases.warmth)
  })

  it('resolution phase increases restraint relative to baseline', () => {
    const baseline = regulateWithPhase(base, 'baseline')
    const resolution = regulateWithPhase(base, 'resolution')
    expect(resolution.biases.restraint).toBeGreaterThan(baseline.biases.restraint)
  })

  it('all phase biases remain in [-1, 1]', () => {
    const phases: OrgasmPhase[] = ['baseline', 'rising', 'peak', 'resolution']
    for (const phase of phases) {
      const { biases } = regulateWithPhase(base, phase)
      for (const [, v] of Object.entries(biases)) {
        expect(v).toBeGreaterThanOrEqual(-1)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })

  it('preserves feltShape and effectiveVector from base regulate()', () => {
    const plain = regulate(base)
    const withPhase = regulateWithPhase(base, 'rising')
    // feltShape and effectiveVector come from the base regulate call — same input
    expect(withPhase.feltShape).toEqual(plain.feltShape)
    expect(withPhase.effectiveVector).toEqual(plain.effectiveVector)
  })
})
