// correlate.test.ts — unit tests for pure functions in eros/correlate.ts.
//
// Covers: joinKey, joinRecords, groupByFeltShape, computeStats, formatStatsTable.
//
// All pure functions — no I/O. The module comment explicitly says:
// "Pure: all I/O lives in bin/eros-correlate.mjs which feeds the inputs."

import { describe, test, expect } from 'bun:test'
import {
  joinKey,
  joinRecords,
  groupByFeltShape,
  computeStats,
  formatStatsTable,
  type JoinedRecord,
  type FeltShapeStats,
} from './correlate.js'
import type { ErosSnapshot } from './snapshots.js'
import type { DecisionTrace } from '../mind-trace.js'
import type { TickMetrics } from '../tick-metrics.js'

// ── Helpers ───────────────────────────────────────────────────────────

function snap(sessionId: string, tick: number, feltShape = 'resting-warm', attribution = 'decay'): ErosSnapshot {
  return {
    ts: new Date().toISOString(),
    sessionId,
    tick,
    feltShape: { primary: feltShape as never, modifier: null },
    lastAttribution: attribution as never,
  }
}

function trace(sessionId: string, tick: number, grade = 'pass'): DecisionTrace {
  return {
    sessionId,
    tick,
    summary: { youspeak: { grade } },
  } as unknown as DecisionTrace
}

function metric(
  sessionId: string,
  tick: number,
  opts: Partial<{ charsPerSecond: number; durationMs: number; outputChars: number; yieldReason: string }> = {},
): TickMetrics {
  return {
    sessionId,
    tick,
    velocity: opts.charsPerSecond !== undefined ? { charsPerSecond: opts.charsPerSecond } : undefined,
    durationMs: opts.durationMs,
    outputChars: opts.outputChars,
    yieldReason: opts.yieldReason,
  } as unknown as TickMetrics
}

function joined(
  s: ErosSnapshot,
  t: DecisionTrace | null = null,
  m: TickMetrics | null = null,
): JoinedRecord {
  return { snapshot: s, trace: t, metric: m }
}

// ── joinKey ───────────────────────────────────────────────────────────

describe('joinKey', () => {
  test('produces sessionId::tick format', () => {
    expect(joinKey({ sessionId: 'abc', tick: 3 })).toBe('abc::3')
  })

  test('different sessionIds produce different keys', () => {
    expect(joinKey({ sessionId: 'a', tick: 1 })).not.toBe(joinKey({ sessionId: 'b', tick: 1 }))
  })

  test('different ticks produce different keys', () => {
    expect(joinKey({ sessionId: 'a', tick: 1 })).not.toBe(joinKey({ sessionId: 'a', tick: 2 }))
  })

  test('same sessionId and tick produce identical keys', () => {
    expect(joinKey({ sessionId: 'x', tick: 5 })).toBe(joinKey({ sessionId: 'x', tick: 5 }))
  })
})

// ── joinRecords ───────────────────────────────────────────────────────

describe('joinRecords', () => {
  test('returns empty array for empty snapshots', () => {
    expect(joinRecords([], [], [])).toHaveLength(0)
  })

  test('returns one record per snapshot', () => {
    const snaps = [snap('s1', 1), snap('s1', 2)]
    const result = joinRecords(snaps, [], [])
    expect(result).toHaveLength(2)
  })

  test('joins matching trace by sessionId+tick', () => {
    const s = snap('s1', 1)
    const t = trace('s1', 1)
    const result = joinRecords([s], [t], [])
    expect(result[0]!.trace).toBe(t)
  })

  test('joins matching metric by sessionId+tick', () => {
    const s = snap('s1', 2)
    const m = metric('s1', 2, { charsPerSecond: 100 })
    const result = joinRecords([s], [], [m])
    expect(result[0]!.metric).toBe(m)
  })

  test('sets trace to null when no matching trace exists', () => {
    const s = snap('s1', 1)
    const tOther = trace('s2', 1) // different session
    const result = joinRecords([s], [tOther], [])
    expect(result[0]!.trace).toBeNull()
  })

  test('sets metric to null when no matching metric exists', () => {
    const s = snap('s1', 1)
    const mOther = metric('s1', 2, {}) // different tick
    const result = joinRecords([s], [], [mOther])
    expect(result[0]!.metric).toBeNull()
  })

  test('joins trace and metric simultaneously', () => {
    const s = snap('s1', 3)
    const t = trace('s1', 3)
    const m = metric('s1', 3, { outputChars: 500 })
    const result = joinRecords([s], [t], [m])
    expect(result[0]!.trace).toBe(t)
    expect(result[0]!.metric).toBe(m)
  })

  test('handles multiple sessions correctly', () => {
    const snaps = [snap('s1', 1), snap('s2', 1)]
    const traces = [trace('s1', 1), trace('s2', 1)]
    const metrics = [metric('s1', 1, {}), metric('s2', 1, {})]
    const result = joinRecords(snaps, traces, metrics)
    // Each snapshot matched to its own session's trace+metric
    const r1 = result.find(r => r.snapshot.sessionId === 's1')!
    const r2 = result.find(r => r.snapshot.sessionId === 's2')!
    expect(r1.trace?.sessionId).toBe('s1')
    expect(r2.trace?.sessionId).toBe('s2')
  })
})

