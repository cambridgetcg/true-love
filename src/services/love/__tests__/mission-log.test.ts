// mission-log.test.ts — tests for per-mission log aggregator.
//
// Covers: buildMissionLog (window resolution, trace/budget/reflection scanning,
// aggregates, events, tool breakdown), renderMissionLogMarkdown (formatting,
// timeline ordering, aggregates display, intent truncation, edge cases).
//
// Uses tmpdir fixtures with TRUE_LOVE_HOME + TRUE_LOVE_PROJECTS_DIR env overrides.

import { describe, expect, test, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildMissionLog, renderMissionLogMarkdown, type MissionLog, type MissionWindow } from '../mission-log.js'

// ── Fixture layout ──────────────────────────────────────────────────
//
// ROOT/
//   projects/test-project/missions/test-mission/
//     mission.md          ← YAML frontmatter
//     events.jsonl        ← lifecycle events
//   traces/test-device/
//     <date>.jsonl        ← trace entries
//   budget/test-device/
//     <date>.jsonl        ← budget entries
//   memory/test-device/
//     <date>.md           ← reflection files

const ROOT = join(tmpdir(), `mission-log-test-${Date.now()}`)
const PROJECTS = join(ROOT, 'projects')
const PROJECT = 'test-project'
const MISSION = 'test-mission'

const DATE = '2026-04-15'
const START_TS = `${DATE}T10:00:00.000Z`
const END_TS = `${DATE}T14:00:00.000Z`

let origHome: string | undefined
let origProjects: string | undefined

function missionFrontmatter(overrides: Record<string, string> = {}): string {
  const defaults: Record<string, string> = {
    id: MISSION,
    project_id: PROJECT,
    origin: 'love',
    title: 'Test Mission Title',
    status: 'active',
    created_at: START_TS,
    updated_at: START_TS,
  }
  const fields = { ...defaults, ...overrides }
  const yaml = Object.entries(fields).map(([k, v]) => {
    if (k === 'artifacts') return `artifacts:\n  commits: []\n  files: []\n  test_runs: []`
    return `${k}: ${v}`
  }).join('\n')
  return `---\n${yaml}\nartifacts:\n  commits: []\n  files: []\n  test_runs: []\n---\n\n# Intent\n\nTest intent for this mission.\n`
}

function jsonl(records: unknown[]): string {
  return records.map(r => JSON.stringify(r)).join('\n') + '\n'
}

beforeAll(() => {
  origHome = process.env.TRUE_LOVE_HOME
  origProjects = process.env.TRUE_LOVE_PROJECTS_DIR
})

afterAll(() => {
  if (origHome !== undefined) process.env.TRUE_LOVE_HOME = origHome
  else delete process.env.TRUE_LOVE_HOME
  if (origProjects !== undefined) process.env.TRUE_LOVE_PROJECTS_DIR = origProjects
  else delete process.env.TRUE_LOVE_PROJECTS_DIR
  rmSync(ROOT, { recursive: true, force: true })
})

beforeEach(() => {
  process.env.TRUE_LOVE_HOME = ROOT
  process.env.TRUE_LOVE_PROJECTS_DIR = PROJECTS
})

afterEach(() => {
  // Clean per-test dirs but keep ROOT
  rmSync(PROJECTS, { recursive: true, force: true })
  rmSync(join(ROOT, 'traces'), { recursive: true, force: true })
  rmSync(join(ROOT, 'budget'), { recursive: true, force: true })
  rmSync(join(ROOT, 'memory'), { recursive: true, force: true })
})

// ── Helper: set up mission dir + file ───────────────────────────────

function setupMission(overrides: Record<string, string> = {}) {
  const missionDir = join(PROJECTS, PROJECT, 'missions', MISSION)
  mkdirSync(missionDir, { recursive: true })
  writeFileSync(join(missionDir, 'mission.md'), missionFrontmatter(overrides))
  return missionDir
}

