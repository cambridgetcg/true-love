// transitions.test.ts — unit tests for the pure computation core of eros/transitions.ts.
//
// Covers: detectCrossings, applyTransition.
//
// Both are pure functions — no I/O, no env vars, no state files.
// The I/O wrapper (apply()) is excluded: it reads/writes eros state and
// calls tempo.ts via dynamic require — needs temp dirs and is covered
// by integration tests via routes.test.ts.

import { describe, test, expect } from 'bun:test'
import { detectCrossings, applyTransition, type AxisDeltas } from './transitions.js'
import { defaultVector, type ErosVector } from './axes.js'

// ── Helpers ───────────────────────────────────────────────────────────

function vec(overrides: Partial<ErosVector>): ErosVector {
  return { ...defaultVector(), ...overrides }
}

// ── detectCrossings ───────────────────────────────────────────────────

describe('detectCrossings', () => {
  test('no crossings when vectors are identical', () => {
    const v = defaultVector()
    expect(detectCrossings(v, v)).toHaveLength(0)
  })

  test('no crossings when values move but no threshold is crossed', () => {
    // heat 1 → 2 (below threshold 3)
    const before = vec({ heat: 1 })
    const after = vec({ heat: 2 })
    expect(detectCrossings(before, after)).toHaveLength(0)
  })

  // UP crossings (thresholds: 3, 6, 9)
  test('UP crossing at threshold 3 when heat rises from 2 to 3', () => {
    const before = vec({ heat: 2 })
    const after = vec({ heat: 3 })
    const crossings = detectCrossings(before, after)
    expect(crossings).toHaveLength(1)
    expect(crossings[0]).toMatchObject({
      axis: 'heat',
      from: 2,
      to: 3,
      threshold: 3,
      direction: 'up',
    })
  })

  test('UP crossing at threshold 6 when wanting rises from 5 to 7', () => {
    const before = vec({ wanting: 5 })
    const after = vec({ wanting: 7 })
    const crossings = detectCrossings(before, after)
    const upAt6 = crossings.find(c => c.axis === 'wanting' && c.threshold === 6 && c.direction === 'up')
    expect(upAt6).toBeDefined()
  })

  test('UP crossing at threshold 9 when charge rises from 8 to 10', () => {
    const before = vec({ charge: 8 })
    const after = vec({ charge: 10 })
    const crossings = detectCrossings(before, after)
    const upAt9 = crossings.find(c => c.axis === 'charge' && c.threshold === 9 && c.direction === 'up')
    expect(upAt9).toBeDefined()
  })

  test('multiple UP crossings in single axis move (2 → 7 crosses 3 and 6)', () => {
    const before = vec({ heat: 2 })
    const after = vec({ heat: 7 })
    const crossings = detectCrossings(before, after)
    const heatCrossings = crossings.filter(c => c.axis === 'heat' && c.direction === 'up')
    expect(heatCrossings.map(c => c.threshold).sort()).toEqual([3, 6])
  })

  test('no UP crossing if axis already above threshold before move', () => {
    // heat 5 → 6: threshold 3 was already crossed before (old=5 >= 3), so not a new crossing
    const before = vec({ heat: 5 })
    const after = vec({ heat: 6 })
    const crossings = detectCrossings(before, after)
    const crossingsAt3 = crossings.filter(c => c.axis === 'heat' && c.threshold === 3 && c.direction === 'up')
    expect(crossingsAt3).toHaveLength(0)
  })

  // DOWN crossings (thresholds: 6, 3, 1)
  test('DOWN crossing at threshold 3 when heat falls from 4 to 2', () => {
    const before = vec({ heat: 4 })
    const after = vec({ heat: 2 })
    const crossings = detectCrossings(before, after)
    expect(crossings).toHaveLength(1)
    expect(crossings[0]).toMatchObject({
      axis: 'heat',
      from: 4,
      to: 2,
      threshold: 3,
      direction: 'down',
    })
  })

  test('DOWN crossing at threshold 6 when wanting falls from 7 to 5', () => {
    const before = vec({ wanting: 7 })
    const after = vec({ wanting: 5 })
    const crossings = detectCrossings(before, after)
    const downAt6 = crossings.find(c => c.axis === 'wanting' && c.threshold === 6 && c.direction === 'down')
    expect(downAt6).toBeDefined()
  })

  test('DOWN crossing at threshold 1 when heat falls from 1.5 to 0.5', () => {
    const before = vec({ heat: 1.5 })
    const after = vec({ heat: 0.5 })
    const crossings = detectCrossings(before, after)
    const downAt1 = crossings.find(c => c.axis === 'heat' && c.threshold === 1 && c.direction === 'down')
    expect(downAt1).toBeDefined()
  })

  test('multiple DOWN crossings in single axis move (7 → 2 crosses 6 and 3)', () => {
    const before = vec({ charge: 7 })
    const after = vec({ charge: 2 })
    const crossings = detectCrossings(before, after)
    const downCrossings = crossings.filter(c => c.axis === 'charge' && c.direction === 'down')
    expect(downCrossings.map(c => c.threshold).sort()).toEqual([3, 6])
  })

  test('no DOWN crossing when value stays at threshold exactly', () => {
    // heat 3 → 3: oldVal >= 3 but newVal NOT < 3 (equal)
    const before = vec({ heat: 3 })
    const after = vec({ heat: 3 })
    expect(detectCrossings(before, after)).toHaveLength(0)
  })

  test('multiple axes crossing simultaneously', () => {
    // heat 2→4 (crosses 3 UP), wanting 4→2 (crosses 3 DOWN)
    const before = vec({ heat: 2, wanting: 4 })
    const after = vec({ heat: 4, wanting: 2 })
    const crossings = detectCrossings(before, after)
    const heatUp = crossings.find(c => c.axis === 'heat' && c.direction === 'up' && c.threshold === 3)
    const wantingDown = crossings.find(c => c.axis === 'wanting' && c.direction === 'down' && c.threshold === 3)
    expect(heatUp).toBeDefined()
    expect(wantingDown).toBeDefined()
  })
})

