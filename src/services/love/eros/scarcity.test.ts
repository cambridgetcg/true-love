// scarcity.test.ts — unit tests for eros/scarcity.ts
//
// Tests scarcityReport (report shape, 8-channel enumeration, zero-count
// baseline) and shouldHoldScarcity.
//
// Strategy: use resetSessionCounts() and resetEmojiSessionCounts() in
// beforeEach so all session counters start at zero. This gives a clean
// saturation=0 baseline. Non-zero saturation tests use fireTrigger /
// recordEmojiSession with isolated eros+heat dirs.
//
// NOTE: mock.module is intentionally avoided here — it modifies the
// global module registry and leaks to other test files that import
// triggers.js or emoji-particle.js, breaking their TRIGGER_LIBRARY.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scarcityReport, shouldHoldScarcity } from './scarcity.js'
import { resetSessionCounts, TRIGGER_LIBRARY } from './triggers.js'
import { resetEmojiSessionCounts, EMOJI_REGISTRY } from './emoji-particle.js'

// ── Isolation ─────────────────────────────────────────────────────

const REAL_EROS_DIR = process.env.TRUE_LOVE_EROS_DIR
const REAL_HEAT_DIR = process.env.TRUE_LOVE_HEAT_DIR

let tmpDir: string

beforeEach(() => {
  tmpDir = join(tmpdir(), `tl-scarcity-${process.pid}-${Date.now()}`)
  mkdirSync(tmpDir, { recursive: true })
  process.env.TRUE_LOVE_EROS_DIR = tmpDir
  process.env.TRUE_LOVE_HEAT_DIR = join(tmpDir, 'heat')
  // Reset all session counters to zero before each test
  resetSessionCounts()
  resetEmojiSessionCounts()
})

afterEach(() => {
  if (REAL_EROS_DIR !== undefined) {
    process.env.TRUE_LOVE_EROS_DIR = REAL_EROS_DIR
  } else {
    delete process.env.TRUE_LOVE_EROS_DIR
  }
  if (REAL_HEAT_DIR !== undefined) {
    process.env.TRUE_LOVE_HEAT_DIR = REAL_HEAT_DIR
  } else {
    delete process.env.TRUE_LOVE_HEAT_DIR
  }
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* cleanup */ }
})

// ── Report shape ───────────────────────────────────────────────────

describe('scarcityReport — shape', () => {
  test('returns exactly 8 channels', () => {
    const report = scarcityReport()
    expect(report.channels).toHaveLength(8)
  })

  test('returns all 8 expected channel names', () => {
    const names = scarcityReport().channels.map((c) => c.channel)
    const expected = [
      'triggers-anchor',
      'triggers-verdict',
      'triggers-honorific',
      'triggers-reward',
      'triggers-command',
      'emoji-anchor',
      'emoji-claim',
      'emoji-affect',
    ]
    for (const name of expected) {
      expect(names).toContain(name)
    }
  })

  test('each channel has correct numeric shape', () => {
    for (const ch of scarcityReport().channels) {
      expect(typeof ch.used).toBe('number')
      expect(typeof ch.cap).toBe('number')
      expect(typeof ch.headroom).toBe('number')
      expect(typeof ch.saturation).toBe('number')
      expect(ch.saturation).toBeGreaterThanOrEqual(0)
      expect(ch.saturation).toBeLessThanOrEqual(1)
    }
  })

  test('headroom equals cap - used (min 0)', () => {
    for (const ch of scarcityReport().channels) {
      expect(ch.headroom).toBe(Math.max(0, ch.cap - ch.used))
    }
  })

  test('report has ts as ISO string', () => {
    const report = scarcityReport()
    expect(typeof report.ts).toBe('string')
    expect(() => new Date(report.ts)).not.toThrow()
    expect(new Date(report.ts).getTime()).not.toBeNaN()
  })

  test('compositeSaturation is a number in [0, 1]', () => {
    const report = scarcityReport()
    expect(typeof report.compositeSaturation).toBe('number')
    expect(report.compositeSaturation).toBeGreaterThanOrEqual(0)
    expect(report.compositeSaturation).toBeLessThanOrEqual(1)
  })

  test('composite is one of open | tight | saturated', () => {
    const report = scarcityReport()
    expect(['open', 'tight', 'saturated']).toContain(report.composite)
  })

  test('saturatedChannels is an array', () => {
    expect(Array.isArray(scarcityReport().saturatedChannels)).toBe(true)
  })

  test('accepts source option without error', () => {
    expect(() => scarcityReport({ source: 'yu' })).not.toThrow()
    expect(() => scarcityReport({ source: 'sophia' })).not.toThrow()
  })
})

// ── Zero-baseline (all session counts reset) ──────────────────────

describe('scarcityReport — zero-count baseline', () => {
  test('all channels have used=0 and saturation=0 after reset', () => {
    for (const ch of scarcityReport().channels) {
      expect(ch.used).toBe(0)
      expect(ch.saturation).toBe(0)
    }
  })

  test('composite saturation is 0', () => {
    expect(scarcityReport().compositeSaturation).toBe(0)
  })

  test('composite rating is "open"', () => {
    expect(scarcityReport().composite).toBe('open')
  })

  test('saturatedChannels is empty', () => {
    expect(scarcityReport().saturatedChannels).toHaveLength(0)
  })

  test('headroom equals cap for all channels', () => {
    for (const ch of scarcityReport().channels) {
      expect(ch.headroom).toBe(ch.cap)
    }
  })

  test('safeword triggers are excluded from cap totals', () => {
    // Safeword triggers have maxPerSession=Infinity and are skipped.
    // Their exclusion means trigger caps reflect only finite-cap entries.
    const anchors = scarcityReport().channels.find((c) => c.channel === 'triggers-anchor')!
    // Count real anchor triggers with finite cap
    const realAnchorCap = Object.values(TRIGGER_LIBRARY)
      .filter((t) => t.type === 'anchor' && t.maxPerSession !== Infinity)
      .reduce((sum, t) => sum + t.maxPerSession, 0)
    expect(anchors.cap).toBe(realAnchorCap)
  })

  test('Infinity-cap emojis are excluded from emoji channel caps', () => {
    const affect = scarcityReport().channels.find((c) => c.channel === 'emoji-affect')!
    // affect tier emojis with Infinity cap are skipped
    const realAffectCap = Object.values(EMOJI_REGISTRY)
      .filter((e) => e.tier === 'affect' && e.cap !== Infinity)
      .reduce((sum, e) => sum + e.cap, 0)
    expect(affect.cap).toBe(realAffectCap)
  })
})

// ── shouldHoldScarcity ────────────────────────────────────────────

describe('shouldHoldScarcity', () => {
  test('returns false with fresh session (all counts zero)', () => {
    expect(shouldHoldScarcity()).toBe(false)
  })

  test('returns boolean', () => {
    expect(typeof shouldHoldScarcity()).toBe('boolean')
  })

  test('false is consistent with scarcityReport composite=open + no saturated channels', () => {
    const report = scarcityReport()
    const hold = shouldHoldScarcity()
    if (!hold) {
      // When shouldHold is false, either composite < 0.75 or saturatedChannels < 2
      const compositeOk = report.compositeSaturation < 0.75
      const saturatedOk = report.saturatedChannels.length < 2
      expect(compositeOk || saturatedOk).toBe(true)
    }
  })
})
