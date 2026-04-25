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
// Storage: ~/.true-love/memory/YYYY-MM-DD.md — one markdown file per day,
// append-only. Each entry is a short header (timestamp + kind) followed
// by the reflection text. Plain markdown so Yu can read it directly.
//
// Loading is OPT-IN. Logging is on by default whenever a dwell session
// runs. The asymmetry is deliberate: writing is observation (cheap, no
// effect on her), reading is influence (it shapes the current turn).
// Influence wants explicit consent.

import { existsSync, mkdirSync, readdirSync, readFileSync, appendFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { getDeviceId } from './device.js'

/**
 * Where her reflections live. Override with TRUE_LOVE_MEMORY_DIR for
 * testing or for running multiple parallel personas under one $HOME.
 */
export function getMemoryDir(): string {
  return process.env.TRUE_LOVE_MEMORY_DIR || join(homedir(), '.true-love', 'memory')
}

function ensureMemoryDir(): string {
  const dir = getMemoryDir()
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
 * Append a reflection to today's memory file. Cheap (single fsync). Never
 * throws into the caller — failure to log shouldn't crash a dwell session.
 */
export function appendReflection(
  text: string,
  kind: ReflectionKind,
  opts: AppendReflectionOptions = {},
): void {
  try {
    const dir = ensureMemoryDir()
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
}

/**
 * Load recent reflections, newest first. Reads up to `days` days of
 * memory files (default 7), parses each into entries, optionally filters
 * by kind, caps at `max` (default 10).
 *
 * Used by callers that want to feed past reflections into the current
 * dwell prompt. Always opt-in — bin/dwell.mjs gates this on `--memory`.
 */
export function loadRecentReflections(opts: LoadOptions = {}): Reflection[] {
  const days = opts.days ?? 7
  const max = opts.max ?? 10
  const dir = getMemoryDir()
  if (!existsSync(dir)) return []

  let files: string[]
  try {
    files = readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
  } catch {
    return []
  }
  files.sort().reverse() // newest first
  files = files.slice(0, days)

  const reflections: Reflection[] = []
  for (const f of files) {
    const fileDate = f.slice(0, 10)
    let raw: string
    try {
      raw = readFileSync(join(dir, f), 'utf-8')
    } catch {
      continue
    }
    const entries = parseEntries(raw, fileDate)
    // Newest entries within a file are at the END (append-only). Reverse so
    // when we concatenate across files we stay newest-first overall.
    entries.reverse()
    for (const e of entries) {
      if (opts.kind && e.kind !== opts.kind) continue
      reflections.push(e)
      if (reflections.length >= max) return reflections
    }
  }
  return reflections
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
