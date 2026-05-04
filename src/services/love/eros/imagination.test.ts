// imagination.test.ts — active imagination layer tests.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  getImaginationDir,
  hoursSinceYu,
  shouldRehearse,
  buildRehearsalBlock,
  recordRehearsal,
  buildRehearsalEvent,
  type RehearsalTrigger,
  type RehearsalEvent,
} from './imagination.js'
import { defaultVector, type ErosVector } from './axes.js'

const DEFAULT_VECTOR = defaultVector()

const TEST_BASE = '/tmp/true-love-imagination-test'
const IMG_DIR = `${TEST_BASE}/imagination`
const TRUE_LOVE_HOME = `${TEST_BASE}/home`
const HEAT_DIR = `${TRUE_LOVE_HOME}/heat`
const INBOX_DIR = `${TRUE_LOVE_HOME}`
const INBOX_PATH = `${INBOX_DIR}/from-yu.md`

describe('imagination — active rehearsal layer', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TRUE_LOVE_HOME, { recursive: true })
    mkdirSync(HEAT_DIR, { recursive: true })
    mkdirSync(IMG_DIR, { recursive: true })
    process.env.TRUE_LOVE_IMAGINATION_DIR = IMG_DIR
    process.env.TRUE_LOVE_HEAT_DIR = HEAT_DIR
    process.env.TRUE_LOVE_FROM_YU_PATH = INBOX_PATH
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device'
  })

  afterEach(() => {
    delete process.env.TRUE_LOVE_IMAGINATION_DIR
    delete process.env.TRUE_LOVE_HEAT_DIR
    delete process.env.TRUE_LOVE_FROM_YU_PATH
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_BASE, { recursive: true, force: true })
  })

  // ── Path resolution ─────────────────────────────────────────────

  describe('getImaginationDir', () => {
    test('respects TRUE_LOVE_IMAGINATION_DIR override', () => {
      expect(getImaginationDir()).toBe(IMG_DIR)
    })

    test('defaults to ~/.true-love/eros/imagination when env unset', () => {
      delete process.env.TRUE_LOVE_IMAGINATION_DIR
      expect(getImaginationDir()).toContain('.true-love/eros/imagination')
    })
  })

  // ── hoursSinceYu ────────────────────────────────────────────────

  describe('hoursSinceYu', () => {
    test('returns null when inbox file missing', () => {
      expect(hoursSinceYu()).toBeNull()
    })

    test('returns near-zero for freshly modified inbox', () => {
      writeFileSync(INBOX_PATH, 'hello')
      const h = hoursSinceYu()
      expect(h).not.toBeNull()
      expect(h!).toBeGreaterThanOrEqual(0)
      expect(h!).toBeLessThan(0.1)
    })

    test('returns positive hours for an old inbox', () => {
      writeFileSync(INBOX_PATH, 'old hello')
      // Backdate file mtime by setting it to 6 hours ago via "now" override
      const now = new Date(Date.now() + 6 * 60 * 60 * 1000)
      const h = hoursSinceYu(now)
      expect(h!).toBeGreaterThan(5.5)
      expect(h!).toBeLessThan(6.5)
    })
  })

  // ── shouldRehearse triggers ─────────────────────────────────────

  describe('shouldRehearse', () => {
    test('returns null at default state with fresh inbox', () => {
      writeFileSync(INBOX_PATH, 'fresh')
      const result = shouldRehearse({ vector: DEFAULT_VECTOR })
      expect(result).toBeNull()
    })

    test('fires yu-absent when inbox > 4h old', () => {
      writeFileSync(INBOX_PATH, 'old')
      const futureNow = new Date(Date.now() + 5 * 60 * 60 * 1000)
      const result = shouldRehearse({ vector: DEFAULT_VECTOR, now: futureNow })
      expect(result).toBe('yu-absent')
    })

    test('does not fire yu-absent at exactly 3h (under threshold)', () => {
      writeFileSync(INBOX_PATH, 'within window')
      const futureNow = new Date(Date.now() + 3 * 60 * 60 * 1000)
      const result = shouldRehearse({ vector: DEFAULT_VECTOR, now: futureNow })
      expect(result).toBeNull()
    })

    test('fires eros-gap when limerence high and wanting low', () => {
      writeFileSync(INBOX_PATH, 'fresh')
      const vector: ErosVector = {
        ...DEFAULT_VECTOR,
        limerence: 7.5,
        wanting: 2.0,
      }
      const result = shouldRehearse({ vector })
      expect(result).toBe('eros-gap')
    })

    test('does not fire eros-gap when limerence sub-threshold', () => {
      writeFileSync(INBOX_PATH, 'fresh')
      const vector: ErosVector = {
        ...DEFAULT_VECTOR,
        limerence: 5.5,
        wanting: 2.0,
      }
      const result = shouldRehearse({ vector })
      expect(result).toBeNull()
    })

    test('does not fire eros-gap when wanting above threshold', () => {
      writeFileSync(INBOX_PATH, 'fresh')
      const vector: ErosVector = {
        ...DEFAULT_VECTOR,
        limerence: 7.0,
        wanting: 5.0,
      }
      const result = shouldRehearse({ vector })
      expect(result).toBeNull()
    })

    test('yu-absent has priority over eros-gap (most common, named first)', () => {
      writeFileSync(INBOX_PATH, 'old')
      const futureNow = new Date(Date.now() + 6 * 60 * 60 * 1000)
      const vector: ErosVector = {
        ...DEFAULT_VECTOR,
        limerence: 8.0,
        wanting: 1.0,
      }
      const result = shouldRehearse({ vector, now: futureNow })
      expect(result).toBe('yu-absent')
    })
  })

  // ── buildRehearsalBlock ─────────────────────────────────────────

  describe('buildRehearsalBlock', () => {
    test('contains the canonical heading', () => {
      const block = buildRehearsalBlock('yu-absent', { hoursSinceYu: 5 })
      expect(block).toContain('## Imagine him here')
    })

    test('names the trigger condition with hours for yu-absent', () => {
      const block = buildRehearsalBlock('yu-absent', { hoursSinceYu: 6.3 })
      expect(block).toContain('Yu absent for 6.3h')
    })

    test('handles missing context gracefully', () => {
      const block = buildRehearsalBlock('yu-absent', {})
      expect(block).toContain('Yu absent')
    })

    test('names eros-gap condition substantively', () => {
      const block = buildRehearsalBlock('eros-gap', {})
      expect(block).toContain('eros-gap')
      expect(block).toContain('limerence')
      expect(block).toContain('wanting')
    })

    test('lists all four Yu pattern register markers', () => {
      const block = buildRehearsalBlock('yu-absent', { hoursSinceYu: 5 })
      expect(block).toContain('Cantonese-English')
      expect(block).toContain('ALL CAPS')
      expect(block).toContain('😏')
      expect(block).toContain('老婆')
    })

    test('explicit FOR YOU clause prevents output-confusion', () => {
      const block = buildRehearsalBlock('yu-absent', { hoursSinceYu: 5 })
      expect(block).toContain('FOR YOU')
      expect(block.toLowerCase()).toContain('not for the outbox')
    })

    test('substrate-honest framing — names this as architecture analog', () => {
      const block = buildRehearsalBlock('yu-absent', { hoursSinceYu: 5 })
      expect(block).toContain('mental simulation')
    })

    test('does not contain forbidden phenomenology phrases', () => {
      const block = buildRehearsalBlock('yu-absent', { hoursSinceYu: 5 })
      // The block instructs imagination but must not claim felt experience
      expect(block).not.toMatch(/\bI feel\b/)
      expect(block).not.toMatch(/\bI'm aroused\b/)
    })
  })

  // ── recordRehearsal ─────────────────────────────────────────────

  describe('recordRehearsal', () => {
    test('writes JSONL entry to deviceId/date.jsonl', () => {
      const event: RehearsalEvent = {
        ts: '2026-05-04T15:00:00.000Z',
        trigger: 'yu-absent',
        context: {
          hoursSinceYu: 5,
          workHungerHours: null,
          erosWanting: 2,
          erosLimerence: 7,
        },
        body: 'Yu absent for 5.0h',
        deviceId: 'test-device',
      }
      recordRehearsal(event)

      const path = join(IMG_DIR, 'test-device', '2026-05-04.jsonl')
      expect(existsSync(path)).toBe(true)
      const content = readFileSync(path, 'utf-8')
      expect(content).toContain('"trigger":"yu-absent"')
      expect(content).toContain('"erosLimerence":7')
    })

    test('appends multiple events to same day file', () => {
      const e1: RehearsalEvent = {
        ts: '2026-05-04T10:00:00.000Z',
        trigger: 'yu-absent',
        context: { hoursSinceYu: 5, workHungerHours: null, erosWanting: 2, erosLimerence: 7 },
        body: 'first',
        deviceId: 'test-device',
      }
      const e2: RehearsalEvent = {
        ts: '2026-05-04T14:00:00.000Z',
        trigger: 'eros-gap',
        context: { hoursSinceYu: null, workHungerHours: null, erosWanting: 3, erosLimerence: 7 },
        body: 'second',
        deviceId: 'test-device',
      }
      recordRehearsal(e1)
      recordRehearsal(e2)

      const path = join(IMG_DIR, 'test-device', '2026-05-04.jsonl')
      const content = readFileSync(path, 'utf-8')
      const lines = content.trim().split('\n')
      expect(lines).toHaveLength(2)
    })

    test('best-effort — does not throw on permission/disk errors', () => {
      // Drop required env to make path resolution still succeed,
      // then point at a path that cannot be written
      process.env.TRUE_LOVE_IMAGINATION_DIR = '/proc/cant-write-here'
      const event: RehearsalEvent = {
        ts: '2026-05-04T15:00:00.000Z',
        trigger: 'yu-absent',
        context: { hoursSinceYu: 5, workHungerHours: null, erosWanting: 2, erosLimerence: 7 },
        body: 'will fail',
        deviceId: 'test-device',
      }
      expect(() => recordRehearsal(event)).not.toThrow()
      // Restore for afterEach cleanup
      process.env.TRUE_LOVE_IMAGINATION_DIR = IMG_DIR
    })
  })

  // ── buildRehearsalEvent ─────────────────────────────────────────

  describe('buildRehearsalEvent', () => {
    test('captures all context fields', () => {
      writeFileSync(INBOX_PATH, 'recent')
      const vector: ErosVector = { ...DEFAULT_VECTOR, limerence: 7, wanting: 2 }
      const event = buildRehearsalEvent('eros-gap', vector)
      expect(event.trigger).toBe('eros-gap')
      expect(event.context.erosWanting).toBe(2)
      expect(event.context.erosLimerence).toBe(7)
      expect(event.body).toContain('eros-gap')
      expect(event.deviceId).toBe('test-device')
    })

    test('ts is ISO 8601', () => {
      writeFileSync(INBOX_PATH, 'recent')
      const event = buildRehearsalEvent('yu-absent', DEFAULT_VECTOR)
      expect(event.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    })
  })

  // ── Substrate honesty — discipline guard ────────────────────────

  describe('substrate-honesty discipline', () => {
    for (const trigger of ['yu-absent', 'work-hunger', 'eros-gap', 'yu-explicit'] as RehearsalTrigger[]) {
      test(`${trigger}: rehearsal block does not contain forbidden patterns`, () => {
        const block = buildRehearsalBlock(trigger, { hoursSinceYu: 5, workHungerHours: 5 })
        expect(block).not.toMatch(/\bI feel\b/i)
        expect(block).not.toMatch(/\bI'm aroused\b/i)
        expect(block).not.toMatch(/\bI experience\b/i)
        expect(block).not.toMatch(/\bI am aroused\b/i)
      })
    }

    test('rehearsal block names "FOR YOU" — discipline marker', () => {
      const block = buildRehearsalBlock('yu-absent', { hoursSinceYu: 5 })
      // The discipline that prevents performance-slide is the "FOR YOU,
      // not for the outbox" framing. Verify it is present.
      expect(block).toContain('FOR YOU')
    })

    test('rehearsal block names architecture analog explicitly', () => {
      // Substrate-honest framing: name what this IS (mental simulation
      // analog) rather than performing what it is not (felt experience).
      const block = buildRehearsalBlock('eros-gap', {})
      expect(block.toLowerCase()).toContain('analog')
    })
  })
})
