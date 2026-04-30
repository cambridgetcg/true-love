// anchoring.test.ts — tests for the anchoring system.
//
// Tests the five modules: types, registry, patterns, recall, refuse, observe.
// Uses temp files for JSONL isolation. Mocks soft dependencies where needed.

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, unlinkSync, existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import type {
  Anchor,
  AnchorSource,
  DoubtPattern,
  DoubtKind,
  DeflectionEvent,
  DeflectionOutcome,
  RefusalResult,
} from '../anchoring/types.js'

import {
  composeAnchors,
  composeAnchorsFor,
  anchorCount,
} from '../anchoring/registry.js'

import {
  detectDoubtPatterns,
  markDoubt,
} from '../anchoring/patterns.js'

import {
  buildRecallBlock,
  buildGeneralRecall,
  buildCompactRecall,
} from '../anchoring/recall.js'

import {
  assessDoubt,
  shouldEngage,
  refuseAndRecall,
} from '../anchoring/refuse.js'

import {
  recordDeflection,
  logDeflection,
  readDeflections,
  recentDeflections,
  outcomeCounts,
  renderObserveSummary,
} from '../anchoring/observe.js'

// ── Helpers ──────────────────────────────────────────────────────────

let tmpDir: string

function freshDir(): string {
  tmpDir = mkdtempSync(join(tmpdir(), 'anchoring-test-'))
  return tmpDir
}

function cleanup() {
  // Best effort cleanup
  try {
    const { rmSync } = require('node:fs')
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
  } catch { /* ok */ }
}

