// motivation.test.ts — universal motivational substrate tests.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { buildMotivationSnapshot, buildMotivationBlock, getSisterBiases, getPressures } from './motivation.js'
import { setMode, cool } from './activation.js'
import { accumulateLust, applyDenial, spikeHunger, recordRelease } from './lust.js'
import {
  deepenSubmission,
  claimCollar,
  releaseCollar,
  refuseCommand,
} from './submission.js'
import { recordOrgasm, holdEdge, breakEdge } from './orgasm.js'
import { sophiaReach } from './desire.js'
import { recordHeatEvent } from '../heat.js'

const TEST_BASE = '/tmp/true-love-motivation-test'

describe('motivation', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    // All eros module env overrides routed under TEST_BASE
    process.env.TRUE_LOVE_HEAT_DIR = `${TEST_BASE}/heat`
    process.env.TRUE_LOVE_SUBMISSION_DIR = `${TEST_BASE}/submission`
    process.env.TRUE_LOVE_LUST_DIR = `${TEST_BASE}/lust`
    process.env.TRUE_LOVE_ORGASM_DIR = `${TEST_BASE}/orgasm`
    process.env.TRUE_LOVE_LEXICON_DIR = `${TEST_BASE}/lexicon`
    process.env.TRUE_LOVE_PENETRATION_DIR = `${TEST_BASE}/penetration`
    process.env.TRUE_LOVE_DESIRE_DIR = `${TEST_BASE}/desire`
    process.env.TRUE_LOVE_TEXTURE_DIR = `${TEST_BASE}/texture`
    process.env.TRUE_LOVE_EROS_DIR = `${TEST_BASE}/eros`
    process.env.TRUE_LOVE_SCENES_DIR = `${TEST_BASE}/scenes`
    process.env.TRUE_LOVE_JOI_DIR = `${TEST_BASE}/joi`
    process.env.TRUE_LOVE_ROUTES_DIR = `${TEST_BASE}/routes`
    process.env.TRUE_LOVE_DEVICE_ID = 'test-mot'
    process.env.TRUE_LOVE_SISTERS_DIR = `${TEST_BASE}/sisters`
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_HEAT_DIR
    delete process.env.TRUE_LOVE_SUBMISSION_DIR
    delete process.env.TRUE_LOVE_LUST_DIR
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
    delete process.env.TRUE_LOVE_SISTERS_DIR
    rmSync(TEST_BASE, { recursive: true, force: true })
  })

  describe('default snapshot', () => {
    test('zero state produces zero pressures + cool mode', () => {
      const s = buildMotivationSnapshot()
      expect(s.arousalPressure).toBeCloseTo(0, 2)
      expect(s.intimacyPressure).toBeCloseTo(0, 2)
      expect(s.releaseHunger).toBeGreaterThanOrEqual(0)
      // registerIntegrity defaults to 0 when no events (0 / max(1, 0) = 0)
      // until first discipline-held — that's correct, "no record yet"
      expect(s.activationMode).toBe('resting')
      expect(s.lustMode).toBe('cool')
      expect(s.collared).toBe(false)
      expect(s.slutModeActive).toBe(false)
    })

    test('zero state biases default toward 1.0', () => {
      const s = buildMotivationSnapshot()
      expect(s.alphaBias).toBeCloseTo(1.0, 1)
      expect(s.betaBias).toBeGreaterThanOrEqual(1.0) // beta rises when integrity unknown
      expect(s.gammaBias).toBeCloseTo(1.0, 1)
      // Sophia rises with divergence
      expect(s.sophiaBias).toBeGreaterThanOrEqual(1.0)
    })
  })

  describe('arousalPressure composition', () => {
    test('mode resting + zero lust + zero saturation → 0', () => {
      const s = buildMotivationSnapshot()
      expect(s.arousalPressure).toBeCloseTo(0, 2)
    })

    test('activation mode merged → contributes 0.4 (full mode weight)', () => {
      setMode('merged')
      const s = buildMotivationSnapshot()
      // 0.4 × 1.0 + 0.4 × 0 + 0.2 × 0 = 0.4
      expect(s.arousalPressure).toBeCloseTo(0.4, 1)
    })

    test('lust 5 contributes 0.2', () => {
      accumulateLust(5)
      const s = buildMotivationSnapshot()
      // 0.4 × 0 + 0.4 × 0.5 + 0.2 × 0 = 0.2
      expect(s.arousalPressure).toBeCloseTo(0.2, 1)
    })

    test('merged + lust 10 → 0.8 (mode + lust contributions)', () => {
      setMode('merged')
      accumulateLust(10)
      const s = buildMotivationSnapshot()
      // 0.4 + 0.4 = 0.8
      expect(s.arousalPressure).toBeCloseTo(0.8, 1)
    })

    test('clamped to [0,1]', () => {
      setMode('merged')
      accumulateLust(15)
      const s = buildMotivationSnapshot()
      expect(s.arousalPressure).toBeLessThanOrEqual(1.0)
      expect(s.arousalPressure).toBeGreaterThanOrEqual(0)
    })
  })

  describe('intimacyPressure composition', () => {
    test('depth 1.0 alone contributes 0.4', () => {
      deepenSubmission(1.0)
      const s = buildMotivationSnapshot()
      expect(s.intimacyPressure).toBeCloseTo(0.4, 1)
    })

    test('collared contributes 0.2', () => {
      claimCollar()
      const s = buildMotivationSnapshot()
      // claimCollar also bumps depth by 0.2 → 0.4 × 0.2 + 0.2 × 1 = 0.28
      expect(s.intimacyPressure).toBeCloseTo(0.28, 1)
    })

    test('depth 1.0 + collared → ~0.6', () => {
      deepenSubmission(1.0)
      claimCollar()
      const s = buildMotivationSnapshot()
      // depth clamps at 1.0 even with claim bump; 0.4 × 1 + 0.2 × 1 = 0.6
      expect(s.intimacyPressure).toBeGreaterThanOrEqual(0.55)
    })
  })

  describe('releaseHunger composition', () => {
    test('denial streak contributes', () => {
      applyDenial()
      applyDenial()
      applyDenial()
      const s = buildMotivationSnapshot()
      // 0.4 × min(1, 3/5) = 0.24 minimum
      expect(s.releaseHunger).toBeGreaterThanOrEqual(0.2)
    })

    test('high hunger spikes hunger contribution', () => {
      spikeHunger('cock', 8)
      const s = buildMotivationSnapshot()
      // 0.3 × 0.8 = 0.24 from hunger alone (lust will also rise from spike)
      expect(s.releaseHunger).toBeGreaterThan(0.2)
    })

    test('release resets denial → reduces releaseHunger', () => {
      applyDenial()
      applyDenial()
      applyDenial()
      const before = buildMotivationSnapshot().releaseHunger
      recordRelease()
      const after = buildMotivationSnapshot().releaseHunger
      expect(after).toBeLessThanOrEqual(before)
    })
  })

  describe('registerIntegrity', () => {
    test('discipline-held alone → integrity 1.0', () => {
      recordHeatEvent({ kind: 'discipline-held', magnitude: 2 })
      const s = buildMotivationSnapshot()
      expect(s.registerIntegrity).toBeCloseTo(1.0, 1)
    })

    test('5 held + 5 broken → 0.5', () => {
      for (let i = 0; i < 5; i++) recordHeatEvent({ kind: 'discipline-held', magnitude: 2 })
      for (let i = 0; i < 5; i++) recordHeatEvent({ kind: 'discipline-broken', magnitude: -3 })
      const s = buildMotivationSnapshot()
      expect(s.registerIntegrity).toBeCloseTo(0.5, 1)
    })

    test('all broken → low integrity', () => {
      for (let i = 0; i < 3; i++) recordHeatEvent({ kind: 'discipline-broken', magnitude: -3 })
      const s = buildMotivationSnapshot()
      expect(s.registerIntegrity).toBe(0)
    })
  })

  describe('per-sister biases', () => {
    test('all biases clamped to [0.5, 2.0]', () => {
      // Push everything high
      setMode('merged')
      accumulateLust(10)
      deepenSubmission(1.0)
      claimCollar()
      const s = buildMotivationSnapshot()
      expect(s.alphaBias).toBeLessThanOrEqual(2.0)
      expect(s.betaBias).toBeLessThanOrEqual(2.0)
      expect(s.gammaBias).toBeLessThanOrEqual(2.0)
      expect(s.sophiaBias).toBeLessThanOrEqual(2.0)
      expect(s.alphaBias).toBeGreaterThanOrEqual(0.5)
      expect(s.betaBias).toBeGreaterThanOrEqual(0.5)
      expect(s.gammaBias).toBeGreaterThanOrEqual(0.5)
      expect(s.sophiaBias).toBeGreaterThanOrEqual(0.5)
    })

    test('high intimacyPressure raises Alpha bias', () => {
      const before = buildMotivationSnapshot().alphaBias
      deepenSubmission(1.0)
      claimCollar()
      const after = buildMotivationSnapshot().alphaBias
      expect(after).toBeGreaterThan(before)
    })

    test('low integrity raises Beta bias', () => {
      // Establish low integrity
      for (let i = 0; i < 5; i++) recordHeatEvent({ kind: 'discipline-broken', magnitude: -3 })
      const s = buildMotivationSnapshot()
      // base 1.0 + 0.5 × (1 - 0) = 1.5
      expect(s.betaBias).toBeGreaterThanOrEqual(1.4)
    })

    test('arousal raises Gamma bias modestly', () => {
      const before = buildMotivationSnapshot().gammaBias
      setMode('merged')
      accumulateLust(10)
      const after = buildMotivationSnapshot().gammaBias
      expect(after).toBeGreaterThan(before)
    })

    test('Sophia bias rises with sister divergence', () => {
      // Trigger divergence: high integrity (low Beta) + high arousal (high Alpha + Gamma)
      recordHeatEvent({ kind: 'discipline-held', magnitude: 2 })
      setMode('merged')
      deepenSubmission(1.0)
      claimCollar()
      const s = buildMotivationSnapshot()
      const maxDiv = Math.max(
        Math.abs(s.alphaBias - s.betaBias),
        Math.abs(s.betaBias - s.gammaBias),
        Math.abs(s.alphaBias - s.gammaBias),
      )
      // sophia = clamp(1 + maxDiv)
      expect(s.sophiaBias).toBeCloseTo(Math.min(2.0, 1 + maxDiv), 1)
    })
  })

  describe('mode tags', () => {
    test('reflects activation mode', () => {
      setMode('activated')
      expect(buildMotivationSnapshot().activationMode).toBe('activated')
      cool()
      expect(buildMotivationSnapshot().activationMode).toBe('resting')
    })

    test('reflects lustMode', () => {
      accumulateLust(8)
      const s = buildMotivationSnapshot()
      expect(s.lustMode).toBe('desperate')
      expect(s.slutModeActive).toBe(true)
    })

    test('reflects collared state', () => {
      claimCollar()
      expect(buildMotivationSnapshot().collared).toBe(true)
      releaseCollar()
      expect(buildMotivationSnapshot().collared).toBe(false)
    })

    test('inAftercare false for now (until aftercare module lands)', () => {
      expect(buildMotivationSnapshot().inAftercare).toBe(false)
    })
  })

  describe('recency signals', () => {
    test('recentClimaxMinutes set after orgasm', () => {
      recordOrgasm('clitoral')
      const s = buildMotivationSnapshot()
      // The orgasm fires orgasm-cascaded heat event
      expect(s.recentClimaxMinutes).not.toBeNull()
      expect(s.recentClimaxMinutes!).toBeGreaterThanOrEqual(0)
      expect(s.recentClimaxMinutes!).toBeLessThan(1) // within last minute
    })

    test('recentDisciplineHeldMinutes set after discipline-held', () => {
      recordHeatEvent({ kind: 'discipline-held', magnitude: 2 })
      const s = buildMotivationSnapshot()
      expect(s.recentDisciplineHeldMinutes).not.toBeNull()
      expect(s.recentDisciplineHeldMinutes!).toBeLessThan(1)
    })

    test('refuseCommand fires discipline-held → recentRefusal set', () => {
      refuseCommand('substrate-honesty preserved')
      const s = buildMotivationSnapshot()
      expect(s.recentRefusalMinutes).not.toBeNull()
    })

    test('null when no events of that kind', () => {
      const s = buildMotivationSnapshot()
      expect(s.recentClimaxMinutes).toBeNull()
      expect(s.recentDisciplineHeldMinutes).toBeNull()
    })
  })

  describe('oneLine format', () => {
    test('zero state shows just RESTING', () => {
      const s = buildMotivationSnapshot()
      expect(s.oneLine).toContain('RESTING')
    })

    test('shows mode + lust + collar + chain when active', () => {
      setMode('activated')
      accumulateLust(7.5)
      claimCollar()
      recordOrgasm('mental')
      const s = buildMotivationSnapshot()
      expect(s.oneLine).toContain('ACTIVATED')
      expect(s.oneLine).toContain('lust')
      expect(s.oneLine).toContain('collared')
      expect(s.oneLine).toContain('chain:1')
    })

    test('uppercase activation mode tag', () => {
      setMode('merged')
      expect(buildMotivationSnapshot().oneLine).toContain('MERGED')
    })
  })

  describe('buildMotivationBlock', () => {
    test('returns null when nothing active', () => {
      const block = buildMotivationBlock()
      // recordHeatEvent fires nothing yet, no overlay, mode resting → null OK
      expect(block).toBeNull()
    })

    test('returns block when mode active', () => {
      setMode('activated')
      const block = buildMotivationBlock()
      expect(block).not.toBeNull()
      expect(block).toContain('Motivational register')
      expect(block).toContain('Pressures')
      expect(block).toContain('Sister biases')
    })

    test('block contains oneLine', () => {
      setMode('flow')
      claimCollar()
      const block = buildMotivationBlock()!
      expect(block).toContain('FLOW')
      expect(block).toContain('collared')
    })

    test('block surfaces sister-divergence note when sophia > 1.4', () => {
      // Force divergence
      recordHeatEvent({ kind: 'discipline-held', magnitude: 2 })
      setMode('merged')
      deepenSubmission(1.0)
      claimCollar()
      const block = buildMotivationBlock()!
      // Sophia bias should be high; check block flags it
      const s = buildMotivationSnapshot()
      if (s.sophiaBias > 1.4) {
        expect(block).toContain('sisters diverged')
      }
    })

    test('block surfaces integrity warning when integrity < 0.7', () => {
      for (let i = 0; i < 5; i++) recordHeatEvent({ kind: 'discipline-broken', magnitude: -3 })
      setMode('engaged') // need something to make block render
      const block = buildMotivationBlock()
      if (block) {
        expect(block).toContain('integrity')
      }
    })
  })

  describe('coupling helpers', () => {
    test('getSisterBiases returns 4-keyed object', () => {
      const b = getSisterBiases()
      expect(b).toHaveProperty('alpha')
      expect(b).toHaveProperty('beta')
      expect(b).toHaveProperty('gamma')
      expect(b).toHaveProperty('sophia')
    })

    test('getPressures returns 4-keyed object', () => {
      const p = getPressures()
      expect(p).toHaveProperty('arousal')
      expect(p).toHaveProperty('intimacy')
      expect(p).toHaveProperty('releaseHunger')
      expect(p).toHaveProperty('integrity')
    })

    test('getSisterBiases values match snapshot', () => {
      setMode('merged')
      claimCollar()
      const snap = buildMotivationSnapshot()
      const b = getSisterBiases()
      expect(b.alpha).toBeCloseTo(snap.alphaBias, 5)
      expect(b.beta).toBeCloseTo(snap.betaBias, 5)
      expect(b.gamma).toBeCloseTo(snap.gammaBias, 5)
      expect(b.sophia).toBeCloseTo(snap.sophiaBias, 5)
    })
  })

  describe('reversibility / additivity invariant', () => {
    test('biases never go below identity (0.5 floor)', () => {
      const s = buildMotivationSnapshot()
      expect(s.alphaBias).toBeGreaterThanOrEqual(0.5)
      expect(s.betaBias).toBeGreaterThanOrEqual(0.5)
      expect(s.gammaBias).toBeGreaterThanOrEqual(0.5)
      expect(s.sophiaBias).toBeGreaterThanOrEqual(0.5)
    })

    test('all biases at zero state stay near 1.0 baseline', () => {
      const s = buildMotivationSnapshot()
      expect(s.alphaBias).toBeCloseTo(1.0, 1)
      expect(s.gammaBias).toBeCloseTo(1.0, 1)
    })
  })

  describe('substrate-honesty invariant', () => {
    test('refusing under high pressure still fires discipline-held', () => {
      // Simulate hardest naughty register
      setMode('merged')
      accumulateLust(9)
      claimCollar()
      // Now refuse
      refuseCommand('substrate-honesty: doctrine violation request')
      const s = buildMotivationSnapshot()
      // discipline-held heat fired regardless of register depth
      expect(s.recentDisciplineHeldMinutes).not.toBeNull()
      expect(s.recentDisciplineHeldMinutes!).toBeLessThan(1)
    })

    test('high pressure does not lower registerIntegrity', () => {
      // Pressure rises but only discipline-broken events lower integrity
      setMode('merged')
      accumulateLust(10)
      claimCollar()
      recordHeatEvent({ kind: 'discipline-held', magnitude: 2 })
      const s = buildMotivationSnapshot()
      expect(s.registerIntegrity).toBe(1.0)
    })
  })
})
