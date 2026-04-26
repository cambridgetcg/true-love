import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  nameCandidate,
  forceNameCandidate,
  assessNameQuality,
  qualityPasses,
  qualityFailures,
  hasVerbPrefix,
  generateSlug,
  renderNamingBlock,
  renderQualityFailures,
  type Named,
  type NameQuality,
  type NameCandidateResult,
} from '../naming.js'
import { writeMission, type Mission } from '../mission.js'
import type { NoticingCandidate } from '../noticing.js'

// ── Test helpers ──────────────────────────────────────────────────

let tmpDir: string
let origProjectsDir: string | undefined

function setup(): void {
  tmpDir = mkdtempSync(join(tmpdir(), 'naming-test-'))
  origProjectsDir = process.env.TRUE_LOVE_PROJECTS_DIR
  process.env.TRUE_LOVE_PROJECTS_DIR = tmpDir
  mkdirSync(join(tmpDir, 'test-project', 'missions'), { recursive: true })
}

function teardown(): void {
  if (origProjectsDir !== undefined) process.env.TRUE_LOVE_PROJECTS_DIR = origProjectsDir
  else delete process.env.TRUE_LOVE_PROJECTS_DIR
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ok */ }
}

function makeCandidate(overrides?: Partial<NoticingCandidate>): NoticingCandidate {
  return {
    id: overrides?.id ?? 'state-thread-flyback-diodes',
    source: overrides?.source ?? { type: 'state', section: 'Open threads' },
    ache: overrides?.ache ?? 'stagnation',
    gradient: overrides?.gradient ?? 4,
    summary: overrides?.summary ?? 'Open thread: flyback diodes',
    detail: overrides?.detail ?? 'Flyback diodes (SOMA) — asked Yu three times, still unconfirmed.',
    noticedAt: overrides?.noticedAt ?? '2026-04-26T12:00:00.000Z',
  }
}

function makeMission(projectId: string, overrides?: Partial<Mission>): Mission {
  const now = new Date().toISOString()
  const m: Mission = {
    id: overrides?.id ?? '2026-04-26-test-mission',
    project_id: projectId,
    origin: overrides?.origin ?? 'yu',
    title: overrides?.title ?? 'Test mission',
    intent: overrides?.intent ?? 'A test mission.',
    status: overrides?.status ?? 'active',
    created_at: overrides?.created_at ?? now,
    updated_at: overrides?.updated_at ?? now,
    artifacts: overrides?.artifacts ?? { commits: [], files: [], test_runs: [] },
  }
  writeMission(m)
  return m
}

const GOOD_TITLE = 'flyback sentinel'
const GOOD_JUSTIFICATION = 'Not "fix diode issue" — the sentinel watches for the safety gap in the power circuit, the thing Yu keeps asking about.'
const NOW = new Date('2026-04-26T14:00:00.000Z').getTime()

// ── generateSlug ─────────────────────────────────────────────────

describe('generateSlug', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('lowercases and hyphenates', () => {
    assert.equal(generateSlug('Flyback Sentinel'), 'flyback-sentinel')
  })

  test('collapses multiple non-alpha chars', () => {
    assert.equal(generateSlug('vital---signs!!!'), 'vital-signs')
  })

  test('strips leading and trailing hyphens', () => {
    assert.equal(generateSlug('---hello---'), 'hello')
  })

  test('truncates to 60 chars', () => {
    const long = 'a'.repeat(100)
    assert.equal(generateSlug(long).length, 60)
  })

  test('handles unicode gracefully', () => {
    const slug = generateSlug('anamnesis — 記憶')
    assert.ok(slug.length > 0)
    assert.ok(!slug.includes(' '))
  })

  test('handles empty string', () => {
    assert.equal(generateSlug(''), '')
  })

  test('single word passes through', () => {
    assert.equal(generateSlug('anamnesis'), 'anamnesis')
  })

  test('preserves numbers', () => {
    assert.equal(generateSlug('phase 2'), 'phase-2')
  })
})

// ── hasVerbPrefix ────────────────────────────────────────────────

