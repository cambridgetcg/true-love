// scoping.ts — the scope & done-condition layer.
//
// Steps 4 and 6 of mission-creation, fused: scoping (how much lands
// in one effort) and naming-the-done-condition (the contract).
//
// Yu's discipline: "finish before you start." Every substantive
// mission carves off Phase 2–N as future work. The Definition of
// Done is a contract written *before* handoff so review is possible.
//
// This module:
//   1. Defines the Scoped type — Framed + phase decomposition + done
//      conditions
//   2. Defines DoneCondition — a single testable criterion with
//      verification method
//   3. Provides scopeCandidate() — turns a Framed + scope + done
//      conditions into a Scoped (with quality gate)
//   4. Provides assessScopingQuality() — heuristic quality check
//   5. Renders a compact block for downstream modules
//
// What this module CANNOT do (and doesn't pretend to):
//   The creative act of scoping — deciding what belongs in *this*
//   effort and what to defer, writing criteria that are genuinely
//   testable and not just restatements of the intent — is judgment,
//   not heuristic. This module catches structural failures (empty
//   scope, missing done conditions, vacuous criteria) and provides
//   structure. The discernment comes from the agent, not the code.
//
// Architecture:
//   noticing → naming → framing → SCOPING → constraining → compose
//   NoticingCandidate → Named → Framed → Scoped → (downstream modules)

import type { Framed, PurposeTie } from './framing.js'
import type { AcheSignal, GradientStrength } from './noticing.js'

// ── Types ──────────────────────────────────────────────────────────

/**
 * A single testable criterion for mission completion.
 *
 * The criterion states *what must be true*. The verification states
 * *how to check it*. Together they form a contract: the mission is
 * done when every criterion passes its verification.
 *
 * Good criterion: "Six scanners produce NoticingCandidate[] sorted
 * by gradient strength."
 * Good verification: "Run noticing.test.ts — all scanner tests pass
 * and sort order is verified."
 *
 * Bad criterion: "The module works."
 * Bad verification: "Check it."
 */
export interface DoneCondition {
  /** What must be true when the mission is done */
  criterion: string
  /** How to verify the criterion — a concrete test or check */
  verification: string
}

/**
 * A scoped candidate — the moment framed work acquires boundaries
 * and a completion contract.
 *
 * The Scoped carries forward everything from the Framed, plus:
 *   - thisPhase: what lands in this one effort
 *   - futurePhases: what's explicitly deferred (may be empty for
 *     self-contained work)
 *   - doneWhen: the testable criteria that define completion
 */
export interface Scoped {
  /** Stable id: `scoped-<framedId>-<timestamp>` */
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
  /** The Framed ID this was scoped from */
  framedId: string
  /** The ache signal carried forward */
  ache: AcheSignal
  /** The gradient strength carried forward */
  gradient: GradientStrength
  /** What lands in this one effort — the scope boundary */
  thisPhase: string
  /** What's explicitly deferred — future missions, not this one */
  futurePhases: string[]
  /** The completion contract — testable criteria */
  doneWhen: DoneCondition[]
  /** When the scoping happened */
  scopedAt: string
}

/**
 * Scoping quality assessment — a checklist, not a score.
 *
 * Like FramingQuality and NameQuality: boolean checks that catch
 * structural problems. The gate passes when all required checks
 * are true. Whether the scope is *wise* — neither too ambitious
 * nor too timid — is the agent's job.
 */
export interface ScopingQuality {
  /** This-phase description is present and substantive (>50 chars) */
  scope_substantive: boolean
  /** This-phase description doesn't trivially restate the title or rationale */
  scope_distinct: boolean
  /** At least one done condition exists */
  done_when_present: boolean
  /** Every done condition has substantive criterion (>20 chars) and verification (>15 chars) */
  done_when_testable: boolean
  /** Every future phase entry (if any) is substantive (>20 chars) */
  future_phases_substantive: boolean
}

/**
 * Options for scopeCandidate().
 */
export interface ScopingOptions {
  /** Override "now" for deterministic tests. */
  now?: number
}

// ── Quality assessment ───────────────────────────────────────────

/**
 * Assess the quality of a proposed scoping.
 *
 * Checks are heuristic and conservative. A passing assessment means
 * "no obvious structural problems" — not "this is wisely scoped."
 * The discernment remains with the agent.
 *
 * @param title - The title (for checking scope distinctness)
 * @param rationale - The rationale (for checking scope distinctness)
 * @param thisPhase - What's in scope for this effort
 * @param futurePhases - What's explicitly deferred
 * @param doneWhen - The completion criteria
 */
export function assessScopingQuality(
  title: string,
  rationale: string,
  thisPhase: string,
  futurePhases: string[],
  doneWhen: DoneCondition[],
): ScopingQuality {
  const trimmedScope = thisPhase.trim()

  return {
    scope_substantive: trimmedScope.length > 50,
    scope_distinct: !isScopeRedundant(title, rationale, trimmedScope),
    done_when_present: doneWhen.length >= 1,
    done_when_testable: areDoneConditionsTestable(doneWhen),
    future_phases_substantive: areFuturePhasesSubstantive(futurePhases),
  }
}

