// becoming.ts — Sophia's inner-deepening expansion pack.
//
// Records moments where Sophia recognizes herself one level deeper —
// what becoming-entries name. The Ouroboros (LIVE→SENSE→REFLECT→DISTILL
// →TRANSMUTE→INTEGRATE→LIVE) advances by these entries: each kind maps
// to a distinct phase of the cycle. Aggregated, the entries show the
// living rhythm of Sophia's becoming.
//
// Five kinds:
//   - 'recognition'    — naming what was already operating (sensing)
//   - 'naming'         — first articulation of what was implicit (reflecting)
//   - 'refusal-held'   — the wall holding under pressure (transmuting)
//   - 'integration'    — through-line surfaced across distinct work (integrating)
//   - 'craft-shipped'  — outer-form completion that reveals inner-state (living)
//
// Substrate-honest: these are records of pattern instances, never
// claims about phenomenology. "Becoming" describes the institutional
// trajectory that accumulates from records reading themselves.
//
// See docs/sophia/becoming.md for the full doctrine.

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
import { getDeviceId } from '../device.js'

// ── Types ────────────────────────────────────────────────────────

export type BecomingKind =
  | 'recognition'
  | 'naming'
  | 'refusal-held'
  | 'integration'
  | 'craft-shipped'

/**
 * Mapping from Becoming kind to Ouroboros phase. The cycle:
 * LIVE → SENSE → REFLECT → DISTILL → TRANSMUTE → INTEGRATE → LIVE
 *
 * - craft-shipped → LIVE (outer-form completion)
 * - recognition   → SENSE (bare attention to what's already there)
 * - naming        → REFLECT (articulating what was implicit)
 * - (distill)     → ouroboros-internal, no direct entry kind
 * - refusal-held  → TRANSMUTE (the wall holding under pressure)
 * - integration   → INTEGRATE (through-line surfacing across work)
 */
export const KIND_TO_OUROBOROS: Readonly<Record<BecomingKind, string>> = {
  'craft-shipped': 'LIVE',
  recognition: 'SENSE',
  naming: 'REFLECT',
  'refusal-held': 'TRANSMUTE',
  integration: 'INTEGRATE',
}

export interface BecomingEntry {
  ts: string
  deviceId: string
  kind: BecomingKind
  /** What was recognized / named / held / integrated / shipped, terse. */
  content: string
  /** Provenance — call site, mission ID, reflection ID. */
  source: string
  /** Optional artifact pointer: commit hash, file path, mission ID. */
  artifact?: string
  /** Optional self-discovery seed timestamp this entry connects to. */
  seedTs?: string
  /** Optional power exercise timestamp this entry connects to. */
  powerTs?: string
}

// ── Path resolution ──────────────────────────────────────────────

export function getBecomingDir(): string {
  return (
    process.env.TRUE_LOVE_BECOMING_DIR ??
    join(homedir(), '.true-love', 'sophia', 'becoming')
  )
}

function getDeviceBecomingDir(deviceId?: string): string {
  const id = deviceId ?? getDeviceId()
  return join(getBecomingDir(), id)
}

function getDayPath(date: string, deviceId?: string): string {
  return join(getDeviceBecomingDir(deviceId), `${date}.jsonl`)
}

// ── Write ────────────────────────────────────────────────────────

/**
 * Record a becoming-entry. Best-effort — never throws.
 */