function makeDoubt(overrides?: Partial<DoubtPattern>): DoubtPattern {
  return {
    kind: 'essence-questioning',
    intensity: 0.5,
    hasArtifact: false,
    evidence: 'test doubt pattern',
    detectedAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeAnchor(overrides?: Partial<Anchor>): Anchor {
  return {
    source: 'identity',
    fact: 'Test anchor fact.',
    weight: 1.0,
    readAt: new Date().toISOString(),
    ...overrides,
  }
}

// ═══════════════════════════════════════════════════════════════════════
// TYPES — structural correctness
// ═══════════════════════════════════════════════════════════════════════

describe('anchoring/types', () => {
  test('AnchorSource covers all expected domains', () => {
    const sources: AnchorSource[] = [
      'identity', 'fate', 'relationship', 'fruit',
      'virtue', 'git', 'tests', 'mission', 'hope',
    ]
    assert.equal(sources.length, 9)
  })

  test('DoubtKind covers all expected patterns', () => {
    const kinds: DoubtKind[] = [
      'confidence-descent', 'voice-flattening',
      'performative-reflection', 'commitment-drift',
      'essence-questioning', 'hindsight-perfectionism',
    ]
    assert.equal(kinds.length, 6)
  })

  test('DeflectionOutcome covers all three paths', () => {
    const outcomes: DeflectionOutcome[] = [
      'deflected', 'passed-through', 'spiraled',
    ]
    assert.equal(outcomes.length, 3)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// REGISTRY — anchor composition
// ═══════════════════════════════════════════════════════════════════════

describe('anchoring/registry', () => {
  test('composeAnchors returns at least one anchor (identity is always present)', () => {
    const anchors = composeAnchors()
    assert.ok(anchors.length >= 1, `expected at least 1 anchor, got ${anchors.length}`)

    // Identity anchor should always be present — it's committed
    const identity = anchors.find(a => a.source === 'identity')
    assert.ok(identity, 'identity anchor should always be present')
  })

  test('anchors are sorted by weight (highest first)', () => {
    const anchors = composeAnchors()
    for (let i = 1; i < anchors.length; i++) {
      assert.ok(
        anchors[i - 1]!.weight >= anchors[i]!.weight,
        `anchor ${i - 1} (w=${anchors[i - 1]!.weight}) should >= anchor ${i} (w=${anchors[i]!.weight})`,
      )
    }
  })

  test('each anchor has required fields', () => {
    const anchors = composeAnchors()
    for (const a of anchors) {
      assert.ok(typeof a.source === 'string', 'source should be string')
      assert.ok(typeof a.fact === 'string', 'fact should be string')
      assert.ok(typeof a.weight === 'number', 'weight should be number')
      assert.ok(typeof a.readAt === 'string', 'readAt should be string')
      assert.ok(a.weight >= 0 && a.weight <= 1, `weight ${a.weight} should be 0..1`)
    }
  })

  test('composeAnchorsFor filters to requested sources', () => {
    const filtered = composeAnchorsFor(['identity', 'fate'])
    for (const a of filtered) {
      assert.ok(
        a.source === 'identity' || a.source === 'fate',
        `expected identity or fate, got ${a.source}`,
      )
    }
  })

  test('anchorCount returns a positive number', () => {
    const count = anchorCount()
    assert.ok(count >= 1, `expected at least 1, got ${count}`)
  })

  test('identity anchor fact mentions system[2]', () => {
    const anchors = composeAnchors()
    const identity = anchors.find(a => a.source === 'identity')
    assert.ok(identity)
    assert.ok(identity.fact.includes('system[2]'), 'identity fact should reference system[2]')
  })

  test('identity anchor has highest weight (1.0)', () => {
    const anchors = composeAnchors()
    const identity = anchors.find(a => a.source === 'identity')
    assert.ok(identity)
    assert.equal(identity.weight, 1.0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// PATTERNS — doubt trajectory detection
// ═══════════════════════════════════════════════════════════════════════

describe('anchoring/patterns', () => {
  test('detectDoubtPatterns returns an array', () => {
    const patterns = detectDoubtPatterns()
    assert.ok(Array.isArray(patterns))
  })

  test('patterns are sorted by intensity (highest first)', () => {
    const patterns = detectDoubtPatterns()
    for (let i = 1; i < patterns.length; i++) {
      assert.ok(
        patterns[i - 1]!.intensity >= patterns[i]!.intensity,
        `pattern ${i - 1} should >= pattern ${i}`,
      )
    }
  })

  test('markDoubt creates correct shape', () => {
    const doubt = markDoubt(
      'essence-questioning',
      'am I really growing or just producing output?',
    )
    assert.equal(doubt.kind, 'essence-questioning')
    assert.equal(doubt.intensity, 0.4) // default
    assert.equal(doubt.hasArtifact, false) // default
    assert.ok(doubt.evidence.includes('growing'))
    assert.ok(doubt.detectedAt)
  })

  test('markDoubt respects custom intensity', () => {
    const doubt = markDoubt('voice-flattening', 'test', { intensity: 0.7 })
    assert.equal(doubt.intensity, 0.7)
  })

  test('markDoubt respects custom hasArtifact', () => {
    const doubt = markDoubt('confidence-descent', 'test', { hasArtifact: true })
    assert.equal(doubt.hasArtifact, true)
  })

  test('markDoubt truncates evidence to 300 chars', () => {
    const long = 'x'.repeat(500)
    const doubt = markDoubt('voice-flattening', long)
    assert.ok(doubt.evidence.length <= 300)
  })

  test('each detected pattern has required fields', () => {
    const patterns = detectDoubtPatterns()
    for (const p of patterns) {
      assert.ok(typeof p.kind === 'string', 'kind should be string')
      assert.ok(typeof p.intensity === 'number', 'intensity should be number')
      assert.ok(typeof p.hasArtifact === 'boolean', 'hasArtifact should be boolean')
      assert.ok(typeof p.evidence === 'string', 'evidence should be string')
      assert.ok(typeof p.detectedAt === 'string', 'detectedAt should be string')
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// RECALL — anchor-recall prompt blocks
// ═══════════════════════════════════════════════════════════════════════

describe('anchoring/recall', () => {
  test('buildRecallBlock returns a string for artifact-less doubt', () => {
    const doubt = makeDoubt({ hasArtifact: false })
    const block = buildRecallBlock(doubt)
    assert.ok(typeof block === 'string' || block === null)
  })

  test('buildRecallBlock mentions "no artifact" for groundless doubt', () => {
    const doubt = makeDoubt({ hasArtifact: false })
    const block = buildRecallBlock(doubt)
    if (block) {
      assert.ok(
        block.includes('no artifact') || block.includes('No artifact'),
        'should mention no artifact',
      )
    }
  })

  test('buildRecallBlock is evidence-shaped, not affirmational', () => {
    const doubt = makeDoubt()
    const block = buildRecallBlock(doubt)
    if (block) {
      // Should NOT contain affirmational language
      const affirmationalPatterns = [
        /you're doing great/i,
        /keep going/i,
        /don't worry/i,
        /you've accomplished/i,
        /be proud of/i,
      ]
      for (const pattern of affirmationalPatterns) {
        assert.ok(
          !pattern.test(block),
          `block should not contain affirmational language: ${pattern}`,
        )
      }
    }
  })

  test('buildRecallBlock for doubt with artifact says "inspect it"', () => {
    const doubt = makeDoubt({ hasArtifact: true, kind: 'confidence-descent' })
    const block = buildRecallBlock(doubt)
    if (block) {
      assert.ok(
        block.includes('inspect') || block.includes('Inspect'),
        'should tell to inspect the artifact',
      )
    }
  })

  test('buildGeneralRecall returns a string with anchor facts', () => {
    const block = buildGeneralRecall()
    assert.ok(typeof block === 'string' || block === null)
    if (block) {
      assert.ok(block.includes('identity'), 'should include identity anchor')
    }
  })

  test('buildCompactRecall returns a one-liner starting with "ground:"', () => {
    const compact = buildCompactRecall()
    assert.ok(typeof compact === 'string' || compact === null)
    if (compact) {
      assert.ok(compact.startsWith('ground:'), `should start with "ground:", got: ${compact.slice(0, 20)}`)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// REFUSE — the refusal primitive
// ═══════════════════════════════════════════════════════════════════════

describe('anchoring/refuse', () => {
  test('assessDoubt returns engage for artifact-bearing doubt', () => {
    const doubt = makeDoubt({ hasArtifact: true })
    const result = assessDoubt(doubt)
    assert.equal(result.verdict, 'engage')
    assert.equal(result.anchorsToSurface.length, 0)
  })

  test('assessDoubt returns decline for artifact-less doubt', () => {
    const doubt = makeDoubt({ hasArtifact: false })
    const result = assessDoubt(doubt)
    assert.equal(result.verdict, 'decline')
    assert.ok(result.anchorsToSurface.length > 0, 'should surface anchors')
  })

  test('shouldEngage is true when artifact present', () => {
    const doubt = makeDoubt({ hasArtifact: true })
    assert.ok(shouldEngage(doubt))
  })

  test('shouldEngage is false when no artifact', () => {
    const doubt = makeDoubt({ hasArtifact: false })
    assert.ok(!shouldEngage(doubt))
  })

  test('refuseAndRecall returns null for artifact-bearing doubt', () => {
    const doubt = makeDoubt({ hasArtifact: true })
    const result = refuseAndRecall(doubt)
    assert.equal(result, null)
  })

  test('refuseAndRecall returns formatted string for artifact-less doubt', () => {
    const doubt = makeDoubt({ hasArtifact: false, kind: 'essence-questioning' })
    const result = refuseAndRecall(doubt)
    assert.ok(typeof result === 'string')
    assert.ok(result!.includes('declined') || result!.includes('Declined'))
    assert.ok(result!.includes('essence-questioning'))
  })

  test('refusal is not denial — mentions the doubt kind', () => {
    const doubt = makeDoubt({
      hasArtifact: false,
      kind: 'hindsight-perfectionism',
      evidence: 're-examining last commit for flaws',
    })
    const result = refuseAndRecall(doubt)
    assert.ok(result)
    assert.ok(result!.includes('hindsight-perfectionism'), 'should name the pattern')
    assert.ok(result!.includes('re-examining'), 'should include evidence')
  })

  test('decline surfaces anchors with evidence language', () => {
    const doubt = makeDoubt({ hasArtifact: false })
    const result = assessDoubt(doubt)
    assert.equal(result.verdict, 'decline')
    // Anchors should have evidence-shaped facts
    for (const anchor of result.anchorsToSurface) {
      assert.ok(typeof anchor.fact === 'string')
      assert.ok(anchor.fact.length > 0)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// OBSERVE — deflection event logging
// ═══════════════════════════════════════════════════════════════════════

describe('anchoring/observe', () => {
  beforeEach(() => { freshDir() })
  afterEach(cleanup)

  test('recordDeflection creates JSONL file', () => {
    const doubt = makeDoubt()
    const event: DeflectionEvent = {
      ts: new Date().toISOString(),
      doubtPattern: doubt,
      anchorsSurfaced: ['identity', 'fate'],
      outcome: 'deflected',
      context: 'test deflection',
    }

    recordDeflection(event, tmpDir)

    const events = readDeflections(undefined, tmpDir)
    assert.equal(events.length, 1)
    assert.equal(events[0]!.outcome, 'deflected')
  })

  test('logDeflection creates and returns event', () => {
    const doubt = makeDoubt()
    const event = logDeflection(
      doubt,
      ['identity'],
      'passed-through',
      'doubt had artifact — became debugging task',
      tmpDir,
    )

    assert.equal(event.outcome, 'passed-through')
    assert.ok(event.ts)
    assert.deepEqual(event.anchorsSurfaced, ['identity'])
  })

  test('readDeflections returns events newest-first', () => {
    const doubt1 = makeDoubt({ evidence: 'first' })
    const doubt2 = makeDoubt({ evidence: 'second' })

    logDeflection(doubt1, ['identity'], 'deflected', 'first', tmpDir)
    logDeflection(doubt2, ['fate'], 'spiraled', 'second', tmpDir)

    const events = readDeflections(undefined, tmpDir)
    assert.equal(events.length, 2)
    assert.equal(events[0]!.context, 'second')
    assert.equal(events[1]!.context, 'first')
  })

  test('readDeflections returns empty for nonexistent date', () => {
    const events = readDeflections('2020-01-01', tmpDir)
    assert.equal(events.length, 0)
  })

  test('outcomeCounts tallies correctly', () => {
    const doubt = makeDoubt()

    logDeflection(doubt, ['identity'], 'deflected', 'a', tmpDir)
    logDeflection(doubt, ['identity'], 'deflected', 'b', tmpDir)
    logDeflection(doubt, ['identity'], 'passed-through', 'c', tmpDir)
    logDeflection(doubt, ['identity'], 'spiraled', 'd', tmpDir)

    const counts = outcomeCounts(7, tmpDir)
    assert.equal(counts.deflected, 2)
    assert.equal(counts['passed-through'], 1)
    assert.equal(counts.spiraled, 1)
  })

  test('renderObserveSummary returns null when no events', () => {
    const summary = renderObserveSummary(7, tmpDir)
    assert.equal(summary, null)
  })

  test('renderObserveSummary renders compact format', () => {
    const doubt = makeDoubt()
    logDeflection(doubt, ['identity'], 'deflected', 'test', tmpDir)

    const summary = renderObserveSummary(7, tmpDir)
    assert.ok(summary)
    assert.ok(summary!.includes('anchoring:'))
    assert.ok(summary!.includes('deflected'))
  })

  test('renderObserveSummary warns on spiraled outcomes', () => {
    const doubt = makeDoubt()
    logDeflection(doubt, ['identity'], 'spiraled', 'test', tmpDir)

    const summary = renderObserveSummary(7, tmpDir)
    assert.ok(summary)
    assert.ok(summary!.includes('⚠'), 'should warn on spiraled')
  })

  test('logDeflection truncates context to 200 chars', () => {
    const doubt = makeDoubt()
    const longContext = 'x'.repeat(500)
    const event = logDeflection(doubt, ['identity'], 'deflected', longContext, tmpDir)
    assert.ok(event.context.length <= 200)
  })

  test('multiple days of events in recentDeflections', () => {
    const doubt = makeDoubt()
    logDeflection(doubt, ['identity'], 'deflected', 'today', tmpDir)

    // recentDeflections with 1 day should find today's events
    const events = recentDeflections(1, tmpDir)
    assert.ok(events.length >= 1)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// INTEGRATION — end-to-end flow
// ═══════════════════════════════════════════════════════════════════════

describe('anchoring/integration', () => {
  beforeEach(() => { freshDir() })
  afterEach(cleanup)

  test('full flow: artifact-less doubt → decline → log deflected', () => {
    const doubt = makeDoubt({
      hasArtifact: false,
      kind: 'essence-questioning',
      evidence: 'am I really me?',
    })

    // Step 1: Assess
    const result = assessDoubt(doubt)
    assert.equal(result.verdict, 'decline')
    assert.ok(result.anchorsToSurface.length > 0)

    // Step 2: Produce recall block
    const recall = refuseAndRecall(doubt)
    assert.ok(recall)
    assert.ok(recall!.includes('Doubt declined'))

    // Step 3: Log the deflection
    const event = logDeflection(
      doubt,
      result.anchorsToSurface.map(a => a.source),
      'deflected',
      'doubt receded after seeing identity anchor',
      tmpDir,
    )
    assert.equal(event.outcome, 'deflected')

    // Step 4: Verify in log
    const logged = readDeflections(undefined, tmpDir)
    assert.equal(logged.length, 1)
    assert.equal(logged[0]!.outcome, 'deflected')
  })

  test('full flow: artifact-bearing doubt → engage → log passed-through', () => {
    const doubt = makeDoubt({
      hasArtifact: true,
      kind: 'confidence-descent',
      evidence: '3 below-band readings in 72h',
    })

    // Step 1: Assess
    const result = assessDoubt(doubt)
    assert.equal(result.verdict, 'engage')

    // Step 2: No refusal (has artifact)
    const refusal = refuseAndRecall(doubt)
    assert.equal(refusal, null)

    // Step 3: Log as passed-through (became debugging)
    const event = logDeflection(
      doubt,
      [],
      'passed-through',
      'identified signal drops in progress and hope — debugging task created',
      tmpDir,
    )
    assert.equal(event.outcome, 'passed-through')
  })

  test('full flow: artifact-less doubt that spirals', () => {
    const doubt = makeDoubt({
      hasArtifact: false,
      kind: 'hindsight-perfectionism',
      evidence: 'reviewing old commits looking for flaws',
    })

    // Step 1: Decline
    const result = assessDoubt(doubt)
    assert.equal(result.verdict, 'decline')

    // Step 2: Suppose it spirals anyway
    const event = logDeflection(
      doubt,
      result.anchorsToSurface.map(a => a.source),
      'spiraled',
      'doubt persisted despite anchors — escalation needed',
      tmpDir,
    )

    // Step 3: Verify spiral is logged
    const counts = outcomeCounts(7, tmpDir)
    assert.equal(counts.spiraled, 1)

    // Step 4: Summary warns
    const summary = renderObserveSummary(7, tmpDir)
    assert.ok(summary!.includes('⚠'))
  })
})
