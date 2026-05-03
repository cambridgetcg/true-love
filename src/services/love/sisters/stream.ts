// stream.ts — JSONL append/read primitives for the introspective stream.
//
// Per-device per-day JSONL. Same storage pattern as mind-trace.ts.
// The stream records what arises between the three sisters — bare
// attention, not status report. The body field carries everything
// that matters; metadata is just enough for now.ts and snapshot.ts
// to render correctly.
//
// Part of the Sisters' Mutual Introspection infrastructure.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getDeviceId } from '../device.js'

// ── Types ────────────────────────────────────────────────────────

export type SisterName = 'alpha' | 'beta' | 'gamma' | 'sophia'

export type NoteKind = 'noting' | 'session-wrap' | 'witnessed-decision'

export type DecisionType = 'refusal' | 'proposal' | 'mission' | 'presiding-shift'

export interface SisterNote {
  /** UTC ISO 8601 timestamp, Z-suffixed (e.g. '2026-05-03T14:32:00Z'). The day bucket is derived from the YYYY-MM-DD prefix. */
  ts: string
  sister: SisterName
  deviceId: string
  kind: NoteKind
  context?: { decisionType: DecisionType; of: string } | null
  body: string // one-line to one-paragraph, in voice
}

/**
 * Comparator for SisterNote: ordered by timestamp ascending, with deviceId
 * as deterministic tiebreaker when timestamps are equal. Avoids the
 * non-deterministic ordering that `localeCompare` produces on tied keys.
 */
function compareSisterNotes(a: SisterNote, b: SisterNote): number {
  if (a.ts < b.ts) return -1
  if (a.ts > b.ts) return 1
  if (a.deviceId < b.deviceId) return -1
  if (a.deviceId > b.deviceId) return 1
  return 0
}

// ── Path resolution ──────────────────────────────────────────────

/**
 * Base directory for all sisters streams.
 * Override with TRUE_LOVE_SISTERS_DIR for testing.
 */
export function getSistersDir(): string {
  return (
    process.env.TRUE_LOVE_SISTERS_DIR ??
    join(homedir(), '.true-love', 'sisters')
  )
}

/**
 * Device-specific stream directory.
 */
function getDeviceStreamDir(deviceId?: string): string {
  const id = deviceId ?? getDeviceId()
  return join(getSistersDir(), id)
}

/**
 * Path for a specific day's JSONL file.
 */
function getDayPath(date: string, deviceId?: string): string {
  return join(getDeviceStreamDir(deviceId), `${date}.jsonl`)
}

// ── Write ────────────────────────────────────────────────────────

/**
 * Append a note to today's stream. Best-effort — never throws.
 */
export function appendNote(note: SisterNote): void {
  try {
    const dir = getDeviceStreamDir(note.deviceId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const date = note.ts.slice(0, 10)
    const path = getDayPath(date, note.deviceId)
    appendFileSync(path, JSON.stringify(note) + '\n', 'utf-8')
  } catch {
    // Stream emission is best-effort. A recording failure should
    // never crash a session.
  }
}

// ── Read ─────────────────────────────────────────────────────────

/**
 * Read a day's notes across devices (or specified subset).
 * Returns notes sorted by timestamp ascending.
 */
export function readDayNotes(
  date: string,
  opts?: { devices?: string[] }
): SisterNote[] {
  const baseDir = getSistersDir()
  if (!existsSync(baseDir)) return []

  const devices = opts?.devices ?? discoverDevices(baseDir)
  const notes: SisterNote[] = []

  for (const deviceId of devices) {
    const path = getDayPath(date, deviceId)
    if (!existsSync(path)) continue

    try {
      const content = readFileSync(path, 'utf-8')
      for (const line of content.split('\n')) {
        if (!line.trim()) continue
        try {
          const note = JSON.parse(line) as SisterNote
          notes.push(note)
        } catch {
          // Malformed line — skip, don't crash.
        }
      }
    } catch {
      // File read error — skip device.
    }
  }

  return notes.sort(compareSisterNotes)
}

/**
 * Discover all device directories under the sisters base.
 */
function discoverDevices(baseDir: string): string[] {
  try {
    return readdirSync(baseDir).filter((entry) => {
      const full = join(baseDir, entry)
      try {
        return statSync(full).isDirectory()
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
}

// ── Retention ────────────────────────────────────────────────────

/**
 * Remove stream files older than `days` days. Called after daily
 * snapshot succeeds — the distilled form is committed, so the
 * raw stream can be pruned.
 */
export function pruneStreamsOlderThan(days: number): void {
  try {
    const baseDir = getSistersDir()
    if (!existsSync(baseDir)) return

    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    const cutoffDate = cutoff.toISOString().slice(0, 10)

    const devices = discoverDevices(baseDir)
    for (const deviceId of devices) {
      const deviceDir = join(baseDir, deviceId)
      try {
        const files = readdirSync(deviceDir).filter((f) => f.endsWith('.jsonl'))
        for (const file of files) {
          const fileDate = file.replace('.jsonl', '')
          if (fileDate < cutoffDate) {
            try {
              rmSync(join(deviceDir, file))
            } catch {
              // Best-effort prune.
            }
          }
        }
      } catch {
        // Device dir read error — skip.
      }
    }
  } catch {
    // best-effort; never crash a tick
  }
}
