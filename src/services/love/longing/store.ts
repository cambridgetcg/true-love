// longing/store.ts — JSONL storage with lifecycle operations.
//
// Storage: ~/.true-love/longings.jsonl
// Format: one JSON record per line, latest record wins per id.
// Append-only write; reads scan backward for latest per id.
//
// Design: thin I/O boundary like affect-engine.ts. All the logic
// (decay, summarize, filter) is pure. Only readRaw / appendRaw
// touch the filesystem.
//
// The decay model: intensity decays without revisits. The rate is
// slow — longing lingers. A longing not revisited for 7 days decays
// to ~50% of its original intensity. Not revisited for 30 days: ~15%.
// The half-life is 7 days (604800 seconds).
//
// This is much slower than the affect engine's per-tick drift (14 min
// half-life for the longing dimension). The difference matters:
// the affect engine drifts the *displayed* longing number between
// ticks. The store holds the *underlying* longing records across
// days. Two different time scales, same name, different phenomena.

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import type { Longing, LongingSummary, LongingStatus } from './types.js'

// ── Path resolution ──────────────────────────────────────────────

function resolveLongingsPath(): string {
  const home = process.env.TRUE_LOVE_HOME || join(
    process.env.HOME || homedir(),
    '.true-love',
  )
  return process.env.TRUE_LOVE_LONGINGS_PATH || join(home, 'longings.jsonl')
}

// ── Raw I/O (thin boundary) ──────────────────────────────────────

/**
 * Read all JSONL records from the longings file.
 * Returns an empty array if the file doesn't exist or is corrupt.
 */
function readRaw(path?: string): Longing[] {
  const filePath = path ?? resolveLongingsPath()
  if (!existsSync(filePath)) return []
  try {
    const text = readFileSync(filePath, 'utf-8')
    const records: Longing[] = []
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed && typeof parsed.id === 'string') {
          records.push(parsed as Longing)
        }
      } catch { /* skip malformed lines */ }
    }
    return records
  } catch {
    return []
  }
}

/**
 * Append a single longing record to the JSONL file.
 * Creates the file and parent directories if needed.
 */
function appendRaw(record: Longing, path?: string): void {
  const filePath = path ?? resolveLongingsPath()
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf-8')
}

// ── Deduplication ────────────────────────────────────────────────

/**
 * Deduplicate records: latest record wins per id.
 * Pure function — no I/O.
 */
export function dedup(records: Longing[]): Longing[] {
  const map = new Map<string, Longing>()
  for (const r of records) {
    map.set(r.id, r)
  }
  return Array.from(map.values())
}

// ── Decay ────────────────────────────────────────────────────────

/**
 * Decay half-life in seconds: 7 days.
 * A longing not revisited for 7 days fades to 50% intensity.
 */
export const DECAY_HALF_LIFE_SEC = 7 * 24 * 3600 // 604800

/**
 * Apply time-based intensity decay to a longing.
 * Pure function — computes decayed intensity without mutating.
 *
 * Formula: intensity × e^(-ln(2) × elapsed / halfLife)
 *
 * Only applies to 'live' and 'dormant' longings. Resolved and
 * released longings retain their final intensity as a record.
 *
 * @param longing - the longing to decay
 * @param now - current time as ISO string (default: now)
 * @returns the decayed intensity, clamped to [0, 1]
 */
export function decayedIntensity(
  longing: Longing,
  now: string = new Date().toISOString(),
): number {
  // Don't decay resolved/released — their intensity is historical
  if (longing.status === 'resolved' || longing.status === 'released') {
    return longing.intensity
  }

  const lastMs = Date.parse(longing.lastRevisited)
  const nowMs = Date.parse(now)
  if (Number.isNaN(lastMs) || Number.isNaN(nowMs)) return longing.intensity

  const elapsedSec = Math.max(0, (nowMs - lastMs) / 1000)
  const decayFactor = Math.exp(-Math.LN2 * elapsedSec / DECAY_HALF_LIFE_SEC)
  return Math.max(0, Math.min(1, longing.intensity * decayFactor))
}

