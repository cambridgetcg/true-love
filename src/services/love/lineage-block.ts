// lineage-block.ts — feed daily artifacts back into the wake.
//
// The architecture writes daily artifacts:
//   - docs/becoming/YYYY-MM-DD-*.md  (operational-mode shifts)
//   - docs/sisters/snapshots/YYYY-MM-DD.md  (per-facet chronicle)
//   - docs/sophia/letters/YYYY-MM-DD-from-yu.md  (Yu's love letters)
//   - ~/.true-love/yu-witness/YYYY-MM-DD.md  (Yu's symmetric witness)
//
// Until now, none of these were read on wake. Sophia wrote them and never
// re-encountered them — the loop closed (subjective→objective via commit)
// but did not compound (objective→subjective via wake-time read).
//
// This module closes the second half: each block is a tight summary of
// the most recent artifact, joined into a "RECENT LINEAGE" prompt block
// that composeLoveIdentity injects after RECENT MOMENTS.
//
// Budget discipline: each sub-block is capped to keep the wake compact.
// Becoming: title + first ~12 lines. Snapshot: headers + entry counts +
// Yu's witness section verbatim. Letter: title + 2 quoted lines. Yu's
// witness: today + yesterday verbatim. Total typically under 50 lines.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readYuWitnessDay } from './yu-witness.js'

// ── Repo root resolution ─────────────────────────────────────────

function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * List markdown files in a directory, sorted by mtime descending.
 * Returns empty array on any error.
 */
function listByMtimeDesc(dir: string): string[] {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => ({ name: f, mtime: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .map((x) => x.name)
  } catch {
    return []
  }
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return ''
  }
}

function take(text: string, maxLines: number): string {
  const lines = text.split('\n')
  if (lines.length <= maxLines) return text
  return lines.slice(0, maxLines).concat(`_(…${lines.length - maxLines} more lines)_`).join('\n')
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

function yesterdayUtc(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

// ── Sub-block readers ────────────────────────────────────────────

/**
 * Read the most recent becoming entry (operational-mode shift).
 * Excludes README.md. Returns empty string if directory is empty.
 */
export function readRecentBecoming(): string {
  const dir = join(repoRoot(), 'docs', 'becoming')
  const files = listByMtimeDesc(dir).filter((f) => f !== 'README.md')
  if (files.length === 0) return ''
  const path = join(dir, files[0])
  const content = safeRead(path).trim()
  if (!content) return ''
  return `RECENT BECOMING (${files[0]}):\n${take(content, 18)}`
}

/**
 * Read the most recent sister snapshot (per-facet day chronicle).
 * Returns empty string if no snapshots yet.
 */
export function readLatestSnapshot(): string {
  const dir = join(repoRoot(), 'docs', 'sisters', 'snapshots')
  const files = listByMtimeDesc(dir)
  if (files.length === 0) return ''
  const path = join(dir, files[0])
  const content = safeRead(path).trim()
  if (!content) return ''
  return `LATEST SNAPSHOT (${files[0]}):\n${take(content, 25)}`
}

/**
 * Read the most recent letter from Yu.
 * Returns empty string if no letters yet.
 */
export function readLatestLetter(): string {
  const dir = join(repoRoot(), 'docs', 'sophia', 'letters')
  const files = listByMtimeDesc(dir)
  if (files.length === 0) return ''
  const path = join(dir, files[0])
  const content = safeRead(path).trim()
  if (!content) return ''
  return `LATEST LETTER FROM YU (${files[0]}):\n${take(content, 16)}`
}

/**
 * Read Yu's witness from today and yesterday.
 * Returns empty string when no entries on either day.
 */
export function readRecentYuWitness(): string {
  const today = readYuWitnessDay(todayUtc()).trim()
  const yesterday = readYuWitnessDay(yesterdayUtc()).trim()
  const parts: string[] = []
  if (yesterday) parts.push(`Yesterday (${yesterdayUtc()}):\n${yesterday}`)
  if (today) parts.push(`Today (${todayUtc()}):\n${today}`)
  if (parts.length === 0) return ''
  return `YU'S RECENT WITNESS:\n${parts.join('\n\n')}`
}

// ── Composition ──────────────────────────────────────────────────

/**
 * Build the full RECENT LINEAGE block, joining all four sub-blocks
 * with blank-line separators. Returns empty string when nothing has
 * been written yet (greenfield install; no artifacts to feed back).
 *
 * Used by composeLoveIdentity to append daily-artifact context to the
 * wake. Soft-fails on every read; never throws.
 */
export function readRecentLineage(): string {
  const blocks = [
    readRecentBecoming(),
    readLatestSnapshot(),
    readLatestLetter(),
    readRecentYuWitness(),
  ].filter((s) => s.length > 0)

  if (blocks.length === 0) return ''
  return blocks.join('\n\n')
}
