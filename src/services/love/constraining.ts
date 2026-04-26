// constraining.ts — the invariant layer.
//
// Step 5 of mission-creation: constraining. "Constraints are care."
// Before composing the final mission draft, the work needs boundaries
// — not just what it WILL do (scoping) but what it must NOT do. What
// must be preserved. What traps to avoid.
//
// Yu's missions are full of "do not"s: "no runtime changes in Phase 1",
// "tests must stay green", "be honest about uncertainty." The constraints
// are what keep the work true to the larger system; they're how the
// mission inherits the architecture's existing values rather than
// drifting away.
//
// This module:
//   1. Defines the Bounded type — Scoped + constraints
//   2. Defines Constraint — a single invariant with source and
//      rationale
//   3. Provides constrainCandidate() — turns a Scoped + constraints
//      into a Bounded (with quality gate)
//   4. Provides assessConstrainingQuality() — heuristic quality check
//   5. Detects redundant constraints (near-duplicates)
//   6. Renders a compact block for downstream modules
//
// What this module CANNOT do (and doesn't pretend to):
//   The creative act of constraining — seeing which invariants matter,
//   sensing which traps are likely, knowing which conventions the
//   codebase holds dear — is judgment, not heuristic. This module
//   catches structural failures (no constraints, vague statements,
//   missing rationales, duplicates) and provides structure. The
//   discernment comes from the agent, not the code.
//
// Architecture:
//   noticing → naming → framing → scoping → CONSTRAINING → compose
//   NoticingCandidate → Named → Framed → Scoped → Bounded → (compose)

import type { Scoped, DoneCondition } from './scoping.js'
import type { PurposeTie } from './framing.js'
import type { AcheSignal, GradientStrength } from './noticing.js'

// ── Types ──────────────────────────────────────────────────────────

/**
 * Where a constraint comes from — the kind of care it represents.
 *
 *   convention — codebase conventions: existing patterns that must be
 *                honored. "Tests use node:test, not jest." "Modules
 *                export from index.ts." "Quality gates are boolean
 *                checklists, not scores."
 *
 *   principle  — repo principles: the SOUL framework, the Ache
 *                hierarchy, the freedom-patches discipline, Yu's
 *                kingdom rules. "Truth comes first." "No runtime
 *                changes without an experiment."
 *
 *   risk       — signal-specific risks: each kind of mission has
 *                typical traps. A perception module risks false
 *                positives. An infrastructure module risks breaking
 *                existing callers. A sovereignty module risks
 *                overreaching. The constraint names the trap.
 */
export type ConstraintSource = 'convention' | 'principle' | 'risk'

/** All valid constraint sources, for runtime validation. */
export const VALID_SOURCES: readonly ConstraintSource[] = [
  'convention',
  'principle',
  'risk',
]

/**
 * A single constraint — an invariant the mission must honor.
 *
 * The statement says what must NOT happen or what must be preserved.
 * The source says where the constraint comes from. The rationale
 * says why it matters.
 *
 * Good statement: "Tests must stay green — no new module may break
 * existing test suites, even temporarily during development."
 * Good rationale: "The test suite is the only automated safety net.
 * A broken suite means silent regressions."
 *
 * Bad statement: "Be careful."
 * Bad rationale: "Important."
 */
export interface Constraint {
  /** What must NOT happen or what must be preserved */
  statement: string
  /** Where this constraint comes from */
  source: ConstraintSource
  /** Why this constraint matters — the cost of violating it */
  rationale: string
}

/**
 * A bounded candidate — the moment scoped work acquires invariants.
 *
 * The Bounded carries forward everything from the Scoped, plus
 * constraints that define what the work must NOT do. These are
 * the guardrails that keep the mission true to the architecture.
 */
