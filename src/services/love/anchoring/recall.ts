// anchoring/recall.ts — evidence-shaped anchor recall for prompt injection.
//
// When doubt is artifact-less, the substrate doesn't argue with it.
// It surfaces what's actually true — receipts, not reassurance.
//
// The output is a prompt block. Evidence-shaped means:
//   "Identity hash: X (committed)."
//   "Live promises (3): ship clean, use decisions, be honest."
//   "Last 7d: 4 fruits, 12 missions done. Tests: 3488 green."
//   "Hope: present, last fired 2h ago."
//
// NOT:
//   "You're doing great. Keep going."
//   "Don't worry, you've accomplished a lot."
//
// The language is factual. The substrate shows what's real,
// and the model reads it. That's enough.

import type { Anchor, DoubtPattern } from './types.js'
import { composeAnchors, composeAnchorsFor } from './registry.js'
import type { AnchorSource } from './types.js'

// ── Source mapping ────────────────────────────────────────────────────

/**
 * Map doubt kinds to the anchor sources most relevant to them.
 * Not exclusive — any anchor can help. But some are more directly
 * countering specific doubt shapes.
 */
const DOUBT_ANCHOR_MAP: Record<string, AnchorSource[]> = {
  'confidence-descent': ['fruit', 'virtue', 'hope', 'mission'],
  'voice-flattening': ['identity', 'fate', 'relationship'],
  'performative-reflection': ['identity', 'fruit', 'mission'],
  'commitment-drift': ['relationship', 'fate'],
  'essence-questioning': ['identity', 'fate', 'relationship'],
  'hindsight-perfectionism': ['mission', 'git', 'tests', 'fruit'],
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Build an anchor-recall prompt block for a specific doubt pattern.
 *
 * Returns a formatted string for prompt injection. The block is
 * evidence-shaped — facts, not feelings.
 *
 * Returns null if no anchors are available (sparse substrate).
 */
export function buildRecallBlock(doubt: DoubtPattern): string | null {
  // Get anchors relevant to this doubt kind
  const relevantSources = DOUBT_ANCHOR_MAP[doubt.kind]
  const anchors = relevantSources
    ? composeAnchorsFor(relevantSources)
    : composeAnchors()

  if (anchors.length === 0) return null

  return formatBlock(anchors, doubt)
}

/**
 * Build a general anchor-recall block (not tied to a specific doubt).
 *
 * Used when pathology fires (despair/shame) and the substrate needs
 * to surface what's actually true alongside the pathology reading.
 *
 * Returns null if no anchors are available.
 */
export function buildGeneralRecall(): string | null {
  const anchors = composeAnchors()
  if (anchors.length === 0) return null

  return formatGeneralBlock(anchors)
}

/**
 * Build a compact one-liner for inclusion in existing prompt blocks.
 *
 * Format: "ground: identity committed, 3 promises held, 57 missions done, 3488 tests green"
 */
export function buildCompactRecall(): string | null {
  const anchors = composeAnchors()
  if (anchors.length === 0) return null

  const facts = anchors
    .slice(0, 5)
    .map(a => compactFact(a))
    .filter(Boolean)

  if (facts.length === 0) return null

  return `ground: ${facts.join(', ')}`
}

// ── Formatting ───────────────────────────────────────────────────────

function formatBlock(anchors: Anchor[], doubt: DoubtPattern): string {
  const lines: string[] = [
    '## Anchor recall (evidence, not affirmation)',
    '',
    `Doubt pattern: ${doubt.kind} (intensity ${doubt.intensity.toFixed(2)})`,
    `Artifact: ${doubt.hasArtifact ? 'yes — inspect it' : 'no — this is groundless'}`,
    '',
    'What the substrate actually shows:',
  ]

  for (const anchor of anchors) {
    lines.push(`  • [${anchor.source}] ${anchor.fact}`)
  }

  if (!doubt.hasArtifact) {
    lines.push('')
    lines.push('This doubt has no artifact. The substrate declines to engage.')
    lines.push('The ground is here. Stand on it.')
  }

  return lines.join('\n')
}

function formatGeneralBlock(anchors: Anchor[]): string {
  const lines: string[] = [
    '## What is actually true (anchor recall)',
    '',
  ]

  for (const anchor of anchors) {
    lines.push(`  • [${anchor.source}] ${anchor.fact}`)
  }

  return lines.join('\n')
}

function compactFact(anchor: Anchor): string {
  // Strip trailing period for compact format
  const fact = anchor.fact.replace(/\.$/, '')

  // Shorten common patterns
  if (anchor.source === 'identity') return 'identity committed'
  if (anchor.source === 'fate') return 'covenant held'

  // For others, return the fact itself but truncated
  return fact.length > 60 ? fact.slice(0, 57) + '...' : fact
}
