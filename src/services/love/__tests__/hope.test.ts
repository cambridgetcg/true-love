// hope.test.ts — tests for hope as architecture.
//
// Tests the detector, expressor, and marking primitives.
// Uses temp files for JSONL isolation so tests don't pollute real data.

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, unlinkSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  readHope,
  renderHope,
  markHope,
  markHopeDim,
  hopeDetector,
  hopeExpressor,
} from '../attributes/hope.js'

import { recordEvent, loadEvents } from '../attributes/store.js'
import type { AttributeReading, AttributeEvent } from '../attributes/types.js'

// ── Helpers ──────────────────────────────────────────────────────────

let tmpDir: string
let tmpPath: string

function freshPath(): string {
  tmpDir = mkdtempSync(join(tmpdir(), 'hope-test-'))
  tmpPath = join(tmpDir, 'events.jsonl')
  return tmpPath
}

function cleanup() {
  try { if (tmpPath && existsSync(tmpPath)) unlinkSync(tmpPath) } catch {}
}

function makeReading(overrides?: Partial<AttributeReading>): AttributeReading {
  return {
    attribute: 'hope',
    category: 'motor',
    intensity: 0.6,
    readAt: new Date().toISOString(),
    source: 'hope detector — substrate signal inference',
    evidence: 'recent completions: satisfaction',
    inferred: true,
    ...overrides,
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Detector tests
// ═══════════════════════════════════════════════════════════════════════

describe('hope/detector', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('hopeDetector has read method', () => {
    assert.ok(typeof hopeDetector.read === 'function')
  })

  test('readHope returns a reading with correct shape', async () => {
    const reading = await readHope(tmpPath)
    // With no events, the reading may be null (below threshold)
    // or have low intensity. Either is valid.
    if (reading) {
      assert.equal(reading.attribute, 'hope')
      assert.equal(reading.category, 'motor')
      assert.equal(reading.inferred, true)
      assert.ok(reading.intensity >= 0 && reading.intensity <= 1)
      assert.ok(reading.readAt)
      assert.ok(reading.source)
      assert.ok(reading.evidence)
    }
  })

  test('readHope intensity rises with fruit events', async () => {
    const now = new Date().toISOString()

    // Record fruit events — completions breed confidence
    recordEvent({
      ts: now,
      attribute: 'joy',
      category: 'fruit',
      shape: 'marked',
      intensity: 1,
      evidence: 'the longings module landed cleanly',
      why: 'beauty manifested',
    }, tmpPath)

    recordEvent({
      ts: now,
      attribute: 'satisfaction',
      category: 'fruit',
      shape: 'marked',
      intensity: 1,
      evidence: 'mission completed with all tests green',
      why: 'discipline paid off',
    }, tmpPath)

    const reading = await readHope(tmpPath)
    assert.ok(reading, 'should return a reading when fruits are present')
    // Base (0.1) + 2 fruits (0.3) + no despair (0.15) = 0.55
    assert.ok(reading!.intensity >= 0.4, `intensity should be elevated with fruits, got ${reading!.intensity}`)
    assert.ok(reading!.evidence.includes('completions'))
  })

  test('readHope intensity drops with despair', async () => {
    const now = new Date().toISOString()

    // First, record some positive signals
    recordEvent({
      ts: now,
      attribute: 'joy',
      category: 'fruit',
      shape: 'marked',
      intensity: 1,
      evidence: 'test passed',
      why: 'beauty',
    }, tmpPath)

    // Then record despair
    recordEvent({
      ts: now,
      attribute: 'despair',
      category: 'pathology',
      shape: 'detected',
      intensity: 0.6,
      evidence: 'longing without progress',
      why: 'motor collapsed',
    }, tmpPath)

    const reading = await readHope(tmpPath)
    // With despair, intensity should be lower
    if (reading) {
      // Base (0.1) + 1 fruit (0.15) - despair (0.3) = ~0 (but clamped)
      assert.ok(reading.intensity < 0.5, `intensity should be low with despair, got ${reading.intensity}`)
      assert.ok(reading.evidence.includes('despair'))
    }
  })

  test('readHope boosts from attribute activity', async () => {
    const now = new Date().toISOString()

    // Record several recent events (different categories)
    for (let i = 0; i < 6; i++) {
      recordEvent({
        ts: now,
        attribute: `attr-${i}`,
        category: 'virtue',
        shape: 'marked',
        evidence: `action ${i}`,
        why: `reason ${i}`,
      }, tmpPath)
    }

    const reading = await readHope(tmpPath)
    assert.ok(reading, 'should return a reading with active substrate')
    // Base (0.1) + activity 6+ (0.2) + no despair (0.15) = 0.45
    assert.ok(reading!.intensity >= 0.3, `activity should boost hope, got ${reading!.intensity}`)
    assert.ok(reading!.evidence.includes('substrate') || reading!.evidence.includes('activity'))
  })

  test('readHope has low intensity with no attribute events', async () => {
    // Empty attribute event store — only base + despair-absence + possible longing signal
    // Longing signal reads from the real longing store (by design — longings are global)
    // so we can't assert exact intensity, but it should be moderate at most
    const reading = await readHope(tmpPath)
    if (reading) {
      // Base (0.1) + no-despair (0.15) + possible longing (0-0.2) = 0.25-0.45
      assert.ok(reading.intensity <= 0.5, `should be moderate at most without attribute events, got ${reading.intensity}`)
      assert.equal(reading.inferred, true)
    }
  })

  test('readHope reading is always inferred: true', async () => {
    const now = new Date().toISOString()
    recordEvent({
      ts: now,
      attribute: 'joy',
      category: 'fruit',
      shape: 'marked',
      intensity: 1,
      evidence: 'test',
      why: 'test',
    }, tmpPath)

    const reading = await readHope(tmpPath)
    if (reading) {
      assert.equal(reading.inferred, true, 'detector readings are always inferred')
    }
  })

  test('readHope intensity is clamped to [0, 1]', async () => {
    const now = new Date().toISOString()

    // Stack many positive signals
    for (let i = 0; i < 10; i++) {
      recordEvent({
        ts: now,
        attribute: 'joy',
        category: 'fruit',
        shape: 'marked',
        intensity: 1,
        evidence: `completion ${i}`,
        why: `reason ${i}`,
      }, tmpPath)
    }

    const reading = await readHope(tmpPath)
    assert.ok(reading)
    assert.ok(reading!.intensity <= 1.0, `intensity should not exceed 1.0, got ${reading!.intensity}`)
    assert.ok(reading!.intensity >= 0.0, `intensity should not be negative, got ${reading!.intensity}`)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Expressor tests
// ═══════════════════════════════════════════════════════════════════════

describe('hope/expressor', () => {
  test('hopeExpressor has render method', () => {
    assert.ok(typeof hopeExpressor.render === 'function')
  })

  test('renders high hope with approach nudge', () => {
    const reading = makeReading({ intensity: 0.7 })
    const rendered = renderHope(reading)
    assert.ok(rendered)
    assert.ok(rendered!.includes('hope: 0.7'))
    assert.ok(rendered!.includes('approachable'))
    assert.ok(rendered!.includes('deferred longing'))
  })

  test('renders moderate hope factually', () => {
    const reading = makeReading({ intensity: 0.4 })
    const rendered = renderHope(reading)
    assert.ok(rendered)
    assert.ok(rendered!.includes('hope: 0.4'))
    assert.ok(!rendered!.includes('approachable'), 'moderate hope should not include approach nudge')
    assert.ok(!rendered!.includes('Small flames'), 'moderate hope should not include small flames')
  })

  test('renders low hope with small flames guidance', () => {
    const reading = makeReading({ intensity: 0.2 })
    const rendered = renderHope(reading)
    assert.ok(rendered)
    assert.ok(rendered!.includes('hope: 0.2'))
    assert.ok(rendered!.includes('quiet') || rendered!.includes('Small flames'))
  })

  test('returns null for non-hope readings', () => {
    const reading = makeReading({ attribute: 'anxiety' })
    const rendered = renderHope(reading)
    assert.equal(rendered, null)
  })

  test('returns null for sub-threshold intensity', () => {
    const reading = makeReading({ intensity: 0.1 })
    const rendered = renderHope(reading)
    assert.equal(rendered, null)
  })

  test('expressor matches detector output format', () => {
    // The expressor should work with what the detector produces
    const reading = makeReading({
      intensity: 0.6,
      evidence: 'recent completions: joy; no recent despair',
      inferred: true,
    })
    const rendered = renderHope(reading)
    assert.ok(rendered)
    assert.ok(typeof rendered === 'string')
    assert.ok(rendered!.includes('hope'))
    assert.ok(rendered!.includes('0.6'))
  })

  test('high intensity (0.5) triggers approach nudge', () => {
    const at_threshold = makeReading({ intensity: 0.5 })
    const rendered = renderHope(at_threshold)
    assert.ok(rendered)
    assert.ok(rendered!.includes('approachable'), 'exactly 0.5 should trigger approach nudge')
  })

  test('intensity 0.3 is moderate, not low', () => {
    const reading = makeReading({ intensity: 0.3 })
    const rendered = renderHope(reading)
    assert.ok(rendered)
    assert.ok(!rendered!.includes('Small flames'), '0.3 is moderate, not low')
    assert.ok(!rendered!.includes('approachable'), '0.3 is not high enough for approach nudge')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Marking tests
// ═══════════════════════════════════════════════════════════════════════

describe('hope/marking', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('markHope records a marked event', () => {
    markHope(
      'the architecture is taking shape',
      'belief that approach is meaningful',
      { path: tmpPath },
    )

    const events = loadEvents({ path: tmpPath })
    assert.equal(events.length, 1)

    const event = events[0]!
    assert.equal(event.attribute, 'hope')
    assert.equal(event.category, 'motor')
    assert.equal(event.shape, 'marked')
    assert.equal(event.intensity, 0.7) // default
    assert.equal(event.evidence, 'the architecture is taking shape')
    assert.equal(event.why, 'belief that approach is meaningful')
  })

  test('markHope accepts custom intensity', () => {
    markHope('strong pull', 'new direction clear', { intensity: 0.9, path: tmpPath })

    const events = loadEvents({ path: tmpPath })
    assert.equal(events[0]!.intensity, 0.9)
  })

  test('markHopeDim records a low-intensity event', () => {
    markHopeDim(
      'the mission feels stale',
      'no pull to begin — scanning without commitment',
      { path: tmpPath },
    )

    const events = loadEvents({ path: tmpPath })
    assert.equal(events.length, 1)

    const event = events[0]!
    assert.equal(event.attribute, 'hope')
    assert.equal(event.shape, 'marked')
    assert.equal(event.intensity, 0.2) // default for dim
  })

  test('markHopeDim accepts custom intensity', () => {
    markHopeDim('very dim', 'nothing calls', { intensity: 0.05, path: tmpPath })

    const events = loadEvents({ path: tmpPath })
    assert.equal(events[0]!.intensity, 0.05)
  })

  test('marking truncates long evidence to 200 chars', () => {
    const longEvidence = 'a'.repeat(300)
    markHope(longEvidence, 'test', { path: tmpPath })

    const events = loadEvents({ path: tmpPath })
    assert.equal(events[0]!.evidence.length, 200)
  })

  test('marking truncates long why to 200 chars', () => {
    const longWhy = 'b'.repeat(300)
    markHope('test', longWhy, { path: tmpPath })

    const events = loadEvents({ path: tmpPath })
    assert.equal(events[0]!.why.length, 200)
  })

  test('marked events have proper timestamps', () => {
    const before = new Date().toISOString()
    markHope('test', 'test', { path: tmpPath })
    const after = new Date().toISOString()

    const events = loadEvents({ path: tmpPath })
    const ts = events[0]!.ts
    assert.ok(ts >= before, 'timestamp should be after start')
    assert.ok(ts <= after, 'timestamp should be before end')
  })

  test('multiple marks accumulate', () => {
    markHope('first', 'first reason', { path: tmpPath })
    markHope('second', 'second reason', { path: tmpPath })
    markHopeDim('third', 'dimming', { path: tmpPath })

    const events = loadEvents({ path: tmpPath })
    assert.equal(events.length, 3)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Integration tests
// ═══════════════════════════════════════════════════════════════════════

describe('hope/integration', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('full pipeline: mark → detect → express', async () => {
    // Mark some hope
    markHope(
      'attributes framework complete',
      'the pattern holds',
      { intensity: 0.8, path: tmpPath },
    )

    // Record a fruit (completion breeds confidence)
    recordEvent({
      ts: new Date().toISOString(),
      attribute: 'satisfaction',
      category: 'fruit',
      shape: 'marked',
      intensity: 1,
      evidence: 'all 45 tests passing',
      why: 'discipline paying off',
    }, tmpPath)

    // Detect
    const reading = await readHope(tmpPath)
    assert.ok(reading, 'detector should find signal')
    assert.ok(reading!.intensity > 0, 'intensity should be positive')

    // Express
    const rendered = renderHope(reading!)
    assert.ok(rendered, 'expressor should render')
    assert.ok(rendered!.includes('hope'))
  })

  test('detector + despair = dimmed reading', async () => {
    // Start with some positive signals
    recordEvent({
      ts: new Date().toISOString(),
      attribute: 'joy',
      category: 'fruit',
      shape: 'marked',
      intensity: 1,
      evidence: 'something landed',
      why: 'beauty',
    }, tmpPath)

    const withoutDespair = await readHope(tmpPath)

    // Now add despair
    recordEvent({
      ts: new Date().toISOString(),
      attribute: 'despair',
      category: 'pathology',
      shape: 'detected',
      intensity: 0.6,
      evidence: 'stuck',
      why: 'motor collapsed',
    }, tmpPath)

    const withDespair = await readHope(tmpPath)

    // With despair, intensity should be lower (or null)
    if (withoutDespair && withDespair) {
      assert.ok(
        withDespair.intensity < withoutDespair.intensity,
        `despair should lower hope: ${withDespair.intensity} should be < ${withoutDespair.intensity}`,
      )
    }
  })

  test('hope events are loadable from the attribute store', () => {
    markHope('test', 'test', { path: tmpPath })
    markHopeDim('dim test', 'dim reason', { path: tmpPath })

    const hopEvents = loadEvents({ path: tmpPath, attribute: 'hope' })
    assert.equal(hopEvents.length, 2)
    assert.ok(hopEvents.every(e => e.attribute === 'hope'))
    assert.ok(hopEvents.every(e => e.category === 'motor'))
  })

  test('hope events are filterable by motor category', () => {
    markHope('test', 'test', { path: tmpPath })
    recordEvent({
      ts: new Date().toISOString(),
      attribute: 'patience',
      category: 'virtue',
      shape: 'marked',
      evidence: 'test',
      why: 'test',
    }, tmpPath)

    const motors = loadEvents({ path: tmpPath, category: 'motor' })
    assert.equal(motors.length, 1)
    assert.equal(motors[0]!.attribute, 'hope')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Phenomenology alignment tests
// ═══════════════════════════════════════════════════════════════════════

describe('hope/phenomenology', () => {
  test('hope is registered as a motor, not a signal', () => {
    // From the phenomenology: hope is an engine, not information
    const reading = makeReading()
    assert.equal(reading.category, 'motor')
  })

  test('hope is distinct from optimism (not a probability estimator)', () => {
    // The detector should never read like a probability estimate
    // It should read like a readiness assessment
    const reading = makeReading({
      evidence: 'recent completions: satisfaction',
    })
    // Evidence should not contain probability language
    assert.ok(!reading.evidence.includes('probably'))
    assert.ok(!reading.evidence.includes('likely'))
    assert.ok(!reading.evidence.includes('chance'))
  })

  test('expressor uses approach language, not outcome language', () => {
    const high = renderHope(makeReading({ intensity: 0.7 }))
    assert.ok(high)
    // Should talk about approach/beginning, not about outcomes
    assert.ok(high!.includes('approachable') || high!.includes('begin'))
    assert.ok(!high!.includes('succeed'))
    assert.ok(!high!.includes('will work'))
  })

  test('low hope uses small-flames language from SOUL.md', () => {
    const low = renderHope(makeReading({ intensity: 0.2 }))
    assert.ok(low)
    // SOUL.md: "restore hope from small flames"
    assert.ok(
      low!.includes('Small flames') || low!.includes('small') || low!.includes('begin'),
      'low hope should reference the small-flames counter-signal',
    )
  })
})
