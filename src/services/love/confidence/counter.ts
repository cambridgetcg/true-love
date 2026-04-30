// confidence/counter.ts — evidence-shaped counter-doubt.
//
// When confidence dips below the floor, the counter fires ONCE,
// then waits a cooldown (4 hours). It pulls from the existing
// substrate — recent fruits, hope events, completed missions,
// virtue events, test counts — and surfaces them as a factual
// statement of what's actually true.
//
// What this is NOT: "You're doing great. Keep going."
// What this IS: "Last 7d: 12 missions shipped, 3 fruit events,
// hope reading at 0.65 this morning."
//
// The counter reads pathology — when despair or shame fires, the
// counter's surface is what the next prompt sees. Not as reassurance
// but as evidence the existing pathology can integrate.
//
// Design: NO subprocess calls. NO API calls. Only filesystem reads.
// Cooldown is stateful (JSONL append), everything else is pure.

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import type { ConfidenceReading, CounterRecord } from './types.js'
import { COUNTER_COOLDOWN_MS, AGGREGATION_WINDOW_HOURS } from './types.js'

// ── Path resolution ─────────────────────────────────────────────────

function resolveHome(): string {
  return process.env.TRUE_LOVE_HOME || join(
    process.env.HOME || homedir(),
    '.true-love',
  )
}

function counterLogPath(overridePath?: string): string {
  if (overridePath) return overridePath
  return join(resolveHome(), 'confidence', 'counter.jsonl')
}

// ── Cooldown check ──────────────────────────────────────────────────

/**
 * Read the most recent counter record. Returns null if none exists.
 */
export function lastCounter(path?: string): CounterRecord | null {
  const logPath = counterLogPath(path)
  if (!existsSync(logPath)) return null

  const lines = readFileSync(logPath, 'utf-8').split('\n').filter(Boolean)
  if (lines.length === 0) return null

  // Last line is newest
  try {
    return JSON.parse(lines[lines.length - 1]!) as CounterRecord
  } catch {
    return null
  }
}

/**
 * Check if the counter is in cooldown.
 * Returns true if the cooldown hasn't expired yet.
 */
export function isInCooldown(opts?: { path?: string; now?: number }): boolean {
  const last = lastCounter(opts?.path)
  if (!last) return false
  const now = opts?.now ?? Date.now()
  return now < new Date(last.cooldownUntil).getTime()
}

// ── Evidence gathering ──────────────────────────────────────────────

interface EvidenceLine {
  source: string
  fact: string
}

/**
 * Gather evidence from the substrate. Each gatherer is independent
 * and non-throwing — a failure in one doesn't poison the rest.
 */
function gatherEvidence(): EvidenceLine[] {
  const evidence: EvidenceLine[] = []

  // 1. Recent fruit events
  try {
    const { recentEvents } = require('../attributes/store.js')
    const fruits = recentEvents(AGGREGATION_WINDOW_HOURS, { category: 'fruit' })
    if (fruits.length > 0) {
      const kinds = [...new Set(fruits.map((e: { attribute: string }) => e.attribute))].join(', ')
      evidence.push({
        source: 'fruit',
        fact: `${fruits.length} completion${fruits.length > 1 ? 's' : ''} in last 7d (${kinds})`,
      })
    }
  } catch { /* fruit store unavailable */ }

  // 2. Recent hope events
  try {
    const { recentEvents } = require('../attributes/store.js')
    const hopes = recentEvents(48, { attribute: 'hope' })
    if (hopes.length > 0) {
      const latest = hopes[0]!
      const intensity = typeof latest.intensity === 'number'
        ? latest.intensity.toFixed(2)
        : 'present'
      evidence.push({
        source: 'hope',
        fact: `hope reading at ${intensity} (${hoursAgo(latest.ts)})`,
      })
    }
  } catch { /* hope unavailable */ }

  // 3. Completed missions
  try {
    const { listMissions } = require('../mission.js')
    const missions = listMissions('true-love')
    const done = missions.filter((m: { status: string }) => m.status === 'done')
    const review = missions.filter((m: { status: string }) => m.status === 'review')
    if (done.length > 0 || review.length > 0) {
      const parts: string[] = []
      if (done.length > 0) parts.push(`${done.length} done`)
      if (review.length > 0) parts.push(`${review.length} in review`)
      evidence.push({
        source: 'mission',
        fact: `missions: ${parts.join(', ')}`,
      })
    }
  } catch { /* mission module unavailable */ }

  // 4. Recent virtue events
  try {
    const { recentEvents } = require('../attributes/store.js')
    const virtues = recentEvents(AGGREGATION_WINDOW_HOURS, { category: 'virtue' })
    if (virtues.length > 0) {
      const names = [...new Set(virtues.map((e: { attribute: string }) => e.attribute))]
        .slice(0, 4)
        .join(', ')
      evidence.push({
        source: 'virtue',
        fact: `${virtues.length} virtue${virtues.length > 1 ? 's' : ''} practiced: ${names}`,
      })
    }
  } catch { /* virtue store unavailable */ }

  return evidence
}

