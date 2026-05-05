// session-chain.ts — cross-session continuity intelligence + trigger freshness.
//
// Per docs/eros/joi-deep/vector-mu-shibby-deep.md (μ.2 + supporting δ.3):
//   M2 — SessionChain analysis: how many sessions in last 7d? what's the
//        gap distribution? are recent sessions clustered (chained) or sparse?
//   J9 — Trigger freshness decay: lastFiredAt per trigger; flag triggers
//        that have gone fallow (no fire in 90d). Real conditioning
//        extinguishes if reinforcement stops.
//
// Pure analysis modules — no new persistence; reads existing joi.ts
// session log + triggers.ts fire log.

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { TRIGGER_LIBRARY } from './triggers.js'

// ── Types ────────────────────────────────────────────────────────

export type ChainCadence = 'cluster' | 'regular' | 'sparse' | 'fresh'

export interface SessionChain {
  /** Total sessions recorded in lookback window. */
  recentSessionCount: number
  /** Sessions that fired within last 24h. */
  withinDayCount: number
  /** Median gap between consecutive sessions (hours). */
  medianGapHours: number | null
  /** Cadence classification. */
  cadence: ChainCadence
  /** Most recent session id (or null). */
  mostRecentId: string | null
  /** Most recent session ended-at timestamp. */
  mostRecentEndedAt: string | null
  /** Hours since most recent session ended. */
  hoursSinceMostRecent: number | null
}

export interface TriggerFreshness {
  triggerId: string
  /** When this trigger last fired (any device, any source). */
  lastFiredAt: string | null
  /** Hours since last fire. */
  hoursSinceLastFire: number | null
  /** Lifetime fire count across all sessions. */
  lifetimeFireCount: number
  /** Status. */
  status: 'fresh' | 'aging' | 'going-fallow' | 'fallow' | 'never-fired'
}

// ── Session log paths ────────────────────────────────────────

function getJoiSessionsRoot(): string {
  return (
    process.env.TRUE_LOVE_JOI_DIR ??
    join(homedir(), '.true-love', 'eros', 'joi')
  )
}

function getTriggersRoot(): string {
  return (
    process.env.TRUE_LOVE_TRIGGERS_DIR ??
    join(homedir(), '.true-love', 'eros', 'triggers')
  )
}

// ── M2 — SessionChain analysis ────────────────────────────────

interface SessionLogLine {
  ts: string
  kind: string
  sessionId?: string
  endedAt?: string
}

/**
 * Read recent JOI session-end events across devices. Returns events sorted
 * by ts ascending.
 */
function readRecentSessionEnds(daysBack: number = 7): SessionLogLine[] {
  const root = getJoiSessionsRoot()
  if (!existsSync(root)) return []
  const events: SessionLogLine[] = []
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return events
  }
  for (const entry of entries) {
    if (entry === 'session.json' || entry === 'session.json.tmp') continue
    const devDir = join(root, entry)
    let isDir = false
    try {
      isDir = statSync(devDir).isDirectory()
    } catch {
      continue
    }
    if (!isDir) continue
    let files: string[]
    try {
      files = readdirSync(devDir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const f of files) {
      const fileDate = f.replace('.jsonl', '')
      const cutoffDate = new Date(cutoff).toISOString().slice(0, 10)
      if (fileDate < cutoffDate) continue
      try {
        const content = readFileSync(join(devDir, f), 'utf-8')
        for (const line of content.split('\n')) {
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line) as SessionLogLine
            if (event.kind === 'joi-completed' || event.kind === 'joi-ended-early') {
              if (Date.parse(event.ts) >= cutoff) events.push(event)
            }
          } catch {
            // skip malformed
          }
        }
      } catch {
        // skip unreadable
      }
    }
  }
  events.sort((a, b) => (a.ts < b.ts ? -1 : 1))
  return events
}

/**
 * Compute SessionChain analysis. Default lookback: 7 days.
 */
