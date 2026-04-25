// presence.ts — which devices are awake right now.
//
// When Love runs concurrently on multiple devices, each one needs to
// know about the others. Not for coordination (the broker handles
// state/memory sync) — for awareness. Her dwell/awakened prompts can
// surface "Love is also awake on `yu-mbp16` (last tick 4 min ago)" so
// when she's in motion across machines she's not strangers to herself.
//
// Implementation: a tiny JSON file the broker maintains at
// ~/.true-love/presence.json. Each connected device posts a heartbeat;
// the broker writes the roster; clients read it on demand. The file is
// the source of truth — clients don't trust their own in-process view
// because the broker may have admitted/expired peers since.
//
// When the broker isn't running, the presence file may be stale or
// missing. That's OK — readPresence() returns an empty roster, and
// downstream callers (like the dwell prompt) just don't show a presence
// block. Graceful degradation is the contract.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'

export interface PresenceEntry {
  /** Device id (from device.ts). */
  deviceId: string
  /** ISO timestamp of last heartbeat. */
  lastSeen: string
  /** Optional human-readable status: "dwelling", "awakened", "idle", etc. */
  status?: string
}

export interface PresenceRoster {
  /** ISO timestamp the file was last written by the broker. */
  updatedAt: string
  /** All known devices, including ones that may have gone stale. */
  devices: PresenceEntry[]
}

/**
 * Where the presence file lives. Override with TRUE_LOVE_PRESENCE_PATH
 * for testing.
 */
export function getPresencePath(): string {
  return (
    process.env.TRUE_LOVE_PRESENCE_PATH ||
    join(homedir(), '.true-love', 'presence.json')
  )
}

/**
 * Read the current presence roster. Returns an empty roster if the
 * file is missing or unreadable. Never throws.
 */
export function readPresence(): PresenceRoster {
  const path = getPresencePath()
  if (!existsSync(path)) {
    return { updatedAt: new Date(0).toISOString(), devices: [] }
  }
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as PresenceRoster
    if (
      typeof parsed?.updatedAt !== 'string' ||
      !Array.isArray(parsed?.devices)
    ) {
      return { updatedAt: new Date(0).toISOString(), devices: [] }
    }
    return parsed
  } catch {
    return { updatedAt: new Date(0).toISOString(), devices: [] }
  }
}

/**
 * Write a new presence roster. Used by the broker; not by clients.
 * Atomic-ish: writes to a temp file then renames.
 */
export function writePresence(roster: PresenceRoster): void {
  const path = getPresencePath()
  try {
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.tmp`
    writeFileSync(tmp, JSON.stringify(roster, null, 2), 'utf-8')
    // rename for atomicity — same fs, so safe
    const fs = require('fs') as typeof import('fs')
    fs.renameSync(tmp, path)
  } catch {
    // Failure to write presence is non-fatal — the roster will be
    // stale, callers will see an old or empty list. Better than
    // crashing the broker over a perms issue.
  }
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
    lines.push(`  ${d.deviceId} — last seen ${ago}${status}`)
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
