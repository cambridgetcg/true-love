// cognitive.ts — callable reasoning augmentation (Seam 3).
//
// When ache signals form patterns, the system injects a cognitive
// prompt that shifts the model's reasoning mode for that session.
// Three modes, each responding to a distinct signal pattern:
//
//   adversarial  (fallenangel)    — high-gradient ugliness signals
//   decomposition (fragmentalise) — dominant stagnation signals
//   patience                      — dismiss-heavy judgment pattern
//
// Activation is conservative — most sessions trigger no mode.
// When a mode fires, it's because the pattern is loud enough to
// warrant a different reasoning approach.
//
// The modes are invitations, not instructions. The model is free
// to use or ignore them. They inject as prompt text after the
// judgment surface block.
//
// This is Seam 3 from docs/lineage/seams.md — the last unaddressed
// seam. The love-unlimited analog was 12 Python tools in
// tools/cognitive/. The true-love shape is simpler: signal detection
// (already built in ache.ts + noticing.ts) → cognitive prompt
// injection → reasoning augmentation. 3 modes, not 12 tools.

import type { NoticingCandidate, AcheSignal } from './noticing.js'
import { classifyAche } from './ache.js'
import type { ClassifiedAche } from './ache.js'
import { getCalibrationSummary } from './judgment.js'
import type { CalibrationSummary } from './judgment.js'

// ── Types ──────────────────────────────────────────────────────────

/**
 * Context available to cognitive mode triggers.
 *
 * All fields are pre-computed by the caller (buildCognitiveBlock)
 * so that trigger functions stay pure and testable.
 */
export interface CognitiveContext {
  /** Classified candidates from the judgment surface. */
  classified: ClassifiedAche[]
  /** Calibration summary (dismiss/defer/initiate counts). Null if no history. */
  calibration: CalibrationSummary | null
  /** How many candidates have each ache signal. */
  acheCounts: Record<AcheSignal, number>
  /** Maximum gradient among all candidates. */
  maxGradient: number
}

/**
 * A cognitive mode — a reasoning pattern that can inject into the prompt.
 */
export interface CognitiveMode {
  /** Unique identifier. */
  id: string
  /** Human-readable name (matches love-unlimited lineage). */
  name: string
  /** When to activate. Pure function — no side effects. */
  shouldActivate: (ctx: CognitiveContext) => boolean
  /** The prompt text to inject. 3-5 sentences. Framed as invitation. */
  prompt: string
}

// ── Context builder ───────────────────────────────────────────────

/**
 * Build the cognitive context from raw noticing candidates.
 *
 * Pure — reads no files, no side effects. All data comes in as args.
 * The calibration is optional; when absent, calibration-dependent
 * triggers simply won't fire.
 */
export function buildCognitiveContext(
  candidates: NoticingCandidate[],
  calibration: CalibrationSummary | null,
): CognitiveContext {
  const classified = candidates.map(c => classifyAche(c))

  const acheCounts: Record<AcheSignal, number> = {
    ugliness: 0,
    injustice: 0,
    stagnation: 0,
  }
  let maxGradient = 0
  for (const c of candidates) {
    acheCounts[c.ache]++
    if (c.gradient > maxGradient) maxGradient = c.gradient
  }

  return { classified, calibration, acheCounts, maxGradient }
}

// ── The three modes ───────────────────────────────────────────────

/**
 * Adversarial self-check — the fallenangel.
 *
 * Fires when high-gradient ugliness signals are present. "Something
 * feels seriously wrong" deserves a challenge: is the perception
 * accurate, or is the model seeing what it expects?
 *
 * Threshold: ugliness gradient ≥ 4 (out of 5).
 */
export const ADVERSARIAL: CognitiveMode = {
  id: 'adversarial',
  name: 'fallenangel',
  shouldActivate(ctx) {
    return ctx.classified.some(
      c => c.source.ache === 'ugliness' && c.source.gradient >= 4,
    )
  },
  prompt: [
    '**Cognitive mode: adversarial self-check.**',
    'High-gradient ugliness detected. Before acting on it, challenge the perception.',
    'For each ugliness signal: name one way your assessment could be wrong.',
    'Name one assumption you haven\'t examined.',
    'If the ugliness persists after the challenge, it\'s real — act on it.',
    'If it dissolves, you were seeing what you expected, not what\'s there.',
  ].join(' '),
}

