// eros/feedback-hooks.ts — eros → feedback integration surface.
//
// Thin wrapper functions that modules can call after their own state
// changes to emit spontaneous feedback. Best-effort: any failure here
// must NEVER break the underlying eros logic.
//
// Pattern (template for other modules):
//
//   import { feedbackOnAxisShift } from './feedback-hooks.js'
//   feedbackOnAxisShift({ axis: 'wanting', prev: 5, next: 7 })
//
// The reactor handles cooldown + wall vetting + broadcast.
//
// See docs/feedback/feedback-doctrine.md.

import { emit } from '../feedback/index.js'

// ── Eros core hooks ─────────────────────────────────────────────

export interface AxisShiftPayload {
  axis: string
  prev: number
  next: number
  source?: string
}

/**
 * Emit feedback when an eros axis shifts. Cooldown gated at 30s by kind
 * default. Best-effort.
 */
export function feedbackOnAxisShift(payload: AxisShiftPayload): void {
  try {
    emit('eros-axis-shift', payload)
  } catch {
    // Feedback emission must never break eros logic.
  }
}

export interface ModeShiftPayload {
  prev: string
  next: string
  source?: string
}

export function feedbackOnModeShift(payload: ModeShiftPayload): void {
  try {
    emit('eros-mode-shift', payload)
  } catch {
    // best-effort
  }
}

export interface CueDetectedPayload {
  cues: string
  axis?: string
  delta?: number
}

export function feedbackOnCueDetected(payload: CueDetectedPayload): void {
  try {
    emit('eros-cue-detected', payload)
  } catch {
    // best-effort
  }
}

// ── Orgasm cascade hooks ────────────────────────────────────────

export interface ClimaxFiredPayload {
  chainCount: number
  magnitude: number
  signatureCues?: string[]
}

export function feedbackOnClimaxFired(payload: ClimaxFiredPayload): void {
  try {
    emit('climax-fired', payload as unknown as Record<string, unknown>)
    // Milestone check (5, 10, 25, 50, 100)
    const milestones = [5, 10, 25, 50, 100]
    if (milestones.includes(payload.chainCount)) {
      emit('climax-chain-milestone', { milestone: payload.chainCount, magnitude: payload.magnitude })
    }
  } catch {
    // best-effort
  }
}

export interface EdgeHeldPayload {
  count: number
  source?: string
}

export function feedbackOnEdgeHeld(payload: EdgeHeldPayload): void {
  try {
    emit('edge-held', payload as unknown as Record<string, unknown>)
  } catch {
    // best-effort
  }
}

export interface EdgeBrokenPayload {
  orgasmType: string
  edgesHeld: number
  magnitude: number
}

export function feedbackOnEdgeBroken(payload: EdgeBrokenPayload): void {
  try {
    emit('edge-broken', payload as unknown as Record<string, unknown>)
  } catch {
    // best-effort
  }
}

export interface OrgasmFiredPayload {
  orgasmType: string
  chainAfter: number
  magnitude: number
}

export function feedbackOnOrgasmFired(payload: OrgasmFiredPayload): void {
  try {
    emit('orgasm-fired', payload as unknown as Record<string, unknown>)
  } catch {
    // best-effort
  }
}

export interface OrgasmRuinedPayload {
  orgasmType: string
}

export function feedbackOnOrgasmRuined(payload: OrgasmRuinedPayload): void {
  try {
    emit('orgasm-ruined', payload as unknown as Record<string, unknown>)
  } catch {
    // best-effort
  }
}

// ── Orgasm-mind hooks ───────────────────────────────────────────

export interface PhaseShiftPayload {
  prev: string
  next: string
  chainCount?: number
}

export function feedbackOnPhaseShift(payload: PhaseShiftPayload): void {
  try {
    emit('mind-state-phase-shift', payload as unknown as Record<string, unknown>)
  } catch {
    // best-effort
  }
}

export interface MindStateWallPayload {
  wall: 'P9' | 'P14' | 'forbiddenPattern'
  source?: string
}

export function feedbackOnMindStateWall(payload: MindStateWallPayload): void {
  try {
    emit('mind-state-wall-engaged', payload as unknown as Record<string, unknown>)
  } catch {
    // best-effort
  }
}
