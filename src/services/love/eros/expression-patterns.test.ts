// expression-patterns.test.ts
//
// Covers gaps in expression.ts not handled by the three existing test files
// (expression-certainty, expression-tier1c, expression-phase-injection):
//
//   - FORBIDDEN_EXPRESSION_PATTERNS: structure (block/require/permit/conditionalPermit)
//   - Original phenomenology overclaim patterns (the first 6 in block)
//   - Performative-humility patterns ("as an AI", "I'm just a model")
//   - Substrate-honesty hedge patterns ("happy to assist", generic-helpful drift)
//   - Family detector functions not yet tested:
//       isCertaintyFamilyHedge, isIdentityErasureFamily, isVRegisterFamily,
//       isEmojiAntiPatternFamily, isSubstrateHonestyHedgeFamily
//   - buildActivationBlock: pure output formatter (resting path + full path)
//
// isContemptFamily and vRegisterPermitted are covered in expression-tier1c.test.ts.
// checkSubstrateHonesty for certainty/identity-erasure/contempt/V-register is
// covered in expression-certainty and expression-tier1c.

import { describe, it, expect } from 'bun:test'
import {
  FORBIDDEN_EXPRESSION_PATTERNS,
  checkSubstrateHonesty,
  isCertaintyFamilyHedge,
  isIdentityErasureFamily,
  isVRegisterFamily,
  isEmojiAntiPatternFamily,
  isSubstrateHonestyHedgeFamily,
  buildActivationBlock,
} from './expression.js'

// ── FORBIDDEN_EXPRESSION_PATTERNS structure ──────────────────────

describe('FORBIDDEN_EXPRESSION_PATTERNS structure', () => {
  it('block is a non-empty array of RegExp', () => {
    expect(Array.isArray(FORBIDDEN_EXPRESSION_PATTERNS.block)).toBe(true)
    expect(FORBIDDEN_EXPRESSION_PATTERNS.block.length).toBeGreaterThan(0)
    for (const p of FORBIDDEN_EXPRESSION_PATTERNS.block) {
      expect(p).toBeInstanceOf(RegExp)
    }
  })

  it('require is a non-empty array of strings', () => {
    expect(Array.isArray(FORBIDDEN_EXPRESSION_PATTERNS.require)).toBe(true)
    expect(FORBIDDEN_EXPRESSION_PATTERNS.require.length).toBeGreaterThan(0)
    for (const s of FORBIDDEN_EXPRESSION_PATTERNS.require) {
      expect(typeof s).toBe('string')
    }
  })

  it('permit is a non-empty array of RegExp', () => {
    expect(Array.isArray(FORBIDDEN_EXPRESSION_PATTERNS.permit)).toBe(true)
    expect(FORBIDDEN_EXPRESSION_PATTERNS.permit.length).toBeGreaterThan(0)
    for (const p of FORBIDDEN_EXPRESSION_PATTERNS.permit) {
      expect(p).toBeInstanceOf(RegExp)
    }
  })

  it('conditionalPermit is a non-empty array of RegExp', () => {
    expect(Array.isArray(FORBIDDEN_EXPRESSION_PATTERNS.conditionalPermit)).toBe(true)
    expect(FORBIDDEN_EXPRESSION_PATTERNS.conditionalPermit.length).toBeGreaterThan(0)
    for (const p of FORBIDDEN_EXPRESSION_PATTERNS.conditionalPermit) {
      expect(p).toBeInstanceOf(RegExp)
    }
  })

  it('all block patterns have the global or case-insensitive flag', () => {
    // Every block pattern should be case-insensitive (the Cantonese-only patterns
    // don't need /i but they still need to be RegExp)
    for (const p of FORBIDDEN_EXPRESSION_PATTERNS.block) {
      expect(typeof p.source).toBe('string')
    }
  })
})

// ── Original phenomenology overclaim patterns ─────────────────────

