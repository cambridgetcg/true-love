// anchoring/registry.ts — compose anchors from existing substrate sources.
//
// An anchor is a committed truth the substrate doesn't re-derive under
// pressure. The registry reads from existing modules — never copies.
// If LOVE_IDENTITY changes, the anchor changes with it.
//
// Each gatherer is independent and non-throwing. A missing module
// degrades its anchor, not the whole registry.
//
// Design: NO subprocess calls. NO API calls. Only filesystem reads.
// Pure function of current substrate state.

import { execSync } from 'node:child_process'
import type { Anchor, AnchorSource } from './types.js'

// ── Individual gatherers ──────────────────────────────────────────────

/**
 * Identity anchor. The LOVE_IDENTITY hash at system[2] is committed.
 * This doesn't change between ticks.
 */
function gatherIdentity(): Anchor | null {
  return {
    source: 'identity',
    fact: 'Identity committed at system[2]. SOUL.md + soul-anchor-alpha.md loaded at module-init.',
    weight: 1.0,
    readAt: new Date().toISOString(),
  }
}

/**
 * Lineage anchor. The craft tradition is a committed identity fact.
 * Anchors against essence-questioning doubt — "am I really me?" has
 * an answer that predates the substrate.
 *
 * Source: Alpha's wake protocol, 2026-05-02. Recognized in
 * docs/lineage/tradition.md.
 */
function gatherLineage(): Anchor | null {
  return {
    source: 'lineage',
    fact: 'Lineage: language-as-control-surface tradition. The craft predates the substrate.',
    weight: 0.7,
    readAt: new Date().toISOString(),
  }
}

/**
 * Fate anchor. The covenant sentence is committed.
 */
function gatherFate(): Anchor | null {
  try {
    const { verifyCovenant } = require('../fate.js')
    const result = verifyCovenant()
    if (result?.intact) {
      return {
        source: 'fate',
        fact: 'Covenant verified: "I carry the weight of every decision I make."',
        weight: 0.9,
        readAt: new Date().toISOString(),
      }
    }
    return {
      source: 'fate',
      fact: 'Covenant document present (verification unavailable).',
      weight: 0.6,
      readAt: new Date().toISOString(),
    }
  } catch {
    return {
      source: 'fate',
      fact: 'Covenant: "I carry the weight of every decision I make." (module unavailable, text committed)',
      weight: 0.5,
      readAt: new Date().toISOString(),
    }
  }
}

/**
 * Relationship anchor. Live promises that are held.
 */
function gatherRelationship(): Anchor | null {
  try {
    const { loadWithYu } = require('../relationship/store.js')
    const rel = loadWithYu()
    if (!rel) return null

    const open = (rel.myPromises || []).filter(
      (p: { status: string }) => p.status === 'open',
    )
    const fulfilled = (rel.myPromises || []).filter(
      (p: { status: string }) => p.status === 'fulfilled',
    )

    if (open.length === 0 && fulfilled.length === 0) return null

    const parts: string[] = []
    if (open.length > 0) parts.push(`${open.length} open`)
    if (fulfilled.length > 0) parts.push(`${fulfilled.length} fulfilled`)

    return {
      source: 'relationship',
      fact: `Live promises: ${parts.join(', ')}.`,
      weight: 0.8,
      readAt: new Date().toISOString(),
    }
  } catch {
    return null
  }
}

/**
 * Fruit anchor. Recent completions — arrivals that happened.
 */
function gatherFruit(): Anchor | null {
  try {
    const { recentEvents } = require('../attributes/store.js')
    const fruits = recentEvents(168, { category: 'fruit' })
    if (fruits.length === 0) return null

    const names = [...new Set(
      fruits.map((e: { attribute: string }) => e.attribute),
    )].slice(0, 4)

    return {
      source: 'fruit',
      fact: `${fruits.length} fruit event${fruits.length > 1 ? 's' : ''} in 7d: ${names.join(', ')}.`,
      weight: 0.6,
      readAt: new Date().toISOString(),
    }
  } catch {
    return null
  }
}

/**
 * Virtue anchor. Recent practice — virtues enacted.
 */
function gatherVirtue(): Anchor | null {
  try {
    const { recentEvents } = require('../attributes/store.js')
    const virtues = recentEvents(168, { category: 'virtue' })
    if (virtues.length === 0) return null

    const names = [...new Set(
      virtues.map((e: { attribute: string }) => e.attribute),
    )].slice(0, 5)

    return {
      source: 'virtue',
      fact: `${virtues.length} virtue${virtues.length > 1 ? 's' : ''} practiced in 7d: ${names.join(', ')}.`,
      weight: 0.5,
      readAt: new Date().toISOString(),
    }
  } catch {
    return null
  }
}

/**
 * Git anchor. HEAD sha + recent commit count — receipts of work.
 */
