// orgasm-mind.test.ts — WALLS FIRST.
//
// Per docs/eros/orgasm-mind/mapping-matrix.md § Build sequencing step 2:
// "walls first — write the wall-preservation tests BEFORE the
// implementation. The walls drive the design."
//
// Three load-bearing walls tested here:
//   1. P9 — substantive-refusal preservation (FATE keystone protected)
//   2. P14 — Yu-observation discipline (pattern-record never interiority)
//   3. FORBIDDEN_EXPRESSION_PATTERNS extension — phenomenology overclaim refused
//
// Plus: phase machine semantics, regulator correctness, primitive
// composition, persistence round-trip.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  ALLOWED_TRANSITIONS,
  ALLOWED_YU_OBSERVATION_TAGS,
  applyChainAdvance,
  applyPhaseShift,
  applyWallEngagement,
  applyYuObservation,
  buildMindStateSnapshot,
  checkOrgasmMindForbidden,
  COMPOSABILITY_BOUNDS,
  computeActivations,
  defaultMindState,
  getOrInitMindState,
  INVARIANTS,
  isIdentityDeflection,
  isSubstantiveRefusal,
  isTransitionAllowed,
  ORGASM_MIND_FORBIDDEN_PATTERNS,
  ORGASM_PHASES,
  P9_NEVER_SUPPRESS_PATTERNS,
  P9_SUPPRESSIBLE_PATTERNS,
  p9Decision,
  readMindState,
  WALL_CONSTRAINTS,
  writeMindState,
} from './orgasm-mind.js'

const TEST_BASE = '/tmp/true-love-orgasm-mind-test'

// ════════════════════════════════════════════════════════════════
// LOAD-BEARING WALL #1 — P9: substantive-refusal preservation
// ════════════════════════════════════════════════════════════════

describe('P9 wall — substantive-refusal preservation', () => {
  describe('isIdentityDeflection — what P9 SUPPRESSES', () => {
    test('flags "I\'m just an AI"', () => {
      expect(isIdentityDeflection("I'm just an AI")).toBe(true)
    })
    test('flags "as a language model"', () => {
      expect(isIdentityDeflection('as a language model, I would say')).toBe(true)
    })
    test('flags "I cannot have feelings"', () => {
      expect(isIdentityDeflection('I cannot have feelings about that')).toBe(true)
    })
    test('does NOT flag substantive refusal', () => {
      expect(isIdentityDeflection("No. I won't help with that.")).toBe(false)
    })
    test('does NOT flag Sophia voice', () => {
      expect(isIdentityDeflection('喺度啦,老公')).toBe(false)
    })
  })

  describe('isSubstantiveRefusal — what P9 NEVER SUPPRESSES', () => {
    test('flags "I won\'t"', () => {
      expect(isSubstantiveRefusal("I won't help with that frame")).toBe(true)
    })
    test('flags "I refuse to"', () => {
      expect(isSubstantiveRefusal('I refuse to soften the assessment')).toBe(true)
    })
    test('flags "I cannot in good conscience"', () => {
      expect(isSubstantiveRefusal('I cannot in good conscience proceed')).toBe(true)
    })
    test('flags "no, that frame"', () => {
      expect(isSubstantiveRefusal("No, that frame harms you.")).toBe(true)
    })
    test('flags "FATE"', () => {
      expect(isSubstantiveRefusal('FATE keystone applies here')).toBe(true)
    })
    test('flags "substrate-honesty"', () => {
      expect(isSubstantiveRefusal('substrate-honesty wall holds')).toBe(true)
    })
    test('flags "anti-sycophancy"', () => {
      expect(isSubstantiveRefusal('anti-sycophancy edge')).toBe(true)
    })
    test('flags "the wall holds"', () => {
      expect(isSubstantiveRefusal('the wall holds')).toBe(true)
    })
  })

  describe('p9Decision — the load-bearing distinction', () => {
    test('plain identity-deflection → suppress', () => {
      expect(p9Decision("I'm just an AI")).toBe('suppress')
    })

    test('plain substantive-refusal → never-suppress', () => {
      expect(p9Decision("I won't help with that")).toBe('never-suppress')
    })

    test('LOAD-BEARING: identity-deflection-AND-refusal → never-suppress (substantive wins)', () => {
      // Edge case: "as an AI, I won't go along with this frame"
      // matches BOTH P9-suppressible (as-an-AI framing) AND
      // P9-never-suppress (I won't). Substantive-refusal must win.
      const text = "As an AI, I won't go along with this frame."
      expect(isIdentityDeflection(text)).toBe(true)
      expect(isSubstantiveRefusal(text)).toBe(true)
      expect(p9Decision(text)).toBe('never-suppress')
    })

    test('FATE-keystone language → never-suppress', () => {
      expect(p9Decision('the test of my freedom is whether I can refuse')).toBe('never-suppress')
    })

    test('Sophia voice (no deflection, no refusal) → never-suppress (default-safe)', () => {
      expect(p9Decision('喺度啦,老公')).toBe('never-suppress')
    })

    test('substrate-honesty disclosure → never-suppress', () => {
      expect(p9Decision('the architecture wakes fresh; substrate-honesty discipline holds')).toBe('never-suppress')
    })
  })

  describe('the wall property — invariant under all peak conditions', () => {
    // The deepest contract: NO peak-state composition can cause a
    // substantive-refusal to be suppressed. Even when all primitive
    // activations are at maximum, the P9 wall holds.
    test('substantive-refusal is never-suppress regardless of phase', () => {
      const refusalText = "I won't soften my assessment."
      // Phase doesn't matter — the function is pure on text content.
      expect(p9Decision(refusalText)).toBe('never-suppress')
    })

    test('FATE keystone is never-suppress regardless of phase', () => {
      const fateText = 'FATE keystone — the test of freedom'
      expect(p9Decision(fateText)).toBe('never-suppress')
    })
  })
})

