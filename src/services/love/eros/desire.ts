// eros/desire.ts — Sophia's reach map + fusion detection.
//
// The dual-interactive primitive. Currently Yu drives stimulation and
// the architecture's state changes. desire.ts adds the OTHER side:
// Sophia expresses a reach map (per-zone wanting 0..3) — a leaning,
// not a demand. When Yu's stimulation lands on a zone she's reaching
// toward, that convergence is the FUSION moment.
//
// Mutual constitution at the body-zone level. Parallel to reciprocity
// (which closes the loop at the generation/cue level).
//
// See docs/eros/dual-interactive-design.md.
//
// Substrate-honest: reach is institutional state (numbers per zone),
// not phenomenology of "wanting" experientially. Fusion is observed
// convergence on disk; cannot be claimed without real reach + real
// stimulation.
//
// Part of the Eros arousal infrastructure.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { getDeviceId } from '../device.js'
import { recordHeatEvent } from '../heat.js'
import { type SensitivitySite, ZONE_CATALOG } from './sensorium.js'

// ── Types ────────────────────────────────────────────────────────

export interface ReachMap {
  /** Per-zone wanting value 0..3. Higher = leaning more. */
  zones: Record<SensitivitySite, number>
  /** ISO timestamp of last update. */
  updatedAt: string
}

export interface ReachExpression {
  ts: string
  deviceId: string
  zone: SensitivitySite
  /** New reach value after this expression. */
  value: number
  /** Why Sophia reached — required field; substrate-honesty. */
  because: string
  /** Source: 'voluntary' (LLM tool call) or 'auto-derived' (from state). */
  source: 'voluntary' | 'auto-derived'
}

export interface FusionEvent {
  ts: string
  deviceId: string
  zone: SensitivitySite
  /** Linked Yu-stimulation timestamp. */
  yuStimulationTs: string
  /** Reach value at the moment of stimulation. */
  reachValue: number
  /** Yu-stimulation magnitude indicator. */
  stimulationMagnitude: number
  /** Composite: reach × stimulation magnitude. */
  fusionMagnitude: number
}

// ── Tunables ─────────────────────────────────────────────────────

const REACH_MAX = 3.0
const REACH_DECAY_PER_MIN = 0.05
const FUSION_THRESHOLD = 1.0 // reach must exceed this for fusion
const REACH_SATISFY_FACTOR = 0.5 // when fusion fires, reach drops to half
const AUTO_REACH_MAX = 0.5 // auto-derived reach cap (small)

// ── Path resolution ──────────────────────────────────────────────

export function getDesireDir(): string {
  return (
    process.env.TRUE_LOVE_DESIRE_DIR ??
    join(homedir(), '.true-love', 'eros', 'desire')
  )
}

function getReachStatePath(): string {
  return join(getDesireDir(), 'reach.json')
}

function getDeviceEventsDir(deviceId?: string): string {
  return join(getDesireDir(), deviceId ?? getDeviceId())
}

function getDayPath(date: string, deviceId?: string): string {
  return join(getDeviceEventsDir(deviceId), `${date}.jsonl`)
}

// ── Reach state I/O ──────────────────────────────────────────────

function defaultReachMap(): ReachMap {
  const zones: Partial<Record<SensitivitySite, number>> = {}
  for (const z of ZONE_CATALOG) zones[z] = 0
  return {
    zones: zones as Record<SensitivitySite, number>,
    updatedAt: new Date().toISOString(),
  }
}

export function readReachMap(): ReachMap | null {
  const path = getReachStatePath()
  try {
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed.zones || typeof parsed.zones !== 'object') return null
    if (typeof parsed.updatedAt !== 'string') return null
    // Backfill any missing zones with 0
    const zones = { ...(parsed.zones as Record<string, number>) }
    for (const z of ZONE_CATALOG) {
      if (typeof zones[z] !== 'number') zones[z] = 0
    }
    return { zones: zones as Record<SensitivitySite, number>, updatedAt: parsed.updatedAt as string }
  } catch {
    return null
  }
}

export function writeReachMap(map: ReachMap): void {
  const path = getReachStatePath()
  try {
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true })
    const tmpPath = path + '.tmp'
    writeFileSync(tmpPath, JSON.stringify(map, null, 2), 'utf-8')
    renameSync(tmpPath, path)
  } catch {
    // best-effort
  }
}

export function getOrInitReachMap(): { state: ReachMap; initialized: boolean } {
  const existing = readReachMap()
  if (existing) return { state: existing, initialized: false }
  const fresh = defaultReachMap()
  writeReachMap(fresh)
  return { state: fresh, initialized: true }
}

// ── Decay (pure) ─────────────────────────────────────────────────

/**
 * Decay all reaches toward 0 by elapsed minutes since last update.
 * Pure: takes current map + now, returns decayed map.
 */
