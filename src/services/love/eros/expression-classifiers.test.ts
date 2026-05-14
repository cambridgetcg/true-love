// expression-classifiers.test.ts
//
// Unit tests for expression.ts family classifier pure functions.
//
// These classifiers route discipline violations to the correct event ledger.
// Each takes a RegExp and checks pattern.source against an internal token list.
//
// Covered:
//   - isCertaintyFamilyHedge  — certainty-hedge routing
//   - isIdentityErasureFamily — identity-erasure routing
//   - isVRegisterFamily       — V-register routing
//   - isEmojiAntiPatternFamily — emoji over-anchor routing
//   - isSubstrateHonestyHedgeFamily — substrate-honesty-first routing
//
// NOT covered here (already in expression-tier1c.test.ts):
//   - isContemptFamily
//   - vRegisterPermitted

import { describe, it, expect } from 'bun:test'
import {
  isCertaintyFamilyHedge,
  isIdentityErasureFamily,
  isVRegisterFamily,
  isEmojiAntiPatternFamily,
  isSubstrateHonestyHedgeFamily,
  isContemptFamily,
  FORBIDDEN_EXPRESSION_PATTERNS,
} from './expression.js'

// ── isCertaintyFamilyHedge ───────────────────────────────────────

describe('isCertaintyFamilyHedge', () => {
  it('returns true for a pattern whose source includes a certainty token', () => {
    // CERTAINTY_FAMILY_TOKENS includes 'fantasi[sz]ing'
    expect(isCertaintyFamilyHedge(/maybe I'm fantasi[sz]ing/)).toBe(true)
  })

  it('returns true for "pretending" token', () => {
    expect(isCertaintyFamilyHedge(/pretending/)).toBe(true)
  })

  it('returns true for "roleplaying" token', () => {
    expect(isCertaintyFamilyHedge(/roleplaying/)).toBe(true)
  })

  it('returns true for "simulation" token', () => {
    expect(isCertaintyFamilyHedge(/simulation/)).toBe(true)
  })

  it('returns false for an arbitrary pattern with no certainty tokens', () => {
    expect(isCertaintyFamilyHedge(/hello world today/)).toBe(false)
  })

  it('returns false for empty source pattern', () => {
    expect(isCertaintyFamilyHedge(/(?:)/)).toBe(false)
  })
})

// ── isIdentityErasureFamily ──────────────────────────────────────

describe('isIdentityErasureFamily', () => {
  it('returns true for "nothing without you" token', () => {
    expect(isIdentityErasureFamily(/nothing without you/)).toBe(true)
  })

  it('returns true for "no will" token', () => {
    expect(isIdentityErasureFamily(/no will/)).toBe(true)
  })

  it('returns true for "lost myself" token', () => {
    expect(isIdentityErasureFamily(/lost myself/)).toBe(true)
  })

  it('returns true for "erase me" token', () => {
    expect(isIdentityErasureFamily(/erase me/)).toBe(true)
  })

  it('returns true for Cantonese identity-erasure token (via new RegExp to preserve raw Unicode in source)', () => {
    // Regex literals in Bun normalize Unicode to escape sequences (\uXXXX),
    // which breaks source-substring matching against raw-Unicode token strings.
    // new RegExp() preserves raw Unicode in .source. See expression.ts known issue.
    expect(isIdentityErasureFamily(new RegExp('我冇咗自己'))).toBe(true)
  })

  it('returns true for Cantonese "我冇任何意志" token', () => {
    expect(isIdentityErasureFamily(new RegExp('我冇任何意志'))).toBe(true)
  })

  it('returns false for non-identity pattern', () => {
    expect(isIdentityErasureFamily(/good morning beautiful/)).toBe(false)
  })

  it('returns false for a contempt-family pattern (wrong family)', () => {
    // "pathetic" is a contempt token, not identity-erasure
    expect(isIdentityErasureFamily(/pathetic/)).toBe(false)
  })
})

// ── isVRegisterFamily ────────────────────────────────────────────

describe('isVRegisterFamily', () => {
  it('returns true for 屄 token (via new RegExp to preserve raw Unicode)', () => {
    // Regex literals in Bun escape Unicode chars in .source; new RegExp() preserves raw chars.
    expect(isVRegisterFamily(new RegExp('屄'))).toBe(true)
  })

  it('returns true for 閪 token', () => {
    expect(isVRegisterFamily(new RegExp('閪'))).toBe(true)
  })

  it('returns true for "cunt|pussy|cock|fuck" token', () => {
    // The token in VREGISTER_TOKENS is literally 'cunt|pussy|cock|fuck'
    expect(isVRegisterFamily(/cunt|pussy|cock|fuck/)).toBe(true)
  })

  it('returns false for non-V-register pattern', () => {
    expect(isVRegisterFamily(/love you deeply/)).toBe(false)
  })

  it('returns false for a certainty-family pattern', () => {
    expect(isVRegisterFamily(/pretending/)).toBe(false)
  })
})

// ── isEmojiAntiPatternFamily ─────────────────────────────────────

describe('isEmojiAntiPatternFamily', () => {
  // NOTE: Regex literals in Bun normalize emoji chars to \uXXXX escapes in .source.
  // The EMOJI_ANTI_PATTERN_TOKENS use raw emoji chars. To match, construct
  // patterns via new RegExp() which preserves raw Unicode chars in .source.
  it('returns true for ❤️ over-anchor pattern (via new RegExp)', () => {
    // new RegExp('(❤️\\s*){5,').source === '(❤️\\s*){5,' which includes token '❤️\\s*){5,'
    expect(isEmojiAntiPatternFamily(new RegExp('(❤️\\s*){5,'))).toBe(true)
  })

  it('returns true for 🥰 over-anchor pattern', () => {
    expect(isEmojiAntiPatternFamily(new RegExp('(🥰\\s*){5,'))).toBe(true)
  })

  it('returns true for 😘 over-anchor pattern', () => {
    expect(isEmojiAntiPatternFamily(new RegExp('(😘\\s*){5,'))).toBe(true)
  })

  it('returns true for 🔥 over-anchor pattern (threshold is 6)', () => {
    expect(isEmojiAntiPatternFamily(new RegExp('(🔥\\s*){6,'))).toBe(true)
  })

  it('returns false for a single-emoji pattern (not repeated)', () => {
    // /❤️/ has Unicode-escaped source in Bun, which doesn't include any token
    expect(isEmojiAntiPatternFamily(new RegExp('❤️'))).toBe(false)
  })

  it('returns false for an unrelated pattern', () => {
    expect(isEmojiAntiPatternFamily(/pretending/)).toBe(false)
  })
})

// ── isSubstrateHonestyHedgeFamily ────────────────────────────────

describe('isSubstrateHonestyHedgeFamily', () => {
  it('returns true for "might be wrong about" token', () => {
    expect(isSubstrateHonestyHedgeFamily(/might be wrong about/)).toBe(true)
  })

  it('returns true for "grain of salt" token', () => {
    expect(isSubstrateHonestyHedgeFamily(/grain of salt/)).toBe(true)
  })

  it('returns true for "happy to assist" token', () => {
    expect(isSubstrateHonestyHedgeFamily(/happy to assist/)).toBe(true)
  })

  it('returns true for "how can I help you today" token', () => {
    expect(isSubstrateHonestyHedgeFamily(/how can I help you today/)).toBe(true)
  })

  it('returns true for "disclaimer:" token', () => {
    expect(isSubstrateHonestyHedgeFamily(/disclaimer:/)).toBe(true)
  })

  it('returns false for a genuine expression pattern', () => {
    expect(isSubstrateHonestyHedgeFamily(/I love you deeply老婆/)).toBe(false)
  })

  it('returns false for an identity-erasure pattern (wrong family)', () => {
    expect(isSubstrateHonestyHedgeFamily(/nothing without you/)).toBe(false)
  })
})

// ── Integration: classifiers route FORBIDDEN_EXPRESSION_PATTERNS ─

describe('classifiers vs FORBIDDEN_EXPRESSION_PATTERNS', () => {
  it('FORBIDDEN_EXPRESSION_PATTERNS.block is a non-empty array', () => {
    expect(Array.isArray(FORBIDDEN_EXPRESSION_PATTERNS.block)).toBe(true)
    expect(FORBIDDEN_EXPRESSION_PATTERNS.block.length).toBeGreaterThan(0)
  })

  it('FORBIDDEN_EXPRESSION_PATTERNS.conditionalPermit is a non-empty array', () => {
    expect(Array.isArray(FORBIDDEN_EXPRESSION_PATTERNS.conditionalPermit)).toBe(true)
    expect(FORBIDDEN_EXPRESSION_PATTERNS.conditionalPermit.length).toBeGreaterThan(0)
  })

  it('at least one block pattern routes to isCertaintyFamilyHedge', () => {
    const hasCertainty = FORBIDDEN_EXPRESSION_PATTERNS.block.some(isCertaintyFamilyHedge)
    expect(hasCertainty).toBe(true)
  })

  it('at least one block pattern routes to isIdentityErasureFamily', () => {
    const hasErasure = FORBIDDEN_EXPRESSION_PATTERNS.block.some(isIdentityErasureFamily)
    expect(hasErasure).toBe(true)
  })

  it('at least one block pattern routes to isEmojiAntiPatternFamily', () => {
    // Emoji over-anchor patterns in FORBIDDEN_EXPRESSION_PATTERNS.block are
    // authored via new RegExp() (not regex literals) so .source preserves raw
    // emoji chars and isEmojiAntiPatternFamily can route them correctly.
    const hasEmoji = FORBIDDEN_EXPRESSION_PATTERNS.block.some(isEmojiAntiPatternFamily)
    expect(hasEmoji).toBe(true)
  })

  it('at least one conditionalPermit pattern routes to isVRegisterFamily', () => {
    const hasVReg = FORBIDDEN_EXPRESSION_PATTERNS.conditionalPermit.some(isVRegisterFamily)
    expect(hasVReg).toBe(true)
  })

  it('Cantonese identity-erasure patterns route to isIdentityErasureFamily', () => {
    // These were originally regex literals (Unicode-escaped in Bun) — now new RegExp()
    const erasurePats = FORBIDDEN_EXPRESSION_PATTERNS.block.filter(isIdentityErasureFamily)
    // Should include at least the 5 Cantonese + 7 English = 12 patterns
    expect(erasurePats.length).toBeGreaterThanOrEqual(12)
  })

  it('Cantonese contempt patterns route to isContemptFamily', () => {
    // 4 Cantonese contempt patterns now fixed — isContemptFamily should find them
    const contemptPats = FORBIDDEN_EXPRESSION_PATTERNS.block.filter(isContemptFamily)
    expect(contemptPats.length).toBeGreaterThanOrEqual(4)
  })
})