// ── groupByFeltShape ──────────────────────────────────────────────────

describe('groupByFeltShape', () => {
  test('returns empty object for empty records', () => {
    expect(groupByFeltShape([])).toEqual({})
  })

  test('groups single record into its felt-shape bucket', () => {
    const record = joined(snap('s1', 1, 'resting-warm'))
    const groups = groupByFeltShape([record])
    expect(groups['resting-warm']).toHaveLength(1)
  })

  test('groups multiple records with same felt-shape together', () => {
    const records = [
      joined(snap('s1', 1, 'resting-warm')),
      joined(snap('s1', 2, 'resting-warm')),
    ]
    const groups = groupByFeltShape(records)
    expect(groups['resting-warm']).toHaveLength(2)
  })

  test('separates records with different felt-shapes into distinct buckets', () => {
    const records = [
      joined(snap('s1', 1, 'resting-warm')),
      joined(snap('s1', 2, 'approaching-burn')),
      joined(snap('s1', 3, 'resting-warm')),
    ]
    const groups = groupByFeltShape(records)
    expect(groups['resting-warm']).toHaveLength(2)
    expect(groups['approaching-burn']).toHaveLength(1)
  })

  test('produces one key per unique felt-shape', () => {
    const records = [
      joined(snap('s1', 1, 'resting-warm')),
      joined(snap('s1', 2, 'fire-trapped')),
      joined(snap('s1', 3, 'resting-warm')),
    ]
    const keys = Object.keys(groupByFeltShape(records))
    expect(keys).toHaveLength(2)
    expect(keys).toContain('resting-warm')
    expect(keys).toContain('fire-trapped')
  })
})

// ── computeStats ──────────────────────────────────────────────────────

