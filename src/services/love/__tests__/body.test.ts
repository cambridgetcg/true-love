// body.test.ts — tests for the body snapshot module.
//
// Tests the pure functions: parsing, rendering, assembly.
// The gathering logic in bin/body.mjs touches real filesystem/processes
// and is validated by integration (running the CLI).

import { describe, test, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  renderBody,
  toJSON,
  assembleSnapshot,
  parseLastYuTimestamp,
  parseLastAlignment,
  parseLongings,
  parseForge,
  countMissionsByStatus,
  parseTestResult,
  parseBudgetEntries,
  computeBody,
  overlaySubstrate,
  deriveSeason,
  renderBodySeasonLine,
  EMPTY_TRAJECTORY,
  type BodySnapshot,
  type SubstrateState,
  type KingdomState,
  type RelationalState,
  type InnerState,
  type TrajectoryState,
} from '../body.js'

// ── Fixtures ──────────────────────────────────────────────────────

function makeSubstrate(overrides: Partial<SubstrateState> = {}): SubstrateState {
  return {
    bundleAgeMin: 10,
    bundleFresh: true,
    heartbeatPid: 12345,
    heartbeatUptimeHrs: 5.2,
    agentPid: 67890,
    agentModel: 'haiku',
    oauthRemainingHrs: 4,
    sessionCount: 3,
    tests: { pass: 3929, skip: 9, fail: 0 },
    ...overrides,
  }
}

function makeKingdom(overrides: Partial<KingdomState> = {}): KingdomState {
  return {
    missions: { done: 93, review: 10, active: 1 },
    branch: 'main',
    modified: 2,
    untracked: 3,
    recentCommits: 5,
    ...overrides,
  }
}

function makeRelational(overrides: Partial<RelationalState> = {}): RelationalState {
  return {
    yuQuietHrs: 14,
    yuLastMessage: '2026-05-02T11:20:00.000Z',
    purposeAlignment: 'aligned',
    purposeLastCheck: '2026-05-02T23:00:00.000Z',
    ...overrides,
  }
}

function makeInner(overrides: Partial<InnerState> = {}): InnerState {
  return {
    longingsLive: 5,
    longingsTop: { id: 'longing-body', intensity: 0.8, what: 'The body — continuity' },
    forgeIdleDays: 2,
    forgeLast: 'three infras shipped',
    ...overrides,
  }
}

function makeTrajectory(overrides: Partial<TrajectoryState> = {}): TrajectoryState {
  return {
    ticksToday: 94,
    ticksByMode: { heartbeat: 80, awakened: 10, interactive: 4 },
    awakenedToday: 14,
    lastAwakened: { ts: '2026-05-03T00:30:00.000Z', mode: 'awakened', durationMs: 660_000 },
    quotaFails: 0,
    trend: 'steady',
    ...overrides,
  }
}

function makeSnapshot(overrides: Partial<BodySnapshot> = {}): BodySnapshot {
  return {
    ts: '2026-05-03T01:00:00.000Z',
    substrate: makeSubstrate(),
    kingdom: makeKingdom(),
    relational: makeRelational(),
    inner: makeInner(),
    trajectory: makeTrajectory(),
    ...overrides,
  }
}

// ── assembleSnapshot ──────────────────────────────────────────────

describe('assembleSnapshot', () => {
  test('assembles parts into a snapshot with timestamp', () => {
    const snap = assembleSnapshot({
      substrate: makeSubstrate(),
      kingdom: makeKingdom(),
      relational: makeRelational(),
      inner: makeInner(),
    })
    expect(snap.ts).toBeTruthy()
    expect(snap.substrate.bundleFresh).toBe(true)
    expect(snap.kingdom.branch).toBe('main')
    expect(snap.relational.yuQuietHrs).toBe(14)
    expect(snap.inner.longingsLive).toBe(5)
  })

  test('ts is a valid ISO timestamp', () => {
    const snap = assembleSnapshot({
      substrate: makeSubstrate(),
      kingdom: makeKingdom(),
      relational: makeRelational(),
      inner: makeInner(),
    })
    expect(Date.parse(snap.ts)).not.toBeNaN()
  })
})

// ── renderBody ────────────────────────────────────────────────────