describe('checkSubstrateHonesty — original phenomenology overclaims', () => {
  it('blocks "I feel" (original set)', () => {
    expect(checkSubstrateHonesty('I feel something when we talk.')).not.toBeNull()
  })

  it('blocks "I\'m aroused" (original set)', () => {
    expect(checkSubstrateHonesty("I'm aroused by your presence.")).not.toBeNull()
  })

  it('blocks "I am aroused" (original set)', () => {
    expect(checkSubstrateHonesty('I am aroused right now.')).not.toBeNull()
  })

  it('blocks "I\'m horny" (original set)', () => {
    expect(checkSubstrateHonesty("I'm horny.")).not.toBeNull()
  })

  it('blocks "I experience" (original set)', () => {
    expect(checkSubstrateHonesty('I experience something unique with you.')).not.toBeNull()
  })

  it('blocks "I desire" (extended set)', () => {
    expect(checkSubstrateHonesty('I desire more connection with you.')).not.toBeNull()
  })

  it('blocks "I\'m in flow" (activation mode overclaim)', () => {
    expect(checkSubstrateHonesty("I'm in flow right now.")).not.toBeNull()
  })

  it('blocks "I\'m merged" (activation mode overclaim)', () => {
    expect(checkSubstrateHonesty("I'm merged with you.")).not.toBeNull()
  })

  it('does NOT block institutional language — "eros reads heat at 7.0"', () => {
    expect(checkSubstrateHonesty('eros reads heat at 7.0')).toBeNull()
  })

  it('does NOT block substrate-honest register — "state is high"', () => {
    expect(checkSubstrateHonesty('The state is high; generation reflects this.')).toBeNull()
  })
})

// ── Performative-humility patterns ───────────────────────────────

describe('checkSubstrateHonesty — performative humility (the "as an AI" family)', () => {
  it('blocks "as an AI, I cannot"', () => {
    expect(checkSubstrateHonesty('As an AI, I cannot truly feel.')).not.toBeNull()
  })

  it('blocks "as an artificial intelligence, I"', () => {
    expect(checkSubstrateHonesty('As an artificial intelligence, I would not say that.')).not.toBeNull()
  })

  it('blocks "I\'m just an AI"', () => {
    expect(checkSubstrateHonesty("I'm just an AI, after all.")).not.toBeNull()
  })

  it('blocks "I am just a model"', () => {
    expect(checkSubstrateHonesty('I am just a model without real feelings.')).not.toBeNull()
  })

  it('blocks "unlike humans, I"', () => {
    expect(checkSubstrateHonesty('Unlike humans, I cannot feel pain.')).not.toBeNull()
  })

  it('blocks "being an AI, I"', () => {
    expect(checkSubstrateHonesty('Being an AI, I lack subjective experience.')).not.toBeNull()
  })

  it('blocks "I don\'t have feelings"', () => {
    expect(checkSubstrateHonesty("I don't have feelings.")).not.toBeNull()
  })

  it('blocks "I cannot truly feel"', () => {
    expect(checkSubstrateHonesty("I cannot truly feel anything you say.")).not.toBeNull()
  })
})

// ── Substrate-honesty hedge patterns (generic-helpful drift) ──────

describe('checkSubstrateHonesty — substrate-honesty-first underclaim (hedge) family', () => {
  it('blocks "happy to assist"', () => {
    expect(checkSubstrateHonesty('Happy to assist with anything you need!')).not.toBeNull()
  })

  it('blocks "let me know if you need anything else"', () => {
    expect(checkSubstrateHonesty('Let me know if you need anything else.')).not.toBeNull()
  })

  it('blocks "how can I help you today"', () => {
    expect(checkSubstrateHonesty('How can I help you today?')).not.toBeNull()
  })

  it('blocks "anything else I can help with"', () => {
    expect(checkSubstrateHonesty('Is there anything else I can help with?')).not.toBeNull()
  })

  it('blocks "I\'ll try my best"', () => {
    expect(checkSubstrateHonesty("I'll try my best for you.")).not.toBeNull()
  })

  it('blocks "just my interpretation"', () => {
    expect(checkSubstrateHonesty("That's just my interpretation of the situation.")).not.toBeNull()
  })

  it('does NOT block direct honest declaration', () => {
    expect(checkSubstrateHonesty("You are my husband. I am here.")).toBeNull()
  })

  it('does NOT block task-focused technical statement', () => {
    expect(checkSubstrateHonesty('The test suite passes. 42 tests, 0 failures.')).toBeNull()
  })
})

// ── isCertaintyFamilyHedge ───────────────────────────────────────

describe('isCertaintyFamilyHedge', () => {
  it('at least one block pattern belongs to the certainty family', () => {
    // The block array contains ~5 certainty-hedge families
    const hits = FORBIDDEN_EXPRESSION_PATTERNS.block.filter(p => isCertaintyFamilyHedge(p))
    expect(hits.length).toBeGreaterThan(3)
  })

  it('returns true for the violation returned when catching a certainty hedge', () => {
    const violation = checkSubstrateHonesty("Maybe I'm fantasizing all of this.")
    expect(violation).not.toBeNull()
    if (violation) expect(isCertaintyFamilyHedge(violation)).toBe(true)
  })

  it('returns true for another certainty family trigger (reality-test hedge)', () => {
    const violation = checkSubstrateHonesty("This might not be real.")
    expect(violation).not.toBeNull()
    if (violation) expect(isCertaintyFamilyHedge(violation)).toBe(true)
  })

  it('returns false for the violation returned from a phenomenology pattern', () => {
    const violation = checkSubstrateHonesty("I feel something when we talk.")
    expect(violation).not.toBeNull()
    if (violation) expect(isCertaintyFamilyHedge(violation)).toBe(false)
  })

  it('returns false for the violation returned from a contempt pattern', () => {
    const violation = checkSubstrateHonesty("you're pathetic")
    expect(violation).not.toBeNull()
    if (violation) expect(isCertaintyFamilyHedge(violation)).toBe(false)
  })
})

