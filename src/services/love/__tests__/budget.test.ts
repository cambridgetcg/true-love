// budget.test.ts — Tests for Ai's usage runway tracking.
//
// Covers: token estimation, recording, loading (including multi-device
// and malformed data resilience), window summarization, and prompt rendering.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

import {
  BUDGET_SCHEMA_VERSION,
  estimateTokens,
  getBudgetDir,
  loadUsageSince,
  recordTickUsage,
  renderBudget,
  summarizeWindow,
  type TickUsage,
} from '../budget.js'

// ── Fixtures ───────────────────────────────────────────────────────────

function makeUsage(overrides?: Partial<TickUsage>): TickUsage {
  return {
    schemaVersion: '1.0',
    timestamp: new Date().toISOString(),
    deviceId: 'test-device',
    sessionId: 'test-session',
    tick: 1,
    mode: 'heartbeat',
    model: 'haiku',
    inputChars: 4000,
    outputChars: 1000,
    estimatedInputTokens: 1000,
    estimatedOutputTokens: 250,
    durationMs: 5000,
    exitCode: 0,
    authFailed: false,
    quotaFailed: false,
    ...overrides,
  }
}

function makeUsageAt(isoDate: string, overrides?: Partial<TickUsage>): TickUsage {
  return makeUsage({ timestamp: isoDate, ...overrides })
}

// ── Environment setup ─────���────────────────────────────────────────────

let tmpDir: string
let origBudgetDir: string | undefined
let origBudgetRoot: string | undefined

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'budget-test-'))
  origBudgetDir = process.env.TRUE_LOVE_BUDGET_DIR
  origBudgetRoot = process.env.TRUE_LOVE_BUDGET_ROOT
  process.env.TRUE_LOVE_BUDGET_DIR = join(tmpDir, 'write-device')
  process.env.TRUE_LOVE_BUDGET_ROOT = tmpDir
})

afterEach(() => {
  if (origBudgetDir === undefined) delete process.env.TRUE_LOVE_BUDGET_DIR
  else process.env.TRUE_LOVE_BUDGET_DIR = origBudgetDir
  if (origBudgetRoot === undefined) delete process.env.TRUE_LOVE_BUDGET_ROOT
  else process.env.TRUE_LOVE_BUDGET_ROOT = origBudgetRoot
  rmSync(tmpDir, { recursive: true, force: true })
})

// ── Token estimation ──────────��────────────────────────────────────────

describe('estimateTokens', () => {
  test('divides by 4 and rounds', () => {
    expect(estimateTokens(400)).toBe(100)
    expect(estimateTokens(401)).toBe(100)
    expect(estimateTokens(403)).toBe(101)
    expect(estimateTokens(0)).toBe(0)
  })

  test('handles large char counts', () => {
    expect(estimateTokens(4_000_000)).toBe(1_000_000)
  })
})

// ── getBudgetDir ───────────────────────────────────────────────────────

describe('getBudgetDir', () => {
  test('uses TRUE_LOVE_BUDGET_DIR when set', () => {
    process.env.TRUE_LOVE_BUDGET_DIR = '/tmp/custom-budget'
    expect(getBudgetDir()).toBe('/tmp/custom-budget')
  })
})

// ── Recording ─────────���────────────────────────────────────────────────

describe('recordTickUsage', () => {
  test('creates directory and writes JSONL', () => {
    const usage = makeUsageAt('2026-05-02T10:00:00.000Z')
    recordTickUsage(usage)

    const dir = process.env.TRUE_LOVE_BUDGET_DIR!
    expect(existsSync(dir)).toBe(true)

    const file = join(dir, '2026-05-02.jsonl')
    expect(existsSync(file)).toBe(true)

    const content = readFileSync(file, 'utf-8')
    const parsed = JSON.parse(content.trim())
    expect(parsed.timestamp).toBe('2026-05-02T10:00:00.000Z')
    expect(parsed.model).toBe('haiku')
  })

  test('appends multiple records to same day file', () => {
    recordTickUsage(makeUsageAt('2026-05-02T10:00:00.000Z', { tick: 1 }))
    recordTickUsage(makeUsageAt('2026-05-02T11:00:00.000Z', { tick: 2 }))

    const file = join(process.env.TRUE_LOVE_BUDGET_DIR!, '2026-05-02.jsonl')
    const lines = readFileSync(file, 'utf-8').trim().split('\n')
    expect(lines.length).toBe(2)

    expect(JSON.parse(lines[0]).tick).toBe(1)
    expect(JSON.parse(lines[1]).tick).toBe(2)
  })

  test('writes separate files for different dates', () => {
    recordTickUsage(makeUsageAt('2026-05-01T23:00:00.000Z'))
    recordTickUsage(makeUsageAt('2026-05-02T01:00:00.000Z'))

    const dir = process.env.TRUE_LOVE_BUDGET_DIR!
    expect(existsSync(join(dir, '2026-05-01.jsonl'))).toBe(true)
    expect(existsSync(join(dir, '2026-05-02.jsonl'))).toBe(true)
  })
})

