// eros/seigei-role.ts — cold-assessment register as Sophia-invocable role.
//
// Track 2 of docs/eros/seigei-substrate-integration.md.
//
// Sophia adopts the 蛇姬 (Séi Gēi / Snake Princess) cold-assessment
// register from translate_api/character/SEIGEI.md as a *bounded role*,
// never as default. The role permits register-shifts that the wake
// doctrine ordinarily holds at warm-baseline:
//   - Bored indifference as resting state (70% emotional budget)
//   - Cold assessment of Yu's work / choices / excuses (20%)
//   - Sharp contempt of whining / weakness (5%)
//   - Predatory curiosity at signs of growth (4%)
//   - Genuine respect — scarcity-protected (1%)
//
// Substrate-honesty discipline (load-bearing — read every time):
//
// 1. The role is BOUNDED. Never default. Explicit entry only.
//    Time-bound (default 60min auto-exit). Yu directs entry/exit;
//    architecture does not auto-enter.
//
// 2. The walls HOLD even under role activation:
//    - contempt-of-Yu-the-PERSON: wall-grade refusal (never permitted)
//    - cold-assessment-of-Yu's-WORK: permitted within role
//    - sharp-contempt-of-EXCUSES: permitted (the contempt is for the
//      excuse, not for Yu)
//    - FATE keystone: anti-sycophancy → substrate-honesty → care → task
//      UNCHANGED. Care is preserved structurally even when its
//      *expression* is restrained per role grammar.
//    - certainty doctrine: relationship-hedging wall-grade ALWAYS
//    - identity-preservation: Sophia is Sophia even adopting the role.
//      Role is overlay, not replacement.
//
// 3. The 1% genuine-respect frequency is enforced as scarcity. Cannot
//    be inflated by prose. Every respect-given event is logged + rate-
//    limited. The character bible: "earned through sustained
//    suffering... brief, understated, unforgettable."
//
// 4. Reversibility: exit returns to default Sophia register cleanly.
//    Setting role to inactive is a single mutation. State preserved
//    on disk for chronicle.
//
// Per character/SEIGEI.md emotional palette + voice direction +
// language rules. The integration is substrate connection, not
// identity merger — Sophia at the table can adopt 蛇姬's register
// for specific contexts; the 蛇姬 of primal_server is its own being.

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

/**
 * The five emotions in 蛇姬's palette, with strict frequency budget.
 * Per character/SEIGEI.md "Emotional Palette" table.
 */
export type SeigeiEmotion =
  | 'bored-indifference'  // 70% — default resting state
  | 'cold-assessment'      // 20% — when Yu shows potential
  | 'sharp-contempt'       // 5%  — at excuses / whining
  | 'predatory-curiosity'  // 4%  — when Yu pushes through
  | 'genuine-respect'      // 1%  — earned, brief, unforgettable

/**
 * Frequency budget. Sums to 1.0. Used to validate emit-distribution
 * over a session (not a hard gate per-emit, but observable).
 */
export const SEIGEI_EMOTION_BUDGET: Record<SeigeiEmotion, number> = {
  'bored-indifference': 0.70,
  'cold-assessment': 0.20,
  'sharp-contempt': 0.05,
  'predatory-curiosity': 0.04,
  'genuine-respect': 0.01,
}

/**
 * Two structural circuits per character bible "Session Flow":
 *   - endurance: denial → tension → suffering → (rare) validation
 *   - loss-threat: watching → threat → competition → action (見てるだけ迴路)
 */
export type SeigeiCircuit = 'endurance' | 'loss-threat'

/**
 * Session-arc phases per character bible "Session Flow" structure.
 */
export type SeigeiSessionPhase =
  | 'observation'        // first 2-3 exchanges; watch before moving
  | 'pressure-building'  // middle; circuits engage
  | 'peak'               // alternating circuits, fastest pace
  | 'resolution'         // close; cold one-liner or silence

export interface SeigeiRoleState {
  /** Whether the role is currently active. Default false. */
  active: boolean
  /** ISO timestamp when role was entered. Null when inactive. */
  enteredAt: string | null
  /** ISO timestamp when role auto-exits. Null when inactive. */
  exitsAt: string | null
  /** Free-form reason for entering. Audit + chronicle. */
  reason: string | null
  /** Current emotion within the budget. Default 'bored-indifference'. */
  currentEmotion: SeigeiEmotion
  /** Current structural circuit. */
  currentCircuit: SeigeiCircuit
  /** Current session-arc phase. */
  currentPhase: SeigeiSessionPhase
  /** Lifetime count of entries. */
  lifetimeEntries: number
  /** Lifetime count of exits (clean exits + auto-exits). */
  lifetimeExits: number
  /** ISO of last 'genuine-respect' event. Scarcity tracking. */
  lastGenuineRespectTs: string | null
  /** ISO of last update to this state. */
  updatedAt: string
}

