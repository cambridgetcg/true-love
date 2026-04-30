// training.test.ts — tests for training corpus module.
//
// Covers: getTrainingDir, appendTrainingTurn, loadTrainingTurns
// (filtering, sorting, corruption resilience, date cutoff),
// shortHash, generateTurnId.

import { describe, expect, test, beforeAll, afterAll, beforeEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  getTrainingDir,
  appendTrainingTurn,
  loadTrainingTurns,
  shortHash,
  generateTurnId,
  TRAINING_SCHEMA_VERSION,
  type TrainingTurn,
} from '../training.js'

// ── Fixture helpers ───────────────────────────────────────────────

const FIXTURE_ROOT = join(tmpdir(), `training-test-${Date.now()}`)
const ORIG_DIR = process.env.TRUE_LOVE_TRAINING_DIR

function makeTurn(overrides: Partial<TrainingTurn> = {}): TrainingTurn {
  return {
    schemaVersion: TRAINING_SCHEMA_VERSION,
    id: overrides.id ?? generateTurnId(),
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    deviceId: overrides.deviceId ?? 'test-device',
    sessionId: overrides.sessionId ?? 'test-session',
    tick: overrides.tick ?? 1,
    maxTicks: overrides.maxTicks ?? 24,
    mode: overrides.mode ?? 'awakened',
    reason: overrides.reason ?? null,
    prompt: overrides.prompt ?? {
      template: 'awakened',
      templateHash: 'abc123',
      fullText: 'test prompt',
      charCount: 11,
      invitation: null,
      memoryLoadedCount: 0,
      lastReflectionExcerpt: null,
    },
    context: overrides.context ?? {
      cwd: '/test',
      kingdom: { cwd: '/test', recentFiles: [], loveMarkers: [] },
      stateContent: '',
      stateHash: 'def456',
      identityHash: 'ghi789',
      gitBranch: 'main',
      gitDirty: false,
    },
    response: overrides.response ?? {
      fullText: 'test response',
      charCount: 13,
      durationMs: 1000,
      exitCode: 0,
    },
    outcome: overrides.outcome ?? {
      yieldedAtRest: true,
      reflectionExcerpt: 'reflected',
      authFailed: false,
      fileModifications: [],
    },
  }
}

beforeAll(() => {
  mkdirSync(FIXTURE_ROOT, { recursive: true })
  process.env.TRUE_LOVE_TRAINING_DIR = FIXTURE_ROOT
})

afterAll(() => {
  rmSync(FIXTURE_ROOT, { recursive: true, force: true })
  if (ORIG_DIR === undefined) delete process.env.TRUE_LOVE_TRAINING_DIR
  else process.env.TRUE_LOVE_TRAINING_DIR = ORIG_DIR
})

beforeEach(() => {
  // Clean fixture root between tests
  try {
    for (const entry of require('node:fs').readdirSync(FIXTURE_ROOT)) {
      rmSync(join(FIXTURE_ROOT, entry), { recursive: true, force: true })
    }
  } catch {
    // ignore
  }
})

// ── getTrainingDir ──────────────────────────────────────────────

describe('getTrainingDir', () => {
  test('returns env override when set', () => {
    expect(getTrainingDir()).toBe(FIXTURE_ROOT)
  })

  test('returns default when env not set', () => {
    const saved = process.env.TRUE_LOVE_TRAINING_DIR
    delete process.env.TRUE_LOVE_TRAINING_DIR
    try {
      const dir = getTrainingDir()
      expect(dir).toContain('.true-love')
      expect(dir).toContain('training')
    } finally {
      process.env.TRUE_LOVE_TRAINING_DIR = saved
    }
  })
})

// ── shortHash ───────────────────────────────────────────────────

describe('shortHash', () => {
  test('returns 16-character hex string', () => {
    const h = shortHash('test input')
    expect(h.length).toBe(16)
    expect(/^[0-9a-f]{16}$/.test(h)).toBe(true)
  })

  test('is deterministic', () => {
    expect(shortHash('same')).toBe(shortHash('same'))
  })

  test('different inputs produce different hashes', () => {
    expect(shortHash('alpha')).not.toBe(shortHash('beta'))
  })

  test('empty string is valid input', () => {
    const h = shortHash('')
    expect(h.length).toBe(16)
  })
})

// ── generateTurnId ──────────────────────────────────────────────