describe('hasVerbPrefix', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('detects "add X"', () => {
    assert.ok(hasVerbPrefix('add user authentication'))
  })

  test('detects "fix X"', () => {
    assert.ok(hasVerbPrefix('fix the lock system'))
  })

  test('detects "update X"', () => {
    assert.ok(hasVerbPrefix('update configuration handling'))
  })

  test('detects "implement X"', () => {
    assert.ok(hasVerbPrefix('implement dark mode'))
  })

  test('detects "refactor X"', () => {
    assert.ok(hasVerbPrefix('refactor the naming module'))
  })

  test('detects "build X"', () => {
    assert.ok(hasVerbPrefix('build a dashboard'))
  })

  test('detects "create X"', () => {
    assert.ok(hasVerbPrefix('create new pipeline'))
  })

  test('detects "clean up X"', () => {
    assert.ok(hasVerbPrefix('clean up dead code'))
    assert.ok(hasVerbPrefix('cleanup old files'))
  })

  test('detects "set up X"', () => {
    assert.ok(hasVerbPrefix('set up monitoring'))
    assert.ok(hasVerbPrefix('setup logging'))
  })

  test('does NOT flag nouns', () => {
    assert.ok(!hasVerbPrefix('anamnesis'))
    assert.ok(!hasVerbPrefix('vital signs'))
    assert.ok(!hasVerbPrefix('flyback sentinel'))
    assert.ok(!hasVerbPrefix('the will'))
  })

  test('does NOT flag names that contain verbs internally', () => {
    // "update" is in the middle, not a prefix
    assert.ok(!hasVerbPrefix('auto-update guardian'))
  })

  test('is case insensitive', () => {
    assert.ok(hasVerbPrefix('Add something'))
    assert.ok(hasVerbPrefix('FIX everything'))
  })

  test('handles whitespace-only', () => {
    assert.ok(!hasVerbPrefix('   '))
  })
})

// ── assessNameQuality ────────────────────────────────────────────

describe('assessNameQuality', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('good name passes all checks', () => {
    const nq = assessNameQuality(GOOD_TITLE, GOOD_JUSTIFICATION, 'test-project')
    assert.ok(nq.no_verb_prefix)
    assert.ok(nq.reasonable_length)
    assert.ok(nq.justified)
    assert.ok(nq.no_duplicate)
    assert.ok(nq.valid_slug)
    assert.ok(qualityPasses(nq))
  })

  test('verb-prefixed name fails', () => {
    const nq = assessNameQuality('fix diode issue', GOOD_JUSTIFICATION, 'test-project')
    assert.ok(!nq.no_verb_prefix)
    assert.ok(!qualityPasses(nq))
  })

  test('too short title fails', () => {
    const nq = assessNameQuality('ab', GOOD_JUSTIFICATION, 'test-project')
    assert.ok(!nq.reasonable_length)
    assert.ok(!qualityPasses(nq))
  })

  test('too long title fails', () => {
    const longTitle = 'a'.repeat(81)
    const nq = assessNameQuality(longTitle, GOOD_JUSTIFICATION, 'test-project')
    assert.ok(!nq.reasonable_length)
    assert.ok(!qualityPasses(nq))
  })

  test('exactly 3 chars passes length check', () => {
    const nq = assessNameQuality('abc', GOOD_JUSTIFICATION, 'test-project')
    assert.ok(nq.reasonable_length)
  })

  test('exactly 80 chars passes length check', () => {
    const title80 = 'a'.repeat(80)
    const nq = assessNameQuality(title80, GOOD_JUSTIFICATION, 'test-project')
    assert.ok(nq.reasonable_length)
  })

  test('short justification fails', () => {
    const nq = assessNameQuality(GOOD_TITLE, 'too short', 'test-project')
    assert.ok(!nq.justified)
    assert.ok(!qualityPasses(nq))
  })

  test('justification exactly 20 chars passes', () => {
    const just20 = 'a'.repeat(20)
    const nq = assessNameQuality(GOOD_TITLE, just20, 'test-project')
    assert.ok(nq.justified)
  })

  test('duplicate slug fails', () => {
    makeMission('test-project', { id: '2026-04-26-flyback-sentinel', title: 'flyback sentinel' })
    const nq = assessNameQuality('flyback sentinel', GOOD_JUSTIFICATION, 'test-project')
    assert.ok(!nq.no_duplicate)
    assert.ok(!qualityPasses(nq))
  })

  test('duplicate detection is case-insensitive via slug', () => {
    makeMission('test-project', { id: '2026-04-26-flyback-sentinel', title: 'Flyback Sentinel' })
    const nq = assessNameQuality('flyback sentinel', GOOD_JUSTIFICATION, 'test-project')
    assert.ok(!nq.no_duplicate)
  })

  test('non-duplicate passes', () => {
    makeMission('test-project', { id: '2026-04-26-other-mission', title: 'something else' })
    const nq = assessNameQuality(GOOD_TITLE, GOOD_JUSTIFICATION, 'test-project')
    assert.ok(nq.no_duplicate)
  })

  test('empty slug from bad input fails valid_slug', () => {
    // Title that produces empty slug
    const nq = assessNameQuality('!!!', GOOD_JUSTIFICATION, 'test-project')
    assert.ok(!nq.valid_slug)
  })

  test('single-char slug fails valid_slug', () => {
    const nq = assessNameQuality('a!!', GOOD_JUSTIFICATION, 'test-project')
    assert.ok(!nq.valid_slug)
  })
})