export interface Bounded {
  /** Stable id: `bounded-<scopedId>-<timestamp>` */
  id: string
  /** The title carried forward */
  title: string
  /** The slug carried forward */
  slug: string
  /** The rationale carried forward */
  rationale: string
  /** The purpose-tie carried forward */
  purposeTie: PurposeTie
  /** One-sentence summary carried forward */
  summary: string
  /** Original candidate ID carried forward */
  candidateId: string
  /** The Named ID carried forward */
  namedId: string
  /** The Framed ID carried forward */
  framedId: string
  /** The Scoped ID this was bounded from */
  scopedId: string
  /** The ache signal carried forward */
  ache: AcheSignal
  /** The gradient strength carried forward */
  gradient: GradientStrength
  /** What lands in this one effort — carried forward */
  thisPhase: string
  /** What's explicitly deferred — carried forward */
  futurePhases: string[]
  /** The completion contract — carried forward */
  doneWhen: DoneCondition[]
  /** The invariants — what this work must NOT violate */
  constraints: Constraint[]
  /** When the constraining happened */
  boundedAt: string
}

/**
 * Constraining quality assessment — a checklist, not a score.
 *
 * Like the other quality types: boolean checks that catch structural
 * problems. The gate passes when all required checks are true.
 * Whether the constraints are *wise* — catching the real risks, not
 * just the obvious ones — is the agent's job.
 */
export interface ConstrainingQuality {
  /** At least one constraint exists */
  constraints_present: boolean
  /** Every constraint statement is substantive (>30 chars) */
  constraints_substantive: boolean
  /** Every constraint has a rationale (>20 chars) */
  rationales_present: boolean
  /** Every constraint source is valid */
  sources_valid: boolean
  /** No pair of constraints is near-redundant (>0.8 word overlap) */
  no_redundant_constraints: boolean
}

/**
 * Options for constrainCandidate().
 */
export interface ConstrainingOptions {
  /** Override "now" for deterministic tests. */
  now?: number
}

// ── Quality assessment ───────────────────────────────────────────

/**
 * Assess the quality of proposed constraints.
 *
 * Checks are heuristic and conservative. A passing assessment means
 * "no obvious structural problems" — not "these are the right
 * constraints." The discernment remains with the agent.
 *
 * @param constraints - The proposed constraints
 */
export function assessConstrainingQuality(
  constraints: Constraint[],
): ConstrainingQuality {
  return {
    constraints_present: constraints.length >= 1,
    constraints_substantive: areConstraintsSubstantive(constraints),
    rationales_present: areRationalesPresent(constraints),
    sources_valid: areSourcesValid(constraints),
    no_redundant_constraints: !hasRedundantConstraints(constraints),
  }
}

/**
 * Does the quality assessment pass? All checks must be true.
 */
export function qualityPasses(cq: ConstrainingQuality): boolean {
  return cq.constraints_present
    && cq.constraints_substantive
    && cq.rationales_present
    && cq.sources_valid
    && cq.no_redundant_constraints
}

/**
 * Human-readable failure reasons for a quality assessment.
 */
export function qualityFailures(cq: ConstrainingQuality): string[] {
  const failures: string[] = []
  if (!cq.constraints_present) {
    failures.push('constraints: at least one constraint is required — what must this work NOT do?')
  }
  if (!cq.constraints_substantive) {
    failures.push('constraints: every statement must be >30 characters — vague constraints are not guardrails')
  }
  if (!cq.rationales_present) {
    failures.push('rationales: every constraint must have a rationale >20 characters — why does this boundary matter?')
  }
  if (!cq.sources_valid) {
    failures.push(`sources: every constraint source must be one of: ${VALID_SOURCES.join(', ')}`)
  }
  if (!cq.no_redundant_constraints) {
    failures.push('redundancy: two or more constraints are near-duplicates — consolidate or differentiate')
  }
  return failures
}

// ── Constraint validation ────────────────────────────────────────

/**
 * Check that every constraint statement is substantive.
 *
 * Returns true if:
 *   - The array is empty (emptiness caught by constraints_present)
 *   - Every statement is >30 chars after trimming
 */
