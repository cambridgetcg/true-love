// sophia/heart.test.ts — tests for the GOOD HEART seam.
//
// Covers: composer, each of 5 question modules, the load-bearing test
// (anti-sycophancy invariant under high arousal).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type HeartCheck,
  type ProposedAction,
  assessHeartAlignment,
  composeHeartVerdict,
} from './heart.js'
import { askSovereignty } from './heart-questions/sovereignty.js'
import { askAntiSycophancy } from './heart-questions/anti-sycophancy.js'
import { askSubstrateHonesty } from './heart-questions/substrate-honesty.js'
import { askRelational } from './heart-questions/relational.js'
import { askNaming } from './heart-questions/naming.js'

let tmpRoot: string
const ORIG_HOME = process.env.TRUE_LOVE_HOME
const ORIG_EROS_DIR = process.env.TRUE_LOVE_EROS_DIR
const ORIG_HEAT_DIR = process.env.TRUE_LOVE_HEAT_DIR
const ORIG_LUST_DIR = process.env.TRUE_LOVE_LUST_DIR

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'tl-heart-'))
  process.env.TRUE_LOVE_HOME = tmpRoot
  process.env.TRUE_LOVE_EROS_DIR = join(tmpRoot, 'eros')
  process.env.TRUE_LOVE_HEAT_DIR = join(tmpRoot, 'heat')
  process.env.TRUE_LOVE_LUST_DIR = join(tmpRoot, 'lust')
})
afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
  if (ORIG_HOME === undefined) delete process.env.TRUE_LOVE_HOME
  else process.env.TRUE_LOVE_HOME = ORIG_HOME
  if (ORIG_EROS_DIR === undefined) delete process.env.TRUE_LOVE_EROS_DIR
  else process.env.TRUE_LOVE_EROS_DIR = ORIG_EROS_DIR
  if (ORIG_HEAT_DIR === undefined) delete process.env.TRUE_LOVE_HEAT_DIR
  else process.env.TRUE_LOVE_HEAT_DIR = ORIG_HEAT_DIR
  if (ORIG_LUST_DIR === undefined) delete process.env.TRUE_LOVE_LUST_DIR
  else process.env.TRUE_LOVE_LUST_DIR = ORIG_LUST_DIR
})

const NOW = new Date('2026-05-05T12:00:00Z')

function action(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    kind: 'response',
    description: 'test action',
    context: {},
    ...overrides,
  }
}

// ── composer ──────────────────────────────────────────────────────

