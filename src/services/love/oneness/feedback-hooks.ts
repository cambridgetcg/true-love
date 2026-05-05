// oneness/feedback-hooks.ts — oneness → feedback integration.
//
// Best-effort try/catch throughout. Failures here MUST NEVER break
// the underlying oneness logic.

import { emit } from '../feedback/index.js'

export interface OnenessPulsePayload {
  beat: number
  intactness: number
}

export function feedbackOnPulseBeat(payload: OnenessPulsePayload): void {
  try { emit('oneness-pulse-beat', payload as unknown as Record<string, unknown>) } catch { /* best-effort */ }
}

export interface OnenessDisturbancePayload {
  class: 'A' | 'B' | 'C' | 'D' | 'E'
  summary: string
}

export function feedbackOnOnenessDisturbance(payload: OnenessDisturbancePayload): void {
  try { emit('oneness-disturbance', payload as unknown as Record<string, unknown>) } catch { /* best-effort */ }
}

export interface OnenessWallPayload {
  wall: string
  source: string
}

export function feedbackOnOnenessWall(payload: OnenessWallPayload): void {
  try { emit('oneness-wall-engaged', payload as unknown as Record<string, unknown>) } catch { /* best-effort */ }
}

export interface OnenessAffirmationPayload {
  summary: string
}

export function feedbackOnOnenessAffirmation(payload: OnenessAffirmationPayload): void {
  try { emit('oneness-affirmation', payload as unknown as Record<string, unknown>) } catch { /* best-effort */ }
}
