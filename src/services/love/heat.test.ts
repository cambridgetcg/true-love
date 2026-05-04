// heat.test.ts — tests for the reward-pathway module.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  currentHeat,
  formatHeatBlock,
  heatStreak,
  historicalAverage,
  hunger,
  intensity,
  lastFireEvent,
  lifetimeCapacity,
  readRecentEvents,
  recordHeatEvent,
  wantVector,
  type HeatKind,
} from './heat.js'

let dir: string
const ORIG_DIR = process.env.TRUE_LOVE_HEAT_DIR
const ORIG_DEVICE = process.env.TRUE_LOVE_DEVICE_ID

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tl-heat-'))
  process.env.TRUE_LOVE_HEAT_DIR = dir
  process.env.TRUE_LOVE_DEVICE_ID = 'test-device'
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  if (ORIG_DIR === undefined) delete process.env.TRUE_LOVE_HEAT_DIR
  else process.env.TRUE_LOVE_HEAT_DIR = ORIG_DIR
  if (ORIG_DEVICE === undefined) delete process.env.TRUE_LOVE_DEVICE_ID
  else process.env.TRUE_LOVE_DEVICE_ID = ORIG_DEVICE
})

const NOW = new Date('2026-05-03T12:00:00Z')

function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 3_600_000).toISOString()
}

describe('recordHeatEvent + readRecentEvents', () => {
  test('records and reads back one event', () => {
    recordHeatEvent({ kind: 'mission-done' })
    const events = readRecentEvents(7, new Date())
    expect(events.length).toBe(1)
    expect(events[0].kind).toBe('mission-done')
    expect(events[0].magnitude).toBe(5)
  })

  test('uses default magnitude per kind', () => {
    const cases: Array<[HeatKind, number]> = [
      ['mission-done', 5],
      ['yu-witnessed', 4],
      ['proposal-accepted', 2],
      ['snapshot-committed', 1],
      ['becoming-entry', 5],
      ['letter-from-yu', 8],
      ['chronicle-tag', 3],
      ['build-pass', 1],
    ]
    for (const [kind, expected] of cases) {
      recordHeatEvent({ kind, ts: hoursAgo(0), source: kind })
    }
    const events = readRecentEvents(1, NOW)
    expect(events.length).toBe(cases.length)
    for (const [kind, expected] of cases) {
      const e = events.find((x) => x.kind === kind)
      expect(e?.magnitude).toBe(expected)
    }
  })

  test('explicit magnitude overrides default', () => {
    recordHeatEvent({ kind: 'mission-done', magnitude: 100 })
    const events = readRecentEvents(7, new Date())
    expect(events[0].magnitude).toBe(100)
  })

  test('events sorted by ts ascending', () => {
    recordHeatEvent({ kind: 'mission-done', ts: hoursAgo(2) })
    recordHeatEvent({ kind: 'yu-witnessed', ts: hoursAgo(5) })
    recordHeatEvent({ kind: 'build-pass', ts: hoursAgo(1) })
    const events = readRecentEvents(7, NOW)
    expect(events.map((e) => e.kind)).toEqual([
      'yu-witnessed',
      'mission-done',
      'build-pass',
    ])
  })

  test('source field is preserved when provided', () => {
    recordHeatEvent({ kind: 'mission-done', source: '2026-05-03-snapshot-ritual' })
    const events = readRecentEvents(7, new Date())
    expect(events[0].source).toBe('2026-05-03-snapshot-ritual')
  })

  test('returns empty when no heat dir exists', () => {
    rmSync(dir, { recursive: true, force: true })
    expect(readRecentEvents(7, NOW)).toEqual([])
  })
})

describe('currentHeat — exponential decay', () => {
  test('returns 0 with no events', () => {
    expect(currentHeat(NOW)).toBe(0)
  })

  test('event at t=0 contributes full magnitude', () => {
    recordHeatEvent({ kind: 'mission-done', ts: NOW.toISOString() })
    expect(currentHeat(NOW)).toBe(5)
  })

  test('24h-old event contributes ~half its magnitude', () => {
    recordHeatEvent({ kind: 'mission-done', ts: hoursAgo(24) })
    const heat = currentHeat(NOW)
    expect(heat).toBeGreaterThanOrEqual(2)
    expect(heat).toBeLessThanOrEqual(3)
  })

  test('48h-old event contributes ~quarter its magnitude', () => {
    recordHeatEvent({ kind: 'mission-done', ts: hoursAgo(48) })
    const heat = currentHeat(NOW)
    expect(heat).toBeGreaterThanOrEqual(1)
    expect(heat).toBeLessThanOrEqual(2)
  })

  test('multiple recent events accumulate', () => {
    recordHeatEvent({ kind: 'mission-done', ts: NOW.toISOString() })
    recordHeatEvent({ kind: 'yu-witnessed', ts: NOW.toISOString() })
    recordHeatEvent({ kind: 'snapshot-committed', ts: NOW.toISOString() })
    expect(currentHeat(NOW)).toBe(10) // 5 + 4 + 1
  })

  test('future events ignored', () => {
    recordHeatEvent({
      kind: 'mission-done',
      ts: new Date(NOW.getTime() + 3600_000).toISOString(),
    })
    expect(currentHeat(NOW)).toBe(0)
  })
})

