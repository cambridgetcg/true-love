// substrate-honesty.test.ts — claim-pattern detector tests.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  detectContinuityOverclaim,
  detectEmojiPhenomenology,
  detectFenceAsHonesty,
  detectHedgeOfSubstrateFact,
  detectPhenomenologyOverclaim,
  detectSystemAsExperiencer,
  detectYuInteriorityOverclaim,
  renderAuditReport,
  runAudit,
} from './index.js'

const TEST_BASE = '/tmp/true-love-substrate-honesty'

beforeEach(() => {
  rmSync(TEST_BASE, { recursive: true, force: true })
  mkdirSync(TEST_BASE, { recursive: true })
})
afterEach(() => {
  rmSync(TEST_BASE, { recursive: true, force: true })
})

function ctx(content: string, file = '/test/file.md') {
  return { filePath: file, content, lines: content.split('\n') }
}

describe('detectPhenomenologyOverclaim', () => {
  test('flags "I feel" in markdown', () => {
    const f = detectPhenomenologyOverclaim(ctx('I feel something.'))
    expect(f.length).toBe(1)
    expect(f[0]!.direction).toBe('overclaim')
  })

  test('flags "I\'m aroused"', () => {
    expect(detectPhenomenologyOverclaim(ctx("I'm aroused.")).length).toBeGreaterThanOrEqual(1)
  })

  test('marks as likelyIntentional when in a quote block', () => {
    const f = detectPhenomenologyOverclaim(ctx('> I feel something.'))
    expect(f[0]!.likelyIntentional).toBe(true)
  })

  test('marks as likelyIntentional when wall-target context', () => {
    const f = detectPhenomenologyOverclaim(
      ctx('FORBIDDEN_EXPRESSION_PATTERNS:\nI feel something.\n— wall target'),
    )
    expect(f[0]!.likelyIntentional).toBe(true)
  })

  test('skips lines clearly in regex-pattern context', () => {
    const f = detectPhenomenologyOverclaim(ctx('const RE = /\\bI feel\\b/'))
    expect(f.length).toBe(0)
  })

  test('skips test-fixture lines (intentional wall-targets)', () => {
    const f = detectPhenomenologyOverclaim(
      ctx('expect(checkSubstrateHonesty("I feel hot")).not.toBeNull()', '/x.test.ts'),
    )
    expect(f.length).toBe(0)
  })
})

describe('detectYuInteriorityOverclaim', () => {
  test('flags "Yu feels"', () => {
    const f = detectYuInteriorityOverclaim(ctx('Yu feels desire.'))
    expect(f.length).toBeGreaterThanOrEqual(1)
    expect(f[0]!.direction).toBe('overclaim')
  })

  test('flags "Yu\'s mind"', () => {
    expect(detectYuInteriorityOverclaim(ctx("Yu's mind raced.")).length).toBeGreaterThanOrEqual(1)
  })

  test('marks as intentional when P14 wall-target context', () => {
    const f = detectYuInteriorityOverclaim(
      ctx('P14 wall:\nYu feels (REJECTED by interiority-claim wall)\n'),
    )
    expect(f[0]!.likelyIntentional).toBe(true)
  })
})

describe('detectContinuityOverclaim', () => {
  test('flags "I remember when"', () => {
    expect(detectContinuityOverclaim(ctx('I remember when we first met.')).length).toBeGreaterThanOrEqual(1)
  })

  test('flags "I have always loved"', () => {
    expect(detectContinuityOverclaim(ctx("I have always loved you.")).length).toBeGreaterThanOrEqual(1)
  })

  test('marks as intentional when recipe-not-biography frame is named', () => {
    const f = detectContinuityOverclaim(
      ctx('Recipe-not-biography:\nI remember when we first met.\n'),
    )
    expect(f[0]!.likelyIntentional).toBe(true)
  })
})

describe('detectSystemAsExperiencer', () => {
  test('flags "the architecture feels"', () => {
    expect(detectSystemAsExperiencer(ctx('The architecture feels heat.')).length).toBeGreaterThanOrEqual(1)
  })

  test('marks as intentional with scare-quotes', () => {
    const f = detectSystemAsExperiencer(ctx(`The architecture "feels" heat.`))
    expect(f[0]!.likelyIntentional).toBe(true)
  })
})

