// composing.ts — the integration layer.
//
// Step 6 (final) of mission-creation: composing. The capstone.
//
// Five upstream modules have done their work:
//   noticing    → surfaced the signal
//   naming      → gave it a name that rings
//   framing     → placed it in the memoir's arc
//   scoping     → bounded the phase and defined done
//   constraining → stated what must NOT happen
//
// Now compose brings them together into a single artifact: the
// Composed — a mission draft that is ready to enter the self-initiation
// staging pipeline or be created directly as a mission.
//
// The one thing compose adds that no upstream module provides: the
// intent. The intent is the agent's synthesis — a paragraph that says
// what this mission will do and deliver, drawing from but not
// restating the rationale, scope, or constraints. It's the "elevator
// pitch" that a reader needs to understand the mission in one breath.
//
// This module:
//   1. Defines the Composed type — the final pipeline output
//   2. Provides composeCandidate() — turns a Bounded + intent into a
//      Composed (with quality gate)
//   3. Provides assessComposingQuality() — heuristic quality check
//   4. Renders a complete mission draft block for review
//   5. Bridges to the self-initiation and mission systems via
//      toMissionFields() and deriveCandidateSource()
//
// What this module CANNOT do (and doesn't pretend to):
//   The creative act of composing — writing an intent that captures
//   the mission's essence without just restating what's already been
//   said — is judgment, not heuristic. This module catches structural
//   failures (empty intent, echoed rationale, broken lineage) and
//   provides structure. The synthesis comes from the agent, not the
//   code.
//
// Architecture:
//   noticing → naming → framing → scoping → constraining → COMPOSING
//   NoticingCandidate → Named → Framed → Scoped → Bounded → Composed

import type { Bounded, Constraint } from './constraining.js'
import type { DoneCondition } from './scoping.js'
import type { PurposeTie } from './framing.js'
import type { AcheSignal, GradientStrength } from './noticing.js'
import type { CandidateSource } from './self-initiation.js'
import type { MissionOrigin } from './mission.js'

// ── Types ──────────────────────────────────────────────────────────

/**
 * The final product of the mission-craft pipeline.
 *
 * A Composed carries everything needed to create a mission — either
 * through self-initiation staging or direct creation. It's the moment
 * the pipeline's output becomes a single, coherent artifact.
 *
 * The Composed preserves the full lineage: every upstream ID is
 * carried forward so the pipeline is traceable from signal to draft.
 */
export interface Composed {
  /** Stable id: `composed-<boundedId>-<timestamp>` */
  id: string

  // ── Mission fields ──
  /** The title (from Named, carried through the chain) */
  title: string
  /** Filesystem/URL-safe slug (from Named, carried through) */
  slug: string
  /** The mission intent — the agent's synthesis of what this will do and deliver */
  intent: string
  /** The rationale (from Framed, carried through) */
  rationale: string

  // ── Pipeline lineage ──
  /** Original NoticingCandidate ID */
  candidateId: string
  /** Named step ID */
  namedId: string
  /** Framed step ID */
  framedId: string
  /** Scoped step ID */
  scopedId: string
  /** Bounded step ID */
  boundedId: string

  // ── Structured enrichments ──
  /** The thread-tie from framing */
  purposeTie: PurposeTie
  /** What lands in this effort (from scoping) */
  thisPhase: string
  /** What's explicitly deferred (from scoping) */
  futurePhases: string[]
  /** The completion contract (from scoping) */
  doneWhen: DoneCondition[]
  /** The invariants (from constraining) */
  constraints: Constraint[]
  /** Which ache signal fires */
  ache: AcheSignal
  /** How loud the gradient is */
  gradient: GradientStrength
  /** One-sentence summary carried forward */
  summary: string

  // ── Metadata ──
  /** When the composition happened */
  composedAt: string
}

/**
 * Composing quality assessment — a checklist, not a score.
 *
 * Like all quality types in the pipeline: boolean checks that catch
 * structural problems. The gate passes when all checks are true.
 * Whether the intent is *compelling* — whether the synthesis captures
 * the mission's essence — is the agent's job.
 */
export interface ComposingQuality {
  /** The intent is present and substantive (>80 chars after trimming) */
  intent_substantive: boolean
  /** The intent is distinct from the rationale (<0.7 word overlap) */
  intent_distinct_from_rationale: boolean
  /** The intent is distinct from the scope (<0.7 word overlap) */
  intent_distinct_from_scope: boolean
  /** All five pipeline IDs are present and non-empty */
  lineage_complete: boolean
}

/**
 * Options for composeCandidate().
 */
export interface ComposingOptions {
  /** Override "now" for deterministic tests. */
  now?: number
}