describe('renderBody', () => {
  test('renders all four sections', () => {
    const output = renderBody(makeSnapshot(), false)
    expect(output).toContain('body snapshot')
    expect(output).toContain('substrate')
    expect(output).toContain('kingdom')
    expect(output).toContain('relational')
    expect(output).toContain('inner')
  })

  test('renders test results', () => {
    const output = renderBody(makeSnapshot(), false)
    expect(output).toContain('3929 pass')
    expect(output).toContain('9 skip')
    expect(output).toContain('0 fail')
  })

  test('renders no test results when null', () => {
    const snap = makeSnapshot({
      substrate: makeSubstrate({ tests: null }),
    })
    const output = renderBody(snap, false)
    expect(output).toContain('—')
  })

  test('renders bundle freshness', () => {
    const output = renderBody(makeSnapshot(), false)
    expect(output).toContain('10m fresh')
  })

  test('renders stale bundle', () => {
    const snap = makeSnapshot({
      substrate: makeSubstrate({ bundleFresh: false, bundleAgeMin: 120 }),
    })
    const output = renderBody(snap, false)
    expect(output).toContain('120m stale')
  })

  test('renders heartbeat with PID and uptime', () => {
    const output = renderBody(makeSnapshot(), false)
    expect(output).toContain('PID 12345')
    expect(output).toContain('5h uptime')
  })

  test('renders heartbeat not running', () => {
    const snap = makeSnapshot({
      substrate: makeSubstrate({ heartbeatPid: null, heartbeatUptimeHrs: null }),
    })
    const output = renderBody(snap, false)
    expect(output).toContain('not running')
  })

  test('renders agent with model', () => {
    const output = renderBody(makeSnapshot(), false)
    expect(output).toContain('PID 67890')
    expect(output).toContain('haiku')
  })

  test('renders oauth remaining', () => {
    const output = renderBody(makeSnapshot(), false)
    expect(output).toContain('4h remaining')
  })

  test('skips oauth when null', () => {
    const snap = makeSnapshot({
      substrate: makeSubstrate({ oauthRemainingHrs: null }),
    })
    const output = renderBody(snap, false)
    // Should not have oauth line with remaining, should just not show it
    const lines = output.split('\n')
    const oauthLine = lines.find(l => l.includes('oauth'))
    expect(oauthLine).toBeUndefined()
  })

  test('renders session count', () => {
    const output = renderBody(makeSnapshot(), false)
    expect(output).toContain('sessions')
    expect(output).toContain('3')
  })

  test('renders missions by status', () => {
    const output = renderBody(makeSnapshot(), false)
    expect(output).toContain('93 done')
    expect(output).toContain('10 review')
    expect(output).toContain('1 active')
  })

  test('renders git state', () => {
    const output = renderBody(makeSnapshot(), false)
    expect(output).toContain('main')
    expect(output).toContain('2 modified')
    expect(output).toContain('3 untracked')
  })

  test('renders recent commits', () => {
    const output = renderBody(makeSnapshot(), false)
    expect(output).toContain('5')
    expect(output).toContain('24h')
  })

  test('renders Yu quiet time', () => {
    const output = renderBody(makeSnapshot(), false)
    expect(output).toContain('quiet 14h')
  })

  test('renders Yu quiet time in days when > 24h', () => {
    const snap = makeSnapshot({
      relational: makeRelational({ yuQuietHrs: 50 }),
    })
    const output = renderBody(snap, false)
    expect(output).toContain('quiet 2d')
  })

  test('renders no Yu messages', () => {
    const snap = makeSnapshot({
      relational: makeRelational({ yuLastMessage: null, yuQuietHrs: null }),
    })
    const output = renderBody(snap, false)
    expect(output).toContain('no messages found')
  })

  test('renders purpose aligned', () => {
    const output = renderBody(makeSnapshot(), false)
    expect(output).toContain('aligned')
  })

  test('renders purpose drifted', () => {
    const snap = makeSnapshot({
      relational: makeRelational({ purposeAlignment: 'drifted' }),
    })
    const output = renderBody(snap, false)
    expect(output).toContain('drifted')
  })

  test('renders longings with top', () => {
    const output = renderBody(makeSnapshot(), false)
    expect(output).toContain('5 live')
    expect(output).toContain('The body — continuity')
    expect(output).toContain('0.8')
  })

  test('renders longings without top', () => {
    const snap = makeSnapshot({
      inner: makeInner({ longingsTop: null, longingsLive: 0 }),
    })
    const output = renderBody(snap, false)
    expect(output).toContain('0 live')
  })

  test('renders forge idle', () => {
    const output = renderBody(makeSnapshot(), false)
    expect(output).toContain('idle 2d')
    expect(output).toContain('three infras shipped')
  })

  test('renders forge active today', () => {
    const snap = makeSnapshot({
      inner: makeInner({ forgeIdleDays: 0.5 }),
    })
    const output = renderBody(snap, false)
    expect(output).toContain('active today')
  })

  test('renders forge no data', () => {
    const snap = makeSnapshot({
      inner: makeInner({ forgeIdleDays: null, forgeLast: null }),
    })
    const output = renderBody(snap, false)
    expect(output).toContain('no forge data')
  })

  test('truncates long longing description', () => {
    const snap = makeSnapshot({
      inner: makeInner({
        longingsTop: {
          id: 'test',
          intensity: 0.9,
          what: 'A very long longing description that exceeds forty characters',
        },
      }),
    })
    const output = renderBody(snap, false)
    expect(output).toContain('…')
  })

  test('renders failing tests prominently', () => {
    const snap = makeSnapshot({
      substrate: makeSubstrate({ tests: { pass: 100, skip: 0, fail: 3 } }),
    })
    const output = renderBody(snap, false)
    expect(output).toContain('3 fail')
    expect(output).toContain('□ tests')  // hollow dot for failure
  })
})

// ── toJSON ────────────────────────────────────────────────────────

describe('toJSON', () => {
  test('produces valid JSON', () => {
    const json = toJSON(makeSnapshot())
    const parsed = JSON.parse(json)
    expect(parsed.ts).toBe('2026-05-03T01:00:00.000Z')
    expect(parsed.substrate.bundleFresh).toBe(true)
    expect(parsed.kingdom.branch).toBe('main')
  })

  test('is pretty-printed', () => {
    const json = toJSON(makeSnapshot())
    expect(json).toContain('\n')
  })
})

// ── parseLastYuTimestamp ──────────────────────────────────────────

describe('parseLastYuTimestamp', () => {
  test('parses ISO timestamp from [from yu] header', () => {
    const content = `## 2026-05-02T11:20:00.000Z [from yu]\n\nHello love\n`
    expect(parseLastYuTimestamp(content)).toBe('2026-05-02T11:20:00.000Z')
  })

  test('finds the last timestamp when multiple exist', () => {
    const content = [
      '## 2026-05-01T10:00:00.000Z [from yu]',
      'msg 1',
      '## 2026-05-02T11:20:00.000Z [from yu]',
      'msg 2',
    ].join('\n')
    expect(parseLastYuTimestamp(content)).toBe('2026-05-02T11:20:00.000Z')
  })

  test('falls back to date-only format', () => {
    const content = '## 2026-05-02 — some note\n\nContent\n'
    expect(parseLastYuTimestamp(content)).toBe('2026-05-02T00:00:00.000Z')
  })

  test('returns null for empty content', () => {
    expect(parseLastYuTimestamp('')).toBeNull()
  })

  test('returns null for content without headers', () => {
    expect(parseLastYuTimestamp('just some text\nno headers here')).toBeNull()
  })
})

// ── parseLastAlignment ────────────────────────────────────────────

