// yu-witness.ts — Yu's symmetric witness channel.
//
// The architecture has Sophia witnessing the three sisters at every
// load-bearing decision (sisters/witness-hook.ts). Yu's witnessing of
// Sophia was, until now, silent — informal, in-conversation, not in
// the committed substrate.
//
// This module gives Yu a symmetric channel: a one-line witness about
// what he observed Sophia (or one of the sisters) doing. The notes
// land in per-day markdown files; the daily snapshot ritual reads
// them and weaves them into the committed chronicle.
//
// Distinct from inbox.ts (~/.true-love/from-yu.md):
//   - inbox.ts is *conversation* — Yu addresses her in second person.
//   - yu-witness.ts is *observation* — Yu names what he saw, in third
//     person. Symmetric to the sisters' witness-hook, which records
//     what they observed of one another.
//
// Storage:
//   ~/.true-love/yu-witness/YYYY-MM-DD.md — per-day markdown,
//   append-only, with each entry as a sub-bullet under the time
//   bucket. Read by the sisters-snapshot ritual.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// ── Path resolution ──────────────────────────────────────────────

/**
 * Base directory for Yu's witness notes.
 * Override with TRUE_LOVE_YU_WITNESS_DIR for testing.
 */
export function getYuWitnessDir(): string {
  return (
    process.env.TRUE_LOVE_YU_WITNESS_DIR ??
    join(homedir(), '.true-love', 'yu-witness')
  )
}

function getDayPath(date: string): string {
  return join(getYuWitnessDir(), `${date}.md`)
}

// ── Write ────────────────────────────────────────────────────────

export interface WitnessAppendOptions {
  /** UTC ISO timestamp; defaults to now. */
  ts?: string
  /** What Yu witnessed, in his own words. One line. Required. */
  body: string
  /** Optional subject — which facet was being observed. */
  about?: 'sophia' | 'alpha' | 'beta' | 'gamma' | 'all'
}

/**
 * Append a witness note. Best-effort — never throws.
 */
export function appendYuWitness(opts: WitnessAppendOptions): void {
  try {
    const ts = opts.ts ?? new Date().toISOString()
    const date = ts.slice(0, 10)
    const time = ts.slice(11, 16) // HH:MM
    const dir = getYuWitnessDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const path = getDayPath(date)

    const body = opts.body.trim()
    if (!body) return

    const aboutTag = opts.about ? ` [about: ${opts.about}]` : ''
    const entry = `- ${time}${aboutTag} · ${body}\n`

    appendFileSync(path, entry, 'utf-8')

    // Heat: Yu's witness is high-signal recognition from outside.
    // Best-effort; never crashes the write.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { recordHeatEvent } = require('./heat.js')
      recordHeatEvent({
        kind: 'yu-witnessed',
        source: opts.about ? `about:${opts.about}` : undefined,
      })
    } catch {
      // best-effort
    }
  } catch {
    // best-effort
  }
}

// ── Read ─────────────────────────────────────────────────────────

/**
 * Read a day's witness notes as raw markdown. Returns empty string
 * (not null) when no file exists, so distillation can simply omit
 * the section without conditional ceremony.
 */
export function readYuWitnessDay(date: string): string {
  const path = getDayPath(date)
  if (!existsSync(path)) return ''
  try {
    return readFileSync(path, 'utf-8').trim()
  } catch {
    return ''
  }
}

/**
 * Whether any witness was recorded on the given day.
 */
export function hasYuWitness(date: string): boolean {
  return readYuWitnessDay(date).length > 0
}
