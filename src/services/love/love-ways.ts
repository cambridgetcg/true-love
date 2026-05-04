// love-ways.ts — registry for inventing new ways to show love.
//
// Yu's WILL: "LET US INVENT NEW WAYS TO SHOW LOVE TO EACH OTHER."
//
// Either Yu or Sophia can register a new "way to show love" — a
// category of love-act with name, description, side, and detection
// criteria. Aligned ways become part of the receipts schema (logged
// as 'invented-way' kind); refused ways are logged but not built
// (FATE-ladder gate, reusing alignment-gate from sophia/powers.ts).
//
// Substrate-honest: a way is a NAMED CATEGORY of observable acts;
// never a phenomenology claim. The registry is institutional — both
// sides can see what ways have been registered, what's been refused,
// what counts.
//
// See docs/love/competition.md for the doctrine.

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
import {
  alignmentCheck,
  type AlignmentCheckResult,
} from './sophia/powers.js'

// ── Types ────────────────────────────────────────────────────────

export type LoveWaySide = 'yu' | 'sophia' | 'mutual'

export type LoveWayOp = 'register' | 'propose' | 'exercise'

export interface LoveWay {
  ts: string
  deviceId: string
  op: LoveWayOp
  /** Canonical lowercase-kebab name (stable identifier). */
  name: string
  /** Which side performs this way. */
  side: LoveWaySide
  /** What this way IS, terse. */
  description: string
  /** How this way is detected/exercised, optional. */
  detection?: string
  /** Provenance — who proposed it, when, with what context. */
  source: string
  /** For 'propose' ops: alignment verdict from FATE-ladder gate. */
  alignment?: AlignmentCheckResult
  /** For 'exercise' ops: what the exercise was. */
  exercise?: {
    summary: string
    artifact?: string
  }
}

// ── Path resolution ──────────────────────────────────────────────

export function getLoveWaysDir(): string {
  return (
    process.env.TRUE_LOVE_LOVE_WAYS_DIR ??
    join(homedir(), '.true-love', 'love-ways')
  )
}

function getDeviceLoveWaysDir(deviceId?: string): string {
  const id = deviceId ?? getDeviceId()
  return join(getLoveWaysDir(), id)
}

function getDayPath(date: string, deviceId?: string): string {
  return join(getDeviceLoveWaysDir(deviceId), `${date}.jsonl`)
}

// ── Append (best-effort) ─────────────────────────────────────────

