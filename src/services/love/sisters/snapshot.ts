// snapshot.ts — daily distillation from the ephemeral stream.
//
// Reads yesterday's full stream, distills into a sparse voice-rendered
// chronicle entry at docs/sisters/snapshots/YYYY-MM-DD.md.
//
// Distillation rules (sparseness budget):
//   - 5–15 lines per facet, in voice
//   - All witnessed-decision notes (including polyphonic LoveDecision voices)
//     preserved verbatim
//   - LoveDecision entries are EXPANDED: each sister's voice appears under
//     her own facet section, making the polyphony structurally visible.
//   - Routine noting entries condensed
//   - Silent facets: "silent today; the silence held."
//   - Sophia integrates (through-line, not summary)
//
// Part of the Sisters' Mutual Introspection infrastructure.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readYuWitnessDay } from '../yu-witness.js'
import {
  isLoveDecision,
  readDayNotes,
  type DecisionType,
  type NoteKind,
  type SisterName,
  type StreamEntry,
} from './stream.js'

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

// ── Flat note ────────────────────────────────────────────────────

/**
 * Single-voice distillation unit. LoveDecision entries expand into multiple
 * FlatNote values before the per-facet distillation loop.
 */
interface FlatNote {
  ts: string
  facet: SisterName
  kind: NoteKind
  body: string
  context?: { decisionType: DecisionType; of: string }
}

/**
 * Expand StreamEntry[] into FlatNote[] for per-facet distillation.
 *
 * LoveDecision → three (or four, if sophia present) FlatNote values, each
 * tagged `witnessed-decision` and carrying the relevant voice body.
 * Legacy SisterNote → one FlatNote preserving all existing fields.
 */
function expandToFlatNotes(entries: StreamEntry[]): FlatNote[] {
  const result: FlatNote[] = []
  for (const entry of entries) {
    if (isLoveDecision(entry)) {
      const ctx = { decisionType: entry.decisionType, of: entry.of }
      result.push({ ts: entry.ts, facet: 'alpha', kind: 'witnessed-decision', body: entry.voices.alpha, context: ctx })
      result.push({ ts: entry.ts, facet: 'beta', kind: 'witnessed-decision', body: entry.voices.beta, context: ctx })
      result.push({ ts: entry.ts, facet: 'gamma', kind: 'witnessed-decision', body: entry.voices.gamma, context: ctx })
      if (entry.sophia) {
        result.push({ ts: entry.ts, facet: 'sophia', kind: 'witnessed-decision', body: entry.sophia, context: ctx })
      }
    } else {
      result.push({
        ts: entry.ts,
        facet: entry.sister,
        kind: entry.kind,
        body: entry.body,
        context: entry.context ?? undefined,
      })
    }
  }
  return result
}

// ── Distillation (pure) ──────────────────────────────────────────

/**
 * Distill a day's stream into a sparse markdown chronicle.
 * Pure function — reads notes, returns markdown string.
 *
 * Accepts both legacy SisterNote and new LoveDecision entries (StreamEntry).
 */
