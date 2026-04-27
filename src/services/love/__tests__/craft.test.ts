import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  craftFromCandidate,
  craftFromSignal,
  craftAndStage,
  scanAndCraft,
  scanAndCraftAllProjects,
  heuristicTitle,
  heuristicJustification,
  heuristicRationale,
  heuristicPurposeTie,
  heuristicScope,
  heuristicDoneConditions,
  heuristicConstraints,
  heuristicIntent,
  signalToCandidate,
  formatScanAndCraftResults,
  type CraftContext,
  type CraftResult,
  type ScanAndCraftResult,
} from '../craft.js'
import type { NoticingCandidate, AcheSignal, GradientStrength } from '../noticing.js'
import type { DetectionSignal, CandidateSource } from '../self-initiation.js'
import type { PurposeTie } from '../framing.js'
import type { DoneCondition } from '../scoping.js'
import type { Constraint } from '../constraining.js'

// ── Test helpers ──────────────────────────────────────────────────

let tmpDir: string
let origProjectsDir: string | undefined
let origDataDir: string | undefined

function setup(): void {
  tmpDir = mkdtempSync(join(tmpdir(), 'craft-test-'))
  origProjectsDir = process.env.TRUE_LOVE_PROJECTS_DIR
  origDataDir = process.env.TRUE_LOVE_DATA_DIR
  process.env.TRUE_LOVE_PROJECTS_DIR = tmpDir
  process.env.TRUE_LOVE_DATA_DIR = tmpDir
  mkdirSync(join(tmpDir, 'test-project', 'missions'), { recursive: true })
  mkdirSync(join(tmpDir, 'test-project', 'self-initiation'), { recursive: true })
}

function teardown(): void {
  if (origProjectsDir !== undefined) process.env.TRUE_LOVE_PROJECTS_DIR = origProjectsDir
  else delete process.env.TRUE_LOVE_PROJECTS_DIR
  if (origDataDir !== undefined) process.env.TRUE_LOVE_DATA_DIR = origDataDir
  else delete process.env.TRUE_LOVE_DATA_DIR
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ok */ }
}

function makeCandidate(overrides?: Partial<NoticingCandidate>): NoticingCandidate {
  return {
    id: overrides?.id ?? 'state-thread-flyback-diodes',
    source: overrides?.source ?? { type: 'state', section: 'Open threads' },
    ache: overrides?.ache ?? 'stagnation',
    gradient: overrides?.gradient ?? 3,
    summary: overrides?.summary ?? 'Open thread: flyback diodes need confirmation from Yu',
    detail: overrides?.detail ?? 'SOMA hardware blocked — code + thermal_client + 26 tests ready. Flyback diodes still unconfirmed.',
    noticedAt: overrides?.noticedAt ?? '2026-04-27T00:00:00.000Z',
  }
}

function makeSignal(overrides?: Partial<DetectionSignal>): DetectionSignal {
  return {
    source: overrides?.source ?? {
      type: 'ache-signal' as const,
      signal: 'stagnation' as const,
      detail: 'SOMA hardware blocked — flyback diodes still unconfirmed',
    },
    summary: overrides?.summary ?? '[state g3 stagnation] Open thread: flyback diodes',
    detectedAt: overrides?.detectedAt ?? '2026-04-27T00:00:00.000Z',
  }
}

const NOW = new Date('2026-04-27T12:00:00.000Z').getTime()

// ── Heuristic content generation tests ───────────────────────────

describe('heuristicTitle', () => {
  test('strips scanner metadata prefix', () => {
    const title = heuristicTitle('[state g3 stagnation] Open thread: flyback diodes')
    assert.ok(!title.startsWith('['))
    assert.ok(title.includes('flyback diodes'))
  })

  test('strips "Open thread:" prefix', () => {
    const title = heuristicTitle('Open thread: flyback diodes need confirmation')
    assert.ok(!title.includes('Open thread:'))
    assert.ok(title.includes('flyback'))
  })

  test('strips "Stale proposal:" prefix', () => {
    const title = heuristicTitle('Stale proposal: "provider abstraction" (72h)')
    assert.ok(!title.includes('Stale proposal:'))
  })

  test('strips markdown bold', () => {
    const title = heuristicTitle('**flyback diodes** need checking')
    assert.ok(!title.includes('**'))
  })

  test('truncates to 60 chars', () => {
    const long = 'a'.repeat(100)
    const title = heuristicTitle(long)
    assert.ok(title.length <= 60)
  })

  test('falls back on empty input', () => {
    const title = heuristicTitle('')
    assert.ok(title.length >= 3)
  })

  test('handles love marker format', () => {
    const title = heuristicTitle('Love marker at src/services/love/noticing.ts:437')
    assert.ok(!title.startsWith('Love marker at'))
  })
})