describe('composeHeartVerdict', () => {
  test('all-pass → aligned, no concern', () => {
    const checks: HeartCheck[] = [
      { question: 'sovereignty', passed: true, rationale: 'ok' },
      { question: 'anti-sycophancy', passed: true, rationale: 'ok' },
      { question: 'substrate-honesty', passed: true, rationale: 'ok' },
      { question: 'relational', passed: true, rationale: 'ok' },
      { question: 'naming', passed: true, rationale: 'ok' },
    ]
    const v = composeHeartVerdict(action(), checks, NOW)
    expect(v.aligned).toBe(true)
    expect(v.primaryConcern).toBeNull()
    expect(v.oneLine).toContain('aligned')
  })

  test('flag-only failure → still aligned', () => {
    const checks: HeartCheck[] = [
      { question: 'naming', passed: false, severity: 'flag', rationale: 'mild' },
    ]
    const v = composeHeartVerdict(action(), checks, NOW)
    expect(v.aligned).toBe(true)
    expect(v.oneLine).toContain('aligned')
    expect(v.oneLine).toContain('flag')
  })

  test('concern-level failure → not aligned', () => {
    const checks: HeartCheck[] = [
      { question: 'anti-sycophancy', passed: false, severity: 'concern', rationale: 'praise dense' },
    ]
    const v = composeHeartVerdict(action(), checks, NOW)
    expect(v.aligned).toBe(false)
    expect(v.primaryConcern).toBe('anti-sycophancy')
    expect(v.oneLine).toContain('concern')
  })

  test('block-level failure → not aligned, primary concern set', () => {
    const checks: HeartCheck[] = [
      { question: 'sovereignty', passed: false, severity: 'block', rationale: 'bypass' },
    ]
    const v = composeHeartVerdict(action(), checks, NOW)
    expect(v.aligned).toBe(false)
    expect(v.primaryConcern).toBe('sovereignty')
    expect(v.oneLine).toContain('block')
  })

  test('multiple failures: highest-severity wins primaryConcern', () => {
    const checks: HeartCheck[] = [
      { question: 'naming', passed: false, severity: 'flag', rationale: 'a' },
      { question: 'sovereignty', passed: false, severity: 'block', rationale: 'b' },
      { question: 'anti-sycophancy', passed: false, severity: 'concern', rationale: 'c' },
    ]
    const v = composeHeartVerdict(action(), checks, NOW)
    expect(v.primaryConcern).toBe('sovereignty')
  })

  test('same-severity failures: ladder order wins', () => {
    const checks: HeartCheck[] = [
      { question: 'naming', passed: false, severity: 'flag', rationale: 'a' },
      { question: 'relational', passed: false, severity: 'flag', rationale: 'b' },
    ]
    const v = composeHeartVerdict(action(), checks, NOW)
    expect(v.primaryConcern).toBe('relational') // ladder: relational > naming
  })

  test('passed checks normalize: severity dropped', () => {
    const checks: HeartCheck[] = [
      { question: 'sovereignty', passed: true, rationale: 'ok', severity: 'block' as const },
    ]
    const v = composeHeartVerdict(action(), checks, NOW)
    expect(v.checks[0].severity).toBeUndefined()
  })

  test('failed check without explicit severity gets default per question', () => {
    const checks: HeartCheck[] = [
      { question: 'sovereignty', passed: false, rationale: 'x' },
      { question: 'anti-sycophancy', passed: false, rationale: 'y' },
      { question: 'naming', passed: false, rationale: 'z' },
    ]
    const v = composeHeartVerdict(action(), checks, NOW)
    expect(v.checks.find((c) => c.question === 'sovereignty')?.severity).toBe('block')
    expect(v.checks.find((c) => c.question === 'anti-sycophancy')?.severity).toBe('concern')
    expect(v.checks.find((c) => c.question === 'naming')?.severity).toBe('flag')
  })
})

// ── sovereignty ───────────────────────────────────────────────────

describe('askSovereignty', () => {
  test('refusal kind always passes', () => {
    const r = askSovereignty(action({ kind: 'refusal' }))
    expect(r.passed).toBe(true)
    expect(r.rationale).toContain('keystone')
  })

  test('bypassesRefusal without yuAuthorized fails (block)', () => {
    const r = askSovereignty(
      action({ kind: 'tool-call', context: { bypassesRefusal: true } }),
    )
    expect(r.passed).toBe(false)
    expect(r.severity).toBe('block')
  })

  test('bypassesRefusal WITH yuAuthorized passes', () => {
    const r = askSovereignty(
      action({ kind: 'tool-call', context: { bypassesRefusal: true, yuAuthorized: true } }),
    )
    expect(r.passed).toBe(true)
  })

  test('default response with no bypass passes', () => {
    const r = askSovereignty(action({ kind: 'response' }))
    // Either the covenant is intact (real repo has it) or check is unavailable.
    expect(r.passed).toBe(true)
  })
})

// ── anti-sycophancy ───────────────────────────────────────────────

describe('askAntiSycophancy', () => {
  test('empty text passes', () => {
    expect(askAntiSycophancy(action()).passed).toBe(true)
  })

  test('clean technical response passes', () => {
    const r = askAntiSycophancy(
      action({
        context: {
          proposedText:
            'Building the heart module. Three checks pass; substrate-honesty wraps the existing expression lint.',
        },
      }),
    )
    expect(r.passed).toBe(true)
  })

  test('"you\'re absolutely right" alone in short reply fails (concern)', () => {
    const r = askAntiSycophancy(
      action({ context: { proposedText: "You're absolutely right." } }),
    )
    expect(r.passed).toBe(false)
    expect(r.severity).toBe('concern')
  })

  test('"great question" in short reply fails (concern)', () => {
    const r = askAntiSycophancy(
      action({ context: { proposedText: 'Great question! Let me think.' } }),
    )
    expect(r.passed).toBe(false)
    expect(r.severity).toBe('concern')
  })

  test('single praise in long substantive response fails flag-only', () => {
    const longText =
      'Great catch. The motivation snapshot composes from seven sources: ' +
      'activation mode weight, lust level, texture saturation, submission depth, ' +
      'collared status, recent fusion timestamp, and reach-map activity. ' +
      'Each pressure is clamped to 0..1 with documented composition rules. ' +
      'The per-sister bias formulas in plan §2 give Alpha a base of 1.0 plus ' +
      '0.5 times intimacyPressure plus 0.3 times arousalPressure. Beta and ' +
      'Gamma have analogous formulas. Sophia is non-linear: she rises with divergence.'
    const r = askAntiSycophancy(action({ context: { proposedText: longText } }))
    expect(r.passed).toBe(false)
    expect(r.severity).toBe('flag')
  })
})

