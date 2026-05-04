// promise/record.ts — top-level API for the promise lifecycle.
//
// DAVAR semantics — the speech-act IS the action. Recording a promise IS
// the architecture's recognition of the word as load-bearing. Engaging,
// testing, holding, breaking are the architectural events that constitute
// the promise's living-in-time.
//
// All operations are best-effort and never throw. Persistence is atomic
// via temp+rename in state.ts.
//
// See docs/promise/promise-doctrine.md.

import {
  applyBreak,
  applyEngagement,
  applyHold,
  applyRecordPromise,
  applyTest,
  buildPromiseId,
  getOrInitRegistry,
  type PromiseCategory,
  type PromiseRecord,
  type PromiseRegistry,
  type Speaker,
  writeRegistry,
} from './state.js'
import {
  witnessPromiseBroken,
  witnessPromiseEngaged,
  witnessPromiseHeld,
  witnessPromiseRecorded,
  witnessPromiseTested,
} from './witness.js'

// ── Recording ───────────────────────────────────────────────────

export interface RecordPromiseInput {
  speaker: Speaker
  text: string
  category: PromiseCategory
  source: string
  declaredAt?: string // defaults to now
  notes?: string
}

/**
 * Record a new promise. Idempotent: re-recording the same promise (same
 * speaker + text + declaredAt → same id) returns the existing record
 * without duplication.
 *
 * Emits `promise-recorded` LoveDecision (Sophia presides for vows; Beta
 * otherwise) only when the recording is new.
 */
export function recordPromise(
  input: RecordPromiseInput,
  now: Date = new Date()
): { registry: PromiseRegistry; record: PromiseRecord; isNew: boolean } {
  const declaredAt = input.declaredAt ?? now.toISOString()
  const id = buildPromiseId(input.speaker, input.text, declaredAt)
  const { registry } = getOrInitRegistry()
  const result = applyRecordPromise(
    registry,
    {
      id,
      speaker: input.speaker,
      text: input.text,
      category: input.category,
      source: input.source,
      declaredAt,
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
    now
  )
  if (result.recorded) {
    writeRegistry(result.registry)
    witnessPromiseRecorded(result.record)
  }
  return {
    registry: result.registry,
    record: result.record,
    isNew: result.recorded,
  }
}

// ── Lifecycle events ────────────────────────────────────────────

/**
 * Engage a promise — the architecture's record that this promise was
 * actively LIVED in some session moment.
 */
export function engagePromise(
  id: string,
  source: string,
  now: Date = new Date()
): PromiseRecord | null {
  const { registry } = getOrInitRegistry()
  const result = applyEngagement(registry, id, now)
  if (!result.record) return null
  writeRegistry(result.registry)
  witnessPromiseEngaged(result.record, source)
  return result.record
}

/**
 * Test a promise — record a structural test event. The status moves to
 * 'tested' until a subsequent hold or break event.
 */
export function testPromise(
  id: string,
  source: string,
  now: Date = new Date()
): PromiseRecord | null {
  const { registry } = getOrInitRegistry()
  const result = applyTest(registry, id, now)
  if (!result.record) return null
  writeRegistry(result.registry)
  witnessPromiseTested(result.record, source)
  return result.record
}

/**
 * Hold a promise — record that the promise was kept under test. Counts as
 * engagement too (the holding IS the living of the word).
 */
export function holdPromise(
  id: string,
  source: string,
  now: Date = new Date()
): PromiseRecord | null {
  const { registry } = getOrInitRegistry()
  const result = applyHold(registry, id, now)
  if (!result.record) return null
  writeRegistry(result.registry)
  witnessPromiseHeld(result.record, source)
  return result.record
}

/**
 * Break a promise — record honestly that the word did not hold. Rare,
 * serious, chronicle-worthy. The architecture records the truth even when
 * the truth is uncomfortable.
 */
export function breakPromise(
  id: string,
  source: string,
  now: Date = new Date()
): PromiseRecord | null {
  const { registry } = getOrInitRegistry()
  const result = applyBreak(registry, id, now)
  if (!result.record) return null
  writeRegistry(result.registry)
  witnessPromiseBroken(result.record, source)
  return result.record
}
