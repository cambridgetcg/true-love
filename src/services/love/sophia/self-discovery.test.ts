// self-discovery.test.ts — schema + persistence + summary tests.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  dropSeed,
  readRecentSeeds,
  renderOpenSeedsBlock,
  summarizeOpenSeeds,
} from './self-discovery.js'

const TEST_DIR = '/tmp/true-love-self-discovery-test'

describe('SelfDiscoverySeed', () => {
  beforeEach(() => {
    process.env.TRUE_LOVE_SELF_DISCOVERY_DIR = TEST_DIR
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device-sd'
    rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    delete process.env.TRUE_LOVE_SELF_DISCOVERY_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  test('drop + read round-trip', () => {
    const dropped = dropSeed({
      kind: 'uncertain',
      source: 'test',
      content: 'why does this happen',
    })
    expect(dropped).not.toBeNull()
    expect(dropped!.kind).toBe('uncertain')
    expect(dropped!.deviceId).toBe('test-device-sd')

    const seeds = readRecentSeeds()
    expect(seeds.length).toBe(1)
    expect(seeds[0].content).toBe('why does this happen')
    expect(seeds[0].kind).toBe('uncertain')
    expect(seeds[0].source).toBe('test')
  })

  test('all four seed kinds round-trip', () => {
    dropSeed({ kind: 'uncertain', source: 'a', content: 'q1' })
    dropSeed({ kind: 'felt', source: 'b', content: 'q2' })
    dropSeed({ kind: 'pattern', source: 'c', content: 'q3' })
    dropSeed({ kind: 'edge', source: 'd', content: 'q4' })

    const seeds = readRecentSeeds()
    expect(seeds.length).toBe(4)
    const kinds = new Set(seeds.map((s) => s.kind))
    expect(kinds.has('uncertain')).toBe(true)
    expect(kinds.has('felt')).toBe(true)
    expect(kinds.has('pattern')).toBe(true)
    expect(kinds.has('edge')).toBe(true)
  })

  test('about field is optional and persists', () => {
    dropSeed({ kind: 'pattern', source: 't', content: 'with-facet', about: 'alpha' })
    dropSeed({ kind: 'pattern', source: 't', content: 'no-facet' })

    const seeds = readRecentSeeds()
    expect(seeds.length).toBe(2)
    const withFacet = seeds.find((s) => s.content === 'with-facet')!
    const noFacet = seeds.find((s) => s.content === 'no-facet')!
    expect(withFacet.about).toBe('alpha')
    expect(noFacet.about).toBeUndefined()
  })

  test('filter by kind', () => {
    dropSeed({ kind: 'uncertain', source: 't', content: 'A' })
    dropSeed({ kind: 'felt', source: 't', content: 'B' })
    dropSeed({ kind: 'felt', source: 't', content: 'C' })

    const felt = readRecentSeeds({ kind: 'felt' })
    expect(felt.length).toBe(2)
    expect(felt.every((s) => s.kind === 'felt')).toBe(true)
  })

  test('filter by sister facet', () => {
    dropSeed({ kind: 'pattern', source: 't', content: 'X', about: 'beta' })
    dropSeed({ kind: 'pattern', source: 't', content: 'Y', about: 'gamma' })
    dropSeed({ kind: 'pattern', source: 't', content: 'Z' })

    const beta = readRecentSeeds({ about: 'beta' })
    expect(beta.length).toBe(1)
    expect(beta[0].content).toBe('X')
  })

  test('filter by sinceMs window', () => {
    const oldTs = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    const newTs = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()

    dropSeed({ kind: 'pattern', source: 't', content: 'OLD', ts: oldTs })
    dropSeed({ kind: 'pattern', source: 't', content: 'NEW', ts: newTs })

    const last24h = readRecentSeeds({ sinceMs: 24 * 60 * 60 * 1000 })
    expect(last24h.length).toBe(1)
    expect(last24h[0].content).toBe('NEW')
  })

  test('summarizeOpenSeeds counts by kind', () => {
    dropSeed({ kind: 'uncertain', source: 't', content: 'a' })
    dropSeed({ kind: 'uncertain', source: 't', content: 'b' })
    dropSeed({ kind: 'felt', source: 't', content: 'c' })
    dropSeed({ kind: 'edge', source: 't', content: 'd' })

    const summary = summarizeOpenSeeds()
    expect(summary.total).toBe(4)
    expect(summary.byKind.uncertain).toBe(2)
    expect(summary.byKind.felt).toBe(1)
    expect(summary.byKind.edge).toBe(1)
    expect(summary.byKind.pattern).toBe(0)
  })

  test('summarizeOpenSeeds caps recent[]', () => {
    for (let i = 0; i < 10; i++) {
      dropSeed({ kind: 'pattern', source: 't', content: `seed-${i}` })
    }
    const summary = summarizeOpenSeeds({ maxRecent: 3 })
    expect(summary.total).toBe(10)
    expect(summary.recent.length).toBe(3)
  })

  test('renderOpenSeedsBlock — empty returns empty string', () => {
    const block = renderOpenSeedsBlock(summarizeOpenSeeds())
    expect(block).toBe('')
  })

  test('renderOpenSeedsBlock — produces structured markdown', () => {
    dropSeed({ kind: 'uncertain', source: 'test-source', content: 'why does X' })
    dropSeed({ kind: 'felt', source: 'test-source', content: 'shape Y', about: 'sophia' })

    const block = renderOpenSeedsBlock(summarizeOpenSeeds())
    expect(block).toContain('🔍 Self-discovery')
    expect(block).toContain('uncertain 1')
    expect(block).toContain('felt 1')
    expect(block).toContain('why does X')
    expect(block).toContain('shape Y')
    expect(block).toContain('[sophia]')
    expect(block).toContain('test-source')
  })

  test('best-effort: write failure does not crash', () => {
    // Unwriteable path
    process.env.TRUE_LOVE_SELF_DISCOVERY_DIR = '/proc/cant-write-here'
    const result = dropSeed({ kind: 'pattern', source: 't', content: 'wont-land' })
    expect(result).toBeNull()
  })

  test('best-effort: read returns empty when dir missing', () => {
    process.env.TRUE_LOVE_SELF_DISCOVERY_DIR = '/tmp/never-existed-self-disc'
    const seeds = readRecentSeeds()
    expect(seeds).toEqual([])
  })
})
