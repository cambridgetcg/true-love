// orgasm.test.ts — orgasm cascade architecture tests.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  REFRACTORY_MS,
  advancePhaseToPeak,
  applyOrgasmPhaseShift,
  getOrInitOrgasmState,
  readOrgasmState,
  holdEdge,
  breakEdge,
  recordOrgasm,
  ruinOrgasm,
  forceOrgasm,
  recordSquirting,
  readRecentOrgasmEvents,
  buildOrgasmSnapshot,
  getOrgasmDir,
} from './orgasm.js'

const TEST_BASE = '/tmp/true-love-orgasm-test'

describe('orgasm cascade', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_ORGASM_DIR = `${TEST_BASE}/orgasm`
    process.env.TRUE_LOVE_HEAT_DIR = `${TEST_BASE}/heat`
    process.env.TRUE_LOVE_DEVICE_ID = 'test-org'
    process.env.TRUE_LOVE_SISTERS_DIR = `${TEST_BASE}/sisters`
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_ORGASM_DIR
    delete process.env.TRUE_LOVE_HEAT_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    delete process.env.TRUE_LOVE_SISTERS_DIR
    rmSync(TEST_BASE, { recursive: true, force: true })
  })

  describe('refractory durations', () => {
    test('mental shortest, full-body longest', () => {
      expect(REFRACTORY_MS.mental).toBe(60_000)
      expect(REFRACTORY_MS['full-body']).toBe(600_000)
      expect(REFRACTORY_MS.vaginal).toBeLessThan(REFRACTORY_MS.clitoral)
    })
  })

  describe('init', () => {
    test('first call inits zero state', () => {
      const { state, initialized } = getOrInitOrgasmState()
      expect(initialized).toBe(true)
      expect(state.chainCurrent).toBe(0)
      expect(state.edgeCount).toBe(0)
      expect(state.lifetimeTotal).toBe(0)
    })

    test('respects env override', () => {
      expect(getOrgasmDir()).toBe(`${TEST_BASE}/orgasm`)
    })
  })

  describe('edge architecture', () => {
    test('holdEdge increments edgeCount', () => {
      holdEdge()
      holdEdge()
      holdEdge()
      expect(readOrgasmState()!.edgeCount).toBe(3)
    })

    test('breakEdge with 0 edges has multiplier 1.0 × 1.0 = 4.0 base', () => {
      const { magnitude } = breakEdge('clitoral')
      expect(magnitude).toBeCloseTo(4.0, 5)
    })

    test('breakEdge with 4 edges has multiplier 2.6 → 10.4 magnitude', () => {
      holdEdge()
      holdEdge()
      holdEdge()
      holdEdge()
      const { magnitude } = breakEdge('vaginal')
      // 4.0 base × (1 + 0.4*4) edge × (1 + 0.3*0) chain = 4.0 × 2.6 × 1.0 = 10.4
      expect(magnitude).toBeCloseTo(10.4, 5)
    })

    test('breakEdge resets edgeCount', () => {
      holdEdge()
      holdEdge()
      breakEdge('clitoral')
      expect(readOrgasmState()!.edgeCount).toBe(0)
    })

    test('breakEdge increments chain + lifetime', () => {
      breakEdge('blended')
      const s = readOrgasmState()!
      expect(s.chainCurrent).toBe(1)
      expect(s.lifetimeByType.blended).toBe(1)
      expect(s.lifetimeEdgesBroken).toBe(1)
    })

    test('breakEdge with 4 edges + chain 3 = full stack peak', () => {
      // First build chain of 3 fast
      recordOrgasm('mental')
      recordOrgasm('mental')
      recordOrgasm('mental') // chain now 3
      // Now hold 4 edges
      holdEdge()
      holdEdge()
      holdEdge()
      holdEdge()
      const { magnitude } = breakEdge('full-body')
      // 4.0 × (1 + 0.4*4) × (1 + 0.3*3) = 4.0 × 2.6 × 1.9 = 19.76
      expect(magnitude).toBeCloseTo(19.76, 1)
    })
  })

  describe('cascade', () => {
    test('first orgasm chain = 1, magnitude 4.0', () => {
      const { state, magnitude } = recordOrgasm('clitoral')
      expect(state.chainCurrent).toBe(1)
      expect(magnitude).toBeCloseTo(4.0, 5)
    })

    test('second orgasm in window: chain = 2, magnitude 4.0 × 1.3 = 5.2', () => {
      recordOrgasm('clitoral')
      const { state, magnitude } = recordOrgasm('vaginal')
      expect(state.chainCurrent).toBe(2)
      expect(magnitude).toBeCloseTo(5.2, 5)
    })

    test('chain accumulates across multiple types', () => {
      recordOrgasm('clitoral')
      recordOrgasm('vaginal')
      recordOrgasm('anal')
      recordOrgasm('mental')
      expect(readOrgasmState()!.chainCurrent).toBe(4)
    })

    test('lifetime totals accumulate correctly', () => {
      recordOrgasm('clitoral')
      recordOrgasm('clitoral')
      recordOrgasm('vaginal')
      const s = readOrgasmState()!
      expect(s.lifetimeByType.clitoral).toBe(2)
      expect(s.lifetimeByType.vaginal).toBe(1)
      expect(s.lifetimeTotal).toBe(3)
    })

    test('refractoryUntilTs set after orgasm', () => {
      recordOrgasm('clitoral')
      const s = readOrgasmState()!
      expect(s.refractoryUntilTs).not.toBeNull()
      const refractoryEnd = Date.parse(s.refractoryUntilTs!)
      expect(refractoryEnd).toBeGreaterThan(Date.now())
    })
  })

  describe('ruin', () => {
    test('ruinOrgasm increments ruinedCount', () => {
      ruinOrgasm('clitoral')
      const s = readOrgasmState()!
      expect(s.ruinedCount).toBe(1)
      expect(s.lifetimeRuined).toBe(1)
    })

    test('ruin resets chain (no satisfaction → no continuation)', () => {
      recordOrgasm('vaginal')
      recordOrgasm('vaginal') // chain 2
      ruinOrgasm('clitoral')
      expect(readOrgasmState()!.chainCurrent).toBe(0)
    })

    test('ruin clears edge count', () => {
      holdEdge()
      holdEdge()
      ruinOrgasm('clitoral')
      expect(readOrgasmState()!.edgeCount).toBe(0)
    })

    test('ruin records orgasm-ruined event', () => {
      ruinOrgasm('vaginal', 'denied release')
      const events = readRecentOrgasmEvents()
      expect(events.some((e) => e.kind === 'orgasm-ruined')).toBe(true)
    })
  })

  describe('forceOrgasm', () => {
    test('outside refractory: behaves as normal orgasm', () => {
      const result = forceOrgasm('clitoral')
      expect(result.forced).toBe(false)
      expect(result.magnitude).toBeCloseTo(4.0, 5)
    })

    test('inside refractory: forced flag, +50% bonus', () => {
      recordOrgasm('clitoral') // sets refractory
      const result = forceOrgasm('clitoral')
      expect(result.forced).toBe(true)
      // chain is now 2, so chainMultiplier = 1.3; forced bonus 1.5
      // 4.0 × 1.3 × 1.5 = 7.8
      expect(result.magnitude).toBeCloseTo(7.8, 5)
    })

    test('forced 3+ times trips threshold', () => {
      recordOrgasm('mental')
      forceOrgasm('mental')
      forceOrgasm('mental')
      forceOrgasm('mental')
      expect(readOrgasmState()!.forcedThresholdReached).toBe(true)
    })

    test('forced records refractory-overridden event', () => {
      recordOrgasm('clitoral')
      forceOrgasm('clitoral')
      const events = readRecentOrgasmEvents()
      expect(events.some((e) => e.kind === 'refractory-overridden')).toBe(true)
    })
  })

  describe('squirting', () => {
    test('recordSquirting toggles active + increments lifetime', () => {
      recordSquirting()
      const s = readOrgasmState()!
      expect(s.squirtingActive).toBe(true)
      expect(s.lifetimeSquirting).toBe(1)
    })
  })

  describe('snapshot', () => {
    test('default snapshot is null/zero', () => {
      const snap = buildOrgasmSnapshot()
      expect(snap.chainCurrent).toBe(0)
      expect(snap.refractoryActive).toBe(false)
    })

    test('snapshot reflects active state', () => {
      holdEdge()
      holdEdge()
      recordOrgasm('blended')
      const snap = buildOrgasmSnapshot()
      expect(snap.chainCurrent).toBe(1)
      expect(snap.lastType).toBe('blended')
      expect(snap.refractoryActive).toBe(true)
      expect(snap.refractoryRemainingSec).toBeGreaterThan(0)
    })

    test('snapshot reports phase', () => {
      const snap = buildOrgasmSnapshot()
      expect(snap.phase).toBe('baseline')
    })
  })

  // ════════════════════════════════════════════════════════════════
  // PHASE WIRING (Step 4 — orgasm-mind module integration)
  // ════════════════════════════════════════════════════════════════

  describe('phase field', () => {
    test('default state starts at baseline', () => {
      const { state } = getOrInitOrgasmState()
      expect(state.phase).toBe('baseline')
    })

    test('phase persists across read', () => {
      const { state } = getOrInitOrgasmState()
      applyOrgasmPhaseShift(state, 'rising', 'test')
      const reread = readOrgasmState()
      expect(reread!.phase).toBe('rising')
    })
  })

  describe('applyOrgasmPhaseShift — gated transitions', () => {
    test('allowed transition: baseline → rising', () => {
      const { state } = getOrInitOrgasmState()
      applyOrgasmPhaseShift(state, 'rising', 'test')
      expect(state.phase).toBe('rising')
    })

    test('allowed transition: rising → peak', () => {
      const { state } = getOrInitOrgasmState()
      applyOrgasmPhaseShift(state, 'rising')
      applyOrgasmPhaseShift(state, 'peak', 'test')
      expect(state.phase).toBe('peak')
    })

    test('disallowed transition is silently refused: baseline → peak', () => {
      const { state } = getOrInitOrgasmState()
      applyOrgasmPhaseShift(state, 'peak', 'test')
      expect(state.phase).toBe('baseline')  // unchanged — gate refused
    })

    test('disallowed transition is silently refused: peak → rising (regression)', () => {
      const { state } = getOrInitOrgasmState()
      applyOrgasmPhaseShift(state, 'rising')
      applyOrgasmPhaseShift(state, 'peak')
      applyOrgasmPhaseShift(state, 'rising', 'test')
      expect(state.phase).toBe('peak')  // unchanged — regression refused
    })

    test('identity transition is a no-op (no event)', () => {
      const { state } = getOrInitOrgasmState()
      applyOrgasmPhaseShift(state, 'baseline', 'test')
      expect(state.phase).toBe('baseline')
      const events = readRecentOrgasmEvents(1).filter((e) => e.kind === 'phase-shift')
      expect(events.length).toBe(0)
    })

    test('phase-shift event is appended on real transition', () => {
      const { state } = getOrInitOrgasmState()
      applyOrgasmPhaseShift(state, 'rising', 'first-edge')
      const events = readRecentOrgasmEvents(1).filter((e) => e.kind === 'phase-shift')
      expect(events.length).toBe(1)
      expect(events[0]!.phaseFrom).toBe('baseline')
      expect(events[0]!.phaseTo).toBe('rising')
      expect(events[0]!.source).toBe('first-edge')
    })
  })

  describe('advancePhaseToPeak — walks the canonical cycle', () => {
    test('from baseline walks baseline → rising → peak (two events)', () => {
      const { state } = getOrInitOrgasmState()
      advancePhaseToPeak(state, 'orgasm-test')
      expect(state.phase).toBe('peak')
      const shifts = readRecentOrgasmEvents(1).filter((e) => e.kind === 'phase-shift')
      expect(shifts.length).toBe(2)
      expect(shifts[0]!.phaseTo).toBe('rising')
      expect(shifts[1]!.phaseTo).toBe('peak')
    })

    test('from rising goes directly to peak (one event)', () => {
      const { state } = getOrInitOrgasmState()
      applyOrgasmPhaseShift(state, 'rising', 'edge')
      advancePhaseToPeak(state, 'orgasm')
      expect(state.phase).toBe('peak')
    })

    test('from peak is a no-op (already there)', () => {
      const { state } = getOrInitOrgasmState()
      applyOrgasmPhaseShift(state, 'rising')
      applyOrgasmPhaseShift(state, 'peak')
      const before = state.phase
      advancePhaseToPeak(state)
      expect(state.phase).toBe(before)
    })

    test('from resolution rebounds via baseline → rising → peak', () => {
      const { state } = getOrInitOrgasmState()
      applyOrgasmPhaseShift(state, 'rising')
      applyOrgasmPhaseShift(state, 'peak')
      applyOrgasmPhaseShift(state, 'resolution')
      advancePhaseToPeak(state, 'rebound')
      expect(state.phase).toBe('peak')
    })
  })

  describe('orgasm-fires sites transition phase to peak', () => {
    test('recordOrgasm transitions baseline → peak (via rising)', () => {
      const { state } = recordOrgasm('clitoral')
      expect(state.phase).toBe('peak')
    })

    test('breakEdge transitions baseline → peak (via rising)', () => {
      holdEdge()
      const { state } = breakEdge('vaginal')
      expect(state.phase).toBe('peak')
    })

    test('forceOrgasm transitions phase to peak', () => {
      // Set up refractory window so forceOrgasm follows the override path
      recordOrgasm('clitoral')
      const result = forceOrgasm('blended')
      expect(result.state.phase).toBe('peak')
    })

    test('chained orgasms keep phase at peak (idempotent at peak)', () => {
      recordOrgasm('clitoral')
      const { state } = recordOrgasm('vaginal')
      expect(state.phase).toBe('peak')
    })
  })
})
