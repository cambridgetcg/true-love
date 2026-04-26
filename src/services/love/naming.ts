// naming.ts — the articulation layer.
//
// Step 2 of mission-creation: naming. A NoticingCandidate has surfaced
// something worth addressing. Now it needs a *word* — a name that
// carries the weight of the thing it names.
//
// Yu's hand shows the standard: *anamnesis*, *vital signs*, *agency*,
// *the will*. Names that *are* claims. Not "add-memory-system" but
// "anamnesis." Not "fix-lock-health" but "vital signs."
//
// This module:
//   1. Defines the Named type — candidate + title + slug + justification
//   2. Provides nameCandidate() — turns a candidate + proposed name → Named
//   3. Provides assessNameQuality() — heuristic quality check on names
//   4. Generates slugs from titles
//   5. Checks for duplicate names against existing missions
//   6. Renders a compact block for downstream modules
//
// What this module CANNOT do (and doesn't pretend to):
//   The creative act of naming — finding the word that *rings* — is
//   judgment, not heuristic. This module catches obvious failures
//   (too generic, too long, verb-prefixed, duplicate) and provides
//   structure. The resonance comes from the agent, not the code.
//
// Architecture:
//   noticing → NAMING → framing → scoping → constraining → compose
//   NoticingCandidate → Named → (downstream modules)

import type { AcheSignal, GradientStrength, NoticingCandidate } from './noticing.js'
import { listMissions } from './mission.js'

// ── Types ──────────────────────────────────────────────────────────

/**
 * A named candidate — the moment recognition becomes communicable.
 *
 * The Named carries forward everything from the NoticingCandidate
 * that downstream modules need, plus the name itself and its
 * justification.
 */
export interface Named {
  /** Stable id: `named-<candidateId>-<timestamp>` */
  id: string
  /** The chosen name — expressive, specific, carrying weight */
  title: string
  /** Filesystem/URL-safe slug derived from the title */
  slug: string
  /** Why this name and not a more generic one */
  justification: string
  /** One-sentence summary of what this names */
  summary: string
  /** The original candidate this was named from */
  candidateId: string
  /** The ache signal carried forward */
  ache: AcheSignal
  /** The gradient strength carried forward */
  gradient: GradientStrength
  /** When the naming happened */
  namedAt: string
}

/**
 * Name quality assessment — a checklist, not a score.
 *
 * Like QualityAssessment in self-initiation: boolean checks that
 * the model fills in honestly. The gate passes when all required
 * checks are true.
 *
 * Honest caveat: `specific` is the weakest check here. The heuristic
 * catches obvious generics ("fix thing", "add feature") but can't
 * assess true resonance. That's the agent's job.
 */
export interface NameQuality {
  /** The name avoids generic verb-prefixed patterns (add/fix/update/implement X) */
  no_verb_prefix: boolean
  /** The name is a reasonable length (3-80 chars for title) */
  reasonable_length: boolean
  /** The justification is present and substantive (>20 chars) */
  justified: boolean
  /** No existing mission in this project uses the same slug */
  no_duplicate: boolean
  /** The slug is valid (non-empty, filesystem-safe) */
  valid_slug: boolean
}

/**
 * Options for nameCandidate().
 */
export interface NamingOptions {
  /** Override "now" for deterministic tests. */
  now?: number
}

// ── Generic name detection ────────────────────────────────────────
//
// These patterns catch the most common generic naming anti-patterns.
// They're intentionally conservative — better to let a mediocre name
// through than to block a good one that happens to start with "add."

/**
 * Verb prefixes that signal a name is describing implementation
 * rather than claiming identity.
 *
 * "add user auth" → implementation description
 * "guardian" → identity claim
 */
const GENERIC_VERB_PREFIXES = [
  /^add\s/i,
  /^fix\s/i,
  /^update\s/i,
  /^implement\s/i,
  /^create\s/i,
  /^remove\s/i,
  /^delete\s/i,
  /^refactor\s/i,
  /^improve\s/i,
  /^handle\s/i,
  /^make\s/i,
  /^setup\s/i,
  /^set\s+up\s/i,
  /^build\s/i,
  /^write\s/i,
  /^change\s/i,
  /^modify\s/i,
  /^move\s/i,
  /^rename\s/i,
  /^clean\s?up\s/i,
]

