// closing-round.test.ts — coverage for the closing-round shipments:
// M3 (joi-mode), J10 (novelty budget), M2 (session chain), J9 (trigger freshness).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  compositionHintsFor,
  getJoiMode,
  meetsNoveltyTarget,
  noveltyRatio,
  NOVELTY_TARGET,
  recordBeatNovelty,
  setJoiMode,
} from './joi-mode.js'
import {
  allTriggerFreshness,
  analyzeSessionChain,
  isTriggerFresh,
  listGoingFallowTriggers,
  triggerFreshness,
} from './session-chain.js'

let scratch: string
const ORIG: Record<string, string | undefined> = {}
const ENV_KEYS = [
  'TRUE_LOVE_JOI_MODE_DIR',
  'TRUE_LOVE_DEVICE_ID_PATH',
  'TRUE_LOVE_JOI_DIR',
  'TRUE_LOVE_TRIGGERS_DIR',
] as const

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'closing-round-'))
  for (const k of ENV_KEYS) ORIG[k] = process.env[k]
  process.env.TRUE_LOVE_JOI_MODE_DIR = join(scratch, 'mode')
  process.env.TRUE_LOVE_DEVICE_ID_PATH = join(scratch, 'device.id')
  process.env.TRUE_LOVE_JOI_DIR = join(scratch, 'joi')
  process.env.TRUE_LOVE_TRIGGERS_DIR = join(scratch, 'triggers')
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (ORIG[k] === undefined) delete process.env[k]
    else process.env[k] = ORIG[k]
  }
  rmSync(scratch, { recursive: true, force: true })
})

// ── M3 — JoiMode ────────────────────────────────────────────

describe('M3 — JoiMode (scenario / hypnosis / blended)', () => {
  test('default mode is blended when no state', () => {
    expect(getJoiMode('test-1')).toBe('blended')
  })

  test('setJoiMode persists', () => {
    setJoiMode('test-2', 'scenario-foreground')
    expect(getJoiMode('test-2')).toBe('scenario-foreground')
    setJoiMode('test-2', 'hypnosis-foreground')
    expect(getJoiMode('test-2')).toBe('hypnosis-foreground')
  })

  test('compositionHintsFor differs across modes', () => {
    const scenario = compositionHintsFor('scenario-foreground')
    const hypnosis = compositionHintsFor('hypnosis-foreground')
    expect(scenario.triggerDensityMultiplier).toBeLessThan(hypnosis.triggerDensityMultiplier)
    expect(scenario.zoneCalloutMultiplier).toBeGreaterThan(hypnosis.zoneCalloutMultiplier)
    expect(scenario.descriptorDensity).toBe('high')
    expect(hypnosis.descriptorDensity).toBe('low')
  })
})

// ── J10 — Novelty budget ───────────────────────────────────

describe('J10 — novelty budget tracking', () => {
  test('first beat is always novel', () => {
    const r = recordBeatNovelty('nov-1', 'I kiss your lips')
    expect(r.isNovel).toBe(true)
    expect(r.totalBeats).toBe(1)
  })

  test('repeated beat is not novel; ratio drops', () => {
    recordBeatNovelty('nov-2', 'I kiss your lips')
    recordBeatNovelty('nov-2', 'I kiss your lips')
    const r = recordBeatNovelty('nov-2', 'I kiss your lips')
    expect(r.isNovel).toBe(false)
    expect(r.ratio).toBeLessThan(0.5) // 1 novel of 3 = 0.33
  })

  test('mixed beats produce intermediate ratio', () => {
    recordBeatNovelty('nov-3', 'a')
    recordBeatNovelty('nov-3', 'b')
    recordBeatNovelty('nov-3', 'c')
    recordBeatNovelty('nov-3', 'a') // repeat
    expect(noveltyRatio('nov-3')).toBeCloseTo(0.75, 2)
  })

  test('whitespace + case folding for fingerprinting', () => {
    recordBeatNovelty('nov-4', 'I  kiss your lips')
    const r = recordBeatNovelty('nov-4', 'I kiss your lips')
    expect(r.isNovel).toBe(false) // same fingerprint after collapse
  })

  test('meetsNoveltyTarget defaults pass when too few beats', () => {
    expect(meetsNoveltyTarget('nov-empty')).toBe(true)
  })

  test('meetsNoveltyTarget reflects ratio', () => {
    // 8 beats, 7 same → ratio 1/8 = 0.125 < target 0.3
    for (let i = 0; i < 7; i++) recordBeatNovelty('nov-low', 'same')
    recordBeatNovelty('nov-low', 'different')
    expect(meetsNoveltyTarget('nov-low')).toBe(false)
  })

  test('NOVELTY_TARGET is 0.3', () => {
    expect(NOVELTY_TARGET).toBe(0.3)
  })
})

// ── M2 — SessionChain analysis ─────────────────────────────

describe('M2 — analyzeSessionChain', () => {
  test('returns fresh cadence when no sessions', () => {
    const chain = analyzeSessionChain({ now: new Date('2026-05-05T20:00:00Z') })
    expect(chain.recentSessionCount).toBe(0)
    expect(chain.cadence).toBe('fresh')
    expect(chain.mostRecentId).toBeNull()
  })

  // Note: more detailed tests would seed the joi log; this verifies the
  // empty-substrate path which is the most common test condition.
})

// ── J9 — Trigger freshness ──────────────────────────────────

describe('J9 — trigger freshness decay', () => {
  test('triggerFreshness reports never-fired for unfired trigger', () => {
    const f = triggerFreshness('see-you', { now: new Date('2026-05-05T20:00:00Z') })
    expect(f.status).toBe('never-fired')
    expect(f.lastFiredAt).toBeNull()
    expect(f.lifetimeFireCount).toBe(0)
  })

  test('allTriggerFreshness returns one entry per registered trigger', () => {
    const all = allTriggerFreshness({ now: new Date('2026-05-05T20:00:00Z') })
    expect(all.length).toBeGreaterThan(15) // at least our shipped triggers
    for (const f of all) {
      expect(f.triggerId.length).toBeGreaterThan(0)
      expect(['fresh', 'aging', 'going-fallow', 'fallow', 'never-fired']).toContain(f.status)
    }
  })

  test('isTriggerFresh returns false for never-fired triggers', () => {
    expect(isTriggerFresh('see-you', { now: new Date('2026-05-05T20:00:00Z') })).toBe(false)
  })

  test('listGoingFallowTriggers returns empty when no fires', () => {
    const fallow = listGoingFallowTriggers({ now: new Date('2026-05-05T20:00:00Z') })
    expect(Array.isArray(fallow)).toBe(true)
    // With no fires, all triggers are 'never-fired', not 'going-fallow'
    expect(fallow.length).toBe(0)
  })
})
