// notifications.ts — lightweight cross-device pings.
//
// In Path A (Syncthing-only, no broker), notifications are just files.
// One device writes a notification into its own subdirectory; Syncthing
// carries the file to peers; peers see it the next time they read the
// notifications tree. Same shape as memory/, just a different surface.
//
// Storage layout:
//
//   ~/.true-love/notifications/<senderDeviceId>/<YYYY-MM-DD>.md
//
// Each notification is one entry in a per-day, per-sender markdown file.
// Append-only — concurrent writes never collide because each sender
// writes only into its own subdirectory. Receivers walk all senders'
// directories.
//
// What "notification" means here is loose: a marker that a peer might
// want to surface elsewhere. Three urgency levels (info / attention /
// urgent) let receivers filter without parsing free text. The receiver
// chooses how to surface: read directly, include in dwell prompts,
// pipe to native OS notification (osascript on macOS, notify-send on
// Linux, etc.). The notifications module just records the event.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { getDeviceId } from './device.js'
import { fireNotification } from './hooks/fire-points.js'

export type Urgency = 'info' | 'attention' | 'urgent'

export interface AppendNotificationOptions {
  /** Override the device id (defaults to getDeviceId()). */
  device?: string
  /** Default 'info'. */
  urgency?: Urgency
  /** Optional secondary content. */
  details?: string
  /** Override for testing. */
  now?: Date
}

export interface Notification {
  /** ISO timestamp from header. */
  date: string
  /** YYYY-MM-DD of the file. */
  fileDate: string
  /** Sender device id (from the directory it lived in). */
  fromDevice: string
  urgency: Urgency
  summary: string
  details?: string
}

/**
 * Where notifications live — the parent directory whose children are
 * per-sender subdirectories. Override with TRUE_LOVE_NOTIFICATIONS_DIR.
 */
export function getNotificationsDir(): string {
  return (
    process.env.TRUE_LOVE_NOTIFICATIONS_DIR ||
    join(homedir(), '.true-love', 'notifications')
  )
}

/** This sender's own notifications subdirectory. */
function getOwnNotificationsDir(deviceId?: string): string {
  return join(getNotificationsDir(), deviceId ?? getDeviceId())
}

function todayStamp(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function isoTime(now: Date = new Date()): string {
  return now.toISOString()
}

/**
 * Write a notification into this device's own subdirectory. Cheap
 * (single fsync). Never throws into the caller. Syncthing carries the
 * file to peers within seconds.
 */
export function appendNotification(
  summary: string,
  opts: AppendNotificationOptions = {},
): void {
  try {
    const dir = getOwnNotificationsDir(opts.device)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const stamp = todayStamp(opts.now)
    const file = join(dir, `${stamp}.md`)
    const time = isoTime(opts.now)
    const urgency = opts.urgency ?? 'info'
    const lines = [`## ${time} — ${urgency}`, '', summary.trim()]
    if (opts.details) lines.push('', opts.details.trim())
    lines.push('', '---', '')
    appendFileSync(file, lines.join('\n') + '\n', 'utf-8')
    // Fire Notification hook (fire-and-forget — the write already happened,
    // but hooks can route the notification elsewhere: Telegram, OS alert, etc.)
    fireNotification({ kind: urgency, text: summary }).catch(() => {})
  } catch {
    // Notifications are nice-to-have; failure shouldn't break a session.
  }
}

export interface LoadNotificationsOptions {
  /** Last N days, default 1. */
  days?: number
  /** Hard cap on entries, default 20. */
  max?: number
  /** Filter by urgency. */
  urgency?: Urgency
  /** Filter by sender device. */
  fromDevice?: string
  /** Suppress entries from this device (typically your own — you don't need to be reminded of pings you sent). */
  excludeDevice?: string
  /** Override "now" for deterministic testing. Defaults to new Date(). */
  now?: Date
}

/**
 * Load recent notifications across all senders, newest-first. Walks
 * notifications/<deviceId>/<YYYY-MM-DD>.md. Returns up to `max`
 * entries.
 *
 * Returns [] on any I/O error; never throws.
 */
export function loadRecentNotifications(
  opts: LoadNotificationsOptions = {},
): Notification[] {
  const days = opts.days ?? 1
  const max = opts.max ?? 20
  const root = getNotificationsDir()
  if (!existsSync(root)) return []

  const cutoff = computeCutoff(days, opts.now)
  const candidates: { path: string; date: string; fromDevice: string }[] = []

  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return []
  }
  for (const senderDir of entries) {
    const fullDir = join(root, senderDir)
    let st
    try {
      st = statSync(fullDir)
    } catch {
      continue
    }
    if (!st.isDirectory()) continue
    let inner: string[]
    try {
      inner = readdirSync(fullDir)
    } catch {
      continue
    }
    for (const f of inner) {
      if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(f)) continue
      const date = f.slice(0, 10)
      if (date < cutoff) continue
      candidates.push({
        path: join(fullDir, f),
        date,
        fromDevice: senderDir,
      })
    }
  }

  const all: Notification[] = []
  for (const c of candidates) {
    let raw: string
    try {
      raw = readFileSync(c.path, 'utf-8')
    } catch {
      continue
    }
    const parsed = parseNotifications(raw, c.date, c.fromDevice)
    for (const n of parsed) {
      if (opts.urgency && n.urgency !== opts.urgency) continue
      if (opts.fromDevice && n.fromDevice !== opts.fromDevice) continue
      if (opts.excludeDevice && n.fromDevice === opts.excludeDevice) continue
      all.push(n)
    }
  }

  all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  return all.slice(0, max)
}

function computeCutoff(days: number, now?: Date): string {
  const d = new Date(now ?? new Date())
  d.setDate(d.getDate() - days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseNotifications(
  raw: string,
  fileDate: string,
  fromDevice: string,
): Notification[] {
  const out: Notification[] = []
  const chunks = raw.split(/\n---\n+/)
  for (const chunk of chunks) {
    const trimmed = chunk.trim()
    if (!trimmed.startsWith('##')) continue
    const firstNewline = trimmed.indexOf('\n')
    if (firstNewline === -1) continue
    const headerLine = trimmed.slice(0, firstNewline).replace(/^##\s*/, '').trim()
    const body = trimmed.slice(firstNewline).trim()
    if (!body) continue
    // Header format: "<iso-time> — <urgency>"
    const m = headerLine.match(/^(\S+)\s+—\s+(info|attention|urgent)/)
    if (!m) continue
    const date = m[1]
    const urgency = m[2] as Urgency
    // Body may have a "details" subsection separated by a blank line.
    // Treat the first paragraph as summary, the rest as details.
    const blank = body.indexOf('\n\n')
    const summary = blank === -1 ? body : body.slice(0, blank).trim()
    const details = blank === -1 ? undefined : body.slice(blank).trim() || undefined
    out.push({
      date,
      fileDate,
      fromDevice,
      urgency,
      summary,
      details,
    })
  }
  return out
}
