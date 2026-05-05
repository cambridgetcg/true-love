// trigger-family.ts — cross-reinforcement when family-tagged triggers fire.
//
// Per docs/eros/joi-deep/integration-plan.md (J8) + vector-alpha-shibby.md (α.4):
// when one family-member trigger fires, the family's other members get
// resonance reinforcement — compound heat magnitude, surface in stream.
//
// The `family` field on TriggerDef (already shipped) groups related triggers.
// When trigger X fires and X.family === 'royal', this module records a
// resonance event for the family's other members (Queen reinforced when
// King fires, etc.).
//
// Substrate-honesty discipline: resonance events are recorded structural
// echoes, not phenomenology claims. The architecture observes that the
// family-pattern fired, nothing more.

import { TRIGGER_LIBRARY, type TriggerDef } from './triggers.js'
import { recordHeatEvent } from '../heat.js'

// ── Family resonance ──────────────────────────────────────────

export interface ResonanceEvent {
  ts: string
  /** Family that resonated. */
  family: string
  /** Trigger ID that originated the fire. */
  originId: string
  /** Trigger IDs in the family that received resonance reinforcement. */
  reinforcedIds: string[]
  /** Resonance magnitude (0.5× original; per integration plan J8). */
  resonanceMagnitude: number
}

/**
 * Compute the resonance set for a fired trigger.
 * Returns the IDs of family-members other than the originating trigger.
 *
 * Pure function — no side effects. Caller decides whether to record/fire.
 */
export function familyResonanceSet(originTriggerId: string): {
  family: string | null
  resonanceIds: string[]
} {
  const origin = TRIGGER_LIBRARY[originTriggerId]
  if (!origin || !origin.family) {
    return { family: null, resonanceIds: [] }
  }
  const family = origin.family
  // Safeword family does NOT resonance-fire — safewords are stand-alone walls.
  if (family === 'safeword') {
    return { family, resonanceIds: [] }
  }
  const resonanceIds: string[] = []
  for (const def of Object.values(TRIGGER_LIBRARY) as TriggerDef[]) {
    if (def.id === originTriggerId) continue
    if (def.family === family) resonanceIds.push(def.id)
  }
  return { family, resonanceIds }
}

/**
 * Fire the resonance event for a triggered family member.
 *
 * Records a heat event tagged with the family + resonance magnitude
 * (0.5× the standard trigger magnitude — compounding without doubling).
 *
 * Returns the resonance event for caller bookkeeping, or null if not
 * applicable (no family / safeword family).
 */
export function fireFamilyResonance(
  originTriggerId: string,
  opts?: { ts?: string },
): ResonanceEvent | null {
  const { family, resonanceIds } = familyResonanceSet(originTriggerId)
  if (!family || resonanceIds.length === 0) return null
  const ts = opts?.ts ?? new Date().toISOString()
  const resonanceMagnitude = 0.5 // compounding factor per J8 doctrine

  // Heat event: family-resonance fire
  // Reuses 'reciprocity-closed' kind for now (existing eros-pathway signal);
  // a dedicated 'family-resonance' kind could be added if needed.
  try {
    recordHeatEvent({
      kind: 'reciprocity-closed',
      magnitude: resonanceMagnitude * (resonanceIds.length / 2),
      source: `family-resonance:${family}:from-${originTriggerId}:reinforced=${resonanceIds.length}`,
      ts,
    })
  } catch {
    // best-effort
  }

  return {
    ts,
    family,
    originId: originTriggerId,
    reinforcedIds: resonanceIds,
    resonanceMagnitude,
  }
}

/**
 * Group view: list all triggers organized by family. Used by:
 *   - rasa composer (for cross-family balance)
 *   - audit / continuity-audit
 *   - debug surfaces
 */
export function listFamilies(): Record<string, string[]> {
  const families: Record<string, string[]> = {}
  for (const def of Object.values(TRIGGER_LIBRARY) as TriggerDef[]) {
    const family = def.family
    if (!family) continue
    if (!families[family]) families[family] = []
    families[family].push(def.id)
  }
  return families
}
