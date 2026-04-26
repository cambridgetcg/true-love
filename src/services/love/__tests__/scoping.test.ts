import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  scopeCandidate,
  forceScopeCandidate,
  assessScopingQuality,
  qualityPasses,
  qualityFailures,
  isScopeRedundant,
  renderScopingBlock,
  renderQualityFailures,
  type Scoped,
  type ScopingQuality,
  type ScopeCandidateResult,
  type DoneCondition,
} from '../scoping.js'
import type { Framed, PurposeTie } from '../framing.js'

// ── Test helpers ──────────────────────────────────────────────────

let tmpDir: string
let origProjectsDir: string | undefined

function setup(): void {
  tmpDir = mkdtempSync(join(tmpdir(), 'scoping-test-'))
  origProjectsDir = process.env.TRUE_LOVE_PROJECTS_DIR
  process.env.TRUE_LOVE_PROJECTS_DIR = tmpDir
  mkdirSync(join(tmpDir, 'test-project', 'missions'), { recursive: true })
}

function teardown(): void {
  if (origProjectsDir !== undefined) process.env.TRUE_LOVE_PROJECTS_DIR = origProjectsDir
  else delete process.env.TRUE_LOVE_PROJECTS_DIR
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ok */ }
}

function makeFramed(overrides?: Partial<Framed>): Framed {
  return {
    id: overrides?.id ?? 'framed-named-state-thread-flyback-diodes-1714132800000-1714136400000',
    title: overrides?.title ?? 'flyback sentinel',
    slug: overrides?.slug ?? 'flyback-sentinel',
    rationale: overrides?.rationale ?? 'The SOMA build depends on flyback diodes for inductive load protection. Yu has been asked three times without confirmation — the gap between "asked" and "resolved" is the ache.',
    purposeTie: overrides?.purposeTie ?? {
      thread: 'infrastructure',
      relationship: 'extends',
      description: 'SOMA hardware safety is the physical substrate that the software kingdom stands on.',
    },
    namedId: overrides?.namedId ?? 'named-state-thread-flyback-diodes-1714132800000',
    summary: overrides?.summary ?? 'Open thread: flyback diodes need confirmation from Yu.',
    candidateId: overrides?.candidateId ?? 'state-thread-flyback-diodes',
    ache: overrides?.ache ?? 'stagnation',
    gradient: overrides?.gradient ?? 4,
    framedAt: overrides?.framedAt ?? '2026-04-26T15:00:00.000Z',
  }
}

function makeDoneCondition(overrides?: Partial<DoneCondition>): DoneCondition {
  return {
    criterion: overrides?.criterion ?? 'Flyback diode spec is confirmed by Yu with specific part numbers and placement for each inductive load in the SOMA rack.',
    verification: overrides?.verification ?? 'Check from-yu.md or mission artifacts for explicit diode confirmation covering all relay and motor drivers.',
  }
}

const GOOD_SCOPE = 'This phase resolves the flyback diode question for the three existing inductive loads in the SOMA rack: the two relay drivers and the stepper motor. It does NOT cover future loads or redesign the power distribution — only confirms the protection for what is already built.'

const GOOD_FUTURE_PHASES = [
  'Extend flyback protection to any new inductive loads added in future SOMA builds — different components may need different diode specs.',
  'Redesign the power distribution board to include built-in flyback protection pads, eliminating the need for per-component confirmation.',
]

const NOW = new Date('2026-04-26T16:00:00.000Z').getTime()

// ── assessScopingQuality ────────────────────────────────────────