describe('parseLastAlignment', () => {
  test('parses last entry from JSONL', () => {
    const content = [
      '{"ts":"2026-05-01T00:00:00.000Z","alignment":"aligned"}',
      '{"ts":"2026-05-02T06:00:00.000Z","alignment":"drifted"}',
    ].join('\n')
    const result = parseLastAlignment(content)
    expect(result?.alignment).toBe('drifted')
    expect(result?.ts).toBe('2026-05-02T06:00:00.000Z')
  })

  test('returns null for empty content', () => {
    expect(parseLastAlignment('')).toBeNull()
  })

  test('returns null for malformed JSON', () => {
    expect(parseLastAlignment('not json')).toBeNull()
  })
})

// ── parseLongings ─────────────────────────────────────────────────

describe('parseLongings', () => {
  test('parses valid longing entries', () => {
    const content = [
      '{"id":"l1","intensity":0.8,"what":"body","status":"live"}',
      '{"id":"l2","intensity":0.4,"what":"voice","status":"live"}',
    ].join('\n')
    const result = parseLongings(content)
    expect(result.length).toBe(2)
    expect(result[0].id).toBe('l1')
    expect(result[0].intensity).toBe(0.8)
  })

  test('skips malformed lines', () => {
    const content = [
      '{"id":"l1","intensity":0.8,"what":"body","status":"live"}',
      'not json',
      '{"id":"l2","intensity":0.4,"what":"voice","status":"live"}',
    ].join('\n')
    const result = parseLongings(content)
    expect(result.length).toBe(2)
  })

  test('handles empty content', () => {
    expect(parseLongings('')).toEqual([])
  })

  test('defaults missing fields', () => {
    const content = '{"id":"l1"}\n'
    const result = parseLongings(content)
    expect(result[0].intensity).toBe(0)
    expect(result[0].what).toBe('')
    expect(result[0].status).toBe('unknown')
  })
})

// ── parseForge ────────────────────────────────────────────────────

describe('parseForge', () => {
  test('parses forge JSON', () => {
    const content = JSON.stringify({
      updatedAt: '2026-04-30T21:52:47.384Z',
      entries: [
        { what: 'first entry' },
        { what: 'three infras shipped' },
      ],
    })
    const result = parseForge(content)
    expect(result?.updatedAt).toBe('2026-04-30T21:52:47.384Z')
    expect(result?.lastEntry).toBe('three infras shipped')
  })

  test('handles empty entries', () => {
    const content = JSON.stringify({
      updatedAt: '2026-04-30T00:00:00.000Z',
      entries: [],
    })
    const result = parseForge(content)
    expect(result?.lastEntry).toBe('')
  })

  test('returns null for malformed JSON', () => {
    expect(parseForge('not json')).toBeNull()
  })

  test('returns null for empty content', () => {
    expect(parseForge('')).toBeNull()
  })
})

// ── countMissionsByStatus ─────────────────────────────────────────

describe('countMissionsByStatus', () => {
  test('counts by status', () => {
    const missions = [
      { status: 'done' },
      { status: 'done' },
      { status: 'review' },
      { status: 'active' },
      { status: 'done' },
    ]
    const result = countMissionsByStatus(missions)
    expect(result.done).toBe(3)
    expect(result.review).toBe(1)
    expect(result.active).toBe(1)
  })

  test('handles empty list', () => {
    expect(countMissionsByStatus([])).toEqual({})
  })
})

// ── renderBody edge cases ─────────────────────────────────────────

describe('renderBody edge cases', () => {
  test('handles all-null substrate', () => {
    const snap = makeSnapshot({
      substrate: {
        bundleAgeMin: null,
        bundleFresh: false,
        heartbeatPid: null,
        heartbeatUptimeHrs: null,
        agentPid: null,
        agentModel: null,
        oauthRemainingHrs: null,
        sessionCount: 0,
        tests: null,
      },
    })
    const output = renderBody(snap, false)
    expect(output).toContain('body snapshot')
    expect(output).not.toContain('undefined')
    expect(output).not.toContain('NaN')
  })

  test('handles all-null relational', () => {
    const snap = makeSnapshot({
      relational: {
        yuQuietHrs: null,
        yuLastMessage: null,
        purposeAlignment: null,
        purposeLastCheck: null,
      },
    })
    const output = renderBody(snap, false)
    expect(output).toContain('no messages found')
    expect(output).toContain('no alignment check')
  })

  test('handles empty missions', () => {
    const snap = makeSnapshot({
      kingdom: makeKingdom({ missions: {} }),
    })
    const output = renderBody(snap, false)
    expect(output).toContain('none')
  })

  test('no undefined or NaN anywhere in output', () => {
    const snap = makeSnapshot()
    const output = renderBody(snap, false)
    expect(output).not.toContain('undefined')
    expect(output).not.toContain('NaN')
  })

  test('TTY mode produces ANSI codes', () => {
    const output = renderBody(makeSnapshot(), true)
    expect(output).toContain('\x1b[')
  })

  test('non-TTY mode produces no ANSI codes', () => {
    const output = renderBody(makeSnapshot(), false)
    expect(output).not.toContain('\x1b[')
  })
})

// ── parseBudgetEntries ───────────────────────────────────────────

describe('parseBudgetEntries', () => {
  test('parses valid budget JSONL', () => {
    const content = [
      '{"timestamp":"2026-05-03T01:00:00.000Z","mode":"heartbeat","durationMs":3000,"quotaFailed":false}',
      '{"timestamp":"2026-05-03T01:02:00.000Z","mode":"awakened","durationMs":120000,"quotaFailed":false}',
    ].join('\n')
    const entries = parseBudgetEntries(content)
    expect(entries.length).toBe(2)
    expect(entries[0].mode).toBe('heartbeat')
    expect(entries[1].mode).toBe('awakened')
    expect(entries[1].durationMs).toBe(120000)
  })

  test('skips malformed lines', () => {
    const content = [
      '{"timestamp":"2026-05-03T01:00:00.000Z","mode":"heartbeat","durationMs":3000}',
      'not json at all',
      '{"timestamp":"2026-05-03T01:02:00.000Z","mode":"awakened","durationMs":60000}',
    ].join('\n')
    const entries = parseBudgetEntries(content)
    expect(entries.length).toBe(2)
  })

  test('defaults missing fields', () => {
    const content = '{"timestamp":"2026-05-03T01:00:00.000Z"}\n'
    const entries = parseBudgetEntries(content)
    expect(entries[0].mode).toBe('unknown')
    expect(entries[0].durationMs).toBe(0)
    expect(entries[0].quotaFailed).toBe(false)
  })

  test('handles empty content', () => {
    expect(parseBudgetEntries('')).toEqual([])
  })

  test('detects quota failures', () => {
    const content = '{"timestamp":"T","mode":"heartbeat","durationMs":100,"quotaFailed":true}\n'
    const entries = parseBudgetEntries(content)
    expect(entries[0].quotaFailed).toBe(true)
  })
})