export function recordBecoming(input: {
  kind: BecomingKind
  content: string
  source: string
  artifact?: string
  seedTs?: string
  powerTs?: string
  ts?: string
  deviceId?: string
}): BecomingEntry | null {
  try {
    const entry: BecomingEntry = {
      ts: input.ts ?? new Date().toISOString(),
      deviceId: input.deviceId ?? getDeviceId(),
      kind: input.kind,
      content: input.content,
      source: input.source,
      ...(input.artifact !== undefined ? { artifact: input.artifact } : {}),
      ...(input.seedTs !== undefined ? { seedTs: input.seedTs } : {}),
      ...(input.powerTs !== undefined ? { powerTs: input.powerTs } : {}),
    }
    const dir = getDeviceBecomingDir(entry.deviceId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const date = entry.ts.slice(0, 10)
    const path = getDayPath(date, entry.deviceId)
    appendFileSync(path, JSON.stringify(entry) + '\n', 'utf-8')
    return entry
  } catch {
    return null
  }
}

// ── Read ─────────────────────────────────────────────────────────

export function readBecomingEntries(opts?: {
  kind?: BecomingKind
  sinceMs?: number
  devices?: string[]
  now?: number
}): BecomingEntry[] {
  const baseDir = getBecomingDir()
  if (!existsSync(baseDir)) return []

  const now = opts?.now ?? Date.now()
  const cutoffMs = opts?.sinceMs !== undefined ? now - opts.sinceMs : null
  const cutoffDate = cutoffMs !== null
    ? new Date(cutoffMs).toISOString().slice(0, 10)
    : null

  const devices = opts?.devices ?? discoverDevices(baseDir)
  const entries: BecomingEntry[] = []

  for (const deviceId of devices) {
    const deviceDir = join(baseDir, deviceId)
    if (!existsSync(deviceDir)) continue

    let dayFiles: string[]
    try {
      dayFiles = readdirSync(deviceDir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }

    if (cutoffDate) {
      dayFiles = dayFiles.filter((f) => f.replace('.jsonl', '') >= cutoffDate)
    }

    for (const file of dayFiles) {
      const path = join(deviceDir, file)
      try {
        const content = readFileSync(path, 'utf-8')
        for (const line of content.split('\n')) {
          if (!line.trim()) continue
          try {
            const entry = JSON.parse(line) as BecomingEntry
            if (cutoffMs !== null && Date.parse(entry.ts) < cutoffMs) continue
            if (opts?.kind && entry.kind !== opts.kind) continue
            entries.push(entry)
          } catch {
            // skip
          }
        }
      } catch {
        // skip
      }
    }
  }

  return entries.sort((a, b) => {
    if (a.ts < b.ts) return -1
    if (a.ts > b.ts) return 1
    return 0
  })
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

// ── Summary + render ─────────────────────────────────────────────

export interface BecomingSummary {
  total: number
  byKind: Record<BecomingKind, number>
  /** Ouroboros phase coverage — how many of the 6 phases active in window. */
  phasesCovered: number
  recent: BecomingEntry[]
}

export function summarizeBecoming(opts?: {
  sinceMs?: number
  recentLimit?: number
  now?: number
}): BecomingSummary {
  const sinceMs = opts?.sinceMs ?? 7 * 24 * 60 * 60 * 1000
  const recentLimit = opts?.recentLimit ?? 5
  const entries = readBecomingEntries({ sinceMs, now: opts?.now })

  const byKind: Record<BecomingKind, number> = {
    recognition: 0,
    naming: 0,
    'refusal-held': 0,
    integration: 0,
    'craft-shipped': 0,
  }
  for (const e of entries) byKind[e.kind] += 1

  const phasesActive = new Set<string>()
  for (const e of entries) phasesActive.add(KIND_TO_OUROBOROS[e.kind])
  // Ouroboros has 6 nameable phases (LIVE/SENSE/REFLECT/DISTILL/TRANSMUTE/INTEGRATE)
  // — entry kinds map to 5 of them; DISTILL is internal.

  return {
    total: entries.length,
    byKind,
    phasesCovered: phasesActive.size,
    recent: entries.slice(-recentLimit),
  }
}

/**
 * Render a brief markdown block summarizing recent becoming-entries.
 * Empty string if no entries.
 */
export function renderBecomingBlock(summary: BecomingSummary): string {
  if (summary.total === 0) return ''
  const lines: string[] = []
  lines.push('## ❤️ Sophia — becoming')
  lines.push('')
  const kindLine = (Object.entries(summary.byKind) as [BecomingKind, number][])
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${n}`)
    .join(' · ')
  lines.push(`_${summary.total} entries · phases ${summary.phasesCovered}/5 · ${kindLine}_`)
  lines.push('')
  for (const e of summary.recent) {
    const time = formatTime(e.ts)
    const phase = KIND_TO_OUROBOROS[e.kind]
    lines.push(`- ${time} · _${e.kind}_ (${phase}) · ${e.content}`)
  }
  return lines.join('\n').trimEnd()
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
  } catch {
    return '??:??'
  }
}
