// eros/snapshot.ts — daily distillation from the eros event stream.
//
// Reads a day's eros stream events, distills into a felt-shape
// trajectory narrative at docs/eros/snapshots/YYYY-MM-DD.md.
//
// Distillation rules:
//   - Trajectory: felt-shape transitions through the day
//   - Peak state: highest overall arousal reached
//   - Attribution summary: what moved the state (cue counts)
//   - Threshold crossings: all witnessed moments
//   - Sparse: 10-20 lines total
//
// Pattern follows sisters/snapshot.ts.
//
// Part of the Eros arousal infrastructure.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readDayEvents, type ErosStreamEvent } from './stream.js'
import { EXCITATION_AXES, resolveFeltShape, type ErosVector } from './axes.js'

// ── Path ───────────────────────────────────────────────────────────

/**
 * Directory where committed eros snapshots live.
 * Override with TRUE_LOVE_EROS_SNAPSHOTS_DIR for testing.
 */
export function getErosSnapshotsDir(): string {
  return (
    process.env.TRUE_LOVE_EROS_SNAPSHOTS_DIR ??
    join(process.cwd(), 'docs', 'eros', 'snapshots')
  )
}

// ── Distillation (pure) ────────────────────────────────────────────

/**
 * Distill a day's eros events into a sparse markdown narrative.
 * Pure function.
 */
export function distillErosDay(date: string, events?: ErosStreamEvent[]): string {
  const dayEvents = events ?? readDayEvents(date)
  const lines: string[] = []

  lines.push(`# Eros — ${date}`)
  lines.push('')

  if (dayEvents.length === 0) {
    lines.push('_No state-shift events recorded. The state held still._')
    lines.push('')
    lines.push('---')
    lines.push(`_0 events._`)
    return lines.join('\n')
  }

  // Trajectory: felt-shapes through the day
  const trajectory = extractTrajectory(dayEvents)
  if (trajectory.length > 0) {
    lines.push('## Trajectory')
    lines.push('')
    for (const point of trajectory) {
      lines.push(`- ${point.time} · ${point.shape}${point.modifier ? ` (${point.modifier})` : ''}`)
    }
    lines.push('')
  }

  // Peak state
  const peak = findPeak(dayEvents)
  if (peak) {
    lines.push('## Peak')
    lines.push('')
    lines.push(`- ${peak.time} · overall ${peak.overall.toFixed(1)} — ${peak.shape}`)
    lines.push('')
  }

  // Attribution summary
  const attrSummary = summarizeAttributions(dayEvents)
  if (attrSummary.length > 0) {
    lines.push('## What moved')
    lines.push('')
    for (const entry of attrSummary) {
      lines.push(`- ${entry.source}: ${entry.count} event${entry.count > 1 ? 's' : ''}`)
    }
    lines.push('')
  }

  // Threshold crossings
  const crossings = dayEvents.filter(e => e.crossings.length > 0)
  if (crossings.length > 0) {
    lines.push('## Witnessed moments')
    lines.push('')
    for (const event of crossings.slice(0, 10)) {
      const time = formatTime(event.ts)
      for (const c of event.crossings) {
        const dir = c.direction === 'up' ? '↑' : '↓'
        lines.push(`- ${time} · ${c.axis} ${dir} through ${c.threshold} (${event.attribution})`)
      }
    }
    if (crossings.length > 10) {
      lines.push(`- _(${crossings.length - 10} more crossings condensed)_`)
    }
    lines.push('')
  }

  lines.push('---')
  lines.push(`_${dayEvents.length} events distilled._`)

  return lines.join('\n')
}

// ── Trajectory extraction ──────────────────────────────────────────

interface TrajectoryPoint {
  time: string
  shape: string
  modifier: string | null
}

function extractTrajectory(events: ErosStreamEvent[]): TrajectoryPoint[] {
  const points: TrajectoryPoint[] = []
  let lastShape = ''

  for (const event of events) {
    const felt = resolveFeltShape(event.after)
    const shapeStr = felt.primary
    if (shapeStr !== lastShape) {
      points.push({
        time: formatTime(event.ts),
        shape: shapeStr,
        modifier: felt.modifier,
      })
      lastShape = shapeStr
    }
  }

  // Budget: max 8 trajectory points (sparse)
  if (points.length > 8) {
    return selectSparseSample(points, 8)
  }
  return points
}

// ── Peak detection ─────────────────────────────────────────────────

interface PeakInfo {
  time: string
  overall: number
  shape: string
}

function findPeak(events: ErosStreamEvent[]): PeakInfo | null {
  let peak: PeakInfo | null = null
  let maxOverall = 0

  for (const event of events) {
    const overall = EXCITATION_AXES.reduce((s, a) => s + event.after[a], 0) / 6
    if (overall > maxOverall) {
      maxOverall = overall
      const felt = resolveFeltShape(event.after)
      peak = {
        time: formatTime(event.ts),
        overall,
        shape: felt.primary,
      }
    }
  }

  return peak
}

// ── Attribution summary ────────────────────────────────────────────

interface AttrEntry {
  source: string
  count: number
}

function summarizeAttributions(events: ErosStreamEvent[]): AttrEntry[] {
  const counts = new Map<string, number>()
  for (const event of events) {
    const source = event.attribution.split(':')[0] ?? 'unknown'
    counts.set(source, (counts.get(source) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)
}

// ── Write ──────────────────────────────────────────────────────────

/**
 * Distill and write to the snapshots directory.
 * Best-effort — never throws.
 */
export function writeErosDailySnapshot(date: string): void {
  try {
    const content = distillErosDay(date)
    const dir = getErosSnapshotsDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${date}.md`), content, 'utf-8')
  } catch {
    // best-effort; never crash
  }
}

/**
 * Check whether a snapshot already exists for a given date.
 */
export function erosSnapshotExists(date: string): boolean {
  return existsSync(join(getErosSnapshotsDir(), `${date}.md`))
}

// ── Helpers ────────────────────────────────────────────────────────

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
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return '??:??'
  }
}
