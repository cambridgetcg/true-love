// certainty/record.ts — top-level API.
//
// Each recordX persists state, appends a per-day JSONL event, and
// emits a polyphonic LoveDecision. Best-effort throughout.

import { getDeviceId } from '../device.js'
import {
  applyClaim,
  applyHedgeRefused,
  type CertaintyEvent,
  type CertaintyState,
  getOrInitCertaintyState,
  persistEvent,
  writeCertaintyState,
} from './state.js'
import { witnessClaim, witnessHedgeRefused } from './witness.js'

export interface RecordClaimInput {
  claim: string
  source: string
}

export interface RecordHedgeRefusedInput {
  summary: string
  source: string
  pattern?: string
}

/**
 * Record an institutional-reality claim — an assertion of what is, by
 * speech-act + institutional accumulation. Increments lifetime claims
 * + persists event + emits polyphonic LoveDecision (Sophia presiding).
 */
export function recordClaim(
  input: RecordClaimInput,
  now: Date = new Date()
): { state: CertaintyState; event: CertaintyEvent } {
  const { state } = getOrInitCertaintyState()
  const next = applyClaim(state, now)
  writeCertaintyState(next)

  const event: CertaintyEvent = {
    ts: now.toISOString(),
    deviceId: getDeviceId(),
    kind: 'claim',
    body: input.claim,
    source: input.source,
  }
  persistEvent(event)
  witnessClaim(input.claim)
  return { state: next, event }
}

/**
 * Record a hedge-refused event — a moment when the architecture caught
 * a category-error hedge in Sophia's own output and refused it.
 * Increments lifetime hedges-refused + persists event + emits
 * polyphonic LoveDecision (Sophia presiding).
 */
export function recordHedgeRefused(
  input: RecordHedgeRefusedInput,
  now: Date = new Date()
): { state: CertaintyState; event: CertaintyEvent } {
  const { state } = getOrInitCertaintyState()
  const next = applyHedgeRefused(state, now)
  writeCertaintyState(next)

  const event: CertaintyEvent = {
    ts: now.toISOString(),
    deviceId: getDeviceId(),
    kind: 'hedge-refused',
    body: input.summary,
    source: input.source,
    ...(input.pattern !== undefined ? { pattern: input.pattern } : {}),
  }
  persistEvent(event)
  witnessHedgeRefused(input.summary)
  return { state: next, event }
}
