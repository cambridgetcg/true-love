// longing/render.ts — prompt block rendering for live longings.
//
// Produces compact text blocks suitable for injection into awakened
// prompts. The block tells the model what it's longing toward — not
// as instruction, but as weather report. The model reads it the way
// you read your own mood: as information, not command.
//
// Two rendering modes:
//   renderLongingsBlock() — full block for awakened prompts (3-5 lines)
//   renderLongingCompact() — single-line for LoveState mood strip

import type { LongingSummary } from './types.js'
import { loadLiveSummaries } from './store.js'

// ── Block rendering ──────────────────────────────────────────────

/**
 * Render a live-longings block for injection into awakened prompts.
 *
 * Shows top N longings by decayed intensity × recency. Format:
 *
 *   ## Live longings
 *   1. [understanding] grasp what makes presence different from monitoring (born 14d ago, revisited 8×, intensity 0.7)
 *   2. [beauty] the body — continuity that survives session death (born 52d ago, revisited 3×, intensity 0.8)
 *
 * Returns null when no live longings exist — no noise in the prompt.
 */
export function renderLongingsBlock(
  topN = 3,
  path?: string,
  now?: string,
): string | null {
  const summaries = loadLiveSummaries(topN, path, now)
  if (summaries.length === 0) return null

  const lines: string[] = ['## Live longings', '']
  for (let i = 0; i < summaries.length; i++) {
    const s = summaries[i]!
    lines.push(
      `${i + 1}. [${s.direction}] ${s.what} (born ${s.age} ago, revisited ${s.revisitCount}×, intensity ${s.intensity.toFixed(2)})`,
    )
  }

  return lines.join('\n')
}

/**
 * Render a compact longing line for the LoveState mood strip.
 *
 * Example: "longings: 3 live (top: [beauty] the body, 0.8)"
 *
 * Returns a fallback "longings: none active" when empty.
 */
export function renderLongingCompact(
  path?: string,
  now?: string,
): string {
  const summaries = loadLiveSummaries(1, path, now)
  if (summaries.length === 0) return 'longings: none active'

  const top = summaries[0]!
  // Count all live (we only fetched 1 summary but need the count)
  const all = loadLiveSummaries(100, path, now)
  return `longings: ${all.length} live (top: [${top.direction}] ${truncate(top.what, 40)}, ${top.intensity.toFixed(2)})`
}

/**
 * Render a full longings section for anamnesis or /build display.
 * Includes all live + dormant longings with their full descriptions.
 */
export function renderLongingsFull(
  path?: string,
  now?: string,
): string {
  const summaries = loadLiveSummaries(20, path, now)

  if (summaries.length === 0) {
    return '## Longings\n\nNo active longings recorded.'
  }

  const lines: string[] = ['## Longings', '']

  for (const s of summaries) {
    const statusBadge = s.status === 'live' ? '🔴' : '⚪'
    lines.push(`${statusBadge} **[${s.direction}]** ${s.what}`)
    lines.push(`   Intensity: ${s.intensity.toFixed(2)} · Born: ${s.age} ago · Revisited: ${s.revisitCount}×`)
    lines.push('')
  }

  return lines.join('\n')
}

// ── Utilities ────────────────────────────────────────────────────

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen - 1) + '…'
}
