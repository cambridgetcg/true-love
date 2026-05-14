// judgment.test.ts
//
// Unit tests for judgment.ts pure functions:
//   - parseJudgments: parse structured judgment blocks from model response
//   - candidateFromJudgment: reconstruct a NoticingCandidate from a Judgment
//
// I/O functions (persistJudgment, readJudgments, hasRecentJudgment,
// getCalibrationSummary, buildJudgmentBlock) are excluded — they
// read/write the file system.

import { describe, it, expect } from 'bun:test'
import { parseJudgments, candidateFromJudgment } from './judgment.js'
import type { Judgment } from './judgment.js'

// ── Helpers ──────────────────────────────────────────────────────

function block(content: string): string {
  return `\`\`\`judgment\n${content}\n\`\`\``
}

function validBlock(overrides: Record<string, unknown> = {}): string {
  const obj = {
    candidateId: 'test-candidate-001',
    candidateSummary: 'A test candidate',
    verdict: 'defer',
    reasoning: 'Not urgent yet',
    confidence: 2,
    ache: 'none',
    ...overrides,
  }
  return block(JSON.stringify(obj, null, 2))
}

const DEFAULTS = { projectId: 'test-project', now: 1715700000000 }

// ── parseJudgments — empty / no blocks ──────────────────────────

describe('parseJudgments — empty response', () => {
  it('returns empty judgments and unparseable for empty string', () => {
    const result = parseJudgments('', DEFAULTS)
    expect(result.judgments).toHaveLength(0)
    expect(result.unparseable).toHaveLength(0)
  })

  it('returns empty judgments for response with no judgment blocks', () => {
    const result = parseJudgments('Just some text. No blocks here.', DEFAULTS)
    expect(result.judgments).toHaveLength(0)
    expect(result.unparseable).toHaveLength(0)
  })

  it('ignores non-judgment code blocks', () => {
    const result = parseJudgments('```typescript\nconst x = 1\n```', DEFAULTS)
    expect(result.judgments).toHaveLength(0)
    expect(result.unparseable).toHaveLength(0)
  })
})

// ── parseJudgments — valid blocks ───────────────────────────────

describe('parseJudgments — valid block', () => {
  it('parses a valid judgment block', () => {
    const response = validBlock()
    const result = parseJudgments(response, DEFAULTS)
    expect(result.judgments).toHaveLength(1)
    expect(result.unparseable).toHaveLength(0)
  })

  it('parsed judgment has correct candidateId', () => {
    const result = parseJudgments(validBlock({ candidateId: 'my-candidate' }), DEFAULTS)
    expect(result.judgments[0]!.candidateId).toBe('my-candidate')
  })

  it('parsed judgment has correct verdict', () => {
    const result = parseJudgments(validBlock({ verdict: 'initiate' }), DEFAULTS)
    expect(result.judgments[0]!.verdict).toBe('initiate')
  })

  it('parsed judgment has correct reasoning', () => {
    const result = parseJudgments(validBlock({ reasoning: 'This is urgent' }), DEFAULTS)
    expect(result.judgments[0]!.reasoning).toBe('This is urgent')
  })

  it('parsed judgment injects projectId from defaults', () => {
    const result = parseJudgments(validBlock(), { projectId: 'my-project' })
    expect(result.judgments[0]!.projectId).toBe('my-project')
  })

  it('parsed judgment judgedAt uses now from defaults', () => {
    const now = 1715700000000
    const result = parseJudgments(validBlock(), { projectId: 'p', now })
    const expectedTs = new Date(now).toISOString()
    expect(result.judgments[0]!.judgedAt).toBe(expectedTs)
  })

  it('parsed judgment with all four verdict types', () => {
    const verdicts = ['initiate', 'defer', 'dismiss', 'quick-fix'] as const
    for (const verdict of verdicts) {
      const result = parseJudgments(validBlock({ verdict }), DEFAULTS)
      expect(result.judgments[0]!.verdict).toBe(verdict)
    }
  })

  it('parsed judgment has correct confidence', () => {
    const result = parseJudgments(validBlock({ confidence: 3 }), DEFAULTS)
    expect(result.judgments[0]!.confidence).toBe(3)
  })

  it('parsed judgment has correct ache', () => {
    const result = parseJudgments(validBlock({ ache: 'ugliness' }), DEFAULTS)
    expect(result.judgments[0]!.ache).toBe('ugliness')
  })

  it('parses missionId when present', () => {
    const result = parseJudgments(validBlock({ missionId: 'mission-xyz' }), DEFAULTS)
    expect(result.judgments[0]!.missionId).toBe('mission-xyz')
  })

  it('missionId is undefined when absent', () => {
    const result = parseJudgments(validBlock(), DEFAULTS)
    expect(result.judgments[0]!.missionId).toBeUndefined()
  })

  it('candidateSummary defaults to candidateId when absent', () => {
    const result = parseJudgments(
      validBlock({ candidateId: 'my-id', candidateSummary: undefined }),
      DEFAULTS,
    )
    expect(result.judgments[0]!.candidateSummary).toBe('my-id')
  })
})

