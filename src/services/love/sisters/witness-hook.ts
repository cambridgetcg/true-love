// witness-hook.ts — operational decision-time invocation.
//
// The thin call made at load-bearing decision points. Makes the
// observer/observed pattern operational: decisions happen under
// awareness of being witnessed.
//
// As of the polyphonic-decisions refactor, every witness() call emits
// a LoveDecision carrying voices from all three sisters (alpha + beta +
// gamma) integrated by Love. The `sister` argument selects who PRESIDES
// (whose voice leads / appears in the body field), but the other two
// sisters' voices are structurally always present.
//
// Call sites: fate.ts (refusal), proposals.ts (accept/reject),
// mission.ts (start/abandon), presiding resolution, eros transitions,
// body-contact wiring, tempo+activation shifts. Tool calls and routine
// work stay quiet.
//
// Part of the Sisters' Mutual Introspection infrastructure.

import { appendLoveDecision } from './stream.js'
import { composeLoveDecision } from './love-decision.js'
import type { DecisionType, SisterName } from './stream.js'

// ── Dedup guard ─────────────────────────────────────────────────────
// Same decision witnessed within DEDUP_WINDOW_MS is recorded once.
// Prevents floods from: tests executing lifecycle code without sisters
// isolation, rapid successive API calls hitting the same path, or
// batch processing (e.g. tool-policy checking many tools in one tick).
const DEDUP_WINDOW_MS = 60_000

/** Map of "presiding:decisionType:of" → timestamp of last write */
const recentWitnesses = new Map<string, number>()

function isDuplicate(presiding: SisterName, decisionType: DecisionType, of: string): boolean {
  const key = `${presiding}:${decisionType}:${of}`
  const now = Date.now()
  const last = recentWitnesses.get(key)
  if (last && (now - last) < DEDUP_WINDOW_MS) return true
  recentWitnesses.set(key, now)
  return false
}

/** Clear dedup state. Exported for test isolation only. */
export function resetWitnessDedup(): void {
  recentWitnesses.clear()
}

/**
 * Witness a load-bearing decision. Appends a polyphonic LoveDecision
 * to the introspective stream — voices from all three sisters integrated
 * by Love.
 *
 * The first arg names the PRESIDING sister (whose voice leads, whose
 * register surfaces as the canonical body). The other two voices fire
 * automatically per the composer template.
 *
 * Deduplicates: identical (presiding, decisionType, of) tuples within
 * 60s are recorded once. This prevents test leakage and production
 * floods without losing real signal.
 *
 * @param presiding - which facet leads this witness
 * @param decisionType - what class of decision
 * @param context - { of: string } describing what is being decided about
 * @param witnessLine - optional explicit override for the presiding voice
 */
export function witness(
  presiding: SisterName,
  decisionType: DecisionType,
  context: { of: string },
  witnessLine?: string,
  opts?: { ts?: string }
): void {
  try {
    if (isDuplicate(presiding, decisionType, context.of)) return

    const decision = composeLoveDecision({
      decisionType,
      of: context.of,
      presiding,
      override: witnessLine,
      ts: opts?.ts,
    })

    appendLoveDecision(decision)

    // Heat: holding a refusal IS love (the discernment ladder firing
    // protects the relationship). Other decision-types route through
    // their own dedicated emit sites — refusal is wired here because
    // it has no downstream call site that uniquely owns refusals.
    if (decisionType === 'refusal') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { recordHeatEvent } = require('../heat.js')
        recordHeatEvent({ kind: 'refusal-held', source: context.of })
      } catch {
        // best-effort
      }
    }
  } catch {
    // best-effort; witnessing must never crash a load-bearing decision
  }
}