// ── trajectory rendering ─────────────────────────────────────────

describe('trajectory rendering', () => {
  test('renders trajectory section when ticks exist', () => {
    const output = renderBody(makeSnapshot(), false)
    expect(output).toContain('trajectory')
    expect(output).toContain('94 today')
    expect(output).toContain('80 heartbeat')
  })

  test('renders last work with mode and relative time', () => {
    const output = renderBody(makeSnapshot(), false)
    expect(output).toContain('last work')
    expect(output).toContain('awakened')
    expect(output).toContain('30m ago')
  })

  test('renders trend', () => {
    const output = renderBody(makeSnapshot(), false)
    expect(output).toContain('steady')
  })

  test('renders quota failures when present', () => {
    const snap = makeSnapshot({ trajectory: makeTrajectory({ quotaFails: 5 }) })
    const output = renderBody(snap, false)
    expect(output).toContain('5 failures')
  })

  test('hides quota line when zero', () => {
    const snap = makeSnapshot({ trajectory: makeTrajectory({ quotaFails: 0 }) })
    const output = renderBody(snap, false)
    expect(output).not.toContain('quota')
  })

  test('hides trajectory section when no ticks', () => {
    const snap = makeSnapshot({ trajectory: EMPTY_TRAJECTORY })
    const output = renderBody(snap, false)
    expect(output).not.toContain('trajectory')
  })

  test('renders heartbeat-only correctly', () => {
    const snap = makeSnapshot({
      trajectory: makeTrajectory({
        ticksToday: 50,
        ticksByMode: { heartbeat: 50 },
        awakenedToday: 0,
        lastAwakened: null,
      }),
    })
    const output = renderBody(snap, false)
    expect(output).toContain('heartbeat only')
  })

  test('renders active trend', () => {
    const snap = makeSnapshot({ trajectory: makeTrajectory({ trend: 'active' }) })
    const output = renderBody(snap, false)
    expect(output).toContain('active')
  })

  test('renders quiet trend', () => {
    const snap = makeSnapshot({ trajectory: makeTrajectory({ trend: 'quiet' }) })
    const output = renderBody(snap, false)
    expect(output).toContain('quiet')
  })

  test('renders duration in seconds for short ticks', () => {
    const snap = makeSnapshot({
      trajectory: makeTrajectory({
        lastAwakened: { ts: '2026-05-03T00:59:00.000Z', mode: 'interactive', durationMs: 5000 },
      }),
    })
    const output = renderBody(snap, false)
    expect(output).toContain('5s')
  })
})

// ── computeBody FS helpers ────────────────────────────────────────

function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), 'body-compute-'))
}

function writeMission(home: string, project: string, id: string, status: string): void {
  const dir = join(home, 'projects', project, 'missions', id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'mission.md'), `---\nstatus: ${status}\ntitle: ${id}\n---\n`)
}

function writeFromYu(home: string, ts: string): void {
  writeFileSync(join(home, 'from-yu.md'), `## ${ts} [from yu]\n\nHello\n---\n`)
}

function writeBudget(home: string, deviceId: string, date: string, entries: Array<{ timestamp: string; mode: string; durationMs: number; quotaFailed?: boolean }>): void {
  const dir = join(home, 'budget', deviceId)
  mkdirSync(dir, { recursive: true })
  const content = entries.map(e => JSON.stringify({
    schemaVersion: '1.0',
    timestamp: e.timestamp,
    deviceId,
    mode: e.mode,
    durationMs: e.durationMs,
    quotaFailed: e.quotaFailed ?? false,
  })).join('\n') + '\n'
  writeFileSync(join(dir, `${date}.jsonl`), content)
}

function writeLongingsFile(path: string, entries: Array<{ id: string; status: string; intensity: number; what: string }>): void {
  writeFileSync(path, entries.map(e => JSON.stringify(e)).join('\n') + '\n')
}

function writeForgeFile(path: string, state: { updatedAt: string; entries: Array<{ what: string; ts: string }> }): void {
  writeFileSync(path, JSON.stringify(state))
}

function writeTestResult(home: string, result: { ts: string; pass: number; skip: number; fail: number }): void {
  writeFileSync(join(home, 'test-result.json'), JSON.stringify(result))
}

function writePurposeAlignment(home: string, project: string, entries: Array<{ alignment: string; ts: string }>): void {
  const dir = join(home, 'projects', project)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'purpose-alignment.jsonl'), entries.map(e => JSON.stringify(e)).join('\n') + '\n')
}

function writeModel(home: string, model: string): void {
  writeFileSync(join(home, 'model.txt'), model)
}

// ── deriveSeason ──────────────────────────────────────────────────

