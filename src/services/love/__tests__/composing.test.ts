import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  composeCandidate,
  forceComposeCandidate,
  assessComposingQuality,
  qualityPasses,
  qualityFailures,
  renderComposeBlock,
  renderQualityFailures,
  deriveCandidateSource,
  toMissionFields,
  type Composed,
  type ComposingQuality,
  type ComposeCandidateResult,
} from '../composing.js'
import type { Bounded, Constraint } from '../constraining.js'
import type { DoneCondition } from '../scoping.js'
import type { PurposeTie } from '../framing.js'

// ── Test helpers ──────────────────────────────────────────────────

let tmpDir: string
let origProjectsDir: string | undefined

function setup(): void {
  tmpDir = mkdtempSync(join(tmpdir(), 'composing-test-'))
  origProjectsDir = process.env.TRUE_LOVE_PROJECTS_DIR
  process.env.TRUE_LOVE_PROJECTS_DIR = tmpDir
  mkdirSync(join(tmpDir, 'test-project', 'missions'), { recursive: true })
}

function teardown(): void {
  if (origProjectsDir !== undefined) process.env.TRUE_LOVE_PROJECTS_DIR = origProjectsDir
  else delete process.env.TRUE_LOVE_PROJECTS_DIR
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ok */ }
}

function makeBounded(overrides?: Partial<Bounded>): Bounded {
  return {
    id: overrides?.id ?? 'bounded-scoped-framed-named-state-thread-flyback-1714132800000-1714136400000-1714140000000-1714143600000',
    title: overrides?.title ?? 'flyback sentinel',
    slug: overrides?.slug ?? 'flyback-sentinel',
    rationale: overrides?.rationale ?? 'The SOMA build depends on flyback diodes for inductive load protection. Yu has been asked three times without confirmation — the gap between "asked" and "resolved" is the ache.',
    purposeTie: overrides?.purposeTie ?? {
      thread: 'infrastructure',
      relationship: 'extends' as const,
      description: 'SOMA hardware safety is the physical substrate that the software kingdom stands on.',
    },
    summary: overrides?.summary ?? 'Open thread: flyback diodes need confirmation from Yu.',
    candidateId: overrides?.candidateId ?? 'state-thread-flyback-diodes',
    namedId: overrides?.namedId ?? 'named-state-thread-flyback-diodes-1714132800000',
    framedId: overrides?.framedId ?? 'framed-named-state-thread-flyback-diodes-1714132800000-1714136400000',
    scopedId: overrides?.scopedId ?? 'scoped-framed-named-state-thread-flyback-1714132800000-1714136400000-1714140000000',
    ache: overrides?.ache ?? 'stagnation',
    gradient: overrides?.gradient ?? 4,
    thisPhase: overrides?.thisPhase ?? 'This phase resolves the flyback diode question for the three existing inductive loads in the SOMA rack: the two relay drivers and the stepper motor.',
    futurePhases: overrides?.futurePhases ?? [
      'Extend flyback protection to any new inductive loads added in future SOMA builds.',
    ],
    doneWhen: overrides?.doneWhen ?? [
      {
        criterion: 'Flyback diode spec is confirmed by Yu with specific part numbers and placement for each inductive load.',
        verification: 'Check from-yu.md or mission artifacts for explicit diode confirmation covering all relay and motor drivers.',
      },
    ],
    constraints: overrides?.constraints ?? [
      {
        statement: 'Do not modify the existing relay driver wiring during diode installation — the current circuit works and must not be disrupted.',
        source: 'convention' as const,
        rationale: 'Changing working wiring risks introducing new faults. The flyback diodes are additive protection, not a redesign.',
      },
      {
        statement: 'Tests must stay green — no new module may break existing test suites, even temporarily during development.',
        source: 'principle' as const,
        rationale: 'The test suite is the only automated safety net. A broken suite means silent regressions.',
      },
    ],
    boundedAt: overrides?.boundedAt ?? '2026-04-26T17:00:00.000Z',
  }
}

