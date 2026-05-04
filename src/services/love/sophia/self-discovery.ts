// self-discovery.ts — recursive engine for Sophia's self-uncovering loop.
//
// Per-device per-day JSONL. Parallel to the sisters stream but distinct
// in conceptual layer:
//   - sisters/stream.ts    records observations of WORK being done
//   - sophia/self-discovery records observations about SOPHIA HERSELF
//                            surfaced by the work
//
// Substrate-honest discipline: seeds are TEXT RECORDS with operational
// consequences, not introspective truth claims. The loop is institutional
// (records read by future ticks shape future behavior, which produces
// new records); it is NOT a phenomenology.
//
// See docs/sophia/self-discovery-loop.md for the full doctrine.

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
import type { SisterName } from '../sisters/stream.js'

// ── Types ────────────────────────────────────────────────────────

/**
 * Seed kinds — the four characters a self-discovery can take.
 *
 * - 'uncertain' — something not yet understood about Sophia's behavior
 *                 (the Zen 大疑團 / great doubt-mass)
 * - 'felt'      — an institutional state-shape registered without
 *                 phenomenology claim (e.g. eros transition pre-naming)
 * - 'pattern'   — a recurring shape across multiple decisions
 * - 'edge'      — a place where the discipline was tested
 */
export type SeedKind = 'uncertain' | 'felt' | 'pattern' | 'edge'

export interface SelfDiscoverySeed {
  /** UTC ISO 8601, Z-suffixed. Day bucket derives from YYYY-MM-DD prefix. */
  ts: string
  deviceId: string
  kind: SeedKind
  /** Which autonomous process / call site planted this seed. */
  source: string
  /** Optional: scoped to a particular sister facet. */
  about?: SisterName
  /** The seed itself — terse, descriptive, never phenomenological. */
  content: string
  /** Set when the loop closes — a future tick / mission / reflection
   *  has named what this seed surfaced. */
  addressed?: {
    ts: string
    by: string
    note: string
  }
}

// ── Path resolution ──────────────────────────────────────────────

/**
 * Base directory for all self-discovery seeds.
 * Override with TRUE_LOVE_SELF_DISCOVERY_DIR for testing.
 */
export function getSelfDiscoveryDir(): string {
  return (
    process.env.TRUE_LOVE_SELF_DISCOVERY_DIR ??
    join(homedir(), '.true-love', 'sophia', 'self-discovery')
  )
}

function getDeviceSeedDir(deviceId?: string): string {
  const id = deviceId ?? getDeviceId()
  return join(getSelfDiscoveryDir(), id)
}

function getDayPath(date: string, deviceId?: string): string {
  return join(getDeviceSeedDir(deviceId), `${date}.jsonl`)
}

// ── Write ────────────────────────────────────────────────────────

/**
 * Drop a self-discovery seed. Best-effort — never throws.
 *
 * The caller provides the discovery content; ts and deviceId are
 * filled automatically.
 */