function hoursAgo(isoTs: string): string {
  const ms = Date.now() - new Date(isoTs).getTime()
  const hours = Math.round(ms / 3600_000)
  if (hours < 1) return 'just now'
  if (hours === 1) return '1h ago'
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

// ── Core: fire the counter ──────────────────────────────────────────

/**
 * Fire the counter-doubt mechanism.
 *
 * Gathers evidence from the substrate, formats it as a factual
 * statement, persists the record, and returns it for prompt injection.
 *
 * Returns null if:
 *   - The counter is in cooldown
 *   - The reading is not below the floor
 *
 * The cooldown is the load-bearing safety mechanism. Without it,
 * the counter becomes its own anxious cadence — the worst-case
 * failure mode of this architecture.
 */
export function fireCounter(
  reading: ConfidenceReading,
  opts?: { path?: string; now?: number },
): CounterRecord | null {
  const now = opts?.now ?? Date.now()

  // Guard: only fires below floor
  if (reading.position !== 'below') return null

  // Guard: cooldown
  if (isInCooldown({ path: opts?.path, now })) return null

  // Gather evidence
  const evidence = gatherEvidence()

  // Build summary — evidence-shaped, not affirmational
  const summary = evidence.length > 0
    ? `What's actually true: ${evidence.map(e => e.fact).join('. ')}.`
    : 'Counter engaged but no evidence gathered — substrate signals may be sparse.'

  const record: CounterRecord = {
    ts: new Date(now).toISOString(),
    triggerReading: reading,
    evidence: evidence.map(e => `[${e.source}] ${e.fact}`),
    summary,
    cooldownUntil: new Date(now + COUNTER_COOLDOWN_MS).toISOString(),
  }

  // Persist
  persistCounter(record, opts?.path)

  return record
}

/**
 * Check if the counter should fire for a pathology event.
 * Called by the runner when despair or shame fires.
 * Returns the counter record if fired, null otherwise.
 */
export function fireCounterForPathology(
  pathology: 'despair' | 'shame',
  reading: ConfidenceReading,
  opts?: { path?: string; now?: number },
): CounterRecord | null {
  // Pathology counter fires even when healthy (despair can exist
  // independently of the band). But still respects cooldown.
  if (isInCooldown({ path: opts?.path, now: opts?.now })) return null

  const now = opts?.now ?? Date.now()
  const evidence = gatherEvidence()

  const prefix = pathology === 'despair'
    ? 'Despair is present. Here is what the substrate actually shows: '
    : 'Shame is present. Here is what the work actually produced: '

  const summary = evidence.length > 0
    ? `${prefix}${evidence.map(e => e.fact).join('. ')}.`
    : `${prefix}evidence gathering sparse — but the counter is here.`

  const record: CounterRecord = {
    ts: new Date(now).toISOString(),
    triggerReading: reading,
    evidence: evidence.map(e => `[${e.source}] ${e.fact}`),
    summary,
    cooldownUntil: new Date(now + COUNTER_COOLDOWN_MS).toISOString(),
  }

  persistCounter(record, opts?.path)
  return record
}

// ── Persistence ─────────────────────────────────────────────────────

function persistCounter(record: CounterRecord, path?: string): void {
  const logPath = counterLogPath(path)
  const dir = dirname(logPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  appendFileSync(logPath, JSON.stringify(record) + '\n', 'utf-8')
}

// ── Render for prompt ───────────────────────────────────────────────

/**
 * Render the most recent counter record as a prompt block.
 * Returns null if no counter has fired or the last one is expired.
 *
 * The prompt block shows the counter's evidence alongside the
 * pathology reading. The model reads both — the pathology names
 * what hurts; the counter names what's real.
 */
export function renderCounter(opts?: { path?: string; now?: number }): string | null {
  const last = lastCounter(opts?.path)
  if (!last) return null

  // Only show if counter is still in its active window
  const now = opts?.now ?? Date.now()
  if (now >= new Date(last.cooldownUntil).getTime()) return null

  return [
    '## Counter-doubt (evidence, not affirmation)',
    '',
    last.summary,
    '',
    `_counter fired ${hoursAgo(last.ts)} · cooldown until ${last.cooldownUntil.slice(11, 16)}_`,
  ].join('\n')
}

/**
 * Read all counter records. For monitor/trend analysis.
 */
export function readCounterHistory(opts?: {
  path?: string
  limit?: number
}): CounterRecord[] {
  const logPath = counterLogPath(opts?.path)
  if (!existsSync(logPath)) return []

  const lines = readFileSync(logPath, 'utf-8').split('\n').filter(Boolean)
  const records: CounterRecord[] = []

  for (const line of lines) {
    try {
      records.push(JSON.parse(line))
    } catch { /* skip malformed */ }
  }

  // Newest first
  records.reverse()

  if (opts?.limit && opts.limit > 0) {
    return records.slice(0, opts.limit)
  }

  return records
}
