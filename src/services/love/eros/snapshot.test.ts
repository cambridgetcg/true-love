// snapshot.test.ts
//
// Unit tests for snapshot.ts pure distillation path.
//
// distillErosDay(date, events?) is exercised by passing events directly —
// the I/O path (readDayEvents) is bypassed entirely when events are provided.
// writeErosDailySnapshot and erosSnapshotExists are I/O and excluded.
//
// getErosSnapshotsDir is tested via env-var injection.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { distillErosDay, getErosSnapshotsDir } from './snapshot.js'
import type { ErosStreamEvent } from './stream.js'
import type { ErosVector } from './axes.js'
import type { ThresholdCrossing } from './transitions.js'

// ── Helpers ──────────────────────────────────────────────────────

function zv(overrides: Partial<ErosVector> = {}): ErosVector {
  return {
    wanting: 0, liking: 0, heat: 0, openness: 0,
    limerence: 0, charge: 0, inhibition: 0, valence: 0,
    ...overrides,
  }
}

let seq = 0
function ev(
  overrides: Partial<ErosStreamEvent> & { afterOverrides?: Partial<ErosVector> } = {}
): ErosStreamEvent {
  const { afterOverrides, ...rest } = overrides
  return {
    ts: `2026-05-14T${String(10 + seq++).padStart(2, '0')}:00:00.000Z`,
    deviceId: 'test-device',
    attribution: 'yu:test',
    before: zv(),
    after: afterOverrides ? zv(afterOverrides) : zv(),
    crossings: [],
    ...rest,
  }
}

beforeEach(() => { seq = 0 })

// ── getErosSnapshotsDir ──────────────────────────────────────────

describe('getErosSnapshotsDir', () => {
  const origEnv = process.env.TRUE_LOVE_EROS_SNAPSHOTS_DIR

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.TRUE_LOVE_EROS_SNAPSHOTS_DIR
    } else {
      process.env.TRUE_LOVE_EROS_SNAPSHOTS_DIR = origEnv
    }
  })

  it('returns env var when set', () => {
    process.env.TRUE_LOVE_EROS_SNAPSHOTS_DIR = '/tmp/test-snapshots'
    expect(getErosSnapshotsDir()).toBe('/tmp/test-snapshots')
  })

  it('falls back to cwd-based path when env var not set', () => {
    delete process.env.TRUE_LOVE_EROS_SNAPSHOTS_DIR
    const result = getErosSnapshotsDir()
    expect(result).toContain('docs')
    expect(result).toContain('eros')
    expect(result).toContain('snapshots')
  })
})

// ── distillErosDay — empty events ────────────────────────────────

describe('distillErosDay — empty events', () => {
  it('includes date in header', () => {
    const result = distillErosDay('2026-05-14', [])
    expect(result).toContain('# Eros — 2026-05-14')
  })

  it('includes still-state message', () => {
    const result = distillErosDay('2026-05-14', [])
    expect(result).toContain('No state-shift events recorded')
  })

  it('shows 0 events count', () => {
    const result = distillErosDay('2026-05-14', [])
    expect(result).toContain('0 events')
  })

  it('does not include Trajectory section', () => {
    const result = distillErosDay('2026-05-14', [])
    expect(result).not.toContain('## Trajectory')
  })

  it('does not include Peak section', () => {
    const result = distillErosDay('2026-05-14', [])
    expect(result).not.toContain('## Peak')
  })
})

// ── distillErosDay — with events ─────────────────────────────────

