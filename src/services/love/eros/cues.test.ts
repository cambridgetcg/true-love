// cues.test.ts
//
// Unit tests for eros/cues.ts pure functions.
//
// Coverage:
//   - getCueDeltas: known/unknown names
//   - getAllCueNames: shape + presence of key names
//   - detectCues: result shape, individual non-Cantonese patterns,
//     edge cases (empty, no match), multi-cue aggregation,
//     heat-emoji bonus (multi-instance), cluster density bonus (5+)
//
// Cantonese patterns (liu-flirt-family, kin-claim-presupposition,
// vulgar-intensifier-infix, reduplication-tempo, softening-particle,
// daam-body-verb) are already covered by cues-cantonese.test.ts.
// No duplication here.

import { describe, it, expect } from 'bun:test'
import { detectCues, getCueDeltas, getAllCueNames } from './cues.js'

// ── getCueDeltas ─────────────────────────────────────────────────

describe('getCueDeltas', () => {
  it('returns deltas for a known cue name', () => {
    const deltas = getCueDeltas('wife-possessive')
    expect(deltas).not.toBeNull()
  })

  it('wife-possessive deltas include limerence and heat', () => {
    const deltas = getCueDeltas('wife-possessive')!
    expect(deltas.limerence).toBe(1.0)
    expect(deltas.heat).toBe(0.5)
  })

  it('returns null for unknown cue name', () => {
    const deltas = getCueDeltas('not-a-real-cue')
    expect(deltas).toBeNull()
  })

  it('returns null for empty string', () => {
    const deltas = getCueDeltas('')
    expect(deltas).toBeNull()
  })

  it('returned deltas object is independent (copy, not reference)', () => {
    const d1 = getCueDeltas('pet-name')!
    const d2 = getCueDeltas('pet-name')!
    d1.limerence = 999
    expect(d2.limerence).toBe(0.5)
  })

  it('heat-emoji deltas include heat', () => {
    const deltas = getCueDeltas('heat-emoji')!
    expect(deltas.heat).toBe(0.3)
  })
})

// ── getAllCueNames ───────────────────────────────────────────────

describe('getAllCueNames', () => {
  it('returns a non-empty array', () => {
    const names = getAllCueNames()
    expect(names.length).toBeGreaterThan(0)
  })

  it('all entries are strings', () => {
    const names = getAllCueNames()
    for (const name of names) {
      expect(typeof name).toBe('string')
    }
  })

  it('includes wife-possessive', () => {
    expect(getAllCueNames()).toContain('wife-possessive')
  })

  it('includes heat-emoji', () => {
    expect(getAllCueNames()).toContain('heat-emoji')
  })

  it('includes all-caps-intensity', () => {
    expect(getAllCueNames()).toContain('all-caps-intensity')
  })

  it('includes liu-flirt-family (Cantonese pattern)', () => {
    expect(getAllCueNames()).toContain('liu-flirt-family')
  })
})

// ── detectCues — result shape ────────────────────────────────────

describe('detectCues — result shape', () => {
  it('returns matches and deltas properties', () => {
    const result = detectCues('hello')
    expect(result).toHaveProperty('matches')
    expect(result).toHaveProperty('deltas')
  })

  it('matches is an array', () => {
    const result = detectCues('老婆')
    expect(Array.isArray(result.matches)).toBe(true)
  })

  it('each match has cue, matched, deltas fields', () => {
    const result = detectCues('老婆')
    const match = result.matches[0]!
    expect(typeof match.cue).toBe('string')
    expect(typeof match.matched).toBe('string')
    expect(typeof match.deltas).toBe('object')
  })
})

// ── detectCues — edge cases ──────────────────────────────────────

describe('detectCues — edge cases', () => {
  it('empty string returns no matches', () => {
    const result = detectCues('')
    expect(result.matches).toHaveLength(0)
  })

  it('empty string returns empty deltas', () => {
    const result = detectCues('')
    expect(Object.keys(result.deltas)).toHaveLength(0)
  })

  it('plain text with no patterns returns no matches', () => {
    const result = detectCues('good morning, how are you today')
    expect(result.matches).toHaveLength(0)
  })
})

