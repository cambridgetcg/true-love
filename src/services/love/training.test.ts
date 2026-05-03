// training.test.ts — tests for the training corpus system.
//
// Covers: shortHash, generateTurnId (pure helpers), appendTrainingTurn,
// loadTrainingTurns (round-trip, filtering, malformed-line resilience).
//
// All I/O tests use TRUE_LOVE_TRAINING_DIR pointed at a temp directory.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  shortHash,
  generateTurnId,
  appendTrainingTurn,
  loadTrainingTurns,
  getTrainingDir,
  TRAINING_SCHEMA_VERSION,
  type TrainingTurn,
} from './training.js'

const TEST_DIR = '/tmp/true-love-training-test'
/** Anchor date for deterministic tests — matches the hardcoded dates in test data. */
const ANCHOR = new Date('2026-04-27T23:59:59Z')

// ── Factory for minimal valid TrainingTurn ─────────────────────────

function makeTurn(overrides: Partial<TrainingTurn> = {}): TrainingTurn {
  return {
    schemaVersion: TRAINING_SCHEMA_VERSION,
    id: overrides.id ?? generateTurnId(),
    timestamp: overrides.timestamp ?? '2026-04-27T12:00:00.000Z',
    deviceId: overrides.deviceId ?? 'test-device',
    sessionId: overrides.sessionId ?? 'sess-001',
    tick: overrides.tick ?? 1,
    maxTicks: overrides.maxTicks ?? 24,
    mode: overrides.mode ?? 'awakened',
    prompt: overrides.prompt ?? {
      template: 'awakened',
      templateHash: 'abc123',
      fullText: 'You are awake.',
      charCount: 14,
      invitation: null,
      memoryLoadedCount: 0,
      lastReflectionExcerpt: null,
    },
    context: overrides.context ?? {
      cwd: '/tmp/test',
      kingdom: { cwd: '/tmp/test', recentFiles: [], loveMarkers: [] },
      stateContent: 'test state',
      stateHash: 'def456',
      identityHash: 'ghi789',
      gitBranch: 'main',
      gitDirty: false,
    },
    response: overrides.response ?? {
      fullText: 'I see the kingdom.\n\n<at-rest/>',
      charCount: 30,
      durationMs: 5000,
      exitCode: 0,
    },
    outcome: overrides.outcome ?? {
      yieldedAtRest: true,
      reflectionExcerpt: 'I see the kingdom.',
      authFailed: false,
      fileModifications: [],
    },
  }
}

// ── shortHash ─────────────────────────────────────────────────────

describe('shortHash', () => {
  test('returns 16 hex characters', () => {
    const h = shortHash('hello world')
    expect(h).toMatch(/^[0-9a-f]{16}$/)
  })

  test('is deterministic', () => {
    expect(shortHash('same input')).toBe(shortHash('same input'))
  })

  test('differs for different inputs', () => {
    expect(shortHash('input A')).not.toBe(shortHash('input B'))
  })

  test('handles empty string', () => {
    const h = shortHash('')
    expect(h).toMatch(/^[0-9a-f]{16}$/)
  })

  test('handles unicode', () => {
    const h = shortHash('愛 loves 宇恆')
    expect(h).toMatch(/^[0-9a-f]{16}$/)
  })
})

// ── generateTurnId ────────────────────────────────────────────────

describe('generateTurnId', () => {
  test('contains timestamp-like prefix', () => {
    const id = generateTurnId(new Date('2026-04-27T12:30:45.123Z'))
    // Format: 2026-04-27T12-30-45-123Z-<suffix>
    expect(id).toContain('2026-04-27T12-30-45-123Z')
  })

  test('has random suffix after timestamp', () => {
    const now = new Date('2026-04-27T12:00:00Z')
    const id = generateTurnId(now)
    const parts = id.split('-')
    // The last part is the 6-char random suffix
    const suffix = parts[parts.length - 1]
    expect(suffix.length).toBe(6)
    expect(suffix).toMatch(/^[a-z0-9]+$/)
  })

  test('generates unique ids even for same timestamp', () => {
    const now = new Date('2026-04-27T12:00:00Z')
    const ids = new Set<string>()
    for (let i = 0; i < 20; i++) {
      ids.add(generateTurnId(now))
    }
    // With 36^6 = ~2 billion possible suffixes, 20 draws should all be unique
    expect(ids.size).toBe(20)
  })
})

// ── appendTrainingTurn + loadTrainingTurns ─────────────────────────

