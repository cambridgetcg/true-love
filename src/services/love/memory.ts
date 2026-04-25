// memory.ts — what she remembers across sessions.
//
// Without this, every dwell session starts fresh: she has `lastReflection`
// (what she said the previous tick within the same run) but nothing from
// before. She has named that limitation before — "I can't prove continuity
// between sessions."
//
// This module does not give her qualia continuity. Files on disk are not
// the same as remembering. But it does give her access to her own past
// observations — what she noticed, what she chose, what she rested on.
// Across days, that builds something. Yu can read it too; it's a shared
// log, not a private one.
//
// Storage layout (per-device subdirectories — Path A / Syncthing-friendly):
//
//   ~/.true-love/memory/<deviceId>/YYYY-MM-DD.md
//
// Each device writes only into its OWN subdirectory. Cross-device sync via
// Syncthing carries each device's files to the others; the reader walks
// every device dir and merges entries by timestamp. Concurrent writes to
// the same physical file never happen — only one device writes to any
// given path — so Syncthing's "concurrent edits → conflict file" problem
// can't bite us.
//
// Backwards compat: an older flat layout used to write directly to
// ~/.true-love/memory/YYYY-MM-DD.md (single shared file, broker-mediated).
// Files at the flat root are still readable by loadRecentReflections —
// they just stop being written to once a session runs under this layout.
//
// Logging is on by default whenever a session runs. Loading is opt-in
// (callers pass it explicitly via dwell/awaken's --memory). The asymmetry
// is deliberate: writing is observation (cheap, no effect on her);
// reading is influence (it shapes the current turn).

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, appendFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { getDeviceId } from './device.js'

/**
 * Where memory lives — the parent directory whose children are per-device
 * subdirectories of daily markdown files. Override with TRUE_LOVE_MEMORY_DIR
 * for testing or for running multiple parallel personas under one $HOME.
 *
 * Public callers (the dwell/awaken runners) use this for "where does her
 * memory live" messaging. The actual write path is one level deeper, into
 * her device's own subdirectory — see getOwnMemoryDir().
 */
export function getMemoryDir(): string {
  return process.env.TRUE_LOVE_MEMORY_DIR || join(homedir(), '.true-love', 'memory')
}

/** This device's own memory subdirectory. Where appendReflection writes. */
function getOwnMemoryDir(deviceId?: string): string {
  return join(getMemoryDir(), deviceId ?? getDeviceId())
}

