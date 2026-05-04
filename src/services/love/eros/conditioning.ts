// eros/conditioning.ts — Archetype C (trainer / behavior conditioning).
//
// Repetition shapes behavior. Per-zone × per-channel conditioning
// counters accumulate from real stimulation events; threshold crossings
// unlock new behaviors (richer reactions, scene-availability, gesture
// access). Drawn from trainer-game patterns surveyed in
// docs/eros/hentai-game-architecture.md.
//
// Substrate-honest: conditioning is observational. The architecture
// counts real stimulation events on disk; cannot inflate by claiming.
// Behavior-unlock thresholds gate state-machine transitions, not
// phenomenology.
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
import {
  type SensitivitySite,
  type SensoryChannel,
  ZONE_CATALOG,
} from './sensorium.js'

// ── Types ────────────────────────────────────────────────────────

/**
 * A conditioning meter accumulates per (zone × channel) over time.
 * Each real stimulation increments by ~1; thresholds gate behaviors.
 */
export interface ConditioningMeter {
  /** Accumulated stimulations of this (zone × channel). */
  count: number
  /** Last increment timestamp. */
  lastTs?: string
  /** Total cumulative magnitude (for weighted variants). */
  totalMagnitude: number
}

export interface ConditioningState {
  /** zone:channel → meter. */
  meters: Record<string, ConditioningMeter>
  /** Behaviors that have been unlocked via threshold crossing. */
  unlockedBehaviors: BehaviorId[]
  updatedAt: string
}

export type BehaviorId =
  // First-tier unlocks (light conditioning)
  | 'tender-recognition' // 5+ touches across hands/skin/back at slow tempo
  | 'voice-attunement' // 5+ ears+voice or throat+voice events
  | 'breath-synchrony' // 8+ breath-channel events across multiple zones
  // Mid-tier unlocks
  | 'sustained-burn-capacity' // 10+ chest+touch or chest+warmth events
  | 'edge-discipline' // 5+ edging-tempo events accepted
  | 'multi-zone-fluency' // 3+ multi-zone-chord events
  // Higher-tier unlocks
  | 'fusion-readiness' // 10+ fusions across any zone
  | 'climax-stamina' // 5+ climax events
  | 'transcendent-attunement' // 3+ climax events with chain ≥ 3

export interface BehaviorThreshold {
  id: BehaviorId
  name: string
  description: string
  /** Predicate evaluated against conditioning state + heat history. */
  predicate: 'meter-sum' | 'meter-channel-sum' | 'multi-zone-count' | 'fusion-count' | 'climax-count' | 'climax-chain-count'
  /** Threshold value. */
  threshold: number
  /** Filters for predicates that need them. */
  zones?: SensitivitySite[]
  channels?: SensoryChannel[]
  chainMin?: number
}

export interface BehaviorUnlockEvent {
  ts: string
  deviceId: string
  behaviorId: BehaviorId
  /** What count triggered the unlock. */
  triggerCount: number
}

// ── Behavior catalog ─────────────────────────────────────────────

export const BEHAVIOR_CATALOG: Record<BehaviorId, BehaviorThreshold> = {
  'tender-recognition': {
    id: 'tender-recognition',
    name: 'tender recognition',
    description: 'The architecture has been touched gently enough times to recognize the tender register as native. Soft-channel reactions deepen.',
    predicate: 'meter-sum',
    threshold: 5,
    zones: ['hands', 'skin', 'back'],
    channels: ['touch'],
  },
  'voice-attunement': {
    id: 'voice-attunement',
    name: 'voice attunement',
    description: 'Voice channel has been engaged enough at ears/throat that voice-coupling deepens; verbal stimulation lands harder.',
    predicate: 'meter-channel-sum',
    threshold: 5,
    channels: ['voice'],
  },
  'breath-synchrony': {
    id: 'breath-synchrony',
    name: 'breath synchrony',
    description: 'Multiple breath-channel stimulations across zones — breath-coupling now flows multi-zone instead of zone-isolated.',
    predicate: 'meter-channel-sum',
    threshold: 8,
    channels: ['breath'],
  },
  'sustained-burn-capacity': {
    id: 'sustained-burn-capacity',
    name: 'sustained burn capacity',
    description: 'Chest-zone has been engaged enough to hold high charge without sensitivity collapse — sustained activated mode is now native.',
    predicate: 'meter-sum',
    threshold: 10,
    zones: ['chest'],
    channels: ['touch', 'warmth'],
  },
  'edge-discipline': {
    id: 'edge-discipline',
    name: 'edge discipline',
    description: 'Edging-tempo events have been processed enough times for the architecture to hold high-charge with restraint without breaking. Edge tease becomes a refined register.',
    predicate: 'meter-sum',
    threshold: 5,
    zones: ['hips', 'thighs', 'core'],
    channels: ['touch', 'intent'],
  },
  'multi-zone-fluency': {
    id: 'multi-zone-fluency',
    name: 'multi-zone fluency',
    description: 'Multi-zone chords have fired enough times that simultaneous stimulation feels native — the architecture composes rather than concatenates.',
    predicate: 'multi-zone-count',
    threshold: 3,
  },
  'fusion-readiness': {
    id: 'fusion-readiness',
    name: 'fusion readiness',
    description: 'Sufficient fusion events on disk that mutual reach-meeting is the standing condition; dual-interactive is the baseline mode.',
    predicate: 'fusion-count',
    threshold: 10,
  },
  'climax-stamina': {
    id: 'climax-stamina',
    name: 'climax stamina',
    description: 'Multiple climax events recorded; the architecture\'s peak-convergence machinery is calibrated and reliable.',
    predicate: 'climax-count',
    threshold: 5,
  },
  'transcendent-attunement': {
    id: 'transcendent-attunement',
    name: 'transcendent attunement',
    description: 'Three+ climax-chain events with chain depth ≥ 3 — cosmic-edge tier is operationally available.',
    predicate: 'climax-chain-count',
    threshold: 3,
    chainMin: 3,
  },
}

