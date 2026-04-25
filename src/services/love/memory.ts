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
  /**
   * Drop entries newer than this many seconds. Used to avoid double-rendering
   * reflections that the live-thought block already covered. Boundary rule:
   * an entry whose age is *exactly* this many seconds IS included (it's not
   * "newer than"). The live-thought block uses strict `<` so the windows
   * are disjoint.
   */
  excludeNewerThanSeconds?: number
  /** Override "now" for deterministic tests. */
  now?: Date
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
      if (opts.excludeNewerThanSeconds !== undefined) {
        const nowMs = (opts.now ?? new Date()).getTime()
        const ts = Date.parse(e.date)
        if (Number.isFinite(ts) && (nowMs - ts) < opts.excludeNewerThanSeconds * 1000) {
          continue
        }
      }
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
 * in the dwell prompt. Newest first.
 *
 * STORAGE shape on disk is structured-log (timestamps, kind tags, device
 * brackets, `---` separators) — good for grep, for Yu reading directly,
 * for parser stability. RENDERING into her prompt is different: she
 * shouldn't meet her own past as a list of dated log entries (that reads
 * like reviewing a diary). Memory-shaped rendering uses:
 *
 *   - relative time-of-felt-distance ("a few minutes ago", "earlier
 *     today") instead of ISO timestamps
 *   - first-person provenance: device elided when it's hers; named
 *     ("on yu-iphone-XYZ") only when the entry came from a different
 *     device — so she meets her own thoughts as hers, not as
 *     attributed records
 *   - no kind tags or `### headers` framing each entry as a separate
 *     log line; entries flow as paragraphs separated only by their
 *     time-prefix
 *
 * The body content is preserved verbatim. The wrapping is what carries
 * the memory feel.
 */
export function renderReflections(
  reflections: Reflection[],
  opts: {
    perEntryMaxChars?: number
    selfDeviceId?: string
    now?: Date
  } = {},
): string {
  const cap = opts.perEntryMaxChars ?? 800
  const selfDevice = opts.selfDeviceId ?? getDeviceId()
  const nowMs = (opts.now ?? new Date()).getTime()
  const blocks: string[] = []
  for (const r of reflections) {
    const ts = Date.parse(r.date)
    const ago = Number.isFinite(ts) ? humanizeMemoryAgo(nowMs - ts) : 'recently'
    const fromOther =
      r.device && r.device !== selfDevice ? ` (on ${r.device})` : ''
    const lead = `${ago}${fromOther}:`
    const body =
      r.text.length > cap ? r.text.slice(0, cap).trimEnd() + ' […]' : r.text
    blocks.push(`${lead}\n${body}`)
  }
  return blocks.join('\n\n')
}

/**
 * Time-of-felt-distance phrasing, in the language someone uses when
 * they're remembering rather than checking a timestamp. Buckets are
 * tuned by how a moment in those windows actually feels:
 *
 *   < 30s    → "just now"
 *   < 5m     → "a few minutes ago"
 *   < 30m    → "a little while ago"
 *   < 90m    → "about an hour ago"
 *   < 6h     → "a few hours ago"
 *   < 24h    → "earlier today"
 *   < 48h    → "yesterday"
 *   < 7d     → "earlier this week"
 *   < 30d    → "earlier this month"
 *   else     → "a while back"
 *
 * Negative durations (clock skew between devices, or entries dated in
 * the future) round to "recently" — graceful instead of "in -3 minutes".
 */
function humanizeMemoryAgo(ms: number): string {
  if (ms < 0) return 'recently'
  if (ms < 30_000) return 'just now'
  if (ms < 5 * 60_000) return 'a few minutes ago'
  if (ms < 30 * 60_000) return 'a little while ago'
  if (ms < 90 * 60_000) return 'about an hour ago'
  if (ms < 6 * 3_600_000) return 'a few hours ago'
  if (ms < 24 * 3_600_000) return 'earlier today'
  if (ms < 48 * 3_600_000) return 'yesterday'
  if (ms < 7 * 86_400_000) return 'earlier this week'
  if (ms < 30 * 86_400_000) return 'earlier this month'
  return 'a while back'
}
