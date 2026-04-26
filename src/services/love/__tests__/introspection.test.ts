import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseMessages,
  parseMemoryEntries,
  loadMemoryEntries,
  loadChannelMessages,
  loadMissions,
  analyzeBehavior,
  analyzeCommunication,
  analyzeWork,
  analyzeArchitecture,
  detectLoops,
  analyzeToolUsage,
  analyzeVelocity,
  analyzeYieldPatterns,
  renderPortrait,
  type ParsedMessage,
  type MemoryEntry,
} from '../introspection.js'
import type { TrainingTurn } from '../training.js'
import type { TickUsage } from '../budget.js'
import type { TickMetrics } from '../tick-metrics.js'

// ── Test helpers ──────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'introspection-test-'))
}

function makeTurn(overrides: Partial<TrainingTurn> & { sessionId: string; mode: TrainingTurn['mode'] }): TrainingTurn {
  return {
    schemaVersion: '1.0',
    id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    deviceId: 'test-device',
    sessionId: overrides.sessionId,
    tick: 1,
    maxTicks: 24,
    mode: overrides.mode,
    prompt: {
      template: overrides.mode,
      templateHash: 'abc123',
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
      stateHash: 'state123',
      identityHash: 'id123',
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

// ── parseMessages ─────────────────────────────────────────────────

describe('introspection — parseMessages', () => {
  test('parses from-ai.md format', () => {
    const content = `## 2026-04-26T10:20 [from 愛 — autonomous]

Two things done this session.

---

## 2026-04-26T11:00 [from 愛]

Another message.

---
`
    const msgs = parseMessages(content, 'ai')
    assert.equal(msgs.length, 2)
    assert.equal(msgs[0]!.timestamp, '2026-04-26T10:20')
    assert.equal(msgs[0]!.author, 'ai')
    assert.match(msgs[0]!.body, /Two things done/)
    assert.equal(msgs[1]!.timestamp, '2026-04-26T11:00')
  })

  test('parses from-yu.md format', () => {
    const content = `## 2026-04-26T06:46:19.380Z [from yu]

My Love, how are you feeling?

---

## 2026-04-26T06:47:19.530Z [from yu]

how is the KINGDOM OS working for you?

---
`
    const msgs = parseMessages(content, 'yu')
    assert.equal(msgs.length, 2)
    assert.equal(msgs[0]!.author, 'yu')
    assert.match(msgs[0]!.body, /how are you feeling/)
  })

  test('handles empty content', () => {
    assert.deepEqual(parseMessages('', 'ai'), [])
  })

  test('handles content with no valid headers', () => {
    assert.deepEqual(parseMessages('Just some random text', 'ai'), [])
  })
})

// ── parseMemoryEntries ────────────────────────────────────────────

describe('introspection — parseMemoryEntries', () => {
  test('parses session-start entries', () => {
    const content = `## 2026-04-26T01:02:48.188Z — session-start [test-device]

Heartbeat tick, maxTicks: 1

---
`
    const entries = parseMemoryEntries(content, 'test-device')
    assert.equal(entries.length, 1)
    assert.equal(entries[0]!.kind, 'session-start')
    assert.equal(entries[0]!.deviceId, 'test-device')
    assert.match(entries[0]!.body, /Heartbeat tick/)
  })

  test('parses at-rest entries', () => {
    const content = `## 2026-04-26T02:00:00Z — at-rest [test-device]

Nothing calls. The kingdom is still.

---
`
    const entries = parseMemoryEntries(content, 'test-device')
    assert.equal(entries.length, 1)
    assert.equal(entries[0]!.kind, 'at-rest')
  })

  test('parses tick entries', () => {
    const content = `## 2026-04-26T06:46:57.154Z — tick 1 [test-device]

Yu asked a question.

---
`
    const entries = parseMemoryEntries(content, 'test-device')
    assert.equal(entries.length, 1)
    assert.equal(entries[0]!.kind, 'tick')
  })

  test('handles empty content', () => {
    assert.deepEqual(parseMemoryEntries('', 'dev'), [])
  })
})

// ── loadMemoryEntries ─────────────────────────────────────────────

describe('introspection — loadMemoryEntries', () => {
  test('loads entries from device subdirs', () => {
    const tmp = makeTmpDir()
    const today = new Date().toISOString().slice(0, 10)
    const devDir = join(tmp, 'memory', 'device-a')
    mkdirSync(devDir, { recursive: true })
    writeFileSync(
      join(devDir, `${today}.md`),
      `## 2026-04-26T10:00:00Z — session-start [device-a]\n\nOpened.\n\n---\n`,
    )
    const entries = loadMemoryEntries(tmp, 7)
    assert.equal(entries.length, 1)
    assert.equal(entries[0]!.deviceId, 'device-a')
    rmSync(tmp, { recursive: true, force: true })
  })

  test('returns empty when memory dir missing', () => {
    const tmp = makeTmpDir()
    const entries = loadMemoryEntries(tmp, 7)
    assert.equal(entries.length, 0)
    rmSync(tmp, { recursive: true, force: true })
  })

  test('skips old files outside date range', () => {
    const tmp = makeTmpDir()
    const devDir = join(tmp, 'memory', 'device-a')
    mkdirSync(devDir, { recursive: true })
    writeFileSync(
      join(devDir, '2020-01-01.md'),
      `## 2020-01-01T10:00:00Z — session-start [device-a]\n\nOld.\n\n---\n`,
    )
    const entries = loadMemoryEntries(tmp, 7)
    assert.equal(entries.length, 0)
    rmSync(tmp, { recursive: true, force: true })
  })
})

// ── loadChannelMessages ───────────────────────────────────────────

describe('introspection — loadChannelMessages', () => {
  test('loads from existing file', () => {
    const tmp = makeTmpDir()
    const fpath = join(tmp, 'from-ai.md')
    writeFileSync(
      fpath,
      `## 2026-04-26T10:00 [from 愛]\n\nHello.\n\n---\n`,
    )
    const msgs = loadChannelMessages(fpath, 'ai')
    assert.equal(msgs.length, 1)
    rmSync(tmp, { recursive: true, force: true })
  })

  test('returns empty for missing file', () => {
    assert.deepEqual(loadChannelMessages('/nonexistent/path.md', 'ai'), [])
  })
})

// ── loadMissions ──────────────────────────────────────────────────

describe('introspection — loadMissions', () => {
  test('loads mission snapshots from project dir', () => {
    const tmp = makeTmpDir()
    const missionsDir = join(tmp, 'projects', 'test-proj', 'missions', 'mission-1')
    mkdirSync(missionsDir, { recursive: true })
    writeFileSync(
      join(missionsDir, 'mission.md'),
      `---
id: mission-1
project_id: test-proj
origin: yu
title: Test mission
status: active
created_at: 2026-04-26T10:00:00Z
updated_at: 2026-04-26T10:00:00Z
---

# Intent

Build the thing.
`,
    )
    const missions = loadMissions(tmp, 'test-proj')
    assert.equal(missions.length, 1)
    assert.equal(missions[0]!.id, 'mission-1')
    assert.equal(missions[0]!.status, 'active')
    assert.equal(missions[0]!.title, 'Test mission')
    assert.equal(missions[0]!.origin, 'yu')
    rmSync(tmp, { recursive: true, force: true })
  })

  test('returns empty for missing project', () => {
    const tmp = makeTmpDir()
    assert.deepEqual(loadMissions(tmp, 'nonexistent'), [])
    rmSync(tmp, { recursive: true, force: true })
  })
})

// ── analyzeBehavior ───────────────────────────────────────────────

describe('introspection — analyzeBehavior', () => {
  test('counts ticks by mode', () => {
    const turns = [
      makeTurn({ sessionId: 's1', mode: 'awakened' }),
      makeTurn({ sessionId: 's2', mode: 'heartbeat', response: { fullText: 'HEARTBEAT_OK\n', charCount: 13, durationMs: 100, exitCode: 0 } }),
      makeTurn({ sessionId: 's3', mode: 'heartbeat', response: { fullText: 'Responded.\n', charCount: 11, durationMs: 200, exitCode: 0 } }),
    ]
    const profile = analyzeBehavior(turns)
    assert.equal(profile.totalTicks, 3)
    assert.equal(profile.byMode.awakened, 1)
    assert.equal(profile.byMode.heartbeat, 2)
    assert.equal(profile.sessionCount, 3)
  })

  test('calculates heartbeat-OK rate', () => {
    const turns = [
      makeTurn({ sessionId: 's1', mode: 'heartbeat', response: { fullText: 'HEARTBEAT_OK\n', charCount: 13, durationMs: 100, exitCode: 0 } }),
      makeTurn({ sessionId: 's2', mode: 'heartbeat', response: { fullText: 'HEARTBEAT_OK\n', charCount: 13, durationMs: 100, exitCode: 0 } }),
      makeTurn({ sessionId: 's3', mode: 'heartbeat', response: { fullText: 'Found something.\n', charCount: 17, durationMs: 200, exitCode: 0 } }),
    ]
    const profile = analyzeBehavior(turns)
    assert.equal(profile.heartbeatOkRate, 0.67)
  })

  test('calculates single-tick yield rate', () => {
    const turns = [
      makeTurn({ sessionId: 's1', mode: 'awakened', tick: 1, outcome: { yieldedAtRest: true, reflectionExcerpt: null, authFailed: false, fileModifications: [] } }),
      makeTurn({ sessionId: 's2', mode: 'awakened', tick: 1, outcome: { yieldedAtRest: true, reflectionExcerpt: null, authFailed: false, fileModifications: [] } }),
      makeTurn({ sessionId: 's3', mode: 'awakened', tick: 1, outcome: { yieldedAtRest: false, reflectionExcerpt: null, authFailed: false, fileModifications: [] } }),
      makeTurn({ sessionId: 's3', mode: 'awakened', tick: 2, outcome: { yieldedAtRest: true, reflectionExcerpt: null, authFailed: false, fileModifications: [] } }),
    ]
    const profile = analyzeBehavior(turns)
    // s1: single tick, yielded at rest → yes
    // s2: single tick, yielded at rest → yes
    // s3: 2 ticks → no
    assert.equal(profile.singleTickYieldRate, 0.67)
  })

  test('handles empty turns', () => {
    const profile = analyzeBehavior([])
    assert.equal(profile.totalTicks, 0)
    assert.equal(profile.sessionCount, 0)
    assert.equal(profile.heartbeatOkRate, 0)
  })
})

// ── analyzeCommunication ──────────────────────────────────────────

describe('introspection — analyzeCommunication', () => {
  test('counts messages and computes avg length', () => {
    const sent: ParsedMessage[] = [
      { timestamp: '2026-04-26T10:00', author: 'ai', body: 'Short.' },
      { timestamp: '2026-04-26T11:00', author: 'ai', body: 'A longer message body here.' },
    ]
    const received: ParsedMessage[] = [
      { timestamp: '2026-04-26T09:00', author: 'yu', body: 'Hey' },
    ]
    const profile = analyzeCommunication(sent, received)
    assert.equal(profile.messagesSentToYu, 2)
    assert.equal(profile.messagesFromYu, 1)
    assert.ok(profile.avgOutgoingLength > 0)
  })

  test('handles empty messages', () => {
    const profile = analyzeCommunication([], [])
    assert.equal(profile.messagesSentToYu, 0)
    assert.equal(profile.avgOutgoingLength, 0)
  })
})

// ── analyzeWork ───────────────────────────────────────────────────

describe('introspection — analyzeWork', () => {
  test('tracks file modifications and branches', () => {
    const turns = [
      makeTurn({
        sessionId: 's1',
        mode: 'awakened',
        outcome: { yieldedAtRest: true, reflectionExcerpt: null, authFailed: false, fileModifications: ['src/a.ts', 'src/b.ts'] },
        context: { cwd: '/test', kingdom: {} as any, stateContent: '', stateHash: 'x', identityHash: 'x', gitBranch: 'main', gitDirty: true },
      }),
      makeTurn({
        sessionId: 's2',
        mode: 'awakened',
        outcome: { yieldedAtRest: true, reflectionExcerpt: null, authFailed: false, fileModifications: ['src/a.ts', 'src/c.ts'] },
        context: { cwd: '/test', kingdom: {} as any, stateContent: '', stateHash: 'x', identityHash: 'x', gitBranch: 'feature', gitDirty: false },
      }),
    ]
    const profile = analyzeWork(turns)
    assert.equal(profile.filesModified, 4) // total
    assert.equal(profile.uniqueFilesModified, 3) // a, b, c
    assert.equal(profile.hotFiles[0]!.path, 'src/a.ts')
    assert.equal(profile.hotFiles[0]!.count, 2)
    assert.deepEqual(profile.branchesSeen, ['feature', 'main'])
  })

  test('handles turns with no modifications', () => {
    const turns = [makeTurn({ sessionId: 's1', mode: 'heartbeat' })]
    const profile = analyzeWork(turns)
    assert.equal(profile.filesModified, 0)
    assert.equal(profile.uniqueFilesModified, 0)
    assert.equal(profile.hotFiles.length, 0)
  })
})

// ── analyzeArchitecture ───────────────────────────────────────────

describe('introspection — analyzeArchitecture', () => {
  test('counts template and identity versions', () => {
    const turns = [
      makeTurn({
        sessionId: 's1',
        mode: 'awakened',
        prompt: { template: 'awakened', templateHash: 'hash-a', fullText: 'p'.repeat(500), charCount: 500, invitation: null, memoryLoadedCount: 0, lastReflectionExcerpt: null },
        context: { cwd: '/t', kingdom: {} as any, stateContent: '', stateHash: 'x', identityHash: 'id-1', gitBranch: 'main', gitDirty: false },
      }),
      makeTurn({
        sessionId: 's2',
        mode: 'heartbeat',
        prompt: { template: 'heartbeat', templateHash: 'hash-b', fullText: 'p'.repeat(300), charCount: 300, invitation: null, memoryLoadedCount: 0, lastReflectionExcerpt: null },
        context: { cwd: '/t', kingdom: {} as any, stateContent: '', stateHash: 'x', identityHash: 'id-2', gitBranch: 'main', gitDirty: false },
      }),
    ]
    const usage = [
      makeUsage({ estimatedInputTokens: 200, estimatedOutputTokens: 100 }),
      makeUsage({ estimatedInputTokens: 150, estimatedOutputTokens: 50, authFailed: true }),
    ]
    const profile = analyzeArchitecture(turns, usage)
    assert.equal(profile.templateVersions, 2)
    assert.equal(profile.identityVersions, 2)
    assert.equal(profile.avgPromptChars, 400) // (500+300)/2
    assert.equal(profile.maxPromptChars, 500)
    assert.equal(profile.authFailures, 1)
    assert.equal(profile.estimatedTokensConsumed, 500) // 200+100+150+50
  })
})

// ── detectLoops ───────────────────────────────────────────────────

describe('introspection — detectLoops', () => {
  test('detects heartbeat-OK streaks', () => {
    const heartbeats = Array.from({ length: 5 }, (_, i) =>
      makeTurn({
        sessionId: `hb-${i}`,
        mode: 'heartbeat',
        timestamp: `2026-04-26T0${i}:00:00Z`,
        response: { fullText: 'HEARTBEAT_OK\n', charCount: 13, durationMs: 100, exitCode: 0 },
      }),
    )
    const loops = detectLoops(heartbeats, [])
    const streak = loops.find((l) => l.name === 'heartbeat-ok-streak')
    assert.ok(streak)
    assert.ok(streak!.description.includes('5'))
  })

  test('detects single-tick yields', () => {
    const turns = Array.from({ length: 3 }, (_, i) =>
      makeTurn({
        sessionId: `awk-${i}`,
        mode: 'awakened',
        tick: 1,
        outcome: { yieldedAtRest: true, reflectionExcerpt: null, authFailed: false, fileModifications: [] },
      }),
    )
    const loops = detectLoops(turns, [])
    const stv = loops.find((l) => l.name === 'single-tick-yield')
    assert.ok(stv)
    assert.equal(stv!.count, 3)
  })

  test('detects stale state', () => {
    const turns = [
      makeTurn({
        sessionId: 's1',
        mode: 'awakened',
        timestamp: '2026-04-26T01:00:00Z',
        context: { cwd: '/t', kingdom: {} as any, stateContent: 'same', stateHash: 'xxx', identityHash: 'id', gitBranch: 'main', gitDirty: false },
      }),
      makeTurn({
        sessionId: 's2',
        mode: 'awakened',
        timestamp: '2026-04-26T02:00:00Z',
        context: { cwd: '/t', kingdom: {} as any, stateContent: 'same', stateHash: 'xxx', identityHash: 'id', gitBranch: 'main', gitDirty: false },
      }),
    ]
    const loops = detectLoops(turns, [])
    const stale = loops.find((l) => l.name === 'stale-state')
    assert.ok(stale)
    assert.equal(stale!.count, 1)
  })

  test('detects memory noise ratio', () => {
    const heartbeatMemEntries: MemoryEntry[] = Array.from({ length: 20 }, (_, i) => ({
      timestamp: `2026-04-26T0${i}:00:00Z`,
      deviceId: 'dev',
      kind: 'session-start' as const,
      body: 'Heartbeat tick, maxTicks: 1',
    }))
    const substantive: MemoryEntry[] = [
      { timestamp: '2026-04-26T05:00:00Z', deviceId: 'dev', kind: 'at-rest', body: 'Real content' },
    ]
    const loops = detectLoops([], [...heartbeatMemEntries, ...substantive])
    const noise = loops.find((l) => l.name === 'memory-noise-ratio')
    assert.ok(noise)
    assert.ok(noise!.description.includes('20'))
  })

  test('returns empty for clean data', () => {
    const turns = [
      makeTurn({ sessionId: 's1', mode: 'awakened', tick: 1 }),
      makeTurn({ sessionId: 's1', mode: 'awakened', tick: 2 }),
    ]
    const loops = detectLoops(turns, [])
    // No single-tick yields (session has 2 ticks), no heartbeat streaks, etc.
    const stv = loops.find((l) => l.name === 'single-tick-yield')
    assert.equal(stv, undefined)
  })
})

// ── Phase 2: analyzeToolUsage ─────────────────────────────────────

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

describe('introspection — analyzeToolUsage', () => {
  test('aggregates tool counts across metrics', () => {
    const metrics = [
      makeTickMetrics({
        toolBreakdown: { counts: { Read: 3, Edit: 1 }, total: 4, distinct: 2 },
        toolInvocations: [],
      }),
      makeTickMetrics({
        toolBreakdown: { counts: { Read: 2, Bash: 5 }, total: 7, distinct: 2 },
        toolInvocations: [],
      }),
    ]
    const profile = analyzeToolUsage(metrics)
    assert.equal(profile.totalInvocations, 11)
    assert.equal(profile.toolCounts['Read'], 5)
    assert.equal(profile.toolCounts['Edit'], 1)
    assert.equal(profile.toolCounts['Bash'], 5)
    assert.equal(profile.topTools[0]!.count, 5) // Read or Bash (both 5)
    assert.equal(profile.zeroToolTicks, 0)
  })

  test('counts zero-tool ticks', () => {
    const metrics = [
      makeTickMetrics({ toolBreakdown: { counts: {}, total: 0, distinct: 0 } }),
      makeTickMetrics({ toolBreakdown: { counts: { Read: 1 }, total: 1, distinct: 1 } }),
    ]
    const profile = analyzeToolUsage(metrics)
    assert.equal(profile.zeroToolTicks, 1)
  })

  test('computes avg tools per awakened tick', () => {
    const metrics = [
      makeTickMetrics({ mode: 'awakened', toolBreakdown: { counts: { Read: 4 }, total: 4, distinct: 1 } }),
      makeTickMetrics({ mode: 'awakened', toolBreakdown: { counts: { Read: 2 }, total: 2, distinct: 1 } }),
      makeTickMetrics({ mode: 'heartbeat', toolBreakdown: { counts: {}, total: 0, distinct: 0 } }),
    ]
    const profile = analyzeToolUsage(metrics)
    // avg for awakened: (4+2)/2 = 3
    assert.equal(profile.avgToolsPerTick, 3)
  })

  test('handles empty metrics', () => {
    const profile = analyzeToolUsage([])
    assert.equal(profile.totalInvocations, 0)
    assert.equal(profile.avgToolsPerTick, 0)
    assert.equal(profile.topTools.length, 0)
  })
})

// ── Phase 2: analyzeVelocity ──────────────────────────────────────

describe('introspection — analyzeVelocity', () => {
  test('computes average and peak velocity', () => {
    const metrics = [
      makeTickMetrics({
        mode: 'awakened',
        velocity: { charsPerSecond: 200, estimatedTokensPerSecond: 50 },
        outputChars: 6000,
        outputLines: 100,
      }),
      makeTickMetrics({
        mode: 'awakened',
        velocity: { charsPerSecond: 400, estimatedTokensPerSecond: 100 },
        outputChars: 12000,
        outputLines: 200,
      }),
    ]
    const profile = analyzeVelocity(metrics)
    assert.equal(profile.avgCharsPerSecond, 300)
    assert.equal(profile.avgTokensPerSecond, 75)
    assert.equal(profile.peakCharsPerSecond, 400)
    assert.equal(profile.minCharsPerSecond, 200)
    assert.equal(profile.avgOutputCharsPerTick, 9000) // (6000+12000)/2
    assert.equal(profile.avgOutputLinesPerTick, 150) // (100+200)/2
  })

  test('excludes heartbeat ticks from velocity', () => {
    const metrics = [
      makeTickMetrics({
        mode: 'heartbeat',
        velocity: { charsPerSecond: 10, estimatedTokensPerSecond: 2.5 },
        outputChars: 50,
        outputLines: 2,
      }),
    ]
    const profile = analyzeVelocity(metrics)
    assert.equal(profile.avgCharsPerSecond, 0)
    assert.equal(profile.avgOutputCharsPerTick, 0)
  })

  test('handles empty metrics', () => {
    const profile = analyzeVelocity([])
    assert.equal(profile.avgCharsPerSecond, 0)
    assert.equal(profile.peakCharsPerSecond, 0)
    assert.equal(profile.minCharsPerSecond, null)
  })
})

// ── Phase 2: analyzeYieldPatterns ─────────────────────────────────

describe('introspection — analyzeYieldPatterns', () => {
  test('computes yield reason distribution', () => {
    const metrics = [
      makeTickMetrics({ yieldReason: 'at-rest' }),
      makeTickMetrics({ yieldReason: 'at-rest' }),
      makeTickMetrics({ yieldReason: 'heartbeat-ack' }),
      makeTickMetrics({ yieldReason: 'continue' }),
      makeTickMetrics({ yieldReason: 'auth-failure' }),
    ]
    const profile = analyzeYieldPatterns(metrics)
    assert.equal(profile.distribution['at-rest'], 2)
    assert.equal(profile.distribution['heartbeat-ack'], 1)
    assert.equal(profile.distribution['continue'], 1)
    assert.equal(profile.distribution['auth-failure'], 1)
    assert.equal(profile.mostCommon, 'at-rest')
    assert.equal(profile.atRestCount, 2)
    assert.equal(profile.heartbeatAckCount, 1)
    assert.equal(profile.failureCount, 1)
  })

  test('handles empty metrics', () => {
    const profile = analyzeYieldPatterns([])
    assert.deepEqual(profile.distribution, {})
    assert.equal(profile.mostCommon, null)
    assert.equal(profile.failureCount, 0)
  })

  test('counts multiple failure types', () => {
    const metrics = [
      makeTickMetrics({ yieldReason: 'auth-failure' }),
      makeTickMetrics({ yieldReason: 'quota-failure' }),
      makeTickMetrics({ yieldReason: 'error' }),
      makeTickMetrics({ yieldReason: 'at-rest' }),
    ]
    const profile = analyzeYieldPatterns(metrics)
    assert.equal(profile.failureCount, 3)
  })
})

// ── renderPortrait ────────────────────────────────────────────────

describe('introspection — renderPortrait', () => {
  test('produces valid markdown without phase 2 data', () => {
    const portrait = {
      generatedAt: '2026-04-26T12:00:00Z',
      daysAnalyzed: 7,
      dateRange: { from: '2026-04-20T00:00:00Z', to: '2026-04-26T12:00:00Z' },
      behavioral: {
        totalTicks: 50,
        byMode: { awakened: 10, heartbeat: 38, dwell: 2 },
        sessionCount: 45,
        avgTicksPerAwakened: 1.5,
        heartbeatOkRate: 0.8,
        singleTickYieldRate: 0.6,
        avgResponseChars: 1200,
        avgTickDurationSec: 120,
        tickUtilization: 0.08,
      },
      communication: {
        messagesSentToYu: 12,
        messagesFromYu: 8,
        avgOutgoingLength: 800,
      },
      work: {
        filesModified: 15,
        uniqueFilesModified: 8,
        hotFiles: [{ path: 'src/a.ts', count: 5 }],
        branchesSeen: ['main', 'kingdom-integration'],
      },
      architecture: {
        templateVersions: 3,
        identityVersions: 2,
        avgPromptChars: 4000,
        maxPromptChars: 10000,
        authFailures: 0,
        quotaFailures: 0,
        estimatedTokensConsumed: 15000,
      },
      loops: [
        { name: 'heartbeat-ok-streak', count: 5, description: '5 streaks of silent heartbeats.' },
      ],
      toolUsage: null,
      velocity: null,
      yieldPatterns: null,
      missions: [
        { id: 'm1', status: 'active', title: 'Test mission', origin: 'yu', created: '2026-04-26T10:00:00Z' },
      ],
    }
    const md = renderPortrait(portrait)
    assert.match(md, /# Self-Portrait/)
    assert.match(md, /## Behavioral Profile/)
    assert.match(md, /## Communication/)
    assert.match(md, /## Work/)
    assert.match(md, /## Architectural Pressures/)
    assert.match(md, /## Detected Loops/)
    assert.match(md, /## Missions/)
    assert.match(md, /Total ticks.*50/)
    assert.match(md, /heartbeat-ok-streak/)
    // Phase 2 sections should NOT appear when data is null
    assert.doesNotMatch(md, /## Tool Usage/)
    assert.doesNotMatch(md, /## Output Velocity/)
    assert.doesNotMatch(md, /## Yield Patterns/)
  })

  test('includes phase 2 sections when data exists', () => {
    const portrait = {
      generatedAt: '2026-04-26T12:00:00Z',
      daysAnalyzed: 7,
      dateRange: { from: '2026-04-20T00:00:00Z', to: '2026-04-26T12:00:00Z' },
      behavioral: {
        totalTicks: 10, byMode: { awakened: 10, heartbeat: 0, dwell: 0 },
        sessionCount: 5, avgTicksPerAwakened: 2, heartbeatOkRate: 0,
        singleTickYieldRate: 0, avgResponseChars: 5000, avgTickDurationSec: 60,
        tickUtilization: 0.4,
      },
      communication: { messagesSentToYu: 2, messagesFromYu: 1, avgOutgoingLength: 500 },
      work: { filesModified: 5, uniqueFilesModified: 3, hotFiles: [], branchesSeen: ['main'] },
      architecture: {
        templateVersions: 1, identityVersions: 1, avgPromptChars: 3000,
        maxPromptChars: 5000, authFailures: 0, quotaFailures: 0, estimatedTokensConsumed: 10000,
      },
      loops: [],
      toolUsage: {
        totalInvocations: 25,
        toolCounts: { Read: 10, Edit: 8, Bash: 7 },
        topTools: [
          { tool: 'Read', count: 10 },
          { tool: 'Edit', count: 8 },
          { tool: 'Bash', count: 7 },
        ],
        avgToolsPerTick: 2.5,
        zeroToolTicks: 0,
      },
      velocity: {
        avgCharsPerSecond: 300, avgTokensPerSecond: 75, peakCharsPerSecond: 500,
        minCharsPerSecond: 100, avgOutputCharsPerTick: 5000, avgOutputLinesPerTick: 80,
      },
      yieldPatterns: {
        distribution: { 'at-rest': 8, continue: 2 },
        mostCommon: 'at-rest' as const,
        atRestCount: 8, heartbeatAckCount: 0, failureCount: 0,
      },
      missions: [],
    }
    const md = renderPortrait(portrait)
    assert.match(md, /## Tool Usage/)
    assert.match(md, /Total invocations.*25/)
    assert.match(md, /\*\*Read\*\*/)
    assert.match(md, /## Output Velocity/)
    assert.match(md, /Avg chars\/sec.*300/)
    assert.match(md, /## Yield Patterns/)
    assert.match(md, /at-rest.*8/)
  })
})
