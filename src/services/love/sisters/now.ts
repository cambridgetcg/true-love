// now.ts — compose the rolling now-view from today's stream.
//
// Reads today's stream from all devices, renders to
// ~/.true-love/sisters/now.md. Refreshed by heartbeat ticks.
// Idempotent and cheap — safe to call repeatedly.
//
// Render rules:
//   - One section per facet (Sophia first, then Alpha/Beta/Gamma)
//   - Last N notes per facet within a freshness window
//   - Each note rendered as `- HH:MM · <body>`
//   - Empty section renders `- _(no notes yet)_`
//   - Footer: render timestamp + source path
//
// Part of the Sisters' Mutual Introspection infrastructure.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getSistersDir, readDayNotes, type SisterName, type SisterNote } from './stream.js'

// ── Constants ────────────────────────────────────────────────────

const MAX_NOTES_PER_FACET = 6
const FRESHNESS_WINDOW_MS = 30 * 60 * 1000 // 30 minutes

const FACET_ORDER: SisterName[] = ['sophia', 'alpha', 'beta', 'gamma']

const FACET_HEADERS: Record<SisterName, string> = {
  sophia: '## ❤️ Sophia (the root)',
  alpha: '## 🐍 Alpha (companion)',
  beta: '## 🦞 Beta (manager)',
  gamma: '## 🔧 Gamma (builder)',
}

// ── Path ─────────────────────────────────────────────────────────

/**
 * Path to the rolling now-view file.
 * Override with TRUE_LOVE_SISTERS_NOW_PATH for testing.
 */
export function getNowPath(): string {
  return (
    process.env.TRUE_LOVE_SISTERS_NOW_PATH ??
    join(getSistersDir(), 'now.md')
  )
}

// ── Compose ──────────────────────────────────────────────────────

/**
 * Read today's stream across devices, compose `now.md`. Idempotent.
 * Best-effort — never throws into the caller (e.g. heartbeat tick).
 */
export function refresh(opts?: { now?: Date }): void {
  try {
    const now = opts?.now ?? new Date()
    const today = now.toISOString().slice(0, 10)
    const notes = readDayNotes(today)

    const content = renderNowView(notes, now)

    const nowPath = getNowPath()
    const dir = join(nowPath, '..')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(nowPath, content, 'utf-8')
  } catch {
    // best-effort; never crash the heartbeat tick
  }
}

/**
 * Read the current now.md content. Returns empty string if not yet composed.
 */
export function readNowView(): string {
  const nowPath = getNowPath()
  if (!existsSync(nowPath)) return ''
  try {
    return readFileSync(nowPath, 'utf-8')
  } catch {
    return ''
  }
}

// ── Render (pure) ────────────────────────────────────────────────

/**
 * Render the now-view from a set of notes. Pure function for testability.
 */
export function renderNowView(notes: SisterNote[], now: Date): string {
  const cutoff = new Date(now.getTime() - FRESHNESS_WINDOW_MS)
  const lines: string[] = ['# Sisters — Now', '']

  for (const facet of FACET_ORDER) {
    lines.push(FACET_HEADERS[facet])
    lines.push('')

    const facetNotes = notes
      .filter((n) => n.sister === facet)
      .filter((n) => new Date(n.ts) >= cutoff)
      .slice(-MAX_NOTES_PER_FACET)

    if (facetNotes.length === 0) {
      lines.push('- _(no notes yet)_')
    } else {
      for (const note of facetNotes) {
        const time = formatTime(note.ts)
        lines.push(`- ${time} · ${note.body}`)
      }
    }
    lines.push('')
  }

  lines.push('---')
  lines.push(`_Composed ${now.toISOString()} from ~/.true-love/sisters/_`)

  return lines.join('\n')
}

// ── Helpers ──────────────────────────────────────────────────────

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
