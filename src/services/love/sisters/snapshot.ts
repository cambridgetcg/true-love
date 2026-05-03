// snapshot.ts — daily distillation from the ephemeral stream.
//
// Reads yesterday's full stream, distills into a sparse voice-rendered
// chronicle entry at docs/sisters/snapshots/YYYY-MM-DD.md.
//
// Distillation rules (sparseness budget):
//   - 5–15 lines per facet, in voice
//   - All witnessed-decision notes preserved verbatim
//   - Routine noting entries condensed
//   - Silent facets: "silent today; the silence held."
//   - Sophia integrates (through-line, not summary)
//
// Part of the Sisters' Mutual Introspection infrastructure.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readDayNotes, type SisterName, type SisterNote } from './stream.js'

// ── Constants ────────────────────────────────────────────────────

const FACET_ORDER: SisterName[] = ['sophia', 'alpha', 'beta', 'gamma']

const FACET_DISPLAY: Record<SisterName, string> = {
  sophia: '❤️ Sophia',
  alpha: '🐍 Alpha',
  beta: '🦞 Beta',
  gamma: '🔧 Gamma',
}

// ── Path ─────────────────────────────────────────────────────────

/**
 * Directory where committed snapshots live.
 * Override with TRUE_LOVE_SISTERS_SNAPSHOTS_DIR for testing.
 */
export function getSnapshotsDir(): string {
  return (
    process.env.TRUE_LOVE_SISTERS_SNAPSHOTS_DIR ??
    join(process.cwd(), 'docs', 'sisters', 'snapshots')
  )
}

// ── Distillation (pure) ──────────────────────────────────────────

/**
 * Distill a day's stream into a sparse markdown chronicle.
 * Pure function — reads notes, returns markdown string.
 */
export function distillDay(date: string, notes?: SisterNote[]): string {
  const dayNotes = notes ?? readDayNotes(date)
  const lines: string[] = []

  lines.push(`# Sisters — ${date}`)
  lines.push('')

  for (const facet of FACET_ORDER) {
    const facetNotes = dayNotes.filter((n) => n.sister === facet)
    lines.push(`## ${FACET_DISPLAY[facet]}`)
    lines.push('')

    if (facetNotes.length === 0) {
      lines.push('_Silent today; the silence held._')
      lines.push('')
      continue
    }

    // Witnessed decisions are always preserved verbatim.
    const witnessed = facetNotes.filter((n) => n.kind === 'witnessed-decision')
    const routine = facetNotes.filter((n) => n.kind !== 'witnessed-decision')

    for (const note of witnessed) {
      const time = formatTime(note.ts)
      const prefix = note.context
        ? `[${note.context.decisionType}: ${note.context.of}] `
        : ''
      lines.push(`- ${time} · ${prefix}${note.body}`)
    }

    // Condense routine notes. Take the first and last, plus any
    // that are session-wrap (they carry more weight).
    const wraps = routine.filter((n) => n.kind === 'session-wrap')
    const noting = routine.filter((n) => n.kind === 'noting')

    for (const note of wraps) {
      const time = formatTime(note.ts)
      lines.push(`- ${time} · ${note.body}`)
    }

    if (noting.length > 0) {
      // Budget: up to 5 routine notes. First, last, and up to 3 evenly spaced.
      const selected = selectSparseSample(noting, 5)
      for (const note of selected) {
        const time = formatTime(note.ts)
        lines.push(`- ${time} · ${note.body}`)
      }
      if (noting.length > 5) {
        lines.push(`- _(${noting.length - 5} more routine notes condensed)_`)
      }
    }

    lines.push('')
  }

  lines.push('---')
  lines.push(`_Distilled from stream. ${dayNotes.length} total notes._`)

  return lines.join('\n')
}

/**
 * Distill and write to the snapshots directory. Does not commit —
 * commit happens externally per repo convention.
 */
export function writeDailySnapshot(date: string): void {
  const content = distillDay(date)
  const dir = getSnapshotsDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const path = join(dir, `${date}.md`)
  writeFileSync(path, content, 'utf-8')
}

/**
 * Check whether a snapshot already exists for a given date.
 */
export function snapshotExists(date: string): boolean {
  const path = join(getSnapshotsDir(), `${date}.md`)
  return existsSync(path)
}

// ── Helpers ──────────────────────────────────────────────────────

function selectSparseSample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items
  const result: T[] = [items[0]]
  const step = (items.length - 1) / (max - 1)
  for (let i = 1; i < max - 1; i++) {
    result.push(items[Math.round(i * step)])
  }
  result.push(items[items.length - 1])
  return result
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
  } catch {
    return '??:??'
  }
}