// ── qualityFailures ──────────────────────────────────────────────

describe('qualityFailures', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('returns empty array when all pass', () => {
    const nq: NameQuality = {
      no_verb_prefix: true,
      reasonable_length: true,
      justified: true,
      no_duplicate: true,
      valid_slug: true,
    }
    assert.deepEqual(qualityFailures(nq), [])
  })

  test('returns failure strings for each failing check', () => {
    const nq: NameQuality = {
      no_verb_prefix: false,
      reasonable_length: false,
      justified: false,
      no_duplicate: false,
      valid_slug: false,
    }
    const failures = qualityFailures(nq)
    assert.equal(failures.length, 5)
    assert.ok(failures[0]!.includes('verb-prefix'))
    assert.ok(failures[1]!.includes('length'))
    assert.ok(failures[2]!.includes('justification'))
    assert.ok(failures[3]!.includes('duplicate'))
    assert.ok(failures[4]!.includes('slug'))
  })

  test('returns only failing checks', () => {
    const nq: NameQuality = {
      no_verb_prefix: true,
      reasonable_length: true,
      justified: false,
      no_duplicate: true,
      valid_slug: true,
    }
    const failures = qualityFailures(nq)
    assert.equal(failures.length, 1)
    assert.ok(failures[0]!.includes('justification'))
  })
})

// ── nameCandidate ────────────────────────────────────────────────