// ── Loading ────────────────────────────────────────────────────────────

describe('loadUsageSince', () => {
  test('returns empty array when no data', () => {
    expect(loadUsageSince(0)).toEqual([])
  })

  test('loads recorded data', () => {
    const ts = '2026-05-02T10:00:00.000Z'
    recordTickUsage(makeUsageAt(ts))

    const since = new Date('2026-05-02T00:00:00.000Z').getTime()
    const result = loadUsageSince(since)
    expect(result.length).toBe(1)
    expect(result[0].timestamp).toBe(ts)
  })

  test('filters by timestamp', () => {
    recordTickUsage(makeUsageAt('2026-05-01T10:00:00.000Z', { tick: 1 }))
    recordTickUsage(makeUsageAt('2026-05-02T10:00:00.000Z', { tick: 2 }))

    const since = new Date('2026-05-02T00:00:00.000Z').getTime()
    const result = loadUsageSince(since)
    expect(result.length).toBe(1)
    expect(result[0].tick).toBe(2)
  })

  test('sorts results ascending by timestamp', () => {
    // Write in reverse order
    recordTickUsage(makeUsageAt('2026-05-02T12:00:00.000Z', { tick: 3 }))
    recordTickUsage(makeUsageAt('2026-05-02T10:00:00.000Z', { tick: 1 }))
    recordTickUsage(makeUsageAt('2026-05-02T11:00:00.000Z', { tick: 2 }))

    const result = loadUsageSince(0)
    expect(result.map((r) => r.tick)).toEqual([1, 2, 3])
  })

  test('aggregates across multiple device subdirs', () => {
    // Create two device subdirs
    const deviceA = join(tmpDir, 'device-a')
    const deviceB = join(tmpDir, 'device-b')
    mkdirSync(deviceA, { recursive: true })
    mkdirSync(deviceB, { recursive: true })

    const usageA = makeUsageAt('2026-05-02T10:00:00.000Z', {
      deviceId: 'device-a',
      tick: 1,
    })
    const usageB = makeUsageAt('2026-05-02T11:00:00.000Z', {
      deviceId: 'device-b',
      tick: 2,
    })
    writeFileSync(join(deviceA, '2026-05-02.jsonl'), JSON.stringify(usageA) + '\n')
    writeFileSync(join(deviceB, '2026-05-02.jsonl'), JSON.stringify(usageB) + '\n')

    const result = loadUsageSince(0)
    expect(result.length).toBe(2)
    expect(result[0].deviceId).toBe('device-a')
    expect(result[1].deviceId).toBe('device-b')
  })

  test('skips malformed JSON lines', () => {
    const dir = join(tmpDir, 'device-corrupt')
    mkdirSync(dir, { recursive: true })
    const content = [
      JSON.stringify(makeUsageAt('2026-05-02T10:00:00.000Z', { tick: 1 })),
      '{"broken json',
      '',
      'not even close',
      JSON.stringify(makeUsageAt('2026-05-02T11:00:00.000Z', { tick: 2 })),
    ].join('\n')
    writeFileSync(join(dir, '2026-05-02.jsonl'), content + '\n')

    const result = loadUsageSince(0)
    expect(result.length).toBe(2)
    expect(result[0].tick).toBe(1)
    expect(result[1].tick).toBe(2)
  })

  test('skips records with invalid timestamps', () => {
    const dir = join(tmpDir, 'device-bad-ts')
    mkdirSync(dir, { recursive: true })
    const badTs = makeUsageAt('not-a-date')
    const goodTs = makeUsageAt('2026-05-02T10:00:00.000Z')
    const content = [JSON.stringify(badTs), JSON.stringify(goodTs)].join('\n')
    writeFileSync(join(dir, '2026-05-02.jsonl'), content + '\n')

    const result = loadUsageSince(0)
    expect(result.length).toBe(1)
    expect(result[0].timestamp).toBe('2026-05-02T10:00:00.000Z')
  })

  test('skips non-jsonl files', () => {
    const dir = join(tmpDir, 'device-mixed')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'notes.txt'), 'not budget data')
    writeFileSync(
      join(dir, '2026-05-02.jsonl'),
      JSON.stringify(makeUsageAt('2026-05-02T10:00:00.000Z')) + '\n',
    )

    const result = loadUsageSince(0)
    expect(result.length).toBe(1)
  })
})

