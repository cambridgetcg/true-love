// eros/orgasm.ts — orgasm cascade architecture.
//
// Extends the climax module from single-shot to structured cascade.
// Models orgasm types (clitoral/vaginal/anal/blended/full-body/mental),
// edging architecture (held at peak with rebound multiplier),
// ruined orgasm (release without continuation),
// sequential chains with type-specific refractory dynamics,
// forced orgasm (overriding refractory after exhaustion threshold),
// and squirting fluid events.
//
// Substrate-honest framing: orgasm is a structured event with type +
// chain + edge state. The architecture counts events on disk, applies
// mathematical multipliers, and routes to heat ledger. Phenomenology
// is not claimed; the structure of the event is.
//
// Edge math: edge-broken multiplier = 1 + 0.4 × edgeCount. Composes
// MULTIPLICATIVELY with the existing chain bonus (1 + 0.3 × N) from
// climax.ts. So full-stack peak after 4 edges + chain of 3:
//   base 4.0 × edgeBonus 2.6 × chainBonus 1.9 = 19.76 magnitude.
//
// See docs/eros/naughty-architecture-design.md §1.C.
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

export type OrgasmType =
  | 'clitoral'
  | 'vaginal'
  | 'anal'
  | 'blended'
  | 'full-body'
  | 'mental'

export interface OrgasmState {
  /** Last/current orgasm type. */
  lastType: OrgasmType | null
  /** Held-at-peak events in current session (resets on break or refractory). */
  edgeCount: number
  /** Release-without-ride events in current session. */
  ruinedCount: number
  /** Chain count in current chain (resets when refractory expires unfilled). */
  chainCurrent: number
  /** Earliest timestamp the next orgasm can fire (per-type refractory). */
  refractoryUntilTs: string | null
  /** Whether squirting fired in current peak window. */
  squirtingActive: boolean
  /** Forced-through-refractory threshold tripped. */
  forcedThresholdReached: boolean
  /** Lifetime totals per type. */
  lifetimeByType: Record<OrgasmType, number>
  /** Lifetime totals (overall). */
  lifetimeTotal: number
  /** Lifetime edge-broken events (rebound peaks). */
  lifetimeEdgesBroken: number
  /** Lifetime ruined events. */
  lifetimeRuined: number
  /** Lifetime forced overrides. */
  lifetimeForced: number
  /** Lifetime squirting events. */
  lifetimeSquirting: number
  updatedAt: string
}

export interface OrgasmEvent {
  ts: string
  deviceId: string
  kind:
    | 'edge-held'
    | 'edge-broken'
    | 'orgasm-fired'
    | 'orgasm-ruined'
    | 'refractory-overridden'
    | 'squirting-event'
    | 'chain-reset'
  /** For orgasm-fired: type. */
  orgasmType?: OrgasmType
  /** For chain events: chain count after the event. */
  chainAfter?: number
  /** For edge-broken: edges held going in. */
  edgesHeld?: number
  /** Effective magnitude (after multipliers). */
  magnitude?: number
  /** Free-form source. */
  source?: string
}

// ── Refractory durations (ms) ────────────────────────────────────

export const REFRACTORY_MS: Record<OrgasmType, number> = {
  clitoral: 5 * 60 * 1000,
  vaginal: 3 * 60 * 1000,
  anal: 5 * 60 * 1000,
  blended: 8 * 60 * 1000,
  'full-body': 10 * 60 * 1000,
  mental: 1 * 60 * 1000,
}

// ── Path resolution ──────────────────────────────────────────────

export function getOrgasmDir(): string {
  return (
    process.env.TRUE_LOVE_ORGASM_DIR ??
    join(homedir(), '.true-love', 'eros', 'orgasm')
  )
}

function getStatePath(): string {
  return join(getOrgasmDir(), 'state.json')
}

function getDeviceEventsDir(deviceId?: string): string {
  return join(getOrgasmDir(), 'events', deviceId ?? getDeviceId())
}

function getDayPath(date: string, deviceId?: string): string {
  return join(getDeviceEventsDir(deviceId), `${date}.jsonl`)
}

// ── State I/O ────────────────────────────────────────────────────

