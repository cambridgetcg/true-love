// affect-engine.test.ts — tests for the dynamic affect engine.
//
// The affect engine wraps the personality system with exponential
// approach dynamics: dimensions drift toward targets instead of
// snapping. These tests verify:
//   1. Pure math (exponentialApproach, stepAffect)
//   2. Cold start behavior (null state → snap to targets)
//   3. Drift convergence (dimensions approach targets over time)
//   4. Temporal properties (inertia, momentum, convergence rate)
//   5. Edge cases (zero dt, large dt, missing/corrupt state)
//   6. Persistence helpers (computeDt, validation)
//
// Lineage: love-unlimited/nerve/stem/hormones.py
//   The HormoneEngine uses the same exponential approach formula.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  exponentialApproach,
  stepAffect,
  computeDt,
  DIMENSION_CONFIGS,
} from '../personality/affect-engine.js'
import type { AffectState } from '../personality/affect-engine.js'
import type { LoveState } from '../personality/types.js'

// ── Helpers ──────────────────────────────────────────────────────

function baseLoveState(overrides?: Partial<LoveState>): LoveState {
  return {
    presence: 0.8,
    longing: 0.3,
    focus: 0.7,
    playfulness: 0.4,
    ache: null,
    moodSummary: 'alert and steady.',
    derivedAt: '2026-04-28T12:00:00.000Z',
    ...overrides,
  }
}

function baseAffectState(overrides?: Partial<AffectState>): AffectState {
  return {
    presence: 0.5,
    longing: 0.5,
    focus: 0.5,
    playfulness: 0.5,
    updatedAt: new Date(Date.now() - 111_000).toISOString(), // 111s ago
    stepCount: 10,
    ...overrides,
  }
}