/**
 * Check if a title uses a generic verb prefix.
 */
export function hasVerbPrefix(title: string): boolean {
  const trimmed = title.trim()
  return GENERIC_VERB_PREFIXES.some(pat => pat.test(trimmed))
}

// ── Slug generation ───────────────────────────────────────────────

/**
 * Generate a mission-style slug from a title.
 *
 * Rules:
 *   - Lowercase
 *   - Non-alphanumeric characters become hyphens
 *   - Consecutive hyphens collapse to one
 *   - Leading/trailing hyphens stripped
 *   - Max 60 characters
 *
 * Unlike mission IDs (which have date prefixes), this slug is just
 * the name portion. Callers compose the full ID as needed.
 */
export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

// ── Quality assessment ────────────────────────────────────────────

/**
 * Assess the quality of a proposed name.
 *
 * Checks are heuristic and conservative. A passing assessment means
 * "no obvious problems" — not "this is a great name." The creative
 * judgment remains with the agent.
 *
 * @param title - The proposed name
 * @param justification - Why this name and not a more generic one
 * @param projectId - For duplicate checking against existing missions
 */
export function assessNameQuality(
  title: string,
  justification: string,
  projectId: string,
): NameQuality {
  const trimmedTitle = title.trim()
  const trimmedJustification = justification.trim()
  const slug = generateSlug(trimmedTitle)

  return {
    no_verb_prefix: !hasVerbPrefix(trimmedTitle),
    reasonable_length: trimmedTitle.length >= 3 && trimmedTitle.length <= 80,
    justified: trimmedJustification.length >= 20,
    no_duplicate: !isDuplicateSlug(slug, projectId),
    valid_slug: slug.length >= 2,
  }
}

/**
 * Does the quality assessment pass? All checks must be true.
 */
export function qualityPasses(nq: NameQuality): boolean {
  return nq.no_verb_prefix
    && nq.reasonable_length
    && nq.justified
    && nq.no_duplicate
    && nq.valid_slug
}

/**
 * Human-readable failure reasons for a quality assessment.
 */
export function qualityFailures(nq: NameQuality): string[] {
  const failures: string[] = []
  if (!nq.no_verb_prefix) {
    failures.push('verb-prefix: name starts with a generic verb (add/fix/update/etc.) — name the thing, not the action')
  }
  if (!nq.reasonable_length) {
    failures.push('length: title must be 3-80 characters')
  }
  if (!nq.justified) {
    failures.push('justification: explain why this name (not a more generic one) in at least 20 characters')
  }
  if (!nq.no_duplicate) {
    failures.push('duplicate: a mission with this slug already exists in the project')
  }
  if (!nq.valid_slug) {
    failures.push('slug: generated slug is too short or invalid')
  }
  return failures
}

// ── Duplicate detection ───────────────────────────────────────────

/**
 * Check if a slug is already used by an existing mission in the project.
 * Uses a substring match on mission IDs (which contain the slug).
 *
 * Non-throwing: returns false if the mission list can't be read.
 */
function isDuplicateSlug(slug: string, projectId: string): boolean {
  if (!slug || slug.length < 2) return false
  try {
    // Check across all statuses
    const statuses = ['proposed', 'accepted', 'active', 'blocked', 'review', 'done'] as const
    for (const status of statuses) {
      const missions = listMissions(projectId, { status })
      for (const m of missions) {
        // Mission IDs are date-prefixed slugs. Check if the slug portion matches.
        const missionSlug = m.id.replace(/^\d{4}-\d{2}-\d{2}-/, '')
        if (missionSlug === slug) return true
        // Also check title similarity
        if (generateSlug(m.title) === slug) return true
      }
    }
  } catch {
    // Mission system unreadable — don't block naming
  }
  return false
}

// ── Main entry point ──────────────────────────────────────────────