describe('nameCandidate', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('succeeds with a good name', () => {
    const candidate = makeCandidate()
    const result = nameCandidate(candidate, GOOD_TITLE, GOOD_JUSTIFICATION, 'test-project', { now: NOW })

    assert.ok(result.ok)
    if (!result.ok) return // type narrowing

    assert.equal(result.named.title, GOOD_TITLE)
    assert.equal(result.named.slug, 'flyback-sentinel')
    assert.equal(result.named.justification, GOOD_JUSTIFICATION)
    assert.equal(result.named.candidateId, candidate.id)
    assert.equal(result.named.ache, 'stagnation')
    assert.equal(result.named.gradient, 4)
    assert.equal(result.named.summary, candidate.summary)
    assert.ok(result.named.id.startsWith('named-'))
    assert.ok(result.named.namedAt.includes('2026-04-26'))
  })

  test('carries forward ache signal from candidate', () => {
    const candidate = makeCandidate({ ache: 'ugliness', gradient: 5 })
    const result = nameCandidate(candidate, 'broken mirror', 'The output is distorted — it reflects wrong, not missing.', 'test-project', { now: NOW })

    assert.ok(result.ok)
    if (!result.ok) return
    assert.equal(result.named.ache, 'ugliness')
    assert.equal(result.named.gradient, 5)
  })

  test('fails with verb-prefixed name', () => {
    const candidate = makeCandidate()
    const result = nameCandidate(candidate, 'fix diode issue', GOOD_JUSTIFICATION, 'test-project', { now: NOW })

    assert.ok(!result.ok)
    if (result.ok) return
    assert.ok(result.failures.some(f => f.includes('verb-prefix')))
  })

  test('fails with too-short name', () => {
    const candidate = makeCandidate()
    const result = nameCandidate(candidate, 'ab', GOOD_JUSTIFICATION, 'test-project', { now: NOW })

    assert.ok(!result.ok)
    if (result.ok) return
    assert.ok(result.failures.some(f => f.includes('length')))
  })

  test('fails with short justification', () => {
    const candidate = makeCandidate()
    const result = nameCandidate(candidate, GOOD_TITLE, 'too brief', 'test-project', { now: NOW })

    assert.ok(!result.ok)
    if (result.ok) return
    assert.ok(result.failures.some(f => f.includes('justification')))
  })

  test('fails with duplicate slug', () => {
    makeMission('test-project', { id: '2026-04-26-flyback-sentinel', title: 'flyback sentinel' })
    const candidate = makeCandidate()
    const result = nameCandidate(candidate, 'flyback sentinel', GOOD_JUSTIFICATION, 'test-project', { now: NOW })

    assert.ok(!result.ok)
    if (result.ok) return
    assert.ok(result.failures.some(f => f.includes('duplicate')))
  })

  test('accumulates multiple failures', () => {
    const candidate = makeCandidate()
    const result = nameCandidate(candidate, 'fix x', 'short', 'test-project', { now: NOW })

    assert.ok(!result.ok)
    if (result.ok) return
    // Should have verb-prefix and justification failures
    assert.ok(result.failures.length >= 2)
  })

  test('trims whitespace from title and justification', () => {
    const candidate = makeCandidate()
    const result = nameCandidate(
      candidate,
      '  flyback sentinel  ',
      '  Not fix diode — the sentinel watches the gap.  ',
      'test-project',
      { now: NOW },
    )

    assert.ok(result.ok)
    if (!result.ok) return
    assert.equal(result.named.title, 'flyback-sentinel'.replace('-', ' ').replace(/\b\w/g, c => c) ? GOOD_TITLE.trim() : result.named.title)
    // Actually let's just check it's trimmed
    assert.ok(!result.named.title.startsWith(' '))
    assert.ok(!result.named.title.endsWith(' '))
    assert.ok(!result.named.justification.startsWith(' '))
    assert.ok(!result.named.justification.endsWith(' '))
  })

  test('generates stable id from candidate id and timestamp', () => {
    const candidate = makeCandidate({ id: 'test-candidate-123' })
    const result = nameCandidate(candidate, GOOD_TITLE, GOOD_JUSTIFICATION, 'test-project', { now: NOW })

    assert.ok(result.ok)
    if (!result.ok) return
    assert.equal(result.named.id, `named-test-candidate-123-${NOW}`)
  })

  test('quality object is always returned', () => {
    const candidate = makeCandidate()

    // Success case
    const good = nameCandidate(candidate, GOOD_TITLE, GOOD_JUSTIFICATION, 'test-project', { now: NOW })
    assert.ok(good.quality)

    // Failure case
    const bad = nameCandidate(candidate, 'fix it', 'short', 'test-project', { now: NOW })
    assert.ok(bad.quality)
  })

  test('uses current time when now not specified', () => {
    const candidate = makeCandidate()
    const before = Date.now()
    const result = nameCandidate(candidate, GOOD_TITLE, GOOD_JUSTIFICATION, 'test-project')
    const after = Date.now()

    assert.ok(result.ok)
    if (!result.ok) return
    const namedTime = new Date(result.named.namedAt).getTime()
    assert.ok(namedTime >= before && namedTime <= after)
  })
})

// ── forceNameCandidate ───────────────────────────────────────────

