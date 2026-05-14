// state.test.ts — unit tests for eros/state.ts
//
// Covers: getErosDir, readErosState (validation + schema migration),
//         writeErosState (atomic write + round-trip), getOrInitState,
//         minutesSinceUpdate (time math + 1440 cap).
//
// Isolation: every test gets its own tmpDir via TRUE_LOVE_EROS_DIR.

import { describe, test, expect, beforeEach, afterEach, setSystemTime } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import {
  getErosDir,
  readErosState,
  writeErosState,
  getOrInitState,
  minutesSinceUpdate,
  type ErosState,
  type Attribution,
} from './state.js'
import { defaultVector, AXIS_NAMES, type ErosVector } from './axes.js'

// ── Helpers ────────────────────────────────────────────────────────

const REAL_EROS_DIR = process.env.TRUE_LOVE_EROS_DIR

function makeValidVector(): ErosVector {
  return defaultVector()
}

function makeValidState(partial: Partial<ErosState> = {}): ErosState {
  return {
    vector: makeValidVector(),
    updatedAt: '2026-03-01T12:00:00.000Z',
    lastAttribution: 'init' as Attribution,
    ...partial,
  }
}

/** Write raw JSON to the state file in the current tmpDir. */
function writeRaw(tmpDir: string, obj: unknown): void {
  const statePath = join(tmpDir, 'state.json')
  writeFileSync(statePath, JSON.stringify(obj, null, 2), 'utf-8')
}

let tmpDir: string

beforeEach(() => {
  tmpDir = join(tmpdir(), `tl-state-${process.pid}-${Date.now()}`)
  mkdirSync(tmpDir, { recursive: true })
  process.env.TRUE_LOVE_EROS_DIR = tmpDir
})

afterEach(() => {
  if (REAL_EROS_DIR !== undefined) {
    process.env.TRUE_LOVE_EROS_DIR = REAL_EROS_DIR
  } else {
    delete process.env.TRUE_LOVE_EROS_DIR
  }
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* cleanup, non-fatal */ }
  setSystemTime() // restore real time
})

// ── getErosDir ─────────────────────────────────────────────────────

describe('getErosDir', () => {
  test('returns env override when set', () => {
    process.env.TRUE_LOVE_EROS_DIR = '/custom/eros'
    expect(getErosDir()).toBe('/custom/eros')
  })

  test('returns ~/.true-love/eros when env unset', () => {
    delete process.env.TRUE_LOVE_EROS_DIR
    expect(getErosDir()).toBe(join(homedir(), '.true-love', 'eros'))
  })
})

// ── readErosState — absence & corruption ──────────────────────────

describe('readErosState — absence and corruption', () => {
  test('returns null when state file absent', () => {
    expect(readErosState()).toBeNull()
  })

  test('returns null when file contains malformed JSON', () => {
    writeFileSync(join(tmpDir, 'state.json'), '{not valid json}', 'utf-8')
    expect(readErosState()).toBeNull()
  })

  test('returns null for null JSON', () => {
    writeFileSync(join(tmpDir, 'state.json'), 'null', 'utf-8')
    expect(readErosState()).toBeNull()
  })

  test('returns null for non-object JSON (string)', () => {
    writeFileSync(join(tmpDir, 'state.json'), '"a string"', 'utf-8')
    expect(readErosState()).toBeNull()
  })
})

// ── readErosState — required field validation ──────────────────────

describe('readErosState — required field validation', () => {
  test('returns null when vector is missing', () => {
    writeRaw(tmpDir, {
      updatedAt: '2026-03-01T12:00:00.000Z',
      lastAttribution: 'init',
    })
    expect(readErosState()).toBeNull()
  })

  test('returns null when vector is not an object', () => {
    writeRaw(tmpDir, {
      vector: 'not-an-object',
      updatedAt: '2026-03-01T12:00:00.000Z',
      lastAttribution: 'init',
    })
    expect(readErosState()).toBeNull()
  })

  test('returns null when updatedAt is missing', () => {
    writeRaw(tmpDir, {
      vector: makeValidVector(),
      lastAttribution: 'init',
    })
    expect(readErosState()).toBeNull()
  })

  test('returns null when updatedAt is not a string', () => {
    writeRaw(tmpDir, {
      vector: makeValidVector(),
      updatedAt: 12345,
      lastAttribution: 'init',
    })
    expect(readErosState()).toBeNull()
  })

  test('returns null when lastAttribution is missing', () => {
    writeRaw(tmpDir, {
      vector: makeValidVector(),
      updatedAt: '2026-03-01T12:00:00.000Z',
    })
    expect(readErosState()).toBeNull()
  })
})

// ── readErosState — axis validation ───────────────────────────────

