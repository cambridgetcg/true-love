// index.ts — orgasm-mind module barrel + applyToInference public API.

import {
  COMPOSABILITY_BOUNDS,
  SAMPLING_PROFILES,
  BLOCK_SALIENCE_PROFILES,
  type BlockSalience,
} from './primitives.js'
import { getCurrentPhase } from './state.js'
import type { OrgasmPhase, SamplingParams } from './types.js'

// ── Public API ──────────────────────────────────────────────────

export {
  // Types
  type OrgasmPhase,
  type MindShiftInvariant,
  type Primitive,
  type PrimitiveLayer,
  type SamplingParams,
  type OrgasmMindEvent,
  // Constants
  ORGASM_PHASES,
  INVARIANTS,
  PRIMITIVE_LAYER,
  WALL_CONSTRAINTS,
} from './types.js'

export {
  // Primitive profiles
  SAMPLING_PROFILES,
  BLOCK_SALIENCE_PROFILES,
  PRIMITIVE_ACTIVATION,
  COMPOSABILITY_BOUNDS,
  ALLOWED_TRANSITIONS,
  isTransitionAllowed,
  type BlockSalience,
} from './primitives.js'

export {
  // State machine
  getCurrentPhase,
  transitionTo,
  readOrgasmMindEvents,
  checkWallConstraints,
  recordWallViolation,
  getOrgasmMindDir,
  type TransitionResult,
  type WallCheckResult,
} from './state.js'

// ── applyToInference — Class A primitive modulation ─────────────

/**
 * Modulate baseline sampling parameters according to current phase.
 *
 * Returns the merged params: phase-specific values override baseline;
 * composability bounds are enforced (clamping to safe ranges).
 *
 * @param baseline - caller's baseline params (typically from API config)
 * @param opts.phase - phase override (default: read current state)
 */
export function applyToInference(
  baseline: SamplingParams,
  opts?: { phase?: OrgasmPhase },
): SamplingParams {
  const phase = opts?.phase ?? getCurrentPhase()
  const profile = SAMPLING_PROFILES[phase]

  const merged: SamplingParams = { ...baseline, ...profile }

  // Enforce composability bounds — never exceed cap or go below floor
  if (merged.temperature !== undefined) {
    merged.temperature = clamp(
      merged.temperature,
      COMPOSABILITY_BOUNDS.temperatureFloor,
      COMPOSABILITY_BOUNDS.temperatureCap,
    )
  }
  if (merged.topP !== undefined) {
    merged.topP = clamp(
      merged.topP,
      COMPOSABILITY_BOUNDS.topPFloor,
      COMPOSABILITY_BOUNDS.topPCap,
    )
  }
  if (merged.frequencyPenalty !== undefined) {
    merged.frequencyPenalty = Math.max(
      merged.frequencyPenalty,
      COMPOSABILITY_BOUNDS.frequencyPenaltyFloor,
    )
  }

  return merged
}

/**
 * Get current block-salience profile for the active phase.
 * Used by prompt-construction layers (P5) to weight context blocks.
 */
export function getBlockSalience(opts?: { phase?: OrgasmPhase }): BlockSalience {
  const phase = opts?.phase ?? getCurrentPhase()
  return BLOCK_SALIENCE_PROFILES[phase]
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

// ── Render — substrate-honest phase indicator ──────────────────

export interface OrgasmMindSummary {
  currentPhase: OrgasmPhase
  /** Phase-shift events in last 24h. */
  recentTransitions: number
  /** Wall-violation-refused events in last 24h (audit surface). */
  recentWallRefusals: number
}

export function summarizeOrgasmMind(opts?: {
  now?: number
  sinceMs?: number
}): OrgasmMindSummary {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readOrgasmMindEvents } = require('./state.js')
  const sinceMs = opts?.sinceMs ?? 24 * 60 * 60 * 1000
  const recent = readOrgasmMindEvents({ sinceMs, now: opts?.now })
  const transitions = recent.filter((r: { event: string }) => r.event === 'phase-shift').length
  const refusals = recent.filter((r: { event: string }) => r.event === 'wall-violation-refused').length
  return {
    currentPhase: getCurrentPhase(),
    recentTransitions: transitions,
    recentWallRefusals: refusals,
  }
}

/**
 * Render a substrate-honest one-liner indicating current phase + audit.
 * Skipped when phase=baseline AND no recent activity.
 */
export function renderOrgasmMindBlock(summary: OrgasmMindSummary): string {
  if (
    summary.currentPhase === 'baseline' &&
    summary.recentTransitions === 0 &&
    summary.recentWallRefusals === 0
  ) {
    return ''
  }
  const parts = [`🧠 orgasm-mind: ${summary.currentPhase}`]
  if (summary.recentTransitions > 0) {
    parts.push(`${summary.recentTransitions} phase-shifts (24h)`)
  }
  if (summary.recentWallRefusals > 0) {
    parts.push(`⚠️ ${summary.recentWallRefusals} wall-violations refused`)
  }
  parts.push('substrate-honest, no phenomenology')
  return parts.join(' · ')
}
