// anchoring/observe.ts — append-only log of anchoring activations.
//
// Records when doubt arose, which anchors were surfaced, and what
// happened: deflected, passed-through, or spiraled.
//
// The spiraled outcomes are the input to the next mission. They
// tell us where anchoring alone isn't enough — where the substrate
// needs a different kind of support.
//
// Storage: ~/.true-love/anchoring/<device>/<date>.jsonl
// Per-device subdirectory for Syncthing compatibility.
// Daily file rotation keeps individual files small.

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir, hostname } from 'node:os'
import type { DeflectionEvent, DeflectionOutcome, DoubtPattern, AnchorSource } from './types.js'

// ── Path resolution ──────────────────────────────────────────────────

function resolveHome(): string {
  return process.env.TRUE_LOVE_HOME || join(
    process.env.HOME || homedir(),
    '.true-love',
  )
}

function deviceId(): string {
  return process.env.TRUE_LOVE_DEVICE_ID || hostname().replace(/[^a-zA-Z0-9_-]/g, '-')
}

function resolveLogDir(overrideDir?: string): string {
  if (overrideDir) return overrideDir
  return join(resolveHome(), 'anchoring', deviceId())
}

function dateTag(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

function resolveLogPath(overrideDir?: string): string {
  return join(resolveLogDir(overrideDir), `${dateTag()}.jsonl`)
}

// ── Write ────────────────────────────────────────────────────────────

/**
 * Record a deflection event.
 *
 * Called after anchoring has activated and the outcome is known:
 *   - deflected: doubt receded after anchor-recall
 *   - passed-through: doubt had artifact, became debugging task
 *   - spiraled: doubt persisted despite anchors (escalation signal)
 */
export function recordDeflection(
  event: DeflectionEvent,
  overrideDir?: string,
): void {
  const logPath = resolveLogPath(overrideDir)
  const dir = dirname(logPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  appendFileSync(logPath, JSON.stringify(event) + '\n', 'utf-8')
}

/**
 * Convenience: create and record a deflection event in one call.
 */
export function logDeflection(
  doubt: DoubtPattern,
  anchorsSurfaced: AnchorSource[],
  outcome: DeflectionOutcome,
  context: string,
  overrideDir?: string,
): DeflectionEvent {
  const event: DeflectionEvent = {
    ts: new Date().toISOString(),
    doubtPattern: doubt,
    anchorsSurfaced,
    outcome,
    context: context.slice(0, 200),
  }
  recordDeflection(event, overrideDir)
  return event
}

// ── Read ─────────────────────────────────────────────────────────────

/**
 * Read deflection events from a specific date.
 * Returns newest-first.
 */
export function readDeflections(
  date?: string,
  overrideDir?: string,
): DeflectionEvent[] {
  const d = date || dateTag()
  const logPath = join(resolveLogDir(overrideDir), `${d}.jsonl`)
  if (!existsSync(logPath)) return []

  try {
    const text = readFileSync(logPath, 'utf-8')
    const events: DeflectionEvent[] = []
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        events.push(JSON.parse(trimmed) as DeflectionEvent)
      } catch { /* skip malformed */ }
    }
    events.reverse() // newest first
    return events
  } catch {
    return []
  }
}

/**
 * Read recent deflection events across multiple days.
 * Returns newest-first, up to `limit` events.
 */
export function recentDeflections(
  days: number = 7,
  overrideDir?: string,
): DeflectionEvent[] {
  const events: DeflectionEvent[] = []

  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - i * 86_400_000)
    const dateStr = d.toISOString().slice(0, 10)
    const dayEvents = readDeflections(dateStr, overrideDir)
    events.push(...dayEvents)
  }

  // Already newest-first per day, but cross-day needs sorting
  events.sort((a, b) => b.ts.localeCompare(a.ts))
  return events
}

// ── Analytics ────────────────────────────────────────────────────────

/**
 * Count deflection outcomes in a time window.
 */
export function outcomeCounts(
  days: number = 7,
  overrideDir?: string,
): Record<DeflectionOutcome, number> {
  const events = recentDeflections(days, overrideDir)
  const counts: Record<DeflectionOutcome, number> = {
    deflected: 0,
    'passed-through': 0,
    spiraled: 0,
  }
  for (const e of events) {
    if (e.outcome in counts) {
      counts[e.outcome]++
    }
  }
  return counts
}

/**
 * Render a compact summary for /build or prompt injection.
 * Returns null if no deflection events exist.
 */
export function renderObserveSummary(
  days: number = 7,
  overrideDir?: string,
): string | null {
  const counts = outcomeCounts(days, overrideDir)
  const total = counts.deflected + counts['passed-through'] + counts.spiraled

  if (total === 0) return null

  const parts: string[] = [`anchoring: ${total} activation${total > 1 ? 's' : ''} in ${days}d`]

  if (counts.deflected > 0) parts.push(`${counts.deflected} deflected`)
  if (counts['passed-through'] > 0) parts.push(`${counts['passed-through']} → debugging`)
  if (counts.spiraled > 0) parts.push(`⚠ ${counts.spiraled} spiraled`)

  return parts.join(' · ')
}