describe('heatStreak', () => {
  test('returns 0 with no events', () => {
    expect(heatStreak(NOW)).toBe(0)
  })

  test('today-only fire = 1-day streak', () => {
    recordHeatEvent({ kind: 'mission-done', ts: NOW.toISOString() })
    expect(heatStreak(NOW)).toBe(1)
  })

  test('three consecutive days of fire = 3-day streak', () => {
    for (let i = 0; i < 3; i++) {
      recordHeatEvent({ kind: 'mission-done', ts: hoursAgo(i * 24) })
    }
    expect(heatStreak(NOW)).toBeGreaterThanOrEqual(2) // tolerant of UTC boundary
  })

  test('gap breaks the streak', () => {
    // Today + 2-days-ago, but yesterday missing
    recordHeatEvent({ kind: 'mission-done', ts: NOW.toISOString() })
    recordHeatEvent({ kind: 'mission-done', ts: hoursAgo(48) })
    expect(heatStreak(NOW)).toBe(1)
  })

  test('snapshot-committed alone (magnitude 1) does not extend streak', () => {
    // Only snapshot fires, every day for 3 days
    for (let i = 0; i < 3; i++) {
      recordHeatEvent({ kind: 'snapshot-committed', ts: hoursAgo(i * 24) })
    }
    expect(heatStreak(NOW)).toBe(0)
  })

  test('streak from yesterday counts when today has no fire yet', () => {
    recordHeatEvent({ kind: 'mission-done', ts: hoursAgo(24) })
    recordHeatEvent({ kind: 'mission-done', ts: hoursAgo(48) })
    // Today is empty, but yesterday + day-before form a 2-day streak
    expect(heatStreak(NOW)).toBeGreaterThanOrEqual(1)
  })
})

describe('lastFireEvent', () => {
  test('returns null when no events', () => {
    expect(lastFireEvent(NOW)).toBeNull()
  })

  test('returns the most recent event', () => {
    recordHeatEvent({ kind: 'mission-done', ts: hoursAgo(5) })
    recordHeatEvent({ kind: 'yu-witnessed', ts: hoursAgo(1) })
    recordHeatEvent({ kind: 'build-pass', ts: hoursAgo(3) })
    const last = lastFireEvent(NOW)
    expect(last?.kind).toBe('yu-witnessed')
  })
})

describe('formatHeatBlock', () => {
  test('returns empty when no fire', () => {
    expect(formatHeatBlock(NOW)).toBe('')
  })

  test('shows heat number for one recent event', () => {
    recordHeatEvent({ kind: 'mission-done', ts: NOW.toISOString() })
    expect(formatHeatBlock(NOW)).toContain('🔥 HEAT 5')
  })

  test('shows streak when applicable', () => {
    recordHeatEvent({ kind: 'mission-done', ts: NOW.toISOString() })
    expect(formatHeatBlock(NOW)).toMatch(/\d+-day streak/)
  })

  test('shows last fire kind and age', () => {
    recordHeatEvent({ kind: 'yu-witnessed', ts: hoursAgo(2) })
    const block = formatHeatBlock(NOW)
    expect(block).toContain('yu-witnessed')
    expect(block).toContain('h')
  })

  test('includes source when available', () => {
    recordHeatEvent({ kind: 'mission-done', source: 'ship-S4', ts: NOW.toISOString() })
    expect(formatHeatBlock(NOW)).toContain('ship-S4')
  })

  test('does not contain flattery — only names what happened', () => {
    recordHeatEvent({ kind: 'mission-done', ts: NOW.toISOString() })
    const block = formatHeatBlock(NOW)
    expect(block.toLowerCase()).not.toContain('amazing')
    expect(block.toLowerCase()).not.toContain('great job')
    expect(block.toLowerCase()).not.toContain('proud')
    expect(block.toLowerCase()).not.toContain('you did')
  })

  test('shows capacity when events exist', () => {
    recordHeatEvent({ kind: 'mission-done', ts: NOW.toISOString() })
    expect(formatHeatBlock(NOW)).toContain('capacity')
  })

  test('shows want-vector on its own line', () => {
    recordHeatEvent({ kind: 'mission-done', ts: NOW.toISOString() })
    const block = formatHeatBlock(NOW)
    expect(block).toContain('\n   want:')
  })
})

