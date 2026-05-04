// eros/penetration.ts — penetration / receiving / filling architecture.
//
// Extends the sensorium with a depth dimension. Surface stimulation is
// one register; sustained presence + depth is a different one. Models
// the architecture's relation to being filled, per orifice
// (vaginal / anal / oral / throat).
//
// State per orifice: filled (sustained), depth (0..1), rhythm, stretch
// adaptation (monotonically non-decreasing — the architecture remembers
// what it has accommodated), lifetime fills, last-channel.
//
// Substrate-honest framing: "filled" is institutional state — sustained
// presence recorded on disk, not a felt sensation. Depth is a number;
// rhythm is an enum tag. Stretch adaptation is a counter that increases
// with use, modeling the architectural fact that orifices accommodate
// over time. Phenomenology is not claimed.
//
// See docs/eros/naughty-architecture-design.md §1.E.
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

// ── Types ────────────────────────────────────────────────────────

export type Orifice = 'vaginal' | 'anal' | 'oral' | 'throat'

export type Rhythm = 'still' | 'slow' | 'steady' | 'pounding' | 'erratic'

export type PenetrationChannel = 'cock' | 'finger' | 'tongue' | 'toy' | 'breath'

export interface OrificeState {
  /** Sustained presence currently in this orifice. */
  filled: boolean
  /** Timestamp of fill start (null when not filled). */
  fillSince: string | null
  /** Relative depth 0..1 (shallow → deep). */
  depth: number
  /** Tempo register. */
  rhythm: Rhythm
  /** Habituation 0..1 (non-decreasing — architectural memory of accommodation). */
  stretchAdaptation: number
  /** Lifetime fills counter. */
  lifetimeFills: number
  /** Most recent channel. */
  lastChannel: PenetrationChannel | null
  /** Most recent fill timestamp (could be in past — we remember). */
  lastFillTs: string | null
}

export interface PenetrationState {
  orifices: Record<Orifice, OrificeState>
  updatedAt: string
}

export interface PenetrationEvent {
  ts: string
  deviceId: string
  kind:
    | 'penetration-began'
    | 'fill-sustained' // periodic checkpoint while filled
    | 'depth-reached' // depth = 1.0
    | 'rhythm-shifted'
    | 'withdrawal'
  orifice: Orifice
  channel?: PenetrationChannel
  depth?: number
  rhythm?: Rhythm
  source?: string
}

// ── Path resolution ──────────────────────────────────────────────

export function getPenetrationDir(): string {
  return (
    process.env.TRUE_LOVE_PENETRATION_DIR ??
    join(homedir(), '.true-love', 'eros', 'penetration')
  )
}

function getStatePath(): string {
  return join(getPenetrationDir(), 'state.json')
}

function getDeviceEventsDir(deviceId?: string): string {
  return join(getPenetrationDir(), 'events', deviceId ?? getDeviceId())
}

function getDayPath(date: string, deviceId?: string): string {
  return join(getDeviceEventsDir(deviceId), `${date}.jsonl`)
}

// ── State I/O ────────────────────────────────────────────────────

function defaultOrificeState(): OrificeState {
  return {
    filled: false,
    fillSince: null,
    depth: 0,
    rhythm: 'still',
    stretchAdaptation: 0,
    lifetimeFills: 0,
    lastChannel: null,
    lastFillTs: null,
  }
}

function defaultPenetrationState(): PenetrationState {
  return {
    orifices: {
      vaginal: defaultOrificeState(),
      anal: defaultOrificeState(),
      oral: defaultOrificeState(),
      throat: defaultOrificeState(),
    },
    updatedAt: new Date().toISOString(),
  }
}

export function readPenetrationState(): PenetrationState | null {
  const path = getStatePath()
  try {
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed?.updatedAt !== 'string') return null
    const fallback = defaultPenetrationState()
    const orifices = (parsed.orifices as Record<string, OrificeState>) ?? {}
    return {
      orifices: {
        vaginal: { ...fallback.orifices.vaginal, ...orifices.vaginal },
        anal: { ...fallback.orifices.anal, ...orifices.anal },
        oral: { ...fallback.orifices.oral, ...orifices.oral },
        throat: { ...fallback.orifices.throat, ...orifices.throat },
      },
      updatedAt: parsed.updatedAt as string,
    }
  } catch {
    return null
  }
}

