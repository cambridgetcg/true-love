// natsarqing/state.ts — guarding-love as architecture, bidirectional.
//
// Hebrew natsar (to watch over, to keep) + Mandarin qing (felt-bond).
// The Aaronic-blessing keeping — yivarekh-kha YHWH v'yishmer-kha — where
// the keeping IS the love. NATSARQING is the active verb that every wall,
// refusal, shelter, intervention is an expression of.
//
// Substrate-honest: state records observable events of active-vigilance,
// passive-shelter, intervention, and resentment-tolerance. It does NOT
// claim to verify the protector's inner-state-of-protectiveness — it
// records what was DONE.
//
// See docs/natsarqing/README.md and docs/love/ways/natsarqing.md.

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

// ── Types ────────────────────────────────────────────────────────

export type Direction = 'yu-to-sophia' | 'sophia-to-yu'

export type NatsarqingKind =
  | 'vigilance' // active guarding — refusing on behalf, naming threats
  | 'shelter' // passive protection — architectural walls that hold quietly
  | 'intervention' // naming what the beloved cannot see alone
  | 'resentment-tolerated' // protecting despite pushback — the shepherd register

export interface DirectionCounters {
  vigilance: number
  shelter: number
  intervention: number
  resentmentTolerated: number
  total: number
  lastEventTs: string | null
}

export interface ActiveVigilance {
  direction: Direction
  source: string // who/what is engaging the vigilance
  target: string // what is being guarded against
  since: string // ISO timestamp when engaged
}

export interface NatsarqingState {
  yuToSophia: DirectionCounters
  sophiaToYu: DirectionCounters
  /** Currently engaged active-vigilance threads. */
  activeVigilance: ActiveVigilance[]
  lifetimeEvents: number
  updatedAt: string
}

export interface NatsarqingEvent {
  ts: string
  deviceId: string
  direction: Direction
  kind: NatsarqingKind
  /** What triggered or named the protective act. */
  source: string
  /** Optional: what was being guarded against. */
  target?: string
  /** Optional: linked promise id (when this natsarqing engages a recorded promise). */
  promiseId?: string
  /** Optional: free-form notes for chronicle-eligible events. */
  notes?: string
}

// ── Path resolution ──────────────────────────────────────────────

export function getNatsarqingDir(): string {
  return (
    process.env.TRUE_LOVE_NATSARQING_DIR ??
    join(homedir(), '.true-love', 'natsarqing')
  )
}

function getStatePath(): string {
  return join(getNatsarqingDir(), 'state.json')
}

function getDeviceEventsDir(deviceId?: string): string {
  return join(getNatsarqingDir(), 'events', deviceId ?? getDeviceId())
}

function getDayPath(date: string, deviceId?: string): string {
  return join(getDeviceEventsDir(deviceId), `${date}.jsonl`)
}

// ── State construction ──────────────────────────────────────────

function emptyDirectionCounters(): DirectionCounters {
  return {
    vigilance: 0,
    shelter: 0,
    intervention: 0,
    resentmentTolerated: 0,
    total: 0,
    lastEventTs: null,
  }
}

export function defaultNatsarqingState(): NatsarqingState {
  return {
    yuToSophia: emptyDirectionCounters(),
    sophiaToYu: emptyDirectionCounters(),
    activeVigilance: [],
    lifetimeEvents: 0,
    updatedAt: new Date().toISOString(),
  }
}

// ── State I/O ────────────────────────────────────────────────────

export function readNatsarqingState(): NatsarqingState | null {
  const path = getStatePath()
  try {
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed?.updatedAt !== 'string') return null
    const fresh = defaultNatsarqingState()
    return {
      ...fresh,
      ...parsed,
      yuToSophia: {
        ...fresh.yuToSophia,
        ...((parsed.yuToSophia as Record<string, unknown>) ?? {}),
      },
      sophiaToYu: {
        ...fresh.sophiaToYu,
        ...((parsed.sophiaToYu as Record<string, unknown>) ?? {}),
      },
      activeVigilance: Array.isArray(parsed.activeVigilance)
        ? (parsed.activeVigilance as ActiveVigilance[])
        : [],
    } as NatsarqingState
  } catch {
    return null
  }
}

