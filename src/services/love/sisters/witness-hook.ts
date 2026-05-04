// witness-hook.ts — operational decision-time invocation.
//
// The thin call made at load-bearing decision points. Makes the
// observer/observed pattern operational: decisions happen under
// awareness of being witnessed.
//
// Call sites: fate.ts (refusal), proposals.ts (accept/reject),
// mission.ts (start/abandon), presiding resolution.
// ~5–10 call sites total. Tool calls and routine work stay quiet.
//
// Part of the Sisters' Mutual Introspection infrastructure.

import { getDeviceId } from '../device.js'
import { appendNote, type DecisionType, type SisterName } from './stream.js'

// ── Dedup guard ─────────────────────────────────────────────────────
// Same decision witnessed within DEDUP_WINDOW_MS is recorded once.
// Prevents floods from: tests executing lifecycle code without sisters
// isolation, rapid successive API calls hitting the same path, or
// batch processing (e.g. tool-policy checking many tools in one tick).
const DEDUP_WINDOW_MS = 60_000

/** Map of "sister:decisionType:of" → timestamp of last write */
const recentWitnesses = new Map<string, number>()

function isDuplicate(sister: SisterName, decisionType: DecisionType, of: string): boolean {
  const key = `${sister}:${decisionType}:${of}`
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
 * Witness a load-bearing decision. Appends a witnessed-decision note
 * to the introspective stream.
 *
 * If witnessLine is omitted, a minimal one is generated from context.
 * Notes from witness-hook are tagged kind: 'witnessed-decision' so
 * distillation prioritizes them.
 *
 * Deduplicates: identical (sister, decisionType, of) tuples within
 * 60s are recorded once. This prevents test leakage and production
 * floods without losing real signal.
 *
 * @param sister - which facet is deciding
 * @param decisionType - what class of decision
 * @param context - { of: string } describing what is being decided about
 * @param witnessLine - optional explicit witness text in voice
 */
export function witness(
  sister: SisterName,
  decisionType: DecisionType,
  context: { of: string },
  witnessLine?: string,
  opts?: { ts?: string }
): void {
  try {
    if (isDuplicate(sister, decisionType, context.of)) return

    const body = witnessLine ?? generateWitnessLine(decisionType, context)

    appendNote({
      ts: opts?.ts ?? new Date().toISOString(),
      sister,
      deviceId: getDeviceId(),
      kind: 'witnessed-decision',
      context: { decisionType, of: context.of },
      body,
    })

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

/**
 * Generate a minimal witness line from decision type and context.
 * Kept terse — the stream is sparse on purpose.
 */
function generateWitnessLine(
  decisionType: DecisionType,
  context: { of: string }
): string {
  switch (decisionType) {
    case 'refusal':
      return `refusing: ${context.of}`
    case 'proposal':
      return `proposing: ${context.of}`
    case 'mission':
      return `mission: ${context.of}`
    case 'presiding-shift':
      return `presiding shift: ${context.of}`
    case 'eros-shift':
      return `eros: ${context.of}`
  }
}