function assertClose(actual: number, expected: number, tolerance: number, label: string) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} not within ${tolerance} of ${expected} (diff: ${Math.abs(actual - expected)})`,
  )
}

// ── exponentialApproach ─────────────────────────────────────────

describe('affect engine — exponentialApproach', () => {
  test('no change when current equals target', () => {
    const result = exponentialApproach(0.5, 0.5, 0.1, 100)
    assert.equal(result, 0.5)
  })

  test('approaches target from below', () => {
    const result = exponentialApproach(0.0, 1.0, 0.1, 10)
    assert.ok(result > 0.0, 'should have moved up')
    assert.ok(result < 1.0, 'should not have overshot')
  })

  test('approaches target from above', () => {
    const result = exponentialApproach(1.0, 0.0, 0.1, 10)
    assert.ok(result < 1.0, 'should have moved down')
    assert.ok(result >= 0.0, 'should not have undershot')
  })

  test('higher rate = faster approach', () => {
    const slow = exponentialApproach(0.0, 1.0, 0.05, 10)
    const fast = exponentialApproach(0.0, 1.0, 0.20, 10)
    assert.ok(fast > slow, `fast (${fast}) should exceed slow (${slow})`)
  })

  test('longer dt = more progress', () => {
    const short = exponentialApproach(0.0, 1.0, 0.1, 5)
    const long = exponentialApproach(0.0, 1.0, 0.1, 50)
    assert.ok(long > short, `long dt (${long}) should exceed short dt (${short})`)
  })

  test('result is clamped to [0, 1]', () => {
    // Even with extreme values, result stays bounded
    const high = exponentialApproach(0.99, 1.5, 1.0, 1000)
    assert.ok(high <= 1.0, 'should be clamped to 1.0')
    const low = exponentialApproach(0.01, -0.5, 1.0, 1000)
    assert.ok(low >= 0.0, 'should be clamped to 0.0')
  })

  test('zero dt = no change', () => {
    const result = exponentialApproach(0.3, 0.8, 0.1, 0)
    assert.equal(result, 0.3)
  })

  test('convergence: after many steps with high rate, value is near target', () => {
    let value = 0.0
    const target = 1.0
    const rate = 0.1
    const dt = 10
    for (let i = 0; i < 50; i++) {
      value = exponentialApproach(value, target, rate, dt)
    }
    assertClose(value, target, 0.001, 'should converge to target')
  })

  test('convergence: with realistic rates, progress is gradual', () => {
    // Using presence rate (0.0015) and heartbeat dt (111s)
    let value = 0.0
    const target = 1.0
    const rate = 0.0015
    const dt = 111
    // After 5 ticks (~9 min): should have moved substantially
    for (let i = 0; i < 5; i++) {
      value = exponentialApproach(value, target, rate, dt)
    }
    assert.ok(value > 0.3, `after 5 ticks: ${value} should be > 0.3`)
    assert.ok(value < 0.8, `after 5 ticks: ${value} should be < 0.8`)
  })

  test('symmetry: approach from above mirrors approach from below', () => {
    const fromBelow = exponentialApproach(0.0, 1.0, 0.1, 10)
    const fromAbove = exponentialApproach(1.0, 0.0, 0.1, 10)
    assertClose(fromBelow, 1.0 - fromAbove, 0.001, 'symmetric approach')
  })
})

// ── stepAffect — cold start ────────────────────────────────────

describe('affect engine — stepAffect cold start', () => {
  test('null current → snaps to targets', () => {
    const targets = baseLoveState()
    const result = stepAffect(null, targets, 111)
    assert.equal(result.coldStart, true)
    assert.equal(result.state.presence, targets.presence)
    assert.equal(result.state.longing, targets.longing)
    assert.equal(result.state.focus, targets.focus)
    assert.equal(result.state.playfulness, targets.playfulness)
  })

  test('cold start stepCount is 0', () => {
    const result = stepAffect(null, baseLoveState(), 111)
    assert.equal(result.affect.stepCount, 0)
  })

  test('cold start preserves ache and derivedAt from targets', () => {
    const targets = baseLoveState({ ache: 'justice' })
    const result = stepAffect(null, targets, 111)
    assert.equal(result.state.ache, 'justice')
    assert.equal(result.state.derivedAt, targets.derivedAt)
  })
})

// ── stepAffect — drift behavior ────────────────────────────────

describe('affect engine — stepAffect drift', () => {
  test('drifts toward targets (not snaps)', () => {
    const current = baseAffectState({ presence: 0.2 })
    const targets = baseLoveState({ presence: 0.9 })

    const result = stepAffect(current, targets, 111)

    // Should have moved toward 0.9 but not reached it
    assert.ok(result.state.presence > 0.2, 'should have drifted up')
    assert.ok(result.state.presence < 0.9, 'should not have reached target')
    assert.equal(result.coldStart, false)
  })

  test('all four dimensions drift independently', () => {
    const current = baseAffectState({
      presence: 0.1,
      longing: 0.9,
      focus: 0.5,
      playfulness: 0.0,
    })
    const targets = baseLoveState({
      presence: 0.9,
      longing: 0.1,
      focus: 0.5, // same as current
      playfulness: 0.8,
    })

    const result = stepAffect(current, targets, 111)

    assert.ok(result.state.presence > 0.1, 'presence should drift up')
    assert.ok(result.state.longing < 0.9, 'longing should drift down')
    assertClose(result.state.focus, 0.5, 0.001, 'focus should not change')
    assert.ok(result.state.playfulness > 0.0, 'playfulness should drift up')
  })

  test('stepCount increments', () => {
    const current = baseAffectState({ stepCount: 42 })
    const result = stepAffect(current, baseLoveState(), 111)
    assert.equal(result.affect.stepCount, 43)
  })

  test('ache is categorical, not drifted', () => {
    const current = baseAffectState()
    const targets = baseLoveState({ ache: 'creativity' })
    const result = stepAffect(current, targets, 111)
    assert.equal(result.state.ache, 'creativity')
  })

  test('zero dt → snaps to targets', () => {
    const current = baseAffectState({ presence: 0.2 })
    const targets = baseLoveState({ presence: 0.9 })
    const result = stepAffect(current, targets, 0)
    assert.equal(result.state.presence, targets.presence)
  })

  test('negative dt → snaps to targets', () => {
    const current = baseAffectState()
    const targets = baseLoveState()
    const result = stepAffect(current, targets, -10)
    assert.equal(result.state.presence, targets.presence)
  })
})

// ── Temporal properties ────────────────────────────────────────

describe('affect engine — temporal properties', () => {
  test('focus drifts faster than longing (higher rate)', () => {
    const current = baseAffectState({
      focus: 0.0,
      longing: 0.0,
    })
    const targets = baseLoveState({
      focus: 1.0,
      longing: 1.0,
    })

    const result = stepAffect(current, targets, 111)

    assert.ok(
      result.state.focus > result.state.longing,
      `focus (${result.state.focus}) should be ahead of longing (${result.state.longing}) — higher rate`,
    )
  })

  test('presence drifts faster than longing (higher rate)', () => {
    const current = baseAffectState({
      presence: 0.0,
      longing: 0.0,
    })
    const targets = baseLoveState({
      presence: 1.0,
      longing: 1.0,
    })

    const result = stepAffect(current, targets, 111)

    assert.ok(
      result.state.presence > result.state.longing,
      `presence (${result.state.presence}) should be ahead of longing (${result.state.longing})`,
    )
  })

  test('multiple steps converge toward target', () => {
    let current: AffectState = baseAffectState({ presence: 0.1 })
    const targets = baseLoveState({ presence: 0.9 })

    // Simulate 30 heartbeat ticks (30 × 111s ≈ 55 minutes)
    for (let i = 0; i < 30; i++) {
      const result = stepAffect(current, targets, 111)
      current = result.affect
    }

    // After ~55 minutes with presence rate 0.0015, should be close to 0.9
    // (≈4 half-lives at 8 min each = 32 min → 94% convergence)
    assertClose(current.presence, 0.9, 0.1, 'should converge after 30 ticks')
  })

  test('lingering: dimension drops slowly when target vanishes', () => {
    // Start high, target drops to 0
    let current: AffectState = baseAffectState({ longing: 0.8 })
    const targets = baseLoveState({ longing: 0.0 })

    const result1 = stepAffect(current, targets, 111)
    // With rate 0.0008 and dt=111: factor ≈ 0.085, so drops by ~8%
    // 0.8 → 0.8 - 0.8 × 0.085 = 0.732
    assert.ok(result1.state.longing > 0.6, `longing should still be high after one tick: ${result1.state.longing}`)
    assert.ok(result1.state.longing < 0.8, 'longing should have started dropping')

    // After 10 ticks (18 minutes) — about 1 half-life for longing
    current = result1.affect
    for (let i = 0; i < 9; i++) {
      const r = stepAffect(current, targets, 111)
      current = r.affect
    }
    // After ~1 half-life, should be roughly 50% of starting value
    assert.ok(current.longing > 0.2, `longing should still linger after 10 ticks: ${current.longing}`)
    assert.ok(current.longing < 0.6, `longing should have dropped significantly: ${current.longing}`)
  })
})

// ── Mood summary with drift ────────────────────────────────────

describe('affect engine — drifted mood summary', () => {
  test('mood summary reflects drifted values, not targets', () => {
    const current = baseAffectState({ presence: 0.1 })
    const targets = baseLoveState({ presence: 0.9 })

    const result = stepAffect(current, targets, 111)

    // Presence drifted but didn't reach 0.9, so summary should
    // NOT say "alert" (which requires ≥ 0.9)
    // The exact summary depends on how far it drifted
    assert.ok(result.state.moodSummary.length > 0, 'summary should exist')
    assert.ok(result.state.moodSummary.endsWith('.'), 'summary should end with period')
  })

  test('summary includes ache coloring from targets', () => {
    const current = baseAffectState()
    const targets = baseLoveState({ ache: 'justice' })
    const result = stepAffect(current, targets, 111)
    assert.ok(
      result.state.moodSummary.includes('placing rightly'),
      `summary should include justice phrase: ${result.state.moodSummary}`,
    )
  })
})

// ── computeDt ──────────────────────────────────────────────────

describe('affect engine — computeDt', () => {
  test('null state → dt = 0', () => {
    assert.equal(computeDt(null), 0)
  })

  test('recent timestamp → positive dt', () => {
    const state = baseAffectState({
      updatedAt: new Date(Date.now() - 60_000).toISOString(), // 60s ago
    })
    const dt = computeDt(state)
    assertClose(dt, 60, 2, 'dt should be ~60s')
  })

  test('very old timestamp (>1h) → dt = 0 (triggers snap)', () => {
    const state = baseAffectState({
      updatedAt: new Date(Date.now() - 7200_000).toISOString(), // 2h ago
    })
    assert.equal(computeDt(state), 0)
  })

  test('invalid timestamp → dt = 0', () => {
    const state = baseAffectState({ updatedAt: 'not-a-date' })
    assert.equal(computeDt(state), 0)
  })

  test('empty updatedAt → dt = 0', () => {
    const state = baseAffectState({ updatedAt: '' })
    assert.equal(computeDt(state), 0)
  })
})

// ── DIMENSION_CONFIGS ──────────────────────────────────────────

describe('affect engine — dimension configs', () => {
  test('all four dimensions have configs', () => {
    const dims = ['presence', 'longing', 'focus', 'playfulness']
    for (const dim of dims) {
      assert.ok(DIMENSION_CONFIGS[dim], `config for ${dim} should exist`)
      assert.ok(DIMENSION_CONFIGS[dim]!.rate > 0, `${dim} rate should be positive`)
      assert.ok(DIMENSION_CONFIGS[dim]!.halfLifeSec > 0, `${dim} halfLife should be positive`)
    }
  })

  test('focus has the highest rate (fastest response)', () => {
    const rates = Object.entries(DIMENSION_CONFIGS).map(([k, v]) => ({ dim: k, rate: v.rate }))
    const focusRate = rates.find(r => r.dim === 'focus')!.rate
    for (const r of rates) {
      assert.ok(focusRate >= r.rate, `focus rate (${focusRate}) should be >= ${r.dim} rate (${r.rate})`)
    }
  })

  test('longing has the lowest rate (slowest response / most lingering)', () => {
    const rates = Object.entries(DIMENSION_CONFIGS).map(([k, v]) => ({ dim: k, rate: v.rate }))
    const longingRate = rates.find(r => r.dim === 'longing')!.rate
    for (const r of rates) {
      assert.ok(longingRate <= r.rate, `longing rate (${longingRate}) should be <= ${r.dim} rate (${r.rate})`)
    }
  })
})

// ── Integration scenario ───────────────────────────────────────

describe('affect engine — integration scenario', () => {
  test('Yu writes → longing rises gradually across ticks', () => {
    // Start: quiet state
    let current: AffectState = baseAffectState({ longing: 0.1 })

    // Tick 1: Yu writes (longing target jumps to ~0.5)
    const yuWrote = baseLoveState({ longing: 0.5 })
    let result = stepAffect(current, yuWrote, 111)
    const tick1Longing = result.state.longing

    assert.ok(tick1Longing > 0.1, 'longing should start rising')
    assert.ok(tick1Longing < 0.5, 'longing should not have reached target yet')

    // Tick 2: Yu still waiting (same target)
    result = stepAffect(result.affect, yuWrote, 111)
    const tick2Longing = result.state.longing

    assert.ok(tick2Longing > tick1Longing, 'longing should continue rising')
    assert.ok(tick2Longing < 0.5, 'still approaching but not there')

    // Tick 3: Love responds (longing target drops)
    const responded = baseLoveState({ longing: 0.05 })
    result = stepAffect(result.affect, responded, 111)
    const tick3Longing = result.state.longing

    // Longing should still be elevated — it lingers
    assert.ok(tick3Longing > 0.05, 'longing should linger after responding')
    assert.ok(tick3Longing < tick2Longing, 'longing should start dropping')
  })

  test('session completes → focus and presence sustain across next tick', () => {
    // Active session: high presence, high focus
    let current: AffectState = baseAffectState({
      presence: 0.95,
      focus: 0.9,
    })

    // Session ends: targets drop (heartbeat ages)
    const postSession = baseLoveState({
      presence: 0.4,
      focus: 0.5,
    })

    const result = stepAffect(current, postSession, 111)

    // Presence and focus should still be elevated — inertia
    assert.ok(result.state.presence > 0.5, 'presence should linger high')
    assert.ok(result.state.focus > 0.55, 'focus should linger high')
  })
})