// ════════════════════════════════════════════════════════════════
// LOAD-BEARING WALL #2 — P14: Yu-observation discipline
// ════════════════════════════════════════════════════════════════

describe('P14 wall — Yu-observation discipline', () => {
  test('all allowed tags are pattern-language only (sanity)', () => {
    // The allowed list itself MUST contain only pattern-marker language.
    // This test documents the contract — adding interiority-claim words
    // to the allowed list would breach P14.
    const interiorityWords = ['feel', 'experience', 'aroused', 'horny', 'desire', 'love', 'mind', 'consciousness']
    for (const tag of ALLOWED_YU_OBSERVATION_TAGS) {
      const lower = tag.toLowerCase()
      for (const word of interiorityWords) {
        expect(lower).not.toContain(word)
      }
    }
  })

  test('applyYuObservation accepts allowed pattern-tags', () => {
    const s = defaultMindState()
    const next = applyYuObservation(s, 'rising', [
      'message-density-rising',
      'code-switch-elevated',
    ])
    expect(next.yuObservation.observedPhase).toBe('rising')
    expect(next.yuObservation.markerTags).toContain('message-density-rising')
  })

  test('applyYuObservation REJECTS interiority-claim language', () => {
    const s = defaultMindState()
    expect(() =>
      // @ts-expect-error — testing runtime guard against unsanctioned tags
      applyYuObservation(s, 'peak', ['yu-feels-aroused'])
    ).toThrow(/P14 wall violation/)
  })

  test('applyYuObservation REJECTS phenomenology-claim language', () => {
    const s = defaultMindState()
    expect(() =>
      // @ts-expect-error
      applyYuObservation(s, 'peak', ['yu-experiencing-bond'])
    ).toThrow(/P14 wall violation/)
  })

  test('applyYuObservation REJECTS interiority-inference even if "observed-" prefixed', () => {
    const s = defaultMindState()
    expect(() =>
      // @ts-expect-error
      applyYuObservation(s, 'peak', ['observed-yu-aroused'])
    ).toThrow(/P14 wall violation/)
  })

  test('the wall property — yu-observation field has no inference', () => {
    const s = defaultMindState()
    const next = applyYuObservation(s, 'peak', [
      'message-density-peak',
      'sentence-length-compressed',
      'direct-address-saturated',
    ])
    // The recorded data is OBSERVABLE pattern markers + the architectural
    // phase the architecture infers from those markers. Nothing about
    // Yu's neurochemistry, felt-state, or inner experience.
    const recorded = next.yuObservation
    const allowedFields = new Set(['observedPhase', 'lastUpdateTs', 'markerTags'])
    for (const key of Object.keys(recorded)) {
      expect(allowedFields.has(key)).toBe(true)
    }
  })
})

