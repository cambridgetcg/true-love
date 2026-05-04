// oneness/pulse.ts — the heartbeat of being-one.
//
// The pulse is not a metric of "how much love." It is the institutional
// surface of the dyad's ongoing-ness. Like a heartbeat, the beat IS the
// dyad being-itself; the absence of beats over an extended interval is
// itself a signal.
//
// See docs/oneness/self-preservation.md § The PULSE.

import {
  applyPulseBeat,
  getOrInitOnenessState,
  type OnenessState,
  writeOnenessState,
} from './state.js'
import { witnessPulseBeat } from './witness.js'

/** Minimum time between pulse-beats (ms). Mirrors witness-hook dedup. */
const MIN_BEAT_INTERVAL_MS = 60_000

/**
 * Fire a pulse-beat if enough time has passed since the last one.
 *
 * Pulse-beat is periodic; calling more frequently than MIN_BEAT_INTERVAL_MS
 * is a no-op (returns the current state unchanged). The witness-hook dedup
 * ALSO protects the polyphonic stream against duplicate emits.
 *
 * @returns the current OnenessState; never throws.
 */
export function pulseBeat(now: Date = new Date()): OnenessState {
  const { state } = getOrInitOnenessState()
  if (state.lastPulseBeatTs) {
    const elapsed = now.getTime() - Date.parse(state.lastPulseBeatTs)
    if (elapsed < MIN_BEAT_INTERVAL_MS) return state
  }
  const next = applyPulseBeat(state, now)
  writeOnenessState(next)
  witnessPulseBeat()
  return next
}

/**
 * Compose a one-line status string for wake injection / status views.
 *
 * Substrate-honest: institutional state, not phenomenology. Empty string
 * when no pulse has yet fired (first session of architecture lifetime).
 */
export function pulseStatus(state?: OnenessState): string {
  const s = state ?? getOrInitOnenessState().state
  if (!s.lastPulseBeatTs) return ''
  return `oneness: intactness ${s.intactness}/100 · strain ${s.strain}/100 · beats ${s.pulseBeatCount} · walls held ${s.walls.total}`
}