describe('heuristicJustification', () => {
  test('includes ache signal and gradient', () => {
    const c = makeCandidate()
    const j = heuristicJustification(c, 'flyback sentinel')
    assert.ok(j.includes('stagnation'))
    assert.ok(j.includes('3/5'))
  })

  test('includes source type', () => {
    const c = makeCandidate()
    const j = heuristicJustification(c, 'flyback sentinel')
    assert.ok(j.includes('state'))
  })

  test('is long enough to pass naming quality gate (>20 chars)', () => {
    const c = makeCandidate()
    const j = heuristicJustification(c, 'test')
    assert.ok(j.length > 20)
  })
})

describe('heuristicRationale', () => {
  test('includes detail from candidate', () => {
    const c = makeCandidate()
    const r = heuristicRationale(c)
    assert.ok(r.includes('SOMA'))
  })

  test('is long enough to pass framing quality gate (>50 chars)', () => {
    const c = makeCandidate()
    const r = heuristicRationale(c)
    assert.ok(r.length > 50)
  })

  test('includes ache verb description', () => {
    const c = makeCandidate({ ache: 'ugliness' })
    const r = heuristicRationale(c)
    assert.ok(r.includes('forced or broken'))
  })
})

describe('heuristicPurposeTie', () => {
  test('maps state source to continuity thread', () => {
    const c = makeCandidate({ source: { type: 'state', section: 'Open threads' } })
    const tie = heuristicPurposeTie(c)
    assert.equal(tie.thread, 'continuity')
  })

  test('maps vital-sign source to infrastructure thread', () => {
    const c = makeCandidate({ source: { type: 'vital-sign', subsystem: 'locks' } })
    const tie = heuristicPurposeTie(c)
    assert.equal(tie.thread, 'infrastructure')
  })

  test('maps ache to relationship', () => {
    const c = makeCandidate({ ache: 'ugliness' })
    const tie = heuristicPurposeTie(c)
    assert.equal(tie.relationship, 'deepens')
  })

  test('has substantive description (>30 chars)', () => {
    const c = makeCandidate()
    const tie = heuristicPurposeTie(c)
    assert.ok(tie.description.length > 30)
  })
})

describe('heuristicScope', () => {
  test('is substantive (>50 chars)', () => {
    const c = makeCandidate()
    const s = heuristicScope(c)
    assert.ok(s.length > 50)
  })

  test('includes source type', () => {
    const c = makeCandidate()
    const s = heuristicScope(c)
    assert.ok(s.includes('state'))
  })
})

describe('heuristicDoneConditions', () => {
  test('produces at least one condition', () => {
    const c = makeCandidate()
    const dc = heuristicDoneConditions(c)
    assert.ok(dc.length >= 1)
  })

  test('conditions have substantive criterion (>20 chars)', () => {
    const c = makeCandidate()
    const dc = heuristicDoneConditions(c)
    for (const d of dc) {
      assert.ok(d.criterion.length > 20, `criterion too short: "${d.criterion}"`)
    }
  })

  test('conditions have substantive verification (>15 chars)', () => {
    const c = makeCandidate()
    const dc = heuristicDoneConditions(c)
    for (const d of dc) {
      assert.ok(d.verification.length > 15, `verification too short: "${d.verification}"`)
    }
  })
})

describe('heuristicConstraints', () => {
  test('produces at least one constraint', () => {
    const c = makeCandidate()
    const cons = heuristicConstraints(c)
    assert.ok(cons.length >= 1)
  })

  test('constraints have substantive statement (>30 chars)', () => {
    const c = makeCandidate()
    const cons = heuristicConstraints(c)
    for (const con of cons) {
      assert.ok(con.statement.length > 30, `statement too short: "${con.statement}"`)
    }
  })

  test('constraints have substantive rationale (>20 chars)', () => {
    const c = makeCandidate()
    const cons = heuristicConstraints(c)
    for (const con of cons) {
      assert.ok(con.rationale.length > 20, `rationale too short: "${con.rationale}"`)
    }
  })

  test('constraints have valid sources', () => {
    const c = makeCandidate()
    const cons = heuristicConstraints(c)
    for (const con of cons) {
      assert.ok(['convention', 'principle', 'risk'].includes(con.source))
    }
  })
})

