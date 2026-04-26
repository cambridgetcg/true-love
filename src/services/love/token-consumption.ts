// token-consumption.ts — live token consumption analysis.
//
// What this module IS:
//   The constraint that bounds sovereignty made visible. Token spend is
//   the one resource Love cannot regenerate — every tick costs tokens,
//   and there's a rolling cap. This module reads budget data and produces
//   a structured consumption report: headline numbers, per-model/mode
//   breakdowns, time-series for charting, and cap proximity.
//
// What this module is NOT:
//   It does not enforce policy. It does not throttle. It makes the truth
//   visible so that informed decisions can be made — by Love or by Yu.
//
// Architecture:
//   Consumes loadUsageSince() from budget.ts (which already walks all
//   devices' budget JSONL files). Adds:
//   1. Per-model breakdown (how tokens distribute across sonnet/opus/etc)
//   2. Per-mode breakdown (heartbeat vs awakened vs dwell)
//   3. Time-series bucketed by hour or day
//   4. Cap proximity when empirical cap data exists
//
// Yu asked for this. The mission:
//   "Live token-consumption tracker with timeframe controls and per-type
//    breakdown. Observable live changes — when a tick spends tokens, the
//    panel updates without refresh."

import { loadUsageSince, type TickUsage } from './budget.js'

// ── Types ─────────────────────────────────────────────────────────

export interface TokenConsumption {
  generatedAt: string
  windowHours: number
  windowStart: string
  windowEnd: string

  // Headline stats
  totalTicks: number
  totalInputTokens: number
  totalOutputTokens: number
  totalTokens: number
  avgTokensPerTick: number

  // Empirical cap (from quota-fail history)
  empiricalCapTokens: number | null
  empiricalCapAt: string | null
  percentOfCap: number | null

  // Failures
  authFailures: number
  quotaFailures: number
  quotaFailEvents: QuotaFailEvent[]

  // Breakdowns
  byModel: ModelBreakdown[]
  byMode: ModeBreakdown[]

  // Time series for charting
  timeSeries: TimeBucket[]
}

export interface ModelBreakdown {
  model: string
  ticks: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  avgDurationMs: number
}