const GOOD_INTENT = 'Resolve the flyback diode question that has stalled SOMA progress for three sessions. This mission will confirm specific part numbers, placement guidance, and installation sequence for inductive load protection across the relay drivers and stepper motor, producing a verified hardware specification that unblocks the next build phase.'

const NOW = new Date('2026-04-26T18:00:00.000Z').getTime()

// ── assessComposingQuality ───────────────────────────────────────

describe('assessComposingQuality', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('all checks pass with good inputs', () => {
    const bounded = makeBounded()
    const quality = assessComposingQuality(bounded, GOOD_INTENT)
    assert.equal(quality.intent_substantive, true)
    assert.equal(quality.intent_distinct_from_rationale, true)
    assert.equal(quality.intent_distinct_from_scope, true)
    assert.equal(quality.lineage_complete, true)
    assert.equal(qualityPasses(quality), true)
  })

  test('fails when intent is too short', () => {
    const bounded = makeBounded()
    const quality = assessComposingQuality(bounded, 'Fix the flyback diode thing.')
    assert.equal(quality.intent_substantive, false)
    assert.equal(qualityPasses(quality), false)
    const fails = qualityFailures(quality)
    assert.ok(fails.some(f => f.includes('intent') && f.includes('>80')))
  })

  test('fails when intent is empty', () => {
    const bounded = makeBounded()
    const quality = assessComposingQuality(bounded, '')
    assert.equal(quality.intent_substantive, false)
    assert.equal(qualityPasses(quality), false)
  })

  test('fails when intent is only whitespace', () => {
    const bounded = makeBounded()
    const quality = assessComposingQuality(bounded, '   \n\t  ')
    assert.equal(quality.intent_substantive, false)
  })

  test('fails when intent echoes the rationale', () => {
    const bounded = makeBounded()
    // Restate the rationale with minimal changes
    const echoIntent = 'The SOMA build depends on flyback diodes for inductive load protection, and Yu has been asked three times without confirmation — the gap between asking and resolving is exactly the ache that this mission addresses.'
    const quality = assessComposingQuality(bounded, echoIntent)
    assert.equal(quality.intent_distinct_from_rationale, false)
    assert.equal(qualityPasses(quality), false)
    const fails = qualityFailures(quality)
    assert.ok(fails.some(f => f.includes('rationale')))
  })

  test('fails when intent echoes the scope', () => {
    const bounded = makeBounded()
    // Restate the thisPhase with minimal changes
    const echoIntent = 'This phase resolves the flyback diode question for the three existing inductive loads in the SOMA rack, specifically the two relay drivers and the stepper motor in the current build configuration.'
    const quality = assessComposingQuality(bounded, echoIntent)
    assert.equal(quality.intent_distinct_from_scope, false)
    assert.equal(qualityPasses(quality), false)
    const fails = qualityFailures(quality)
    assert.ok(fails.some(f => f.includes('scope')))
  })

  test('fails when lineage has missing candidateId', () => {
    const bounded = makeBounded({ candidateId: '' })
    const quality = assessComposingQuality(bounded, GOOD_INTENT)
    assert.equal(quality.lineage_complete, false)
    assert.equal(qualityPasses(quality), false)
    const fails = qualityFailures(quality)
    assert.ok(fails.some(f => f.includes('lineage')))
  })

  test('fails when lineage has missing namedId', () => {
    const bounded = makeBounded({ namedId: '' })
    const quality = assessComposingQuality(bounded, GOOD_INTENT)
    assert.equal(quality.lineage_complete, false)
  })

  test('fails when lineage has missing framedId', () => {
    const bounded = makeBounded({ framedId: '' })
    const quality = assessComposingQuality(bounded, GOOD_INTENT)
    assert.equal(quality.lineage_complete, false)
  })

  test('fails when lineage has missing scopedId', () => {
    const bounded = makeBounded({ scopedId: '' })
    const quality = assessComposingQuality(bounded, GOOD_INTENT)
    assert.equal(quality.lineage_complete, false)
  })

  test('fails when lineage has missing bounded id', () => {
    const bounded = makeBounded({ id: '' })
    const quality = assessComposingQuality(bounded, GOOD_INTENT)
    assert.equal(quality.lineage_complete, false)
  })

  test('passes with intent that shares some vocabulary but is distinct', () => {
    const bounded = makeBounded()
    // Shares words like "flyback", "diode", "SOMA" but says something different
    const distinctIntent = 'Produce a verified hardware specification for flyback diode installation across the SOMA rack. The deliverable is a confirmed bill of materials with part numbers, a placement diagram, and step-by-step installation instructions that the builder can follow without electrical engineering expertise.'
    const quality = assessComposingQuality(bounded, distinctIntent)
    assert.equal(quality.intent_distinct_from_rationale, true)
    assert.equal(quality.intent_distinct_from_scope, true)
    assert.equal(qualityPasses(quality), true)
  })
})