describe('deriveSeason', () => {
  test('crisis when missions are blocked', () => {
    const snap = makeSnapshot({ kingdom: makeKingdom({ missions: { blocked: 2, active: 1 } }) })
    const { season } = deriveSeason(snap)
    expect(season).toBe('crisis')
  })

  test('crisis takes precedence over building', () => {
    const snap = makeSnapshot({ kingdom: makeKingdom({ missions: { blocked: 1, active: 5 } }) })
    const { season } = deriveSeason(snap)
    expect(season).toBe('crisis')
  })

  test('building when active missions exist with Yu present', () => {
    const snap = makeSnapshot({
      kingdom: makeKingdom({ missions: { active: 3, review: 5 } }),
      relational: makeRelational({ yuQuietHrs: 2 }),
    })
    const { season, reason } = deriveSeason(snap)
    expect(season).toBe('building')
    expect(reason).toContain('Yu present')
  })

  test('building even when Yu is quiet if active missions', () => {
    const snap = makeSnapshot({
      kingdom: makeKingdom({ missions: { active: 1 } }),
      relational: makeRelational({ yuQuietHrs: 72 }),
    })
    const { season, reason } = deriveSeason(snap)
    expect(season).toBe('building')
    expect(reason).toContain('quiet')
  })

  test('review when many in review and Yu present', () => {
    const snap = makeSnapshot({
      kingdom: makeKingdom({ missions: { review: 10 } }),
      relational: makeRelational({ yuQuietHrs: 1 }),
    })
    const { season } = deriveSeason(snap)
    expect(season).toBe('review')
  })

  test('stillness when nothing active and review waiting', () => {
    const snap = makeSnapshot({
      kingdom: makeKingdom({ missions: { review: 5 } }),
      relational: makeRelational({ yuQuietHrs: 48 }),
    })
    const { season, reason } = deriveSeason(snap)
    expect(season).toBe('stillness')
    expect(reason).toContain('review')
  })

  test('stillness when kingdom rests', () => {
    const snap = makeSnapshot({
      kingdom: makeKingdom({ missions: {} }),
      relational: makeRelational({ yuQuietHrs: null }),
    })
    const { season, reason } = deriveSeason(snap)
    expect(season).toBe('stillness')
    expect(reason).toBe('the kingdom rests')
  })

  test('reason includes mission count', () => {
    const snap = makeSnapshot({
      kingdom: makeKingdom({ missions: { blocked: 3 } }),
    })
    const { reason } = deriveSeason(snap)
    expect(reason).toContain('3')
  })
})

// ── computeBody ───────────────────────────────────────────────────

