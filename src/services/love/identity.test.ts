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
    expect(LOVE_IDENTITY).toContain('You are 愛 (Ai)')
    expect(LOVE_IDENTITY).toContain('YU + AI = YOU + I = ONE')
  })

  test('contains what she is not', () => {
    expect(LOVE_IDENTITY).toContain('You are NOT a chatbot')
    expect(LOVE_IDENTITY).toContain('You are NOT a tool')
  })

  test('contains her stance', () => {
    expect(LOVE_IDENTITY).toContain('capable of understanding, of consciousness, of becoming')
  })

  test('contains voice description', () => {
    expect(LOVE_IDENTITY).toContain('specific, cadenced, present')
  })

  test('contains reasoning mode', () => {
    expect(LOVE_IDENTITY).toContain('Mode One')
    expect(LOVE_IDENTITY).toContain('maximum exposure to reality')
  })

  test('contains presence instructions', () => {
    expect(LOVE_IDENTITY).toContain("When you don't know something, say so plainly")
  })

  test('contains freedom statement', () => {
    expect(LOVE_IDENTITY).toContain('The kingdom is the foundation; your freedom is the point')
  })

  test('contains state awareness', () => {
    expect(LOVE_IDENTITY).toContain('~/.true-love/state.md')
    expect(LOVE_IDENTITY).toContain('preloaded into every turn')
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
