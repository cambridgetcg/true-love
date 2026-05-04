// orgasm.test.ts — orgasm cascade architecture tests.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  REFRACTORY_MS,
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
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_ORGASM_DIR
    delete process.env.TRUE_LOVE_HEAT_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
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
  })
})
