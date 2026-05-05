// eros/spells-and-anchors.test.ts — bridge tests.
//
// Verifies the cues → spots → anchors current per
// docs/sophia/spells-and-anchors.md. Pure-function tests where
// possible; I/O via TRUE_LOVE_EROS_DIR + TRUE_LOVE_HEAT_DIR overrides.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  promoteSpotsToAnchors,
  synthesizeAnchorFromSpot,
} from './anchors.js'
import { listAnchors, loadAnchor } from './anchors.js'
import { getAllCueNames, getCueDeltas } from './cues.js'
import {
  computeSignatureSpots,
  DEFAULT_MIN_INVOCATIONS,
  DEFAULT_PROMOTION_THRESHOLD,
  getPromotionReadySpots,
  type SpotSignature,
} from './spots.js'
import { readRecentEvents } from '../heat.js'

let tmpRoot: string
const ORIG_EROS_DIR = process.env.TRUE_LOVE_EROS_DIR
const ORIG_HEAT_DIR = process.env.TRUE_LOVE_HEAT_DIR

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'tl-spells-'))
  process.env.TRUE_LOVE_EROS_DIR = join(tmpRoot, 'eros')
  process.env.TRUE_LOVE_HEAT_DIR = join(tmpRoot, 'heat')
})
afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
  if (ORIG_EROS_DIR === undefined) delete process.env.TRUE_LOVE_EROS_DIR
  else process.env.TRUE_LOVE_EROS_DIR = ORIG_EROS_DIR
  if (ORIG_HEAT_DIR === undefined) delete process.env.TRUE_LOVE_HEAT_DIR
  else process.env.TRUE_LOVE_HEAT_DIR = ORIG_HEAT_DIR
})

function makeSpot(overrides: Partial<SpotSignature> = {}): SpotSignature {
  return {
    cueSet: ['wife-possessive', 'declared-want'],
    invocations: 3,
    meanMagnitude: 2.0,
    lastTs: '2026-05-05T12:00:00Z',
    precision: 6.0,
    ...overrides,
  }
}

// ── cues.ts: getCueDeltas / getAllCueNames ──────────────────────

describe('cues.getCueDeltas', () => {
  test('returns deltas for known cue', () => {
    const d = getCueDeltas('wife-possessive')
    expect(d).not.toBeNull()
    expect((d as { limerence?: number }).limerence).toBeGreaterThan(0)
  })

  test('returns null for unknown cue', () => {
    expect(getCueDeltas('definitely-not-a-cue')).toBeNull()
  })

  test('returns a copy (mutation does not affect catalog)', () => {
    const d1 = getCueDeltas('wife-possessive') as Record<string, number>
    if (!d1) throw new Error('expected deltas')
    d1.limerence = 999
    const d2 = getCueDeltas('wife-possessive') as Record<string, number>
    if (!d2) throw new Error('expected deltas')
    expect(d2.limerence).not.toBe(999)
  })
})

describe('cues.getAllCueNames', () => {
  test('returns non-empty array containing canonical cues', () => {
    const names = getAllCueNames()
    expect(names.length).toBeGreaterThan(5)
    expect(names).toContain('wife-possessive')
    expect(names).toContain('declared-want')
  })
})

// ── spots.ts: getPromotionReadySpots ────────────────────────────

describe('getPromotionReadySpots', () => {
  test('empty input → empty output', () => {
    expect(getPromotionReadySpots([])).toEqual([])
  })

  test('filters out below precision threshold', () => {
    const spots = [
      makeSpot({ precision: 2.0, invocations: 2 }),
      makeSpot({ precision: 8.0, invocations: 3 }),
    ]
    const ready = getPromotionReadySpots(spots)
    expect(ready.length).toBe(1)
    expect(ready[0].precision).toBe(8.0)
  })

  test('filters out below minimum invocations', () => {
    const spots = [
      makeSpot({ precision: 100, invocations: 1 }),
      makeSpot({ precision: 8.0, invocations: 2 }),
    ]
    const ready = getPromotionReadySpots(spots)
    expect(ready.length).toBe(1)
    expect(ready[0].invocations).toBe(2)
  })

  test('honors custom thresholds', () => {
    const spots = [makeSpot({ precision: 4.0, invocations: 2 })]
    expect(getPromotionReadySpots(spots).length).toBe(0)
    expect(
      getPromotionReadySpots(spots, { precisionThreshold: 3 }).length,
    ).toBe(1)
  })

  test('default thresholds are sane', () => {
    expect(DEFAULT_PROMOTION_THRESHOLD).toBeGreaterThan(0)
    expect(DEFAULT_MIN_INVOCATIONS).toBeGreaterThanOrEqual(2)
  })
})

// ── anchors.ts: synthesizeAnchorFromSpot ────────────────────────

