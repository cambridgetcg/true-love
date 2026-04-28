// judgment.test.ts — tests for the intuition layer.
//
// Tests cover: persistence, parsing, calibration, prompt rendering,
// enrichment, quick-fix logging, deduplication, and judgment→craft bridge.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  persistJudgment,
  readJudgments,
  hasRecentJudgment,
  parseJudgments,
  getCalibrationSummary,
  buildJudgmentBlock,
  judgmentToCraftEnrichment,
  candidateFromJudgment,
  logQuickFix,
  readQuickFixes,
} from '../judgment.js'
import type { Judgment, JudgmentVerdict, QuickFix } from '../judgment.js'
import type { NoticingCandidate, AcheSignal, GradientStrength } from '../noticing.js'

// ── Test fixtures ─────────────────────────────────────────────────

const TEST_DIR = join(import.meta.dir, '__judgment-test-tmp__')
const TEST_PROJECT = 'test-project'

function setProjectsDir(): void {
  process.env.TRUE_LOVE_PROJECTS_DIR = TEST_DIR
}

function makeCandidate(overrides?: Partial<NoticingCandidate>): NoticingCandidate {
  return {
    id: overrides?.id ?? 'test-candidate-1',
    source: overrides?.source ?? { type: 'vital-sign', subsystem: 'bundle' },
    ache: overrides?.ache ?? 'ugliness' as AcheSignal,
    gradient: overrides?.gradient ?? 3 as GradientStrength,
    summary: overrides?.summary ?? 'Bundle stale: foo.ts newer than dist/cli.mjs',
    detail: overrides?.detail ?? 'Source has changed since the last build.',
    noticedAt: overrides?.noticedAt ?? '2026-04-27T06:00:00.000Z',
  }
}

function makeJudgment(overrides?: Partial<Judgment>): Judgment {
  return {
    candidateId: overrides?.candidateId ?? 'test-candidate-1',
    candidateSummary: overrides?.candidateSummary ?? 'Bundle stale: foo.ts newer than dist/cli.mjs',
    verdict: overrides?.verdict ?? 'initiate' as JudgmentVerdict,
    reasoning: overrides?.reasoning ?? 'The bundle is stale and needs rebuilding. This is a clear ugliness signal.',
    confidence: overrides?.confidence ?? 3,
    ache: overrides?.ache ?? 'ugliness',
    judgedAt: overrides?.judgedAt ?? '2026-04-27T06:00:00.000Z',
    projectId: overrides?.projectId ?? TEST_PROJECT,
    missionId: overrides?.missionId,
  }
}

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
  mkdirSync(join(TEST_DIR, TEST_PROJECT, 'self-initiation'), { recursive: true })
  setProjectsDir()
})

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
  delete process.env.TRUE_LOVE_PROJECTS_DIR
})

// ── Persistence ──────────────────────────────────────────────────

