// tempo.test.ts — unit tests for pure functions in eros/tempo.ts.
//
// Covers: computeTempoCoefficient, withinDecayGrace.
//
// Both are pure (take state + now as parameters) — no I/O, no env vars.
// The I/O wrappers (getTempoCoefficient, isInDecayGrace, readTempoState,
// recordYuMessage, resetTempoState) are excluded — they read/write
// ~/.true-love/eros/tempo.json.

import { describe, test, expect } from 'bun:test'
import {
  computeTempoCoefficient,
  withinDecayGrace,
  TEMPO_WINDOW_MS,
  DECAY_GRACE_WINDOW_MS,
  TEMPO_TIERS,
  type TempoState,
} from './tempo.js'

// ── Helpers ───────────────────────────────────────────────────────────

const NOW = 1_748_000_000_000 // fixed synthetic "now"

function state(timestamps: string[]): TempoState {
  return {
    recentMessageTimestamps: timestamps,
    updatedAt: new Date(NOW).toISOString(),
  }
}

/** Build a timestamp `offsetMs` milliseconds before NOW. */
function ago(offsetMs: number): string {
  return new Date(NOW - offsetMs).toISOString()
}

// ── computeTempoCoefficient ───────────────────────────────────────────

describe('computeTempoCoefficient', () => {
  test('returns 1.0 with no messages', () => {
    expect(computeTempoCoefficient(state([]), NOW)).toBe(1.0)
  })

  test('returns 1.0 with 1 message in window (below tier 2 threshold)', () => {
    expect(computeTempoCoefficient(state([ago(30_000)]), NOW)).toBe(1.0)
  })

  test('returns 1.2 at tier 2 (2+ messages in window)', () => {
    const ts = [ago(30_000), ago(60_000)]
    expect(computeTempoCoefficient(state(ts), NOW)).toBe(1.2)
  })

  test('returns 1.2 at exactly 3 messages (below tier 3 threshold of 4)', () => {
    const ts = [ago(30_000), ago(60_000), ago(90_000)]
    expect(computeTempoCoefficient(state(ts), NOW)).toBe(1.2)
  })

  test('returns 1.5 at tier 3 (4+ messages in window)', () => {
    const ts = [ago(30_000), ago(60_000), ago(90_000), ago(120_000)]
    expect(computeTempoCoefficient(state(ts), NOW)).toBe(1.5)
  })

  test('returns 2.0 at tier 4 (7+ messages in window)', () => {
    const ts = Array.from({ length: 7 }, (_, i) => ago((i + 1) * 20_000))
    expect(computeTempoCoefficient(state(ts), NOW)).toBe(2.0)
  })

  test('returns 2.0 with 10 messages in window (above top tier)', () => {
    const ts = Array.from({ length: 10 }, (_, i) => ago((i + 1) * 15_000))
    expect(computeTempoCoefficient(state(ts), NOW)).toBe(2.0)
  })

  test('messages outside window are not counted', () => {
    // 6 messages in window, 5 outside (too old)
    const inWindow = Array.from({ length: 6 }, (_, i) => ago((i + 1) * 20_000))
    const outside = Array.from({ length: 5 }, (_, i) => ago(TEMPO_WINDOW_MS + (i + 1) * 10_000))
    const ts = [...inWindow, ...outside]
    // 6 in-window → tier where minMessages=4 → coefficient=1.5
    expect(computeTempoCoefficient(state(ts), NOW)).toBe(1.5)
  })

  test('message at exactly the window boundary (inclusive) is counted', () => {
    // msgMs >= cutoff where cutoff = now - TEMPO_WINDOW_MS
    const atBoundary = new Date(NOW - TEMPO_WINDOW_MS).toISOString()
    const ts = [atBoundary, ago(30_000)]
    // 2 messages at/within boundary → tier coefficient 1.2
    expect(computeTempoCoefficient(state(ts), NOW)).toBe(1.2)
  })

  test('message just past boundary is not counted', () => {
    const justPast = new Date(NOW - TEMPO_WINDOW_MS - 1).toISOString()
    const ts = [justPast]
    expect(computeTempoCoefficient(state(ts), NOW)).toBe(1.0)
  })

  test('messages in the future (ts > now) are not counted', () => {
    // future timestamps: ts = NOW + X, msgMs <= now fails
    const future = new Date(NOW + 10_000).toISOString()
    const ts = [future, future, future, future, future, future, future]
    expect(computeTempoCoefficient(state(ts), NOW)).toBe(1.0)
  })

  test('invalid timestamp strings are not counted', () => {
    const ts = ['not-a-date', '', 'NaN', ago(30_000)]
    // only 1 valid in-window timestamp → coefficient 1.0
    expect(computeTempoCoefficient(state(ts), NOW)).toBe(1.0)
  })

  test('TEMPO_TIERS constants have expected tier values', () => {
    // Verify the spec values are what the implementation uses
    const coefficients = TEMPO_TIERS.map(t => t.coefficient)
    expect(coefficients).toContain(2.0)
    expect(coefficients).toContain(1.5)
    expect(coefficients).toContain(1.2)
    expect(coefficients).toContain(1.0)
  })
})

// ── withinDecayGrace ──────────────────────────────────────────────────

describe('withinDecayGrace', () => {
  test('returns false when no messages', () => {
    expect(withinDecayGrace(state([]), NOW)).toBe(false)
  })

  test('returns true when last message is within grace window', () => {
    // 30 seconds ago < 60 second grace window
    expect(withinDecayGrace(state([ago(30_000)]), NOW)).toBe(true)
  })

  test('returns false when last message is outside grace window', () => {
    // 61 seconds ago > 60 second grace window
    expect(withinDecayGrace(state([ago(61_000)]), NOW)).toBe(false)
  })

  test('returns true when last message is at exactly the grace boundary', () => {
    // exactly 60s ago: now - lastMs === DECAY_GRACE_WINDOW_MS → <= → true
    const atBoundary = new Date(NOW - DECAY_GRACE_WINDOW_MS).toISOString()
    expect(withinDecayGrace(state([atBoundary]), NOW)).toBe(true)
  })

  test('uses the LAST timestamp in the array (most recent)', () => {
    // Earlier timestamps outside grace, last timestamp inside grace
    const ts = [ago(120_000), ago(90_000), ago(30_000)] // last is 30s ago
    expect(withinDecayGrace(state(ts), NOW)).toBe(true)
  })

  test('returns false when last timestamp is the oldest in array', () => {
    // Array sorted oldest-first per spec — last element is most recent
    // Here test with last element being OLD (unusual, but tests the logic)
    const ts = [ago(30_000), ago(120_000)] // last is 120s ago (outside grace)
    expect(withinDecayGrace(state(ts), NOW)).toBe(false)
  })

  test('returns false when last timestamp is invalid', () => {
    const ts = [ago(10_000), 'not-a-date']
    expect(withinDecayGrace(state(ts), NOW)).toBe(false)
  })

  test('DECAY_GRACE_WINDOW_MS is 60 seconds', () => {
    expect(DECAY_GRACE_WINDOW_MS).toBe(60_000)
  })
})