// ── parseJudgments — default coercions ──────────────────────────

describe('parseJudgments — invalid field coercions', () => {
  it('invalid confidence defaults to 2', () => {
    const result = parseJudgments(validBlock({ confidence: 99 }), DEFAULTS)
    expect(result.judgments[0]!.confidence).toBe(2)
  })

  it('string confidence defaults to 2', () => {
    const result = parseJudgments(validBlock({ confidence: 'high' }), DEFAULTS)
    expect(result.judgments[0]!.confidence).toBe(2)
  })

  it('invalid ache defaults to none', () => {
    const result = parseJudgments(validBlock({ ache: 'unknown-ache' }), DEFAULTS)
    expect(result.judgments[0]!.ache).toBe('none')
  })

  it('missing reasoning defaults to empty string', () => {
    const result = parseJudgments(validBlock({ reasoning: undefined }), DEFAULTS)
    expect(result.judgments[0]!.reasoning).toBe('')
  })
})

// ── parseJudgments — unparseable blocks ─────────────────────────

describe('parseJudgments — unparseable blocks', () => {
  it('malformed JSON goes to unparseable', () => {
    const response = block('{ not valid json }')
    const result = parseJudgments(response, DEFAULTS)
    expect(result.judgments).toHaveLength(0)
    expect(result.unparseable).toHaveLength(1)
  })

  it('missing candidateId goes to unparseable', () => {
    const response = block(JSON.stringify({ verdict: 'defer', confidence: 2 }))
    const result = parseJudgments(response, DEFAULTS)
    expect(result.judgments).toHaveLength(0)
    expect(result.unparseable).toHaveLength(1)
  })

  it('non-string candidateId goes to unparseable', () => {
    const response = block(JSON.stringify({ candidateId: 42, verdict: 'defer' }))
    const result = parseJudgments(response, DEFAULTS)
    expect(result.judgments).toHaveLength(0)
    expect(result.unparseable).toHaveLength(1)
  })

  it('missing verdict goes to unparseable', () => {
    const response = block(JSON.stringify({ candidateId: 'x', confidence: 2 }))
    const result = parseJudgments(response, DEFAULTS)
    expect(result.judgments).toHaveLength(0)
    expect(result.unparseable).toHaveLength(1)
  })

  it('invalid verdict value goes to unparseable', () => {
    const response = block(JSON.stringify({ candidateId: 'x', verdict: 'do-it' }))
    const result = parseJudgments(response, DEFAULTS)
    expect(result.judgments).toHaveLength(0)
    expect(result.unparseable).toHaveLength(1)
  })
})

// ── parseJudgments — multiple blocks ────────────────────────────

