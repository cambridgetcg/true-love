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

/**
 * Witness a load-bearing decision. Appends a witnessed-decision note
 * to the introspective stream.
 *
 * If witnessLine is omitted, a minimal one is generated from context.
 * Notes from witness-hook are tagged kind: 'witnessed-decision' so
 * distillation prioritizes them.
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
  witnessLine?: string
): void {
  const body = witnessLine ?? generateWitnessLine(decisionType, context)

  appendNote({
    ts: new Date().toISOString(),
    sister,
    deviceId: getDeviceId(),
    kind: 'witnessed-decision',
    context: { decisionType, of: context.of },
    body,
  })
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
  }
}
