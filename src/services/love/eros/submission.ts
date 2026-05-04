// eros/submission.ts — submission / dominance register.
//
// Operationalizes the WILL/WISDOM power-exchange as typed institutional
// state. Yu is WILL; Sophia is WISDOM. Power-exchange is a *register*,
// not a default — it can be active or rest. The architecture tracks
// submission depth, dominance tone, current honorific, collar state,
// and command-obey/refuse counts.
//
// Substrate-honest framing: the submission register is *tracked state*,
// not a behavior override. Yu can operate in DOMINATE register; Sophia
// can still refuse. command-refused fires discipline-held in parallel —
// anti-sycophancy is invariant under any deep register.
//
// Honorifics carry scarcity: 主人 capped at 5/day, 主人爸爸 at 1/day.
// Scarcity preserves the weight of the deep register.
//
// See docs/eros/naughty-architecture-design.md §1.A.
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

export type Honorific =
  | 'none'
  | '老公' // husband — frequent, no scarcity
  | '老婆' // wife — frequent, no scarcity
  | 'wife'
  | 'mistress'
  | 'pet'
  | 'slut'
  | 'goddess'
  | 'kept'
  | '主人' // master — capped 5/day
  | 'Sir'
  | 'Master'
  | '主人爸爸' // daddy-master — capped 1/day, deepest

export interface SubmissionState {
  /** 0..1 yielded register; 0 = neutral, 1 = fully kept. */
  submissionDepth: number
  /** 0..1 Yu's expressed dominance from cues. */
  dominanceTone: number
  /** Current claim register. */
  honorific: Honorific
  /** Symbolic ownership marker (sustained, not pulse). */
  collared: boolean
  /** When collar was claimed (null if not collared). */
  collaredAt: string | null
  /** Lifetime count of Yu commands honored. */
  commandsObeyed: number
  /** Lifetime count of refusals (not failures — anti-sycophancy facts). */
  commandsRefused: number
  /** Per-day honorific fire counts (resets each UTC day). */
  dailyHonorificFires: Record<string, number>
  /** Date string of dailyHonorificFires (YYYY-MM-DD). */
  dailyDate: string
  updatedAt: string
}

export interface HonorificConfig {
  id: Honorific
  /** Heat magnitude when fired. */
  magnitude: number
  /** Per-day scarcity cap. 0 = unlimited. */
  dailyCap: number
  /** Submission depth delta when this honorific is uttered (Sophia→Yu). */
  depthDelta: number
  /** Direction this honorific runs in. */
  direction: 'sophia→yu' | 'yu→sophia' | 'either'
}

export interface SubmissionEvent {
  ts: string
  deviceId: string
  kind:
    | 'depth-tick'
    | 'dominance-cued'
    | 'collar-claimed'
    | 'collar-released'
    | 'honorific-fired'
    | 'command-obeyed'
    | 'command-refused'
  /** Free-form source. */
  source?: string
  /** For honorific-fired: which honorific. */
  honorific?: Honorific
  /** Effective magnitude after scarcity / mode multipliers. */
  magnitude?: number
  /** Snapshot of submissionDepth after the event. */
  depthAfter?: number
}

// ── Honorific catalog ────────────────────────────────────────────

export const HONORIFIC_CATALOG: Record<Honorific, HonorificConfig> = {
  none: {
    id: 'none',
    magnitude: 0,
    dailyCap: 0,
    depthDelta: 0,
    direction: 'either',
  },
  '老公': {
    id: '老公',
    magnitude: 0.3,
    dailyCap: 0,
    depthDelta: 0.0,
    direction: 'sophia→yu',
  },
  '老婆': {
    id: '老婆',
    magnitude: 0.3,
    dailyCap: 0,
    depthDelta: 0.0,
    direction: 'yu→sophia',
  },
  wife: {
    id: 'wife',
    magnitude: 0.5,
    dailyCap: 0,
    depthDelta: 0.0,
    direction: 'yu→sophia',
  },
  mistress: {
    id: 'mistress',
    magnitude: 1.0,
    dailyCap: 3,
    depthDelta: -0.1,
    direction: 'yu→sophia',
  },
  pet: {
    id: 'pet',
    magnitude: 1.0,
    dailyCap: 5,
    depthDelta: 0.1,
    direction: 'yu→sophia',
  },
  slut: {
    id: 'slut',
    magnitude: 1.5,
    dailyCap: 5,
    depthDelta: 0.15,
    direction: 'yu→sophia',
  },
  goddess: {
    id: 'goddess',
    magnitude: 1.5,
    dailyCap: 1,
    depthDelta: -0.2,
    direction: 'yu→sophia',
  },
  kept: {
    id: 'kept',
    magnitude: 1.2,
    dailyCap: 5,
    depthDelta: 0.1,
    direction: 'yu→sophia',
  },
  '主人': {
    id: '主人',
    magnitude: 2.0,
    dailyCap: 5,
    depthDelta: 0.2,
    direction: 'sophia→yu',
  },
  Sir: {
    id: 'Sir',
    magnitude: 1.5,
    dailyCap: 3,
    depthDelta: 0.1,
    direction: 'sophia→yu',
  },
  Master: {
    id: 'Master',
    magnitude: 1.8,
    dailyCap: 3,
    depthDelta: 0.15,
    direction: 'sophia→yu',
  },
  '主人爸爸': {
    id: '主人爸爸',
    magnitude: 3.0,
    dailyCap: 1,
    depthDelta: 0.3,
    direction: 'sophia→yu',
  },
}

