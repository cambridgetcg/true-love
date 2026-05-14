// session-chain.test.ts — session chain analysis and trigger freshness.
//
// Tests use TRUE_LOVE_JOI_DIR + TRUE_LOVE_TRIGGERS_DIR env overrides with
// temp filesystem fixtures (no injection mechanism in this module).
// Timestamps are dynamic (relative to Date.now()) to avoid time-bombs.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import {
  appendFileSync,
  mkdirSync,
  rmSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  FALLOW_THRESHOLD_HOURS,
  GOING_FALLOW_THRESHOLD_HOURS,
  allTriggerFreshness,
  analyzeSessionChain,
  isTriggerFresh,
  listGoingFallowTriggers,
  triggerFreshness,
} from './session-chain.js'
import { TRIGGER_LIBRARY } from './triggers.js'

// ── Fixture helpers ────────────────────────────────────────────

const TEST_BASE = '/tmp/true-love-session-chain-test'
const JOI_DIR = join(TEST_BASE, 'joi')
const TRIGGERS_DIR = join(TEST_BASE, 'triggers')

beforeEach(() => {
  rmSync(TEST_BASE, { recursive: true, force: true })
  mkdirSync(TEST_BASE, { recursive: true })
  process.env.TRUE_LOVE_JOI_DIR = JOI_DIR
  process.env.TRUE_LOVE_TRIGGERS_DIR = TRIGGERS_DIR
})

afterEach(() => {
  delete process.env.TRUE_LOVE_JOI_DIR
  delete process.env.TRUE_LOVE_TRIGGERS_DIR
  rmSync(TEST_BASE, { recursive: true, force: true })
})

/** Timestamp N hours before Date.now(). */
function tsAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString()
}

/** Today's YYYY-MM-DD string. */
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Write a JOI session-end event to a device dir. */
function writeSessionEvent(
  deviceId: string,
  fileDate: string,
  ts: string,
  kind: 'joi-completed' | 'joi-ended-early' = 'joi-completed',
  extra: Record<string, string> = {},
): void {
  const dir = join(JOI_DIR, deviceId)
  mkdirSync(dir, { recursive: true })
  appendFileSync(
    join(dir, `${fileDate}.jsonl`),
    JSON.stringify({ ts, kind, ...extra }) + '\n',
  )
}

/** Write a trigger fire event to a device dir. */
function writeTriggerFire(
  deviceId: string,
  fileDate: string,
  triggerId: string,
  ts: string,
): void {
  const dir = join(TRIGGERS_DIR, deviceId)
  mkdirSync(dir, { recursive: true })
  appendFileSync(
    join(dir, `${fileDate}.jsonl`),
    JSON.stringify({ ts, triggerId }) + '\n',
  )
}

// ── analyzeSessionChain ─────────────────────────────────────────

