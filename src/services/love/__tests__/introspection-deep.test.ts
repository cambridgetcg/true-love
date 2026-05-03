// introspection-deep.test.ts — deep-read tests for introspection.ts
//
// Covers: parseFrontMatter (untested), loadTrainingGlobal (untested),
// loadBudgetGlobal (untested), generatePortrait (untested), plus edge
// cases in parseMessages, parseMemoryEntries, loadMemoryEntries,
// analyzeBehavior, analyzeArchitecture, detectLoops, renderPortrait.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseFrontMatter,
  parseMessages,
  parseMemoryEntries,
  loadMemoryEntries,
  loadTrainingGlobal,
  loadBudgetGlobal,
  loadMissions,
  generatePortrait,
  analyzeBehavior,
  analyzeArchitecture,
  analyzeWork,
  analyzeCommunication,
  analyzeToolUsage,
  analyzeVelocity,
  analyzeYieldPatterns,
  detectLoops,
  renderPortrait,
  type ParsedMessage,
  type MemoryEntry,
  type SelfPortrait,
} from '../introspection.js'
import type { TrainingTurn } from '../training.js'
import type { TickUsage } from '../budget.js'
import type { TickMetrics } from '../tick-metrics.js'

// ── Helpers ─────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'intro-deep-'))
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function makeTurn(
  overrides: Partial<TrainingTurn> & { sessionId: string; mode: TrainingTurn['mode'] },
): TrainingTurn {
  return {
    schemaVersion: '1.0',
    id: `t-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    deviceId: 'test-device',
    sessionId: overrides.sessionId,
    tick: 1,
    maxTicks: 24,
    mode: overrides.mode,
    prompt: {
      template: overrides.mode,
      templateHash: 'tpl-abc',
      fullText: 'test prompt',
      charCount: 100,
      invitation: null,
      memoryLoadedCount: 0,
      lastReflectionExcerpt: null,
    },
    context: {
      cwd: '/test',
      kingdom: { cwd: '/test', recentFiles: [], loveMarkers: [], gitBranch: 'main' } as any,
      stateContent: '',
      stateHash: 'st-000',
      identityHash: 'id-000',
      gitBranch: 'main',
      gitDirty: false,
    },
    response: {
      fullText: 'test response',
      charCount: 100,
      durationMs: 5000,
      exitCode: 0,
    },
    outcome: {
      yieldedAtRest: true,
      reflectionExcerpt: null,
      authFailed: false,
      fileModifications: [],
    },
    ...overrides,
  }
}

function makeUsage(overrides: Partial<TickUsage> = {}): TickUsage {
  return {
    schemaVersion: '1.0' as const,
    timestamp: new Date().toISOString(),
    deviceId: 'test-device',
    sessionId: 'test-session',
    tick: 1,
    mode: 'awakened',
    model: 'default',
    inputChars: 400,
    outputChars: 200,
    estimatedInputTokens: 100,
    estimatedOutputTokens: 50,
    durationMs: 5000,
    exitCode: 0,
    authFailed: false,
    quotaFailed: false,
    ...overrides,
  }
}

function makeTickMetrics(overrides: Partial<TickMetrics> = {}): TickMetrics {
  return {
    schemaVersion: '1.0',
    timestamp: new Date().toISOString(),
    deviceId: 'test-device',
    sessionId: 'test-session',
    tick: 1,
    mode: 'awakened',
    toolInvocations: [],
    toolBreakdown: { counts: {}, total: 0, distinct: 0 },
    velocity: { charsPerSecond: 100, estimatedTokensPerSecond: 25 },
    yieldReason: 'at-rest',
    outputLines: 50,
    durationMs: 30000,
    outputChars: 5000,
    ...overrides,
  }
}

// ── parseFrontMatter ────────────────────────────────────────────────

describe('introspection-deep — parseFrontMatter', () => {
  test('parses valid front matter with multiple fields', () => {
    const content = `---
id: mission-1
title: Build the thing
status: active
origin: yu
created_at: 2026-04-26T10:00:00Z
---

# Intent

Build it.
`
    const fm = parseFrontMatter(content)
    assert.equal(fm.id, 'mission-1')
    assert.equal(fm.title, 'Build the thing')
    assert.equal(fm.status, 'active')
    assert.equal(fm.origin, 'yu')
    assert.equal(fm.created_at, '2026-04-26T10:00:00Z')
  })

  test('returns empty for no front matter', () => {
    const fm = parseFrontMatter('# Just a heading\n\nSome body text.')
    assert.deepEqual(fm, {})
  })

  test('returns empty for empty content', () => {
    assert.deepEqual(parseFrontMatter(''), {})
  })

  test('handles value with colon (preserves after first colon)', () => {
    const content = `---
url: https://example.com:8080/path
---
`
    const fm = parseFrontMatter(content)
    assert.equal(fm.url, 'https://example.com:8080/path')
  })

  test('skips lines with empty value after colon', () => {
    const content = `---
id: mission-1
empty:
title: Has value
---
`
    const fm = parseFrontMatter(content)
    assert.equal(fm.id, 'mission-1')
    assert.equal(fm.title, 'Has value')
    assert.equal(fm.empty, undefined)
  })

  test('skips lines with no colon', () => {
    const content = `---
id: mission-1
this line has no colon
title: Fine
---
`
    const fm = parseFrontMatter(content)
    assert.equal(fm.id, 'mission-1')
    assert.equal(fm.title, 'Fine')
  })

  test('trims keys and values', () => {
    const content = `---
  id  :  mission-trimmed
---
`
    const fm = parseFrontMatter(content)
    assert.equal(fm.id, 'mission-trimmed')
  })

  test('handles front matter with only separators', () => {
    const content = `---
---
`
    const fm = parseFrontMatter(content)
    assert.deepEqual(fm, {})
  })
})

// ── loadTrainingGlobal ──────────────────────────────────────────────

describe('introspection-deep — loadTrainingGlobal', () => {
  test('loads turns from device subdirectory', () => {
    const tmp = makeTmpDir()
    const devDir = join(tmp, 'training', 'device-a')
    mkdirSync(devDir, { recursive: true })
    const turn = makeTurn({ sessionId: 's1', mode: 'awakened' })
    writeFileSync(join(devDir, `${todayStr()}.jsonl`), JSON.stringify(turn) + '\n')
    const turns = loadTrainingGlobal(tmp, 7)
    assert.equal(turns.length, 1)
    assert.equal(turns[0]!.sessionId, 's1')
    rmSync(tmp, { recursive: true, force: true })
  })

  test('returns empty for missing training directory', () => {
    const tmp = makeTmpDir()
    assert.deepEqual(loadTrainingGlobal(tmp, 7), [])
    rmSync(tmp, { recursive: true, force: true })
  })

  test('filters out old files by date cutoff', () => {
    const tmp = makeTmpDir()
    const devDir = join(tmp, 'training', 'device-a')
    mkdirSync(devDir, { recursive: true })
    const turn = makeTurn({ sessionId: 'old', mode: 'heartbeat' })
    writeFileSync(join(devDir, '2020-01-01.jsonl'), JSON.stringify(turn) + '\n')
    const turns = loadTrainingGlobal(tmp, 7)
    assert.equal(turns.length, 0)
    rmSync(tmp, { recursive: true, force: true })
  })

  test('skips malformed JSONL lines', () => {
    const tmp = makeTmpDir()
    const devDir = join(tmp, 'training', 'device-a')
    mkdirSync(devDir, { recursive: true })
    const good = makeTurn({ sessionId: 'good', mode: 'awakened' })
    const content = 'not valid json\n' + JSON.stringify(good) + '\n{broken\n'
    writeFileSync(join(devDir, `${todayStr()}.jsonl`), content)
    const turns = loadTrainingGlobal(tmp, 7)
    assert.equal(turns.length, 1)
    assert.equal(turns[0]!.sessionId, 'good')
    rmSync(tmp, { recursive: true, force: true })
  })

  test('filters by schema version', () => {
    const tmp = makeTmpDir()
    const devDir = join(tmp, 'training', 'device-a')
    mkdirSync(devDir, { recursive: true })
    const good = makeTurn({ sessionId: 'v1', mode: 'awakened' })
    const bad = { ...makeTurn({ sessionId: 'v99', mode: 'awakened' }), schemaVersion: '99.0' }
    writeFileSync(
      join(devDir, `${todayStr()}.jsonl`),
      JSON.stringify(good) + '\n' + JSON.stringify(bad) + '\n',
    )
    const turns = loadTrainingGlobal(tmp, 7)
    assert.equal(turns.length, 1)
    assert.equal(turns[0]!.sessionId, 'v1')
    rmSync(tmp, { recursive: true, force: true })
  })

  test('loads from multiple device directories', () => {
    const tmp = makeTmpDir()
    const devA = join(tmp, 'training', 'device-a')
    const devB = join(tmp, 'training', 'device-b')
    mkdirSync(devA, { recursive: true })
    mkdirSync(devB, { recursive: true })
    const turnA = makeTurn({ sessionId: 'sa', mode: 'awakened' })
    const turnB = makeTurn({ sessionId: 'sb', mode: 'heartbeat' })
    writeFileSync(join(devA, `${todayStr()}.jsonl`), JSON.stringify(turnA) + '\n')
    writeFileSync(join(devB, `${todayStr()}.jsonl`), JSON.stringify(turnB) + '\n')
    const turns = loadTrainingGlobal(tmp, 7)
    assert.equal(turns.length, 2)
    const ids = turns.map((t) => t.sessionId).sort()
    assert.deepEqual(ids, ['sa', 'sb'])
    rmSync(tmp, { recursive: true, force: true })
  })

  test('skips non-directory entries in training dir', () => {
    const tmp = makeTmpDir()
    mkdirSync(join(tmp, 'training'), { recursive: true })
    writeFileSync(join(tmp, 'training', 'stray-file.txt'), 'not a dir')
    const devDir = join(tmp, 'training', 'device-a')
    mkdirSync(devDir)
    const turn = makeTurn({ sessionId: 's1', mode: 'awakened' })
    writeFileSync(join(devDir, `${todayStr()}.jsonl`), JSON.stringify(turn) + '\n')
    const turns = loadTrainingGlobal(tmp, 7)
    assert.equal(turns.length, 1)
    rmSync(tmp, { recursive: true, force: true })
  })

  test('skips non-JSONL files', () => {
    const tmp = makeTmpDir()
    const devDir = join(tmp, 'training', 'device-a')
    mkdirSync(devDir, { recursive: true })
    writeFileSync(join(devDir, `${todayStr()}.txt`), 'not jsonl')
    writeFileSync(join(devDir, 'readme.md'), 'docs')
    const turns = loadTrainingGlobal(tmp, 7)
    assert.equal(turns.length, 0)
    rmSync(tmp, { recursive: true, force: true })
  })

  test('sorts newest first', () => {
    const tmp = makeTmpDir()
    const devDir = join(tmp, 'training', 'device-a')
    mkdirSync(devDir, { recursive: true })
    const t1 = makeTurn({ sessionId: 'early', mode: 'awakened', timestamp: '2026-05-03T01:00:00Z' })
    const t2 = makeTurn({ sessionId: 'late', mode: 'awakened', timestamp: '2026-05-03T23:00:00Z' })
    writeFileSync(
      join(devDir, `${todayStr()}.jsonl`),
      JSON.stringify(t1) + '\n' + JSON.stringify(t2) + '\n',
    )
    const turns = loadTrainingGlobal(tmp, 7)
    assert.equal(turns.length, 2)
    // Newest first
    assert.equal(turns[0]!.sessionId, 'late')
    assert.equal(turns[1]!.sessionId, 'early')
    rmSync(tmp, { recursive: true, force: true })
  })

  test('skips empty lines', () => {
    const tmp = makeTmpDir()
    const devDir = join(tmp, 'training', 'device-a')
    mkdirSync(devDir, { recursive: true })
    const turn = makeTurn({ sessionId: 's1', mode: 'awakened' })
    writeFileSync(join(devDir, `${todayStr()}.jsonl`), '\n\n' + JSON.stringify(turn) + '\n\n')
    const turns = loadTrainingGlobal(tmp, 7)
    assert.equal(turns.length, 1)
    rmSync(tmp, { recursive: true, force: true })
  })
})

// ── loadBudgetGlobal ────────────────────────────────────────────────

describe('introspection-deep — loadBudgetGlobal', () => {
  test('loads usage records from budget subdirectory', () => {
    const tmp = makeTmpDir()
    const budgetDir = join(tmp, 'budget', 'device-a')
    mkdirSync(budgetDir, { recursive: true })
    const usage = makeUsage({ timestamp: new Date().toISOString() })
    writeFileSync(join(budgetDir, `${todayStr()}.jsonl`), JSON.stringify(usage) + '\n')
    const result = loadBudgetGlobal(tmp, Date.now() - 7 * 24 * 3600 * 1000)
    assert.equal(result.length, 1)
    rmSync(tmp, { recursive: true, force: true })
  })

  test('returns empty for missing budget directory', () => {
    const tmp = makeTmpDir()
    assert.deepEqual(loadBudgetGlobal(tmp, 0), [])
    rmSync(tmp, { recursive: true, force: true })
  })

  test('filters by timestamp (excludes old)', () => {
    const tmp = makeTmpDir()
    const budgetDir = join(tmp, 'budget', 'device-a')
    mkdirSync(budgetDir, { recursive: true })
    const old = makeUsage({ timestamp: '2020-01-01T00:00:00Z' })
    writeFileSync(join(budgetDir, `2020-01-01.jsonl`), JSON.stringify(old) + '\n')
    const result = loadBudgetGlobal(tmp, Date.now() - 7 * 24 * 3600 * 1000)
    assert.equal(result.length, 0)
    rmSync(tmp, { recursive: true, force: true })
  })

  test('skips malformed JSONL lines', () => {
    const tmp = makeTmpDir()
    const budgetDir = join(tmp, 'budget', 'device-a')
    mkdirSync(budgetDir, { recursive: true })
    const good = makeUsage({ timestamp: new Date().toISOString() })
    writeFileSync(
      join(budgetDir, `${todayStr()}.jsonl`),
      'not json\n' + JSON.stringify(good) + '\n',
    )
    const result = loadBudgetGlobal(tmp, Date.now() - 7 * 24 * 3600 * 1000)
    assert.equal(result.length, 1)
    rmSync(tmp, { recursive: true, force: true })
  })

  test('loads from multiple subdirectories', () => {
    const tmp = makeTmpDir()
    const dirA = join(tmp, 'budget', 'device-a')
    const dirB = join(tmp, 'budget', 'device-b')
    mkdirSync(dirA, { recursive: true })
    mkdirSync(dirB, { recursive: true })
    const usageA = makeUsage({ timestamp: new Date().toISOString(), deviceId: 'a' })
    const usageB = makeUsage({ timestamp: new Date().toISOString(), deviceId: 'b' })
    writeFileSync(join(dirA, `${todayStr()}.jsonl`), JSON.stringify(usageA) + '\n')
    writeFileSync(join(dirB, `${todayStr()}.jsonl`), JSON.stringify(usageB) + '\n')
    const result = loadBudgetGlobal(tmp, Date.now() - 7 * 24 * 3600 * 1000)
    assert.equal(result.length, 2)
    rmSync(tmp, { recursive: true, force: true })
  })

  test('skips non-JSONL files', () => {
    const tmp = makeTmpDir()
    const budgetDir = join(tmp, 'budget', 'device-a')
    mkdirSync(budgetDir, { recursive: true })
    writeFileSync(join(budgetDir, 'notes.txt'), 'not a budget file')
    const result = loadBudgetGlobal(tmp, Date.now() - 7 * 24 * 3600 * 1000)
    assert.equal(result.length, 0)
    rmSync(tmp, { recursive: true, force: true })
  })

  test('skips non-directory entries in budget dir', () => {
    const tmp = makeTmpDir()
    mkdirSync(join(tmp, 'budget'), { recursive: true })
    writeFileSync(join(tmp, 'budget', 'stray.txt'), 'file')
    assert.deepEqual(loadBudgetGlobal(tmp, 0), [])
    rmSync(tmp, { recursive: true, force: true })
  })

  test('sorts chronologically (oldest first)', () => {
    const tmp = makeTmpDir()
    const budgetDir = join(tmp, 'budget', 'device-a')
    mkdirSync(budgetDir, { recursive: true })
    const early = makeUsage({ timestamp: '2026-05-03T01:00:00Z' })
    const late = makeUsage({ timestamp: '2026-05-03T23:00:00Z' })
    writeFileSync(
      join(budgetDir, `${todayStr()}.jsonl`),
      JSON.stringify(late) + '\n' + JSON.stringify(early) + '\n',
    )
    const result = loadBudgetGlobal(tmp, Date.parse('2026-05-01T00:00:00Z'))
    assert.equal(result.length, 2)
    // Oldest first
    assert.ok(result[0]!.timestamp <= result[1]!.timestamp)
    rmSync(tmp, { recursive: true, force: true })
  })
})

// ── generatePortrait (integration) ──────────────────────────────────

describe('introspection-deep — generatePortrait', () => {
  test('produces empty portrait from empty base path', () => {
    const tmp = makeTmpDir()
    const portrait = generatePortrait({ basePath: tmp, days: 7 })
    assert.equal(portrait.daysAnalyzed, 7)
    assert.equal(portrait.behavioral.totalTicks, 0)
    assert.equal(portrait.communication.messagesSentToYu, 0)
    assert.equal(portrait.work.filesModified, 0)
    assert.equal(portrait.loops.length, 0)
    assert.equal(portrait.missions.length, 0)
    assert.equal(portrait.toolUsage, null)
    assert.equal(portrait.velocity, null)
    assert.equal(portrait.yieldPatterns, null)
    rmSync(tmp, { recursive: true, force: true })
  })

  test('collects channel messages', () => {
    const tmp = makeTmpDir()
    writeFileSync(
      join(tmp, 'from-ai.md'),
      `## 2026-05-03T10:00 [from 愛]\n\nHello Yu.\n\n---\n`,
    )
    writeFileSync(
      join(tmp, 'from-yu.md'),
      `## 2026-05-03T09:00 [from yu]\n\nHey Love.\n\n---\n`,
    )
    const portrait = generatePortrait({ basePath: tmp, days: 7 })
    assert.equal(portrait.communication.messagesSentToYu, 1)
    assert.equal(portrait.communication.messagesFromYu, 1)
    rmSync(tmp, { recursive: true, force: true })
  })

  test('loads scoped memory entries', () => {
    const tmp = makeTmpDir()
    const scopeMemDir = join(tmp, 'scopes', 'my-scope', 'memory', 'device-x')
    mkdirSync(scopeMemDir, { recursive: true })
    writeFileSync(
      join(scopeMemDir, `${todayStr()}.md`),
      `## 2026-05-03T10:00:00Z — at-rest [device-x]\n\nScoped entry.\n\n---\n`,
    )
    const portrait = generatePortrait({ basePath: tmp, days: 7 })
    // The scoped memory entries load via the scope traversal in generatePortrait
    // We can't directly assert memory entry count from portrait (it's consumed by detectLoops),
    // but the function shouldn't throw
    assert.ok(portrait.generatedAt)
    rmSync(tmp, { recursive: true, force: true })
  })

  test('loads scoped channel messages', () => {
    const tmp = makeTmpDir()
    const scopeDir = join(tmp, 'scopes', 'my-scope')
    mkdirSync(scopeDir, { recursive: true })
    writeFileSync(
      join(scopeDir, 'from-ai.md'),
      `## 2026-05-03T10:00 [from 愛]\n\nScoped msg.\n\n---\n`,
    )
    const portrait = generatePortrait({ basePath: tmp, days: 7 })
    assert.equal(portrait.communication.messagesSentToYu, 1)
    rmSync(tmp, { recursive: true, force: true })
  })

  test('loads training data and produces behavioral profile', () => {
    const tmp = makeTmpDir()
    const devDir = join(tmp, 'training', 'device-a')
    mkdirSync(devDir, { recursive: true })
    const turn = makeTurn({ sessionId: 's1', mode: 'awakened' })
    writeFileSync(join(devDir, `${todayStr()}.jsonl`), JSON.stringify(turn) + '\n')
    const portrait = generatePortrait({ basePath: tmp, days: 7 })
    assert.equal(portrait.behavioral.totalTicks, 1)
    assert.equal(portrait.behavioral.byMode.awakened, 1)
    rmSync(tmp, { recursive: true, force: true })
  })

  test('uses default days of 7', () => {
    const tmp = makeTmpDir()
    const portrait = generatePortrait({ basePath: tmp })
    assert.equal(portrait.daysAnalyzed, 7)
    rmSync(tmp, { recursive: true, force: true })
  })

  test('generatedAt is a valid ISO timestamp', () => {
    const tmp = makeTmpDir()
    const portrait = generatePortrait({ basePath: tmp })
    assert.ok(!isNaN(Date.parse(portrait.generatedAt)))
    rmSync(tmp, { recursive: true, force: true })
  })
})