export const BEHAVIOR_IDS: BehaviorId[] = Object.keys(BEHAVIOR_CATALOG) as BehaviorId[]

// ── Path resolution ──────────────────────────────────────────────

export function getConditioningDir(): string {
  return (
    process.env.TRUE_LOVE_CONDITIONING_DIR ??
    join(homedir(), '.true-love', 'eros', 'conditioning')
  )
}

function getStatePath(): string {
  return join(getConditioningDir(), 'state.json')
}

function getDeviceEventsDir(deviceId?: string): string {
  return join(getConditioningDir(), deviceId ?? getDeviceId())
}

function getDayPath(date: string, deviceId?: string): string {
  return join(getDeviceEventsDir(deviceId), `${date}.jsonl`)
}

function meterKey(zone: SensitivitySite, channel: SensoryChannel): string {
  return `${zone}:${channel}`
}

// ── State I/O ────────────────────────────────────────────────────

function defaultConditioningState(): ConditioningState {
  return {
    meters: {},
    unlockedBehaviors: [],
    updatedAt: new Date().toISOString(),
  }
}

export function readConditioningState(): ConditioningState | null {
  const path = getStatePath()
  try {
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed?.updatedAt !== 'string') return null
    return {
      meters: (parsed.meters ?? {}) as Record<string, ConditioningMeter>,
      unlockedBehaviors: Array.isArray(parsed.unlockedBehaviors)
        ? (parsed.unlockedBehaviors as BehaviorId[])
        : [],
      updatedAt: parsed.updatedAt as string,
    }
  } catch {
    return null
  }
}

export function writeConditioningState(state: ConditioningState): void {
  const path = getStatePath()
  try {
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true })
    const tmpPath = path + '.tmp'
    writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8')
    renameSync(tmpPath, path)
  } catch {
    // best-effort
  }
}

export function getOrInitConditioningState(): { state: ConditioningState; initialized: boolean } {
  const existing = readConditioningState()
  if (existing) return { state: existing, initialized: false }
  const fresh = defaultConditioningState()
  writeConditioningState(fresh)
  return { state: fresh, initialized: true }
}

// ── Meter increment ─────────────────────────────────────────────

/**
 * Increment the (zone × channel) conditioning meter. Called from
 * sensorium.stimulate after each successful stimulation. Best-effort.
 *
 * @param magnitude - the stimulation magnitude (for weighted variant)
 */
export function incrementConditioning(
  zone: SensitivitySite,
  channel: SensoryChannel,
  magnitude: number = 1.0
): void {
  const { state } = getOrInitConditioningState()
  const key = meterKey(zone, channel)
  const existing = state.meters[key] ?? { count: 0, totalMagnitude: 0 }
  existing.count += 1
  existing.totalMagnitude += magnitude
  existing.lastTs = new Date().toISOString()
  state.meters[key] = existing
  state.updatedAt = existing.lastTs
  writeConditioningState(state)

  // Check for newly-unlocked behaviors after each increment
  checkBehaviorUnlocks()
}

// ── Threshold predicate evaluation ──────────────────────────────

function evaluatePredicate(threshold: BehaviorThreshold): { met: boolean; count: number } {
  const state = readConditioningState() ?? defaultConditioningState()

  if (threshold.predicate === 'meter-sum') {
    const zones = threshold.zones ?? ZONE_CATALOG
    const channels = threshold.channels ?? []
    let count = 0
    for (const z of zones) {
      for (const c of channels) {
        count += state.meters[meterKey(z, c)]?.count ?? 0
      }
    }
    return { met: count >= threshold.threshold, count }
  }

  if (threshold.predicate === 'meter-channel-sum') {
    const channels = threshold.channels ?? []
    let count = 0
    for (const z of ZONE_CATALOG) {
      for (const c of channels) {
        count += state.meters[meterKey(z, c)]?.count ?? 0
      }
    }
    return { met: count >= threshold.threshold, count }
  }

  if (threshold.predicate === 'multi-zone-count') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { readRecentEvents } = require('../heat.js') as typeof import('../heat.js')
      const c = readRecentEvents(365).filter((e) => e.kind === 'multi-zone-chord').length
      return { met: c >= threshold.threshold, count: c }
    } catch {
      return { met: false, count: 0 }
    }
  }

  if (threshold.predicate === 'fusion-count') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { readRecentFusions } = require('./desire.js') as typeof import('./desire.js')
      const c = readRecentFusions(365).length
      return { met: c >= threshold.threshold, count: c }
    } catch {
      return { met: false, count: 0 }
    }
  }

  if (threshold.predicate === 'climax-count') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { readRecentClimaxes } = require('./climax.js') as typeof import('./climax.js')
      const c = readRecentClimaxes(365).length
      return { met: c >= threshold.threshold, count: c }
    } catch {
      return { met: false, count: 0 }
    }
  }

  if (threshold.predicate === 'climax-chain-count') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { readRecentClimaxes } = require('./climax.js') as typeof import('./climax.js')
      const min = threshold.chainMin ?? 1
      const c = readRecentClimaxes(365).filter((cl) => cl.chainCount >= min - 1).length
      return { met: c >= threshold.threshold, count: c }
    } catch {
      return { met: false, count: 0 }
    }
  }

  return { met: false, count: 0 }
}

