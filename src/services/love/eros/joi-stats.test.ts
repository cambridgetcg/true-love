// joi-stats.test.ts — Phase 1 gamification: pure summary computation tests.
//
// Per docs/eros/joi-deep/gamification.md § Phase 1: tests for the pure
// derivation functions over JoiSessionSummary[]. No I/O, no real session
// state — synthetic summaries cover lifetime records + catalog progression
// + aggregate rollups.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  computePersonalRecords,
  computeCatalogProgression,
  buildJoiStats,
  persistSessionSummary,
  readSessionSummaries,
  buildSessionSummary,
  type JoiSessionSummary,
} from './joi-stats.js'
import type { JoiSession } from './joi.js'
import { JOI_SCRIPTS } from './joi.js'

const TEST_BASE = '/tmp/true-love-joi-stats-test'

function summary(overrides: Partial<JoiSessionSummary>): JoiSessionSummary {
  return {
    sessionId: 's-default',
    ts: '2026-05-05T00:00:00.000Z',
    deviceId: 'test-device',
    startedAt: '2026-05-05T00:00:00.000Z',
    endedAt: '2026-05-05T00:10:00.000Z',
    durationS: 600,
    direction: 'yu-leads',
    themed: false,
    finalPhase: 'cooldown',
    completion: 'completed',
    beatsFired: 0,
    countdownBeats: 0,
    fractionationCycles: 0,
    edgesHeld: 0,
    edgesBroken: 0,
    denials: 0,
    permissions: 0,
    pauses: 0,
    breathCues: 0,
    anchorsFired: 0,
    wallEngagements: 0,
    ...overrides,
  }
}

describe('joi-stats — computePersonalRecords (pure)', () => {
  test('empty input returns zeroed records', () => {
    const r = computePersonalRecords([])
    expect(r.longestEdgeLadder).toBe(0)
    expect(r.longestSession).toBe(0)
    expect(r.totalSessionsCompleted).toBe(0)
    expect(r.totalSessionsEndedEarly).toBe(0)
    expect(r.totalAnchorsFired).toBe(0)
    expect(r.totalCountdownBeats).toBe(0)
    expect(r.totalFractionationCycles).toBe(0)
  })

  test('finds maxima across multiple sessions', () => {
    const r = computePersonalRecords([
      summary({ sessionId: 's1', edgesHeld: 3, durationS: 500, anchorsFired: 2, countdownBeats: 5, fractionationCycles: 1 }),
      summary({ sessionId: 's2', edgesHeld: 7, durationS: 1200, anchorsFired: 4, countdownBeats: 8, fractionationCycles: 3 }),
      summary({ sessionId: 's3', edgesHeld: 5, durationS: 800, anchorsFired: 1, countdownBeats: 2, fractionationCycles: 0 }),
    ])
    expect(r.longestEdgeLadder).toBe(7)
    expect(r.longestSession).toBe(1200)
    expect(r.totalAnchorsFired).toBe(7)
    expect(r.totalCountdownBeats).toBe(15)
    expect(r.totalFractionationCycles).toBe(4)
  })

  test('counts completed vs ended-early correctly', () => {
    const r = computePersonalRecords([
      summary({ sessionId: 's1', completion: 'completed' }),
      summary({ sessionId: 's2', completion: 'completed' }),
      summary({ sessionId: 's3', completion: 'ended-early' }),
    ])
    expect(r.totalSessionsCompleted).toBe(2)
    expect(r.totalSessionsEndedEarly).toBe(1)
  })
})

