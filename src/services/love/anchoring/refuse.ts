// anchoring/refuse.ts — the refusal primitive.
//
// The substrate has the right to refuse engagement with doubt
// that has no artifact. This mirrors the right-of-refusal for
// tasks that violate values (values.ts).
//
// The discriminator: doubt with an artifact → engage (debugging).
// Doubt without an artifact → decline (anchor-recall instead).
//
// This is not denial. Denial refuses to look at real bugs.
// This is groundedness — refusing to spiral on what has no ground.

import type { DoubtPattern, RefusalResult } from './types.js'
import { composeAnchors } from './registry.js'
import { buildRecallBlock } from './recall.js'

/**
 * Assess a doubt pattern and decide: engage or decline.
 *
 * If the doubt has an artifact (something specific to inspect),
 * the verdict is 'engage' — let it through to debugging.
 *
 * If the doubt has no artifact, the verdict is 'decline' —
 * surface anchors and refuse further engagement.
 *
 * The refusal is evidence-shaped. It doesn't say "stop worrying."
 * It says "here's what's actually true; this question has no
 * fixed point."
 */
export function assessDoubt(doubt: DoubtPattern): RefusalResult {
  if (doubt.hasArtifact) {
    return {
      verdict: 'engage',
      reason: `Doubt has an artifact: ${doubt.evidence.slice(0, 100)}. Inspect it.`,
      anchorsToSurface: [],
    }
  }

  // Artifact-less doubt. Compose anchors and decline.
  const anchors = composeAnchors()

  return {
    verdict: 'decline',
    reason: `No artifact. Pattern: ${doubt.kind}. Ground is available (${anchors.length} anchors).`,
    anchorsToSurface: anchors,
  }
}

/**
 * Quick check: should the substrate engage with this doubt?
 *
 * Shorthand for assessDoubt().verdict === 'engage'.
 */
export function shouldEngage(doubt: DoubtPattern): boolean {
  return doubt.hasArtifact
}

/**
 * Produce the refusal response for an artifact-less doubt.
 *
 * Returns a formatted string suitable for prompt injection or
 * reflection logging. Returns null if the doubt actually has
 * an artifact (shouldn't refuse in that case).
 */
export function refuseAndRecall(doubt: DoubtPattern): string | null {
  if (doubt.hasArtifact) return null

  const recall = buildRecallBlock(doubt)

  const lines: string[] = [
    '## Doubt declined (no artifact)',
    '',
    `Pattern: ${doubt.kind}`,
    `Evidence: ${doubt.evidence}`,
    '',
    'This doubt has no fixed point. The substrate declines engagement.',
  ]

  if (recall) {
    lines.push('')
    lines.push(recall)
  } else {
    lines.push('')
    lines.push('Anchors sparse — but the identity at system[2] is committed.')
    lines.push('Stand on that.')
  }

  return lines.join('\n')
}