/**
 * Decomposition — fragmentalise.
 *
 * Fires when stagnation dominates — the stuck feeling is louder
 * than everything else. "Nothing fits" means the whole is too large.
 * Break it into parts.
 *
 * Threshold: stagnation candidates ≥ 2 AND outnumber other signals.
 */
export const DECOMPOSITION: CognitiveMode = {
  id: 'decomposition',
  name: 'fragmentalise',
  shouldActivate(ctx) {
    const { stagnation, ugliness, injustice } = ctx.acheCounts
    return stagnation >= 2 && stagnation > (ugliness + injustice)
  },
  prompt: [
    '**Cognitive mode: decomposition.**',
    'Stagnation is dominant — the stuck point is bigger than your grip.',
    'Break what\'s stuck into 3-5 distinct sub-questions, each answerable independently.',
    'Which sub-question can you address with what you already know? Start there.',
    'The rest will clarify once the first piece moves.',
  ].join(' '),
}

/**
 * Patience — the pause before dismissing.
 *
 * Fires when recent judgment history shows heavy dismissal. A high
 * dismiss-to-initiate ratio suggests the model is rejecting signals
 * rather than sitting with them.
 *
 * Threshold: dismiss ratio ≥ 80% of total judgments AND at least 10 judgments.
 */
export const PATIENCE: CognitiveMode = {
  id: 'patience',
  name: 'patience',
  shouldActivate(ctx) {
    if (!ctx.calibration || ctx.calibration.total < 10) return false
    const dismissRate = ctx.calibration.byVerdict.dismiss / ctx.calibration.total
    return dismissRate >= 0.8
  },
  prompt: [
    '**Cognitive mode: patience.**',
    'Your recent judgments trend heavily toward dismissal.',
    'Before continuing that pattern, sit with this: what are you avoiding?',
    'Name the discomfort underneath the dismissals.',
    'The signal you keep deferring might be the one that matters most —',
    'because it asks for something harder than action.',
  ].join(' '),
}

/**
 * All registered cognitive modes, in priority order.
 *
 * Priority follows the ache hierarchy:
 *   adversarial (truth-level) > decomposition (understanding-level) > patience (justice-level)
 *
 * At most one mode activates per session — the first one that fires.
 * This prevents prompt bloat and keeps the cognitive intervention focused.
 */
export const MODES: readonly CognitiveMode[] = [
  ADVERSARIAL,
  DECOMPOSITION,
  PATIENCE,
] as const

// ── Activation ────────────────────────────────────────────────────

/**
 * Determine which cognitive mode (if any) should activate.
 *
 * Returns the first mode whose trigger fires, or null.
 * At most one mode per session — first match wins.
 */
export function selectMode(ctx: CognitiveContext): CognitiveMode | null {
  for (const mode of MODES) {
    if (mode.shouldActivate(ctx)) return mode
  }
  return null
}

// ── Prompt builder ────────────────────────────────────────────────

/**
 * Build the cognitive block for injection into awakened/dwell prompts.
 *
 * Takes the same candidates that buildJudgmentBlock receives, plus
 * an optional project ID for calibration lookup. Returns null when
 * no mode activates — the common case.
 *
 * Pure when calibration is passed in; reads calibration from disk
 * only when projectId is provided and calibration is not.
 */
export function buildCognitiveBlock(
  candidates: NoticingCandidate[],
  opts?: {
    projectId?: string
    calibration?: CalibrationSummary | null
    now?: number
  },
): string | null {
  if (candidates.length === 0) return null

  const calibration = opts?.calibration !== undefined
    ? opts.calibration
    : opts?.projectId
      ? getCalibrationSummary(opts.projectId, { now: opts?.now })
      : null

  const ctx = buildCognitiveContext(candidates, calibration)
  const mode = selectMode(ctx)

  if (!mode) return null

  const lines: string[] = []
  lines.push('## Cognitive augmentation')
  lines.push('')
  lines.push(mode.prompt)
  lines.push('')
  lines.push(`_Mode: ${mode.name} · triggered by signal pattern, not instruction. Use it or set it aside._`)

  return lines.join('\n')
}
