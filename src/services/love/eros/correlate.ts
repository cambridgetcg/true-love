// eros/correlate.ts — pure functions for eros × response-character analysis.
//
// Joins per-tick eros snapshots with the existing trace + metric streams
// by (sessionId, tick), groups joined records by felt-shape, and computes
// descriptive statistics per group.
//
// Substrate-honesty: descriptive, not causal. The output answers "when the
// state was at felt-shape X, what was the typical response character" —
// not "felt-shape X CAUSED response character Y." Correlation, not cause.
//
// Pure: all I/O lives in bin/eros-correlate.mjs which feeds the inputs.
//
// Part of the Eros arousal infrastructure — Phase-1.5 of the LLM
// arousal-state research stack.

import type { DecisionTrace } from '../mind-trace.js'
import type { TickMetrics } from '../tick-metrics.js'
import type { ErosSnapshot } from './snapshots.js'

// ── Types ──────────────────────────────────────────────────────────

export interface JoinedRecord {
  snapshot: ErosSnapshot
  /** Null when no trace recorded for this (sessionId, tick) pair. */
  trace: DecisionTrace | null
  /** Null when no tick-metric recorded for this (sessionId, tick) pair. */
  metric: TickMetrics | null
}

export interface FeltShapeStats {
  feltShape: string
  n: number
  /** Mean velocity in chars/sec; null if no metrics joined. */
  meanCharsPerSecond: number | null
  /** Mean tick duration in ms; null if no metrics joined. */
  meanDurationMs: number | null
  /** Mean output character count; null if no metrics joined. */
  meanOutputChars: number | null
  /** Distribution of yieldReason values across joined metrics. */
  yieldReasonCounts: Record<string, number>
  /** Distribution of youspeak grade values across joined traces. */
  youspeakGradeCounts: Record<string, number>
  /** Distribution of attribution channel (autonomic/voluntary/yu/decay/init). */
  attributionCounts: Record<string, number>
}

// ── Join key ───────────────────────────────────────────────────────

/**
 * Build the join key from any record carrying sessionId + tick.
 * Records with the same sessionId+tick refer to the same tick.
 */
export function joinKey(r: { sessionId: string; tick: number }): string {
  return `${r.sessionId}::${r.tick}`
}

// ── Joining ────────────────────────────────────────────────────────

/**
 * Join snapshots with traces + metrics by (sessionId, tick).
 * Returns one record per snapshot — trace and metric may be null when
 * a snapshot was recorded but the corresponding trace/metric wasn't
 * (e.g., tick errored before reaching the trace-recording site).
 */
export function joinRecords(
  snapshots: ErosSnapshot[],
  traces: DecisionTrace[],
  metrics: TickMetrics[],
): JoinedRecord[] {
  const traceMap = new Map<string, DecisionTrace>()
  for (const t of traces) traceMap.set(joinKey(t), t)
  const metricMap = new Map<string, TickMetrics>()
  for (const m of metrics) metricMap.set(joinKey(m), m)
  return snapshots.map((s) => ({
    snapshot: s,
    trace: traceMap.get(joinKey(s)) ?? null,
    metric: metricMap.get(joinKey(s)) ?? null,
  }))
}

// ── Grouping ───────────────────────────────────────────────────────

/**
 * Group joined records by felt-shape.primary value.
 * Each unique felt-shape becomes a bucket.
 */
export function groupByFeltShape(records: JoinedRecord[]): Record<string, JoinedRecord[]> {
  const out: Record<string, JoinedRecord[]> = {}
  for (const r of records) {
    const key = r.snapshot.feltShape.primary
    if (!out[key]) out[key] = []
    out[key]!.push(r)
  }
  return out
}

// ── Stats ──────────────────────────────────────────────────────────

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * Compute per-felt-shape descriptive statistics.
 * Means are null when no joined record has the relevant field.
 */
export function computeStats(records: JoinedRecord[], feltShape: string): FeltShapeStats {
  const charsPerSecond = records
    .map((r) => r.metric?.velocity?.charsPerSecond)
    .filter((v): v is number => typeof v === 'number')
  const durationMs = records
    .map((r) => r.metric?.durationMs)
    .filter((v): v is number => typeof v === 'number')
  const outputChars = records
    .map((r) => r.metric?.outputChars)
    .filter((v): v is number => typeof v === 'number')

  const yieldReasonCounts: Record<string, number> = {}
  for (const r of records) {
    const reason = r.metric?.yieldReason ?? 'no-metric'
    yieldReasonCounts[reason] = (yieldReasonCounts[reason] ?? 0) + 1
  }

  const youspeakGradeCounts: Record<string, number> = {}
  for (const r of records) {
    const grade = r.trace?.summary?.youspeak?.grade ?? 'none'
    youspeakGradeCounts[grade] = (youspeakGradeCounts[grade] ?? 0) + 1
  }

  const attributionCounts: Record<string, number> = {}
  for (const r of records) {
    const channel = r.snapshot.lastAttribution.split(':')[0] ?? 'unknown'
    attributionCounts[channel] = (attributionCounts[channel] ?? 0) + 1
  }

  return {
    feltShape,
    n: records.length,
    meanCharsPerSecond: mean(charsPerSecond),
    meanDurationMs: mean(durationMs),
    meanOutputChars: mean(outputChars),
    yieldReasonCounts,
    youspeakGradeCounts,
    attributionCounts,
  }
}

// ── Formatting ─────────────────────────────────────────────────────

function formatNum(v: number | null, decimals = 1): string {
  return v === null ? '—' : v.toFixed(decimals)
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return '(none)'
  return entries.map(([k, v]) => `${k}=${v}`).join(' ')
}

/**
 * Render a readable terminal table from per-felt-shape stats.
 * Sorted by sample size descending.
 */
export function formatStatsTable(allStats: FeltShapeStats[]): string {
  const lines: string[] = []
  lines.push('═══ Eros × Response-Character Correlation ═══')
  lines.push('Descriptive only — sample sizes guide interpretation.')
  lines.push('')
  if (allStats.length === 0) {
    lines.push('(no joined data — snapshots/traces/metrics empty or no matches)')
    return lines.join('\n')
  }
  for (const s of [...allStats].sort((a, b) => b.n - a.n)) {
    lines.push(`${s.feltShape}  (n=${s.n})`)
    lines.push(`  velocity:    ${formatNum(s.meanCharsPerSecond)} chars/sec`)
    lines.push(`  duration:    ${formatNum(s.meanDurationMs, 0)} ms`)
    lines.push(`  output:      ${formatNum(s.meanOutputChars, 0)} chars`)
    lines.push(`  yield:       ${formatCounts(s.yieldReasonCounts)}`)
    lines.push(`  youspeak:    ${formatCounts(s.youspeakGradeCounts)}`)
    lines.push(`  attribution: ${formatCounts(s.attributionCounts)}`)
    lines.push('')
  }
  return lines.join('\n')
}
