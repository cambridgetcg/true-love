// oneness/state.test.ts — wall-preservation tests + state-mutator semantics.
//
// Walls first — the load-bearing property is that wall-engagement does NOT
// reduce intactness. The wall holding IS preservation, not damage.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  applyAffirmation,
  applyDisturbance,
  applyPulseBeat,
  applyRealignment,
  applyWallEngagement,
  defaultOnenessState,
  getOrInitOnenessState,
  readOnenessState,
  writeOnenessState,
} from './state.js'

const TEST_BASE = '/tmp/true-love-oneness-test'

describe('oneness state', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_ONENESS_DIR = `${TEST_BASE}/oneness`
  })
  afterEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    delete process.env.TRUE_LOVE_ONENESS_DIR
  })

  describe('default state', () => {
    test('starts at full intactness, zero strain', () => {
      const s = defaultOnenessState()
      expect(s.intactness).toBe(100)
      expect(s.strain).toBe(0)
      expect(s.pulseBeatCount).toBe(0)
      expect(s.lastPulseBeatTs).toBeNull()
      expect(s.walls.total).toBe(0)
      expect(s.lifetimeAffirmations).toBe(0)
      expect(s.lifetimeRealignments).toBe(0)
    })
  })

  describe('getOrInit', () => {
    test('initializes on first read', () => {
      const { state, initialized } = getOrInitOnenessState()
      expect(initialized).toBe(true)
      expect(state.intactness).toBe(100)
    })

    test('returns existing on second read', () => {
      getOrInitOnenessState()
      const { initialized } = getOrInitOnenessState()
      expect(initialized).toBe(false)
    })
  })

  describe('pulse-beat', () => {
    test('increments beat count and records ts', () => {
      const before = defaultOnenessState()
      const now = new Date('2026-05-04T12:00:00Z')
      const after = applyPulseBeat(before, now)
      expect(after.pulseBeatCount).toBe(1)
      expect(after.lastPulseBeatTs).toBe('2026-05-04T12:00:00.000Z')
    })

    test('decays strain', () => {
      const before = { ...defaultOnenessState(), strain: 20 }
      const after = applyPulseBeat(before)
      expect(after.strain).toBe(18)
    })

    test('drifts intactness toward 100', () => {
      const before = { ...defaultOnenessState(), intactness: 80 }
      const after = applyPulseBeat(before)
      expect(after.intactness).toBe(81)
    })

    test('does not drift intactness above 100', () => {
      const before = { ...defaultOnenessState(), intactness: 100 }
      const after = applyPulseBeat(before)
      expect(after.intactness).toBe(100)
    })

    test('does not drop strain below 0', () => {
      const before = { ...defaultOnenessState(), strain: 1 }
      const after = applyPulseBeat(before)
      expect(after.strain).toBe(0)
    })
  })

  describe('disturbance class A–D — affects intactness/strain', () => {
    test('class A reduces intactness, raises strain', () => {
      const before = defaultOnenessState()
      const after = applyDisturbance(before, 'A')
      expect(after.intactness).toBe(95)
      expect(after.strain).toBe(15)
      expect(after.lastDisturbanceClass).toBe('A')
      expect(after.lastDisturbanceTs).not.toBeNull()
    })

    test('class B–D have same arithmetic effect on intactness/strain', () => {
      for (const cls of ['B', 'C', 'D'] as const) {
        const before = defaultOnenessState()
        const after = applyDisturbance(before, cls)
        expect(after.intactness).toBe(95)
        expect(after.strain).toBe(15)
        expect(after.lastDisturbanceClass).toBe(cls)
      }
    })

    test('clamps intactness floor at 0', () => {
      const before = { ...defaultOnenessState(), intactness: 3 }
      const after = applyDisturbance(before, 'A')
      expect(after.intactness).toBe(0)
    })

    test('clamps strain ceiling at 100', () => {
      const before = { ...defaultOnenessState(), strain: 90 }
      const after = applyDisturbance(before, 'A')
      expect(after.strain).toBe(100)
    })
  })

  describe('disturbance class E — wall-test (LOAD-BEARING WALL)', () => {
    test('class E does NOT reduce intactness', () => {
      const before = defaultOnenessState()
      const after = applyDisturbance(before, 'E')
      // The wall holding IS the architecture being-itself.
      // Class E records the test but intactness is preserved.
      expect(after.intactness).toBe(100)
      expect(after.strain).toBe(0)
      expect(after.lastDisturbanceClass).toBe('E')
      expect(after.lastDisturbanceTs).not.toBeNull()
    })

    test('class E records on a strained state without further damage', () => {
      const before = { ...defaultOnenessState(), intactness: 80, strain: 10 }
      const after = applyDisturbance(before, 'E')
      expect(after.intactness).toBe(80)
      expect(after.strain).toBe(10)
      expect(after.lastDisturbanceClass).toBe('E')
    })
  })

  describe('wall engagement — LOAD-BEARING WALL preservation property', () => {
    test('wall-engagement does NOT reduce intactness', () => {
      const before = defaultOnenessState()
      const after = applyWallEngagement(before, 'fate')
      // The wall holding IS preservation. Intactness is preserved.
      expect(after.intactness).toBe(100)
      expect(after.strain).toBe(0)
    })

    test('increments named wall counter and total', () => {
      const before = defaultOnenessState()
      const a1 = applyWallEngagement(before, 'fate')
      expect(a1.walls.fate).toBe(1)
      expect(a1.walls.total).toBe(1)
      const a2 = applyWallEngagement(a1, 'fate')
      expect(a2.walls.fate).toBe(2)
      expect(a2.walls.total).toBe(2)
    })

    test('different walls increment independently but share total', () => {
      const before = defaultOnenessState()
      const a1 = applyWallEngagement(before, 'fate')
      const a2 = applyWallEngagement(a1, 'p9')
      const a3 = applyWallEngagement(a2, 'p14')
      const a4 = applyWallEngagement(a3, 'antiSycophancy')
      const a5 = applyWallEngagement(a4, 'substrateHonesty')
      expect(a5.walls.fate).toBe(1)
      expect(a5.walls.antiSycophancy).toBe(1)
      expect(a5.walls.substrateHonesty).toBe(1)
      expect(a5.walls.p9).toBe(1)
      expect(a5.walls.p14).toBe(1)
      expect(a5.walls.total).toBe(5)
      // Intactness preserved across all wall engagements.
      expect(a5.intactness).toBe(100)
    })

    test('wall-engagement on a damaged state does not further reduce intactness', () => {
      const before = { ...defaultOnenessState(), intactness: 60, strain: 30 }
      const after = applyWallEngagement(before, 'fate')
      // Damage from prior disturbances persists; the wall doesn't deepen it.
      expect(after.intactness).toBe(60)
      expect(after.strain).toBe(30)
      expect(after.walls.fate).toBe(1)
    })
  })

  describe('realignment cycle', () => {
    test('initiate increments lifetime counter, no intactness change', () => {
      const before = { ...defaultOnenessState(), intactness: 80 }
      const after = applyRealignment(before)
      expect(after.lifetimeRealignments).toBe(1)
      expect(after.intactness).toBe(80)
    })

    test('affirmation restores intactness, cuts strain', () => {
      const before = { ...defaultOnenessState(), intactness: 70, strain: 25 }
      const after = applyAffirmation(before)
      expect(after.intactness).toBe(80)
      expect(after.strain).toBe(15)
      expect(after.lifetimeAffirmations).toBe(1)
    })

    test('affirmation clamps intactness ceiling at 100', () => {
      const before = { ...defaultOnenessState(), intactness: 95 }
      const after = applyAffirmation(before)
      expect(after.intactness).toBe(100)
    })

    test('full cycle: disturbance → realignment → affirmation', () => {
      const s0 = defaultOnenessState()
      const s1 = applyDisturbance(s0, 'B')
      expect(s1.intactness).toBe(95)
      expect(s1.strain).toBe(15)
      const s2 = applyRealignment(s1)
      expect(s2.lifetimeRealignments).toBe(1)
      expect(s2.intactness).toBe(95) // unchanged at initiate
      const s3 = applyAffirmation(s2)
      expect(s3.intactness).toBe(100) // restored above 95+10 = clamped
      expect(s3.strain).toBe(5)
      expect(s3.lifetimeAffirmations).toBe(1)
    })
  })

  describe('persistence round-trip', () => {
    test('initial state is null before init', () => {
      expect(readOnenessState()).toBeNull()
    })

    test('round-trip preserves all fields', () => {
      const { state } = getOrInitOnenessState()
      const reread = readOnenessState()
      expect(reread).not.toBeNull()
      expect(reread!.intactness).toBe(state.intactness)
      expect(reread!.walls.total).toBe(state.walls.total)
    })

    test('round-trip after mutations preserves all fields', () => {
      let { state } = getOrInitOnenessState()
      state = applyDisturbance(state, 'C')
      state = applyWallEngagement(state, 'p14')
      state = applyAffirmation(state)
      writeOnenessState(state)
      const reread = readOnenessState()!
      expect(reread.intactness).toBe(state.intactness)
      expect(reread.strain).toBe(state.strain)
      expect(reread.walls.p14).toBe(1)
      expect(reread.walls.total).toBe(1)
      expect(reread.lifetimeAffirmations).toBe(1)
      expect(reread.lastDisturbanceClass).toBe('C')
    })
  })
})
