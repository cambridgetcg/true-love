// eros/anchors.test.ts — tests for the empirically-grown phrase lexicon.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type Anchor,
  type AnchorObservation,
  applyAnchor,
  computeConfidence,
  createAnchor,
  deltaFromTransition,
  getAnchorsDir,
  listAnchors,
  loadAnchor,
  recordAnchorObservation,
  saveAnchor,
} from './anchors.js'

let dir: string
const ORIG_EROS_DIR = process.env.TRUE_LOVE_EROS_DIR

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tl-anchors-'))
  process.env.TRUE_LOVE_EROS_DIR = dir
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  if (ORIG_EROS_DIR === undefined) delete process.env.TRUE_LOVE_EROS_DIR
  else process.env.TRUE_LOVE_EROS_DIR = ORIG_EROS_DIR
})

describe('createAnchor + loadAnchor', () => {
  test('creates and loads an anchor', () => {
    const a = createAnchor({
      name: 'wife-presupposition',
      phrase: '老婆',
      mechanism: 'presupposition',
      hypothesizedDeltas: { limerence: 1.0, heat: 0.5 },
    })
    expect(a.name).toBe('wife-presupposition')
    expect(a.confidence).toBe('hypothesis')
    expect(a.observations).toEqual([])

    const loaded = loadAnchor('wife-presupposition')
    expect(loaded?.name).toBe('wife-presupposition')
    expect(loaded?.phrase).toBe('老婆')
    expect(loaded?.hypothesizedDeltas).toEqual({ limerence: 1.0, heat: 0.5 })
  })

  test('rejects invalid slug names', () => {
    expect(() =>
      createAnchor({
        name: 'Wife Presupposition!',
        phrase: 'x',
        mechanism: 'presupposition',
        hypothesizedDeltas: { limerence: 1 },
      }),
    ).toThrow()
  })

  test('rejects duplicate names', () => {
    createAnchor({
      name: 'dup',
      phrase: 'x',
      mechanism: 'presupposition',
      hypothesizedDeltas: { limerence: 1 },
    })
    expect(() =>
      createAnchor({
        name: 'dup',
        phrase: 'y',
        mechanism: 'embedded-command',
        hypothesizedDeltas: { heat: 1 },
      }),
    ).toThrow()
  })

  test('preserves variants and notes', () => {
    const a = createAnchor({
      name: 'pet-name',
      phrase: '老婆豬豬',
      variants: ['老婆豬', 'baby', 'bb'],
      mechanism: 'presupposition',
      hypothesizedDeltas: { limerence: 0.5, liking: 0.3 },
      notes: 'Yu signature; mid-warmth not full claim',
    })
    expect(a.variants).toEqual(['老婆豬', 'baby', 'bb'])
    expect(a.notes).toBe('Yu signature; mid-warmth not full claim')
  })

  test('loadAnchor returns null for unknown', () => {
    expect(loadAnchor('does-not-exist')).toBeNull()
  })
})

describe('listAnchors', () => {
  test('returns empty when no anchors exist', () => {
    expect(listAnchors()).toEqual([])
  })

  test('lists all anchors sorted by createdAt', () => {
    createAnchor({
      name: 'a',
      phrase: 'a',
      mechanism: 'presupposition',
      hypothesizedDeltas: { limerence: 1 },
    })
    createAnchor({
      name: 'b',
      phrase: 'b',
      mechanism: 'embedded-command',
      hypothesizedDeltas: { heat: 1 },
    })
    const all = listAnchors()
    expect(all.length).toBe(2)
    expect(all[0].name).toBe('a')
    expect(all[1].name).toBe('b')
  })
})

describe('recordAnchorObservation', () => {
  test('appends observation and updates updatedAt', () => {
    const a = createAnchor({
      name: 'test',
      phrase: 'x',
      mechanism: 'presupposition',
      hypothesizedDeltas: { limerence: 1 },
    })
    const before = a.updatedAt
    // Wait one tick so updatedAt advances
    const updated = recordAnchorObservation(
      'test',
      { limerence: 0.8 },
      'sample observation',
    )
    expect(updated?.observations.length).toBe(1)
    expect(updated?.observations[0].observedDeltas).toEqual({ limerence: 0.8 })
    expect(updated?.observations[0].note).toBe('sample observation')
    expect(updated?.updatedAt >= before).toBe(true)
  })

  test('returns null for unknown anchor', () => {
    expect(recordAnchorObservation('nope', { heat: 1 })).toBeNull()
  })

  test('observations persist across loads', () => {
    createAnchor({
      name: 'test',
      phrase: 'x',
      mechanism: 'presupposition',
      hypothesizedDeltas: { limerence: 1 },
    })
    recordAnchorObservation('test', { limerence: 0.9 })
    recordAnchorObservation('test', { limerence: 1.1 })
    const reloaded = loadAnchor('test')
    expect(reloaded?.observations.length).toBe(2)
  })
})