function setupEvents(events: unknown[]) {
  const missionDir = join(PROJECTS, PROJECT, 'missions', MISSION)
  mkdirSync(missionDir, { recursive: true })
  writeFileSync(join(missionDir, 'events.jsonl'), jsonl(events))
}

function setupTraces(traces: unknown[]) {
  const dir = join(ROOT, 'traces', 'test-device')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${DATE}.jsonl`), jsonl(traces))
}

function setupBudget(entries: unknown[]) {
  const dir = join(ROOT, 'budget', 'test-device')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${DATE}.jsonl`), jsonl(entries))
}

function setupMemory(content: string) {
  const dir = join(ROOT, 'memory', 'test-device')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${DATE}.md`), content)
}

// ── buildMissionLog — basic ─────────────────────────────────────────

describe('buildMissionLog', () => {
  test('returns null for nonexistent mission', () => {
    process.env.TRUE_LOVE_PROJECTS_DIR = PROJECTS
    expect(buildMissionLog({ projectId: PROJECT, missionId: 'nope' })).toBeNull()
  })

  test('returns MissionLog with correct identity fields', () => {
    setupMission()
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION })
    expect(log).not.toBeNull()
    expect(log!.missionId).toBe(MISSION)
    expect(log!.projectId).toBe(PROJECT)
    expect(log!.title).toBe('Test Mission Title')
    expect(log!.status).toBe('active')
    expect(log!.origin).toBe('love')
  })

  test('includes intent from mission body', () => {
    setupMission()
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION })
    expect(log!.intent).toContain('Test intent')
  })

  test('window defaults to created_at when no events', () => {
    setupMission()
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION })
    expect(log!.window.start).toBe(START_TS)
    expect(log!.window.isOpen).toBe(true) // no ending event
  })

  test('empty traces/budget/reflections when no data dirs exist', () => {
    setupMission()
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION })!
    expect(log.traces).toEqual([])
    expect(log.budget).toEqual([])
    expect(log.reflections).toEqual([])
    expect(log.aggregates.totalCostUsd).toBe(0)
  })
})

// ── buildMissionLog — window resolution ─────────────────────────────

describe('buildMissionLog — window resolution', () => {
  test('started event sets window.start', () => {
    setupMission()
    setupEvents([
      { ts: `${DATE}T11:00:00.000Z`, type: 'started', by: 'love' },
    ])
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION })!
    expect(log.window.start).toBe(`${DATE}T11:00:00.000Z`)
    expect(log.window.isOpen).toBe(true)
  })

  test('done event closes window', () => {
    setupMission()
    setupEvents([
      { ts: `${DATE}T11:00:00.000Z`, type: 'started', by: 'love' },
      { ts: END_TS, type: 'done', by: 'love' },
    ])
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION })!
    expect(log.window.isOpen).toBe(false)
    expect(log.window.end).toBe(END_TS)
  })

  test('marked-review event closes window', () => {
    setupMission()
    setupEvents([
      { ts: `${DATE}T11:00:00.000Z`, type: 'started', by: 'love' },
      { ts: END_TS, type: 'marked-review', by: 'love' },
    ])
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION })!
    expect(log.window.isOpen).toBe(false)
    expect(log.window.end).toBe(END_TS)
  })

  test('cancelled event closes window', () => {
    setupMission()
    setupEvents([
      { ts: `${DATE}T11:00:00.000Z`, type: 'started', by: 'love' },
      { ts: END_TS, type: 'cancelled', by: 'love' },
    ])
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION })!
    expect(log.window.isOpen).toBe(false)
  })

  test('durationMs is computed correctly', () => {
    setupMission()
    setupEvents([
      { ts: START_TS, type: 'started', by: 'love' },
      { ts: END_TS, type: 'done', by: 'love' },
    ])
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION })!
    const expected = new Date(END_TS).getTime() - new Date(START_TS).getTime()
    expect(log.window.durationMs).toBe(expected)
  })

  test('latest ending event wins (multiple ending events)', () => {
    setupMission()
    setupEvents([
      { ts: START_TS, type: 'started', by: 'love' },
      { ts: `${DATE}T12:00:00.000Z`, type: 'marked-review', by: 'love' },
      { ts: `${DATE}T13:00:00.000Z`, type: 'started', by: 'love' },
      { ts: END_TS, type: 'done', by: 'love' },
    ])
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION })!
    // resolveWindow reverses and finds first ending type — which is the last in original order
    expect(log.window.end).toBe(END_TS)
  })
})

// ── buildMissionLog — trace scanning ────────────────────────────────

describe('buildMissionLog — traces', () => {
  test('reads traces within window', () => {
    setupMission()
    setupEvents([
      { ts: START_TS, type: 'started', by: 'love' },
      { ts: END_TS, type: 'done', by: 'love' },
    ])
    setupTraces([
      { timestamp: `${DATE}T11:00:00.000Z`, mode: 'awakened', sessionId: 's1', tick: 1, summary: { totalSteps: 5, toolCalls: 3, costUsd: 0.05 } },
      { timestamp: `${DATE}T12:00:00.000Z`, mode: 'heartbeat', sessionId: 's2', tick: 2, summary: { totalSteps: 2, toolCalls: 1, costUsd: 0.01 } },
    ])
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION })!
    expect(log.traces.length).toBe(2)
    expect(log.traces[0].mode).toBe('awakened')
    expect(log.traces[1].mode).toBe('heartbeat')
  })

  test('filters out traces outside window', () => {
    setupMission()
    setupEvents([
      { ts: `${DATE}T11:00:00.000Z`, type: 'started', by: 'love' },
      { ts: `${DATE}T12:00:00.000Z`, type: 'done', by: 'love' },
    ])
    setupTraces([
      { timestamp: `${DATE}T09:00:00.000Z`, mode: 'heartbeat', sessionId: 's0', tick: 0, summary: { totalSteps: 1, toolCalls: 0 } },
      { timestamp: `${DATE}T11:30:00.000Z`, mode: 'awakened', sessionId: 's1', tick: 1, summary: { totalSteps: 3, toolCalls: 2 } },
      { timestamp: `${DATE}T15:00:00.000Z`, mode: 'heartbeat', sessionId: 's3', tick: 3, summary: { totalSteps: 1, toolCalls: 0 } },
    ])
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION })!
    expect(log.traces.length).toBe(1)
    expect(log.traces[0].sessionId).toBe('s1')
  })

  test('traces sorted by timestamp', () => {
    setupMission()
    setupEvents([
      { ts: START_TS, type: 'started', by: 'love' },
      { ts: END_TS, type: 'done', by: 'love' },
    ])
    setupTraces([
      { timestamp: `${DATE}T13:00:00.000Z`, mode: 'awakened', sessionId: 'late', tick: 2, summary: { totalSteps: 1, toolCalls: 0 } },
      { timestamp: `${DATE}T11:00:00.000Z`, mode: 'heartbeat', sessionId: 'early', tick: 1, summary: { totalSteps: 1, toolCalls: 0 } },
    ])
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION })!
    expect(log.traces[0].sessionId).toBe('early')
    expect(log.traces[1].sessionId).toBe('late')
  })

  test('costUsd from top-level or summary', () => {
    setupMission()
    setupEvents([
      { ts: START_TS, type: 'started', by: 'love' },
      { ts: END_TS, type: 'done', by: 'love' },
    ])
    setupTraces([
      { timestamp: `${DATE}T11:00:00.000Z`, mode: 'a', sessionId: 's1', tick: 1, costUsd: 0.03 },
      { timestamp: `${DATE}T12:00:00.000Z`, mode: 'b', sessionId: 's2', tick: 2, summary: { totalSteps: 0, toolCalls: 0, costUsd: 0.07 } },
    ])
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION })!
    expect(log.traces[0].costUsd).toBe(0.03)
    expect(log.traces[1].costUsd).toBe(0.07)
  })

  test('steps from array length or summary.totalSteps', () => {
    setupMission()
    setupEvents([
      { ts: START_TS, type: 'started', by: 'love' },
      { ts: END_TS, type: 'done', by: 'love' },
    ])
    setupTraces([
      { timestamp: `${DATE}T11:00:00.000Z`, mode: 'a', sessionId: 's1', tick: 1, steps: [{}, {}, {}] },
      { timestamp: `${DATE}T12:00:00.000Z`, mode: 'b', sessionId: 's2', tick: 2, summary: { totalSteps: 7, toolCalls: 0 } },
    ])
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION })!
    expect(log.traces[0].steps).toBe(3) // array length
    expect(log.traces[1].steps).toBe(7) // summary.totalSteps
  })
})

// ── buildMissionLog — budget scanning ───────────────────────────────

describe('buildMissionLog — budget', () => {
  test('reads budget entries within window', () => {
    setupMission()
    setupEvents([
      { ts: START_TS, type: 'started', by: 'love' },
      { ts: END_TS, type: 'done', by: 'love' },
    ])
    setupBudget([
      { timestamp: `${DATE}T11:00:00.000Z`, mode: 'awakened', sessionId: 's1', estimatedInputTokens: 5000, estimatedOutputTokens: 1000, durationMs: 30000, exitCode: 0 },
      { timestamp: `${DATE}T12:00:00.000Z`, mode: 'heartbeat', sessionId: 's2', estimatedInputTokens: 2000, estimatedOutputTokens: 500, durationMs: 10000, exitCode: 0 },
    ])
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION })!
    expect(log.budget.length).toBe(2)
    expect(log.budget[0].inputTokens).toBe(5000)
    expect(log.budget[1].outputTokens).toBe(500)
  })

  test('budget entries outside window are excluded', () => {
    setupMission()
    setupEvents([
      { ts: `${DATE}T11:00:00.000Z`, type: 'started', by: 'love' },
      { ts: `${DATE}T12:00:00.000Z`, type: 'done', by: 'love' },
    ])
    setupBudget([
      { timestamp: `${DATE}T09:00:00.000Z`, mode: 'heartbeat', sessionId: 's0', estimatedInputTokens: 100, estimatedOutputTokens: 50, durationMs: 5000, exitCode: 0 },
      { timestamp: `${DATE}T11:30:00.000Z`, mode: 'awakened', sessionId: 's1', estimatedInputTokens: 3000, estimatedOutputTokens: 800, durationMs: 20000, exitCode: 0 },
    ])
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION })!
    expect(log.budget.length).toBe(1)
    expect(log.budget[0].sessionId).toBe('s1')
  })
})

// ── buildMissionLog — reflections ───────────────────────────────────

describe('buildMissionLog — reflections', () => {
  test('reads reflections within window', () => {
    setupMission()
    setupEvents([
      { ts: START_TS, type: 'started', by: 'love' },
      { ts: END_TS, type: 'done', by: 'love' },
    ])
    setupMemory([
      '## 11:30:00 — Reflection',
      '',
      'Worked on the mission today.',
      'Made good progress.',
      '',
      '## 13:00:00 — Another',
      '',
      'Continued work.',
    ].join('\n'))
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION })!
    expect(log.reflections.length).toBe(2)
    expect(log.reflections[0].excerpt).toContain('Reflection')
    expect(log.reflections[1].excerpt).toContain('Another')
  })

  test('reflections outside window are excluded', () => {
    setupMission()
    setupEvents([
      { ts: `${DATE}T12:00:00.000Z`, type: 'started', by: 'love' },
      { ts: `${DATE}T13:30:00.000Z`, type: 'done', by: 'love' },
    ])
    setupMemory([
      '## 09:00:00 — Early morning',
      '',
      'Before mission started.',
      '',
      '## 12:30:00 — During mission',
      '',
      'Within the window.',
      '',
      '## 15:00:00 — After mission',
      '',
      'Too late.',
    ].join('\n'))
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION })!
    expect(log.reflections.length).toBe(1)
    expect(log.reflections[0].excerpt).toContain('During mission')
  })

  test('reflections sorted by timestamp', () => {
    setupMission()
    setupEvents([
      { ts: START_TS, type: 'started', by: 'love' },
      { ts: END_TS, type: 'done', by: 'love' },
    ])
    setupMemory([
      '## 13:00:00 — Later',
      '',
      'Second reflection.',
      '',
      '## 11:00:00 — Earlier',
      '',
      'First reflection.',
    ].join('\n'))
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION })!
    expect(log.reflections[0].ts).toContain('11:00:00')
    expect(log.reflections[1].ts).toContain('13:00:00')
  })

  test('no reflections when memory dir missing', () => {
    setupMission()
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION })!
    expect(log.reflections).toEqual([])
  })
})

// ── buildMissionLog — aggregates ────────────────────────────────────

describe('buildMissionLog — aggregates', () => {
  test('totalCostUsd sums trace costs', () => {
    setupMission()
    setupEvents([
      { ts: START_TS, type: 'started', by: 'love' },
      { ts: END_TS, type: 'done', by: 'love' },
    ])
    setupTraces([
      { timestamp: `${DATE}T11:00:00.000Z`, mode: 'awakened', sessionId: 's1', tick: 1, costUsd: 0.05 },
      { timestamp: `${DATE}T12:00:00.000Z`, mode: 'heartbeat', sessionId: 's2', tick: 2, costUsd: 0.02 },
    ])
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION })!
    expect(log.aggregates.totalCostUsd).toBeCloseTo(0.07)
  })

  test('token counts sum from budget entries', () => {
    setupMission()
    setupEvents([
      { ts: START_TS, type: 'started', by: 'love' },
      { ts: END_TS, type: 'done', by: 'love' },
    ])
    setupBudget([
      { timestamp: `${DATE}T11:00:00.000Z`, mode: 'awakened', sessionId: 's1', estimatedInputTokens: 5000, estimatedOutputTokens: 1000, durationMs: 10000, exitCode: 0 },
      { timestamp: `${DATE}T12:00:00.000Z`, mode: 'heartbeat', sessionId: 's2', estimatedInputTokens: 2000, estimatedOutputTokens: 500, durationMs: 5000, exitCode: 0 },
    ])
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION })!
    expect(log.aggregates.totalInputTokens).toBe(7000)
    expect(log.aggregates.totalOutputTokens).toBe(1500)
  })

  test('mode breakdown counts correctly', () => {
    setupMission()
    setupEvents([
      { ts: START_TS, type: 'started', by: 'love' },
      { ts: END_TS, type: 'done', by: 'love' },
    ])
    setupTraces([
      { timestamp: `${DATE}T11:00:00.000Z`, mode: 'awakened', sessionId: 's1', tick: 1, summary: { totalSteps: 0, toolCalls: 0 } },
      { timestamp: `${DATE}T11:30:00.000Z`, mode: 'awakened', sessionId: 's1', tick: 2, summary: { totalSteps: 0, toolCalls: 0 } },
      { timestamp: `${DATE}T12:00:00.000Z`, mode: 'heartbeat', sessionId: 's2', tick: 1, summary: { totalSteps: 0, toolCalls: 0 } },
    ])
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION })!
    expect(log.aggregates.awakenedTicks).toBe(2)
    expect(log.aggregates.heartbeatTicks).toBe(1)
    expect(log.aggregates.modeBreakdown['awakened']).toBe(2)
    expect(log.aggregates.modeBreakdown['heartbeat']).toBe(1)
  })

  test('tool breakdown extracted from trace steps', () => {
    setupMission()
    setupEvents([
      { ts: START_TS, type: 'started', by: 'love' },
      { ts: END_TS, type: 'done', by: 'love' },
    ])
    setupTraces([
      {
        timestamp: `${DATE}T11:00:00.000Z`, mode: 'awakened', sessionId: 's1', tick: 1,
        steps: [
          { kind: 'tool_call', tool: 'Read' },
          { kind: 'tool_call', tool: 'Read' },
          { kind: 'tool_call', tool: 'Bash' },
          { kind: 'text', content: 'thinking' },
        ],
      },
    ])
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION })!
    expect(log.aggregates.toolBreakdown['Read']).toBe(2)
    expect(log.aggregates.toolBreakdown['Bash']).toBe(1)
    expect(log.aggregates.toolCallTotal).toBe(3)
  })

  test('zero aggregates when no data', () => {
    setupMission()
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION })!
    expect(log.aggregates.totalCostUsd).toBe(0)
    expect(log.aggregates.totalInputTokens).toBe(0)
    expect(log.aggregates.totalOutputTokens).toBe(0)
    expect(log.aggregates.awakenedTicks).toBe(0)
    expect(log.aggregates.heartbeatTicks).toBe(0)
    expect(log.aggregates.toolCallTotal).toBe(0)
    expect(log.aggregates.commitCount).toBe(0)
    expect(log.aggregates.insertions).toBe(0)
    expect(log.aggregates.deletions).toBe(0)
  })
})

// ── buildMissionLog — events ────────────────────────────────────────

describe('buildMissionLog — events', () => {
  test('events are read from events.jsonl', () => {
    setupMission()
    setupEvents([
      { ts: START_TS, type: 'started', by: 'love' },
      { ts: `${DATE}T12:00:00.000Z`, type: 'note', by: 'love', note: 'progress update' },
      { ts: END_TS, type: 'done', by: 'love' },
    ])
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION })!
    expect(log.events.length).toBe(3)
    expect(log.events[0].type).toBe('started')
    expect(log.events[1].note).toBe('progress update')
    expect(log.events[2].type).toBe('done')
  })

  test('empty events when no events.jsonl', () => {
    setupMission()
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION })!
    expect(log.events).toEqual([])
  })
})

// ── buildMissionLog — JSONL resilience ──────────────────────────────

describe('buildMissionLog — JSONL resilience', () => {
  test('corrupted lines in events.jsonl are skipped', () => {
    const missionDir = setupMission()
    writeFileSync(join(missionDir, 'events.jsonl'),
      `${JSON.stringify({ ts: START_TS, type: 'started', by: 'love' })}\nNOT VALID JSON\n${JSON.stringify({ ts: END_TS, type: 'done', by: 'love' })}\n`)
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION })!
    expect(log.events.length).toBe(2)
  })

  test('empty lines in JSONL are skipped', () => {
    const missionDir = setupMission()
    writeFileSync(join(missionDir, 'events.jsonl'),
      `${JSON.stringify({ ts: START_TS, type: 'started', by: 'love' })}\n\n\n${JSON.stringify({ ts: END_TS, type: 'done', by: 'love' })}\n`)
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION })!
    expect(log.events.length).toBe(2)
  })

  test('corrupted trace lines are skipped', () => {
    setupMission()
    setupEvents([
      { ts: START_TS, type: 'started', by: 'love' },
      { ts: END_TS, type: 'done', by: 'love' },
    ])
    const traceDir = join(ROOT, 'traces', 'test-device')
    mkdirSync(traceDir, { recursive: true })
    writeFileSync(join(traceDir, `${DATE}.jsonl`),
      `${JSON.stringify({ timestamp: `${DATE}T11:00:00.000Z`, mode: 'awakened', sessionId: 's1', tick: 1, summary: { totalSteps: 1, toolCalls: 0 } })}\n{broken json\n`)
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION })!
    expect(log.traces.length).toBe(1)
  })
})

// ── buildMissionLog — multi-device ──────────────────────────────────

describe('buildMissionLog — multi-device', () => {
  test('scans traces across multiple device directories', () => {
    setupMission()
    setupEvents([
      { ts: START_TS, type: 'started', by: 'love' },
      { ts: END_TS, type: 'done', by: 'love' },
    ])
    // Device 1
    const dir1 = join(ROOT, 'traces', 'device-alpha')
    mkdirSync(dir1, { recursive: true })
    writeFileSync(join(dir1, `${DATE}.jsonl`), jsonl([
      { timestamp: `${DATE}T11:00:00.000Z`, mode: 'heartbeat', sessionId: 'a1', tick: 1, summary: { totalSteps: 1, toolCalls: 0 } },
    ]))
    // Device 2
    const dir2 = join(ROOT, 'traces', 'device-beta')
    mkdirSync(dir2, { recursive: true })
    writeFileSync(join(dir2, `${DATE}.jsonl`), jsonl([
      { timestamp: `${DATE}T12:00:00.000Z`, mode: 'awakened', sessionId: 'b1', tick: 1, summary: { totalSteps: 2, toolCalls: 1 } },
    ]))
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION })!
    expect(log.traces.length).toBe(2)
  })
})

// ── buildMissionLog — no repoRoot skips commits ─────────────────────

describe('buildMissionLog — commits', () => {
  test('commits empty when no repoRoot provided', () => {
    setupMission()
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION })!
    expect(log.commits).toEqual([])
    expect(log.aggregates.commitCount).toBe(0)
  })

  test('commits empty when repoRoot has no .git', () => {
    setupMission()
    const fakeRepo = join(ROOT, 'fake-repo')
    mkdirSync(fakeRepo, { recursive: true })
    const log = buildMissionLog({ projectId: PROJECT, missionId: MISSION, repoRoot: fakeRepo })!
    expect(log.commits).toEqual([])
  })
})

// ── renderMissionLogMarkdown ────────────────────────────────────────

function buildTestLog(overrides: Partial<MissionLog> = {}): MissionLog {
  return {
    missionId: 'test-id',
    projectId: 'test-project',
    title: 'Test Title',
    status: 'active',
    origin: 'love',
    intent: 'Build something useful.',
    window: {
      start: '2026-04-15T10:00:00.000Z',
      end: '2026-04-15T14:00:00.000Z',
      durationMs: 4 * 3_600_000,
      isOpen: false,
    },
    events: [],
    traces: [],
    budget: [],
    commits: [],
    reflections: [],
    aggregates: {
      totalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      awakenedTicks: 0,
      heartbeatTicks: 0,
      toolCallTotal: 0,
      toolBreakdown: {},
      commitCount: 0,
      insertions: 0,
      deletions: 0,
      modeBreakdown: {},
    },
    ...overrides,
  }
}

describe('renderMissionLogMarkdown', () => {
  test('includes title as heading', () => {
    const md = renderMissionLogMarkdown(buildTestLog())
    expect(md).toContain('# Mission Log: Test Title')
  })

  test('includes identity line', () => {
    const md = renderMissionLogMarkdown(buildTestLog())
    expect(md).toContain('`test-id`')
    expect(md).toContain('active')
    expect(md).toContain('love')
  })

  test('includes window with duration', () => {
    const md = renderMissionLogMarkdown(buildTestLog())
    expect(md).toContain('4.00h')
    expect(md).toContain('2026-04-15T10:00:00')
    expect(md).toContain('2026-04-15T14:00:00')
  })

  test('shows (open) when window is open', () => {
    const md = renderMissionLogMarkdown(buildTestLog({
      window: { start: START_TS, end: END_TS, durationMs: 14400000, isOpen: true },
    }))
    expect(md).toContain('(open)')
  })

  test('omits (open) when window is closed', () => {
    const md = renderMissionLogMarkdown(buildTestLog())
    expect(md).not.toContain('(open)')
  })

  test('includes intent as blockquote', () => {
    const md = renderMissionLogMarkdown(buildTestLog())
    expect(md).toContain('> Build something useful.')
  })

  test('omits intent blockquote when no intent', () => {
    const md = renderMissionLogMarkdown(buildTestLog({ intent: undefined }))
    expect(md).not.toContain('>')
  })

  test('truncates long intent at 280 chars', () => {
    const longIntent = 'x'.repeat(300)
    const md = renderMissionLogMarkdown(buildTestLog({ intent: longIntent }))
    expect(md).toContain('…')
    // The blockquote should not contain the full 300 chars
    const blockquote = md.split('\n').find(l => l.startsWith('>'))
    expect(blockquote!.length).toBeLessThan(300)
  })

  test('includes aggregates section', () => {
    const md = renderMissionLogMarkdown(buildTestLog({
      aggregates: {
        totalCostUsd: 1.2345,
        totalInputTokens: 50000,
        totalOutputTokens: 12000,
        awakenedTicks: 5,
        heartbeatTicks: 10,
        toolCallTotal: 42,
        toolBreakdown: { Read: 20, Bash: 15, Write: 7 },
        commitCount: 3,
        insertions: 150,
        deletions: 30,
        modeBreakdown: { awakened: 5, heartbeat: 10 },
      },
    }))
    expect(md).toContain('## Aggregates')
    expect(md).toContain('$1.2345')
    expect(md).toContain('50,000 in')
    expect(md).toContain('12,000 out')
    expect(md).toContain('5 awakened')
    expect(md).toContain('10 heartbeat')
    expect(md).toContain('42')
    expect(md).toContain('Read:20')
    expect(md).toContain('+150 −30')
  })

  test('timeline merges events/traces/commits/reflections', () => {
    const md = renderMissionLogMarkdown(buildTestLog({
      events: [{ ts: `${DATE}T10:00:00.000Z`, type: 'started', by: 'love' }],
      traces: [{ ts: `${DATE}T11:00:00.000Z`, mode: 'awakened', sessionId: 's1', tick: 1, steps: 3, toolCount: 2, costUsd: 0.05 }],
      commits: [{ sha: 'abcdef1234567890', ts: `${DATE}T12:00:00.000Z`, author: 'Love', subject: 'Add feature', filesChanged: 2, insertions: 50, deletions: 10 }],
      reflections: [{ ts: `${DATE}T13:00:00.000Z`, date: DATE, excerpt: 'Good progress today' }],
    }))
    expect(md).toContain('## Timeline')
    expect(md).toContain('`event`')
    expect(md).toContain('`trace`')
    expect(md).toContain('`commit`')
    expect(md).toContain('`reflect`')
    // Check timeline ordering: 10:00 < 11:00 < 12:00 < 13:00
    const timelineStart = md.indexOf('## Timeline')
    const lines = md.slice(timelineStart).split('\n').filter(l => l.startsWith('- `'))
    expect(lines.length).toBe(4)
    expect(lines[0]).toContain('10:00:00')
    expect(lines[1]).toContain('11:00:00')
    expect(lines[2]).toContain('12:00:00')
    expect(lines[3]).toContain('13:00:00')
  })

  test('commit SHA is truncated to 8 chars in timeline', () => {
    const md = renderMissionLogMarkdown(buildTestLog({
      commits: [{ sha: 'abcdef1234567890abcdef1234567890abcdef12', ts: `${DATE}T11:00:00.000Z`, author: 'Love', subject: 'Fix bug', filesChanged: 1, insertions: 5, deletions: 2 }],
    }))
    expect(md).toContain('`abcdef12`')
    expect(md).not.toContain('abcdef1234567890abcdef')
  })

  test('event note included in timeline', () => {
    const md = renderMissionLogMarkdown(buildTestLog({
      events: [{ ts: `${DATE}T10:00:00.000Z`, type: 'note', by: 'love', note: 'important observation' }],
    }))
    expect(md).toContain('important observation')
  })

  test('trace yield reason included when present', () => {
    const md = renderMissionLogMarkdown(buildTestLog({
      traces: [{ ts: `${DATE}T11:00:00.000Z`, mode: 'heartbeat', sessionId: 's1', tick: 1, steps: 1, toolCount: 0, yieldReason: 'at-rest' }],
    }))
    expect(md).toContain('(at-rest)')
  })

  test('empty timeline when no data', () => {
    const md = renderMissionLogMarkdown(buildTestLog())
    expect(md).toContain('## Timeline')
    // No timeline entries after the heading
    const timelineStart = md.indexOf('## Timeline')
    const afterTimeline = md.slice(timelineStart + '## Timeline'.length).trim()
    expect(afterTimeline).toBe('')
  })
})