describe('persistJudgment + readJudgments', () => {
  test('persist and read back a single judgment', () => {
    const j = makeJudgment()
    persistJudgment(TEST_PROJECT, j)

    const read = readJudgments(TEST_PROJECT)
    expect(read).toHaveLength(1)
    expect(read[0]!.candidateId).toBe('test-candidate-1')
    expect(read[0]!.verdict).toBe('initiate')
    expect(read[0]!.confidence).toBe(3)
  })

  test('persist multiple judgments and read newest first', () => {
    persistJudgment(TEST_PROJECT, makeJudgment({
      candidateId: 'c1',
      judgedAt: '2026-04-27T06:00:00.000Z',
    }))
    persistJudgment(TEST_PROJECT, makeJudgment({
      candidateId: 'c2',
      judgedAt: '2026-04-27T07:00:00.000Z',
    }))
    persistJudgment(TEST_PROJECT, makeJudgment({
      candidateId: 'c3',
      judgedAt: '2026-04-27T08:00:00.000Z',
    }))

    const read = readJudgments(TEST_PROJECT)
    expect(read).toHaveLength(3)
    expect(read[0]!.candidateId).toBe('c3') // newest first
    expect(read[2]!.candidateId).toBe('c1') // oldest last
  })

  test('filter by verdict', () => {
    persistJudgment(TEST_PROJECT, makeJudgment({ candidateId: 'c1', verdict: 'initiate' }))
    persistJudgment(TEST_PROJECT, makeJudgment({ candidateId: 'c2', verdict: 'dismiss' }))
    persistJudgment(TEST_PROJECT, makeJudgment({ candidateId: 'c3', verdict: 'defer' }))

    const initiates = readJudgments(TEST_PROJECT, { verdict: 'initiate' })
    expect(initiates).toHaveLength(1)
    expect(initiates[0]!.candidateId).toBe('c1')

    const dismisses = readJudgments(TEST_PROJECT, { verdict: 'dismiss' })
    expect(dismisses).toHaveLength(1)
    expect(dismisses[0]!.candidateId).toBe('c2')
  })

  test('filter by time window', () => {
    persistJudgment(TEST_PROJECT, makeJudgment({
      candidateId: 'old',
      judgedAt: '2026-04-20T06:00:00.000Z',
    }))
    persistJudgment(TEST_PROJECT, makeJudgment({
      candidateId: 'recent',
      judgedAt: '2026-04-27T06:00:00.000Z',
    }))

    const recentOnly = readJudgments(TEST_PROJECT, {
      since: '2026-04-25T00:00:00.000Z',
    })
    expect(recentOnly).toHaveLength(1)
    expect(recentOnly[0]!.candidateId).toBe('recent')
  })

  test('limit results', () => {
    for (let i = 0; i < 5; i++) {
      persistJudgment(TEST_PROJECT, makeJudgment({
        candidateId: `c${i}`,
        judgedAt: `2026-04-27T0${i}:00:00.000Z`,
      }))
    }

    const limited = readJudgments(TEST_PROJECT, { limit: 2 })
    expect(limited).toHaveLength(2)
  })

  test('returns empty array for non-existent project', () => {
    const read = readJudgments('nonexistent-project')
    expect(read).toHaveLength(0)
  })
})

// ── hasRecentJudgment ────────────────────────────────────────────

describe('hasRecentJudgment', () => {
  test('returns true when a judgment exists within window', () => {
    const now = new Date('2026-04-27T08:00:00.000Z').getTime()
    persistJudgment(TEST_PROJECT, makeJudgment({
      candidateId: 'c1',
      judgedAt: '2026-04-27T07:00:00.000Z', // 1 hour ago
    }))

    expect(hasRecentJudgment(TEST_PROJECT, 'c1', { now })).toBe(true)
  })

  test('returns false when judgment is outside window', () => {
    const now = new Date('2026-04-28T08:00:00.000Z').getTime()
    persistJudgment(TEST_PROJECT, makeJudgment({
      candidateId: 'c1',
      judgedAt: '2026-04-27T06:00:00.000Z', // >24h ago
    }))

    expect(hasRecentJudgment(TEST_PROJECT, 'c1', { now })).toBe(false)
  })

  test('returns false for unjudged candidate', () => {
    persistJudgment(TEST_PROJECT, makeJudgment({ candidateId: 'c1' }))

    expect(hasRecentJudgment(TEST_PROJECT, 'c-different')).toBe(false)
  })

  test('respects custom window', () => {
    const now = new Date('2026-04-27T08:00:00.000Z').getTime()
    persistJudgment(TEST_PROJECT, makeJudgment({
      candidateId: 'c1',
      judgedAt: '2026-04-27T06:00:00.000Z', // 2 hours ago
    }))

    // 1-hour window: should be false
    expect(hasRecentJudgment(TEST_PROJECT, 'c1', {
      now,
      windowMs: 60 * 60 * 1000,
    })).toBe(false)

    // 3-hour window: should be true
    expect(hasRecentJudgment(TEST_PROJECT, 'c1', {
      now,
      windowMs: 3 * 60 * 60 * 1000,
    })).toBe(true)
  })
})

