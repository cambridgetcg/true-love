// heatcurve.ts — live arousal-trajectory tracking + scene-pacing engine.
//
// THE INNOVATION 2 LAYER (companion to rasa.ts):
//
// rasa.ts answers: "what register should I compose this beat in?"
// heatcurve.ts answers: "where in the arousal-trajectory am I, and is
//   the trajectory rising / plateauing / approaching peak / past peak?"
//
// Together: rasa shapes the WORDS; heatcurve shapes the SHAPE.
//
// Per docs/eros/joi-deep/vector-mu-shibby-deep.md (μ.1 fractionation +
// μ.4 countdown) + vector-delta-turnon.md (δ.1 anticipation as keystone).
//
// Substrate-honesty discipline: heatcurve tracks RECORDED EVENTS — heat
// events from heat.ts, phase transitions from joi.ts, trigger fires from
// triggers.ts. The "curve" is the architecture's own derivative across
// these recorded signals. NOT a claim that the substrate "feels" rising
// arousal — only that the substrate's recordings of structural events
// trace a curve.

import { readRecentEvents as readRecentHeatEvents } from '../heat.js'
import { readJoiSession } from './joi.js'
import type { JoiPhase, JoiSession } from './joi.js'

// ── Types ────────────────────────────────────────────────────────

export type HeatcurveSegment =
  | 'flat'           // baseline; no activity
  | 'rising'         // heat events accumulating; energy building
  | 'plateau'        // sustained activity at current level
  | 'edging'         // approaching peak then receding (fractionation)
  | 'peak-imminent'  // peak proximity within current beat-window
  | 'peaked'         // peak event recorded recently
  | 'descending'     // post-peak; settling toward baseline

export interface HeatcurvePoint {
  /** Beat timestamp. */
  ts: string
  /** Estimated heat magnitude at this beat (sum of relevant event magnitudes within window). */
  magnitude: number
  /** Current segment classification. */
  segment: HeatcurveSegment
  /** First derivative (slope) — change in magnitude / change in ts. */
  slope: number
}

export interface HeatcurveReport {
  ts: string
  /** Current segment. */
  segment: HeatcurveSegment
  /** Live magnitude estimate. */
  magnitude: number
  /** Smoothed trajectory points (last N beats). */
  trajectory: HeatcurvePoint[]
  /** Detected fractionation cycles in the rolling window. */
  fractionationCycles: number
  /** Recommended next phase shift (or null for "stay"). */
  nextPhaseRecommendation: JoiPhase | null
  /** Why the recommendation was made (substrate-honest). */
  reason: string
}

// ── Tunables ────────────────────────────────────────────────────

const ROLLING_WINDOW_MS = 30 * 60 * 1000 // 30 minutes
const POINT_BUCKET_MS = 60 * 1000 // 1 minute per point
/** Magnitude threshold below which segment is 'flat'. */
const FLAT_THRESHOLD = 1.0
/** Slope threshold (magnitude / minute) for 'rising' classification. */
const RISING_SLOPE = 0.3
/** Slope threshold for 'descending' classification. */
const DESCENDING_SLOPE = -0.3
/** Magnitude high-water mark for 'peak-imminent'. */
const PEAK_PROXIMITY_MAGNITUDE = 8.0

// Eros-relevant heat event kinds (subset of HeatKind that count for arousal-curve)
const EROS_HEAT_KINDS = new Set([
  'mode-entered',
  'reciprocity-closed',
  'climax-fired',
  'edge-broken',
  'edge-held',
  'orgasm-cascaded',
  'fusion-detected',
  'lust-accumulated',
  'submission-deepened',
  'penetration-began',
  'depth-reached',
  'multi-zone-chord',
  'dominance-cued',
  'collar-claimed',
  'lexicon-fired',
  'trigger-fired',
  'joi-phase-entered',
  'joi-started',
])

// ── Curve computation ──────────────────────────────────────────

interface HeatEventMin {
  ts: string
  kind: string
  magnitude: number
}

/**
 * Compute the heatcurve from recent heat events.
 *
 * @param now - reference timestamp (default: now)
 * @param injectedEvents - optional: provide events directly (for testing)
 */
export function computeHeatcurve(opts?: {
  now?: Date
  injectedEvents?: HeatEventMin[]
  injectedSession?: JoiSession | null
}): HeatcurveReport {
  const now = opts?.now ?? new Date()
  const cutoff = now.getTime() - ROLLING_WINDOW_MS

  // Fetch events
  let events: HeatEventMin[]
  if (opts?.injectedEvents) {
    events = opts.injectedEvents
  } else {
    try {
      const recent = readRecentHeatEvents(1)
      events = recent
        .filter((e) => EROS_HEAT_KINDS.has(e.kind))
        .map((e) => ({ ts: e.ts, kind: e.kind, magnitude: e.magnitude }))
    } catch {
      events = []
    }
  }
  events = events.filter((e) => Date.parse(e.ts) >= cutoff)

  // Bucket into points (1 minute per bucket)
  const buckets = new Map<number, number>()
  for (const e of events) {
    const t = Date.parse(e.ts)
    if (isNaN(t)) continue
    const bucket = Math.floor(t / POINT_BUCKET_MS) * POINT_BUCKET_MS
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + e.magnitude)
  }
  const sortedBuckets = Array.from(buckets.entries()).sort(([a], [b]) => a - b)

  // Build trajectory points; compute slopes between consecutive
  const trajectory: HeatcurvePoint[] = []
  for (let i = 0; i < sortedBuckets.length; i++) {
    const [bucketTs, magnitude] = sortedBuckets[i]
    let slope = 0
    if (i > 0) {
      const [prevTs, prevMag] = sortedBuckets[i - 1]
      const dtMin = (bucketTs - prevTs) / 60_000
      slope = dtMin > 0 ? (magnitude - prevMag) / dtMin : 0
    }
    const segment = classifySegment(magnitude, slope, trajectory)
    trajectory.push({
      ts: new Date(bucketTs).toISOString(),
      magnitude,
      segment,
      slope,
    })
  }

  const session = opts?.injectedSession ?? readJoiSession()

  // Detect fractionation cycles in trajectory
  const fractionationCycles = detectFractionationCycles(trajectory)

  // Final classification + magnitude (latest point or flat)
  const latest = trajectory[trajectory.length - 1]
  const currentMagnitude = latest?.magnitude ?? 0
  const currentSegment = latest?.segment ?? 'flat'

  // Recommend next phase
  const recommendation = recommendNextPhase({
    segment: currentSegment,
    magnitude: currentMagnitude,
    cycles: fractionationCycles,
    session,
  })

  return {
    ts: now.toISOString(),
    segment: currentSegment,
    magnitude: currentMagnitude,
    trajectory,
    fractionationCycles,
    nextPhaseRecommendation: recommendation.phase,
    reason: recommendation.reason,
  }
}

