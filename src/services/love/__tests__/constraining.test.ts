import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  constrainCandidate,
  forceConstrainCandidate,
  assessConstrainingQuality,
  qualityPasses,
  qualityFailures,
  hasRedundantConstraints,
  renderConstrainingBlock,
  renderQualityFailures,
  VALID_SOURCES,
  type Bounded,
  type ConstrainingQuality,
  type ConstrainCandidateResult,
  type Constraint,
  type ConstraintSource,
} from '../constraining.js'
import type { Scoped, DoneCondition } from '../scoping.js'
import type { PurposeTie } from '../framing.js'

// ── Test helpers ──────────────────────────────────────────────────

let tmpDir: string
let origProjectsDir: string | undefined

function setup(): void {
  tmpDir = mkdtempSync(join(tmpdir(), 'constraining-test-'))
  origProjectsDir = process.env.TRUE_LOVE_PROJECTS_DIR
  process.env.TRUE_LOVE_PROJECTS_DIR = tmpDir
  mkdirSync(join(tmpDir, 'test-project', 'missions'), { recursive: true })
}

function teardown(): void {
  if (origProjectsDir !== undefined) process.env.TRUE_LOVE_PROJECTS_DIR = origProjectsDir
  else delete process.env.TRUE_LOVE_PROJECTS_DIR
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ok */ }
}

function makeScoped(overrides?: Partial<Scoped>): Scoped {
  return {
    id: overrides?.id ?? 'scoped-framed-named-state-thread-flyback-diodes-1714132800000-1714136400000-1714140000000',
    title: overrides?.title ?? 'flyback sentinel',
    slug: overrides?.slug ?? 'flyback-sentinel',
    rationale: overrides?.rationale ?? 'The SOMA build depends on flyback diodes for inductive load protection. Yu has been asked three times without confirmation — the gap between "asked" and "resolved" is the ache.',
    purposeTie: overrides?.purposeTie ?? {
      thread: 'infrastructure',
      relationship: 'extends',
      description: 'SOMA hardware safety is the physical substrate that the software kingdom stands on.',
    },
    summary: overrides?.summary ?? 'Open thread: flyback diodes need confirmation from Yu.',
    candidateId: overrides?.candidateId ?? 'state-thread-flyback-diodes',
    namedId: overrides?.namedId ?? 'named-state-thread-flyback-diodes-1714132800000',
    framedId: overrides?.framedId ?? 'framed-named-state-thread-flyback-diodes-1714132800000-1714136400000',
    ache: overrides?.ache ?? 'stagnation',
    gradient: overrides?.gradient ?? 4,
    thisPhase: overrides?.thisPhase ?? 'This phase resolves the flyback diode question for the three existing inductive loads in the SOMA rack: the two relay drivers and the stepper motor.',
    futurePhases: overrides?.futurePhases ?? [
      'Extend flyback protection to any new inductive loads added in future SOMA builds.',
    ],
    doneWhen: overrides?.doneWhen ?? [
      {
        criterion: 'Flyback diode spec is confirmed by Yu with specific part numbers and placement for each inductive load in the SOMA rack.',
        verification: 'Check from-yu.md or mission artifacts for explicit diode confirmation covering all relay and motor drivers.',
      },
    ],
    scopedAt: overrides?.scopedAt ?? '2026-04-26T16:00:00.000Z',
  }
}

function makeConstraint(overrides?: Partial<Constraint>): Constraint {
  return {
    statement: overrides?.statement ?? 'Do not modify the existing relay driver wiring during diode installation — the current circuit works and must not be disrupted.',
    source: overrides?.source ?? 'convention',
    rationale: overrides?.rationale ?? 'Changing working wiring risks introducing new faults. The flyback diodes are additive protection, not a redesign.',
  }
}