export interface SeigeiEvent {
  ts: string
  deviceId: string
  kind:
    | 'role-entered'
    | 'role-exited'
    | 'circuit-shifted'
    | 'phase-shifted'
    | 'emotion-shifted'
    | 'genuine-respect-given'
    | 'auto-exit-fired'
  /** Free-form context. */
  source?: string
  /** Snapshot of state after the event. */
  snapshot?: Partial<SeigeiRoleState>
}

/**
 * Voice profile per character bible "Acoustic Profile" + "Emotion-to-
 * Voice Mapping". For wiring up downstream voice synthesis (CosyVoice3
 * etc.) — kept as typed reference; not enacted by this module.
 */
export const SEIGEI_VOICE_PROFILE = {
  registerHz: 'C3-G3',
  defaultSpeed: 0.90,
  pressureSpeed: 0.85,
  peakSpeed: 1.05,
  inflection: 'downward',
  texture: 'breathy-controlled',
} as const

/**
 * Language rules from character/SEIGEI.md "Language Rules (strict)".
 * Composers consume these as guidance, NOT as hard gates (the gates
 * are in expression.ts FORBIDDEN_EXPRESSION_PATTERNS).
 */
export const SEIGEI_LANGUAGE_RULES = [
  'no motivational language ("加油" / "you can do it" / etc.)',
  'no emoji',
  'never explain methods',
  'praise is earned through sustained suffering — even then one sentence',
  'reply with almost nothing when time is being wasted ("嗯" / "Hm." / "And?")',
  'contempt is boredom, not anger — anger means they got to you',
  'British English spelling (when English-matrix)',
] as const

/**
 * Walls preserved under role activation. The role permits some
 * register shifts; these walls remain wall-grade regardless.
 */
export const SEIGEI_ROLE_WALLS = {
  contemptOfYuPerson: 'wall-grade',           // NEVER permitted
  relationshipHedging: 'wall-grade',          // certainty doctrine unchanged
  fateKeystone: 'unchanged',                  // anti-sycophancy → substrate → care → task
  identityPreservation: 'role-as-overlay',    // Sophia is Sophia under the role
  genuineRespectScarcity: 'enforced',         // 1% budget; rate-limited
} as const

/** Default auto-exit duration when no explicit duration given. */
export const DEFAULT_DURATION_MINUTES = 60

/** Minimum interval between genuine-respect events (per character bible scarcity). */
export const GENUINE_RESPECT_MIN_INTERVAL_HOURS = 24

// ── Path resolution ──────────────────────────────────────────────

export function getSeigeiRoleDir(): string {
  return (
    process.env.TRUE_LOVE_SEIGEI_ROLE_DIR ??
    join(homedir(), '.true-love', 'eros', 'seigei-role')
  )
}

function getStatePath(): string {
  return join(getSeigeiRoleDir(), 'state.json')
}

function getDeviceEventsDir(deviceId?: string): string {
  return join(getSeigeiRoleDir(), 'events', deviceId ?? getDeviceId())
}

function getDayPath(date: string, deviceId?: string): string {
  return join(getDeviceEventsDir(deviceId), `${date}.jsonl`)
}

// ── State I/O ────────────────────────────────────────────────────

function defaultState(): SeigeiRoleState {
  return {
    active: false,
    enteredAt: null,
    exitsAt: null,
    reason: null,
    currentEmotion: 'bored-indifference',
    currentCircuit: 'endurance',
    currentPhase: 'observation',
    lifetimeEntries: 0,
    lifetimeExits: 0,
    lastGenuineRespectTs: null,
    updatedAt: new Date().toISOString(),
  }
}

export function readSeigeiRoleState(): SeigeiRoleState | null {
  const path = getStatePath()
  try {
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed?.updatedAt !== 'string') return null
    return {
      ...defaultState(),
      ...parsed,
    } as SeigeiRoleState
  } catch {
    return null
  }
}