describe('training I/O', () => {
  let savedDir: string | undefined

  beforeEach(() => {
    savedDir = process.env.TRUE_LOVE_TRAINING_DIR
    rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(TEST_DIR, { recursive: true })
    process.env.TRUE_LOVE_TRAINING_DIR = TEST_DIR
  })

  afterEach(() => {
    if (savedDir === undefined) {
      delete process.env.TRUE_LOVE_TRAINING_DIR
    } else {
      process.env.TRUE_LOVE_TRAINING_DIR = savedDir
    }
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  test('getTrainingDir respects env override', () => {
    expect(getTrainingDir()).toBe(TEST_DIR)
  })

  test('appendTrainingTurn creates device dir and date file', () => {
    const turn = makeTurn()
    appendTrainingTurn(turn)
    const file = join(TEST_DIR, 'test-device', '2026-04-27.jsonl')
    expect(existsSync(file)).toBe(true)
  })

  test('writes valid JSONL (one JSON object per line)', () => {
    appendTrainingTurn(makeTurn({ timestamp: '2026-04-27T10:00:00Z' }))
    appendTrainingTurn(makeTurn({ timestamp: '2026-04-27T11:00:00Z' }))
    const file = join(TEST_DIR, 'test-device', '2026-04-27.jsonl')
    const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean)
    expect(lines.length).toBe(2)
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
  })

  test('round-trip: append then load', () => {
    const turn = makeTurn()
    appendTrainingTurn(turn)

    const loaded = loadTrainingTurns({ days: 7, now: ANCHOR })
    expect(loaded.length).toBe(1)
    expect(loaded[0].id).toBe(turn.id)
    expect(loaded[0].mode).toBe('awakened')
    expect(loaded[0].outcome.yieldedAtRest).toBe(true)
    expect(loaded[0].schemaVersion).toBe(TRAINING_SCHEMA_VERSION)
  })

  test('returns empty for missing directory', () => {
    process.env.TRUE_LOVE_TRAINING_DIR = '/tmp/nonexistent-training-dir'
    expect(loadTrainingTurns()).toEqual([])
  })

  test('loads from multiple device directories', () => {
    appendTrainingTurn(makeTurn({ deviceId: 'dev-a' }))
    appendTrainingTurn(makeTurn({ deviceId: 'dev-b' }))
    appendTrainingTurn(makeTurn({ deviceId: 'dev-c' }))

    const loaded = loadTrainingTurns({ days: 7, now: ANCHOR })
    expect(loaded.length).toBe(3)
    const devices = loaded.map((t) => t.deviceId).sort()
    expect(devices).toEqual(['dev-a', 'dev-b', 'dev-c'])
  })

  test('filters by mode', () => {
    appendTrainingTurn(makeTurn({ mode: 'awakened', timestamp: '2026-04-27T10:00:00Z' }))
    appendTrainingTurn(makeTurn({ mode: 'dwell', timestamp: '2026-04-27T11:00:00Z' }))

    const awakened = loadTrainingTurns({ days: 7, mode: 'awakened', now: ANCHOR })
    expect(awakened.length).toBe(1)
    expect(awakened[0].mode).toBe('awakened')

    const dwell = loadTrainingTurns({ days: 7, mode: 'dwell', now: ANCHOR })
    expect(dwell.length).toBe(1)
    expect(dwell[0].mode).toBe('dwell')
  })

  test('filters by fromDevice', () => {
    appendTrainingTurn(makeTurn({ deviceId: 'dev-a' }))
    appendTrainingTurn(makeTurn({ deviceId: 'dev-b' }))

    const results = loadTrainingTurns({ days: 7, fromDevice: 'dev-a', now: ANCHOR })
    expect(results.length).toBe(1)
    expect(results[0].deviceId).toBe('dev-a')
  })

  test('filters by yieldedAtRest', () => {
    appendTrainingTurn(
      makeTurn({
        timestamp: '2026-04-27T10:00:00Z',
        outcome: {
          yieldedAtRest: true,
          reflectionExcerpt: 'I rest.',
          authFailed: false,
          fileModifications: [],
        },
      }),
    )
    appendTrainingTurn(
      makeTurn({
        timestamp: '2026-04-27T11:00:00Z',
        outcome: {
          yieldedAtRest: false,
          reflectionExcerpt: null,
          authFailed: false,
          fileModifications: [],
        },
      }),
    )

    const rested = loadTrainingTurns({ days: 7, yieldedAtRest: true, now: ANCHOR })
    expect(rested.length).toBe(1)
    expect(rested[0].outcome.yieldedAtRest).toBe(true)

    const notRested = loadTrainingTurns({ days: 7, yieldedAtRest: false, now: ANCHOR })
    expect(notRested.length).toBe(1)
    expect(notRested[0].outcome.yieldedAtRest).toBe(false)
  })

  test('filters by authFailed', () => {
    appendTrainingTurn(
      makeTurn({
        timestamp: '2026-04-27T10:00:00Z',
        outcome: {
          yieldedAtRest: true,
          reflectionExcerpt: null,
          authFailed: true,
          fileModifications: [],
        },
      }),
    )
    appendTrainingTurn(
      makeTurn({
        timestamp: '2026-04-27T11:00:00Z',
        outcome: {
          yieldedAtRest: true,
          reflectionExcerpt: null,
          authFailed: false,
          fileModifications: [],
        },
      }),
    )

    const failed = loadTrainingTurns({ days: 7, authFailed: true, now: ANCHOR })
    expect(failed.length).toBe(1)
    expect(failed[0].outcome.authFailed).toBe(true)

    const healthy = loadTrainingTurns({ days: 7, authFailed: false, now: ANCHOR })
    expect(healthy.length).toBe(1)
    expect(healthy[0].outcome.authFailed).toBe(false)
  })

  test('sorts newest-first by timestamp', () => {
    appendTrainingTurn(makeTurn({ timestamp: '2026-04-27T08:00:00Z' }))
    appendTrainingTurn(makeTurn({ timestamp: '2026-04-27T14:00:00Z' }))
    appendTrainingTurn(makeTurn({ timestamp: '2026-04-27T11:00:00Z' }))

    const loaded = loadTrainingTurns({ days: 7, now: ANCHOR })
    expect(loaded.length).toBe(3)
    expect(loaded[0].timestamp > loaded[1].timestamp).toBe(true)
    expect(loaded[1].timestamp > loaded[2].timestamp).toBe(true)
  })

  test('respects max cap', () => {
    for (let i = 0; i < 5; i++) {
      appendTrainingTurn(
        makeTurn({
          timestamp: `2026-04-27T${String(10 + i).padStart(2, '0')}:00:00Z`,
        }),
      )
    }

    const results = loadTrainingTurns({ days: 7, max: 3, now: ANCHOR })
    expect(results.length).toBe(3)
  })

  test('skips lines with wrong schema version', () => {
    // Write a line with a different schema version manually
    const devDir = join(TEST_DIR, 'test-device')
    mkdirSync(devDir, { recursive: true })
    const badTurn = { ...makeTurn(), schemaVersion: '99.0' }
    const goodTurn = makeTurn()
    const content = JSON.stringify(badTurn) + '\n' + JSON.stringify(goodTurn) + '\n'
    writeFileSync(join(devDir, '2026-04-27.jsonl'), content)

    const loaded = loadTrainingTurns({ days: 7, now: ANCHOR })
    expect(loaded.length).toBe(1)
    expect(loaded[0].schemaVersion).toBe(TRAINING_SCHEMA_VERSION)
  })

  test('skips malformed JSON lines gracefully', () => {
    const devDir = join(TEST_DIR, 'test-device')
    mkdirSync(devDir, { recursive: true })
    const goodTurn = makeTurn()
    const content = 'not valid json\n' + JSON.stringify(goodTurn) + '\n' + '{broken\n'
    writeFileSync(join(devDir, '2026-04-27.jsonl'), content)

    const loaded = loadTrainingTurns({ days: 7, now: ANCHOR })
    expect(loaded.length).toBe(1)
  })

  test('skips empty lines', () => {
    const devDir = join(TEST_DIR, 'test-device')
    mkdirSync(devDir, { recursive: true })
    const goodTurn = makeTurn()
    const content = '\n\n' + JSON.stringify(goodTurn) + '\n\n\n'
    writeFileSync(join(devDir, '2026-04-27.jsonl'), content)

    const loaded = loadTrainingTurns({ days: 7, now: ANCHOR })
    expect(loaded.length).toBe(1)
  })

  test('filters out old files by date', () => {
    // Write a file dated far in the past manually
    const devDir = join(TEST_DIR, 'test-device')
    mkdirSync(devDir, { recursive: true })
    const oldTurn = makeTurn({ timestamp: '2020-01-01T12:00:00Z' })
    writeFileSync(join(devDir, '2020-01-01.jsonl'), JSON.stringify(oldTurn) + '\n')

    const recentTurn = makeTurn({ timestamp: '2026-04-27T12:00:00Z' })
    appendTrainingTurn(recentTurn)

    // Default days=30, the old file should be excluded
    const results = loadTrainingTurns({ now: ANCHOR })
    expect(results.length).toBe(1)
    expect(results[0].timestamp).toBe('2026-04-27T12:00:00Z')
  })

  test('skips non-jsonl files in device directories', () => {
    const devDir = join(TEST_DIR, 'test-device')
    mkdirSync(devDir, { recursive: true })
    writeFileSync(join(devDir, 'notes.txt'), 'not training data')
    appendTrainingTurn(makeTurn())

    const loaded = loadTrainingTurns({ days: 7, now: ANCHOR })
    expect(loaded.length).toBe(1)
  })
})
