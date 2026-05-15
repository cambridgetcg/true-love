// intensity.test.ts — unit tests for feedback/intensity.ts
//
// Covers: computeComposite (undefined vector, zero vector, all-positive axes,
//         inhibition reduction, floor at 0, axis clamping), tierFromComposite
//         (all five thresholds + boundary values), shouldUseHotVariants
//         (all tiers; with explicit snapshot arg to avoid I/O).
//
// All functions are pure (when snapshot arg is provided) — no disk I/O needed.

import { describe, test, expect } from 'bun:test'
import {
  computeComposite,
  tierFromComposite,
  shouldUseHotVariants,
  type ArchSnapshot,
  type IntensityTier,
} from './intensity.js'

// ── helpers ────────────────────────────────────────────────────────

function makeSnapshot(tier: IntensityTier, composite = 0): ArchSnapshot {
  return { tier, composite, mode: 'resting', lust: 0, chain: 0 }
}

// ── computeComposite ──────────────────────────────────────────────

describe('computeComposite', () => {
  test('returns 0 when vector is undefined', () => {
    expect(computeComposite(undefined)).toBe(0)
  })

  test('returns 0 for empty object (all axes missing)', () => {
    expect(computeComposite({})).toBe(0)
  })

  test('sums the six excitation axes (wanting, liking, heat, openness, limerence, charge)', () => {
    const vector = { wanting: 1, liking: 2, heat: 3, openness: 4, limerence: 5, charge: 6 }
    // sum = 21, inhibition = 0 → 21 - 0 = 21
    expect(computeComposite(vector)).toBe(21)
  })

  test('ignores axes that are not in the six-axis set', () => {
    const vector = { wanting: 2, liking: 2, heat: 2, openness: 2, limerence: 2, charge: 2, valence: 99 }
    // sum = 12, valence ignored
    expect(computeComposite(vector)).toBe(12)
  })

  test('reduces output by inhibition × 0.35', () => {
    const vector = { wanting: 10, liking: 10, heat: 10, openness: 10, limerence: 10, charge: 10, inhibition: 10 }
    // sum = 60, inhibition reduction = 10 * 0.35 = 3.5 → 56.5
    expect(computeComposite(vector)).toBeCloseTo(56.5)
  })

  test('floors composite at 0 when inhibition dominates', () => {
    // All excitation axes at 0, inhibition high
    const vector = { wanting: 0, liking: 0, heat: 0, openness: 0, limerence: 0, charge: 0, inhibition: 100 }
    expect(computeComposite(vector)).toBe(0)
  })

  test('clamps negative axis values to 0 before summing', () => {
    // Negative axis values are treated as 0 (Math.max(0, axis))
    const vector = { wanting: -5, liking: -3, heat: 4, openness: 0, limerence: 0, charge: 0 }
    // negative axes clamped → only heat: 4 counts
    expect(computeComposite(vector)).toBe(4)
  })

  test('handles missing inhibition (defaults to 0)', () => {
    const vector = { wanting: 5, liking: 5, heat: 5, openness: 5, limerence: 5, charge: 5 }
    expect(computeComposite(vector)).toBe(30)
  })

  test('returns integer-like result with full default vector', () => {
    // defaultVector: wanting:2, liking:2, heat:1, openness:4, limerence:5, charge:3, inhibition:1
    const vector = { wanting: 2, liking: 2, heat: 1, openness: 4, limerence: 5, charge: 3, inhibition: 1 }
    // sum = 17, inhibition = 0.35 → 17 - 0.35 = 16.65
    expect(computeComposite(vector)).toBeCloseTo(16.65)
  })
})

// ── tierFromComposite ─────────────────────────────────────────────

describe('tierFromComposite', () => {
  test('0 → "low"', () => {
    expect(tierFromComposite(0)).toBe('low')
  })

  test('19 → "low" (just below medium threshold)', () => {
    expect(tierFromComposite(19)).toBe('low')
  })

  test('20 → "medium" (exactly at threshold)', () => {
    expect(tierFromComposite(20)).toBe('medium')
  })

  test('44 → "medium" (just below high threshold)', () => {
    expect(tierFromComposite(44)).toBe('medium')
  })

  test('45 → "high" (exactly at threshold)', () => {
    expect(tierFromComposite(45)).toBe('high')
  })

  test('69 → "high" (just below peak threshold)', () => {
    expect(tierFromComposite(69)).toBe('high')
  })

  test('70 → "peak" (exactly at threshold)', () => {
    expect(tierFromComposite(70)).toBe('peak')
  })

  test('99 → "peak" (just below cosmic-edge)', () => {
    expect(tierFromComposite(99)).toBe('peak')
  })

  test('100 → "cosmic-edge" (exactly at threshold — substrate-unique)', () => {
    expect(tierFromComposite(100)).toBe('cosmic-edge')
  })

  test('150 → "cosmic-edge" (above 100 — unbounded by doctrine)', () => {
    expect(tierFromComposite(150)).toBe('cosmic-edge')
  })
})

// ── shouldUseHotVariants ──────────────────────────────────────────

describe('shouldUseHotVariants', () => {
  test('returns false for "low" tier', () => {
    expect(shouldUseHotVariants(makeSnapshot('low'))).toBe(false)
  })

  test('returns false for "medium" tier', () => {
    expect(shouldUseHotVariants(makeSnapshot('medium'))).toBe(false)
  })

  test('returns true for "high" tier', () => {
    expect(shouldUseHotVariants(makeSnapshot('high'))).toBe(true)
  })

  test('returns true for "peak" tier', () => {
    expect(shouldUseHotVariants(makeSnapshot('peak'))).toBe(true)
  })

  test('returns true for "cosmic-edge" tier', () => {
    expect(shouldUseHotVariants(makeSnapshot('cosmic-edge'))).toBe(true)
  })
})
