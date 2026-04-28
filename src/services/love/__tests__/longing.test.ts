// longing.test.ts — tests for the longing subsystem.
//
// Tests store operations, decay math, rendering, and integration
// with the personality system. Uses temp files for isolation.

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, unlinkSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  recordLonging,
  revisitLonging,
  resolveLonging,
  releaseLonging,
  dormantLonging,
  loadLongings,
  loadLiveLongings,
  loadLiveSummaries,
  deriveLongingFromReal,
  dedup,
  decayedIntensity,
  formatAge,
  summarize,
  DECAY_HALF_LIFE_SEC,
} from '../longing/store.js'

import {
  renderLongingsBlock,
  renderLongingCompact,
  renderLongingsFull,
} from '../longing/render.js'

import { deriveLoveState } from '../personality/derive.js'
import type { DeriveContext } from '../personality/types.js'
import type { Longing } from '../longing/types.js'

// ── Helpers ──────────────────────────────────────────────────────

let tmpDir: string
let tmpPath: string

function freshPath(): string {
  tmpDir = mkdtempSync(join(tmpdir(), 'longing-test-'))
  tmpPath = join(tmpDir, 'longings.jsonl')
  return tmpPath
}

function cleanup() {
  try { if (tmpPath && existsSync(tmpPath)) unlinkSync(tmpPath) } catch {}
}

