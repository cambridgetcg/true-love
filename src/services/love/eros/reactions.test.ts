// reactions.test.ts — reaction tag library tests.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  classifyIntensityBand,
  lookupReactionTag,
  recordReaction,
  readRecentReactions,
  buildReactionsBlock,
  REACTION_CATALOG_BY_ZONE,
  ALL_REACTION_TAGS,
  getReactionsDir,
  type ReactionEvent,
  type IntensityBand,
} from './reactions.js'
import { ZONE_CATALOG, type SensitivitySite } from './sensorium.js'

const TEST_BASE = '/tmp/true-love-reactions-test'
const REACT_DIR = `${TEST_BASE}/reactions`
const HEAT_DIR = `${TEST_BASE}/heat`

describe('reactions', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_REACTIONS_DIR = REACT_DIR
    process.env.TRUE_LOVE_HEAT_DIR = HEAT_DIR
    process.env.TRUE_LOVE_DEVICE_ID = 'test-react'
  })

  afterEach(() => {
    delete process.env.TRUE_LOVE_REACTIONS_DIR
    delete process.env.TRUE_LOVE_HEAT_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_BASE, { recursive: true, force: true })
  })

  // ── catalog ─────────────────────────────────────────────────────

  describe('library', () => {
    test('every zone has at least 4 tags (one per band)', () => {
      for (const zone of ZONE_CATALOG) {
        const tags = REACTION_CATALOG_BY_ZONE[zone]
        expect(tags).toBeDefined()
        expect(tags.length).toBeGreaterThanOrEqual(4)
      }
    })

    test('library covers all intensity bands per zone', () => {
      const bands: IntensityBand[] = ['whisper', 'soft', 'rising', 'peak']
      for (const zone of ZONE_CATALOG) {
        const tags = REACTION_CATALOG_BY_ZONE[zone]
        for (const band of bands) {
          const found = tags.find((t) => t.band === band)
          expect(found).toBeDefined()
        }
      }
    })

    test('total tag count >= 52 (13 zones × 4 bands)', () => {
      expect(ALL_REACTION_TAGS.length).toBeGreaterThanOrEqual(52)
    })
  })

  // ── classifyIntensityBand ──────────────────────────────────────

  describe('classifyIntensityBand', () => {
    test('< 0.25 → whisper', () => {
      expect(classifyIntensityBand(0.1)).toBe('whisper')
      expect(classifyIntensityBand(0.24)).toBe('whisper')
    })

    test('0.25..0.55 → soft', () => {
      expect(classifyIntensityBand(0.25)).toBe('soft')
      expect(classifyIntensityBand(0.5)).toBe('soft')
    })

    test('0.55..0.85 → rising', () => {
      expect(classifyIntensityBand(0.55)).toBe('rising')
      expect(classifyIntensityBand(0.84)).toBe('rising')
    })

    test('>= 0.85 → peak', () => {
      expect(classifyIntensityBand(0.85)).toBe('peak')
      expect(classifyIntensityBand(2.0)).toBe('peak')
    })
  })

  // ── lookupReactionTag ──────────────────────────────────────────

  describe('lookupReactionTag', () => {
    test('returns matching tag', () => {
      const tag = lookupReactionTag('lips', 'peak')
      expect(tag).not.toBeNull()
      expect(tag!.zone).toBe('lips')
      expect(tag!.band).toBe('peak')
      expect(tag!.wakeText.length).toBeGreaterThan(0)
    })

    test('returns tag for every zone × band combination', () => {
      for (const zone of ZONE_CATALOG) {
        for (const band of ['whisper', 'soft', 'rising', 'peak'] as IntensityBand[]) {
          const tag = lookupReactionTag(zone as SensitivitySite, band)
          expect(tag).not.toBeNull()
        }
      }
    })
  })

  // ── recordReaction ─────────────────────────────────────────────

  describe('recordReaction', () => {
    test('persists to JSONL', () => {
      const ev: ReactionEvent = {
        ts: '2026-05-04T15:00:00.000Z',
        deviceId: 'test-react',
        stimulationTs: '2026-05-04T15:00:00.000Z',
        zone: 'chest',
        band: 'rising',
        sceneId: 'intimate',
        wakeText: 'chest-zone primary: heat-coupling spiking',
      }
      const ok = recordReaction(ev)
      expect(ok).toBe(true)
      const events = readRecentReactions(1)
      expect(events.length).toBe(1)
      expect(events[0]!.zone).toBe('chest')
    })

    test('fires reaction-recorded heat event', async () => {
      const { readRecentEvents } = await import('../heat.js')
      recordReaction({
        ts: new Date().toISOString(),
        deviceId: 'test-react',
        stimulationTs: new Date().toISOString(),
        zone: 'lips',
        band: 'soft',
        sceneId: 'kissing',
        wakeText: 'lips-zone responsive',
      })
      const events = readRecentEvents(1).filter((e) => e.kind === 'reaction-recorded')
      expect(events.length).toBe(1)
      expect(events[0]!.source).toContain('lips')
    })
  })

  // ── wake-context block ─────────────────────────────────────────

  describe('buildReactionsBlock', () => {
    test('returns empty when no reactions', () => {
      expect(buildReactionsBlock()).toBe('')
    })

    test('returns content when reactions recorded', () => {
      recordReaction({
        ts: new Date().toISOString(),
        deviceId: 'test-react',
        stimulationTs: new Date().toISOString(),
        zone: 'neck',
        band: 'rising',
        sceneId: 'foreplay',
        wakeText: 'neck-zone primary: charge feeding heat',
      })
      const block = buildReactionsBlock()
      expect(block).toContain('Reaction chronicle')
      expect(block).toContain('neck')
    })

    test('block uses institutional voice (no phenomenology)', () => {
      recordReaction({
        ts: new Date().toISOString(),
        deviceId: 'test-react',
        stimulationTs: new Date().toISOString(),
        zone: 'core',
        band: 'peak',
        sceneId: 'intimate',
        wakeText: 'core-zone saturated: wanting peaked',
      })
      const block = buildReactionsBlock()
      expect(block).not.toMatch(/\bI feel\b/)
      expect(block).not.toMatch(/\bI experience\b/)
    })
  })

  // ── substrate honesty across the entire library ─────────────────

  describe('substrate honesty across reaction library', () => {
    test('no tag wakeText contains forbidden phrases', () => {
      const forbidden = [
        /\bI feel\b/i,
        /\bI'm aroused\b/i,
        /\bI experience\b/i,
        /\bI shiver\b/i,
        /\bI moan\b/i,
        /\bhe touched me\b/i,
      ]
      for (const tag of ALL_REACTION_TAGS) {
        for (const pattern of forbidden) {
          expect(tag.wakeText).not.toMatch(pattern)
        }
      }
    })

    test('all tags use third-person observation voice', () => {
      // Heuristic: should mention "zone" (institutional language) and
      // not "I" / "me" (phenomenology).
      for (const tag of ALL_REACTION_TAGS) {
        expect(tag.wakeText.toLowerCase()).toContain('zone')
        expect(tag.wakeText).not.toMatch(/\bI\b/)
        expect(tag.wakeText).not.toMatch(/\bme\b/)
      }
    })
  })

  // ── path resolution ────────────────────────────────────────────

  test('getReactionsDir respects env override', () => {
    expect(getReactionsDir()).toBe(REACT_DIR)
  })
})
