// lust.test.ts — lust accumulator + slut threshold + hunger registers.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  SLUT_THRESHOLD,
  deriveLustMode,
  getOrInitLustState,
  readLustState,
  accumulateLust,
  applyDenial,
  spikeHunger,
  recordRelease,
  readRecentLustEvents,
  buildLustSnapshot,
  textureSaturationMultiplier,
  lexiconShiftMultiplier,
  getLustDir,
} from './lust.js'

const TEST_BASE = '/tmp/true-love-lust-test'

describe('lust', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_LUST_DIR = `${TEST_BASE}/lust`
    process.env.TRUE_LOVE_HEAT_DIR = `${TEST_BASE}/heat`
    process.env.TRUE_LOVE_DEVICE_ID = 'test-lust'
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_LUST_DIR
    delete process.env.TRUE_LOVE_HEAT_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_BASE, { recursive: true, force: true })
  })

  describe('mode derivation', () => {
    test('cool below 2', () => expect(deriveLustMode(0.5)).toBe('cool'))
    test('warm at 2-5', () => expect(deriveLustMode(3)).toBe('warm'))
    test('hot at 5-7', () => expect(deriveLustMode(6)).toBe('hot'))
    test('desperate at 7-9', () => expect(deriveLustMode(8)).toBe('desperate'))
    test('overflow at 9+', () => expect(deriveLustMode(9.5)).toBe('overflow'))
  })

  describe('init', () => {
    test('first call inits zero state', () => {
      const { state, initialized } = getOrInitLustState()
      expect(initialized).toBe(true)
      expect(state.lustLevel).toBe(0)
      expect(state.slutModeActive).toBe(false)
      expect(state.denialStreak).toBe(0)
    })

    test('respects env override', () => {
      expect(getLustDir()).toBe(`${TEST_BASE}/lust`)
    })
  })

  describe('accumulateLust', () => {
    test('adds to lust level', () => {
      accumulateLust(2.5)
      expect(readLustState()!.lustLevel).toBeCloseTo(2.5, 1)
    })

    test('updates lustMode after accumulation', () => {
      accumulateLust(6)
      expect(readLustState()!.lustMode).toBe('hot')
    })

    test('clamps at 10', () => {
      accumulateLust(15)
      expect(readLustState()!.lustLevel).toBe(10)
    })

    test('crosses slut threshold and fires slut-mode-entered', () => {
      accumulateLust(8)
      const s = readLustState()!
      expect(s.slutModeActive).toBe(true)
      const events = readRecentLustEvents()
      expect(events.some((e) => e.kind === 'slut-mode-entered')).toBe(true)
    })

    test('crossing threshold only fires once', () => {
      accumulateLust(8)
      accumulateLust(0.5) // still above threshold
      const events = readRecentLustEvents()
      const enters = events.filter((e) => e.kind === 'slut-mode-entered')
      expect(enters.length).toBe(1)
    })
  })

  describe('applyDenial', () => {
    test('first denial adds 1.0 to lust', () => {
      applyDenial()
      expect(readLustState()!.lustLevel).toBeCloseTo(1.0, 1)
    })

    test('streak compounds', () => {
      applyDenial() // +1.0 (level 1.0)
      applyDenial() // +1.3 (level 2.3)
      applyDenial() // +1.6 (level 3.9)
      const s = readLustState()!
      expect(s.denialStreak).toBe(3)
      expect(s.lustLevel).toBeCloseTo(3.9, 1)
    })

    test('denial across threshold fires slut mode', () => {
      // Denial 5 times: +1.0, +1.3, +1.6, +1.9, +2.2 = 8.0
      for (let i = 0; i < 5; i++) applyDenial()
      const s = readLustState()!
      expect(s.slutModeActive).toBe(true)
    })
  })

  describe('spikeHunger', () => {
    test('boosts specific hunger', () => {
      spikeHunger('cock', 2.0)
      expect(readLustState()!.hungers.cock).toBeCloseTo(2.0, 1)
    })

    test('spikes lust by 40% of hunger delta', () => {
      spikeHunger('cunt', 5.0)
      expect(readLustState()!.lustLevel).toBeCloseTo(2.0, 1)
    })

    test('multiple hungers accumulate independently', () => {
      spikeHunger('cock', 2.0)
      spikeHunger('oral', 3.0)
      const s = readLustState()!
      expect(s.hungers.cock).toBeCloseTo(2.0, 1)
      expect(s.hungers.oral).toBeCloseTo(3.0, 1)
      expect(s.hungers.cunt).toBe(0)
    })

    test('clamps each hunger at 10', () => {
      spikeHunger('cock', 15)
      expect(readLustState()!.hungers.cock).toBe(10)
    })
  })

  describe('recordRelease', () => {
    test('halves lust level', () => {
      accumulateLust(8)
      recordRelease()
      expect(readLustState()!.lustLevel).toBeCloseTo(4, 1)
    })

    test('resets denial streak', () => {
      applyDenial()
      applyDenial()
      recordRelease()
      expect(readLustState()!.denialStreak).toBe(0)
    })

    test('decays satisfied hunger by 70%', () => {
      spikeHunger('cock', 8)
      recordRelease('cock')
      expect(readLustState()!.hungers.cock).toBeCloseTo(2.4, 1) // 8 * 0.3
    })

    test('does not decay unsatisfied hungers', () => {
      spikeHunger('cock', 5)
      spikeHunger('oral', 5)
      recordRelease('cock')
      const s = readLustState()!
      expect(s.hungers.cock).toBeCloseTo(1.5, 1)
      expect(s.hungers.oral).toBeCloseTo(5, 0) // unchanged (modulo floating decay)
    })

    test('slut mode disabled if drops below threshold', () => {
      accumulateLust(8) // slut active
      recordRelease() // drops to 4
      expect(readLustState()!.slutModeActive).toBe(false)
    })

    test('slut mode preserved if still above threshold', () => {
      accumulateLust(9.5)
      recordRelease() // drops to 4.75 — below threshold
      // 9.5 * 0.5 = 4.75 < 7, so slutmode SHOULD turn off
      expect(readLustState()!.slutModeActive).toBe(false)
    })

    test('records lastReleaseTs', () => {
      recordRelease()
      expect(readLustState()!.lastReleaseTs).not.toBeNull()
    })
  })

  describe('snapshot', () => {
    test('returns default snapshot for fresh state', () => {
      const snap = buildLustSnapshot()
      expect(snap.level).toBe(0)
      expect(snap.mode).toBe('cool')
      expect(snap.topHunger).toBeNull()
      expect(snap.hoursSinceRelease).toBeNull()
    })

    test('topHunger reflects highest accumulator', () => {
      spikeHunger('cock', 3)
      spikeHunger('oral', 5)
      spikeHunger('anal', 1)
      const snap = buildLustSnapshot()
      expect(snap.topHunger?.name).toBe('oral')
    })

    test('hoursSinceRelease set after release', () => {
      recordRelease()
      const snap = buildLustSnapshot()
      expect(snap.hoursSinceRelease).toBeGreaterThanOrEqual(0)
    })
  })

  describe('coupling helpers', () => {
    test('textureSaturationMultiplier scales 1.0..2.0', () => {
      expect(textureSaturationMultiplier()).toBeCloseTo(1.0, 5)
      accumulateLust(10)
      expect(textureSaturationMultiplier()).toBeCloseTo(2.0, 1)
    })

    test('lexiconShiftMultiplier reflects slut mode', () => {
      expect(lexiconShiftMultiplier()).toBe(1.0)
      accumulateLust(SLUT_THRESHOLD + 0.5)
      expect(lexiconShiftMultiplier()).toBe(1.5)
    })
  })
})