// ── Quality assessment ───────────────────────────────────────────

/**
 * Assess the quality of a proposed composition.
 *
 * Checks are heuristic and conservative. A passing assessment means
 * "no obvious structural problems" — not "this is a compelling
 * synthesis." The creative work remains with the agent.
 *
 * @param bounded - The Bounded being composed
 * @param intent - The agent-written intent
 */
export function assessComposingQuality(
  bounded: Bounded,
  intent: string,
): ComposingQuality {
  const trimmedIntent = intent.trim()

  return {
    intent_substantive: trimmedIntent.length > 80,
    intent_distinct_from_rationale: !isOverlapping(trimmedIntent, bounded.rationale),
    intent_distinct_from_scope: !isOverlapping(trimmedIntent, bounded.thisPhase),
    lineage_complete: isLineageComplete(bounded),
  }
}

/**
 * Does the quality assessment pass? All checks must be true.
 */
export function qualityPasses(cq: ComposingQuality): boolean {
  return cq.intent_substantive
    && cq.intent_distinct_from_rationale
    && cq.intent_distinct_from_scope
    && cq.lineage_complete
}

/**
 * Human-readable failure reasons for a quality assessment.
 */
export function qualityFailures(cq: ComposingQuality): string[] {
  const failures: string[] = []
  if (!cq.intent_substantive) {
    failures.push('intent: must be >80 characters — the intent is the mission\'s elevator pitch, not a restatement')
  }
  if (!cq.intent_distinct_from_rationale) {
    failures.push('intent: too similar to the rationale (>70% word overlap) — the intent says what the mission DOES, the rationale says WHY')
  }
  if (!cq.intent_distinct_from_scope) {
    failures.push('intent: too similar to the scope (>70% word overlap) — the intent synthesizes, the scope delineates boundaries')
  }
  if (!cq.lineage_complete) {
    failures.push('lineage: all five pipeline IDs (candidateId, namedId, framedId, scopedId, boundedId) must be present — the pipeline must be traceable')
  }
  return failures
}

// ── Lineage validation ──────────────────────────────────────────

/**
 * Check that all pipeline IDs are present and non-empty.
 */
function isLineageComplete(bounded: Bounded): boolean {
  return !!(
    bounded.candidateId?.trim()
    && bounded.namedId?.trim()
    && bounded.framedId?.trim()
    && bounded.scopedId?.trim()
    && bounded.id?.trim()
  )
}

// ── Overlap detection ───────────────────────────────────────────
//
// The intent should be a synthesis, not a restatement. These
// heuristics catch near-echoes by word overlap — the same approach
// used in scoping (scope vs rationale) and constraining (redundant
// pairs).

/**
 * Check if two strings have >0.7 word overlap.
 *
 * Returns true if the shorter string's words are >70% contained in
 * the longer string. This threshold is more lenient than constraining's
 * 0.8 because intent naturally shares some vocabulary with rationale
 * and scope — the point is to catch wholesale echoing, not incidental
 * overlap.
 */
function isOverlapping(a: string, b: string): boolean {
  const normA = normalize(a)
  const normB = normalize(b)
  return computeWordOverlap(normA, normB) > 0.7
}

// ── Main entry point ─────────────────────────────────────────────

/**
 * Compose a bounded candidate into a mission draft.
 *
 * Takes a Bounded (from the constraint layer) plus the agent-written
 * intent. Validates quality and produces a Composed object that can
 * be staged via self-initiation or created directly as a mission.
 *
 * The intent is the agent's synthesis — the one paragraph that says
 * what this mission will do and deliver. It should draw from the
 * rationale, scope, and constraints, but not merely restate them.
 *
 * Returns `{ ok: true, composed }` on success, or `{ ok: false, failures }`
 * when quality checks fail. The caller decides whether to force
 * through or try a different intent.
 *
 * @param bounded - The Bounded to compose
 * @param intent - The agent-written mission intent
 * @param opts - Optional overrides (now for deterministic tests)
 */
export function composeCandidate(
  bounded: Bounded,
  intent: string,
  opts?: ComposingOptions,
): ComposeCandidateResult {
  const now = opts?.now ?? Date.now()
  const trimmedIntent = intent.trim()

  // Quality gate
  const quality = assessComposingQuality(bounded, trimmedIntent)
  const failures = qualityFailures(quality)

  if (failures.length > 0) {
    return { ok: false, quality, failures }
  }

  const composedAt = new Date(now).toISOString()

  const composed: Composed = {
    id: `composed-${bounded.id}-${now}`,
    title: bounded.title,
    slug: bounded.slug,
    intent: trimmedIntent,
    rationale: bounded.rationale,
    candidateId: bounded.candidateId,
    namedId: bounded.namedId,
    framedId: bounded.framedId,
    scopedId: bounded.scopedId,
    boundedId: bounded.id,
    purposeTie: bounded.purposeTie,
    thisPhase: bounded.thisPhase,
    futurePhases: bounded.futurePhases,
    doneWhen: bounded.doneWhen,
    constraints: bounded.constraints,
    ache: bounded.ache,
    gradient: bounded.gradient,
    summary: bounded.summary,
    composedAt,
  }

  return { ok: true, composed, quality }
}