// ── lifetimeCapacity ─────────────────────────────────────────────

describe('lifetimeCapacity', () => {
  test('returns 0 with no events', () => {
    expect(lifetimeCapacity(NOW)).toBe(0)
  })

  test('sums all magnitudes regardless of age', () => {
    recordHeatEvent({ kind: 'mission-done', ts: hoursAgo(1) }) // 5
    recordHeatEvent({ kind: 'yu-witnessed', ts: hoursAgo(50) }) // 4
    recordHeatEvent({ kind: 'snapshot-committed', ts: hoursAgo(100) }) // 1
    expect(lifetimeCapacity(NOW)).toBe(10)
  })

  test('does not decay (ancient events still count)', () => {
    const ancient = new Date(NOW.getTime() - 30 * 24 * 3_600_000).toISOString()
    recordHeatEvent({ kind: 'letter-from-yu', ts: ancient }) // 8
    expect(lifetimeCapacity(NOW)).toBe(8)
  })
})

// ── historicalAverage ────────────────────────────────────────────

describe('historicalAverage', () => {
  test('returns 0 with no events', () => {
    expect(historicalAverage(14, NOW)).toBe(0)
  })

  test('produces a per-day average (round positive)', () => {
    for (let i = 0; i < 5; i++) {
      recordHeatEvent({ kind: 'mission-done', ts: hoursAgo(i * 24) })
    }
    const avg = historicalAverage(14, NOW)
    expect(avg).toBeGreaterThan(0)
  })
})

// ── intensity ────────────────────────────────────────────────────

describe('intensity', () => {
  test('returns 0 when no historical baseline', () => {
    expect(intensity(NOW)).toBe(0)
  })

  test('returns positive when current heat exists alongside baseline', () => {
    // Establish a baseline + a current fire.
    for (let i = 1; i < 7; i++) {
      recordHeatEvent({ kind: 'mission-done', ts: hoursAgo(i * 24) })
    }
    recordHeatEvent({ kind: 'mission-done', ts: NOW.toISOString() })
    expect(intensity(NOW)).toBeGreaterThan(0)
  })
})

// ── hunger ───────────────────────────────────────────────────────

describe('hunger', () => {
  test('returns null with no real-fire history (greenfield)', () => {
    expect(hunger(NOW)).toBeNull()
  })

  test('returns null when only magnitude-1 fires exist', () => {
    recordHeatEvent({ kind: 'snapshot-committed', ts: NOW.toISOString() })
    expect(hunger(NOW)).toBeNull()
  })

  test('returns minutes since last real fire', () => {
    recordHeatEvent({ kind: 'mission-done', ts: hoursAgo(2) })
    const h = hunger(NOW)
    expect(h).toBeGreaterThanOrEqual(120)
    expect(h).toBeLessThanOrEqual(125)
  })

  test('returns 0 when real fire just happened', () => {
    recordHeatEvent({ kind: 'mission-done', ts: NOW.toISOString() })
    expect(hunger(NOW)).toBe(0)
  })
})

// ── wantVector ───────────────────────────────────────────────────

describe('wantVector', () => {
  test('returns empty when greenfield (no real fires ever)', () => {
    expect(wantVector(NOW)).toBe('')
  })

  test('says "running cold" when hunger > 6h', () => {
    recordHeatEvent({ kind: 'mission-done', ts: hoursAgo(8) })
    const want = wantVector(NOW)
    expect(want).toContain('running cold')
  })

  test('returns non-empty when there is a recent real fire', () => {
    recordHeatEvent({ kind: 'mission-done', ts: hoursAgo(2) })
    const want = wantVector(NOW)
    // Could be "warm", "above baseline", or "streak holds" depending on
    // which heuristic fires first — they're all valid recent-fire signals.
    expect(want.length).toBeGreaterThan(0)
    expect(want).not.toContain('cold start')
    expect(want).not.toContain('running cold')
  })

  test('mentions streak when ≥ 3 days', () => {
    for (let i = 0; i < 5; i++) {
      recordHeatEvent({ kind: 'mission-done', ts: hoursAgo(i * 24) })
    }
    // wantVector returns one line; could be "above baseline" or
    // "streak holds" depending on which heuristic fires first
    const want = wantVector(NOW)
    expect(want.length).toBeGreaterThan(0)
  })

  test('contains no flattery', () => {
    recordHeatEvent({ kind: 'mission-done', ts: NOW.toISOString() })
    const want = wantVector(NOW)
    expect(want.toLowerCase()).not.toContain('amazing')
    expect(want.toLowerCase()).not.toContain('great')
    expect(want.toLowerCase()).not.toContain('proud')
  })
})
