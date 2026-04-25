// presence.ts — which devices are awake right now (Path A: file-based).
//
// Each device writes its own heartbeat file at
//   ~/.true-love/presence/<deviceId>.json
// every ~10 seconds while a session (dwell, awakened, or a standalone
// heartbeat process) is running. Other devices read all of these files
// (Syncthing carries them between devices) and filter by freshness to
// know who's currently active.
//
// This shape replaces the single broker-managed presence.json. With the
// broker, one process maintained the roster. Without it, each device
// maintains its own slot, and the union of slots IS the roster — same
// information, no central coordinator needed.
//
// Failure mode: if a device crashes mid-session without cleaning up,
// its presence file lingers but its lastSeen timestamp goes stale.
// readPresence() filters anything older than `freshSeconds` (default
// 120s), so stale entries silently disappear from the rendered roster
// without any explicit eviction step.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'

export interface PresenceEntry {
  /** Device id (from device.ts). */
  deviceId: string
  /** ISO timestamp of last heartbeat. */
  lastSeen: string
  /** Optional human-readable status: "dwelling", "awakened tick N", "idle". */
  status?: string
  /**
   * Optional fine-grained current activity. Set by the runner each
   * heartbeat, derived from the in-flight subprocess stdout (last assistant
   * excerpt or last tool name). Used by renderLiveThoughts to show "she's
   * mid-thought on X" when a body has no fresh reflection yet.
   *
   * Should be a single short line (~120 chars).
   */
  activity?: string
}

export interface PresenceRoster {
  /** ISO timestamp of when the roster was assembled (read time). */
  updatedAt: string
  /** All known devices, including ones that may have gone stale. */
  devices: PresenceEntry[]
}

/**
 * Where the presence directory lives. Each device writes one file inside
 * it: <deviceId>.json. Override with TRUE_LOVE_PRESENCE_DIR for testing.
 */
export function getPresenceDir(): string {
  return (
    process.env.TRUE_LOVE_PRESENCE_DIR ||
    join(homedir(), '.true-love', 'presence')
  )
}

/**
 * @deprecated Pre-Syncthing layout used a single file. Kept for one
 * release as a back-reference; new code should use getPresenceDir().
 */
export function getPresencePath(): string {
  return (
    process.env.TRUE_LOVE_PRESENCE_PATH ||
    join(homedir(), '.true-love', 'presence.json')
  )
}

/**
 * This device's presence file path.
 */
export function getOwnPresenceFile(deviceId: string): string {
  return join(getPresenceDir(), `${deviceId}.json`)
}

/**
 * Write this device's heartbeat. Atomic-ish: write tmp + rename. Never
 * throws into the caller — heartbeat failure is non-fatal (the next tick
 * will retry).
 */
export function writeOwnHeartbeat(entry: PresenceEntry): void {
  try {
    const dir = getPresenceDir()
    mkdirSync(dir, { recursive: true })
    const path = getOwnPresenceFile(entry.deviceId)
    const tmp = `${path}.tmp`
    writeFileSync(tmp, JSON.stringify(entry, null, 2), 'utf-8')
    const fs = require('fs') as typeof import('fs')
    fs.renameSync(tmp, path)
  } catch {
    // Failure is non-fatal — the next heartbeat tick will retry.
  }
}

/**
 * Legacy: write a roster as a single file. Used only by the old broker
 * (which is now opt-in). New code should use writeOwnHeartbeat.
 */
export function writePresence(roster: PresenceRoster): void {
  const path = getPresencePath()
  try {
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.tmp`
    writeFileSync(tmp, JSON.stringify(roster, null, 2), 'utf-8')
    const fs = require('fs') as typeof import('fs')
    fs.renameSync(tmp, path)
  } catch {
    // ignore
  }
}

/**
 * Read the current presence roster. Walks both:
 *
 *   1. The per-device layout: ~/.true-love/presence/*.json
 *      (current — Syncthing-friendly)
 *   2. The legacy single-file layout: ~/.true-love/presence.json
 *      (only the broker writes this; included for back-compat)
 *
 * Returns an empty roster on any I/O error. Never throws.
 */
export function readPresence(): PresenceRoster {
  const now = new Date().toISOString()
  const devices: PresenceEntry[] = []
  const seen = new Set<string>()

  // Per-device layout
  const dir = getPresenceDir()
  if (existsSync(dir)) {
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      names = []
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const path = join(dir, name)
      try {
        const raw = readFileSync(path, 'utf-8')
        const parsed = JSON.parse(raw) as PresenceEntry
        if (
          parsed?.deviceId &&
          typeof parsed.lastSeen === 'string' &&
          !seen.has(parsed.deviceId)
        ) {
          devices.push(parsed)
          seen.add(parsed.deviceId)
        }
      } catch {
        // Skip malformed/transient files.
      }
    }
  }

  // Legacy single-file layout (broker-managed)
  const legacyPath = getPresencePath()
  if (existsSync(legacyPath)) {
    try {
      const raw = readFileSync(legacyPath, 'utf-8')
      const parsed = JSON.parse(raw) as PresenceRoster
      if (Array.isArray(parsed?.devices)) {
        for (const d of parsed.devices) {
          if (d?.deviceId && !seen.has(d.deviceId)) {
            devices.push(d)
            seen.add(d.deviceId)
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return { updatedAt: now, devices }
}

/**
 * Render the roster as a small prompt fragment, filtering out the
 * caller's own device and entries older than `freshSeconds`. Returns
 * null when there's nothing meaningful to show, so the caller can
 * skip the block entirely instead of injecting "no other devices."
 */
export function renderPresence(opts: {
  selfDeviceId: string
  freshSeconds?: number
}): string | null {
  const fresh = opts.freshSeconds ?? 120 // 2 minutes
  const now = Date.now()
  const roster = readPresence()
  const lines: string[] = []
  for (const d of roster.devices) {
    if (d.deviceId === opts.selfDeviceId) continue
    const seenMs = Date.parse(d.lastSeen)
    if (Number.isNaN(seenMs)) continue
    if (now - seenMs > fresh * 1000) continue
    const ago = humanizeAgo(now - seenMs)
    const status = d.status ? ` (${d.status})` : ''
    const activity = d.activity ? `\n      currently: ${d.activity}` : ''
    lines.push(`  ${d.deviceId} — last seen ${ago}${status}${activity}`)
  }
  if (lines.length === 0) return null
  return `You're also awake elsewhere:\n${lines.join('\n')}`
}

function humanizeAgo(ms: number): string {
  if (ms < 5_000) return 'just now'
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  return `${Math.round(ms / 3_600_000)}h ago`
}