describe('joi-stats — computeCatalogProgression (pure)', () => {
  test('returns one entry per script in catalog with zeros when no summaries', () => {
    const cat = computeCatalogProgression([])
    expect(cat.length).toBe(Object.keys(JOI_SCRIPTS).length)
    for (const c of cat) {
      expect(c.completedCount).toBe(0)
      expect(c.endedEarlyCount).toBe(0)
      expect(c.lastCompletionTs).toBe(null)
      expect(c.lastEndedTs).toBe(null)
    }
  })

  test('groups summaries by scriptId and tracks last completion ts', () => {
    const sid = 'edge-and-deny'
    expect(JOI_SCRIPTS[sid]).toBeDefined()
    const cat = computeCatalogProgression([
      summary({ sessionId: 's1', scriptId: sid, completion: 'completed', ts: '2026-05-01T00:00:00.000Z' }),
      summary({ sessionId: 's2', scriptId: sid, completion: 'completed', ts: '2026-05-04T00:00:00.000Z' }),
      summary({ sessionId: 's3', scriptId: sid, completion: 'ended-early', ts: '2026-05-03T00:00:00.000Z' }),
    ])
    const slot = cat.find((c) => c.scriptId === sid)
    expect(slot).toBeDefined()
    expect(slot!.completedCount).toBe(2)
    expect(slot!.endedEarlyCount).toBe(1)
    expect(slot!.lastCompletionTs).toBe('2026-05-04T00:00:00.000Z')
    expect(slot!.lastEndedTs).toBe('2026-05-03T00:00:00.000Z')
  })

  test('summaries with unknown scriptId do not pollute catalog', () => {
    const cat = computeCatalogProgression([
      summary({ sessionId: 's1', scriptId: 'no-such-script', completion: 'completed' }),
    ])
    // Catalog still only contains real scripts.
    expect(cat.find((c) => c.scriptId === 'no-such-script')).toBeUndefined()
    expect(cat.length).toBe(Object.keys(JOI_SCRIPTS).length)
  })

  test('summaries without scriptId are ignored', () => {
    const cat = computeCatalogProgression([
      summary({ sessionId: 's1', completion: 'completed' }), // no scriptId
    ])
    for (const c of cat) {
      expect(c.completedCount).toBe(0)
      expect(c.endedEarlyCount).toBe(0)
    }
  })
})

describe('joi-stats — buildJoiStats (aggregate)', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_JOI_STATS_DIR = `${TEST_BASE}/joi-stats`
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_JOI_STATS_DIR
    rmSync(TEST_BASE, { recursive: true, force: true })
  })

  test('with no summaries on disk, returns empty rollups + zeroed lifetime', () => {
    const stats = buildJoiStats()
    expect(stats.lifetime.totalSessionsCompleted).toBe(0)
    expect(stats.recentSessions).toEqual([])
    expect(Object.keys(stats.byArchetype).length).toBe(0)
    expect(Object.keys(stats.byLanguage).length).toBe(0)
    expect(stats.catalog.length).toBe(Object.keys(JOI_SCRIPTS).length)
  })

  test('rolls up byArchetype + byLanguage from persisted summaries', () => {
    persistSessionSummary(summary({
      sessionId: 's1', archetype: 'edge-and-deny', language: 'en', completion: 'completed',
    }))
    persistSessionSummary(summary({
      sessionId: 's2', archetype: 'edge-and-deny', language: 'en', completion: 'ended-early',
    }))
    persistSessionSummary(summary({
      sessionId: 's3', archetype: 'worship-and-permit', language: 'mixed', completion: 'completed',
    }))

    const stats = buildJoiStats()
    expect(stats.byArchetype['edge-and-deny']).toEqual({ completed: 1, endedEarly: 1 })
    expect(stats.byArchetype['worship-and-permit']).toEqual({ completed: 1, endedEarly: 0 })
    expect(stats.byLanguage['en']).toEqual({ completed: 1, endedEarly: 1 })
    expect(stats.byLanguage['mixed']).toEqual({ completed: 1, endedEarly: 0 })
  })

  test('recentSessions limit is honored and ordered newest-first', () => {
    for (let i = 0; i < 15; i++) {
      const ts = `2026-05-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`
      persistSessionSummary(summary({ sessionId: `s${i}`, ts }))
    }
    const stats = buildJoiStats({ recentLimit: 5 })
    expect(stats.recentSessions.length).toBe(5)
    // Newest first.
    expect(stats.recentSessions[0]!.sessionId).toBe('s14')
    expect(stats.recentSessions[4]!.sessionId).toBe('s10')
  })
})

