import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  frameCandidate,
  forceFrameCandidate,
  assessFramingQuality,
  qualityPasses,
  qualityFailures,
  isRationaleRedundant,
  renderFramingBlock,
  renderQualityFailures,
  VALID_RELATIONSHIPS,
  type Framed,
  type FramingQuality,
  type FrameCandidateResult,
  type PurposeTie,
  type FramingRelationship,
} from '../framing.js'
import { writeMission, type Mission } from '../mission.js'
import type { Named } from '../naming.js'

// ── Test helpers ──────────────────────────────────────────────────

let tmpDir: string
let origProjectsDir: string | undefined

function setup(): void {
  tmpDir = mkdtempSync(join(tmpdir(), 'framing-test-'))
  origProjectsDir = process.env.TRUE_LOVE_PROJECTS_DIR
  process.env.TRUE_LOVE_PROJECTS_DIR = tmpDir
  mkdirSync(join(tmpDir, 'test-project', 'missions'), { recursive: true })
}

function teardown(): void {
  if (origProjectsDir !== undefined) process.env.TRUE_LOVE_PROJECTS_DIR = origProjectsDir
  else delete process.env.TRUE_LOVE_PROJECTS_DIR
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ok */ }
}

function makeNamed(overrides?: Partial<Named>): Named {
  return {
    id: overrides?.id ?? 'named-state-thread-flyback-diodes-1714132800000',
    title: overrides?.title ?? 'flyback sentinel',
    slug: overrides?.slug ?? 'flyback-sentinel',
    justification: overrides?.justification ?? 'Not "fix diode issue" — the sentinel watches for the safety gap in the power circuit.',
    summary: overrides?.summary ?? 'Open thread: flyback diodes need confirmation from Yu.',
    candidateId: overrides?.candidateId ?? 'state-thread-flyback-diodes',
    ache: overrides?.ache ?? 'stagnation',
    gradient: overrides?.gradient ?? 4,
    namedAt: overrides?.namedAt ?? '2026-04-26T14:00:00.000Z',
  }
}