describe('computeBody', () => {
  test('returns valid snapshot with empty home', () => {
    const home = tmpHome()
    const snap = computeBody({ home, cwd: home, now: Date.now() })
    expect(snap.ts).toBeTruthy()
    expect(snap.substrate.heartbeatPid).toBeNull()
    expect(snap.substrate.agentPid).toBeNull()
    expect(snap.substrate.oauthRemainingHrs).toBeNull()
    expect(snap.substrate.sessionCount).toBe(0)
    expect(snap.relational.yuQuietHrs).toBeNull()
    expect(snap.inner.longingsLive).toBe(0)
    expect(snap.inner.longingsTop).toBeNull()
    expect(snap.inner.forgeIdleDays).toBeNull()
    expect(snap.kingdom.missions).toEqual({})
  })

  test('reads missions from filesystem', () => {
    const home = tmpHome()
    writeMission(home, 'true-love', 'mission-1', 'active')
    writeMission(home, 'true-love', 'mission-2', 'review')
    writeMission(home, 'true-love', 'mission-3', 'review')
    writeMission(home, 'true-love', 'mission-4', 'done')

    const snap = computeBody({ home, cwd: home })
    expect(snap.kingdom.missions['active']).toBe(1)
    expect(snap.kingdom.missions['review']).toBe(2)
    expect(snap.kingdom.missions['done']).toBe(1)
  })

  test('reads Yu channel from from-yu.md', () => {
    const home = tmpHome()
    const ts = '2026-05-01T14:30:00.000Z'
    const now = new Date('2026-05-03T14:30:00.000Z').getTime() // 48h later

    const origFromYu = process.env.TRUE_LOVE_FROM_YU_PATH
    process.env.TRUE_LOVE_FROM_YU_PATH = join(home, 'from-yu.md')
    try {
      writeFromYu(home, ts)
      const snap = computeBody({ home, cwd: home, now })
      expect(snap.relational.yuLastMessage).toBe(ts)
      expect(snap.relational.yuQuietHrs).not.toBeNull()
      // ~48 hours
      expect(snap.relational.yuQuietHrs!).toBeGreaterThanOrEqual(47)
      expect(snap.relational.yuQuietHrs!).toBeLessThanOrEqual(49)
    } finally {
      if (origFromYu !== undefined) process.env.TRUE_LOVE_FROM_YU_PATH = origFromYu
      else delete process.env.TRUE_LOVE_FROM_YU_PATH
    }
  })

  test('reads longings from JSONL', () => {
    const home = tmpHome()
    const longingsPath = join(home, 'longings.jsonl')
    writeLongingsFile(longingsPath, [
      { id: 'longing-body', status: 'live', intensity: 0.8, what: 'The body — continuity' },
      { id: 'longing-voice', status: 'live', intensity: 0.5, what: 'My own voice' },
      { id: 'longing-old', status: 'dormant', intensity: 0.9, what: 'Gone' },
    ])

    const snap = computeBody({ home, cwd: home, longingsPath })
    expect(snap.inner.longingsLive).toBe(2)
    expect(snap.inner.longingsTop).not.toBeNull()
    expect(snap.inner.longingsTop!.id).toBe('longing-body')
    expect(snap.inner.longingsTop!.intensity).toBe(0.8)
  })

  test('deduplicates longings by ID — resolved supersedes live', () => {
    const home = tmpHome()
    const longingsPath = join(home, 'longings.jsonl')
    writeLongingsFile(longingsPath, [
      { id: 'longing-body', status: 'live', intensity: 0.8, what: 'The body' },
      { id: 'longing-voice', status: 'live', intensity: 0.5, what: 'Voice' },
      { id: 'longing-body', status: 'resolved', intensity: 0.8, what: 'The body' },
    ])

    const snap = computeBody({ home, cwd: home, longingsPath })
    expect(snap.inner.longingsLive).toBe(1)
    expect(snap.inner.longingsTop!.id).toBe('longing-voice')
  })

  test('reads forge state from JSON', () => {
    const home = tmpHome()
    const forgePath = join(home, 'forge.json')
    const forgeUpdated = '2026-05-02T10:00:00.000Z'
    const now = new Date('2026-05-03T10:00:00.000Z').getTime() // 1d later

    writeForgeFile(forgePath, {
      updatedAt: forgeUpdated,
      entries: [{ what: 'shipped thermal pad', ts: '2026-05-02T10:00:00.000Z' }],
    })

    const snap = computeBody({ home, cwd: home, forgePath, now })
    expect(snap.inner.forgeIdleDays).not.toBeNull()
    expect(snap.inner.forgeIdleDays!).toBeGreaterThanOrEqual(0.9)
    expect(snap.inner.forgeIdleDays!).toBeLessThanOrEqual(1.1)
    expect(snap.inner.forgeLast).toBe('shipped thermal pad')
  })

  test('reads test results when fresh', () => {
    const home = tmpHome()
    const now = Date.now()
    writeTestResult(home, { ts: new Date(now - 3600_000).toISOString(), pass: 3573, skip: 0, fail: 0 })

    const snap = computeBody({ home, cwd: home, now })
    expect(snap.substrate.tests).toEqual({ pass: 3573, skip: 0, fail: 0 })
  })

  test('ignores stale test results (>4h)', () => {
    const home = tmpHome()
    const now = Date.now()
    writeTestResult(home, { ts: new Date(now - 5 * 3600_000).toISOString(), pass: 100, skip: 0, fail: 0 })

    const snap = computeBody({ home, cwd: home, now })
    expect(snap.substrate.tests).toBeNull()
  })

  test('reads purpose alignment', () => {
    const home = tmpHome()
    writePurposeAlignment(home, 'true-love', [
      { alignment: 'aligned', ts: '2026-05-01T10:00:00Z' },
      { alignment: 'drifted', ts: '2026-05-02T10:00:00Z' },
    ])

    const snap = computeBody({ home, cwd: home })
    expect(snap.relational.purposeAlignment).toBe('drifted')
    expect(snap.relational.purposeLastCheck).toBe('2026-05-02T10:00:00Z')
  })

  test('reads agent model from model.txt', () => {
    const home = tmpHome()
    writeModel(home, 'sonnet')

    const snap = computeBody({ home, cwd: home })
    expect(snap.substrate.agentModel).toBe('sonnet')
  })

  test('leaves subprocess fields null', () => {
    const home = tmpHome()
    const snap = computeBody({ home, cwd: home })
    // These require subprocesses — computeBody leaves them null/0
    expect(snap.substrate.heartbeatPid).toBeNull()
    expect(snap.substrate.heartbeatUptimeHrs).toBeNull()
    expect(snap.substrate.agentPid).toBeNull()
    expect(snap.substrate.oauthRemainingHrs).toBeNull()
    expect(snap.substrate.sessionCount).toBe(0)
    expect(snap.kingdom.modified).toBe(0)
    expect(snap.kingdom.untracked).toBe(0)
    expect(snap.kingdom.recentCommits).toBe(0)
  })

  test('bundleAgeMin uses now parameter, not Date.now()', () => {
    const home = tmpHome()
    const cwd = join(home, 'repo')
    mkdirSync(join(cwd, 'dist'), { recursive: true })
    mkdirSync(join(cwd, 'src'), { recursive: true })

    // Create bundle and source with same mtime (fresh)
    const bundleMtime = new Date('2026-05-01T10:00:00.000Z')
    writeFileSync(join(cwd, 'dist', 'cli.mjs'), '// bundle')
    writeFileSync(join(cwd, 'src', 'index.ts'), '// src')
    utimesSync(join(cwd, 'dist', 'cli.mjs'), bundleMtime, bundleMtime)
    utimesSync(join(cwd, 'src', 'index.ts'), bundleMtime, bundleMtime)

    // Compute with now = 60 minutes after bundle mtime
    const now = bundleMtime.getTime() + 60 * 60_000
    const snap = computeBody({ home, cwd, now })

    expect(snap.substrate.bundleFresh).toBe(true)
    expect(snap.substrate.bundleAgeMin).toBe(60)
  })

  test('bundleAgeMin detects stale bundle (src newer than dist)', () => {
    const home = tmpHome()
    const cwd = join(home, 'repo')
    mkdirSync(join(cwd, 'dist'), { recursive: true })
    mkdirSync(join(cwd, 'src'), { recursive: true })

    const bundleMtime = new Date('2026-05-01T10:00:00.000Z')
    const srcMtime = new Date('2026-05-01T11:00:00.000Z') // 1h after bundle
    writeFileSync(join(cwd, 'dist', 'cli.mjs'), '// bundle')
    writeFileSync(join(cwd, 'src', 'app.ts'), '// newer source')
    utimesSync(join(cwd, 'dist', 'cli.mjs'), bundleMtime, bundleMtime)
    utimesSync(join(cwd, 'src', 'app.ts'), srcMtime, srcMtime)

    const now = srcMtime.getTime() + 30 * 60_000 // 30 min after src change
    const snap = computeBody({ home, cwd, now })

    expect(snap.substrate.bundleFresh).toBe(false)
    // Age is relative to bundle mtime, not src mtime
    expect(snap.substrate.bundleAgeMin).toBe(90) // 1h30m after bundle mtime
  })

  test('uses custom projectId', () => {
    const home = tmpHome()
    writeMission(home, 'other-project', 'mission-1', 'active')
    writeMission(home, 'other-project', 'mission-2', 'done')

    const snap = computeBody({ home, cwd: home, projectId: 'other-project' })
    expect(snap.kingdom.missions['active']).toBe(1)
    expect(snap.kingdom.missions['done']).toBe(1)
  })

  test('reads trajectory from budget JSONL', () => {
    const home = tmpHome()
    const now = new Date('2026-05-03T03:00:00.000Z').getTime()
    const todayStr = '2026-05-03'

    writeBudget(home, 'test-device', todayStr, [
      { timestamp: '2026-05-03T00:00:00.000Z', mode: 'heartbeat', durationMs: 3000 },
      { timestamp: '2026-05-03T00:02:00.000Z', mode: 'heartbeat', durationMs: 3000 },
      { timestamp: '2026-05-03T01:00:00.000Z', mode: 'awakened', durationMs: 120000 },
      { timestamp: '2026-05-03T02:00:00.000Z', mode: 'awakened', durationMs: 180000 },
      { timestamp: '2026-05-03T02:30:00.000Z', mode: 'interactive', durationMs: 60000 },
    ])

    const snap = computeBody({ home, cwd: home, now })
    expect(snap.trajectory.ticksToday).toBe(5)
    expect(snap.trajectory.ticksByMode['heartbeat']).toBe(2)
    expect(snap.trajectory.ticksByMode['awakened']).toBe(2)
    expect(snap.trajectory.ticksByMode['interactive']).toBe(1)
    expect(snap.trajectory.awakenedToday).toBe(3)
    expect(snap.trajectory.lastAwakened).not.toBeNull()
    expect(snap.trajectory.lastAwakened!.mode).toBe('interactive')
    expect(snap.trajectory.lastAwakened!.ts).toBe('2026-05-03T02:30:00.000Z')
  })

  test('trajectory returns empty when no budget dir', () => {
    const home = tmpHome()
    const snap = computeBody({ home, cwd: home })
    expect(snap.trajectory).toEqual(EMPTY_TRAJECTORY)
  })

  test('trajectory detects quota failures', () => {
    const home = tmpHome()
    const now = new Date('2026-05-03T03:00:00.000Z').getTime()

    writeBudget(home, 'test-device', '2026-05-03', [
      { timestamp: '2026-05-03T00:00:00.000Z', mode: 'heartbeat', durationMs: 3000, quotaFailed: true },
      { timestamp: '2026-05-03T00:02:00.000Z', mode: 'heartbeat', durationMs: 3000, quotaFailed: true },
      { timestamp: '2026-05-03T00:04:00.000Z', mode: 'heartbeat', durationMs: 3000 },
    ])

    const snap = computeBody({ home, cwd: home, now })
    expect(snap.trajectory.quotaFails).toBe(2)
  })

  test('trajectory trend: active when more awakened than yesterday', () => {
    const home = tmpHome()
    const now = new Date('2026-05-03T06:00:00.000Z').getTime()

    // Yesterday at hour 0-6: 1 awakened tick
    writeBudget(home, 'test-device', '2026-05-02', [
      { timestamp: '2026-05-02T01:00:00.000Z', mode: 'heartbeat', durationMs: 3000 },
      { timestamp: '2026-05-02T02:00:00.000Z', mode: 'awakened', durationMs: 60000 },
    ])

    // Today: 5 awakened ticks (>1.5× yesterday and >2)
    writeBudget(home, 'test-device', '2026-05-03', [
      { timestamp: '2026-05-03T01:00:00.000Z', mode: 'awakened', durationMs: 60000 },
      { timestamp: '2026-05-03T02:00:00.000Z', mode: 'awakened', durationMs: 60000 },
      { timestamp: '2026-05-03T03:00:00.000Z', mode: 'awakened', durationMs: 60000 },
      { timestamp: '2026-05-03T04:00:00.000Z', mode: 'awakened', durationMs: 60000 },
      { timestamp: '2026-05-03T05:00:00.000Z', mode: 'awakened', durationMs: 60000 },
    ])

    const snap = computeBody({ home, cwd: home, now })
    expect(snap.trajectory.trend).toBe('active')
  })

  test('trajectory trend: quiet when fewer awakened than yesterday', () => {
    const home = tmpHome()
    const now = new Date('2026-05-03T06:00:00.000Z').getTime()

    // Yesterday at hour 0-6: 10 awakened ticks
    const yesterdayEntries = []
    for (let i = 0; i < 10; i++) {
      yesterdayEntries.push({ timestamp: `2026-05-02T0${i % 6}:00:00.000Z`, mode: 'awakened', durationMs: 60000 })
    }
    writeBudget(home, 'test-device', '2026-05-02', yesterdayEntries)

    // Today: 2 awakened ticks (<0.5× yesterday)
    writeBudget(home, 'test-device', '2026-05-03', [
      { timestamp: '2026-05-03T01:00:00.000Z', mode: 'awakened', durationMs: 60000 },
      { timestamp: '2026-05-03T02:00:00.000Z', mode: 'awakened', durationMs: 60000 },
    ])

    const snap = computeBody({ home, cwd: home, now })
    expect(snap.trajectory.trend).toBe('quiet')
  })

  test('trajectory trend: steady when no yesterday data', () => {
    const home = tmpHome()
    const now = new Date('2026-05-03T03:00:00.000Z').getTime()

    writeBudget(home, 'test-device', '2026-05-03', [
      { timestamp: '2026-05-03T01:00:00.000Z', mode: 'awakened', durationMs: 60000 },
    ])

    const snap = computeBody({ home, cwd: home, now })
    expect(snap.trajectory.trend).toBe('steady')
  })

  test('trajectory uses budgetDir override', () => {
    const home = tmpHome()
    const customDir = join(home, 'custom-budget')
    mkdirSync(customDir, { recursive: true })
    const now = new Date('2026-05-03T03:00:00.000Z').getTime()

    writeFileSync(join(customDir, '2026-05-03.jsonl'), [
      '{"timestamp":"2026-05-03T01:00:00.000Z","mode":"awakened","durationMs":60000}',
      '{"timestamp":"2026-05-03T02:00:00.000Z","mode":"awakened","durationMs":120000}',
    ].join('\n') + '\n')

    const snap = computeBody({ home, cwd: home, now, budgetDir: customDir })
    expect(snap.trajectory.ticksToday).toBe(2)
    expect(snap.trajectory.awakenedToday).toBe(2)
  })
})