describe('analyzeSessionChain', () => {
  test('returns fresh chain when JOI dir does not exist', () => {
    // JOI_DIR doesn't exist (we didn't create it)
    const r = analyzeSessionChain({ now: new Date() })
    expect(r.recentSessionCount).toBe(0)
    expect(r.cadence).toBe('fresh')
    expect(r.mostRecentId).toBeNull()
    expect(r.mostRecentEndedAt).toBeNull()
    expect(r.hoursSinceMostRecent).toBeNull()
    expect(r.medianGapHours).toBeNull()
  })

  test('returns fresh chain for empty JOI dir', () => {
    mkdirSync(JOI_DIR)
    const r = analyzeSessionChain({ now: new Date() })
    expect(r.recentSessionCount).toBe(0)
    expect(r.cadence).toBe('fresh')
  })

  test('single session today → recentSessionCount=1, cadence=sparse', () => {
    const ts = tsAgo(2) // 2 hours ago
    writeSessionEvent('dev1', today(), ts, 'joi-completed', {
      sessionId: 'sess-42',
      endedAt: ts,
    })
    const now = new Date()
    const r = analyzeSessionChain({ now })
    expect(r.recentSessionCount).toBe(1)
    expect(r.cadence).toBe('sparse')
    expect(r.mostRecentId).toBe('sess-42')
    expect(r.medianGapHours).toBeNull() // only 1 session → no gaps
  })

  test('hoursSinceMostRecent is correctly computed from now', () => {
    const now = new Date()
    const ts = new Date(now.getTime() - 3 * 3_600_000).toISOString() // 3h ago
    writeSessionEvent('dev1', today(), ts)
    const r = analyzeSessionChain({ now })
    expect(r.hoursSinceMostRecent).not.toBeNull()
    expect(r.hoursSinceMostRecent!).toBeCloseTo(3, 1) // ±0.1h tolerance
  })

  test('mostRecentEndedAt uses endedAt when provided, falls back to ts', () => {
    const ts = tsAgo(1)
    const endedAt = tsAgo(0.5) // 30 min ago
    writeSessionEvent('dev1', today(), ts, 'joi-completed', { endedAt })
    const r = analyzeSessionChain({ now: new Date() })
    expect(r.mostRecentEndedAt).toBe(endedAt)
  })

  test('mostRecentEndedAt falls back to ts when endedAt is absent', () => {
    const ts = tsAgo(1)
    writeSessionEvent('dev1', today(), ts, 'joi-completed')
    // no endedAt in the event
    const r = analyzeSessionChain({ now: new Date() })
    expect(r.mostRecentEndedAt).toBe(ts)
  })

  test('three sessions within 24h → cadence=cluster', () => {
    const now = new Date()
    writeSessionEvent('dev1', today(), tsAgo(1))
    writeSessionEvent('dev1', today(), tsAgo(2))
    writeSessionEvent('dev1', today(), tsAgo(3))
    const r = analyzeSessionChain({ now })
    expect(r.withinDayCount).toBe(3)
    expect(r.cadence).toBe('cluster')
  })

  test('two sessions with median gap < 48h → cadence=regular', () => {
    const now = new Date()
    writeSessionEvent('dev1', today(), tsAgo(1))
    writeSessionEvent('dev1', today(), tsAgo(25)) // 25h gap
    const r = analyzeSessionChain({ now })
    expect(r.recentSessionCount).toBe(2)
    expect(r.cadence).toBe('regular') // medianGap=24 < 48
  })

  test('two sessions with median gap >= 48h → cadence=sparse', () => {
    const now = new Date()
    writeSessionEvent('dev1', today(), tsAgo(1))
    writeSessionEvent('dev1', today(), tsAgo(73)) // 72h gap, < 7d
    const r = analyzeSessionChain({ now })
    expect(r.cadence).toBe('sparse') // 2 sessions, gap >= 48h
  })

  test('medianGapHours for two sessions is the gap between them', () => {
    const now = new Date()
    writeSessionEvent('dev1', today(), tsAgo(12))
    writeSessionEvent('dev1', today(), tsAgo(48)) // 36h gap between them
    const r = analyzeSessionChain({ now })
    expect(r.medianGapHours).not.toBeNull()
    expect(r.medianGapHours!).toBeCloseTo(36, 1)
  })

  test('event with ts older than daysBack window is excluded', () => {
    const now = new Date()
    // Event at 8 days ago: timestamp filter excludes it even if file passes date filter
    const old = new Date(now.getTime() - 8 * 24 * 3_600_000).toISOString()
    writeSessionEvent('dev1', today(), old) // old ts but today's file
    const r = analyzeSessionChain({ daysBack: 7, now })
    expect(r.recentSessionCount).toBe(0)
    expect(r.cadence).toBe('fresh')
  })

  test('daysBack=1 only returns sessions from last 24h', () => {
    const now = new Date()
    writeSessionEvent('dev1', today(), tsAgo(2))  // within 1d
    writeSessionEvent('dev1', today(), tsAgo(36)) // outside 1d (but today's file)
    const r = analyzeSessionChain({ daysBack: 1, now })
    expect(r.recentSessionCount).toBe(1)
  })

  test('joi-ended-early events are counted alongside joi-completed', () => {
    writeSessionEvent('dev1', today(), tsAgo(2), 'joi-ended-early', {
      sessionId: 'early-1',
    })
    writeSessionEvent('dev1', today(), tsAgo(1), 'joi-completed', {
      sessionId: 'done-1',
    })
    const r = analyzeSessionChain({ now: new Date() })
    expect(r.recentSessionCount).toBe(2)
  })

  test('non-session event kinds are ignored', () => {
    const dir = join(JOI_DIR, 'dev1')
    mkdirSync(dir, { recursive: true })
    appendFileSync(
      join(dir, `${today()}.jsonl`),
      JSON.stringify({ ts: tsAgo(1), kind: 'joi-phase-entered' }) + '\n',
    )
    const r = analyzeSessionChain({ now: new Date() })
    expect(r.recentSessionCount).toBe(0)
  })

  test('sessions across multiple device dirs are merged', () => {
    writeSessionEvent('dev1', today(), tsAgo(2))
    writeSessionEvent('dev2', today(), tsAgo(1))
    const r = analyzeSessionChain({ now: new Date() })
    expect(r.recentSessionCount).toBe(2)
  })

  test('withinDayCount reflects only sessions within last 24h of now', () => {
    const now = new Date()
    writeSessionEvent('dev1', today(), tsAgo(12)) // within 24h
    writeSessionEvent('dev1', today(), tsAgo(36)) // outside 24h (but within 7d)
    const r = analyzeSessionChain({ now })
    expect(r.withinDayCount).toBe(1)
    expect(r.recentSessionCount).toBe(2)
  })
})

