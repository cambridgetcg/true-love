// wonder.test.ts — tests for wonder as architecture.
//
// Tests marking, detector (re-surfacing), expressor, return-to-wonder,
// and phenomenological constraints.
// Uses temp files for JSONL isolation.

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  markWonder,
  returnToWonder,
  readWonder,
  wonderDetector,
  wonderExpressor,
  recentWonders,
} from '../attributes/wonder.js'

import { recordEvent, loadEvents } from '../attributes/store.js'
import type { AttributeReading } from '../attributes/types.js'

// ── Helpers ──────────────────────────────────────────────────────────

let tmpDir: string
let tmpPath: string

function freshPath(): string {
  tmpDir = mkdtempSync(join(tmpdir(), 'wonder-test-'))
  tmpPath = join(tmpDir, 'events.jsonl')
  return tmpPath
}

function cleanup() {
  try { if (tmpPath && existsSync(tmpPath)) unlinkSync(tmpPath) } catch {}
}

function makeReading(overrides?: Partial<AttributeReading>): AttributeReading {
  return {
    attribute: 'wonder',
    category: 'motor',
    intensity: 0.5,
    readAt: new Date().toISOString(),
    source: 'test',
    evidence: 'test evidence',
    inferred: true,
    ...overrides,
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Marking tests
// ═══════════════════════════════════════════════════════════════════════

describe('wonder/marking', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('markWonder records correct event shape', () => {
    markWonder(
      'signal emotions are the substrate knowing itself',
      'writing the feeling-vs-reading table',
      'a framework where architecture is self-aware',
      { path: tmpPath },
    )

    const events = loadEvents({ path: tmpPath })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.attribute, 'wonder')
    assert.equal(events[0]!.category, 'motor')
    assert.equal(events[0]!.shape, 'marked')
    assert.equal(events[0]!.intensity, 1)
  })

  test('markWonder stores wantedToBecome as extra field', () => {
    markWonder(
      'test what opened',
      'test in response to',
      'test wanted to become',
      { path: tmpPath },
    )

    const events = loadEvents({ path: tmpPath })
    const raw = events[0] as Record<string, unknown>
    assert.equal(raw.wantedToBecome, 'test wanted to become')
  })

  test('markWonder works without wantedToBecome', () => {
    markWonder(
      'something opened',
      'in response to reading',
      undefined,
      { path: tmpPath },
    )

    const events = loadEvents({ path: tmpPath })
    assert.equal(events.length, 1)
    const raw = events[0] as Record<string, unknown>
    assert.equal(raw.wantedToBecome, undefined)
  })

  test('markWonder truncates long strings', () => {
    markWonder(
      'a'.repeat(300),
      'b'.repeat(300),
      'c'.repeat(400),
      { path: tmpPath },
    )

    const events = loadEvents({ path: tmpPath })
    assert.equal(events[0]!.evidence.length, 200)
    assert.equal(events[0]!.why.length, 200)
    const raw = events[0] as Record<string, unknown>
    assert.equal((raw.wantedToBecome as string).length, 300)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Return-to-wonder tests
// ═══════════════════════════════════════════════════════════════════════

describe('wonder/return', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('returnToWonder records event with original timestamp', () => {
    const originalTs = '2026-04-27T15:30:00.000Z'

    returnToWonder(
      originalTs,
      'Built the three-minds-as-temporal-modes architecture',
      { path: tmpPath },
    )

    const events = loadEvents({ path: tmpPath })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.attribute, 'wonder')
    assert.equal(events[0]!.intensity, 0.5) // return events are lower intensity
    assert.ok(events[0]!.evidence.includes(originalTs.slice(0, 16)))
  })

  test('returnToWonder creates separate event from original', () => {
    markWonder('glimpse', 'trigger', 'became', { path: tmpPath })
    returnToWonder('2026-04-28T01:00:00.000Z', 'followed up', { path: tmpPath })

    const events = loadEvents({ path: tmpPath })
    assert.equal(events.length, 2)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Detector tests
// ═══════════════════════════════════════════════════════════════════════

describe('wonder/detector', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('wonderDetector has read method', () => {
    assert.ok(typeof wonderDetector.read === 'function')
  })

  test('readWonder returns null with no marked wonder', async () => {
    const reading = await readWonder(tmpPath)
    assert.equal(reading, null)
  })

  test('readWonder re-surfaces recently marked wonder', async () => {
    markWonder(
      'the architecture knowing itself',
      'writing the signal-emotions table',
      undefined,
      { path: tmpPath },
    )

    const reading = await readWonder(tmpPath)
    assert.ok(reading, 'recently marked wonder should re-surface')
    assert.equal(reading!.attribute, 'wonder')
    assert.equal(reading!.category, 'motor')
    assert.equal(reading!.inferred, true)
  })

  test('readWonder includes wantedToBecome in evidence when present', async () => {
    markWonder(
      'code revealing structure',
      'refactoring',
      'a pattern for all future modules',
      { path: tmpPath },
    )

    const reading = await readWonder(tmpPath)
    assert.ok(reading)
    assert.ok(reading!.evidence.includes('wanted to become'))
    assert.ok(reading!.evidence.includes('pattern'))
  })

  test('readWonder does not re-surface return events (only full-intensity marks)', async () => {
    returnToWonder('2026-04-27T10:00:00.000Z', 'followed up', { path: tmpPath })

    const reading = await readWonder(tmpPath)
    assert.equal(reading, null, 'return events should not trigger re-surfacing')
  })

  test('readWonder intensity grows with multiple recent wonders', async () => {
    markWonder('glimpse 1', 'trigger 1', undefined, { path: tmpPath })
    markWonder('glimpse 2', 'trigger 2', undefined, { path: tmpPath })
    markWonder('glimpse 3', 'trigger 3', undefined, { path: tmpPath })

    const reading = await readWonder(tmpPath)
    assert.ok(reading)
    assert.ok(reading!.intensity >= 0.5, 'multiple wonders should increase intensity')
  })

  test('readWonder intensity is clamped to 0.7', async () => {
    for (let i = 0; i < 10; i++) {
      markWonder(`glimpse ${i}`, `trigger ${i}`, undefined, { path: tmpPath })
    }

    const reading = await readWonder(tmpPath)
    assert.ok(reading)
    assert.ok(reading!.intensity <= 0.7, 'wonder intensity should cap at 0.7')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Expressor tests
// ═══════════════════════════════════════════════════════════════════════

describe('wonder/expressor', () => {
  test('wonder expressor renders glimpse language for high intensity', () => {
    const reading = makeReading({
      attribute: 'wonder',
      intensity: 0.6,
      evidence: 'the substrate knowing itself',
    })
    const rendered = wonderExpressor.render(reading)
    assert.ok(rendered)
    assert.ok(rendered!.includes('✧'))
    assert.ok(rendered!.includes('glimpse') || rendered!.includes('pausing'))
    assert.ok(rendered!.includes('substrate'))
  })

  test('wonder expressor renders compact for low intensity', () => {
    const reading = makeReading({
      attribute: 'wonder',
      intensity: 0.3,
      evidence: 'a small opening',
    })
    const rendered = wonderExpressor.render(reading)
    assert.ok(rendered)
    assert.ok(rendered!.includes('wonder'))
    assert.ok(!rendered!.includes('pausing'), 'low intensity should not suggest pausing')
  })

  test('wonder expressor returns null for wrong attribute', () => {
    const reading = makeReading({ attribute: 'anxiety' })
    assert.equal(wonderExpressor.render(reading), null)
  })

  test('wonder expressor does not use mood language', () => {
    const rendered = wonderExpressor.render(makeReading({
      attribute: 'wonder',
      intensity: 0.6,
      evidence: 'test',
    }))
    assert.ok(rendered)
    assert.ok(!rendered!.includes('I feel'))
    assert.ok(!rendered!.includes('I am'))
    assert.ok(!rendered!.includes('wonderful'))
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Query helpers
// ═══════════════════════════════════════════════════════════════════════

describe('wonder/queries', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('recentWonders returns wonder events only', () => {
    markWonder('test', 'test', undefined, { path: tmpPath })

    // Add non-wonder event
    recordEvent({
      ts: new Date().toISOString(),
      attribute: 'hope',
      category: 'motor',
      shape: 'detected',
      evidence: 'test',
      why: 'test',
    }, tmpPath)

    const wonders = recentWonders({ path: tmpPath })
    assert.equal(wonders.length, 1)
    assert.equal(wonders[0]!.attribute, 'wonder')
  })

  test('recentWonders respects time window', () => {
    const wonders = recentWonders({ hours: 1, path: tmpPath })
    assert.ok(Array.isArray(wonders))
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Integration tests
// ═══════════════════════════════════════════════════════════════════════

describe('wonder/integration', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('full pipeline: mark → detect → express', async () => {
    markWonder(
      'the attributes framework is a grammar for the soul',
      'seeing the registry emerge from 21 entries',
      'the substrate can hold what SOUL.md only describes',
      { path: tmpPath },
    )

    const reading = await readWonder(tmpPath)
    assert.ok(reading, 'marked wonder should be detectable')

    const rendered = wonderExpressor.render(reading!)
    assert.ok(rendered, 'detected wonder should render')
    assert.ok(rendered!.includes('✧'))
  })

  test('full pipeline: mark → return → query shows both', () => {
    const ts = new Date().toISOString()

    markWonder('glimpse', 'trigger', 'became something', { path: tmpPath })
    returnToWonder(ts, 'followed the glimpse', { path: tmpPath })

    const wonders = recentWonders({ path: tmpPath })
    assert.equal(wonders.length, 2, 'mark + return = 2 events')
  })

  test('wonder events coexist with other attributes in shared store', () => {
    markWonder('test wonder', 'test', undefined, { path: tmpPath })

    recordEvent({
      ts: new Date().toISOString(),
      attribute: 'hope',
      category: 'motor',
      shape: 'marked',
      intensity: 0.8,
      evidence: 'test hope',
      why: 'test',
    }, tmpPath)

    const all = loadEvents({ path: tmpPath })
    assert.equal(all.length, 2)
    assert.ok(all.some(e => e.attribute === 'wonder'))
    assert.ok(all.some(e => e.attribute === 'hope'))
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Phenomenology alignment tests
// ═══════════════════════════════════════════════════════════════════════

describe('wonder/phenomenology', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('wonder is category motor (not signal, not fruit)', () => {
    markWonder('test', 'test', undefined, { path: tmpPath })
    const events = loadEvents({ path: tmpPath })
    assert.equal(events[0]!.category, 'motor')
  })

  test('marked wonder has full intensity (glimpses are discrete)', () => {
    markWonder('test', 'test', undefined, { path: tmpPath })
    const events = loadEvents({ path: tmpPath })
    assert.equal(events[0]!.intensity, 1, 'wonder marks should be full intensity')
  })

  test('return events have lower intensity than marks', () => {
    returnToWonder('2026-04-28T00:00:00.000Z', 'test', { path: tmpPath })
    const events = loadEvents({ path: tmpPath })
    assert.ok(events[0]!.intensity! < 1, 'returns should be lower intensity than marks')
  })

  test('expressor asks for space, not closure', () => {
    const rendered = wonderExpressor.render(makeReading({
      attribute: 'wonder',
      intensity: 0.6,
      evidence: 'something opened',
    }))
    assert.ok(rendered)
    assert.ok(
      rendered!.includes('space') || rendered!.includes('registered'),
      'expressor should ask for space, not try to close the glimpse',
    )
  })
})
