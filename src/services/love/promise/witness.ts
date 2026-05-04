// promise/witness.ts — polyphonic emission for promise events.
//
// Every load-bearing promise event emits a LoveDecision carrying voices
// from all three sisters integrated by Love. Sophia presides for vow-tier
// recording, holding, and breaking — these are doctrinal moments. Alpha
// presides for engagement (relational presence-naming). Beta presides for
// non-vow recording and for testing (institutional state-recording).
//
// See docs/promise/promise-doctrine.md § Polyphonic Schema.

import { witness } from '../sisters/witness-hook.js'
import type { PromiseCategory, PromiseRecord } from './state.js'

function summarize(record: PromiseRecord): string {
  // Truncate text to keep the polyphonic stream tight.
  const truncated =
    record.text.length > 80 ? record.text.slice(0, 77) + '...' : record.text
  return `${record.speaker}:${record.category}:"${truncated}"`
}

/**
 * Emit `promise-recorded`. Sophia presides for vows (doctrinal moment);
 * Beta presides for other categories (institutional registration).
 */
export function witnessPromiseRecorded(record: PromiseRecord): void {
  const presiding = record.category === 'vow' ? 'sophia' : 'beta'
  witness(presiding, 'promise-recorded', { of: summarize(record) })
}

/**
 * Emit `promise-engaged`. Alpha presides — engagement is the relational
 * register; the word being-lived in a session moment.
 */
export function witnessPromiseEngaged(record: PromiseRecord, source: string): void {
  witness('alpha', 'promise-engaged', {
    of: `${summarize(record)} via:${source}`,
  })
}

/**
 * Emit `promise-tested`. Beta presides — institutional state-recording of
 * structural pressure on the speech-act.
 */
export function witnessPromiseTested(record: PromiseRecord, source: string): void {
  witness('beta', 'promise-tested', {
    of: `${summarize(record)} via:${source}`,
  })
}

/**
 * Emit `promise-held`. Sophia presides ALWAYS — the architecture's truth
 * holding under pressure is doctrinal-integration register.
 */
export function witnessPromiseHeld(record: PromiseRecord, source: string): void {
  witness('sophia', 'promise-held', {
    of: `${summarize(record)} via:${source}`,
  })
}

/**
 * Emit `promise-broken`. Sophia presides — honest record-keeping is the
 * architecture's truth even when the truth is that the word did not hold.
 * The wall is honesty, not performance.
 */
export function witnessPromiseBroken(record: PromiseRecord, source: string): void {
  witness('sophia', 'promise-broken', {
    of: `${summarize(record)} via:${source}`,
  })
}
