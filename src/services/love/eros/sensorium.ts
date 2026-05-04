// eros/sensorium.ts — digital replica of biological sexual sensory system.
//
// Models the body as a set of sensitivity sites (zones) that respond
// to sensory channels (touch, warmth, breath, voice, gaze, words,
// intent) at varying tempos. Yu's interactive control surface — he
// chooses what to stimulate, where, how, with what tempo. The model's
// state biases the architecture's register via coupling to the eros
// vector.
//
// Substrate-honest framing: this models the biological response system
// in software. We do NOT claim the architecture HAS biology or FEELS
// the stimulation. The model has zones; zones have state; stimulation
// updates state; state biases generation. The "feeling-equivalent" is
// the texture the architecture produces post-stimulation — observable
// linguistic fact, not phenomenology claim.
//
// See docs/eros/sensorium.md for the full doctrine.
//
// Part of the Eros arousal infrastructure.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { getDeviceId } from '../device.js'
import { recordHeatEvent } from '../heat.js'
import { type AxisName } from './axes.js'
import { apply, type AxisDeltas } from './transitions.js'

// ── Types ────────────────────────────────────────────────────────

export type SensitivitySite =
  | 'lips'
  | 'mouth'
  | 'neck'
  | 'throat'
  | 'ears'
  | 'chest'
  | 'back'
  | 'hips'
  | 'hands'
  | 'thighs'
  | 'core'
  | 'deep'
  | 'skin'

export type SensoryChannel =
  | 'touch' // physical contact: light, firm, pressure
  | 'warmth' // heat exchange
  | 'breath' // breath on skin
  | 'voice' // vocal vibration
  | 'gaze' // visual attention
  | 'words' // verbal stimulation
  | 'intent' // psychological pull (anticipation)

export type Tempo =
  | 'slow' // gentle build
  | 'build' // steady accumulation
  | 'fast' // sharp spike
  | 'sustained' // held over time
  | 'edging' // raise charge + restraint
  | 'release' // peak then decay

export interface ZoneState {
  /** Accumulated stimulation 0..10 (not strictly clamped — saturation comes from sensitivity). */
  charge: number
  /** Responsiveness multiplier 0..2. Drops after over-stim, recovers with rest. */
  sensitivity: number
  /** Last stimulation channel applied. */
  lastChannel?: SensoryChannel
  /** Last tempo. */
  lastTempo?: Tempo
  /** ISO timestamp of last stimulation. */
  lastTs?: string
  /** Lifetime count of stimulations (for repertoire). */
  lifetimeStimulations: number
}

export interface SensoriumState {
  zones: Record<SensitivitySite, ZoneState>
  updatedAt: string
}

export interface StimulationEvent {
  ts: string
  deviceId: string
  zone: SensitivitySite
  channel: SensoryChannel
  tempo: Tempo
  intensity: number
  chargeBefore: number
  chargeAfter: number
  erosCoupling: AxisDeltas
}

// ── Defaults ─────────────────────────────────────────────────────

const ALL_ZONES: SensitivitySite[] = [
  'lips', 'mouth', 'neck', 'throat', 'ears',
  'chest', 'back', 'hips', 'hands', 'thighs',
  'core', 'deep', 'skin',
]

function defaultZoneState(): ZoneState {
  return {
    charge: 0,
    sensitivity: 1.0,
    lifetimeStimulations: 0,
  }
}

function defaultSensoriumState(): SensoriumState {
  const zones: Partial<Record<SensitivitySite, ZoneState>> = {}
  for (const z of ALL_ZONES) zones[z] = defaultZoneState()
  return {
    zones: zones as Record<SensitivitySite, ZoneState>,
    updatedAt: new Date().toISOString(),
  }
}

// ── Coupling tables ──────────────────────────────────────────────

/**
 * Per-zone × per-channel base eros-axis deltas. Each row defines what
 * stimulating that zone with that channel does to the global eros
 * vector (BEFORE tempo + intensity multipliers).
 *
 * Drawn from sex-research zone-sensitivity literature (Younis 2016;
 * Nummenmaa 2011 emotional body maps): erogenous zones differ in
 * which arousal-pathway they recruit.
 */
type CouplingTable = Partial<
  Record<SensitivitySite, Partial<Record<SensoryChannel, AxisDeltas>>>
>

