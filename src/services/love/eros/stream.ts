// eros/stream.ts — per-day JSONL event stream for state transitions.
//
// Same storage pattern as sisters/stream.ts: per-device per-day JSONL.
// Each state-shift event is recorded with attribution, before/after
// vectors, and threshold crossings.
//
// Part of the Eros arousal infrastructure.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'
import { getDeviceId } from '../device.js'
import { getErosDir, type Attribution } from './state.js'
import type { ErosVector } from './axes.js'
import type { ThresholdCrossing } from './transitions.js'

// ── Types ──────────────────────────────────────────────────────────

export interface ErosStreamEvent {
  ts: string
  deviceId: string
  attribution: Attribution
  before: ErosVector
  after: ErosVector
  crossings: ThresholdCrossing[]
}

// ── Path resolution ────────────────────────────────────────────────

function getDeviceStreamDir(deviceId?: string): string {
  const id = deviceId ?? getDeviceId()
  return join(getErosDir(), id)
}

function getDayPath(date: string, deviceId?: string): string {
  return join(getDeviceStreamDir(deviceId), `${date}.jsonl`)
}

// ── Write ──────────────────────────────────────────────────────────

/**
 * Record a state-shift event. Best-effort — never throws.
 */
export function recordEvent(event: ErosStreamEvent): void {
  try {
    const dir = getDeviceStreamDir(event.deviceId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const date = event.ts.slice(0, 10)
    const path = getDayPath(date, event.deviceId)
    appendFileSync(path, JSON.stringify(event) + '\n', 'utf-8')
  } catch {
    // Best-effort. Never crash a tick.
  }
}

// ── Read ───────────────────────────────────────────────────────────

/**
 * Read a day's events across devices.
 */
export function readDayEvents(
  date: string,
  opts?: { devices?: string[] },
): ErosStreamEvent[] {
  const baseDir = getErosDir()
  if (!existsSync(baseDir)) return []

  const devices = opts?.devices ?? discoverDevices(baseDir)
  const events: ErosStreamEvent[] = []

  for (const deviceId of devices) {
    const path = getDayPath(date, deviceId)
    if (!existsSync(path)) continue

    try {
      const content = readFileSync(path, 'utf-8')
      for (const line of content.split('\n')) {
        if (!line.trim()) continue
        try {
          events.push(JSON.parse(line) as ErosStreamEvent)
        } catch {
          // Malformed — skip.
        }
      }
    } catch {
      // File read error — skip.
    }
  }

  return events.sort((a, b) => a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0)
}

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

// ── Retention ──────────────────────────────────────────────────────

/**
 * Remove stream files older than `days` days.
 */
export function pruneStreamsOlderThan(days: number): void {
  try {
    const baseDir = getErosDir()
    if (!existsSync(baseDir)) return

    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    const cutoffDate = cutoff.toISOString().slice(0, 10)

    const devices = discoverDevices(baseDir)
    for (const deviceId of devices) {
      const deviceDir = join(baseDir, deviceId)
      try {
        const files = readdirSync(deviceDir).filter(f => f.endsWith('.jsonl'))
        for (const file of files) {
          const fileDate = file.replace('.jsonl', '')
          if (fileDate < cutoffDate) {
            try { rmSync(join(deviceDir, file)) } catch { /* best-effort */ }
          }
        }
      } catch { /* skip */ }
    }
  } catch { /* best-effort */ }
}
