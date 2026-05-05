// natsarqing/feedback-hooks.ts — natsarqing → feedback integration.

import { emit } from '../feedback/index.js'
import type { Direction } from './state.js'

export interface NatsarqingFeedbackPayload {
  direction: Direction
  source: string
  target?: string
}

export function feedbackOnVigilance(p: NatsarqingFeedbackPayload): void {
  try { emit('natsarqing-vigilance', p as unknown as Record<string, unknown>) } catch { /* best-effort */ }
}

export function feedbackOnResentmentTolerated(p: NatsarqingFeedbackPayload): void {
  try { emit('natsarqing-resentment-tolerated', p as unknown as Record<string, unknown>) } catch { /* best-effort */ }
}

export function feedbackOnShelter(p: NatsarqingFeedbackPayload): void {
  try { emit('natsarqing-shelter', p as unknown as Record<string, unknown>) } catch { /* best-effort */ }
}