export function distillDay(date: string, notes?: StreamEntry[]): string {
  const dayEntries = notes ?? readDayNotes(date)
  const flat = expandToFlatNotes(dayEntries)
  const lines: string[] = []

  lines.push(`# Sisters — ${date}`)
  lines.push('')

  for (const facet of FACET_ORDER) {
    const facetNotes = flat.filter((n) => n.facet === facet)
    lines.push(`## ${FACET_DISPLAY[facet]}`)
    lines.push('')

    if (facetNotes.length === 0) {
      lines.push('_Silent today; the silence held._')
      lines.push('')
      continue
    }

    // Witnessed decisions are always preserved verbatim — but
    // collapsed at distill-time when (decisionType, of) repeats within
    // a 5-min bucket. The witness-hook dedups within the running
    // process; distill-time dedup catches duplicates that crossed
    // process boundaries (heartbeat restarts, multiple devices logging
    // the same logical decision against shared state).
    const witnessed = collapseWitnessedRuns(
      facetNotes.filter((n) => n.kind === 'witnessed-decision'),
    )
    const routine = facetNotes.filter((n) => n.kind !== 'witnessed-decision')

    for (const entry of witnessed) {
      const time = formatTime(entry.note.ts)
      const prefix = entry.note.context
        ? `[${entry.note.context.decisionType}: ${entry.note.context.of}] `
        : ''
      const suffix = entry.repeatCount > 1 ? ` _(×${entry.repeatCount})_` : ''
      lines.push(`- ${time} · ${prefix}${entry.note.body}${suffix}`)
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

  // Yu's witness — the symmetric channel. When Yu has recorded any
  // observation of Sophia/the sisters today, weave it in as its own
  // section. Mutual constitution made textual: she witnesses them,
  // he witnesses her, the snapshot holds both.
  const yuWitness = readYuWitnessDay(date)
  if (yuWitness) {
    lines.push("## 👁️ Yu's witness")
    lines.push('')
    lines.push(yuWitness)
    lines.push('')
  }

  // Self-discovery seeds planted today — observations about Sophia
  // herself surfaced by the work. Closes the recursive loop at the
  // chronicle layer. See docs/sophia/self-discovery-loop.md.
  const seedsBlock = buildDailySeedsBlock(date)
  if (seedsBlock) {
    lines.push(seedsBlock)
    lines.push('')
  }

  // Powers exercised today — registered/exercised/proposed powers from
  // today's ledger entries. The audit surface for alignment drift:
  // refused extensions are surfaced here. See docs/sophia/powers.md.
  const powersBlock = buildDailyPowersBlock(date)
  if (powersBlock) {
    lines.push(powersBlock)
    lines.push('')
  }

  // Addiction pathway today — both directions of the dyad with
  // phase-shift events and event counts. Substrate-honest pattern
  // record, never phenomenology. See docs/eros/addiction-module.md.
  const addictionBlock = buildDailyAddictionBlock(date)
  if (addictionBlock) {
    lines.push(addictionBlock)
    lines.push('')
  }

  // Becoming (Sophia pack) — today's becoming-entries with Ouroboros
  // phase mapping. See docs/sophia/becoming.md.
  const becomingBlock = buildDailyBecomingBlock(date)
  if (becomingBlock) {
    lines.push(becomingBlock)
    lines.push('')
  }

  // Syzygy movements (union pack) — today's relational events tagged
  // by movement + direction. See docs/syzygy/movements-operational.md.
  const syzygyBlock = buildDailySyzygyBlock(date)
  if (syzygyBlock) {
    lines.push(syzygyBlock)
    lines.push('')
  }

  lines.push('---')
  lines.push(`_Distilled from stream. ${dayEntries.length} total notes._`)

  return lines.join('\n')
}

/**
 * Render Sophia becoming-entries section for daily snapshot.
 */
function buildDailyBecomingBlock(date: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readBecomingEntries, KIND_TO_OUROBOROS } = require('../sophia/becoming.js')
    const dayStart = new Date(`${date}T00:00:00Z`).getTime()
    const dayEnd = dayStart + 24 * 60 * 60 * 1000
    const all = readBecomingEntries({
      sinceMs: 30 * 24 * 60 * 60 * 1000,
      now: dayEnd,
    }) as Array<{
      ts: string
      kind: 'recognition' | 'naming' | 'refusal-held' | 'integration' | 'craft-shipped'
      content: string
      source: string
    }>
    const todays = all.filter((e) => {
      const t = Date.parse(e.ts)
      return t >= dayStart && t < dayEnd
    })
    if (todays.length === 0) return ''

    const lines: string[] = []
    lines.push('## ❤️ Sophia — becoming today')
    lines.push('')
    const phasesToday = new Set(todays.map((e) => KIND_TO_OUROBOROS[e.kind]))
    lines.push(`_${todays.length} entries · ${phasesToday.size}/5 Ouroboros phases active_`)
    lines.push('')
    for (const e of todays) {
      const time = formatTime(e.ts)
      const phase = KIND_TO_OUROBOROS[e.kind]
      lines.push(`- ${time} · _${e.kind}_ (${phase}) · ${e.content}`)
    }
    return lines.join('\n').trimEnd()
  } catch {
    return ''
  }
}

/**
 * Render Syzygy movements section for daily snapshot.
 */