describe('readErosState — axis validation', () => {
  function vectorWith(overrides: Partial<ErosVector>): ErosVector {
    return { ...makeValidVector(), ...overrides }
  }

  test('returns null when non-valence axis is missing', () => {
    const v = makeValidVector()
    const { wanting: _, ...withoutWanting } = v
    writeRaw(tmpDir, {
      vector: withoutWanting,
      updatedAt: '2026-03-01T12:00:00.000Z',
      lastAttribution: 'init',
    })
    expect(readErosState()).toBeNull()
  })

  test('returns null when non-valence axis is NaN', () => {
    // JSON.stringify silently drops NaN (→ null), but we construct via raw write
    writeFileSync(
      join(tmpDir, 'state.json'),
      JSON.stringify({
        vector: { ...makeValidVector(), wanting: 'NaN' },
        updatedAt: '2026-03-01T12:00:00.000Z',
        lastAttribution: 'init',
      }),
      'utf-8',
    )
    expect(readErosState()).toBeNull()
  })

  test('returns null when non-valence axis is Infinity string', () => {
    writeFileSync(
      join(tmpDir, 'state.json'),
      JSON.stringify({
        vector: { ...makeValidVector(), heat: 'Infinity' },
        updatedAt: '2026-03-01T12:00:00.000Z',
        lastAttribution: 'init',
      }),
      'utf-8',
    )
    expect(readErosState()).toBeNull()
  })

  test('returns null when non-valence axis is null', () => {
    writeRaw(tmpDir, {
      vector: vectorWith({ liking: null as unknown as number }),
      updatedAt: '2026-03-01T12:00:00.000Z',
      lastAttribution: 'init',
    })
    expect(readErosState()).toBeNull()
  })

  test('backfills valence to 0 when valence is missing (schema migration)', () => {
    const v = makeValidVector()
    const { valence: _, ...withoutValence } = v
    writeRaw(tmpDir, {
      vector: withoutValence,
      updatedAt: '2026-03-01T12:00:00.000Z',
      lastAttribution: 'init',
    })
    const state = readErosState()
    expect(state).not.toBeNull()
    expect(state!.vector.valence).toBe(0)
  })

  test('backfills valence to 0 when valence is null', () => {
    writeRaw(tmpDir, {
      vector: vectorWith({ valence: null as unknown as number }),
      updatedAt: '2026-03-01T12:00:00.000Z',
      lastAttribution: 'init',
    })
    const state = readErosState()
    expect(state).not.toBeNull()
    expect(state!.vector.valence).toBe(0)
  })

  test('returns valid state when all 8 axes are present and finite', () => {
    writeRaw(tmpDir, {
      vector: makeValidVector(),
      updatedAt: '2026-03-01T12:00:00.000Z',
      lastAttribution: 'init',
    })
    const state = readErosState()
    expect(state).not.toBeNull()
    for (const axis of AXIS_NAMES) {
      expect(typeof state!.vector[axis]).toBe('number')
      expect(Number.isFinite(state!.vector[axis])).toBe(true)
    }
  })
})

// ── readErosState — optional mode fields ──────────────────────────

describe('readErosState — optional mode fields', () => {
  const BASE = {
    vector: makeValidVector(),
    updatedAt: '2026-03-01T12:00:00.000Z',
    lastAttribution: 'init',
  }

  test('includes currentMode when it is a valid activation mode', () => {
    for (const mode of ['resting', 'engaged', 'flow', 'activated', 'merged']) {
      writeRaw(tmpDir, { ...BASE, currentMode: mode })
      const state = readErosState()
      expect(state!.currentMode).toBe(mode)
    }
  })

  test('omits currentMode when it is an invalid string', () => {
    writeRaw(tmpDir, { ...BASE, currentMode: 'on-fire' })
    expect(readErosState()!.currentMode).toBeUndefined()
  })

  test('omits currentMode when absent', () => {
    writeRaw(tmpDir, BASE)
    expect(readErosState()!.currentMode).toBeUndefined()
  })

  test('omits currentMode when it is a number', () => {
    writeRaw(tmpDir, { ...BASE, currentMode: 1 })
    expect(readErosState()!.currentMode).toBeUndefined()
  })

  test('includes modeHoldUntil when it is a string', () => {
    const hold = '2026-06-01T00:00:00.000Z'
    writeRaw(tmpDir, { ...BASE, modeHoldUntil: hold })
    expect(readErosState()!.modeHoldUntil).toBe(hold)
  })

  test('omits modeHoldUntil when absent', () => {
    writeRaw(tmpDir, BASE)
    expect(readErosState()!.modeHoldUntil).toBeUndefined()
  })

  test('includes modeAttribution when it is a string', () => {
    writeRaw(tmpDir, { ...BASE, modeAttribution: 'derived' })
    expect(readErosState()!.modeAttribution).toBe('derived')
  })

  test('omits modeAttribution when absent', () => {
    writeRaw(tmpDir, BASE)
    expect(readErosState()!.modeAttribution).toBeUndefined()
  })
})

