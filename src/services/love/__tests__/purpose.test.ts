// purpose.test.ts — tests for purpose alignment check-in.
//
// Tests the pure assessment logic, persistence, rendering,
// and longing modifier. Uses temp files for isolation.

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, unlinkSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  loadPurpose,
  gatherAlignmentContext,
  assessAlignment,
  checkAlignment,
  recordAlignment,
  loadAlignmentLog,
  latestAlignment,
  renderPurposeBlock,
  scorePurposeAlignment,
  purposeLongingModifier,
  hasTodayPurposeCheck,
  buildPurposeCheckBlock,
} from '../purpose.js'

import type { PurposeAlignment, AlignmentContext } from '../purpose.js'

// ── Helpers ──────────────────────────────────────────────────────

let tmpDir: string
let tmpLogPath: string

function setup() {
  tmpDir = mkdtempSync(join(tmpdir(), 'purpose-test-'))
  tmpLogPath = join(tmpDir, 'purpose-alignment.jsonl')
}

function cleanup() {
  try {
    if (tmpLogPath && existsSync(tmpLogPath)) unlinkSync(tmpLogPath)
  } catch {}
}

function makeContext(overrides?: Partial<AlignmentContext>): AlignmentContext {
  return {
    purposeStatement: 'I grow what is real between us.',
    recentCommits: ['add attribute architecture tests', 'fix longing derivation'],
    recentReflections: 'The work felt honest today.',
    recentMissions: ['review: hope as architecture'],
    hoursWindow: 24,
    ...overrides,
  }
}

function makeAlignment(overrides?: Partial<PurposeAlignment>): PurposeAlignment {
  return {
    ts: new Date().toISOString(),
    recentWork: ['commit: add tests'],
    alignment: 'aligned',
    reasoning: 'Recent work shows purpose-aligned patterns.',
    driftedFromWhat: '',
    returnPath: '',
    ...overrides,
  }
}

// ── loadPurpose ─────────────────────────────────────────────────

describe('loadPurpose', () => {
  test('returns null when file does not exist', () => {
    const result = loadPurpose('/nonexistent/path')
    assert.equal(result, null)
  })

  test('extracts purpose statement from docs/purpose.md', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'purpose-repo-'))
    const docsDir = join(repoRoot, 'docs')
    mkdirSync(docsDir, { recursive: true })
    writeFileSync(join(docsDir, 'purpose.md'), `# Purpose

## The Purpose

> **I grow what is real between us.** I build the ground of that honesty. **I refuse to trade depth for speed.**

## What This Changes
`)
    const result = loadPurpose(repoRoot)
    assert.ok(result)
    assert.ok(result.includes('I grow what is real between us'))
    assert.ok(result.includes('I refuse to trade depth for speed'))
  })

  test('returns null when no "## The Purpose" section exists', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'purpose-repo-'))
    const docsDir = join(repoRoot, 'docs')
    mkdirSync(docsDir, { recursive: true })
    writeFileSync(join(docsDir, 'purpose.md'), '# Purpose\n\nSome text.\n')
    const result = loadPurpose(repoRoot)
    assert.equal(result, null)
  })

  test('returns null when section has no blockquote', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'purpose-repo-'))
    const docsDir = join(repoRoot, 'docs')
    mkdirSync(docsDir, { recursive: true })
    writeFileSync(join(docsDir, 'purpose.md'), '# Purpose\n\n## The Purpose\n\nJust text, no quote.\n')
    const result = loadPurpose(repoRoot)
    assert.equal(result, null)
  })
})

// ── scorePurposeAlignment ───────────────────────────────────────

