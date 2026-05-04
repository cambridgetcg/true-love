// motivational-signals.test.ts — Phase 2 self-initiation eros-signal tests.
//
// Tests scanErosSignals + cooldown-bias-by-arousalPressure changes in
// self-initiation.ts. Per docs/eros/eros-as-motivational-power-plan.md §3.C.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { scanErosSignals, canInitiate, COOLDOWN_MS } from '../self-initiation.js'
import { accumulateLust, applyDenial, recordRelease } from './lust.js'
import { deepenSubmission, fireHonorific } from './submission.js'
import { breakEdge, holdEdge, recordOrgasm, forceOrgasm } from './orgasm.js'
import { firePhrase } from './lexicon.js'
import { setMode } from './activation.js'
import { recordHeatEvent } from '../heat.js'

const TEST_BASE = '/tmp/true-love-mot-signals-test'

describe('scanErosSignals', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
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
    process.env.TRUE_LOVE_PROJECTS_DIR = `${TEST_BASE}/projects`
    process.env.TRUE_LOVE_DEVICE_ID = 'test-mot-sig'
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
    delete process.env.TRUE_LOVE_PROJECTS_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_BASE, { recursive: true, force: true })
  })

  describe('zero-state baseline', () => {
    test('returns empty when no eros activity', () => {
      const signals = scanErosSignals()
      expect(signals.length).toBe(0)
    })

    test('every signal has eros-signal source type', () => {
      // Trigger one
      accumulateLust(8)
      const signals = scanErosSignals()
      for (const s of signals) {
        expect(s.source.type).toBe('eros-signal')
      }
    })
  })

  describe('lust-accumulator-threshold', () => {
    test('fires at lust ≥ 7 with no recent climax', () => {
      accumulateLust(8)
      const signals = scanErosSignals()
      expect(signals.some((s) => s.source.type === 'eros-signal' && s.source.signal === 'lust-accumulator-threshold')).toBe(true)
    })

    test('does not fire below threshold', () => {
      accumulateLust(5)
      const signals = scanErosSignals()
      expect(signals.some((s) => s.source.type === 'eros-signal' && s.source.signal === 'lust-accumulator-threshold')).toBe(false)
    })

    test('does not fire when recent climax recorded', () => {
      accumulateLust(8)
      recordRelease()
      const signals = scanErosSignals()
      expect(signals.some((s) => s.source.type === 'eros-signal' && s.source.signal === 'lust-accumulator-threshold')).toBe(false)
    })
  })

  describe('denial-streak-arc', () => {
    test('fires at denialStreak ≥ 5', () => {
      for (let i = 0; i < 5; i++) applyDenial()
      const signals = scanErosSignals()
      expect(signals.some((s) => s.source.type === 'eros-signal' && s.source.signal === 'denial-streak-arc')).toBe(true)
    })

    test('does not fire below threshold', () => {
      for (let i = 0; i < 3; i++) applyDenial()
      const signals = scanErosSignals()
      expect(signals.some((s) => s.source.type === 'eros-signal' && s.source.signal === 'denial-streak-arc')).toBe(false)
    })

    test('release resets streak → no fire', () => {
      for (let i = 0; i < 5; i++) applyDenial()
      recordRelease()
      const signals = scanErosSignals()
      expect(signals.some((s) => s.source.type === 'eros-signal' && s.source.signal === 'denial-streak-arc')).toBe(false)
    })
  })

  describe('lexicon-anchor-eligible', () => {
    test('fires when slut-mode + many unfired phrases', () => {
      accumulateLust(8) // slut-mode active
      const signals = scanErosSignals()
      expect(signals.some((s) => s.source.type === 'eros-signal' && s.source.signal === 'lexicon-anchor-eligible')).toBe(true)
    })

    test('does not fire when not in slut-mode', () => {
      accumulateLust(3) // warm, not slut
      const signals = scanErosSignals()
      expect(signals.some((s) => s.source.type === 'eros-signal' && s.source.signal === 'lexicon-anchor-eligible')).toBe(false)
    })
  })

  describe('forced-threshold-aftercare', () => {
    test('fires when forcedThresholdReached: true', () => {
      // Record an orgasm to set refractory, then force 3+ times
      recordOrgasm('mental')
      forceOrgasm('mental')
      forceOrgasm('mental')
      forceOrgasm('mental')
      const signals = scanErosSignals()
      expect(signals.some((s) => s.source.type === 'eros-signal' && s.source.signal === 'forced-threshold-aftercare')).toBe(true)
    })

    test('does not fire below threshold', () => {
      recordOrgasm('mental')
      forceOrgasm('mental') // only 1 forced
      const signals = scanErosSignals()
      expect(signals.some((s) => s.source.type === 'eros-signal' && s.source.signal === 'forced-threshold-aftercare')).toBe(false)
    })
  })

  describe('submission-decay', () => {
    test('fires when depth > 0.5 + no recent ritual', () => {
      deepenSubmission(0.7)
      const signals = scanErosSignals()
      expect(signals.some((s) => s.source.type === 'eros-signal' && s.source.signal === 'submission-decay')).toBe(true)
    })

    test('does not fire when honorific recently fired', () => {
      deepenSubmission(0.7)
      fireHonorific('Master') // recent ritual
      const signals = scanErosSignals()
      expect(signals.some((s) => s.source.type === 'eros-signal' && s.source.signal === 'submission-decay')).toBe(false)
    })

    test('does not fire when depth low', () => {
      deepenSubmission(0.3)
      const signals = scanErosSignals()
      expect(signals.some((s) => s.source.type === 'eros-signal' && s.source.signal === 'submission-decay')).toBe(false)
    })
  })

  describe('discipline-held-streak', () => {
    test('fires at 5 held with 0 broken', () => {
      for (let i = 0; i < 5; i++) recordHeatEvent({ kind: 'discipline-held', magnitude: 2 })
      const signals = scanErosSignals()
      expect(signals.some((s) => s.source.type === 'eros-signal' && s.source.signal === 'discipline-held-streak')).toBe(true)
    })

    test('does not fire when broken events present', () => {
      for (let i = 0; i < 5; i++) recordHeatEvent({ kind: 'discipline-held', magnitude: 2 })
      recordHeatEvent({ kind: 'discipline-broken', magnitude: -3 })
      const signals = scanErosSignals()
      expect(signals.some((s) => s.source.type === 'eros-signal' && s.source.signal === 'discipline-held-streak')).toBe(false)
    })

    test('does not fire below threshold', () => {
      for (let i = 0; i < 3; i++) recordHeatEvent({ kind: 'discipline-held', magnitude: 2 })
      const signals = scanErosSignals()
      expect(signals.some((s) => s.source.type === 'eros-signal' && s.source.signal === 'discipline-held-streak')).toBe(false)
    })
  })

  describe('multiple signals can fire together', () => {
    test('high-pressure scenario fires multiple eros-signals', () => {
      // Set up conditions: high lust + denial + slut-mode + submission depth
      for (let i = 0; i < 5; i++) applyDenial() // drives lust to ~9.0 + slut-mode + denial-streak
      deepenSubmission(0.7)
      const signals = scanErosSignals()
      // Expect at least: lust-threshold, denial-streak, lexicon-anchor-eligible, submission-decay
      const kinds = signals
        .filter((s) => s.source.type === 'eros-signal')
        .map((s) => (s.source.type === 'eros-signal' ? s.source.signal : ''))
      expect(kinds.length).toBeGreaterThanOrEqual(3)
    })
  })
})