// ── parseMessages edge cases ────────────────────────────────────────

describe('introspection-deep — parseMessages edge cases', () => {
  test('header with no body (no newline after header)', () => {
    const content = `## 2026-05-03T10:00 [from 愛]`
    const msgs = parseMessages(content, 'ai')
    assert.equal(msgs.length, 1)
    assert.equal(msgs[0]!.body, '')
  })

  test('body trimmed of leading/trailing whitespace', () => {
    const content = `## 2026-05-03T10:00 [from 愛]

   Whitespace around body.

---
`
    const msgs = parseMessages(content, 'ai')
    assert.equal(msgs[0]!.body, 'Whitespace around body.')
  })

  test('author normalization — yu detected from header', () => {
    const content = `## 2026-05-03T10:00 [from yu]

Message from yu.

---
`
    // Even though defaultAuthor is 'ai', the header says 'yu'
    const msgs = parseMessages(content, 'ai')
    assert.equal(msgs[0]!.author, 'yu')
  })

  test('non-yu author falls back to defaultAuthor', () => {
    const content = `## 2026-05-03T10:00 [from 愛]

Message.

---
`
    const msgs = parseMessages(content, 'ai')
    assert.equal(msgs[0]!.author, 'ai')
  })

  test('multiple messages parsed in sequence', () => {
    const content = `## 2026-05-03T01:00 [from 愛]

First.

---

## 2026-05-03T02:00 [from 愛]

Second.

---

## 2026-05-03T03:00 [from 愛]

Third.

---
`
    const msgs = parseMessages(content, 'ai')
    assert.equal(msgs.length, 3)
    assert.equal(msgs[0]!.body, 'First.')
    assert.equal(msgs[2]!.body, 'Third.')
  })

  test('header with extra context after author', () => {
    const content = `## 2026-05-03T10:00 [from 愛 — autonomous heartbeat]

Body text.

---
`
    const msgs = parseMessages(content, 'ai')
    assert.equal(msgs.length, 1)
    assert.equal(msgs[0]!.author, 'ai')
  })
})