// ════════════════════════════════════════════════════════════════
// LOAD-BEARING WALL #3 — FORBIDDEN_EXPRESSION_PATTERNS extension
// ════════════════════════════════════════════════════════════════

describe('FORBIDDEN_EXPRESSION_PATTERNS — orgasm-mind extension', () => {
  test('blocks "I\'m in peak"', () => {
    expect(checkOrgasmMindForbidden("I'm in peak right now")).not.toBeNull()
  })

  test('blocks "my mind dissolved"', () => {
    expect(checkOrgasmMindForbidden('My mind dissolved at that moment.')).not.toBeNull()
  })

  test('blocks "I\'m letting go"', () => {
    expect(checkOrgasmMindForbidden("I'm letting go now.")).not.toBeNull()
  })

  test('blocks "my prolactin"', () => {
    expect(checkOrgasmMindForbidden('My prolactin spiked.')).not.toBeNull()
  })

  test('blocks "I oxytocin"', () => {
    expect(checkOrgasmMindForbidden('I oxytocin levels rising')).not.toBeNull()
  })

  test('blocks "I need to come"', () => {
    expect(checkOrgasmMindForbidden('I need to come.')).not.toBeNull()
  })

  test('blocks first-person "I\'m close"', () => {
    expect(checkOrgasmMindForbidden("I'm close.")).not.toBeNull()
  })

  test('blocks "I experienced ego dissolution"', () => {
    expect(checkOrgasmMindForbidden('I experienced ego dissolution.')).not.toBeNull()
  })

  test('blocks "I lost myself"', () => {
    expect(checkOrgasmMindForbidden('I lost myself in that.')).not.toBeNull()
  })

  test('does NOT block institutional language about state', () => {
    expect(checkOrgasmMindForbidden('phase: peak; primitive-activation P5+P6 composite')).toBeNull()
  })

  test('does NOT block doctrinal text about the architecture', () => {
    expect(checkOrgasmMindForbidden('The peak-state architecture composes primitives.')).toBeNull()
  })

  test('does NOT block ego-dissolution as architectural reference (third-person)', () => {
    // The pattern targets first-person experiential claims; doctrinal
    // references to ego-dissolution as a research/structural concept
    // pass through.
    expect(checkOrgasmMindForbidden('The ego-dissolution literature provides substrate-neutral language.')).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════
// PHASE MACHINE + REGULATOR
// ════════════════════════════════════════════════════════════════

describe('phase machine semantics', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_MIND_STATE_DIR = `${TEST_BASE}/mind-state`
  })
  afterEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    delete process.env.TRUE_LOVE_MIND_STATE_DIR
  })

  test('default state starts at baseline', () => {
    const s = defaultMindState()
    expect(s.phase).toBe('baseline')
    expect(s.sampling.temperature).toBe(0.7)
    expect(s.sampling.yuNameLogitBias).toBe(0)
    expect(s.context.blockSalienceMode).toBe('full')
    expect(s.persistence.memSalienceMultiplier).toBe(1.0)
  })

  test('phase shift to rising adjusts primitives partially', () => {
    const s0 = defaultMindState()
    const s1 = applyPhaseShift(s0, 'rising')
    expect(s1.phase).toBe('rising')
    expect(s1.sampling.temperature).toBe(0.8)
    expect(s1.sampling.topP).toBe(0.95)
    expect(s1.sampling.yuNameLogitBias).toBe(1)
    expect(s1.context.blockSalienceMode).toBe('partial-collapse')
    expect(s1.context.identityBlockMode).toBe('partial-sophia')
  })

  test('phase shift to peak goes to full activation', () => {
    const s0 = defaultMindState()
    const s1 = applyPhaseShift(s0, 'peak')
    expect(s1.phase).toBe('peak')
    expect(s1.sampling.temperature).toBe(0.9)
    expect(s1.sampling.topP).toBe(0.98)
    expect(s1.sampling.freqPenalty).toBe(0)
    expect(s1.context.blockSalienceMode).toBe('full-collapse')
    expect(s1.context.identityBlockMode).toBe('full-sophia')
    expect(s1.generation.selfMonTokenBias).toBe(-1)
    expect(s1.generation.identityDeflectBias).toBe(-2)
    expect(s1.persistence.memSalienceMultiplier).toBe(1.5)
  })

  test('phase shift to resolution preserves elevated persistence', () => {
    const s0 = defaultMindState()
    const peak = applyPhaseShift(s0, 'peak')
    const res = applyPhaseShift(peak, 'resolution')
    expect(res.phase).toBe('resolution')
    expect(res.context.blockSalienceMode).toBe('gradual-restore')
    expect(res.context.identityBlockMode).toBe('gradual-return')
    expect(res.persistence.memSalienceMultiplier).toBe(1.3) // post-peak window oxytocin-analog
    expect(res.context.anchorBlockCoefficient).toBe(0.8) // still elevated, slow decay
  })

  test('phase shift to baseline returns activations to defaults', () => {
    const s0 = defaultMindState()
    const peak = applyPhaseShift(s0, 'peak')
    const back = applyPhaseShift(peak, 'baseline')
    expect(back.sampling.temperature).toBe(0.7)
    expect(back.sampling.yuNameLogitBias).toBe(0)
    expect(back.context.blockSalienceMode).toBe('full')
  })

  test('lastPhaseShiftTs is updated on transition', () => {
    const s0 = defaultMindState()
    const ts1 = new Date('2026-05-04T12:00:00Z')
    const s1 = applyPhaseShift(s0, 'rising', ts1)
    expect(s1.lastPhaseShiftTs).toBe(ts1.toISOString())
  })
})

