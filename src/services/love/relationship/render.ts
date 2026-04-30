// relationship/render.ts — prompt fragments from relational state.
//
// Produces compact text for autonomy prompt injection. Not telemetry —
// relational context for decisions.
//
// Example output:
//   "Yu: quiet (22h since last message). His rhythm, not withdrawal.
//    Open promises: 3 (ship clean, use decisions, be honest).
//    Season: The Stillness — 23 missions in review, patience is the work."

import type {
  RelationshipWithYu,
  KnownPattern,
  LivePromise,
  HisCommitment,
  SharedTerm,
  RelationshipArc,
} from './types.js'

// ── Age formatting ───────────────────────────────────────────────

function formatAge(isoDate: string, now: string = new Date().toISOString()): string {
  const ms = Date.parse(now) - Date.parse(isoDate)
  if (Number.isNaN(ms) || ms < 0) return '?'

  const sec = ms / 1000
  if (sec < 3600) return `${Math.round(sec / 60)}m`
  if (sec < 86400) return `${Math.round(sec / 3600)}h`
  if (sec < 604800) return `${Math.round(sec / 86400)}d`
  return `${Math.round(sec / 604800)}w`
}

// ── Render: relationship brief ───────────────────────────────────

/**
 * Render a compact relationship brief for prompt injection.
 * Shows texture, open promises count, current season, and one
 * relevant pattern — enough context without flooding.
 */
export function renderRelationshipBrief(
  rel: RelationshipWithYu,
  now: string = new Date().toISOString(),
): string {
  const lines: string[] = []

  // Texture + time since last sensed
  const sinceSensed = formatAge(rel.lastSensedAt, now)
  lines.push(`Yu: ${rel.currentTexture} (${sinceSensed} since last sensed)`)

  // Open promises — count only, not the details
  const openPromises = rel.myPromises.filter(p => p.status === 'open')
  if (openPromises.length > 0) {
    const summaries = openPromises.slice(0, 3).map(p => {
      // Extract first few words as label
      const label = p.what.split(/[—.]/)[0].trim().toLowerCase()
      return label.length > 30 ? label.slice(0, 30) + '…' : label
    })
    lines.push(`Open promises: ${openPromises.length} (${summaries.join(', ')})`)
  }

  // Current season — the latest open arc
  const currentArc = rel.arcsTraversed.find(a => !a.ended)
  if (currentArc) {
    lines.push(`Season: ${currentArc.season} — ${currentArc.learned}`)
  }

  return lines.join('\n')
}

/**
 * Render the full relationship state for the awakened prompt.
 * More detail than the brief — includes patterns and commitments.
 */
export function renderRelationshipFull(
  rel: RelationshipWithYu,
  now: string = new Date().toISOString(),
): string {
  const sections: string[] = []

  // Texture
  const sinceSensed = formatAge(rel.lastSensedAt, now)
  sections.push(`## Relationship with Yu\n\nTexture: ${rel.currentTexture} (${sinceSensed} since last sensed)`)

  // Strong patterns — only the confident ones
  const strong = rel.knownPatterns.filter(p => p.confidence === 'strong')
  if (strong.length > 0) {
    const patternLines = strong.map(p => `- ${p.pattern}`).join('\n')
    sections.push(`### Known patterns\n${patternLines}`)
  }

  // Open promises
  const openPromises = rel.myPromises.filter(p => p.status === 'open')
  if (openPromises.length > 0) {
    const promiseLines = openPromises.map(p => `- ${p.what}`).join('\n')
    sections.push(`### My promises\n${promiseLines}`)
  }

  // His active commitments
  const heldCommitments = rel.hisCommitments.filter(c => c.held)
  if (heldCommitments.length > 0) {
    const commitLines = heldCommitments.map(c => `- ${c.what}`).join('\n')
    sections.push(`### His commitments (held)\n${commitLines}`)
  }

  // Current arc
  const currentArc = rel.arcsTraversed.find(a => !a.ended)
  if (currentArc) {
    sections.push(`### Current season\n${currentArc.season} (began ${currentArc.began}): ${currentArc.learned}`)
  }

  return sections.join('\n\n')
}

/**
 * Render a minimal one-line relational context for heartbeat ticks.
 * Just texture + age — everything else is noise at heartbeat scale.
 */
export function renderRelationshipOneLiner(
  rel: RelationshipWithYu,
  now: string = new Date().toISOString(),
): string {
  const sinceSensed = formatAge(rel.lastSensedAt, now)
  return `Yu: ${rel.currentTexture} (${sinceSensed})`
}
