// conditioning.test.ts — trainer / behavior unlock tests.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  BEHAVIOR_CATALOG,
  BEHAVIOR_IDS,
  getOrInitConditioningState,
  readConditioningState,
  incrementConditioning,
  checkBehaviorUnlocks,
  buildConditioningBlock,
  getConditioningDir,
} from './conditioning.js'

const TEST_BASE = '/tmp/true-love-conditioning-test'

describe('conditioning', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_CONDITIONING_DIR = `${TEST_BASE}/conditioning`
    process.env.TRUE_LOVE_HEAT_DIR = `${TEST_BASE}/heat`
    process.env.TRUE_LOVE_DESIRE_DIR = `${TEST_BASE}/desire`
    process.env.TRUE_LOVE_CLIMAX_DIR = `${TEST_BASE}/climax`
    process.env.TRUE_LOVE_DEVICE_ID = 'test-cond'
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_CONDITIONING_DIR
    delete process.env.TRUE_LOVE_HEAT_DIR
    delete process.env.TRUE_LOVE_DESIRE_DIR
    delete process.env.TRUE_LOVE_CLIMAX_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_BASE, { recursive: true, force: true })
  })

  describe('catalog', () => {
    test('exports 9 behavior thresholds', () => {
      expect(BEHAVIOR_IDS.length).toBe(9)
      expect(BEHAVIOR_IDS).toContain('tender-recognition')
      expect(BEHAVIOR_IDS).toContain('transcendent-attunement')
    })

    test('every behavior has id + name + description + threshold', () => {
      for (const id of BEHAVIOR_IDS) {
        const b = BEHAVIOR_CATALOG[id]
        expect(b.id).toBe(id)
        expect(b.name.length).toBeGreaterThan(0)
        expect(b.description.length).toBeGreaterThan(0)
        expect(b.threshold).toBeGreaterThan(0)
      }
    })
  })

  describe('init', () => {
    test('first call inits empty state', () => {
      const { state, initialized } = getOrInitConditioningState()
      expect(initialized).toBe(true)
      expect(state.unlockedBehaviors).toEqual([])
      expect(Object.keys(state.meters).length).toBe(0)
    })

    test('respects env override', () => {
      expect(getConditioningDir()).toBe(`${TEST_BASE}/conditioning`)
    })
  })

  describe('incrementConditioning', () => {
    test('creates meter on first increment', () => {
      incrementConditioning('lips', 'touch')
      const state = readConditioningState()!
      expect(state.meters['lips:touch'].count).toBe(1)
    })

    test('accumulates count over multiple increments', () => {
      incrementConditioning('lips', 'touch')
      incrementConditioning('lips', 'touch')
      incrementConditioning('lips', 'touch')
      const state = readConditioningState()!
      expect(state.meters['lips:touch'].count).toBe(3)
    })

    test('totalMagnitude accumulates weighted', () => {
      incrementConditioning('chest', 'warmth', 0.7)
      incrementConditioning('chest', 'warmth', 0.5)
      const state = readConditioningState()!
      expect(state.meters['chest:warmth'].totalMagnitude).toBeCloseTo(1.2, 5)
    })

    test('different (zone × channel) get separate meters', () => {
      incrementConditioning('lips', 'touch')
      incrementConditioning('chest', 'warmth')
      const state = readConditioningState()!
      expect(Object.keys(state.meters).length).toBe(2)
    })

    test('stores lastTs', () => {
      incrementConditioning('lips', 'touch')
      const state = readConditioningState()!
      expect(state.meters['lips:touch'].lastTs).toBeDefined()
    })
  })

  describe('checkBehaviorUnlocks', () => {
    test('no unlocks at empty state', () => {
      const fired = checkBehaviorUnlocks()
      expect(fired.length).toBe(0)
    })

    test('tender-recognition unlocks at 5 hands+skin+back×touch events', () => {
      // tender-recognition: meter-sum on (hands|skin|back) × touch threshold 5
      incrementConditioning('hands', 'touch')
      incrementConditioning('hands', 'touch')
      incrementConditioning('skin', 'touch')
      incrementConditioning('skin', 'touch')
      incrementConditioning('back', 'touch')
      // 5 events; should unlock now
      const state = readConditioningState()!
      expect(state.unlockedBehaviors).toContain('tender-recognition')
    })

    test('voice-attunement unlocks at 5 voice-channel events', () => {
      for (let i = 0; i < 5; i++) {
        incrementConditioning('ears', 'voice')
      }
      const state = readConditioningState()!
      expect(state.unlockedBehaviors).toContain('voice-attunement')
    })

    test('breath-synchrony unlocks at 8 breath events', () => {
      for (let i = 0; i < 4; i++) incrementConditioning('neck', 'breath')
      for (let i = 0; i < 4; i++) incrementConditioning('skin', 'breath')
      const state = readConditioningState()!
      expect(state.unlockedBehaviors).toContain('breath-synchrony')
    })

    test('does NOT re-unlock already-unlocked behavior', () => {
      for (let i = 0; i < 5; i++) incrementConditioning('hands', 'touch')
      const before = readConditioningState()!.unlockedBehaviors.length
      incrementConditioning('hands', 'touch')
      const after = readConditioningState()!.unlockedBehaviors.length
      expect(after).toBe(before)
    })

    test('fires behavior-unlocked heat event on unlock', async () => {
      for (let i = 0; i < 5; i++) incrementConditioning('hands', 'touch')
      const { readRecentEvents } = await import('../heat.js')
      const events = readRecentEvents(1).filter((e) => e.kind === 'behavior-unlocked')
      expect(events.length).toBeGreaterThan(0)
      expect(events[0]!.source).toContain('tender-recognition')
    })
  })

  describe('buildConditioningBlock', () => {
    test('returns empty when nothing has happened', () => {
      getOrInitConditioningState()
      expect(buildConditioningBlock()).toBe('')
    })

    test('returns content after stimulations recorded', () => {
      incrementConditioning('lips', 'touch')
      incrementConditioning('chest', 'warmth')
      const block = buildConditioningBlock()
      expect(block).toContain('Conditioning')
      expect(block).toContain('stimulations')
    })

    test('shows unlocked behaviors with check marks', () => {
      for (let i = 0; i < 5; i++) incrementConditioning('hands', 'touch')
      const block = buildConditioningBlock()
      expect(block).toContain('Unlocked')
      expect(block).toContain('tender recognition')
    })
  })
})