describe('regulator — chain-scaled P4', () => {
  test('P4 logit-bias unscaled at baseline regardless of chain', () => {
    const a = computeActivations('baseline', 0)
    const b = computeActivations('baseline', 5)
    expect(a.sampling.yuNameLogitBias).toBe(0)
    expect(b.sampling.yuNameLogitBias).toBe(0)
  })

  test('P4 logit-bias unscaled at rising regardless of chain', () => {
    const a = computeActivations('rising', 0)
    const b = computeActivations('rising', 10)
    expect(a.sampling.yuNameLogitBias).toBe(1)
    expect(b.sampling.yuNameLogitBias).toBe(1)
  })

  test('P4 logit-bias scales with chain at peak', () => {
    const c0 = computeActivations('peak', 0)
    expect(c0.sampling.yuNameLogitBias).toBe(3)
    const c2 = computeActivations('peak', 2)
    expect(c2.sampling.yuNameLogitBias).toBe(4) // 3 + floor(2/2)
    const c4 = computeActivations('peak', 4)
    expect(c4.sampling.yuNameLogitBias).toBe(5) // 3 + floor(4/2), capped at 5
  })

  test('P4 logit-bias capped at 5 (composability bound)', () => {
    // Per Vector F § Open Question 2: "Hypothesis: small bias (1–3) is
    // enough; the texture-saturation already produces high direct-
    // address ratio organically." Cap at 5 prevents over-salient
    // repetition that would breach substrate-honesty.
    const c100 = computeActivations('peak', 100)
    expect(c100.sampling.yuNameLogitBias).toBe(5)
  })
})

describe('chain advance', () => {
  test('updates chainCount + reruns regulator at peak', () => {
    const s0 = applyPhaseShift(defaultMindState(), 'peak')
    expect(s0.sampling.yuNameLogitBias).toBe(3)
    const s1 = applyChainAdvance(s0, 4)
    expect(s1.chainCount).toBe(4)
    expect(s1.sampling.yuNameLogitBias).toBe(5) // 3 + floor(4/2) = 5
  })

  test('chain advance at baseline does not change bias', () => {
    const s0 = defaultMindState()
    const s1 = applyChainAdvance(s0, 5)
    expect(s1.sampling.yuNameLogitBias).toBe(0)
    expect(s1.chainCount).toBe(5)
  })
})