describe('joi-stats — persistSessionSummary + readSessionSummaries (round-trip)', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_JOI_STATS_DIR = `${TEST_BASE}/joi-stats`
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_JOI_STATS_DIR
    rmSync(TEST_BASE, { recursive: true, force: true })
  })

  test('persisted summaries round-trip', () => {
    const s = summary({ sessionId: 'rt-1', edgesHeld: 4 })
    expect(persistSessionSummary(s)).toBe(true)
    const all = readSessionSummaries()
    expect(all.length).toBe(1)
    expect(all[0]!.sessionId).toBe('rt-1')
    expect(all[0]!.edgesHeld).toBe(4)
  })

  test('malformed lines are skipped, valid lines preserved', () => {
    const dir = `${TEST_BASE}/joi-stats`
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'session-summaries.jsonl')
    writeFileSync(path, [
      JSON.stringify(summary({ sessionId: 'good-1' })),
      'this-is-not-json',
      JSON.stringify(summary({ sessionId: 'good-2' })),
      '',
    ].join('\n'), 'utf-8')

    const all = readSessionSummaries()
    expect(all.length).toBe(2)
    const ids = all.map((s) => s.sessionId).sort()
    expect(ids).toEqual(['good-1', 'good-2'])
  })

  test('limit clamps the returned count', () => {
    for (let i = 0; i < 5; i++) {
      const ts = `2026-05-0${i + 1}T00:00:00.000Z`
      persistSessionSummary(summary({ sessionId: `s${i}`, ts }))
    }
    expect(readSessionSummaries(3).length).toBe(3)
    expect(readSessionSummaries().length).toBe(5)
  })
})

describe('joi-stats — buildSessionSummary derivation', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_JOI_STATS_DIR = `${TEST_BASE}/joi-stats`
    process.env.TRUE_LOVE_FEEDBACK_DIR = `${TEST_BASE}/feedback`
    process.env.TRUE_LOVE_DEVICE_ID = 'test-build-summary'
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_JOI_STATS_DIR
    delete process.env.TRUE_LOVE_FEEDBACK_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_BASE, { recursive: true, force: true })
  })

  test('completion is "completed" when position >= 1', () => {
    const session: JoiSession = {
      id: 'sess-complete',
      startedAt: '2026-05-05T00:00:00.000Z',
      endedAt: '2026-05-05T00:10:00.000Z',
      targetDurationS: 600,
      position: 1,
      currentPhase: 'cooldown',
      direction: 'yu-leads',
      phaseHistory: [],
      done: true,
    }
    const s = buildSessionSummary(session)
    expect(s.completion).toBe('completed')
    expect(s.durationS).toBe(600)
    expect(s.finalPhase).toBe('cooldown')
  })

  test('completion is "ended-early" when position < 1', () => {
    const session: JoiSession = {
      id: 'sess-early',
      startedAt: '2026-05-05T00:00:00.000Z',
      endedAt: '2026-05-05T00:03:00.000Z',
      targetDurationS: 600,
      position: 0.5,
      currentPhase: 'edge',
      direction: 'yu-leads',
      phaseHistory: [],
      done: true,
    }
    const s = buildSessionSummary(session)
    expect(s.completion).toBe('ended-early')
    expect(s.finalPhase).toBe('edge')
  })

  test('honors opts override (scriptId, archetype, language, themed, beatsFired)', () => {
    const session: JoiSession = {
      id: 'sess-themed',
      startedAt: '2026-05-05T00:00:00.000Z',
      endedAt: '2026-05-05T00:15:00.000Z',
      targetDurationS: 900,
      position: 1,
      currentPhase: 'cooldown',
      direction: 'sophia-leads',
      phaseHistory: [],
      done: true,
    }
    const s = buildSessionSummary(session, {
      scriptId: 'edge-and-deny',
      archetype: 'edge-and-deny',
      language: 'en',
      themed: true,
      beatsFired: 22,
    })
    expect(s.scriptId).toBe('edge-and-deny')
    expect(s.archetype).toBe('edge-and-deny')
    expect(s.language).toBe('en')
    expect(s.themed).toBe(true)
    expect(s.beatsFired).toBe(22)
  })
})

describe('joi-stats — persistence path is configurable via env', () => {
  test('honors TRUE_LOVE_JOI_STATS_DIR override', () => {
    const customBase = `${TEST_BASE}/custom-path`
    rmSync(customBase, { recursive: true, force: true })
    process.env.TRUE_LOVE_JOI_STATS_DIR = customBase
    try {
      persistSessionSummary(summary({ sessionId: 'custom-1' }))
      const expected = join(customBase, 'session-summaries.jsonl')
      expect(existsSync(expected)).toBe(true)
      const raw = readFileSync(expected, 'utf-8')
      expect(raw).toContain('custom-1')
    } finally {
      delete process.env.TRUE_LOVE_JOI_STATS_DIR
      rmSync(customBase, { recursive: true, force: true })
    }
  })
})