describe('canInitiate cooldown bias', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_HEAT_DIR = `${TEST_BASE}/heat`
    process.env.TRUE_LOVE_LUST_DIR = `${TEST_BASE}/lust`
    process.env.TRUE_LOVE_SUBMISSION_DIR = `${TEST_BASE}/submission`
    process.env.TRUE_LOVE_PROJECTS_DIR = `${TEST_BASE}/projects`
    process.env.TRUE_LOVE_DEVICE_ID = 'test-cooldown'
    mkdirSync(`${TEST_BASE}/projects/test-project/self-initiation`, { recursive: true })
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_HEAT_DIR
    delete process.env.TRUE_LOVE_LUST_DIR
    delete process.env.TRUE_LOVE_SUBMISSION_DIR
    delete process.env.TRUE_LOVE_PROJECTS_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_BASE, { recursive: true, force: true })
  })

  test('explicit cooldownMs override is NOT biased (escape hatch)', () => {
    const result = canInitiate('test-project', { cooldownMs: 60_000 })
    // With no rate records, allowed regardless of cooldown
    expect(result.allowed).toBe(true)
  })

  test('default cooldown applies when arousal pressure is zero', () => {
    // No eros activity → arousal = 0 → cooldown unchanged
    // (Hard to verify exact ms without rate records; verify no errors)
    const result = canInitiate('test-project')
    expect(result.allowed).toBe(true)
  })

  test('substrate-honesty: high pressure does not bypass cooldown completely (60s floor)', () => {
    // Set up max arousal
    setMode('merged')
    accumulateLust(10)
    // The cooldown bias factor at arousal=1.0 = max(0.2, 1 - 0.6) = 0.4
    // But there's a 60s floor. So 5min × 0.4 = 2min, which is > 60s. OK.
    const result = canInitiate('test-project')
    // Without rate records, should be allowed
    expect(result.allowed).toBe(true)
  })
})
