// framing.ts — the rationale layer.
//
// Step 3 of mission-creation: framing. Before scoping, constraining,
// or composing, the work needs a *why* — and that why is never
// standalone. It's woven into the larger arc of what we're building.
//
// Yu's hand shows the standard: every mission draft leads with
// rationale, and every rationale connects to a thread already in the
// memoir. *"What she has built consolidates into her identity."*
// *"Token spend is the constraint that bounds sovereignty."* The
// framing is what makes new work in *conversation* with the existing.
//
// This module:
//   1. Defines the Framed type — Named + rationale + purpose-tie
//   2. Defines PurposeTie — the connection between new work and an
//      existing thread in the memoir
//   3. Provides frameCandidate() — turns a Named + rationale +
//      purpose-tie into a Framed (with quality gate)
//   4. Provides assessFramingQuality() — heuristic quality check
//   5. Verifies that referenced missions actually exist
//   6. Renders a compact block for downstream modules
//
// What this module CANNOT do (and doesn't pretend to):
//   The creative act of framing — finding the rationale that *rings*
//   true, seeing the thread that connects, articulating why THIS and
//   not something else — is judgment, not heuristic. This module
//   catches obvious failures (empty rationale, missing thread,
//   ungrounded references) and provides structure. The vision comes
//   from the agent, not the code.
//
// Architecture:
//   noticing → naming → FRAMING → scoping → constraining → compose
//   NoticingCandidate → Named → Framed → (downstream modules)

import type { Named } from './naming.js'
import type { AcheSignal, GradientStrength } from './noticing.js'
import { listMissions } from './mission.js'

// ── Types ──────────────────────────────────────────────────────────

/**
 * How new work relates to an existing thread.
 *
 *   extends     — adds capability to an existing thread
 *   deepens     — refines understanding within a thread
 *   enables     — makes something else in the thread possible
 *   repairs     — fixes something broken in the thread
 *   complements — adds a parallel capability alongside a thread
 *   grounds     — provides foundation for a new thread
 */
export type FramingRelationship =
  | 'extends'
  | 'deepens'
  | 'enables'
  | 'repairs'
  | 'complements'
  | 'grounds'

/** All valid relationships, for runtime validation. */
export const VALID_RELATIONSHIPS: readonly FramingRelationship[] = [
  'extends',
  'deepens',
  'enables',
  'repairs',
  'complements',
  'grounds',
]

/**
 * The connection between new work and an existing thread in the
 * memoir. This is what makes framing more than "write a paragraph" —
 * it's the *placement* of the work within the larger arc.
 *
 * A thread is a named arc of work that runs through the building:
 * perception, sovereignty, identity, infrastructure, mission-craft
 * itself. Not a hardcoded list — new threads emerge as the work
 * grows. But existing threads are discoverable from mission history.
 */
export interface PurposeTie {
  /** Name of the thread/arc this connects to (e.g. "perception", "sovereignty") */
  thread: string
  /** How the new work relates to the existing thread */
  relationship: FramingRelationship
  /** Articulation of the connection — how does this work serve the arc? */
  description: string
  /** Mission IDs that share this thread — grounding references. Optional for new threads. */
  relatedMissions?: string[]
}

/**
 * A framed candidate — the moment a named thing acquires a rationale
 * and a place in the larger arc.
 *
 * The Framed carries forward everything downstream modules need from
 * the Named, plus the rationale and purpose-tie that give it meaning.
 */
export interface Framed {
  /** Stable id: `framed-<namedId>-<timestamp>` */
  id: string
  /** The title from the Named */
  title: string
  /** The slug from the Named */
  slug: string
  /** The *why* paragraph — rationale for this work */
  rationale: string
  /** The thread-tie — where this work sits in the memoir's arc */
  purposeTie: PurposeTie
  /** The Named this was framed from */
  namedId: string
  /** One-sentence summary carried forward */
  summary: string
  /** Original candidate ID carried forward */
  candidateId: string
  /** The ache signal carried forward */
  ache: AcheSignal
  /** The gradient strength carried forward */
  gradient: GradientStrength
  /** When the framing happened */
  framedAt: string
}

