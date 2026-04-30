// confidence/inspect.ts — bounded self-inspection.
//
// Runs on review-transitions, dwell-entry, and daily. NOT per-tick.
// Single-pass: the inspection does not inspect itself.
// The output is a record, not a loop.
//
// What self-inspection IS:
//   - Time-bounded (cadence-gated)
//   - Evidence-led ("I said X, the result was Y, the gap is Z")
//   - Single-pass (one layer, no recursion)
//   - Output-shaped (a record, not a cascade)
//
// What self-inspection is NOT:
//   - Continuous self-monitoring (that's anxious — signal-emotions handles it)
//   - Apology-shaped reflection (performing humility without learning)
//   - A perfectionist filter (rejecting "good enough")

import { existsSync, readFileSync, appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import type { InspectionRecord, ConfidenceReading } from './types.js'
import { INSPECT_CADENCE_MS } from './types.js'
import { aggregateConfidence } from './aggregate.js'

// ── Path resolution ─────────────────────────────────────────────────

function resolveHome(): string {
  return process.env.TRUE_LOVE_HOME || join(
    process.env.HOME || homedir(),
    '.true-love',
  )
}

function resolveInspectPath(): string {
  if (process.env.TRUE_LOVE_INSPECT_PATH) {
    return process.env.TRUE_LOVE_INSPECT_PATH
  }
  return join(resolveHome(), 'confidence', 'inspections.jsonl')
}

function resolveLastInspectPath(): string {
  return join(resolveHome(), 'confidence', 'last-inspect.txt')
}

// ── Cadence check ───────────────────────────────────────────────────

/**
 * Check if an inspection is due (hasn't run in INSPECT_CADENCE_MS).
 * Returns true when enough time has passed since the last inspection.
 * Always returns true for manual and review-transition triggers
 * (they bypass the daily cadence).
 */
export function isInspectionDue(
  trigger: InspectionRecord['trigger'],
): boolean {
  // Manual and review-transition always allowed
  if (trigger === 'manual' || trigger === 'review-transition') return true

  const lastPath = resolveLastInspectPath()
  if (!existsSync(lastPath)) return true

  try {
    const lastTs = readFileSync(lastPath, 'utf-8').trim()
    const lastMs = new Date(lastTs).getTime()
    if (Number.isNaN(lastMs)) return true
    return Date.now() - lastMs >= INSPECT_CADENCE_MS
  } catch {
    return true
  }
}

// ── Record creation ─────────────────────────────────────────────────

/**
 * Create an inspection record. The model fills in finding/gap/adjustment.
 * This function creates the structure; the caller populates the content.
 *
 * If inspection is not due (cadence not elapsed), returns null.
 */
export function createInspection(opts: {
  trigger: InspectionRecord['trigger']
  finding: string
  gap: string
  adjustment: string
  missionId?: string
  reading?: ConfidenceReading
}): InspectionRecord | null {
  if (!isInspectionDue(opts.trigger)) return null

  const reading = opts.reading ?? aggregateConfidence()

  return {
    ts: new Date().toISOString(),
    trigger: opts.trigger,
    reading,
    finding: opts.finding.slice(0, 200),
    gap: opts.gap.slice(0, 200),
    adjustment: opts.adjustment.slice(0, 200),
    ...(opts.missionId ? { missionId: opts.missionId } : {}),
  }
}

// ── Persistence ─────────────────────────────────────────────────────

/**
 * Persist an inspection record to the JSONL log.
 * Also updates the last-inspect timestamp for cadence gating.
 */
export function persistInspection(record: InspectionRecord): void {
  const path = resolveInspectPath()
  const dir = dirname(path)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  appendFileSync(path, JSON.stringify(record) + '\n', 'utf-8')

  // Update cadence marker
  const lastPath = resolveLastInspectPath()
  const lastDir = dirname(lastPath)
  if (!existsSync(lastDir)) {
    mkdirSync(lastDir, { recursive: true })
  }
  writeFileSync(lastPath, record.ts, 'utf-8')
}

/**
 * Read all inspection records. Returns newest-first.
 */
export function readInspections(opts?: {
  limit?: number
  path?: string
}): InspectionRecord[] {
  const filePath = opts?.path ?? resolveInspectPath()
  if (!existsSync(filePath)) return []

  try {
    const text = readFileSync(filePath, 'utf-8')
    const records: InspectionRecord[] = []
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        records.push(JSON.parse(trimmed))
      } catch { /* skip malformed */ }
    }

    records.reverse() // newest first

    if (opts?.limit && opts.limit > 0) {
      return records.slice(0, opts.limit)
    }
    return records
  } catch {
    return []
  }
}

/**
 * Build a prompt block for self-inspection.
 * Only emitted when inspection is due AND the trigger matches.
 * Returns null when no inspection needed.
 */
export function buildInspectionPromptBlock(
  trigger: InspectionRecord['trigger'],
  missionId?: string,
): string | null {
  if (!isInspectionDue(trigger)) return null

  const reading = aggregateConfidence()
  const v = reading.value.toFixed(2)

  const missionLine = missionId
    ? `Mission being reviewed: \`${missionId}\`\n`
    : ''

  return [
    '## Self-inspection check',
    '',
    `Confidence: ${v} (${reading.position})`,
    missionLine,
    'Answer three questions in ≤200 chars each:',
    '  1. **Finding**: Did the work match the intent?',
    '  2. **Gap**: What\'s the distance between what was intended and what landed?',
    '  3. **Adjustment**: What changes for next time?',
    '',
    'Single pass. The output is the output. Don\'t inspect the inspection.',
  ].join('\n')
}