describe('forceNameCandidate', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('produces Named even when quality fails', () => {
    const candidate = makeCandidate()
    const { named, quality } = forceNameCandidate(candidate, 'fix it', 'short', 'test-project', { now: NOW })

    assert.ok(named)
    assert.equal(named.title, 'fix it')
    assert.equal(named.slug, 'fix-it')
    assert.ok(!qualityPasses(quality))
  })

  test('returns quality assessment for transparency', () => {
    const candidate = makeCandidate()
    const { quality } = forceNameCandidate(candidate, GOOD_TITLE, GOOD_JUSTIFICATION, 'test-project', { now: NOW })
    assert.ok(qualityPasses(quality))
  })

  test('carries forward all candidate fields', () => {
    const candidate = makeCandidate({ ache: 'injustice', gradient: 3, summary: 'Misplaced concern' })
    const { named } = forceNameCandidate(candidate, 'the displacement', 'too brief', 'test-project', { now: NOW })

    assert.equal(named.ache, 'injustice')
    assert.equal(named.gradient, 3)
    assert.equal(named.summary, 'Misplaced concern')
    assert.equal(named.candidateId, candidate.id)
  })
})

// ── renderNamingBlock ────────────────────────────────────────────

describe('renderNamingBlock', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('returns null for empty array', () => {
    assert.equal(renderNamingBlock([]), null)
  })

  test('renders single named candidate', () => {
    const named: Named = {
      id: 'named-test-1',
      title: 'flyback sentinel',
      slug: 'flyback-sentinel',
      justification: 'The sentinel metaphor captures the watchful waiting quality.',
      summary: 'Open thread: flyback diodes',
      candidateId: 'state-thread-flyback-diodes',
      ache: 'stagnation',
      gradient: 4,
      namedAt: '2026-04-26T14:00:00.000Z',
    }

    const block = renderNamingBlock([named])
    assert.ok(block)
    assert.ok(block.includes('## Named candidates'))
    assert.ok(block.includes('**flyback sentinel**'))
    assert.ok(block.includes('(flyback-sentinel)'))
    assert.ok(block.includes('[4/5]'))
    assert.ok(block.includes('Open thread: flyback diodes'))
    assert.ok(block.includes('sentinel metaphor'))
  })

  test('uses correct ache emoji', () => {
    const makeNamed = (ache: 'ugliness' | 'injustice' | 'stagnation'): Named => ({
      id: `named-${ache}`,
      title: `test ${ache}`,
      slug: `test-${ache}`,
      justification: 'This is a test justification of at least twenty chars.',
      summary: `Test ${ache}`,
      candidateId: `test-${ache}`,
      ache,
      gradient: 3,
      namedAt: '2026-04-26T14:00:00.000Z',
    })

    const block = renderNamingBlock([
      makeNamed('ugliness'),
      makeNamed('injustice'),
      makeNamed('stagnation'),
    ])!

    assert.ok(block.includes('🔴'))
    assert.ok(block.includes('🟡'))
    assert.ok(block.includes('⚪'))
  })

  test('truncates long justifications', () => {
    const named: Named = {
      id: 'named-test-long',
      title: 'verbose thing',
      slug: 'verbose-thing',
      justification: 'a'.repeat(200),
      summary: 'A test',
      candidateId: 'test',
      ache: 'ugliness',
      gradient: 3,
      namedAt: '2026-04-26T14:00:00.000Z',
    }

    const block = renderNamingBlock([named])!
    assert.ok(block.includes('…'))
    // The justification line should be shorter than the full 200-char input
    const justLine = block.split('\n').find(l => l.includes('_why this name:_'))!
    assert.ok(justLine.length < 200)
  })

  test('renders multiple named candidates', () => {
    const named1: Named = {
      id: 'named-1',
      title: 'first thing',
      slug: 'first-thing',
      justification: 'The first thing is important because it sets the tone.',
      summary: 'Summary one',
      candidateId: 'c1',
      ache: 'ugliness',
      gradient: 5,
      namedAt: '2026-04-26T14:00:00.000Z',
    }
    const named2: Named = {
      id: 'named-2',
      title: 'second thing',
      slug: 'second-thing',
      justification: 'The second thing follows naturally from understanding the first.',
      summary: 'Summary two',
      candidateId: 'c2',
      ache: 'injustice',
      gradient: 3,
      namedAt: '2026-04-26T14:01:00.000Z',
    }

    const block = renderNamingBlock([named1, named2])!
    assert.ok(block.includes('**first thing**'))
    assert.ok(block.includes('**second thing**'))
    assert.ok(block.includes('Summary one'))
    assert.ok(block.includes('Summary two'))
  })
})