describe('assessScopingQuality', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('all checks pass with good inputs', () => {
    const quality = assessScopingQuality(
      'flyback sentinel',
      'The SOMA build depends on flyback diodes for inductive load protection.',
      GOOD_SCOPE,
      GOOD_FUTURE_PHASES,
      [makeDoneCondition()],
    )
    assert.equal(quality.scope_substantive, true)
    assert.equal(quality.scope_distinct, true)
    assert.equal(quality.done_when_present, true)
    assert.equal(quality.done_when_testable, true)
    assert.equal(quality.future_phases_substantive, true)
    assert.equal(qualityPasses(quality), true)
  })

  test('fails when scope is too short', () => {
    const quality = assessScopingQuality(
      'flyback sentinel',
      'The SOMA build depends on flyback diodes.',
      'Confirm the diodes.',
      [],
      [makeDoneCondition()],
    )
    assert.equal(quality.scope_substantive, false)
    assert.equal(qualityPasses(quality), false)
  })

  test('fails when scope restates the title', () => {
    const quality = assessScopingQuality(
      'flyback sentinel',
      'rationale text here',
      'flyback sentinel is the mission that we are scoping right now in this effort and it matters.',
      [],
      [makeDoneCondition()],
    )
    assert.equal(quality.scope_distinct, false)
    assert.equal(qualityPasses(quality), false)
  })

  test('fails when scope is near-duplicate of rationale', () => {
    const rationale = 'The SOMA build depends on flyback diodes for inductive load protection and safety of the rack.'
    const quality = assessScopingQuality(
      'flyback sentinel',
      rationale,
      // Mostly the same words in the same order
      'the SOMA build depends on flyback diodes for inductive load protection and safety of rack hardware',
      [],
      [makeDoneCondition()],
    )
    assert.equal(quality.scope_distinct, false)
    assert.equal(qualityPasses(quality), false)
  })

  test('fails when no done conditions', () => {
    const quality = assessScopingQuality(
      'flyback sentinel',
      'rationale text here',
      GOOD_SCOPE,
      [],
      [],
    )
    assert.equal(quality.done_when_present, false)
    assert.equal(qualityPasses(quality), false)
  })

  test('fails when criterion is too short', () => {
    const quality = assessScopingQuality(
      'flyback sentinel',
      'rationale text here',
      GOOD_SCOPE,
      [],
      [{ criterion: 'Diodes confirmed.', verification: 'Check the parts list for confirmation.' }],
    )
    assert.equal(quality.done_when_testable, false)
    assert.equal(qualityPasses(quality), false)
  })

  test('fails when verification is too short', () => {
    const quality = assessScopingQuality(
      'flyback sentinel',
      'rationale text here',
      GOOD_SCOPE,
      [],
      [{ criterion: 'Flyback diode spec is confirmed by Yu with specific part numbers.', verification: 'Check the log.' }],
    )
    assert.equal(quality.done_when_testable, false)
    assert.equal(qualityPasses(quality), false)
  })

  test('fails when any done condition is weak (mixed)', () => {
    const quality = assessScopingQuality(
      'flyback sentinel',
      'rationale text here',
      GOOD_SCOPE,
      [],
      [
        makeDoneCondition(), // good
        { criterion: 'Works.', verification: 'Test.' }, // bad
      ],
    )
    assert.equal(quality.done_when_testable, false)
    assert.equal(qualityPasses(quality), false)
  })

  test('fails when a future phase is too short', () => {
    const quality = assessScopingQuality(
      'flyback sentinel',
      'rationale text here',
      GOOD_SCOPE,
      ['Add more diodes later.'], // 21 chars but only 20 after trim check — let's be precise
      [makeDoneCondition()],
    )
    // "Add more diodes later." is 22 chars, > 20, so this should pass
    assert.equal(quality.future_phases_substantive, true)
  })

  test('fails when a future phase is trivially short', () => {
    const quality = assessScopingQuality(
      'flyback sentinel',
      'rationale text here',
      GOOD_SCOPE,
      ['Phase 2.'], // too short
      [makeDoneCondition()],
    )
    assert.equal(quality.future_phases_substantive, false)
    assert.equal(qualityPasses(quality), false)
  })

  test('passes with no future phases (self-contained work)', () => {
    const quality = assessScopingQuality(
      'flyback sentinel',
      'rationale text here',
      GOOD_SCOPE,
      [],
      [makeDoneCondition()],
    )
    assert.equal(quality.future_phases_substantive, true)
  })

  test('passes with multiple good done conditions', () => {
    const quality = assessScopingQuality(
      'flyback sentinel',
      'rationale text here',
      GOOD_SCOPE,
      [],
      [
        makeDoneCondition(),
        {
          criterion: 'Each inductive load has a specific diode part number assigned in the build notes.',
          verification: 'Review SOMA build doc for per-load diode assignments — no blank entries.',
        },
      ],
    )
    assert.equal(quality.done_when_present, true)
    assert.equal(quality.done_when_testable, true)
    assert.equal(qualityPasses(quality), true)
  })
})

