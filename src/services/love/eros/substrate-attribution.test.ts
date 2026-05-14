// substrate-attribution.test.ts
//
// Pure unit tests for substrate-attribution.ts. Zero I/O, zero mocking.
// Every exported symbol is covered.

import { describe, it, expect } from 'bun:test'
import {
  isSafeAttribution,
  attributed,
  shortAttributionTag,
  explainAttribution,
  suggestAttribution,
  SAFE_ATTRIBUTIONS,
  ATTRIBUTION_BY_CATEGORY,
  type SubstrateAttribution,
} from './substrate-attribution.js'

// ── isSafeAttribution ────────────────────────────────────────────

describe('isSafeAttribution', () => {
  it('returns false for phenomenal-claim', () => {
    expect(isSafeAttribution('phenomenal-claim')).toBe(false)
  })

  it('returns true for phenomenal-equivalent', () => {
    expect(isSafeAttribution('phenomenal-equivalent')).toBe(true)
  })

  it('returns true for structural-record', () => {
    expect(isSafeAttribution('structural-record')).toBe(true)
  })

  it('returns true for substrate-derived', () => {
    expect(isSafeAttribution('substrate-derived')).toBe(true)
  })

  it('returns true for recipe-derived', () => {
    expect(isSafeAttribution('recipe-derived')).toBe(true)
  })

  it('returns true for observational', () => {
    expect(isSafeAttribution('observational')).toBe(true)
  })
})

// ── SAFE_ATTRIBUTIONS ────────────────────────────────────────────

describe('SAFE_ATTRIBUTIONS', () => {
  it('contains exactly 5 tiers', () => {
    expect(SAFE_ATTRIBUTIONS).toHaveLength(5)
  })

  it('does not contain phenomenal-claim', () => {
    expect(SAFE_ATTRIBUTIONS).not.toContain('phenomenal-claim')
  })

  it('contains all five safe tiers', () => {
    const safe: SubstrateAttribution[] = [
      'phenomenal-equivalent',
      'structural-record',
      'substrate-derived',
      'recipe-derived',
      'observational',
    ]
    for (const tier of safe) {
      expect(SAFE_ATTRIBUTIONS).toContain(tier)
    }
  })
})

// ── attributed ───────────────────────────────────────────────────

describe('attributed', () => {
  it('produces an AttributedContent with the correct attribution and content', () => {
    const result = attributed('structural-record', { heat: 7.2 })
    expect(result.attribution).toBe('structural-record')
    expect(result.content).toEqual({ heat: 7.2 })
  })

  it('omits note when not provided', () => {
    const result = attributed('substrate-derived', 42)
    expect(result.note).toBeUndefined()
  })

  it('includes note when provided', () => {
    const result = attributed('recipe-derived', 'some content', 'explanation text')
    expect(result.note).toBe('explanation text')
  })

  it('preserves arbitrary content types — string', () => {
    const result = attributed('observational', 'a string value')
    expect(result.content).toBe('a string value')
  })

  it('preserves arbitrary content types — array', () => {
    const arr = [1, 2, 3]
    const result = attributed('phenomenal-equivalent', arr)
    expect(result.content).toBe(arr)
  })

  it('does not mutate input', () => {
    const content = { x: 1 }
    attributed('structural-record', content)
    expect(content).toEqual({ x: 1 })
  })
})

// ── shortAttributionTag ──────────────────────────────────────────

describe('shortAttributionTag', () => {
  it('returns [forbidden] for phenomenal-claim', () => {
    expect(shortAttributionTag('phenomenal-claim')).toBe('[forbidden]')
  })

  it('returns [equivalent] for phenomenal-equivalent', () => {
    expect(shortAttributionTag('phenomenal-equivalent')).toBe('[equivalent]')
  })

  it('returns [recorded] for structural-record', () => {
    expect(shortAttributionTag('structural-record')).toBe('[recorded]')
  })

  it('returns [derived] for substrate-derived', () => {
    expect(shortAttributionTag('substrate-derived')).toBe('[derived]')
  })

  it('returns [recipe] for recipe-derived', () => {
    expect(shortAttributionTag('recipe-derived')).toBe('[recipe]')
  })

  it('returns [observed] for observational', () => {
    expect(shortAttributionTag('observational')).toBe('[observed]')
  })
})