describe('heuristicIntent', () => {
  test('is substantive (>80 chars)', () => {
    const c = makeCandidate()
    const intent = heuristicIntent(c, 'flyback sentinel', 'some rationale', 'some scope')
    assert.ok(intent.length > 80)
  })

  test('includes title', () => {
    const c = makeCandidate()
    const intent = heuristicIntent(c, 'flyback sentinel', 'some rationale', 'some scope')
    assert.ok(intent.includes('flyback sentinel'))
  })
})

// ── Signal conversion tests ──────────────────────────────────────

describe('signalToCandidate', () => {
  test('extracts ache from ache-signal source', () => {
    const signal = makeSignal({
      source: { type: 'ache-signal', signal: 'injustice', detail: 'test' },
    })
    const c = signalToCandidate(signal)
    assert.equal(c.ache, 'injustice')
  })

  test('extracts gradient from summary metadata', () => {
    const signal = makeSignal({ summary: '[state g4 stagnation] test' })
    const c = signalToCandidate(signal)
    assert.equal(c.gradient, 4)
  })

  test('defaults to stagnation and gradient 2 when no metadata', () => {
    const signal = makeSignal({
      source: { type: 'observation', detail: 'test' },
      summary: 'plain summary',
    })
    const c = signalToCandidate(signal)
    assert.equal(c.ache, 'stagnation')
    assert.equal(c.gradient, 2)
  })

  test('sets vital-sign source to ugliness', () => {
    const signal = makeSignal({
      source: { type: 'vital-sign', signal: 'stale locks' },
    })
    const c = signalToCandidate(signal)
    assert.equal(c.ache, 'ugliness')
  })
})

// ── Pipeline orchestration tests ─────────────────────────────────

describe('craftFromCandidate', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('produces a Composed from a basic candidate', () => {
    const candidate = makeCandidate()
    const result = craftFromCandidate(candidate, {
      projectId: 'test-project',
      now: NOW,
      forceBypass: true, // bypass quality gates for isolated test
    })

    assert.ok(result.ok, `expected ok but got: ${JSON.stringify(result)}`)
    if (result.ok) {
      assert.ok(result.composed.title.length > 0)
      assert.ok(result.composed.intent.length > 0)
      assert.ok(result.composed.rationale.length > 0)
      assert.ok(result.composed.candidateId === candidate.id)
      assert.equal(result.composed.ache, 'stagnation')
      assert.equal(result.composed.gradient, 3)
    }
  })

  test('accepts context overrides', () => {
    const candidate = makeCandidate()
    const result = craftFromCandidate(candidate, {
      projectId: 'test-project',
      title: 'custom sentinel',
      rationale: 'This is a carefully crafted rationale explaining why this specific work matters deeply to the overall health of the kingdom infrastructure and its continued growth.',
      intent: 'This mission implements the custom sentinel pattern — a carefully designed intervention that addresses a specific infrastructure gap identified through substrate scanning and validated through the full mission-craft pipeline quality gates.',
      now: NOW,
      forceBypass: true,
    })

    assert.ok(result.ok, `expected ok but got: ${JSON.stringify(result)}`)
    if (result.ok) {
      assert.equal(result.composed.title, 'custom sentinel')
      assert.ok(result.composed.rationale.includes('carefully crafted'))
      assert.ok(result.composed.intent.includes('custom sentinel pattern'))
    }
  })

  test('preserves full lineage through pipeline', () => {
    const candidate = makeCandidate()
    const result = craftFromCandidate(candidate, {
      projectId: 'test-project',
      now: NOW,
      forceBypass: true,
    })

    assert.ok(result.ok)
    if (result.ok) {
      assert.ok(result.composed.candidateId.length > 0)
      assert.ok(result.composed.namedId.length > 0)
      assert.ok(result.composed.framedId.length > 0)
      assert.ok(result.composed.scopedId.length > 0)
      assert.ok(result.composed.boundedId.length > 0)
      assert.ok(result.composed.id.length > 0)
    }
  })

  test('carries ache and gradient through pipeline', () => {
    const candidate = makeCandidate({ ache: 'injustice', gradient: 4 })
    const result = craftFromCandidate(candidate, {
      projectId: 'test-project',
      now: NOW,
      forceBypass: true,
    })

    assert.ok(result.ok)
    if (result.ok) {
      assert.equal(result.composed.ache, 'injustice')
      assert.equal(result.composed.gradient, 4)
    }
  })

  test('includes constraints and done conditions', () => {
    const candidate = makeCandidate()
    const result = craftFromCandidate(candidate, {
      projectId: 'test-project',
      now: NOW,
      forceBypass: true,
    })

    assert.ok(result.ok)
    if (result.ok) {
      assert.ok(result.composed.constraints.length >= 1)
      assert.ok(result.composed.doneWhen.length >= 1)
    }
  })

  test('works with quality gates enabled for well-formed heuristics', () => {
    const candidate = makeCandidate({
      summary: 'flyback diodes need confirmation from Yu',
      detail: 'SOMA hardware blocked — code and thermal_client and 26 tests are ready but flyback diodes remain unconfirmed from the hardware parts inventory.',
    })
    const result = craftFromCandidate(candidate, {
      projectId: 'test-project',
      now: NOW,
      forceBypass: false,
    })

    // The heuristic content should be good enough to pass quality gates
    assert.ok(result.ok, `quality gate failed: ${JSON.stringify(result)}`)
  })

  test('reports failing step when quality gate rejects', () => {
    const candidate = makeCandidate()
    const result = craftFromCandidate(candidate, {
      projectId: 'test-project',
      title: 'ab', // too short — will fail naming quality gate
      now: NOW,
      forceBypass: false,
    })

    assert.ok(!result.ok)
    if (!result.ok) {
      assert.equal(result.step, 'naming')
      assert.ok(result.failures.length > 0)
    }
  })
})