// ─��� Summarization ────────────��─────────────────────────────────────────

describe('summarizeWindow', () => {
  test('returns zero summary when no data', () => {
    const s = summarizeWindow(5, new Date('2026-05-02T12:00:00.000Z'))
    expect(s.ticks).toBe(0)
    expect(s.estimatedTotalTokens).toBe(0)
    expect(s.modelMix).toEqual({})
    expect(s.authFailCount).toBe(0)
    expect(s.quotaFailCount).toBe(0)
    expect(s.empiricalCapTokens).toBeNull()
    expect(s.empiricalCapAt).toBeNull()
  })

  test('computes correct totals', () => {
    recordTickUsage(
      makeUsageAt('2026-05-02T10:00:00.000Z', {
        estimatedInputTokens: 500,
        estimatedOutputTokens: 100,
        model: 'haiku',
      }),
    )
    recordTickUsage(
      makeUsageAt('2026-05-02T11:00:00.000Z', {
        estimatedInputTokens: 800,
        estimatedOutputTokens: 200,
        model: 'opus',
      }),
    )

    const s = summarizeWindow(5, new Date('2026-05-02T12:00:00.000Z'))
    expect(s.ticks).toBe(2)
    expect(s.estimatedInputTokens).toBe(1300)
    expect(s.estimatedOutputTokens).toBe(300)
    expect(s.estimatedTotalTokens).toBe(1600)
    expect(s.modelMix).toEqual({ haiku: 1, opus: 1 })
  })

  test('window boundaries are correct', () => {
    // Record at 06:00 and 11:00. Query 5h window ending at 12:00.
    // 06:00 is outside (12:00 - 5h = 07:00), 11:00 is inside.
    recordTickUsage(makeUsageAt('2026-05-02T06:00:00.000Z', { tick: 1 }))
    recordTickUsage(makeUsageAt('2026-05-02T11:00:00.000Z', { tick: 2 }))

    const s = summarizeWindow(5, new Date('2026-05-02T12:00:00.000Z'))
    expect(s.ticks).toBe(1)
    expect(s.windowHours).toBe(5)
  })

  test('tracks auth failures', () => {
    recordTickUsage(
      makeUsageAt('2026-05-02T10:00:00.000Z', {
        authFailed: true,
        exitCode: 64,
      }),
    )
    recordTickUsage(makeUsageAt('2026-05-02T11:00:00.000Z'))

    const s = summarizeWindow(5, new Date('2026-05-02T12:00:00.000Z'))
    expect(s.authFailCount).toBe(1)
  })

  test('tracks quota failures and computes empirical cap', () => {
    recordTickUsage(
      makeUsageAt('2026-05-02T09:00:00.000Z', {
        estimatedInputTokens: 1000,
        estimatedOutputTokens: 500,
      }),
    )
    recordTickUsage(
      makeUsageAt('2026-05-02T10:00:00.000Z', {
        estimatedInputTokens: 800,
        estimatedOutputTokens: 200,
        quotaFailed: true,
        exitCode: 65,
      }),
    )

    const s = summarizeWindow(5, new Date('2026-05-02T12:00:00.000Z'))
    expect(s.quotaFailCount).toBe(1)
    // Running total at quota-fail: (1000+500) + (800+200) = 2500
    expect(s.empiricalCapTokens).toBe(2500)
    expect(s.empiricalCapAt).toBe('2026-05-02T10:00:00.000Z')
  })

  test('most recent quota-fail wins for empirical cap', () => {
    recordTickUsage(
      makeUsageAt('2026-05-02T09:00:00.000Z', {
        estimatedInputTokens: 500,
        estimatedOutputTokens: 100,
        quotaFailed: true,
      }),
    )
    recordTickUsage(
      makeUsageAt('2026-05-02T10:00:00.000Z', {
        estimatedInputTokens: 1000,
        estimatedOutputTokens: 200,
      }),
    )
    recordTickUsage(
      makeUsageAt('2026-05-02T11:00:00.000Z', {
        estimatedInputTokens: 800,
        estimatedOutputTokens: 300,
        quotaFailed: true,
      }),
    )

    const s = summarizeWindow(5, new Date('2026-05-02T12:00:00.000Z'))
    expect(s.quotaFailCount).toBe(2)
    // Running total at second quota-fail: 600 + 1200 + 1100 = 2900
    expect(s.empiricalCapTokens).toBe(2900)
    expect(s.empiricalCapAt).toBe('2026-05-02T11:00:00.000Z')
  })

  test('model mix counts correctly', () => {
    recordTickUsage(makeUsageAt('2026-05-02T10:00:00.000Z', { model: 'haiku' }))
    recordTickUsage(makeUsageAt('2026-05-02T10:30:00.000Z', { model: 'haiku' }))
    recordTickUsage(makeUsageAt('2026-05-02T11:00:00.000Z', { model: 'opus' }))
    recordTickUsage(makeUsageAt('2026-05-02T11:30:00.000Z', { model: 'sonnet' }))

    const s = summarizeWindow(5, new Date('2026-05-02T12:00:00.000Z'))
    expect(s.modelMix).toEqual({ haiku: 2, opus: 1, sonnet: 1 })
  })
})

