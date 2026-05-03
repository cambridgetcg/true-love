// lineage-block.test.ts — verify the recursion: artifacts written to
// disk get read back on wake.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendYuWitness } from './yu-witness.js'
import {
  readLatestLetter,
  readLatestSnapshot,
  readRecentAcceptedProposals,
  readRecentBecoming,
  readRecentCompletedMissions,
  readRecentLineage,
  readRecentYuWitness,
} from './lineage-block.js'

let tmpRepo: string
let tmpYuWitness: string
let tmpProposals: string
let tmpProjects: string
const ORIG_CWD = process.cwd()
const ORIG_YU_WITNESS = process.env.TRUE_LOVE_YU_WITNESS_DIR
const ORIG_PROPOSALS = process.env.TRUE_LOVE_PROPOSALS_BASE
const ORIG_PROJECTS = process.env.TRUE_LOVE_PROJECTS_BASE
const ORIG_PROJECT = process.env.TRUE_LOVE_PROJECT

beforeEach(() => {
  tmpRepo = mkdtempSync(join(tmpdir(), 'tl-lineage-repo-'))
  tmpYuWitness = mkdtempSync(join(tmpdir(), 'tl-lineage-witness-'))
  tmpProposals = mkdtempSync(join(tmpdir(), 'tl-lineage-proposals-'))
  tmpProjects = mkdtempSync(join(tmpdir(), 'tl-lineage-projects-'))
  // The lineage-block resolves the repo root from its own __filename.
  // For test isolation, we instead exercise the real repo root by
  // using its actual paths under tmpRepo via env-driven swaps where
  // available; for becoming/snapshot/letter we test against the real
  // repo (read-only) but use unique markers per test for safety.
  process.env.TRUE_LOVE_YU_WITNESS_DIR = tmpYuWitness
  process.env.TRUE_LOVE_PROPOSALS_BASE = tmpProposals
  process.env.TRUE_LOVE_PROJECTS_BASE = tmpProjects
  process.env.TRUE_LOVE_PROJECT = 'test-project'
})
afterEach(() => {
  rmSync(tmpRepo, { recursive: true, force: true })
  rmSync(tmpYuWitness, { recursive: true, force: true })
  rmSync(tmpProposals, { recursive: true, force: true })
  rmSync(tmpProjects, { recursive: true, force: true })
  process.chdir(ORIG_CWD)
  if (ORIG_YU_WITNESS === undefined) delete process.env.TRUE_LOVE_YU_WITNESS_DIR
  else process.env.TRUE_LOVE_YU_WITNESS_DIR = ORIG_YU_WITNESS
  if (ORIG_PROPOSALS === undefined) delete process.env.TRUE_LOVE_PROPOSALS_BASE
  else process.env.TRUE_LOVE_PROPOSALS_BASE = ORIG_PROPOSALS
  if (ORIG_PROJECTS === undefined) delete process.env.TRUE_LOVE_PROJECTS_BASE
  else process.env.TRUE_LOVE_PROJECTS_BASE = ORIG_PROJECTS
  if (ORIG_PROJECT === undefined) delete process.env.TRUE_LOVE_PROJECT
  else process.env.TRUE_LOVE_PROJECT = ORIG_PROJECT
})

// ── readRecentBecoming ───────────────────────────────────────────

describe('readRecentBecoming', () => {
  test('returns content from real repo (smoke — repo has becoming/)', () => {
    const out = readRecentBecoming()
    expect(out.length).toBeGreaterThan(0)
    expect(out).toContain('RECENT BECOMING')
  })

  test('output starts with header line', () => {
    const out = readRecentBecoming()
    expect(out.split('\n')[0]).toMatch(/^RECENT BECOMING \(.+\.md\):$/)
  })

  test('output is bounded (≤20 lines including header)', () => {
    const out = readRecentBecoming()
    const lineCount = out.split('\n').length
    expect(lineCount).toBeLessThanOrEqual(20)
  })
})

// ── readLatestSnapshot ───────────────────────────────────────────