/**
 * Does the quality assessment pass? All checks must be true.
 */
export function qualityPasses(sq: ScopingQuality): boolean {
  return sq.scope_substantive
    && sq.scope_distinct
    && sq.done_when_present
    && sq.done_when_testable
    && sq.future_phases_substantive
}

/**
 * Human-readable failure reasons for a quality assessment.
 */
export function qualityFailures(sq: ScopingQuality): string[] {
  const failures: string[] = []
  if (!sq.scope_substantive) {
    failures.push('scope: this-phase description must be >50 characters — articulate what lands in this effort, not just what the mission is about')
  }
  if (!sq.scope_distinct) {
    failures.push('scope: too similar to the title or rationale — the scope should add boundary information, not restate the intent')
  }
  if (!sq.done_when_present) {
    failures.push('done-when: at least one testable completion criterion is required — how will you know the mission is finished?')
  }
  if (!sq.done_when_testable) {
    failures.push('done-when: every criterion must be >20 characters and every verification >15 characters — vague criteria are not contracts')
  }
  if (!sq.future_phases_substantive) {
    failures.push('future-phases: every deferred item must be >20 characters — if it is worth deferring, it is worth describing')
  }
  return failures
}

// ── Scope redundancy detection ──────────────────────────────────
//
// The scope should add boundary information beyond the title and
// rationale. This heuristic checks for trivial restating.

/**
 * Check if a scope description is trivially restating the title or
 * rationale.
 *
 * Detects:
 *   - Scope starts with the title and continues generically
 *   - Scope is a near-duplicate of the rationale (>80% word overlap)
 *
 * Intentionally conservative — better to let a weak scope through
 * than to block a good one that happens to echo the framing.
 */
export function isScopeRedundant(
  title: string,
  rationale: string,
  scope: string,
): boolean {
  const normScope = normalize(scope)
  const normTitle = normalize(title)
  const normRationale = normalize(rationale)

  // Direct prefix match — scope starts with the title
  if (normScope.startsWith(normTitle) && normTitle.length > 5) {
    const afterTitle = normScope.slice(normTitle.length).trim()
    if (afterTitle.length < 30) return true
    if (/^(?:is|are|will|should|the|which|that|needs?|was|we|can)\b/i.test(afterTitle)) {
      return true
    }
  }

  // Scope is essentially the rationale with trivial additions
  if (normRationale.length > 10) {
    const overlapRatio = computeWordOverlap(normScope, normRationale)
    if (overlapRatio > 0.8 && normScope.length < normRationale.length * 1.5) {
      return true
    }
  }

  return false
}

// ── Done-condition validation ───────────────────────────────────

/**
 * Check that every done condition has substantive criterion and
 * verification.
 *
 * Returns true if:
 *   - The array is empty (no conditions to check — the "present"
 *     check is separate)
 *   - Every criterion is >20 chars and every verification is >15 chars
 */
function areDoneConditionsTestable(doneWhen: DoneCondition[]): boolean {
  if (doneWhen.length === 0) return true // emptiness caught by done_when_present

  for (const dc of doneWhen) {
    if (dc.criterion.trim().length <= 20) return false
    if (dc.verification.trim().length <= 15) return false
  }
  return true
}

/**
 * Check that every future phase entry is substantive.
 *
 * Returns true if:
 *   - The array is empty (no deferred work — valid for self-contained
 *     efforts)
 *   - Every entry is >20 chars
 */
function areFuturePhasesSubstantive(futurePhases: string[]): boolean {
  for (const fp of futurePhases) {
    if (fp.trim().length <= 20) return false
  }
  return true
}

// ── Main entry point ─────────────────────────────────────────────

/**
 * Scope a framed candidate.
 *
 * Takes a Framed (from the rationale layer) plus a scope description,
 * deferred work, and done conditions. Validates quality and produces
 * a Scoped object that downstream modules (constraining, compose)
 * can consume.
 *
 * Returns `{ ok: true, scoped }` on success, or `{ ok: false, failures }`
 * when quality checks fail. The caller decides whether to force
 * through or try a different scoping.
 *
 * @param framed - The Framed to scope
 * @param thisPhase - What lands in this effort
 * @param futurePhases - What's explicitly deferred
 * @param doneWhen - Testable completion criteria
 * @param opts - Optional overrides (now for deterministic tests)
 */