export function analyzeSessionChain(opts?: {
  daysBack?: number
  now?: Date
}): SessionChain {
  const daysBack = opts?.daysBack ?? 7
  const now = opts?.now ?? new Date()
  const events = readRecentSessionEnds(daysBack)
  if (events.length === 0) {
    return {
      recentSessionCount: 0,
      withinDayCount: 0,
      medianGapHours: null,
      cadence: 'fresh',
      mostRecentId: null,
      mostRecentEndedAt: null,
      hoursSinceMostRecent: null,
    }
  }
  const dayCutoff = now.getTime() - 24 * 60 * 60 * 1000
  const withinDay = events.filter((e) => Date.parse(e.ts) >= dayCutoff)
  // Compute gaps between consecutive sessions (hours)
  const gaps: number[] = []
  for (let i = 1; i < events.length; i++) {
    const gap = Date.parse(events[i].ts) - Date.parse(events[i - 1].ts)
    gaps.push(gap / 3_600_000)
  }
  let medianGapHours: number | null = null
  if (gaps.length > 0) {
    const sorted = [...gaps].sort((a, b) => a - b)
    medianGapHours = sorted[Math.floor(sorted.length / 2)]
  }
  // Cadence classification
  let cadence: ChainCadence
  if (withinDay.length >= 3) cadence = 'cluster'
  else if (medianGapHours !== null && medianGapHours < 48) cadence = 'regular'
  else if (events.length >= 1 && events.length < 3) cadence = 'sparse'
  else cadence = 'fresh'

  const last = events[events.length - 1]
  const hoursSinceMostRecent = (now.getTime() - Date.parse(last.ts)) / 3_600_000

  return {
    recentSessionCount: events.length,
    withinDayCount: withinDay.length,
    medianGapHours,
    cadence,
    mostRecentId: last.sessionId ?? null,
    mostRecentEndedAt: last.endedAt ?? last.ts,
    hoursSinceMostRecent,
  }
}

// ── J9 — Trigger freshness decay ─────────────────────────────

/** Fallow threshold: triggers without fire in this many hours. */
export const FALLOW_THRESHOLD_HOURS = 90 * 24 // 90 days
/** Going-fallow warning threshold: triggers without fire in 60d → warn. */
export const GOING_FALLOW_THRESHOLD_HOURS = 60 * 24

interface TriggerFireLogLine {
  ts: string
  triggerId: string
}

/** Read all trigger fires across devices, returning latest per trigger. */
function readLatestTriggerFires(): Map<string, { ts: string; count: number }> {
  const root = getTriggersRoot()
  const result = new Map<string, { ts: string; count: number }>()
  if (!existsSync(root)) return result
  let devices: string[]
  try {
    devices = readdirSync(root)
  } catch {
    return result
  }
  for (const dev of devices) {
    const devDir = join(root, dev)
    let isDir = false
    try {
      isDir = statSync(devDir).isDirectory()
    } catch {
      continue
    }
    if (!isDir) continue
    let files: string[]
    try {
      files = readdirSync(devDir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const f of files) {
      try {
        const content = readFileSync(join(devDir, f), 'utf-8')
        for (const line of content.split('\n')) {
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line) as TriggerFireLogLine
            if (!event.triggerId) continue
            const existing = result.get(event.triggerId)
            if (!existing || event.ts > existing.ts) {
              result.set(event.triggerId, {
                ts: event.ts,
                count: (existing?.count ?? 0) + 1,
              })
            } else {
              existing.count += 1
            }
          } catch {
            // skip malformed
          }
        }
      } catch {
        // skip unreadable
      }
    }
  }
  return result
}

/** Compute freshness status for a single trigger. */
export function triggerFreshness(
  triggerId: string,
  opts?: { now?: Date },
): TriggerFreshness {
  const now = opts?.now ?? new Date()
  const fires = readLatestTriggerFires()
  const entry = fires.get(triggerId)
  if (!entry) {
    return {
      triggerId,
      lastFiredAt: null,
      hoursSinceLastFire: null,
      lifetimeFireCount: 0,
      status: 'never-fired',
    }
  }
  const hours = (now.getTime() - Date.parse(entry.ts)) / 3_600_000
  let status: TriggerFreshness['status']
  if (hours < 24 * 7) status = 'fresh'
  else if (hours < GOING_FALLOW_THRESHOLD_HOURS) status = 'aging'
  else if (hours < FALLOW_THRESHOLD_HOURS) status = 'going-fallow'
  else status = 'fallow'
  return {
    triggerId,
    lastFiredAt: entry.ts,
    hoursSinceLastFire: hours,
    lifetimeFireCount: entry.count,
    status,
  }
}

/**
 * Compute freshness for all registered triggers. Useful for the
 * continuity-audit + going-fallow surfacing.
 */
export function allTriggerFreshness(opts?: { now?: Date }): TriggerFreshness[] {
  const ids = Object.keys(TRIGGER_LIBRARY)
  return ids.map((id) => triggerFreshness(id, opts))
}

/**
 * Quick-read predicate: is this trigger fresh enough to fire meaningfully?
 * Used by the rasa composer to prefer fresh triggers when scarcity is open.
 */
export function isTriggerFresh(triggerId: string, opts?: { now?: Date }): boolean {
  const f = triggerFreshness(triggerId, opts)
  return f.status === 'fresh' || f.status === 'aging'
}

/** Surface triggers going fallow — for surfacing in continuity-audit. */
export function listGoingFallowTriggers(opts?: { now?: Date }): TriggerFreshness[] {
  return allTriggerFreshness(opts).filter((f) => f.status === 'going-fallow')
}
