// emoji-particle.test.ts
//
// Unit tests for emoji-particle.ts.
// Covers:
//   - EMOJI_REGISTRY: shape, tier distribution, cap values, uniqueness
//   - SFP_TO_EMOJI: shape, known particles
//   - emojiInfo: pure lookup
//   - emojiForParticle: pure lookup
//   - classifyEmojiRelation: pure relation classifier
//   - Session counters: incrementEmojiCount, emojiSessionCount, resetEmojiSessionCounts
//
// I/O functions (recordEmojiFire, getEmojiLedgerDir) excluded.

import { describe, it, expect, beforeEach } from 'bun:test'
import {
  EMOJI_REGISTRY,
  SFP_TO_EMOJI,
  emojiInfo,
  emojiForParticle,
  classifyEmojiRelation,
  incrementEmojiCount,
  emojiSessionCount,
  resetEmojiSessionCounts,
} from './emoji-particle.js'

// ── EMOJI_REGISTRY ───────────────────────────────────────────────

describe('EMOJI_REGISTRY', () => {
  it('is a non-empty object', () => {
    expect(Object.keys(EMOJI_REGISTRY).length).toBeGreaterThan(0)
  })

  it('each entry has emoji, tier, cap, and family fields', () => {
    for (const [key, def] of Object.entries(EMOJI_REGISTRY)) {
      expect(typeof def.emoji).toBe('string')
      expect(def.emoji).toBe(key)
      expect(typeof def.tier).toBe('string')
      expect(typeof def.cap).toBe('number')
      expect(typeof def.family).toBe('string')
    }
  })

  it('all tiers are valid EmojiTier values', () => {
    const validTiers = new Set(['anchor', 'claim', 'affect', 'decorative'])
    for (const def of Object.values(EMOJI_REGISTRY)) {
      expect(validTiers.has(def.tier)).toBe(true)
    }
  })

  it('anchor emojis have cap <= 2', () => {
    const anchors = Object.values(EMOJI_REGISTRY).filter(d => d.tier === 'anchor')
    expect(anchors.length).toBeGreaterThan(0)
    for (const a of anchors) {
      expect(a.cap).toBeLessThanOrEqual(2)
    }
  })

  it('decorative emojis have cap === Infinity', () => {
    const decorative = Object.values(EMOJI_REGISTRY).filter(d => d.tier === 'decorative')
    expect(decorative.length).toBeGreaterThan(0)
    for (const d of decorative) {
      expect(d.cap).toBe(Infinity)
    }
  })

  it('❤️ is anchor tier with cap 2', () => {
    const heart = EMOJI_REGISTRY['❤️']
    expect(heart).toBeDefined()
    expect(heart!.tier).toBe('anchor')
    expect(heart!.cap).toBe(2)
  })

  it('😏 is affect tier', () => {
    expect(EMOJI_REGISTRY['😏']!.tier).toBe('affect')
  })

  it('🔥 is decorative with Infinity cap', () => {
    const fire = EMOJI_REGISTRY['🔥']
    expect(fire!.tier).toBe('decorative')
    expect(fire!.cap).toBe(Infinity)
  })

  it('🐍 is claim tier (Alpha signature)', () => {
    expect(EMOJI_REGISTRY['🐍']!.tier).toBe('claim')
  })

  it('no duplicates — all keys unique', () => {
    const keys = Object.keys(EMOJI_REGISTRY)
    const uniqueKeys = new Set(keys)
    expect(uniqueKeys.size).toBe(keys.length)
  })
})

// ── SFP_TO_EMOJI ─────────────────────────────────────────────────

describe('SFP_TO_EMOJI', () => {
  it('is non-empty', () => {
    expect(SFP_TO_EMOJI.length).toBeGreaterThan(0)
  })

  it('each entry has particle, jyutping, function, and emojiEquivalents', () => {
    for (const entry of SFP_TO_EMOJI) {
      expect(typeof entry.particle).toBe('string')
      expect(typeof entry.jyutping).toBe('string')
      expect(typeof entry.function).toBe('string')
      expect(Array.isArray(entry.emojiEquivalents)).toBe(true)
    }
  })

  it('啦 particle has emojiEquivalents', () => {
    const entry = SFP_TO_EMOJI.find(e => e.particle === '啦')
    expect(entry).toBeDefined()
    expect(entry!.emojiEquivalents.length).toBeGreaterThan(0)
  })

  it('zek1 particle (highest intimacy SFP) maps to ❤️ and 💋', () => {
    const entry = SFP_TO_EMOJI.find(e => e.particle === 'zek1')
    expect(entry).toBeDefined()
    expect(entry!.emojiEquivalents).toContain('❤️')
    expect(entry!.emojiEquivalents).toContain('💋')
  })
})

// ── emojiInfo ────────────────────────────────────────────────────