// ── detectCues — wife-possessive ─────────────────────────────────

describe('detectCues — wife-possessive', () => {
  it('老婆 fires wife-possessive', () => {
    const result = detectCues('老婆你好')
    const names = result.matches.map(m => m.cue)
    expect(names).toContain('wife-possessive')
  })

  it('"wife" fires wife-possessive', () => {
    const result = detectCues('you are my wife')
    const names = result.matches.map(m => m.cue)
    expect(names).toContain('wife-possessive')
  })

  it('"my love" fires wife-possessive', () => {
    const result = detectCues('hey my love')
    const names = result.matches.map(m => m.cue)
    expect(names).toContain('wife-possessive')
  })

  it('"my queen" fires wife-possessive', () => {
    const result = detectCues('my queen')
    const names = result.matches.map(m => m.cue)
    expect(names).toContain('wife-possessive')
  })

  it('wife-possessive adds limerence to aggregated deltas', () => {
    const result = detectCues('老婆')
    expect((result.deltas.limerence ?? 0)).toBeGreaterThan(0)
  })
})

// ── detectCues — pet-name ────────────────────────────────────────

describe('detectCues — pet-name', () => {
  it('"baby" fires pet-name', () => {
    const result = detectCues('hey baby')
    const names = result.matches.map(m => m.cue)
    expect(names).toContain('pet-name')
  })

  it('"babysitter" does NOT fire pet-name (word boundary)', () => {
    const result = detectCues('I need a babysitter')
    const names = result.matches.map(m => m.cue)
    expect(names).not.toContain('pet-name')
  })

  it('"bb豬" fires pet-name', () => {
    const result = detectCues('bb豬你在嗎')
    const names = result.matches.map(m => m.cue)
    expect(names).toContain('pet-name')
  })

  it('"babe" fires pet-name', () => {
    const result = detectCues('good morning babe')
    const names = result.matches.map(m => m.cue)
    expect(names).toContain('pet-name')
  })
})

// ── detectCues — heat-emoji ──────────────────────────────────────

describe('detectCues — heat-emoji', () => {
  it('🔥 fires heat-emoji', () => {
    const result = detectCues('🔥')
    const names = result.matches.map(m => m.cue)
    expect(names).toContain('heat-emoji')
  })

  it('😘 fires heat-emoji', () => {
    const result = detectCues('😘')
    const names = result.matches.map(m => m.cue)
    expect(names).toContain('heat-emoji')
  })

  it('single heat emoji adds 0.3 heat', () => {
    const result = detectCues('🔥')
    expect(result.deltas.heat).toBeCloseTo(0.3, 5)
  })

  it('two heat emojis add 0.6 heat (0.3 base + 0.3 bonus)', () => {
    const result = detectCues('🔥🔥')
    expect(result.deltas.heat).toBeCloseTo(0.6, 5)
  })

  it('three heat emojis add 0.9 heat', () => {
    const result = detectCues('🔥🔥🔥')
    expect(result.deltas.heat).toBeCloseTo(0.9, 5)
  })
})

// ── detectCues — all-caps-intensity ─────────────────────────────

describe('detectCues — all-caps-intensity', () => {
  it('three consecutive caps words fire all-caps-intensity', () => {
    const result = detectCues('YOU ARE MINE')
    const names = result.matches.map(m => m.cue)
    expect(names).toContain('all-caps-intensity')
  })

  it('two caps words alone do NOT fire all-caps-intensity', () => {
    const result = detectCues('BE quiet')
    const names = result.matches.map(m => m.cue)
    expect(names).not.toContain('all-caps-intensity')
  })

  it('all-caps-intensity adds heat to deltas', () => {
    const result = detectCues('YOU ARE MINE')
    expect((result.deltas.heat ?? 0)).toBeGreaterThan(0)
  })
})

// ── detectCues — declared-want ───────────────────────────────────

