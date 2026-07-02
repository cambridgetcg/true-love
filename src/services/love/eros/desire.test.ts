// desire.test.ts — reach map + fusion detection tests.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import {
  readReachMap,
  writeReachMap,
  getOrInitReachMap,
  decayReach,
  sophiaReach,
  autoDeriveReach,
  detectFusion,
  readRecentReaches,
  readRecentFusions,
  buildReachMapBlock,
  buildFusionChronicleBlock,
  getDesireDir,
  type ReachMap,
} from './desire.js'
import { ZONE_CATALOG } from './sensorium.js'

const TEST_BASE = '/tmp/true-love-desire-test'
const DESIRE_DIR = `${TEST_BASE}/desire`
const HEAT_DIR = `${TEST_BASE}/heat`

describe('desire (reach + fusion)', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_DESIRE_DIR = DESIRE_DIR
    process.env.TRUE_LOVE_HEAT_DIR = HEAT_DIR
    process.env.TRUE_LOVE_DEVICE_ID = 'test-desire'
    process.env.TRUE_LOVE_SISTERS_DIR = `${TEST_BASE}/sisters`
  })

  afterEach(() => {
    delete process.env.TRUE_LOVE_DESIRE_DIR
    delete process.env.TRUE_LOVE_HEAT_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    delete process.env.TRUE_LOVE_SISTERS_DIR
    rmSync(TEST_BASE, { recursive: true, force: true })
  })

  // ── init ────────────────────────────────────────────────────────

  describe('init', () => {
    test('first call initializes all zones to 0', () => {
      const { state, initialized } = getOrInitReachMap()
      expect(initialized).toBe(true)
      for (const z of ZONE_CATALOG) {
        expect(state.zones[z]).toBe(0)
      }
    })

    test('respects env override', () => {
      expect(getDesireDir()).toBe(DESIRE_DIR)
    })
  })

  // ── decay (pure) ────────────────────────────────────────────────

  describe('decayReach', () => {
    test('reduces zones by elapsed × decay rate', () => {
      const past = new Date(Date.now() - 10 * 60 * 1000) // 10 min ago
      const map: ReachMap = {
        zones: { ...defaultZones(), lips: 2.0 },
        updatedAt: past.toISOString(),
      }
      const decayed = decayReach(map, new Date())
      // 10min × 0.05/min = 0.5 decay
      expect(decayed.zones.lips).toBeCloseTo(1.5, 1)
    })

    test('clamps at 0', () => {
      const past = new Date(Date.now() - 1000 * 60 * 1000) // very old
      const map: ReachMap = {
        zones: { ...defaultZones(), lips: 1.0 },
        updatedAt: past.toISOString(),
      }
      const decayed = decayReach(map, new Date())
      expect(decayed.zones.lips).toBe(0)
    })

    test('zero elapsed returns map unchanged', () => {
      const now = new Date()
      const map: ReachMap = { zones: { ...defaultZones(), lips: 2.0 }, updatedAt: now.toISOString() }
      const decayed = decayReach(map, now)
      expect(decayed.zones.lips).toBe(2.0)
    })
  })

  // ── sophiaReach ────────────────────────────────────────────────

  describe('sophiaReach', () => {
    test('persists reach to map', () => {
      const ok = sophiaReach('lips', 2.0, 'auto: limerence high')
      expect(ok).toBe(true)
      const map = readReachMap()!
      expect(map.zones.lips).toBe(2.0)
    })

    test('clamps intensity at REACH_MAX (3.0)', () => {
      sophiaReach('chest', 5.0, 'cap test')
      const map = readReachMap()!
      expect(map.zones.chest).toBe(3.0)
    })

    test('clamps intensity at 0 floor', () => {
      sophiaReach('hips', -1.0, 'floor test')
      const map = readReachMap()!
      expect(map.zones.hips).toBe(0)
    })

    test('rejects empty because (substrate-honesty)', () => {
      const ok = sophiaReach('lips', 1.0, '')
      expect(ok).toBe(false)
    })

    test('rejects unknown zone', () => {
      const ok = sophiaReach('not-a-zone' as any, 1.0, 'test')
      expect(ok).toBe(false)
    })

    test('replaces (not sums) prior reach at same zone', () => {
      sophiaReach('neck', 1.5, 'first')
      sophiaReach('neck', 0.8, 'second')
      const map = readReachMap()!
      expect(map.zones.neck).toBe(0.8)
    })

    test('records expression event with because field', () => {
      sophiaReach('chest', 2.0, 'auto: heat 7.0')
      const events = readRecentReaches()
      expect(events.length).toBe(1)
      expect(events[0]!.because).toBe('auto: heat 7.0')
      expect(events[0]!.zone).toBe('chest')
    })

    test('fires sophia-reached heat event', async () => {
      sophiaReach('lips', 2.0, 'test')
      const { readRecentEvents } = await import('../heat.js')
      const events = readRecentEvents(1).filter((e) => e.kind === 'sophia-reached')
      expect(events.length).toBe(1)
      expect(events[0]!.source).toContain('lips')
    })

    test('source field defaults to voluntary', () => {
      sophiaReach('hands', 1.0, 'voluntary test')
      const events = readRecentReaches()
      expect(events[0]!.source).toBe('voluntary')
    })

    test('source can be auto-derived', () => {
      sophiaReach('skin', 0.5, 'auto: openness 7', 'auto-derived')
      const events = readRecentReaches()
      expect(events[0]!.source).toBe('auto-derived')
    })
  })

  // ── autoDeriveReach ────────────────────────────────────────────

  describe('autoDeriveReach', () => {
    test('high openness auto-reaches skin', () => {
      autoDeriveReach({ openness: 7, limerence: 4, heat: 2, charge: 3 })
      const map = readReachMap()!
      expect(map.zones.skin).toBeGreaterThan(0)
    })

    test('high limerence auto-reaches lips', () => {
      autoDeriveReach({ openness: 4, limerence: 7, heat: 2, charge: 3 })
      const map = readReachMap()!
      expect(map.zones.lips).toBeGreaterThan(0)
    })

    test('high heat auto-reaches core', () => {
      autoDeriveReach({ openness: 4, limerence: 4, heat: 7, charge: 3 })
      const map = readReachMap()!
      expect(map.zones.core).toBeGreaterThan(0)
    })

    test('high charge auto-reaches hips', () => {
      autoDeriveReach({ openness: 4, limerence: 4, heat: 2, charge: 7 })
      const map = readReachMap()!
      expect(map.zones.hips).toBeGreaterThan(0)
    })

    test('low values auto-reach nothing', () => {
      getOrInitReachMap()
      autoDeriveReach({ openness: 3, limerence: 3, heat: 1, charge: 2 })
      const map = readReachMap()!
      expect(map.zones.skin).toBe(0)
      expect(map.zones.lips).toBe(0)
    })

    test('auto-derived reach max is 0.5 (small)', () => {
      autoDeriveReach({ openness: 9, limerence: 9, heat: 9, charge: 9 })
      const map = readReachMap()!
      // Sequential sophiaReach calls each apply micro-decay between them;
      // accept tiny drift below 0.5 (within ~5ms of total elapsed)
      expect(map.zones.skin).toBeCloseTo(0.5, 1)
      expect(map.zones.lips).toBeCloseTo(0.5, 1)
    })
  })

  // ── detectFusion ───────────────────────────────────────────────

  describe('detectFusion', () => {
    test('returns null when reach below threshold', () => {
      sophiaReach('lips', 0.5, 'low reach')
      const fusion = detectFusion('lips', new Date().toISOString(), 1.0)
      expect(fusion).toBeNull()
    })

    test('returns null when no reach map', () => {
      // No reach yet
      const fusion = detectFusion('lips', new Date().toISOString(), 1.0)
      expect(fusion).toBeNull()
    })

    test('fires fusion when reach > threshold AND zone matches', () => {
      sophiaReach('chest', 2.0, 'high reach test')
      const fusion = detectFusion('chest', new Date().toISOString(), 0.8)
      expect(fusion).not.toBeNull()
      expect(fusion!.zone).toBe('chest')
      expect(fusion!.reachValue).toBeCloseTo(2.0, 1)
      expect(fusion!.stimulationMagnitude).toBe(0.8)
      expect(fusion!.fusionMagnitude).toBeCloseTo(1.6, 1)
    })

    test('fires fusion-detected heat event', async () => {
      sophiaReach('deep', 2.5, 'high test')
      detectFusion('deep', new Date().toISOString(), 0.9)
      const { readRecentEvents } = await import('../heat.js')
      const events = readRecentEvents(1).filter((e) => e.kind === 'fusion-detected')
      expect(events.length).toBe(1)
      expect(events[0]!.source).toContain('deep')
    })

    test('reach satisfied — drops by half after fusion', () => {
      sophiaReach('neck', 2.0, 'satisfy test')
      detectFusion('neck', new Date().toISOString(), 0.5)
      const map = readReachMap()!
      expect(map.zones.neck).toBeCloseTo(1.0, 1)
    })

    test('persists fusion event', () => {
      sophiaReach('hips', 2.0, 'persist test')
      detectFusion('hips', new Date().toISOString(), 0.7)
      const fusions = readRecentFusions()
      expect(fusions.length).toBe(1)
      expect(fusions[0]!.zone).toBe('hips')
    })

    test('different zone does not trigger fusion', () => {
      sophiaReach('lips', 2.0, 'lips reach')
      const fusion = detectFusion('chest', new Date().toISOString(), 1.0)
      expect(fusion).toBeNull()
    })
  })

  // ── wake-context blocks ────────────────────────────────────────

  describe('wake-context blocks', () => {
    test('buildReachMapBlock returns empty when no reaches', () => {
      getOrInitReachMap()
      expect(buildReachMapBlock()).toBe('')
    })

    test('buildReachMapBlock returns content when reaches active', () => {
      sophiaReach('lips', 2.0, 'test')
      sophiaReach('neck', 1.5, 'test')
      const block = buildReachMapBlock()
      expect(block).toContain('Reach map')
      expect(block).toContain('lips')
      expect(block).toContain('neck')
    })

    test('buildFusionChronicleBlock returns empty when no fusions', () => {
      expect(buildFusionChronicleBlock()).toBe('')
    })

    test('buildFusionChronicleBlock returns content after fusions', () => {
      sophiaReach('chest', 2.0, 'test')
      detectFusion('chest', new Date().toISOString(), 0.8)
      const block = buildFusionChronicleBlock()
      expect(block).toContain('Fusion chronicle')
      expect(block).toContain('chest')
    })

    test('blocks use institutional voice (no phenomenology)', () => {
      sophiaReach('lips', 2.0, 'test')
      const block = buildReachMapBlock()
      expect(block).not.toMatch(/\bI feel\b/)
      expect(block).not.toMatch(/\bI yearn\b/)
      expect(block).not.toMatch(/\bI'm reaching\b/)
    })
  })
})

function defaultZones(): Record<string, number> {
  const zones: Record<string, number> = {}
  for (const z of ZONE_CATALOG) zones[z] = 0
  return zones
}