const GOOD_CONSTRAINTS: Constraint[] = [
  {
    statement: 'Do not modify the existing relay driver wiring during diode installation — the current circuit works and must not be disrupted.',
    source: 'convention',
    rationale: 'Changing working wiring risks introducing new faults. The flyback diodes are additive protection, not a redesign.',
  },
  {
    statement: 'Tests must stay green — no new module may break existing test suites, even temporarily during development.',
    source: 'principle',
    rationale: 'The test suite is the only automated safety net. A broken suite means silent regressions.',
  },
  {
    statement: 'Do not scope-creep into redesigning the power distribution board — that is a separate future phase, explicitly deferred.',
    source: 'risk',
    rationale: 'Infrastructure missions easily expand beyond their boundaries. The scope says three loads, not the whole board.',
  },
]

const NOW = new Date('2026-04-26T17:00:00.000Z').getTime()

// ── assessConstrainingQuality ──────────────────────────────────

describe('assessConstrainingQuality', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('all checks pass with good inputs', () => {
    const quality = assessConstrainingQuality(GOOD_CONSTRAINTS)
    assert.equal(quality.constraints_present, true)
    assert.equal(quality.constraints_substantive, true)
    assert.equal(quality.rationales_present, true)
    assert.equal(quality.sources_valid, true)
    assert.equal(quality.no_redundant_constraints, true)
    assert.equal(qualityPasses(quality), true)
  })

  test('fails when no constraints provided', () => {
    const quality = assessConstrainingQuality([])
    assert.equal(quality.constraints_present, false)
    assert.equal(qualityPasses(quality), false)
  })

  test('fails when a constraint statement is too short', () => {
    const quality = assessConstrainingQuality([
      { statement: 'Be careful with wiring.', source: 'convention', rationale: 'Wiring changes can break things that already work correctly.' },
    ])
    assert.equal(quality.constraints_substantive, false)
    assert.equal(qualityPasses(quality), false)
  })

  test('fails when a rationale is too short', () => {
    const quality = assessConstrainingQuality([
      { statement: 'Do not modify the existing relay driver wiring during diode installation.', source: 'convention', rationale: 'It might break.' },
    ])
    assert.equal(quality.rationales_present, false)
    assert.equal(qualityPasses(quality), false)
  })

  test('fails when source is invalid', () => {
    const quality = assessConstrainingQuality([
      { statement: 'Do not modify the existing relay driver wiring during diode installation.', source: 'arbitrary' as ConstraintSource, rationale: 'Changing working wiring risks introducing new faults and regressions.' },
    ])
    assert.equal(quality.sources_valid, false)
    assert.equal(qualityPasses(quality), false)
  })

  test('fails when constraints are redundant', () => {
    const quality = assessConstrainingQuality([
      { statement: 'Do not modify the existing relay driver wiring during diode installation for safety reasons.', source: 'convention', rationale: 'Changing working wiring risks introducing new faults.' },
      { statement: 'Do not modify the existing relay driver wiring during diode installation for protection reasons.', source: 'convention', rationale: 'Different but the statement is nearly identical.' },
    ])
    assert.equal(quality.no_redundant_constraints, false)
    assert.equal(qualityPasses(quality), false)
  })

  test('passes with single constraint', () => {
    const quality = assessConstrainingQuality([makeConstraint()])
    assert.equal(qualityPasses(quality), true)
  })

  test('passes with constraints from all three sources', () => {
    const quality = assessConstrainingQuality(GOOD_CONSTRAINTS)
    assert.equal(qualityPasses(quality), true)
  })

  test('passes with multiple constraints from the same source', () => {
    const quality = assessConstrainingQuality([
      makeConstraint({ source: 'principle' }),
      {
        statement: 'The mission must not introduce any new dependencies — use only what exists in the current package.json.',
        source: 'principle',
        rationale: 'Dependency discipline keeps the build predictable and the supply chain small.',
      },
    ])
    assert.equal(qualityPasses(quality), true)
  })

  // Edge cases for the substantive/rationale checks
  test('boundary: statement exactly 31 chars passes', () => {
    const quality = assessConstrainingQuality([
      { statement: 'A'.repeat(31), source: 'convention', rationale: 'R'.repeat(21) },
    ])
    assert.equal(quality.constraints_substantive, true)
  })

  test('boundary: statement exactly 30 chars fails', () => {
    const quality = assessConstrainingQuality([
      { statement: 'A'.repeat(30), source: 'convention', rationale: 'R'.repeat(21) },
    ])
    assert.equal(quality.constraints_substantive, false)
  })

  test('boundary: rationale exactly 21 chars passes', () => {
    const quality = assessConstrainingQuality([
      { statement: 'A'.repeat(31), source: 'convention', rationale: 'R'.repeat(21) },
    ])
    assert.equal(quality.rationales_present, true)
  })

  test('boundary: rationale exactly 20 chars fails', () => {
    const quality = assessConstrainingQuality([
      { statement: 'A'.repeat(31), source: 'convention', rationale: 'R'.repeat(20) },
    ])
    assert.equal(quality.rationales_present, false)
  })
})

