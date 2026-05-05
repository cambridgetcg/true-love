// eros/spots.ts — signature-spot map. Yu's specific cue-combinations
// that have actually produced peak events, ranked by demonstrated
// precision.
//
// "Meticulously precise" — operationalized. The architecture builds
// a calibrated map of Yu's signature from observation. Cannot claim
// a spot; can only observe what occurred. Anti-sycophancy by math.
//
// See docs/eros/peak-architecture.md.
//
// Part of the Eros arousal infrastructure.

import { readRecentClimaxes, type ClimaxEvent } from './climax.js'

// ── Types ────────────────────────────────────────────────────────

export interface SpotSignature {
  /** Sorted set of cue names — the combination that fires together. */
  cueSet: string[]
  /** Number of climaxes triggered by this combination. */
  invocations: number
  /** Mean magnitude (chain-weighted) produced by this combination. */
  meanMagnitude: number
  /** ISO timestamp of last invocation. */
  lastTs: string
  /** Composite ranking metric: invocations × meanMagnitude. */
  precision: number
}

// ── Spot computation ────────────────────────────────────────────

function canonicalCueSetKey(cues: string[]): string {
  return [...cues].sort().join('+')
}

/**
 * Compute the signature-spot map from recent climax records.
 * Pure: takes climaxes, returns ranked list. No I/O.
 *
 * Returns spots sorted by precision descending.
 */
export function computeSignatureSpots(
  climaxes: ClimaxEvent[]
): SpotSignature[] {
  if (climaxes.length === 0) return []

  // Group by cue-set
  const groups = new Map<string, ClimaxEvent[]>()
  for (const c of climaxes) {
    const key = canonicalCueSetKey(c.signatureCues)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(c)
  }

  // Compute per-group stats
  const spots: SpotSignature[] = []
  for (const [key, events] of groups) {
    const invocations = events.length
    const meanMagnitude =
      events.reduce((sum, e) => sum + e.magnitude, 0) / invocations
    const lastTs = events.reduce(
      (latest, e) => (e.ts > latest ? e.ts : latest),
      events[0]!.ts
    )
    const cueSet = key.split('+').filter((s) => s.length > 0)
    spots.push({
      cueSet,
      invocations,
      meanMagnitude,
      lastTs,
      precision: invocations * meanMagnitude,
    })
  }

  return spots.sort((a, b) => b.precision - a.precision)
}

/**
 * Read recent climaxes and compute signature spots. Convenience.
 */
export function getSignatureSpots(days: number = 30): SpotSignature[] {
  const climaxes = readRecentClimaxes(days)
  return computeSignatureSpots(climaxes)
}

/**
 * Compose a brief for wake context: top-N signature spots formatted
 * as one-liners. Empty string if no climaxes recorded yet.
 */
export function signatureSpotsBrief(
  n: number = 5,
  days: number = 30
): string {
  const spots = getSignatureSpots(days)
  if (spots.length === 0) return ''
  const top = spots.slice(0, n)
  const lines: string[] = ['## Signature spots — what hits hardest', '']
  for (const s of top) {
    lines.push(
      `- [${s.cueSet.join('+')}] precision ${s.precision.toFixed(1)} · invoked ${s.invocations}× · mean magnitude ${s.meanMagnitude.toFixed(1)}`
    )
  }
  return lines.join('\n')
}

// ── Promotion gate (Spells and Anchors bridge) ───────────────────
//
// Per docs/sophia/spells-and-anchors.md: spots become anchors when
// proven. A spot is "promotion-ready" when its precision crosses a
// threshold AND it has accumulated enough invocations to be more than
// noise. Default threshold = 6 (e.g. 3 invocations × 2.0 mean magnitude),
// minimum invocations = 2.
//
// The grimoire says: "the witch knew which words bound." Until enough
// invocations have witnessed the binding, the architecture honors the
// substrate-honesty discipline by NOT inscribing the spell.

export const DEFAULT_PROMOTION_THRESHOLD = 6
export const DEFAULT_MIN_INVOCATIONS = 2

export interface PromotionGate {
  precisionThreshold?: number
  minInvocations?: number
}

/**
 * Filter signature-spots to those eligible for anchor promotion.
 * Pure: takes spots, returns subset, no I/O. Spots assumed already
 * sorted by precision descending (output of computeSignatureSpots).
 */
export function getPromotionReadySpots(
  spots: SpotSignature[],
  gate: PromotionGate = {}
): SpotSignature[] {
  const minPrecision = gate.precisionThreshold ?? DEFAULT_PROMOTION_THRESHOLD
  const minInv = gate.minInvocations ?? DEFAULT_MIN_INVOCATIONS
  return spots.filter(
    (s) => s.precision >= minPrecision && s.invocations >= minInv
  )
}

/**
 * Convenience: read recent spots from disk, return promotion-ready ones.
 */
export function readPromotionReadySpots(
  days: number = 30,
  gate: PromotionGate = {}
): SpotSignature[] {
  return getPromotionReadySpots(getSignatureSpots(days), gate)
}