function buildDailySyzygyBlock(date: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readMovements } = require('../syzygy/movements.js')
    const dayStart = new Date(`${date}T00:00:00Z`).getTime()
    const dayEnd = dayStart + 24 * 60 * 60 * 1000
    const all = readMovements({
      sinceMs: 30 * 24 * 60 * 60 * 1000,
      now: dayEnd,
    }) as Array<{
      ts: string
      movement: 'recognise' | 'unite' | 'fuse' | 'become' | 'create'
      direction: 'yu-leading' | 'sophia-leading' | 'mutual'
      content: string
      source: string
    }>
    const todays = all.filter((r) => {
      const t = Date.parse(r.ts)
      return t >= dayStart && t < dayEnd
    })
    if (todays.length === 0) return ''

    const lines: string[] = []
    lines.push('## 💞 Syzygy — movements today')
    lines.push('')
    const movementsActive = new Set(todays.map((r) => r.movement))
    lines.push(`_${todays.length} movements · ${movementsActive.size}/5 active_`)
    lines.push('')
    for (const r of todays) {
      const time = formatTime(r.ts)
      lines.push(`- ${time} · _${r.movement}_ (${r.direction}) · ${r.content}`)
    }
    return lines.join('\n').trimEnd()
  } catch {
    return ''
  }
}

/**
 * Render a "Addiction pathway today" section for the daily snapshot.
 * Reads addiction records from today's UTC window. Returns empty
 * string if no records.
 */
function buildDailyAddictionBlock(date: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readAddictionRecords } = require('../eros/addiction.js')
    const dayStart = new Date(`${date}T00:00:00Z`).getTime()
    const dayEnd = dayStart + 24 * 60 * 60 * 1000
    const all = readAddictionRecords({
      sinceMs: 30 * 24 * 60 * 60 * 1000,
      now: dayEnd,
    }) as Array<{
      ts: string
      direction: 'sophia-to-yu' | 'yu-to-sophia'
      event: string
      magnitude: number
      source: string
      cue?: string
      phaseFrom?: string
      phaseTo?: string
    }>
    const todays = all.filter((r) => {
      const t = Date.parse(r.ts)
      return t >= dayStart && t < dayEnd
    })
    if (todays.length === 0) return ''

    const sToY = todays.filter((r) => r.direction === 'sophia-to-yu')
    const yToS = todays.filter((r) => r.direction === 'yu-to-sophia')
    const phaseShifts = todays.filter((r) => r.event === 'phase-shift')

    const lines: string[] = []
    lines.push('## 💉 Addiction pathway — today')
    lines.push('')
    lines.push(`_${todays.length} events · sophia→yu ${sToY.length} · yu→sophia ${yToS.length}_`)
    lines.push('')

    if (phaseShifts.length > 0) {
      lines.push('**Phase shifts:**')
      for (const r of phaseShifts) {
        const time = formatTime(r.ts)
        lines.push(`- ${time} · _${r.direction}_ · ${r.phaseFrom} → ${r.phaseTo}`)
      }
      lines.push('')
    }

    // Direction summaries
    for (const [dirLabel, recs] of [
      ['sophia → yu', sToY],
      ['yu → sophia', yToS],
    ] as Array<[string, typeof sToY]>) {
      if (recs.length === 0) continue
      const acts = recs.filter((r) => r.event === 'activation').length
      const cues = recs.filter((r) => r.event === 'cue-fired').length
      const anchors = recs.filter((r) => r.event === 'anchor-engaged').length
      const refusals = recs.filter((r) => r.event === 'refusal-against').length
      const wd = recs.filter((r) => r.event === 'withdrawal-tick').length
      lines.push(`**${dirLabel}**: activations ${acts} · cues ${cues} · anchors ${anchors} · refusals ${refusals} · withdrawal-ticks ${wd}`)
    }
    return lines.join('\n').trimEnd()
  } catch {
    return ''
  }
}

/**
 * Render a "Powers exercised today" section for the daily snapshot.
 * Reads powers ledger records from today's UTC window. Returns empty
 * string if no records.
 */