function makePurposeTie(overrides?: Partial<PurposeTie>): PurposeTie {
  return {
    thread: overrides?.thread ?? 'infrastructure',
    relationship: overrides?.relationship ?? 'extends',
    description: overrides?.description ?? 'SOMA hardware safety is the physical substrate that the software kingdom stands on — without confirmed flyback protection, the power circuit is a single point of failure.',
    relatedMissions: overrides?.relatedMissions,
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

const GOOD_RATIONALE = 'The SOMA build depends on flyback diodes for inductive load protection. Yu has been asked three times without confirmation — the gap between "asked" and "resolved" is the ache. Without this, every motor and relay driver in the rack is unprotected against back-EMF.'
const NOW = new Date('2026-04-26T15:00:00.000Z').getTime()

// ── assessFramingQuality ─────────────────────────────────────────

describe('assessFramingQuality', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('all checks pass with good inputs', () => {
    const quality = assessFramingQuality(
      'flyback sentinel',
      'Open thread: flyback diodes need confirmation.',
      GOOD_RATIONALE,
      makePurposeTie(),
      'test-project',
    )
    assert.equal(quality.rationale_substantive, true)
    assert.equal(quality.rationale_distinct, true)
    assert.equal(quality.thread_named, true)
    assert.equal(quality.connection_articulated, true)
    assert.equal(quality.relationship_valid, true)
    assert.equal(quality.references_grounded, true)
    assert.equal(qualityPasses(quality), true)
  })

  test('fails when rationale is too short', () => {
    const quality = assessFramingQuality(
      'flyback sentinel',
      'Open thread: flyback diodes.',
      'Too short to be real.',
      makePurposeTie(),
      'test-project',
    )
    assert.equal(quality.rationale_substantive, false)
    assert.equal(qualityPasses(quality), false)
  })

  test('fails when rationale restates the title', () => {
    const quality = assessFramingQuality(
      'flyback sentinel',
      'Open thread: flyback diodes.',
      'flyback sentinel is the name of the thing we are building here, which is good.',
      makePurposeTie(),
      'test-project',
    )
    assert.equal(quality.rationale_distinct, false)
    assert.equal(qualityPasses(quality), false)
  })

  test('fails when thread name is empty', () => {
    const quality = assessFramingQuality(
      'flyback sentinel',
      'summary text here',
      GOOD_RATIONALE,
      makePurposeTie({ thread: '' }),
      'test-project',
    )
    assert.equal(quality.thread_named, false)
    assert.equal(qualityPasses(quality), false)
  })

  test('fails when thread name is too short', () => {
    const quality = assessFramingQuality(
      'flyback sentinel',
      'summary text here',
      GOOD_RATIONALE,
      makePurposeTie({ thread: 'x' }),
      'test-project',
    )
    assert.equal(quality.thread_named, false)
  })

  test('fails when connection description is too short', () => {
    const quality = assessFramingQuality(
      'flyback sentinel',
      'summary text here',
      GOOD_RATIONALE,
      makePurposeTie({ description: 'relates to hardware' }),
      'test-project',
    )
    assert.equal(quality.connection_articulated, false)
    assert.equal(qualityPasses(quality), false)
  })

  test('fails when relationship is invalid', () => {
    const quality = assessFramingQuality(
      'flyback sentinel',
      'summary text here',
      GOOD_RATIONALE,
      makePurposeTie({ relationship: 'destroys' as any }),
      'test-project',
    )
    assert.equal(quality.relationship_valid, false)
    assert.equal(qualityPasses(quality), false)
  })

  test('fails when referenced mission does not exist', () => {
    const quality = assessFramingQuality(
      'flyback sentinel',
      'summary text here',
      GOOD_RATIONALE,
      makePurposeTie({ relatedMissions: ['2026-04-26-nonexistent-mission'] }),
      'test-project',
    )
    assert.equal(quality.references_grounded, false)
    assert.equal(qualityPasses(quality), false)
  })

  test('passes when referenced mission exists', () => {
    makeMission('test-project', {
      id: '2026-04-26-vital-signs',
      title: 'vital signs',
    })
    const quality = assessFramingQuality(
      'flyback sentinel',
      'summary text here',
      GOOD_RATIONALE,
      makePurposeTie({ relatedMissions: ['2026-04-26-vital-signs'] }),
      'test-project',
    )
    assert.equal(quality.references_grounded, true)
  })

  test('passes with no referenced missions (new thread)', () => {
    const quality = assessFramingQuality(
      'flyback sentinel',
      'summary text here',
      GOOD_RATIONALE,
      makePurposeTie({ relatedMissions: [] }),
      'test-project',
    )
    assert.equal(quality.references_grounded, true)
  })

  test('passes with undefined relatedMissions', () => {
    const quality = assessFramingQuality(
      'flyback sentinel',
      'summary text here',
      GOOD_RATIONALE,
      makePurposeTie({ relatedMissions: undefined }),
      'test-project',
    )
    assert.equal(quality.references_grounded, true)
  })
})

// ── qualityFailures ──────────────────────────────────────────────

describe('qualityFailures', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('returns empty array when all checks pass', () => {
    const quality = assessFramingQuality(
      'flyback sentinel',
      'Open thread: flyback diodes need confirmation.',
      GOOD_RATIONALE,
      makePurposeTie(),
      'test-project',
    )
    assert.deepEqual(qualityFailures(quality), [])
  })

  test('returns relevant messages for each failure', () => {
    const quality: FramingQuality = {
      rationale_substantive: false,
      rationale_distinct: false,
      thread_named: false,
      connection_articulated: false,
      relationship_valid: false,
      references_grounded: false,
    }
    const failures = qualityFailures(quality)
    assert.equal(failures.length, 6)
    assert.ok(failures[0]!.includes('rationale'))
    assert.ok(failures[1]!.includes('rationale'))
    assert.ok(failures[2]!.includes('thread'))
    assert.ok(failures[3]!.includes('connection'))
    assert.ok(failures[4]!.includes('relationship'))
    assert.ok(failures[5]!.includes('references'))
  })
})

// ── isRationaleRedundant ─────────────────────────────────────────