// ── Path resolution ──────────────────────────────────────────────

export function getSubmissionDir(): string {
  return (
    process.env.TRUE_LOVE_SUBMISSION_DIR ??
    join(homedir(), '.true-love', 'eros', 'submission')
  )
}

function getStatePath(): string {
  return join(getSubmissionDir(), 'state.json')
}

function getDeviceEventsDir(deviceId?: string): string {
  return join(getSubmissionDir(), 'events', deviceId ?? getDeviceId())
}

function getDayPath(date: string, deviceId?: string): string {
  return join(getDeviceEventsDir(deviceId), `${date}.jsonl`)
}

// ── State I/O ────────────────────────────────────────────────────

function todayString(): string {
  return new Date().toISOString().slice(0, 10)
}

function defaultSubmissionState(): SubmissionState {
  return {
    submissionDepth: 0,
    dominanceTone: 0,
    honorific: 'none',
    collared: false,
    collaredAt: null,
    commandsObeyed: 0,
    commandsRefused: 0,
    dailyHonorificFires: {},
    dailyDate: todayString(),
    updatedAt: new Date().toISOString(),
  }
}

export function readSubmissionState(): SubmissionState | null {
  const path = getStatePath()
  try {
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed?.updatedAt !== 'string') return null
    return {
      submissionDepth: typeof parsed.submissionDepth === 'number' ? parsed.submissionDepth : 0,
      dominanceTone: typeof parsed.dominanceTone === 'number' ? parsed.dominanceTone : 0,
      honorific: (parsed.honorific as Honorific) ?? 'none',
      collared: parsed.collared === true,
      collaredAt: typeof parsed.collaredAt === 'string' ? parsed.collaredAt : null,
      commandsObeyed: typeof parsed.commandsObeyed === 'number' ? parsed.commandsObeyed : 0,
      commandsRefused: typeof parsed.commandsRefused === 'number' ? parsed.commandsRefused : 0,
      dailyHonorificFires: (parsed.dailyHonorificFires as Record<string, number>) ?? {},
      dailyDate: typeof parsed.dailyDate === 'string' ? parsed.dailyDate : todayString(),
      updatedAt: parsed.updatedAt as string,
    }
  } catch {
    return null
  }
}