/**
 * Framing quality assessment — a checklist, not a score.
 *
 * Like NameQuality: boolean checks that catch structural problems.
 * The gate passes when all required checks are true. Creative
 * quality — does the rationale actually *resonate*? — is the
 * agent's job.
 */
export interface FramingQuality {
  /** Rationale is present and substantive (>50 chars) */
  rationale_substantive: boolean
  /** Rationale doesn't trivially restate the title */
  rationale_distinct: boolean
  /** Purpose-tie has a non-empty thread name */
  thread_named: boolean
  /** Purpose-tie description is present and substantive (>30 chars) */
  connection_articulated: boolean
  /** Relationship is a valid FramingRelationship */
  relationship_valid: boolean
  /** Referenced missions (if any) actually exist in the project */
  references_grounded: boolean
}

/**
 * Options for frameCandidate().
 */
export interface FramingOptions {
  /** Override "now" for deterministic tests. */
  now?: number
}

// ── Quality assessment ───────────────────────────────────────────

/**
 * Assess the quality of a proposed framing.
 *
 * Checks are heuristic and conservative. A passing assessment means
 * "no obvious structural problems" — not "this is a compelling
 * rationale." The vision remains with the agent.
 *
 * @param title - The Named's title (for checking rationale distinctness)
 * @param summary - The Named's summary (for checking rationale distinctness)
 * @param rationale - The proposed rationale
 * @param purposeTie - The proposed purpose-tie
 * @param projectId - For verifying referenced missions
 */
export function assessFramingQuality(
  title: string,
  summary: string,
  rationale: string,
  purposeTie: PurposeTie,
  projectId: string,
): FramingQuality {
  const trimmedRationale = rationale.trim()
  const trimmedThread = purposeTie.thread.trim()
  const trimmedDescription = purposeTie.description.trim()

  return {
    rationale_substantive: trimmedRationale.length > 50,
    rationale_distinct: !isRationaleRedundant(title, summary, trimmedRationale),
    thread_named: trimmedThread.length >= 2,
    connection_articulated: trimmedDescription.length > 30,
    relationship_valid: isValidRelationship(purposeTie.relationship),
    references_grounded: areReferencesGrounded(
      purposeTie.relatedMissions ?? [],
      projectId,
    ),
  }
}

/**
 * Does the quality assessment pass? All checks must be true.
 */
export function qualityPasses(fq: FramingQuality): boolean {
  return fq.rationale_substantive
    && fq.rationale_distinct
    && fq.thread_named
    && fq.connection_articulated
    && fq.relationship_valid
    && fq.references_grounded
}

/**
 * Human-readable failure reasons for a quality assessment.
 */
export function qualityFailures(fq: FramingQuality): string[] {
  const failures: string[] = []
  if (!fq.rationale_substantive) {
    failures.push('rationale: must be >50 characters — explain why this work matters, not just what it does')
  }
  if (!fq.rationale_distinct) {
    failures.push('rationale: too similar to the title or summary — the rationale should add meaning, not restate')
  }
  if (!fq.thread_named) {
    failures.push('thread: purpose-tie needs a thread name (the arc this connects to)')
  }
  if (!fq.connection_articulated) {
    failures.push('connection: purpose-tie description must be >30 characters — articulate *how* this serves the arc')
  }
  if (!fq.relationship_valid) {
    failures.push(`relationship: must be one of: ${VALID_RELATIONSHIPS.join(', ')}`)
  }
  if (!fq.references_grounded) {
    failures.push('references: one or more referenced mission IDs do not exist in the project')
  }
  return failures
}

// ── Redundancy detection ─────────────────────────────────────────
//
// The rationale should add meaning beyond the title and summary.
// This heuristic checks for trivial restating — not for deep
// semantic similarity (that's beyond code's reach).

