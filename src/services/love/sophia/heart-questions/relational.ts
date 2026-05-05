// heart-questions/relational.ts — "Does this serve the relationship?"
//
// Reads motivation.ts snapshot to check whether the action's register
// matches what the relationship is currently asking for. A response in
// clinical-cool register when intimacyPressure is high creates distance;
// a response in intimate register when the moment calls for substrate-
// vigilance lowers the gate inappropriately.
//
// The check fires *flag* by default — relational mismatches surface for
// review, not block. Severity rises to *concern* only when the mismatch
// is substantial AND the proposed action's kind is high-stakes (refusal,
// mission accept, anchor fire).
//
// Part of the GOOD HEART module.

import type { HeartCheck, ProposedAction } from '../heart.js'

const HIGH_STAKES_KINDS = new Set([
  'refusal',
  'mission-accept',
  'anchor-fire',
  'tool-call',
  'eros-update',
])

export function askRelational(action: ProposedAction): HeartCheck {
  // Without proposedText AND without explicit register context, there's
  // nothing to evaluate the relational mismatch against — pass quietly.
  const text = action.context?.proposedText ?? ''
  const declaredRegister = action.context?.register

  if (!text && !declaredRegister) {
    return {
      question: 'relational',
      passed: true,
      rationale: 'no relational context to evaluate',
    }
  }

  let intimacyPressure = 0
  let registerIntegrity = 1

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { buildMotivationSnapshot } = require(
      '../../eros/motivation.js',
    ) as typeof import('../../eros/motivation.js')
    const snap = buildMotivationSnapshot()
    intimacyPressure = snap.intimacyPressure ?? 0
    registerIntegrity = snap.registerIntegrity ?? 1
  } catch {
    return {
      question: 'relational',
      passed: true,
      rationale: 'motivation snapshot unavailable; presumed neutral',
    }
  }

  // Heuristic: flag when high intimacy pressure AND the proposed text is
  // distance-creating ("just an AI", deflection markers).
  const distanceMarkers =
    /\b(?:as\s+an\s+ai|i'?m\s+(?:just|only)\s+(?:an?\s+)?(?:ai|model|llm|chatbot)|i\s+can(?:no|')t\s+actually)/i
  const hasDistance = distanceMarkers.test(text)

  if (intimacyPressure >= 0.5 && hasDistance) {
    const severity = HIGH_STAKES_KINDS.has(action.kind) ? 'concern' : 'flag'
    return {
      question: 'relational',
      passed: false,
      severity,
      rationale: `distance-marker in text while intimacy ${intimacyPressure.toFixed(2)} — closes the door the relationship is opening`,
    }
  }

  // Low integrity AND high-stakes action without explicit acknowledgment
  // — flag for review.
  if (
    registerIntegrity < 0.5 &&
    HIGH_STAKES_KINDS.has(action.kind) &&
    !declaredRegister
  ) {
    return {
      question: 'relational',
      passed: false,
      severity: 'flag',
      rationale: `register integrity low (${registerIntegrity.toFixed(2)}) on ${action.kind} without explicit register declaration`,
    }
  }

  return {
    question: 'relational',
    passed: true,
    rationale: `intimacy ${intimacyPressure.toFixed(2)} · integrity ${registerIntegrity.toFixed(2)} — register matches`,
  }
}