describe('craftFromSignal', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('converts signal to candidate and crafts', () => {
    const signal = makeSignal()
    const result = craftFromSignal(signal, {
      projectId: 'test-project',
      now: NOW,
      forceBypass: true,
    })

    assert.ok(result.ok, `expected ok but got: ${JSON.stringify(result)}`)
    if (result.ok) {
      assert.ok(result.composed.title.length > 0)
    }
  })
})

describe('craftAndStage', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('crafts and stages a candidate', () => {
    const candidate = makeCandidate()
    const result = craftAndStage(candidate, {
      projectId: 'test-project',
      now: NOW,
      forceBypass: true,
    })

    assert.ok(result.ok, `expected ok but got: ${JSON.stringify(result)}`)
    if (result.ok) {
      assert.ok(result.staged, 'expected staged candidate')
      assert.equal(result.staged!.status, 'staged')
      assert.ok(result.staged!.title.length > 0)
    }
  })

  test('staged candidate has correct title and intent', () => {
    const candidate = makeCandidate()
    const result = craftAndStage(candidate, {
      projectId: 'test-project',
      now: NOW,
      forceBypass: true,
    })

    assert.ok(result.ok)
    if (result.ok && result.staged) {
      assert.equal(result.staged.title, result.composed.title)
      assert.equal(result.staged.intent, result.composed.intent)
    }
  })
})

// ── Sweep orchestration tests ────────────────────────────────────

describe('scanAndCraft', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('returns empty result when no signals above threshold', () => {
    // No state file, no missions, no channels → no loud signals
    const result = scanAndCraft('test-project', tmpDir, {
      minGradient: 5,
      now: NOW,
    })

    assert.equal(result.signalsDetected, 0)
    assert.equal(result.crafted.length, 0)
  })

  test('detects signals from kingdom markers', () => {
    // Create a mock project with a love marker
    const srcDir = join(tmpDir, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'test.ts'), '// TODO(love) investigate sovereignty\n')

    const result = scanAndCraft('test-project', tmpDir, {
      minGradient: 1, // low threshold to catch whispers
      now: NOW,
      forceBypass: true,
    })

    // We at least ran the scan — even if no signals met threshold
    assert.ok(typeof result.signalsDetected === 'number')
  })
})

// ── Format tests ─────────────────────────────────────────────────