describe('isRationaleRedundant', () => {
  test('detects rationale that starts with the title', () => {
    assert.equal(
      isRationaleRedundant(
        'flyback sentinel',
        'summary here',
        'flyback sentinel is the thing we need to build',
      ),
      true,
    )
  })

  test('allows rationale that starts with title but adds substantial content', () => {
    assert.equal(
      isRationaleRedundant(
        'flyback sentinel',
        'summary here',
        'flyback sentinel — but the real question is: why hasn\'t Yu confirmed the diode spec after three asks? The gap between "asked" and "resolved" is growing.',
      ),
      false,
    )
  })

  test('detects rationale that mostly restates the summary', () => {
    const summary = 'the power circuit needs flyback diode protection for inductive loads'
    assert.equal(
      isRationaleRedundant(
        'flyback sentinel',
        summary,
        'the power circuit needs flyback diode protection for inductive loads in the rack',
      ),
      true,
    )
  })

  test('allows genuinely distinct rationale', () => {
    assert.equal(
      isRationaleRedundant(
        'flyback sentinel',
        'Open thread: flyback diodes need confirmation.',
        GOOD_RATIONALE,
      ),
      false,
    )
  })

  test('handles short titles gracefully', () => {
    // Short titles (<= 5 chars) should not trigger prefix detection
    assert.equal(
      isRationaleRedundant(
        'soma',
        'short summary',
        'soma is the physical body of the system, and it needs protection.',
      ),
      false,
    )
  })

  test('handles empty strings without crashing', () => {
    assert.equal(isRationaleRedundant('', '', ''), false)
    assert.equal(isRationaleRedundant('title', '', 'a rationale that stands alone'), false)
    assert.equal(isRationaleRedundant('', 'summary', 'a rationale that stands alone'), false)
  })
})

// ── VALID_RELATIONSHIPS ──────────────────────────────────────────

describe('VALID_RELATIONSHIPS', () => {
  test('contains all six relationship types', () => {
    assert.equal(VALID_RELATIONSHIPS.length, 6)
    assert.ok(VALID_RELATIONSHIPS.includes('extends'))
    assert.ok(VALID_RELATIONSHIPS.includes('deepens'))
    assert.ok(VALID_RELATIONSHIPS.includes('enables'))
    assert.ok(VALID_RELATIONSHIPS.includes('repairs'))
    assert.ok(VALID_RELATIONSHIPS.includes('complements'))
    assert.ok(VALID_RELATIONSHIPS.includes('grounds'))
  })
})

// ── frameCandidate ───────────────────────────────────────────────

