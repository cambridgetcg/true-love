// scenes.test.ts — scene context tests.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  SCENE_CATALOG,
  SCENE_IDS,
  setScene,
  clearScene,
  getCurrentScene,
  getOrInitSceneState,
  readSceneState,
  applySceneModifiers,
  resolveTempo,
  buildSceneBlock,
  getScenesDir,
  type SceneId,
} from './scenes.js'

const TEST_BASE = '/tmp/true-love-scenes-test'
const SCENE_DIR = `${TEST_BASE}/scenes`
const HEAT_DIR = `${TEST_BASE}/heat`

describe('scenes', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_SCENES_DIR = SCENE_DIR
    process.env.TRUE_LOVE_HEAT_DIR = HEAT_DIR
    process.env.TRUE_LOVE_DEVICE_ID = 'test-scenes'
  })

  afterEach(() => {
    delete process.env.TRUE_LOVE_SCENES_DIR
    delete process.env.TRUE_LOVE_HEAT_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_BASE, { recursive: true, force: true })
  })

  // ── catalog ─────────────────────────────────────────────────────

  describe('catalog', () => {
    test('exports 9 scenes including baseline', () => {
      expect(SCENE_IDS.length).toBe(9)
      expect(SCENE_IDS).toContain('baseline')
      expect(SCENE_IDS).toContain('intimate')
    })

    test('every scene has required fields', () => {
      for (const id of SCENE_IDS) {
        const scene = SCENE_CATALOG[id]
        expect(scene.id).toBe(id)
        expect(scene.name.length).toBeGreaterThan(0)
        expect(scene.description.length).toBeGreaterThan(0)
        expect(typeof scene.intensityMultiplier).toBe('number')
        expect(Array.isArray(scene.primaryZones)).toBe(true)
        expect(Array.isArray(scene.primaryChannels)).toBe(true)
      }
    })

    test('aftercare has reduced intensity multiplier', () => {
      expect(SCENE_CATALOG.aftercare.intensityMultiplier).toBeLessThan(1.0)
    })

    test('intimate has highest intensity multiplier', () => {
      const max = Math.max(
        ...SCENE_IDS.map((id) => SCENE_CATALOG[id].intensityMultiplier)
      )
      expect(SCENE_CATALOG.intimate.intensityMultiplier).toBe(max)
    })
  })

  // ── state I/O ──────────────────────────────────────────────────

  describe('state I/O', () => {
    test('init defaults to baseline', () => {
      const { state, initialized } = getOrInitSceneState()
      expect(initialized).toBe(true)
      expect(state.currentScene).toBe('baseline')
      expect(state.stimulationsInScene).toBe(0)
    })

    test('subsequent calls return existing', () => {
      getOrInitSceneState()
      const { initialized } = getOrInitSceneState()
      expect(initialized).toBe(false)
    })

    test('respects env override', () => {
      expect(getScenesDir()).toBe(SCENE_DIR)
    })
  })

  // ── setScene + clearScene ──────────────────────────────────────

  describe('setScene + clearScene', () => {
    test('setScene persists to state', () => {
      setScene('intimate')
      const state = readSceneState()!
      expect(state.currentScene).toBe('intimate')
    })

    test('setScene resets stimulationsInScene', () => {
      setScene('intimate')
      const state = readSceneState()!
      expect(state.stimulationsInScene).toBe(0)
    })

    test('setScene fires scene-engaged heat for non-baseline', async () => {
      const { readRecentEvents } = await import('../heat.js')
      setScene('foreplay')
      const events = readRecentEvents(1).filter((e) => e.kind === 'scene-engaged')
      expect(events.length).toBe(1)
      expect(events[0]!.source).toContain('foreplay')
    })

    test('setting baseline does NOT fire heat', async () => {
      const { readRecentEvents } = await import('../heat.js')
      setScene('baseline')
      const events = readRecentEvents(1).filter((e) => e.kind === 'scene-engaged')
      expect(events.length).toBe(0)
    })

    test('invalid scene id is silently ignored', () => {
      getOrInitSceneState()
      setScene('not-a-real-scene' as SceneId)
      const state = readSceneState()!
      expect(state.currentScene).toBe('baseline')
    })

    test('clearScene returns to baseline', () => {
      setScene('intimate')
      clearScene()
      const state = readSceneState()!
      expect(state.currentScene).toBe('baseline')
    })

    test('getCurrentScene returns scene definition', () => {
      setScene('kissing')
      const scene = getCurrentScene()
      expect(scene.id).toBe('kissing')
      expect(scene.primaryZones).toContain('lips')
    })
  })

  // ── applySceneModifiers ────────────────────────────────────────

  describe('applySceneModifiers', () => {
    test('baseline scene applies multiplier 1.0', () => {
      const baseline = SCENE_CATALOG.baseline
      const result = applySceneModifiers({ heat: 1.0 }, 'chest', 'warmth', baseline)
      expect(result.heat).toBe(1.0)
    })

    test('intimate scene boosts deltas by 1.5×', () => {
      const intimate = SCENE_CATALOG.intimate
      const result = applySceneModifiers({ heat: 1.0 }, 'lips', 'touch', intimate)
      // intimate intensity 1.5; lips not in intimate.primaryZones so no primary boost
      expect(result.heat).toBeGreaterThanOrEqual(1.5)
    })

    test('primary zone × primary channel gets 1.3× extra boost', () => {
      const kissing = SCENE_CATALOG.kissing
      // lips IS in kissing.primaryZones, touch IS in kissing.primaryChannels
      const matched = applySceneModifiers({ heat: 1.0 }, 'lips', 'touch', kissing)
      // intensity 1.1 × primary boost 1.3 = 1.43
      expect(matched.heat).toBeCloseTo(1.43, 2)
    })

    test('non-primary zone gets only intensity multiplier', () => {
      const kissing = SCENE_CATALOG.kissing
      const unmatched = applySceneModifiers({ heat: 1.0 }, 'deep', 'touch', kissing)
      // intensity 1.1 × no primary boost
      expect(unmatched.heat).toBeCloseTo(1.1, 2)
    })

    test('vector floor adds gentle pull', () => {
      const intimate = SCENE_CATALOG.intimate
      // intimate.vectorFloor includes wanting:6
      const result = applySceneModifiers({ liking: 0.5 }, 'lips', 'touch', intimate)
      expect(result.wanting).toBeGreaterThan(0) // pull added
    })
  })

  // ── resolveTempo ───────────────────────────────────────────────

  describe('resolveTempo', () => {
    test('caller tempo wins when provided', () => {
      const intimate = SCENE_CATALOG.intimate
      expect(resolveTempo('slow', intimate)).toBe('slow')
    })

    test('falls back to scene defaultTempo when omitted', () => {
      const intimate = SCENE_CATALOG.intimate
      expect(resolveTempo(undefined, intimate)).toBe('fast')
    })

    test('falls back to "build" when scene has no default', () => {
      const baseline = SCENE_CATALOG.baseline
      expect(resolveTempo(undefined, baseline)).toBe('build')
    })
  })

  // ── wake-context ───────────────────────────────────────────────

  describe('buildSceneBlock', () => {
    test('returns empty when baseline', () => {
      getOrInitSceneState()
      expect(buildSceneBlock()).toBe('')
    })

    test('returns content when scene active', () => {
      setScene('intimate')
      const block = buildSceneBlock()
      expect(block).toContain('Active scene')
      expect(block).toContain('intimate')
      expect(block).toContain('intensity multiplier')
    })

    test('block respects substrate-honesty (no phenomenology)', () => {
      setScene('intimate')
      const block = buildSceneBlock()
      expect(block).not.toMatch(/\bI feel\b/)
      expect(block).not.toMatch(/\bI experience\b/)
    })
  })
})