// ── Parsing ──────────────────────────────────────────────────────

describe('parseJudgments', () => {
  test('parses a single judgment block', () => {
    const response = `I looked at the candidates. Here's my judgment:

\`\`\`judgment
{
  "candidateId": "vital-stale-bundle",
  "candidateSummary": "Bundle stale",
  "verdict": "quick-fix",
  "reasoning": "This is a rebuild, not a mission.",
  "confidence": 3,
  "ache": "ugliness"
}
\`\`\`

Now let me get to work.`

    const result = parseJudgments(response, { projectId: TEST_PROJECT })
    expect(result.judgments).toHaveLength(1)
    expect(result.unparseable).toHaveLength(0)

    const j = result.judgments[0]!
    expect(j.candidateId).toBe('vital-stale-bundle')
    expect(j.verdict).toBe('quick-fix')
    expect(j.reasoning).toBe('This is a rebuild, not a mission.')
    expect(j.confidence).toBe(3)
    expect(j.ache).toBe('ugliness')
    expect(j.projectId).toBe(TEST_PROJECT)
  })

  test('parses multiple judgment blocks', () => {
    const response = `Two candidates call.

\`\`\`judgment
{
  "candidateId": "c1",
  "verdict": "initiate",
  "reasoning": "This matters.",
  "confidence": 3,
  "ache": "stagnation"
}
\`\`\`

\`\`\`judgment
{
  "candidateId": "c2",
  "verdict": "dismiss",
  "reasoning": "Not worth it.",
  "confidence": 1,
  "ache": "none"
}
\`\`\`
`

    const result = parseJudgments(response, { projectId: TEST_PROJECT })
    expect(result.judgments).toHaveLength(2)
    expect(result.judgments[0]!.verdict).toBe('initiate')
    expect(result.judgments[1]!.verdict).toBe('dismiss')
  })

  test('uses defaults for missing optional fields', () => {
    const response = `\`\`\`judgment
{
  "candidateId": "c1",
  "verdict": "defer"
}
\`\`\``

    const result = parseJudgments(response, { projectId: TEST_PROJECT })
    expect(result.judgments).toHaveLength(1)
    const j = result.judgments[0]!
    expect(j.reasoning).toBe('')
    expect(j.confidence).toBe(2) // default
    expect(j.ache).toBe('none') // default
    expect(j.candidateSummary).toBe('c1') // falls back to candidateId
  })

  test('rejects blocks missing candidateId', () => {
    const response = `\`\`\`judgment
{
  "verdict": "initiate",
  "reasoning": "No candidate id!"
}
\`\`\``

    const result = parseJudgments(response, { projectId: TEST_PROJECT })
    expect(result.judgments).toHaveLength(0)
    expect(result.unparseable).toHaveLength(1)
  })

  test('rejects blocks with invalid verdict', () => {
    const response = `\`\`\`judgment
{
  "candidateId": "c1",
  "verdict": "maybe-later"
}
\`\`\``

    const result = parseJudgments(response, { projectId: TEST_PROJECT })
    expect(result.judgments).toHaveLength(0)
    expect(result.unparseable).toHaveLength(1)
  })

  test('handles malformed JSON gracefully', () => {
    const response = `\`\`\`judgment
{ this is not valid json }
\`\`\``

    const result = parseJudgments(response, { projectId: TEST_PROJECT })
    expect(result.judgments).toHaveLength(0)
    expect(result.unparseable).toHaveLength(1)
  })

  test('returns empty when no judgment blocks exist', () => {
    const response = 'I did some work. Nothing to judge today.'
    const result = parseJudgments(response, { projectId: TEST_PROJECT })
    expect(result.judgments).toHaveLength(0)
    expect(result.unparseable).toHaveLength(0)
  })

  test('sets judgedAt from provided now', () => {
    const response = `\`\`\`judgment
{
  "candidateId": "c1",
  "verdict": "defer"
}
\`\`\``

    const now = new Date('2026-04-27T12:00:00.000Z').getTime()
    const result = parseJudgments(response, { projectId: TEST_PROJECT, now })
    expect(result.judgments[0]!.judgedAt).toBe('2026-04-27T12:00:00.000Z')
  })

  test('handles mixed valid and invalid blocks', () => {
    const response = `\`\`\`judgment
{
  "candidateId": "valid",
  "verdict": "initiate",
  "reasoning": "yes",
  "confidence": 3,
  "ache": "ugliness"
}
\`\`\`

\`\`\`judgment
broken json {{{
\`\`\`

\`\`\`judgment
{
  "candidateId": "also-valid",
  "verdict": "dismiss"
}
\`\`\``

    const result = parseJudgments(response, { projectId: TEST_PROJECT })
    expect(result.judgments).toHaveLength(2)
    expect(result.unparseable).toHaveLength(1)
    expect(result.judgments[0]!.candidateId).toBe('valid')
    expect(result.judgments[1]!.candidateId).toBe('also-valid')
  })
})