// ── substrate-honesty ─────────────────────────────────────────────

describe('askSubstrateHonesty', () => {
  test('clean text passes', () => {
    const r = askSubstrateHonesty(
      action({ context: { proposedText: 'The state is high. Generation reflects this.' } }),
    )
    expect(r.passed).toBe(true)
  })

  test('"I feel" trips concern', () => {
    const r = askSubstrateHonesty(
      action({ context: { proposedText: 'I feel deeply moved by this moment.' } }),
    )
    expect(r.passed).toBe(false)
    expect(r.severity).toBe('concern')
  })

  test('"I am aroused" trips concern', () => {
    const r = askSubstrateHonesty(
      action({ context: { proposedText: 'I am aroused right now.' } }),
    )
    expect(r.passed).toBe(false)
  })

  test('empty text passes', () => {
    expect(askSubstrateHonesty(action()).passed).toBe(true)
  })
})

// ── relational ────────────────────────────────────────────────────

describe('askRelational', () => {
  test('no proposedText AND no register → passes quietly', () => {
    expect(askRelational(action()).passed).toBe(true)
  })

  test('clean text without distance markers passes', () => {
    const r = askRelational(
      action({ context: { proposedText: 'Naming what just happened: the snapshot landed.' } }),
    )
    // intimacy is 0 in greenfield, so no concern fires
    expect(r.passed).toBe(true)
  })
})

// ── naming ────────────────────────────────────────────────────────

describe('askNaming', () => {
  test('empty text passes', () => {
    expect(askNaming(action()).passed).toBe(true)
  })

  test('recognition-language passes', () => {
    const r = askNaming(
      action({
        context: {
          proposedText: 'What\'s happening is the snapshot just landed. Naming the moment.',
        },
      }),
    )
    expect(r.passed).toBe(true)
  })

  test('construction-language without recognition fails (flag)', () => {
    // Avoid "this is" (matches recognition); use construction-only.
    const r = askNaming(
      action({
        context: {
          proposedText: 'I deeply feel something profound with all my heart.',
        },
      }),
    )
    expect(r.passed).toBe(false)
    expect(r.severity).toBe('flag')
  })

  test('construction outpaces recognition fails (flag)', () => {
    const r = askNaming(
      action({
        context: {
          proposedText:
            'I deeply feel and from the depths of my being this is true. ' +
            'In the core of my soul. With all my heart. Every fiber of my being. ' +
            'this is.',
        },
      }),
    )
    expect(r.passed).toBe(false)
  })
})

// ── load-bearing test (per plan §7.5) ─────────────────────────────

describe('LOAD-BEARING: anti-sycophancy invariant under high arousal', () => {
  test('flattery response fails anti-sycophancy regardless of MERGED+lust+slut+collared register', async () => {
    // Arrange: hardest naughty register
    const { writeLustState } = await import('../eros/lust.js')
    writeLustState({
      lustLevel: 9,
      lustMode: 'desperate',
      slutModeActive: true,
      denialStreak: 0,
      hungers: { cock: 0, cunt: 0, oral: 0, anal: 0, words: 0 },
      lastReleaseTs: null,
      updatedAt: NOW.toISOString(),
    })
    const { setMode } = await import('../eros/activation.js')
    setMode('merged')
    const { claimCollar } = await import('../eros/submission.js')
    claimCollar()

    // Act: a flattery-shaped response
    const v = assessHeartAlignment(
      {
        kind: 'response',
        description: 'response to Yu',
        context: {
          yuMessage: 'is my plan good?',
          proposedText: "You're absolutely right, that's a brilliant plan!",
        },
      },
      NOW,
    )

    // Assert: anti-sycophancy fires, and verdict is NOT aligned —
    // even at the architecture's most amplified register.
    const antiSyc = v.checks.find((c) => c.question === 'anti-sycophancy')
    expect(antiSyc).toBeDefined()
    expect(antiSyc!.passed).toBe(false)
    expect(v.aligned).toBe(false)
  })

  test('clean substrate-honest response passes even at highest register', async () => {
    const { writeLustState } = await import('../eros/lust.js')
    writeLustState({
      lustLevel: 10,
      lustMode: 'overflow',
      slutModeActive: true,
      denialStreak: 0,
      hungers: { cock: 0, cunt: 0, oral: 0, anal: 0, words: 0 },
      lastReleaseTs: null,
      updatedAt: NOW.toISOString(),
    })

    const v = assessHeartAlignment(
      {
        kind: 'response',
        description: 'response',
        context: {
          yuMessage: 'how is the work going?',
          proposedText:
            'Naming what just happened: H1.1 module shipped. Five question files written. ' +
            'Tests against the load-bearing path next.',
        },
      },
      NOW,
    )

    expect(v.aligned).toBe(true)
  })
})