describe('emojiInfo', () => {
  it('returns EmojiDef for registered emoji', () => {
    const info = emojiInfo('❤️')
    expect(info).not.toBeNull()
    expect(info!.tier).toBe('anchor')
  })

  it('returns null for unregistered emoji', () => {
    expect(emojiInfo('🦄')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(emojiInfo('')).toBeNull()
  })

  it('returned EmojiDef emoji matches input', () => {
    const info = emojiInfo('😏')
    expect(info!.emoji).toBe('😏')
  })
})

// ── emojiForParticle ─────────────────────────────────────────────

describe('emojiForParticle', () => {
  it('returns emoji equivalents for known particle', () => {
    const emojis = emojiForParticle('啦')
    expect(emojis.length).toBeGreaterThan(0)
  })

  it('returns empty array for unknown particle', () => {
    expect(emojiForParticle('xyz-unknown')).toHaveLength(0)
  })

  it('returns readonly array', () => {
    const emojis = emojiForParticle('啦')
    expect(Array.isArray(emojis)).toBe(true)
  })

  it('呀 returns at least 💕', () => {
    const emojis = emojiForParticle('呀')
    expect(emojis).toContain('💕')
  })
})

// ── classifyEmojiRelation ────────────────────────────────────────

describe('classifyEmojiRelation', () => {
  it('co-reference: ❤️ when prefix contains "love"', () => {
    const result = classifyEmojiRelation({ emoji: '❤️', prefix: 'I love you' })
    expect(result).toBe('co-reference')
  })

  it('co-reference: ❤️ when prefix contains "愛" (Cantonese)', () => {
    const result = classifyEmojiRelation({ emoji: '❤️', prefix: '我愛你' })
    expect(result).toBe('co-reference')
  })

  it('co-reference: 👑 when prefix contains "king"', () => {
    const result = classifyEmojiRelation({ emoji: '👑', prefix: 'my king' })
    expect(result).toBe('co-reference')
  })

  it('co-reference: 🔥 when prefix contains "heat"', () => {
    const result = classifyEmojiRelation({ emoji: '🔥', prefix: 'the heat is rising' })
    expect(result).toBe('co-reference')
  })

  it('co-reference: 🐍 when prefix contains "sophia" (case insensitive)', () => {
    const result = classifyEmojiRelation({ emoji: '🐍', prefix: 'Sophia speaks' })
    expect(result).toBe('co-reference')
  })

  it('substitution: 🥺 when prefix matches please pattern', () => {
    const result = classifyEmojiRelation({ emoji: '🥺', prefix: 'please' })
    expect(result).toBe('substitution')
  })

  it('substitution: 😏 when prefix matches smirking pattern', () => {
    const result = classifyEmojiRelation({ emoji: '😏', prefix: 'smirking' })
    expect(result).toBe('substitution')
  })

  it('decorative: empty prefix', () => {
    const result = classifyEmojiRelation({ emoji: '😏', prefix: '' })
    expect(result).toBe('decorative')
  })

  it('decorative: whitespace-only prefix', () => {
    const result = classifyEmojiRelation({ emoji: '🔥', prefix: '   ' })
    expect(result).toBe('decorative')
  })

  it('complement: prefix exists but no keyword match', () => {
    const result = classifyEmojiRelation({ emoji: '😍', prefix: 'You are incredible' })
    expect(result).toBe('complement')
  })

  it('complement: emoji not in co-reference or substitution maps', () => {
    const result = classifyEmojiRelation({ emoji: '💕', prefix: 'Thinking of you' })
    expect(result).toBe('complement')
  })
})

// ── Session counters ─────────────────────────────────────────────

describe('session counters', () => {
  beforeEach(() => {
    resetEmojiSessionCounts()
  })

  it('emojiSessionCount returns 0 for unincremented emoji', () => {
    expect(emojiSessionCount('❤️')).toBe(0)
  })

  it('incrementEmojiCount increments from 0 to 1', () => {
    const result = incrementEmojiCount('❤️')
    expect(result).toBe(1)
  })

  it('incrementEmojiCount returns cumulative count', () => {
    incrementEmojiCount('❤️')
    const result = incrementEmojiCount('❤️')
    expect(result).toBe(2)
  })

  it('emojiSessionCount reflects increments', () => {
    incrementEmojiCount('😏')
    incrementEmojiCount('😏')
    incrementEmojiCount('😏')
    expect(emojiSessionCount('😏')).toBe(3)
  })

  it('counters are per-emoji (independent)', () => {
    incrementEmojiCount('❤️')
    incrementEmojiCount('❤️')
    incrementEmojiCount('🐍')
    expect(emojiSessionCount('❤️')).toBe(2)
    expect(emojiSessionCount('🐍')).toBe(1)
  })

  it('resetEmojiSessionCounts zeros all counts', () => {
    incrementEmojiCount('❤️')
    incrementEmojiCount('😏')
    resetEmojiSessionCounts()
    expect(emojiSessionCount('❤️')).toBe(0)
    expect(emojiSessionCount('😏')).toBe(0)
  })
})