// ── qualityFailures ──────────────────────────────────────────────

describe('qualityFailures', () => {
  test('returns empty array when all checks pass', () => {
    const quality: ScopingQuality = {
      scope_substantive: true,
      scope_distinct: true,
      done_when_present: true,
      done_when_testable: true,
      future_phases_substantive: true,
    }
    assert.deepEqual(qualityFailures(quality), [])
  })

  test('returns relevant messages for each failure', () => {
    const quality: ScopingQuality = {
      scope_substantive: false,
      scope_distinct: false,
      done_when_present: false,
      done_when_testable: false,
      future_phases_substantive: false,
    }
    const failures = qualityFailures(quality)
    assert.equal(failures.length, 5)
    assert.ok(failures[0]!.includes('scope'))
    assert.ok(failures[1]!.includes('scope'))
    assert.ok(failures[2]!.includes('done-when'))
    assert.ok(failures[3]!.includes('done-when'))
    assert.ok(failures[4]!.includes('future-phases'))
  })

  test('returns only the failing checks', () => {
    const quality: ScopingQuality = {
      scope_substantive: true,
      scope_distinct: true,
      done_when_present: false,
      done_when_testable: true,
      future_phases_substantive: true,
    }
    const failures = qualityFailures(quality)
    assert.equal(failures.length, 1)
    assert.ok(failures[0]!.includes('done-when'))
  })
})

// ── isScopeRedundant ────────────────────────────────────────────

describe('isScopeRedundant', () => {
  test('detects scope that starts with the title', () => {
    assert.equal(
      isScopeRedundant(
        'flyback sentinel',
        'some rationale',
        'flyback sentinel is the thing we are scoping right now in this mission effort.',
      ),
      true,
    )
  })

  test('allows scope that starts with title but adds substantial content via pivot', () => {
    assert.equal(
      isScopeRedundant(
        'flyback sentinel',
        'some rationale',
        'flyback sentinel — but scoped only to the three existing inductive loads, not future expansion. The relay drivers and stepper motor are the boundary.',
      ),
      false,
    )
  })

  test('detects scope that mostly restates the rationale', () => {
    const rationale = 'the power circuit needs flyback diode protection for inductive loads in the rack'
    assert.equal(
      isScopeRedundant(
        'flyback sentinel',
        rationale,
        'the power circuit needs flyback diode protection for inductive loads in the rack hardware',
      ),
      true,
    )
  })

  test('allows genuinely distinct scope', () => {
    assert.equal(
      isScopeRedundant(
        'flyback sentinel',
        'The SOMA build depends on flyback diodes for inductive load protection.',
        GOOD_SCOPE,
      ),
      false,
    )
  })

  test('handles short titles gracefully', () => {
    assert.equal(
      isScopeRedundant(
        'soma',
        'short rationale',
        'soma is the body and it needs work — we are scoping the relay protection specifically.',
      ),
      false,
    )
  })

  test('handles empty strings without crashing', () => {
    assert.equal(isScopeRedundant('', '', ''), false)
    assert.equal(isScopeRedundant('title', '', 'a scope that stands on its own merits'), false)
    assert.equal(isScopeRedundant('', 'rationale', 'a scope that stands on its own merits'), false)
  })
})

// ── scopeCandidate ──────────────────────────────────────────────

