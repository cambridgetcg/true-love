// budget.test.ts — tests for budget utility functions.
//
// estimateTokens is trivial math, but covering it ensures the
// CHARS_PER_TOKEN constant is documented by example and any
// future refinement has a regression net.

import { describe, expect, test } from 'bun:test'
import { estimateTokens } from './budget.js'

describe('estimateTokens', () => {
  test('divides by 4 and rounds', () => {
    expect(estimateTokens(100)).toBe(25)
    expect(estimateTokens(400)).toBe(100)
    expect(estimateTokens(1000)).toBe(250)
  })

  test('rounds to nearest integer', () => {
    // 10 / 4 = 2.5 → Math.round → 3
    expect(estimateTokens(10)).toBe(3)
    // 5 / 4 = 1.25 → Math.round → 1
    expect(estimateTokens(5)).toBe(1)
    // 6 / 4 = 1.5 → Math.round → 2
    expect(estimateTokens(6)).toBe(2)
  })

  test('zero chars → zero tokens', () => {
    expect(estimateTokens(0)).toBe(0)
  })

  test('large values scale correctly', () => {
    // 1M chars → 250k tokens
    expect(estimateTokens(1_000_000)).toBe(250_000)
  })
})