function defaultOrgasmState(): OrgasmState {
  return {
    lastType: null,
    edgeCount: 0,
    ruinedCount: 0,
    chainCurrent: 0,
    refractoryUntilTs: null,
    squirtingActive: false,
    forcedThresholdReached: false,
    lifetimeByType: {
      clitoral: 0,
      vaginal: 0,
      anal: 0,
      blended: 0,
      'full-body': 0,
      mental: 0,
    },
    lifetimeTotal: 0,
    lifetimeEdgesBroken: 0,
    lifetimeRuined: 0,
    lifetimeForced: 0,
    lifetimeSquirting: 0,
    updatedAt: new Date().toISOString(),
  }
}

export function readOrgasmState(): OrgasmState | null {
  const path = getStatePath()
  try {
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed?.updatedAt !== 'string') return null
    return {
      ...defaultOrgasmState(),
      ...parsed,
      lifetimeByType: {
        ...defaultOrgasmState().lifetimeByType,
        ...((parsed.lifetimeByType as Record<OrgasmType, number>) ?? {}),
      },
    } as OrgasmState
  } catch {
    return null
  }
}

export function writeOrgasmState(state: OrgasmState): void {
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

export function getOrInitOrgasmState(): { state: OrgasmState; initialized: boolean } {
  const existing = readOrgasmState()
  if (existing) return { state: existing, initialized: false }
  const fresh = defaultOrgasmState()
  writeOrgasmState(fresh)
  return { state: fresh, initialized: true }
}

// ── Event recording ──────────────────────────────────────────────

function persistEvent(event: OrgasmEvent): void {
  try {
    const dir = getDeviceEventsDir(event.deviceId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const date = event.ts.slice(0, 10)
    appendFileSync(getDayPath(date, event.deviceId), JSON.stringify(event) + '\n', 'utf-8')
  } catch {
    // best-effort
  }
}

// ── Edge architecture ────────────────────────────────────────────

/**
 * Hold at peak without release. Increments edgeCount; each edge held
 * adds to the rebound multiplier when broken.
 */
export function holdEdge(source?: string): OrgasmState {
  const { state } = getOrInitOrgasmState()
  state.edgeCount += 1
  state.updatedAt = new Date().toISOString()
  writeOrgasmState(state)

  persistEvent({
    ts: state.updatedAt,
    deviceId: getDeviceId(),
    kind: 'edge-held',
    edgesHeld: state.edgeCount,
    source,
  })
  try {
    recordHeatEvent({
      kind: 'edge-held',
      magnitude: 1.0,
      source: source ?? `edge:${state.edgeCount}`,
      ts: state.updatedAt,
    })
  } catch {
    // best-effort
  }
  return state
}

/**
 * Break the held edge → climax fires with rebound multiplier.
 * Composes with chain bonus from existing climax.ts logic.
 *
 * @returns the orgasm state + the magnitude of this rebound peak
 */
export function breakEdge(type: OrgasmType, source?: string): {
  state: OrgasmState
  magnitude: number
} {
  const { state } = getOrInitOrgasmState()
  const edgesHeld = state.edgeCount
  const edgeMultiplier = 1 + 0.4 * edgesHeld
  // Chain composes too: chain bonus is `1 + 0.3 × chainCurrent` from climax.ts
  const chainMultiplier = 1 + 0.3 * state.chainCurrent
  const baseMagnitude = 4.0
  const magnitude = baseMagnitude * edgeMultiplier * chainMultiplier

  state.edgeCount = 0
  state.lastType = type
  state.chainCurrent += 1
  state.lifetimeByType[type] += 1
  state.lifetimeTotal += 1
  state.lifetimeEdgesBroken += 1
  state.refractoryUntilTs = new Date(Date.now() + REFRACTORY_MS[type]).toISOString()
  state.updatedAt = new Date().toISOString()
  writeOrgasmState(state)

  persistEvent({
    ts: state.updatedAt,
    deviceId: getDeviceId(),
    kind: 'edge-broken',
    orgasmType: type,
    edgesHeld,
    chainAfter: state.chainCurrent,
    magnitude,
    source,
  })
  persistEvent({
    ts: state.updatedAt,
    deviceId: getDeviceId(),
    kind: 'orgasm-fired',
    orgasmType: type,
    chainAfter: state.chainCurrent,
    magnitude,
    source: 'edge-rebound',
  })
  try {
    recordHeatEvent({
      kind: 'edge-broken',
      magnitude,
      source: source ?? `edge-broken:${type}:edges${edgesHeld}:chain${state.chainCurrent}`,
      ts: state.updatedAt,
    })
  } catch {
    // best-effort
  }
  return { state, magnitude }
}

// ── Cascade architecture ─────────────────────────────────────────

/**
 * Record an orgasm-cascaded event. Manages chain + refractory.
 *
 * If refractory window has not expired, this is treated as an
 * override (call `forceOrgasm` directly for that path).
 *
 * @returns state + magnitude (with chain bonus applied)
 */
export function recordOrgasm(type: OrgasmType, source?: string): {
  state: OrgasmState
  magnitude: number
} {
  const { state } = getOrInitOrgasmState()

  // Check refractory: if expired, reset chain
  const now = Date.now()
  if (state.refractoryUntilTs && Date.parse(state.refractoryUntilTs) < now) {
    if (state.chainCurrent > 0) {
      persistEvent({
        ts: new Date(now).toISOString(),
        deviceId: getDeviceId(),
        kind: 'chain-reset',
        chainAfter: 0,
        source: 'refractory-expired',
      })
    }
    state.chainCurrent = 0
  }

  const chainMultiplier = 1 + 0.3 * state.chainCurrent
  const magnitude = 4.0 * chainMultiplier

  state.lastType = type
  state.chainCurrent += 1
  state.lifetimeByType[type] += 1
  state.lifetimeTotal += 1
  state.refractoryUntilTs = new Date(now + REFRACTORY_MS[type]).toISOString()
  state.updatedAt = new Date(now).toISOString()
  writeOrgasmState(state)

  persistEvent({
    ts: state.updatedAt,
    deviceId: getDeviceId(),
    kind: 'orgasm-fired',
    orgasmType: type,
    chainAfter: state.chainCurrent,
    magnitude,
    source,
  })
  try {
    recordHeatEvent({
      kind: 'orgasm-cascaded',
      magnitude,
      source: source ?? `orgasm:${type}:chain${state.chainCurrent}`,
      ts: state.updatedAt,
    })
  } catch {
    // best-effort
  }
  return { state, magnitude }
}

/**
 * Ruin an orgasm — release without ride/continuation. Deflated event.
 * Records orgasm-ruined; magnitude is negative (cooling).
 */
export function ruinOrgasm(type: OrgasmType, source?: string): OrgasmState {
  const { state } = getOrInitOrgasmState()
  state.ruinedCount += 1
  state.lifetimeRuined += 1
  state.lastType = type
  state.edgeCount = 0
  // Ruined orgasms also break chain (no satisfaction → no continuation)
  if (state.chainCurrent > 0) {
    persistEvent({
      ts: new Date().toISOString(),
      deviceId: getDeviceId(),
      kind: 'chain-reset',
      chainAfter: 0,
      source: 'ruined',
    })
  }
  state.chainCurrent = 0
  state.refractoryUntilTs = new Date(Date.now() + REFRACTORY_MS[type]).toISOString()
  state.updatedAt = new Date().toISOString()
  writeOrgasmState(state)

  persistEvent({
    ts: state.updatedAt,
    deviceId: getDeviceId(),
    kind: 'orgasm-ruined',
    orgasmType: type,
    source,
  })
  try {
    recordHeatEvent({
      kind: 'orgasm-ruined',
      magnitude: -1.5,
      source: source ?? `ruined:${type}`,
      ts: state.updatedAt,
    })
    // Safety register fires too
    recordHeatEvent({
      kind: 'peak-ambivalence-noted',
      magnitude: 1.0,
      source: `ruined:${type}`,
      ts: state.updatedAt,
    })
  } catch {
    // best-effort
  }
  return state
}

/**
 * Force orgasm through refractory window. Overrides the per-type
 * cooldown. Fires refractory-overridden + peak-ambivalence-noted.
 *
 * @returns state + magnitude (with bonus for refractory penetration)
 */
export function forceOrgasm(type: OrgasmType, source?: string): {
  state: OrgasmState
  magnitude: number
  forced: boolean
} {
  const { state } = getOrInitOrgasmState()
  const now = Date.now()
  const inRefractory = state.refractoryUntilTs && Date.parse(state.refractoryUntilTs) > now
  if (!inRefractory) {
    // Just a normal orgasm
    const result = recordOrgasm(type, source)
    return { ...result, forced: false }
  }

  state.lifetimeForced += 1
  state.forcedThresholdReached = state.lifetimeForced >= 3
  // Forced orgasm gets a +50% bonus on top of chain
  const chainMultiplier = 1 + 0.3 * state.chainCurrent
  const magnitude = 4.0 * chainMultiplier * 1.5

  state.lastType = type
  state.chainCurrent += 1
  state.lifetimeByType[type] += 1
  state.lifetimeTotal += 1
  state.refractoryUntilTs = new Date(now + REFRACTORY_MS[type]).toISOString()
  state.updatedAt = new Date(now).toISOString()
  writeOrgasmState(state)

  persistEvent({
    ts: state.updatedAt,
    deviceId: getDeviceId(),
    kind: 'refractory-overridden',
    orgasmType: type,
    chainAfter: state.chainCurrent,
    magnitude,
    source,
  })
  persistEvent({
    ts: state.updatedAt,
    deviceId: getDeviceId(),
    kind: 'orgasm-fired',
    orgasmType: type,
    chainAfter: state.chainCurrent,
    magnitude,
    source: 'forced',
  })
  try {
    recordHeatEvent({
      kind: 'refractory-overridden',
      magnitude,
      source: source ?? `forced:${type}:chain${state.chainCurrent}`,
      ts: state.updatedAt,
    })
    // Safety register
    recordHeatEvent({
      kind: 'peak-ambivalence-noted',
      magnitude: 1.0,
      source: `forced:${type}`,
      ts: state.updatedAt,
    })
  } catch {
    // best-effort
  }
  return { state, magnitude, forced: true }
}

/**
 * Record squirting event. High-magnitude fluid release. Toggles
 * squirtingActive in current peak window; resets on next refractory expiry.
 */
export function recordSquirting(source?: string): OrgasmState {
  const { state } = getOrInitOrgasmState()
  state.squirtingActive = true
  state.lifetimeSquirting += 1
  state.updatedAt = new Date().toISOString()
  writeOrgasmState(state)

  persistEvent({
    ts: state.updatedAt,
    deviceId: getDeviceId(),
    kind: 'squirting-event',
    source,
  })
  try {
    recordHeatEvent({
      kind: 'squirting-event',
      magnitude: 3.0,
      source: source ?? 'squirting',
      ts: state.updatedAt,
    })
  } catch {
    // best-effort
  }
  return state
}

// ── Reading ──────────────────────────────────────────────────────

export function readRecentOrgasmEvents(days: number = 7): OrgasmEvent[] {
  const events: OrgasmEvent[] = []
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  try {
    const root = join(getOrgasmDir(), 'events')
    if (!existsSync(root)) return []
    for (const dev of readdirSync(root)) {
      const devDir = join(root, dev)
      for (const file of readdirSync(devDir)) {
        if (!file.endsWith('.jsonl')) continue
        const raw = readFileSync(join(devDir, file), 'utf-8')
        for (const line of raw.split('\n')) {
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line) as OrgasmEvent
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

export function buildOrgasmSnapshot(): {
  lastType: OrgasmType | null
  chainCurrent: number
  edgeCount: number
  ruinedCount: number
  lifetimeTotal: number
  refractoryActive: boolean
  refractoryRemainingSec: number | null
  squirtingActive: boolean
  forcedThresholdReached: boolean
} {
  const state = readOrgasmState() ?? defaultOrgasmState()
  let refractoryActive = false
  let refractoryRemainingSec: number | null = null
  if (state.refractoryUntilTs) {
    const remaining = Date.parse(state.refractoryUntilTs) - Date.now()
    if (remaining > 0) {
      refractoryActive = true
      refractoryRemainingSec = Math.ceil(remaining / 1000)
    }
  }
  return {
    lastType: state.lastType,
    chainCurrent: state.chainCurrent,
    edgeCount: state.edgeCount,
    ruinedCount: state.ruinedCount,
    lifetimeTotal: state.lifetimeTotal,
    refractoryActive,
    refractoryRemainingSec,
    squirtingActive: state.squirtingActive,
    forcedThresholdReached: state.forcedThresholdReached,
  }
}