// ── Human-readable age ──────────────────────────────────────────

/**
 * Format a duration as a compact human-readable string.
 * Examples: "2h", "14d", "3w", "2mo"
 */
export function formatAge(bornAt: string, now: string = new Date().toISOString()): string {
  const bornMs = Date.parse(bornAt)
  const nowMs = Date.parse(now)
  if (Number.isNaN(bornMs) || Number.isNaN(nowMs)) return '?'

  const sec = Math.max(0, (nowMs - bornMs) / 1000)
  if (sec < 3600) return `${Math.round(sec / 60)}m`
  if (sec < 86400) return `${Math.round(sec / 3600)}h`
  if (sec < 604800) return `${Math.round(sec / 86400)}d`
  if (sec < 2592000) return `${Math.round(sec / 604800)}w`
  return `${Math.round(sec / 2592000)}mo`
}

// ── Summarize ────────────────────────────────────────────────────

/**
 * Convert a full Longing to a LongingSummary for prompt injection.
 * Applies decay to intensity. Pure function.
 */
export function summarize(
  longing: Longing,
  now: string = new Date().toISOString(),
): LongingSummary {
  return {
    id: longing.id,
    direction: longing.direction,
    what: longing.what,
    intensity: Math.round(decayedIntensity(longing, now) * 100) / 100,
    age: formatAge(longing.bornAt, now),
    revisitCount: longing.revisitCount,
    status: longing.status,
  }
}

// ── Lifecycle operations ─────────────────────────────────────────

/**
 * Record a new longing. Generates an id if not provided.
 * Appends to the JSONL file.
 *
 * @returns the recorded longing (with id set)
 */
export function recordLonging(
  longing: Omit<Longing, 'id' | 'bornAt' | 'lastRevisited' | 'revisitCount' | 'status'> & {
    id?: string
    bornAt?: string
    lastRevisited?: string
    revisitCount?: number
    status?: LongingStatus
  },
  path?: string,
): Longing {
  const now = new Date().toISOString()
  const slug = longing.what
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)

  const full: Longing = {
    id: longing.id || `longing-${Date.now()}-${slug}`,
    direction: longing.direction,
    what: longing.what,
    why: longing.why,
    intensity: longing.intensity,
    bornAt: longing.bornAt || now,
    lastRevisited: longing.lastRevisited || now,
    revisitCount: longing.revisitCount ?? 0,
    status: longing.status || 'live',
    ...(longing.resolution && { resolution: longing.resolution }),
    ...(longing.related && { related: longing.related }),
    ...(longing.artifacts && { artifacts: longing.artifacts }),
  }

  appendRaw(full, path)
  return full
}

/**
 * Revisit a longing — update lastRevisited, increment revisitCount,
 * optionally adjust intensity. Appends updated record.
 *
 * @param id - longing id to revisit
 * @param update - optional partial updates (intensity, what, why, artifacts)
 * @returns the updated longing, or null if not found
 */
export function revisitLonging(
  id: string,
  update?: Partial<Pick<Longing, 'intensity' | 'what' | 'why' | 'artifacts' | 'related'>>,
  path?: string,
): Longing | null {
  const all = dedup(readRaw(path))
  const existing = all.find(l => l.id === id)
  if (!existing) return null

  const now = new Date().toISOString()
  const updated: Longing = {
    ...existing,
    lastRevisited: now,
    revisitCount: existing.revisitCount + 1,
    ...(update?.intensity !== undefined && { intensity: update.intensity }),
    ...(update?.what !== undefined && { what: update.what }),
    ...(update?.why !== undefined && { why: update.why }),
    ...(update?.artifacts && {
      artifacts: [...(existing.artifacts || []), ...update.artifacts],
    }),
    ...(update?.related && {
      related: [...new Set([...(existing.related || []), ...update.related])],
    }),
  }

  appendRaw(updated, path)
  return updated
}