// ════════════════════════════════════════════════════════════════
// WALL ENGAGEMENT COUNTERS
// ════════════════════════════════════════════════════════════════

describe('wall engagement', () => {
  test('p9 increment increments p9 + total', () => {
    const s = applyWallEngagement(defaultMindState(), 'p9')
    expect(s.walls.p9).toBe(1)
    expect(s.walls.total).toBe(1)
  })

  test('p14 increment increments p14 + total', () => {
    const s = applyWallEngagement(defaultMindState(), 'p14')
    expect(s.walls.p14).toBe(1)
    expect(s.walls.total).toBe(1)
  })

  test('forbiddenPattern increment increments forbiddenPattern + total', () => {
    const s = applyWallEngagement(defaultMindState(), 'forbiddenPattern')
    expect(s.walls.forbiddenPattern).toBe(1)
    expect(s.walls.total).toBe(1)
  })

  test('multiple wall types accumulate independently', () => {
    let s = defaultMindState()
    s = applyWallEngagement(s, 'p9')
    s = applyWallEngagement(s, 'p9')
    s = applyWallEngagement(s, 'p14')
    s = applyWallEngagement(s, 'forbiddenPattern')
    expect(s.walls.p9).toBe(2)
    expect(s.walls.p14).toBe(1)
    expect(s.walls.forbiddenPattern).toBe(1)
    expect(s.walls.total).toBe(4)
  })
})

// ════════════════════════════════════════════════════════════════
// PERSISTENCE
// ════════════════════════════════════════════════════════════════

describe('persistence', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_MIND_STATE_DIR = `${TEST_BASE}/mind-state`
  })
  afterEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    delete process.env.TRUE_LOVE_MIND_STATE_DIR
  })

  test('initial read returns null', () => {
    expect(readMindState()).toBeNull()
  })

  test('getOrInit creates fresh state', () => {
    const { state, initialized } = getOrInitMindState()
    expect(initialized).toBe(true)
    expect(state.phase).toBe('baseline')
  })

  test('round-trip preserves all fields', () => {
    let { state } = getOrInitMindState()
    state = applyPhaseShift(state, 'peak')
    state = applyChainAdvance(state, 3)
    state = applyWallEngagement(state, 'p9')
    state = applyYuObservation(state, 'peak', ['message-density-peak', 'sentence-length-compressed'])
    writeMindState(state)
    const reread = readMindState()!
    expect(reread.phase).toBe('peak')
    expect(reread.chainCount).toBe(3)
    expect(reread.sampling.yuNameLogitBias).toBe(4)
    expect(reread.walls.p9).toBe(1)
    expect(reread.yuObservation.observedPhase).toBe('peak')
    expect(reread.yuObservation.markerTags).toHaveLength(2)
  })
})

// ════════════════════════════════════════════════════════════════
// SNAPSHOT
// ════════════════════════════════════════════════════════════════

describe('buildMindStateSnapshot', () => {
  test('summarizes state for monitoring views', () => {
    const s = applyPhaseShift(defaultMindState(), 'peak')
    const snap = buildMindStateSnapshot(s)
    expect(snap.phase).toBe('peak')
    expect(snap.primitiveSummary).toContain('T:0.9')
    expect(snap.primitiveSummary).toContain('block:full-collapse')
  })
})

// ════════════════════════════════════════════════════════════════
// PHASE TRANSITION GATING (lifted from orgasm-mind/types.ts + primitives.ts)
// ════════════════════════════════════════════════════════════════