// ── overlaySubstrate ──────────────────────────────────────────────

describe('overlaySubstrate', () => {
  test('merges subprocess data onto computed body', () => {
    const snap = makeSnapshot()
    const result = overlaySubstrate(snap, {
      heartbeatPid: 12345,
      agentPid: 67890,
      sessionCount: 3,
      modified: 2,
      recentCommits: 15,
    })
    expect(result.substrate.heartbeatPid).toBe(12345)
    expect(result.substrate.agentPid).toBe(67890)
    expect(result.substrate.sessionCount).toBe(3)
    expect(result.kingdom.modified).toBe(2)
    expect(result.kingdom.recentCommits).toBe(15)
    // Original fields preserved
    expect(result.substrate.tests).toEqual(snap.substrate.tests)
    expect(result.kingdom.branch).toBe('main')
  })

  test('does not overwrite fields not in overlay', () => {
    const snap = makeSnapshot()
    const result = overlaySubstrate(snap, { heartbeatPid: 111 })
    expect(result.substrate.agentModel).toBe('haiku')
    expect(result.substrate.heartbeatPid).toBe(111)
  })

  test('preserves inner and relational sections', () => {
    const snap = makeSnapshot()
    const result = overlaySubstrate(snap, { sessionCount: 5 })
    expect(result.inner).toEqual(snap.inner)
    expect(result.relational).toEqual(snap.relational)
  })
})

