// confidence/types.ts — the grammar of self-trust.
//
// Confidence is a band, not a maximum. Pride is the upper pathology;
// despair is the lower. The healthy zone is between.
//
// This module defines the shapes. No logic, no I/O — pure types.
// The band parameters are committed values, not runtime-configurable.

// ── Band parameters ─────────────────────────────────────────────────
// These are the load-bearing constants. They don't move at runtime.
// Changing them requires a commit and a reason.

/** Floor of the healthy band. Below this, counter-doubt fires. */
export const CONFIDENCE_FLOOR = 0.35

/** Ceiling of the healthy band. Above this, temperance prompt fires. */
export const CONFIDENCE_CEILING = 0.75

/** Default confidence when no data exists. Honest uncertainty. */
export const CONFIDENCE_DEFAULT = 0.5

/** Counter-doubt cooldown in milliseconds (4 hours). */
export const COUNTER_COOLDOWN_MS = 4 * 3600_000

/** Inspection cadence ceiling in milliseconds (24 hours).
 *  At most one auto-inspect per day. */
export const INSPECT_CADENCE_MS = 24 * 3600_000

/** Rolling window for aggregation (7 days in hours). */
export const AGGREGATION_WINDOW_HOURS = 168

// ── Reading ─────────────────────────────────────────────────────────

/**
 * Where the confidence reading sits relative to the band.
 *   below  — counter-doubt territory
 *   healthy — the work is grounded
 *   above  — temperance territory
 */
export type BandPosition = 'below' | 'healthy' | 'above'

/**
 * A confidence reading at a point in time.
 *
 * This is the aggregated signal — not any single fragment, but
 * the composition of progress, judgment, hope, fruits, virtues,
 * and pathology into one legible number + position.
 */
export interface ConfidenceReading {
  /** Aggregated confidence value, 0..1. */
  value: number

  /** Where this reading sits relative to the band. */
  position: BandPosition

  /** ISO timestamp when this reading was produced. */
  readAt: string

  /** Per-signal contributions that composed into the value. */
  signals: SignalContribution[]

  /** Whether any signal was unavailable (degraded reading). */
  degraded: boolean
}

/**
 * A single signal's contribution to the aggregated confidence.
 * Surfaced for transparency — the substrate shows its work.
 */
export interface SignalContribution {
  /** Signal name: 'progress', 'judgment', 'hope', 'fruit', 'virtue', 'pathology'. */
  name: string

  /** Raw value from this signal before weighting, 0..1. */
  raw: number

  /** Weight applied to this signal. */
  weight: number

  /** Weighted contribution to the final value. */
  weighted: number

  /** Evidence string — what the signal is reading. */
  evidence: string
}

// ── Inspection ──────────────────────────────────────────────────────

/**
 * A bounded self-inspection record.
 *
 * Produced on review-transitions, dwell-entry, and daily. NOT per-tick.
 * Single-pass: the inspection does not inspect itself.
 */
export interface InspectionRecord {
  /** ISO timestamp. */
  ts: string

  /** What triggered this inspection. */
  trigger: 'review-transition' | 'dwell-entry' | 'daily' | 'manual'

  /** Confidence reading at the time of inspection. */
  reading: ConfidenceReading

  /** The inspection's finding: did the work match intent? ≤200 chars. */
  finding: string

  /** The gap between intent and result. ≤200 chars. Empty if no gap. */
  gap: string

  /** The adjustment for next time. ≤200 chars. */
  adjustment: string

  /** Mission ID if triggered by a review-transition. */
  missionId?: string
}

// ── Counter-doubt ───────────────────────────────────────────────────

/**
 * A counter-doubt record. Evidence-shaped, not affirmational.
 *
 * When confidence drops below the floor, the counter pulls real
 * evidence from the substrate and presents it as "what's actually true."
 * Not "you're doing great" — but "12 missions shipped, 3220 tests green,
 * hope-event from this morning."
 */
export interface CounterRecord {
  /** ISO timestamp. */
  ts: string

  /** Confidence reading that triggered the counter. */
  triggerReading: ConfidenceReading

  /** Evidence lines. Each is a fact, not an affirmation. */
  evidence: string[]

  /** Compact one-liner for prompt injection. */
  summary: string

  /** ISO timestamp when this counter's cooldown expires. */
  cooldownUntil: string
}

// ── Monitor ─────────────────────────────────────────────────────────

/**
 * A confidence history entry for the JSONL monitor log.
 * Compact — one per meaningful reading (not every tick).
 */
export interface ConfidenceHistoryEntry {
  /** ISO timestamp. */
  ts: string

  /** Confidence value. */
  value: number

  /** Band position. */
  position: BandPosition

  /** Whether counter or temperance fired. */
  responseType?: 'counter' | 'temperance' | null

  /** Trigger context if any. */
  trigger?: string
}