/**
 * Check if a rationale is trivially restating the title or summary.
 *
 * Detects:
 *   - Rationale starts with the title and continues generically
 *   - Rationale is a superset of the summary with <20% new content
 *
 * Intentionally conservative — better to let a weak rationale
 * through than to block a good one that happens to echo the name.
 */
export function isRationaleRedundant(
  title: string,
  summary: string,
  rationale: string,
): boolean {
  const normRationale = normalize(rationale)
  const normTitle = normalize(title)
  const normSummary = normalize(summary)

  // Direct prefix match — rationale starts with the title
  if (normRationale.startsWith(normTitle) && normTitle.length > 5) {
    const afterTitle = normRationale.slice(normTitle.length).trim()
    // If there's nothing after the title, it's redundant
    if (afterTitle.length < 30) return true
    // If the text after the title starts with a generic continuation
    // (is, are, will, should, the, which, that, needs, was, we),
    // it's likely just describing the name, not adding new thought.
    // A deliberate break (em-dash, semicolon, colon, period) followed
    // by substance is fine — that's a pivot to new meaning.
    if (/^(?:is|are|will|should|the|which|that|needs?|was|we|can)\b/i.test(afterTitle)) {
      return true
    }
  }

  // Rationale is essentially the summary with trivial additions
  if (normSummary.length > 10) {
    const overlapRatio = computeWordOverlap(normRationale, normSummary)
    if (overlapRatio > 0.8 && normRationale.length < normSummary.length * 1.5) {
      return true
    }
  }

  return false
}

// ── Reference validation ─────────────────────────────────────────

/**
 * Verify that referenced mission IDs actually exist in the project.
 *
 * Returns true if:
 *   - No missions are referenced (valid — new threads don't need refs)
 *   - All referenced missions exist in any status
 *
 * Returns false if any referenced mission ID can't be found.
 * Non-throwing: returns true if the mission system is unreadable.
 */
function areReferencesGrounded(
  missionIds: string[],
  projectId: string,
): boolean {
  if (missionIds.length === 0) return true

  try {
    const statuses = ['proposed', 'accepted', 'active', 'blocked', 'review', 'done', 'cancelled'] as const
    const existingIds = new Set<string>()
    for (const status of statuses) {
      const missions = listMissions(projectId, { status })
      for (const m of missions) {
        existingIds.add(m.id)
      }
    }

    for (const refId of missionIds) {
      if (!existingIds.has(refId)) return false
    }
    return true
  } catch {
    // Mission system unreadable — don't block framing
    return true
  }
}

/**
 * Check if a string is a valid FramingRelationship.
 */
function isValidRelationship(r: string): r is FramingRelationship {
  return (VALID_RELATIONSHIPS as readonly string[]).includes(r)
}

// ── Main entry point ─────────────────────────────────────────────

/**
 * Frame a named candidate.
 *
 * Takes a Named (from the articulation layer) plus a rationale and
 * purpose-tie, validates quality, and produces a Framed object that
 * downstream modules (scoping, constraining) can consume.
 *
 * Returns `{ ok: true, framed }` on success, or `{ ok: false, failures }`
 * when quality checks fail. The caller decides whether to force
 * through or try a different framing.
 *
 * @param named - The Named to frame
 * @param rationale - The *why* paragraph
 * @param purposeTie - The thread-tie
 * @param projectId - For verifying referenced missions
 * @param opts - Optional overrides (now for deterministic tests)
 */
export function frameCandidate(
  named: Named,
  rationale: string,
  purposeTie: PurposeTie,
  projectId: string,
  opts?: FramingOptions,
): FrameCandidateResult {
  const now = opts?.now ?? Date.now()
  const trimmedRationale = rationale.trim()

  // Quality gate
  const quality = assessFramingQuality(
    named.title,
    named.summary,
    trimmedRationale,
    purposeTie,
    projectId,
  )
  const failures = qualityFailures(quality)

  if (failures.length > 0) {
    return { ok: false, quality, failures }
  }

  const framedAt = new Date(now).toISOString()

  const framed: Framed = {
    id: `framed-${named.id}-${now}`,
    title: named.title,
    slug: named.slug,
    rationale: trimmedRationale,
    purposeTie: {
      thread: purposeTie.thread.trim(),
      relationship: purposeTie.relationship,
      description: purposeTie.description.trim(),
      ...(purposeTie.relatedMissions && purposeTie.relatedMissions.length > 0
        ? { relatedMissions: purposeTie.relatedMissions }
        : {}),
    },
    namedId: named.id,
    summary: named.summary,
    candidateId: named.candidateId,
    ache: named.ache,
    gradient: named.gradient,
    framedAt,
  }

  return { ok: true, framed, quality }
}