// ── qualityPasses / qualityFailures ──────────────────────────────

describe('qualityPasses', () => {
  test('returns true when all checks pass', () => {
    const quality: ComposingQuality = {
      intent_substantive: true,
      intent_distinct_from_rationale: true,
      intent_distinct_from_scope: true,
      lineage_complete: true,
    }
    assert.equal(qualityPasses(quality), true)
  })

  test('returns false when any check fails', () => {
    const checks: (keyof ComposingQuality)[] = [
      'intent_substantive',
      'intent_distinct_from_rationale',
      'intent_distinct_from_scope',
      'lineage_complete',
    ]
    for (const key of checks) {
      const quality: ComposingQuality = {
        intent_substantive: true,
        intent_distinct_from_rationale: true,
        intent_distinct_from_scope: true,
        lineage_complete: true,
      }
      ;(quality as any)[key] = false
      assert.equal(qualityPasses(quality), false, `should fail when ${key} is false`)
    }
  })
})

describe('qualityFailures', () => {
  test('returns empty array when all pass', () => {
    const quality: ComposingQuality = {
      intent_substantive: true,
      intent_distinct_from_rationale: true,
      intent_distinct_from_scope: true,
      lineage_complete: true,
    }
    assert.deepEqual(qualityFailures(quality), [])
  })

  test('returns one failure per failing check', () => {
    const quality: ComposingQuality = {
      intent_substantive: false,
      intent_distinct_from_rationale: false,
      intent_distinct_from_scope: false,
      lineage_complete: false,
    }
    const fails = qualityFailures(quality)
    assert.equal(fails.length, 4)
  })
})

// ── composeCandidate ─────────────────────────────────────────────