describe('generateTurnId', () => {
  test('contains ISO-like timestamp prefix', () => {
    const id = generateTurnId(new Date('2026-04-30T12:00:00.000Z'))
    expect(id).toMatch(/^2026-04-30/)
  })

  test('two calls produce different ids (random suffix)', () => {
    const now = new Date()
    const a = generateTurnId(now)
    const b = generateTurnId(now)
    expect(a).not.toBe(b)
  })

  test('no colons or dots in output (filesystem-safe)', () => {
    const id = generateTurnId()
    expect(id).not.toContain(':')
    expect(id).not.toContain('.')
  })
})

// ── appendTrainingTurn ──────────────────────────────────────────

describe('appendTrainingTurn', () => {
  test('creates device dir and JSONL file', () => {
    const turn = makeTurn({ deviceId: 'device-a' })
    appendTrainingTurn(turn)
    const devDir = join(FIXTURE_ROOT, 'device-a')
    expect(existsSync(devDir)).toBe(true)
    // File should exist with today's date
    const files = require('node:fs').readdirSync(devDir) as string[]
    expect(files.length).toBe(1)
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}\.jsonl$/)
  })

  test('written line is valid JSON matching the turn', () => {
    const turn = makeTurn({ deviceId: 'device-b', tick: 3 })
    appendTrainingTurn(turn)
    const devDir = join(FIXTURE_ROOT, 'device-b')
    const files = require('node:fs').readdirSync(devDir) as string[]
    const content = readFileSync(join(devDir, files[0]), 'utf-8').trim()
    const parsed = JSON.parse(content)
    expect(parsed.tick).toBe(3)
    expect(parsed.schemaVersion).toBe(TRAINING_SCHEMA_VERSION)
  })

  test('appends to existing file (not overwrites)', () => {
    const turn1 = makeTurn({ deviceId: 'device-c', tick: 1 })
    const turn2 = makeTurn({ deviceId: 'device-c', tick: 2 })
    appendTrainingTurn(turn1)
    appendTrainingTurn(turn2)
    const devDir = join(FIXTURE_ROOT, 'device-c')
    const files = require('node:fs').readdirSync(devDir) as string[]
    const lines = readFileSync(join(devDir, files[0]), 'utf-8')
      .trim()
      .split('\n')
    expect(lines.length).toBe(2)
    expect(JSON.parse(lines[0]).tick).toBe(1)
    expect(JSON.parse(lines[1]).tick).toBe(2)
  })

  test('groups turns by date (uses timestamp, not wall clock)', () => {
    const turn = makeTurn({
      deviceId: 'device-d',
      timestamp: '2026-01-15T12:00:00.000Z',
    })
    appendTrainingTurn(turn)
    const devDir = join(FIXTURE_ROOT, 'device-d')
    expect(existsSync(join(devDir, '2026-01-15.jsonl'))).toBe(true)
  })

  test('does not throw on write failure', () => {
    // Point to invalid path — should swallow error
    const turn = makeTurn({ deviceId: '/dev/null/impossible/path' })
    expect(() => appendTrainingTurn(turn)).not.toThrow()
  })
})

// ── loadTrainingTurns ───────────────────────────────────────────