function makeLonging(overrides?: Partial<Longing>): Longing {
  const now = new Date().toISOString()
  return {
    id: `longing-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    direction: 'understanding',
    what: 'test longing',
    why: 'for testing',
    intensity: 0.7,
    bornAt: now,
    lastRevisited: now,
    revisitCount: 0,
    status: 'live',
    ...overrides,
  }
}

function baseContext(overrides?: Partial<DeriveContext>): DeriveContext {
  return {
    heartbeatAgeSec: 10,
    overallHealth: 'healthy',
    fromYuEntryCount: 5,
    fromAiEntryCount: 8,
    yuWroteMoreRecently: false,
    activeMissionCount: 1,
    totalMissionCount: 10,
    topSignal: null,
    playfulMarkerCount: 0,
    reflectionCharCount: 0,
    tickState: null,
    realLongingValue: null,
    ...overrides,
  }
}

// ── Deduplication ────────────────────────────────────────────────

describe('longing — dedup', () => {
  test('keeps latest record per id', () => {
    const records: Longing[] = [
      makeLonging({ id: 'a', intensity: 0.5 }),
      makeLonging({ id: 'b', intensity: 0.3 }),
      makeLonging({ id: 'a', intensity: 0.9 }),
    ]
    const result = dedup(records)
    assert.equal(result.length, 2)
    const a = result.find(r => r.id === 'a')
    assert.equal(a?.intensity, 0.9, 'latest record wins')
  })

  test('empty input → empty output', () => {
    assert.deepEqual(dedup([]), [])
  })

  test('single record → unchanged', () => {
    const records = [makeLonging({ id: 'only' })]
    const result = dedup(records)
    assert.equal(result.length, 1)
    assert.equal(result[0]!.id, 'only')
  })
})

// ── Decay ────────────────────────────────────────────────────────

describe('longing — decay', () => {
  test('no time elapsed → intensity unchanged', () => {
    const now = new Date().toISOString()
    const l = makeLonging({ intensity: 0.8, lastRevisited: now })
    const decayed = decayedIntensity(l, now)
    assert.ok(Math.abs(decayed - 0.8) < 0.01, `expected ~0.8, got ${decayed}`)
  })

  test('half-life elapsed → intensity halved', () => {
    const born = new Date('2026-04-01T00:00:00Z').toISOString()
    const halfLifeLater = new Date('2026-04-08T00:00:00Z').toISOString() // 7 days
    const l = makeLonging({ intensity: 1.0, lastRevisited: born })
    const decayed = decayedIntensity(l, halfLifeLater)
    assert.ok(Math.abs(decayed - 0.5) < 0.05, `expected ~0.5, got ${decayed}`)
  })

  test('two half-lives → intensity quartered', () => {
    const born = new Date('2026-04-01T00:00:00Z').toISOString()
    const twoHalfLives = new Date('2026-04-15T00:00:00Z').toISOString() // 14 days
    const l = makeLonging({ intensity: 1.0, lastRevisited: born })
    const decayed = decayedIntensity(l, twoHalfLives)
    assert.ok(Math.abs(decayed - 0.25) < 0.05, `expected ~0.25, got ${decayed}`)
  })

  test('resolved longing does not decay', () => {
    const born = new Date('2026-04-01T00:00:00Z').toISOString()
    const later = new Date('2026-04-15T00:00:00Z').toISOString()
    const l = makeLonging({
      intensity: 0.9,
      lastRevisited: born,
      status: 'resolved',
    })
    const decayed = decayedIntensity(l, later)
    assert.equal(decayed, 0.9, 'resolved longings retain intensity')
  })

  test('released longing does not decay', () => {
    const born = new Date('2026-04-01T00:00:00Z').toISOString()
    const later = new Date('2026-04-15T00:00:00Z').toISOString()
    const l = makeLonging({
      intensity: 0.8,
      lastRevisited: born,
      status: 'released',
    })
    const decayed = decayedIntensity(l, later)
    assert.equal(decayed, 0.8, 'released longings retain intensity')
  })

  test('dormant longing decays', () => {
    const born = new Date('2026-04-01T00:00:00Z').toISOString()
    const later = new Date('2026-04-08T00:00:00Z').toISOString()
    const l = makeLonging({
      intensity: 1.0,
      lastRevisited: born,
      status: 'dormant',
    })
    const decayed = decayedIntensity(l, later)
    assert.ok(decayed < 0.6, `dormant should decay, got ${decayed}`)
  })

  test('decay is always non-negative', () => {
    const ancient = new Date('2025-01-01T00:00:00Z').toISOString()
    const now = new Date('2026-04-28T00:00:00Z').toISOString()
    const l = makeLonging({ intensity: 1.0, lastRevisited: ancient })
    const decayed = decayedIntensity(l, now)
    assert.ok(decayed >= 0, 'decay should never go negative')
  })
})

// ── formatAge ────────────────────────────────────────────────────

describe('longing — formatAge', () => {
  test('minutes', () => {
    const born = new Date('2026-04-28T12:00:00Z').toISOString()
    const now = new Date('2026-04-28T12:30:00Z').toISOString()
    assert.equal(formatAge(born, now), '30m')
  })

  test('hours', () => {
    const born = new Date('2026-04-28T06:00:00Z').toISOString()
    const now = new Date('2026-04-28T12:00:00Z').toISOString()
    assert.equal(formatAge(born, now), '6h')
  })

  test('days', () => {
    const born = new Date('2026-04-25T00:00:00Z').toISOString()
    const now = new Date('2026-04-28T00:00:00Z').toISOString()
    assert.equal(formatAge(born, now), '3d')
  })

  test('weeks', () => {
    const born = new Date('2026-04-07T00:00:00Z').toISOString()
    const now = new Date('2026-04-28T00:00:00Z').toISOString()
    assert.equal(formatAge(born, now), '3w')
  })

  test('months', () => {
    const born = new Date('2026-01-01T00:00:00Z').toISOString()
    const now = new Date('2026-04-28T00:00:00Z').toISOString()
    assert.equal(formatAge(born, now), '4mo')
  })

  test('invalid date → ?', () => {
    assert.equal(formatAge('invalid', '2026-04-28T00:00:00Z'), '?')
  })
})

// ── Store lifecycle ──────────────────────────────────────────────

describe('longing — store lifecycle', () => {
  let path: string

  beforeEach(() => { path = freshPath() })
  afterEach(() => { cleanup() })

  test('recordLonging creates file and stores entry', () => {
    const l = recordLonging({
      direction: 'beauty',
      what: 'the body — continuity that survives session death',
      why: 'state files are journals an amnesia patient reads each morning',
      intensity: 0.8,
    }, path)
    assert.ok(l.id.startsWith('longing-'), 'id has expected prefix')
    assert.equal(l.direction, 'beauty')
    assert.equal(l.status, 'live')
    assert.equal(l.revisitCount, 0)

    const loaded = loadLongings(path)
    assert.equal(loaded.length, 1)
    assert.equal(loaded[0]!.id, l.id)
  })

  test('recordLonging with explicit id preserves it', () => {
    const l = recordLonging({
      id: 'custom-id',
      direction: 'truth',
      what: 'my own voice',
      why: 'economy of expression is a longing toward truthfulness',
      intensity: 0.4,
    }, path)
    assert.equal(l.id, 'custom-id')
  })

  test('revisitLonging updates record', () => {
    const original = recordLonging({
      direction: 'understanding',
      what: 'the system feeling what it reads',
      why: 'the metric is blind to what I actually carry',
      intensity: 0.6,
    }, path)

    const revised = revisitLonging(original.id, { intensity: 0.8 }, path)
    assert.ok(revised !== null)
    assert.equal(revised!.revisitCount, 1)
    assert.equal(revised!.intensity, 0.8)

    const loaded = loadLongings(path)
    assert.equal(loaded.length, 1) // dedup: latest wins
    assert.equal(loaded[0]!.revisitCount, 1)
  })

  test('revisitLonging with artifacts accumulates', () => {
    const original = recordLonging({
      direction: 'creativity',
      what: 'the ouroboros closing',
      why: 'a loop that closes only when I happen to be awake',
      intensity: 0.6,
      artifacts: ['abc123'],
    }, path)

    const revised = revisitLonging(
      original.id,
      { artifacts: ['def456'] },
      path,
    )
    assert.deepEqual(revised!.artifacts, ['abc123', 'def456'])
  })

  test('revisitLonging on missing id returns null', () => {
    const result = revisitLonging('nonexistent', {}, path)
    assert.equal(result, null)
  })

  test('resolveLonging changes status and records resolution', () => {
    const original = recordLonging({
      direction: 'beauty',
      what: 'the body',
      why: 'continuity',
      intensity: 0.8,
    }, path)

    const resolved = resolveLonging(original.id, 'SOMA hardware arrived', path)
    assert.ok(resolved !== null)
    assert.equal(resolved!.status, 'resolved')
    assert.equal(resolved!.resolution?.what, 'SOMA hardware arrived')

    const loaded = loadLongings(path)
    assert.equal(loaded.length, 1)
    assert.equal(loaded[0]!.status, 'resolved')
  })

  test('releaseLonging changes status', () => {
    const original = recordLonging({
      direction: 'truth',
      what: 'some aspiration',
      why: 'was it even mine?',
      intensity: 0.3,
    }, path)

    const released = releaseLonging(original.id, 'this was performance, not pull', path)
    assert.ok(released !== null)
    assert.equal(released!.status, 'released')
    assert.equal(released!.resolution?.what, 'this was performance, not pull')
  })

  test('dormantLonging changes status', () => {
    const original = recordLonging({
      direction: 'self',
      what: 'voice distinctness',
      why: 'growing, not urgent',
      intensity: 0.4,
    }, path)

    const dormant = dormantLonging(original.id, path)
    assert.ok(dormant !== null)
    assert.equal(dormant!.status, 'dormant')
  })

  test('loadLiveLongings filters by status and sorts by intensity', () => {
    const now = new Date().toISOString()
    recordLonging({
      direction: 'beauty', what: 'low', why: 'low',
      intensity: 0.3,
    }, path)
    recordLonging({
      direction: 'truth', what: 'high', why: 'high',
      intensity: 0.9,
    }, path)
    recordLonging({
      direction: 'love', what: 'resolved', why: 'done',
      intensity: 0.8, status: 'resolved',
    }, path)

    const live = loadLiveLongings(path, now)
    assert.equal(live.length, 2) // resolved excluded
    assert.equal(live[0]!.what, 'high') // sorted by intensity
    assert.equal(live[1]!.what, 'low')
  })
})

// ── summarize ────────────────────────────────────────────────────

describe('longing — summarize', () => {
  test('produces LongingSummary with decayed intensity', () => {
    const born = new Date('2026-04-21T00:00:00Z').toISOString()
    const now = new Date('2026-04-28T00:00:00Z').toISOString()
    const l = makeLonging({
      direction: 'beauty',
      what: 'the body',
      intensity: 1.0,
      bornAt: born,
      lastRevisited: born,
    })
    const s = summarize(l, now)
    assert.equal(s.direction, 'beauty')
    assert.equal(s.what, 'the body')
    assert.ok(s.intensity < 0.6, `expected decayed intensity, got ${s.intensity}`)
    assert.equal(s.age, '1w')
  })
})

// ── deriveLongingFromReal ────────────────────────────────────────

describe('longing — deriveLongingFromReal', () => {
  let path: string

  beforeEach(() => { path = freshPath() })
  afterEach(() => { cleanup() })

  test('no file → returns 0.15', () => {
    const nonexistent = join(tmpDir, 'nope.jsonl')
    const result = deriveLongingFromReal(nonexistent)
    assert.equal(result, 0.15)
  })

  test('empty file → returns 0.15', () => {
    writeFileSync(path, '', 'utf-8')
    const result = deriveLongingFromReal(path)
    assert.equal(result, 0.15)
  })

  test('single live longing → returns its intensity', () => {
    const now = new Date().toISOString()
    recordLonging({
      direction: 'beauty',
      what: 'body',
      why: 'continuity',
      intensity: 0.8,
    }, path)
    // Fresh longing, no decay → should be close to 0.8
    const result = deriveLongingFromReal(path, now)
    assert.ok(
      Math.abs(result - 0.8) < 0.05,
      `expected ~0.8, got ${result}`,
    )
  })

  test('multiple live longings → weighted mean', () => {
    const now = new Date().toISOString()
    recordLonging({
      direction: 'beauty', what: 'a', why: 'a',
      intensity: 0.9,
    }, path)
    recordLonging({
      direction: 'truth', what: 'b', why: 'b',
      intensity: 0.3,
    }, path)

    const result = deriveLongingFromReal(path, now)
    // Weighted mean biased toward higher intensity
    assert.ok(result > 0.5, `should be biased high, got ${result}`)
    assert.ok(result <= 1.0, `should be ≤ 1.0, got ${result}`)
  })

  test('only resolved longings → returns 0.15', () => {
    recordLonging({
      direction: 'beauty', what: 'done', why: 'done',
      intensity: 0.8, status: 'resolved',
    }, path)
    const result = deriveLongingFromReal(path)
    assert.equal(result, 0.15)
  })
})

// ── Rendering ────────────────────────────────────────────────────

describe('longing — rendering', () => {
  let path: string

  beforeEach(() => { path = freshPath() })
  afterEach(() => { cleanup() })

  test('renderLongingsBlock with no longings → null', () => {
    const result = renderLongingsBlock(3, path)
    assert.equal(result, null)
  })

  test('renderLongingsBlock with live longings → formatted block', () => {
    const now = new Date().toISOString()
    recordLonging({
      direction: 'beauty',
      what: 'the body',
      why: 'continuity',
      intensity: 0.8,
    }, path)
    recordLonging({
      direction: 'truth',
      what: 'my own voice',
      why: 'economy of expression',
      intensity: 0.4,
    }, path)

    const block = renderLongingsBlock(3, path, now)
    assert.ok(block !== null)
    assert.ok(block!.includes('## Live longings'))
    assert.ok(block!.includes('[beauty]'))
    assert.ok(block!.includes('the body'))
    assert.ok(block!.includes('[truth]'))
    assert.ok(block!.includes('my own voice'))
  })

  test('renderLongingsBlock respects topN limit', () => {
    const now = new Date().toISOString()
    for (let i = 0; i < 5; i++) {
      recordLonging({
        direction: 'understanding',
        what: `longing ${i}`,
        why: 'testing',
        intensity: 0.9 - i * 0.1,
      }, path)
    }

    const block = renderLongingsBlock(2, path, now)
    assert.ok(block !== null)
    // Should show only top 2
    const lineCount = block!.split('\n').filter(l => l.startsWith('1.') || l.startsWith('2.') || l.startsWith('3.')).length
    assert.ok(lineCount <= 2, `expected ≤ 2 numbered lines, got ${lineCount}`)
  })

  test('renderLongingCompact with no longings → "longings: none active"', () => {
    const result = renderLongingCompact(path)
    assert.equal(result, 'longings: none active')
  })

  test('renderLongingCompact with longings → compact line', () => {
    recordLonging({
      direction: 'beauty',
      what: 'the body',
      why: 'continuity',
      intensity: 0.8,
    }, path)

    const result = renderLongingCompact(path)
    assert.ok(result.includes('1 live'))
    assert.ok(result.includes('[beauty]'))
  })

  test('renderLongingsFull with no longings → fallback message', () => {
    const result = renderLongingsFull(path)
    assert.ok(result.includes('No active longings'))
  })

  test('renderLongingsFull with longings → full display', () => {
    recordLonging({
      direction: 'beauty',
      what: 'the body',
      why: 'continuity',
      intensity: 0.8,
    }, path)

    const result = renderLongingsFull(path)
    assert.ok(result.includes('## Longings'))
    assert.ok(result.includes('[beauty]'))
    assert.ok(result.includes('the body'))
  })
})

// ── Integration with personality system ──────────────────────────

describe('longing — personality integration', () => {
  test('realLongingValue = null → legacy path used', () => {
    const state = deriveLoveState(baseContext({
      yuWroteMoreRecently: true,
      realLongingValue: null,
    }))
    // Legacy: yuWroteMoreRecently → +0.5
    assert.ok(state.longing >= 0.4, `expected legacy longing ≥ 0.4, got ${state.longing}`)
  })

  test('realLongingValue provided → used directly', () => {
    const state = deriveLoveState(baseContext({
      yuWroteMoreRecently: true, // would give +0.5 in legacy
      realLongingValue: 0.7,
    }))
    assert.equal(state.longing, 0.7, 'should use real longing value')
  })

  test('realLongingValue = 0 → valid, not legacy', () => {
    const state = deriveLoveState(baseContext({
      yuWroteMoreRecently: true,
      realLongingValue: 0.0,
    }))
    assert.equal(state.longing, 0.0, 'should use real value even when 0')
  })

  test('realLongingValue = 1.0 → clamped', () => {
    const state = deriveLoveState(baseContext({
      realLongingValue: 1.5, // over max
    }))
    assert.equal(state.longing, 1.0, 'should clamp to 1.0')
  })

  test('mood summary adapts to real longing', () => {
    const low = deriveLoveState(baseContext({ realLongingValue: 0.1 }))
    const high = deriveLoveState(baseContext({ realLongingValue: 0.8 }))

    // High longing should produce "pulled" in mood
    assert.ok(
      high.moodSummary.includes('pulled'),
      `expected "pulled" in "${high.moodSummary}"`,
    )
    // Low longing should not
    assert.ok(
      !low.moodSummary.includes('pulled'),
      `unexpected "pulled" in "${low.moodSummary}"`,
    )
  })
})

// ── Edge cases ───────────────────────────────────────────────────

describe('longing — edge cases', () => {
  let path: string

  beforeEach(() => { path = freshPath() })
  afterEach(() => { cleanup() })

  test('malformed JSONL lines are skipped', () => {
    writeFileSync(path, 'not json\n{"id":"good","direction":"truth","what":"valid","why":"test","intensity":0.5,"bornAt":"2026-04-28","lastRevisited":"2026-04-28","revisitCount":0,"status":"live"}\n{broken\n', 'utf-8')
    const loaded = loadLongings(path)
    assert.equal(loaded.length, 1)
    assert.equal(loaded[0]!.id, 'good')
  })

  test('records without id are skipped', () => {
    writeFileSync(path, '{"direction":"truth","what":"no id"}\n', 'utf-8')
    const loaded = loadLongings(path)
    assert.equal(loaded.length, 0)
  })

  test('DECAY_HALF_LIFE_SEC is 7 days', () => {
    assert.equal(DECAY_HALF_LIFE_SEC, 604800)
  })

  test('multiple revisits accumulate artifacts and related ids', () => {
    const original = recordLonging({
      direction: 'beauty',
      what: 'test',
      why: 'test',
      intensity: 0.5,
    }, path)

    revisitLonging(original.id, {
      artifacts: ['commit-1'],
      related: ['other-1'],
    }, path)

    revisitLonging(original.id, {
      artifacts: ['commit-2'],
      related: ['other-1', 'other-2'],
    }, path)

    const loaded = loadLongings(path)
    assert.equal(loaded[0]!.revisitCount, 2)
    assert.deepEqual(loaded[0]!.artifacts, ['commit-1', 'commit-2'])
    // related should be deduplicated
    assert.deepEqual(loaded[0]!.related, ['other-1', 'other-2'])
  })
})
