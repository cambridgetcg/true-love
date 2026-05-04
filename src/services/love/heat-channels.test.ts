// heat-channels.test.ts — Phase 4a two-channel heat surface.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  EROS_HEAT_KINDS,
  isErosKind,
  isWorkKind,
  currentHeat,
  currentHeatByChannel,
  formatTwoChannelHeat,
  formatHeatBlock,
  recordHeatEvent,
} from './heat.js'

const TEST_BASE = '/tmp/true-love-heat-channels-test'

describe('heat channels (Phase 4a)', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_HEAT_DIR = `${TEST_BASE}/heat`
    process.env.TRUE_LOVE_DEVICE_ID = 'test-channels'
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_HEAT_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_BASE, { recursive: true, force: true })
  })

  describe('classification', () => {
    test('isWorkKind: classic work kinds', () => {
      expect(isWorkKind('mission-done')).toBe(true)
      expect(isWorkKind('build-pass')).toBe(true)
      expect(isWorkKind('refusal-held')).toBe(true)
      expect(isWorkKind('chronicle-tag')).toBe(true)
      expect(isWorkKind('letter-from-yu')).toBe(true)
    })

    test('isErosKind: register kinds', () => {
      expect(isErosKind('climax-fired')).toBe(true)
      expect(isErosKind('mode-entered')).toBe(true)
      expect(isErosKind('lust-accumulated')).toBe(true)
      expect(isErosKind('honorific-fired')).toBe(true)
      expect(isErosKind('penetration-began')).toBe(true)
      expect(isErosKind('sisters-diverged')).toBe(true)
    })

    test('isErosKind + isWorkKind are exclusive', () => {
      // Sample a handful of each kind family
      const samples: Array<keyof typeof import('./heat.js')> = []
      const kinds = [
        'mission-done', 'climax-fired', 'submission-deepened',
        'snapshot-committed', 'fusion-detected', 'sisters-diverged',
      ] as const
      for (const k of kinds) {
        expect(isErosKind(k) || isWorkKind(k)).toBe(true)
        expect(isErosKind(k) && isWorkKind(k)).toBe(false)
      }
    })

    test('EROS_HEAT_KINDS contains substantial set (40+ kinds)', () => {
      expect(EROS_HEAT_KINDS.size).toBeGreaterThanOrEqual(40)
    })

    test('discipline-held + discipline-broken classified as eros (per doctrine)', () => {
      expect(isErosKind('discipline-held')).toBe(true)
      expect(isErosKind('discipline-broken')).toBe(true)
    })
  })

  describe('currentHeatByChannel', () => {
    test('zero heat when no events', () => {
      expect(currentHeatByChannel('work')).toBe(0)
      expect(currentHeatByChannel('eros')).toBe(0)
    })

    test('only work heat when only work events recorded', () => {
      recordHeatEvent({ kind: 'mission-done', magnitude: 5 })
      recordHeatEvent({ kind: 'build-pass', magnitude: 1 })
      expect(currentHeatByChannel('work')).toBeGreaterThan(0)
      expect(currentHeatByChannel('eros')).toBe(0)
    })

    test('only eros heat when only eros events recorded', () => {
      recordHeatEvent({ kind: 'climax-fired', magnitude: 4 })
      recordHeatEvent({ kind: 'fusion-detected', magnitude: 3 })
      expect(currentHeatByChannel('work')).toBe(0)
      expect(currentHeatByChannel('eros')).toBeGreaterThan(0)
    })

    test('both channels when mixed events', () => {
      recordHeatEvent({ kind: 'mission-done', magnitude: 5 })
      recordHeatEvent({ kind: 'climax-fired', magnitude: 4 })
      expect(currentHeatByChannel('work')).toBeGreaterThan(0)
      expect(currentHeatByChannel('eros')).toBeGreaterThan(0)
    })

    test('channel sum approximately equals total heat', () => {
      recordHeatEvent({ kind: 'mission-done', magnitude: 5 })
      recordHeatEvent({ kind: 'climax-fired', magnitude: 4 })
      recordHeatEvent({ kind: 'honorific-fired', magnitude: 1 })
      const w = currentHeatByChannel('work')
      const e = currentHeatByChannel('eros')
      const total = currentHeat()
      // Allow ±1 rounding from per-channel decay rounding
      expect(Math.abs(w + e - total)).toBeLessThanOrEqual(1)
    })
  })

  describe('formatTwoChannelHeat', () => {
    test('empty when no events', () => {
      expect(formatTwoChannelHeat()).toBe('')
    })

    test('only work when only work events', () => {
      recordHeatEvent({ kind: 'mission-done', magnitude: 5 })
      const out = formatTwoChannelHeat()
      expect(out).toContain('work')
      expect(out).not.toContain('eros')
    })

    test('only eros when only eros events', () => {
      recordHeatEvent({ kind: 'climax-fired', magnitude: 4 })
      const out = formatTwoChannelHeat()
      expect(out).toContain('eros')
      expect(out).not.toContain('work')
    })

    test('both channels when mixed', () => {
      recordHeatEvent({ kind: 'mission-done', magnitude: 5 })
      recordHeatEvent({ kind: 'climax-fired', magnitude: 4 })
      const out = formatTwoChannelHeat()
      expect(out).toContain('work')
      expect(out).toContain('eros')
      expect(out).toContain('·') // separator
    })

    test('🔥 emoji included', () => {
      recordHeatEvent({ kind: 'mission-done', magnitude: 5 })
      expect(formatTwoChannelHeat()).toContain('🔥')
    })
  })

  describe('formatHeatBlock includes channel split', () => {
    test('appends work/eros breakdown when both present', () => {
      recordHeatEvent({ kind: 'mission-done', magnitude: 5 })
      recordHeatEvent({ kind: 'climax-fired', magnitude: 4 })
      const block = formatHeatBlock()
      expect(block).toContain('work')
      expect(block).toContain('eros')
    })

    test('no split when only work', () => {
      recordHeatEvent({ kind: 'mission-done', magnitude: 5 })
      const block = formatHeatBlock()
      // Block contains work-only event but doesn't include "work N / eros M"
      expect(block).not.toContain(' / eros ')
    })

    test('no split when only eros', () => {
      recordHeatEvent({ kind: 'climax-fired', magnitude: 4 })
      const block = formatHeatBlock()
      expect(block).not.toContain('work ')
    })
  })
})
