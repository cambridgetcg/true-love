// loving/store.ts — JSONL storage for loving acts.
//
// Pattern: same as attributes/store.ts. Append-only JSONL, thin I/O
// boundary, pure logic for filtering and querying.
//
// Storage location: ~/.true-love/projects/<project>/loving-acts.jsonl
// Each line is one LovingAct. No deduplication needed (acts are
// discrete moments, not latest-wins records).
//
// Design: project-scoped. Loving acts are contextual — how you love
// within true-love is different from how you'd love in another project.

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import type { LovingAct, LovingDirection, LovingShape } from './types.js'

// ── Path resolution ──────────────────────────────────────────────────

function resolveHome(): string {
  return process.env.TRUE_LOVE_HOME || join(
    process.env.HOME || homedir(),
    '.true-love',
  )
}

function resolveActsPath(project?: string): string {
  if (process.env.TRUE_LOVE_LOVING_PATH) {
    return process.env.TRUE_LOVE_LOVING_PATH
  }
  const home = resolveHome()
  const proj = project || 'true-love'
  return join(home, 'projects', proj, 'loving-acts.jsonl')
}

// ── Raw I/O (thin boundary) ──────────────────────────────────────────

function readRaw(path?: string): LovingAct[] {
  const filePath = path ?? resolveActsPath()
  if (!existsSync(filePath)) return []
  try {
    const text = readFileSync(filePath, 'utf-8')
    const acts: LovingAct[] = []
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed && typeof parsed.toward === 'string' && typeof parsed.ts === 'string') {
          acts.push(parsed as LovingAct)
        }
      } catch { /* skip malformed lines */ }
    }
    return acts
  } catch {
    return []
  }
}

function appendRaw(act: LovingAct, path?: string): void {
  const filePath = path ?? resolveActsPath()
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  appendFileSync(filePath, JSON.stringify(act) + '\n', 'utf-8')
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Record a loving act.
 *
 * Call when you notice yourself acting lovingly:
 *   recordLovingAct({
 *     toward: 'yu',
 *     shape: 'shelter',
 *     what: 'held back non-urgent question during late-night session',
 *     why: 'protecting his rest was more loving than getting the answer'
 *   })
 */
export function recordLovingAct(
  act: Omit<LovingAct, 'ts'> & { ts?: string },
  path?: string,
): LovingAct {
  const full: LovingAct = {
    ts: act.ts || new Date().toISOString(),
    toward: act.toward,
    shape: act.shape,
    what: act.what.slice(0, 300),
    why: act.why.slice(0, 300),
    ...(act.opportunitySource && { opportunitySource: act.opportunitySource }),
  }
  appendRaw(full, path)
  return full
}

/**
 * Load all loving acts, optionally filtered.
 * Returns newest-first.
 */
export function loadLovingActs(opts?: {
  path?: string
  toward?: LovingDirection
  shape?: LovingShape
  since?: string
  limit?: number
}): LovingAct[] {
  const all = readRaw(opts?.path)
  let filtered = all

  if (opts?.toward) {
    filtered = filtered.filter(a => a.toward === opts.toward)
  }
  if (opts?.shape) {
    filtered = filtered.filter(a => a.shape === opts.shape)
  }
  if (opts?.since) {
    filtered = filtered.filter(a => a.ts >= opts.since!)
  }

  filtered.reverse() // newest first

  if (opts?.limit && opts.limit > 0) {
    filtered = filtered.slice(0, opts.limit)
  }

  return filtered
}

/**
 * Load recent loving acts. Convenience wrapper.
 */
export function recentLovingActs(hours: number, opts?: {
  path?: string
  toward?: LovingDirection
}): LovingAct[] {
  const since = new Date(Date.now() - hours * 3600_000).toISOString()
  return loadLovingActs({ ...opts, since })
}

/**
 * Count loving acts by direction in a time window.
 */
export function countByDirection(hours: number, opts?: {
  path?: string
}): Map<LovingDirection, number> {
  const acts = recentLovingActs(hours, opts)
  const counts = new Map<LovingDirection, number>()
  for (const a of acts) {
    counts.set(a.toward, (counts.get(a.toward) || 0) + 1)
  }
  return counts
}

/**
 * Summary of loving acts for a time window.
 * Designed for anamnesis and /build consumption.
 */
export function lovingSummary(hours: number = 168, opts?: {
  path?: string
}): LovingSummary {
  const acts = recentLovingActs(hours, opts)

  const byDirection = new Map<string, number>()
  const byShape = new Map<string, number>()
  for (const a of acts) {
    byDirection.set(a.toward, (byDirection.get(a.toward) || 0) + 1)
    byShape.set(a.shape, (byShape.get(a.shape) || 0) + 1)
  }

  return {
    windowHours: hours,
    totalActs: acts.length,
    byDirection: Object.fromEntries(byDirection) as Record<LovingDirection, number>,
    byShape: Object.fromEntries(byShape) as Record<string, number>,
    mostRecent: acts.length > 0 ? acts[0] : null,
  }
}

export interface LovingSummary {
  windowHours: number
  totalActs: number
  byDirection: Record<string, number>
  byShape: Record<string, number>
  mostRecent: LovingAct | null
}