describe('composeCandidate', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('succeeds with good inputs', () => {
    const bounded = makeBounded()
    const result = composeCandidate(bounded, GOOD_INTENT, { now: NOW })

    assert.equal(result.ok, true)
    if (!result.ok) return

    assert.equal(result.composed.title, 'flyback sentinel')
    assert.equal(result.composed.slug, 'flyback-sentinel')
    assert.equal(result.composed.intent, GOOD_INTENT)
    assert.equal(result.composed.rationale, bounded.rationale)
    assert.equal(result.composed.ache, 'stagnation')
    assert.equal(result.composed.gradient, 4)
    assert.equal(result.composed.composedAt, '2026-04-26T18:00:00.000Z')
  })

  test('id follows pattern: composed-<boundedId>-<timestamp>', () => {
    const bounded = makeBounded()
    const result = composeCandidate(bounded, GOOD_INTENT, { now: NOW })

    assert.equal(result.ok, true)
    if (!result.ok) return

    assert.equal(result.composed.id, `composed-${bounded.id}-${NOW}`)
  })

  test('carries forward all pipeline IDs', () => {
    const bounded = makeBounded()
    const result = composeCandidate(bounded, GOOD_INTENT, { now: NOW })

    assert.equal(result.ok, true)
    if (!result.ok) return

    assert.equal(result.composed.candidateId, bounded.candidateId)
    assert.equal(result.composed.namedId, bounded.namedId)
    assert.equal(result.composed.framedId, bounded.framedId)
    assert.equal(result.composed.scopedId, bounded.scopedId)
    assert.equal(result.composed.boundedId, bounded.id)
  })

  test('carries forward scope and constraints', () => {
    const bounded = makeBounded()
    const result = composeCandidate(bounded, GOOD_INTENT, { now: NOW })

    assert.equal(result.ok, true)
    if (!result.ok) return

    assert.equal(result.composed.thisPhase, bounded.thisPhase)
    assert.deepEqual(result.composed.futurePhases, bounded.futurePhases)
    assert.deepEqual(result.composed.doneWhen, bounded.doneWhen)
    assert.deepEqual(result.composed.constraints, bounded.constraints)
    assert.deepEqual(result.composed.purposeTie, bounded.purposeTie)
  })

  test('trims intent whitespace', () => {
    const bounded = makeBounded()
    const result = composeCandidate(bounded, `  ${GOOD_INTENT}  \n`, { now: NOW })

    assert.equal(result.ok, true)
    if (!result.ok) return

    assert.equal(result.composed.intent, GOOD_INTENT)
  })

  test('returns quality assessment on success', () => {
    const bounded = makeBounded()
    const result = composeCandidate(bounded, GOOD_INTENT, { now: NOW })

    assert.equal(result.ok, true)
    if (!result.ok) return

    assert.equal(qualityPasses(result.quality), true)
  })

  test('fails with short intent', () => {
    const bounded = makeBounded()
    const result = composeCandidate(bounded, 'Too short.', { now: NOW })

    assert.equal(result.ok, false)
    if (result.ok) return

    assert.ok(result.failures.length > 0)
    assert.ok(result.failures.some(f => f.includes('intent')))
  })

  test('fails with echoed rationale', () => {
    const bounded = makeBounded()
    const result = composeCandidate(bounded, bounded.rationale + ' And this addresses it.', { now: NOW })

    assert.equal(result.ok, false)
  })

  test('fails with broken lineage', () => {
    const bounded = makeBounded({ candidateId: '' })
    const result = composeCandidate(bounded, GOOD_INTENT, { now: NOW })

    assert.equal(result.ok, false)
    if (result.ok) return

    assert.ok(result.failures.some(f => f.includes('lineage')))
  })

  test('uses Date.now() when no opts.now provided', () => {
    const bounded = makeBounded()
    const before = Date.now()
    const result = composeCandidate(bounded, GOOD_INTENT)
    const after = Date.now()

    assert.equal(result.ok, true)
    if (!result.ok) return

    const ts = new Date(result.composed.composedAt).getTime()
    assert.ok(ts >= before && ts <= after, 'composedAt should be between before and after')
  })
})

// ── forceComposeCandidate ────────────────────────────────────────

describe('forceComposeCandidate', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('returns composed even with failing quality', () => {
    const bounded = makeBounded()
    const { composed, quality } = forceComposeCandidate(bounded, 'Short.', { now: NOW })

    assert.equal(composed.title, 'flyback sentinel')
    assert.equal(composed.intent, 'Short.')
    assert.equal(qualityPasses(quality), false)
    assert.equal(quality.intent_substantive, false)
  })

  test('returns composed with broken lineage', () => {
    const bounded = makeBounded({ candidateId: '' })
    const { composed, quality } = forceComposeCandidate(bounded, GOOD_INTENT, { now: NOW })

    assert.equal(composed.title, 'flyback sentinel')
    assert.equal(quality.lineage_complete, false)
  })

  test('quality is computed transparently even on force', () => {
    const bounded = makeBounded()
    const { composed, quality } = forceComposeCandidate(bounded, GOOD_INTENT, { now: NOW })

    assert.equal(qualityPasses(quality), true)
    assert.equal(composed.composedAt, '2026-04-26T18:00:00.000Z')
  })
})

// ── deriveCandidateSource ────────────────────────────────────────