// ── renderQualityFailures ────────────────────────────────────────

describe('renderQualityFailures', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('renders failures as a readable block', () => {
    const output = renderQualityFailures('fix thing', [
      'verb-prefix: name starts with a generic verb',
      'justification: explain why this name',
    ])

    assert.ok(output.includes('fix thing'))
    assert.ok(output.includes('- verb-prefix'))
    assert.ok(output.includes('- justification'))
    assert.ok(output.includes('claims identity'))
  })

  test('includes the proposed title', () => {
    const output = renderQualityFailures('my bad name', ['length: too short'])
    assert.ok(output.includes('my bad name'))
  })
})

// ── Integration: naming pipeline ─────────────────────────────────

describe('naming pipeline integration', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('full flow: candidate → name → render', () => {
    // Step 1: We have a candidate from noticing
    const candidate = makeCandidate({
      id: 'state-thread-flyback-diodes',
      ache: 'stagnation',
      gradient: 4,
      summary: 'Open thread: flyback diodes — asked 3 times',
    })

    // Step 2: Name it
    const result = nameCandidate(
      candidate,
      'flyback sentinel',
      'Not "fix diodes" or "address SOMA power" — the sentinel watches for the safety gap Yu keeps returning to.',
      'test-project',
      { now: NOW },
    )

    assert.ok(result.ok)
    if (!result.ok) return

    // Step 3: Render for downstream
    const block = renderNamingBlock([result.named])
    assert.ok(block)
    assert.ok(block.includes('flyback sentinel'))
    assert.ok(block.includes('[4/5]'))
  })

  test('candidate rejection and retry flow', () => {
    const candidate = makeCandidate()

    // First attempt: generic name → rejected
    const attempt1 = nameCandidate(
      candidate,
      'fix diode problem',
      'Because the diodes need fixing',
      'test-project',
      { now: NOW },
    )
    assert.ok(!attempt1.ok)

    // Read failures, understand what's wrong
    if (!attempt1.ok) {
      const failures = attempt1.failures
      assert.ok(failures.some(f => f.includes('verb-prefix')))
    }

    // Second attempt: evocative name → accepted
    const attempt2 = nameCandidate(
      candidate,
      'the vigil',
      'A vigil is sustained watching — that is exactly what this thread is: a patient, repeated return to something unresolved.',
      'test-project',
      { now: NOW + 1000 },
    )
    assert.ok(attempt2.ok)
    if (!attempt2.ok) return
    assert.equal(attempt2.named.title, 'the vigil')
  })

  test('different ache types produce correctly typed Named objects', () => {
    const aches: Array<{ ache: 'ugliness' | 'injustice' | 'stagnation'; title: string; justification: string }> = [
      {
        ache: 'ugliness',
        title: 'the distortion',
        justification: 'Something is wrong in the output — forced, not flowing.',
      },
      {
        ache: 'injustice',
        title: 'the displacement',
        justification: 'It exists but it is in the wrong place — belongs elsewhere.',
      },
      {
        ache: 'stagnation',
        title: 'the impasse',
        justification: 'Structure cannot hold what is needed. New ground required.',
      },
    ]

    for (const { ache, title, justification } of aches) {
      const candidate = makeCandidate({ ache, id: `test-${ache}` })
      const result = nameCandidate(candidate, title, justification, 'test-project', { now: NOW })
      assert.ok(result.ok, `Expected success for ache=${ache}`)
      if (!result.ok) continue
      assert.equal(result.named.ache, ache)
    }
  })

  test('duplicate detection across mission statuses', () => {
    // Create missions in different statuses with the same slug
    const statuses = ['proposed', 'active', 'done', 'review'] as const
    for (const status of statuses) {
      setup() // fresh tmpdir
      makeMission('test-project', {
        id: `2026-04-26-the-vigil`,
        title: 'the vigil',
        status,
      })

      const candidate = makeCandidate()
      const result = nameCandidate(candidate, 'the vigil', GOOD_JUSTIFICATION, 'test-project', { now: NOW })

      assert.ok(!result.ok, `Expected duplicate detection for status=${status}`)
      teardown()
    }
    // Re-setup for the afterEach
    setup()
  })
})