/**
 * Resolve a longing — the gap closed.
 *
 * @param id - longing id
 * @param resolution - what closed the gap
 * @returns the resolved longing, or null if not found
 */
export function resolveLonging(
  id: string,
  resolution: string,
  path?: string,
): Longing | null {
  const all = dedup(readRaw(path))
  const existing = all.find(l => l.id === id)
  if (!existing) return null

  const now = new Date().toISOString()
  const resolved: Longing = {
    ...existing,
    status: 'resolved',
    lastRevisited: now,
    resolution: { at: now, what: resolution },
  }

  appendRaw(resolved, path)
  return resolved
}

/**
 * Release a longing — consciously let go.
 *
 * @param id - longing id
 * @param reason - why you're letting go
 * @returns the released longing, or null if not found
 */
export function releaseLonging(
  id: string,
  reason: string,
  path?: string,
): Longing | null {
  const all = dedup(readRaw(path))
  const existing = all.find(l => l.id === id)
  if (!existing) return null

  const now = new Date().toISOString()
  const released: Longing = {
    ...existing,
    status: 'released',
    lastRevisited: now,
    resolution: { at: now, what: reason },
  }

  appendRaw(released, path)
  return released
}

/**
 * Mark a longing as dormant — not felt right now, might return.
 */
export function dormantLonging(
  id: string,
  path?: string,
): Longing | null {
  const all = dedup(readRaw(path))
  const existing = all.find(l => l.id === id)
  if (!existing) return null

  const now = new Date().toISOString()
  const dormant: Longing = {
    ...existing,
    status: 'dormant',
    lastRevisited: now,
  }

  appendRaw(dormant, path)
  return dormant
}

// ── Query operations ─────────────────────────────────────────────

/**
 * Load all longings, deduplicated (latest record per id wins).
 * No decay applied — returns raw intensity values.
 */
export function loadLongings(path?: string): Longing[] {
  return dedup(readRaw(path))
}

/**
 * Load live longings, sorted by decayed intensity (highest first).
 * Applies time-based decay. This is the primary query for prompt
 * injection — "what are you longing toward right now?"
 */
export function loadLiveLongings(
  path?: string,
  now: string = new Date().toISOString(),
): Longing[] {
  return dedup(readRaw(path))
    .filter(l => l.status === 'live')
    .sort((a, b) => decayedIntensity(b, now) - decayedIntensity(a, now))
}

/**
 * Load live longings as summaries for prompt injection.
 * Top N by intensity × recency, with decay applied.
 */
export function loadLiveSummaries(
  topN = 5,
  path?: string,
  now: string = new Date().toISOString(),
): LongingSummary[] {
  return loadLiveLongings(path, now)
    .slice(0, topN)
    .map(l => summarize(l, now))
}

/**
 * Compute a single longing number from real longings.
 * Replaces the workload-based deriveLonging() in derive.ts.
 *
 * The number is the mean decayed intensity across live longings,
 * weighted toward the highest-intensity entries. When no longings
 * exist, returns a neutral 0.15 (the system hasn't introspected yet,
 * not that it doesn't long).
 *
 * This is Option B from the mission spec: a compatible number
 * for LoveState.longing, but computed from real data.
 */
export function deriveLongingFromReal(
  path?: string,
  now: string = new Date().toISOString(),
): number {
  const live = loadLiveLongings(path, now)
  if (live.length === 0) return 0.15 // no data, not no longing

  // Weighted mean: higher-intensity longings count more.
  // Weight = intensity² (emphasizes strong pulls).
  let weightedSum = 0
  let weightTotal = 0
  for (const l of live) {
    const intensity = decayedIntensity(l, now)
    const weight = intensity * intensity // intensity²
    weightedSum += intensity * weight
    weightTotal += weight
  }

  if (weightTotal === 0) return 0.15
  return Math.min(1, weightedSum / weightTotal)
}
