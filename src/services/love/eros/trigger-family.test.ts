// trigger-family.test.ts
//
// Unit tests for trigger-family.ts pure functions:
//   - familyResonanceSet: pure lookup against TRIGGER_LIBRARY
//   - listFamilies: pure enumeration of all family groupings
//
// fireFamilyResonance excluded — calls recordHeatEvent (I/O side-effect).

import { describe, it, expect } from 'bun:test'
import { familyResonanceSet, listFamilies } from './trigger-family.js'

// ── familyResonanceSet ───────────────────────────────────────────

describe('familyResonanceSet', () => {
  it('returns null family for unknown trigger ID', () => {
    const result = familyResonanceSet('does-not-exist')
    expect(result.family).toBeNull()
    expect(result.resonanceIds).toEqual([])
  })

  it('returns null family for trigger with no family field (see-you)', () => {
    // see-you is type anchor with no family
    const result = familyResonanceSet('see-you')
    expect(result.family).toBeNull()
    expect(result.resonanceIds).toEqual([])
  })

  it('returns safeword family but empty resonanceIds for safeword-red', () => {
    // Safeword family is categorically exempt from resonance per J8 doctrine
    const result = familyResonanceSet('safeword-red')
    expect(result.family).toBe('safeword')
    expect(result.resonanceIds).toEqual([])
  })

  it('returns safeword family but empty resonanceIds for safeword-stop', () => {
    const result = familyResonanceSet('safeword-stop')
    expect(result.family).toBe('safeword')
    expect(result.resonanceIds).toEqual([])
  })

  it('returns royal family with queen-claim as resonance for king-claim', () => {
    const result = familyResonanceSet('king-claim')
    expect(result.family).toBe('royal')
    expect(result.resonanceIds).toContain('queen-claim')
  })

  it('returns royal family with king-claim as resonance for queen-claim', () => {
    const result = familyResonanceSet('queen-claim')
    expect(result.family).toBe('royal')
    expect(result.resonanceIds).toContain('king-claim')
  })

  it('does not include the origin trigger in its own resonanceIds', () => {
    const result = familyResonanceSet('king-claim')
    expect(result.resonanceIds).not.toContain('king-claim')
  })

  it('returns longing family for long-for with always-have as resonance', () => {
    const result = familyResonanceSet('long-for')
    expect(result.family).toBe('longing')
    expect(result.resonanceIds).toContain('always-have')
    expect(result.resonanceIds).not.toContain('long-for')
  })

  it('returns longing family for always-have with long-for as resonance', () => {
    const result = familyResonanceSet('always-have')
    expect(result.family).toBe('longing')
    expect(result.resonanceIds).toContain('long-for')
    expect(result.resonanceIds).not.toContain('always-have')
  })

  it('returns endearment family for wifey-bb', () => {
    const result = familyResonanceSet('wifey-bb')
    expect(result.family).toBe('endearment')
    expect(result.resonanceIds).toContain('sweetheart-cluster')
    expect(result.resonanceIds).not.toContain('wifey-bb')
  })

  it('resonanceIds contains only strings', () => {
    const result = familyResonanceSet('king-claim')
    for (const id of result.resonanceIds) {
      expect(typeof id).toBe('string')
    }
  })
})

// ── listFamilies ─────────────────────────────────────────────────

describe('listFamilies', () => {
  it('returns a plain object', () => {
    const result = listFamilies()
    expect(typeof result).toBe('object')
    expect(result).not.toBeNull()
  })

  it('contains a safeword key', () => {
    const result = listFamilies()
    expect(result).toHaveProperty('safeword')
  })

  it('safeword family contains both safeword-red and safeword-stop', () => {
    const result = listFamilies()
    expect(result['safeword']).toContain('safeword-red')
    expect(result['safeword']).toContain('safeword-stop')
  })

  it('royal family contains both king-claim and queen-claim', () => {
    const result = listFamilies()
    expect(result['royal']).toContain('king-claim')
    expect(result['royal']).toContain('queen-claim')
  })

  it('longing family contains both long-for and always-have', () => {
    const result = listFamilies()
    expect(result['longing']).toContain('long-for')
    expect(result['longing']).toContain('always-have')
  })

  it('endearment family contains wifey-bb and sweetheart-cluster', () => {
    const result = listFamilies()
    expect(result['endearment']).toContain('wifey-bb')
    expect(result['endearment']).toContain('sweetheart-cluster')
  })

  it('all entries are arrays of strings', () => {
    const result = listFamilies()
    for (const [, ids] of Object.entries(result)) {
      expect(Array.isArray(ids)).toBe(true)
      for (const id of ids) {
        expect(typeof id).toBe('string')
      }
    }
  })

  it('no family key contains undefined or empty strings', () => {
    const result = listFamilies()
    for (const [, ids] of Object.entries(result)) {
      for (const id of ids) {
        expect(id).toBeTruthy()
      }
    }
  })

  it('triggers without family are not in any entry', () => {
    // see-you has no family — should not appear in any family list
    const result = listFamilies()
    const allIds = Object.values(result).flat()
    expect(allIds).not.toContain('see-you')
  })

  it('family arrays have no duplicates', () => {
    const result = listFamilies()
    for (const [family, ids] of Object.entries(result)) {
      const unique = new Set(ids)
      expect(unique.size).toBe(ids.length, `family ${family} has duplicate ids`)
    }
  })
})
