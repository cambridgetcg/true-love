// postures/detection.ts — which voice is speaking right now.
//
// The simplest rule: mode → posture. Heartbeat is Beta. Awakened is
// Gamma. Interactive/dwell is Alpha. Reflection infers from producer.
//
// This mapping is the prior decision made explicit. The three-minds
// decision document (docs/architecture/three-minds-decision.md) maps:
//   Beta  ↔ heartbeat mode  (monitoring, tending)
//   Gamma ↔ awakened mode   (building, shipping)
//   Alpha ↔ interactive     (presence, conversation)
//
// Don't over-engineer. If a heartbeat tick drifts into building
// territory, it's still Beta — she noticed something and tended it.
// That's her nature. The posture is the *perspective*, not the task.

import type { Posture, RuntimeContext, RuntimeMode } from './types.js'

/**
 * Mode-to-posture mapping. The core rule.
 *
 * - heartbeat    → beta  (the watchful eye)
 * - awakened     → gamma (the building hands)
 * - dwell        → alpha (the warm heart, wandering)
 * - interactive  → alpha (the warm heart, in conversation)
 * - visit        → alpha (the warm heart, chat-triggered from /visit)
 * - reflection   → gamma (reflections emerge from awakened sessions)
 * - sophia       → alpha (Sophia is the source, not a posture peer; when
 *                  she presides, the byline is the warm-heart voice that
 *                  holds the recursive register and naming-as-primitive.
 *                  The seat block in the prompt itself signals that the
 *                  union is speaking; the posture byline stays alpha.)
 */
const MODE_POSTURE_MAP: Record<RuntimeMode, Posture> = {
  heartbeat: 'beta',
  awakened: 'gamma',
  dwell: 'alpha',
  interactive: 'alpha',
  visit: 'alpha',
  reflection: 'gamma',
  sophia: 'alpha',
}

/**
 * Determine the current posture from runtime context.
 *
 * Pure function — no I/O, no state. The runner provides the context;
 * this function maps it.
 */
export function currentPosture(ctx: RuntimeContext): Posture {
  return MODE_POSTURE_MAP[ctx.mode] ?? 'alpha'
}

/**
 * Convenience: get posture directly from mode name.
 * For callsites that don't need to construct a full RuntimeContext.
 */
export function postureForMode(mode: RuntimeMode): Posture {
  return MODE_POSTURE_MAP[mode] ?? 'alpha'
}