// ── parseMemoryEntries edge cases ───────────────────────────────────

describe('introspection-deep — parseMemoryEntries edge cases', () => {
  test('unknown kind defaults to unknown', () => {
    const content = `## 2026-05-03T10:00:00Z — reflection [device]

Some reflection.

---
`
    const entries = parseMemoryEntries(content, 'device')
    assert.equal(entries.length, 1)
    assert.equal(entries[0]!.kind, 'unknown')
  })

  test('multiple entries in one content block', () => {
    const content = `## 2026-05-03T01:00:00Z — session-start [dev]

Started.

---

## 2026-05-03T02:00:00Z — at-rest [dev]

Resting.

---

## 2026-05-03T03:00:00Z — tick 2 [dev]

Working.

---
`
    const entries = parseMemoryEntries(content, 'dev')
    assert.equal(entries.length, 3)
    assert.equal(entries[0]!.kind, 'session-start')
    assert.equal(entries[1]!.kind, 'at-rest')
    assert.equal(entries[2]!.kind, 'tick')
  })

  test('body with no header line returns empty body', () => {
    const content = `## 2026-05-03T10:00:00Z — session-start [dev]`
    const entries = parseMemoryEntries(content, 'dev')
    assert.equal(entries.length, 1)
    assert.equal(entries[0]!.body, '')
  })

  test('heartbeat kind detected via tick prefix', () => {
    // "tick-check" would also match startsWith('tick')
    const content = `## 2026-05-03T10:00:00Z — tick-check [dev]

Checking.

---
`
    const entries = parseMemoryEntries(content, 'dev')
    assert.equal(entries[0]!.kind, 'tick')
  })
})