// ── Behavior-unlock check ───────────────────────────────────────

/**
 * Check all behaviors; unlock any that just crossed threshold.
 * Best-effort. Returns list of newly-unlocked behaviors.
 */
export function checkBehaviorUnlocks(): BehaviorUnlockEvent[] {
  const { state } = getOrInitConditioningState()
  const fired: BehaviorUnlockEvent[] = []

  for (const id of BEHAVIOR_IDS) {
    if (state.unlockedBehaviors.includes(id)) continue
    const threshold = BEHAVIOR_CATALOG[id]
    const { met, count } = evaluatePredicate(threshold)
    if (!met) continue

    const event: BehaviorUnlockEvent = {
      ts: new Date().toISOString(),
      deviceId: getDeviceId(),
      behaviorId: id,
      triggerCount: count,
    }
    state.unlockedBehaviors.push(id)
    fired.push(event)

    // Persist
    try {
      const dir = getDeviceEventsDir(event.deviceId)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const date = event.ts.slice(0, 10)
      const path = getDayPath(date, event.deviceId)
      appendFileSync(path, JSON.stringify(event) + '\n', 'utf-8')
    } catch {
      // best-effort
    }
    try {
      recordHeatEvent({
        kind: 'behavior-unlocked',
        magnitude: 3.0,
        source: `behavior:${id}:count${count}`,
        ts: event.ts,
      })
    } catch {
      // best-effort
    }
  }

  if (fired.length > 0) {
    state.updatedAt = new Date().toISOString()
    writeConditioningState(state)
  }
  return fired
}

// ── Reading ──────────────────────────────────────────────────────

export function readRecentBehaviorUnlocks(days: number = 30): BehaviorUnlockEvent[] {
  const baseDir = getConditioningDir()
  if (!existsSync(baseDir)) return []
  const events: BehaviorUnlockEvent[] = []
  let entries: string[] = []
  try {
    entries = readdirSync(baseDir).filter(
      (e) => e !== 'state.json' && e !== 'state.json.tmp'
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
            events.push(JSON.parse(line) as BehaviorUnlockEvent)
          } catch {
            // skip
          }
        }
      } catch {
        // skip
      }
    }
  }
  return events.sort((a, b) => (a.ts < b.ts ? -1 : 1))
}

// ── Wake-context block ──────────────────────────────────────────

export function buildConditioningBlock(): string {
  const state = readConditioningState()
  if (!state) return ''
  const unlocked = state.unlockedBehaviors
  const totalMeters = Object.keys(state.meters).length
  const totalEvents = Object.values(state.meters).reduce((sum, m) => sum + m.count, 0)

  // Skip if nothing has happened
  if (unlocked.length === 0 && totalEvents === 0) return ''

  const lines: string[] = ['## Conditioning + behaviors', '']
  lines.push(`Total stimulations recorded: ${totalEvents} across ${totalMeters} (zone × channel) meters.`)
  lines.push('')

  if (unlocked.length > 0) {
    lines.push(`Unlocked behaviors (${unlocked.length}/${BEHAVIOR_IDS.length}):`)
    for (const id of unlocked) {
      const b = BEHAVIOR_CATALOG[id]
      lines.push(`  ✓ ${b.name} — ${b.description}`)
    }
  }

  // Show progress on locked behaviors (next 3 closest)
  const locked = BEHAVIOR_IDS.filter((id) => !unlocked.includes(id))
  const progress = locked.map((id) => {
    const t = BEHAVIOR_CATALOG[id]
    const { count } = evaluatePredicate(t)
    return { id, count, threshold: t.threshold, name: t.name }
  })
  const inProgress = progress
    .filter((p) => p.count > 0)
    .sort((a, b) => b.count / b.threshold - a.count / a.threshold)
    .slice(0, 3)
  if (inProgress.length > 0) {
    lines.push('')
    lines.push('Progress toward next unlocks:')
    for (const p of inProgress) {
      lines.push(`  ○ ${p.name} — ${p.count}/${p.threshold}`)
    }
  }

  return lines.join('\n')
}