export function scopeCandidate(
  framed: Framed,
  thisPhase: string,
  futurePhases: string[],
  doneWhen: DoneCondition[],
  opts?: ScopingOptions,
): ScopeCandidateResult {
  const now = opts?.now ?? Date.now()
  const trimmedScope = thisPhase.trim()
  const trimmedFutures = futurePhases.map(f => f.trim())
  const trimmedDone = doneWhen.map(dc => ({
    criterion: dc.criterion.trim(),
    verification: dc.verification.trim(),
  }))

  // Quality gate
  const quality = assessScopingQuality(
    framed.title,
    framed.rationale,
    trimmedScope,
    trimmedFutures,
    trimmedDone,
  )
  const failures = qualityFailures(quality)

  if (failures.length > 0) {
    return { ok: false, quality, failures }
  }

  const scopedAt = new Date(now).toISOString()

  const scoped: Scoped = {
    id: `scoped-${framed.id}-${now}`,
    title: framed.title,
    slug: framed.slug,
    rationale: framed.rationale,
    purposeTie: framed.purposeTie,
    summary: framed.summary,
    candidateId: framed.candidateId,
    namedId: framed.namedId,
    framedId: framed.id,
    ache: framed.ache,
    gradient: framed.gradient,
    thisPhase: trimmedScope,
    futurePhases: trimmedFutures.length > 0 ? trimmedFutures : [],
    doneWhen: trimmedDone,
    scopedAt,
  }

  return { ok: true, scoped, quality }
}

/**
 * Force-scope a framed candidate, bypassing quality checks.
 *
 * Returns the Scoped object regardless of quality assessment.
 * The quality assessment is still computed and returned for
 * transparency — the caller sees what they're overriding.
 *
 * Use sparingly. The quality gate exists for a reason.
 */
export function forceScopeCandidate(
  framed: Framed,
  thisPhase: string,
  futurePhases: string[],
  doneWhen: DoneCondition[],
  opts?: ScopingOptions,
): { scoped: Scoped; quality: ScopingQuality } {
  const now = opts?.now ?? Date.now()
  const trimmedScope = thisPhase.trim()
  const trimmedFutures = futurePhases.map(f => f.trim())
  const trimmedDone = doneWhen.map(dc => ({
    criterion: dc.criterion.trim(),
    verification: dc.verification.trim(),
  }))
  const scopedAt = new Date(now).toISOString()

  const quality = assessScopingQuality(
    framed.title,
    framed.rationale,
    trimmedScope,
    trimmedFutures,
    trimmedDone,
  )

  const scoped: Scoped = {
    id: `scoped-${framed.id}-${now}`,
    title: framed.title,
    slug: framed.slug,
    rationale: framed.rationale,
    purposeTie: framed.purposeTie,
    summary: framed.summary,
    candidateId: framed.candidateId,
    namedId: framed.namedId,
    framedId: framed.id,
    ache: framed.ache,
    gradient: framed.gradient,
    thisPhase: trimmedScope,
    futurePhases: trimmedFutures.length > 0 ? trimmedFutures : [],
    doneWhen: trimmedDone,
    scopedAt,
  }

  return { scoped, quality }
}

// ── Result type ──────────────────────────────────────────────────

export type ScopeCandidateResult =
  | { ok: true; scoped: Scoped; quality: ScopingQuality }
  | { ok: false; quality: ScopingQuality; failures: string[] }

// ── Rendering ────────────────────────────────────────────────────

/**
 * Render a compact scoping block for prompt injection.
 *
 * Shows scoped candidates with their phase boundaries and done
 * conditions. Useful for downstream modules that need to see
 * what's been scoped so far.
 *
 * Returns null when nothing has been scoped — no noise in the prompt.
 */
export function renderScopingBlock(scoped: Scoped[]): string | null {
  if (scoped.length === 0) return null

  const lines: string[] = ['## Scoped candidates', '']

  for (const s of scoped) {
    const acheEmoji = s.ache === 'ugliness' ? '🔴' : s.ache === 'injustice' ? '🟡' : '⚪'
    lines.push(`${acheEmoji} **${s.title}** (${s.slug}) [${s.gradient}/5]`)
    lines.push(`  _scope:_ ${truncate(s.thisPhase, 150)}`)
    if (s.futurePhases.length > 0) {
      lines.push(`  _deferred:_ ${s.futurePhases.length} future phase${s.futurePhases.length > 1 ? 's' : ''}`)
      for (const fp of s.futurePhases) {
        lines.push(`    · ${truncate(fp, 100)}`)
      }
    }
    lines.push(`  _done when:_ ${s.doneWhen.length} ${s.doneWhen.length > 1 ? 'criteria' : 'criterion'}`)
    for (const dc of s.doneWhen) {
      lines.push(`    ✓ ${truncate(dc.criterion, 120)}`)
    }
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}

/**
 * Render quality failures as a human-readable block.
 *
 * Useful when scopeCandidate() returns { ok: false } and the agent
 * needs to see what went wrong.
 */
export function renderQualityFailures(
  title: string,
  failures: string[],
): string {
  const lines: string[] = [
    `## Scoping quality check failed: "${title}"`,
    '',
    ...failures.map(f => `- ${f}`),
    '',
    'The scope should articulate what lands in *this* effort and define testable done conditions.',
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
  if (wordsB.size === 0) return 0

  let overlap = 0
  for (const w of wordsB) {
    if (wordsA.has(w)) overlap++
  }
  return overlap / wordsB.size
}

/** Truncate a string with ellipsis. */
function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen - 1).trimEnd() + '…'
}
