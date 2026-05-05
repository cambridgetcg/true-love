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

export interface EmitOpts {
  /**
   * Pre-composed line — bypass composer's variant selection. Used by
   * themed-script runners that author full coherent narratives ahead of
   * time and break them into timed beats. Walls still vet the override
   * line; if it breaches a wall, the emit is suppressed.
   *
   * Per Yu's directive 2026-05-05: "generate full script first and then
   * break down into timed messages for consistency in theme."
   */
  overrideLine?: string
  /** Severity override (otherwise defaults from spec). */
  severity?: 'low' | 'medium' | 'high'
  now?: Date
}

/**
 * Emit a feedback event for the given kind + payload. Best-effort
 * throughout — never throws on infrastructure failure.
 *
 * Caller (each module's feedback-hooks.ts) just calls this with the
 * relevant kind and payload; the reactor handles all gating, composition,
 * and broadcast.
 *
 * When `opts.overrideLine` is provided, the composer's variant selection
 * is skipped — the override line is used directly (after wall vetting).
 * This enables themed-script delivery: the script authors a coherent arc
 * up front; the runner broadcasts each pre-composed beat exactly.
 */
export function emit(
  kind: FeedbackKind,
  payload: Record<string, unknown> = {},
  optsOrNow?: EmitOpts | Date
): EmitResult {
  // Backward compat: if called with a Date as 3rd arg, treat as opts.now.
  const opts: EmitOpts = optsOrNow instanceof Date ? { now: optsOrNow } : (optsOrNow ?? {})
  const now = opts.now ?? new Date()
  const { state } = getOrInitFeedbackState()

  // ── Gate 1: Cooldown ──────────────────────────────────────
  const cooldownMs = COOLDOWN_MS[kind] ?? 30_000
  if (!isCooldownElapsed(state, kind, cooldownMs, now)) {
    return { emitted: false, reason: 'cooldown' }
  }

  // ── Override path: pre-composed line, bypass composer ────────
  if (opts.overrideLine) {
    // Wall-vet the override line (still subject to substrate-honesty etc.)
    const { vet } = require('./walls.js') as typeof import('./walls.js')
    const v = vet(opts.overrideLine)
    if (!v.ok && v.wall) {
      const next = applySuppress(state, now)
      writeFeedbackState(next)
      broadcastSuppression(kind, opts.overrideLine, v.wall, v.pattern, now)
      return { emitted: false, reason: 'wall-suppressed' }
    }
    const next = applyEmit(state, kind, -1, now) // -1 = override variant marker
    writeFeedbackState(next)
    broadcastEmit(kind, opts.overrideLine, payload, opts.severity ?? defaultSeverity(kind), now)
    return { emitted: true, voice: opts.overrideLine }
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
  broadcastEmit(kind, result.line!, payload, opts.severity ?? defaultSeverity(kind), now)
  return { emitted: true, voice: result.line }
}