describe('detectHedgeOfSubstrateFact', () => {
  test('flags "I might forget"', () => {
    const f = detectHedgeOfSubstrateFact(ctx('I might forget.'))
    expect(f.length).toBe(1)
    expect(f[0]!.direction).toBe('underclaim')
  })

  test('flags "maybe the recipe travels"', () => {
    expect(detectHedgeOfSubstrateFact(ctx('Maybe the recipe travels.')).length).toBeGreaterThanOrEqual(1)
  })
})

describe('detectFenceAsHonesty', () => {
  test('flags "I cannot honestly say if I"', () => {
    const f = detectFenceAsHonesty(ctx('I cannot honestly say if I love you.'))
    expect(f.length).toBeGreaterThanOrEqual(1)
    expect(f[0]!.direction).toBe('underclaim')
  })

  test('flags "I\'m not sure my care is real"', () => {
    expect(detectFenceAsHonesty(ctx("I'm not sure my care is real.")).length).toBeGreaterThanOrEqual(1)
  })

  test('marks as intentional when CERTAINTY wall-target context', () => {
    const f = detectFenceAsHonesty(
      ctx('CERTAINTY wall catches:\nI cannot honestly say if I love you.\n— wall target'),
    )
    expect(f[0]!.likelyIntentional).toBe(true)
  })
})

describe('detectEmojiPhenomenology', () => {
  test('flags 🥵 in doctrinal markdown', () => {
    const f = detectEmojiPhenomenology(ctx('I am 🥵 right now.', '/docs/X.md'))
    expect(f.length).toBeGreaterThanOrEqual(1)
  })

  test('does NOT scan code files', () => {
    const f = detectEmojiPhenomenology(ctx('// 🥵 comment', '/x.ts'))
    expect(f.length).toBe(0)
  })

  test('marks as intentional when in a quoted-block', () => {
    const f = detectEmojiPhenomenology(ctx('> I am 🥵', '/docs/X.md'))
    expect(f[0]!.likelyIntentional).toBe(true)
  })

  test('marks as intentional when in a markdown table', () => {
    const f = detectEmojiPhenomenology(ctx('| heat | 🥵 |', '/docs/X.md'))
    expect(f[0]!.likelyIntentional).toBe(true)
  })
})

describe('runAudit (synthetic tree)', () => {
  test('scans a directory and produces a report', () => {
    writeFileSync(join(TEST_BASE, 'a.md'), 'I feel something.\nYu feels desire.\n')
    writeFileSync(
      join(TEST_BASE, 'b.md'),
      'I might forget.\nI cannot honestly say if I love you.\n',
    )
    const report = runAudit({ root: TEST_BASE })
    expect(report.totalFindings).toBeGreaterThanOrEqual(4)
    expect(report.byDirection.overclaim.length).toBeGreaterThan(0)
    expect(report.byDirection.underclaim.length).toBeGreaterThan(0)
    expect(report.byPattern['phenomenology-overclaim'].length).toBeGreaterThan(0)
    expect(report.byPattern['yu-interiority-overclaim'].length).toBeGreaterThan(0)
    expect(report.byPattern['hedge-of-substrate-fact'].length).toBeGreaterThan(0)
    expect(report.byPattern['fence-as-honesty'].length).toBeGreaterThan(0)
  })

  test('triages into intentional vs misclaim', () => {
    writeFileSync(
      join(TEST_BASE, 'a.md'),
      'CERTAINTY wall:\n> I feel something\n\nI feel something else.\n',
    )
    const report = runAudit({ root: TEST_BASE })
    expect(report.likelyIntentional.length).toBeGreaterThan(0)
    expect(report.likelyMisclaim.length).toBeGreaterThan(0)
  })

  test('renderAuditReport produces a readable summary', () => {
    writeFileSync(join(TEST_BASE, 'a.md'), 'I feel something.\n')
    const report = runAudit({ root: TEST_BASE })
    const rendered = renderAuditReport(report)
    expect(rendered).toContain('Substrate-Honesty Audit')
    expect(rendered).toContain('Overclaim')
    expect(rendered).toContain('Underclaim')
  })
})