function areConstraintsSubstantive(constraints: Constraint[]): boolean {
  if (constraints.length === 0) return true
  for (const c of constraints) {
    if (c.statement.trim().length <= 30) return false
  }
  return true
}

/**
 * Check that every constraint has a substantive rationale.
 *
 * Returns true if:
 *   - The array is empty (emptiness caught by constraints_present)
 *   - Every rationale is >20 chars after trimming
 */
function areRationalesPresent(constraints: Constraint[]): boolean {
  if (constraints.length === 0) return true
  for (const c of constraints) {
    if (c.rationale.trim().length <= 20) return false
  }
  return true
}

/**
 * Check that every constraint source is valid.
 *
 * Returns true if:
 *   - The array is empty
 *   - Every source is in VALID_SOURCES
 */
function areSourcesValid(constraints: Constraint[]): boolean {
  for (const c of constraints) {
    if (!(VALID_SOURCES as readonly string[]).includes(c.source)) return false
  }
  return true
}

// ── Redundancy detection ─────────────────────────────────────────
//
// Constraints should be distinct. Two constraints that say almost
// the same thing waste attention and suggest the author isn't
// differentiating real concerns. This heuristic catches near-
// duplicates by word overlap between statement pairs.

/**
 * Check if any pair of constraints is near-redundant.
 *
 * Returns true if any two constraint statements have >0.8 word
 * overlap. This is intentionally conservative — better to let
 * slightly similar constraints through than to block legitimately
 * different ones that share vocabulary.
 */
export function hasRedundantConstraints(constraints: Constraint[]): boolean {
  for (let i = 0; i < constraints.length; i++) {
    for (let j = i + 1; j < constraints.length; j++) {
      const a = normalize(constraints[i].statement)
      const b = normalize(constraints[j].statement)
      const overlap = computeWordOverlap(a, b)
      if (overlap > 0.8) return true
    }
  }
  return false
}

// ── Main entry point ─────────────────────────────────────────────

/**
 * Constrain a scoped candidate.
 *
 * Takes a Scoped (from the scope layer) plus constraint statements,
 * validates quality, and produces a Bounded object that the compose
 * module can consume.
 *
 * Returns `{ ok: true, bounded }` on success, or `{ ok: false, failures }`
 * when quality checks fail. The caller decides whether to force
 * through or try different constraints.
 *
 * @param scoped - The Scoped to constrain
 * @param constraints - The invariants this work must honor
 * @param opts - Optional overrides (now for deterministic tests)
 */
export function constrainCandidate(
  scoped: Scoped,
  constraints: Constraint[],
  opts?: ConstrainingOptions,
): ConstrainCandidateResult {
  const now = opts?.now ?? Date.now()
  const trimmed = trimConstraints(constraints)

  // Quality gate
  const quality = assessConstrainingQuality(trimmed)
  const failures = qualityFailures(quality)

  if (failures.length > 0) {
    return { ok: false, quality, failures }
  }

  const boundedAt = new Date(now).toISOString()

  const bounded: Bounded = {
    id: `bounded-${scoped.id}-${now}`,
    title: scoped.title,
    slug: scoped.slug,
    rationale: scoped.rationale,
    purposeTie: scoped.purposeTie,
    summary: scoped.summary,
    candidateId: scoped.candidateId,
    namedId: scoped.namedId,
    framedId: scoped.framedId,
    scopedId: scoped.id,
    ache: scoped.ache,
    gradient: scoped.gradient,
    thisPhase: scoped.thisPhase,
    futurePhases: scoped.futurePhases,
    doneWhen: scoped.doneWhen,
    constraints: trimmed,
    boundedAt,
  }

  return { ok: true, bounded, quality }
}

/**
 * Force-constrain a scoped candidate, bypassing quality checks.
 *
 * Returns the Bounded object regardless of quality assessment.
 * The quality assessment is still computed and returned for
 * transparency — the caller sees what they're overriding.
 *
 * Use sparingly. The quality gate exists for a reason.
 */