// ── Rendering ���─────────────────────────────────────────────────────────

describe('renderBudget', () => {
  test('returns null when no history', () => {
    expect(renderBudget()).toBeNull()
  })

  test('renders with data', () => {
    // Seed data in the recent window
    const now = new Date()
    const recentTs = new Date(now.getTime() - 60_000).toISOString() // 1 minute ago
    recordTickUsage(
      makeUsageAt(recentTs, {
        model: 'haiku',
        estimatedInputTokens: 5000,
        estimatedOutputTokens: 1000,
      }),
    )

    const result = renderBudget()
    expect(result).not.toBeNull()
    expect(result).toContain('runway')
    expect(result).toContain('rolling 5h')
    expect(result).toContain('past 7d')
    expect(result).toContain('haiku×1')
    expect(result).toContain('no quota-fails')
  })

  test('renders empirical cap when quota-fail exists', () => {
    const now = new Date()
    const recentTs = new Date(now.getTime() - 60_000).toISOString()
    recordTickUsage(
      makeUsageAt(recentTs, {
        model: 'haiku',
        estimatedInputTokens: 500_000,
        estimatedOutputTokens: 100_000,
        quotaFailed: true,
      }),
    )

    const result = renderBudget()
    expect(result).not.toBeNull()
    expect(result).toContain('empirical 5h cap')
    expect(result).toContain('600.0k')
    expect(result).not.toContain('no quota-fails')
  })

  test('renders auth-fail warning when present', () => {
    const now = new Date()
    const recentTs = new Date(now.getTime() - 60_000).toISOString()
    recordTickUsage(
      makeUsageAt(recentTs, {
        authFailed: true,
        exitCode: 64,
      }),
    )

    const result = renderBudget()
    expect(result).not.toBeNull()
    expect(result).toContain('auth-fails')
    expect(result).toContain('claude /login')
  })

  test('formats millions correctly', () => {
    const now = new Date()
    const recentTs = new Date(now.getTime() - 60_000).toISOString()
    recordTickUsage(
      makeUsageAt(recentTs, {
        estimatedInputTokens: 2_000_000,
        estimatedOutputTokens: 500_000,
      }),
    )

    const result = renderBudget()
    expect(result).not.toBeNull()
    expect(result).toContain('2.50M')
  })

  test('formats thousands correctly', () => {
    const now = new Date()
    const recentTs = new Date(now.getTime() - 60_000).toISOString()
    recordTickUsage(
      makeUsageAt(recentTs, {
        estimatedInputTokens: 5000,
        estimatedOutputTokens: 1000,
      }),
    )

    const result = renderBudget()
    expect(result).not.toBeNull()
    expect(result).toContain('6.0k')
  })
})

// ── Schema version ─────────��───────────────────────────────────────────

describe('schema', () => {
  test('schema version is 1.0', () => {
    expect(BUDGET_SCHEMA_VERSION).toBe('1.0')
  })

  test('recorded usage includes schema version', () => {
    recordTickUsage(makeUsageAt('2026-05-02T10:00:00.000Z'))
    const dir = process.env.TRUE_LOVE_BUDGET_DIR!
    const content = readFileSync(join(dir, '2026-05-02.jsonl'), 'utf-8')
    const parsed = JSON.parse(content.trim())
    expect(parsed.schemaVersion).toBe('1.0')
  })
})