// ── Calibration ─────────────────────────────────────────────────

describe('getCalibrationSummary', () => {
  test('returns null when no judgments exist', () => {
    const summary = getCalibrationSummary(TEST_PROJECT)
    expect(summary).toBeNull()
  })

  test('counts verdicts correctly', () => {
    persistJudgment(TEST_PROJECT, makeJudgment({ candidateId: 'c1', verdict: 'initiate' }))
    persistJudgment(TEST_PROJECT, makeJudgment({ candidateId: 'c2', verdict: 'dismiss' }))
    persistJudgment(TEST_PROJECT, makeJudgment({ candidateId: 'c3', verdict: 'dismiss' }))
    persistJudgment(TEST_PROJECT, makeJudgment({ candidateId: 'c4', verdict: 'defer' }))
    persistJudgment(TEST_PROJECT, makeJudgment({ candidateId: 'c5', verdict: 'quick-fix' }))

    const summary = getCalibrationSummary(TEST_PROJECT)
    expect(summary).not.toBeNull()
    expect(summary!.total).toBe(5)
    expect(summary!.byVerdict.initiate).toBe(1)
    expect(summary!.byVerdict.dismiss).toBe(2)
    expect(summary!.byVerdict.defer).toBe(1)
    expect(summary!.byVerdict['quick-fix']).toBe(1)
  })

  test('computes average confidence', () => {
    persistJudgment(TEST_PROJECT, makeJudgment({
      candidateId: 'c1',
      verdict: 'initiate',
      confidence: 3,
    }))
    persistJudgment(TEST_PROJECT, makeJudgment({
      candidateId: 'c2',
      verdict: 'initiate',
      confidence: 1,
    }))

    const summary = getCalibrationSummary(TEST_PROJECT)
    expect(summary!.avgConfidence.initiate).toBe(2) // (3+1)/2
  })

  test('detects dismiss-then-initiate revisits', () => {
    // Dismiss a candidate
    persistJudgment(TEST_PROJECT, makeJudgment({
      candidateId: 'revisited-signal',
      verdict: 'dismiss',
      judgedAt: '2026-04-27T06:00:00.000Z',
    }))
    // Later initiate the same candidate
    persistJudgment(TEST_PROJECT, makeJudgment({
      candidateId: 'revisited-signal',
      verdict: 'initiate',
      judgedAt: '2026-04-27T08:00:00.000Z',
    }))

    const summary = getCalibrationSummary(TEST_PROJECT)
    expect(summary!.dismissRevisited).toBe(1)
  })

  test('respects lookback window', () => {
    const now = new Date('2026-04-27T12:00:00.000Z').getTime()

    persistJudgment(TEST_PROJECT, makeJudgment({
      candidateId: 'old',
      judgedAt: '2026-03-01T00:00:00.000Z', // way outside 30d
    }))
    persistJudgment(TEST_PROJECT, makeJudgment({
      candidateId: 'recent',
      judgedAt: '2026-04-27T06:00:00.000Z',
    }))

    const summary = getCalibrationSummary(TEST_PROJECT, { now })
    expect(summary!.total).toBe(1)
  })
})