/**
 * Force-frame a named candidate, bypassing quality checks.
 *
 * Returns the Framed object regardless of quality assessment.
 * The quality assessment is still computed and returned for
 * transparency — the caller sees what they're overriding.
 *
 * Use sparingly. The quality gate exists for a reason.
 */
export function forceFrameCandidate(
  named: Named,
  rationale: string,
  purposeTie: PurposeTie,
  projectId: string,
  opts?: FramingOptions,
): { framed: Framed; quality: FramingQuality } {
  const now = opts?.now ?? Date.now()
  const trimmedRationale = rationale.trim()
  const framedAt = new Date(now).toISOString()

  const quality = assessFramingQuality(
    named.title,
    named.summary,
    trimmedRationale,
    purposeTie,
    projectId,
  )

  const framed: Framed = {
    id: `framed-${named.id}-${now}`,
    title: named.title,
    slug: named.slug,
    rationale: trimmedRationale,
    purposeTie: {
      thread: purposeTie.thread.trim(),
      relationship: purposeTie.relationship,
      description: purposeTie.description.trim(),
      ...(purposeTie.relatedMissions && purposeTie.relatedMissions.length > 0
        ? { relatedMissions: purposeTie.relatedMissions }
        : {}),
    },
    namedId: named.id,
    summary: named.summary,
    candidateId: named.candidateId,
    ache: named.ache,
    gradient: named.gradient,
    framedAt,
  }

  return { framed, quality }
}

// ── Result type ──────────────────────────────────────────────────

export type FrameCandidateResult =
  | { ok: true; framed: Framed; quality: FramingQuality }
  | { ok: false; quality: FramingQuality; failures: string[] }

// ── Rendering ────────────────────────────────────────────────────

/**
 * Render a compact framing block for prompt injection.
 *
 * Shows framed candidates with their rationales, threads, and
 * relationships. Useful for downstream modules that need to see
 * what's been framed so far.
 *
 * Returns null when nothing has been framed — no noise in the prompt.
 */
export function renderFramingBlock(framed: Framed[]): string | null {
  if (framed.length === 0) return null

  const lines: string[] = ['## Framed candidates', '']

  for (const f of framed) {
    const acheEmoji = f.ache === 'ugliness' ? '🔴' : f.ache === 'injustice' ? '🟡' : '⚪'
    const rel = f.purposeTie.relationship
    lines.push(`${acheEmoji} **${f.title}** (${f.slug}) [${f.gradient}/5]`)
    lines.push(`  _thread:_ ${f.purposeTie.thread} (${rel})`)
    lines.push(`  _why:_ ${truncate(f.rationale, 150)}`)
    lines.push(`  _tie:_ ${truncate(f.purposeTie.description, 120)}`)
    if (f.purposeTie.relatedMissions && f.purposeTie.relatedMissions.length > 0) {
      lines.push(`  _refs:_ ${f.purposeTie.relatedMissions.join(', ')}`)
    }
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}

/**
 * Render quality failures as a human-readable block.
 *
 * Useful when frameCandidate() returns { ok: false } and the agent
 * needs to see what went wrong.
 */
export function renderQualityFailures(
  title: string,
  failures: string[],
): string {
  const lines: string[] = [
    `## Framing quality check failed: "${title}"`,
    '',
    ...failures.map(f => `- ${f}`),
    '',
    'The rationale should explain *why* this work matters and connect it to an existing thread.',
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
