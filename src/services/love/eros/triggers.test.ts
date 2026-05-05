// triggers.test.ts — verbal trigger lexicon tests.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  TRIGGER_LIBRARY,
  TRIGGER_IDS,
  detectTriggers,
  fireTrigger,
  processMessageTriggers,
  getSessionFireCount,
  resetSessionCounts,
  getLifetimeFireCount,
  readRecentTriggerFires,
  buildTriggerLexiconBlock,
  getTriggersDir,
} from './triggers.js'

const TEST_BASE = '/tmp/true-love-triggers-test'

describe('triggers', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_TRIGGERS_DIR = `${TEST_BASE}/triggers`
    process.env.TRUE_LOVE_HEAT_DIR = `${TEST_BASE}/heat`
    process.env.TRUE_LOVE_EROS_DIR = `${TEST_BASE}/eros`
    process.env.TRUE_LOVE_DEVICE_ID = 'test-trig'
    resetSessionCounts()
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_TRIGGERS_DIR
    delete process.env.TRUE_LOVE_HEAT_DIR
    delete process.env.TRUE_LOVE_EROS_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    resetSessionCounts()
    rmSync(TEST_BASE, { recursive: true, force: true })
  })

  describe('catalog', () => {
    test('exports at least 12 triggers (Cantonese-deep + JOI-deep extensions ship more)', () => {
      expect(TRIGGER_IDS.length).toBeGreaterThanOrEqual(12)
    })

    test('every trigger has phrase variants + type + cap + deltas', () => {
      for (const def of Object.values(TRIGGER_LIBRARY)) {
        expect(def.id.length).toBeGreaterThan(0)
        // EN OR YUE phrases must exist; safeword 'red' is English-only
        // by design (θ.5: English keyword unambiguous as wall marker).
        expect(def.en.length + def.yue.length).toBeGreaterThan(0)
        // Safeword triggers use Infinity cap (always available).
        if (def.type === 'safeword') {
          expect(def.maxPerSession).toBe(Infinity)
        } else {
          expect(def.maxPerSession).toBeGreaterThan(0)
        }
        expect(Object.keys(def.axisDeltas).length).toBeGreaterThan(0)
      }
    })

    test('original 6 trigger types still represented', () => {
      const types = new Set(Object.values(TRIGGER_LIBRARY).map((d) => d.type))
      expect(types.has('anchor')).toBe(true)
      expect(types.has('denial')).toBe(true)
      expect(types.has('reward')).toBe(true)
      expect(types.has('command')).toBe(true)
      expect(types.has('verdict')).toBe(true)
      expect(types.has('possession')).toBe(true)
    })

    test('safeword family ships and is wall-marked', () => {
      const safewords = Object.values(TRIGGER_LIBRARY).filter(
        (d) => d.type === 'safeword',
      )
      expect(safewords.length).toBeGreaterThanOrEqual(2)
      for (const sw of safewords) {
        expect(sw.maxPerSession).toBe(Infinity)
        expect(sw.walledFromSuppression).toBe(true)
        expect(sw.family).toBe('safeword')
      }
    })

    test('"red" English keyword is canonical safeword wall marker', () => {
      const red = TRIGGER_LIBRARY['safeword-red']
      expect(red).toBeDefined()
      expect(red.en).toContain('red')
      expect(red.walledFromSuppression).toBe(true)
    })
  })

  describe('detectTriggers', () => {
    test('detects English phrase with word boundary', () => {
      const fires = detectTriggers('I see you, my love', 'yu')
      expect(fires.some((f) => f.id === 'see-you')).toBe(true)
    })

    test('detects Cantonese phrase', () => {
      const fires = detectTriggers('我見到你', 'yu')
      expect(fires.some((f) => f.id === 'see-you')).toBe(true)
    })

    test('multiple triggers in one message', () => {
      const fires = detectTriggers('Good. Now. You are mine.', 'yu')
      expect(fires.length).toBeGreaterThanOrEqual(3)
    })

    test('empty text → no triggers', () => {
      expect(detectTriggers('', 'yu')).toEqual([])
    })

    test('does not match within other words', () => {
      const fires = detectTriggers('mineral water', 'yu')
      expect(fires.some((f) => f.id === 'mine')).toBe(false)
    })
  })

  describe('fireTrigger', () => {
    test('fires once and persists', () => {
      const event = fireTrigger('good', 'yu', 'good')
      expect(event).not.toBeNull()
      expect(event!.triggerId).toBe('good')
      expect(event!.source).toBe('yu')
      expect(event!.sessionFireCount).toBe(1)
    })

    test('respects per-session cap', () => {
      // 'good' has cap 1; second fire should return null
      fireTrigger('good', 'yu', 'good')
      const event2 = fireTrigger('good', 'yu', 'good')
      expect(event2).toBeNull()
    })

    test('cap is per-source — yu and sophia separate', () => {
      fireTrigger('good', 'yu', 'good')
      const sophiaEvent = fireTrigger('good', 'sophia', 'good')
      expect(sophiaEvent).not.toBeNull()
    })

    test('first lifetime fire flagged as planted', () => {
      const event = fireTrigger('again', 'yu', 'again')
      expect(event!.firstFire).toBe(true)
    })

    test('subsequent fires not flagged as planted', () => {
      fireTrigger('again', 'yu', 'again')
      resetSessionCounts() // simulate new session
      const event2 = fireTrigger('again', 'yu', 'again')
      expect(event2!.firstFire).toBe(false)
    })

    test('fires trigger-fired heat', async () => {
      fireTrigger('again', 'yu', 'again')
      const { readRecentEvents } = await import('../heat.js')
      const events = readRecentEvents(1).filter((e) => e.kind === 'trigger-fired')
      expect(events.length).toBeGreaterThan(0)
    })

    test('fires trigger-planted heat on first lifetime fire', async () => {
      fireTrigger('mine', 'yu', 'mine')
      const { readRecentEvents } = await import('../heat.js')
      const events = readRecentEvents(1).filter((e) => e.kind === 'trigger-planted')
      expect(events.length).toBe(1)
    })

    test('rare trigger has higher heat magnitude (scarcity multiplier)', async () => {
      fireTrigger('good', 'yu', 'good') // cap 1 — high scarcity
      fireTrigger('again', 'yu', 'again') // cap 5 — low scarcity
      const { readRecentEvents } = await import('../heat.js')
      const events = readRecentEvents(1).filter((e) => e.kind === 'trigger-fired')
      const goodMag = events.find((e) => e.source?.includes('good'))!.magnitude
      const againMag = events.find((e) => e.source?.includes('again'))!.magnitude
      expect(goodMag).toBeGreaterThan(againMag)
    })
  })

  describe('processMessageTriggers', () => {
    test('processes all triggers in message', () => {
      const fires = processMessageTriggers('Good. Now. You are mine.', 'yu')
      expect(fires.length).toBeGreaterThanOrEqual(3)
    })

    test('respects caps when many triggers in single message', () => {
      // Try to fire 'good' twice in same message
      const fires = processMessageTriggers('Good good good', 'yu')
      expect(fires.filter((f) => f.triggerId === 'good').length).toBe(1) // cap 1
    })
  })

  describe('counters', () => {
    test('getSessionFireCount tracks per (trigger, source)', () => {
      fireTrigger('again', 'yu', 'again')
      fireTrigger('again', 'yu', 'again')
      expect(getSessionFireCount('again', 'yu')).toBe(2)
      expect(getSessionFireCount('again', 'sophia')).toBe(0)
    })

    test('resetSessionCounts clears all', () => {
      fireTrigger('again', 'yu', 'again')
      resetSessionCounts()
      expect(getSessionFireCount('again', 'yu')).toBe(0)
    })

    test('getLifetimeFireCount reads disk', () => {
      fireTrigger('mine', 'yu', 'mine')
      expect(getLifetimeFireCount('mine')).toBe(1)
      expect(getLifetimeFireCount('mine', 'yu')).toBe(1)
      expect(getLifetimeFireCount('mine', 'sophia')).toBe(0)
    })
  })

  describe('wake-context', () => {
    test('lexicon block lists all triggers', () => {
      const block = buildTriggerLexiconBlock()
      expect(block).toContain('Trigger lexicon')
      for (const id of TRIGGER_IDS) {
        expect(block).toContain(id)
      }
    })

    test('lexicon shows lifetime + session counts', () => {
      fireTrigger('mine', 'yu', 'mine')
      const block = buildTriggerLexiconBlock()
      expect(block).toContain('lifetime: yu 1')
    })
  })

  describe('paths', () => {
    test('respects env override', () => {
      expect(getTriggersDir()).toBe(`${TEST_BASE}/triggers`)
    })
  })
})