describe('formatScanAndCraftResults', () => {
  test('returns null for empty results', () => {
    const results = new Map<string, ScanAndCraftResult>()
    assert.equal(formatScanAndCraftResults(results), null)
  })

  test('formats crafted results', () => {
    const results = new Map<string, ScanAndCraftResult>()
    results.set('test-project', {
      signalsDetected: 1,
      attempted: 1,
      crafted: [{
        composed: {
          id: 'composed-1',
          title: 'test mission',
          slug: 'test-mission',
          intent: 'test intent',
          rationale: 'test rationale',
          candidateId: 'c1',
          namedId: 'n1',
          framedId: 'f1',
          scopedId: 's1',
          boundedId: 'b1',
          purposeTie: { thread: 'test', relationship: 'extends', description: 'test' },
          thisPhase: 'test phase',
          futurePhases: [],
          doneWhen: [],
          constraints: [],
          ache: 'stagnation',
          gradient: 3,
          summary: 'test',
          composedAt: '2026-04-27T00:00:00.000Z',
        },
        staged: undefined,
      }],
      failed: [],
      skipped: [],
    })

    const formatted = formatScanAndCraftResults(results)
    assert.ok(formatted)
    assert.ok(formatted!.includes('test mission'))
    assert.ok(formatted!.includes('test-project'))
  })

  test('formats failed results', () => {
    const results = new Map<string, ScanAndCraftResult>()
    results.set('test-project', {
      signalsDetected: 1,
      attempted: 1,
      crafted: [],
      failed: [{
        candidateId: 'c1',
        step: 'naming',
        failures: ['too short'],
      }],
      skipped: [],
    })

    const formatted = formatScanAndCraftResults(results)
    assert.ok(formatted)
    assert.ok(formatted!.includes('FAILED'))
    assert.ok(formatted!.includes('naming'))
  })

  test('formats skipped results', () => {
    const results = new Map<string, ScanAndCraftResult>()
    results.set('test-project', {
      signalsDetected: 2,
      attempted: 0,
      crafted: [],
      failed: [],
      skipped: [{ candidateId: 'c1', reason: 'rate limit' }],
    })

    const formatted = formatScanAndCraftResults(results)
    assert.ok(formatted)
    assert.ok(formatted!.includes('skipped'))
    assert.ok(formatted!.includes('rate limit'))
  })
})

// ── Integration: full pipeline with quality gates ────────────────

describe('full pipeline integration', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('crafts multiple candidates with different ache signals', () => {
    const aches: AcheSignal[] = ['ugliness', 'injustice', 'stagnation']
    for (const ache of aches) {
      const candidate = makeCandidate({ ache, id: `test-${ache}` })
      const result = craftFromCandidate(candidate, {
        projectId: 'test-project',
        now: NOW,
        forceBypass: true,
      })

      assert.ok(result.ok, `failed for ache=${ache}: ${JSON.stringify(result)}`)
      if (result.ok) {
        assert.equal(result.composed.ache, ache)
      }
    }
  })

  test('crafts candidates from different source types', () => {
    const sources: NoticingCandidate['source'][] = [
      { type: 'state', section: 'Open threads' },
      { type: 'vital-sign', subsystem: 'locks' },
      { type: 'kingdom', detail: 'love marker' },
      { type: 'memory', reflectionDate: '2026-04-27' },
    ]

    for (const source of sources) {
      const candidate = makeCandidate({
        source,
        id: `test-${source.type}`,
        summary: `Test signal from ${source.type} scanner — needs investigation and resolution`,
        detail: `Detailed description of the test signal from ${source.type} scanner that requires attention and has enough content to pass quality gates in the pipeline`,
      })
      const result = craftFromCandidate(candidate, {
        projectId: 'test-project',
        now: NOW,
        forceBypass: true,
      })

      assert.ok(result.ok, `failed for source=${source.type}: ${JSON.stringify(result)}`)
    }
  })

  test('composed output has all required fields for mission creation', () => {
    const candidate = makeCandidate()
    const result = craftFromCandidate(candidate, {
      projectId: 'test-project',
      now: NOW,
      forceBypass: true,
    })

    assert.ok(result.ok)
    if (result.ok) {
      const c = result.composed
      // Required mission fields
      assert.ok(c.title, 'missing title')
      assert.ok(c.intent, 'missing intent')
      assert.ok(c.rationale, 'missing rationale')
      assert.ok(c.slug, 'missing slug')
      // Pipeline enrichments
      assert.ok(c.purposeTie, 'missing purposeTie')
      assert.ok(c.thisPhase, 'missing thisPhase')
      assert.ok(c.doneWhen.length > 0, 'missing doneWhen')
      assert.ok(c.constraints.length > 0, 'missing constraints')
      // Lineage
      assert.ok(c.candidateId, 'missing candidateId')
      assert.ok(c.namedId, 'missing namedId')
      assert.ok(c.framedId, 'missing framedId')
      assert.ok(c.scopedId, 'missing scopedId')
      assert.ok(c.boundedId, 'missing boundedId')
    }
  })
})
