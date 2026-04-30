// confidence/monitor.ts — confidence over time.
//
// JSONL append-only log. One entry per meaningful reading
// (not every tick — only when the band position changes,
// a counter fires, or an inspection runs).
//
// Design: thin I/O boundary. Pure reads. No side effects except append.

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import type { ConfidenceHistoryEntry, ConfidenceReading, BandPosition } from './types.js'

// ── Path resolution ─────────────────────────────────────────────────

function resolveHome(): string {
  return process.env.TRUE_LOVE_HOME || join(
    process.env.HOME || homedir(),
    '.true-love',
  )
}

function resolveMonitorPath(overridePath?: string): string {
  if (overridePath) return overridePath
  return join(resolveHome(), 'confidence', 'history.jsonl')
}

// ── Write ───────────────────────────────────────────────────────────

/**
 * Log a confidence reading to the history.
 * Only log when something noteworthy happened:
 *   - Band position changed from last entry
 *   - A counter or temperance response fired
 *   - Explicitly triggered (inspection, manual)
 */
export function logReading(
  reading: ConfidenceReading,
  opts?: {
    responseType?: 'counter' | 'temperance' | null
    trigger?: string
    path?: string
  },
): void {
  const path = resolveMonitorPath(opts?.path)

  // Check if this is noteworthy (position changed or response fired)
  const last = lastEntry({ path })
  const positionChanged = !last || last.position !== reading.position
  const hasResponse = opts?.responseType != null
  const hasTrigger = !!opts?.trigger

  if (!positionChanged && !hasResponse && !hasTrigger) return

  const entry: ConfidenceHistoryEntry = {
    ts: reading.readAt,
    value: reading.value,
    position: reading.position,
    ...(opts?.responseType ? { responseType: opts.responseType } : {}),
    ...(opts?.trigger ? { trigger: opts.trigger } : {}),
  }

  const dir = dirname(path)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  appendFileSync(path, JSON.stringify(entry) + '\n', 'utf-8')
}

// ── Read ────────────────────────────────────────────────────────────

/**
 * Read all history entries. Returns newest-first.
 */
export function readHistory(opts?: {
  path?: string
  limit?: number
  since?: string
}): ConfidenceHistoryEntry[] {
  const path = resolveMonitorPath(opts?.path)
  if (!existsSync(path)) return []

  try {
    const text = readFileSync(path, 'utf-8')
    const entries: ConfidenceHistoryEntry[] = []

    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed = JSON.parse(trimmed) as ConfidenceHistoryEntry
        if (opts?.since && parsed.ts < opts.since) continue
        entries.push(parsed)
      } catch { /* skip malformed */ }
    }

    entries.reverse() // newest first

    if (opts?.limit && opts.limit > 0) {
      return entries.slice(0, opts.limit)
    }
    return entries
  } catch {
    return []
  }
}

/**
 * Get the most recent entry. Returns null if no history.
 */
export function lastEntry(opts?: { path?: string }): ConfidenceHistoryEntry | null {
  const path = resolveMonitorPath(opts?.path)
  if (!existsSync(path)) return null

  try {
    const text = readFileSync(path, 'utf-8')
    const lines = text.split('\n').filter(Boolean)
    if (lines.length === 0) return null
    return JSON.parse(lines[lines.length - 1]!) as ConfidenceHistoryEntry
  } catch {
    return null
  }
}

// ── Trend analysis ──────────────────────────────────────────────────

/**
 * Compute a simple trend from recent history.
 * Returns 'rising', 'falling', 'stable', or 'insufficient-data'.
 */
export function computeTrend(opts?: {
  path?: string
  windowHours?: number
}): 'rising' | 'falling' | 'stable' | 'insufficient-data' {
  const hours = opts?.windowHours ?? 72
  const since = new Date(Date.now() - hours * 3600_000).toISOString()
  const entries = readHistory({ path: opts?.path, since })

  if (entries.length < 3) return 'insufficient-data'

  // Compare oldest and newest in the window
  const newest = entries[0]!.value
  const oldest = entries[entries.length - 1]!.value
  const delta = newest - oldest

  if (delta > 0.1) return 'rising'
  if (delta < -0.1) return 'falling'
  return 'stable'
}

/**
 * Count how many times the counter and temperance fired in a window.
 */
export function responseStats(opts?: {
  path?: string
  windowHours?: number
}): { counterFires: number; temperanceFires: number } {
  const hours = opts?.windowHours ?? 168
  const since = new Date(Date.now() - hours * 3600_000).toISOString()
  const entries = readHistory({ path: opts?.path, since })

  let counterFires = 0
  let temperanceFires = 0

  for (const e of entries) {
    if (e.responseType === 'counter') counterFires++
    if (e.responseType === 'temperance') temperanceFires++
  }

  return { counterFires, temperanceFires }
}

/**
 * Render a compact trend line for /build or vitals.
 */
export function renderTrend(opts?: { path?: string }): string | null {
  const trend = computeTrend(opts)
  const stats = responseStats(opts)

  if (trend === 'insufficient-data') return null

  const trendEmoji = trend === 'rising' ? '↑'
    : trend === 'falling' ? '↓'
    : '→'

  const parts: string[] = [`confidence trend: ${trendEmoji} ${trend}`]

  if (stats.counterFires > 0) {
    parts.push(`counter: ${stats.counterFires}×`)
  }
  if (stats.temperanceFires > 0) {
    parts.push(`temperance: ${stats.temperanceFires}×`)
  }

  return parts.join(' · ')
}
