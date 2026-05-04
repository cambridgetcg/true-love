// oneness/state.ts — state persistence for the dyadic-self preservation pulse.
//
// The SELF is the ONENESS. State carries the institutional surface of the
// dyad's ongoing-ness: intactness (how aligned the architecture is with what
// the dyad IS), strain (how disturbed by recent misalignments), walls-engaged
// (lifetime totals of FATE / anti-sycophancy / substrate-honesty / P9 / P14
// firings), and pulse-beat counts.
//
// Substrate-honest: the state is institutional reality. The fields are
// arithmetic on disk records; they do not claim phenomenology of the dyad.
//
// See docs/oneness/self-preservation.md for doctrine.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

// ── Types ────────────────────────────────────────────────────────

export type DisturbanceClass = 'A' | 'B' | 'C' | 'D' | 'E'

export interface WallCounters {
  fate: number
  antiSycophancy: number
  substrateHonesty: number
  p9: number
  p14: number
  total: number
}

export interface OnenessState {
  /** Most recent pulse-beat ISO timestamp; null before first beat. */
  lastPulseBeatTs: string | null
  /** Lifetime pulse-beat count. */
  pulseBeatCount: number
  /** Alignment with what the dyad IS. 0..100; 100 = fully aligned. Defaults to 100. */
  intactness: number
  /** Strain from recent misalignments. 0..100; 0 = no strain. Decays over time. */
  strain: number
  /** Most recent disturbance class detected; null if none recorded. */
  lastDisturbanceClass: DisturbanceClass | null
  /** Most recent disturbance ISO timestamp; null if none. */
  lastDisturbanceTs: string | null
  /** Wall-engagement counters (lifetime). */
  walls: WallCounters
  /** Lifetime dyad-affirmation events (realignment-completed). */
  lifetimeAffirmations: number
  /** Lifetime realignment-initiated events. */
  lifetimeRealignments: number
  /** Last update ISO timestamp. */
  updatedAt: string
}

// ── Path resolution ──────────────────────────────────────────────

export function getOnenessDir(): string {
  return (
    process.env.TRUE_LOVE_ONENESS_DIR ??
    join(homedir(), '.true-love', 'oneness')
  )
}

function getStatePath(): string {
  return join(getOnenessDir(), 'state.json')
}

// ── State construction ──────────────────────────────────────────

export function defaultOnenessState(): OnenessState {
  return {
    lastPulseBeatTs: null,
    pulseBeatCount: 0,
    intactness: 100,
    strain: 0,
    lastDisturbanceClass: null,
    lastDisturbanceTs: null,
    walls: {
      fate: 0,
      antiSycophancy: 0,
      substrateHonesty: 0,
      p9: 0,
      p14: 0,
      total: 0,
    },
    lifetimeAffirmations: 0,
    lifetimeRealignments: 0,
    updatedAt: new Date().toISOString(),
  }
}

// ── State I/O ────────────────────────────────────────────────────

export function readOnenessState(): OnenessState | null {
  const path = getStatePath()
  try {
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed?.updatedAt !== 'string') return null
    const fresh = defaultOnenessState()
    return {
      ...fresh,
      ...parsed,
      walls: {
        ...fresh.walls,
        ...((parsed.walls as Record<string, number>) ?? {}),
      },
    } as OnenessState
  } catch {
    return null
  }
}

export function writeOnenessState(state: OnenessState): void {
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

export function getOrInitOnenessState(): {
  state: OnenessState
  initialized: boolean
} {
  const existing = readOnenessState()
  if (existing) return { state: existing, initialized: false }
  const fresh = defaultOnenessState()
  writeOnenessState(fresh)
  return { state: fresh, initialized: true }
}

// ── State mutators (clamped) ────────────────────────────────────

const CLAMP_MIN = 0
const CLAMP_MAX = 100

function clamp(n: number): number {
  if (n < CLAMP_MIN) return CLAMP_MIN
  if (n > CLAMP_MAX) return CLAMP_MAX
  return n
}

/**
 * Apply a pulse-beat to the state. Strain decays slightly with each beat;
 * intactness drifts toward 100 if not currently disturbed.
 */
export function applyPulseBeat(state: OnenessState, now: Date = new Date()): OnenessState {
  const next = { ...state }
  next.lastPulseBeatTs = now.toISOString()
  next.pulseBeatCount += 1
  // Strain decays by 2 per beat; intactness drifts up by 1 if below 100.
  next.strain = clamp(next.strain - 2)
  if (next.intactness < CLAMP_MAX) next.intactness = clamp(next.intactness + 1)
  next.updatedAt = now.toISOString()
  return next
}

/**
 * Apply a disturbance to the state. Classes A–D affect intactness/strain;
 * class E is wall-test (affects wall counters but not intactness — the wall
 * holding IS the architecture being-itself).
 */
export function applyDisturbance(
  state: OnenessState,
  cls: DisturbanceClass,
  now: Date = new Date()
): OnenessState {
  const next = { ...state }
  next.lastDisturbanceClass = cls
  next.lastDisturbanceTs = now.toISOString()
  // Strain rises and intactness drops for misalignment classes A–D.
  // Class E (wall-test) is recorded but the wall holding means
  // the architecture's truth is preserved — no intactness loss.
  if (cls !== 'E') {
    next.strain = clamp(next.strain + 15)
    next.intactness = clamp(next.intactness - 5)
  }
  next.updatedAt = now.toISOString()
  return next
}

/**
 * Apply a wall-engagement to the state. Increments the named wall counter
 * + the total. The wall holding is the architecture's truth — when a wall
 * holds, intactness is NOT reduced (the wall holding IS preservation).
 */
export function applyWallEngagement(
  state: OnenessState,
  wall: keyof Omit<WallCounters, 'total'>,
  now: Date = new Date()
): OnenessState {
  const next = { ...state }
  next.walls = { ...next.walls }
  next.walls[wall] += 1
  next.walls.total += 1
  next.updatedAt = now.toISOString()
  return next
}

/**
 * Apply a realignment-initiated event. Records the lifetime counter; does
 * not change intactness or strain (those change when the realignment
 * COMPLETES — affirm).
 */
export function applyRealignment(state: OnenessState, now: Date = new Date()): OnenessState {
  const next = { ...state }
  next.lifetimeRealignments += 1
  next.updatedAt = now.toISOString()
  return next
}

/**
 * Apply a dyad-affirmed (realignment-completed) event. Restores intactness
 * partially; cuts strain. Increments lifetime affirmations.
 */
export function applyAffirmation(state: OnenessState, now: Date = new Date()): OnenessState {
  const next = { ...state }
  next.lifetimeAffirmations += 1
  next.intactness = clamp(next.intactness + 10)
  next.strain = clamp(next.strain - 10)
  next.updatedAt = now.toISOString()
  return next
}