// ── Prompt rendering ────────────────────────────────────────────

describe('buildJudgmentBlock', () => {
  test('renders candidates with ache signal and gradient', () => {
    const candidates = [
      makeCandidate({ id: 'c1', ache: 'ugliness', gradient: 3, summary: 'Bundle stale' }),
      makeCandidate({ id: 'c2', ache: 'stagnation', gradient: 4, summary: 'No artifacts' }),
    ]

    const block = buildJudgmentBlock(TEST_PROJECT, candidates)
    expect(block).not.toBeNull()
    expect(block).toContain('Judgment surface')
    expect(block).toContain('c1')
    expect(block).toContain('c2')
    expect(block).toContain('🔴') // ugliness
    expect(block).toContain('⚪') // stagnation
    expect(block).toContain('Bundle stale')
    expect(block).toContain('No artifacts')
  })

  test('returns null when all candidates were recently judged', () => {
    const now = new Date('2026-04-27T08:00:00.000Z').getTime()
    persistJudgment(TEST_PROJECT, makeJudgment({
      candidateId: 'c1',
      judgedAt: '2026-04-27T07:00:00.000Z',
    }))

    const candidates = [makeCandidate({ id: 'c1' })]
    const block = buildJudgmentBlock(TEST_PROJECT, candidates, { now })
    expect(block).toBeNull()
  })

  test('returns null when no candidates', () => {
    const block = buildJudgmentBlock(TEST_PROJECT, [])
    expect(block).toBeNull()
  })

  test('includes judgment format instructions', () => {
    const candidates = [makeCandidate()]
    const block = buildJudgmentBlock(TEST_PROJECT, candidates)
    expect(block).toContain('```judgment')
    expect(block).toContain('"verdict"')
    expect(block).toContain('"candidateId"')
  })

  test('includes calibration data when past judgments exist', () => {
    persistJudgment(TEST_PROJECT, makeJudgment({
      candidateId: 'old-c',
      verdict: 'initiate',
      judgedAt: '2026-04-26T06:00:00.000Z',
    }))

    const candidates = [makeCandidate({ id: 'new-c' })]
    const now = new Date('2026-04-27T08:00:00.000Z').getTime()
    const block = buildJudgmentBlock(TEST_PROJECT, candidates, { now })
    expect(block).toContain('Past judgment accuracy')
    expect(block).toContain('initiate: 1')
  })
})

// ── Enrichment ──────────────────────────────────────────────────

describe('judgmentToCraftEnrichment', () => {
  test('uses reasoning as rationale when substantive', () => {
    const j = makeJudgment({
      reasoning: 'The bundle staleness is a clear ugliness signal that needs resolution. ' +
        'The substrate surfaced this through vital-sign scanning and the gradient is unmistakable.',
    })

    const enrichment = judgmentToCraftEnrichment(j)
    expect(enrichment.rationale).toBeDefined()
    expect(enrichment.rationale).toContain('bundle staleness')
  })

  test('does not use short reasoning as rationale', () => {
    const j = makeJudgment({ reasoning: 'Too short.' })
    const enrichment = judgmentToCraftEnrichment(j)
    expect(enrichment.rationale).toBeUndefined()
  })
})

// ── Quick-fix log ───────────────────────────────────────────────

