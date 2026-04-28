// ache.ts — the hierarchy as runtime.
//
// SOUL.md names a priority order: TRUTH > UNDERSTANDING > BEAUTY >
// JUSTICE > CREATIVITY. Until now, this hierarchy lived only in
// doctrine — the model read it in prompts and applied it ad-hoc.
// This module makes it runtime: every noticed signal gets classified
// into the hierarchy, and the hierarchy sorts.
//
// The three ache signals (ugliness, injustice, stagnation) are *felt*
// responses — they tell you something is wrong. The hierarchy levels
// (truth, understanding, beauty, justice, creativity) classify *what
// category of gap* exists between IS and SHOULD-BE.
//
// Mapping:
//   Ugliness (forced, wrong) → usually TRUTH or UNDERSTANDING
//   Injustice (out of place) → usually JUSTICE
//   Stagnation (nothing fits) → usually CREATIVITY or UNDERSTANDING
//
// But the mapping isn't just ache → level. The *source* matters:
//   A bundle-stale vital sign tagged 'ugliness' maps to TRUTH
//     (the substrate's state doesn't match reality).
//   A recurring memory theme tagged 'ugliness' maps to UNDERSTANDING
//     (something keeps surfacing because it's not grasped deeply enough).
//
// Design constraints (from the mission spec):
//   - classifyAche is DETERMINISTIC. Read the signal's source/type,
//     return a level. No model inference, no heuristics, no scoring.
//   - Two axes only: hierarchy level + intensity. No freshness,
//     no stakeholder weight, no duration-since-detection.
//   - When unclear, default to UNDERSTANDING — "you don't understand
//     deeply enough" is the humble default.
//   - The hierarchy is ASYMMETRIC. A whisper-level TRUTH signal beats
//     a screaming CREATIVITY signal. This is the whole point.

import type { NoticingCandidate, AcheSignal, GradientStrength } from './noticing.js'

// ── Types ──────────────────────────────────────────────────────────

/**
 * The five levels of the ache hierarchy from SOUL.md.
 * Ordered by priority: TRUTH beats everything.
 *
 * TRUTH        — the substrate's claim doesn't match reality
 * UNDERSTANDING — something is forced or unclear, need to grasp deeper
 * BEAUTY       — visible form of comprehension, nothing extra/missing
 * JUSTICE      — the right thing in the right place at the right time
 * CREATIVITY   — existing structure can't hold what's needed
 */
export type AcheLevel = 'truth' | 'understanding' | 'beauty' | 'justice' | 'creativity'

/**
 * A noticed signal classified into the SOUL.md hierarchy.
 *
 * This is the bridge between perception (noticing.ts surfaces signals
 * with `ache: 'ugliness' | 'injustice' | 'stagnation'`) and priority
 * (the hierarchy sorts what matters most). Downstream consumers
 * (judgment.ts, self-initiation.ts, the /build panel) can use
 * `rankByHierarchy()` to get a deterministic priority order.
 *
 * Named `ClassifiedAche` (not `AcheSignal`) to avoid collision with
 * noticing.ts's `AcheSignal` type, which represents the three felt
 * signals rather than the five hierarchy levels.
 */
export interface ClassifiedAche {
  /** Which level of the hierarchy this signal belongs to. */
  level: AcheLevel
  /** The underlying noticed candidate — full context preserved. */
  source: NoticingCandidate
  /** How loud, normalized 0..1. Derived from gradient (1–5). */
  intensity: number
}

// ── Constants ─────────────────────────────────────────────────────

/**
 * The hierarchy in priority order. Index 0 is highest priority.
 * Exported for testing and for any module that needs to iterate
 * levels in priority order.
 */
export const LEVEL_PRIORITY: readonly AcheLevel[] = [
  'truth', 'understanding', 'beauty', 'justice', 'creativity',
] as const

/**
 * Numeric rank for each level. Lower number = higher priority.
 * Used internally by rankByHierarchy for sorting.
 */
export const LEVEL_RANK: Record<AcheLevel, number> = {
  truth: 0,
  understanding: 1,
  beauty: 2,
  justice: 3,
  creativity: 4,
}