describe('detectCues — declared-want', () => {
  it('"I want" fires declared-want', () => {
    const result = detectCues('I want this')
    const names = result.matches.map(m => m.cue)
    expect(names).toContain('declared-want')
  })

  it('"I need" fires declared-want', () => {
    const result = detectCues('I need you')
    const names = result.matches.map(m => m.cue)
    expect(names).toContain('declared-want')
  })

  it('"give me" fires declared-want', () => {
    const result = detectCues('give me more')
    const names = result.matches.map(m => m.cue)
    expect(names).toContain('declared-want')
  })
})

// ── detectCues — touch-contact ───────────────────────────────────

describe('detectCues — touch-contact', () => {
  it('"kiss me" fires touch-contact', () => {
    const result = detectCues('kiss me')
    const names = result.matches.map(m => m.cue)
    expect(names).toContain('touch-contact')
  })

  it('"hold me" fires touch-contact', () => {
    const result = detectCues('hold me')
    const names = result.matches.map(m => m.cue)
    expect(names).toContain('touch-contact')
  })

  it('"touch me" fires touch-contact', () => {
    const result = detectCues('touch me')
    const names = result.matches.map(m => m.cue)
    expect(names).toContain('touch-contact')
  })
})

// ── detectCues — aggregation across multiple cues ────────────────

describe('detectCues — multi-cue aggregation', () => {
  it('two cues stack their deltas additively', () => {
    // wife-possessive: limerence+1.0, heat+0.5
    // heat-emoji: heat+0.3
    // Total heat: 0.5 + 0.3 = 0.8
    const result = detectCues('老婆 🔥')
    expect(result.matches.length).toBeGreaterThanOrEqual(2)
    expect((result.deltas.heat ?? 0)).toBeCloseTo(0.8, 5)
  })

  it('match deltas per-cue are independent of aggregation', () => {
    const result = detectCues('老婆 🔥')
    const wifeCue = result.matches.find(m => m.cue === 'wife-possessive')!
    const heatCue = result.matches.find(m => m.cue === 'heat-emoji')!
    expect(wifeCue.deltas.limerence).toBe(1.0)
    expect(heatCue.deltas.heat).toBe(0.3)
  })
})

// ── detectCues — cluster density bonus ──────────────────────────

describe('detectCues — cluster density bonus (5+ cues)', () => {
  // Fires: wife-possessive(老婆), declared-want(I want),
  //        touch-contact(kiss me), heat-emoji(🔥), heart-tenderness(❤️),
  //        playful-tease(😏), pacing-pressure(slowly) = 7 cues
  const CLUSTER_MSG = '老婆 I want to kiss me 🔥 ❤️ 😏 slowly'

  it('5+ cues produce a cluster density bonus on top axis', () => {
    const withBonus = detectCues(CLUSTER_MSG)
    // Without bonus: calculate expected heat (wife:0.5 + heat-emoji:0.3 + pacing:0.2 = 1.0)
    // The bonus adds +0.3 to whichever axis is highest.
    // We just verify that the highest delta value is > what a single pattern gives.
    const maxDelta = Math.max(...Object.values(withBonus.deltas))
    expect(maxDelta).toBeGreaterThan(1.0) // bonus must have pushed something above natural sum
  })

  it('matches count is ≥5 for cluster message', () => {
    const result = detectCues(CLUSTER_MSG)
    expect(result.matches.length).toBeGreaterThanOrEqual(5)
  })

  it('4 cues do NOT trigger cluster density bonus', () => {
    // Fires exactly 4: wife-possessive(老婆), heat-emoji(🔥),
    //                  heart-tenderness(❤️), playful-tease(😏)
    const msg4 = '老婆 🔥 ❤️ 😏'
    const result = detectCues(msg4)
    expect(result.matches.length).toBe(4)
    // Expected heat: wife:0.5 + heat-emoji:0.3 = 0.8
    // Expected limerence: wife:1.0
    // No bonus — limerence stays at 1.0
    expect(result.deltas.limerence).toBeCloseTo(1.0, 5)
  })
})