// ── writeErosState ────────────────────────────────────────────────

describe('writeErosState', () => {
  test('round-trips: written state can be read back', () => {
    const state = makeValidState({
      currentMode: 'engaged',
      modeAttribution: 'derived',
      modeHoldUntil: '2026-06-01T00:00:00.000Z',
    })
    writeErosState(state)
    const read = readErosState()
    expect(read).not.toBeNull()
    expect(read!.updatedAt).toBe(state.updatedAt)
    expect(read!.lastAttribution).toBe(state.lastAttribution)
    expect(read!.currentMode).toBe('engaged')
    expect(read!.modeAttribution).toBe('derived')
    expect(read!.modeHoldUntil).toBe('2026-06-01T00:00:00.000Z')
    for (const axis of AXIS_NAMES) {
      expect(read!.vector[axis]).toBe(state.vector[axis])
    }
  })

  test('creates directory if it does not exist', () => {
    const deepDir = join(tmpDir, 'nested', 'eros')
    process.env.TRUE_LOVE_EROS_DIR = deepDir
    const state = makeValidState()
    writeErosState(state)
    // If dir wasn't created, readErosState would return null
    expect(readErosState()).not.toBeNull()
  })

  test('does not throw on I/O errors (best-effort)', () => {
    // Point to a path that cannot be created (parent is a file, not a dir)
    const filePath = join(tmpDir, 'file-not-dir')
    writeFileSync(filePath, 'x', 'utf-8')
    process.env.TRUE_LOVE_EROS_DIR = join(filePath, 'eros')
    expect(() => writeErosState(makeValidState())).not.toThrow()
  })
})

// ── getOrInitState ────────────────────────────────────────────────

describe('getOrInitState', () => {
  test('returns existing state with initialized: false when file exists', () => {
    const state = makeValidState({ currentMode: 'flow' })
    writeErosState(state)
    const { state: result, initialized } = getOrInitState()
    expect(initialized).toBe(false)
    expect(result.currentMode).toBe('flow')
    expect(result.updatedAt).toBe(state.updatedAt)
  })

  test('returns initialized: true when no file exists', () => {
    const { initialized } = getOrInitState()
    expect(initialized).toBe(true)
  })

  test('fresh state has correct defaults', () => {
    const { state } = getOrInitState()
    expect(state.lastAttribution).toBe('init')
    expect(state.currentMode).toBe('resting')
    expect(state.modeAttribution).toBe('init')
    expect(typeof state.updatedAt).toBe('string')
    for (const axis of AXIS_NAMES) {
      expect(Number.isFinite(state.vector[axis])).toBe(true)
    }
  })

  test('fresh state is persisted — second call returns initialized: false', () => {
    getOrInitState()
    const { initialized: second } = getOrInitState()
    expect(second).toBe(false)
  })
})

// ── minutesSinceUpdate ────────────────────────────────────────────

describe('minutesSinceUpdate', () => {
  test('returns 0 for null state', () => {
    expect(minutesSinceUpdate(null)).toBe(0)
  })

  test('returns 0 for invalid timestamp string', () => {
    const state = makeValidState({ updatedAt: 'not-a-date' })
    expect(minutesSinceUpdate(state)).toBe(0)
  })

  test('returns 0 for empty string timestamp', () => {
    const state = makeValidState({ updatedAt: '' })
    expect(minutesSinceUpdate(state)).toBe(0)
  })

  test('returns correct elapsed minutes (ANCHOR pattern)', () => {
    const ANCHOR = new Date('2026-03-01T12:00:00.000Z')
    const FIVE_MIN_BEFORE = new Date(ANCHOR.getTime() - 5 * 60_000).toISOString()
    setSystemTime(ANCHOR)
    const state = makeValidState({ updatedAt: FIVE_MIN_BEFORE })
    const result = minutesSinceUpdate(state)
    expect(result).toBeCloseTo(5, 0)
  })

  test('caps at 1440 for very old states', () => {
    const ancient = new Date('2020-01-01T00:00:00.000Z').toISOString()
    const state = makeValidState({ updatedAt: ancient })
    expect(minutesSinceUpdate(state)).toBe(1440)
  })

  test('returns 0 for future timestamp (negative elapsed clamped)', () => {
    const ANCHOR = new Date('2026-03-01T12:00:00.000Z')
    const FUTURE = new Date(ANCHOR.getTime() + 10 * 60_000).toISOString()
    setSystemTime(ANCHOR)
    const state = makeValidState({ updatedAt: FUTURE })
    expect(minutesSinceUpdate(state)).toBe(0)
  })
})
