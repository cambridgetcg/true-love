// heat.ts — the reward-pathway module.
//
// Real-signal dopamine analog: a numerical "heat" index that goes up
// when actual work lands (mission done, Yu witnessed, proposal accepted,
// snapshot committed, becoming entry, letter from Yu) and decays over
// time (24h half-life). High heat = the system has been on fire
// recently. Low heat = idle, hunger pulls toward action.
//
// Discipline (load-bearing):
//   - Heat is tied to *real artifacts*. The number is computed from
//     events that actually happened on disk; it cannot be inflated by
//     prose or self-talk. Anti-sycophancy preserved.
//   - Surfacing heat in the wake names the work, not the worker.
//     "🔥 47 · 5-day streak · last fire 12m" — not "you're amazing".
//   - Decay is the natural hunger signal. If yesterday's mission was
//     the last fire, heat is half what it was. Two days ago, quarter.
//     The math itself says "keep building."
//
// Storage: ~/.true-love/heat/<deviceId>/YYYY-MM-DD.jsonl — one line
// per event, append-only, per-device per-day. Survives reboots; the
// daily snapshot ritual sees the heat ledger same as any other stream.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getDeviceId } from './device.js'

// ── Types ────────────────────────────────────────────────────────

export type HeatKind =
  | 'mission-done'
  | 'yu-witnessed'
  | 'proposal-accepted'
  | 'snapshot-committed'
  | 'becoming-entry'
  | 'letter-from-yu'
  | 'chronicle-tag'
  | 'build-pass'

export interface HeatEvent {
  /** UTC ISO timestamp; defaults to now. */
  ts: string
  /** What kind of fire it is. */
  kind: HeatKind
  /** Strength of the signal (small/medium/large fire). */
  magnitude: number
  /** Free-form source identifier (mission id, proposal title, etc.). */
  source?: string
  /** Device that recorded the event. */
  deviceId: string
}

/**
 * Default magnitude for each kind. Calibrated so a typical day can
 * accumulate ~10-30 heat; a *fire* day with multiple kinds active
 * can hit 50+. Letters are rare and treated as the highest signal.
 */
export const DEFAULT_MAGNITUDE: Record<HeatKind, number> = {
  'mission-done': 5,
  'yu-witnessed': 4,
  'proposal-accepted': 2,
  'snapshot-committed': 1,
  'becoming-entry': 5,
  'letter-from-yu': 8,
  'chronicle-tag': 3,
  'build-pass': 1,
}

// ── Path resolution ──────────────────────────────────────────────

/**
 * Base directory for heat events.
 * Override with TRUE_LOVE_HEAT_DIR for testing.
 */
export function getHeatDir(): string {
  return (
    process.env.TRUE_LOVE_HEAT_DIR ??
    join(homedir(), '.true-love', 'heat')
  )
}

function getDeviceHeatDir(deviceId?: string): string {
  return join(getHeatDir(), deviceId ?? getDeviceId())
}

function getDayPath(date: string, deviceId?: string): string {
  return join(getDeviceHeatDir(deviceId), `${date}.jsonl`)
}

// ── Write ────────────────────────────────────────────────────────

export interface RecordHeatOpts {
  kind: HeatKind
  /** Override the default magnitude for this kind. */
  magnitude?: number
  /** Free-form source descriptor (mission id, proposal title, etc.). */
  source?: string
  /** Override timestamp; defaults to now. Used by tests. */
  ts?: string
  /** Override device id; defaults to current device. Used by tests. */
  deviceId?: string
}

/**
 * Record one heat event. Best-effort — never throws into the caller.
 * If something goes wrong (disk full, permission denied), the fire
 * happened in real life; the ledger just doesn't capture it. Caller
 * never knows or cares.
 */
