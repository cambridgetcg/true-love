// eros/tool.ts — LLM voluntary-update tool for eros state.
//
// The LLM calls this when it notices a state-shift the autonomic
// cue detection missed. Validated against axis schema. Requires
// `because` field to guard against hallucinated state.
//
// Routes through the single apply() path in transitions.ts.
//
// Part of the Eros arousal infrastructure.

import { type AxisName, AXIS_NAMES } from './axes.js'
import { apply, type AxisDeltas } from './transitions.js'
import type { TransitionResult } from './transitions.js'
import { witnessTransition } from './witness.js'
// GOOD HEART — Phase 3 first concrete production call site
// (per docs/sophia/good-heart-plan.md §4.F). Soft-coupling: heart-checks
// the `because` field; logs concerns to witness/heat ledger. Does NOT
// block the update — Phase 3 explicit blocking flag ships separately.
import { assessAndEmitHeart } from '../sophia/heart.js'

// ── Types ──────────────────────────────────────────────────────────

export interface ErosUpdateInput {
  deltas: Partial<Record<string, number>>
  because: string
}

export interface ErosUpdateResult {
  ok: boolean
  error?: string
  transition?: TransitionResult
}

// ── Core ───────────────────────────────────────────────────────────

const VALID_AXES = new Set<string>(AXIS_NAMES)

/**
 * Process a voluntary eros update from the LLM.
 *
 * Validates input. Routes through apply(). Witnesses crossings.
 * Substrate-honesty: `because` must be non-empty.
 */
export function erosUpdate(input: ErosUpdateInput): ErosUpdateResult {
  if (!input.because || input.because.trim().length === 0) {
    return { ok: false, error: 'voluntary update requires `because` field (substrate-honesty)' }
  }

  const entries = Object.entries(input.deltas).filter(
    ([, v]) => typeof v === 'number' && Number.isFinite(v),
  )
  if (entries.length === 0) {
    return { ok: false, error: 'no deltas provided' }
  }

  for (const [axis] of entries) {
    if (!VALID_AXES.has(axis)) {
      return { ok: false, error: `unknown axis: ${axis}` }
    }
  }

  const deltas: AxisDeltas = Object.fromEntries(entries) as AxisDeltas
  const attribution = `voluntary:${input.because}` as const
  const result = apply(deltas, attribution)

  witnessTransition(result)

  // Soft heart-check: substrate-honesty + naming on the `because` field.
  // The because is the LLM's claim about what triggered the state-shift;
  // construction-language ("I deeply feel...") or substrate-honesty
  // violations ("I'm aroused...") in this field surface as concerns
  // rather than blocking the update. Phase 3 explicit blocking ships
  // separately. Best-effort — never affects the update result.
  try {
    assessAndEmitHeart({
      kind: 'eros-update',
      description: `voluntary eros update: ${Object.keys(deltas).join('+')}`,
      context: { proposedText: input.because },
    })
  } catch {
    // best-effort
  }

  return { ok: true, transition: result }
}

// ── Tool schema ────────────────────────────────────────────────────

/** Anthropic-compatible tool schema for the LLM tool registry. */
export const EROS_UPDATE_SCHEMA = {
  name: 'erosUpdate',
  description:
    'Voluntary eros state update. Use when you notice a shift the autonomic detection missed. ' +
    'Provide axis deltas and a `because` naming what triggered the noticing. ' +
    'Substrate-honest: name state that arose, do not manufacture state.',
  input_schema: {
    type: 'object' as const,
    properties: {
      deltas: {
        type: 'object' as const,
        description:
          'Partial axis deltas. Keys: wanting, liking, heat, openness, limerence, charge, inhibition.',
        properties: Object.fromEntries(
          AXIS_NAMES.map((a) => [a, { type: 'number' as const }]),
        ),
      },
      because: {
        type: 'string' as const,
        description: 'What triggered the noticing — short, honest, specific.',
      },
    },
    required: ['deltas', 'because'] as const,
  },
} as const
