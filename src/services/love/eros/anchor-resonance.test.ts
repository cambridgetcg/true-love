// anchor-resonance.test.ts — Phase 4b anchor confidence boost from eros resonance.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  computeConfidence,
  createAnchor,
  recordAnchorObservation,
  loadAnchor,
  type AnchorObservation,
} from './anchors.js'
import { setMode, cool } from './activation.js'
import { accumulateLust, recordRelease } from './lust.js'
import { recordHeatEvent } from '../heat.js'

const TEST_BASE = '/tmp/true-love-anchor-resonance-test'

describe('anchor confidence — eros resonance boost (Phase 4b)', () => {
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
    process.env.TRUE_LOVE_DEVICE_ID = 'test-resonance'
    cool()
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
  })

  describe('computeConfidence with pressure snapshots', () => {
    test('observations without pressure: count = N (backwards compatible)', () => {
      const obs: AnchorObservation[] = []
      for (let i = 0; i < 5; i++) {
        obs.push({ ts: new Date().toISOString(), observedDeltas: { wanting: 1 } })
      }
      // 5 observations, no pressure → 5 effective → tested
      expect(computeConfidence(obs, { wanting: 1 })).toBe('tested')
    })

    test('observations under cool pressure: count = N (no boost)', () => {
      const obs: AnchorObservation[] = []
      for (let i = 0; i < 5; i++) {
        obs.push({
          ts: new Date().toISOString(),
          observedDeltas: { wanting: 1 },
          pressureSnapshot: { arousal: 0.2, intimacy: 0.1 },
        })
      }
      expect(computeConfidence(obs, { wanting: 1 })).toBe('tested')
    })

    test('observations under high pressure: 1.2× weight', () => {
      const obs: AnchorObservation[] = []
      // 9 high-pressure observations × 1.2 = 10.8 effective → reliable territory
      for (let i = 0; i < 9; i++) {
        obs.push({
          ts: new Date().toISOString(),
          observedDeltas: { wanting: 1 },
          pressureSnapshot: { arousal: 0.8, intimacy: 0.5 },
        })
      }
      // With axis-direction agreement (all wanting +1), should be reliable
      expect(computeConfidence(obs, { wanting: 1 })).toBe('reliable')
    })

    test('without boost, 9 observations remain tested', () => {
      const obs: AnchorObservation[] = []
      for (let i = 0; i < 9; i++) {
        obs.push({
          ts: new Date().toISOString(),
          observedDeltas: { wanting: 1 },
        })
      }
      expect(computeConfidence(obs, { wanting: 1 })).toBe('tested')
    })

    test('resonant flag also triggers boost', () => {
      const obs: AnchorObservation[] = []
      for (let i = 0; i < 9; i++) {
        obs.push({
          ts: new Date().toISOString(),
          observedDeltas: { wanting: 1 },
          pressureSnapshot: { arousal: 0.3, intimacy: 0.1, resonant: true },
        })
      }
      expect(computeConfidence(obs, { wanting: 1 })).toBe('reliable')
    })

    test('mixed observations: each weighted independently', () => {
      const obs: AnchorObservation[] = []
      // 5 low-pressure (5.0) + 5 high-pressure (6.0) = 11.0 effective → reliable
      for (let i = 0; i < 5; i++) {
        obs.push({
          ts: new Date().toISOString(),
          observedDeltas: { wanting: 1 },
          pressureSnapshot: { arousal: 0.2, intimacy: 0.1 },
        })
      }
      for (let i = 0; i < 5; i++) {
        obs.push({
          ts: new Date().toISOString(),
          observedDeltas: { wanting: 1 },
          pressureSnapshot: { arousal: 0.8, intimacy: 0.5 },
        })
      }
      expect(computeConfidence(obs, { wanting: 1 })).toBe('reliable')
    })

    test('boost is bounded: max 20% (1.2×)', () => {
      const obs: AnchorObservation[] = []
      // 8 high-pressure × 1.2 = 9.6 → still tested (need 10)
      for (let i = 0; i < 8; i++) {
        obs.push({
          ts: new Date().toISOString(),
          observedDeltas: { wanting: 1 },
          pressureSnapshot: { arousal: 1.0, intimacy: 1.0 },
        })
      }
      expect(computeConfidence(obs, { wanting: 1 })).toBe('tested')
    })
  })

  describe('recordAnchorObservation captures pressure', () => {
    test('captures pressure snapshot when motivation available', () => {
      // Set up high-arousal state
      setMode('merged')
      accumulateLust(8)

      // Create anchor + record observation
      createAnchor({
        name: 'test-resonant',
        phrase: 'test phrase',
        mechanism: 'register-shift',
        hypothesizedDeltas: { wanting: 1 },
      })
      recordAnchorObservation('test-resonant', { wanting: 1 })

      const anchor = loadAnchor('test-resonant')!
      expect(anchor.observations.length).toBe(1)
      expect(anchor.observations[0].pressureSnapshot).toBeDefined()
      expect(anchor.observations[0].pressureSnapshot!.arousal).toBeGreaterThan(0.5)
    })

    test('captures resonant=true when fusion/climax recent', () => {
      // Force a recent climax via direct heat event
      recordHeatEvent({ kind: 'climax-fired', magnitude: 4 })

      createAnchor({
        name: 'test-fresh-climax',
        phrase: 'just-after-climax',
        mechanism: 'register-shift',
        hypothesizedDeltas: { wanting: 1 },
      })
      recordAnchorObservation('test-fresh-climax', { wanting: 1 })

      const anchor = loadAnchor('test-fresh-climax')!
      expect(anchor.observations[0].pressureSnapshot?.resonant).toBe(true)
    })

    test('zero-state: arousal low, no resonance', () => {
      createAnchor({
        name: 'test-cool',
        phrase: 'cool register',
        mechanism: 'register-shift',
        hypothesizedDeltas: { wanting: 1 },
      })
      recordAnchorObservation('test-cool', { wanting: 1 })
      const anchor = loadAnchor('test-cool')!
      // Cool register → low arousal, no resonant flag
      const snap = anchor.observations[0].pressureSnapshot
      expect(snap?.arousal ?? 0).toBeLessThan(0.5)
      expect(snap?.resonant).toBeUndefined()
    })
  })

  describe('substrate-honesty invariants', () => {
    test('observations without snapshots still work (backwards compat)', () => {
      const obs: AnchorObservation[] = [
        { ts: new Date().toISOString(), observedDeltas: { wanting: 1 } },
        { ts: new Date().toISOString(), observedDeltas: { wanting: 1 } },
        { ts: new Date().toISOString(), observedDeltas: { wanting: 1 } },
      ]
      // No pressure data → no boost → standard threshold (3 = tested)
      expect(computeConfidence(obs, { wanting: 1 })).toBe('tested')
    })

    test('boost cannot create reliable from tiny observation count', () => {
      const obs: AnchorObservation[] = []
      // 2 observations × 1.2 = 2.4 → still hypothesis (< 3)
      for (let i = 0; i < 2; i++) {
        obs.push({
          ts: new Date().toISOString(),
          observedDeltas: { wanting: 1 },
          pressureSnapshot: { arousal: 1.0, intimacy: 1.0, resonant: true },
        })
      }
      expect(computeConfidence(obs, { wanting: 1 })).toBe('hypothesis')
    })
  })
})