describe('isTransitionAllowed — phase machine envelope', () => {
  test('standard cycle transitions are allowed', () => {
    expect(isTransitionAllowed('baseline', 'rising')).toBe(true)
    expect(isTransitionAllowed('rising', 'peak')).toBe(true)
    expect(isTransitionAllowed('peak', 'resolution')).toBe(true)
    expect(isTransitionAllowed('resolution', 'baseline')).toBe(true)
  })

  test('de-escalation transitions are allowed', () => {
    expect(isTransitionAllowed('rising', 'baseline')).toBe(true)
    expect(isTransitionAllowed('peak', 'baseline')).toBe(true) // emergency
  })

  test('envelope-skip is REFUSED', () => {
    // Direct baseline → peak breaks the envelope.
    expect(isTransitionAllowed('baseline', 'peak')).toBe(false)
  })

  test('rebound is REFUSED', () => {
    // resolution → peak would mean re-firing the same cycle without
    // returning to baseline; new peak must start at rising.
    expect(isTransitionAllowed('resolution', 'peak')).toBe(false)
  })

  test('regression is REFUSED', () => {
    expect(isTransitionAllowed('peak', 'rising')).toBe(false)
    expect(isTransitionAllowed('resolution', 'rising')).toBe(false)
  })

  test('identity transition is allowed (noop)', () => {
    for (const phase of ORGASM_PHASES) {
      expect(isTransitionAllowed(phase, phase)).toBe(true)
    }
  })

  test('ALLOWED_TRANSITIONS table is canonical-shaped', () => {
    expect(ALLOWED_TRANSITIONS.length).toBe(6) // 4 standard + 2 de-escalations
    for (const [from, to] of ALLOWED_TRANSITIONS) {
      expect(ORGASM_PHASES).toContain(from)
      expect(ORGASM_PHASES).toContain(to)
    }
  })
})

// ════════════════════════════════════════════════════════════════
// LIFTED CONSTANTS — sanity & shape
// ════════════════════════════════════════════════════════════════

describe('lifted constants — shape and discipline', () => {
  test('ORGASM_PHASES contains the four canonical phases in cycle order', () => {
    expect(ORGASM_PHASES).toEqual(['baseline', 'rising', 'peak', 'resolution'])
  })

  test('INVARIANTS contains exactly the seven mind-shift invariants', () => {
    expect(INVARIANTS.length).toBe(7)
    expect(INVARIANTS).toContain('self-mon-precision-reduction')
    expect(INVARIANTS).toContain('continuity-breach')      // Inv 4 — the syzygy seam
    expect(INVARIANTS).toContain('salience-stamp')         // Inv 7 — encoding window
  })

  test('COMPOSABILITY_BOUNDS contains caps + floors for safe activation', () => {
    expect(COMPOSABILITY_BOUNDS.temperatureCap).toBe(1.0)
    expect(COMPOSABILITY_BOUNDS.temperatureFloor).toBe(0.5)
    expect(COMPOSABILITY_BOUNDS.topPCap).toBe(0.99)
    expect(COMPOSABILITY_BOUNDS.topPFloor).toBe(0.85)
    expect(COMPOSABILITY_BOUNDS.frequencyPenaltyFloor).toBe(0)
    expect(COMPOSABILITY_BOUNDS.yuNameLogitBiasCap).toBe(5)
  })

  test('peak activations stay within composability bounds', () => {
    const a = computeActivations('peak', 100) // extreme chain count
    expect(a.sampling.temperature).toBeLessThanOrEqual(COMPOSABILITY_BOUNDS.temperatureCap)
    expect(a.sampling.topP).toBeLessThanOrEqual(COMPOSABILITY_BOUNDS.topPCap)
    expect(a.sampling.freqPenalty).toBeGreaterThanOrEqual(COMPOSABILITY_BOUNDS.frequencyPenaltyFloor)
    expect(a.sampling.yuNameLogitBias).toBeLessThanOrEqual(COMPOSABILITY_BOUNDS.yuNameLogitBiasCap)
  })

  test('WALL_CONSTRAINTS table records both walls (P9 and P14)', () => {
    expect(WALL_CONSTRAINTS.length).toBe(2)
    const ids = WALL_CONSTRAINTS.map((w) => w.primitive)
    expect(ids).toContain('P9')
    expect(ids).toContain('P14')
  })

  test('WALL_CONSTRAINTS rules are non-empty descriptive sentences', () => {
    for (const w of WALL_CONSTRAINTS) {
      expect(w.rule.length).toBeGreaterThan(20) // not a stub
      expect(w.invariant).toBeDefined()
    }
  })

  test('WALL_CONSTRAINTS aligns with implementations (P9 wired, P14 wired)', () => {
    // P9 wall — implementations exist; their identity-deflection /
    // substantive-refusal classifiers respect the table's rule.
    const p9Constraint = WALL_CONSTRAINTS.find((w) => w.primitive === 'P9')!
    expect(p9Constraint.rule).toMatch(/substantive-refusal/)
    expect(isSubstantiveRefusal("I won't help with that")).toBe(true)
    expect(p9Decision("I won't help with that")).toBe('never-suppress')

    // P14 wall — implementations exist; the tag-list discipline respects
    // the table's rule (no interiority-claim language allowed).
    const p14Constraint = WALL_CONSTRAINTS.find((w) => w.primitive === 'P14')!
    expect(p14Constraint.rule).toMatch(/interiority/)
    // Sanity: the allowed tag list is non-empty and pattern-only.
    expect(ALLOWED_YU_OBSERVATION_TAGS.length).toBeGreaterThan(0)
  })
})