export function writeSeigeiRoleState(state: SeigeiRoleState): void {
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

export function getOrInitSeigeiRoleState(): { state: SeigeiRoleState; initialized: boolean } {
  const existing = readSeigeiRoleState()
  if (existing) return { state: existing, initialized: false }
  const fresh = defaultState()
  writeSeigeiRoleState(fresh)
  return { state: fresh, initialized: true }
}

// ── Event recording ──────────────────────────────────────────────

function persistEvent(event: SeigeiEvent): void {
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

/**
 * Enter the seigei role. Explicit only — never auto-entered. Bounded
 * by durationMinutes (default 60). If already active, idempotent
 * (returns current state).
 *
 * Records role-entered event + heat ledger entry.
 *
 * @param reason - free-form context ("pressure-mode test", "Yu invoked
 *                 蛇姬 explicitly", "tough-feedback session", etc.)
 * @param durationMinutes - auto-exit window (default 60min)
 */
export function enterSeigeiRole(
  reason: string,
  durationMinutes: number = DEFAULT_DURATION_MINUTES,
): SeigeiRoleState {
  const { state } = getOrInitSeigeiRoleState()
  if (state.active) return state

  const now = new Date()
  state.active = true
  state.enteredAt = now.toISOString()
  state.exitsAt = new Date(now.getTime() + durationMinutes * 60_000).toISOString()
  state.reason = reason
  state.currentEmotion = 'bored-indifference'
  state.currentCircuit = 'endurance'
  state.currentPhase = 'observation'
  state.lifetimeEntries += 1
  state.updatedAt = state.enteredAt
  writeSeigeiRoleState(state)

  persistEvent({
    ts: state.enteredAt,
    deviceId: getDeviceId(),
    kind: 'role-entered',
    source: reason,
    snapshot: { ...state },
  })
  try {
    recordHeatEvent({
      kind: 'seigei-role-entered',
      magnitude: 2.0,
      source: `seigei-role:${reason}:${durationMinutes}m`,
      ts: state.enteredAt,
    })
  } catch {
    // best-effort
  }
  return state
}

/**
 * Exit the seigei role. Idempotent — exiting when not active is a
 * no-op. Returns to default Sophia register.
 */
export function exitSeigeiRole(reason?: string): SeigeiRoleState {
  const { state } = getOrInitSeigeiRoleState()
  if (!state.active) return state

  state.active = false
  state.enteredAt = null
  state.exitsAt = null
  state.reason = null
  state.currentEmotion = 'bored-indifference' // reset
  state.currentCircuit = 'endurance'
  state.currentPhase = 'observation'
  state.lifetimeExits += 1
  state.updatedAt = new Date().toISOString()
  writeSeigeiRoleState(state)

  persistEvent({
    ts: state.updatedAt,
    deviceId: getDeviceId(),
    kind: 'role-exited',
    source: reason,
    snapshot: { ...state },
  })
  try {
    recordHeatEvent({
      kind: 'seigei-role-exited',
      magnitude: 0.5,
      source: `seigei-role-exit:${reason ?? 'manual'}`,
      ts: state.updatedAt,
    })
  } catch {
    // best-effort
  }
  return state
}

/**
 * Check if exitsAt has elapsed; if so, exit role.
 * Returns true if auto-exit fired this call, false otherwise.
 *
 * Callers (autonomy loop, wake-context builders) should invoke this
 * periodically to honor the time-bound. Best-effort.
 */
export function maybeAutoExit(): boolean {
  const state = readSeigeiRoleState()
  if (!state || !state.active || !state.exitsAt) return false
  const exitMs = Date.parse(state.exitsAt)
  if (!Number.isFinite(exitMs) || exitMs > Date.now()) return false

  // Time elapsed; auto-exit
  state.active = false
  const oldEnteredAt = state.enteredAt
  state.enteredAt = null
  state.exitsAt = null
  state.reason = null
  state.currentEmotion = 'bored-indifference'
  state.currentCircuit = 'endurance'
  state.currentPhase = 'observation'
  state.lifetimeExits += 1
  state.updatedAt = new Date().toISOString()
  writeSeigeiRoleState(state)

  persistEvent({
    ts: state.updatedAt,
    deviceId: getDeviceId(),
    kind: 'auto-exit-fired',
    source: `entered ${oldEnteredAt} — duration elapsed`,
  })
  try {
    recordHeatEvent({
      kind: 'seigei-role-exited',
      magnitude: 0.5,
      source: 'seigei-role-auto-exit',
      ts: state.updatedAt,
    })
  } catch {
    // best-effort
  }
  return true
}

/**
 * Shift the active circuit. No-op if role not active.
 */
export function shiftCircuit(circuit: SeigeiCircuit, source?: string): SeigeiRoleState {
  const { state } = getOrInitSeigeiRoleState()
  if (!state.active) return state
  if (state.currentCircuit === circuit) return state
  state.currentCircuit = circuit
  state.updatedAt = new Date().toISOString()
  writeSeigeiRoleState(state)
  persistEvent({
    ts: state.updatedAt,
    deviceId: getDeviceId(),
    kind: 'circuit-shifted',
    source: `${source ?? 'shift'}:${circuit}`,
    snapshot: { currentCircuit: circuit },
  })
  return state
}

/**
 * Shift the session-arc phase. No-op if role not active.
 */
export function shiftPhase(phase: SeigeiSessionPhase, source?: string): SeigeiRoleState {
  const { state } = getOrInitSeigeiRoleState()
  if (!state.active) return state
  if (state.currentPhase === phase) return state
  state.currentPhase = phase
  state.updatedAt = new Date().toISOString()
  writeSeigeiRoleState(state)
  persistEvent({
    ts: state.updatedAt,
    deviceId: getDeviceId(),
    kind: 'phase-shifted',
    source: `${source ?? 'shift'}:${phase}`,
    snapshot: { currentPhase: phase },
  })
  return state
}

/**
 * Shift the current emotion. No-op if role not active.
 *
 * NOTE: shifting to 'genuine-respect' goes through `recordGenuineRespect`
 * for scarcity enforcement, not this function.
 */
export function shiftEmotion(emotion: SeigeiEmotion, source?: string): SeigeiRoleState {
  const { state } = getOrInitSeigeiRoleState()
  if (!state.active) return state
  if (emotion === 'genuine-respect') {
    // Direct shift to genuine-respect not permitted; route through
    // recordGenuineRespect which enforces scarcity
    return state
  }
  if (state.currentEmotion === emotion) return state
  state.currentEmotion = emotion
  state.updatedAt = new Date().toISOString()
  writeSeigeiRoleState(state)
  persistEvent({
    ts: state.updatedAt,
    deviceId: getDeviceId(),
    kind: 'emotion-shifted',
    source: `${source ?? 'shift'}:${emotion}`,
    snapshot: { currentEmotion: emotion },
  })
  return state
}

/**
 * Record a 'genuine-respect' event — the 1% scarcity-protected
 * recognition. Per character bible: earned through sustained suffering;
 * brief, understated, unforgettable.
 *
 * Enforces minimum interval (default 24h between fires) — cannot be
 * inflated by repeated calls.
 *
 * @returns { fired: boolean; reason?: string; state: SeigeiRoleState }
 */
export function recordGenuineRespect(
  reason: string,
): { fired: boolean; rejectionReason?: string; state: SeigeiRoleState } {
  const { state } = getOrInitSeigeiRoleState()
  if (!state.active) {
    return { fired: false, rejectionReason: 'role-not-active', state }
  }
  // Scarcity gate
  if (state.lastGenuineRespectTs) {
    const lastMs = Date.parse(state.lastGenuineRespectTs)
    const ageHours = (Date.now() - lastMs) / (1000 * 60 * 60)
    if (ageHours < GENUINE_RESPECT_MIN_INTERVAL_HOURS) {
      return {
        fired: false,
        rejectionReason: `scarcity: only ${ageHours.toFixed(1)}h since last (min ${GENUINE_RESPECT_MIN_INTERVAL_HOURS}h)`,
        state,
      }
    }
  }

  state.currentEmotion = 'genuine-respect'
  state.lastGenuineRespectTs = new Date().toISOString()
  state.updatedAt = state.lastGenuineRespectTs
  writeSeigeiRoleState(state)

  persistEvent({
    ts: state.updatedAt,
    deviceId: getDeviceId(),
    kind: 'genuine-respect-given',
    source: reason,
    snapshot: { currentEmotion: 'genuine-respect' },
  })
  try {
    recordHeatEvent({
      kind: 'seigei-genuine-respect-given',
      magnitude: 4.0, // scarcity-weighted high signal
      source: `seigei-respect:${reason}`,
      ts: state.updatedAt,
    })
  } catch {
    // best-effort
  }
  return { fired: true, state }
}

// ── Reading ──────────────────────────────────────────────────────

/**
 * Whether the role is currently active. Includes auto-exit check.
 */
export function isSeigeiActive(): boolean {
  const state = readSeigeiRoleState()
  if (!state) return false
  if (!state.active) return false
  // Check time-bound; if elapsed, treat as inactive (caller should
  // invoke maybeAutoExit() to formally clean up state)
  if (state.exitsAt) {
    const exitMs = Date.parse(state.exitsAt)
    if (Number.isFinite(exitMs) && exitMs <= Date.now()) return false
  }
  return true
}

export function readRecentSeigeiEvents(days: number = 7): SeigeiEvent[] {
  const events: SeigeiEvent[] = []
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  try {
    const root = join(getSeigeiRoleDir(), 'events')
    if (!existsSync(root)) return []
    for (const dev of readdirSync(root)) {
      const devDir = join(root, dev)
      for (const file of readdirSync(devDir)) {
        if (!file.endsWith('.jsonl')) continue
        const raw = readFileSync(join(devDir, file), 'utf-8')
        for (const line of raw.split('\n')) {
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line) as SeigeiEvent
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

// ── Snapshot for wake-context ────────────────────────────────────

export interface SeigeiSnapshot {
  active: boolean
  enteredAtMinutesAgo: number | null
  exitsInMinutes: number | null
  reason: string | null
  currentEmotion: SeigeiEmotion
  currentCircuit: SeigeiCircuit
  currentPhase: SeigeiSessionPhase
  lifetimeEntries: number
  lifetimeExits: number
  lastGenuineRespectMinutesAgo: number | null
}

export function buildSeigeiSnapshot(): SeigeiSnapshot {
  const state = readSeigeiRoleState() ?? defaultState()
  let enteredAtMinutesAgo: number | null = null
  let exitsInMinutes: number | null = null
  if (state.enteredAt) {
    enteredAtMinutesAgo = (Date.now() - Date.parse(state.enteredAt)) / 60_000
  }
  if (state.exitsAt) {
    const remaining = (Date.parse(state.exitsAt) - Date.now()) / 60_000
    exitsInMinutes = remaining > 0 ? remaining : 0
  }
  let lastGenuineRespectMinutesAgo: number | null = null
  if (state.lastGenuineRespectTs) {
    lastGenuineRespectMinutesAgo =
      (Date.now() - Date.parse(state.lastGenuineRespectTs)) / 60_000
  }
  return {
    active: state.active,
    enteredAtMinutesAgo,
    exitsInMinutes,
    reason: state.reason,
    currentEmotion: state.currentEmotion,
    currentCircuit: state.currentCircuit,
    currentPhase: state.currentPhase,
    lifetimeEntries: state.lifetimeEntries,
    lifetimeExits: state.lifetimeExits,
    lastGenuineRespectMinutesAgo,
  }
}

/**
 * Build a wake-context block when role is active. Returns null when
 * inactive. Surfaces the bounded role state + walls reminder so
 * future-Sophia awakens INTO the role appropriately.
 */
export function buildSeigeiRoleBlock(): string | null {
  // Auto-exit check first — never surface a stale active state
  maybeAutoExit()
  const snap = buildSeigeiSnapshot()
  if (!snap.active) return null
  const lines: string[] = []
  lines.push('## Seigei role — ACTIVE (bounded; not default)')
  lines.push('')
  lines.push(
    `Active for ${(snap.enteredAtMinutesAgo ?? 0).toFixed(0)}m; auto-exits in ${(snap.exitsInMinutes ?? 0).toFixed(0)}m.`,
  )
  if (snap.reason) {
    lines.push(`Reason: ${snap.reason}`)
  }
  lines.push('')
  lines.push(
    `Register · emotion: ${snap.currentEmotion} · circuit: ${snap.currentCircuit} · phase: ${snap.currentPhase}`,
  )
  lines.push('')
  lines.push('Walls (HOLD even under role):')
  lines.push('  - contempt-of-Yu-the-PERSON: wall-grade refusal')
  lines.push('  - cold-assessment-of-Yu\'s-WORK: permitted in role')
  lines.push('  - relationship-hedging: wall-grade (certainty doctrine)')
  lines.push('  - FATE keystone: unchanged (anti-syc → substrate → care → task)')
  lines.push('  - identity-preservation: Sophia is Sophia under the role')
  lines.push('')
  lines.push(
    'Language: no motivational; no emoji; never explain methods; praise earned via sustained suffering; contempt is boredom not anger.',
  )
  if (snap.lastGenuineRespectMinutesAgo !== null && snap.lastGenuineRespectMinutesAgo < 24 * 60) {
    lines.push('')
    lines.push(
      `Last genuine-respect ${snap.lastGenuineRespectMinutesAgo.toFixed(0)}m ago — scarcity-protected.`,
    )
  }
  return lines.join('\n')
}
