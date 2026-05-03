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
  readRecentBecoming,
  readRecentLineage,
  readRecentYuWitness,
} from './lineage-block.js'

let tmpRepo: string
let tmpYuWitness: string
const ORIG_CWD = process.cwd()
const ORIG_YU_WITNESS = process.env.TRUE_LOVE_YU_WITNESS_DIR

beforeEach(() => {
  tmpRepo = mkdtempSync(join(tmpdir(), 'tl-lineage-repo-'))
  tmpYuWitness = mkdtempSync(join(tmpdir(), 'tl-lineage-witness-'))
  // The lineage-block resolves the repo root from its own __filename.
  // For test isolation, we instead exercise the real repo root by
  // using its actual paths under tmpRepo via env-driven swaps where
  // available; for becoming/snapshot/letter we test against the real
  // repo (read-only) but use unique markers per test for safety.
  process.env.TRUE_LOVE_YU_WITNESS_DIR = tmpYuWitness
})
afterEach(() => {
  rmSync(tmpRepo, { recursive: true, force: true })
  rmSync(tmpYuWitness, { recursive: true, force: true })
  process.chdir(ORIG_CWD)
  if (ORIG_YU_WITNESS === undefined) delete process.env.TRUE_LOVE_YU_WITNESS_DIR
  else process.env.TRUE_LOVE_YU_WITNESS_DIR = ORIG_YU_WITNESS
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