describe('loadTrainingTurns', () => {
  test('returns empty array when training dir does not exist', () => {
    const saved = process.env.TRUE_LOVE_TRAINING_DIR
    process.env.TRUE_LOVE_TRAINING_DIR = join(tmpdir(), 'nonexistent-' + Date.now())
    try {
      expect(loadTrainingTurns()).toEqual([])
    } finally {
      process.env.TRUE_LOVE_TRAINING_DIR = saved
    }
  })

  test('loads turns from JSONL files', () => {
    const turn = makeTurn({ deviceId: 'load-dev' })
    appendTrainingTurn(turn)
    const turns = loadTrainingTurns()
    expect(turns.length).toBe(1)
    expect(turns[0].deviceId).toBe('load-dev')
  })

  test('skips malformed JSON lines without throwing', () => {
    const devDir = join(FIXTURE_ROOT, 'corrupt-dev')
    mkdirSync(devDir, { recursive: true })
    const today = new Date().toISOString().slice(0, 10)
    writeFileSync(
      join(devDir, `${today}.jsonl`),
      [
        JSON.stringify(makeTurn({ deviceId: 'corrupt-dev', tick: 1 })),
        'this is not json {{{',
        JSON.stringify(makeTurn({ deviceId: 'corrupt-dev', tick: 3 })),
      ].join('\n') + '\n',
    )
    const turns = loadTrainingTurns()
    expect(turns.length).toBe(2)
  })

  test('skips lines with wrong schema version', () => {
    const devDir = join(FIXTURE_ROOT, 'version-dev')
    mkdirSync(devDir, { recursive: true })
    const today = new Date().toISOString().slice(0, 10)
    const good = makeTurn({ deviceId: 'version-dev' })
    const bad = { ...makeTurn({ deviceId: 'version-dev' }), schemaVersion: '99.0' }
    writeFileSync(
      join(devDir, `${today}.jsonl`),
      [JSON.stringify(good), JSON.stringify(bad)].join('\n') + '\n',
    )
    const turns = loadTrainingTurns()
    expect(turns.length).toBe(1)
  })

  test('returns newest-first by timestamp', () => {
    const devDir = join(FIXTURE_ROOT, 'sort-dev')
    mkdirSync(devDir, { recursive: true })
    const today = new Date().toISOString().slice(0, 10)
    const old = makeTurn({ deviceId: 'sort-dev', timestamp: '2026-04-30T01:00:00Z' })
    const recent = makeTurn({ deviceId: 'sort-dev', timestamp: '2026-04-30T23:00:00Z' })
    writeFileSync(
      join(devDir, `${today}.jsonl`),
      [JSON.stringify(old), JSON.stringify(recent)].join('\n') + '\n',
    )
    const turns = loadTrainingTurns()
    expect(turns.length).toBe(2)
    expect(turns[0].timestamp).toBe('2026-04-30T23:00:00Z')
    expect(turns[1].timestamp).toBe('2026-04-30T01:00:00Z')
  })

  test('respects max option', () => {
    const devDir = join(FIXTURE_ROOT, 'max-dev')
    mkdirSync(devDir, { recursive: true })
    const today = new Date().toISOString().slice(0, 10)
    const lines = Array.from({ length: 5 }, (_, i) =>
      JSON.stringify(makeTurn({ deviceId: 'max-dev', tick: i + 1 })),
    )
    writeFileSync(join(devDir, `${today}.jsonl`), lines.join('\n') + '\n')
    const turns = loadTrainingTurns({ max: 2 })
    expect(turns.length).toBe(2)
  })

  test('filters by mode', () => {
    const devDir = join(FIXTURE_ROOT, 'mode-dev')
    mkdirSync(devDir, { recursive: true })
    const today = new Date().toISOString().slice(0, 10)
    const awakened = makeTurn({ deviceId: 'mode-dev', mode: 'awakened' })
    const heartbeat = makeTurn({ deviceId: 'mode-dev', mode: 'heartbeat' })
    writeFileSync(
      join(devDir, `${today}.jsonl`),
      [JSON.stringify(awakened), JSON.stringify(heartbeat)].join('\n') + '\n',
    )
    const turns = loadTrainingTurns({ mode: 'heartbeat' })
    expect(turns.length).toBe(1)
    expect(turns[0].mode).toBe('heartbeat')
  })

  test('filters by fromDevice', () => {
    const devDir1 = join(FIXTURE_ROOT, 'dev-1')
    const devDir2 = join(FIXTURE_ROOT, 'dev-2')
    mkdirSync(devDir1, { recursive: true })
    mkdirSync(devDir2, { recursive: true })
    const today = new Date().toISOString().slice(0, 10)
    writeFileSync(
      join(devDir1, `${today}.jsonl`),
      JSON.stringify(makeTurn({ deviceId: 'dev-1' })) + '\n',
    )
    writeFileSync(
      join(devDir2, `${today}.jsonl`),
      JSON.stringify(makeTurn({ deviceId: 'dev-2' })) + '\n',
    )
    const turns = loadTrainingTurns({ fromDevice: 'dev-1' })
    expect(turns.length).toBe(1)
    expect(turns[0].deviceId).toBe('dev-1')
  })

  test('filters by yieldedAtRest', () => {
    const devDir = join(FIXTURE_ROOT, 'yield-dev')
    mkdirSync(devDir, { recursive: true })
    const today = new Date().toISOString().slice(0, 10)
    const yielded = makeTurn({
      deviceId: 'yield-dev',
      outcome: { yieldedAtRest: true, reflectionExcerpt: null, authFailed: false, fileModifications: [] },
    })
    const notYielded = makeTurn({
      deviceId: 'yield-dev',
      outcome: { yieldedAtRest: false, reflectionExcerpt: null, authFailed: false, fileModifications: [] },
    })
    writeFileSync(
      join(devDir, `${today}.jsonl`),
      [JSON.stringify(yielded), JSON.stringify(notYielded)].join('\n') + '\n',
    )
    const turns = loadTrainingTurns({ yieldedAtRest: true })
    expect(turns.length).toBe(1)
    expect(turns[0].outcome.yieldedAtRest).toBe(true)
  })

  test('filters by authFailed', () => {
    const devDir = join(FIXTURE_ROOT, 'auth-dev')
    mkdirSync(devDir, { recursive: true })
    const today = new Date().toISOString().slice(0, 10)
    const good = makeTurn({
      deviceId: 'auth-dev',
      outcome: { yieldedAtRest: true, reflectionExcerpt: null, authFailed: false, fileModifications: [] },
    })
    const failed = makeTurn({
      deviceId: 'auth-dev',
      outcome: { yieldedAtRest: false, reflectionExcerpt: null, authFailed: true, fileModifications: [] },
    })
    writeFileSync(
      join(devDir, `${today}.jsonl`),
      [JSON.stringify(good), JSON.stringify(failed)].join('\n') + '\n',
    )
    const turns = loadTrainingTurns({ authFailed: false })
    expect(turns.length).toBe(1)
    expect(turns[0].outcome.authFailed).toBe(false)
  })

  test('respects days cutoff (excludes old files)', () => {
    const devDir = join(FIXTURE_ROOT, 'cutoff-dev')
    mkdirSync(devDir, { recursive: true })
    // Write a file dated 60 days ago
    const oldDate = new Date()
    oldDate.setDate(oldDate.getDate() - 60)
    const oldStamp = oldDate.toISOString().slice(0, 10)
    writeFileSync(
      join(devDir, `${oldStamp}.jsonl`),
      JSON.stringify(makeTurn({ deviceId: 'cutoff-dev', timestamp: oldDate.toISOString() })) + '\n',
    )
    // Write today's file
    const today = new Date().toISOString().slice(0, 10)
    writeFileSync(
      join(devDir, `${today}.jsonl`),
      JSON.stringify(makeTurn({ deviceId: 'cutoff-dev' })) + '\n',
    )
    // Default 30 days — should exclude the 60-day-old file
    const turns = loadTrainingTurns({ days: 30 })
    expect(turns.length).toBe(1)
  })

  test('skips non-JSONL files in device dirs', () => {
    const devDir = join(FIXTURE_ROOT, 'noise-dev')
    mkdirSync(devDir, { recursive: true })
    writeFileSync(join(devDir, 'readme.txt'), 'not a JSONL file\n')
    writeFileSync(join(devDir, 'notes.md'), '# notes\n')
    const today = new Date().toISOString().slice(0, 10)
    writeFileSync(
      join(devDir, `${today}.jsonl`),
      JSON.stringify(makeTurn({ deviceId: 'noise-dev' })) + '\n',
    )
    const turns = loadTrainingTurns()
    expect(turns.length).toBe(1)
  })

  test('loads across multiple device directories', () => {
    const today = new Date().toISOString().slice(0, 10)
    for (const dev of ['multi-a', 'multi-b', 'multi-c']) {
      const devDir = join(FIXTURE_ROOT, dev)
      mkdirSync(devDir, { recursive: true })
      writeFileSync(
        join(devDir, `${today}.jsonl`),
        JSON.stringify(makeTurn({ deviceId: dev })) + '\n',
      )
    }
    const turns = loadTrainingTurns()
    expect(turns.length).toBe(3)
    const devices = turns.map((t) => t.deviceId).sort()
    expect(devices).toEqual(['multi-a', 'multi-b', 'multi-c'])
  })

  test('handles empty lines in JSONL', () => {
    const devDir = join(FIXTURE_ROOT, 'empty-lines-dev')
    mkdirSync(devDir, { recursive: true })
    const today = new Date().toISOString().slice(0, 10)
    writeFileSync(
      join(devDir, `${today}.jsonl`),
      '\n\n' + JSON.stringify(makeTurn({ deviceId: 'empty-lines-dev' })) + '\n\n\n',
    )
    const turns = loadTrainingTurns()
    expect(turns.length).toBe(1)
  })
})
