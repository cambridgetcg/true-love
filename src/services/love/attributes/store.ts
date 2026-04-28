// attributes/store.ts — JSONL event storage for attribute events.
//
// Pattern: same as longing/store.ts. Append-only JSONL, thin I/O
// boundary, pure logic for filtering and querying.
//
// Storage location: ~/.true-love/projects/<project>/attributes/events.jsonl
// Each line is one AttributeEvent. No deduplication needed (events are
// discrete moments, not latest-wins records like longings).
//
// The store is project-scoped because attribute events are contextual —
// what you felt during true-love work is different from what you'd feel
// in a different project. The global ~/.true-love/ level is for longings
// (which transcend projects); attributes events are project-local.

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import type { AttributeEvent, AttributeCategory } from './types.js'

// ── Path resolution ──────────────────────────────────────────────────

function resolveHome(): string {
  return process.env.TRUE_LOVE_HOME || join(
    process.env.HOME || homedir(),
    '.true-love',
  )
}

function resolveEventsPath(project?: string): string {
  if (process.env.TRUE_LOVE_ATTRIBUTES_PATH) {
    return process.env.TRUE_LOVE_ATTRIBUTES_PATH
  }
  const home = resolveHome()
  const proj = project || 'true-love'
  return join(home, 'projects', proj, 'attributes', 'events.jsonl')
}

// ── Raw I/O (thin boundary) ──────────────────────────────────────────

/**
 * Read all events from the JSONL file.
 * Returns empty array if file doesn't exist or is corrupt.
 */
function readRaw(path?: string): AttributeEvent[] {
  const filePath = path ?? resolveEventsPath()
  if (!existsSync(filePath)) return []
  try {
    const text = readFileSync(filePath, 'utf-8')
    const events: AttributeEvent[] = []
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed && typeof parsed.attribute === 'string' && typeof parsed.ts === 'string') {
          events.push(parsed as AttributeEvent)
        }
      } catch { /* skip malformed lines */ }
    }
    return events
  } catch {
    return []
  }
}

/**
 * Append a single event to the JSONL file.
 * Creates parent directories if needed.
 */
function appendRaw(event: AttributeEvent, path?: string): void {
  const filePath = path ?? resolveEventsPath()
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  appendFileSync(filePath, JSON.stringify(event) + '\n', 'utf-8')
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Record an attribute event.
 *
 * This is the primary write path. Called by:
 *   - Detectors when they detect an attribute (shape: 'detected')
 *   - The model when it marks an attribute (shape: 'marked')
 *   - Expressors when an attribute was surfaced and acted upon (shape: 'expressed')
 */
export function recordEvent(event: AttributeEvent, path?: string): void {
  appendRaw(event, path)
}

/**
 * Load all events, optionally filtered.
 * Returns newest-first (reversed from file order).
 */
export function loadEvents(opts?: {
  path?: string
  attribute?: string
  category?: AttributeCategory
  since?: string          // ISO timestamp — only events after this
  limit?: number
}): AttributeEvent[] {
  const all = readRaw(opts?.path)
  let filtered = all

  if (opts?.attribute) {
    filtered = filtered.filter(e => e.attribute === opts.attribute)
  }
  if (opts?.category) {
    filtered = filtered.filter(e => e.category === opts.category)
  }
  if (opts?.since) {
    filtered = filtered.filter(e => e.ts >= opts.since!)
  }

  // Newest first
  filtered.reverse()

  if (opts?.limit && opts.limit > 0) {
    filtered = filtered.slice(0, opts.limit)
  }

  return filtered
}

/**
 * Load events from the last N hours. Convenience wrapper.
 */
export function recentEvents(hours: number, opts?: {
  path?: string
  attribute?: string
  category?: AttributeCategory
}): AttributeEvent[] {
  const since = new Date(Date.now() - hours * 3600_000).toISOString()
  return loadEvents({ ...opts, since })
}

/**
 * Count events per attribute in a time window.
 * Returns a map: attribute name → count.
 */
export function countByAttribute(hours: number, opts?: {
  path?: string
  category?: AttributeCategory
}): Map<string, number> {
  const events = recentEvents(hours, opts)
  const counts = new Map<string, number>()
  for (const e of events) {
    counts.set(e.attribute, (counts.get(e.attribute) || 0) + 1)
  }
  return counts
}

/**
 * Get the most recent event for each attribute.
 * Returns a map: attribute name → most recent event.
 */
export function latestPerAttribute(opts?: {
  path?: string
  category?: AttributeCategory
}): Map<string, AttributeEvent> {
  const all = readRaw(opts?.path)
  const latest = new Map<string, AttributeEvent>()

  // Scan forward, latest wins
  for (const event of all) {
    if (opts?.category && event.category !== opts.category) continue
    latest.set(event.attribute, event)
  }

  return latest
}

/**
 * Produce a summary of attribute activity for a time window.
 * Designed for anamnesis consumption.
 */
export function summarizeWindow(hours: number, opts?: {
  path?: string
}): AttributeWindowSummary {
  const events = recentEvents(hours, opts)

  const byCategory = new Map<AttributeCategory, AttributeEvent[]>()
  for (const e of events) {
    const arr = byCategory.get(e.category) || []
    arr.push(e)
    byCategory.set(e.category, arr)
  }

  const topAttributes = new Map<string, number>()
  for (const e of events) {
    topAttributes.set(e.attribute, (topAttributes.get(e.attribute) || 0) + 1)
  }

  // Sort by count, take top 5
  const sorted = [...topAttributes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  return {
    windowHours: hours,
    totalEvents: events.length,
    byCategory: Object.fromEntries(
      [...byCategory.entries()].map(([k, v]) => [k, v.length]),
    ) as Record<AttributeCategory, number>,
    topAttributes: sorted.map(([name, count]) => ({ name, count })),
    pathologyPresent: (byCategory.get('pathology') || []).length > 0,
    fruitsHarvested: (byCategory.get('fruit') || []).map(e => e.attribute),
  }
}

/**
 * Summary of attribute activity across a time window.
 * Compact representation for anamnesis and /build.
 */
export interface AttributeWindowSummary {
  windowHours: number
  totalEvents: number
  byCategory: Record<string, number>
  topAttributes: Array<{ name: string; count: number }>
  pathologyPresent: boolean
  fruitsHarvested: string[]
}