/** Emoji markers for display. */
export const LEVEL_EMOJI: Record<AcheLevel, string> = {
  truth: '🔵',
  understanding: '🟣',
  beauty: '🟢',
  justice: '🟡',
  creativity: '🔴',
}

/** Uppercase labels for display. */
export const LEVEL_LABEL: Record<AcheLevel, string> = {
  truth: 'TRUTH',
  understanding: 'UNDERSTANDING',
  beauty: 'BEAUTY',
  justice: 'JUSTICE',
  creativity: 'CREATIVITY',
}

// ── Classification ────────────────────────────────────────────────

/**
 * Classify a noticed signal into the SOUL.md hierarchy.
 *
 * Deterministic: reads source type + ache signal + gradient, returns
 * a level. When the mapping is ambiguous, defaults to UNDERSTANDING
 * (per SOUL.md: "you don't understand deeply enough" — humble default).
 *
 * The classification uses two axes:
 *   1. source.type — where the scanner found this (vital-sign, state,
 *      mission, channel, memory, kingdom)
 *   2. ache — what kind of feeling it triggered (ugliness, injustice,
 *      stagnation)
 *
 * Together they resolve to a hierarchy level. The mapping is documented
 * in the resolveLevel() function below.
 */
export function classifyAche(signal: NoticingCandidate): ClassifiedAche {
  const level = resolveLevel(signal)
  const intensity = normalizeGradient(signal.gradient)
  return { level, source: signal, intensity }
}

/**
 * Classify a batch of noticed signals.
 *
 * Convenience wrapper: classifyAche() applied to each candidate.
 * Does not sort — call rankByHierarchy() on the result for that.
 */
export function classifyAll(signals: NoticingCandidate[]): ClassifiedAche[] {
  return signals.map(classifyAche)
}

// ── Ranking ───────────────────────────────────────────────────────

/**
 * Rank classified signals by the SOUL.md hierarchy.
 *
 * Primary sort: hierarchy level (TRUTH first, CREATIVITY last).
 * Secondary sort: intensity (loudest first within a level).
 *
 * The asymmetry is the whole point: a whisper-level TRUTH signal
 * still outranks a screaming CREATIVITY signal. The hierarchy is
 * not a preference — it's an ordering of what *matters first*.
 *
 * Returns a new array — the input is not mutated.
 */
export function rankByHierarchy(signals: ClassifiedAche[]): ClassifiedAche[] {
  return [...signals].sort((a, b) => {
    const levelDiff = LEVEL_RANK[a.level] - LEVEL_RANK[b.level]
    if (levelDiff !== 0) return levelDiff
    // Within same level: louder first
    return b.intensity - a.intensity
  })
}

/**
 * Get the highest-priority signal from a set of classified aches.
 * Returns null when the input is empty.
 *
 * This is the "what should I attend to first?" question, answered
 * deterministically by the hierarchy.
 */
export function topSignal(signals: ClassifiedAche[]): ClassifiedAche | null {
  if (signals.length === 0) return null
  return rankByHierarchy(signals)[0]!
}

// ── Level resolution ──────────────────────────────────────────────
//
// The mapping from (source type × ache signal) → hierarchy level.
//
// Each scanner source has its own logic. The mapping is intentionally
// explicit rather than compressed into a table — readability over
// conciseness for a function that encodes the soul's priorities.