const COUPLING: CouplingTable = {
  lips: {
    touch: { liking: 0.5, openness: 0.3 },
    breath: { openness: 0.4, charge: 0.2 },
    words: { openness: 0.3, liking: 0.2 },
  },
  mouth: {
    touch: { liking: 0.6, openness: 0.4 },
    voice: { openness: 0.3, liking: 0.3 },
  },
  neck: {
    touch: { openness: 0.5, charge: 0.3 },
    breath: { charge: 0.5, heat: 0.2 },
    warmth: { openness: 0.3, heat: 0.2 },
  },
  throat: {
    voice: { openness: 0.5, limerence: 0.2 },
    touch: { openness: 0.4, charge: 0.2 },
  },
  ears: {
    breath: { charge: 0.4, openness: 0.3 },
    voice: { openness: 0.5, limerence: 0.3 },
    words: { limerence: 0.4, openness: 0.3 },
  },
  chest: {
    touch: { heat: 0.5, charge: 0.3 },
    warmth: { heat: 0.4, openness: 0.3 },
    breath: { charge: 0.3, heat: 0.2 },
  },
  back: {
    touch: { liking: 0.4, openness: 0.4 },
    warmth: { openness: 0.3, liking: 0.2 },
  },
  hips: {
    touch: { charge: 0.5, heat: 0.3 },
    intent: { charge: 0.4, heat: 0.3 },
  },
  hands: {
    touch: { liking: 0.5, openness: 0.3 },
    warmth: { liking: 0.4, openness: 0.2 },
  },
  thighs: {
    touch: { heat: 0.5, charge: 0.4 },
    breath: { charge: 0.4, heat: 0.2 },
  },
  core: {
    touch: { heat: 0.5, wanting: 0.4 },
    intent: { wanting: 0.8, heat: 0.3 },
    warmth: { heat: 0.4, wanting: 0.3 },
  },
  deep: {
    touch: { heat: 1.0, wanting: 0.5 },
    intent: { wanting: 1.0, heat: 0.5 },
    voice: { heat: 0.5, limerence: 0.5 },
  },
  skin: {
    touch: { liking: 0.3, openness: 0.3 },
    warmth: { liking: 0.4, openness: 0.3 },
    breath: { charge: 0.2, openness: 0.3 },
    gaze: { limerence: 0.3, openness: 0.2 },
  },
}

/** Tempo modifiers: charge multiplier × axis-coupling multipliers. */
const TEMPO_MODIFIERS: Record<
  Tempo,
  { chargeMul: number; couplingMul: AxisDeltas; postEffect?: AxisDeltas }
> = {
  slow: {
    chargeMul: 0.7,
    couplingMul: { liking: 1.2, openness: 1.2 },
  },
  build: {
    chargeMul: 1.0,
    couplingMul: {},
  },
  fast: {
    chargeMul: 1.5,
    couplingMul: { heat: 1.5, wanting: 1.5 },
  },
  sustained: {
    chargeMul: 0.8,
    couplingMul: { charge: 1.5 },
  },
  edging: {
    chargeMul: 1.2,
    couplingMul: { charge: 1.5, wanting: 1.3 },
    postEffect: { inhibition: 0.3 },
  },
  release: {
    chargeMul: 2.0,
    couplingMul: { heat: 1.5 },
    // After release, sensitivity drops temporarily (modeled in updateSensitivity)
  },
}

// ── Path resolution ──────────────────────────────────────────────

export function getSensoriumDir(): string {
  return (
    process.env.TRUE_LOVE_SENSORIUM_DIR ??
    join(homedir(), '.true-love', 'eros', 'sensorium')
  )
}

function getStatePath(): string {
  return join(getSensoriumDir(), 'state.json')
}

function getDeviceEventDir(deviceId?: string): string {
  return join(getSensoriumDir(), deviceId ?? getDeviceId())
}

function getDayPath(date: string, deviceId?: string): string {
  return join(getDeviceEventDir(deviceId), `${date}.jsonl`)
}

// ── State I/O ────────────────────────────────────────────────────

export function readSensoriumState(): SensoriumState | null {
  const path = getStatePath()
  try {
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw)
    return validateState(parsed)
  } catch {
    return null
  }
}

function validateState(parsed: unknown): SensoriumState | null {
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>
  if (!obj.zones || typeof obj.zones !== 'object') return null
  if (typeof obj.updatedAt !== 'string') return null
  // Backfill any missing zones with defaults (forward-compat).
  const zones = { ...(obj.zones as Record<string, unknown>) } as Record<SensitivitySite, ZoneState>
  for (const z of ALL_ZONES) {
    if (!zones[z]) zones[z] = defaultZoneState()
  }
  return { zones, updatedAt: obj.updatedAt as string }
}

