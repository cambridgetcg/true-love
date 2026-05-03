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
import { homedir } from 'node:os'
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

// ── Decision-artifact readers (proposals + missions) ─────────────

interface ProposalShape {
  id: string
  title?: string
  status?: string
  reviewedAt?: string
  reviewNote?: string
  severity?: string
}

function readProposalsHome(): string {
  return (
    process.env.TRUE_LOVE_PROPOSALS_BASE ??
    join(homedir(), '.true-love', 'proposals')
  )
}

/**
 * Read the most recently accepted proposals (max 3, by reviewedAt
 * descending). Each proposal is one architectural decision Sophia
 * recognized as worth applying. Re-encountering them on wake names
 * the line of decisions she has been making.
 *
 * Returns empty string when no proposals dir exists or none accepted.
 */
export function readRecentAcceptedProposals(): string {
  const dir = readProposalsHome()
  if (!existsSync(dir)) return ''
  let entries: ProposalShape[] = []
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      try {
        const p = JSON.parse(safeRead(join(dir, f))) as ProposalShape
        if (p.status === 'accepted') entries.push(p)
      } catch {
        // skip malformed
      }
    }
  } catch {
    return ''
  }
  if (entries.length === 0) return ''

  entries.sort((a, b) => (b.reviewedAt ?? '').localeCompare(a.reviewedAt ?? ''))
  const top = entries.slice(0, 3)
  const lines = top.map((p) => {
    const date = (p.reviewedAt ?? '').slice(0, 10) || '????-??-??'
    return `  - ${date} · ${p.title ?? p.id}`
  })
  return `RECENT ACCEPTED PROPOSALS (last ${top.length}):\n${lines.join('\n')}`
}

interface MissionShape {
  id: string
  title?: string
  status?: string
  created_at?: string
  completed_at?: string
}

function readProjectsHome(): string {
  return (
    process.env.TRUE_LOVE_PROJECTS_BASE ??
    join(homedir(), '.true-love', 'projects')
  )
}

function defaultProjectId(): string {
  return process.env.TRUE_LOVE_PROJECT ?? 'true-love'
}

/**
 * Read the most recently completed missions for the default project
 * (max 3, by completed_at or created_at descending). Each mission is
 * a unit of work Gamma shipped. Re-encountering them on wake names
 * the line of work that has actually landed.
 *
 * Returns empty string when no missions dir exists or none done.
 */
export function readRecentCompletedMissions(): string {
  const projectId = defaultProjectId()
  const dir = join(readProjectsHome(), projectId, 'missions')
  if (!existsSync(dir)) return ''
  let entries: MissionShape[] = []
  try {
    for (const sub of readdirSync(dir, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue
      const missionFile = join(dir, sub.name, 'mission.md')
      if (!existsSync(missionFile)) continue
      const text = safeRead(missionFile)
      const m = parseMissionFrontmatter(text, sub.name)
      if (m && m.status === 'done') entries.push(m)
    }
  } catch {
    return ''
  }
  if (entries.length === 0) return ''

  entries.sort((a, b) => {
    const ka = a.completed_at ?? a.created_at ?? ''
    const kb = b.completed_at ?? b.created_at ?? ''
    return kb.localeCompare(ka)
  })
  const top = entries.slice(0, 3)
  const lines = top.map((m) => {
    const date = (m.completed_at ?? m.created_at ?? '').slice(0, 10) || '????-??-??'
    return `  - ${date} · ${m.title ?? m.id}`
  })
  return `RECENT COMPLETED MISSIONS (last ${top.length}):\n${lines.join('\n')}`
}

/**
 * Minimal frontmatter parser — extracts title, status, created_at,
 * completed_at from the YAML-ish block at the top of a mission.md.
 * Avoids importing the full mission.ts parser (which has many side
 * effects unrelated to this read path).
 */
function parseMissionFrontmatter(content: string, fallbackId: string): MissionShape | null {
  if (!content.startsWith('---\n')) return null
  const end = content.indexOf('\n---\n', 4)
  if (end === -1) return null
  const yaml = content.slice(4, end)
  const out: MissionShape = { id: fallbackId }
  for (const rawLine of yaml.split('\n')) {
    const line = rawLine.trim()
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    const val = line
      .slice(colon + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '')
    if (key === 'id') out.id = val
    else if (key === 'title') out.title = val
    else if (key === 'status') out.status = val
    else if (key === 'created_at') out.created_at = val
    else if (key === 'completed_at') out.completed_at = val
  }
  return out
}

// ── Composition ──────────────────────────────────────────────────

/**
 * Build the full RECENT LINEAGE block, joining all sub-blocks with
 * blank-line separators. Returns empty string when nothing has been
 * written yet (greenfield install; no artifacts to feed back).
 *
 * Compounding artifact sources:
 *   - docs/becoming/             — operational-mode shifts
 *   - docs/sisters/snapshots/    — daily per-facet chronicle
 *   - docs/sophia/letters/       — Yu's love letters
 *   - ~/.true-love/yu-witness/   — Yu's symmetric witness (today + yesterday)
 *   - ~/.true-love/proposals/    — accepted proposals (decisions made)
 *   - ~/.true-love/projects/<p>/missions/ — completed missions
 *
 * Soft-fails on every read; never throws.
 */
export function readRecentLineage(): string {
  const blocks = [
    readRecentBecoming(),
    readLatestSnapshot(),
    readLatestLetter(),
    readRecentYuWitness(),
    readRecentAcceptedProposals(),
    readRecentCompletedMissions(),
  ].filter((s) => s.length > 0)

  if (blocks.length === 0) return ''
  return blocks.join('\n\n')
}