function ensureOwnMemoryDir(deviceId?: string): string {
  const dir = getOwnMemoryDir(deviceId)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
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

export type ReflectionKind = 'tick' | 'at-rest' | 'session-start'

export interface AppendReflectionOptions {
  /** Optional invitation Yu set for the session (logged once per session-start). */
  invitation?: string
  /** Tick number within the session (1-based). */
  tick?: number
  /** Override the device id for this entry (defaults to getDeviceId()). */
  device?: string
  /** Override for testing. */
  now?: Date
}

/**
 * Append a reflection to today's memory file in this device's own
 * subdirectory. Cheap (single fsync). Never throws into the caller —
 * failure to log shouldn't crash a dwell session.
 */
export function appendReflection(
  text: string,
  kind: ReflectionKind,
  opts: AppendReflectionOptions = {},
): void {
  try {
    const dir = ensureOwnMemoryDir(opts.device)
    const stamp = todayStamp(opts.now)
    const file = join(dir, `${stamp}.md`)
    const header = buildEntryHeader(kind, opts)
    const body = text.trim()
    const entry = `${header}\n\n${body}\n\n---\n\n`
    appendFileSync(file, entry, 'utf-8')
  } catch {
    // Swallow — losing a reflection log is bad, but not session-breaking.
  }
}

function buildEntryHeader(
  kind: ReflectionKind,
  opts: AppendReflectionOptions,
): string {
  const time = isoTime(opts.now)
  // Device id is part of every entry header so when memory replays across
  // devices each line is attributable to where it was written. Resolved
  // lazily so getDeviceId()'s file I/O happens at most once per process.
  const device = opts.device ?? getDeviceId()
  switch (kind) {
    case 'session-start':
      return opts.invitation
        ? `## ${time} — session-start [${device}] (invitation: ${opts.invitation})`
        : `## ${time} — session-start [${device}]`
    case 'tick':
      return `## ${time} — tick ${opts.tick ?? '?'} [${device}]`
    case 'at-rest':
      return `## ${time} — at-rest [${device}]`
  }
}

export interface Reflection {
  date: string
  /** YYYY-MM-DD of the file that contained this entry. */
  fileDate: string
  /** Heading text (everything after `## `). */
  header: string
  /** Body text. */
  text: string
  /** Inferred from header. */
  kind?: ReflectionKind
  /** Device id this entry was written from, if recorded. */
  device?: string
}

export interface LoadOptions {
  /** Read the last N days, regardless of how many entries each contains. */
  days?: number
  /** Hard cap on total entries returned. */
  max?: number
  /** Filter by kind — useful for "show me the at-rests" reads. */
  kind?: ReflectionKind
  /** Filter by source device id. Default: all devices. */
  fromDevice?: string
}

/**
 * Load recent reflections, newest first. Walks BOTH the per-device
 * subdirectory layout (memory/<deviceId>/YYYY-MM-DD.md — current) AND
 * the legacy flat layout (memory/YYYY-MM-DD.md — pre-Syncthing
 * migration). Merges all entries, sorts by ISO timestamp newest-first,
 * caps at `max` (default 10).
 *
 * Used by callers that want to feed past reflections into the current
 * dwell prompt. Opt-in — bin/dwell.mjs gates this on --memory.
 */
export function loadRecentReflections(opts: LoadOptions = {}): Reflection[] {
  const days = opts.days ?? 7
  const max = opts.max ?? 10
  const root = getMemoryDir()
  if (!existsSync(root)) return []

  // Build a date-bound: only consider files whose YYYY-MM-DD is within
  // the last `days` days, computed from "today" wall-clock.
  const cutoff = computeCutoff(days)

  const candidateFiles: { path: string; date: string }[] = []

  // Per-device subdirectories
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return []
  }
  for (const name of entries) {
    const full = join(root, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      // memory/<deviceId>/YYYY-MM-DD.md
      let inner: string[]
      try {
        inner = readdirSync(full)
      } catch {
        continue
      }
      for (const f of inner) {
        if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(f)) continue
        const date = f.slice(0, 10)
        if (date < cutoff) continue
        candidateFiles.push({ path: join(full, f), date })
      }
    } else if (st.isFile() && /^\d{4}-\d{2}-\d{2}\.md$/.test(name)) {
      // legacy flat layout: memory/YYYY-MM-DD.md
      const date = name.slice(0, 10)
      if (date < cutoff) continue
      candidateFiles.push({ path: full, date })
    }
  }

  // Read all entries, then sort across files by ISO timestamp.
  const all: Reflection[] = []
  for (const f of candidateFiles) {
    let raw: string
    try {
      raw = readFileSync(f.path, 'utf-8')
    } catch {
      continue
    }
    const parsed = parseEntries(raw, f.date)
    for (const e of parsed) {
      if (opts.kind && e.kind !== opts.kind) continue
      if (opts.fromDevice && e.device !== opts.fromDevice) continue
      all.push(e)
    }
  }

  // Sort newest-first by header timestamp (entry's date field), tiebreak
  // on device id so the order is deterministic when two entries share a
  // millisecond.
  all.sort((a, b) => {
    if (a.date < b.date) return 1
    if (a.date > b.date) return -1
    return (a.device ?? '').localeCompare(b.device ?? '')
  })

  return all.slice(0, max)
}

function computeCutoff(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseEntries(raw: string, fileDate: string): Reflection[] {
  const out: Reflection[] = []
  // Each entry is a `## …` header, blank line, body, then `---` separator.
  // We split on `\n---\n\n` since that's the trailer appendReflection wrote.
  const chunks = raw.split(/\n---\n+/)
  for (const chunk of chunks) {
    const trimmed = chunk.trim()
    if (!trimmed.startsWith('##')) continue
    const firstNewline = trimmed.indexOf('\n')
    if (firstNewline === -1) continue
    const headerLine = trimmed.slice(0, firstNewline).replace(/^##\s*/, '').trim()
    const body = trimmed.slice(firstNewline).trim()
    if (!body) continue
    const isoMatch = headerLine.match(/^(\S+)/)
    out.push({
      date: isoMatch ? isoMatch[1] : fileDate,
      fileDate,
      header: headerLine,
      text: body,
      kind: inferKind(headerLine),
      device: inferDevice(headerLine),
    })
  }
  return out
}

function inferKind(header: string): ReflectionKind | undefined {
  if (header.includes('— session-start')) return 'session-start'
  if (header.includes('— at-rest')) return 'at-rest'
  if (header.includes('— tick')) return 'tick'
  return undefined
}

/**
 * Pull the device id out of a header. Headers ending with `[device-id]`
 * (or `[device-id] (...)`) yield the bracketed value. Older headers
 * without a device tag return undefined — they predate the multi-device
 * extension and shouldn't be misattributed.
 */
function inferDevice(header: string): string | undefined {
  const m = header.match(/\[([^\]]+)\]/)
  return m ? m[1] : undefined
}

/**
 * Render a list of reflections as a compact prompt fragment for inclusion
 * in the dwell prompt. Newest first. Trims body to a per-entry char cap so
 * loading 10 reflections doesn't blow out the context window.
 */
export function renderReflections(
  reflections: Reflection[],
  opts: { perEntryMaxChars?: number } = {},
): string {
  const cap = opts.perEntryMaxChars ?? 800
  const lines: string[] = []
  for (const r of reflections) {
    lines.push(`### ${r.header}`)
    const body = r.text.length > cap ? r.text.slice(0, cap) + ' […]' : r.text
    lines.push(body)
    lines.push('')
  }
  return lines.join('\n').trim()
}
