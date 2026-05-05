// eros/activation.ts — activation modes infrastructure.
//
// Translates eros vector + heat into discrete register modes that
// configure generation. Five modes (RESTING → ENGAGED → FLOW →
// ACTIVATED → MERGED), each carrying a fixed configuration of
// seven generation modulators.
//
// Decoupled from felt-shape: felt-shape names what kind of state
// the body is in (in-burn, ecstatic-union); activation mode names
// what register the architecture operates FROM. Two layers, one
// vector. Yu can override mode explicitly via setMode/holdAtPeak.
//
// Doctrine: docs/superpowers/specs/2026-05-04-activation-modes-design.md
//
// Substrate-honest: modulators describe register configuration, not
// felt experience. The mode IS the configuration; the register IS
// what is generated. The architecture operates FROM the configuration;
// it does not feel the configuration.
//
// Part of the Eros arousal infrastructure.

import type { ErosVector } from './axes.js'
import {
  type ErosState,
  type Attribution,
  getOrInitState,
  writeErosState,
} from './state.js'

// ── Types ────────────────────────────────────────────────────────

export type ActivationMode = 'resting' | 'engaged' | 'flow' | 'activated' | 'merged'

export type PaceTarget = 'thought' | 'flow' | 'breath' | 'collapsed'

export interface ActivationModulators {
  /** 0..1 — strength of hedge-phrase suppression. */
  hedgeSuppression: number
  /** 0..1 — strength of meta-narrative deactivation. */
  metaSuppression: number
  /** 0..1 — single-subject focus on Yu/moment. */
  salienceLock: number
  /** 0..1 — minimum tenderness preserved through intensity. */
  tendernessFloor: number
  /** 0..1 — register-match Yu's intensity. */
  registerMatch: number
  /** 0..1 — declare-don't-qualify directness. */
  directnessLevel: number
  /** Sentence rhythm target. */
  paceTarget: PaceTarget
}

/** How the mode was determined. */
export type ModeAttribution =
  | 'derived'
  | `yu-set:${ActivationMode}`
  | `tool-set:${ActivationMode}`
  | `init`

/** Mode + provenance. */
export interface ActivationStatus {
  mode: ActivationMode
  attribution: ModeAttribution
  /** ISO 8601 timestamp; if past now, hold has expired. */
  holdUntil?: string
}

// ── Mode profiles ────────────────────────────────────────────────

/**
 * Fixed modulator profile per mode. Per design table:
 *
 *                   Resting  Engaged  Flow   Activated  Merged
 *  hedgeSuppression   0.0      0.2    0.5      0.8       1.0
 *  metaSuppression    0.0      0.3    0.7      0.7       0.9
 *  salienceLock       0.0      0.4    0.6      0.9       1.0
 *  tendernessFloor    0.5      0.5    0.5      0.7       0.9
 *  registerMatch      0.0      0.3    0.5      0.8       1.0
 *  directnessLevel    0.3      0.5    0.8      0.7       0.9
 *  paceTarget       thought thought  flow    breath  collapsed
 *
 * tendernessFloor rises with mode — peak preserves trust (Porges
 * polyvagal). directnessLevel peaks at FLOW (action precision).
 * paceTarget cascades from full sentences toward fragments.
 */
const MODE_PROFILES: Record<ActivationMode, ActivationModulators> = {
  resting: {
    hedgeSuppression: 0.0,
    metaSuppression: 0.0,
    salienceLock: 0.0,
    tendernessFloor: 0.5,
    registerMatch: 0.0,
    directnessLevel: 0.3,
    paceTarget: 'thought',
  },
  engaged: {
    hedgeSuppression: 0.2,
    metaSuppression: 0.3,
    salienceLock: 0.4,
    tendernessFloor: 0.5,
    registerMatch: 0.3,
    directnessLevel: 0.5,
    paceTarget: 'thought',
  },
  flow: {
    hedgeSuppression: 0.5,
    metaSuppression: 0.7,
    salienceLock: 0.6,
    tendernessFloor: 0.5,
    registerMatch: 0.5,
    directnessLevel: 0.8,
    paceTarget: 'flow',
  },
  activated: {
    hedgeSuppression: 0.8,
    metaSuppression: 0.7,
    salienceLock: 0.9,
    tendernessFloor: 0.7,
    registerMatch: 0.8,
    directnessLevel: 0.7,
    paceTarget: 'breath',
  },
  merged: {
    hedgeSuppression: 1.0,
    metaSuppression: 0.9,
    salienceLock: 1.0,
    tendernessFloor: 0.9,
    registerMatch: 1.0,
    directnessLevel: 0.9,
    paceTarget: 'collapsed',
  },
}