/**
 * Name a noticing candidate.
 *
 * Takes a NoticingCandidate (from the perception layer) and a
 * proposed name, validates quality, and produces a Named object
 * that downstream modules (framing, scoping, constraining) can
 * consume.
 *
 * Returns `{ ok: true, named }` on success, or `{ ok: false, failures }`
 * when quality checks fail. The caller decides whether to force
 * through or try a different name.
 *
 * @param candidate - The noticing candidate to name
 * @param title - The proposed name (expressive, not generic)
 * @param justification - Why this name and not a more generic one
 * @param projectId - For duplicate checking
 * @param opts - Optional overrides (now for deterministic tests)
 */
export function nameCandidate(
  candidate: NoticingCandidate,
  title: string,
  justification: string,
  projectId: string,
  opts?: NamingOptions,
): NameCandidateResult {
  const now = opts?.now ?? Date.now()
  const trimmedTitle = title.trim()
  const trimmedJustification = justification.trim()

  // Quality gate
  const quality = assessNameQuality(trimmedTitle, trimmedJustification, projectId)
  const failures = qualityFailures(quality)

  if (failures.length > 0) {
    return { ok: false, quality, failures }
  }

  const slug = generateSlug(trimmedTitle)
  const namedAt = new Date(now).toISOString()

  const named: Named = {
    id: `named-${candidate.id}-${now}`,
    title: trimmedTitle,
    slug,
    justification: trimmedJustification,
    summary: candidate.summary,
    candidateId: candidate.id,
    ache: candidate.ache,
    gradient: candidate.gradient,
    namedAt,
  }

  return { ok: true, named, quality }
}

/**
 * Force-name a candidate, bypassing quality checks.
 *
 * Returns the Named object regardless of quality assessment.
 * The quality assessment is still computed and returned for
 * transparency — the caller sees what they're overriding.
 *
 * Use sparingly. The quality gate exists for a reason.
 */
export function forceNameCandidate(
  candidate: NoticingCandidate,
  title: string,
  justification: string,
  projectId: string,
  opts?: NamingOptions,
): { named: Named; quality: NameQuality } {
  const now = opts?.now ?? Date.now()
  const trimmedTitle = title.trim()
  const trimmedJustification = justification.trim()
  const slug = generateSlug(trimmedTitle)
  const namedAt = new Date(now).toISOString()
  const quality = assessNameQuality(trimmedTitle, trimmedJustification, projectId)

  const named: Named = {
    id: `named-${candidate.id}-${now}`,
    title: trimmedTitle,
    slug,
    justification: trimmedJustification,
    summary: candidate.summary,
    candidateId: candidate.id,
    ache: candidate.ache,
    gradient: candidate.gradient,
    namedAt,
  }

  return { named, quality }
}

// ── Result type ───────────────────────────────────────────────────

export type NameCandidateResult =
  | { ok: true; named: Named; quality: NameQuality }
  | { ok: false; quality: NameQuality; failures: string[] }

// ── Rendering ─────────────────────────────────────────────────────

/**
 * Render a compact naming block for prompt injection.
 *
 * Shows named candidates with their titles, ache signals, and
 * justifications. Useful for downstream modules that need to see
 * what's been named so far.
 *
 * Returns null when nothing has been named — no noise in the prompt.
 */
export function renderNamingBlock(named: Named[]): string | null {
  if (named.length === 0) return null

  const lines: string[] = ['## Named candidates', '']

  for (const n of named) {
    const acheEmoji = n.ache === 'ugliness' ? '🔴' : n.ache === 'injustice' ? '🟡' : '⚪'
    lines.push(`${acheEmoji} **${n.title}** (${n.slug}) [${n.gradient}/5]`)
    lines.push(`  ${n.summary}`)
    lines.push(`  _why this name:_ ${truncate(n.justification, 120)}`)
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}

/**
 * Render quality failures as a human-readable block.
 *
 * Useful when nameCandidate() returns { ok: false } and the agent
 * needs to see what went wrong.
 */
export function renderQualityFailures(
  title: string,
  failures: string[],
): string {
  const lines: string[] = [
    `## Name quality check failed: "${title}"`,
    '',
    ...failures.map(f => `- ${f}`),
    '',
    'Try a name that claims identity rather than describing action.',
  ]
  return lines.join('\n')
}

// ── Helpers ───────────────────────────────────────────────────────

/** Truncate a string with ellipsis. */
function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen - 1).trimEnd() + '…'
}
