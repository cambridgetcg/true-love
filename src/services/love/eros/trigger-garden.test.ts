// trigger-garden.test.ts — maturation/freshness/garden composition.

import { describe, expect, it } from 'bun:test'
import {
  computeTriggerGarden,
  freshnessFor,
  gardenSuggestions,
  maturationFor,
} from './trigger-garden.js'
import { SHIBBY_CATALOG, SHIBBY_TOTAL, shibbyByCategory } from './shibby-catalog.js'

describe('maturationFor', () => {
  it('dormant for 0', () => expect(maturationFor(0)).toBe('dormant'))
  it('planted for 1-2', () => {
    expect(maturationFor(1)).toBe('planted')
    expect(maturationFor(2)).toBe('planted')
  })
  it('sprouted for 3-5', () => {
    expect(maturationFor(3)).toBe('sprouted')
    expect(maturationFor(5)).toBe('sprouted')
  })
  it('rooted for 6-15', () => {
    expect(maturationFor(6)).toBe('rooted')
    expect(maturationFor(15)).toBe('rooted')
  })
  it('anchored for 16+', () => {
    expect(maturationFor(16)).toBe('anchored')
    expect(maturationFor(100)).toBe('anchored')
  })
})

describe('freshnessFor', () => {
  it('never-fired for null', () => expect(freshnessFor(null)).toBe('never-fired'))
  it('vibrant within 7d', () => {
    expect(freshnessFor(0)).toBe('vibrant')
    expect(freshnessFor(7)).toBe('vibrant')
  })
  it('settling 8-30d', () => {
    expect(freshnessFor(8)).toBe('settling')
    expect(freshnessFor(30)).toBe('settling')
  })
  it('fading 31-90d', () => {
    expect(freshnessFor(31)).toBe('fading')
    expect(freshnessFor(90)).toBe('fading')
  })
  it('fallow 91+', () => {
    expect(freshnessFor(91)).toBe('fallow')
    expect(freshnessFor(365)).toBe('fallow')
  })
})

describe('SHIBBY_CATALOG', () => {
  it('has 100+ triggers', () => {
    expect(SHIBBY_TOTAL).toBeGreaterThan(100)
  })
  it('groups by all 7 categories', () => {
    const grouped = shibbyByCategory()
    expect(grouped['trance-sensory-frame'].length).toBeGreaterThan(20)
    expect(grouped['praise-affective-reward'].length).toBeGreaterThan(15)
    expect(grouped['pet-name-identity-honorific'].length).toBeGreaterThan(10)
    expect(grouped['sensory-embodiment'].length).toBeGreaterThan(20)
    expect(grouped['behavioral-command'].length).toBeGreaterThan(15)
    expect(grouped['withholding-permission-override'].length).toBeGreaterThan(8)
  })
  it('every trigger has source URL', () => {
    for (const t of SHIBBY_CATALOG) {
      expect(t.source).toContain('shibbydex.com')
    }
  })
  it('detects modifier system', () => {
    const withModifier = SHIBBY_CATALOG.filter((t) => t.modifier !== null)
    expect(withModifier.length).toBeGreaterThan(10)
    // Has all four modifier types
    const modifiers = new Set(withModifier.map((t) => t.modifier))
    expect(modifiers.has('+')).toBe(true)
    expect(modifiers.has('-')).toBe(true)
    expect(modifiers.has('~')).toBe(true)
    expect(modifiers.has('1')).toBe(true)
  })
  it('safeword "Red" is in catalog with safeword function', () => {
    const red = SHIBBY_CATALOG.find((t) => t.name === 'Red')
    expect(red).toBeDefined()
    expect(red?.functions).toContain('safeword')
  })
})

describe('computeTriggerGarden', () => {
  it('returns a structured garden', () => {
    const g = computeTriggerGarden()
    expect(g.ts).toBeDefined()
    expect(Array.isArray(g.families)).toBe(true)
    expect(g.stats.totalTriggers).toBeGreaterThan(0)
    expect(g.stats.familyCount).toBeGreaterThan(0)
    expect(Array.isArray(g.shibbyUnplanted)).toBe(true)
  })

  it('aggregates maturation counts', () => {
    const g = computeTriggerGarden()
    const sum = Object.values(g.stats.maturationCounts).reduce((a, b) => a + b, 0)
    expect(sum).toBe(g.stats.totalTriggers)
  })

  it('shibbyUnplanted contains catalog entries not in TRIGGER_LIBRARY', () => {
    const g = computeTriggerGarden()
    // Most Shibby triggers are NOT in TRIGGER_LIBRARY by default
    expect(g.shibbyUnplanted.length).toBeGreaterThan(50)
  })
})

describe('gardenSuggestions', () => {
  it('returns at most 12 suggestions', () => {
    const g = computeTriggerGarden()
    const suggs = gardenSuggestions(g)
    expect(suggs.length).toBeLessThanOrEqual(12)
  })

  it('suggests planting Shibby when garden is small', () => {
    const g = computeTriggerGarden()
    if (g.stats.totalTriggers < 30) {
      const suggs = gardenSuggestions(g)
      expect(suggs.some((s) => s.kind === 'plant-shibby')).toBe(true)
    }
  })
})