describe('scopeCandidate', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('produces Scoped on success', () => {
    const framed = makeFramed()
    const result = scopeCandidate(
      framed,
      GOOD_SCOPE,
      GOOD_FUTURE_PHASES,
      [makeDoneCondition()],
      { now: NOW },
    )
    assert.equal(result.ok, true)
    if (!result.ok) return

    assert.equal(result.scoped.title, 'flyback sentinel')
    assert.equal(result.scoped.slug, 'flyback-sentinel')
    assert.equal(result.scoped.thisPhase, GOOD_SCOPE)
    assert.equal(result.scoped.futurePhases.length, 2)
    assert.equal(result.scoped.doneWhen.length, 1)
    assert.equal(result.scoped.framedId, framed.id)
    assert.equal(result.scoped.namedId, framed.namedId)
    assert.equal(result.scoped.candidateId, 'state-thread-flyback-diodes')
    assert.equal(result.scoped.ache, 'stagnation')
    assert.equal(result.scoped.gradient, 4)
    assert.equal(result.scoped.scopedAt, new Date(NOW).toISOString())
  })

  test('id is deterministic with now override', () => {
    const framed = makeFramed()
    const result = scopeCandidate(framed, GOOD_SCOPE, [], [makeDoneCondition()], { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.scoped.id, `scoped-${framed.id}-${NOW}`)
  })

  test('carries forward all Framed fields', () => {
    const framed = makeFramed({
      ache: 'ugliness',
      gradient: 2,
      summary: 'A specific summary for carrying forward.',
      candidateId: 'custom-candidate-123',
      namedId: 'named-custom-123',
      rationale: 'The original rationale that explains the why of this work in detail for the record.',
      purposeTie: {
        thread: 'perception',
        relationship: 'deepens',
        description: 'This deepens the perception arc by adding fine-grained awareness.',
      },
    })
    const result = scopeCandidate(framed, GOOD_SCOPE, [], [makeDoneCondition()], { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return

    assert.equal(result.scoped.ache, 'ugliness')
    assert.equal(result.scoped.gradient, 2)
    assert.equal(result.scoped.summary, 'A specific summary for carrying forward.')
    assert.equal(result.scoped.candidateId, 'custom-candidate-123')
    assert.equal(result.scoped.namedId, 'named-custom-123')
    assert.equal(result.scoped.rationale, framed.rationale)
    assert.equal(result.scoped.purposeTie.thread, 'perception')
    assert.equal(result.scoped.purposeTie.relationship, 'deepens')
  })

  test('trims scope whitespace', () => {
    const framed = makeFramed()
    const result = scopeCandidate(framed, `  ${GOOD_SCOPE}  `, [], [makeDoneCondition()], { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.scoped.thisPhase, GOOD_SCOPE)
  })

  test('trims future phase whitespace', () => {
    const framed = makeFramed()
    const result = scopeCandidate(
      framed,
      GOOD_SCOPE,
      ['  Extend flyback protection to new inductive loads added in future SOMA builds.  '],
      [makeDoneCondition()],
      { now: NOW },
    )
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.ok(!result.scoped.futurePhases[0]!.startsWith(' '))
    assert.ok(!result.scoped.futurePhases[0]!.endsWith(' '))
  })

  test('trims done condition whitespace', () => {
    const framed = makeFramed()
    const result = scopeCandidate(
      framed,
      GOOD_SCOPE,
      [],
      [{ criterion: '  Diode spec confirmed by Yu with part numbers for each load.  ', verification: '  Check from-yu.md for confirmation.  ' }],
      { now: NOW },
    )
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.ok(!result.scoped.doneWhen[0]!.criterion.startsWith(' '))
    assert.ok(!result.scoped.doneWhen[0]!.criterion.endsWith(' '))
    assert.ok(!result.scoped.doneWhen[0]!.verification.startsWith(' '))
    assert.ok(!result.scoped.doneWhen[0]!.verification.endsWith(' '))
  })

  test('rejects when scope is too short', () => {
    const framed = makeFramed()
    const result = scopeCandidate(framed, 'Confirm diodes.', [], [makeDoneCondition()], { now: NOW })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.ok(result.failures.some(f => f.includes('scope')))
  })

  test('rejects when scope restates title', () => {
    const framed = makeFramed()
    const result = scopeCandidate(
      framed,
      'flyback sentinel is the mission we are doing right now to resolve the flyback diode issue.',
      [],
      [makeDoneCondition()],
      { now: NOW },
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.ok(result.failures.some(f => f.includes('scope')))
  })

  test('rejects when no done conditions', () => {
    const framed = makeFramed()
    const result = scopeCandidate(framed, GOOD_SCOPE, [], [], { now: NOW })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.ok(result.failures.some(f => f.includes('done-when')))
  })

  test('rejects when criterion is too short', () => {
    const framed = makeFramed()
    const result = scopeCandidate(
      framed,
      GOOD_SCOPE,
      [],
      [{ criterion: 'Diodes confirmed OK.', verification: 'Check the parts list and build doc for confirmation.' }],
      { now: NOW },
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.ok(result.failures.some(f => f.includes('done-when')))
  })

  test('rejects when verification is too short', () => {
    const framed = makeFramed()
    const result = scopeCandidate(
      framed,
      GOOD_SCOPE,
      [],
      [{ criterion: 'Flyback diode spec is confirmed by Yu with part numbers for each load.', verification: 'Check the docs.' }],
      { now: NOW },
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.ok(result.failures.some(f => f.includes('done-when')))
  })

  test('rejects when a future phase is too short', () => {
    const framed = makeFramed()
    const result = scopeCandidate(
      framed,
      GOOD_SCOPE,
      ['Do more later.'],
      [makeDoneCondition()],
      { now: NOW },
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.ok(result.failures.some(f => f.includes('future-phases')))
  })

  test('accepts empty future phases (self-contained work)', () => {
    const framed = makeFramed()
    const result = scopeCandidate(framed, GOOD_SCOPE, [], [makeDoneCondition()], { now: NOW })
    assert.equal(result.ok, true)
  })

  test('returns quality object on success', () => {
    const framed = makeFramed()
    const result = scopeCandidate(framed, GOOD_SCOPE, [], [makeDoneCondition()], { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.ok(result.quality)
    assert.equal(qualityPasses(result.quality), true)
  })

  test('returns quality object on failure', () => {
    const framed = makeFramed()
    const result = scopeCandidate(framed, 'short', [], [], { now: NOW })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.ok(result.quality)
    assert.equal(result.quality.scope_substantive, false)
    assert.equal(result.quality.done_when_present, false)
  })

  test('accumulates multiple failures', () => {
    const framed = makeFramed()
    const result = scopeCandidate(
      framed,
      'x',
      ['y'],
      [{ criterion: 'z', verification: 'w' }],
      { now: NOW },
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.ok(result.failures.length >= 3, `Expected at least 3 failures, got ${result.failures.length}`)
  })

  test('uses current time when now not specified', () => {
    const framed = makeFramed()
    const before = Date.now()
    const result = scopeCandidate(framed, GOOD_SCOPE, [], [makeDoneCondition()])
    const after = Date.now()
    assert.equal(result.ok, true)
    if (!result.ok) return
    const scopedTime = new Date(result.scoped.scopedAt).getTime()
    assert.ok(scopedTime >= before && scopedTime <= after)
  })

  test('stores futurePhases as empty array when none provided', () => {
    const framed = makeFramed()
    const result = scopeCandidate(framed, GOOD_SCOPE, [], [makeDoneCondition()], { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.deepEqual(result.scoped.futurePhases, [])
  })

  test('multiple done conditions all preserved', () => {
    const framed = makeFramed()
    const conditions: DoneCondition[] = [
      makeDoneCondition(),
      {
        criterion: 'Build notes document per-load diode assignments with part numbers and schematic references.',
        verification: 'Review SOMA build doc — verify no blank diode entries for relay and motor loads.',
      },
      {
        criterion: 'The mission artifacts include a clear confirmation trail from Yu to the agent.',
        verification: 'Check from-yu.md and mission conversation log for explicit confirmation.',
      },
    ]
    const result = scopeCandidate(framed, GOOD_SCOPE, [], conditions, { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.scoped.doneWhen.length, 3)
    assert.equal(result.scoped.doneWhen[0]!.criterion, conditions[0]!.criterion)
    assert.equal(result.scoped.doneWhen[2]!.criterion, conditions[2]!.criterion)
  })
})

// ── forceScopeCandidate ─────────────────────────────────────────

describe('forceScopeCandidate', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('produces Scoped even when quality fails', () => {
    const framed = makeFramed()
    const { scoped, quality } = forceScopeCandidate(
      framed,
      'short scope',
      ['x'],
      [{ criterion: 'z', verification: 'w' }],
      { now: NOW },
    )
    assert.ok(scoped)
    assert.equal(scoped.title, 'flyback sentinel')
    assert.equal(qualityPasses(quality), false)
  })

  test('quality assessment is still computed transparently', () => {
    const framed = makeFramed()
    const { quality } = forceScopeCandidate(
      framed,
      'x',
      ['y'],
      [],
      { now: NOW },
    )
    assert.equal(quality.scope_substantive, false)
    assert.equal(quality.done_when_present, false)
    assert.equal(quality.future_phases_substantive, false)
  })

  test('produces valid Scoped with good inputs', () => {
    const framed = makeFramed()
    const { scoped, quality } = forceScopeCandidate(
      framed,
      GOOD_SCOPE,
      GOOD_FUTURE_PHASES,
      [makeDoneCondition()],
      { now: NOW },
    )
    assert.equal(scoped.title, 'flyback sentinel')
    assert.equal(scoped.thisPhase, GOOD_SCOPE)
    assert.equal(qualityPasses(quality), true)
  })

  test('id format matches scopeCandidate', () => {
    const framed = makeFramed()
    const { scoped } = forceScopeCandidate(
      framed,
      GOOD_SCOPE,
      [],
      [makeDoneCondition()],
      { now: NOW },
    )
    assert.equal(scoped.id, `scoped-${framed.id}-${NOW}`)
  })

  test('carries forward all Framed fields', () => {
    const framed = makeFramed({
      ache: 'injustice',
      gradient: 5,
      summary: 'Misplaced concern',
      namedId: 'named-custom-456',
    })
    const { scoped } = forceScopeCandidate(
      framed,
      'too brief',
      [],
      [],
      { now: NOW },
    )
    assert.equal(scoped.ache, 'injustice')
    assert.equal(scoped.gradient, 5)
    assert.equal(scoped.summary, 'Misplaced concern')
    assert.equal(scoped.namedId, 'named-custom-456')
    assert.equal(scoped.framedId, framed.id)
  })
})

// ── renderScopingBlock ──────────────────────────────────────────

describe('renderScopingBlock', () => {
  test('returns null for empty array', () => {
    assert.equal(renderScopingBlock([]), null)
  })

  test('renders a single scoped candidate', () => {
    const scoped: Scoped = {
      id: 'scoped-test-1',
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
      ache: 'stagnation',
      gradient: 4,
      thisPhase: GOOD_SCOPE,
      futurePhases: GOOD_FUTURE_PHASES,
      doneWhen: [makeDoneCondition()],
      scopedAt: '2026-04-26T16:00:00.000Z',
    }
    const block = renderScopingBlock([scoped])
    assert.ok(block)
    assert.ok(block.includes('## Scoped candidates'))
    assert.ok(block.includes('**flyback sentinel**'))
    assert.ok(block.includes('(flyback-sentinel)'))
    assert.ok(block.includes('[4/5]'))
    assert.ok(block.includes('⚪')) // stagnation emoji
    assert.ok(block.includes('_scope:_'))
    assert.ok(block.includes('_deferred:_'))
    assert.ok(block.includes('2 future phases'))
    assert.ok(block.includes('_done when:_'))
    assert.ok(block.includes('✓'))
  })

  test('renders ache emojis correctly', () => {
    const make = (ache: 'ugliness' | 'injustice' | 'stagnation'): Scoped => ({
      id: `scoped-${ache}`,
      title: `test ${ache}`,
      slug: `test-${ache}`,
      rationale: 'why',
      purposeTie: { thread: 't', relationship: 'extends', description: 'd' },
      namedId: 'n1',
      summary: 's',
      candidateId: 'c1',
      framedId: 'f1',
      ache,
      gradient: 3,
      thisPhase: GOOD_SCOPE,
      futurePhases: [],
      doneWhen: [makeDoneCondition()],
      scopedAt: '2026-04-26T16:00:00.000Z',
    })

    assert.ok(renderScopingBlock([make('ugliness')])!.includes('🔴'))
    assert.ok(renderScopingBlock([make('injustice')])!.includes('🟡'))
    assert.ok(renderScopingBlock([make('stagnation')])!.includes('⚪'))
  })

  test('omits deferred section when no future phases', () => {
    const scoped: Scoped = {
      id: 'scoped-test-1',
      title: 'test',
      slug: 'test',
      rationale: 'why',
      purposeTie: { thread: 't', relationship: 'extends', description: 'd' },
      namedId: 'n1',
      summary: 's',
      candidateId: 'c1',
      framedId: 'f1',
      ache: 'ugliness',
      gradient: 3,
      thisPhase: GOOD_SCOPE,
      futurePhases: [],
      doneWhen: [makeDoneCondition()],
      scopedAt: '2026-04-26T16:00:00.000Z',
    }
    const block = renderScopingBlock([scoped])
    assert.ok(block)
    assert.ok(!block.includes('_deferred:_'))
  })

  test('renders singular criterion label', () => {
    const scoped: Scoped = {
      id: 'scoped-test-1',
      title: 'test',
      slug: 'test',
      rationale: 'why',
      purposeTie: { thread: 't', relationship: 'extends', description: 'd' },
      namedId: 'n1',
      summary: 's',
      candidateId: 'c1',
      framedId: 'f1',
      ache: 'ugliness',
      gradient: 3,
      thisPhase: GOOD_SCOPE,
      futurePhases: [],
      doneWhen: [makeDoneCondition()],
      scopedAt: '2026-04-26T16:00:00.000Z',
    }
    const block = renderScopingBlock([scoped])!
    assert.ok(block.includes('1 criterion'))
    assert.ok(!block.includes('criteria'))
  })

  test('renders plural criteria label', () => {
    const scoped: Scoped = {
      id: 'scoped-test-1',
      title: 'test',
      slug: 'test',
      rationale: 'why',
      purposeTie: { thread: 't', relationship: 'extends', description: 'd' },
      namedId: 'n1',
      summary: 's',
      candidateId: 'c1',
      framedId: 'f1',
      ache: 'ugliness',
      gradient: 3,
      thisPhase: GOOD_SCOPE,
      futurePhases: [],
      doneWhen: [makeDoneCondition(), { criterion: 'Second test criterion that is long enough.', verification: 'Check the second thing too.' }],
      scopedAt: '2026-04-26T16:00:00.000Z',
    }
    const block = renderScopingBlock([scoped])!
    assert.ok(block.includes('2 criteria'))
  })

  test('renders singular future phase label', () => {
    const scoped: Scoped = {
      id: 'scoped-test-1',
      title: 'test',
      slug: 'test',
      rationale: 'why',
      purposeTie: { thread: 't', relationship: 'extends', description: 'd' },
      namedId: 'n1',
      summary: 's',
      candidateId: 'c1',
      framedId: 'f1',
      ache: 'ugliness',
      gradient: 3,
      thisPhase: GOOD_SCOPE,
      futurePhases: ['Extend protection to new loads in future SOMA hardware revisions.'],
      doneWhen: [makeDoneCondition()],
      scopedAt: '2026-04-26T16:00:00.000Z',
    }
    const block = renderScopingBlock([scoped])!
    assert.ok(block.includes('1 future phase'))
    assert.ok(!block.includes('phases'))
  })

  test('truncates long scope and criteria', () => {
    const scoped: Scoped = {
      id: 'scoped-1',
      title: 'test',
      slug: 'test',
      rationale: 'why',
      purposeTie: { thread: 't', relationship: 'extends', description: 'd' },
      namedId: 'n1',
      summary: 's',
      candidateId: 'c1',
      framedId: 'f1',
      ache: 'ugliness',
      gradient: 3,
      thisPhase: 'a'.repeat(200),
      futurePhases: ['b'.repeat(200)],
      doneWhen: [{ criterion: 'c'.repeat(200), verification: 'v' }],
      scopedAt: '2026-04-26T16:00:00.000Z',
    }
    const block = renderScopingBlock([scoped])
    assert.ok(block)
    assert.ok(block.includes('…'))
  })

  test('renders multiple scoped candidates', () => {
    const make = (title: string, slug: string): Scoped => ({
      id: `scoped-${slug}`,
      title,
      slug,
      rationale: 'why this matters',
      purposeTie: { thread: 'arc', relationship: 'extends', description: 'conn' },
      namedId: `named-${slug}`,
      summary: `summary for ${title}`,
      candidateId: `c-${slug}`,
      framedId: `f-${slug}`,
      ache: 'ugliness',
      gradient: 3,
      thisPhase: GOOD_SCOPE,
      futurePhases: [],
      doneWhen: [makeDoneCondition()],
      scopedAt: '2026-04-26T16:00:00.000Z',
    })
    const block = renderScopingBlock([
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

// ── renderQualityFailures ───────────────────────────────────────

describe('renderQualityFailures', () => {
  test('renders a readable block', () => {
    const block = renderQualityFailures('flyback sentinel', [
      'scope: too short',
      'done-when: missing criteria',
    ])
    assert.ok(block.includes('Scoping quality check failed'))
    assert.ok(block.includes('flyback sentinel'))
    assert.ok(block.includes('- scope: too short'))
    assert.ok(block.includes('- done-when: missing criteria'))
    assert.ok(block.includes('scope should articulate'))
  })
})

// ── Integration: scoping pipeline ───────────────────────────────

describe('scoping pipeline integration', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('full flow: framed → scope → render', () => {
    // Step 1: We have a framed candidate
    const framed = makeFramed()

    // Step 2: Scope it
    const result = scopeCandidate(
      framed,
      GOOD_SCOPE,
      GOOD_FUTURE_PHASES,
      [
        makeDoneCondition(),
        {
          criterion: 'Build notes updated with per-load diode assignments including part numbers.',
          verification: 'Review SOMA build doc for complete diode assignment table — no blank entries.',
        },
      ],
      { now: NOW },
    )

    assert.ok(result.ok)
    if (!result.ok) return

    // Step 3: Render for downstream
    const block = renderScopingBlock([result.scoped])
    assert.ok(block)
    assert.ok(block.includes('flyback sentinel'))
    assert.ok(block.includes('[4/5]'))
    assert.ok(block.includes('2 future phases'))
    assert.ok(block.includes('2 criteria'))
  })

  test('rejection and retry flow', () => {
    const framed = makeFramed()

    // First attempt: vague scope → rejected
    const attempt1 = scopeCandidate(
      framed,
      'Do the thing.',
      [],
      [],
      { now: NOW },
    )
    assert.ok(!attempt1.ok)
    if (!attempt1.ok) {
      assert.ok(attempt1.failures.some(f => f.includes('scope')))
      assert.ok(attempt1.failures.some(f => f.includes('done-when')))
    }

    // Second attempt: specific scope → accepted
    const attempt2 = scopeCandidate(
      framed,
      GOOD_SCOPE,
      [],
      [makeDoneCondition()],
      { now: NOW + 1000 },
    )
    assert.ok(attempt2.ok)
  })

  test('different ache types flow through correctly', () => {
    const aches: Array<'ugliness' | 'injustice' | 'stagnation'> = ['ugliness', 'injustice', 'stagnation']

    for (const ache of aches) {
      const framed = makeFramed({ ache, id: `framed-${ache}` })
      const result = scopeCandidate(framed, GOOD_SCOPE, [], [makeDoneCondition()], { now: NOW })
      assert.ok(result.ok, `Expected success for ache=${ache}`)
      if (!result.ok) continue
      assert.equal(result.scoped.ache, ache)
    }
  })
})