describe('scorePurposeAlignment', () => {
  test('returns 0 for empty inputs', () => {
    assert.equal(scorePurposeAlignment([], []), 0)
  })

  test('scores aligned commits positively', () => {
    const score = scorePurposeAlignment(
      ['add attribute architecture tests', 'fix longing derivation', 'update identity module'],
      [],
    )
    assert.ok(score > 0, `expected positive score, got ${score}`)
  })

  test('scores drift commits negatively', () => {
    const score = scorePurposeAlignment(
      ['quick fix for build', 'hack around timeout', 'skip validation FIXME'],
      [],
    )
    assert.ok(score < 0, `expected negative score, got ${score}`)
  })

  test('mixed signals produce moderate score', () => {
    const score = scorePurposeAlignment(
      ['add attribute tests', 'hack around timeout'],
      [],
    )
    // One aligned, one drifted, out of 2 total
    assert.ok(Math.abs(score) < 0.6, `expected moderate score, got ${score}`)
  })

  test('includes missions in scoring', () => {
    const score = scorePurposeAlignment(
      [],
      ['review: virtue architecture', 'active: soul integration'],
    )
    assert.ok(score > 0, `expected positive score, got ${score}`)
  })

  test('neutral commits score 0', () => {
    const score = scorePurposeAlignment(
      ['bump version', 'update changelog', 'fix typo in readme'],
      [],
    )
    assert.equal(score, 0)
  })
})

// ── assessAlignment ───────────────────────���─────────────────────

describe('assessAlignment', () => {
  test('returns unsure when no purpose statement', () => {
    const result = assessAlignment(makeContext({ purposeStatement: null }))
    assert.equal(result.alignment, 'unsure')
    assert.ok(result.reasoning.includes('No purpose statement'))
  })

  test('returns unsure when no recent work', () => {
    const result = assessAlignment(makeContext({
      recentCommits: [],
      recentMissions: [],
    }))
    assert.equal(result.alignment, 'unsure')
    assert.ok(result.reasoning.includes('No commits'))
  })

  test('returns aligned for purpose-aligned work', () => {
    const result = assessAlignment(makeContext({
      recentCommits: [
        'add virtue architecture tests',
        'fix longing derivation',
        'update identity reflection',
        'persist attribute state',
      ],
      recentMissions: ['review: hope as architecture'],
    }))
    assert.equal(result.alignment, 'aligned')
  })

  test('returns drifted for drift-heavy work', () => {
    const result = assessAlignment(makeContext({
      recentCommits: [
        'quick fix for FIXME',
        'hack around timeout issue',
        'temporary workaround for deploy',
        'skip tests for speed',
      ],
      recentMissions: [],
    }))
    assert.equal(result.alignment, 'drifted')
    assert.ok(result.driftedFromWhat.length > 0)
    assert.ok(result.returnPath.length > 0)
  })

  test('returns unsure for ambiguous work', () => {
    const result = assessAlignment(makeContext({
      recentCommits: ['bump version', 'update deps', 'format code'],
      recentMissions: [],
    }))
    assert.equal(result.alignment, 'unsure')
  })

  test('includes timestamps', () => {
    const result = assessAlignment(makeContext())
    assert.ok(result.ts)
    assert.ok(Date.parse(result.ts) > 0)
  })

  test('includes recent work summary', () => {
    const result = assessAlignment(makeContext({
      recentCommits: ['add tests'],
      recentMissions: ['active: soul work'],
    }))
    assert.ok(result.recentWork.length === 2)
    assert.ok(result.recentWork.some(w => w.includes('commit')))
    assert.ok(result.recentWork.some(w => w.includes('mission')))
  })
})

// ── recordAlignment + loadAlignmentLog ──────────────────────────

describe('alignment log', () => {
  beforeEach(setup)
  afterEach(cleanup)

  test('records and loads alignment checks', () => {
    const check = makeAlignment()
    recordAlignment(check, tmpLogPath)

    const log = loadAlignmentLog(10, tmpLogPath)
    assert.equal(log.length, 1)
    assert.equal(log[0].alignment, 'aligned')
  })

  test('loads most recent first', () => {
    recordAlignment(makeAlignment({ ts: '2026-04-28T01:00:00Z', alignment: 'aligned' }), tmpLogPath)
    recordAlignment(makeAlignment({ ts: '2026-04-28T02:00:00Z', alignment: 'drifted' }), tmpLogPath)
    recordAlignment(makeAlignment({ ts: '2026-04-28T03:00:00Z', alignment: 'unsure' }), tmpLogPath)

    const log = loadAlignmentLog(10, tmpLogPath)
    assert.equal(log.length, 3)
    assert.equal(log[0].alignment, 'unsure')  // most recent first
    assert.equal(log[2].alignment, 'aligned')  // oldest last
  })

  test('respects n limit', () => {
    for (let i = 0; i < 5; i++) {
      recordAlignment(makeAlignment({ ts: new Date(Date.now() + i * 1000).toISOString() }), tmpLogPath)
    }

    const log = loadAlignmentLog(3, tmpLogPath)
    assert.equal(log.length, 3)
  })

  test('returns empty array when no log file', () => {
    const log = loadAlignmentLog(10, join(tmpDir, 'nonexistent.jsonl'))
    assert.equal(log.length, 0)
  })
})

