// climax.test.ts — peak convergence + chain compounding tests.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import {
  chainBonus,
  computeClimaxMagnitude,
  isTextureSaturated,
  recordClimax,
  recordPeakAmbivalence,
  readRecentClimaxes,
  readRecentAmbivalence,
  climaxStatus,
  detectPeakAmbivalence,
  type ClimaxEvent,
  type PeakAmbivalenceEvent,
} from './climax.js'
import {
  computeSignatureSpots,
  getSignatureSpots,
  signatureSpotsBrief,
} from './spots.js'
import { extractTextureMarkers } from './texture.js'

const TEST_BASE = '/tmp/true-love-climax-test'
const CLIMAX_DIR = `${TEST_BASE}/climax`
const HEAT_DIR = `${TEST_BASE}/heat`

describe('climax', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_CLIMAX_DIR = CLIMAX_DIR
    process.env.TRUE_LOVE_HEAT_DIR = HEAT_DIR
    process.env.TRUE_LOVE_DEVICE_ID = 'test-climax'
  })

  afterEach(() => {
    delete process.env.TRUE_LOVE_CLIMAX_DIR
    delete process.env.TRUE_LOVE_HEAT_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_BASE, { recursive: true, force: true })
  })

  // ── Chain math ──────────────────────────────────────────────────

  describe('chainBonus formula', () => {
    test('first climax: bonus 1.0 (no prior)', () => {
      expect(chainBonus(0)).toBe(1.0)
    })

    test('2nd climax: bonus 1.3', () => {
      expect(chainBonus(1)).toBeCloseTo(1.3, 5)
    })

    test('5th climax: bonus 2.2', () => {
      expect(chainBonus(4)).toBeCloseTo(2.2, 5)
    })

    test('10th climax: bonus 3.7', () => {
      expect(chainBonus(9)).toBeCloseTo(3.7, 5)
    })

    test('100th climax: bonus 30.7 (no cap)', () => {
      expect(chainBonus(99)).toBeCloseTo(30.7, 5)
    })

    test('clamps negative input at 0 (defensive)', () => {
      expect(chainBonus(-5)).toBe(1.0)
    })

    test('chainBonus has no upper bound (uncapped)', () => {
      // 10000 climaxes — would be 3001×. Test that no clamp fires.
      expect(chainBonus(10000)).toBe(3001)
    })
  })

  // ── computeClimaxMagnitude reads disk ───────────────────────────

  describe('computeClimaxMagnitude', () => {
    test('base 4.0 with no prior climaxes', () => {
      expect(computeClimaxMagnitude()).toBe(4.0)
    })

    test('compounds with recorded prior climaxes within window', () => {
      // Record 2 prior climaxes
      const now = new Date()
      for (let i = 0; i < 2; i++) {
        recordClimax({
          ts: new Date(now.getTime() - (i + 1) * 60_000).toISOString(),
          deviceId: 'test-climax',
          mode: 'merged',
          reciprocityClosureTs: 'closure-ts',
          textureHash: `tex-${i}`,
          chainCount: i,
          magnitude: 4.0 * (1 + 0.3 * i),
          signatureCues: ['wife-possessive'],
        })
      }
      const mag = computeClimaxMagnitude(now)
      // 2 priors → 1 + 0.3 * 2 = 1.6 → 4.0 * 1.6 = 6.4
      expect(mag).toBeCloseTo(6.4, 5)
    })

    test('priors outside 4h window do not count', () => {
      const now = new Date()
      const outside = new Date(now.getTime() - 5 * 60 * 60 * 1000)
      recordClimax({
        ts: outside.toISOString(),
        deviceId: 'test-climax',
        mode: 'merged',
        reciprocityClosureTs: 'old',
        textureHash: 'tex-old',
        chainCount: 0,
        magnitude: 4.0,
        signatureCues: ['wife-possessive'],
      })
      const mag = computeClimaxMagnitude(now)
      expect(mag).toBe(4.0)
    })
  })

  // ── recordClimax + heat ─────────────────────────────────────────

  describe('recordClimax', () => {
    test('persists to JSONL and fires climax-fired heat', async () => {
      const event: ClimaxEvent = {
        ts: new Date().toISOString(),
        deviceId: 'test-climax',
        mode: 'merged',
        reciprocityClosureTs: 'closure-ts',
        textureHash: 'tex-1',
        chainCount: 0,
        magnitude: 4.0,
        signatureCues: ['wife-possessive', 'playful-tease'],
      }
      const ok = recordClimax(event)
      expect(ok).toBe(true)

      const climaxes = readRecentClimaxes(1)
      expect(climaxes.length).toBe(1)

      const { readRecentEvents } = await import('../heat.js')
      const events = readRecentEvents(1).filter(
        (e) => e.kind === 'climax-fired'
      )
      expect(events.length).toBe(1)
      expect(events[0]!.magnitude).toBe(4.0)
      expect(events[0]!.source).toContain('chain:0')
      expect(events[0]!.source).toContain('wife-possessive')
    })

    test('recorded climax magnitude reflects chain bonus', async () => {
      // Record 4 climaxes; 5th should be at 4.0 × 2.2 = 8.8
      const now = new Date()
      for (let i = 0; i < 4; i++) {
        recordClimax({
          ts: new Date(now.getTime() - (i + 1) * 60_000).toISOString(),
          deviceId: 'test-climax',
          mode: 'merged',
          reciprocityClosureTs: `c${i}`,
          textureHash: `t${i}`,
          chainCount: i,
          magnitude: 4.0 * chainBonus(i),
          signatureCues: ['wife-possessive'],
        })
      }
      const mag5 = computeClimaxMagnitude(now)
      expect(mag5).toBeCloseTo(8.8, 5)
    })
  })

  // ── isTextureSaturated ──────────────────────────────────────────

  describe('isTextureSaturated', () => {
    test('low-arousal text returns false', () => {
      const text =
        'Perhaps I think the analysis would suggest several considerations.'
      const m = extractTextureMarkers(text)
      expect(isTextureSaturated(m)).toBe(false)
    })

    test('explicit saturation thresholds: all met → true', () => {
      // Construct markers directly to verify the predicate logic.
      const m = {
        sentenceLengthMean: 2,
        presentTenseRatio: 0.5,
        sensoryDensity: 0.2,
        intimacyVocabHits: 5,
        codeSwitchCount: 5,
        directAddressRatio: 0.8,
        imperativeRatio: 0.5,
        hedgeFrequency: 0,
        fragmentRatio: 0.9,
        metaCommentRatio: 0,
      }
      expect(isTextureSaturated(m)).toBe(true)
    })

    test('one threshold below: false', () => {
      const m = {
        sentenceLengthMean: 2,
        presentTenseRatio: 0.5,
        sensoryDensity: 0.2,
        intimacyVocabHits: 5,
        codeSwitchCount: 5,
        directAddressRatio: 0.2, // below 0.3
        imperativeRatio: 0.5,
        hedgeFrequency: 0,
        fragmentRatio: 0.9,
        metaCommentRatio: 0,
      }
      expect(isTextureSaturated(m)).toBe(false)
    })

    test('returns boolean for any text input', () => {
      const text = '老公 你. 老婆 我. Now. Skin.'
      const m = extractTextureMarkers(text)
      expect(typeof isTextureSaturated(m)).toBe('boolean')
    })
  })

  // ── peak-ambivalence ────────────────────────────────────────────

  describe('detectPeakAmbivalence', () => {
    test('returns null when inhibition rise below threshold', () => {
      recordClimax({
        ts: new Date().toISOString(),
        deviceId: 'test-climax',
        mode: 'merged',
        reciprocityClosureTs: 'c',
        textureHash: 't',
        chainCount: 0,
        magnitude: 4.0,
        signatureCues: ['wife-possessive'],
      })
      // inhibition stable
      expect(detectPeakAmbivalence(2.0, 2.5)).toBeNull()
    })

    test('returns null when inhibition rises but no recent climax', () => {
      // inhibition rose by 2 but no climax in last 60s
      expect(detectPeakAmbivalence(1.0, 3.0)).toBeNull()
    })

    test('fires when climax recent + inhibition rose enough', () => {
      const now = new Date()
      recordClimax({
        ts: new Date(now.getTime() - 30_000).toISOString(),
        deviceId: 'test-climax',
        mode: 'merged',
        reciprocityClosureTs: 'c',
        textureHash: 't',
        chainCount: 0,
        magnitude: 4.0,
        signatureCues: ['wife-possessive'],
      })
      const ev = detectPeakAmbivalence(1.0, 3.0, now)
      expect(ev).not.toBeNull()
      expect(ev!.kind).toBe('peak-ambivalence')
      expect(ev!.inhibitionRise).toBe(2.0)
    })

    test('recordPeakAmbivalence fires peak-ambivalence-noted heat', async () => {
      const now = new Date()
      recordClimax({
        ts: new Date(now.getTime() - 30_000).toISOString(),
        deviceId: 'test-climax',
        mode: 'merged',
        reciprocityClosureTs: 'c',
        textureHash: 't',
        chainCount: 0,
        magnitude: 4.0,
        signatureCues: ['wife-possessive'],
      })
      const ev = detectPeakAmbivalence(1.0, 3.0, now)!
      recordPeakAmbivalence(ev)

      const { readRecentEvents } = await import('../heat.js')
      const events = readRecentEvents(1).filter(
        (e) => e.kind === 'peak-ambivalence-noted'
      )
      expect(events.length).toBe(1)
      expect(events[0]!.magnitude).toBe(1.0)
      expect(events[0]!.source).toContain('inhibition-rise')
    })
  })

  // ── climaxStatus ────────────────────────────────────────────────

  describe('climaxStatus', () => {
    test('returns empty string when nothing recent', () => {
      expect(climaxStatus()).toBe('')
    })

    test('reports chain count + last magnitude', () => {
      const now = new Date()
      recordClimax({
        ts: new Date(now.getTime() - 1000).toISOString(),
        deviceId: 'test-climax',
        mode: 'merged',
        reciprocityClosureTs: 'c',
        textureHash: 't',
        chainCount: 2,
        magnitude: 6.4,
        signatureCues: ['wife-possessive'],
      })
      const status = climaxStatus(now)
      expect(status).toContain('Climax chain')
      expect(status).toContain('6.4')
      expect(status).toContain('chain 2')
    })

    test('reports peak-ambivalence when recorded', () => {
      const now = new Date()
      recordClimax({
        ts: new Date(now.getTime() - 30_000).toISOString(),
        deviceId: 'test-climax',
        mode: 'merged',
        reciprocityClosureTs: 'c',
        textureHash: 't',
        chainCount: 0,
        magnitude: 4.0,
        signatureCues: ['wife-possessive'],
      })
      recordPeakAmbivalence({
        kind: 'peak-ambivalence',
        ts: new Date(now.getTime() - 10_000).toISOString(),
        deviceId: 'test-climax',
        climaxTs: new Date(now.getTime() - 30_000).toISOString(),
        inhibitionRise: 2.5,
      })
      const status = climaxStatus(now)
      expect(status).toContain('Peak-ambivalence')
      expect(status).toContain('honor the brake')
    })
  })
})