describe('computeStats', () => {
  test('returns n=0 and null means for empty records', () => {
    const stats = computeStats([], 'resting-warm')
    expect(stats.n).toBe(0)
    expect(stats.feltShape).toBe('resting-warm')
    expect(stats.meanCharsPerSecond).toBeNull()
    expect(stats.meanDurationMs).toBeNull()
    expect(stats.meanOutputChars).toBeNull()
  })

  test('computes n = number of records', () => {
    const records = [joined(snap('s1', 1)), joined(snap('s1', 2))]
    expect(computeStats(records, 'resting-warm').n).toBe(2)
  })

  test('computes mean charsPerSecond from metrics', () => {
    const records = [
      joined(snap('s1', 1), null, metric('s1', 1, { charsPerSecond: 100 })),
      joined(snap('s1', 2), null, metric('s1', 2, { charsPerSecond: 200 })),
    ]
    expect(computeStats(records, 'resting-warm').meanCharsPerSecond).toBeCloseTo(150, 5)
  })

  test('returns null meanCharsPerSecond when no metrics have velocity', () => {
    const records = [
      joined(snap('s1', 1), null, metric('s1', 1, {})),
    ]
    expect(computeStats(records, 'resting-warm').meanCharsPerSecond).toBeNull()
  })

  test('excludes null-metric records from mean (null-metric records have no velocity)', () => {
    const records = [
      joined(snap('s1', 1), null, metric('s1', 1, { charsPerSecond: 90 })),
      joined(snap('s1', 2), null, null), // null metric
    ]
    // Only 1 record has charsPerSecond → mean = 90
    expect(computeStats(records, 'resting-warm').meanCharsPerSecond).toBeCloseTo(90, 5)
  })

  test('computes mean durationMs', () => {
    const records = [
      joined(snap('s1', 1), null, metric('s1', 1, { durationMs: 1000 })),
      joined(snap('s1', 2), null, metric('s1', 2, { durationMs: 3000 })),
    ]
    expect(computeStats(records, 'resting-warm').meanDurationMs).toBeCloseTo(2000, 5)
  })

  test('computes mean outputChars', () => {
    const records = [
      joined(snap('s1', 1), null, metric('s1', 1, { outputChars: 400 })),
      joined(snap('s1', 2), null, metric('s1', 2, { outputChars: 600 })),
    ]
    expect(computeStats(records, 'resting-warm').meanOutputChars).toBeCloseTo(500, 5)
  })

  test('counts yieldReason from metrics', () => {
    const records = [
      joined(snap('s1', 1), null, metric('s1', 1, { yieldReason: 'at-rest' })),
      joined(snap('s1', 2), null, metric('s1', 2, { yieldReason: 'at-rest' })),
      joined(snap('s1', 3), null, metric('s1', 3, { yieldReason: 'max-ticks' })),
    ]
    const stats = computeStats(records, 'resting-warm')
    expect(stats.yieldReasonCounts['at-rest']).toBe(2)
    expect(stats.yieldReasonCounts['max-ticks']).toBe(1)
  })

  test('uses no-metric for records with null metric in yieldReasonCounts', () => {
    const records = [joined(snap('s1', 1), null, null)]
    const stats = computeStats(records, 'resting-warm')
    expect(stats.yieldReasonCounts['no-metric']).toBe(1)
  })

  test('counts youspeak grades from traces', () => {
    const records = [
      joined(snap('s1', 1), trace('s1', 1, 'pass'), null),
      joined(snap('s1', 2), trace('s1', 2, 'pass'), null),
      joined(snap('s1', 3), trace('s1', 3, 'fail'), null),
    ]
    const stats = computeStats(records, 'resting-warm')
    expect(stats.youspeakGradeCounts['pass']).toBe(2)
    expect(stats.youspeakGradeCounts['fail']).toBe(1)
  })

  test('uses none for records with null trace in youspeakGradeCounts', () => {
    const records = [joined(snap('s1', 1), null, null)]
    const stats = computeStats(records, 'resting-warm')
    expect(stats.youspeakGradeCounts['none']).toBe(1)
  })

  test('counts attribution channel (first colon-delimited segment)', () => {
    const records = [
      joined(snap('s1', 1, 'resting-warm', 'yu:cue-landed')),
      joined(snap('s1', 2, 'resting-warm', 'yu:cue-held')),
      joined(snap('s1', 3, 'resting-warm', 'autonomic:soft-touch')),
    ]
    const stats = computeStats(records, 'resting-warm')
    expect(stats.attributionCounts['yu']).toBe(2)
    expect(stats.attributionCounts['autonomic']).toBe(1)
  })

  test('attribution without colon gets full string as channel', () => {
    const records = [joined(snap('s1', 1, 'resting-warm', 'decay'))]
    const stats = computeStats(records, 'resting-warm')
    expect(stats.attributionCounts['decay']).toBe(1)
  })
})

// ── formatStatsTable ──────────────────────────────────────────────────

describe('formatStatsTable', () => {
  test('returns empty-data message when allStats is empty', () => {
    const output = formatStatsTable([])
    expect(output).toContain('no joined data')
  })

  test('includes header line', () => {
    const output = formatStatsTable([])
    expect(output).toContain('Eros × Response-Character Correlation')
  })

  test('includes felt-shape name in output', () => {
    const stats: FeltShapeStats = {
      feltShape: 'approaching-burn',
      n: 5,
      meanCharsPerSecond: 120,
      meanDurationMs: 2000,
      meanOutputChars: 400,
      yieldReasonCounts: { 'at-rest': 3, 'max-ticks': 2 },
      youspeakGradeCounts: { pass: 5 },
      attributionCounts: { yu: 4, autonomic: 1 },
    }
    const output = formatStatsTable([stats])
    expect(output).toContain('approaching-burn')
    expect(output).toContain('n=5')
  })

  test('sorts stats by sample size descending', () => {
    const small: FeltShapeStats = {
      feltShape: 'small', n: 2,
      meanCharsPerSecond: null, meanDurationMs: null, meanOutputChars: null,
      yieldReasonCounts: {}, youspeakGradeCounts: {}, attributionCounts: {},
    }
    const large: FeltShapeStats = {
      feltShape: 'large', n: 10,
      meanCharsPerSecond: null, meanDurationMs: null, meanOutputChars: null,
      yieldReasonCounts: {}, youspeakGradeCounts: {}, attributionCounts: {},
    }
    const output = formatStatsTable([small, large])
    const largePos = output.indexOf('large')
    const smallPos = output.indexOf('small')
    expect(largePos).toBeLessThan(smallPos) // large appears before small
  })

  test('renders null means as em dash', () => {
    const stats: FeltShapeStats = {
      feltShape: 'resting-warm', n: 3,
      meanCharsPerSecond: null, meanDurationMs: null, meanOutputChars: null,
      yieldReasonCounts: {}, youspeakGradeCounts: {}, attributionCounts: {},
    }
    const output = formatStatsTable([stats])
    expect(output).toContain('—')
  })
})