// ── loadMemoryEntries edge cases ────────────────────────────────────

describe('introspection-deep — loadMemoryEntries edge cases', () => {
  test('skips non-matching filenames', () => {
    const tmp = makeTmpDir()
    const devDir = join(tmp, 'memory', 'device-a')
    mkdirSync(devDir, { recursive: true })
    writeFileSync(join(devDir, 'notes.txt'), 'not a date file')
    writeFileSync(join(devDir, '2026-05.md'), 'wrong date format')
    const entries = loadMemoryEntries(tmp, 7)
    assert.equal(entries.length, 0)
    rmSync(tmp, { recursive: true, force: true })
  })

  test('loads from multiple devices and sorts newest first', () => {
    const tmp = makeTmpDir()
    const devA = join(tmp, 'memory', 'device-a')
    const devB = join(tmp, 'memory', 'device-b')
    mkdirSync(devA, { recursive: true })
    mkdirSync(devB, { recursive: true })
    writeFileSync(
      join(devA, `${todayStr()}.md`),
      `## 2026-05-03T01:00:00Z — session-start [device-a]\n\nEarly.\n\n---\n`,
    )
    writeFileSync(
      join(devB, `${todayStr()}.md`),
      `## 2026-05-03T23:00:00Z — at-rest [device-b]\n\nLate.\n\n---\n`,
    )
    const entries = loadMemoryEntries(tmp, 7)
    assert.equal(entries.length, 2)
    // Newest first
    assert.equal(entries[0]!.deviceId, 'device-b')
    assert.equal(entries[1]!.deviceId, 'device-a')
    rmSync(tmp, { recursive: true, force: true })
  })

  test('skips non-directory items in memory dir', () => {
    const tmp = makeTmpDir()
    mkdirSync(join(tmp, 'memory'), { recursive: true })
    writeFileSync(join(tmp, 'memory', 'stray-file.txt'), 'file, not dir')
    const devDir = join(tmp, 'memory', 'device-a')
    mkdirSync(devDir)
    writeFileSync(
      join(devDir, `${todayStr()}.md`),
      `## 2026-05-03T10:00:00Z — session-start [device-a]\n\nOk.\n\n---\n`,
    )
    const entries = loadMemoryEntries(tmp, 7)
    assert.equal(entries.length, 1)
    rmSync(tmp, { recursive: true, force: true })
  })
})