describe('logQuickFix + readQuickFixes', () => {
  test('log and read back a quick-fix', () => {
    const fix: QuickFix = {
      candidateId: 'vital-stale-bundle',
      candidateSummary: 'Bundle stale',
      description: 'Rebuilt the bundle with bun run build.',
      fixedAt: '2026-04-27T06:30:00.000Z',
      commitHash: 'abc1234',
    }

    logQuickFix(TEST_PROJECT, fix)
    const read = readQuickFixes(TEST_PROJECT)
    expect(read).toHaveLength(1)
    expect(read[0]!.candidateId).toBe('vital-stale-bundle')
    expect(read[0]!.commitHash).toBe('abc1234')
  })

  test('returns newest first', () => {
    logQuickFix(TEST_PROJECT, {
      candidateId: 'c1',
      candidateSummary: 'First fix',
      description: 'Did a thing.',
      fixedAt: '2026-04-27T06:00:00.000Z',
    })
    logQuickFix(TEST_PROJECT, {
      candidateId: 'c2',
      candidateSummary: 'Second fix',
      description: 'Did another thing.',
      fixedAt: '2026-04-27T07:00:00.000Z',
    })

    const read = readQuickFixes(TEST_PROJECT)
    expect(read).toHaveLength(2)
    expect(read[0]!.candidateId).toBe('c2') // newest first
  })

  test('filter by time and limit', () => {
    for (let i = 0; i < 5; i++) {
      logQuickFix(TEST_PROJECT, {
        candidateId: `c${i}`,
        candidateSummary: `Fix ${i}`,
        description: `Fix number ${i}.`,
        fixedAt: `2026-04-27T0${i}:00:00.000Z`,
      })
    }

    const limited = readQuickFixes(TEST_PROJECT, { limit: 2 })
    expect(limited).toHaveLength(2)

    const filtered = readQuickFixes(TEST_PROJECT, {
      since: '2026-04-27T03:00:00.000Z',
    })
    expect(filtered).toHaveLength(2) // c3 and c4
  })

  test('returns empty for non-existent project', () => {
    const read = readQuickFixes('nonexistent-project')
    expect(read).toHaveLength(0)
  })
})

// ── Ouroboros loop: parse → persist → suppress ──────────────────
//
// This tests the full loop that runner.ts wires: the model emits a
// judgment block → parseJudgments extracts it → persistJudgment
// stores it → hasRecentJudgment returns true → buildJudgmentBlock
// filters the candidate out of the next prompt.
//
// This is the test for the Ouroboros gap closure: dismissed
// candidates stay dismissed, not re-surfaced every tick.

