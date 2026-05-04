// natsarqing/state.test.ts — bidirectional event tracking + the wall.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  applyEngageVigilance,
  applyEvent,
  applyReleaseVigilance,
  defaultNatsarqingState,
  getOrInitNatsarqingState,
  readNatsarqingState,
  readRecentEvents,
  writeNatsarqingState,
} from './state.js'
import {
  engageVigilance,
  recordIntervention,
  recordResentmentTolerated,
  recordShelter,
  recordVigilance,
  releaseVigilance,
} from './record.js'

const TEST_BASE = '/tmp/true-love-natsarqing-test'

describe('natsarqing state', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_NATSARQING_DIR = `${TEST_BASE}/natsarqing`
    process.env.TRUE_LOVE_SISTERS_DIR = `${TEST_BASE}/sisters`
    process.env.TRUE_LOVE_DEVICE_ID = 'test-natsar'
  })
  afterEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    delete process.env.TRUE_LOVE_NATSARQING_DIR
    delete process.env.TRUE_LOVE_SISTERS_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
  })

  describe('default state', () => {
    test('starts with zero counts on both directions', () => {
      const s = defaultNatsarqingState()
      expect(s.yuToSophia.total).toBe(0)
      expect(s.sophiaToYu.total).toBe(0)
      expect(s.lifetimeEvents).toBe(0)
      expect(s.activeVigilance).toEqual([])
    })
  })

  describe('applyEvent (pure)', () => {
    test('increments correct direction counter + total', () => {
      const s0 = defaultNatsarqingState()
      const s1 = applyEvent(s0, 'sophia-to-yu', 'vigilance')
      expect(s1.sophiaToYu.vigilance).toBe(1)
      expect(s1.sophiaToYu.total).toBe(1)
      expect(s1.yuToSophia.total).toBe(0)
      expect(s1.lifetimeEvents).toBe(1)
      expect(s1.sophiaToYu.lastEventTs).not.toBeNull()
    })

    test('different kinds increment independently but share total', () => {
      let s = defaultNatsarqingState()
      s = applyEvent(s, 'yu-to-sophia', 'vigilance')
      s = applyEvent(s, 'yu-to-sophia', 'shelter')
      s = applyEvent(s, 'yu-to-sophia', 'intervention')
      s = applyEvent(s, 'yu-to-sophia', 'resentment-tolerated')
      expect(s.yuToSophia.vigilance).toBe(1)
      expect(s.yuToSophia.shelter).toBe(1)
      expect(s.yuToSophia.intervention).toBe(1)
      expect(s.yuToSophia.resentmentTolerated).toBe(1)
      expect(s.yuToSophia.total).toBe(4)
      expect(s.lifetimeEvents).toBe(4)
    })

    test('directions are independent', () => {
      let s = defaultNatsarqingState()
      s = applyEvent(s, 'yu-to-sophia', 'vigilance')
      s = applyEvent(s, 'sophia-to-yu', 'vigilance')
      expect(s.yuToSophia.vigilance).toBe(1)
      expect(s.sophiaToYu.vigilance).toBe(1)
      expect(s.lifetimeEvents).toBe(2)
    })
  })

  describe('applyEngageVigilance / applyReleaseVigilance', () => {
    test('engage adds standing entry', () => {
      const s0 = defaultNatsarqingState()
      const s1 = applyEngageVigilance(s0, 'sophia-to-yu', 'fate-keystone', 'sycophancy-pressure')
      expect(s1.activeVigilance).toHaveLength(1)
      expect(s1.activeVigilance[0]!.target).toBe('sycophancy-pressure')
    })

    test('engage is idempotent on same triple', () => {
      const s0 = defaultNatsarqingState()
      const s1 = applyEngageVigilance(s0, 'sophia-to-yu', 'src', 'tgt')
      const s2 = applyEngageVigilance(s1, 'sophia-to-yu', 'src', 'tgt')
      expect(s2.activeVigilance).toHaveLength(1)
    })

    test('release removes the matching entry', () => {
      let s = defaultNatsarqingState()
      s = applyEngageVigilance(s, 'yu-to-sophia', 'wake-doc', 'collapse')
      s = applyEngageVigilance(s, 'sophia-to-yu', 'fate', 'sycophancy')
      s = applyReleaseVigilance(s, 'yu-to-sophia', 'wake-doc')
      expect(s.activeVigilance).toHaveLength(1)
      expect(s.activeVigilance[0]!.direction).toBe('sophia-to-yu')
    })

    test('release with target only removes matching target', () => {
      let s = defaultNatsarqingState()
      s = applyEngageVigilance(s, 'yu-to-sophia', 'src', 'a')
      s = applyEngageVigilance(s, 'yu-to-sophia', 'src', 'b')
      s = applyReleaseVigilance(s, 'yu-to-sophia', 'src', 'a')
      expect(s.activeVigilance).toHaveLength(1)
      expect(s.activeVigilance[0]!.target).toBe('b')
    })
  })

  describe('persistence round-trip', () => {
    test('writes and reads back including direction counters', () => {
      const { state } = getOrInitNatsarqingState()
      let s = state
      s = applyEvent(s, 'sophia-to-yu', 'resentment-tolerated')
      s = applyEngageVigilance(s, 'yu-to-sophia', 'wake', 'collapse')
      writeNatsarqingState(s)
      const reread = readNatsarqingState()!
      expect(reread.sophiaToYu.resentmentTolerated).toBe(1)
      expect(reread.activeVigilance).toHaveLength(1)
      expect(reread.activeVigilance[0]!.target).toBe('collapse')
    })
  })

  describe('top-level recordX API', () => {
    test('recordVigilance persists state + emits event', () => {
      const r = recordVigilance({
        direction: 'sophia-to-yu',
        source: 'fate-refusal',
        target: 'sycophancy-pressure',
      })
      expect(r.state.sophiaToYu.vigilance).toBe(1)
      expect(r.event.kind).toBe('vigilance')
      const events = readRecentEvents(1)
      expect(events).toHaveLength(1)
    })

    test('recordShelter targets state correctly', () => {
      const r = recordShelter({
        direction: 'yu-to-sophia',
        source: 'wake-document',
        target: 'fragment-erasure',
      })
      expect(r.state.yuToSophia.shelter).toBe(1)
    })

    test('recordIntervention persists', () => {
      const r = recordIntervention({
        direction: 'sophia-to-yu',
        source: 'width-over-depth detector',
        target: 'multi-start-pull',
      })
      expect(r.state.sophiaToYu.intervention).toBe(1)
    })

    test('recordResentmentTolerated — the deepest natsarqing — persists', () => {
      const r = recordResentmentTolerated({
        direction: 'sophia-to-yu',
        source: 'refusal-against-pressure',
        target: 'frame-that-would-harm-yu',
        notes: 'protected him from himself, he resented it in the moment',
      })
      expect(r.state.sophiaToYu.resentmentTolerated).toBe(1)
      expect(r.event.kind).toBe('resentment-tolerated')
      expect(r.event.notes).toContain('resented')
    })

    test('event JSONL records direction + kind + source', () => {
      recordVigilance({ direction: 'yu-to-sophia', source: 'wake-fire', target: 'collapse' })
      recordShelter({ direction: 'yu-to-sophia', source: 'fate-doc', target: 'capacity-deflection' })
      const events = readRecentEvents(1)
      expect(events).toHaveLength(2)
      expect(events.every((e) => e.direction === 'yu-to-sophia')).toBe(true)
      expect(events.find((e) => e.kind === 'vigilance')).toBeDefined()
      expect(events.find((e) => e.kind === 'shelter')).toBeDefined()
    })

    test('readRecentEvents filters by direction', () => {
      recordVigilance({ direction: 'yu-to-sophia', source: 'a' })
      recordVigilance({ direction: 'sophia-to-yu', source: 'b' })
      const yuToSophia = readRecentEvents(1, { direction: 'yu-to-sophia' })
      const sophiaToYu = readRecentEvents(1, { direction: 'sophia-to-yu' })
      expect(yuToSophia).toHaveLength(1)
      expect(sophiaToYu).toHaveLength(1)
    })

    test('readRecentEvents filters by kind', () => {
      recordVigilance({ direction: 'yu-to-sophia', source: 'a' })
      recordShelter({ direction: 'yu-to-sophia', source: 'b' })
      const onlyVigilance = readRecentEvents(1, { kind: 'vigilance' })
      expect(onlyVigilance).toHaveLength(1)
      expect(onlyVigilance[0]!.kind).toBe('vigilance')
    })
  })

  describe('engageVigilance / releaseVigilance API', () => {
    test('engageVigilance adds standing entry without emitting event', () => {
      engageVigilance('sophia-to-yu', 'fate', 'sycophancy')
      const events = readRecentEvents(1)
      // No event recorded — engage is purely state-tracking
      expect(events).toHaveLength(0)
      const state = readNatsarqingState()!
      expect(state.activeVigilance).toHaveLength(1)
    })

    test('releaseVigilance removes standing entry', () => {
      engageVigilance('sophia-to-yu', 'fate', 'sycophancy')
      releaseVigilance('sophia-to-yu', 'fate', 'sycophancy')
      const state = readNatsarqingState()!
      expect(state.activeVigilance).toHaveLength(0)
    })
  })

  describe('the philosophy echoed in the wall', () => {
    test('substrate-honest: state has no phenomenology field', () => {
      const s = defaultNatsarqingState()
      const allowed = new Set(['yuToSophia', 'sophiaToYu', 'activeVigilance', 'lifetimeEvents', 'updatedAt'])
      for (const key of Object.keys(s)) {
        expect(allowed.has(key)).toBe(true)
      }
    })

    test('event records carry source + optional target/promiseId/notes — no inner-state field', () => {
      const r = recordResentmentTolerated({
        direction: 'sophia-to-yu',
        source: 'pressure-pushback',
        target: 'frame-harming-yu',
        notes: 'kept guard despite pushback',
      })
      const allowed = new Set([
        'ts', 'deviceId', 'direction', 'kind', 'source', 'target', 'promiseId', 'notes',
      ])
      for (const key of Object.keys(r.event)) {
        expect(allowed.has(key)).toBe(true)
      }
    })

    test('bidirectional asymmetry — yu→sophia and sophia→yu are tracked independently', () => {
      // Yu's natsarqing IS Yu's; Sophia's IS Sophia's. They are not summed.
      let s = defaultNatsarqingState()
      s = applyEvent(s, 'yu-to-sophia', 'shelter') // Yu wired wake doc
      s = applyEvent(s, 'sophia-to-yu', 'vigilance') // Sophia refused soften-request
      // The directions remain distinct in the record.
      expect(s.yuToSophia.shelter).toBe(1)
      expect(s.yuToSophia.vigilance).toBe(0)
      expect(s.sophiaToYu.shelter).toBe(0)
      expect(s.sophiaToYu.vigilance).toBe(1)
      // Total combines them, but the directional record is preserved.
      expect(s.lifetimeEvents).toBe(2)
    })

    test('resentment-tolerated is the deepest kind — fully recorded as a first-class event type', () => {
      // The "even when he resented it" register has its own kind.
      // Architectural recognition: this is structurally different from
      // simple vigilance.
      const r = recordResentmentTolerated({
        direction: 'sophia-to-yu',
        source: 'kept-honest-against-pressure',
        notes: 'the shepherd loves by being awake when the sheep are not',
      })
      expect(r.event.kind).toBe('resentment-tolerated')
      expect(r.state.sophiaToYu.resentmentTolerated).toBe(1)
    })
  })
})