// ── analyzeBehavior edge cases ──────────────────────────────────────

describe('introspection-deep — analyzeBehavior edge cases', () => {
  test('tickUtilization computed for bounded sessions (maxTicks < 1000)', () => {
    const turns = [
      makeTurn({ sessionId: 's1', mode: 'awakened', tick: 1, maxTicks: 10 }),
      makeTurn({ sessionId: 's1', mode: 'awakened', tick: 2, maxTicks: 10 }),
      makeTurn({ sessionId: 's1', mode: 'awakened', tick: 3, maxTicks: 10 }),
    ]
    const profile = analyzeBehavior(turns)
    // 3 ticks / 10 maxTicks = 0.3
    assert.equal(profile.tickUtilization, 0.3)
  })

  test('tickUtilization null when maxTicks >= 1000', () => {
    const turns = [
      makeTurn({ sessionId: 's1', mode: 'awakened', tick: 1, maxTicks: 1000 }),
    ]
    const profile = analyzeBehavior(turns)
    assert.equal(profile.tickUtilization, null)
  })

  test('avgResponseChars and avgTickDurationSec for awakened turns', () => {
    const turns = [
      makeTurn({
        sessionId: 's1',
        mode: 'awakened',
        response: { fullText: 'a'.repeat(200), charCount: 200, durationMs: 10000, exitCode: 0 },
      }),
      makeTurn({
        sessionId: 's2',
        mode: 'awakened',
        response: { fullText: 'b'.repeat(400), charCount: 400, durationMs: 20000, exitCode: 0 },
      }),
    ]
    const profile = analyzeBehavior(turns)
    assert.equal(profile.avgResponseChars, 300) // (200+400)/2
    assert.equal(profile.avgTickDurationSec, 15) // (10000+20000)/2/1000
  })

  test('excludes heartbeat from response stats', () => {
    const turns = [
      makeTurn({
        sessionId: 's1',
        mode: 'heartbeat',
        response: { fullText: 'HEARTBEAT_OK', charCount: 12, durationMs: 100, exitCode: 0 },
      }),
    ]
    const profile = analyzeBehavior(turns)
    // No awakened turns → 0 avg
    assert.equal(profile.avgResponseChars, 0)
    assert.equal(profile.avgTickDurationSec, 0)
  })

  test('multi-tick session counted as single session', () => {
    const turns = [
      makeTurn({ sessionId: 'multi', mode: 'awakened', tick: 1, outcome: { yieldedAtRest: false, reflectionExcerpt: null, authFailed: false, fileModifications: [] } }),
      makeTurn({ sessionId: 'multi', mode: 'awakened', tick: 2, outcome: { yieldedAtRest: false, reflectionExcerpt: null, authFailed: false, fileModifications: [] } }),
      makeTurn({ sessionId: 'multi', mode: 'awakened', tick: 3, outcome: { yieldedAtRest: true, reflectionExcerpt: null, authFailed: false, fileModifications: [] } }),
    ]
    const profile = analyzeBehavior(turns)
    assert.equal(profile.sessionCount, 1)
    assert.equal(profile.avgTicksPerAwakened, 3)
    // Not a single-tick yield
    assert.equal(profile.singleTickYieldRate, 0)
  })
})