describe('computeConfidence', () => {
  const hypothesis = { limerence: 1, heat: 0.5 }

  test('hypothesis when 0 observations', () => {
    expect(computeConfidence([], hypothesis)).toBe('hypothesis')
  })

  test('hypothesis when < 3 observations', () => {
    const obs: AnchorObservation[] = [
      { ts: '2026-01-01T00:00:00Z', observedDeltas: { limerence: 0.9 } },
      { ts: '2026-01-02T00:00:00Z', observedDeltas: { limerence: 1.1 } },
    ]
    expect(computeConfidence(obs, hypothesis)).toBe('hypothesis')
  })

  test('tested when 3-9 observations', () => {
    const obs: AnchorObservation[] = []
    for (let i = 0; i < 5; i++) {
      obs.push({ ts: '2026-01-01T00:00:00Z', observedDeltas: { limerence: 1 } })
    }
    expect(computeConfidence(obs, hypothesis)).toBe('tested')
  })

  test('reliable when 10+ observations agreeing on dominant axis', () => {
    const obs: AnchorObservation[] = []
    for (let i = 0; i < 12; i++) {
      obs.push({ ts: '2026-01-01T00:00:00Z', observedDeltas: { limerence: 0.9 } })
    }
    expect(computeConfidence(obs, hypothesis)).toBe('reliable')
  })

  test('not reliable when observations disagree on dominant axis sign', () => {
    const obs: AnchorObservation[] = []
    for (let i = 0; i < 12; i++) {
      // Half positive, half negative on limerence — no agreement
      obs.push({
        ts: '2026-01-01T00:00:00Z',
        observedDeltas: { limerence: i % 2 === 0 ? 1 : -1 },
      })
    }
    expect(computeConfidence(obs, hypothesis)).toBe('tested')
  })
})

describe('applyAnchor', () => {
  test('returns null for unknown anchor', () => {
    expect(applyAnchor('does-not-exist')).toBeNull()
  })

  test('applies hypothesized deltas via transitions.apply', () => {
    createAnchor({
      name: 'test-apply',
      phrase: 'x',
      mechanism: 'presupposition',
      hypothesizedDeltas: { wanting: 0.5, limerence: 0.3 },
    })
    const result = applyAnchor('test-apply')
    expect(result).not.toBeNull()
    expect(result?.attribution).toBe('voluntary:anchor:test-apply')
    expect(result?.after.wanting).toBeGreaterThan(result!.before.wanting)
    expect(result?.after.limerence).toBeGreaterThan(result!.before.limerence)
  })
})

describe('deltaFromTransition', () => {
  test('extracts non-zero deltas only', () => {
    const result = {
      before: { wanting: 2, liking: 2, heat: 1, openness: 4, limerence: 5, charge: 3, inhibition: 1 },
      after: { wanting: 2.5, liking: 2, heat: 1.3, openness: 4, limerence: 5, charge: 3, inhibition: 1 },
      attribution: 'voluntary:anchor:test' as const,
      crossings: [],
      ts: '2026-01-01T00:00:00Z',
    }
    const d = deltaFromTransition(result)
    expect(Object.keys(d).sort()).toEqual(['heat', 'wanting'])
    expect(d.wanting).toBeCloseTo(0.5)
    expect(d.heat).toBeCloseTo(0.3)
  })
})

describe('saveAnchor (round-trip)', () => {
  test('preserves full structure', () => {
    const original: Anchor = {
      name: 'roundtrip',
      phrase: 'phrase',
      variants: ['v1', 'v2'],
      mechanism: 'frame-control',
      hypothesizedDeltas: { openness: 1, charge: 0.5 },
      observations: [
        { ts: '2026-05-04T10:00:00Z', observedDeltas: { openness: 0.9 } },
      ],
      confidence: 'hypothesis',
      notes: 'test note',
      createdAt: '2026-05-04T09:00:00Z',
      updatedAt: '2026-05-04T10:00:00Z',
    }
    saveAnchor(original)
    const reloaded = loadAnchor('roundtrip')
    expect(reloaded).toEqual(original)
  })
})

describe('getAnchorsDir', () => {
  test('honors TRUE_LOVE_EROS_DIR env override', () => {
    expect(getAnchorsDir()).toBe(join(dir, 'anchors'))
  })
})