describe('frameCandidate', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('produces Framed on success', () => {
    const named = makeNamed()
    const result = frameCandidate(named, GOOD_RATIONALE, makePurposeTie(), 'test-project', { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return

    assert.equal(result.framed.title, 'flyback sentinel')
    assert.equal(result.framed.slug, 'flyback-sentinel')
    assert.equal(result.framed.rationale, GOOD_RATIONALE)
    assert.equal(result.framed.purposeTie.thread, 'infrastructure')
    assert.equal(result.framed.purposeTie.relationship, 'extends')
    assert.equal(result.framed.namedId, named.id)
    assert.equal(result.framed.candidateId, 'state-thread-flyback-diodes')
    assert.equal(result.framed.ache, 'stagnation')
    assert.equal(result.framed.gradient, 4)
    assert.equal(result.framed.framedAt, new Date(NOW).toISOString())
  })

  test('id is deterministic with now override', () => {
    const named = makeNamed()
    const result = frameCandidate(named, GOOD_RATIONALE, makePurposeTie(), 'test-project', { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.framed.id, `framed-${named.id}-${NOW}`)
  })

  test('carries forward all Named fields', () => {
    const named = makeNamed({
      ache: 'ugliness',
      gradient: 2,
      summary: 'A specific summary for carrying forward.',
      candidateId: 'custom-candidate-123',
    })
    const result = frameCandidate(named, GOOD_RATIONALE, makePurposeTie(), 'test-project', { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.framed.ache, 'ugliness')
    assert.equal(result.framed.gradient, 2)
    assert.equal(result.framed.summary, 'A specific summary for carrying forward.')
    assert.equal(result.framed.candidateId, 'custom-candidate-123')
  })

  test('trims rationale whitespace', () => {
    const named = makeNamed()
    const result = frameCandidate(named, `  ${GOOD_RATIONALE}  `, makePurposeTie(), 'test-project', { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.framed.rationale, GOOD_RATIONALE)
  })

  test('trims thread and description whitespace', () => {
    const named = makeNamed()
    const tie = makePurposeTie({
      thread: '  infrastructure  ',
      description: '  SOMA hardware safety is the physical substrate that the software kingdom stands on.  ',
    })
    const result = frameCandidate(named, GOOD_RATIONALE, tie, 'test-project', { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.framed.purposeTie.thread, 'infrastructure')
    assert.ok(!result.framed.purposeTie.description.startsWith(' '))
    assert.ok(!result.framed.purposeTie.description.endsWith(' '))
  })

  test('rejects when rationale is too short', () => {
    const named = makeNamed()
    const result = frameCandidate(named, 'Too short.', makePurposeTie(), 'test-project', { now: NOW })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.ok(result.failures.some(f => f.includes('rationale')))
  })

  test('rejects when rationale restates title', () => {
    const named = makeNamed()
    const result = frameCandidate(
      named,
      'flyback sentinel is what we need to build because it is important and necessary for the project.',
      makePurposeTie(),
      'test-project',
      { now: NOW },
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.ok(result.failures.some(f => f.includes('rationale')))
  })

  test('rejects when thread is empty', () => {
    const named = makeNamed()
    const result = frameCandidate(
      named,
      GOOD_RATIONALE,
      makePurposeTie({ thread: '' }),
      'test-project',
      { now: NOW },
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.ok(result.failures.some(f => f.includes('thread')))
  })

  test('rejects when relationship is invalid', () => {
    const named = makeNamed()
    const result = frameCandidate(
      named,
      GOOD_RATIONALE,
      makePurposeTie({ relationship: 'obliterates' as any }),
      'test-project',
      { now: NOW },
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.ok(result.failures.some(f => f.includes('relationship')))
  })

  test('rejects when referenced mission does not exist', () => {
    const named = makeNamed()
    const result = frameCandidate(
      named,
      GOOD_RATIONALE,
      makePurposeTie({ relatedMissions: ['2026-04-26-ghost-mission'] }),
      'test-project',
      { now: NOW },
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.ok(result.failures.some(f => f.includes('references')))
  })

  test('accepts when referenced mission exists', () => {
    makeMission('test-project', {
      id: '2026-04-26-vital-signs',
      title: 'vital signs',
    })
    const named = makeNamed()
    const result = frameCandidate(
      named,
      GOOD_RATIONALE,
      makePurposeTie({ relatedMissions: ['2026-04-26-vital-signs'] }),
      'test-project',
      { now: NOW },
    )
    assert.equal(result.ok, true)
  })

  test('omits relatedMissions from Framed when empty', () => {
    const named = makeNamed()
    const result = frameCandidate(
      named,
      GOOD_RATIONALE,
      makePurposeTie({ relatedMissions: [] }),
      'test-project',
      { now: NOW },
    )
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.framed.purposeTie.relatedMissions, undefined)
  })

  test('includes relatedMissions in Framed when present', () => {
    makeMission('test-project', {
      id: '2026-04-26-vital-signs',
      title: 'vital signs',
    })
    const named = makeNamed()
    const result = frameCandidate(
      named,
      GOOD_RATIONALE,
      makePurposeTie({ relatedMissions: ['2026-04-26-vital-signs'] }),
      'test-project',
      { now: NOW },
    )
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.deepEqual(result.framed.purposeTie.relatedMissions, ['2026-04-26-vital-signs'])
  })

  test('returns quality object on success', () => {
    const named = makeNamed()
    const result = frameCandidate(named, GOOD_RATIONALE, makePurposeTie(), 'test-project', { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.ok(result.quality)
    assert.equal(qualityPasses(result.quality), true)
  })

  test('returns quality object on failure', () => {
    const named = makeNamed()
    const result = frameCandidate(named, 'short', makePurposeTie(), 'test-project', { now: NOW })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.ok(result.quality)
    assert.equal(result.quality.rationale_substantive, false)
  })

  test('accumulates multiple failures', () => {
    const named = makeNamed()
    const result = frameCandidate(
      named,
      'x',
      { thread: '', relationship: 'zap' as any, description: 'y' },
      'test-project',
      { now: NOW },
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.ok(result.failures.length >= 4, `Expected at least 4 failures, got ${result.failures.length}`)
  })
})

// ── forceFrameCandidate ──────────────────────────────────────────

describe('forceFrameCandidate', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('produces Framed even when quality fails', () => {
    const named = makeNamed()
    const { framed, quality } = forceFrameCandidate(
      named,
      'short rationale',
      makePurposeTie({ thread: '' }),
      'test-project',
      { now: NOW },
    )
    assert.ok(framed)
    assert.equal(framed.title, 'flyback sentinel')
    assert.equal(qualityPasses(quality), false)
  })

  test('quality assessment is still computed transparently', () => {
    const named = makeNamed()
    const { quality } = forceFrameCandidate(
      named,
      'x',
      { thread: '', relationship: 'nope' as any, description: '' },
      'test-project',
      { now: NOW },
    )
    assert.equal(quality.rationale_substantive, false)
    assert.equal(quality.thread_named, false)
    assert.equal(quality.connection_articulated, false)
    assert.equal(quality.relationship_valid, false)
  })

  test('produces valid Framed with good inputs', () => {
    const named = makeNamed()
    const { framed, quality } = forceFrameCandidate(
      named,
      GOOD_RATIONALE,
      makePurposeTie(),
      'test-project',
      { now: NOW },
    )
    assert.equal(framed.title, 'flyback sentinel')
    assert.equal(framed.rationale, GOOD_RATIONALE)
    assert.equal(qualityPasses(quality), true)
  })

  test('id format matches frameCandidate', () => {
    const named = makeNamed()
    const { framed } = forceFrameCandidate(
      named,
      GOOD_RATIONALE,
      makePurposeTie(),
      'test-project',
      { now: NOW },
    )
    assert.equal(framed.id, `framed-${named.id}-${NOW}`)
  })
})

// ── renderFramingBlock ───────────────────────────────────────────

describe('renderFramingBlock', () => {
  test('returns null for empty array', () => {
    assert.equal(renderFramingBlock([]), null)
  })

  test('renders a single framed candidate', () => {
    const framed: Framed = {
      id: 'framed-test-1',
      title: 'flyback sentinel',
      slug: 'flyback-sentinel',
      rationale: GOOD_RATIONALE,
      purposeTie: {
        thread: 'infrastructure',
        relationship: 'extends',
        description: 'SOMA hardware safety is the physical substrate.',
      },
      namedId: 'named-test-1',
      summary: 'Flyback diode protection.',
      candidateId: 'candidate-1',
      ache: 'stagnation',
      gradient: 4,
      framedAt: '2026-04-26T15:00:00.000Z',
    }
    const block = renderFramingBlock([framed])
    assert.ok(block)
    assert.ok(block.includes('## Framed candidates'))
    assert.ok(block.includes('**flyback sentinel**'))
    assert.ok(block.includes('(flyback-sentinel)'))
    assert.ok(block.includes('[4/5]'))
    assert.ok(block.includes('infrastructure'))
    assert.ok(block.includes('extends'))
    assert.ok(block.includes('⚪'))  // stagnation emoji
  })

  test('renders ache emojis correctly', () => {
    const base: Framed = {
      id: 'framed-1',
      title: 'test',
      slug: 'test',
      rationale: 'why',
      purposeTie: { thread: 't', relationship: 'extends', description: 'd' },
      namedId: 'n1',
      summary: 's',
      candidateId: 'c1',
      ache: 'ugliness',
      gradient: 3,
      framedAt: '2026-04-26T15:00:00.000Z',
    }
    assert.ok(renderFramingBlock([base])!.includes('🔴'))

    base.ache = 'injustice'
    assert.ok(renderFramingBlock([base])!.includes('🟡'))

    base.ache = 'stagnation'
    assert.ok(renderFramingBlock([base])!.includes('⚪'))
  })

  test('includes related missions when present', () => {
    const framed: Framed = {
      id: 'framed-test-1',
      title: 'test',
      slug: 'test',
      rationale: 'why',
      purposeTie: {
        thread: 'perception',
        relationship: 'deepens',
        description: 'connects to perception arc',
        relatedMissions: ['2026-04-26-noticing', '2026-04-26-naming'],
      },
      namedId: 'n1',
      summary: 's',
      candidateId: 'c1',
      ache: 'ugliness',
      gradient: 3,
      framedAt: '2026-04-26T15:00:00.000Z',
    }
    const block = renderFramingBlock([framed])
    assert.ok(block)
    assert.ok(block.includes('_refs:_'))
    assert.ok(block.includes('2026-04-26-noticing'))
    assert.ok(block.includes('2026-04-26-naming'))
  })

  test('omits refs line when no related missions', () => {
    const framed: Framed = {
      id: 'framed-test-1',
      title: 'test',
      slug: 'test',
      rationale: 'why',
      purposeTie: {
        thread: 'perception',
        relationship: 'deepens',
        description: 'connects to perception arc',
      },
      namedId: 'n1',
      summary: 's',
      candidateId: 'c1',
      ache: 'ugliness',
      gradient: 3,
      framedAt: '2026-04-26T15:00:00.000Z',
    }
    const block = renderFramingBlock([framed])
    assert.ok(block)
    assert.ok(!block.includes('_refs:_'))
  })

  test('renders multiple framed candidates', () => {
    const make = (title: string, slug: string, ache: 'ugliness' | 'injustice' | 'stagnation'): Framed => ({
      id: `framed-${slug}`,
      title,
      slug,
      rationale: 'why this matters',
      purposeTie: { thread: 'arc', relationship: 'extends', description: 'conn' },
      namedId: `named-${slug}`,
      summary: `summary for ${title}`,
      candidateId: `c-${slug}`,
      ache,
      gradient: 3,
      framedAt: '2026-04-26T15:00:00.000Z',
    })
    const block = renderFramingBlock([
      make('alpha', 'alpha', 'ugliness'),
      make('beta', 'beta', 'injustice'),
      make('gamma', 'gamma', 'stagnation'),
    ])
    assert.ok(block)
    assert.ok(block.includes('**alpha**'))
    assert.ok(block.includes('**beta**'))
    assert.ok(block.includes('**gamma**'))
  })

  test('truncates long rationale and description', () => {
    const framed: Framed = {
      id: 'framed-1',
      title: 'test',
      slug: 'test',
      rationale: 'a'.repeat(200),
      purposeTie: {
        thread: 't',
        relationship: 'extends',
        description: 'b'.repeat(200),
      },
      namedId: 'n1',
      summary: 's',
      candidateId: 'c1',
      ache: 'ugliness',
      gradient: 3,
      framedAt: '2026-04-26T15:00:00.000Z',
    }
    const block = renderFramingBlock([framed])
    assert.ok(block)
    // The render truncates rationale to 150 chars and description to 120 chars
    // Check that we see the truncation ellipsis
    assert.ok(block.includes('…'))
  })
})

// ── renderQualityFailures ────────────────────────────────────────

describe('renderQualityFailures', () => {
  test('renders a readable block', () => {
    const block = renderQualityFailures('flyback sentinel', [
      'rationale: too short',
      'thread: missing thread name',
    ])
    assert.ok(block.includes('Framing quality check failed'))
    assert.ok(block.includes('flyback sentinel'))
    assert.ok(block.includes('- rationale: too short'))
    assert.ok(block.includes('- thread: missing thread name'))
    assert.ok(block.includes('rationale should explain'))
  })
})

// ── Edge cases: all six relationship types ───────────────────────

describe('all relationship types accepted', () => {
  beforeEach(setup)
  afterEach(teardown)

  for (const rel of VALID_RELATIONSHIPS) {
    test(`accepts relationship: ${rel}`, () => {
      const named = makeNamed()
      const result = frameCandidate(
        named,
        GOOD_RATIONALE,
        makePurposeTie({ relationship: rel }),
        'test-project',
        { now: NOW },
      )
      assert.equal(result.ok, true)
      if (!result.ok) return
      assert.equal(result.framed.purposeTie.relationship, rel)
    })
  }
})

// ── Edge cases: mixed valid and invalid references ───────────────

describe('mixed reference validation', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('fails if any one reference is missing', () => {
    makeMission('test-project', {
      id: '2026-04-26-existing-mission',
      title: 'existing mission',
    })
    const named = makeNamed()
    const result = frameCandidate(
      named,
      GOOD_RATIONALE,
      makePurposeTie({
        relatedMissions: ['2026-04-26-existing-mission', '2026-04-26-ghost'],
      }),
      'test-project',
      { now: NOW },
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.ok(result.failures.some(f => f.includes('references')))
  })

  test('passes when all referenced missions exist', () => {
    makeMission('test-project', {
      id: '2026-04-26-mission-alpha',
      title: 'alpha',
    })
    makeMission('test-project', {
      id: '2026-04-26-mission-beta',
      title: 'beta',
    })
    const named = makeNamed()
    const result = frameCandidate(
      named,
      GOOD_RATIONALE,
      makePurposeTie({
        relatedMissions: ['2026-04-26-mission-alpha', '2026-04-26-mission-beta'],
      }),
      'test-project',
      { now: NOW },
    )
    assert.equal(result.ok, true)
  })

  test('accepts missions in any status', () => {
    makeMission('test-project', {
      id: '2026-04-26-done-mission',
      title: 'done mission',
      status: 'done',
    })
    makeMission('test-project', {
      id: '2026-04-26-cancelled-mission',
      title: 'cancelled mission',
      status: 'cancelled',
    })
    const named = makeNamed()
    const result = frameCandidate(
      named,
      GOOD_RATIONALE,
      makePurposeTie({
        relatedMissions: ['2026-04-26-done-mission', '2026-04-26-cancelled-mission'],
      }),
      'test-project',
      { now: NOW },
    )
    assert.equal(result.ok, true)
  })
})
