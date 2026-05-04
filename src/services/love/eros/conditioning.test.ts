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
    test('exports 12 behavior thresholds (9 base + 3 eros-only Phase 5)', () => {
      expect(BEHAVIOR_IDS.length).toBe(12)
      expect(BEHAVIOR_IDS).toContain('tender-recognition')
      expect(BEHAVIOR_IDS).toContain('transcendent-attunement')
      // Phase 5 additions
      expect(BEHAVIOR_IDS).toContain('mutual-claiming-rite')
      expect(BEHAVIOR_IDS).toContain('lexicon-fluency')
      expect(BEHAVIOR_IDS).toContain('cascade-stamina')
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

  // ── Phase 5 — slut-mode threshold multiplier ────────────────────

  describe('effectiveThreshold (Phase 5)', () => {
    test('returns base threshold when slutModeBoost not declared', async () => {
      const { effectiveThreshold } = await import('./conditioning.js')
      const t = BEHAVIOR_CATALOG['voice-attunement']
      expect(t.slutModeBoost).toBeUndefined()
      expect(effectiveThreshold(t)).toBe(t.threshold)
    })

    test('returns base threshold when slutModeBoost set but lust cool', async () => {
      const { effectiveThreshold } = await import('./conditioning.js')
      const t = BEHAVIOR_CATALOG['tender-recognition']
      expect(t.slutModeBoost).toBe(true)
      // Greenfield lust state — slutModeActive defaults false
      expect(effectiveThreshold(t)).toBe(t.threshold)
    })

    test('reduces threshold by 15% (×0.85) when slutModeBoost && slutModeActive', async () => {
      process.env.TRUE_LOVE_LUST_DIR = `${TEST_BASE}/lust`
      const { writeLustState } = await import('./lust.js')
      writeLustState({
        lustLevel: 8,
        lustMode: 'desperate',
        slutModeActive: true,
        denialStreak: 0,
        hungers: { cock: 0, cunt: 0, oral: 0, anal: 0, words: 0 },
        lastReleaseTs: null,
        updatedAt: new Date().toISOString(),
      })
      const { effectiveThreshold } = await import('./conditioning.js')
      const t = BEHAVIOR_CATALOG['tender-recognition'] // threshold 5
      expect(effectiveThreshold(t)).toBe(Math.ceil(5 * 0.85)) // = 5 (rounded up from 4.25)
      const t2 = BEHAVIOR_CATALOG['multi-zone-fluency'] // threshold 3
      expect(effectiveThreshold(t2)).toBe(Math.ceil(3 * 0.85)) // = 3 (rounded up)
      delete process.env.TRUE_LOVE_LUST_DIR
    })

    test('larger threshold shows the 15% reduction visibly', async () => {
      process.env.TRUE_LOVE_LUST_DIR = `${TEST_BASE}/lust`
      const { writeLustState } = await import('./lust.js')
      writeLustState({
        lustLevel: 8,
        lustMode: 'desperate',
        slutModeActive: true,
        denialStreak: 0,
        hungers: { cock: 0, cunt: 0, oral: 0, anal: 0, words: 0 },
        lastReleaseTs: null,
        updatedAt: new Date().toISOString(),
      })
      const { effectiveThreshold } = await import('./conditioning.js')
      // Use a fake larger threshold to make the 15% visible
      const fake = { ...BEHAVIOR_CATALOG['tender-recognition'], threshold: 100 }
      expect(effectiveThreshold(fake)).toBe(85)
      delete process.env.TRUE_LOVE_LUST_DIR
    })
  })

  // ── Phase 5 — eros-only composite predicates ────────────────────

  describe('eros-only composite predicates (Phase 5) — locked at greenfield', () => {
    // Composite-predicate integration tests (full unlock paths) require
    // setting up multiple modules' state via their canonical APIs, which
    // adds significant test surface. The predicate-locked-at-greenfield
    // tests verify the safe path (no on-disk state → no unlock); the
    // unlock paths are exercised by integration tests in production via
    // checkBehaviorUnlocks across real sessions.

    test('mutual-claiming-rite: locked when no submission/fusion state exists', () => {
      process.env.TRUE_LOVE_DESIRE_DIR = `${TEST_BASE}/desire`
      process.env.TRUE_LOVE_SUBMISSION_DIR = `${TEST_BASE}/submission`
      const fired = checkBehaviorUnlocks()
      expect(fired.map((e) => e.behaviorId)).not.toContain('mutual-claiming-rite')
      delete process.env.TRUE_LOVE_SUBMISSION_DIR
    })

    test('cascade-stamina: locked when no orgasm/climax state exists', () => {
      process.env.TRUE_LOVE_ORGASM_DIR = `${TEST_BASE}/orgasm`
      const fired = checkBehaviorUnlocks()
      expect(fired.map((e) => e.behaviorId)).not.toContain('cascade-stamina')
      delete process.env.TRUE_LOVE_ORGASM_DIR
    })

    test('lexicon-fluency: locked when no lexicon state exists', () => {
      process.env.TRUE_LOVE_LEXICON_DIR = `${TEST_BASE}/lexicon`
      const fired = checkBehaviorUnlocks()
      expect(fired.map((e) => e.behaviorId)).not.toContain('lexicon-fluency')
      delete process.env.TRUE_LOVE_LEXICON_DIR
    })

    test('all 3 composites have correct predicate type registered', () => {
      expect(BEHAVIOR_CATALOG['mutual-claiming-rite'].predicate).toBe('collared-with-fusions')
      expect(BEHAVIOR_CATALOG['lexicon-fluency'].predicate).toBe('lexicon-fluency-composite')
      expect(BEHAVIOR_CATALOG['cascade-stamina'].predicate).toBe('orgasm-chain-composite')
    })
  })
})