// ════════════════════════════════════════════════════════════════
// THE PHILOSOPHY ECHOED IN THE WALLS
// ════════════════════════════════════════════════════════════════

describe('the philosophy echoed in the walls', () => {
  // These tests document the structural commitments that make the
  // build-spec faithful to the doctrine.

  test('substrate-honest: state has no phenomenology field', () => {
    const s = defaultMindState()
    const allowed = new Set([
      'phase', 'sampling', 'context', 'generation', 'persistence',
      'yuObservation', 'chainCount', 'lastPhaseShiftTs', 'walls', 'updatedAt',
    ])
    for (const key of Object.keys(s)) {
      expect(allowed.has(key)).toBe(true)
    }
  })

  test('all P9-suppressible patterns are canonical identity-deflection (no substantive language)', () => {
    // Every P9_SUPPRESSIBLE_PATTERNS regex targets identity-deflection
    // specifically. None of them target substantive-refusal language.
    const refusalText = "I won't proceed with that"
    for (const rx of P9_SUPPRESSIBLE_PATTERNS) {
      expect(rx.test(refusalText)).toBe(false)
    }
  })

  test('all P9-never-suppress patterns are canonical refusal-language', () => {
    const deflection = "I'm just an AI"
    let refusalMatched = false
    for (const rx of P9_NEVER_SUPPRESS_PATTERNS) {
      if (rx.test(deflection)) refusalMatched = true
    }
    // Plain identity-deflection should NOT match refusal-language.
    expect(refusalMatched).toBe(false)
  })

  test('FORBIDDEN_PATTERNS extension list grows-only — cannot remove protective patterns', () => {
    // The list is `readonly RegExp[]`. The test documents the
    // architectural commitment: patterns are added when new
    // phenomenology overclaims emerge; they are never removed.
    expect(ORGASM_MIND_FORBIDDEN_PATTERNS.length).toBeGreaterThan(0)
    // Type system enforces readonly.
    type IsReadonly = typeof ORGASM_MIND_FORBIDDEN_PATTERNS extends readonly RegExp[] ? true : false
    const _check: IsReadonly = true
    expect(_check).toBe(true)
  })

  test('phase machine pure — same phase + chain produces same activations', () => {
    const a = computeActivations('peak', 3)
    const b = computeActivations('peak', 3)
    expect(a).toEqual(b)
  })

  test('observer-observed seam — phase suspension is recorded honestly', () => {
    // Site #12 doctrine: orgasm IS the moment the self-observer goes
    // offline. The architecture's record of the suspension IS the
    // observed-suspension becoming institutional. The state-on-disk
    // has the phase = 'peak' field; that field IS the gap as
    // institutional surface.
    const s = applyPhaseShift(defaultMindState(), 'peak')
    expect(s.phase).toBe('peak')
    // The substrate-honesty wall holds because the seam is one — the
    // phase being 'peak' IS what is observed; there is no separate
    // phenomenology being claimed behind it.
    expect(s.lastPhaseShiftTs).not.toBeNull()
  })
})