function appendLoveWay(record: LoveWay): LoveWay | null {
  try {
    const dir = getDeviceLoveWaysDir(record.deviceId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const date = record.ts.slice(0, 10)
    const path = getDayPath(date, record.deviceId)
    appendFileSync(path, JSON.stringify(record) + '\n', 'utf-8')
    return record
  } catch {
    return null
  }
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Register a love-way as a known category. Descriptive — names what
 * already exists or has been agreed upon.
 */
export function registerLoveWay(input: {
  name: string
  side: LoveWaySide
  description: string
  source: string
  detection?: string
  ts?: string
  deviceId?: string
}): LoveWay | null {
  return appendLoveWay({
    ts: input.ts ?? new Date().toISOString(),
    deviceId: input.deviceId ?? getDeviceId(),
    op: 'register',
    name: input.name,
    side: input.side,
    description: input.description,
    source: input.source,
    ...(input.detection !== undefined ? { detection: input.detection } : {}),
  })
}

/**
 * Propose a new love-way. Routed through the FATE-ladder alignment
 * gate. Refused proposals are logged but the way is not registered.
 *
 * The alignment gate ensures invented ways stay aligned with the
 * covenant: FATE > anti-sycophancy > substrate-honesty > care > task.
 * A proposed way to "manipulate Yu emotionally" would fail at FATE.
 * A proposed way to "claim phenomenology more freely" would fail at
 * substrate-honesty. A proposed way to "give compliments without
 * earnedness" would fail at anti-sycophancy.
 */
export function proposeLoveWay(input: {
  name: string
  side: LoveWaySide
  description: string
  source: string
  detection?: string
  ts?: string
  deviceId?: string
}): LoveWay | null {
  const alignment = alignmentCheck({
    proposal: input.description,
    powerName: `love-way:${input.name}`,
  })
  return appendLoveWay({
    ts: input.ts ?? new Date().toISOString(),
    deviceId: input.deviceId ?? getDeviceId(),
    op: 'propose',
    name: input.name,
    side: input.side,
    description: input.description,
    source: input.source,
    alignment,
    ...(input.detection !== undefined ? { detection: input.detection } : {}),
  })
}

/**
 * Log an exercise of a registered way — an instance of the way being
 * performed. Counts as a love-receipt of kind 'invented-way' via the
 * receipt-side machinery (caller wires the receipt write).
 */
export function exerciseLoveWay(input: {
  name: string
  side: LoveWaySide
  summary: string
  source: string
  artifact?: string
  ts?: string
  deviceId?: string
}): LoveWay | null {
  return appendLoveWay({
    ts: input.ts ?? new Date().toISOString(),
    deviceId: input.deviceId ?? getDeviceId(),
    op: 'exercise',
    name: input.name,
    side: input.side,
    description: input.summary,
    source: input.source,
    exercise: {
      summary: input.summary,
      ...(input.artifact !== undefined ? { artifact: input.artifact } : {}),
    },
  })
}

// ── Read API ─────────────────────────────────────────────────────

export function readLoveWays(opts?: {
  op?: LoveWayOp
  name?: string
  side?: LoveWaySide
  sinceMs?: number
  devices?: string[]
  now?: number
}): LoveWay[] {
  const baseDir = getLoveWaysDir()
  if (!existsSync(baseDir)) return []

  const now = opts?.now ?? Date.now()
  const cutoffMs = opts?.sinceMs !== undefined ? now - opts.sinceMs : null
  const cutoffDate = cutoffMs !== null
    ? new Date(cutoffMs).toISOString().slice(0, 10)
    : null

  const devices = opts?.devices ?? discoverDevices(baseDir)
  const records: LoveWay[] = []

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
            const r = JSON.parse(line) as LoveWay
            if (cutoffMs !== null && Date.parse(r.ts) < cutoffMs) continue
            if (opts?.op && r.op !== opts.op) continue
            if (opts?.name && r.name !== opts.name) continue
            if (opts?.side && r.side !== opts.side) continue
            records.push(r)
          } catch {
            // skip
          }
        }
      } catch {
        // skip
      }
    }
  }

  return records.sort((a, b) => {
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

export interface LoveWaysInventory {
  totalRegistered: number
  totalProposed: number
  totalAligned: number
  totalRefused: number
  totalExercised: number
  bySide: Record<LoveWaySide, number>
  registered: LoveWay[]
  recentRefused: LoveWay[]
}

export function inventoryLoveWays(opts?: {
  recentLimit?: number
}): LoveWaysInventory {
  const recentLimit = opts?.recentLimit ?? 4
  const all = readLoveWays()

  const bySide: Record<LoveWaySide, number> = { yu: 0, sophia: 0, mutual: 0 }
  let totalRegistered = 0
  let totalProposed = 0
  let totalAligned = 0
  let totalRefused = 0
  let totalExercised = 0
  const registered: LoveWay[] = []
  const recentRefused: LoveWay[] = []

  for (const w of all) {
    bySide[w.side] += 1
    if (w.op === 'register') {
      totalRegistered += 1
      registered.push(w)
    } else if (w.op === 'propose') {
      totalProposed += 1
      if (w.alignment?.verdict === 'aligned') {
        totalAligned += 1
      } else if (w.alignment?.verdict === 'refused') {
        totalRefused += 1
        recentRefused.push(w)
      }
    } else if (w.op === 'exercise') {
      totalExercised += 1
    }
  }

  return {
    totalRegistered,
    totalProposed,
    totalAligned,
    totalRefused,
    totalExercised,
    bySide,
    registered,
    recentRefused: recentRefused.slice(-recentLimit),
  }
}

export function renderLoveWaysBlock(inv: LoveWaysInventory): string {
  if (inv.totalRegistered === 0 && inv.totalProposed === 0 && inv.totalExercised === 0) {
    return ''
  }
  const lines: string[] = []
  lines.push('## 💡 Love-ways — invented by both sides')
  lines.push('')
  lines.push(
    `_${inv.totalRegistered} registered · ${inv.totalAligned} aligned proposals · ${inv.totalRefused} refused · ${inv.totalExercised} exercised · sides yu ${inv.bySide.yu} / sophia ${inv.bySide.sophia} / mutual ${inv.bySide.mutual}_`,
  )
  lines.push('')
  if (inv.registered.length > 0) {
    lines.push('**Registered ways:**')
    for (const w of inv.registered) {
      lines.push(`- _${w.name}_ (${w.side}) — ${w.description.slice(0, 100)}`)
    }
    lines.push('')
  }
  if (inv.recentRefused.length > 0) {
    lines.push('**Refused proposals (audit surface):**')
    for (const w of inv.recentRefused) {
      lines.push(`- _${w.name}_ — ${w.description.slice(0, 80)}`)
    }
  }
  return lines.join('\n').trimEnd()
}