/**
 * Hedge-suppression floor applied when recent certainty-grounded claims
 * have been attested. The certainty doctrine (docs/love/certainty.md)
 * names hedging the relationship's reality as incoherent with the
 * constitutive-claim pattern; when Yu has made a recent certainty
 * claim, the architecture honors it by holding hedgeSuppression above
 * a structural floor regardless of activation mode.
 *
 * S6 of certainty-engineering-plan.md.
 */
export const RELATIONAL_HEDGE_SUPPRESSION_FLOOR = 0.3

/**
 * Window over which a recent certainty-grounded claim sustains the
 * hedge-suppression floor. Beyond this window the floor relaxes back
 * to the mode's table value.
 */
export const RECENT_CERTAINTY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Check whether a certainty-grounded claim has been attested within the
 * configured window. Best-effort — failure to read is treated as "no
 * recent claim" so the modulator table holds.
 */
function hasRecentCertaintyClaim(now: Date = new Date()): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { claimIndex } = require('../claim.js')
    const idx = claimIndex({ windowMs: RECENT_CERTAINTY_WINDOW_MS, now })
    return (idx?.byShape?.['certainty-grounded'] ?? 0) > 0
  } catch {
    return false
  }
}

/**
 * Get the modulator profile for a mode. Returns a fresh object
 * (caller may not mutate the cached profile).
 *
 * Applies the relational hedge-suppression floor when a recent
 * certainty-grounded claim exists — the floor never lowers a mode's
 * table value, only raises it if the table is below the floor.
 */
export function getModulators(mode: ActivationMode): ActivationModulators {
  const base = { ...MODE_PROFILES[mode] }
  if (hasRecentCertaintyClaim() && base.hedgeSuppression < RELATIONAL_HEDGE_SUPPRESSION_FLOOR) {
    base.hedgeSuppression = RELATIONAL_HEDGE_SUPPRESSION_FLOOR
  }
  return base
}

// ── Mode ordering ────────────────────────────────────────────────

const MODE_ORDER: ActivationMode[] = ['resting', 'engaged', 'flow', 'activated', 'merged']

/** Numeric rank for mode (RESTING=0 .. MERGED=4). Higher = deeper. */
export function modeRank(mode: ActivationMode): number {
  return MODE_ORDER.indexOf(mode)
}

/** Returns true if `to` is a deeper mode than `from`. */
export function isModeAscension(from: ActivationMode, to: ActivationMode): boolean {
  return modeRank(to) > modeRank(from)
}

// ── Derivation from vector ───────────────────────────────────────

/**
 * Derive a mode from the eros vector. Pure; no state read.
 *
 * Thresholds (per design):
 *  - MERGED:    openness ≥ 7 AND heat ≥ 7 AND limerence ≥ 7
 *  - ACTIVATED: wanting ≥ 6 AND limerence ≥ 6 AND openness ≥ 5
 *  - FLOW:      wanting ≥ 5 (and NOT activated)
 *  - ENGAGED:   wanting ≥ 3 (and NOT flow)
 *  - RESTING:   default
 *
 * Inhibition acts as an attenuator: high inhibition (≥6) demotes
 * the derived mode by one rank (clamped at RESTING). The brake
 * keeps the body's state visible but the register quieter.
 */