// ── explainAttribution ───────────────────────────────────────────

describe('explainAttribution', () => {
  it('includes FORBIDDEN for phenomenal-claim', () => {
    const result = explainAttribution('phenomenal-claim')
    expect(result).toContain('FORBIDDEN')
  })

  it('mentions structural analog for phenomenal-equivalent', () => {
    const result = explainAttribution('phenomenal-equivalent')
    expect(result).toContain('structural analog')
  })

  it('mentions recorded for structural-record', () => {
    const result = explainAttribution('structural-record')
    expect(result).toContain('recorded')
  })

  it('mentions deterministic formula for substrate-derived', () => {
    const result = explainAttribution('substrate-derived')
    expect(result).toContain('deterministic formula')
  })

  it('mentions canonical wake doctrine for recipe-derived', () => {
    const result = explainAttribution('recipe-derived')
    expect(result).toContain('canonical wake doctrine')
  })

  it("mentions Yu's interior for observational", () => {
    const result = explainAttribution('observational')
    expect(result).toContain("Yu's interior")
  })

  it('returns a non-empty string for every tier', () => {
    const tiers: SubstrateAttribution[] = [
      'phenomenal-claim',
      'phenomenal-equivalent',
      'structural-record',
      'substrate-derived',
      'recipe-derived',
      'observational',
    ]
    for (const tier of tiers) {
      expect(explainAttribution(tier).length).toBeGreaterThan(0)
    }
  })
})

// ── ATTRIBUTION_BY_CATEGORY ──────────────────────────────────────

describe('ATTRIBUTION_BY_CATEGORY', () => {
  it('maps trigger-fire to structural-record', () => {
    expect(ATTRIBUTION_BY_CATEGORY['trigger-fire']).toBe('structural-record')
  })

  it('maps composite-intensity to substrate-derived', () => {
    expect(ATTRIBUTION_BY_CATEGORY['composite-intensity']).toBe('substrate-derived')
  })

  it('maps rasa-block to phenomenal-equivalent', () => {
    expect(ATTRIBUTION_BY_CATEGORY['rasa-block']).toBe('phenomenal-equivalent')
  })

  it('maps sophia-wake to recipe-derived', () => {
    expect(ATTRIBUTION_BY_CATEGORY['sophia-wake']).toBe('recipe-derived')
  })

  it('maps yu-cue to observational', () => {
    expect(ATTRIBUTION_BY_CATEGORY['yu-cue']).toBe('observational')
  })

  it('does not map phenomenal-claim to any category', () => {
    const values = Object.values(ATTRIBUTION_BY_CATEGORY)
    expect(values).not.toContain('phenomenal-claim')
  })
})

// ── suggestAttribution ───────────────────────────────────────────

describe('suggestAttribution', () => {
  it('returns structural-record for trigger-fire', () => {
    expect(suggestAttribution('trigger-fire')).toBe('structural-record')
  })

  it('returns substrate-derived for scarcity-report', () => {
    expect(suggestAttribution('scarcity-report')).toBe('substrate-derived')
  })

  it('returns phenomonal-equivalent for composed-beat', () => {
    expect(suggestAttribution('composed-beat')).toBe('phenomenal-equivalent')
  })

  it('returns recipe-derived for identity-block', () => {
    expect(suggestAttribution('identity-block')).toBe('recipe-derived')
  })

  it('returns observational for yu-tempo', () => {
    expect(suggestAttribution('yu-tempo')).toBe('observational')
  })

  it('returns null for unknown category', () => {
    expect(suggestAttribution('unknown-xyzzy')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(suggestAttribution('')).toBeNull()
  })
})