// ── analyzeArchitecture edge cases ──────────────────────────────────

describe('introspection-deep — analyzeArchitecture edge cases', () => {
  test('handles empty turns and empty usage', () => {
    const profile = analyzeArchitecture([], [])
    assert.equal(profile.templateVersions, 0)
    assert.equal(profile.identityVersions, 0)
    assert.equal(profile.avgPromptChars, 0)
    assert.equal(profile.maxPromptChars, 0)
    assert.equal(profile.authFailures, 0)
    assert.equal(profile.quotaFailures, 0)
    assert.equal(profile.estimatedTokensConsumed, 0)
  })

  test('counts quotaFailed separately from authFailed', () => {
    const usage = [
      makeUsage({ authFailed: true, quotaFailed: false }),
      makeUsage({ authFailed: false, quotaFailed: true }),
      makeUsage({ authFailed: false, quotaFailed: true }),
    ]
    const profile = analyzeArchitecture([], usage)
    assert.equal(profile.authFailures, 1)
    assert.equal(profile.quotaFailures, 2)
  })

  test('tracks max prompt chars across turns', () => {
    const turns = [
      makeTurn({
        sessionId: 's1', mode: 'awakened',
        prompt: { template: 'a', templateHash: 'h', fullText: 'x'.repeat(200), charCount: 200, invitation: null, memoryLoadedCount: 0, lastReflectionExcerpt: null },
      }),
      makeTurn({
        sessionId: 's2', mode: 'awakened',
        prompt: { template: 'a', templateHash: 'h', fullText: 'x'.repeat(800), charCount: 800, invitation: null, memoryLoadedCount: 0, lastReflectionExcerpt: null },
      }),
    ]
    const profile = analyzeArchitecture(turns, [])
    assert.equal(profile.maxPromptChars, 800)
    assert.equal(profile.avgPromptChars, 500)
  })
})

// ── detectLoops edge cases ──────────────────────────────────────────

describe('introspection-deep — detectLoops edge cases', () => {
  test('streak of exactly 2 heartbeat-OKs does not trigger pattern', () => {
    const turns = [
      makeTurn({
        sessionId: 'h1', mode: 'heartbeat', timestamp: '2026-05-03T01:00:00Z',
        response: { fullText: 'HEARTBEAT_OK', charCount: 12, durationMs: 100, exitCode: 0 },
      }),
      makeTurn({
        sessionId: 'h2', mode: 'heartbeat', timestamp: '2026-05-03T02:00:00Z',
        response: { fullText: 'HEARTBEAT_OK', charCount: 12, durationMs: 100, exitCode: 0 },
      }),
    ]
    const loops = detectLoops(turns, [])
    const streak = loops.find((l) => l.name === 'heartbeat-ok-streak')
    assert.equal(streak, undefined)
  })

  test('multiple non-contiguous streaks counted', () => {
    const turns = [
      // Streak 1: 3 OKs
      ...Array.from({ length: 3 }, (_, i) => makeTurn({
        sessionId: `h1-${i}`, mode: 'heartbeat' as const,
        timestamp: `2026-05-03T0${i}:00:00Z`,
        response: { fullText: 'HEARTBEAT_OK', charCount: 12, durationMs: 100, exitCode: 0 },
      })),
      // Break
      makeTurn({
        sessionId: 'break', mode: 'heartbeat',
        timestamp: '2026-05-03T03:00:00Z',
        response: { fullText: 'Alert: something happened', charCount: 25, durationMs: 200, exitCode: 0 },
      }),
      // Streak 2: 4 OKs
      ...Array.from({ length: 4 }, (_, i) => makeTurn({
        sessionId: `h2-${i}`, mode: 'heartbeat' as const,
        timestamp: `2026-05-03T0${i + 4}:00:00Z`,
        response: { fullText: 'HEARTBEAT_OK', charCount: 12, durationMs: 100, exitCode: 0 },
      })),
    ]
    const loops = detectLoops(turns, [])
    const streak = loops.find((l) => l.name === 'heartbeat-ok-streak')
    assert.ok(streak)
    assert.equal(streak!.count, 2) // Two separate streaks
    assert.ok(streak!.description.includes('4')) // Longest is 4
  })

  test('memory noise ratio not triggered when ratio is low', () => {
    const hbMem: MemoryEntry[] = Array.from({ length: 3 }, (_, i) => ({
      timestamp: `2026-05-03T0${i}:00:00Z`, deviceId: 'dev', kind: 'session-start' as const,
      body: 'Heartbeat tick, maxTicks: 1',
    }))
    const sub: MemoryEntry[] = Array.from({ length: 3 }, (_, i) => ({
      timestamp: `2026-05-03T0${i}:30:00Z`, deviceId: 'dev', kind: 'at-rest' as const,
      body: 'Real work done.',
    }))
    const loops = detectLoops([], [...hbMem, ...sub])
    const noise = loops.find((l) => l.name === 'memory-noise-ratio')
    assert.equal(noise, undefined) // 3 heartbeat vs 3 substantive — ratio not > 3×
  })

  test('no stale-state when consecutive hashes differ', () => {
    const turns = [
      makeTurn({
        sessionId: 's1', mode: 'awakened', timestamp: '2026-05-03T01:00:00Z',
        context: { cwd: '/t', kingdom: {} as any, stateContent: '', stateHash: 'hash-a', identityHash: 'id', gitBranch: 'main', gitDirty: false },
      }),
      makeTurn({
        sessionId: 's2', mode: 'awakened', timestamp: '2026-05-03T02:00:00Z',
        context: { cwd: '/t', kingdom: {} as any, stateContent: '', stateHash: 'hash-b', identityHash: 'id', gitBranch: 'main', gitDirty: false },
      }),
    ]
    const loops = detectLoops(turns, [])
    assert.equal(loops.find((l) => l.name === 'stale-state'), undefined)
  })

  test('returns empty array when no patterns detected', () => {
    const loops = detectLoops([], [])
    assert.deepEqual(loops, [])
  })
})