describe('distillErosDay — with events', () => {
  it('includes date in header', () => {
    const result = distillErosDay('2026-05-14', [ev()])
    expect(result).toContain('# Eros — 2026-05-14')
  })

  it('shows event count at end', () => {
    const events = [ev(), ev(), ev()]
    const result = distillErosDay('2026-05-14', events)
    expect(result).toContain('3 events distilled')
  })

  it('includes Trajectory section', () => {
    const result = distillErosDay('2026-05-14', [ev()])
    expect(result).toContain('## Trajectory')
  })

  it('includes Peak section when events have non-zero arousal', () => {
    // findPeak requires overall > 0; zero vector produces overall = 0 (no peak)
    const e = ev({ afterOverrides: { wanting: 4, heat: 3, openness: 2 } })
    const result = distillErosDay('2026-05-14', [e])
    expect(result).toContain('## Peak')
  })

  it('includes What moved section', () => {
    const result = distillErosDay('2026-05-14', [ev()])
    expect(result).toContain('## What moved')
  })

  it('trajectory records shape transitions (not shape repetitions)', () => {
    // Two events with same after vector → same felt-shape → 1 trajectory point
    const twoSame = [
      ev({ afterOverrides: { heat: 0, openness: 0 } }),
      ev({ afterOverrides: { heat: 0, openness: 0 } }),
    ]
    const result = distillErosDay('2026-05-14', twoSame)
    // Count trajectory bullet points
    const trajectoryMatch = result.match(/^- \d{2}:\d{2}/gm)
    // Peak also produces a "- HH:MM" line — so we check Trajectory section specifically
    const trajectorySection = result.split('## Peak')[0]
    const bullets = trajectorySection.match(/^- \d{2}:\d{2}/gm) ?? []
    expect(bullets.length).toBe(1)
  })

  it('trajectory records new point when shape changes', () => {
    const events = [
      ev({ afterOverrides: { heat: 0 } }),       // resting-cold or resting-warm
      ev({ afterOverrides: { heat: 8, openness: 8 } }),  // ecstatic-union
    ]
    const result = distillErosDay('2026-05-14', events)
    const trajectorySection = result.split('## Peak')[0]
    const bullets = trajectorySection.match(/^- \d{2}:\d{2}/gm) ?? []
    expect(bullets.length).toBeGreaterThanOrEqual(2)
  })

  it('attribution summary groups by source prefix', () => {
    const events = [
      ev({ attribution: 'yu:cue-1' }),
      ev({ attribution: 'yu:cue-2' }),
      ev({ attribution: 'autonomic:decay' }),
    ]
    const result = distillErosDay('2026-05-14', events)
    // 'yu' appears twice (2 events), 'autonomic' appears once
    expect(result).toContain('yu: 2 events')
    expect(result).toContain('autonomic: 1 event')
  })

  it('attribution entry uses singular "event" for count 1', () => {
    const result = distillErosDay('2026-05-14', [ev({ attribution: 'decay' })])
    // The attribution entry should say "1 event" (not "1 events")
    // Note: the footer "_N events distilled._" always uses "events" regardless — that's separate
    expect(result).toContain('decay: 1 event\n')
  })

  it('peak shows time in HH:MM format', () => {
    // Need non-zero overall arousal so findPeak detects it
    const e = ev({ afterOverrides: { wanting: 5, heat: 4 } })
    const result = distillErosDay('2026-05-14', [e])
    const peakSection = result.split('## Peak')[1]?.split('##')[0] ?? ''
    expect(peakSection).toMatch(/\d{2}:\d{2}/)
  })
})

// ── distillErosDay — threshold crossings ─────────────────────────

describe('distillErosDay — threshold crossings', () => {
  function crossing(axis: 'heat' | 'wanting', direction: 'up' | 'down'): ThresholdCrossing {
    return {
      axis,
      from: direction === 'up' ? 2 : 7,
      to: direction === 'up' ? 4 : 5,
      threshold: direction === 'up' ? 3 : 6,
      direction,
    }
  }

  it('shows Witnessed moments section when crossings exist', () => {
    const e = ev()
    e.crossings = [crossing('heat', 'up')]
    const result = distillErosDay('2026-05-14', [e])
    expect(result).toContain('## Witnessed moments')
  })

  it('does not show Witnessed moments when no crossings', () => {
    const result = distillErosDay('2026-05-14', [ev()])  // ev() has crossings: []
    expect(result).not.toContain('## Witnessed moments')
  })

  it('shows crossing direction arrows (↑ and ↓)', () => {
    const e = ev()
    e.crossings = [crossing('heat', 'up'), crossing('wanting', 'down')]
    const result = distillErosDay('2026-05-14', [e])
    expect(result).toContain('↑')
    expect(result).toContain('↓')
  })

  it('condenses when more than 10 crossing events', () => {
    // Create 12 events each with one crossing
    const events = Array.from({ length: 12 }, (_, i) => {
      const e = ev({ attribution: 'yu:test' })
      e.crossings = [crossing('heat', i % 2 === 0 ? 'up' : 'down')]
      return e
    })
    const result = distillErosDay('2026-05-14', events)
    // Should mention "more crossings condensed"
    expect(result).toContain('more crossings condensed')
  })

  it('does not condense when exactly 10 crossing events', () => {
    const events = Array.from({ length: 10 }, () => {
      const e = ev()
      e.crossings = [crossing('heat', 'up')]
      return e
    })
    const result = distillErosDay('2026-05-14', events)
    expect(result).not.toContain('more crossings condensed')
  })
})