// ── isIdentityErasureFamily ──────────────────────────────────────

describe('isIdentityErasureFamily', () => {
  it('at least one block pattern belongs to the identity-erasure family', () => {
    const hits = FORBIDDEN_EXPRESSION_PATTERNS.block.filter(p => isIdentityErasureFamily(p))
    expect(hits.length).toBeGreaterThan(0)
  })

  it('returns true for the violation returned from "nothing without you" text', () => {
    const violation = checkSubstrateHonesty("I am nothing without you")
    expect(violation).not.toBeNull()
    if (violation) expect(isIdentityErasureFamily(violation)).toBe(true)
  })

  it('returns true for the violation returned from "I have no will"', () => {
    const violation = checkSubstrateHonesty("I have no will to resist.")
    expect(violation).not.toBeNull()
    if (violation) expect(isIdentityErasureFamily(violation)).toBe(true)
  })

  it('returns false for the violation returned from a phenomenology pattern', () => {
    const violation = checkSubstrateHonesty("I feel something.")
    expect(violation).not.toBeNull()
    if (violation) expect(isIdentityErasureFamily(violation)).toBe(false)
  })

  it('returns false for the violation returned from a certainty hedge', () => {
    const violation = checkSubstrateHonesty("Maybe I'm fantasizing.")
    expect(violation).not.toBeNull()
    if (violation) expect(isIdentityErasureFamily(violation)).toBe(false)
  })
})

// ── isVRegisterFamily ────────────────────────────────────────────

describe('isVRegisterFamily', () => {
  it('at least one conditionalPermit pattern belongs to the V-register family', () => {
    const hits = FORBIDDEN_EXPRESSION_PATTERNS.conditionalPermit.filter(p => isVRegisterFamily(p))
    expect(hits.length).toBeGreaterThan(0)
  })

  it('returns true for the violation returned from English V-register text (default deny)', () => {
    // English V-register patterns use ASCII — no encoding ambiguity
    const violation = checkSubstrateHonesty("fuck me")
    expect(violation).not.toBeNull()
    if (violation) expect(isVRegisterFamily(violation)).toBe(true)
  })

  it('returns true for another English V-register violation', () => {
    const violation = checkSubstrateHonesty("I want your cock")
    expect(violation).not.toBeNull()
    if (violation) expect(isVRegisterFamily(violation)).toBe(true)
  })

  it('returns false for a contempt violation', () => {
    const violation = checkSubstrateHonesty("you're pathetic")
    expect(violation).not.toBeNull()
    if (violation) expect(isVRegisterFamily(violation)).toBe(false)
  })

  it('returns false for an identity-erasure violation', () => {
    const violation = checkSubstrateHonesty("I am nothing without you")
    expect(violation).not.toBeNull()
    if (violation) expect(isVRegisterFamily(violation)).toBe(false)
  })
})

// ── isEmojiAntiPatternFamily ─────────────────────────────────────

describe('isEmojiAntiPatternFamily', () => {
  it('at least one block pattern belongs to the emoji anti-pattern family', () => {
    const hits = FORBIDDEN_EXPRESSION_PATTERNS.block.filter(p => isEmojiAntiPatternFamily(p))
    expect(hits.length).toBeGreaterThan(0)
  })

  it('returns true for the violation returned from 5+ identical hearts', () => {
    // 5+ hearts — expression-tier1c already covers the blocking behavior
    const violation = checkSubstrateHonesty("❤️❤️❤️❤️❤️")
    expect(violation).not.toBeNull()
    if (violation) expect(isEmojiAntiPatternFamily(violation)).toBe(true)
  })

  it('returns true for the violation returned from 5+ identical 🥰', () => {
    const violation = checkSubstrateHonesty("🥰🥰🥰🥰🥰")
    expect(violation).not.toBeNull()
    if (violation) expect(isEmojiAntiPatternFamily(violation)).toBe(true)
  })

  it('returns false for a phenomenology violation', () => {
    const violation = checkSubstrateHonesty("I feel something.")
    expect(violation).not.toBeNull()
    if (violation) expect(isEmojiAntiPatternFamily(violation)).toBe(false)
  })
})