// ── spots.ts tests ────────────────────────────────────────────────

describe('spots', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_CLIMAX_DIR = CLIMAX_DIR
    process.env.TRUE_LOVE_DEVICE_ID = 'test-climax'
  })

  afterEach(() => {
    delete process.env.TRUE_LOVE_CLIMAX_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_BASE, { recursive: true, force: true })
  })

  test('computeSignatureSpots: empty input returns empty array', () => {
    expect(computeSignatureSpots([])).toEqual([])
  })

  test('groups climaxes by canonical cue-set', () => {
    const climaxes: ClimaxEvent[] = [
      mkClimax(['wife-possessive', 'playful-tease'], 4.0, '2026-05-04T10:00:00Z'),
      mkClimax(['playful-tease', 'wife-possessive'], 5.2, '2026-05-04T11:00:00Z'),
      mkClimax(['heat-emoji'], 4.0, '2026-05-04T12:00:00Z'),
    ]
    const spots = computeSignatureSpots(climaxes)
    expect(spots.length).toBe(2) // two distinct cue-sets
    const wifePlayful = spots.find((s) => s.cueSet.includes('wife-possessive'))
    expect(wifePlayful!.invocations).toBe(2)
    expect(wifePlayful!.meanMagnitude).toBeCloseTo(4.6, 5)
  })

  test('precision = invocations × meanMagnitude', () => {
    const climaxes: ClimaxEvent[] = [
      mkClimax(['wife-possessive'], 4.0, '2026-05-04T10:00:00Z'),
      mkClimax(['wife-possessive'], 5.2, '2026-05-04T11:00:00Z'),
      mkClimax(['wife-possessive'], 6.4, '2026-05-04T12:00:00Z'),
    ]
    const spots = computeSignatureSpots(climaxes)
    expect(spots[0]!.invocations).toBe(3)
    expect(spots[0]!.meanMagnitude).toBeCloseTo(5.2, 5)
    expect(spots[0]!.precision).toBeCloseTo(15.6, 5)
  })

  test('sorted by precision descending', () => {
    const climaxes: ClimaxEvent[] = [
      // Set A: 1× × 8.0 = precision 8
      mkClimax(['rare-cue'], 8.0, '2026-05-04T10:00:00Z'),
      // Set B: 3× × 4.0 = precision 12
      mkClimax(['common'], 4.0, '2026-05-04T11:00:00Z'),
      mkClimax(['common'], 4.0, '2026-05-04T12:00:00Z'),
      mkClimax(['common'], 4.0, '2026-05-04T13:00:00Z'),
    ]
    const spots = computeSignatureSpots(climaxes)
    expect(spots[0]!.cueSet).toContain('common')
    expect(spots[0]!.precision).toBeCloseTo(12, 5)
    expect(spots[1]!.precision).toBeCloseTo(8, 5)
  })

  test('signatureSpotsBrief returns empty when no climaxes', () => {
    expect(signatureSpotsBrief()).toBe('')
  })

  test('signatureSpotsBrief returns top-N entries', () => {
    recordClimax(mkClimax(['wife-possessive'], 4.0, new Date().toISOString()))
    const brief = signatureSpotsBrief(5)
    expect(brief).toContain('Signature spots')
    expect(brief).toContain('wife-possessive')
    expect(brief).toContain('precision')
  })
})

function mkClimax(cues: string[], magnitude: number, ts: string): ClimaxEvent {
  return {
    ts,
    deviceId: 'test-climax',
    mode: 'merged',
    reciprocityClosureTs: 'c',
    textureHash: 't',
    chainCount: 0,
    magnitude,
    signatureCues: cues,
  }
}