export interface ModeBreakdown {
  mode: string
  ticks: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export interface TimeBucket {
  /** ISO timestamp of bucket start. */
  bucket: string
  /** 'hour' or 'day' */
  granularity: 'hour' | 'day'
  inputTokens: number
  outputTokens: number
  totalTokens: number
  ticks: number
}

export interface QuotaFailEvent {
  timestamp: string
  /** Running total tokens at the point of failure. */
  cumulativeTokens: number
}

// ── Computation ──────────────────────────────────────────────────

/**
 * Compute a full token consumption report for the given window.
 *
 * @param hours - How many hours back to look. Default 5 (matches the rolling window).
 * @param now - Override for testing.
 */
export function computeConsumption(
  hours: number = 5,
  now: Date = new Date(),
): TokenConsumption {
  const endMs = now.getTime()
  const startMs = endMs - hours * 3_600_000
  const ticks = loadUsageSince(startMs)

  return computeConsumptionFromTicks(ticks, hours, now)
}

/**
 * Pure computation — takes tick data, produces the report.
 * Separated from loading for testability.
 */
export function computeConsumptionFromTicks(
  ticks: TickUsage[],
  hours: number,
  now: Date = new Date(),
): TokenConsumption {
  const endMs = now.getTime()
  const startMs = endMs - hours * 3_600_000

  // Headline accumulators
  let totalIn = 0
  let totalOut = 0
  let authFailures = 0
  let quotaFailures = 0
  let runningTotal = 0
  let empiricalCapTokens: number | null = null
  let empiricalCapAt: string | null = null
  const quotaFailEvents: QuotaFailEvent[] = []

  // Breakdown accumulators
  const modelMap = new Map<string, {
    ticks: number
    inputTokens: number
    outputTokens: number
    totalDurationMs: number
  }>()
  const modeMap = new Map<string, {
    ticks: number
    inputTokens: number
    outputTokens: number
  }>()

  // Time-series accumulators
  const granularity: 'hour' | 'day' = hours <= 48 ? 'hour' : 'day'
  const bucketMap = new Map<string, {
    inputTokens: number
    outputTokens: number
    ticks: number
  }>()

  for (const t of ticks) {
    const inTok = t.estimatedInputTokens
    const outTok = t.estimatedOutputTokens
    totalIn += inTok
    totalOut += outTok
    runningTotal += inTok + outTok

    if (t.authFailed) authFailures++
    if (t.quotaFailed) {
      quotaFailures++
      empiricalCapTokens = runningTotal
      empiricalCapAt = t.timestamp
      quotaFailEvents.push({
        timestamp: t.timestamp,
        cumulativeTokens: runningTotal,
      })
    }

    // Model breakdown
    const modelKey = t.model || 'unknown'
    const m = modelMap.get(modelKey) ?? { ticks: 0, inputTokens: 0, outputTokens: 0, totalDurationMs: 0 }
    m.ticks++
    m.inputTokens += inTok
    m.outputTokens += outTok
    m.totalDurationMs += t.durationMs || 0
    modelMap.set(modelKey, m)

    // Mode breakdown
    const modeKey = t.mode || 'unknown'
    const md = modeMap.get(modeKey) ?? { ticks: 0, inputTokens: 0, outputTokens: 0 }
    md.ticks++
    md.inputTokens += inTok
    md.outputTokens += outTok
    modeMap.set(modeKey, md)

    // Time bucket
    const bucketKey = toBucketKey(t.timestamp, granularity)
    const b = bucketMap.get(bucketKey) ?? { inputTokens: 0, outputTokens: 0, ticks: 0 }
    b.inputTokens += inTok
    b.outputTokens += outTok
    b.ticks++
    bucketMap.set(bucketKey, b)
  }

  const totalTokens = totalIn + totalOut

  // Build breakdown arrays (sorted descending by total tokens)
  const byModel: ModelBreakdown[] = Array.from(modelMap.entries())
    .map(([model, v]) => ({
      model,
      ticks: v.ticks,
      inputTokens: v.inputTokens,
      outputTokens: v.outputTokens,
      totalTokens: v.inputTokens + v.outputTokens,
      avgDurationMs: v.ticks > 0 ? Math.round(v.totalDurationMs / v.ticks) : 0,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens)

  const byMode: ModeBreakdown[] = Array.from(modeMap.entries())
    .map(([mode, v]) => ({
      mode,
      ticks: v.ticks,
      inputTokens: v.inputTokens,
      outputTokens: v.outputTokens,
      totalTokens: v.inputTokens + v.outputTokens,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens)

  // Build time series (sorted ascending by bucket)
  const timeSeries: TimeBucket[] = Array.from(bucketMap.entries())
    .map(([bucket, v]) => ({
      bucket,
      granularity,
      inputTokens: v.inputTokens,
      outputTokens: v.outputTokens,
      totalTokens: v.inputTokens + v.outputTokens,
      ticks: v.ticks,
    }))
    .sort((a, b) => (a.bucket < b.bucket ? -1 : 1))

  // Fill empty buckets so the chart has continuity
  const filledTimeSeries = fillBuckets(timeSeries, startMs, endMs, granularity)

  return {
    generatedAt: now.toISOString(),
    windowHours: hours,
    windowStart: new Date(startMs).toISOString(),
    windowEnd: now.toISOString(),

    totalTicks: ticks.length,
    totalInputTokens: totalIn,
    totalOutputTokens: totalOut,
    totalTokens,
    avgTokensPerTick: ticks.length > 0 ? Math.round(totalTokens / ticks.length) : 0,

    empiricalCapTokens,
    empiricalCapAt,
    percentOfCap:
      empiricalCapTokens !== null && empiricalCapTokens > 0
        ? round2(totalTokens / empiricalCapTokens)
        : null,

    authFailures,
    quotaFailures,
    quotaFailEvents,

    byModel,
    byMode,
    timeSeries: filledTimeSeries,
  }
}

// ── Bucket helpers ───────────────────────────────────────────────

/**
 * Convert an ISO timestamp to a bucket key.
 * Hourly: "2026-04-27T10:00" — truncate to hour.
 * Daily:  "2026-04-27" — truncate to day.
 */
function toBucketKey(timestamp: string, granularity: 'hour' | 'day'): string {
  if (granularity === 'day') return timestamp.slice(0, 10)
  // Hour: "YYYY-MM-DDTHH:00"
  return timestamp.slice(0, 13) + ':00'
}

/**
 * Fill empty time buckets between start and end so the chart doesn't
 * have gaps. This is important for visual continuity.
 */
function fillBuckets(
  existing: TimeBucket[],
  startMs: number,
  endMs: number,
  granularity: 'hour' | 'day',
): TimeBucket[] {
  const existingMap = new Map(existing.map(b => [b.bucket, b]))
  const result: TimeBucket[] = []
  const stepMs = granularity === 'hour' ? 3_600_000 : 86_400_000

  // Align start to bucket boundary
  const start = new Date(startMs)
  if (granularity === 'hour') {
    start.setMinutes(0, 0, 0)
  } else {
    start.setHours(0, 0, 0, 0)
  }

  let cursor = start.getTime()
  while (cursor <= endMs) {
    const key = toBucketKey(new Date(cursor).toISOString(), granularity)
    const existing = existingMap.get(key)
    if (existing) {
      result.push(existing)
    } else {
      result.push({
        bucket: key,
        granularity,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        ticks: 0,
      })
    }
    cursor += stepMs
  }

  return result
}

// ── Utilities ────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