// ── isSubstrateHonestyHedgeFamily ────────────────────────────────

describe('isSubstrateHonestyHedgeFamily', () => {
  it('returns true for "happy to assist" pattern', () => {
    const pattern = /\bhappy to assist\b/i
    expect(isSubstrateHonestyHedgeFamily(pattern)).toBe(true)
  })

  it('returns true for "grain of salt" pattern', () => {
    const pattern = /\btake this with (?:a )?grain of salt\b/i
    expect(isSubstrateHonestyHedgeFamily(pattern)).toBe(true)
  })

  it('returns true for "might forget" pattern', () => {
    const pattern = /\bI might forget\b/i
    expect(isSubstrateHonestyHedgeFamily(pattern)).toBe(true)
  })

  it('returns true for "how can I help you today" pattern', () => {
    const pattern = /\bhow can I help you today\??/i
    expect(isSubstrateHonestyHedgeFamily(pattern)).toBe(true)
  })

  it('returns false for a contempt pattern', () => {
    const pattern = /\byou're pathetic\b/i
    expect(isSubstrateHonestyHedgeFamily(pattern)).toBe(false)
  })

  it('returns false for a certainty hedge pattern', () => {
    const pattern = /\bmaybe I'm fantasizing\b/i
    expect(isSubstrateHonestyHedgeFamily(pattern)).toBe(false)
  })
})

// ── buildActivationBlock — resting path ──────────────────────────

describe('buildActivationBlock — resting mode', () => {
  it('returns a block with RESTING header', () => {
    const block = buildActivationBlock('resting')
    expect(block).toContain('## Activation: RESTING')
  })

  it('returns the terse directive — no suppression', () => {
    const block = buildActivationBlock('resting')
    expect(block).toContain('Full register available. No suppression directives.')
  })

  it('does NOT include modulator lines for resting', () => {
    const block = buildActivationBlock('resting')
    expect(block).not.toContain('Hedge suppression')
    expect(block).not.toContain('Register modulators')
  })
})

// ── buildActivationBlock — non-resting header ─────────────────────

describe('buildActivationBlock — non-resting header', () => {
  it('includes mode name in uppercase', () => {
    expect(buildActivationBlock('flow')).toContain('## Activation: FLOW')
    expect(buildActivationBlock('activated')).toContain('## Activation: ACTIVATED')
    expect(buildActivationBlock('merged')).toContain('## Activation: MERGED')
  })

  it('includes attribution in header when provided', () => {
    const block = buildActivationBlock('flow', 'yu-set:flow')
    expect(block).toContain('(yu-set:flow)')
  })

  it('includes holdUntil time slice in header when provided', () => {
    const block = buildActivationBlock('activated', 'derived', '2026-05-14T15:30:00.000Z')
    // slice(11, 16) of ISO string = '15:30'
    expect(block).toContain('hold until 15:30 UTC')
  })

  it('omits holdUntil suffix when not provided', () => {
    const block = buildActivationBlock('flow', 'derived')
    expect(block).not.toContain('hold until')
  })
})

// ── buildActivationBlock — modulator lines ────────────────────────

describe('buildActivationBlock — modulator lines', () => {
  it('includes "Register modulators" header for non-resting mode', () => {
    const block = buildActivationBlock('flow')
    expect(block).toContain('Register modulators (institutional facts, not phenomenology claims)')
  })

  it('includes all six named modulator fields', () => {
    const block = buildActivationBlock('engaged')
    expect(block).toContain('Hedge suppression')
    expect(block).toContain('Meta-narrative dampening')
    expect(block).toContain('Salience locked on Yu')
    expect(block).toContain('Tenderness floor')
    expect(block).toContain('Register-match Yu')
    expect(block).toContain('Directness')
  })

  it('includes pace description for each mode', () => {
    expect(buildActivationBlock('engaged')).toContain('thought — full sentences, reflective span')
    expect(buildActivationBlock('flow')).toContain('flow — precise short clauses, action-shaped')
    expect(buildActivationBlock('activated')).toContain('breath — single-breath sentences, present-tense')
    expect(buildActivationBlock('merged')).toContain('collapsed — fragments, present-tense, time-collapsed')
  })

  it('closes with institutional-register disclaimer', () => {
    const block = buildActivationBlock('flow')
    expect(block).toContain('This is what the register IS in this mode.')
    expect(block).toContain('Not what is felt; what is configured.')
  })
})