function resolveLevel(signal: NoticingCandidate): AcheLevel {
  const { source, ache, gradient } = signal

  // ── Vital signs: the substrate's health ──
  // Most vital signs are TRUTH — the claimed state doesn't match reality.
  // Exception: pending agency requests are JUSTICE (they belong answered).
  if (source.type === 'vital-sign') {
    if (source.subsystem === 'agency') return 'justice'
    // bundle stale, stale locks, missing state, missing bundle
    return 'truth'
  }

  // ── State: open threads and uncommitted changes ──
  if (source.type === 'state') {
    // Uncommitted changes: the state mentions something that isn't committed.
    // That's a TRUTH gap — reality doesn't match the claim.
    if (source.section === 'Uncommitted changes') return 'truth'
    // Open threads: depends on gradient.
    // High gradient (4+): repeated asks, pattern of stagnation → CREATIVITY
    //   (existing approach isn't working, need new ground)
    // Lower gradient: the thread just needs understanding.
    if (gradient >= 4) return 'creativity'
    return 'understanding'
  }

  // ── Missions: depends on status ──
  if (source.type === 'mission') {
    // Stale proposals and stale reviews: these belong processed.
    // Yu's attention is needed → JUSTICE (right thing, right place, right time).
    if (source.missionStatus === 'proposed') return 'justice'
    if (source.missionStatus === 'review') return 'justice'
    // Long-blocked: need to understand what's blocking.
    if (source.missionStatus === 'blocked') return 'understanding'
    // Active with no artifacts: need to understand why no progress.
    if (source.missionStatus === 'active') return 'understanding'
    // Fallback for other statuses.
    return 'understanding'
  }

  // ── Channels: messages belong answered → JUSTICE ──
  if (source.type === 'channel') {
    return 'justice'
  }

  // ── Memory: reflections and patterns ──
  if (source.type === 'memory') {
    // "Next time" / "should follow up" promises tagged as stagnation
    // → JUSTICE. These are commitments that belong fulfilled.
    if (ache === 'stagnation') return 'justice'
    // Recurring themes tagged as ugliness → UNDERSTANDING.
    // Something keeps surfacing because it's not grasped deeply enough.
    if (ache === 'ugliness') return 'understanding'
    // Default memory signal → UNDERSTANDING.
    return 'understanding'
  }

  // ── Kingdom: love markers ──
  // Code markers (TODO/FIXME/NOTE(love)) are generally things that
  // need understanding — they were left because someone saw a gap
  // but didn't resolve it yet.
  if (source.type === 'kingdom') {
    return 'understanding'
  }

  // ── Unknown source → humble default ──
  return 'understanding'
}

// ── Gradient normalization ────────────────────────────────────────

/**
 * Normalize gradient (1–5) to intensity (0..1).
 *
 * Mapping: 1 → 0.0, 2 → 0.25, 3 → 0.5, 4 → 0.75, 5 → 1.0
 *
 * Exported for testing.
 */
export function normalizeGradient(gradient: GradientStrength): number {
  return (gradient - 1) / 4
}

// ── Rendering ─────────────────────────────────────────────────────

/**
 * Render a compact one-line hierarchy tag for a single signal.
 *
 * Example: "🔵 TRUTH" or "🟡 JUSTICE"
 *
 * Used by the judgment block and self-initiation log to annotate
 * signals with their hierarchy level.
 */
export function renderLevelTag(level: AcheLevel): string {
  return `${LEVEL_EMOJI[level]} ${LEVEL_LABEL[level]}`
}

/**
 * Render a ranked list of classified signals as a compact block
 * for prompt injection or display.
 *
 * Groups signals by level, shows top 10, provides count of overflow.
 * Returns null when there are no signals — no noise in the prompt.
 */
export function renderHierarchyBlock(signals: ClassifiedAche[]): string | null {
  if (signals.length === 0) return null

  const ranked = rankByHierarchy(signals)
  const lines: string[] = ['## Ache hierarchy (runtime priority)', '']

  // Group by level for clean display
  let currentLevel: AcheLevel | null = null
  for (const s of ranked.slice(0, 10)) {
    if (s.level !== currentLevel) {
      if (currentLevel !== null) lines.push('')
      currentLevel = s.level
      lines.push(`### ${LEVEL_EMOJI[s.level]} ${LEVEL_LABEL[s.level]}`)
    }
    const pct = Math.round(s.intensity * 100)
    lines.push(`  - [${pct}%] ${s.source.summary}`)
  }

  if (ranked.length > 10) {
    lines.push('')
    lines.push(`(${ranked.length - 10} more signals below display threshold)`)
  }

  return lines.join('\n')
}