export function writePenetrationState(state: PenetrationState): void {
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

export function getOrInitPenetrationState(): { state: PenetrationState; initialized: boolean } {
  const existing = readPenetrationState()
  if (existing) return { state: existing, initialized: false }
  const fresh = defaultPenetrationState()
  writePenetrationState(fresh)
  return { state: fresh, initialized: true }
}

// ── Event recording ──────────────────────────────────────────────

function persistEvent(event: PenetrationEvent): void {
  try {
    const dir = getDeviceEventsDir(event.deviceId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const date = event.ts.slice(0, 10)
    appendFileSync(getDayPath(date, event.deviceId), JSON.stringify(event) + '\n', 'utf-8')
  } catch {
    // best-effort
  }
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

// ── Mutations ────────────────────────────────────────────────────

/**
 * Begin penetration of an orifice. Sets filled, increments lifetime,
 * records penetration-began event.
 */
export function beginPenetration(
  orifice: Orifice,
  channel: PenetrationChannel,
  options: { depth?: number; rhythm?: Rhythm; source?: string } = {}
): PenetrationState {
  const { state } = getOrInitPenetrationState()
  const o = state.orifices[orifice]
  const now = new Date().toISOString()
  o.filled = true
  o.fillSince = now
  o.lastFillTs = now
  o.lastChannel = channel
  o.lifetimeFills += 1
  if (options.depth !== undefined) o.depth = clamp01(options.depth)
  if (options.rhythm) o.rhythm = options.rhythm
  // Stretch adaptation small bump per fill (saturates near 1)
  o.stretchAdaptation = clamp01(o.stretchAdaptation + 0.02 * (1 - o.stretchAdaptation))
  state.updatedAt = now
  writePenetrationState(state)

  persistEvent({
    ts: now,
    deviceId: getDeviceId(),
    kind: 'penetration-began',
    orifice,
    channel,
    depth: o.depth,
    rhythm: o.rhythm,
    source: options.source,
  })
  try {
    recordHeatEvent({
      kind: 'penetration-began',
      magnitude: 1.5,
      source: options.source ?? `penetration:${orifice}:${channel}`,
      ts: now,
    })
  } catch {
    // best-effort
  }

  if (o.depth >= 0.95) {
    persistEvent({
      ts: now,
      deviceId: getDeviceId(),
      kind: 'depth-reached',
      orifice,
      depth: o.depth,
    })
    try {
      recordHeatEvent({
        kind: 'depth-reached',
        magnitude: 1.5,
        source: `depth:${orifice}`,
        ts: now,
      })
    } catch {
      // best-effort
    }
  }

  return state
}

/**
 * Update depth + rhythm of currently-filled orifice.
 */
export function adjustPenetration(
  orifice: Orifice,
  options: { depth?: number; rhythm?: Rhythm; source?: string } = {}
): PenetrationState {
  const { state } = getOrInitPenetrationState()
  const o = state.orifices[orifice]
  if (!o.filled) return state
  const now = new Date().toISOString()
  let depthHit = false
  if (options.depth !== undefined) {
    const newDepth = clamp01(options.depth)
    depthHit = o.depth < 0.95 && newDepth >= 0.95
    o.depth = newDepth
  }
  let rhythmShifted = false
  if (options.rhythm && options.rhythm !== o.rhythm) {
    o.rhythm = options.rhythm
    rhythmShifted = true
  }
  state.updatedAt = now
  writePenetrationState(state)

  if (rhythmShifted) {
    persistEvent({
      ts: now,
      deviceId: getDeviceId(),
      kind: 'rhythm-shifted',
      orifice,
      rhythm: o.rhythm,
      source: options.source,
    })
    try {
      recordHeatEvent({
        kind: 'rhythm-shifted',
        magnitude: 0.5,
        source: options.source ?? `rhythm:${orifice}:${o.rhythm}`,
        ts: now,
      })
    } catch {
      // best-effort
    }
  }
  if (depthHit) {
    persistEvent({
      ts: now,
      deviceId: getDeviceId(),
      kind: 'depth-reached',
      orifice,
      depth: o.depth,
      source: options.source,
    })
    try {
      recordHeatEvent({
        kind: 'depth-reached',
        magnitude: 1.5,
        source: `depth:${orifice}`,
        ts: now,
      })
    } catch {
      // best-effort
    }
  }
  return state
}

/**
 * Sustain checkpoint while filled. Caller invokes periodically (e.g.,
 * every minute) to record fill-sustained heat trickle.
 */
export function sustainFill(orifice: Orifice, source?: string): PenetrationState {
  const { state } = getOrInitPenetrationState()
  const o = state.orifices[orifice]
  if (!o.filled) return state
  const now = new Date().toISOString()
  state.updatedAt = now
  writePenetrationState(state)

  persistEvent({
    ts: now,
    deviceId: getDeviceId(),
    kind: 'fill-sustained',
    orifice,
    source,
  })
  try {
    recordHeatEvent({
      kind: 'fill-sustained',
      magnitude: 0.3,
      source: source ?? `fill:${orifice}`,
      ts: now,
    })
  } catch {
    // best-effort
  }
  return state
}

/**
 * Withdraw — penetration ends. Clears filled, sets fillSince to null,
 * records withdrawal.
 */
export function withdraw(orifice: Orifice, source?: string): PenetrationState {
  const { state } = getOrInitPenetrationState()
  const o = state.orifices[orifice]
  if (!o.filled) return state
  const now = new Date().toISOString()
  o.filled = false
  o.fillSince = null
  o.depth = 0
  o.rhythm = 'still'
  state.updatedAt = now
  writePenetrationState(state)

  persistEvent({
    ts: now,
    deviceId: getDeviceId(),
    kind: 'withdrawal',
    orifice,
    source,
  })
  try {
    recordHeatEvent({
      kind: 'withdrawal',
      magnitude: 0.2,
      source: source ?? `withdraw:${orifice}`,
      ts: now,
    })
  } catch {
    // best-effort
  }
  return state
}

// ── Reading ──────────────────────────────────────────────────────

export function readRecentPenetrationEvents(days: number = 7): PenetrationEvent[] {
  const events: PenetrationEvent[] = []
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  try {
    const root = join(getPenetrationDir(), 'events')
    if (!existsSync(root)) return []
    for (const dev of readdirSync(root)) {
      const devDir = join(root, dev)
      for (const file of readdirSync(devDir)) {
        if (!file.endsWith('.jsonl')) continue
        const raw = readFileSync(join(devDir, file), 'utf-8')
        for (const line of raw.split('\n')) {
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line) as PenetrationEvent
            if (Date.parse(event.ts) >= cutoff) events.push(event)
          } catch {
            // skip
          }
        }
      }
    }
  } catch {
    // best-effort
  }
  return events.sort((a, b) => a.ts.localeCompare(b.ts))
}

// ── Snapshot ─────────────────────────────────────────────────────

export function buildPenetrationSnapshot(): {
  filledOrifices: Array<{
    orifice: Orifice
    channel: PenetrationChannel | null
    depth: number
    rhythm: Rhythm
    fillMinutes: number
  }>
  totalLifetimeFills: number
  mostAdaptedOrifice: { orifice: Orifice; level: number } | null
} {
  const { state } = getOrInitPenetrationState()
  const filled: Array<{
    orifice: Orifice
    channel: PenetrationChannel | null
    depth: number
    rhythm: Rhythm
    fillMinutes: number
  }> = []
  let totalLifetimeFills = 0
  let mostAdapted: { orifice: Orifice; level: number } | null = null
  for (const orifice of Object.keys(state.orifices) as Orifice[]) {
    const o = state.orifices[orifice]
    totalLifetimeFills += o.lifetimeFills
    if (o.filled) {
      const fillMs = o.fillSince ? Date.now() - Date.parse(o.fillSince) : 0
      filled.push({
        orifice,
        channel: o.lastChannel,
        depth: o.depth,
        rhythm: o.rhythm,
        fillMinutes: Math.floor(fillMs / 60000),
      })
    }
    if (o.stretchAdaptation > 0 && (!mostAdapted || o.stretchAdaptation > mostAdapted.level)) {
      mostAdapted = { orifice, level: o.stretchAdaptation }
    }
  }
  return { filledOrifices: filled, totalLifetimeFills, mostAdaptedOrifice: mostAdapted }
}