/**
 * Force-compose a bounded candidate, bypassing quality checks.
 *
 * Returns the Composed object regardless of quality assessment.
 * The quality assessment is still computed and returned for
 * transparency — the caller sees what they're overriding.
 *
 * Use sparingly. The quality gate exists for a reason.
 */
export function forceComposeCandidate(
  bounded: Bounded,
  intent: string,
  opts?: ComposingOptions,
): { composed: Composed; quality: ComposingQuality } {
  const now = opts?.now ?? Date.now()
  const trimmedIntent = intent.trim()
  const composedAt = new Date(now).toISOString()

  const quality = assessComposingQuality(bounded, trimmedIntent)

  const composed: Composed = {
    id: `composed-${bounded.id}-${now}`,
    title: bounded.title,
    slug: bounded.slug,
    intent: trimmedIntent,
    rationale: bounded.rationale,
    candidateId: bounded.candidateId,
    namedId: bounded.namedId,
    framedId: bounded.framedId,
    scopedId: bounded.scopedId,
    boundedId: bounded.id,
    purposeTie: bounded.purposeTie,
    thisPhase: bounded.thisPhase,
    futurePhases: bounded.futurePhases,
    doneWhen: bounded.doneWhen,
    constraints: bounded.constraints,
    ache: bounded.ache,
    gradient: bounded.gradient,
    summary: bounded.summary,
    composedAt,
  }

  return { composed, quality }
}

// ── Result type ──────────────────────────────────────────────────

export type ComposeCandidateResult =
  | { ok: true; composed: Composed; quality: ComposingQuality }
  | { ok: false; quality: ComposingQuality; failures: string[] }

// ── Bridge: self-initiation ─────────────────────────────────────
//
// The compose module bridges the mission-craft pipeline to the
// self-initiation system. These functions map a Composed to the
// types that stageCandidate() and Mission creation expect.

/**
 * Derive a CandidateSource from a Composed.
 *
 * The pipeline always knows the ache signal (it's been carried from
 * noticing through every step), so we map to the 'ache-signal'
 * variant. This is always valid and always honest about the origin.
 */
export function deriveCandidateSource(composed: Composed): CandidateSource {
  return {
    type: 'ache-signal',
    signal: composed.ache,
    detail: composed.summary,
  }
}

/**
 * Extract the fields needed to create a Mission from a Composed.
 *
 * Returns an object with exactly the fields that Mission expects,
 * plus a decomposition string synthesized from the pipeline's
 * structured data (scope, done conditions, constraints, deferred
 * phases).
 *
 * The caller provides project_id and decides the origin. A
 * pipeline-composed mission is always origin: 'love' (the model
 * created it), but the caller confirms.
 */
export function toMissionFields(
  composed: Composed,
  projectId: string,
  opts?: { origin?: MissionOrigin },
): {
  title: string
  intent: string
  rationale: string
  origin: MissionOrigin
  decomposition: string
  project_id: string
} {
  const origin = opts?.origin ?? 'love'

  // Build a structured decomposition from pipeline artifacts.
  // This is the "body" of the mission markdown — richer than
  // the old monolithic template because it's grounded in the
  // pipeline's validated outputs.
  const decomposition = buildDecomposition(composed)

  return {
    title: composed.title,
    intent: composed.intent,
    rationale: composed.rationale,
    origin,
    decomposition,
    project_id: projectId,
  }
}

/**
 * Build a mission decomposition string from pipeline artifacts.
 *
 * This is the structured body that makes pipeline-composed missions
 * richer than hand-crafted ones. Every section is grounded in a
 * validated pipeline output.
 */