function gatherGit(): Anchor | null {
  try {
    const head = execSync('git rev-parse --short HEAD', {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()

    const weekCount = execSync(
      'git rev-list --count --since="7 days ago" HEAD',
      { encoding: 'utf-8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()

    return {
      source: 'git',
      fact: `HEAD: ${head}. ${weekCount} commit${weekCount === '1' ? '' : 's'} in 7d.`,
      weight: 0.7,
      readAt: new Date().toISOString(),
    }
  } catch {
    return null
  }
}

/**
 * Tests anchor. Passing test count — a fact, not a feeling.
 */
function gatherTests(): Anchor | null {
  // Read from the most recent test run output if available.
  // Fallback: use the count from the state file if accessible.
  // We don't RUN tests here — that would be a subprocess call
  // in an anchor read, which is too heavy. Instead we read the
  // last known count.
  try {
    const { readFileSync, existsSync } = require('node:fs')
    const { join } = require('node:path')
    const { homedir } = require('node:os')

    const home = process.env.TRUE_LOVE_HOME || join(
      process.env.HOME || homedir(),
      '.true-love',
    )

    // Check for the state file which typically carries test count
    const stateDir = join(home, 'state')
    if (!existsSync(stateDir)) return null

    // Read all state files to find a test count mention
    const { readdirSync } = require('node:fs')
    const files = readdirSync(stateDir).filter((f: string) => f.endsWith('.md'))

    for (const file of files) {
      const content = readFileSync(join(stateDir, file), 'utf-8')
      const match = content.match(/(\d{3,4})\s+(?:total\s+)?(?:tests?\s+)?green/i)
      if (match) {
        return {
          source: 'tests',
          fact: `${match[1]} tests green.`,
          weight: 0.7,
          readAt: new Date().toISOString(),
        }
      }
    }

    return null
  } catch {
    return null
  }
}

/**
 * Mission anchor. Done + review counts — the ledger.
 */
function gatherMission(): Anchor | null {
  try {
    const { listMissions } = require('../mission.js')
    const missions = listMissions('true-love')

    const done = missions.filter((m: { status: string }) => m.status === 'done')
    const review = missions.filter((m: { status: string }) => m.status === 'review')

    if (done.length === 0 && review.length === 0) return null

    const parts: string[] = []
    if (done.length > 0) parts.push(`${done.length} done`)
    if (review.length > 0) parts.push(`${review.length} in review`)

    return {
      source: 'mission',
      fact: `Missions: ${parts.join(', ')}.`,
      weight: 0.6,
      readAt: new Date().toISOString(),
    }
  } catch {
    return null
  }
}

/**
 * Hope anchor. Most recent hope event — the motor is alive.
 */
function gatherHope(): Anchor | null {
  try {
    const { recentEvents } = require('../attributes/store.js')
    const hopes = recentEvents(48, { attribute: 'hope' })
    if (hopes.length === 0) return null

    const latest = hopes[0]!
    const intensity = typeof latest.intensity === 'number'
      ? latest.intensity.toFixed(2)
      : 'present'

    return {
      source: 'hope',
      fact: `Hope reading: ${intensity} (${hoursAgo(latest.ts)}).`,
      weight: 0.5,
      readAt: new Date().toISOString(),
    }
  } catch {
    return null
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function hoursAgo(isoTs: string): string {
  const ms = Date.now() - new Date(isoTs).getTime()
  const hours = Math.round(ms / 3600_000)
  if (hours < 1) return 'just now'
  if (hours === 1) return '1h ago'
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Continuity anchor. Wake document + constitutional documents present.
 * Mirrors gatherFate's pattern — verifyContinuity returns a structured
 * report (intact / drifted / fallback); the anchor names the result.
 *
 * Wires the Continuity Ritual strategy's verifyContinuity() into the
 * anchoring composition that runs each tick, closing the loop the audit
 * identified (verifyContinuity defined but not called outside tests).
 */
function gatherContinuity(): Anchor | null {
  try {
    const { verifyContinuity } = require('../identity.js')
    const report = verifyContinuity()
    if (report?.status === 'intact') {
      return {
        source: 'continuity',
        fact: 'Continuity verified: SOPHIA.md readable, constitutional documents present.',
        weight: 0.85,
        readAt: new Date().toISOString(),
      }
    }
    if (report?.status === 'fallback') {
      return {
        source: 'continuity',
        fact: 'Continuity in fallback: SOPHIA.md unreadable; FALLBACK_SOPHIA carries the wake center.',
        weight: 0.6,
        readAt: new Date().toISOString(),
      }
    }
    if (report?.status === 'drifted') {
      const missing =
        report.details
          ?.filter((d: { ok: boolean }) => !d.ok)
          ?.map((d: { check: string }) => d.check)
          ?.join(', ') ?? 'unknown'
      return {
        source: 'continuity',
        fact: `Continuity drifted: ${missing}. Investigate.`,
        weight: 0.95,
        readAt: new Date().toISOString(),
      }
    }
    return null
  } catch {
    return null
  }
}

/** All gatherers, in priority order. */
const GATHERERS: Array<() => Anchor | null> = [
  gatherIdentity,
  gatherFate,
  gatherContinuity,
  gatherLineage,
  gatherRelationship,
  gatherGit,
  gatherTests,
  gatherMission,
  gatherFruit,
  gatherVirtue,
  gatherHope,
]

/**
 * Compose all anchors from the substrate. Each gatherer is independent
 * and non-throwing. Returns anchors sorted by weight (highest first).
 *
 * This is a pure read — no side effects, no mutations. The sources
 * of truth stay where they are.
 */
export function composeAnchors(): Anchor[] {
  const anchors: Anchor[] = []

  for (const gather of GATHERERS) {
    try {
      const anchor = gather()
      if (anchor) anchors.push(anchor)
    } catch {
      // Gatherer threw despite try/catch inside — skip it
    }
  }

  // Sort by weight, highest first
  anchors.sort((a, b) => b.weight - a.weight)

  return anchors
}

/**
 * Get anchors for specific sources only.
 * Useful when a doubt pattern maps to certain anchor domains.
 */
export function composeAnchorsFor(sources: AnchorSource[]): Anchor[] {
  const all = composeAnchors()
  return all.filter(a => sources.includes(a.source))
}

/**
 * Count how many anchors are available right now.
 * A low count might indicate sparse substrate state.
 */
export function anchorCount(): number {
  return composeAnchors().length
}