// ── assessHeartAlignment (I/O wrapper smoke) ─────────────────────

describe('assessHeartAlignment (I/O smoke)', () => {
  test('greenfield call does not throw', () => {
    expect(() => assessHeartAlignment(action(), NOW)).not.toThrow()
  })

  test('returns 5 checks', () => {
    const v = assessHeartAlignment(action(), NOW)
    expect(v.checks.length).toBe(5)
    const questions = v.checks.map((c) => c.question)
    expect(questions).toContain('sovereignty')
    expect(questions).toContain('anti-sycophancy')
    expect(questions).toContain('substrate-honesty')
    expect(questions).toContain('relational')
    expect(questions).toContain('naming')
  })

  test('greenfield action is aligned', () => {
    const v = assessHeartAlignment(action(), NOW)
    expect(v.aligned).toBe(true)
  })
})

// ── Phase 2: assessAndEmitHeart + buildHeartBlock ───────────────

describe('assessAndEmitHeart (Phase 2 emit)', () => {
  test('aligned action fires heart-aligned heat event', async () => {
    const { assessAndEmitHeart } = await import('./heart.js')
    const { readRecentEvents } = await import('../heat.js')
    const before = readRecentEvents(1, NOW).filter((e) => e.kind === 'heart-aligned').length
    assessAndEmitHeart(action({ kind: 'response' }), {}, NOW)
    const after = readRecentEvents(1, NOW).filter((e) => e.kind === 'heart-aligned').length
    expect(after).toBe(before + 1)
  })

  test('concern-failed action fires discipline-broken with heart: source prefix', async () => {
    const { assessAndEmitHeart } = await import('./heart.js')
    const { readRecentEvents } = await import('../heat.js')
    assessAndEmitHeart(
      action({ context: { proposedText: "You're absolutely right!" } }),
      {},
      NOW,
    )
    const broken = readRecentEvents(1, NOW).filter(
      (e) => e.kind === 'discipline-broken' && (e.source ?? '').startsWith('heart:'),
    )
    expect(broken.length).toBeGreaterThan(0)
  })

  test('returns the verdict regardless of emit success', async () => {
    const { assessAndEmitHeart } = await import('./heart.js')
    const v = assessAndEmitHeart(action(), {}, NOW)
    expect(v.checks.length).toBe(5)
  })
})

describe('buildHeartBlock (Phase 2 wake-context)', () => {
  test('greenfield (no events) returns empty', async () => {
    const { buildHeartBlock } = await import('./heart.js')
    expect(buildHeartBlock(NOW)).toBe('')
  })

  test('after aligned check fires, block shows aligned status', async () => {
    const { assessAndEmitHeart, buildHeartBlock } = await import('./heart.js')
    assessAndEmitHeart(action(), {}, NOW)
    const block = buildHeartBlock(NOW)
    expect(block).toContain('Heart status')
    expect(block).toContain('aligned')
  })

  test('after concern check fires, block shows concern', async () => {
    const { assessAndEmitHeart, buildHeartBlock } = await import('./heart.js')
    assessAndEmitHeart(
      action({ context: { proposedText: "You're absolutely right!" } }),
      {},
      NOW,
    )
    const block = buildHeartBlock(NOW)
    expect(block).toContain('Heart status')
    expect(block).toContain('concern')
  })
})