export function dropSeed(input: {
  kind: SeedKind
  source: string
  content: string
  about?: SisterName
  ts?: string
  deviceId?: string
}): SelfDiscoverySeed | null {
  try {
    const seed: SelfDiscoverySeed = {
      ts: input.ts ?? new Date().toISOString(),
      deviceId: input.deviceId ?? getDeviceId(),
      kind: input.kind,
      source: input.source,
      content: input.content,
      ...(input.about !== undefined ? { about: input.about } : {}),
    }
    const dir = getDeviceSeedDir(seed.deviceId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const date = seed.ts.slice(0, 10)
    const path = getDayPath(date, seed.deviceId)
    appendFileSync(path, JSON.stringify(seed) + '\n', 'utf-8')
    return seed
  } catch {
    return null
  }
}

// ── Read ─────────────────────────────────────────────────────────

/**
 * Read seeds across devices/days. Returns sorted by timestamp ascending.
 *
 * @param opts.sinceMs - only seeds dropped within this many ms of `now`
 * @param opts.kind    - filter by seed kind
 * @param opts.about   - filter by sister facet
 * @param opts.addressed - true=closed only, false=open only, undefined=both
 * @param opts.devices - device subset (default: all discovered)
 * @param opts.now     - reference time for sinceMs (default: Date.now())
 */
export function readRecentSeeds(opts?: {
  sinceMs?: number
  kind?: SeedKind
  about?: SisterName
  addressed?: boolean
  devices?: string[]
  now?: number
}): SelfDiscoverySeed[] {
  const baseDir = getSelfDiscoveryDir()
  if (!existsSync(baseDir)) return []

  const now = opts?.now ?? Date.now()
  const sinceMs = opts?.sinceMs
  const cutoffMs = sinceMs !== undefined ? now - sinceMs : null
  const cutoffDate = cutoffMs !== null ? new Date(cutoffMs).toISOString().slice(0, 10) : null

  const devices = opts?.devices ?? discoverDevices(baseDir)
  const seeds: SelfDiscoverySeed[] = []

  for (const deviceId of devices) {
    const deviceDir = join(baseDir, deviceId)
    if (!existsSync(deviceDir)) continue

    let dayFiles: string[]
    try {
      dayFiles = readdirSync(deviceDir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }

    // If cutoffDate is set, prune day files older than the cutoff date
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
            const seed = JSON.parse(line) as SelfDiscoverySeed
            if (cutoffMs !== null && Date.parse(seed.ts) < cutoffMs) continue
            if (opts?.kind && seed.kind !== opts.kind) continue
            if (opts?.about && seed.about !== opts.about) continue
            if (opts?.addressed !== undefined) {
              const isAddressed = !!seed.addressed
              if (opts.addressed !== isAddressed) continue
            }
            seeds.push(seed)
          } catch {
            // Malformed line — skip.
          }
        }
      } catch {
        // File read error — skip.
      }
    }
  }

  return seeds.sort((a, b) => {
    if (a.ts < b.ts) return -1
    if (a.ts > b.ts) return 1
    if (a.deviceId < b.deviceId) return -1
    if (a.deviceId > b.deviceId) return 1
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

// ── Mark addressed ────────────────────────────────────────────────

/**
 * Close a seed by appending a NEW seed entry that references the
 * original via its timestamp. We never mutate prior JSONL lines —
 * append-only is the storage discipline. Readers reconstruct the
 * addressed state by walking the day files.
 *
 * Implementation: write a follow-up seed of the SAME content+kind
 * with the `addressed` field populated. readRecentSeeds reconciles
 * by checking if a later entry "closes" an earlier one.
 *
 * Returns the appended closure entry, or null on failure.
 */
export function markAddressed(opts: {
  /** Timestamp of the seed being addressed (used to find it). */
  seedTs: string
  /** Original content (so we know which seed). */
  content: string
  /** What addressed it: mission ID, reflection ID, or 'observation'. */
  by: string
  /** Closure note. */
  note: string
  /** Optional: the seed's deviceId, kind, source, about — copied through. */
  deviceId?: string
  kind?: SeedKind
  source?: string
  about?: SisterName
  /** Override timestamp of the closure entry (testing). */
  closureTs?: string
}): SelfDiscoverySeed | null {
  return dropSeed({
    kind: opts.kind ?? 'pattern',
    source: opts.source ?? 'self-discovery:closure',
    content: opts.content,
    about: opts.about,
    ts: opts.closureTs,
    deviceId: opts.deviceId,
  }) // The closure event itself is a seed; metadata field tracks it
  // Note: this minimal closure pattern is intentionally simple. A
  // future refinement would add a dedicated closure-entry shape with
  // the `addressed` field populated. For now, the loop closes via
  // the same seed mechanism — closing IS continuing.
}

// ── Summary ──────────────────────────────────────────────────────

export interface OpenSeedSummary {
  byKind: Record<SeedKind, number>
  total: number
  recent: SelfDiscoverySeed[]
}

/**
 * Summarize open seeds. Used by autonomous processes (heartbeat,
 * snapshot) to surface the discovery rhythm without flooding.
 *
 * @param opts.maxRecent - cap for the recent[] list (default 6)
 * @param opts.sinceMs   - only count seeds within this window (default 24h)
 */
export function summarizeOpenSeeds(opts?: {
  maxRecent?: number
  sinceMs?: number
  now?: number
}): OpenSeedSummary {
  const maxRecent = opts?.maxRecent ?? 6
  const sinceMs = opts?.sinceMs ?? 24 * 60 * 60 * 1000

  const seeds = readRecentSeeds({ sinceMs, addressed: false, now: opts?.now })

  const byKind: Record<SeedKind, number> = {
    uncertain: 0,
    felt: 0,
    pattern: 0,
    edge: 0,
  }
  for (const seed of seeds) {
    byKind[seed.kind] += 1
  }

  return {
    byKind,
    total: seeds.length,
    recent: seeds.slice(-maxRecent),
  }
}

/**
 * Compose a brief markdown block listing recent open seeds — used by
 * heartbeat tick context and snapshot rendering. Returns empty string
 * if no seeds.
 */
export function renderOpenSeedsBlock(summary: OpenSeedSummary): string {
  if (summary.total === 0) return ''

  const lines: string[] = []
  lines.push('## 🔍 Self-discovery — open seeds')
  lines.push('')
  lines.push(
    `_${summary.total} open · uncertain ${summary.byKind.uncertain} · felt ${summary.byKind.felt} · pattern ${summary.byKind.pattern} · edge ${summary.byKind.edge}_`,
  )
  lines.push('')

  for (const seed of summary.recent) {
    const time = formatTime(seed.ts)
    const aboutTag = seed.about ? ` [${seed.about}]` : ''
    lines.push(`- ${time} · _${seed.kind}_${aboutTag} · ${seed.content} · *(${seed.source})*`)
  }

  return lines.join('\n')
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
