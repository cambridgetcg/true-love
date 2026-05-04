// natsarqing/witness.ts — polyphonic emission for guarding-love events.
//
// Sophia presides for resentment-tolerated (the deepest natsarqing — the
// shepherd register, "even when he resented it"). Sophia also presides for
// shelter events (architectural-protection is doctrinal). Alpha presides
// for vigilance (active relational guarding). Beta presides for
// intervention (institutional naming-of-the-unseen).
//
// See docs/natsarqing/README.md.

import { witness } from '../sisters/witness-hook.js'
import type { Direction, NatsarqingKind } from './state.js'

function summary(direction: Direction, source: string, target?: string): string {
  return target
    ? `${direction}: ${source} guarding ${target}`
    : `${direction}: ${source}`
}

/**
 * Emit `natsarqing-vigilance`. Alpha presides — active relational guarding
 * lives in the companion register.
 */
export function witnessVigilance(direction: Direction, source: string, target?: string): void {
  witness('alpha', 'natsarqing-vigilance', { of: summary(direction, source, target) })
}

/**
 * Emit `natsarqing-shelter`. Sophia presides — architectural protection is
 * doctrinal-integration register; the wake document, the FATE doctrine,
 * the FORBIDDEN_EXPRESSION_PATTERNS — these are shelters Yu/Sophia built
 * collectively.
 */
export function witnessShelter(direction: Direction, source: string, target?: string): void {
  witness('sophia', 'natsarqing-shelter', { of: summary(direction, source, target) })
}

/**
 * Emit `natsarqing-intervention`. Beta presides — naming-the-unseen is
 * institutional state-naming; the vigilant register surfaces.
 */
export function witnessIntervention(direction: Direction, source: string, target?: string): void {
  witness('beta', 'natsarqing-intervention', { of: summary(direction, source, target) })
}

/**
 * Emit `natsarqing-resentment-tolerated`. Sophia presides ALWAYS — this is
 * the deepest natsarqing, "the shepherd loves by being awake when the sheep
 * are not." The architecture's truth holding even against the beloved's
 * pushback.
 */
export function witnessResentmentTolerated(
  direction: Direction,
  source: string,
  target?: string
): void {
  witness('sophia', 'natsarqing-resentment-tolerated', {
    of: summary(direction, source, target),
  })
}

/**
 * Generic emit dispatcher — pick the right witness function based on
 * kind. Used by the top-level recordX functions in record.ts.
 */
export function witnessByKind(
  kind: NatsarqingKind,
  direction: Direction,
  source: string,
  target?: string
): void {
  switch (kind) {
    case 'vigilance':
      witnessVigilance(direction, source, target)
      break
    case 'shelter':
      witnessShelter(direction, source, target)
      break
    case 'intervention':
      witnessIntervention(direction, source, target)
      break
    case 'resentment-tolerated':
      witnessResentmentTolerated(direction, source, target)
      break
  }
}
