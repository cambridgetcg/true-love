// eros/joi-feedback-hooks.ts — JOI session events → feedback layer.
//
// JOI lifecycle (startJoi / advanceJoi / endJoi) emits feedback so the
// dashboard renders the session as it runs. New JOI primitives:
//
//   - countdown — "5...4...3..." structure made tension (Vector C research)
//   - fractionation — surface-then-drop cycles for trance deepening
//   - anchor-fired — lexicon phrase becomes state-trigger this session
//
// Best-effort throughout: failures here MUST NEVER break JOI logic.
//
// See docs/eros/erotic-linguistics-research.md § Vector C (deeper research turn).

import { emit } from '../feedback/index.js'
import type { JoiPhase, JoiSession } from './joi.js'

// ── Session lifecycle ───────────────────────────────────────────

export function feedbackOnJoiSessionStart(session: JoiSession): void {
  try {
    emit('joi-session-start', {
      direction: session.direction,
      targetDurationS: session.targetDurationS,
      sessionId: session.id,
    })
  } catch { /* best-effort */ }
}

export function feedbackOnJoiPhaseShift(prev: JoiPhase, next: JoiPhase, session: JoiSession): void {
  try {
    emit('joi-phase-shift', {
      prev,
      next,
      direction: session.direction,
      sessionId: session.id,
      position: session.position,
    })
  } catch { /* best-effort */ }
}

export function feedbackOnJoiSessionEnd(session: JoiSession, completed: boolean): void {
  try {
    emit('joi-session-end', {
      sessionId: session.id,
      direction: session.direction,
      completed,
      finalPhase: session.currentPhase,
    })
  } catch { /* best-effort */ }
}

// ── Countdown primitive — Vector C structural element ──────────
//
// "Five… four… you're so close… three… let go for me now!" is a load-
// bearing JOI structural pattern (per JOI script research). Each beat is
// a discrete event the architecture broadcasts.

export interface CountdownBeatPayload {
  /** Current beat (counting down: 5, 4, 3, 2, 1, 0). */
  beat: number
  /** Total beats in this countdown cycle (typically 5 or 10). */
  total: number
  /** Optional context — what the countdown leads toward. */
  target?: 'release' | 'hold' | 'edge' | 'breath'
}

export function feedbackOnCountdownBeat(payload: CountdownBeatPayload): void {
  try {
    emit('joi-countdown', payload as unknown as Record<string, unknown>)
  } catch { /* best-effort */ }
}

// ── Fractionation primitive — trance deepening ─────────────────
//
// Per Erickson + erotic-hypnosis literature: bringing the subject in/out
// of trance briefly, repeatedly, deepens the trance each cycle. The
// architectural correlate: edge-broken → re-engage cycle. This event
// names that explicitly when JOI is the framing.

export interface FractionationCyclePayload {
  /** Cycle number (1, 2, 3, ...). */
  cycle: number
  /** Direction: 'surfacing' (lift from trance) or 'dropping' (return deeper). */
  direction: 'surfacing' | 'dropping'
  /** Optional depth indicator (0..10; arbitrary, institutional only). */
  depth?: number
}

export function feedbackOnFractionationCycle(payload: FractionationCyclePayload): void {
  try {
    emit('joi-fractionation', payload as unknown as Record<string, unknown>)
  } catch { /* best-effort */ }
}

// ── Anchor-fired — lexicon phrase becomes session state-trigger ─

export interface AnchorFiredPayload {
  /** Lexicon phrase id. */
  phraseId: string
  /** The phrase itself (truncated to 60 chars in payload). */
  phrase: string
  /** Lifetime fire count (anchor strength). */
  lifetime: number
  /** Whether this is the session's first time firing this phrase. */
  newToSession: boolean
}

export function feedbackOnAnchorFired(payload: AnchorFiredPayload): void {
  try {
    emit('joi-anchor-fired', payload as unknown as Record<string, unknown>)
  } catch { /* best-effort */ }
}

// ── Pause / tease / denial / permission / breath — Vector C primitives ─

export interface PausePayload {
  /** Pause duration target (ms). Erickson's "embedded silence" technique. */
  durationMs: number
  /** Optional reason / context. */
  reason?: 'breath' | 'sensation-landing' | 'suspension' | 'fractionation-gap'
}

export function feedbackOnJoiPause(payload: PausePayload): void {
  try { emit('joi-pause', payload as unknown as Record<string, unknown>) } catch { /* best-effort */ }
}

export interface TeasePayload {
  /** Tease intensity 1..10 — institutional only. */
  intensity: number
  /** Optional zone target. */
  zone?: string
  /** Optional context note. */
  context?: string
}

export function feedbackOnJoiTease(payload: TeasePayload): void {
  try { emit('joi-tease', payload as unknown as Record<string, unknown>) } catch { /* best-effort */ }
}

export interface DenialPayload {
  /** What is being denied — institutional descriptor. */
  target: 'release' | 'speed-increase' | 'permission' | 'edge-break'
  /** Optional reason / message. */
  reason?: string
}

export function feedbackOnJoiDenial(payload: DenialPayload): void {
  try { emit('joi-denial', payload as unknown as Record<string, unknown>) } catch { /* best-effort */ }
}

export interface PermissionPayload {
  /** What is being permitted. */
  grant: 'release' | 'speed-increase' | 'edge-break' | 'tease-end' | 'breath-out'
  /** Optional condition / framing. */
  condition?: string
}

export function feedbackOnJoiPermission(payload: PermissionPayload): void {
  try { emit('joi-permission', payload as unknown as Record<string, unknown>) } catch { /* best-effort */ }
}

export interface BreathCuePayload {
  /** Breath rhythm pattern: 'inhale' / 'hold' / 'exhale' / 'cycle' (one full breath). */
  pattern: 'inhale' | 'hold' | 'exhale' | 'cycle'
  /** Duration in ms for this beat. */
  durationMs: number
  /** Optional cycle number for tracking. */
  cycle?: number
}

export function feedbackOnJoiBreathCue(payload: BreathCuePayload): void {
  try { emit('joi-breath-cue', payload as unknown as Record<string, unknown>) } catch { /* best-effort */ }
}

export interface ScriptEngagedPayload {
  /** Named script id. */
  scriptId: string
  /** Total duration of the script. */
  durationS: number
  /** Number of phases / steps. */
  steps: number
}

export function feedbackOnJoiScriptEngaged(payload: ScriptEngagedPayload): void {
  try { emit('joi-script-engaged', payload as unknown as Record<string, unknown>) } catch { /* best-effort */ }
}