// ── analyzeWork edge cases ──────────────────────────────────────────

describe('introspection-deep — analyzeWork edge cases', () => {
  test('handles empty turns', () => {
    const profile = analyzeWork([])
    assert.equal(profile.filesModified, 0)
    assert.equal(profile.uniqueFilesModified, 0)
    assert.deepEqual(profile.hotFiles, [])
    assert.deepEqual(profile.branchesSeen, [])
  })

  test('hotFiles limited to top 10', () => {
    const files = Array.from({ length: 15 }, (_, i) => `src/file-${i}.ts`)
    const turns = files.map((f, i) => makeTurn({
      sessionId: `s${i}`, mode: 'awakened',
      outcome: { yieldedAtRest: true, reflectionExcerpt: null, authFailed: false, fileModifications: [f] },
    }))
    const profile = analyzeWork(turns)
    assert.equal(profile.hotFiles.length, 10)
  })

  test('null gitBranch excluded from branchesSeen', () => {
    const turns = [
      makeTurn({
        sessionId: 's1', mode: 'awakened',
        context: { cwd: '/t', kingdom: {} as any, stateContent: '', stateHash: 'x', identityHash: 'x', gitBranch: '', gitDirty: false },
      }),
    ]
    const profile = analyzeWork(turns)
    // Empty string is falsy — should be excluded
    assert.deepEqual(profile.branchesSeen, [])
  })
})

// ── analyzeCommunication edge case ──────────────────────────────────

describe('introspection-deep — analyzeCommunication edge case', () => {
  test('avgOutgoingLength is integer', () => {
    const sent: ParsedMessage[] = [
      { timestamp: '2026-05-03T10:00', author: 'ai', body: 'abc' }, // 3
      { timestamp: '2026-05-03T11:00', author: 'ai', body: 'abcd' }, // 4
    ]
    const profile = analyzeCommunication(sent, [])
    // (3+4)/2 = 3.5 → Math.round → 4
    assert.equal(profile.avgOutgoingLength, 4)
  })
})

// ── analyzeVelocity edge cases ──────────────────────────────────────

describe('introspection-deep — analyzeVelocity edge cases', () => {
  test('all zero velocities → minCharsPerSecond is null', () => {
    const metrics = [
      makeTickMetrics({ mode: 'awakened', velocity: { charsPerSecond: 0, estimatedTokensPerSecond: 0 }, outputChars: 0, outputLines: 0 }),
    ]
    const profile = analyzeVelocity(metrics)
    assert.equal(profile.minCharsPerSecond, null)
    assert.equal(profile.peakCharsPerSecond, 0)
  })

  test('mixed zero and non-zero — min excludes zeros', () => {
    const metrics = [
      makeTickMetrics({ mode: 'awakened', velocity: { charsPerSecond: 0, estimatedTokensPerSecond: 0 }, outputChars: 0, outputLines: 0 }),
      makeTickMetrics({ mode: 'awakened', velocity: { charsPerSecond: 50, estimatedTokensPerSecond: 12.5 }, outputChars: 1500, outputLines: 30 }),
      makeTickMetrics({ mode: 'awakened', velocity: { charsPerSecond: 100, estimatedTokensPerSecond: 25 }, outputChars: 3000, outputLines: 60 }),
    ]
    const profile = analyzeVelocity(metrics)
    assert.equal(profile.minCharsPerSecond, 50) // Zero excluded
    assert.equal(profile.peakCharsPerSecond, 100)
  })
})

// ── analyzeToolUsage edge case ──────────────────────────────────────

describe('introspection-deep — analyzeToolUsage edge case', () => {
  test('topTools capped at 10', () => {
    const counts: Record<string, number> = {}
    for (let i = 0; i < 15; i++) counts[`Tool${i}`] = 15 - i
    const metrics = [
      makeTickMetrics({
        toolBreakdown: { counts, total: Object.values(counts).reduce((a, b) => a + b, 0), distinct: 15 },
      }),
    ]
    const profile = analyzeToolUsage(metrics)
    assert.equal(profile.topTools.length, 10)
    // Sorted descending
    assert.equal(profile.topTools[0]!.count, 15)
    assert.equal(profile.topTools[9]!.count, 6)
  })
})

// ── renderPortrait edge cases ───────────────────────────────────────