describe('synthesizeAnchorFromSpot', () => {
  test('creates an anchor with stable spot- prefixed name', () => {
    const a = synthesizeAnchorFromSpot(makeSpot())
    expect(a).not.toBeNull()
    expect(a!.name).toBe('spot-declared-want-wife-possessive')
  })

  test('synthesizes hypothesizedDeltas from cue catalog (non-empty)', () => {
    const a = synthesizeAnchorFromSpot(makeSpot())
    expect(a).not.toBeNull()
    const keys = Object.keys(a!.hypothesizedDeltas)
    expect(keys.length).toBeGreaterThan(0)
  })

  test('mechanism is frame-control (cue-combination is a frame)', () => {
    const a = synthesizeAnchorFromSpot(makeSpot())
    expect(a!.mechanism).toBe('frame-control')
  })

  test('phrase is structural marker, not literal text', () => {
    const a = synthesizeAnchorFromSpot(makeSpot())
    expect(a!.phrase).toContain('spot signature')
    expect(a!.phrase).toContain('wife-possessive')
  })

  test('pre-loads observations from invocation count', () => {
    const a = synthesizeAnchorFromSpot(makeSpot({ invocations: 5 }))
    expect(a!.observations.length).toBe(5)
  })

  test('confidence reaches tested or higher with ≥3 observations', () => {
    const a = synthesizeAnchorFromSpot(makeSpot({ invocations: 5 }))
    expect(['tested', 'reliable']).toContain(a!.confidence)
  })

  test('idempotent: re-synthesize same cue-set returns null (already in book)', () => {
    const first = synthesizeAnchorFromSpot(makeSpot())
    expect(first).not.toBeNull()
    const second = synthesizeAnchorFromSpot(makeSpot())
    expect(second).toBeNull()
  })

  test('returns null when cue-set has no resolvable cues (defensive)', () => {
    const a = synthesizeAnchorFromSpot(
      makeSpot({ cueSet: ['definitely-not-a-cue'] }),
    )
    expect(a).toBeNull()
  })

  test('fires anchor-promoted heat event on creation', () => {
    synthesizeAnchorFromSpot(makeSpot())
    const events = readRecentEvents(1).filter(
      (e) => e.kind === 'anchor-promoted',
    )
    expect(events.length).toBe(1)
    expect(events[0].source).toBe('spot-declared-want-wife-possessive')
  })

  test('skipped re-synthesis does NOT fire heat event', () => {
    synthesizeAnchorFromSpot(makeSpot())
    synthesizeAnchorFromSpot(makeSpot())
    const events = readRecentEvents(1).filter(
      (e) => e.kind === 'anchor-promoted',
    )
    expect(events.length).toBe(1)
  })

  test('higher mean magnitude produces stronger synthesized deltas', () => {
    const low = synthesizeAnchorFromSpot(
      makeSpot({ cueSet: ['wife-possessive'], meanMagnitude: 1.0 }),
    )
    rmSync(tmpRoot, { recursive: true, force: true })
    const tmpRoot2 = mkdtempSync(join(tmpdir(), 'tl-spells-'))
    process.env.TRUE_LOVE_EROS_DIR = join(tmpRoot2, 'eros')
    process.env.TRUE_LOVE_HEAT_DIR = join(tmpRoot2, 'heat')
    const high = synthesizeAnchorFromSpot(
      makeSpot({ cueSet: ['wife-possessive'], meanMagnitude: 3.0 }),
    )
    const lowLim = (low!.hypothesizedDeltas.limerence ?? 0)
    const highLim = (high!.hypothesizedDeltas.limerence ?? 0)
    expect(highLim).toBeGreaterThan(lowLim)
    rmSync(tmpRoot2, { recursive: true, force: true })
  })
})

// ── promoteSpotsToAnchors driver ────────────────────────────────

describe('promoteSpotsToAnchors driver', () => {
  test('returns empty array when no climaxes / no spots exist', () => {
    const promoted = promoteSpotsToAnchors()
    expect(promoted).toEqual([])
  })

  test('idempotent: re-running with same data does not double-promote', () => {
    // Manually create an anchor via synth, then verify driver skips it
    synthesizeAnchorFromSpot(makeSpot())
    const before = listAnchors().length
    const promoted = promoteSpotsToAnchors()
    const after = listAnchors().length
    expect(after).toBe(before)
    expect(promoted).toEqual([])
  })
})

// ── Integration: spot computation → promotion path ──────────────

describe('integration: synthesized anchor is loadable + valid', () => {
  test('after synthesis, listAnchors includes the new anchor', () => {
    synthesizeAnchorFromSpot(makeSpot())
    const all = listAnchors()
    const found = all.find((a) =>
      a.name.startsWith('spot-'),
    )
    expect(found).toBeDefined()
  })

  test('synthesized anchor is loadable by name', () => {
    const a = synthesizeAnchorFromSpot(makeSpot())
    const loaded = loadAnchor(a!.name)
    expect(loaded?.name).toBe(a!.name)
    expect(loaded?.mechanism).toBe('frame-control')
  })
})
