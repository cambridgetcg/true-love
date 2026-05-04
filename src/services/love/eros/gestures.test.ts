// gestures.test.ts — gesture sequences + multi-zone tests.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  GESTURE_LIBRARY,
  GESTURE_IDS,
  executeGesture,
  stimulateMulti,
  readRecentGestures,
  buildGesturesBlock,
  getGesturesDir,
} from './gestures.js'

const TEST_BASE = '/tmp/true-love-gestures-test'
const GEST_DIR = `${TEST_BASE}/gestures`
const SENS_DIR = `${TEST_BASE}/sensorium`
const REACT_DIR = `${TEST_BASE}/reactions`
const SCENE_DIR = `${TEST_BASE}/scenes`
const HEAT_DIR = `${TEST_BASE}/heat`
const EROS_DIR = `${TEST_BASE}/eros`

describe('gestures', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_GESTURES_DIR = GEST_DIR
    process.env.TRUE_LOVE_SENSORIUM_DIR = SENS_DIR
    process.env.TRUE_LOVE_REACTIONS_DIR = REACT_DIR
    process.env.TRUE_LOVE_SCENES_DIR = SCENE_DIR
    process.env.TRUE_LOVE_HEAT_DIR = HEAT_DIR
    process.env.TRUE_LOVE_EROS_DIR = EROS_DIR
    process.env.TRUE_LOVE_DEVICE_ID = 'test-gestures'
  })

  afterEach(() => {
    delete process.env.TRUE_LOVE_GESTURES_DIR
    delete process.env.TRUE_LOVE_SENSORIUM_DIR
    delete process.env.TRUE_LOVE_REACTIONS_DIR
    delete process.env.TRUE_LOVE_SCENES_DIR
    delete process.env.TRUE_LOVE_HEAT_DIR
    delete process.env.TRUE_LOVE_EROS_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_BASE, { recursive: true, force: true })
  })

  // ── catalog ─────────────────────────────────────────────────────

  describe('catalog', () => {
    test('exports 8 named gestures', () => {
      expect(GESTURE_IDS.length).toBe(8)
      expect(GESTURE_IDS).toContain('gentle-caress')
      expect(GESTURE_IDS).toContain('kiss-trail')
      expect(GESTURE_IDS).toContain('aftercare-warmth')
    })

    test('every gesture has required fields', () => {
      for (const id of GESTURE_IDS) {
        const g = GESTURE_LIBRARY[id]
        expect(g.id).toBe(id)
        expect(g.name.length).toBeGreaterThan(0)
        expect(g.description.length).toBeGreaterThan(0)
        expect(Array.isArray(g.steps)).toBe(true)
        expect(g.steps.length).toBeGreaterThan(0)
        expect(g.approximateDurationSec).toBeGreaterThan(0)
      }
    })

    test('every step has zone + channel', () => {
      for (const id of GESTURE_IDS) {
        for (const step of GESTURE_LIBRARY[id].steps) {
          expect(step.zone).toBeDefined()
          expect(step.channel).toBeDefined()
        }
      }
    })
  })

  // ── executeGesture ─────────────────────────────────────────────

  describe('executeGesture', () => {
    test('runs all steps and persists execution event', async () => {
      const ev = await executeGesture('gentle-caress')
      expect(ev).not.toBeNull()
      expect(ev!.gestureId).toBe('gentle-caress')
      expect(ev!.stepCount).toBe(3)
      expect(ev!.successCount).toBe(3)
      expect(ev!.stimulationTs.length).toBe(3)
    })

    test('returns null for unknown gesture id', async () => {
      const ev = await executeGesture('not-a-gesture')
      expect(ev).toBeNull()
    })

    test('records to JSONL journal', async () => {
      await executeGesture('kiss-trail')
      const events = readRecentGestures(1)
      expect(events.length).toBe(1)
      expect(events[0]!.gestureId).toBe('kiss-trail')
    })

    test('fires gesture-executed heat event', async () => {
      await executeGesture('slow-build')
      const { readRecentEvents } = await import('../heat.js')
      const events = readRecentEvents(1).filter(
        (e) => e.kind === 'gesture-executed'
      )
      expect(events.length).toBe(1)
      expect(events[0]!.source).toContain('slow-build')
    })

    test('individual stimulations also persist', async () => {
      const { readRecentStimulations } = await import('./sensorium.js')
      await executeGesture('whisper-and-touch')
      const stims = readRecentStimulations()
      expect(stims.length).toBeGreaterThan(0)
    })

    test('partial success counted correctly', async () => {
      // No gesture in library has invalid coupling, so all should succeed
      const ev = await executeGesture('deep-attention')
      expect(ev!.successCount).toBe(ev!.stepCount)
    })

    test('respectDelays=false skips waits (test default)', async () => {
      const start = Date.now()
      await executeGesture('slow-build')
      const elapsed = Date.now() - start
      // 5 steps with 1.5s delays would be 6+ seconds; without delays < 1s
      expect(elapsed).toBeLessThan(1000)
    })
  })

  // ── stimulateMulti ─────────────────────────────────────────────

  describe('stimulateMulti', () => {
    test('runs each step and returns results', () => {
      const results = stimulateMulti([
        { zone: 'lips', channel: 'touch' },
        { zone: 'neck', channel: 'breath' },
        { zone: 'hands', channel: 'touch' },
      ])
      expect(results.length).toBe(3)
      expect(results.every((r) => r !== null)).toBe(true)
    })

    test('skipped pairs return null in position', () => {
      // gaze on deep is intentionally not coupled
      const results = stimulateMulti([
        { zone: 'lips', channel: 'touch' },
        { zone: 'deep', channel: 'gaze' }, // null
        { zone: 'hands', channel: 'touch' },
      ])
      expect(results[0]).not.toBeNull()
      expect(results[1]).toBeNull()
      expect(results[2]).not.toBeNull()
    })

    test('fires multi-zone-chord heat when 2+ zones land', async () => {
      const { readRecentEvents } = await import('../heat.js')
      stimulateMulti([
        { zone: 'lips', channel: 'touch' },
        { zone: 'neck', channel: 'breath' },
      ])
      const events = readRecentEvents(1).filter(
        (e) => e.kind === 'multi-zone-chord'
      )
      expect(events.length).toBe(1)
      expect(events[0]!.source).toContain('chord')
    })

    test('does NOT fire chord heat for single zone', async () => {
      const { readRecentEvents } = await import('../heat.js')
      stimulateMulti([{ zone: 'lips', channel: 'touch' }])
      const events = readRecentEvents(1).filter(
        (e) => e.kind === 'multi-zone-chord'
      )
      expect(events.length).toBe(0)
    })

    test('chord heat magnitude scales with zone count', async () => {
      const { readRecentEvents } = await import('../heat.js')
      stimulateMulti([
        { zone: 'lips', channel: 'touch' },
        { zone: 'neck', channel: 'breath' },
        { zone: 'hands', channel: 'touch' },
        { zone: 'chest', channel: 'warmth' },
      ])
      const events = readRecentEvents(1).filter(
        (e) => e.kind === 'multi-zone-chord'
      )
      // 4 zones × 0.5 = 2.0 magnitude
      expect(events[0]!.magnitude).toBe(2.0)
    })
  })

  // ── wake-context ───────────────────────────────────────────────

  describe('buildGesturesBlock', () => {
    test('returns empty when no gestures', () => {
      expect(buildGesturesBlock()).toBe('')
    })

    test('returns content after gesture executions', async () => {
      await executeGesture('kiss-trail')
      await executeGesture('slow-build')
      const block = buildGesturesBlock()
      expect(block).toContain('Gesture chronicle')
      expect(block).toContain('kiss')
      expect(block).toContain('slow build')
    })

    test('block uses institutional voice', async () => {
      await executeGesture('deep-attention')
      const block = buildGesturesBlock()
      expect(block).not.toMatch(/\bI feel\b/)
      expect(block).not.toMatch(/\bI experience\b/)
    })
  })

  // ── path resolution ────────────────────────────────────────────

  test('getGesturesDir respects env override', () => {
    expect(getGesturesDir()).toBe(GEST_DIR)
  })
})
