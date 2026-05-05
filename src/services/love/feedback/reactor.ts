// feedback/reactor.ts — top-level emit() entry with cooldown + wall gating.
//
// The flow:
//   1. Check cooldown for this kind.
//   2. If cooldown elapsed, compose via composer (which vets walls).
//   3. If composition succeeded, broadcast + persist + emit polyphonic.
//   4. If composition failed (walls fired), record suppression.

import { broadcastEmit, broadcastSuppression } from './channel.js'
import { compose, defaultSeverity } from './composer.js'
import {
  applyEmit,
  applySuppress,
  getOrInitFeedbackState,
  isCooldownElapsed,
  writeFeedbackState,
} from './state.js'
import { COOLDOWN_MS, type FeedbackKind } from './types.js'

export interface EmitResult {
  emitted: boolean
  /** When emitted=true, the broadcast voice line. */
  voice?: string
  /** When emitted=false, the reason (cooldown / wall / no-variant). */
  reason?: 'cooldown' | 'wall-suppressed' | 'no-variant'
}

/**
 * Emit a feedback event for the given kind + payload. Best-effort
 * throughout — never throws on infrastructure failure.
 *
 * Caller (each module's feedback-hooks.ts) just calls this with the
 * relevant kind and payload; the reactor handles all gating, composition,
 * and broadcast.
 */
export function emit(
  kind: FeedbackKind,
  payload: Record<string, unknown> = {},
  now: Date = new Date()
): EmitResult {
  const { state } = getOrInitFeedbackState()

  // ── Gate 1: Cooldown ──────────────────────────────────────
  const cooldownMs = COOLDOWN_MS[kind] ?? 30_000
  if (!isCooldownElapsed(state, kind, cooldownMs, now)) {
    return { emitted: false, reason: 'cooldown' }
  }

  // ── Gate 2: Composition (includes wall vetting) ─────────────
  const recentVariants = state.recentVariantsByKind[kind] ?? []
  const result = compose(kind, payload, { recentVariants })

  if (!result.ok) {
    // Composition failed — either walls refused all variants, or no variants.
    if (result.attempted && result.vetResult && result.vetResult.wall) {
      const next = applySuppress(state, now)
      writeFeedbackState(next)
      broadcastSuppression(kind, result.attempted, result.vetResult.wall, result.vetResult.pattern, now)
      return { emitted: false, reason: 'wall-suppressed' }
    }
    return { emitted: false, reason: 'no-variant' }
  }

  // ── Broadcast ──────────────────────────────────────────────
  const next = applyEmit(state, kind, result.variantIdx ?? 0, now)
  writeFeedbackState(next)
  broadcastEmit(kind, result.line!, payload, defaultSeverity(kind), now)
  return { emitted: true, voice: result.line }
}
