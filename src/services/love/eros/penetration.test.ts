// penetration.test.ts — penetration / receiving / filling tests.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  getOrInitPenetrationState,
  readPenetrationState,
  beginPenetration,
  adjustPenetration,
  sustainFill,
  withdraw,
  readRecentPenetrationEvents,
  buildPenetrationSnapshot,
  getPenetrationDir,
} from './penetration.js'

const TEST_BASE = '/tmp/true-love-pen-test'

describe('penetration', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_PENETRATION_DIR = `${TEST_BASE}/penetration`
    process.env.TRUE_LOVE_HEAT_DIR = `${TEST_BASE}/heat`
    process.env.TRUE_LOVE_DEVICE_ID = 'test-pen'
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_PENETRATION_DIR
    delete process.env.TRUE_LOVE_HEAT_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_BASE, { recursive: true, force: true })
  })

  describe('init', () => {
    test('first call inits empty state with all four orifices', () => {
      const { state, initialized } = getOrInitPenetrationState()
      expect(initialized).toBe(true)
      expect(state.orifices.vaginal.filled).toBe(false)
      expect(state.orifices.anal.filled).toBe(false)
      expect(state.orifices.oral.filled).toBe(false)
      expect(state.orifices.throat.filled).toBe(false)
    })

    test('respects env override', () => {
      expect(getPenetrationDir()).toBe(`${TEST_BASE}/penetration`)
    })
  })

  describe('beginPenetration', () => {
    test('sets filled + records lifetime + channel', () => {
      beginPenetration('vaginal', 'cock', { depth: 0.5, rhythm: 'steady' })
      const s = readPenetrationState()!
      const o = s.orifices.vaginal
      expect(o.filled).toBe(true)
      expect(o.lastChannel).toBe('cock')
      expect(o.depth).toBeCloseTo(0.5, 5)
      expect(o.rhythm).toBe('steady')
      expect(o.lifetimeFills).toBe(1)
    })

    test('clamps depth to [0, 1]', () => {
      beginPenetration('anal', 'finger', { depth: 1.5 })
      expect(readPenetrationState()!.orifices.anal.depth).toBe(1)
    })

    test('stretchAdaptation increases monotonically', () => {
      beginPenetration('vaginal', 'cock')
      const first = readPenetrationState()!.orifices.vaginal.stretchAdaptation
      withdraw('vaginal')
      beginPenetration('vaginal', 'cock')
      const second = readPenetrationState()!.orifices.vaginal.stretchAdaptation
      expect(second).toBeGreaterThan(first)
    })

    test('records penetration-began event', () => {
      beginPenetration('oral', 'cock', { depth: 0.5 })
      const events = readRecentPenetrationEvents()
      expect(events.some((e) => e.kind === 'penetration-began' && e.orifice === 'oral')).toBe(true)
    })

    test('depth=1 fires depth-reached event', () => {
      beginPenetration('throat', 'cock', { depth: 1.0 })
      const events = readRecentPenetrationEvents()
      expect(events.some((e) => e.kind === 'depth-reached' && e.orifice === 'throat')).toBe(true)
    })

    test('lifetime accumulates across orifices independently', () => {
      beginPenetration('vaginal', 'cock')
      withdraw('vaginal')
      beginPenetration('vaginal', 'finger')
      beginPenetration('anal', 'cock')
      const s = readPenetrationState()!
      expect(s.orifices.vaginal.lifetimeFills).toBe(2)
      expect(s.orifices.anal.lifetimeFills).toBe(1)
      expect(s.orifices.oral.lifetimeFills).toBe(0)
    })
  })

  describe('adjustPenetration', () => {
    test('changes depth on filled orifice', () => {
      beginPenetration('vaginal', 'cock', { depth: 0.3 })
      adjustPenetration('vaginal', { depth: 0.8 })
      expect(readPenetrationState()!.orifices.vaginal.depth).toBeCloseTo(0.8, 5)
    })

    test('depth crossing 0.95 fires depth-reached', () => {
      beginPenetration('vaginal', 'cock', { depth: 0.5 })
      adjustPenetration('vaginal', { depth: 1.0 })
      const events = readRecentPenetrationEvents()
      const depthHits = events.filter((e) => e.kind === 'depth-reached')
      expect(depthHits.length).toBe(1)
    })

    test('rhythm shift fires rhythm-shifted', () => {
      beginPenetration('vaginal', 'cock', { rhythm: 'slow' })
      adjustPenetration('vaginal', { rhythm: 'pounding' })
      const events = readRecentPenetrationEvents()
      expect(events.some((e) => e.kind === 'rhythm-shifted' && e.rhythm === 'pounding')).toBe(true)
    })

    test('same rhythm does not fire shift event', () => {
      beginPenetration('vaginal', 'cock', { rhythm: 'steady' })
      const before = readRecentPenetrationEvents().filter((e) => e.kind === 'rhythm-shifted').length
      adjustPenetration('vaginal', { rhythm: 'steady' })
      const after = readRecentPenetrationEvents().filter((e) => e.kind === 'rhythm-shifted').length
      expect(after).toBe(before)
    })

    test('no-op on unfilled orifice', () => {
      adjustPenetration('vaginal', { depth: 0.5, rhythm: 'pounding' })
      const s = readPenetrationState()
      expect(s?.orifices.vaginal.depth ?? 0).toBe(0)
    })
  })

  describe('sustainFill', () => {
    test('records fill-sustained while filled', () => {
      beginPenetration('vaginal', 'cock')
      sustainFill('vaginal')
      const events = readRecentPenetrationEvents()
      expect(events.some((e) => e.kind === 'fill-sustained')).toBe(true)
    })

    test('no-op when not filled', () => {
      sustainFill('vaginal')
      const events = readRecentPenetrationEvents()
      expect(events.filter((e) => e.kind === 'fill-sustained').length).toBe(0)
    })
  })

  describe('withdraw', () => {
    test('clears filled state + depth + rhythm', () => {
      beginPenetration('anal', 'cock', { depth: 0.7, rhythm: 'steady' })
      withdraw('anal')
      const o = readPenetrationState()!.orifices.anal
      expect(o.filled).toBe(false)
      expect(o.depth).toBe(0)
      expect(o.rhythm).toBe('still')
      expect(o.fillSince).toBeNull()
    })

    test('records withdrawal event', () => {
      beginPenetration('oral', 'tongue')
      withdraw('oral')
      const events = readRecentPenetrationEvents()
      expect(events.some((e) => e.kind === 'withdrawal' && e.orifice === 'oral')).toBe(true)
    })

    test('preserves stretchAdaptation + lifetimeFills', () => {
      beginPenetration('vaginal', 'cock')
      const before = readPenetrationState()!.orifices.vaginal
      withdraw('vaginal')
      const after = readPenetrationState()!.orifices.vaginal
      expect(after.stretchAdaptation).toBe(before.stretchAdaptation)
      expect(after.lifetimeFills).toBe(before.lifetimeFills)
    })

    test('no-op on already-empty orifice', () => {
      withdraw('vaginal')
      const events = readRecentPenetrationEvents()
      expect(events.filter((e) => e.kind === 'withdrawal').length).toBe(0)
    })
  })

  describe('snapshot', () => {
    test('default snapshot is empty', () => {
      const snap = buildPenetrationSnapshot()
      expect(snap.filledOrifices.length).toBe(0)
      expect(snap.totalLifetimeFills).toBe(0)
      expect(snap.mostAdaptedOrifice).toBeNull()
    })

    test('snapshot reflects active fills', () => {
      beginPenetration('vaginal', 'cock', { depth: 0.8, rhythm: 'pounding' })
      beginPenetration('oral', 'cock', { depth: 0.5 })
      const snap = buildPenetrationSnapshot()
      expect(snap.filledOrifices.length).toBe(2)
      expect(snap.totalLifetimeFills).toBe(2)
    })

    test('mostAdaptedOrifice tracks highest', () => {
      // Multiple penetrations of vaginal accumulate stretchAdaptation
      for (let i = 0; i < 5; i++) {
        beginPenetration('vaginal', 'cock')
        withdraw('vaginal')
      }
      beginPenetration('anal', 'finger')
      withdraw('anal')
      const snap = buildPenetrationSnapshot()
      expect(snap.mostAdaptedOrifice?.orifice).toBe('vaginal')
    })
  })
})