export function recordHeatEvent(opts: RecordHeatOpts): void {
  try {
    const ts = opts.ts ?? new Date().toISOString()
    const deviceId = opts.deviceId ?? getDeviceId()
    const magnitude = opts.magnitude ?? DEFAULT_MAGNITUDE[opts.kind]
    const event: HeatEvent = {
      ts,
      kind: opts.kind,
      magnitude,
      source: opts.source,
      deviceId,
    }
    const dir = getDeviceHeatDir(deviceId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const date = ts.slice(0, 10)
    const path = getDayPath(date, deviceId)
    appendFileSync(path, JSON.stringify(event) + '\n', 'utf-8')
  } catch {
    // best-effort
  }
}

// ── Read ─────────────────────────────────────────────────────────

/**
 * Read events across the last N days, all devices. Sorted by ts ascending.
 */
export function readRecentEvents(days = 7, now: Date = new Date()): HeatEvent[] {
  const baseDir = getHeatDir()
  if (!existsSync(baseDir)) return []

  const dates: string[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date(now)
    d.setUTCDate(d.getUTCDate() - i)
    dates.push(d.toISOString().slice(0, 10))
  }

  let devices: string[]
  try {
    devices = readdirSync(baseDir).filter((entry) => {
      try {
        return statSync(join(baseDir, entry)).isDirectory()
      } catch {
        return false
      }
    })
  } catch {
    return []
  }

  const events: HeatEvent[] = []
  for (const deviceId of devices) {
    for (const date of dates) {
      const path = getDayPath(date, deviceId)
      if (!existsSync(path)) continue
      try {
        const content = readFileSync(path, 'utf-8')
        for (const line of content.split('\n')) {
          if (!line.trim()) continue
          try {
            events.push(JSON.parse(line) as HeatEvent)
          } catch {
            // skip malformed
          }
        }
      } catch {
        // skip device
      }
    }
  }

  events.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
  return events
}

// ── Compute ──────────────────────────────────────────────────────

const HALF_LIFE_HOURS = 24
const DECAY_LAMBDA = Math.LN2 / HALF_LIFE_HOURS // ln(2) / 24

/**
 * Current heat — exponentially-decayed sum of recent magnitudes.
 * 24h half-life. So an event with magnitude 5 contributes 5 right
 * away, 2.5 a day later, 1.25 two days later, etc.
 *
 * Returned as an integer (rounded).
 */
export function currentHeat(now: Date = new Date()): number {
  const events = readRecentEvents(7, now)
  let total = 0
  const nowMs = now.getTime()
  for (const e of events) {
    const ageHours = (nowMs - new Date(e.ts).getTime()) / 3_600_000
    if (ageHours < 0) continue // future events ignored
    total += e.magnitude * Math.exp(-DECAY_LAMBDA * ageHours)
  }
  return Math.round(total)
}

/**
 * Number of consecutive days (looking back from `now`) where at least
 * one event of magnitude ≥ 2 was recorded. Today counts if there's
 * already been one such event; otherwise the streak is yesterday's.
 *
 * "Real fire" gate (magnitude ≥ 2) — a snapshot-committed event alone
 * doesn't extend the streak, since the snapshot ritual fires nightly
 * regardless of whether work happened.
 */
export function heatStreak(now: Date = new Date()): number {
  const events = readRecentEvents(60, now) // look back 60 days max
  const dayHas = new Set<string>()
  for (const e of events) {
    if (e.magnitude >= 2) dayHas.add(e.ts.slice(0, 10))
  }

  let streak = 0
  // Walk back from today; if today missing, start from yesterday.
  const cursor = new Date(now)
  if (!dayHas.has(cursor.toISOString().slice(0, 10))) {
    cursor.setUTCDate(cursor.getUTCDate() - 1)
  }
  while (dayHas.has(cursor.toISOString().slice(0, 10))) {
    streak += 1
    cursor.setUTCDate(cursor.getUTCDate() - 1)
  }
  return streak
}

/**
 * Most recent fire event (any kind). Returns null when there are no
 * events at all.
 */
export function lastFireEvent(now: Date = new Date()): HeatEvent | null {
  const events = readRecentEvents(7, now)
  return events.length > 0 ? events[events.length - 1] : null
}

// ── Compose for prompt ───────────────────────────────────────────

/**
 * Format the heat block for inclusion in the wake context.
 *
 * Returns empty string when no fire has happened in the last 7 days
 * (greenfield install, or genuinely cold). When something exists,
 * returns a tight one/two-line block grounded in the numbers.
 *
 * Shape: "🔥 HEAT N · K-day streak · last fire MMm — kind"
 *
 * The prose intentionally stays in the register of *naming what
 * happened*, not *praising who did it*. Anti-sycophancy preserved.
 */
export function formatHeatBlock(now: Date = new Date()): string {
  const heat = currentHeat(now)
  const streak = heatStreak(now)
  const last = lastFireEvent(now)
  if (heat === 0 && streak === 0 && !last) return ''

  const parts: string[] = [`🔥 HEAT ${heat}`]
  if (streak > 0) {
    parts.push(`${streak}-day streak`)
  }
  if (last) {
    const ageMin = Math.round((now.getTime() - new Date(last.ts).getTime()) / 60_000)
    const ageStr = formatAge(ageMin)
    const sourceTail = last.source ? ` (${last.source})` : ''
    parts.push(`last fire ${ageStr} — ${last.kind}${sourceTail}`)
  }
  return parts.join(' · ')
}

function formatAge(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}