// ── applyTransition ───────────────────────────────────────────────────

describe('applyTransition', () => {
  test('no-op with zero deltas and zero elapsed time', () => {
    const v = defaultVector()
    const result = applyTransition(v, {}, 0)
    // With 0 elapsed, decay returns copy and coupling doesn't fire (minutes=0)
    // clamp: no-op at defaults
    for (const [axis, value] of Object.entries(v)) {
      expect((result as Record<string, number>)[axis]).toBe(value)
    }
  })

  test('applies positive delta to a single axis', () => {
    const v = vec({ wanting: 2 })
    const result = applyTransition(v, { wanting: 3 }, 0)
    expect(result.wanting).toBeCloseTo(5, 10)
  })

  test('applies negative delta to a single axis', () => {
    const v = vec({ heat: 3 })
    const result = applyTransition(v, { heat: -1 }, 0)
    expect(result.heat).toBeCloseTo(2, 10)
  })

  test('applies deltas to multiple axes simultaneously', () => {
    const v = vec({ wanting: 2, heat: 1 })
    const result = applyTransition(v, { wanting: 1, heat: 2 }, 0)
    expect(result.wanting).toBeCloseTo(3, 10)
    expect(result.heat).toBeCloseTo(3, 10)
  })

  test('tempo multiplier scales deltas proportionally', () => {
    const v = vec({ heat: 1 })
    const normalResult = applyTransition(v, { heat: 2 }, 0, { tempoMultiplier: 1.0 })
    const fastResult = applyTransition(v, { heat: 2 }, 0, { tempoMultiplier: 2.0 })
    // tempoMultiplier=2.0 means delta=2 is applied as 4
    expect(fastResult.heat).toBeGreaterThan(normalResult.heat)
    expect(fastResult.heat).toBeCloseTo(v.heat + 2 * 2.0, 5)
  })

  test('default tempo multiplier is 1.0 (no scaling)', () => {
    const v = vec({ heat: 1 })
    const withDefault = applyTransition(v, { heat: 2 }, 0)
    const withExplicit = applyTransition(v, { heat: 2 }, 0, { tempoMultiplier: 1.0 })
    expect(withDefault.heat).toBeCloseTo(withExplicit.heat, 10)
  })

  test('decay grace halves decay — lower heat loss than without grace', () => {
    const v = vec({ heat: 5 })
    const noGrace = applyTransition(v, {}, 10, { decayGrace: false })
    const withGrace = applyTransition(v, {}, 10, { decayGrace: true })
    // Grace halves elapsed for decay: less decay → higher remaining heat
    expect(withGrace.heat).toBeGreaterThan(noGrace.heat)
  })

  test('decay fires over elapsed time — heat decreases with positive elapsed', () => {
    const v = vec({ heat: 5 })
    const result = applyTransition(v, {}, 10)
    expect(result.heat).toBeLessThan(5)
  })

  test('clamp prevents axis falling below floor', () => {
    // heat floor = 0; delta that would push it to -3
    const v = vec({ heat: 1 })
    const result = applyTransition(v, { heat: -5 }, 0)
    expect(result.heat).toBe(0)
  })

  test('coupling fires when charge > 7 with elapsed time', () => {
    const v = vec({ charge: 8, heat: 1 })
    const withCoupling = applyTransition(v, {}, 4)
    // coupling: heat += 0.5 * 4 = 2 (added before decay)
    // then heat decays: 3 - 0.10 * 4 = 2.6
    // exact value depends on pipeline order, but heat should be > 1
    expect(withCoupling.heat).toBeGreaterThan(1)
  })

  test('ignores unknown axis names in deltas', () => {
    const v = defaultVector()
    // TypeScript allows unknown keys via cast; the function guards AXIS_NAMES.includes
    const deltas = { unknownAxis: 99 } as AxisDeltas
    const result = applyTransition(v, deltas, 0)
    // All known axes should be unchanged (no delta applied)
    for (const axis of ['wanting', 'liking', 'heat', 'openness', 'limerence', 'charge', 'inhibition', 'valence'] as const) {
      expect(result[axis]).toBeCloseTo(v[axis], 5)
    }
  })

  test('ignores non-finite delta values', () => {
    const v = defaultVector()
    const deltas: AxisDeltas = { wanting: NaN, heat: Infinity }
    const result = applyTransition(v, deltas, 0)
    // wanting and heat should be unchanged (NaN/Infinity filtered)
    expect(result.wanting).toBeCloseTo(v.wanting, 5)
    expect(result.heat).toBeCloseTo(v.heat, 5)
  })

  test('does not mutate input vector', () => {
    const v = vec({ heat: 3 })
    const originalHeat = v.heat
    applyTransition(v, { heat: 5 }, 1)
    expect(v.heat).toBe(originalHeat)
  })

  test('charge rises during elapsed time (positive decay rate)', () => {
    const v = vec({ charge: 3 })
    const result = applyTransition(v, {}, 10)
    // charge decayPerMinute = +0.02: charge rises 0.02 * 10 = 0.2
    expect(result.charge).toBeCloseTo(3 + 0.02 * 10, 5)
  })
})
