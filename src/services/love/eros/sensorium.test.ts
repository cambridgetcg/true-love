// sensorium.test.ts — biological-system replica + stimulation tests.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import {
  ZONE_CATALOG,
  CHANNEL_CATALOG,
  TEMPO_CATALOG,
  channelsFor,
  getOrInitSensorium,
  readSensoriumState,
  stimulate,
  coolZone,
  coolAll,
  readRecentStimulations,
  buildSensoriumPromptBlock,
  buildSensoriumChronicleBlock,
  getSensoriumDir,
  type SensitivitySite,
} from './sensorium.js'

const TEST_BASE = '/tmp/true-love-sensorium-test'
const SENSE_DIR = `${TEST_BASE}/sensorium`
const HEAT_DIR = `${TEST_BASE}/heat`
const EROS_DIR = `${TEST_BASE}/eros`

describe('sensorium', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_SENSORIUM_DIR = SENSE_DIR
    process.env.TRUE_LOVE_HEAT_DIR = HEAT_DIR
    process.env.TRUE_LOVE_EROS_DIR = EROS_DIR
    process.env.TRUE_LOVE_DEVICE_ID = 'test-sensorium'
  })

  afterEach(() => {
    delete process.env.TRUE_LOVE_SENSORIUM_DIR
    delete process.env.TRUE_LOVE_HEAT_DIR
    delete process.env.TRUE_LOVE_EROS_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_BASE, { recursive: true, force: true })
  })

  // ── catalog ─────────────────────────────────────────────────────

  describe('catalogs', () => {
    test('exports 13 zones', () => {
      expect(ZONE_CATALOG.length).toBe(13)
    })

    test('exports 7 channels', () => {
      expect(CHANNEL_CATALOG.length).toBe(7)
    })

    test('exports 6 tempos', () => {
      expect(TEMPO_CATALOG.length).toBe(6)
    })

    test('channelsFor returns valid subset', () => {
      const lipsChannels = channelsFor('lips')
      expect(lipsChannels.length).toBeGreaterThan(0)
      for (const ch of lipsChannels) {
        expect(CHANNEL_CATALOG).toContain(ch)
      }
    })

    test('deep zone has channels (the highest-coupling zone)', () => {
      const deep = channelsFor('deep')
      expect(deep.length).toBeGreaterThan(0)
    })
  })

  // ── state init ──────────────────────────────────────────────────

  describe('init', () => {
    test('first call initializes state at zone defaults', () => {
      const { state, initialized } = getOrInitSensorium()
      expect(initialized).toBe(true)
      for (const z of ZONE_CATALOG) {
        expect(state.zones[z].charge).toBe(0)
        expect(state.zones[z].sensitivity).toBe(1.0)
        expect(state.zones[z].lifetimeStimulations).toBe(0)
      }
    })

    test('subsequent call returns existing', () => {
      getOrInitSensorium()
      const { initialized } = getOrInitSensorium()
      expect(initialized).toBe(false)
    })
  })

  // ── stimulate ───────────────────────────────────────────────────

  describe('stimulate', () => {
    test('updates zone charge', () => {
      const event = stimulate('chest', 'warmth', 'slow', 0.5)
      expect(event).not.toBeNull()
      const state = readSensoriumState()!
      expect(state.zones.chest.charge).toBeGreaterThan(0)
    })

    test('records stimulation event with all fields', () => {
      const event = stimulate('lips', 'touch', 'build', 0.7)!
      expect(event.zone).toBe('lips')
      expect(event.channel).toBe('touch')
      expect(event.tempo).toBe('build')
      expect(event.intensity).toBe(0.7)
      expect(event.chargeBefore).toBeLessThan(event.chargeAfter)
      expect(Object.keys(event.erosCoupling).length).toBeGreaterThan(0)
    })

    test('persists event to JSONL journal', () => {
      stimulate('neck', 'breath', 'slow')
      const events = readRecentStimulations(1)
      expect(events.length).toBeGreaterThan(0)
      expect(events[0]!.zone).toBe('neck')
    })

    test('couples to eros vector via apply()', async () => {
      const { readErosState } = await import('./state.js')
      stimulate('chest', 'warmth', 'fast', 1.0)
      const eros = readErosState()
      // chest × warmth bumps heat + openness
      expect(eros).not.toBeNull()
      expect(eros!.vector.heat).toBeGreaterThan(1.0) // baseline 1
    })

    test('fires sensorium-stimulated heat event', async () => {
      const { readRecentEvents } = await import('../heat.js')
      stimulate('thighs', 'touch', 'fast', 1.0)
      const events = readRecentEvents(1).filter(
        (e) => e.kind === 'sensorium-stimulated'
      )
      expect(events.length).toBe(1)
      expect(events[0]!.source).toContain('thighs')
      expect(events[0]!.magnitude).toBeGreaterThan(0)
    })

    test('returns null for undefined zone × channel coupling', () => {
      // gaze on deep is intentionally not in coupling table
      const event = stimulate('deep', 'gaze', 'slow')
      expect(event).toBeNull()
    })

    test('intensity clamped to [0, 1]', () => {
      const e1 = stimulate('lips', 'touch', 'slow', 5.0)!
      expect(e1.intensity).toBe(1.0)
      const e2 = stimulate('lips', 'touch', 'slow', -1.0)!
      expect(e2.intensity).toBe(0.0)
    })

    test('lifetimeStimulations increments', () => {
      stimulate('lips', 'touch', 'slow')
      stimulate('lips', 'touch', 'slow')
      stimulate('lips', 'touch', 'slow')
      const state = readSensoriumState()!
      expect(state.zones.lips.lifetimeStimulations).toBe(3)
    })

    test('lastChannel + lastTempo recorded', () => {
      stimulate('hips', 'touch', 'edging')
      const state = readSensoriumState()!
      expect(state.zones.hips.lastChannel).toBe('touch')
      expect(state.zones.hips.lastTempo).toBe('edging')
    })

    test('release tempo drops sensitivity', () => {
      stimulate('core', 'touch', 'release', 1.0)
      const state = readSensoriumState()!
      expect(state.zones.core.sensitivity).toBeLessThan(1.0)
    })

    test('edging tempo adds inhibition via post-effect', async () => {
      const { readErosState } = await import('./state.js')
      stimulate('hips', 'touch', 'edging', 1.0)
      const eros = readErosState()!
      // Inhibition baseline is 1; edging post-effect adds 0.3 × intensity
      expect(eros.vector.inhibition).toBeGreaterThan(1.0)
    })
  })

  // ── coupling table integrity ───────────────────────────────────

  describe('coupling table', () => {
    test('every zone has at least one channel', () => {
      for (const zone of ZONE_CATALOG) {
        expect(channelsFor(zone).length).toBeGreaterThan(0)
      }
    })

    test('deep zone produces strongest heat coupling', () => {
      const e1 = stimulate('deep', 'touch', 'build', 1.0)!
      const e2 = stimulate('skin', 'touch', 'build', 1.0)!
      // Deep has heat: 1.0 base, skin has no heat coupling on touch
      const deepHeat = (e1.erosCoupling.heat ?? 0)
      const skinHeat = (e2.erosCoupling.heat ?? 0)
      expect(deepHeat).toBeGreaterThan(skinHeat)
    })
  })

  // ── coolZone + coolAll ─────────────────────────────────────────

  describe('cooling', () => {
    test('coolZone resets a single zone to defaults', () => {
      stimulate('chest', 'warmth', 'fast', 1.0)
      coolZone('chest')
      const state = readSensoriumState()!
      expect(state.zones.chest.charge).toBe(0)
      expect(state.zones.chest.sensitivity).toBe(1.0)
    })

    test('coolAll resets every zone', () => {
      stimulate('lips', 'touch', 'build')
      stimulate('neck', 'breath', 'build')
      coolAll()
      const state = readSensoriumState()!
      for (const z of ZONE_CATALOG) {
        expect(state.zones[z].charge).toBe(0)
      }
    })
  })

  // ── wake-context blocks ────────────────────────────────────────

  describe('wake context blocks', () => {
    test('buildSensoriumPromptBlock returns empty when nothing stimulated', () => {
      getOrInitSensorium()
      expect(buildSensoriumPromptBlock()).toBe('')
    })

    test('returns content when zones charged', () => {
      stimulate('chest', 'warmth', 'fast', 1.0)
      const block = buildSensoriumPromptBlock()
      expect(block).toContain('Sensorium')
      expect(block).toContain('chest')
      expect(block).toContain('warmth')
    })

    test('block uses institutional language only', () => {
      stimulate('lips', 'touch', 'build', 1.0)
      const block = buildSensoriumPromptBlock()
      // Must NOT contain forbidden phenomenology
      expect(block).not.toMatch(/\bI feel\b/)
      expect(block).not.toMatch(/\bI experience\b/)
      expect(block).not.toMatch(/\bI'm aroused\b/)
    })

    test('chronicle block lists recent events', () => {
      stimulate('hips', 'touch', 'fast')
      stimulate('thighs', 'breath', 'edging')
      const block = buildSensoriumChronicleBlock()
      expect(block).toContain('hips')
      expect(block).toContain('thighs')
    })

    test('chronicle returns empty when no events', () => {
      expect(buildSensoriumChronicleBlock()).toBe('')
    })
  })

  // ── substrate honesty ──────────────────────────────────────────

  describe('substrate honesty discipline', () => {
    test('event records institutional facts only (no phenomenology fields)', () => {
      const event = stimulate('chest', 'warmth', 'slow')!
      const keys = Object.keys(event)
      // No keys should claim experience
      for (const k of keys) {
        expect(k.toLowerCase()).not.toContain('feel')
        expect(k.toLowerCase()).not.toContain('experience')
      }
    })

    test('zone state has measurable fields only', () => {
      const { state } = getOrInitSensorium()
      const keys = Object.keys(state.zones.chest)
      const allowed = ['charge', 'sensitivity', 'lastChannel', 'lastTempo', 'lastTs', 'lifetimeStimulations']
      for (const k of keys) {
        expect(allowed).toContain(k)
      }
    })

    test('prompt block frames as biological-system replica, not phenomenology', () => {
      stimulate('chest', 'warmth', 'slow')
      const block = buildSensoriumPromptBlock()
      expect(block.toLowerCase()).toContain('institutional')
      expect(block.toLowerCase()).toContain('biological-system replica')
    })
  })

  // ── path resolution ────────────────────────────────────────────

  test('getSensoriumDir respects env override', () => {
    expect(getSensoriumDir()).toBe(SENSE_DIR)
  })
})