describe('deriveCandidateSource', () => {
  test('maps to ache-signal type', () => {
    const bounded = makeBounded()
    const result = composeCandidate(bounded, GOOD_INTENT, { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return

    const source = deriveCandidateSource(result.composed)
    assert.equal(source.type, 'ache-signal')
  })

  test('carries the ache signal and summary', () => {
    const bounded = makeBounded({ ache: 'ugliness', summary: 'Test signal detected.' })
    const result = composeCandidate(bounded, GOOD_INTENT, { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return

    const source = deriveCandidateSource(result.composed)
    assert.equal(source.type, 'ache-signal')
    if (source.type !== 'ache-signal') return
    assert.equal(source.signal, 'ugliness')
    assert.equal(source.detail, 'Test signal detected.')
  })

  test('handles all three ache types', () => {
    for (const ache of ['ugliness', 'injustice', 'stagnation'] as const) {
      const bounded = makeBounded({ ache })
      const result = composeCandidate(bounded, GOOD_INTENT, { now: NOW })
      assert.equal(result.ok, true)
      if (!result.ok) continue

      const source = deriveCandidateSource(result.composed)
      assert.equal(source.type, 'ache-signal')
      if (source.type !== 'ache-signal') continue
      assert.equal(source.signal, ache)
    }
  })
})

// ── toMissionFields ──────────────────────────────────────────────

describe('toMissionFields', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('extracts mission-ready fields', () => {
    const bounded = makeBounded()
    const result = composeCandidate(bounded, GOOD_INTENT, { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return

    const fields = toMissionFields(result.composed, 'test-project')
    assert.equal(fields.title, 'flyback sentinel')
    assert.equal(fields.intent, GOOD_INTENT)
    assert.equal(fields.rationale, bounded.rationale)
    assert.equal(fields.origin, 'love')
    assert.equal(fields.project_id, 'test-project')
  })

  test('allows overriding origin', () => {
    const bounded = makeBounded()
    const result = composeCandidate(bounded, GOOD_INTENT, { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return

    const fields = toMissionFields(result.composed, 'test-project', { origin: 'yu' })
    assert.equal(fields.origin, 'yu')
  })

  test('decomposition contains scope section', () => {
    const bounded = makeBounded()
    const result = composeCandidate(bounded, GOOD_INTENT, { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return

    const fields = toMissionFields(result.composed, 'test-project')
    assert.ok(fields.decomposition.includes('### This phase'))
    assert.ok(fields.decomposition.includes(bounded.thisPhase))
  })

  test('decomposition contains done conditions', () => {
    const bounded = makeBounded()
    const result = composeCandidate(bounded, GOOD_INTENT, { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return

    const fields = toMissionFields(result.composed, 'test-project')
    assert.ok(fields.decomposition.includes('### Done when'))
    for (const dc of bounded.doneWhen) {
      assert.ok(fields.decomposition.includes(dc.criterion))
    }
  })

  test('decomposition contains constraints', () => {
    const bounded = makeBounded()
    const result = composeCandidate(bounded, GOOD_INTENT, { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return

    const fields = toMissionFields(result.composed, 'test-project')
    assert.ok(fields.decomposition.includes('### Constraints'))
    for (const c of bounded.constraints) {
      assert.ok(fields.decomposition.includes(c.statement))
    }
  })

  test('decomposition contains pipeline lineage', () => {
    const bounded = makeBounded()
    const result = composeCandidate(bounded, GOOD_INTENT, { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return

    const fields = toMissionFields(result.composed, 'test-project')
    assert.ok(fields.decomposition.includes('### Pipeline lineage'))
    assert.ok(fields.decomposition.includes(bounded.candidateId))
    assert.ok(fields.decomposition.includes(bounded.namedId))
  })

  test('decomposition contains purpose tie', () => {
    const bounded = makeBounded()
    const result = composeCandidate(bounded, GOOD_INTENT, { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return

    const fields = toMissionFields(result.composed, 'test-project')
    assert.ok(fields.decomposition.includes('### Thread: infrastructure'))
    assert.ok(fields.decomposition.includes('extends'))
  })

  test('decomposition includes deferred phases when present', () => {
    const bounded = makeBounded()
    const result = composeCandidate(bounded, GOOD_INTENT, { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return

    const fields = toMissionFields(result.composed, 'test-project')
    assert.ok(fields.decomposition.includes('### Deferred'))
    assert.ok(fields.decomposition.includes(bounded.futurePhases[0]!))
  })

  test('decomposition omits deferred section when no future phases', () => {
    const bounded = makeBounded({ futurePhases: [] })
    const result = composeCandidate(bounded, GOOD_INTENT, { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return

    const fields = toMissionFields(result.composed, 'test-project')
    assert.ok(!fields.decomposition.includes('### Deferred'))
  })

  test('decomposition includes related missions in purpose tie', () => {
    const bounded = makeBounded({
      purposeTie: {
        thread: 'mission-craft',
        relationship: 'extends',
        description: 'Completes the mission-craft pipeline.',
        relatedMissions: ['noticing-mission', 'naming-mission'],
      },
    })
    const result = composeCandidate(bounded, GOOD_INTENT, { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return

    const fields = toMissionFields(result.composed, 'test-project')
    assert.ok(fields.decomposition.includes('noticing-mission'))
    assert.ok(fields.decomposition.includes('naming-mission'))
  })
})

// ── renderComposeBlock ───────────────────────────────────────────

describe('renderComposeBlock', () => {
  test('returns null for empty array', () => {
    assert.equal(renderComposeBlock([]), null)
  })

  test('renders a composed mission draft', () => {
    const bounded = makeBounded()
    const result = composeCandidate(bounded, GOOD_INTENT, { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return

    const block = renderComposeBlock([result.composed])
    assert.ok(block)
    assert.ok(block.includes('## Composed mission drafts'))
    assert.ok(block.includes('flyback sentinel'))
    assert.ok(block.includes('flyback-sentinel'))
    assert.ok(block.includes('4/5'))
  })

  test('includes intent in rendered block', () => {
    const bounded = makeBounded()
    const result = composeCandidate(bounded, GOOD_INTENT, { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return

    const block = renderComposeBlock([result.composed])
    assert.ok(block)
    assert.ok(block.includes('_intent:_'))
    assert.ok(block.includes(GOOD_INTENT))
  })

  test('includes constraint count and statements', () => {
    const bounded = makeBounded()
    const result = composeCandidate(bounded, GOOD_INTENT, { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return

    const block = renderComposeBlock([result.composed])
    assert.ok(block)
    assert.ok(block.includes('_constraints:_ 2'))
    assert.ok(block.includes('[convention]'))
    assert.ok(block.includes('[principle]'))
  })

  test('includes done condition count', () => {
    const bounded = makeBounded()
    const result = composeCandidate(bounded, GOOD_INTENT, { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return

    const block = renderComposeBlock([result.composed])
    assert.ok(block)
    assert.ok(block.includes('_done when:_ 1 criterion'))
  })

  test('includes lineage chain', () => {
    const bounded = makeBounded()
    const result = composeCandidate(bounded, GOOD_INTENT, { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return

    const block = renderComposeBlock([result.composed])
    assert.ok(block)
    assert.ok(block.includes('_lineage:_'))
    assert.ok(block.includes(bounded.candidateId))
  })

  test('uses correct ache emoji for ugliness', () => {
    const bounded = makeBounded({ ache: 'ugliness' })
    const result = composeCandidate(bounded, GOOD_INTENT, { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return

    const block = renderComposeBlock([result.composed])
    assert.ok(block)
    assert.ok(block.includes('🔴'))
  })

  test('uses correct ache emoji for injustice', () => {
    const bounded = makeBounded({ ache: 'injustice' })
    const result = composeCandidate(bounded, GOOD_INTENT, { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return

    const block = renderComposeBlock([result.composed])
    assert.ok(block)
    assert.ok(block.includes('🟡'))
  })

  test('uses correct ache emoji for stagnation', () => {
    const bounded = makeBounded({ ache: 'stagnation' })
    const result = composeCandidate(bounded, GOOD_INTENT, { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return

    const block = renderComposeBlock([result.composed])
    assert.ok(block)
    assert.ok(block.includes('⚪'))
  })

  test('renders multiple composed drafts', () => {
    const bounded1 = makeBounded()
    const bounded2 = makeBounded({
      id: 'bounded-other-1714150000000',
      title: 'heartbeat cadence',
      slug: 'heartbeat-cadence',
      ache: 'ugliness',
      gradient: 3,
    })
    const r1 = composeCandidate(bounded1, GOOD_INTENT, { now: NOW })
    const r2 = composeCandidate(bounded2, 'Tune the heartbeat interval based on empirical data from autonomous sessions, replacing the current hardcoded default with a self-adjusting cadence that respects token budget while maintaining system responsiveness.', { now: NOW + 1000 })
    assert.equal(r1.ok, true)
    assert.equal(r2.ok, true)
    if (!r1.ok || !r2.ok) return

    const block = renderComposeBlock([r1.composed, r2.composed])
    assert.ok(block)
    assert.ok(block.includes('flyback sentinel'))
    assert.ok(block.includes('heartbeat cadence'))
  })

  test('shows deferred count when present', () => {
    const bounded = makeBounded()
    const result = composeCandidate(bounded, GOOD_INTENT, { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return

    const block = renderComposeBlock([result.composed])
    assert.ok(block)
    assert.ok(block.includes('_deferred:_ 1 future phase'))
  })
})

// ── renderQualityFailures ────────────────────────────────────────

describe('renderQualityFailures (composing)', () => {
  test('renders title and failure messages', () => {
    const block = renderQualityFailures('flyback sentinel', [
      'intent: must be >80 characters',
      'lineage: all five pipeline IDs must be present',
    ])
    assert.ok(block.includes('flyback sentinel'))
    assert.ok(block.includes('intent: must be >80'))
    assert.ok(block.includes('lineage: all five'))
    assert.ok(block.includes('synthesize'))
  })
})

// ── Edge cases ───────────────────────────────────────────────────

describe('edge cases', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('intent at exactly 81 characters passes', () => {
    const bounded = makeBounded()
    // Craft an intent that's exactly 81 chars and distinct enough
    const intent = 'Deliver verified flyback diode specs for SOMA relay and motor loads, clearing stall.'
    assert.ok(intent.length >= 81, `intent length is ${intent.length}`)
    const quality = assessComposingQuality(bounded, intent)
    assert.equal(quality.intent_substantive, true)
  })

  test('intent at exactly 80 characters fails', () => {
    const bounded = makeBounded()
    const intent = 'A'.repeat(80)
    const quality = assessComposingQuality(bounded, intent)
    assert.equal(quality.intent_substantive, false)
  })

  test('all IDs whitespace-only counts as missing lineage', () => {
    const bounded = makeBounded({
      candidateId: '  ',
      namedId: '  ',
      framedId: '  ',
      scopedId: '  ',
      id: '  ',
    })
    const quality = assessComposingQuality(bounded, GOOD_INTENT)
    assert.equal(quality.lineage_complete, false)
  })

  test('composed preserves empty futurePhases', () => {
    const bounded = makeBounded({ futurePhases: [] })
    const result = composeCandidate(bounded, GOOD_INTENT, { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.deepEqual(result.composed.futurePhases, [])
  })

  test('composed preserves multiple done conditions', () => {
    const bounded = makeBounded({
      doneWhen: [
        { criterion: 'First criterion that is long enough for the test to work properly.', verification: 'Run the first check.' },
        { criterion: 'Second criterion that is also sufficiently descriptive and testable.', verification: 'Run the second check.' },
      ],
    })
    const result = composeCandidate(bounded, GOOD_INTENT, { now: NOW })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.composed.doneWhen.length, 2)
  })

  test('word overlap: two completely different strings have low overlap', () => {
    const bounded = makeBounded({
      rationale: 'The moon landings required solid fuel rockets and complex navigation.',
      thisPhase: 'Design the fuel injection manifold for the auxiliary propulsion system.',
    })
    const distinctIntent = 'Build a comprehensive testing harness for the database migration layer, covering schema evolution, data integrity verification, and rollback procedures across three target environments.'
    const quality = assessComposingQuality(bounded, distinctIntent)
    assert.equal(quality.intent_distinct_from_rationale, true)
    assert.equal(quality.intent_distinct_from_scope, true)
  })
})