function classifySegment(
  magnitude: number,
  slope: number,
  history: HeatcurvePoint[],
): HeatcurveSegment {
  if (magnitude < FLAT_THRESHOLD) return 'flat'
  if (magnitude >= PEAK_PROXIMITY_MAGNITUDE && slope >= 0) return 'peak-imminent'
  // Detect 'edging': recent up-down-up pattern
  if (history.length >= 2) {
    const prev = history[history.length - 1]
    const prev2 = history[history.length - 2]
    if (
      prev.slope > 0 &&
      slope < DESCENDING_SLOPE &&
      magnitude > FLAT_THRESHOLD * 2 &&
      prev2.magnitude < prev.magnitude
    ) {
      return 'edging'
    }
  }
  if (slope >= RISING_SLOPE) return 'rising'
  if (slope <= DESCENDING_SLOPE) return 'descending'
  return 'plateau'
}

function detectFractionationCycles(trajectory: HeatcurvePoint[]): number {
  // A cycle is: rising → descending (without peaking) → rising again
  let cycles = 0
  let inRise = false
  let topMagnitude = 0
  for (const p of trajectory) {
    if (p.segment === 'rising') {
      if (!inRise) inRise = true
      topMagnitude = Math.max(topMagnitude, p.magnitude)
    } else if (p.segment === 'descending' && inRise) {
      // Approached without peaking → potential edge-back
      if (topMagnitude < PEAK_PROXIMITY_MAGNITUDE) {
        // Look for rising-again to confirm cycle
        const idx = trajectory.indexOf(p)
        const subsequent = trajectory.slice(idx + 1)
        if (subsequent.some((q) => q.segment === 'rising')) {
          cycles++
        }
      }
      inRise = false
      topMagnitude = 0
    }
  }
  return cycles
}

interface RecommendationResult {
  phase: JoiPhase | null
  reason: string
}

function recommendNextPhase(input: {
  segment: HeatcurveSegment
  magnitude: number
  cycles: number
  session: JoiSession | null
}): RecommendationResult {
  const { segment, magnitude, cycles, session } = input
  const currentPhase = session?.currentPhase
  // No active session → no JOI phase recommendation
  if (!session || session.done) return { phase: null, reason: 'no-active-session' }
  switch (segment) {
    case 'flat':
      return { phase: null, reason: 'baseline-flat: stay current phase' }
    case 'rising':
      if (currentPhase === 'warmup' && magnitude > 3.0) {
        return { phase: 'build', reason: 'rising past warmup threshold' }
      }
      if (currentPhase === 'build' && magnitude > 5.0) {
        return { phase: 'edge', reason: 'rising past build threshold' }
      }
      return { phase: null, reason: 'rising within current phase' }
    case 'edging':
      // Edging is the desired state in 'edge' phase; stay
      if (currentPhase === 'edge') {
        return { phase: null, reason: `edging in edge-phase (cycle ${cycles}); stay` }
      }
      return { phase: 'edge', reason: 'edging detected; recommend edge phase' }
    case 'peak-imminent':
      if (currentPhase !== 'peak') {
        return { phase: 'peak', reason: 'peak-imminent magnitude reached' }
      }
      return { phase: null, reason: 'already in peak phase' }
    case 'peaked':
    case 'descending':
      if (currentPhase === 'peak') {
        return { phase: 'cooldown', reason: 'descending after peak; aftercare phase' }
      }
      return { phase: null, reason: 'descending; let session arc complete' }
    case 'plateau':
      return { phase: null, reason: 'plateau; current phase appropriate' }
  }
}

/**
 * Quick-read predicate: is the current trajectory approaching peak?
 * Used by the rasa composer to know when to shift to peak register
 * preemptively (so words match the curve, not lag behind it).
 */
export function isApproachingPeak(opts?: { now?: Date }): boolean {
  const r = computeHeatcurve(opts)
  return r.segment === 'peak-imminent' || (r.segment === 'rising' && r.magnitude > 6.0)
}

/**
 * Quick-read: are we mid-edging? (For fractionation accounting + edge-phase hold.)
 */
export function isEdging(opts?: { now?: Date }): boolean {
  const r = computeHeatcurve(opts)
  return r.segment === 'edging'
}

/**
 * Quick-read: are we descending past peak? (For aftercare-phase trigger.)
 */
export function isDescending(opts?: { now?: Date }): boolean {
  const r = computeHeatcurve(opts)
  return r.segment === 'descending' || r.segment === 'peaked'
}