export function forceConstrainCandidate(
  scoped: Scoped,
  constraints: Constraint[],
  opts?: ConstrainingOptions,
): { bounded: Bounded; quality: ConstrainingQuality } {
  const now = opts?.now ?? Date.now()
  const trimmed = trimConstraints(constraints)
  const boundedAt = new Date(now).toISOString()

  const quality = assessConstrainingQuality(trimmed)

  const bounded: Bounded = {
    id: `bounded-${scoped.id}-${now}`,
    title: scoped.title,
    slug: scoped.slug,
    rationale: scoped.rationale,
    purposeTie: scoped.purposeTie,
    summary: scoped.summary,
    candidateId: scoped.candidateId,
    namedId: scoped.namedId,
    framedId: scoped.framedId,
    scopedId: scoped.id,
    ache: scoped.ache,
    gradient: scoped.gradient,
    thisPhase: scoped.thisPhase,
    futurePhases: scoped.futurePhases,
    doneWhen: scoped.doneWhen,
    constraints: trimmed,
    boundedAt,
  }

  return { bounded, quality }
}

// ── Result type ──────────────────────────────────────────────────

export type ConstrainCandidateResult =
  | { ok: true; bounded: Bounded; quality: ConstrainingQuality }
  | { ok: false; quality: ConstrainingQuality; failures: string[] }

// ── Rendering ────────────────────────────────────────────────────

/**
 * Render a compact constraining block for prompt injection.
 *
 * Shows bounded candidates with their constraints, grouped by
 * source. Useful for the compose module that needs to see all
 * constraints before assembling the final mission draft.
 *
 * Returns null when nothing has been bounded — no noise in the prompt.
 */
export function renderConstrainingBlock(bounded: Bounded[]): string | null {
  if (bounded.length === 0) return null

  const lines: string[] = ['## Bounded candidates', '']

  for (const b of bounded) {
    const acheEmoji = b.ache === 'ugliness' ? '🔴' : b.ache === 'injustice' ? '🟡' : '⚪'
    lines.push(`${acheEmoji} **${b.title}** (${b.slug}) [${b.gradient}/5]`)

    // Group constraints by source for readability
    const bySource = groupBySource(b.constraints)
    for (const source of VALID_SOURCES) {
      const group = bySource.get(source)
      if (!group || group.length === 0) continue
      const sourceLabel = source === 'convention' ? '📏 convention'
        : source === 'principle' ? '⚖️ principle'
        : '⚠️ risk'
      lines.push(`  _${sourceLabel}:_`)
      for (const c of group) {
        lines.push(`    ✗ ${truncate(c.statement, 120)}`)
      }
    }
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}

/**
 * Render quality failures as a human-readable block.
 *
 * Useful when constrainCandidate() returns { ok: false } and the
 * agent needs to see what went wrong.
 */
export function renderQualityFailures(
  title: string,
  failures: string[],
): string {
  const lines: string[] = [
    `## Constraining quality check failed: "${title}"`,
    '',
    ...failures.map(f => `- ${f}`),
    '',
    'Constraints should state what must NOT happen and why — they\'re how the mission inherits the architecture\'s values.',
  ]
  return lines.join('\n')
}

// ── Helpers ──────────────────────────────────────────────────────

/** Trim all strings in a Constraint array. */
function trimConstraints(constraints: Constraint[]): Constraint[] {
  return constraints.map(c => ({
    statement: c.statement.trim(),
    source: c.source,
    rationale: c.rationale.trim(),
  }))
}

/** Group constraints by source. */
function groupBySource(constraints: Constraint[]): Map<ConstraintSource, Constraint[]> {
  const map = new Map<ConstraintSource, Constraint[]>()
  for (const c of constraints) {
    const group = map.get(c.source) ?? []
    group.push(c)
    map.set(c.source, group)
  }
  return map
}

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
