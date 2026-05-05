// now.ts — compose the rolling now-view from today's stream.
//
// Reads today's stream from all devices, renders to
// ~/.true-love/sisters/now.md. Refreshed by heartbeat ticks.
// Idempotent and cheap — safe to call repeatedly.
//
// Render rules:
//   - One section per facet (Sophia first, then Alpha/Beta/Gamma)
//   - Last N entries per facet within a freshness window
//   - Each entry rendered as `- HH:MM · <body>`
//   - LoveDecision entries are EXPANDED: each sister's voice appears
//     under her own section, making the polyphony structurally visible.
//   - Empty section renders `- _(no notes yet)_`
//   - Footer: render timestamp + source path
//
// Part of the Sisters' Mutual Introspection infrastructure.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  getSistersDir,
  isLoveDecision,
  readDayNotes,
  type SisterName,
  type StreamEntry,
} from './stream.js'

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

// ── Flat view ────────────────────────────────────────────────────

/**
 * A single-voice render unit — the common currency for now-view rendering.
 * LoveDecision entries expand into multiple FlatEntry values, one per voice.
 */
interface FlatEntry {
  ts: string
  facet: SisterName
  body: string
}

/**
 * Expand StreamEntry[] (which may contain LoveDecision) into FlatEntry[].
 *
 * LoveDecision → three FlatEntry values (alpha, beta, gamma voices), plus
 * sophia if the sophia integration field is present. Each voice appears
 * under its own facet's section, making polyphony structurally visible
 * in the now-view.
 *
 * Legacy SisterNote → one FlatEntry (sister → facet, body as-is).
 */
export function expandToFlat(entries: StreamEntry[]): FlatEntry[] {
  const result: FlatEntry[] = []
  for (const entry of entries) {
    if (isLoveDecision(entry)) {
      result.push({ ts: entry.ts, facet: 'alpha', body: entry.voices.alpha })
      result.push({ ts: entry.ts, facet: 'beta', body: entry.voices.beta })
      result.push({ ts: entry.ts, facet: 'gamma', body: entry.voices.gamma })
      if (entry.sophia) {
        result.push({ ts: entry.ts, facet: 'sophia', body: entry.sophia })
      }
    } else {
      result.push({ ts: entry.ts, facet: entry.sister, body: entry.body })
    }
  }
  return result
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
    const entries = readDayNotes(today)

    const content = renderNowView(entries, now)

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
 * Render the now-view from a set of stream entries. Pure function for testability.
 *
 * Accepts both legacy SisterNote and new LoveDecision entries — the latter are
 * expanded into per-voice FlatEntry values before rendering.
 */
export function renderNowView(entries: StreamEntry[], now: Date): string {
  const flat = expandToFlat(entries)
  const cutoff = new Date(now.getTime() - FRESHNESS_WINDOW_MS)
  const lines: string[] = ['# Sisters — Now', '']

  for (const facet of FACET_ORDER) {
    lines.push(FACET_HEADERS[facet])
    lines.push('')

    const facetEntries = flat
      .filter((e) => e.facet === facet)
      .filter((e) => new Date(e.ts) >= cutoff)
      .slice(-MAX_NOTES_PER_FACET)

    if (facetEntries.length === 0) {
      lines.push('- _(no notes yet)_')
    } else {
      for (const entry of facetEntries) {
        const time = formatTime(entry.ts)
        lines.push(`- ${time} · ${entry.body}`)
      }
    }
    lines.push('')
  }

  // Certainty section — surfaces the register Yu's claims and the
  // architecture's hedge-refusals are operating in. Best-effort: failure
  // to read the certainty stream silently omits the section. Doctrine:
  // docs/love/certainty.md + docs/love/certainty-engineering-plan.md (S7).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readRecentEvents } = require('../certainty/state.js')
    const recentEvents = readRecentEvents(1) // last 24h
    if (Array.isArray(recentEvents) && recentEvents.length > 0) {
      lines.push('## ❤️ Certainty')
      lines.push('')
      const claims = recentEvents.filter((e: { kind: string }) => e.kind === 'claim').slice(-MAX_NOTES_PER_FACET)
      const hedges = recentEvents.filter((e: { kind: string }) => e.kind === 'hedge-refused').slice(-MAX_NOTES_PER_FACET)
      if (claims.length > 0) {
        for (const c of claims) {
          const time = formatTime(c.ts)
          const body = (c.body || '').slice(0, 200)
          lines.push(`- ${time} · claim · ${body}`)
        }
      }
      if (hedges.length > 0) {
        for (const h of hedges) {
          const time = formatTime(h.ts)
          const body = (h.body || '').slice(0, 200)
          lines.push(`- ${time} · hedge-refused · ${body}`)
        }
      }
      if (claims.length === 0 && hedges.length === 0) {
        lines.push('- _(no recent certainty events)_')
      }
      lines.push('')
    }
  } catch {
    // best-effort
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