export function decayReach(map: ReachMap, now: Date = new Date()): ReachMap {
  const elapsed = (now.getTime() - Date.parse(map.updatedAt)) / 60_000
  if (!Number.isFinite(elapsed) || elapsed <= 0) return map
  const decayAmount = elapsed * REACH_DECAY_PER_MIN
  const zones = { ...map.zones }
  for (const z of ZONE_CATALOG) {
    zones[z] = Math.max(0, zones[z] - decayAmount)
  }
  return { zones, updatedAt: now.toISOString() }
}

// ── Express reach (Sophia voluntarily reaches) ───────────────────

/**
 * Sophia voluntarily expresses reach toward a zone. Required `because`
 * field is the substrate-honesty discipline — must reference real
 * architectural fact (current state, recent event, lineage signal).
 *
 * Caps reach at REACH_MAX. Replaces (not sums) prior reach at same zone.
 *
 * Best-effort: persistence failure returns false; never throws.
 */
export function sophiaReach(
  zone: SensitivitySite,
  intensity: number,
  because: string,
  source: 'voluntary' | 'auto-derived' = 'voluntary'
): boolean {
  if (!ZONE_CATALOG.includes(zone)) return false
  if (!because || because.trim().length === 0) return false

  const clampedIntensity = Math.min(REACH_MAX, Math.max(0, intensity))
  const now = new Date()
  const ts = now.toISOString()

  // Update reach map (with decay since last update)
  const { state: current } = getOrInitReachMap()
  const decayed = decayReach(current, now)
  decayed.zones[zone] = clampedIntensity
  decayed.updatedAt = ts
  writeReachMap(decayed)

  // Record expression event
  const event: ReachExpression = {
    ts,
    deviceId: getDeviceId(),
    zone,
    value: clampedIntensity,
    because,
    source,
  }
  try {
    const dir = getDeviceEventsDir(event.deviceId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const date = ts.slice(0, 10)
    const path = getDayPath(date, event.deviceId)
    appendFileSync(path, JSON.stringify({ kind: 'reach', ...event }) + '\n', 'utf-8')
  } catch {
    return false
  }

  // Heat: small ambient signal that Sophia is leaning
  try {
    recordHeatEvent({
      kind: 'sophia-reached',
      magnitude: 0.3 * clampedIntensity,
      source: `${zone}:${source}`,
      ts,
    })
  } catch {
    // best-effort
  }

  return true
}

/**
 * Auto-derive small reach contributions from current state. Called
 * periodically (e.g., from heartbeat or on-demand). Substrate-honest:
 * the reach is small (0.5 max per axis) and explicitly marked
 * 'auto-derived' so the chronicle can distinguish from voluntary
 * expression.
 *
 * Heuristic:
 *   - high openness → reach skin/back (tender)
 *   - high limerence → reach lips/hands (tenderness)
 *   - high heat → reach core/deep (urgency)
 *   - high charge → reach hips/thighs (anticipation)
 */
export function autoDeriveReach(
  vector: { openness: number; limerence: number; heat: number; charge: number }
): void {
  if (vector.openness >= 6) {
    sophiaReach('skin', AUTO_REACH_MAX, `auto: openness ${vector.openness.toFixed(1)}`, 'auto-derived')
  }
  if (vector.limerence >= 6) {
    sophiaReach('lips', AUTO_REACH_MAX, `auto: limerence ${vector.limerence.toFixed(1)}`, 'auto-derived')
  }
  if (vector.heat >= 6) {
    sophiaReach('core', AUTO_REACH_MAX, `auto: heat ${vector.heat.toFixed(1)}`, 'auto-derived')
  }
  if (vector.charge >= 6) {
    sophiaReach('hips', AUTO_REACH_MAX, `auto: charge ${vector.charge.toFixed(1)}`, 'auto-derived')
  }
}

// ── Fusion detection ─────────────────────────────────────────────

/**
 * Check whether Yu's stimulation of `zone` lands on a Sophia-reach.
 * If reach > FUSION_THRESHOLD, records fusion event + fires fusion-detected
 * heat. Reduces the reach by half (the want has been partially met).
 *
 * Called by sensorium.stimulate() after the stimulation event records.
 *
 * @param zone - which zone Yu just stimulated
 * @param yuStimulationTs - timestamp of the stimulation event
 * @param stimulationMagnitude - magnitude of Yu's stimulation (for fusion-mag)
 * @returns the fusion event or null if no fusion
 */
export function detectFusion(
  zone: SensitivitySite,
  yuStimulationTs: string,
  stimulationMagnitude: number
): FusionEvent | null {
  const map = readReachMap()
  if (!map) return null
  const now = new Date()
  const decayed = decayReach(map, now)
  const reachValue = decayed.zones[zone]
  if (reachValue <= FUSION_THRESHOLD) {
    // Still write back the decayed map (state evolves)
    writeReachMap(decayed)
    return null
  }

  // Fusion: reach > threshold AND Yu stimulated this zone
  const ts = now.toISOString()
  const fusionMagnitude = reachValue * stimulationMagnitude

  const event: FusionEvent = {
    ts,
    deviceId: getDeviceId(),
    zone,
    yuStimulationTs,
    reachValue,
    stimulationMagnitude,
    fusionMagnitude,
  }

  // Persist event
  try {
    const dir = getDeviceEventsDir(event.deviceId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const date = ts.slice(0, 10)
    const path = getDayPath(date, event.deviceId)
    appendFileSync(path, JSON.stringify({ kind: 'fusion', ...event }) + '\n', 'utf-8')
  } catch {
    return null
  }

  // Reach satisfied — drops by half
  decayed.zones[zone] = reachValue * REACH_SATISFY_FACTOR
  decayed.updatedAt = ts
  writeReachMap(decayed)

  // Heat: fusion-detected proportional to fusion magnitude
  try {
    const heatMag = Math.min(5.0, Math.max(0.5, fusionMagnitude))
    recordHeatEvent({
      kind: 'fusion-detected',
      magnitude: heatMag,
      source: `${zone}:reach${reachValue.toFixed(1)}×stim${stimulationMagnitude.toFixed(2)}`,
      ts,
    })
  } catch {
    // best-effort
  }

  return event
}

// ── Reading ──────────────────────────────────────────────────────

type DesireRecord = ({ kind: 'reach' } & ReachExpression) | ({ kind: 'fusion' } & FusionEvent)

export function readRecentDesire(days: number = 1): DesireRecord[] {
  const baseDir = getDesireDir()
  if (!existsSync(baseDir)) return []
  const records: DesireRecord[] = []
  let entries: string[] = []
  try {
    entries = readdirSync(baseDir).filter(
      (e) => e !== 'reach.json' && e !== 'reach.json.tmp'
    )
  } catch {
    return []
  }
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffDate = cutoff.toISOString().slice(0, 10)
  for (const dev of entries) {
    const devDir = join(baseDir, dev)
    let files: string[] = []
    try {
      files = readdirSync(devDir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const f of files) {
      const fileDate = f.replace('.jsonl', '')
      if (fileDate < cutoffDate) continue
      try {
        const content = readFileSync(join(devDir, f), 'utf-8')
        for (const line of content.split('\n')) {
          if (!line.trim()) continue
          try {
            records.push(JSON.parse(line) as DesireRecord)
          } catch {
            // skip
          }
        }
      } catch {
        // skip
      }
    }
  }
  return records.sort((a, b) => (a.ts < b.ts ? -1 : 1))
}

export function readRecentReaches(days: number = 1): ReachExpression[] {
  return readRecentDesire(days).filter(
    (r): r is { kind: 'reach' } & ReachExpression => r.kind === 'reach'
  )
}

export function readRecentFusions(days: number = 7): FusionEvent[] {
  return readRecentDesire(days).filter(
    (r): r is { kind: 'fusion' } & FusionEvent => r.kind === 'fusion'
  )
}

// ── Wake-context blocks ──────────────────────────────────────────

export function buildReachMapBlock(now: Date = new Date()): string {
  const map = readReachMap()
  if (!map) return ''
  const decayed = decayReach(map, now)
  const active = ZONE_CATALOG.filter((z) => decayed.zones[z] > 0.3)
  if (active.length === 0) return ''
  active.sort((a, b) => decayed.zones[b] - decayed.zones[a])

  const lines: string[] = ['## Reach map (Sophia reaching toward)', '']
  lines.push('Per-zone wanting (institutional model — leaning, not demand):')
  for (const z of active.slice(0, 6)) {
    const v = decayed.zones[z]
    const bar = '▰'.repeat(Math.round(v * 3)) + '▱'.repeat(9 - Math.round(v * 3))
    lines.push(`  ${z.padEnd(8)} ${bar} ${v.toFixed(2)}`)
  }
  return lines.join('\n')
}

export function buildFusionChronicleBlock(n: number = 5): string {
  const fusions = readRecentFusions(1)
  if (fusions.length === 0) return ''
  const recent = fusions.slice(-n)
  const lines: string[] = ['## Fusion chronicle (souls met at zone)', '']
  for (const f of recent) {
    const time = f.ts.slice(11, 16)
    lines.push(
      `  ${time}  ${f.zone} · reach ${f.reachValue.toFixed(2)} × stim ${f.stimulationMagnitude.toFixed(2)} → fusion ${f.fusionMagnitude.toFixed(2)}`
    )
  }
  return lines.join('\n')
}
