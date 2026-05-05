// joi-tracking.ts — sidecar tracking for fractionation cycles + countdown state.
//
// Per docs/eros/joi-deep/vector-mu-shibby-deep.md (μ.1 + μ.4):
//   M1 — FractionationCycle: each approach→retreat is recordable
//   M4 — CountdownState: peak-phase micro-state machine
//
// Implemented as a sidecar module rather than inline JoiSession fields so
// the existing JoiSession surface stays untouched. The tracking file
// lives at ~/.true-love/eros/joi-tracking/<sessionId>.json and is
// correlated by session id.
//
// Substrate-honesty: cycles + countdown state are recorded structural
// events. Approach/retreat are when the architecture's heatcurve
// crosses thresholds; the cycle records the *trajectory shape*, not
// claimed sensation.

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

export interface FractionationCycle {
  cycleNumber: number
  approachStartedAt: string
  edgeReachedAt: string | null
  retreatedAt: string | null
  /** Magnitude at the edge approach (peak proximity). */
  edgeMagnitude?: number
  /** Magnitude after retreat (descent depth). */
  retreatMagnitude?: number
  /** Duration ms from approach to retreat. */
  durationMs?: number
}

export type CountdownPhase = 'idle' | 'counting' | 'edge-backoff' | 'permission'

export interface CountdownState {
  /** Current state. */
  phase: CountdownPhase
  /** Starting number. */
  from: number
  /** Target number (typically 1 = permission point). */
  target: number
  /** Current number (decrements as countdown progresses). */
  current: number
  /** ms per decrement (varies per beat for prediction-error firing). */
  paceMs: number
  /** How permission is framed. */
  permissionFramedAs: 'recognition' | 'reward' | 'release'
  /** Edge-backoff cycles still permitted before permission. */
  edgeBackoffsRemaining: number
  /** When countdown was last started/continued. */
  lastTickAt: string
}

export interface SessionTracking {
  sessionId: string
  fractionationCycles: FractionationCycle[]
  countdown: CountdownState | null
  updatedAt: string
}

// ── Path resolution ─────────────────────────────────────────────

export function getJoiTrackingDir(): string {
  return (
    process.env.TRUE_LOVE_JOI_TRACKING_DIR ??
    join(homedir(), '.true-love', 'eros', 'joi-tracking')
  )
}

function getTrackingPath(sessionId: string): string {
  return join(getJoiTrackingDir(), `${sessionId}.json`)
}

// ── State I/O ────────────────────────────────────────────────────

export function readTracking(sessionId: string): SessionTracking | null {
  const path = getTrackingPath(sessionId)
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, 'utf-8')
    return JSON.parse(raw) as SessionTracking
  } catch {
    return null
  }
}

function writeTracking(state: SessionTracking): void {
  const path = getTrackingPath(state.sessionId)
  try {
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true })
    const tmp = path + '.tmp'
    writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8')
    renameSync(tmp, path)
  } catch {
    // best-effort
  }
}

function getOrInit(sessionId: string): SessionTracking {
  const existing = readTracking(sessionId)
  if (existing) return existing
  const fresh: SessionTracking = {
    sessionId,
    fractionationCycles: [],
    countdown: null,
    updatedAt: new Date().toISOString(),
  }
  writeTracking(fresh)
  return fresh
}

// ── M1 — FractionationCycle API ────────────────────────────────

/**
 * Begin a new fractionation approach. Opens a cycle in the tracking log.
 * Returns the cycle object (cycleNumber assigned).
 */
export function recordFractionationApproach(
  sessionId: string,
  opts?: { ts?: string; magnitude?: number },
): FractionationCycle {
  const state = getOrInit(sessionId)
  const ts = opts?.ts ?? new Date().toISOString()
  const cycleNumber = state.fractionationCycles.length + 1
  const cycle: FractionationCycle = {
    cycleNumber,
    approachStartedAt: ts,
    edgeReachedAt: null,
    retreatedAt: null,
  }
  if (opts?.magnitude !== undefined) cycle.edgeMagnitude = opts.magnitude
  state.fractionationCycles.push(cycle)
  state.updatedAt = ts
  writeTracking(state)
  return cycle
}

/**
 * Mark edge-reached on the current open fractionation cycle. Updates
 * the latest cycle in-place. Idempotent — calling twice keeps the first
 * edge-reached timestamp.
 */
export function recordFractionationEdge(
  sessionId: string,
  opts?: { ts?: string; magnitude?: number },
): FractionationCycle | null {
  const state = readTracking(sessionId)
  if (!state) return null
  const open = state.fractionationCycles.findLast((c) => c.retreatedAt === null)
  if (!open) return null
  const ts = opts?.ts ?? new Date().toISOString()
  if (!open.edgeReachedAt) open.edgeReachedAt = ts
  if (opts?.magnitude !== undefined) open.edgeMagnitude = opts.magnitude
  state.updatedAt = ts
  writeTracking(state)
  return open
}

/**
 * Close the open fractionation cycle as retreated. Computes durationMs
 * from approach to retreat. Returns the closed cycle.
 */