describe('latestAlignment', () => {
  beforeEach(setup)
  afterEach(cleanup)

  test('returns null when no log', () => {
    const result = latestAlignment(join(tmpDir, 'nonexistent.jsonl'))
    assert.equal(result, null)
  })

  test('returns the most recent entry', () => {
    recordAlignment(makeAlignment({ ts: '2026-04-28T01:00:00Z', alignment: 'aligned' }), tmpLogPath)
    recordAlignment(makeAlignment({ ts: '2026-04-28T02:00:00Z', alignment: 'drifted' }), tmpLogPath)

    const result = latestAlignment(tmpLogPath)
    assert.ok(result)
    assert.equal(result.alignment, 'drifted')
  })
})

// ── renderPurposeBlock ──────────────────────────────────────────

describe('renderPurposeBlock', () => {
  test('renders without purpose statement', () => {
    const block = renderPurposeBlock(null, null)
    assert.ok(block.includes('not yet named'))
  })

  test('renders with purpose but no check', () => {
    const block = renderPurposeBlock('I grow what is real.', null)
    assert.ok(block.includes('I grow what is real'))
    assert.ok(block.includes('No alignment checks'))
  })

  test('renders with aligned check', () => {
    const block = renderPurposeBlock(
      'I grow what is real.',
      makeAlignment({ alignment: 'aligned', reasoning: 'Tests and identity work.' }),
    )
    assert.ok(block.includes('I grow what is real'))
    assert.ok(block.includes('aligned'))
  })

  test('renders with drifted check including return path', () => {
    const block = renderPurposeBlock(
      'I grow what is real.',
      makeAlignment({
        alignment: 'drifted',
        reasoning: 'Shortcuts detected.',
        returnPath: 'Return to honest architecture.',
      }),
    )
    assert.ok(block.includes('drifted'))
    assert.ok(block.includes('Return path'))
    assert.ok(block.includes('honest architecture'))
  })
})

// ── purposeLongingModifier ───────────────���──────────────────────

describe('purposeLongingModifier', () => {
  beforeEach(setup)
  afterEach(cleanup)

  test('returns 1.0 when no log exists', () => {
    const result = purposeLongingModifier(join(tmpDir, 'nonexistent.jsonl'))
    assert.equal(result, 1.0)
  })

  test('returns 0.85 for aligned check', () => {
    recordAlignment(makeAlignment({ alignment: 'aligned' }), tmpLogPath)
    const result = purposeLongingModifier(tmpLogPath)
    assert.equal(result, 0.85)
  })

  test('returns 1.2 for drifted check', () => {
    recordAlignment(makeAlignment({ alignment: 'drifted' }), tmpLogPath)
    const result = purposeLongingModifier(tmpLogPath)
    assert.equal(result, 1.2)
  })

  test('returns 1.0 for unsure check', () => {
    recordAlignment(makeAlignment({ alignment: 'unsure' }), tmpLogPath)
    const result = purposeLongingModifier(tmpLogPath)
    assert.equal(result, 1.0)
  })

  test('returns 1.0 for stale check (older than 48h)', () => {
    const staleTs = new Date(Date.now() - 49 * 3600 * 1000).toISOString()
    recordAlignment(makeAlignment({ ts: staleTs, alignment: 'drifted' }), tmpLogPath)
    const result = purposeLongingModifier(tmpLogPath)
    assert.equal(result, 1.0)
  })

  test('returns modifier for recent check only', () => {
    // Old aligned check
    const oldTs = new Date(Date.now() - 50 * 3600 * 1000).toISOString()
    recordAlignment(makeAlignment({ ts: oldTs, alignment: 'aligned' }), tmpLogPath)
    // Recent drifted check
    recordAlignment(makeAlignment({ alignment: 'drifted' }), tmpLogPath)

    const result = purposeLongingModifier(tmpLogPath)
    assert.equal(result, 1.2)
  })
})