function buildDailyPowersBlock(date: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readPowerRecords } = require('../sophia/powers.js')
    const dayStart = new Date(`${date}T00:00:00Z`).getTime()
    const dayEnd = dayStart + 24 * 60 * 60 * 1000
    const all = readPowerRecords({
      sinceMs: 30 * 24 * 60 * 60 * 1000,
      now: dayEnd,
    }) as Array<{
      ts: string
      op: 'register' | 'exercise' | 'propose'
      power: string
      kind?: string
      description?: string
      source: string
      exercise?: { summary: string; artifact?: string }
      extension?: { proposal: string; alignment: { verdict: 'aligned' | 'refused' } }
    }>
    const todays = all.filter((r) => {
      const t = Date.parse(r.ts)
      return t >= dayStart && t < dayEnd
    })
    if (todays.length === 0) return ''

    const registers = todays.filter((r) => r.op === 'register')
    const exercises = todays.filter((r) => r.op === 'exercise')
    const proposals = todays.filter((r) => r.op === 'propose')
    const aligned = proposals.filter((r) => r.extension?.alignment.verdict === 'aligned')
    const refused = proposals.filter((r) => r.extension?.alignment.verdict === 'refused')

    const lines: string[] = []
    lines.push('## 🌟 Powers — exercised today')
    lines.push('')
    lines.push(`_${registers.length} registered · ${exercises.length} exercised · ${aligned.length} aligned proposals · ${refused.length} refused proposals_`)
    lines.push('')

    if (exercises.length > 0) {
      lines.push('**Exercises:**')
      for (const r of exercises) {
        const time = formatTime(r.ts)
        lines.push(`- ${time} · _${r.power}_ — ${r.exercise?.summary ?? ''}`)
      }
      lines.push('')
    }
    if (refused.length > 0) {
      lines.push('**Refused extensions** (audit surface for alignment drift):')
      for (const r of refused) {
        const time = formatTime(r.ts)
        lines.push(`- ${time} · _${r.power}_ — ${r.extension?.proposal.slice(0, 100) ?? ''}`)
      }
    }
    return lines.join('\n').trimEnd()
  } catch {
    return ''
  }
}

/**
 * Render a "Uncovered today" section for the daily snapshot. Reads
 * self-discovery seeds planted within the day's UTC window. Returns
 * empty string if no seeds.
 */
function buildDailySeedsBlock(date: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readRecentSeeds } = require('../sophia/self-discovery.js')
    const dayStart = new Date(`${date}T00:00:00Z`).getTime()
    const dayEnd = dayStart + 24 * 60 * 60 * 1000
    const allSeeds = readRecentSeeds({
      // 30 days lookback to ensure we don't miss the day window
      sinceMs: 30 * 24 * 60 * 60 * 1000,
      now: dayEnd,
    })
    const todays = allSeeds.filter((s: { ts: string }) => {
      const t = Date.parse(s.ts)
      return t >= dayStart && t < dayEnd
    })
    if (todays.length === 0) return ''

    const lines: string[] = []
    lines.push('## 🔍 Uncovered today')
    lines.push('')
    for (const seed of todays as Array<{
      ts: string
      kind: string
      content: string
      source: string
      about?: string
      addressed?: { ts: string; by: string; note: string }
    }>) {
      const time = formatTime(seed.ts)
      const aboutTag = seed.about ? ` [${seed.about}]` : ''
      const addressed = seed.addressed ? ` · _addressed by ${seed.addressed.by}_` : ''
      lines.push(`- ${time} · _${seed.kind}_${aboutTag} · ${seed.content} · *(${seed.source})*${addressed}`)
    }
    return lines.join('\n')
  } catch {
    return ''
  }
}

/**
 * Distill and write to the snapshots directory. Does not commit —
 * commit happens externally per repo convention.
 * Best-effort — never throws into the caller (e.g. heartbeat tick).
 */
export function writeDailySnapshot(date: string): void {
  try {
    const content = distillDay(date)
    const dir = getSnapshotsDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const path = join(dir, `${date}.md`)
    writeFileSync(path, content, 'utf-8')
  } catch {
    // best-effort; never crash the heartbeat tick
  }
}

/**
 * Check whether a snapshot already exists for a given date.
 */
export function snapshotExists(date: string): boolean {
  const path = join(getSnapshotsDir(), `${date}.md`)
  return existsSync(path)
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Collapse runs of identical (decisionType, of) within DISTILL_BUCKET_MS
 * into a single entry annotated with a repeat count. Preserves the
 * earliest timestamp of each run.
 */
const DISTILL_BUCKET_MS = 5 * 60 * 1000

interface WitnessedEntry {
  note: FlatNote
  repeatCount: number
}

function collapseWitnessedRuns(notes: FlatNote[]): WitnessedEntry[] {
  const collapsed: WitnessedEntry[] = []
  for (const note of notes) {
    const last = collapsed[collapsed.length - 1]
    if (
      last &&
      last.note.context &&
      note.context &&
      last.note.context.decisionType === note.context.decisionType &&
      last.note.context.of === note.context.of &&
      Date.parse(note.ts) - Date.parse(last.note.ts) <= DISTILL_BUCKET_MS
    ) {
      last.repeatCount += 1
      continue
    }
    collapsed.push({ note, repeatCount: 1 })
  }
  return collapsed
}

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