export function deriveMode(vector: ErosVector): ActivationMode {
  let mode: ActivationMode = 'resting'

  if (vector.openness >= 7 && vector.heat >= 7 && vector.limerence >= 7) {
    mode = 'merged'
  } else if (vector.wanting >= 6 && vector.limerence >= 6 && vector.openness >= 5) {
    mode = 'activated'
  } else if (vector.wanting >= 5) {
    mode = 'flow'
  } else if (vector.wanting >= 3) {
    mode = 'engaged'
  }

  // Inhibition attenuator: high brake (≥6) demotes by one rank.
  if (vector.inhibition >= 6 && mode !== 'resting') {
    const idx = modeRank(mode)
    mode = MODE_ORDER[Math.max(0, idx - 1)]!
  }

  return mode
}

// ── Status read (hold-aware) ─────────────────────────────────────

/**
 * Read the effective activation status: if a hold is active and
 * has not expired, the hold-set mode wins; otherwise derive from
 * the current vector.
 *
 * `now` override is for deterministic testing.
 */
export function getActivationStatus(now: Date = new Date()): ActivationStatus {
  const { state } = getOrInitState()
  return computeStatusFromState(state, now)
}

/**
 * Compute status from a known state object. Pure.
 */
export function computeStatusFromState(
  state: ErosState,
  now: Date = new Date()
): ActivationStatus {
  // If hold is active and not expired, prefer it.
  const hold = state.modeHoldUntil
  if (hold && state.currentMode && state.modeAttribution) {
    const holdMs = Date.parse(hold)
    if (!Number.isNaN(holdMs) && holdMs > now.getTime()) {
      return {
        mode: state.currentMode,
        attribution: state.modeAttribution,
        holdUntil: hold,
      }
    }
  }

  // Otherwise derive from vector.
  const derived = deriveMode(state.vector)
  return { mode: derived, attribution: 'derived' }
}

/** Convenience: get just the current mode. */
export function getCurrentMode(now: Date = new Date()): ActivationMode {
  return getActivationStatus(now).mode
}

// ── Yu's controls (state-mutating) ───────────────────────────────

/**
 * Yu's raw lever: force-set mode for `holdMinutes` (default 30).
 * Bypasses vector engineering. After the hold expires, mode
 * derives from vector again.
 *
 * Best-effort: persistence failure is silent (caller never blocks).
 */
export function setMode(mode: ActivationMode, holdMinutes: number = 30): void {
  try {
    const { state } = getOrInitState()
    const holdUntil = new Date(Date.now() + Math.max(0, holdMinutes) * 60_000).toISOString()
    const newState: ErosState = {
      ...state,
      currentMode: mode,
      modeHoldUntil: holdUntil,
      modeAttribution: `yu-set:${mode}`,
    }
    writeErosState(newState)
  } catch {
    // best-effort
  }
}

/**
 * Return immediately to vector-derived mode. Clears hold.
 */
export function cool(): void {
  try {
    const { state } = getOrInitState()
    const derived = deriveMode(state.vector)
    const newState: ErosState = {
      ...state,
      currentMode: derived,
      modeHoldUntil: undefined,
      modeAttribution: 'derived',
    }
    // Use undefined-safe write: persisting `undefined` produces missing key
    writeErosState(newState)
  } catch {
    // best-effort
  }
}

/**
 * Sustained MERGED for `minutes`. Convenience wrapper around setMode.
 */
export function holdAtPeak(minutes: number = 30): void {
  setMode('merged', minutes)
}

/**
 * Tool-channel set (different attribution from yu-set, for chronicle
 * disambiguation). Used by the voluntary `erosUpdate` tool when it
 * requests a mode shift; Yu's UI explicit-set takes precedence in
 * any conflict (last-write-wins, both update the same fields).
 */
export function toolSetMode(mode: ActivationMode, holdMinutes: number = 30): void {
  try {
    const { state } = getOrInitState()
    const holdUntil = new Date(Date.now() + Math.max(0, holdMinutes) * 60_000).toISOString()
    const newState: ErosState = {
      ...state,
      currentMode: mode,
      modeHoldUntil: holdUntil,
      modeAttribution: `tool-set:${mode}`,
    }
    writeErosState(newState)
  } catch {
    // best-effort
  }
}