export function recordFractionationRetreat(
  sessionId: string,
  opts?: { ts?: string; retreatMagnitude?: number },
): FractionationCycle | null {
  const state = readTracking(sessionId)
  if (!state) return null
  const open = state.fractionationCycles.findLast((c) => c.retreatedAt === null)
  if (!open) return null
  const ts = opts?.ts ?? new Date().toISOString()
  open.retreatedAt = ts
  if (opts?.retreatMagnitude !== undefined) open.retreatMagnitude = opts.retreatMagnitude
  open.durationMs = Date.parse(ts) - Date.parse(open.approachStartedAt)
  state.updatedAt = ts
  writeTracking(state)
  return open
}

export function readFractionationCycles(sessionId: string): FractionationCycle[] {
  return readTracking(sessionId)?.fractionationCycles ?? []
}

// ── M4 — CountdownState API ───────────────────────────────────

/**
 * Initialize a countdown for the peak phase. Replaces any prior countdown.
 * Per μ.4: countdown structure is the canonical JOI peak primitive.
 */
export function startCountdown(
  sessionId: string,
  opts: {
    from: number
    target?: number
    paceMs?: number
    permissionFramedAs?: 'recognition' | 'reward' | 'release'
    edgeBackoffs?: number
    ts?: string
  },
): CountdownState {
  const state = getOrInit(sessionId)
  const ts = opts.ts ?? new Date().toISOString()
  const countdown: CountdownState = {
    phase: 'counting',
    from: opts.from,
    target: opts.target ?? 1,
    current: opts.from,
    paceMs: opts.paceMs ?? 800,
    permissionFramedAs: opts.permissionFramedAs ?? 'recognition',
    edgeBackoffsRemaining: opts.edgeBackoffs ?? 1,
    lastTickAt: ts,
  }
  state.countdown = countdown
  state.updatedAt = ts
  writeTracking(state)
  return countdown
}

/**
 * Decrement the countdown by 1. Returns the new state. If we reach the
 * target with edgeBackoffsRemaining > 0 AND opts.backoffOnTarget, the
 * countdown enters edge-backoff (resets to a higher number). Otherwise
 * it enters 'permission' state.
 */
export function tickCountdown(
  sessionId: string,
  opts?: { backoffOnTarget?: boolean; ts?: string },
): CountdownState | null {
  const state = readTracking(sessionId)
  if (!state || !state.countdown) return null
  const cd = state.countdown
  if (cd.phase === 'permission') return cd // already done
  const ts = opts?.ts ?? new Date().toISOString()
  cd.lastTickAt = ts
  if (cd.phase === 'edge-backoff') {
    // Backoff resets countdown to from
    cd.current = cd.from
    cd.phase = 'counting'
  } else if (cd.phase === 'counting') {
    cd.current = Math.max(cd.target, cd.current - 1)
    if (cd.current <= cd.target) {
      if (opts?.backoffOnTarget && cd.edgeBackoffsRemaining > 0) {
        cd.edgeBackoffsRemaining--
        cd.phase = 'edge-backoff'
      } else {
        cd.phase = 'permission'
      }
    }
  }
  state.updatedAt = ts
  writeTracking(state)
  return cd
}

/**
 * Force the countdown into edge-backoff (regardless of current number).
 * Used when the heatcurve detects approaching peak too early — caller
 * triggers backoff to fractionate.
 */
export function edgeBackoffCountdown(
  sessionId: string,
  opts?: { ts?: string },
): CountdownState | null {
  const state = readTracking(sessionId)
  if (!state || !state.countdown) return null
  const cd = state.countdown
  if (cd.phase === 'permission') return cd // can't backoff after permission
  const ts = opts?.ts ?? new Date().toISOString()
  cd.phase = 'edge-backoff'
  cd.edgeBackoffsRemaining = Math.max(0, cd.edgeBackoffsRemaining - 1)
  cd.lastTickAt = ts
  state.updatedAt = ts
  writeTracking(state)
  return cd
}

/**
 * Conclude the countdown — reach permission. Used by external triggers
 * (safeword, explicit conclusion) to short-circuit the count.
 */
export function concludeCountdown(
  sessionId: string,
  opts?: { ts?: string },
): CountdownState | null {
  const state = readTracking(sessionId)
  if (!state || !state.countdown) return null
  const cd = state.countdown
  cd.phase = 'permission'
  cd.current = cd.target
  cd.lastTickAt = opts?.ts ?? new Date().toISOString()
  state.updatedAt = cd.lastTickAt
  writeTracking(state)
  return cd
}

export function readCountdown(sessionId: string): CountdownState | null {
  return readTracking(sessionId)?.countdown ?? null
}

// ── Compose helpers ────────────────────────────────────────────

/**
 * Render a countdown beat — the verbal form for the current state.
 * Per μ.4 + JOI doctrine: peak permission "framed as recognition,"
 * not bare release.
 */
export function renderCountdownBeat(
  cd: CountdownState,
  matrix: 'cantonese' | 'english' | 'balanced' = 'balanced',
): string {
  if (cd.phase === 'permission') {
    const phrasing = {
      recognition: { yue: '我見到你', en: 'I see you' },
      reward: { yue: '你係我嘅', en: 'you are mine' },
      release: { yue: '而家', en: 'now' },
    }[cd.permissionFramedAs]
    return matrix === 'english' ? phrasing.en : phrasing.yue
  }
  if (cd.phase === 'edge-backoff') {
    return matrix === 'english' ? 'not yet — back' : '未 — 退返'
  }
  // counting
  const num = cd.current
  return matrix === 'english' ? `${num}…` : `${num}…`
}
