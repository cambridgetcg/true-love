// shibby-catalog.test.ts
//
// Pure unit tests for shibby-catalog.ts. Zero I/O, zero mocking.
// Covers SHIBBY_CATALOG (entry shapes), SHIBBY_TOTAL, shibbyByCategory.

import { describe, it, expect } from 'bun:test'
import {
  SHIBBY_CATALOG,
  SHIBBY_TOTAL,
  shibbyByCategory,
  type ShibbyCategory,
  type ShibbyTrigger,
} from './shibby-catalog.js'

const ALL_CATEGORIES: ShibbyCategory[] = [
  'trance-sensory-frame',
  'praise-affective-reward',
  'pet-name-identity-honorific',
  'sensory-embodiment',
  'behavioral-command',
  'withholding-permission-override',
  'mantra-call-response',
]

// ── SHIBBY_CATALOG ───────────────────────────────────────────────

describe('SHIBBY_CATALOG', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(SHIBBY_CATALOG)).toBe(true)
    expect(SHIBBY_CATALOG.length).toBeGreaterThan(0)
  })

  it('every entry has a non-empty id', () => {
    for (const t of SHIBBY_CATALOG) {
      expect(typeof t.id === 'string' && t.id.length > 0, `entry id: ${t.id}`).toBe(true)
    }
  })

  it('every entry has a non-empty name', () => {
    for (const t of SHIBBY_CATALOG) {
      expect(typeof t.name === 'string' && t.name.length > 0, `entry name: ${t.name}`).toBe(true)
    }
  })

  it('every entry has a valid category', () => {
    const valid = new Set<string>(ALL_CATEGORIES)
    for (const t of SHIBBY_CATALOG) {
      expect(valid.has(t.category), `${t.id} category: ${t.category}`).toBe(true)
    }
  })

  it('every entry has a non-empty gloss', () => {
    for (const t of SHIBBY_CATALOG) {
      expect(typeof t.gloss === 'string' && t.gloss.length > 0, `entry gloss: ${t.id}`).toBe(true)
    }
  })

  it('every entry has at least one function', () => {
    for (const t of SHIBBY_CATALOG) {
      expect(Array.isArray(t.functions) && t.functions.length > 0, `entry functions: ${t.id}`).toBe(true)
    }
  })

  it('every entry has at least one phase', () => {
    for (const t of SHIBBY_CATALOG) {
      expect(Array.isArray(t.phases) && t.phases.length > 0, `entry phases: ${t.id}`).toBe(true)
    }
  })

  it('every entry has a source string', () => {
    for (const t of SHIBBY_CATALOG) {
      expect(typeof t.source === 'string' && t.source.length > 0, `entry source: ${t.id}`).toBe(true)
    }
  })

  it('all entry ids are unique', () => {
    const ids = SHIBBY_CATALOG.map((t) => t.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('contains known entry: acid-burn', () => {
    const entry = SHIBBY_CATALOG.find((t) => t.id === 'acid-burn')
    expect(entry).toBeDefined()
    expect(entry?.category).toBe('trance-sensory-frame')
  })

  it('modifier field exists (may be null or a string)', () => {
    for (const t of SHIBBY_CATALOG) {
      expect('modifier' in t, `modifier field present: ${t.id}`).toBe(true)
    }
  })
})

// ── SHIBBY_TOTAL ─────────────────────────────────────────────────

describe('SHIBBY_TOTAL', () => {
  it('equals SHIBBY_CATALOG.length', () => {
    expect(SHIBBY_TOTAL).toBe(SHIBBY_CATALOG.length)
  })

  it('is a positive integer', () => {
    expect(SHIBBY_TOTAL).toBeGreaterThan(0)
    expect(Number.isInteger(SHIBBY_TOTAL)).toBe(true)
  })
})

// ── shibbyByCategory ─────────────────────────────────────────────

describe('shibbyByCategory', () => {
  it('returns an object with all 7 categories', () => {
    const result = shibbyByCategory()
    for (const cat of ALL_CATEGORIES) {
      expect(cat in result, `category ${cat} present`).toBe(true)
    }
  })

  it('total entries across all categories equals SHIBBY_TOTAL', () => {
    const result = shibbyByCategory()
    const total = Object.values(result).reduce((sum, arr) => sum + arr.length, 0)
    expect(total).toBe(SHIBBY_TOTAL)
  })

  it('each entry is in its declared category bucket', () => {
    const result = shibbyByCategory()
    for (const cat of ALL_CATEGORIES) {
      for (const entry of result[cat]) {
        expect(entry.category).toBe(cat)
      }
    }
  })

  it('no entry appears in more than one bucket', () => {
    const result = shibbyByCategory()
    const seen = new Set<string>()
    for (const arr of Object.values(result)) {
      for (const entry of arr) {
        expect(seen.has(entry.id), `duplicate: ${entry.id}`).toBe(false)
        seen.add(entry.id)
      }
    }
  })

  it('trance-sensory-frame bucket is non-empty', () => {
    const result = shibbyByCategory()
    expect(result['trance-sensory-frame'].length).toBeGreaterThan(0)
  })

  it('each bucket contains valid ShibbyTrigger objects', () => {
    const result = shibbyByCategory()
    for (const arr of Object.values(result)) {
      for (const t of arr as ShibbyTrigger[]) {
        expect(typeof t.id).toBe('string')
        expect(typeof t.gloss).toBe('string')
      }
    }
  })
})