function buildDecomposition(composed: Composed): string {
  const lines: string[] = []

  // Purpose tie
  lines.push(`### Thread: ${composed.purposeTie.thread}`)
  lines.push(`_${composed.purposeTie.relationship}_ — ${composed.purposeTie.description}`)
  if (composed.purposeTie.relatedMissions?.length) {
    lines.push(`Related: ${composed.purposeTie.relatedMissions.join(', ')}`)
  }
  lines.push('')

  // Scope
  lines.push('### This phase')
  lines.push(composed.thisPhase)
  lines.push('')

  // Deferred work
  if (composed.futurePhases.length > 0) {
    lines.push('### Deferred')
    for (const fp of composed.futurePhases) {
      lines.push(`- ${fp}`)
    }
    lines.push('')
  }

  // Done conditions
  lines.push('### Done when')
  for (const dc of composed.doneWhen) {
    lines.push(`- **${dc.criterion}**`)
    lines.push(`  _verify:_ ${dc.verification}`)
  }
  lines.push('')

  // Constraints
  lines.push('### Constraints')
  for (const c of composed.constraints) {
    lines.push(`- [${c.source}] ${c.statement}`)
    lines.push(`  _why:_ ${c.rationale}`)
  }
  lines.push('')

  // Lineage
  lines.push('### Pipeline lineage')
  lines.push(`- candidate: \`${composed.candidateId}\``)
  lines.push(`- named: \`${composed.namedId}\``)
  lines.push(`- framed: \`${composed.framedId}\``)
  lines.push(`- scoped: \`${composed.scopedId}\``)
  lines.push(`- bounded: \`${composed.boundedId}\``)
  lines.push(`- composed: \`${composed.id}\``)

  return lines.join('\n')
}

// ── Rendering ────────────────────────────────────────────────────

/**
 * Render a complete compose block for prompt injection.
 *
 * Shows the full mission draft: intent, rationale, scope, done
 * conditions, constraints, lineage. This is what the agent (or Yu)
 * reviews before the mission enters the world.
 *
 * Returns null when nothing has been composed — no noise in the prompt.
 */
export function renderComposeBlock(composed: Composed[]): string | null {
  if (composed.length === 0) return null

  const lines: string[] = ['## Composed mission drafts', '']

  for (const c of composed) {
    const acheEmoji = c.ache === 'ugliness' ? '🔴' : c.ache === 'injustice' ? '🟡' : '⚪'
    lines.push(`${acheEmoji} **${c.title}** (${c.slug}) [${c.gradient}/5]`)
    lines.push('')
    lines.push(`_intent:_ ${c.intent}`)
    lines.push('')
    lines.push(`_rationale:_ ${truncate(c.rationale, 200)}`)
    lines.push('')
    lines.push(`_scope:_ ${truncate(c.thisPhase, 150)}`)
    if (c.futurePhases.length > 0) {
      lines.push(`_deferred:_ ${c.futurePhases.length} future phase${c.futurePhases.length > 1 ? 's' : ''}`)
    }
    lines.push('')

    // Done conditions
    lines.push(`_done when:_ ${c.doneWhen.length} ${c.doneWhen.length > 1 ? 'criteria' : 'criterion'}`)
    for (const dc of c.doneWhen) {
      lines.push(`  ✓ ${truncate(dc.criterion, 120)}`)
    }
    lines.push('')

    // Constraints (compact)
    lines.push(`_constraints:_ ${c.constraints.length}`)
    for (const con of c.constraints) {
      lines.push(`  ✗ [${con.source}] ${truncate(con.statement, 100)}`)
    }
    lines.push('')

    // Lineage (one line)
    lines.push(`_lineage:_ ${c.candidateId} → ${c.namedId} → ${c.framedId} → ${c.scopedId} → ${c.boundedId} → ${c.id}`)
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}

/**
 * Render quality failures as a human-readable block.
 *
 * Useful when composeCandidate() returns { ok: false } and the
 * agent needs to see what went wrong.
 */
export function renderQualityFailures(
  title: string,
  failures: string[],
): string {
  const lines: string[] = [
    `## Composing quality check failed: "${title}"`,
    '',
    ...failures.map(f => `- ${f}`),
    '',
    'The intent should synthesize what the mission DOES and DELIVERS — drawing from rationale, scope, and constraints but not restating them.',
  ]
  return lines.join('\n')
}

// ── Helpers ──────────────────────────────────────────────────────

/** Normalize a string for comparison: lowercase, collapse whitespace. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Compute word-level overlap ratio between two strings. */
function computeWordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.split(/\s+/).filter(w => w.length > 2))
  const wordsB = new Set(b.split(/\s+/).filter(w => w.length > 2))
  if (wordsA.size === 0 && wordsB.size === 0) return 1
  if (wordsA.size === 0 || wordsB.size === 0) return 0

  // Symmetric: overlap relative to the smaller set
  const smaller = wordsA.size <= wordsB.size ? wordsA : wordsB
  const larger = wordsA.size <= wordsB.size ? wordsB : wordsA

  let overlap = 0
  for (const w of smaller) {
    if (larger.has(w)) overlap++
  }
  return overlap / smaller.size
}

/** Truncate a string with ellipsis. */
function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen - 1).trimEnd() + '…'
}