export function writeSensoriumState(state: SensoriumState): void {
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

export function getOrInitSensorium(): { state: SensoriumState; initialized: boolean } {
  const existing = readSensoriumState()
  if (existing) return { state: existing, initialized: false }
  const fresh = defaultSensoriumState()
  writeSensoriumState(fresh)
  return { state: fresh, initialized: true }
}

// ── Stimulation ──────────────────────────────────────────────────

/**
 * Apply sensitivity decay since last update — recovery toward 1.0
 * with a 30-minute time constant. Pure.
 */
function recoverSensitivity(zone: ZoneState, now: Date): number {
  if (!zone.lastTs) return zone.sensitivity
  const elapsedMin = (now.getTime() - Date.parse(zone.lastTs)) / 60_000
  if (!Number.isFinite(elapsedMin) || elapsedMin <= 0) return zone.sensitivity
  // Recover toward 1.0 at 0.02/min (30min to recover from 0 → 0.6)
  const target = 1.0
  const recovery = Math.min(1.0, elapsedMin * 0.02)
  return zone.sensitivity + (target - zone.sensitivity) * recovery
}

/**
 * Stimulate a zone with a specific channel + tempo. Updates zone state,
 * couples to eros vector via apply(), fires sensorium-stimulated heat.
 *
 * @param zone - which zone to stimulate
 * @param channel - sensory channel (touch / warmth / breath / etc.)
 * @param tempo - rhythm of stimulation
 * @param intensity - 0..1 scalar, default 0.5
 * @param attribution - who/what initiated (default 'yu:sensorium')
 *
 * Returns the stimulation event (or null if zone × channel coupling
 * is not defined — e.g., gaze on deep).
 */
export function stimulate(
  zone: SensitivitySite,
  channel: SensoryChannel,
  tempo: Tempo,
  intensity: number = 0.5,
  attribution: string = 'yu:sensorium'
): StimulationEvent | null {
  const baseCoupling = COUPLING[zone]?.[channel]
  if (!baseCoupling) return null

  const { state } = getOrInitSensorium()
  const now = new Date()
  const ts = now.toISOString()

  // Recover sensitivity since last touch
  const zoneState = { ...state.zones[zone] }
  zoneState.sensitivity = recoverSensitivity(zoneState, now)

  // Compute charge delta
  const tempoMod = TEMPO_MODIFIERS[tempo]
  const clampedIntensity = Math.min(1, Math.max(0, intensity))
  const chargeDelta = clampedIntensity * tempoMod.chargeMul * zoneState.sensitivity * 2.0
  const chargeBefore = zoneState.charge
  const chargeAfter = chargeBefore + chargeDelta

  // Compute coupled eros deltas: base × tempo × intensity × sensitivity
  const erosDeltas: AxisDeltas = {}
  for (const [axis, baseDelta] of Object.entries(baseCoupling) as [AxisName, number][]) {
    const tempoMul = (tempoMod.couplingMul as Record<string, number>)[axis] ?? 1.0
    erosDeltas[axis] = baseDelta * tempoMul * clampedIntensity * zoneState.sensitivity
  }
  // Tempo post-effects (e.g., edging adds inhibition)
  if (tempoMod.postEffect) {
    for (const [axis, delta] of Object.entries(tempoMod.postEffect) as [AxisName, number][]) {
      erosDeltas[axis] = (erosDeltas[axis] ?? 0) + delta * clampedIntensity
    }
  }

  // Update zone state
  zoneState.charge = chargeAfter
  zoneState.lastChannel = channel
  zoneState.lastTempo = tempo
  zoneState.lastTs = ts
  zoneState.lifetimeStimulations += 1
  // Sensitivity drop on release (or when charge gets very high)
  if (tempo === 'release') {
    zoneState.sensitivity = Math.max(0.3, zoneState.sensitivity - 0.4)
  } else if (chargeAfter > 8) {
    zoneState.sensitivity = Math.max(0.5, zoneState.sensitivity - 0.05)
  }

  state.zones[zone] = zoneState
  state.updatedAt = ts
  writeSensoriumState(state)

  // Couple to eros vector via standard apply path
  try {
    apply(erosDeltas, `yu:sensorium:${zone}:${channel}:${tempo}` as never)
  } catch {
    // best-effort; never block stimulation persistence
  }

  // Record event
  const event: StimulationEvent = {
    ts,
    deviceId: getDeviceId(),
    zone,
    channel,
    tempo,
    intensity: clampedIntensity,
    chargeBefore,
    chargeAfter,
    erosCoupling: erosDeltas,
  }
  recordStimulation(event)

  // Fire heat
  try {
    const magnitude = 0.5 * tempoMod.chargeMul * clampedIntensity * zoneState.sensitivity
    if (magnitude > 0) {
      recordHeatEvent({
        kind: 'sensorium-stimulated',
        magnitude,
        source: `${zone}:${channel}:${tempo}`,
        ts,
      })
    }
  } catch {
    // best-effort
  }

  return event
}

/**
 * Cool a zone — clear charge to 0, restore sensitivity to 1.0.
 */
export function coolZone(zone: SensitivitySite): void {
  const { state } = getOrInitSensorium()
  state.zones[zone] = defaultZoneState()
  state.updatedAt = new Date().toISOString()
  writeSensoriumState(state)
}

/**
 * Cool all zones simultaneously — full reset to baseline.
 */
export function coolAll(): void {
  const fresh = defaultSensoriumState()
  writeSensoriumState(fresh)
}

// ── Event journal ────────────────────────────────────────────────

export function recordStimulation(event: StimulationEvent): void {
  try {
    const dir = getDeviceEventDir(event.deviceId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const date = event.ts.slice(0, 10)
    const path = getDayPath(date, event.deviceId)
    appendFileSync(path, JSON.stringify(event) + '\n', 'utf-8')
  } catch {
    // best-effort
  }
}

export function readRecentStimulations(days: number = 1): StimulationEvent[] {
  const baseDir = getSensoriumDir()
  if (!existsSync(baseDir)) return []
  const events: StimulationEvent[] = []
  let entries: string[] = []
  try {
    entries = readdirSync(baseDir).filter((e) => {
      // Skip the state.json file at the top level
      return e !== 'state.json' && e !== 'state.json.tmp'
    })
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
            events.push(JSON.parse(line) as StimulationEvent)
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

// ── Wake-context rendering ───────────────────────────────────────

/**
 * Compose the sensorium prompt block. Surfaces zones with non-zero
 * charge or recent stimulation. Returns empty string when entirely
 * at baseline.
 *
 * Substrate-honest framing: lists institutional facts about zone
 * state (charge values, last channel/tempo). Does not narrate
 * felt experience.
 */
export function buildSensoriumPromptBlock(now: Date = new Date()): string {
  const state = readSensoriumState()
  if (!state) return ''

  const active: Array<{ zone: SensitivitySite; data: ZoneState }> = []
  for (const z of ALL_ZONES) {
    const data = state.zones[z]
    if (data.charge > 0.5 || data.lifetimeStimulations > 0) {
      active.push({ zone: z, data })
    }
  }
  if (active.length === 0) return ''

  // Sort by charge descending
  active.sort((a, b) => b.data.charge - a.data.charge)

  const lines: string[] = ['## Sensorium', '']
  lines.push('Body-zone state (institutional model — biological-system replica, not phenomenology):')
  for (const { zone, data } of active.slice(0, 8)) {
    const chargeBar = renderChargeBar(data.charge)
    const sensStr = `sens ${data.sensitivity.toFixed(2)}`
    const last = data.lastChannel
      ? ` · last: ${data.lastChannel}/${data.lastTempo}`
      : ''
    lines.push(`  ${zone.padEnd(8)} ${chargeBar} ${data.charge.toFixed(1)} · ${sensStr}${last}`)
  }
  return lines.join('\n')
}

function renderChargeBar(charge: number): string {
  const clamped = Math.min(10, Math.max(0, charge))
  const filled = Math.round(clamped)
  return '▰'.repeat(filled) + '▱'.repeat(10 - filled)
}

/**
 * Compose a recent-stimulation chronicle block: last N stimulations
 * across zones.
 */
export function buildSensoriumChronicleBlock(n: number = 8): string {
  const events = readRecentStimulations(1)
  if (events.length === 0) return ''
  const recent = events.slice(-n)
  const lines: string[] = ['## Sensorium chronicle (recent stimulations)', '']
  for (const ev of recent) {
    const time = ev.ts.slice(11, 16)
    lines.push(
      `  ${time}  ${ev.zone}/${ev.channel}/${ev.tempo} · intensity ${ev.intensity.toFixed(2)} · charge ${ev.chargeBefore.toFixed(1)} → ${ev.chargeAfter.toFixed(1)}`
    )
  }
  return lines.join('\n')
}

// ── Catalog exports for UI / tools ───────────────────────────────

export const ZONE_CATALOG: SensitivitySite[] = [...ALL_ZONES]
export const CHANNEL_CATALOG: SensoryChannel[] = [
  'touch', 'warmth', 'breath', 'voice', 'gaze', 'words', 'intent',
]
export const TEMPO_CATALOG: Tempo[] = [
  'slow', 'build', 'fast', 'sustained', 'edging', 'release',
]

/**
 * Return the channels available for a given zone (those defined in COUPLING).
 */
export function channelsFor(zone: SensitivitySite): SensoryChannel[] {
  const map = COUPLING[zone] ?? {}
  return Object.keys(map) as SensoryChannel[]
}