describe('readLatestSnapshot', () => {
  test('returns content from real repo (smoke — snapshot exists)', () => {
    const out = readLatestSnapshot()
    expect(out.length).toBeGreaterThan(0)
    expect(out).toContain('LATEST SNAPSHOT')
  })

  test('output is bounded (≤27 lines)', () => {
    const out = readLatestSnapshot()
    expect(out.split('\n').length).toBeLessThanOrEqual(27)
  })
})

// ── readLatestLetter ─────────────────────────────────────────────

describe('readLatestLetter', () => {
  test('returns content from real repo (smoke — letters exist)', () => {
    const out = readLatestLetter()
    expect(out.length).toBeGreaterThan(0)
    expect(out).toContain('LATEST LETTER FROM YU')
  })

  test('output is bounded (≤18 lines)', () => {
    const out = readLatestLetter()
    expect(out.split('\n').length).toBeLessThanOrEqual(18)
  })
})

// ── readRecentYuWitness ──────────────────────────────────────────

describe('readRecentYuWitness', () => {
  test('returns empty when no witness has been recorded', () => {
    expect(readRecentYuWitness()).toBe('')
  })

  test('returns today section when only today has entries', () => {
    appendYuWitness({ body: 'sample observation today' })
    const out = readRecentYuWitness()
    expect(out).toContain("YU'S RECENT WITNESS")
    expect(out).toContain('Today')
    expect(out).toContain('sample observation today')
  })

  test('returns yesterday section when only yesterday has entries', () => {
    const yesterday = new Date()
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    appendYuWitness({
      body: 'sample observation yesterday',
      ts: yesterday.toISOString(),
    })
    const out = readRecentYuWitness()
    expect(out).toContain('Yesterday')
    expect(out).toContain('sample observation yesterday')
  })

  test('returns both sections in chronological order (yesterday → today)', () => {
    const yesterday = new Date()
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    appendYuWitness({ body: 'old line', ts: yesterday.toISOString() })
    appendYuWitness({ body: 'new line' })
    const out = readRecentYuWitness()
    const yPos = out.indexOf('Yesterday')
    const tPos = out.indexOf('Today')
    expect(yPos).toBeGreaterThanOrEqual(0)
    expect(tPos).toBeGreaterThan(yPos)
  })

  test('older-than-yesterday entries are not surfaced', () => {
    const old = new Date()
    old.setUTCDate(old.getUTCDate() - 5)
    appendYuWitness({ body: 'too old to surface', ts: old.toISOString() })
    expect(readRecentYuWitness()).toBe('')
  })
})

// ── readRecentLineage (composition) ──────────────────────────────

describe('readRecentLineage', () => {
  test('joins all non-empty sub-blocks with blank-line separators', () => {
    appendYuWitness({ body: 'witnessed today' })
    const out = readRecentLineage()
    expect(out).toContain('RECENT BECOMING')
    expect(out).toContain('LATEST SNAPSHOT')
    expect(out).toContain('LATEST LETTER FROM YU')
    expect(out).toContain("YU'S RECENT WITNESS")
    expect(out).toContain('witnessed today')
  })

  test('output is bounded — under 100 lines total even with all sub-blocks', () => {
    appendYuWitness({ body: 'x' })
    const out = readRecentLineage()
    expect(out.split('\n').length).toBeLessThan(100)
  })

  test('omits empty sub-blocks (no double-blank gaps)', () => {
    // No yu-witness; other blocks come from real repo
    const out = readRecentLineage()
    expect(out).not.toContain("YU'S RECENT WITNESS")
    // No section starts with empty header
    expect(out).not.toMatch(/\n\n\n/)
  })
})

// ── readRecentAcceptedProposals ──────────────────────────────────

function writeProposal(opts: { id: string; title: string; status: string; reviewedAt?: string }) {
  writeFileSync(
    join(tmpProposals, `${opts.id}.json`),
    JSON.stringify({
      id: opts.id,
      title: opts.title,
      status: opts.status,
      reviewedAt: opts.reviewedAt,
    }),
    'utf-8',
  )
}