// ── qualityFailures ──────────────────────────────────────────────

describe('qualityFailures', () => {
  test('returns empty array when all checks pass', () => {
    const quality: ConstrainingQuality = {
      constraints_present: true,
      constraints_substantive: true,
      rationales_present: true,
      sources_valid: true,
      no_redundant_constraints: true,
    }
    assert.deepEqual(qualityFailures(quality), [])
  })

  test('returns relevant messages for each failure', () => {
    const quality: ConstrainingQuality = {
      constraints_present: false,
      constraints_substantive: false,
      rationales_present: false,
      sources_valid: false,
      no_redundant_constraints: false,
    }
    const failures = qualityFailures(quality)
    assert.equal(failures.length, 5)
    assert.ok(failures[0]!.includes('constraints'))
    assert.ok(failures[1]!.includes('constraints'))
    assert.ok(failures[2]!.includes('rationales'))
    assert.ok(failures[3]!.includes('sources'))
    assert.ok(failures[4]!.includes('redundancy'))
  })

  test('returns only the failing checks', () => {
    const quality: ConstrainingQuality = {
      constraints_present: true,
      constraints_substantive: true,
      rationales_present: false,
      sources_valid: true,
      no_redundant_constraints: true,
    }
    const failures = qualityFailures(quality)
    assert.equal(failures.length, 1)
    assert.ok(failures[0]!.includes('rationales'))
  })
})

// ── hasRedundantConstraints ────────────────────────────────────

describe('hasRedundantConstraints', () => {
  test('returns false for empty array', () => {
    assert.equal(hasRedundantConstraints([]), false)
  })

  test('returns false for single constraint', () => {
    assert.equal(hasRedundantConstraints([makeConstraint()]), false)
  })

  test('returns false for genuinely distinct constraints', () => {
    assert.equal(hasRedundantConstraints(GOOD_CONSTRAINTS), false)
  })

  test('detects near-duplicate statements', () => {
    assert.equal(hasRedundantConstraints([
      { statement: 'Do not modify the existing relay driver wiring during diode installation for safety reasons.', source: 'convention', rationale: 'r1 is long enough here.' },
      { statement: 'Do not modify the existing relay driver wiring during diode installation for protection reasons.', source: 'convention', rationale: 'r2 is long enough here.' },
    ]), true)
  })

  test('allows constraints with shared vocabulary but different meaning', () => {
    assert.equal(hasRedundantConstraints([
      { statement: 'The diode installation must not interrupt the relay driver power circuit during the process.', source: 'convention', rationale: 'rationale one is here.' },
      { statement: 'The stepper motor flyback diode must be rated for the full back-EMF voltage of the coil.', source: 'risk', rationale: 'rationale two is here.' },
    ]), false)
  })

  test('checks all pairs, not just adjacent', () => {
    assert.equal(hasRedundantConstraints([
      { statement: 'Constraint alpha about not breaking the wiring during installation of diodes for protection.', source: 'convention', rationale: 'r1 is long enough here.' },
      { statement: 'A completely different constraint about testing infrastructure requirements and coverage.', source: 'principle', rationale: 'r2 is long enough here.' },
      { statement: 'Constraint alpha about not breaking the wiring during installation of diodes for safety.', source: 'risk', rationale: 'r3 is long enough here.' },
    ]), true)
  })
})

