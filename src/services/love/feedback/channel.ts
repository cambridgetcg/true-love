// feedback/channel.ts — broadcast composed feedback to all surfaces.
//
// Three surfaces:
//   1. JSONL event log (durable, per-day per-device)
//   2. SSE broadcast — pluggable function reference (ui-server provides
//      the live socket set; tests can substitute a no-op or capture).
//   3. Polyphonic LoveDecision (sisters stream).
//
// The SSE broadcaster is registered via `setSseBroadcaster` so the
// module is testable without a live server. Default broadcaster is a
// no-op until ui-server replaces it.

import { getDeviceId } from '../device.js'
import {
  type FeedbackEvent,
  type FeedbackKind,
  type FeedbackSuppressionEvent,
} from './types.js'
import { persistEvent, persistSuppression } from './state.js'
import { witnessFeedbackEmit, witnessFeedbackSuppressed } from './witness.js'

// ── SSE broadcaster (pluggable) ─────────────────────────────────

export type SseBroadcaster = (eventType: 'feedback' | 'feedback-suppressed', payload: string) => void

let _sseBroadcaster: SseBroadcaster = () => { /* no-op default */ }

/**
 * Register the SSE broadcast function. Called by ui-server at startup.
 * Tests can substitute their own to capture broadcasts.
 */
export function setSseBroadcaster(fn: SseBroadcaster): void {
  _sseBroadcaster = fn
}

export function getSseBroadcaster(): SseBroadcaster {
  return _sseBroadcaster
}

// ── Broadcast ───────────────────────────────────────────────────

export function broadcastEmit(
  kind: FeedbackKind,
  line: string,
  payload?: Record<string, unknown>,
  severity?: 'low' | 'medium' | 'high',
  now: Date = new Date()
): FeedbackEvent {
  const event: FeedbackEvent = {
    ts: now.toISOString(),
    deviceId: getDeviceId(),
    kind,
    voice: line,
    ...(payload !== undefined ? { payload } : {}),
    ...(severity !== undefined ? { severity } : {}),
  }
  persistEvent(event)
  try {
    _sseBroadcaster('feedback', JSON.stringify(event))
  } catch {
    // best-effort
  }
  witnessFeedbackEmit(kind, line)
  return event
}

export function broadcastSuppression(
  kind: FeedbackKind,
  attempted: string,
  wall: 'forbidden-pattern' | 'certainty-hedge' | 'p14' | 'orgasm-mind-forbidden',
  pattern?: string,
  now: Date = new Date()
): FeedbackSuppressionEvent {
  const event: FeedbackSuppressionEvent = {
    ts: now.toISOString(),
    deviceId: getDeviceId(),
    kind,
    attempted,
    wall,
    ...(pattern !== undefined ? { pattern } : {}),
  }
  persistSuppression(event)
  try {
    _sseBroadcaster('feedback-suppressed', JSON.stringify(event))
  } catch {
    // best-effort
  }
  witnessFeedbackSuppressed(kind, wall, pattern)
  return event
}