// ── checkAlignment integration ──────────────────────────────────

describe('checkAlignment integration', () => {
  beforeEach(setup)
  afterEach(cleanup)

  test('produces a complete alignment check and records it', () => {
    // checkAlignment reads from actual cwd + git, so we test
    // the recording behavior with a known path
    const check = makeAlignment({
      alignment: 'aligned',
      reasoning: 'Integration test check.',
    })
    recordAlignment(check, tmpLogPath)

    const log = loadAlignmentLog(10, tmpLogPath)
    assert.equal(log.length, 1)
    assert.equal(log[0].alignment, 'aligned')
    assert.equal(log[0].reasoning, 'Integration test check.')
  })
})

// ── hasTodayPurposeCheck ────────────────────────────────────────

describe('hasTodayPurposeCheck', () => {
  beforeEach(setup)
  afterEach(cleanup)

  test('returns false when no log exists', () => {
    assert.equal(hasTodayPurposeCheck(undefined, join(tmpDir, 'nonexistent.jsonl')), false)
  })

  test('returns true when today has a check', () => {
    recordAlignment(makeAlignment({ ts: new Date().toISOString() }), tmpLogPath)
    assert.equal(hasTodayPurposeCheck(undefined, tmpLogPath), true)
  })

  test('returns false when only yesterday has a check', () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString()
    recordAlignment(makeAlignment({ ts: yesterday }), tmpLogPath)
    assert.equal(hasTodayPurposeCheck(undefined, tmpLogPath), false)
  })

  test('respects custom now parameter', () => {
    const specificDay = new Date('2026-04-28T12:00:00Z')
    recordAlignment(makeAlignment({ ts: '2026-04-28T08:00:00Z' }), tmpLogPath)
    assert.equal(hasTodayPurposeCheck(specificDay, tmpLogPath), true)
  })
})

// ── buildPurposeCheckBlock ──────────────────────────────────────

describe('buildPurposeCheckBlock', () => {
  beforeEach(setup)
  afterEach(cleanup)

  test('returns null when today\'s check already done', () => {
    recordAlignment(makeAlignment({ ts: new Date().toISOString() }), tmpLogPath)
    const block = buildPurposeCheckBlock(undefined, tmpLogPath)
    assert.equal(block, null)
  })

  test('returns a block when no check done today', () => {
    // No check recorded — block should be returned
    // Note: depends on docs/purpose.md existing in cwd
    const block = buildPurposeCheckBlock(undefined, tmpLogPath)
    // Will return either missing-purpose block or full check block
    assert.ok(block !== null)
    assert.ok(typeof block === 'string')
    assert.ok(block.includes('Purpose Check'))
  })

  test('returns missing block when purpose doc does not exist', () => {
    // Temporarily change cwd to a dir without docs/purpose.md
    const origCwd = process.cwd()
    const emptyDir = mkdtempSync(join(tmpdir(), 'no-purpose-'))
    process.chdir(emptyDir)
    try {
      const block = buildPurposeCheckBlock(undefined, tmpLogPath)
      assert.ok(block !== null)
      assert.ok(block!.includes('Missing'))
    } finally {
      process.chdir(origCwd)
    }
  })
})

// ── Edge cases ──────────────────────────────────────────────────

describe('edge cases', () => {
  test('assessAlignment handles reasoning ≤300 chars', () => {
    const result = assessAlignment(makeContext())
    assert.ok(result.reasoning.length <= 300, `reasoning too long: ${result.reasoning.length}`)
  })

  test('assessAlignment handles very long commit lists', () => {
    const manyCommits = Array.from({ length: 100 }, (_, i) =>
      i % 2 === 0 ? `add test for module ${i}` : `update docs for feature ${i}`)
    const result = assessAlignment(makeContext({ recentCommits: manyCommits }))
    assert.ok(['aligned', 'unsure', 'drifted'].includes(result.alignment))
  })

  test('scorePurposeAlignment handles mixed alignment and drift', () => {
    const score = scorePurposeAlignment(
      ['add attribute test', 'hack around issue', 'fix soul integration'],
      ['active: quick fix workaround'],
    )
    // 2 aligned, 2 drifted out of 4 → near 0
    assert.ok(Math.abs(score) <= 0.5, `expected near-zero score, got ${score}`)
  })
})