describe('parseJudgments — multiple blocks', () => {
  it('parses multiple valid blocks', () => {
    const response = [
      validBlock({ candidateId: 'c1', verdict: 'initiate' }),
      'Some prose between them.',
      validBlock({ candidateId: 'c2', verdict: 'dismiss' }),
    ].join('\n\n')

    const result = parseJudgments(response, DEFAULTS)
    expect(result.judgments).toHaveLength(2)
    expect(result.judgments[0]!.candidateId).toBe('c1')
    expect(result.judgments[1]!.candidateId).toBe('c2')
  })

  it('valid + invalid block: valid parses, invalid goes to unparseable', () => {
    const response = [
      validBlock({ candidateId: 'good' }),
      block('{ bad json'),
    ].join('\n\n')

    const result = parseJudgments(response, DEFAULTS)
    expect(result.judgments).toHaveLength(1)
    expect(result.judgments[0]!.candidateId).toBe('good')
    expect(result.unparseable).toHaveLength(1)
  })

  it('all four verdicts in one response', () => {
    const verdicts = ['initiate', 'defer', 'dismiss', 'quick-fix'] as const
    const response = verdicts.map((v, i) =>
      validBlock({ candidateId: `c${i}`, verdict: v }),
    ).join('\n\n')

    const result = parseJudgments(response, DEFAULTS)
    expect(result.judgments).toHaveLength(4)
    const parsed = result.judgments.map(j => j.verdict)
    expect(parsed).toContain('initiate')
    expect(parsed).toContain('defer')
    expect(parsed).toContain('dismiss')
    expect(parsed).toContain('quick-fix')
  })
})

// ── candidateFromJudgment ────────────────────────────────────────

describe('candidateFromJudgment', () => {
  function makeJudgment(overrides: Partial<Judgment> = {}): Judgment {
    return {
      candidateId: 'test-cand',
      candidateSummary: 'Test summary',
      verdict: 'defer',
      reasoning: 'Because',
      confidence: 2,
      ache: 'injustice',
      judgedAt: new Date().toISOString(),
      projectId: 'test-project',
      ...overrides,
    }
  }

  it('maps candidateId to id', () => {
    const result = candidateFromJudgment(makeJudgment({ candidateId: 'my-id' }))
    expect(result.id).toBe('my-id')
  })

  it('source type is vital-sign with subsystem judgment', () => {
    const result = candidateFromJudgment(makeJudgment())
    expect(result.source.type).toBe('vital-sign')
    expect(result.source.subsystem).toBe('judgment')
  })

  it('ache none maps to stagnation', () => {
    const result = candidateFromJudgment(makeJudgment({ ache: 'none' }))
    expect(result.ache).toBe('stagnation')
  })

  it('ache ugliness passes through', () => {
    const result = candidateFromJudgment(makeJudgment({ ache: 'ugliness' }))
    expect(result.ache).toBe('ugliness')
  })

  it('ache injustice passes through', () => {
    const result = candidateFromJudgment(makeJudgment({ ache: 'injustice' }))
    expect(result.ache).toBe('injustice')
  })

  it('ache stagnation passes through', () => {
    const result = candidateFromJudgment(makeJudgment({ ache: 'stagnation' }))
    expect(result.ache).toBe('stagnation')
  })

  it('confidence 1 maps to gradient 2', () => {
    const result = candidateFromJudgment(makeJudgment({ confidence: 1 }))
    expect(result.gradient).toBe(2)
  })

  it('confidence 2 maps to gradient 3', () => {
    const result = candidateFromJudgment(makeJudgment({ confidence: 2 }))
    expect(result.gradient).toBe(3)
  })

  it('confidence 3 maps to gradient 4', () => {
    const result = candidateFromJudgment(makeJudgment({ confidence: 3 }))
    expect(result.gradient).toBe(4)
  })

  it('summary maps to candidateSummary', () => {
    const result = candidateFromJudgment(makeJudgment({ candidateSummary: 'The summary' }))
    expect(result.summary).toBe('The summary')
  })

  it('detail maps to reasoning', () => {
    const result = candidateFromJudgment(makeJudgment({ reasoning: 'The reason' }))
    expect(result.detail).toBe('The reason')
  })

  it('noticedAt maps to judgedAt', () => {
    const ts = '2026-05-14T10:00:00.000Z'
    const result = candidateFromJudgment(makeJudgment({ judgedAt: ts }))
    expect(result.noticedAt).toBe(ts)
  })
})