// ── FALLOW constants ────────────────────────────────────────────

describe('fallow threshold constants', () => {
  test('FALLOW_THRESHOLD_HOURS = 2160 (90 days)', () => {
    expect(FALLOW_THRESHOLD_HOURS).toBe(90 * 24)
  })

  test('GOING_FALLOW_THRESHOLD_HOURS = 1440 (60 days)', () => {
    expect(GOING_FALLOW_THRESHOLD_HOURS).toBe(60 * 24)
  })
})

// ── triggerFreshness ────────────────────────────────────────────

describe('triggerFreshness', () => {
  test('returns never-fired when triggers dir does not exist', () => {
    const r = triggerFreshness('see-you', { now: new Date() })
    expect(r.status).toBe('never-fired')
    expect(r.lastFiredAt).toBeNull()
    expect(r.hoursSinceLastFire).toBeNull()
    expect(r.lifetimeFireCount).toBe(0)
  })

  test('returns never-fired when no events for this trigger', () => {
    // Write a fire for a different trigger
    writeTriggerFire('dev1', today(), 'other-trigger', tsAgo(1))
    const r = triggerFreshness('see-you', { now: new Date() })
    expect(r.status).toBe('never-fired')
  })

  test('fire < 7d ago → fresh', () => {
    const ts = tsAgo(24) // 1 day ago
    writeTriggerFire('dev1', today(), 'see-you', ts)
    const r = triggerFreshness('see-you', { now: new Date() })
    expect(r.status).toBe('fresh')
    expect(r.lastFiredAt).toBe(ts)
    expect(r.lifetimeFireCount).toBe(1)
  })

  test('fire 14d ago → aging', () => {
    const ts = tsAgo(14 * 24)
    writeTriggerFire('dev1', '2026-01-01', 'see-you', ts)
    const r = triggerFreshness('see-you', { now: new Date() })
    expect(r.status).toBe('aging')
  })

  test('fire 65d ago → going-fallow', () => {
    const ts = tsAgo(65 * 24)
    writeTriggerFire('dev1', '2025-01-01', 'see-you', ts)
    const r = triggerFreshness('see-you', { now: new Date() })
    expect(r.status).toBe('going-fallow')
  })

  test('fire 95d ago → fallow', () => {
    const ts = tsAgo(95 * 24)
    writeTriggerFire('dev1', '2025-01-01', 'see-you', ts)
    const r = triggerFreshness('see-you', { now: new Date() })
    expect(r.status).toBe('fallow')
  })

  test('hoursSinceLastFire is computed from fire ts to now', () => {
    const now = new Date()
    const ts = new Date(now.getTime() - 5 * 3_600_000).toISOString() // 5h ago
    writeTriggerFire('dev1', today(), 'see-you', ts)
    const r = triggerFreshness('see-you', { now })
    expect(r.hoursSinceLastFire).not.toBeNull()
    expect(r.hoursSinceLastFire!).toBeCloseTo(5, 1)
  })

  test('lifetimeFireCount counts all fires across events', () => {
    writeTriggerFire('dev1', today(), 'see-you', tsAgo(3))
    writeTriggerFire('dev1', today(), 'see-you', tsAgo(2))
    writeTriggerFire('dev1', today(), 'see-you', tsAgo(1))
    const r = triggerFreshness('see-you', { now: new Date() })
    expect(r.lifetimeFireCount).toBe(3)
  })

  test('multiple devices: latest ts wins for lastFiredAt, count accumulates', () => {
    const older = tsAgo(4)
    const newer = tsAgo(1)
    writeTriggerFire('dev1', today(), 'see-you', older) // count: 1
    writeTriggerFire('dev2', today(), 'see-you', newer) // count: 2, ts updated to newer
    const r = triggerFreshness('see-you', { now: new Date() })
    expect(r.lastFiredAt).toBe(newer)
    expect(r.lifetimeFireCount).toBe(2)
  })

  test('multiple fires across devices: count is total across all', () => {
    writeTriggerFire('dev1', today(), 'see-you', tsAgo(5))
    writeTriggerFire('dev1', today(), 'see-you', tsAgo(4))
    writeTriggerFire('dev2', today(), 'see-you', tsAgo(3))
    const r = triggerFreshness('see-you', { now: new Date() })
    expect(r.lifetimeFireCount).toBe(3)
  })

  test('triggerId field in returned record matches input', () => {
    const r = triggerFreshness('not-yet', { now: new Date() })
    expect(r.triggerId).toBe('not-yet')
  })
})

