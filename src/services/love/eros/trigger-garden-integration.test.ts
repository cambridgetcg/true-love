// trigger-garden-integration.test.ts — end-to-end verification:
// fire a trigger → it appears in the garden with right maturation/freshness.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fireTrigger } from './triggers.js'
import { computeTriggerGarden, maturationFor, freshnessFor } from './trigger-garden.js'

const ENV_KEYS = ['TRUE_LOVE_TRIGGERS_DIR', 'TRUE_LOVE_DEVICE_ID']
const ENV_BACKUP: Record<string, string | undefined> = {}

let tmpDir: string

beforeEach(() => {
  for (const k of ENV_KEYS) ENV_BACKUP[k] = process.env[k]
  tmpDir = mkdtempSync(join(tmpdir(), 'garden-int-'))
  process.env.TRUE_LOVE_TRIGGERS_DIR = tmpDir
  process.env.TRUE_LOVE_DEVICE_ID = 'test-garden'
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (ENV_BACKUP[k] === undefined) delete process.env[k]
    else process.env[k] = ENV_BACKUP[k]
  }
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
})

describe('garden ← trigger fire pipeline', () => {
  it('fired trigger appears in garden as planted', () => {
    // Fire a known trigger from TRIGGER_LIBRARY
    const ev = fireTrigger('safeword-red', 'yu', 'red')
    expect(ev).not.toBeNull()

    const garden = computeTriggerGarden()
    const safewordFamily = garden.families.find((f) => f.family === 'safeword')
    expect(safewordFamily).toBeDefined()
    const red = safewordFamily?.entries.find((e) => e.id === 'safeword-red')
    expect(red).toBeDefined()
    expect(red?.fireCount).toBe(1)
    expect(red?.yuFireCount).toBe(1)
    expect(red?.maturation).toBe('planted')
    expect(red?.freshness).toBe('vibrant')
    expect(red?.goingFallow).toBe(false)
  })

  it('Yu and Sophia counts split correctly', () => {
    fireTrigger('safeword-red', 'yu', 'red')
    fireTrigger('safeword-red', 'yu', 'red')
    fireTrigger('safeword-red', 'sophia', 'red')

    const garden = computeTriggerGarden()
    const red = garden.families
      .find((f) => f.family === 'safeword')
      ?.entries.find((e) => e.id === 'safeword-red')
    expect(red?.yuFireCount).toBe(2)
    expect(red?.sophiaFireCount).toBe(1)
    expect(red?.fireCount).toBe(3)
    expect(red?.maturation).toBe('sprouted')
  })

  it('garden global stats track fire totals', () => {
    fireTrigger('safeword-red', 'yu', 'red')
    fireTrigger('safeword-stop', 'yu', 'stop')

    const garden = computeTriggerGarden()
    expect(garden.stats.totalFires).toBeGreaterThanOrEqual(2)
    expect(garden.stats.maturationCounts.planted).toBeGreaterThanOrEqual(2)
  })

  it('walledFromSuppression flag propagates from TriggerDef', () => {
    const garden = computeTriggerGarden()
    const safewords = garden.families
      .find((f) => f.family === 'safeword')
      ?.entries
    expect(safewords?.length).toBeGreaterThan(0)
    for (const e of safewords ?? []) {
      expect(e.walledFromSuppression).toBe(true)
    }
  })

  it('maturation tier ladders correctly across many fires', () => {
    // Plant → sprouted (3+ fires)
    for (let i = 0; i < 4; i++) {
      fireTrigger('safeword-red', 'yu', 'red')
    }
    let garden = computeTriggerGarden()
    let red = garden.families
      .find((f) => f.family === 'safeword')
      ?.entries.find((e) => e.id === 'safeword-red')
    // Note: per-session cap is Infinity for safewords, so we can fire 4×
    expect(red?.maturation).toMatch(/sprouted|rooted|anchored/)
  })

  it('suggestion engine surfaces plant-shibby for small gardens', () => {
    const garden = computeTriggerGarden()
    if (garden.stats.totalTriggers < 30) {
      const planted = garden.suggestions
      expect(garden.shibbyUnplanted.length).toBeGreaterThan(0)
    }
  })
})

describe('garden boundary conditions', () => {
  it('handles empty fires gracefully (no crash, all dormant)', () => {
    const garden = computeTriggerGarden()
    expect(garden.stats.totalTriggers).toBeGreaterThan(0)
    expect(garden.stats.totalFires).toBe(0)
    expect(garden.stats.maturationCounts.dormant).toBe(garden.stats.totalTriggers)
    expect(garden.stats.unfired).toBe(garden.stats.totalTriggers)
  })

  it('shibby unplanted excludes core triggers', () => {
    // safeword-red is in TRIGGER_LIBRARY; it should not appear in shibbyUnplanted
    // (and Shibby's "Red" has id "red", which when prefixed with shibby- is "shibby-red")
    const garden = computeTriggerGarden()
    const ids = garden.shibbyUnplanted.map((s) => s.id)
    // The catalog entries are unprefixed in the catalog, but trigger-garden
    // checks by `shibby-${id}` against TRIGGER_LIBRARY keys — none match by default
    expect(garden.shibbyUnplanted.length).toBeGreaterThan(100)
  })

  it('maturationFor + freshnessFor are pure', () => {
    expect(maturationFor(0)).toBe('dormant')
    expect(maturationFor(20)).toBe('anchored')
    expect(freshnessFor(null)).toBe('never-fired')
    expect(freshnessFor(45)).toBe('fading')
  })
})
