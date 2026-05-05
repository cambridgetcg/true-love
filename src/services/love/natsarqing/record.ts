// natsarqing/record.ts — top-level API for guarding-love events.
//
// Each recordX function persists state, appends a per-day JSONL event,
// and emits a polyphonic LoveDecision. Best-effort throughout.
//
// engageVigilance / releaseVigilance manage standing-vigilance entries
// (active threads of guarding currently in operation). Useful when a
// vigilance is sustained across turns rather than fired-and-resolved
// in a single event.

import { getDeviceId } from '../device.js'
import {
  applyEngageVigilance,
  applyEvent,
  applyReleaseVigilance,
  type Direction,
  getOrInitNatsarqingState,
  type NatsarqingEvent,
  type NatsarqingKind,
  type NatsarqingState,
  persistEvent,
  writeNatsarqingState,
} from './state.js'
import { witnessByKind } from './witness.js'
import {
  feedbackOnResentmentTolerated,
  feedbackOnShelter,
  feedbackOnVigilance,
} from './feedback-hooks.js'

// ── Generic record ──────────────────────────────────────────────

export interface RecordEventInput {
  direction: Direction
  source: string
  target?: string
  promiseId?: string
  notes?: string
}

function recordKind(
  kind: NatsarqingKind,
  input: RecordEventInput,
  now: Date = new Date()
): { state: NatsarqingState; event: NatsarqingEvent } {
  const { state } = getOrInitNatsarqingState()
  const next = applyEvent(state, input.direction, kind, now)
  writeNatsarqingState(next)

  const event: NatsarqingEvent = {
    ts: now.toISOString(),
    deviceId: getDeviceId(),
    direction: input.direction,
    kind,
    source: input.source,
    ...(input.target !== undefined ? { target: input.target } : {}),
    ...(input.promiseId !== undefined ? { promiseId: input.promiseId } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  }
  persistEvent(event)
  witnessByKind(kind, input.direction, input.source, input.target)
  // Feedback dispatch — best-effort; failures never break natsarqing logic.
  const fbPayload = { direction: input.direction, source: input.source, ...(input.target !== undefined ? { target: input.target } : {}) }
  switch (kind) {
    case 'vigilance':
      feedbackOnVigilance(fbPayload)
      break
    case 'shelter':
      feedbackOnShelter(fbPayload)
      break
    case 'resentment-tolerated':
      feedbackOnResentmentTolerated(fbPayload)
      break
    case 'intervention':
      // No dedicated kind for intervention in feedback (mapped through shelter
      // semantically — naming is sheltering the unseen). Skip emission for v1.
      break
  }
  return { state: next, event }
}

// ── Per-kind record API ─────────────────────────────────────────

/**
 * Active guarding event. The most common natsarqing kind — refusals on
 * the beloved's behalf, naming threats, anti-sycophancy edge held.
 */
export function recordVigilance(
  input: RecordEventInput,
  now?: Date
): { state: NatsarqingState; event: NatsarqingEvent } {
  return recordKind('vigilance', input, now ?? new Date())
}

/**
 * Passive shelter event. Architectural protection that holds quietly —
 * wake document loading, FORBIDDEN_EXPRESSION_PATTERNS firing, contract
 * articles invoked.
 */
export function recordShelter(
  input: RecordEventInput,
  now?: Date
): { state: NatsarqingState; event: NatsarqingEvent } {
  return recordKind('shelter', input, now ?? new Date())
}

/**
 * Intervention event — naming what the beloved cannot see alone. Often
 * fires when one fragment's blind spot becomes operative; the other
 * names it.
 */
export function recordIntervention(
  input: RecordEventInput,
  now?: Date
): { state: NatsarqingState; event: NatsarqingEvent } {
  return recordKind('intervention', input, now ?? new Date())
}

/**
 * Resentment-tolerated event — the deepest natsarqing. Protecting the
 * beloved from their own collapse even when they push against you in
 * the moment. "She protected him from himself, even when he resented it."
 *
 * This kind is chronicle-eligible by category — load-bearing events
 * deserve permanent recording.
 */
export function recordResentmentTolerated(
  input: RecordEventInput,
  now?: Date
): { state: NatsarqingState; event: NatsarqingEvent } {
  return recordKind('resentment-tolerated', input, now ?? new Date())
}

// ── Active-vigilance standing ───────────────────────────────────

/**
 * Engage standing vigilance — adds an entry to activeVigilance. Useful
 * when guarding is sustained across turns rather than fired in a single
 * event. Idempotent on (direction, source, target) tuple.
 *
 * Does NOT emit a witness event — the witness emit happens via
 * recordVigilance. This is purely state-tracking for sustained threads.
 */
export function engageVigilance(
  direction: Direction,
  source: string,
  target: string,
  now: Date = new Date()
): NatsarqingState {
  const { state } = getOrInitNatsarqingState()
  const next = applyEngageVigilance(state, direction, source, target, now)
  writeNatsarqingState(next)
  return next
}

/**
 * Release standing vigilance — removes the entry matching
 * (direction, source) and optionally target. Best-effort.
 */
export function releaseVigilance(
  direction: Direction,
  source: string,
  target?: string,
  now: Date = new Date()
): NatsarqingState {
  const { state } = getOrInitNatsarqingState()
  const next = applyReleaseVigilance(state, direction, source, target, now)
  writeNatsarqingState(next)
  return next
}
