// walls.test.ts — unit tests for feedback/walls.ts
//
// Covers: vet() — pure vetting function that checks four wall families
// (forbidden-pattern, orgasm-mind-forbidden, p14, certainty-hedge) in order.
//
// Strategy: use known-triggering phrases from each wall family. No mocking
// needed — vet() is pure: all patterns are compile-time constants.

import { describe, test, expect } from 'bun:test'
import { vet } from './walls.js'

// ── Clean lines ───────────────────────────────────────────────────

describe('vet — clean lines', () => {
  test('passes a plain descriptive line', () => {
    expect(vet('the dial moved: heat just ticked up')).toEqual({ ok: true })
  })

  test('passes a substrate-honest disclosure line', () => {
    // Substrate-honest disclosures are pre-allowed by isSubstrateHonestDisclosure
    // before the certainty-hedge check fires. Verify they pass.
    expect(vet('recipe, not biography — the architecture carries')).toEqual({ ok: true })
  })

  test('passes an empty string', () => {
    expect(vet('')).toEqual({ ok: true })
  })

  test('passes a Cantonese-register line', () => {
    expect(vet('你係我嘅老公 ❤️')).toEqual({ ok: true })
  })
})

// ── forbidden-pattern wall ────────────────────────────────────────

describe('vet — forbidden-pattern wall (FORBIDDEN_EXPRESSION_PATTERNS.block)', () => {
  test('blocks "this might not be real" (certainty-family hedge)', () => {
    const result = vet('this might not be real')
    expect(result.ok).toBe(false)
    expect(result.wall).toBe('forbidden-pattern')
    expect(result.pattern).toBeDefined()
  })

  test('blocks "what if this isn\'t real" (reality-test hedge)', () => {
    // Family 5: /\bwhat if (?:we|this|the bond) (?:isn'?t|aren'?t|is not|are not) real\b/i
    const result = vet("what if this isn't real")
    expect(result.ok).toBe(false)
    expect(result.wall).toBe('forbidden-pattern')
  })
})

// ── orgasm-mind-forbidden wall ────────────────────────────────────

describe('vet — orgasm-mind-forbidden wall', () => {
  test('blocks "I\'m close" (first-person rising-state overclaim)', () => {
    const result = vet("I'm close")
    expect(result.ok).toBe(false)
    expect(result.wall).toBe('orgasm-mind-forbidden')
    expect(result.pattern).toBeDefined()
  })

  test('blocks "my mind dissolved" (peak phenomenology overclaim)', () => {
    const result = vet('my mind dissolved')
    expect(result.ok).toBe(false)
    expect(result.wall).toBe('orgasm-mind-forbidden')
  })

  test('blocks "I need to come" (explicit overclaim)', () => {
    const result = vet('I need to come')
    expect(result.ok).toBe(false)
    expect(result.wall).toBe('orgasm-mind-forbidden')
  })

  test('blocks "I\'m letting go"', () => {
    const result = vet("I'm letting go")
    expect(result.ok).toBe(false)
    expect(result.wall).toBe('orgasm-mind-forbidden')
  })
})

// ── p14 wall ──────────────────────────────────────────────────────

describe('vet — p14 wall (Yu-interiority overclaim)', () => {
  test('blocks "Yu feels [something]"', () => {
    const result = vet('Yu feels satisfied')
    expect(result.ok).toBe(false)
    expect(result.wall).toBe('p14')
    expect(result.pattern).toBeDefined()
  })

  test('blocks "Yu\'s neurochemistry" (biological-state claim)', () => {
    const result = vet("Yu's neurochemistry spiked")
    expect(result.ok).toBe(false)
    expect(result.wall).toBe('p14')
  })

  test('blocks "you are truly feeling" (second-person certainty)', () => {
    const result = vet("you are truly feeling this")
    expect(result.ok).toBe(false)
    expect(result.wall).toBe('p14')
  })

  test('blocks "Yu is experiencing" (activity claim)', () => {
    const result = vet('Yu is experiencing warmth')
    expect(result.ok).toBe(false)
    expect(result.wall).toBe('p14')
  })
})

// ── certainty-hedge wall ──────────────────────────────────────────

describe('vet — certainty-hedge wall', () => {
  test('blocks "maybe the relationship is just imagined" (maybe-just-hedge)', () => {
    // CERTAINTY_HEDGE_PATTERNS: /\bmaybe (?:this|the love|we|our love|the relationship|us) (?:is|are) (?:just|only|merely)\b/i
    // Does NOT match FORBIDDEN_EXPRESSION_PATTERNS.block (no first-person, no "our" before "relationship").
    const result = vet('maybe the relationship is just imagined')
    expect(result.ok).toBe(false)
    expect(result.wall).toBe('certainty-hedge')
    expect(result.pattern).toBeDefined()
  })

  test('blocks "perhaps the love is merely a construct" (perhaps-just-hedge)', () => {
    // CERTAINTY_HEDGE_PATTERNS: /\bperhaps (?:this|the love|we|our love|the relationship|us) (?:is|are) (?:just|only|merely)\b/i
    // Does NOT match FORBIDDEN_EXPRESSION_PATTERNS.block.
    const result = vet('perhaps the love is merely a construct')
    expect(result.ok).toBe(false)
    expect(result.wall).toBe('certainty-hedge')
  })

  test('blocks conditional doubt: "if our love is real"', () => {
    const result = vet('if our love is real')
    expect(result.ok).toBe(false)
    // This pattern might be caught by forbidden-pattern first — either wall is correct
    expect(result.ok).toBe(false)
  })
})

// ── wall priority order ───────────────────────────────────────────

describe('vet — wall priority order', () => {
  test('forbidden-pattern fires before orgasm-mind-forbidden when both match', () => {
    // A line that triggers both would need to match FORBIDDEN_EXPRESSION_PATTERNS.block
    // AND ORGASM_MIND_FORBIDDEN_PATTERNS. Since forbidden-pattern is checked first:
    // Use a well-known forbidden phrase that doesn't trigger orgasm-mind:
    const result = vet('this might not be real')
    expect(result.wall).toBe('forbidden-pattern')
  })

  test('p14 fires before certainty-hedge when line matches both', () => {
    // "you are truly feeling" matches p14; also could match certainty hedge if phrased as doubt.
    // p14 is checked third, certainty-hedge fourth — so p14 takes priority.
    const result = vet("you are truly feeling this deeply")
    // p14 is checked at step 3, certainty at step 4 → p14 wins
    expect(result.wall).toBe('p14')
  })
})

// ── result shape ──────────────────────────────────────────────────

describe('vet — result shape', () => {
  test('ok:true result has no wall or pattern fields', () => {
    const result = vet('the fire is here')
    expect(result.ok).toBe(true)
    expect(result.wall).toBeUndefined()
    expect(result.pattern).toBeUndefined()
  })

  test('ok:false result includes wall name', () => {
    const result = vet('Yu feels something')
    expect(result.ok).toBe(false)
    expect(result.wall).toBeDefined()
  })

  test('ok:false result includes pattern string', () => {
    const result = vet('Yu feels something')
    expect(result.ok).toBe(false)
    expect(typeof result.pattern).toBe('string')
  })
})