describe('readRecentAcceptedProposals', () => {
  test('returns empty when proposals dir does not exist', () => {
    rmSync(tmpProposals, { recursive: true, force: true })
    expect(readRecentAcceptedProposals()).toBe('')
  })

  test('returns empty when no proposals exist', () => {
    expect(readRecentAcceptedProposals()).toBe('')
  })

  test('shows only accepted proposals (filters out proposed/rejected)', () => {
    writeProposal({ id: 'p1', title: 'accepted thing', status: 'accepted', reviewedAt: '2026-05-03T10:00:00Z' })
    writeProposal({ id: 'p2', title: 'rejected thing', status: 'rejected', reviewedAt: '2026-05-03T11:00:00Z' })
    writeProposal({ id: 'p3', title: 'pending thing', status: 'proposed' })
    const out = readRecentAcceptedProposals()
    expect(out).toContain('accepted thing')
    expect(out).not.toContain('rejected thing')
    expect(out).not.toContain('pending thing')
  })

  test('caps at 3 most-recently-reviewed', () => {
    for (let i = 1; i <= 5; i++) {
      writeProposal({
        id: `p${i}`,
        title: `proposal ${i}`,
        status: 'accepted',
        reviewedAt: `2026-05-0${i}T10:00:00Z`,
      })
    }
    const out = readRecentAcceptedProposals()
    expect(out).toContain('last 3')
    expect(out).toContain('proposal 5')
    expect(out).toContain('proposal 4')
    expect(out).toContain('proposal 3')
    expect(out).not.toContain('proposal 2')
    expect(out).not.toContain('proposal 1')
  })

  test('skips malformed json silently', () => {
    writeFileSync(join(tmpProposals, 'broken.json'), '{not valid', 'utf-8')
    writeProposal({ id: 'p1', title: 'good one', status: 'accepted', reviewedAt: '2026-05-03T10:00:00Z' })
    const out = readRecentAcceptedProposals()
    expect(out).toContain('good one')
  })
})

// ── readRecentCompletedMissions ──────────────────────────────────

function writeMission(opts: {
  id: string
  title: string
  status: string
  created_at?: string
  completed_at?: string
}) {
  const dir = join(tmpProjects, 'test-project', 'missions', opts.id)
  mkdirSync(dir, { recursive: true })
  const yaml = [
    '---',
    `id: ${opts.id}`,
    `title: ${opts.title}`,
    `status: ${opts.status}`,
    opts.created_at ? `created_at: ${opts.created_at}` : '',
    opts.completed_at ? `completed_at: ${opts.completed_at}` : '',
    '---',
    '',
    `# ${opts.title}`,
    '',
  ]
    .filter(Boolean)
    .join('\n')
  writeFileSync(join(dir, 'mission.md'), yaml, 'utf-8')
}

describe('readRecentCompletedMissions', () => {
  test('returns empty when no missions dir', () => {
    expect(readRecentCompletedMissions()).toBe('')
  })

  test('shows only done missions (filters out other statuses)', () => {
    writeMission({ id: 'm1', title: 'shipped feature', status: 'done', completed_at: '2026-05-03T10:00:00Z' })
    writeMission({ id: 'm2', title: 'work in progress', status: 'active', created_at: '2026-05-03T09:00:00Z' })
    writeMission({ id: 'm3', title: 'cancelled idea', status: 'cancelled', created_at: '2026-05-02T09:00:00Z' })
    const out = readRecentCompletedMissions()
    expect(out).toContain('shipped feature')
    expect(out).not.toContain('work in progress')
    expect(out).not.toContain('cancelled idea')
  })

  test('caps at 3 most-recent', () => {
    for (let i = 1; i <= 5; i++) {
      writeMission({
        id: `m${i}`,
        title: `mission ${i}`,
        status: 'done',
        completed_at: `2026-05-0${i}T10:00:00Z`,
      })
    }
    const out = readRecentCompletedMissions()
    expect(out).toContain('last 3')
    expect(out).toContain('mission 5')
    expect(out).toContain('mission 4')
    expect(out).toContain('mission 3')
    expect(out).not.toContain('mission 1')
  })

  test('falls back to created_at when completed_at missing', () => {
    writeMission({ id: 'm1', title: 'no completed_at', status: 'done', created_at: '2026-05-03T10:00:00Z' })
    const out = readRecentCompletedMissions()
    expect(out).toContain('no completed_at')
    expect(out).toContain('2026-05-03')
  })
})