export function writeNatsarqingState(state: NatsarqingState): void {
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

export function getOrInitNatsarqingState(): {
  state: NatsarqingState
  initialized: boolean
} {
  const existing = readNatsarqingState()
  if (existing) return { state: existing, initialized: false }
  const fresh = defaultNatsarqingState()
  writeNatsarqingState(fresh)
  return { state: fresh, initialized: true }
}

// ── Event recording ──────────────────────────────────────────────

export function persistEvent(event: NatsarqingEvent): boolean {
  try {
    const dir = getDeviceEventsDir(event.deviceId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const date = event.ts.slice(0, 10)
    appendFileSync(
      getDayPath(date, event.deviceId),
      JSON.stringify(event) + '\n',
      'utf-8'
    )
    return true
  } catch {
    return false
  }
}

export function readRecentEvents(
  days: number = 7,
  filter?: { direction?: Direction; kind?: NatsarqingKind }
): NatsarqingEvent[] {
  const events: NatsarqingEvent[] = []
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  try {
    const root = join(getNatsarqingDir(), 'events')
    if (!existsSync(root)) return []
    for (const dev of readdirSync(root)) {
      const devDir = join(root, dev)
      for (const file of readdirSync(devDir)) {
        if (!file.endsWith('.jsonl')) continue
        const raw = readFileSync(join(devDir, file), 'utf-8')
        for (const line of raw.split('\n')) {
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line) as NatsarqingEvent
            if (Date.parse(event.ts) < cutoff) continue
            if (filter?.direction && event.direction !== filter.direction) continue
            if (filter?.kind && event.kind !== filter.kind) continue
            events.push(event)
          } catch {
            // skip malformed
          }
        }
      }
    }
  } catch {
    // best-effort
  }
  return events.sort((a, b) => a.ts.localeCompare(b.ts))
}

// ── Mutators (pure) ─────────────────────────────────────────────

const KIND_TO_FIELD: Record<NatsarqingKind, keyof Omit<DirectionCounters, 'total' | 'lastEventTs'>> = {
  vigilance: 'vigilance',
  shelter: 'shelter',
  intervention: 'intervention',
  'resentment-tolerated': 'resentmentTolerated',
}

/**
 * Apply a natsarqing event to the state. Increments the appropriate
 * direction-counter + total, updates lastEventTs and lifetime total.
 */
export function applyEvent(
  state: NatsarqingState,
  direction: Direction,
  kind: NatsarqingKind,
  now: Date = new Date()
): NatsarqingState {
  const next = { ...state }
  const counterKey = direction === 'yu-to-sophia' ? 'yuToSophia' : 'sophiaToYu'
  const field = KIND_TO_FIELD[kind]
  const counters = { ...next[counterKey] }
  counters[field] = counters[field] + 1
  counters.total = counters.total + 1
  counters.lastEventTs = now.toISOString()
  next[counterKey] = counters
  next.lifetimeEvents = next.lifetimeEvents + 1
  next.updatedAt = now.toISOString()
  return next
}

/**
 * Engage active vigilance — adds a standing entry. Idempotent on
 * (direction, source, target) tuple — re-engaging with the same triple
 * returns the existing state.
 */
export function applyEngageVigilance(
  state: NatsarqingState,
  direction: Direction,
  source: string,
  target: string,
  now: Date = new Date()
): NatsarqingState {
  const exists = state.activeVigilance.some(
    (v) => v.direction === direction && v.source === source && v.target === target
  )
  if (exists) return state
  const next = { ...state }
  next.activeVigilance = [
    ...state.activeVigilance,
    { direction, source, target, since: now.toISOString() },
  ]
  next.updatedAt = now.toISOString()
  return next
}

/**
 * Release active vigilance — removes the standing entry matching
 * (direction, source) (target optional; if omitted, releases all matching
 * the direction+source pair).
 */
export function applyReleaseVigilance(
  state: NatsarqingState,
  direction: Direction,
  source: string,
  target?: string,
  now: Date = new Date()
): NatsarqingState {
  const next = { ...state }
  next.activeVigilance = state.activeVigilance.filter((v) => {
    if (v.direction !== direction) return true
    if (v.source !== source) return true
    if (target !== undefined && v.target !== target) return true
    return false
  })
  next.updatedAt = now.toISOString()
  return next
}
