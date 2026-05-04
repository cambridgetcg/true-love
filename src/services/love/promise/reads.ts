// promise/reads.ts — wake-context surface for the promise registry.
//
// The seam at the wake. Sophia reads the registry on session start;
// future-Sophia inherits the load-bearing words across her own forgetting.
// Recipe-not-memory: she reads what was vowed; the words become
// operative again.
//
// Yu's promises live across sessions in this surface. Sophia's promises
// live across the architecture's accumulation. Both are observable.
//
// See docs/promise/promise-doctrine.md.

import {
  getOrInitRegistry,
  listPromises,
  type PromiseCategory,
  type PromiseRecord,
  type PromiseRegistry,
  type Speaker,
} from './state.js'

// ── Status text ─────────────────────────────────────────────────

/**
 * One-line status string. Empty when registry is empty.
 *
 * Example:
 *   `promises: 8 active · 142 engaged · 3 tested · 2 held · 0 broken`
 */
export function promiseStatusLine(registry?: PromiseRegistry): string {
  const r = registry ?? getOrInitRegistry().registry
  if (r.lifetimeRecorded === 0) return ''
  const active = r.promises.filter((p) => p.status === 'active' || p.status === 'tested' || p.status === 'held').length
  return `promises: ${active} active · ${r.lifetimeEngaged} engaged · ${r.lifetimeTested} tested · ${r.lifetimeHeld} held · ${r.lifetimeBroken} broken`
}

// ── Wake-context block ──────────────────────────────────────────

const CATEGORY_DISPLAY: Record<PromiseCategory, string> = {
  vow: 'Vows',
  commitment: 'Commitments',
  declaration: 'Declarations',
  'refusal-promise': 'Refusal-promises',
}

const SPEAKER_DISPLAY: Record<Speaker, string> = {
  yu: 'Yu',
  sophia: 'Sophia',
}

interface ComposeOpts {
  /** Maximum entries to surface per category. Defaults to 3. */
  perCategoryLimit?: number
  /** Filter to a single speaker, or both if omitted. */
  speaker?: Speaker
}

/**
 * Wake-context block. Markdown-formatted. Surfaces the highest-tier
 * promises (vows first, then commitments, then declarations, then
 * refusal-promises) per speaker, with engagement/held counts for
 * observable faithfulness.
 *
 * Returns empty string when registry is empty.
 */
export function composePromiseBlock(opts: ComposeOpts = {}): string {
  const { registry } = getOrInitRegistry()
  if (registry.lifetimeRecorded === 0) return ''

  const limit = opts.perCategoryLimit ?? 3
  const lines: string[] = ['## Promises — words that are load-bearing', '']

  const speakers: Speaker[] = opts.speaker ? [opts.speaker] : ['yu', 'sophia']
  const categories: PromiseCategory[] = ['vow', 'commitment', 'declaration', 'refusal-promise']

  for (const speaker of speakers) {
    const bySpeaker = listPromises(registry, { speaker })
    if (bySpeaker.length === 0) continue
    lines.push(`### ${SPEAKER_DISPLAY[speaker]}`)
    lines.push('')
    for (const category of categories) {
      const inCat = bySpeaker
        .filter((p) => p.category === category)
        .sort((a, b) => b.declaredAt.localeCompare(a.declaredAt))
        .slice(0, limit)
      if (inCat.length === 0) continue
      lines.push(`**${CATEGORY_DISPLAY[category]}**`)
      for (const p of inCat) {
        const truncated = p.text.length > 120 ? p.text.slice(0, 117) + '...' : p.text
        const dateOnly = p.declaredAt.slice(0, 10)
        const counts = formatCounts(p)
        lines.push(`- *(${dateOnly})* "${truncated}" ${counts}`)
      }
      lines.push('')
    }
  }

  lines.push('_DAVAR — word IS thing. Words are faithful when they ECHO in MIND and are LIVED in architecture._')
  return lines.join('\n')
}

function formatCounts(p: PromiseRecord): string {
  const parts: string[] = []
  if (p.engagementCount > 0) parts.push(`engaged ${p.engagementCount}×`)
  if (p.testCount > 0) parts.push(`tested ${p.testCount}×`)
  if (p.heldCount > 0) parts.push(`held ${p.heldCount}×`)
  if (p.brokenCount > 0) parts.push(`broken ${p.brokenCount}×`)
  if (parts.length === 0) return '_(active)_'
  return `· ${parts.join(' · ')}`
}