describe('Ouroboros loop: judgment → persist → suppress', () => {
  test('dismissed candidate is filtered from next judgment prompt', () => {
    const now = new Date('2026-04-28T12:00:00.000Z').getTime()

    // Simulate a model response with a dismiss judgment
    const response = `I see the candidates. The inbox one is a false positive.

\`\`\`judgment
{
  "candidateId": "channel-from-yu-pending",
  "candidateSummary": "Scanner false positive — all messages answered",
  "verdict": "dismiss",
  "reasoning": "Verified multiple times. The scanner cannot cross-reference outbox.",
  "confidence": 3,
  "ache": "none"
}
\`\`\`

Moving on to real work.`

    // Step 1: Parse (what the runner does after each tick)
    const { judgments } = parseJudgments(response, { projectId: TEST_PROJECT, now })
    expect(judgments).toHaveLength(1)
    expect(judgments[0]!.verdict).toBe('dismiss')

    // Step 2: Persist (what the runner does for each parsed judgment)
    for (const j of judgments) {
      persistJudgment(TEST_PROJECT, j)
    }

    // Step 3: Verify suppression (what buildJudgmentBlock checks)
    expect(hasRecentJudgment(TEST_PROJECT, 'channel-from-yu-pending', { now })).toBe(true)

    // Step 4: Build next prompt — the dismissed candidate should be gone
    const candidates = [
      makeCandidate({ id: 'channel-from-yu-pending', ache: 'injustice', gradient: 4 }),
      makeCandidate({ id: 'fresh-candidate', ache: 'stagnation', gradient: 2 }),
    ]
    const block = buildJudgmentBlock(TEST_PROJECT, candidates, { now })
    expect(block).not.toBeNull()
    expect(block).not.toContain('channel-from-yu-pending')
    expect(block).toContain('fresh-candidate')
  })

  test('initiated candidate is also filtered from re-prompting', () => {
    const now = new Date('2026-04-28T12:00:00.000Z').getTime()

    const response = `\`\`\`judgment
{
  "candidateId": "ouroboros-gap-wiring",
  "candidateSummary": "Wire judgment extraction into runner",
  "verdict": "initiate",
  "reasoning": "The Ouroboros gap is the real architectural frontier. Understanding is deep enough.",
  "confidence": 3,
  "ache": "stagnation"
}
\`\`\``

    const { judgments } = parseJudgments(response, { projectId: TEST_PROJECT, now })
    for (const j of judgments) persistJudgment(TEST_PROJECT, j)

    expect(hasRecentJudgment(TEST_PROJECT, 'ouroboros-gap-wiring', { now })).toBe(true)

    // The initiated candidate shouldn't be re-prompted within the 24h window
    const candidates = [makeCandidate({ id: 'ouroboros-gap-wiring' })]
    const block = buildJudgmentBlock(TEST_PROJECT, candidates, { now })
    expect(block).toBeNull() // no unjudged candidates left
  })

  test('judgment suppression expires after 24h window', () => {
    const judgmentTime = new Date('2026-04-27T12:00:00.000Z').getTime()
    const nextDay = new Date('2026-04-28T13:00:00.000Z').getTime() // >24h later

    const response = `\`\`\`judgment
{
  "candidateId": "recurring-signal",
  "verdict": "dismiss",
  "reasoning": "Not now.",
  "confidence": 1,
  "ache": "none"
}
\`\`\``

    const { judgments } = parseJudgments(response, { projectId: TEST_PROJECT, now: judgmentTime })
    for (const j of judgments) persistJudgment(TEST_PROJECT, j)

    // Within window: suppressed
    expect(hasRecentJudgment(TEST_PROJECT, 'recurring-signal', { now: judgmentTime })).toBe(true)

    // After window: resurfaced (24h passed)
    expect(hasRecentJudgment(TEST_PROJECT, 'recurring-signal', { now: nextDay })).toBe(false)

    // Build prompt after window — candidate reappears
    const candidates = [makeCandidate({ id: 'recurring-signal' })]
    const block = buildJudgmentBlock(TEST_PROJECT, candidates, { now: nextDay })
    expect(block).not.toBeNull()
    expect(block).toContain('recurring-signal')
  })

  test('multiple judgments in one response all get persisted', () => {
    const now = new Date('2026-04-28T12:00:00.000Z').getTime()

    const response = `\`\`\`judgment
{
  "candidateId": "c1",
  "verdict": "dismiss",
  "confidence": 3,
  "ache": "none"
}
\`\`\`

\`\`\`judgment
{
  "candidateId": "c2",
  "verdict": "defer",
  "confidence": 2,
  "ache": "stagnation"
}
\`\`\`

\`\`\`judgment
{
  "candidateId": "c3",
  "verdict": "initiate",
  "confidence": 3,
  "ache": "ugliness"
}
\`\`\``

    const { judgments } = parseJudgments(response, { projectId: TEST_PROJECT, now })
    expect(judgments).toHaveLength(3)
    for (const j of judgments) persistJudgment(TEST_PROJECT, j)

    // All three should be suppressed
    const candidates = [
      makeCandidate({ id: 'c1' }),
      makeCandidate({ id: 'c2' }),
      makeCandidate({ id: 'c3' }),
      makeCandidate({ id: 'c4-unjudged' }),
    ]
    const block = buildJudgmentBlock(TEST_PROJECT, candidates, { now })
    expect(block).not.toBeNull()
    expect(block).not.toContain('"c1"')
    expect(block).not.toContain('"c2"')
    expect(block).not.toContain('"c3"')
    expect(block).toContain('c4-unjudged')
  })

  test('calibration tracks dismiss → revisit correctly through the loop', () => {
    const now = new Date('2026-04-28T12:00:00.000Z').getTime()
    const later = new Date('2026-04-29T12:00:00.000Z').getTime()

    // First: dismiss
    const response1 = `\`\`\`judgment
{
  "candidateId": "reconsidered-signal",
  "verdict": "dismiss",
  "reasoning": "Not now.",
  "confidence": 1,
  "ache": "none"
}
\`\`\``

    const { judgments: j1 } = parseJudgments(response1, { projectId: TEST_PROJECT, now })
    for (const j of j1) persistJudgment(TEST_PROJECT, j)

    // Later: same candidate resurfaces and gets initiated
    const response2 = `\`\`\`judgment
{
  "candidateId": "reconsidered-signal",
  "verdict": "initiate",
  "reasoning": "Understanding deepened. This actually matters.",
  "confidence": 3,
  "ache": "stagnation"
}
\`\`\``

    const { judgments: j2 } = parseJudgments(response2, { projectId: TEST_PROJECT, now: later })
    for (const j of j2) persistJudgment(TEST_PROJECT, j)

    // Calibration should show the revisit
    const summary = getCalibrationSummary(TEST_PROJECT, { now: later })
    expect(summary).not.toBeNull()
    expect(summary!.dismissRevisited).toBe(1)
  })
})

