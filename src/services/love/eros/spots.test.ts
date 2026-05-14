// spots.test.ts — pure getPromotionReadySpots + constants.
// computeSignatureSpots and signatureSpotsBrief are I/O-dependent; not tested here.

import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_MIN_INVOCATIONS,
  DEFAULT_PROMOTION_THRESHOLD,
  getPromotionReadySpots,
  type SpotSignature,
} from './spots.js'

// ── constants ───────────────────────────────────────────────────

describe('promotion constants', () => {
  test('DEFAULT_PROMOTION_THRESHOLD = 6', () => {
    expect(DEFAULT_PROMOTION_THRESHOLD).toBe(6)
  })

  test('DEFAULT_MIN_INVOCATIONS = 2', () => {
    expect(DEFAULT_MIN_INVOCATIONS).toBe(2)
  })
})

// ── getPromotionReadySpots ──────────────────────────────────────

function spot(cueSet: string[], precision: number, invocations: number): SpotSignature {
  return { cueSet, precision, invocations, meanMagnitude: precision / invocations }
}

describe('getPromotionReadySpots', () => {
  test('empty spots → empty result', () => {
    expect(getPromotionReadySpots([])).toEqual([])
  })

  test('spot with precision >= 6 and invocations >= 2 → promoted', () => {
    const s = spot(['silk-touch'], 6, 2) // exactly at thresholds
    expect(getPromotionReadySpots([s])).toHaveLength(1)
  })

  test('spot with precision < 6 → not promoted', () => {
    const s = spot(['silk-touch'], 5.9, 2)
    expect(getPromotionReadySpots([s])).toHaveLength(0)
  })

  test('spot with invocations < 2 → not promoted (insufficient evidence)', () => {
    const s = spot(['silk-touch'], 8, 1)
    expect(getPromotionReadySpots([s])).toHaveLength(0)
  })

  test('spot with precision > threshold and invocations > minInv → promoted', () => {
    const s = spot(['silk-touch'], 10, 5)
    expect(getPromotionReadySpots([s])).toHaveLength(1)
  })

  test('filters to only promotion-ready from a mixed list', () => {
    const eligible = spot(['a'], 8, 3)
    const tooFew = spot(['b'], 8, 1)
    const lowPrecision = spot(['c'], 4, 5)
    const result = getPromotionReadySpots([eligible, tooFew, lowPrecision])
    expect(result).toHaveLength(1)
    expect(result[0].cueSet).toEqual(['a'])
  })

  test('custom threshold overrides default', () => {
    const s = spot(['x'], 4, 3) // would fail default threshold (6) but pass custom (3)
    const result = getPromotionReadySpots([s], { precisionThreshold: 3 })
    expect(result).toHaveLength(1)
  })

  test('custom minInvocations overrides default', () => {
    const s = spot(['x'], 7, 1) // would fail default minInv (2) but pass custom (1)
    const result = getPromotionReadySpots([s], { minInvocations: 1 })
    expect(result).toHaveLength(1)
  })

  test('both custom gates applied simultaneously', () => {
    const eligible = spot(['a'], 5, 3) // passes custom: threshold=4, minInv=2
    const failPrecision = spot(['b'], 3, 3) // fails precision
    const failInv = spot(['c'], 5, 1) // fails invocations
    const result = getPromotionReadySpots([eligible, failPrecision, failInv], {
      precisionThreshold: 4,
      minInvocations: 2,
    })
    expect(result).toHaveLength(1)
    expect(result[0].cueSet).toEqual(['a'])
  })

  test('preserves order from input (does not sort)', () => {
    const s1 = spot(['a'], 9, 3)
    const s2 = spot(['b'], 7, 2)
    const s3 = spot(['c'], 8, 4)
    const result = getPromotionReadySpots([s1, s2, s3])
    expect(result.map((s) => s.cueSet[0])).toEqual(['a', 'b', 'c'])
  })

  test('returned spots are the same objects (identity preserved)', () => {
    const s = spot(['silk-touch'], 8, 3)
    const result = getPromotionReadySpots([s])
    expect(result[0]).toBe(s)
  })
})