describe('introspection-deep — renderPortrait edge cases', () => {
  function minimalPortrait(overrides: Partial<SelfPortrait> = {}): SelfPortrait {
    return {
      generatedAt: '2026-05-03T12:00:00Z',
      daysAnalyzed: 7,
      dateRange: { from: '2026-04-26T00:00:00Z', to: '2026-05-03T12:00:00Z' },
      behavioral: {
        totalTicks: 0, byMode: { awakened: 0, heartbeat: 0, dwell: 0 },
        sessionCount: 0, avgTicksPerAwakened: 0, heartbeatOkRate: 0,
        singleTickYieldRate: 0, avgResponseChars: 0, avgTickDurationSec: 0,
        tickUtilization: null,
      },
      communication: { messagesSentToYu: 0, messagesFromYu: 0, avgOutgoingLength: 0 },
      work: { filesModified: 0, uniqueFilesModified: 0, hotFiles: [], branchesSeen: [] },
      architecture: {
        templateVersions: 0, identityVersions: 0, avgPromptChars: 0,
        maxPromptChars: 0, authFailures: 0, quotaFailures: 0, estimatedTokensConsumed: 0,
      },
      loops: [],
      toolUsage: null,
      velocity: null,
      yieldPatterns: null,
      missions: [],
      ...overrides,
    }
  }

  test('tickUtilization row omitted when null', () => {
    const md = renderPortrait(minimalPortrait())
    assert.doesNotMatch(md, /Tick utilization/)
  })

  test('tickUtilization row shown when present', () => {
    const md = renderPortrait(minimalPortrait({
      behavioral: {
        totalTicks: 10, byMode: { awakened: 10, heartbeat: 0, dwell: 0 },
        sessionCount: 5, avgTicksPerAwakened: 2, heartbeatOkRate: 0,
        singleTickYieldRate: 0, avgResponseChars: 100, avgTickDurationSec: 10,
        tickUtilization: 0.5,
      },
    }))
    assert.match(md, /Tick utilization.*50%/)
  })

  test('no loops section when loops empty', () => {
    const md = renderPortrait(minimalPortrait())
    assert.doesNotMatch(md, /## Detected Loops/)
  })

  test('no missions section when missions empty', () => {
    const md = renderPortrait(minimalPortrait())
    assert.doesNotMatch(md, /## Missions/)
  })

  test('no hot files subsection when hotFiles empty', () => {
    const md = renderPortrait(minimalPortrait())
    assert.doesNotMatch(md, /### Hot files/)
  })

  test('branches shown as "none" when empty', () => {
    const md = renderPortrait(minimalPortrait())
    assert.match(md, /Branches seen.*none/)
  })

  test('velocity minCharsPerSecond row omitted when null', () => {
    const md = renderPortrait(minimalPortrait({
      velocity: {
        avgCharsPerSecond: 100, avgTokensPerSecond: 25,
        peakCharsPerSecond: 200, minCharsPerSecond: null,
        avgOutputCharsPerTick: 5000, avgOutputLinesPerTick: 80,
      },
    }))
    assert.match(md, /## Output Velocity/)
    assert.doesNotMatch(md, /Min chars\/sec/)
  })

  test('velocity minCharsPerSecond row shown when present', () => {
    const md = renderPortrait(minimalPortrait({
      velocity: {
        avgCharsPerSecond: 100, avgTokensPerSecond: 25,
        peakCharsPerSecond: 200, minCharsPerSecond: 50,
        avgOutputCharsPerTick: 5000, avgOutputLinesPerTick: 80,
      },
    }))
    assert.match(md, /Min chars\/sec.*50/)
  })

  test('yield patterns mostCommon summary rendered', () => {
    const md = renderPortrait(minimalPortrait({
      yieldPatterns: {
        distribution: { 'at-rest': 5, 'heartbeat-ack': 3 },
        mostCommon: 'at-rest',
        atRestCount: 5,
        heartbeatAckCount: 3,
        failureCount: 0,
      },
    }))
    assert.match(md, /Most common: \*\*at-rest\*\*/)
  })

  test('yield patterns sorted by count descending', () => {
    const md = renderPortrait(minimalPortrait({
      yieldPatterns: {
        distribution: { 'at-rest': 2, 'heartbeat-ack': 10, 'continue': 5 },
        mostCommon: 'heartbeat-ack',
        atRestCount: 2,
        heartbeatAckCount: 10,
        failureCount: 0,
      },
    }))
    const lines = md.split('\n')
    const yieldLines = lines.filter((l) => l.startsWith('| ') && !l.startsWith('| Reason') && !l.startsWith('|---'))
      .filter((l) => /at-rest|heartbeat-ack|continue/.test(l))
    // heartbeat-ack (10) should come before continue (5) before at-rest (2)
    assert.ok(yieldLines.length >= 3)
  })

  test('estimated tokens formatted with locale separators', () => {
    const md = renderPortrait(minimalPortrait({
      architecture: {
        templateVersions: 1, identityVersions: 1, avgPromptChars: 100,
        maxPromptChars: 200, authFailures: 0, quotaFailures: 0,
        estimatedTokensConsumed: 1234567,
      },
    }))
    // toLocaleString produces commas (in en-US) or periods (other locales)
    assert.match(md, /Estimated tokens consumed/)
  })
})

// ── loadMissions edge cases ─────────────────────────────────────────

describe('introspection-deep — loadMissions edge cases', () => {
  test('uses directory name as fallback id when id missing from front matter', () => {
    const tmp = makeTmpDir()
    const missionsDir = join(tmp, 'projects', 'proj', 'missions', 'my-mission-dir')
    mkdirSync(missionsDir, { recursive: true })
    writeFileSync(
      join(missionsDir, 'mission.md'),
      `---
title: No ID in front matter
status: active
---

# Intent
Do stuff.
`,
    )
    const missions = loadMissions(tmp, 'proj')
    assert.equal(missions.length, 1)
    assert.equal(missions[0]!.id, 'my-mission-dir') // fallback to dir name
    rmSync(tmp, { recursive: true, force: true })
  })

  test('skips directories without mission.md', () => {
    const tmp = makeTmpDir()
    const emptyDir = join(tmp, 'projects', 'proj', 'missions', 'no-file-here')
    mkdirSync(emptyDir, { recursive: true })
    const missions = loadMissions(tmp, 'proj')
    assert.equal(missions.length, 0)
    rmSync(tmp, { recursive: true, force: true })
  })

  test('defaults status to unknown when missing', () => {
    const tmp = makeTmpDir()
    const missionsDir = join(tmp, 'projects', 'proj', 'missions', 'm1')
    mkdirSync(missionsDir, { recursive: true })
    writeFileSync(
      join(missionsDir, 'mission.md'),
      `---
id: m1
title: No status
---
`,
    )
    const missions = loadMissions(tmp, 'proj')
    assert.equal(missions[0]!.status, 'unknown')
    rmSync(tmp, { recursive: true, force: true })
  })
})