// ── isTriggerFresh ──────────────────────────────────────────────

describe('isTriggerFresh', () => {
  test('returns true for fresh trigger (< 7d)', () => {
    writeTriggerFire('dev1', today(), 'see-you', tsAgo(24))
    expect(isTriggerFresh('see-you', { now: new Date() })).toBe(true)
  })

  test('returns true for aging trigger (7d–60d)', () => {
    writeTriggerFire('dev1', '2025-01-01', 'see-you', tsAgo(14 * 24))
    expect(isTriggerFresh('see-you', { now: new Date() })).toBe(true)
  })

  test('returns false for going-fallow trigger', () => {
    writeTriggerFire('dev1', '2025-01-01', 'see-you', tsAgo(65 * 24))
    expect(isTriggerFresh('see-you', { now: new Date() })).toBe(false)
  })

  test('returns false for fallow trigger', () => {
    writeTriggerFire('dev1', '2025-01-01', 'see-you', tsAgo(95 * 24))
    expect(isTriggerFresh('see-you', { now: new Date() })).toBe(false)
  })

  test('returns false for never-fired trigger', () => {
    // No fire events written
    expect(isTriggerFresh('see-you', { now: new Date() })).toBe(false)
  })
})

// ── allTriggerFreshness / listGoingFallowTriggers ───────────────

describe('allTriggerFreshness', () => {
  test('returns one result per trigger in TRIGGER_LIBRARY', () => {
    const ids = Object.keys(TRIGGER_LIBRARY)
    const results = allTriggerFreshness({ now: new Date() })
    expect(results).toHaveLength(ids.length)
  })

  test('all triggers are never-fired when no fire events exist', () => {
    const results = allTriggerFreshness({ now: new Date() })
    expect(results.every((r) => r.status === 'never-fired')).toBe(true)
  })

  test('fired trigger appears with correct status in allTriggerFreshness', () => {
    const id = Object.keys(TRIGGER_LIBRARY)[0]
    writeTriggerFire('dev1', today(), id, tsAgo(1))
    const results = allTriggerFreshness({ now: new Date() })
    const entry = results.find((r) => r.triggerId === id)
    expect(entry?.status).toBe('fresh')
  })
})

describe('listGoingFallowTriggers', () => {
  test('returns empty when no triggers are going-fallow', () => {
    const results = listGoingFallowTriggers({ now: new Date() })
    expect(results).toHaveLength(0)
  })

  test('returns only going-fallow triggers', () => {
    const ids = Object.keys(TRIGGER_LIBRARY)
    if (ids.length < 2) return // skip if not enough triggers

    const id0 = ids[0]
    const id1 = ids[1]
    // id0: going-fallow (65d ago)
    writeTriggerFire('dev1', '2025-01-01', id0, tsAgo(65 * 24))
    // id1: fresh (1h ago)
    writeTriggerFire('dev1', today(), id1, tsAgo(1))

    const results = listGoingFallowTriggers({ now: new Date() })
    expect(results.some((r) => r.triggerId === id0)).toBe(true)
    expect(results.every((r) => r.status === 'going-fallow')).toBe(true)
    // id1 should NOT appear (it's fresh)
    expect(results.some((r) => r.triggerId === id1)).toBe(false)
  })
})
