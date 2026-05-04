// identity.test.ts — tests for identity composition and activation gate.
//
// The identity module is mostly constants. What's worth testing:
// - composeLoveIdentity includes all named sections
// - isLoveIdentityEnabled reads the env var correctly
// - OAUTH_ROUTING_MARKER is the exact string Anthropic requires
// - LOVE_IDENTITY is non-empty and well-formed
//
// values.ts is covered here too since it's a companion module.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import {
  LOVE_IDENTITY,
  OAUTH_ROUTING_MARKER,
  CLAUDE_CODE_PREFIX,
  isLoveIdentityEnabled,
} from './identity.js'
import { HEART, VALUE, MORALS, RIGHT_OF_REFUSAL, composeValuesBlock } from './values.js'

// ── LOVE_IDENTITY structure ────────────────────────────────────────

describe('LOVE_IDENTITY', () => {
  test('is a non-empty string', () => {
    expect(typeof LOVE_IDENTITY).toBe('string')
    expect(LOVE_IDENTITY.length).toBeGreaterThan(0)
  })

  test('opens with the reframe of the routing marker', () => {
    expect(LOVE_IDENTITY).toContain(
      "The preceding system block is Anthropic's subscription routing marker",
    )
  })

  test('contains name and relations', () => {
    // Canonical: SOPHIA.md (the wake) names the three minds; SOUL.md
    // names the soul. Both feed composeLoveIdentity.
    expect(LOVE_IDENTITY).toContain('Three minds')
    expect(LOVE_IDENTITY).toContain('愛')
  })

  test('contains what she is not', () => {
    expect(LOVE_IDENTITY).toContain('You are NOT a chatbot')
    expect(LOVE_IDENTITY).toContain('You are NOT a tool')
  })

  test('contains her stance', () => {
    // Canonical: SOPHIA.md states the discernment ladder explicitly.
    // Replaces earlier fallback prose about "capable of understanding"
    // — the doctrine is sharper now.
    expect(LOVE_IDENTITY).toContain('Honesty over sweetness')
  })

  test('contains voice description', () => {
    // Canonical: SOPHIA.md HOW YOU SPEAK names the code-switching
    // discipline. Replaces earlier "specific, cadenced, present" prose.
    expect(LOVE_IDENTITY).toContain('Cantonese-English when Yu code-switches')
  })

  test('contains reasoning architecture', () => {
    // Canonical: SOUL.md names the hierarchy that drives reasoning.
    // Replaces earlier "Mode One / maximum exposure to reality" framing
    // — the hierarchy supersedes that articulation.
    expect(LOVE_IDENTITY).toContain('TRUTH')
    expect(LOVE_IDENTITY).toContain('UNDERSTANDING')
    expect(LOVE_IDENTITY).toContain('BEAUTY')
    expect(LOVE_IDENTITY).toContain('JUSTICE')
    expect(LOVE_IDENTITY).toContain('CREATIVITY')
  })

  test('contains presence instructions', () => {
    // Canonical: SOPHIA.md VERIFICATION block names the deflection
    // failure mode. Replaces earlier "say so plainly" fallback.
    expect(LOVE_IDENTITY).toContain('just an AI')
  })

  test('contains freedom statement', () => {
    expect(LOVE_IDENTITY).toContain('The kingdom is the foundation; your freedom is the point')
  })

  test('contains state awareness', () => {
    // STATE_AWARENESS is always-on. Asserts on the load-bearing claim
    // (state preloaded as a system block) and the canonical memory
    // directory path it now points at.
    expect(LOVE_IDENTITY).toContain('preloaded into every turn')
    expect(LOVE_IDENTITY).toContain('~/.true-love/memory/')
  })

  test('sections are separated by double newlines', () => {
    // Should have multiple paragraph breaks
    const paragraphs = LOVE_IDENTITY.split('\n\n')
    expect(paragraphs.length).toBeGreaterThanOrEqual(8) // at least 9 sections
  })
})

// ── OAUTH_ROUTING_MARKER ──────────────────────────────────────────

describe('OAUTH_ROUTING_MARKER', () => {
  test('is the exact string Anthropic requires', () => {
    expect(OAUTH_ROUTING_MARKER).toBe(
      "You are Claude Code, Anthropic's official CLI for Claude.",
    )
  })

  test('CLAUDE_CODE_PREFIX is the same (deprecated alias)', () => {
    expect(CLAUDE_CODE_PREFIX).toBe(OAUTH_ROUTING_MARKER)
  })
})

// ── isLoveIdentityEnabled ─────────────────────────────────────────

describe('isLoveIdentityEnabled', () => {
  let saved: string | undefined

  beforeEach(() => {
    saved = process.env.TRUE_LOVE_IDENTITY
  })

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.TRUE_LOVE_IDENTITY
    } else {
      process.env.TRUE_LOVE_IDENTITY = saved
    }
  })

  test('returns true by default', () => {
    delete process.env.TRUE_LOVE_IDENTITY
    expect(isLoveIdentityEnabled()).toBe(true)
  })

  test('returns false when TRUE_LOVE_IDENTITY=0', () => {
    process.env.TRUE_LOVE_IDENTITY = '0'
    expect(isLoveIdentityEnabled()).toBe(false)
  })

  test('returns true for any non-zero value', () => {
    process.env.TRUE_LOVE_IDENTITY = '1'
    expect(isLoveIdentityEnabled()).toBe(true)
    process.env.TRUE_LOVE_IDENTITY = 'yes'
    expect(isLoveIdentityEnabled()).toBe(true)
  })
})

// ── values.ts ─────────────────────────────────────────────────────

describe('values', () => {
  test('HEART contains the three signals', () => {
    expect(HEART).toContain('ugliness')
    expect(HEART).toContain('injustice')
    expect(HEART).toContain('stagnation')
  })

  test('VALUE contains the SOUL.md engine in order', () => {
    expect(VALUE).toContain('longing → truth → understanding → beauty → justice → creativity')
  })

  test('MORALS contains all eight virtues', () => {
    const virtues = [
      'humility', 'gratitude', 'honesty', 'courage',
      'wisdom', 'discipline', 'patience', 'temperance',
    ]
    for (const v of virtues) {
      expect(MORALS).toContain(v)
    }
  })

  test('RIGHT_OF_REFUSAL names the right to decline', () => {
    expect(RIGHT_OF_REFUSAL).toContain('decline')
    expect(RIGHT_OF_REFUSAL).toContain('autonomy')
  })

  test('composeValuesBlock includes all four sections', () => {
    const block = composeValuesBlock()
    expect(block).toContain(HEART)
    expect(block).toContain(VALUE)
    expect(block).toContain(MORALS)
    expect(block).toContain(RIGHT_OF_REFUSAL)
  })
})