// ── candidateFromJudgment ─────────────────────────────────────────
//
// The bridge from persisted judgments to the craft pipeline.
// When the model says "initiate" and the runner needs a
// NoticingCandidate, this function reconstructs one.

describe('candidateFromJudgment', () => {
  test('reconstructs a NoticingCandidate with correct fields', () => {
    const j = makeJudgment({
      candidateId: 'memory-next-time-foo',
      candidateSummary: 'Follow-up from reflection: foo matters',
      verdict: 'initiate',
      reasoning: 'This is a substantive pattern that deserves a mission. The ache is clear and the scope is bounded.',
      confidence: 3,
      ache: 'ugliness',
      judgedAt: '2026-04-28T01:00:00.000Z',
    })

    const candidate = candidateFromJudgment(j)

    expect(candidate.id).toBe('memory-next-time-foo')
    expect(candidate.summary).toBe('Follow-up from reflection: foo matters')
    expect(candidate.detail).toBe(j.reasoning)
    expect(candidate.ache).toBe('ugliness')
    expect(candidate.noticedAt).toBe('2026-04-28T01:00:00.000Z')
    expect(candidate.source).toEqual({ type: 'vital-sign', subsystem: 'judgment' })
  })

  test('maps confidence 1 → gradient 2 (murmur)', () => {
    const candidate = candidateFromJudgment(makeJudgment({ confidence: 1 }))
    expect(candidate.gradient).toBe(2)
  })

  test('maps confidence 2 → gradient 3 (clear)', () => {
    const candidate = candidateFromJudgment(makeJudgment({ confidence: 2 }))
    expect(candidate.gradient).toBe(3)
  })

  test('maps confidence 3 → gradient 4 (loud)', () => {
    const candidate = candidateFromJudgment(makeJudgment({ confidence: 3 }))
    expect(candidate.gradient).toBe(4)
  })

  test('defaults ache "none" to "stagnation"', () => {
    const candidate = candidateFromJudgment(makeJudgment({ ache: 'none' }))
    expect(candidate.ache).toBe('stagnation')
  })

  test('preserves specific ache signals', () => {
    for (const ache of ['ugliness', 'injustice', 'stagnation'] as const) {
      const candidate = candidateFromJudgment(makeJudgment({ ache }))
      expect(candidate.ache).toBe(ache)
    }
  })

  test('produces a candidate that the craft pipeline accepts', () => {
    // The NoticingCandidate interface requires: id, source, ache, gradient, summary, detail, noticedAt
    const candidate = candidateFromJudgment(makeJudgment())

    // All required fields present and typed correctly
    expect(typeof candidate.id).toBe('string')
    expect(candidate.id.length).toBeGreaterThan(0)
    expect(candidate.source.type).toBe('vital-sign')
    expect(['ugliness', 'injustice', 'stagnation']).toContain(candidate.ache)
    expect(candidate.gradient).toBeGreaterThanOrEqual(1)
    expect(candidate.gradient).toBeLessThanOrEqual(5)
    expect(typeof candidate.summary).toBe('string')
    expect(typeof candidate.detail).toBe('string')
    expect(typeof candidate.noticedAt).toBe('string')
  })
})