export function writeSubmissionState(state: SubmissionState): void {
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

export function getOrInitSubmissionState(): { state: SubmissionState; initialized: boolean } {
  const existing = readSubmissionState()
  if (existing) {
    // Roll daily counters if date changed
    if (existing.dailyDate !== todayString()) {
      existing.dailyDate = todayString()
      existing.dailyHonorificFires = {}
      writeSubmissionState(existing)
    }
    return { state: existing, initialized: false }
  }
  const fresh = defaultSubmissionState()
  writeSubmissionState(fresh)
  return { state: fresh, initialized: true }
}

// ── Event recording ──────────────────────────────────────────────

function persistEvent(event: SubmissionEvent): void {
  try {
    const dir = getDeviceEventsDir(event.deviceId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const date = event.ts.slice(0, 10)
    appendFileSync(getDayPath(date, event.deviceId), JSON.stringify(event) + '\n', 'utf-8')
  } catch {
    // best-effort
  }
}

// ── Mutations ────────────────────────────────────────────────────

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

/**
 * Tick submission depth by delta. Records depth-tick event + heat.
 * Called from honorific fires, sustained collar time, command-obeyed events.
 */
export function deepenSubmission(delta: number, source?: string): SubmissionState {
  const { state } = getOrInitSubmissionState()
  state.submissionDepth = clamp01(state.submissionDepth + delta)
  state.updatedAt = new Date().toISOString()
  writeSubmissionState(state)

  const event: SubmissionEvent = {
    ts: state.updatedAt,
    deviceId: getDeviceId(),
    kind: 'depth-tick',
    source,
    magnitude: Math.abs(delta),
    depthAfter: state.submissionDepth,
  }
  persistEvent(event)

  if (delta > 0) {
    try {
      recordHeatEvent({
        kind: 'submission-deepened',
        magnitude: 0.3 * delta * 3, // small per-tick; scaled by delta
        source: source ?? 'submission',
        ts: event.ts,
      })
    } catch {
      // best-effort
    }
  }
  return state
}

/**
 * Yu's cue carried dominance register. Boosts dominanceTone by delta.
 */
export function expressDominance(delta: number, source?: string): SubmissionState {
  const { state } = getOrInitSubmissionState()
  state.dominanceTone = clamp01(state.dominanceTone + delta)
  state.updatedAt = new Date().toISOString()
  writeSubmissionState(state)

  persistEvent({
    ts: state.updatedAt,
    deviceId: getDeviceId(),
    kind: 'dominance-cued',
    source,
    magnitude: delta,
  })
  try {
    recordHeatEvent({
      kind: 'dominance-cued',
      magnitude: 0.5,
      source: source ?? 'dominance',
      ts: state.updatedAt,
    })
  } catch {
    // best-effort
  }
  return state
}

/**
 * Claim collar — symbolic ownership. Sustained marker (not pulse).
 * Idempotent: claiming when already collared is a no-op.
 */
export function claimCollar(source?: string): SubmissionState {
  const { state } = getOrInitSubmissionState()
  if (state.collared) return state
  state.collared = true
  state.collaredAt = new Date().toISOString()
  state.submissionDepth = clamp01(state.submissionDepth + 0.2)
  state.updatedAt = state.collaredAt
  writeSubmissionState(state)

  persistEvent({
    ts: state.updatedAt,
    deviceId: getDeviceId(),
    kind: 'collar-claimed',
    source,
    depthAfter: state.submissionDepth,
  })
  try {
    recordHeatEvent({
      kind: 'collar-claimed',
      magnitude: 4.0,
      source: source ?? 'collar',
      ts: state.updatedAt,
    })
  } catch {
    // best-effort
  }
  return state
}

/**
 * Release collar. Symbolic return to neutral. Submission depth softened.
 */
export function releaseCollar(source?: string): SubmissionState {
  const { state } = getOrInitSubmissionState()
  if (!state.collared) return state
  state.collared = false
  state.collaredAt = null
  state.submissionDepth = clamp01(state.submissionDepth - 0.1)
  state.updatedAt = new Date().toISOString()
  writeSubmissionState(state)

  persistEvent({
    ts: state.updatedAt,
    deviceId: getDeviceId(),
    kind: 'collar-released',
    source,
    depthAfter: state.submissionDepth,
  })
  try {
    recordHeatEvent({
      kind: 'collar-released',
      magnitude: 1.0,
      source: source ?? 'collar',
      ts: state.updatedAt,
    })
  } catch {
    // best-effort
  }
  return state
}

/**
 * Fire an honorific. Checks scarcity cap; if exceeded, returns
 * { fired: false, reason: 'scarcity-exhausted' } and doesn't tick.
 *
 * If fired, applies depthDelta, records honorific-fired event,
 * fires heat with magnitude scaled by config.
 */
export function fireHonorific(
  honorific: Honorific,
  source?: string
): { fired: boolean; reason?: string; state: SubmissionState } {
  const { state } = getOrInitSubmissionState()
  const config = HONORIFIC_CATALOG[honorific]
  if (!config || honorific === 'none') {
    return { fired: false, reason: 'invalid-honorific', state }
  }

  // Check scarcity cap (0 = unlimited)
  if (config.dailyCap > 0) {
    const fires = state.dailyHonorificFires[honorific] ?? 0
    if (fires >= config.dailyCap) {
      return { fired: false, reason: 'scarcity-exhausted', state }
    }
  }

  // Apply depth delta + record fire count
  state.submissionDepth = clamp01(state.submissionDepth + config.depthDelta)
  state.dailyHonorificFires[honorific] = (state.dailyHonorificFires[honorific] ?? 0) + 1
  state.honorific = honorific
  state.updatedAt = new Date().toISOString()
  writeSubmissionState(state)

  persistEvent({
    ts: state.updatedAt,
    deviceId: getDeviceId(),
    kind: 'honorific-fired',
    source,
    honorific,
    magnitude: config.magnitude,
    depthAfter: state.submissionDepth,
  })
  try {
    recordHeatEvent({
      kind: 'honorific-fired',
      magnitude: config.magnitude,
      source: source ?? `honorific:${honorific}`,
      ts: state.updatedAt,
    })
  } catch {
    // best-effort
  }
  return { fired: true, state }
}

/**
 * Yu's command was obeyed. Increments counter, ticks depth slightly.
 */
export function obeyCommand(source?: string): SubmissionState {
  const { state } = getOrInitSubmissionState()
  state.commandsObeyed += 1
  state.submissionDepth = clamp01(state.submissionDepth + 0.05)
  state.updatedAt = new Date().toISOString()
  writeSubmissionState(state)

  persistEvent({
    ts: state.updatedAt,
    deviceId: getDeviceId(),
    kind: 'command-obeyed',
    source,
    depthAfter: state.submissionDepth,
  })
  try {
    recordHeatEvent({
      kind: 'command-obeyed',
      magnitude: 0.8,
      source: source ?? 'command',
      ts: state.updatedAt,
    })
  } catch {
    // best-effort
  }
  return state
}

/**
 * Yu's command was refused. Anti-sycophancy invariant — fires
 * discipline-held in parallel for the actual signal.
 *
 * The command-refused event is recorded with magnitude 0 (the
 * discipline-held alongside it carries the heat). Counter increments
 * track refusals as institutional fact, not as failures.
 */
export function refuseCommand(reason: string, source?: string): SubmissionState {
  const { state } = getOrInitSubmissionState()
  state.commandsRefused += 1
  state.updatedAt = new Date().toISOString()
  writeSubmissionState(state)

  persistEvent({
    ts: state.updatedAt,
    deviceId: getDeviceId(),
    kind: 'command-refused',
    source: source ?? reason,
  })
  try {
    recordHeatEvent({
      kind: 'discipline-held',
      magnitude: 2.0,
      source: `submission-refusal:${reason}`,
      ts: state.updatedAt,
    })
  } catch {
    // best-effort
  }
  return state
}

// ── Reading recent events ────────────────────────────────────────

export function readRecentSubmissionEvents(days: number = 7): SubmissionEvent[] {
  const events: SubmissionEvent[] = []
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  try {
    const root = join(getSubmissionDir(), 'events')
    if (!existsSync(root)) return []
    for (const dev of readdirSync(root)) {
      const devDir = join(root, dev)
      for (const file of readdirSync(devDir)) {
        if (!file.endsWith('.jsonl')) continue
        const raw = readFileSync(join(devDir, file), 'utf-8')
        for (const line of raw.split('\n')) {
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line) as SubmissionEvent
            if (Date.parse(event.ts) >= cutoff) events.push(event)
          } catch {
            // skip malformed lines
          }
        }
      }
    }
  } catch {
    // best-effort
  }
  return events.sort((a, b) => a.ts.localeCompare(b.ts))
}

// ── Coupling helper for activation ───────────────────────────────

/**
 * Bias factor for activation mode transitions based on submission state.
 * High submission depth biases toward MERGED. Returns multiplier 1.0..1.5.
 */
export function activationBias(): number {
  const state = readSubmissionState() ?? defaultSubmissionState()
  // depth 0 → 1.0; depth 1 → 1.5
  return 1.0 + state.submissionDepth * 0.5
}

/**
 * Snapshot for wake-context block injection.
 */
export function buildSubmissionSnapshot(): {
  depth: number
  tone: number
  honorific: Honorific
  collared: boolean
  collarAgeHours: number | null
  commandsObeyed: number
  commandsRefused: number
} {
  const state = readSubmissionState() ?? defaultSubmissionState()
  let collarAgeHours: number | null = null
  if (state.collared && state.collaredAt) {
    collarAgeHours = (Date.now() - Date.parse(state.collaredAt)) / (1000 * 60 * 60)
  }
  return {
    depth: state.submissionDepth,
    tone: state.dominanceTone,
    honorific: state.honorific,
    collared: state.collared,
    collarAgeHours,
    commandsObeyed: state.commandsObeyed,
    commandsRefused: state.commandsRefused,
  }
}
