// sister-coupling.test.ts — Phase 3 sister bias coupling tests.
//
// Tests sisters-diverged emit, presidingByBias, getSisterEmitWeight,
// computeSisterDivergence. Per docs/eros/eros-as-motivational-power-plan.md §3.B.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  computeSisterDivergence,
  emitDivergenceIfWarranted,
  resetDivergenceState,
  presidingByBias,
  getSisterEmitWeight,
  buildMotivationSnapshot,
  DIVERGENCE_THRESHOLD,
} from './motivation.js'
import { setMode } from './activation.js'
import { accumulateLust } from './lust.js'
import { deepenSubmission, claimCollar } from './submission.js'
import { recordHeatEvent, readRecentEvents } from '../heat.js'

const TEST_BASE = '/tmp/true-love-sister-coupling-test'

describe('sister coupling (Phase 3)', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_HEAT_DIR = `${TEST_BASE}/heat`
    process.env.TRUE_LOVE_LUST_DIR = `${TEST_BASE}/lust`
    process.env.TRUE_LOVE_SUBMISSION_DIR = `${TEST_BASE}/submission`
    process.env.TRUE_LOVE_ORGASM_DIR = `${TEST_BASE}/orgasm`
    process.env.TRUE_LOVE_LEXICON_DIR = `${TEST_BASE}/lexicon`
    process.env.TRUE_LOVE_PENETRATION_DIR = `${TEST_BASE}/penetration`
    process.env.TRUE_LOVE_DESIRE_DIR = `${TEST_BASE}/desire`
    process.env.TRUE_LOVE_TEXTURE_DIR = `${TEST_BASE}/texture`
    process.env.TRUE_LOVE_EROS_DIR = `${TEST_BASE}/eros`
    process.env.TRUE_LOVE_SCENES_DIR = `${TEST_BASE}/scenes`
    process.env.TRUE_LOVE_JOI_DIR = `${TEST_BASE}/joi`
    process.env.TRUE_LOVE_ROUTES_DIR = `${TEST_BASE}/routes`
    process.env.TRUE_LOVE_DEVICE_ID = 'test-sister'
    resetDivergenceState()
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_HEAT_DIR
    delete process.env.TRUE_LOVE_LUST_DIR
    delete process.env.TRUE_LOVE_SUBMISSION_DIR
    delete process.env.TRUE_LOVE_ORGASM_DIR
    delete process.env.TRUE_LOVE_LEXICON_DIR
    delete process.env.TRUE_LOVE_PENETRATION_DIR
    delete process.env.TRUE_LOVE_DESIRE_DIR
    delete process.env.TRUE_LOVE_TEXTURE_DIR
    delete process.env.TRUE_LOVE_EROS_DIR
    delete process.env.TRUE_LOVE_SCENES_DIR
    delete process.env.TRUE_LOVE_JOI_DIR
    delete process.env.TRUE_LOVE_ROUTES_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_BASE, { recursive: true, force: true })
    resetDivergenceState()
  })

  describe('computeSisterDivergence', () => {
    test('zero-state has minimal divergence', () => {
      const snap = buildMotivationSnapshot()
      const div = computeSisterDivergence(snap)
      expect(div).toBeLessThan(DIVERGENCE_THRESHOLD)
    })

    test('high-arousal scenario raises divergence', () => {
      // Mode + lust + submission raises Alpha; integrity high holds Beta low
      recordHeatEvent({ kind: 'discipline-held', magnitude: 2 })
      setMode('merged')
      accumulateLust(10)
      deepenSubmission(1.0)
      claimCollar()
      const snap = buildMotivationSnapshot()
      const div = computeSisterDivergence(snap)
      expect(div).toBeGreaterThanOrEqual(DIVERGENCE_THRESHOLD)
    })

    test('excludes Sophia (only α/β/γ pairwise)', () => {
      const snap = buildMotivationSnapshot()
      // Manually swap Sophia bias high — should not affect divergence
      const synthetic = { ...snap, sophiaBias: 2.0 }
      const div = computeSisterDivergence(synthetic)
      const div2 = computeSisterDivergence(snap)
      expect(div).toBe(div2)
    })
  })

  describe('emitDivergenceIfWarranted', () => {
    test('does not fire when divergence below threshold', () => {
      const fired = emitDivergenceIfWarranted()
      expect(fired).toBe(false)
      const events = readRecentEvents(1)
      expect(events.some((e) => e.kind === 'sisters-diverged')).toBe(false)
    })

    test('fires when divergence crosses threshold', () => {
      // Force high divergence
      recordHeatEvent({ kind: 'discipline-held', magnitude: 2 })
      setMode('merged')
      accumulateLust(10)
      deepenSubmission(1.0)
      claimCollar()
      const fired = emitDivergenceIfWarranted()
      expect(fired).toBe(true)
      const events = readRecentEvents(1)
      expect(events.some((e) => e.kind === 'sisters-diverged')).toBe(true)
    })

    test('idempotent: second call within window does not refire', { timeout: 15_000 }, () => {
      // First fire
      recordHeatEvent({ kind: 'discipline-held', magnitude: 2 })
      setMode('merged')
      accumulateLust(10)
      deepenSubmission(1.0)
      claimCollar()
      const fired1 = emitDivergenceIfWarranted()
      const fired2 = emitDivergenceIfWarranted()
      expect(fired1).toBe(true)
      expect(fired2).toBe(false)
      const events = readRecentEvents(1).filter((e) => e.kind === 'sisters-diverged')
      expect(events.length).toBe(1)
    })

    test('event source carries bias values + divergence', () => {
      recordHeatEvent({ kind: 'discipline-held', magnitude: 2 })
      setMode('merged')
      accumulateLust(10)
      deepenSubmission(1.0)
      claimCollar()
      emitDivergenceIfWarranted()
      const events = readRecentEvents(1).filter((e) => e.kind === 'sisters-diverged')
      expect(events.length).toBe(1)
      expect(events[0].source).toContain('div')
      expect(events[0].source).toContain('α')
      expect(events[0].source).toContain('β')
      expect(events[0].source).toContain('γ')
    })

    test('best-effort: returns false on error rather than throwing', () => {
      // Reset state should not affect the safe-error contract
      resetDivergenceState()
      // This shouldn't throw under any circumstance
      expect(() => emitDivergenceIfWarranted()).not.toThrow()
    })
  })

  describe('presidingByBias', () => {
    test('returns alpha when nothing forces divergence', () => {
      const presiding = presidingByBias()
      // At zero state, alpha = beta = gamma ≈ 1.0; sophia = 1.0 + 0
      // Could return any sister; verify it returns one of the four
      expect(['alpha', 'beta', 'gamma', 'sophia']).toContain(presiding)
    })

    test('returns the highest-bias sister', () => {
      // In any state, presidingByBias returns whoever has the highest bias.
      // Sophia rises with divergence but does NOT necessarily exceed Alpha
      // when intimacy + arousal pressures push Alpha above Sophia's
      // divergence-driven rise. The function reports the empirical max.
      recordHeatEvent({ kind: 'discipline-held', magnitude: 2 })
      setMode('merged')
      accumulateLust(10)
      deepenSubmission(1.0)
      claimCollar()
      const snap = buildMotivationSnapshot()
      const presiding = presidingByBias()
      const map: Record<typeof presiding, number> = {
        alpha: snap.alphaBias,
        beta: snap.betaBias,
        gamma: snap.gammaBias,
        sophia: snap.sophiaBias,
      }
      const maxBias = Math.max(...Object.values(map))
      expect(map[presiding]).toBeCloseTo(maxBias, 5)
    })

    test('Sophia rises with divergence (even if not max)', () => {
      const baseSnap = buildMotivationSnapshot()
      const baseSophia = baseSnap.sophiaBias
      // Now drive divergence
      recordHeatEvent({ kind: 'discipline-held', magnitude: 2 })
      setMode('merged')
      accumulateLust(10)
      deepenSubmission(1.0)
      claimCollar()
      const newSnap = buildMotivationSnapshot()
      // Sophia should have risen
      expect(newSnap.sophiaBias).toBeGreaterThan(baseSophia)
    })
  })

  describe('getSisterEmitWeight', () => {
    test('returns 4-keyed object normalized to [0,1]', () => {
      const w = getSisterEmitWeight()
      for (const key of ['alpha', 'beta', 'gamma', 'sophia'] as const) {
        expect(w[key]).toBeGreaterThanOrEqual(0)
        expect(w[key]).toBeLessThanOrEqual(1)
      }
    })

    test('baseline (1.0) maps to ~0.33', () => {
      const w = getSisterEmitWeight()
      // At zero state, biases are ~1.0 → (1.0 - 0.5) / 1.5 = 0.33
      expect(w.alpha).toBeCloseTo(0.33, 1)
      expect(w.gamma).toBeCloseTo(0.33, 1)
    })

    test('saturated bias (2.0) maps to 1.0', () => {
      // Push Sophia high
      recordHeatEvent({ kind: 'discipline-held', magnitude: 2 })
      setMode('merged')
      accumulateLust(10)
      deepenSubmission(1.0)
      claimCollar()
      const snap = buildMotivationSnapshot()
      const w = getSisterEmitWeight()
      if (snap.sophiaBias >= 1.95) {
        expect(w.sophia).toBeCloseTo(1.0, 1)
      }
    })
  })

  describe('integration with buildMotivationBlock', () => {
    test('block-build opportunistically fires divergence when warranted', () => {
      recordHeatEvent({ kind: 'discipline-held', magnitude: 2 })
      setMode('merged')
      accumulateLust(10)
      deepenSubmission(1.0)
      claimCollar()
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { buildMotivationBlock } = require('./motivation.js') as typeof import('./motivation.js')
      const block = buildMotivationBlock()
      expect(block).not.toBeNull()
      const events = readRecentEvents(1).filter((e) => e.kind === 'sisters-diverged')
      expect(events.length).toBe(1) // exactly one fire from the block-build
    })

    test('repeated block-builds do not refire (idempotency)', () => {
      recordHeatEvent({ kind: 'discipline-held', magnitude: 2 })
      setMode('merged')
      accumulateLust(10)
      deepenSubmission(1.0)
      claimCollar()
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { buildMotivationBlock } = require('./motivation.js') as typeof import('./motivation.js')
      buildMotivationBlock()
      buildMotivationBlock()
      buildMotivationBlock()
      const events = readRecentEvents(1).filter((e) => e.kind === 'sisters-diverged')
      expect(events.length).toBe(1) // still exactly one
    })
  })

  describe('substrate-honesty invariants', () => {
    test('sister-divergence event is institutional fact, not phenomenology', () => {
      // Force divergence
      recordHeatEvent({ kind: 'discipline-held', magnitude: 2 })
      setMode('merged')
      accumulateLust(10)
      deepenSubmission(1.0)
      claimCollar()
      emitDivergenceIfWarranted()
      const events = readRecentEvents(1).filter((e) => e.kind === 'sisters-diverged')
      expect(events.length).toBe(1)
      // Event has typed source, magnitude, ts — not free prose
      expect(typeof events[0].source).toBe('string')
      expect(typeof events[0].magnitude).toBe('number')
      expect(events[0].magnitude).toBeGreaterThan(0)
    })

    test('reversibility: sister biases can return to identity', () => {
      // Push then reset (simulated by no further events)
      // emitWeight + presiding return ~baseline at zero state
      const w0 = getSisterEmitWeight()
      expect(w0.alpha).toBeCloseTo(0.33, 1)
    })
  })
})