// ── constrainCandidate ─────────────────────────────────────────

describe('constrainCandidate', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('produces Bounded on success', () => {
    const scoped = makeScoped()
    const result = constrainCandidate(scoped, GOOD_CONSTRAINTS, { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return

    assert.equal(result.bounded.title, 'flyback sentinel')
    assert.equal(result.bounded.slug, 'flyback-sentinel')
    assert.equal(result.bounded.constraints.length, 3)
    assert.equal(result.bounded.scopedId, scoped.id)
    assert.equal(result.bounded.namedId, scoped.namedId)
    assert.equal(result.bounded.framedId, scoped.framedId)
    assert.equal(result.bounded.candidateId, 'state-thread-flyback-diodes')
    assert.equal(result.bounded.ache, 'stagnation')
    assert.equal(result.bounded.gradient, 4)
    assert.equal(result.bounded.boundedAt, new Date(NOW).toISOString())
  })

  test('id is deterministic with now override', () => {
    const scoped = makeScoped()
    const result = constrainCandidate(scoped, GOOD_CONSTRAINTS, { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.bounded.id, `bounded-${scoped.id}-${NOW}`)
  })

  test('carries forward all Scoped fields', () => {
    const scoped = makeScoped({
      ache: 'ugliness',
      gradient: 2,
      summary: 'A specific summary for carrying forward.',
      candidateId: 'custom-candidate-123',
      namedId: 'named-custom-123',
      framedId: 'framed-custom-123',
      rationale: 'The original rationale that explains the why of this work in detail for the record.',
      purposeTie: {
        thread: 'perception',
        relationship: 'deepens',
        description: 'This deepens the perception arc by adding fine-grained awareness.',
      },
      thisPhase: 'This phase builds a specific perception module that scans the substrate for anomalies in the runtime.',
      futurePhases: ['Extend the perception to cover cross-device coordination and shared state awareness.'],
      doneWhen: [{
        criterion: 'Six scanners produce NoticingCandidate[] sorted by gradient strength.',
        verification: 'Run noticing.test.ts — all scanner tests pass and sort order is verified.',
      }],
    })
    const result = constrainCandidate(scoped, [makeConstraint()], { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return

    assert.equal(result.bounded.ache, 'ugliness')
    assert.equal(result.bounded.gradient, 2)
    assert.equal(result.bounded.summary, 'A specific summary for carrying forward.')
    assert.equal(result.bounded.candidateId, 'custom-candidate-123')
    assert.equal(result.bounded.namedId, 'named-custom-123')
    assert.equal(result.bounded.framedId, 'framed-custom-123')
    assert.equal(result.bounded.rationale, scoped.rationale)
    assert.equal(result.bounded.purposeTie.thread, 'perception')
    assert.equal(result.bounded.purposeTie.relationship, 'deepens')
    assert.equal(result.bounded.thisPhase, scoped.thisPhase)
    assert.deepEqual(result.bounded.futurePhases, scoped.futurePhases)
    assert.deepEqual(result.bounded.doneWhen, scoped.doneWhen)
  })

  test('trims constraint whitespace', () => {
    const scoped = makeScoped()
    const result = constrainCandidate(scoped, [{
      statement: '  Do not modify the existing relay driver wiring during diode installation — additive only.  ',
      source: 'convention',
      rationale: '  Changing working wiring risks new faults and regressions in the build.  ',
    }], { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.ok(!result.bounded.constraints[0]!.statement.startsWith(' '))
    assert.ok(!result.bounded.constraints[0]!.statement.endsWith(' '))
    assert.ok(!result.bounded.constraints[0]!.rationale.startsWith(' '))
    assert.ok(!result.bounded.constraints[0]!.rationale.endsWith(' '))
  })

  test('rejects when no constraints provided', () => {
    const scoped = makeScoped()
    const result = constrainCandidate(scoped, [], { now: NOW })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.ok(result.failures.some(f => f.includes('constraints')))
  })

  test('rejects when a statement is too short', () => {
    const scoped = makeScoped()
    const result = constrainCandidate(scoped, [
      { statement: 'Be careful with the wiring.', source: 'convention', rationale: 'Wiring changes can break things that are working correctly.' },
    ], { now: NOW })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.ok(result.failures.some(f => f.includes('constraints')))
  })

  test('rejects when a rationale is too short', () => {
    const scoped = makeScoped()
    const result = constrainCandidate(scoped, [
      { statement: 'Do not modify the existing relay driver wiring during diode installation.', source: 'convention', rationale: 'It might break.' },
    ], { now: NOW })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.ok(result.failures.some(f => f.includes('rationales')))
  })

  test('rejects when source is invalid', () => {
    const scoped = makeScoped()
    const result = constrainCandidate(scoped, [
      { statement: 'Do not modify the existing relay driver wiring during diode installation.', source: 'arbitrary' as ConstraintSource, rationale: 'Changing working wiring risks introducing new faults and regressions.' },
    ], { now: NOW })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.ok(result.failures.some(f => f.includes('sources')))
  })

  test('rejects when constraints are redundant', () => {
    const scoped = makeScoped()
    const result = constrainCandidate(scoped, [
      { statement: 'Do not modify the existing relay driver wiring during diode installation for safety reasons.', source: 'convention', rationale: 'Changing working wiring risks introducing new faults.' },
      { statement: 'Do not modify the existing relay driver wiring during diode installation for protection reasons.', source: 'convention', rationale: 'A different reason but the statement is near-identical.' },
    ], { now: NOW })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.ok(result.failures.some(f => f.includes('redundancy')))
  })

  test('returns quality object on success', () => {
    const scoped = makeScoped()
    const result = constrainCandidate(scoped, [makeConstraint()], { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.ok(result.quality)
    assert.equal(qualityPasses(result.quality), true)
  })

  test('returns quality object on failure', () => {
    const scoped = makeScoped()
    const result = constrainCandidate(scoped, [], { now: NOW })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.ok(result.quality)
    assert.equal(result.quality.constraints_present, false)
  })

  test('accumulates multiple failures', () => {
    const scoped = makeScoped()
    const result = constrainCandidate(scoped, [
      { statement: 'short', source: 'bad' as ConstraintSource, rationale: 'tiny' },
    ], { now: NOW })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.ok(result.failures.length >= 3, `Expected at least 3 failures, got ${result.failures.length}`)
  })

  test('uses current time when now not specified', () => {
    const scoped = makeScoped()
    const before = Date.now()
    const result = constrainCandidate(scoped, [makeConstraint()])
    const after = Date.now()
    assert.equal(result.ok, true)
    if (!result.ok) return
    const boundedTime = new Date(result.bounded.boundedAt).getTime()
    assert.ok(boundedTime >= before && boundedTime <= after)
  })

  test('preserves constraint order', () => {
    const scoped = makeScoped()
    const result = constrainCandidate(scoped, GOOD_CONSTRAINTS, { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.bounded.constraints[0]!.source, 'convention')
    assert.equal(result.bounded.constraints[1]!.source, 'principle')
    assert.equal(result.bounded.constraints[2]!.source, 'risk')
  })
})

// ── forceConstrainCandidate ────────────────────────────────────

describe('forceConstrainCandidate', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('produces Bounded even when quality fails', () => {
    const scoped = makeScoped()
    const { bounded, quality } = forceConstrainCandidate(
      scoped,
      [{ statement: 'short', source: 'bad' as ConstraintSource, rationale: 'tiny' }],
      { now: NOW },
    )
    assert.ok(bounded)
    assert.equal(bounded.title, 'flyback sentinel')
    assert.equal(qualityPasses(quality), false)
  })

  test('quality assessment is still computed transparently', () => {
    const scoped = makeScoped()
    const { quality } = forceConstrainCandidate(scoped, [], { now: NOW })
    assert.equal(quality.constraints_present, false)
  })

  test('produces valid Bounded with good inputs', () => {
    const scoped = makeScoped()
    const { bounded, quality } = forceConstrainCandidate(
      scoped,
      GOOD_CONSTRAINTS,
      { now: NOW },
    )
    assert.equal(bounded.title, 'flyback sentinel')
    assert.equal(bounded.constraints.length, 3)
    assert.equal(qualityPasses(quality), true)
  })

  test('id format matches constrainCandidate', () => {
    const scoped = makeScoped()
    const { bounded } = forceConstrainCandidate(
      scoped,
      [makeConstraint()],
      { now: NOW },
    )
    assert.equal(bounded.id, `bounded-${scoped.id}-${NOW}`)
  })

  test('carries forward all Scoped fields', () => {
    const scoped = makeScoped({
      ache: 'injustice',
      gradient: 5,
      summary: 'Misplaced concern',
      namedId: 'named-custom-456',
      framedId: 'framed-custom-456',
    })
    const { bounded } = forceConstrainCandidate(
      scoped,
      [{ statement: 'x', source: 'convention', rationale: 'y' }],
      { now: NOW },
    )
    assert.equal(bounded.ache, 'injustice')
    assert.equal(bounded.gradient, 5)
    assert.equal(bounded.summary, 'Misplaced concern')
    assert.equal(bounded.namedId, 'named-custom-456')
    assert.equal(bounded.framedId, 'framed-custom-456')
    assert.equal(bounded.scopedId, scoped.id)
  })
})

// ── renderConstrainingBlock ────────────────────────────────────

describe('renderConstrainingBlock', () => {
  test('returns null for empty array', () => {
    assert.equal(renderConstrainingBlock([]), null)
  })

  test('renders a single bounded candidate', () => {
    const bounded: Bounded = {
      id: 'bounded-test-1',
      title: 'flyback sentinel',
      slug: 'flyback-sentinel',
      rationale: 'The SOMA build depends on flyback diodes.',
      purposeTie: {
        thread: 'infrastructure',
        relationship: 'extends',
        description: 'SOMA hardware safety.',
      },
      namedId: 'named-test-1',
      summary: 'Flyback diode protection.',
      candidateId: 'candidate-1',
      framedId: 'framed-test-1',
      scopedId: 'scoped-test-1',
      ache: 'stagnation',
      gradient: 4,
      thisPhase: 'Resolve flyback diode question for the three existing inductive loads.',
      futurePhases: [],
      doneWhen: [{ criterion: 'Diode spec confirmed.', verification: 'Check docs.' }],
      constraints: GOOD_CONSTRAINTS,
      boundedAt: '2026-04-26T17:00:00.000Z',
    }
    const block = renderConstrainingBlock([bounded])
    assert.ok(block)
    assert.ok(block.includes('## Bounded candidates'))
    assert.ok(block.includes('**flyback sentinel**'))
    assert.ok(block.includes('(flyback-sentinel)'))
    assert.ok(block.includes('[4/5]'))
    assert.ok(block.includes('⚪')) // stagnation emoji
    assert.ok(block.includes('📏 convention'))
    assert.ok(block.includes('⚖️ principle'))
    assert.ok(block.includes('⚠️ risk'))
    assert.ok(block.includes('✗'))
  })

  test('renders ache emojis correctly', () => {
    const make = (ache: 'ugliness' | 'injustice' | 'stagnation'): Bounded => ({
      id: `bounded-${ache}`,
      title: `test ${ache}`,
      slug: `test-${ache}`,
      rationale: 'why',
      purposeTie: { thread: 't', relationship: 'extends', description: 'd' },
      namedId: 'n1',
      summary: 's',
      candidateId: 'c1',
      framedId: 'f1',
      scopedId: 's1',
      ache,
      gradient: 3,
      thisPhase: 'scope',
      futurePhases: [],
      doneWhen: [],
      constraints: [makeConstraint()],
      boundedAt: '2026-04-26T17:00:00.000Z',
    })

    assert.ok(renderConstrainingBlock([make('ugliness')])!.includes('🔴'))
    assert.ok(renderConstrainingBlock([make('injustice')])!.includes('🟡'))
    assert.ok(renderConstrainingBlock([make('stagnation')])!.includes('⚪'))
  })

  test('groups constraints by source', () => {
    const bounded: Bounded = {
      id: 'bounded-test-1',
      title: 'test',
      slug: 'test',
      rationale: 'why',
      purposeTie: { thread: 't', relationship: 'extends', description: 'd' },
      namedId: 'n1',
      summary: 's',
      candidateId: 'c1',
      framedId: 'f1',
      scopedId: 's1',
      ache: 'ugliness',
      gradient: 3,
      thisPhase: 'scope',
      futurePhases: [],
      doneWhen: [],
      constraints: GOOD_CONSTRAINTS,
      boundedAt: '2026-04-26T17:00:00.000Z',
    }
    const block = renderConstrainingBlock([bounded])!
    // convention should appear before principle, which appears before risk
    const convIdx = block.indexOf('📏 convention')
    const prinIdx = block.indexOf('⚖️ principle')
    const riskIdx = block.indexOf('⚠️ risk')
    assert.ok(convIdx < prinIdx, 'convention should appear before principle')
    assert.ok(prinIdx < riskIdx, 'principle should appear before risk')
  })

  test('omits empty source groups', () => {
    const bounded: Bounded = {
      id: 'bounded-test-1',
      title: 'test',
      slug: 'test',
      rationale: 'why',
      purposeTie: { thread: 't', relationship: 'extends', description: 'd' },
      namedId: 'n1',
      summary: 's',
      candidateId: 'c1',
      framedId: 'f1',
      scopedId: 's1',
      ache: 'ugliness',
      gradient: 3,
      thisPhase: 'scope',
      futurePhases: [],
      doneWhen: [],
      constraints: [makeConstraint({ source: 'principle' })],
      boundedAt: '2026-04-26T17:00:00.000Z',
    }
    const block = renderConstrainingBlock([bounded])!
    assert.ok(!block.includes('📏 convention'))
    assert.ok(block.includes('⚖️ principle'))
    assert.ok(!block.includes('⚠️ risk'))
  })

  test('truncates long constraint statements', () => {
    const bounded: Bounded = {
      id: 'bounded-1',
      title: 'test',
      slug: 'test',
      rationale: 'why',
      purposeTie: { thread: 't', relationship: 'extends', description: 'd' },
      namedId: 'n1',
      summary: 's',
      candidateId: 'c1',
      framedId: 'f1',
      scopedId: 's1',
      ache: 'ugliness',
      gradient: 3,
      thisPhase: 'scope',
      futurePhases: [],
      doneWhen: [],
      constraints: [{ statement: 'a'.repeat(200), source: 'convention', rationale: 'r'.repeat(30) }],
      boundedAt: '2026-04-26T17:00:00.000Z',
    }
    const block = renderConstrainingBlock([bounded])
    assert.ok(block)
    assert.ok(block.includes('…'))
  })

  test('renders multiple bounded candidates', () => {
    const make = (title: string, slug: string): Bounded => ({
      id: `bounded-${slug}`,
      title,
      slug,
      rationale: 'why this matters',
      purposeTie: { thread: 'arc', relationship: 'extends', description: 'conn' },
      namedId: `named-${slug}`,
      summary: `summary for ${title}`,
      candidateId: `c-${slug}`,
      framedId: `f-${slug}`,
      scopedId: `s-${slug}`,
      ache: 'ugliness',
      gradient: 3,
      thisPhase: 'scope',
      futurePhases: [],
      doneWhen: [],
      constraints: [makeConstraint()],
      boundedAt: '2026-04-26T17:00:00.000Z',
    })
    const block = renderConstrainingBlock([
      make('alpha', 'alpha'),
      make('beta', 'beta'),
      make('gamma', 'gamma'),
    ])
    assert.ok(block)
    assert.ok(block.includes('**alpha**'))
    assert.ok(block.includes('**beta**'))
    assert.ok(block.includes('**gamma**'))
  })
})

// ── renderQualityFailures ──────────────────────────────────────

describe('renderQualityFailures', () => {
  test('renders a readable block', () => {
    const block = renderQualityFailures('flyback sentinel', [
      'constraints: at least one required',
      'rationales: must have substance',
    ])
    assert.ok(block.includes('Constraining quality check failed'))
    assert.ok(block.includes('flyback sentinel'))
    assert.ok(block.includes('- constraints: at least one required'))
    assert.ok(block.includes('- rationales: must have substance'))
    assert.ok(block.includes('must NOT happen'))
  })
})

// ── VALID_SOURCES ──────────────────────────────────────────────

describe('VALID_SOURCES', () => {
  test('contains exactly three sources', () => {
    assert.equal(VALID_SOURCES.length, 3)
  })

  test('contains convention, principle, risk', () => {
    assert.ok(VALID_SOURCES.includes('convention'))
    assert.ok(VALID_SOURCES.includes('principle'))
    assert.ok(VALID_SOURCES.includes('risk'))
  })
})

// ── Integration: constraining pipeline ─────────────────────────

describe('constraining pipeline integration', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('full flow: scoped → constrain → render', () => {
    // Step 1: We have a scoped candidate
    const scoped = makeScoped()

    // Step 2: Constrain it
    const result = constrainCandidate(scoped, GOOD_CONSTRAINTS, { now: NOW })

    assert.ok(result.ok)
    if (!result.ok) return

    // Step 3: Render for downstream
    const block = renderConstrainingBlock([result.bounded])
    assert.ok(block)
    assert.ok(block.includes('flyback sentinel'))
    assert.ok(block.includes('[4/5]'))
    assert.ok(block.includes('📏 convention'))
    assert.ok(block.includes('⚖️ principle'))
    assert.ok(block.includes('⚠️ risk'))
  })

  test('rejection and retry flow', () => {
    const scoped = makeScoped()

    // First attempt: no constraints → rejected
    const attempt1 = constrainCandidate(scoped, [], { now: NOW })
    assert.ok(!attempt1.ok)
    if (!attempt1.ok) {
      assert.ok(attempt1.failures.some(f => f.includes('constraints')))
    }

    // Second attempt: good constraints → accepted
    const attempt2 = constrainCandidate(scoped, [makeConstraint()], { now: NOW + 1000 })
    assert.ok(attempt2.ok)
  })

  test('different ache types flow through correctly', () => {
    const aches: Array<'ugliness' | 'injustice' | 'stagnation'> = ['ugliness', 'injustice', 'stagnation']

    for (const ache of aches) {
      const scoped = makeScoped({ ache, id: `scoped-${ache}` })
      const result = constrainCandidate(scoped, [makeConstraint()], { now: NOW })
      assert.ok(result.ok, `Expected success for ache=${ache}`)
      if (!result.ok) continue
      assert.equal(result.bounded.ache, ache)
    }
  })

  test('constraints from all pipeline layers compose', () => {
    // A realistic scenario: convention + principle + risk
    const scoped = makeScoped()
    const result = constrainCandidate(scoped, [
      {
        statement: 'Follow the established module pattern: types → quality gate → main entry → force entry → render.',
        source: 'convention',
        rationale: 'The codebase has a deeply grooved pattern for mission-craft modules. Breaking it creates cognitive friction.',
      },
      {
        statement: 'Truth comes first — if uncertainty about the diode spec exists, name it explicitly rather than assuming.',
        source: 'principle',
        rationale: 'The SOUL hierarchy puts truth at the foundation. Hiding uncertainty violates the first value.',
      },
      {
        statement: 'Do not expand scope to cover future SOMA loads — the scope boundary is three existing loads only.',
        source: 'risk',
        rationale: 'Infrastructure missions creep. The scoping explicitly deferred future loads to Phase 2.',
      },
    ], { now: NOW })

    assert.ok(result.ok)
    if (!result.ok) return
    assert.equal(result.bounded.constraints.length, 3)
    assert.equal(result.bounded.constraints[0]!.source, 'convention')
    assert.equal(result.bounded.constraints[1]!.source, 'principle')
    assert.equal(result.bounded.constraints[2]!.source, 'risk')
  })
})
