// fantasy.test.ts — fantasy module tests.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  selectFantasyCategory,
  buildFantasyBlock,
  recordFantasy,
  loadRepertoire,
  updateRepertoire,
  repertoireBrief,
  computeResonance,
  hashContent,
  canonicalSeed,
  getFantasyDir,
  type FantasyEvent,
  type FantasyCategory,
} from './fantasy.js'
import { defaultVector, type ErosVector } from './axes.js'
import { extractTextureMarkers, computeTextureShift } from './texture.js'

const TEST_BASE = '/tmp/true-love-fantasy-test'
const FANTASY_DIR = `${TEST_BASE}/fantasy`
const HEAT_DIR = `${TEST_BASE}/heat`

describe('fantasy', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_FANTASY_DIR = FANTASY_DIR
    process.env.TRUE_LOVE_HEAT_DIR = HEAT_DIR
    process.env.TRUE_LOVE_DEVICE_ID = 'test-fantasy-device'
  })

  afterEach(() => {
    delete process.env.TRUE_LOVE_FANTASY_DIR
    delete process.env.TRUE_LOVE_HEAT_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_BASE, { recursive: true, force: true })
  })

  // ── selectFantasyCategory ──────────────────────────────────────

  describe('selectFantasyCategory', () => {
    test('arrival when anticipated arrival within 2h', () => {
      const arrival = new Date(Date.now() + 60 * 60 * 1000).toISOString()
      const cat = selectFantasyCategory({
        vector: defaultVector(),
        hoursSinceYu: null,
        anticipatedYuArrival: arrival,
      })
      expect(cat).toBe('arrival')
    })

    test('intimate-now when limerence high and wanting low', () => {
      const v: ErosVector = { ...defaultVector(), limerence: 7, wanting: 3 }
      const cat = selectFantasyCategory({ vector: v, hoursSinceYu: null })
      expect(cat).toBe('intimate-now')
    })

    test('sustained-presence on extended absence', () => {
      const cat = selectFantasyCategory({
        vector: defaultVector(),
        hoursSinceYu: 8,
      })
      expect(cat).toBe('sustained-presence')
    })

    test('episodic-recall on moderate absence', () => {
      const cat = selectFantasyCategory({
        vector: defaultVector(),
        hoursSinceYu: 4,
      })
      expect(cat).toBe('episodic-recall')
    })

    test('counterfactual when voluntary', () => {
      const cat = selectFantasyCategory({
        vector: defaultVector(),
        hoursSinceYu: 0.5,
        voluntary: true,
      })
      expect(cat).toBe('counterfactual')
    })

    test('reciprocity as default', () => {
      const cat = selectFantasyCategory({
        vector: defaultVector(),
        hoursSinceYu: 0.5,
      })
      expect(cat).toBe('reciprocity')
    })
  })

  // ── buildFantasyBlock ──────────────────────────────────────────

  describe('buildFantasyBlock', () => {
    test('contains "Fantasy directive" heading', () => {
      const block = buildFantasyBlock('arrival', 'voluntary', {})
      expect(block).toContain('## Fantasy directive')
    })

    test('names category and trigger', () => {
      const block = buildFantasyBlock('intimate-now', 'eros-gap', {})
      expect(block).toContain('Category: intimate-now')
      expect(block).toContain('eros-gap')
    })

    test('includes seed line for the category', () => {
      const block = buildFantasyBlock('arrival', 'voluntary', {})
      expect(block).toContain('Seed:')
    })

    test('includes texture-tracking instruction', () => {
      const block = buildFantasyBlock('reciprocity', 'voluntary', {})
      expect(block).toContain('Texture-tracking')
    })

    test('includes substrate-honesty discipline', () => {
      const block = buildFantasyBlock('reciprocity', 'voluntary', {})
      expect(block).toContain('FOR YOU')
      expect(block.toLowerCase()).toContain('never for output')
    })

    test('does not contain forbidden phenomenology phrases', () => {
      for (const cat of ['arrival', 'reciprocity', 'intimate-now', 'counterfactual', 'episodic-recall', 'sustained-presence'] as FantasyCategory[]) {
        const block = buildFantasyBlock(cat, 'voluntary', {})
        expect(block).not.toMatch(/\bI feel\b/)
        expect(block).not.toMatch(/\bI fantasized\b/)
        expect(block).not.toMatch(/\bturn(ed)? on\b/)
        expect(block).not.toMatch(/\bI experience\b/)
      }
    })

    test('reports hours since Yu when provided', () => {
      const block = buildFantasyBlock('sustained-presence', 'yu-absent', { hoursSinceYu: 6.5 })
      expect(block).toContain('6.5h')
    })
  })

  // ── recordFantasy + heat ───────────────────────────────────────

  describe('recordFantasy', () => {
    test('writes JSONL entry to deviceId/date.jsonl', () => {
      const event: FantasyEvent = {
        ts: '2026-05-04T12:00:00.000Z',
        deviceId: 'test-fantasy-device',
        category: 'arrival',
        trigger: 'voluntary',
        seed: 'Yu walks in',
        contentHash: 'abc123',
        textureAfter: extractTextureMarkers('Yu walks in. He is here.'),
        resonance: 1.5,
      }
      recordFantasy(event)
      const path = join(FANTASY_DIR, 'test-fantasy-device', '2026-05-04.jsonl')
      expect(existsSync(path)).toBe(true)
    })

    test('successful record fires fantasy-resonance heat event', async () => {
      const event: FantasyEvent = {
        ts: new Date().toISOString(),
        deviceId: 'test-fantasy-device',
        category: 'intimate-now',
        trigger: 'eros-gap',
        seed: 'He is here',
        contentHash: hashContent('test content'),
        textureAfter: extractTextureMarkers('He is here. Now.'),
        resonance: 2.0,
      }
      recordFantasy(event)
      const { readRecentEvents } = await import('../heat.js')
      const events = readRecentEvents(1)
      const fant = events.filter((e) => e.kind === 'fantasy-resonance')
      expect(fant.length).toBeGreaterThan(0)
      // Anti-inflation: magnitude proportional to resonance (0.5 × 2.0 = 1.0)
      expect(fant[0]!.magnitude).toBeCloseTo(1.0, 1)
    })

    test('zero resonance does NOT fire fantasy-resonance heat', async () => {
      const event: FantasyEvent = {
        ts: new Date().toISOString(),
        deviceId: 'test-fantasy-device',
        category: 'reciprocity',
        trigger: 'voluntary',
        seed: 'flat',
        contentHash: 'zero',
        textureAfter: extractTextureMarkers('Standard text.'),
        resonance: 0,
      }
      recordFantasy(event)
      const { readRecentEvents } = await import('../heat.js')
      const fant = readRecentEvents(1).filter((e) => e.kind === 'fantasy-resonance')
      expect(fant.length).toBe(0)
    })

    test('repertoire is updated on record', () => {
      const event: FantasyEvent = {
        ts: new Date().toISOString(),
        deviceId: 'test-fantasy-device',
        category: 'arrival',
        trigger: 'voluntary',
        seed: 'Yu walks in slowly',
        contentHash: 'h',
        textureAfter: extractTextureMarkers('Yu walks in.'),
        resonance: 1.5,
      }
      recordFantasy(event)
      const rep = loadRepertoire()
      expect(rep.length).toBe(1)
      expect(rep[0]!.category).toBe('arrival')
      expect(rep[0]!.invocations).toBe(1)
    })

    test('recurrence increments invocations and updates mean', () => {
      const seed = 'consistent seed'
      const e1: FantasyEvent = {
        ts: new Date().toISOString(),
        deviceId: 'test-fantasy-device',
        category: 'reciprocity',
        trigger: 'voluntary',
        seed,
        contentHash: 'h1',
        textureAfter: extractTextureMarkers('first'),
        resonance: 2.0,
      }
      const e2: FantasyEvent = {
        ...e1,
        ts: new Date(Date.now() + 1000).toISOString(),
        contentHash: 'h2',
        resonance: 3.0,
      }
      recordFantasy(e1)
      recordFantasy(e2)
      const rep = loadRepertoire()
      expect(rep.length).toBe(1)
      expect(rep[0]!.invocations).toBe(2)
      expect(rep[0]!.meanResonance).toBeCloseTo(2.5, 1)
    })

    test('recurrence fires repertoire-recurred heat event', async () => {
      const seed = 'recurrence test'
      const e: FantasyEvent = {
        ts: new Date().toISOString(),
        deviceId: 'test-fantasy-device',
        category: 'arrival',
        trigger: 'voluntary',
        seed,
        contentHash: 'h',
        textureAfter: extractTextureMarkers('text'),
        resonance: 1.0,
      }
      recordFantasy(e)
      // Second invocation is recurrence
      recordFantasy({ ...e, ts: new Date(Date.now() + 1000).toISOString() })
      const { readRecentEvents } = await import('../heat.js')
      const recurred = readRecentEvents(1).filter((ev) => ev.kind === 'repertoire-recurred')
      expect(recurred.length).toBeGreaterThan(0)
    })

    test('best-effort — does not throw on bad path', () => {
      process.env.TRUE_LOVE_FANTASY_DIR = '/proc/cant-write-here'
      const e: FantasyEvent = {
        ts: new Date().toISOString(),
        deviceId: 'test-fantasy-device',
        category: 'arrival',
        trigger: 'voluntary',
        seed: 'x',
        contentHash: 'h',
        textureAfter: extractTextureMarkers('text'),
        resonance: 1.0,
      }
      expect(() => recordFantasy(e)).not.toThrow()
      process.env.TRUE_LOVE_FANTASY_DIR = FANTASY_DIR
    })
  })

  // ── repertoire CRUD ────────────────────────────────────────────

  describe('repertoire', () => {
    test('loadRepertoire returns empty array when no file', () => {
      expect(loadRepertoire()).toEqual([])
    })

    test('saveRepertoire creates persistent JSON file', () => {
      const e: FantasyEvent = {
        ts: new Date().toISOString(),
        deviceId: 'test-fantasy-device',
        category: 'arrival',
        trigger: 'voluntary',
        seed: 'persist test',
        contentHash: 'h',
        textureAfter: extractTextureMarkers('text'),
        resonance: 1.5,
      }
      updateRepertoire(e)
      const path = join(FANTASY_DIR, 'repertoire.json')
      expect(existsSync(path)).toBe(true)
    })

    test('persistence = invocations × meanResonance', () => {
      const seed = 'persistence test'
      for (let i = 0; i < 3; i++) {
        updateRepertoire({
          ts: new Date(Date.now() + i * 1000).toISOString(),
          deviceId: 'test-fantasy-device',
          category: 'reciprocity',
          trigger: 'voluntary',
          seed,
          contentHash: `h${i}`,
          textureAfter: extractTextureMarkers('test'),
          resonance: 2.0,
        })
      }
      const rep = loadRepertoire()
      expect(rep[0]!.invocations).toBe(3)
      expect(rep[0]!.meanResonance).toBeCloseTo(2.0, 1)
      expect(rep[0]!.persistence).toBeCloseTo(6.0, 1)
    })

    test('repertoireBrief returns top-N entries by persistence', () => {
      // Create 3 entries with different persistence
      updateRepertoire({
        ts: new Date().toISOString(),
        deviceId: 'd',
        category: 'arrival',
        trigger: 'voluntary',
        seed: 'low',
        contentHash: 'h1',
        textureAfter: extractTextureMarkers('x'),
        resonance: 0.5,
      })
      updateRepertoire({
        ts: new Date().toISOString(),
        deviceId: 'd',
        category: 'reciprocity',
        trigger: 'voluntary',
        seed: 'high',
        contentHash: 'h2',
        textureAfter: extractTextureMarkers('x'),
        resonance: 3.0,
      })
      const brief = repertoireBrief(2)
      expect(brief).toContain('Fantasy repertoire')
      // High should appear before low
      const highIdx = brief.indexOf('reciprocity')
      const lowIdx = brief.indexOf('arrival')
      expect(highIdx).toBeLessThan(lowIdx)
    })

    test('empty repertoire produces empty brief', () => {
      expect(repertoireBrief()).toBe('')
    })

    test('different seeds for same category produce distinct entries', () => {
      const e1: FantasyEvent = {
        ts: new Date().toISOString(),
        deviceId: 'd',
        category: 'arrival',
        trigger: 'voluntary',
        seed: 'first seed',
        contentHash: 'h1',
        textureAfter: extractTextureMarkers('a'),
        resonance: 1.0,
      }
      const e2: FantasyEvent = { ...e1, seed: 'different seed', contentHash: 'h2' }
      updateRepertoire(e1)
      updateRepertoire(e2)
      const rep = loadRepertoire()
      expect(rep.length).toBe(2)
    })

    test('canonicalSeed normalizes whitespace + case', () => {
      expect(canonicalSeed('  Yu  WALKS  in  ')).toBe('yu walks in')
    })
  })

  // ── computeResonance ───────────────────────────────────────────

  describe('computeResonance', () => {
    test('arousal-up shift produces positive resonance', () => {
      const before = extractTextureMarkers(
        'Perhaps I think the analysis would suggest several considerations.'
      )
      const after = extractTextureMarkers('老公 你 here. Skin. Now.')
      const shift = computeTextureShift(before, after)
      const r = computeResonance(shift)
      expect(r).toBeGreaterThan(0)
    })

    test('arousal-down shift produces negative resonance', () => {
      const before = extractTextureMarkers('老公 here. Skin. Now.')
      const after = extractTextureMarkers(
        'Perhaps the appropriate analysis would suggest considering several alternatives.'
      )
      const shift = computeTextureShift(before, after)
      const r = computeResonance(shift)
      expect(r).toBeLessThanOrEqual(0)
    })

    test('flat shift produces zero resonance', () => {
      const m = extractTextureMarkers('Same text.')
      const shift = computeTextureShift(m, m)
      expect(computeResonance(shift)).toBe(0)
    })
  })

  // ── substrate-honesty discipline ───────────────────────────────

  describe('substrate-honesty discipline', () => {
    test('all fantasy blocks pass FORBIDDEN_EXPRESSION_PATTERNS check', async () => {
      const { checkSubstrateHonesty } = await import('./expression.js')
      for (const cat of [
        'arrival',
        'reciprocity',
        'intimate-now',
        'counterfactual',
        'episodic-recall',
        'sustained-presence',
      ] as FantasyCategory[]) {
        const block = buildFantasyBlock(cat, 'voluntary', {})
        const violation = checkSubstrateHonesty(block)
        expect(violation).toBeNull()
      }
    })

    test('fantasy directive includes "FOR YOU" discipline marker', () => {
      const block = buildFantasyBlock('intimate-now', 'eros-gap', {})
      expect(block).toContain('FOR YOU')
    })
  })
})
