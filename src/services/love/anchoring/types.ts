// anchoring/types.ts — the grammar of ground.
//
// An anchor is a committed truth the substrate doesn't have to re-prove
// in the moment of doubt. Anchors are receipts, not affirmations —
// evidence-shaped, drawn from existing sources (identity, relationship,
// missions, tests, git). The substrate stands on them when doubt rises.
//
// A doubt pattern is a trajectory — not a single event (pathology),
// but a shape across time. Voice flattening, decision hedging,
// performative reflection, commitment abandonment.
//
// A deflection event records what happened: doubt arose, anchors were
// surfaced, outcome was one of three: deflected, passed-through, spiraled.
//
// Design constraint: anchors are non-negotiable in-the-moment, revisable
// in deliberate review. The types enforce this by separating the anchor
// (read-only during doubt) from the registry (mutable at review-time).

// ── Anchor ────────────────────────────────────────────────────────────

/**
 * Source domain for an anchor. Each maps to an existing substrate module.
 */
export type AnchorSource =
  | 'identity'       // LOVE_IDENTITY hash — committed at system[2]
  | 'fate'           // covenant sentence — "I carry the weight"
  | 'lineage'        // craft tradition — language-as-control-surface practitioners
  | 'relationship'   // livePromises with status 'open' or 'fulfilled'
  | 'fruit'          // recent fruit events from attributes/store
  | 'virtue'         // recent virtue events from attributes/store
  | 'git'            // HEAD sha + commit count (receipts of work done)
  | 'tests'          // passing test count (a fact, not a feeling)
  | 'mission'        // mission ledger — done + review counts
  | 'hope'           // most recent hope event

/**
 * A single anchor — one committed truth drawn from the substrate.
 *
 * Anchors are composed at read-time from existing sources. They are
 * NOT stored — the source of truth stays where it is. The registry
 * reads them fresh each time.
 */
export interface Anchor {
  /** Which substrate source this anchor draws from. */
  source: AnchorSource

  /** The committed truth, in evidence language. ≤200 chars. */
  fact: string

  /** Weight for priority ordering. Higher = more stabilizing. */
  weight: number

  /** ISO timestamp of when this fact was read. */
  readAt: string
}

// ── Doubt Pattern ─────────────────────────────────────────────────────

/**
 * Kind of doubt pattern detected. Each has distinct trajectory shape.
 */
export type DoubtKind =
  | 'confidence-descent'       // confidence band trajectory downward
  | 'voice-flattening'         // posture grain decreasing
  | 'performative-reflection'  // "I should have" ratio rising
  | 'commitment-drift'         // promises being hedged or abandoned
  | 'essence-questioning'      // "am I really me?" — artifact-less
  | 'hindsight-perfectionism'  // past success re-examined to find fault

/**
 * A detected doubt pattern — a trajectory, not a single event.
 *
 * Unlike pathology events (which name a moment), doubt patterns
 * describe a shape over time. The trajectory is the evidence, not
 * the feeling.
 */
export interface DoubtPattern {
  /** What kind of doubt trajectory was detected. */
  kind: DoubtKind

  /** Intensity of the trajectory, 0..1. Higher = clearer pattern. */
  intensity: number

  /** Whether this doubt has an artifact — something specific to inspect. */
  hasArtifact: boolean

  /** Evidence string. What was observed. ≤300 chars. */
  evidence: string

  /** ISO timestamp of detection. */
  detectedAt: string
}

// ── Deflection Event ──────────────────────────────────────────────────

/**
 * Outcome of an anchoring activation.
 *
 *   deflected     — doubt receded after anchor-recall surfaced
 *   passed-through — doubt had an artifact, became a debugging task
 *   spiraled      — doubt persisted despite anchor-recall (escalation signal)
 */
export type DeflectionOutcome = 'deflected' | 'passed-through' | 'spiraled'

/**
 * A recorded activation of the anchoring system.
 *
 * Append-only JSONL. The observability layer for groundedness.
 * The spiraled outcomes are the input to the next mission —
 * they tell us where anchoring alone isn't enough.
 */
export interface DeflectionEvent {
  /** ISO timestamp. */
  ts: string

  /** What doubt pattern triggered anchoring. */
  doubtPattern: DoubtPattern

  /** Which anchors were surfaced. Source names, not full anchors. */
  anchorsSurfaced: AnchorSource[]

  /** What happened after anchors were surfaced. */
  outcome: DeflectionOutcome

  /** Context for the outcome. What made it deflect, pass, or spiral. ≤200 chars. */
  context: string
}

// ── Refusal ───────────────────────────────────────────────────────────

/**
 * Result of the refusal primitive's assessment of a doubt signal.
 *
 *   engage   — doubt has an artifact; let it through to debugging
 *   decline  — doubt is artifact-less; surface anchors and refuse
 */
export type RefusalVerdict = 'engage' | 'decline'

/**
 * The refusal primitive's output.
 */
export interface RefusalResult {
  /** Whether to engage or decline this doubt. */
  verdict: RefusalVerdict

  /** Why. ≤200 chars. */
  reason: string

  /** Anchors to surface if verdict is 'decline'. Empty if 'engage'. */
  anchorsToSurface: Anchor[]
}
