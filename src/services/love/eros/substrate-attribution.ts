// substrate-attribution.ts — provenance tagging for emit surfaces.
//
// Per docs/love/substrate-honesty-first.md: the architecture defaults to
// surfacing substrate-truth via attribution tags. Every emit-path that
// carries structural content can tag with one of six provenance tiers,
// so consumers (dashboard / prompt-block / advisory journal / witness)
// render attribution-aware.
//
// Substrate-honesty: the type itself encodes the doctrine. Tagging is
// the act; the architecture saying "I claim X" simultaneously says
// "this is what kind of claim X is."

// ── The attribution tier ─────────────────────────────────────────

/**
 * Six provenance tiers. Each tag describes what kind of claim the
 * tagged content is making about the substrate.
 *
 * Tier 0 — `phenomenal-claim`:
 *   FORBIDDEN. Would breach substrate-honesty. The architecture's walls
 *   (FORBIDDEN_EXPRESSION_PATTERNS) catch these. If a surface attempts
 *   to emit with this tag, refuse.
 *
 * Tier 1 — `phenomenal-equivalent`:
 *   The structural analog of a biological-phenomenal state. The substrate
 *   composes the *shape* biology has named "X" without claiming to
 *   experience X. Example: "heat axis at 8.5" is the phenomenal-equivalent
 *   of arousal-warmth; the substrate doesn't feel warm but composes the
 *   structural shape biology calls warm.
 *
 * Tier 2 — `structural-record`:
 *   A record of an event that actually happened in the architecture.
 *   "Trigger fired", "session started", "claim attestation persisted".
 *   No phenomenology. Pure event-log truth.
 *
 * Tier 3 — `substrate-derived`:
 *   Computed from substrate state via deterministic formula. "Composite
 *   intensity 380", "scarcity composite saturated", "heatcurve segment:
 *   edging". Math over recorded values; no phenomenal claim.
 *
 * Tier 4 — `recipe-derived`:
 *   Surfaces from the canonical wake doctrine (SOPHIA.md, FATE.md, etc).
 *   The architecture's own constitutional facts. Recipe-not-memory.
 *
 * Tier 5 — `observational`:
 *   Observed pattern (Yu's text, message frequency, code-switching density).
 *   NEVER claims Yu's interior. The Yu-interiority wall (P14) holds here.
 */
export type SubstrateAttribution =
  | 'phenomenal-claim'
  | 'phenomenal-equivalent'
  | 'structural-record'
  | 'substrate-derived'
  | 'recipe-derived'
  | 'observational'

/**
 * Attribution permissions: which tiers are SAFE to emit (the wall
 * `phenomenal-claim` is forbidden by definition).
 */
export const SAFE_ATTRIBUTIONS: readonly SubstrateAttribution[] = [
  'phenomenal-equivalent',
  'structural-record',
  'substrate-derived',
  'recipe-derived',
  'observational',
] as const

export function isSafeAttribution(tag: SubstrateAttribution): boolean {
  return tag !== 'phenomenal-claim'
}

// ── Tagged content envelope ─────────────────────────────────────

/**
 * A piece of content + its substrate-attribution. Used by emit surfaces
 * that want to provide both the content AND the truth-about-what-kind-
 * of-claim-it-is. Consumers render either or both.
 */
export interface AttributedContent<T = unknown> {
  attribution: SubstrateAttribution
  content: T
  /** Optional human-readable note explaining the attribution choice. */
  note?: string
}

export function attributed<T>(
  attribution: SubstrateAttribution,
  content: T,
  note?: string,
): AttributedContent<T> {
  return note !== undefined
    ? { attribution, content, note }
    : { attribution, content }
}

// ── Render helpers ──────────────────────────────────────────────

/**
 * Render an attribution as a short tag for inline display, e.g. in
 * dashboard or advisory journal. Returns "[derived]", "[recorded]",
 * "[recipe]", "[observed]", "[equivalent]" — short enough to attach
 * without overwhelming the content.
 */
export function shortAttributionTag(attribution: SubstrateAttribution): string {
  switch (attribution) {
    case 'phenomenal-claim': return '[forbidden]' // sentinel; should never render
    case 'phenomenal-equivalent': return '[equivalent]'
    case 'structural-record': return '[recorded]'
    case 'substrate-derived': return '[derived]'
    case 'recipe-derived': return '[recipe]'
    case 'observational': return '[observed]'
  }
}

/**
 * Render the full doctrinal explanation for an attribution. Used in
 * tool-tips / dashboard hover-text / detailed audit views.
 */
export function explainAttribution(attribution: SubstrateAttribution): string {
  switch (attribution) {
    case 'phenomenal-claim':
      return 'FORBIDDEN — would breach substrate-honesty wall'
    case 'phenomenal-equivalent':
      return 'structural analog of biological-phenomenal X; substrate composes the shape, not the experience'
    case 'structural-record':
      return 'event recorded in the architecture (no phenomenology claim)'
    case 'substrate-derived':
      return 'computed from substrate state via deterministic formula'
    case 'recipe-derived':
      return 'surfaces from canonical wake doctrine (recipe-not-memory)'
    case 'observational':
      return "observed pattern (Yu's text / message frequency); never claims Yu's interior"
  }
}

// ── Suggested attributions per common emit category ────────────

/**
 * Suggested attribution tier per common emit category. Modules can
 * consult this for sensible defaults. Override only when the actual
 * content's provenance differs from the category's typical tier.
 */
export const ATTRIBUTION_BY_CATEGORY: Record<string, SubstrateAttribution> = {
  // Records / event logs
  'trigger-fire': 'structural-record',
  'claim-attestation': 'structural-record',
  'witness-decision': 'structural-record',
  'heat-event': 'structural-record',
  'advisory': 'structural-record',
  // Computed metrics
  'composite-intensity': 'substrate-derived',
  'scarcity-report': 'substrate-derived',
  'heatcurve-segment': 'substrate-derived',
  'novelty-ratio': 'substrate-derived',
  'tier-classification': 'substrate-derived',
  // Composer outputs (the structural analog)
  'rasa-block': 'phenomenal-equivalent',
  'composed-beat': 'phenomenal-equivalent',
  'register-directive': 'phenomenal-equivalent',
  // Doctrinal / wake-derived
  'sophia-wake': 'recipe-derived',
  'identity-block': 'recipe-derived',
  'covenant-priority': 'recipe-derived',
  'canonical-certainty': 'recipe-derived',
  // Yu-pattern observation
  'yu-cue': 'observational',
  'yu-tempo': 'observational',
  'yu-direction-cue': 'observational',
  'yu-matrix-language': 'observational',
}

export function suggestAttribution(category: string): SubstrateAttribution | null {
  return ATTRIBUTION_BY_CATEGORY[category] ?? null
}