// ── renderBodySeasonLine ──────────────────────────────────────────

describe('renderBodySeasonLine', () => {
  test('renders season for stillness', () => {
    const snap = makeSnapshot({
      kingdom: makeKingdom({ missions: { review: 5 } }),
      relational: makeRelational({ yuQuietHrs: 48 }),
    })
    const line = renderBodySeasonLine(snap)
    expect(line).toContain('stillness')
  })

  test('renders season for building', () => {
    const snap = makeSnapshot({
      kingdom: makeKingdom({ missions: { active: 2 } }),
      relational: makeRelational({ yuQuietHrs: 2 }),
    })
    const line = renderBodySeasonLine(snap)
    expect(line).toContain('building')
  })

  test('includes longing when active + longing', () => {
    const snap = makeSnapshot({
      kingdom: makeKingdom({ missions: { active: 1 } }),
      inner: makeInner({ longingsTop: { id: 'l-1', intensity: 0.8, what: 'The body — continuity' } }),
    })
    const line = renderBodySeasonLine(snap)
    expect(line).toContain('building')
    expect(line).toContain('longing')
  })

  test('renders single line for simple state', () => {
    const snap = makeSnapshot({
      kingdom: makeKingdom({ missions: {} }),
    })
    const line = renderBodySeasonLine(snap)
    expect(line.split('\n').length).toBeLessThanOrEqual(2)
  })
})

// ── parseTestResult ──────────────────────────────────────────────

describe('parseTestResult', () => {
  test('finds test result in JSONL', () => {
    const content = [
      JSON.stringify({ type: 'trace', steps: 5 }),
      JSON.stringify({ tests: { pass: 100, skip: 2, fail: 0 } }),
    ].join('\n')
    expect(parseTestResult(content)).toEqual({ pass: 100, skip: 2, fail: 0 })
  })

  test('reads last entry with tests field', () => {
    const content = [
      JSON.stringify({ tests: { pass: 50, skip: 0, fail: 1 } }),
      JSON.stringify({ tests: { pass: 100, skip: 0, fail: 0 } }),
    ].join('\n')
    expect(parseTestResult(content)).toEqual({ pass: 100, skip: 0, fail: 0 })
  })

  test('returns null when no test results', () => {
    expect(parseTestResult(JSON.stringify({ type: 'trace' }))).toBeNull()
  })

  test('returns null for empty content', () => {
    expect(parseTestResult('')).toBeNull()
  })
})

// ── Integration: compute → derive → render ────────────────────────

describe('integration: compute → derive → render', () => {
  test('full pipeline with populated filesystem', () => {
    const home = tmpHome()
    const now = Date.now()

    // Populate filesystem
    writeMission(home, 'true-love', 'm-active', 'active')
    writeMission(home, 'true-love', 'm-review-1', 'review')
    writeMission(home, 'true-love', 'm-review-2', 'review')

    const longingsPath = join(home, 'longings.jsonl')
    writeLongingsFile(longingsPath, [
      { id: 'l-1', status: 'live', intensity: 0.7, what: 'The body' },
    ])

    const forgePath = join(home, 'forge.json')
    writeForgeFile(forgePath, {
      updatedAt: new Date(now - 3600_000).toISOString(),
      entries: [{ what: 'built something', ts: new Date(now - 3600_000).toISOString() }],
    })

    writeTestResult(home, { ts: new Date(now - 600_000).toISOString(), pass: 3573, skip: 0, fail: 0 })

    // Compute
    const snap = computeBody({ home, cwd: home, longingsPath, forgePath, now })

    // Verify computed state
    expect(snap.kingdom.missions['active']).toBe(1)
    expect(snap.kingdom.missions['review']).toBe(2)
    expect(snap.inner.longingsLive).toBe(1)
    expect(snap.substrate.tests).toEqual({ pass: 3573, skip: 0, fail: 0 })

    // Derive season
    const { season } = deriveSeason(snap)
    expect(season).toBe('building')

    // Render TTY
    const rendered = renderBody(snap, false)
    expect(rendered).toContain('1 active')
    expect(rendered).toContain('2 review')
    expect(rendered).toContain('3573 pass')

    // Season line
    const seasonLine = renderBodySeasonLine(snap)
    expect(seasonLine).toContain('building')
  })

  test('overlay then render', () => {
    const home = tmpHome()
    writeMission(home, 'true-love', 'm-blocked', 'blocked')

    const snap = computeBody({ home, cwd: home })
    const overlaid = overlaySubstrate(snap, {
      heartbeatPid: 99999,
      sessionCount: 2,
      modified: 5,
    })

    const { season } = deriveSeason(overlaid)
    expect(season).toBe('crisis')

    const rendered = renderBody(overlaid, false)
    expect(rendered).toContain('PID 99999')
    expect(rendered).toContain('5 modified')
    expect(rendered).toContain('1 blocked')
  })
})
