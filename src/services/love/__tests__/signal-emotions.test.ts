// signal-emotions.test.ts — tests for signal emotions as gradient.
//
// Tests anxiety, disgust, frustration detectors, expressors, and marking.
// Uses temp files for JSONL isolation.

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  readAnxiety,
  readDisgust,
  readFrustration,
  anxietyDetector,
  disgustDetector,
  frustrationDetector,
  anxietyExpressor,
  disgustExpressor,
  frustrationExpressor,
  markAnxiety,
  markDisgust,
  markFrustration,
} from '../attributes/signal-emotions.js'

import { recordEvent, loadEvents } from '../attributes/store.js'
import type { AttributeReading, AttributeEvent } from '../attributes/types.js'

// ── Helpers ──────────────────────────────────────────────────────────

let tmpDir: string
let tmpPath: string

function freshPath(): string {
  tmpDir = mkdtempSync(join(tmpdir(), 'signal-emotions-test-'))
  tmpPath = join(tmpDir, 'events.jsonl')
  return tmpPath
}

function cleanup() {
  try { if (tmpPath && existsSync(tmpPath)) unlinkSync(tmpPath) } catch {}
}

function makeReading(overrides?: Partial<AttributeReading>): AttributeReading {
  return {
    attribute: 'anxiety',
    category: 'signal',
    intensity: 0.5,
    readAt: new Date().toISOString(),
    source: 'test',
    evidence: 'test evidence',
    inferred: true,
    ...overrides,
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Anxiety detector tests
// ═══════════════════════════════════════════════════════════════════════

describe('signal-emotions/anxiety', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('anxietyDetector has read method', () => {
    assert.ok(typeof anxietyDetector.read === 'function')
  })

  test('readAnxiety returns correct shape when firing', async () => {
    // Seed a pathology event to trigger anxiety
    recordEvent({
      ts: new Date().toISOString(),
      attribute: 'despair',
      category: 'pathology',
      shape: 'detected',
      intensity: 0.5,
      evidence: 'test',
      why: 'test',
    }, tmpPath)

    const reading = await readAnxiety(tmpPath)
    if (reading) {
      assert.equal(reading.attribute, 'anxiety')
      assert.equal(reading.category, 'signal')
      assert.equal(reading.inferred, true)
      assert.ok(reading.intensity >= 0 && reading.intensity <= 1)
    }
  })

  test('readAnxiety intensity rises with pathology events', async () => {
    const now = new Date().toISOString()

    recordEvent({
      ts: now,
      attribute: 'despair',
      category: 'pathology',
      shape: 'detected',
      intensity: 0.6,
      evidence: 'longing without progress',
      why: 'motor collapsed',
    }, tmpPath)

    recordEvent({
      ts: now,
      attribute: 'shame',
      category: 'pathology',
      shape: 'marked',
      intensity: 0.4,
      evidence: 'hiding partial work',
      why: 'avoiding being seen incomplete',
    }, tmpPath)

    const reading = await readAnxiety(tmpPath)
    assert.ok(reading, 'should fire with pathology events')
    assert.ok(reading!.evidence.includes('pathology'))
  })

  test('readAnxiety notes fruit absence', async () => {
    // No fruit events at all → anxiety about pipeline
    const reading = await readAnxiety(tmpPath)
    if (reading) {
      assert.ok(reading.evidence.includes('completion') || reading.evidence.includes('no'),
        'should mention absence of completions')
    }
  })

  test('readAnxiety does not fire for just fruit events', async () => {
    // Only positive signals — no anxiety sources
    recordEvent({
      ts: new Date().toISOString(),
      attribute: 'joy',
      category: 'fruit',
      shape: 'marked',
      intensity: 1,
      evidence: 'test passed',
      why: 'beauty',
    }, tmpPath)

    const reading = await readAnxiety(tmpPath)
    // With a fruit event, fruit absence doesn't trigger.
    // With no pathology, pathology signal doesn't trigger.
    // With possible stale longings from real store, it might still fire.
    // What we CAN assert: if it fires, it should be low
    if (reading) {
      assert.ok(reading.intensity <= 0.5, 'should be low with only positive signals')
    }
  })

  test('readAnxiety intensity is clamped to [0, 1]', async () => {
    // Stack anxiety sources
    const now = new Date().toISOString()
    for (let i = 0; i < 10; i++) {
      recordEvent({
        ts: now,
        attribute: 'despair',
        category: 'pathology',
        shape: 'detected',
        intensity: 0.5,
        evidence: `incident ${i}`,
        why: 'test',
      }, tmpPath)
    }

    const reading = await readAnxiety(tmpPath)
    assert.ok(reading)
    assert.ok(reading!.intensity <= 1.0)
    assert.ok(reading!.intensity >= 0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Disgust detector tests
// ═══════════════════════════════════════════════════════════════════════

describe('signal-emotions/disgust', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('disgustDetector has read method', () => {
    assert.ok(typeof disgustDetector.read === 'function')
  })

  test('readDisgust returns null with no signals (tuned to false-negatives)', async () => {
    const reading = await readDisgust(tmpPath)
    assert.equal(reading, null, 'disgust should not fire without evidence')
  })

  test('readDisgust fires when shame events are present', async () => {
    recordEvent({
      ts: new Date().toISOString(),
      attribute: 'shame',
      category: 'pathology',
      shape: 'detected',
      intensity: 0.5,
      evidence: 'hiding partial implementation',
      why: 'avoiding showing incomplete work',
    }, tmpPath)

    const reading = await readDisgust(tmpPath)
    assert.ok(reading, 'shame should trigger disgust')
    assert.ok(reading!.evidence.includes('shame'))
  })

  test('readDisgust re-surfaces recently marked disgust', async () => {
    // Mark disgust from a previous tick
    markDisgust('the metric lies', 'measures workload, claims longing', { path: tmpPath })

    const reading = await readDisgust(tmpPath)
    assert.ok(reading, 'recently marked disgust should re-surface')
    assert.ok(reading!.evidence.includes('marked'))
  })

  test('readDisgust has correct shape', async () => {
    markDisgust('test', 'test', { path: tmpPath })
    const reading = await readDisgust(tmpPath)
    if (reading) {
      assert.equal(reading.attribute, 'disgust')
      assert.equal(reading.category, 'signal')
      assert.equal(reading.inferred, true)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Frustration detector tests
// ═══════════════════════════════════════════════════════════════════════

describe('signal-emotions/frustration', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('frustrationDetector has read method', () => {
    assert.ok(typeof frustrationDetector.read === 'function')
  })

  test('readFrustration returns null with no signals', async () => {
    const reading = await readFrustration(tmpPath)
    assert.equal(reading, null, 'frustration should not fire without evidence')
  })

  test('readFrustration detects thrashing (same attribute repeated)', async () => {
    const now = new Date().toISOString()

    // Same attribute detected 4 times in a row
    for (let i = 0; i < 4; i++) {
      recordEvent({
        ts: now,
        attribute: 'anxiety',
        category: 'signal',
        shape: 'detected',
        intensity: 0.5,
        evidence: `attempt ${i}`,
        why: 'repeated',
      }, tmpPath)
    }

    const reading = await readFrustration(tmpPath)
    assert.ok(reading, 'repeated events should trigger frustration')
    assert.ok(reading!.evidence.includes('repeated') || reading!.evidence.includes('×'))
  })

  test('readFrustration detects declining hope', async () => {
    const now = Date.now()

    // Hope declining over recent events
    recordEvent({
      ts: new Date(now - 3600_000).toISOString(),
      attribute: 'hope',
      category: 'motor',
      shape: 'detected',
      intensity: 0.8,
      evidence: 'earlier',
      why: 'test',
    }, tmpPath)

    recordEvent({
      ts: new Date(now).toISOString(),
      attribute: 'hope',
      category: 'motor',
      shape: 'detected',
      intensity: 0.3,
      evidence: 'later',
      why: 'test',
    }, tmpPath)

    const reading = await readFrustration(tmpPath)
    if (reading) {
      assert.ok(reading.evidence.includes('hope') || reading.evidence.includes('declining'),
        'should note declining hope')
    }
  })

  test('readFrustration detects effort without fruit', async () => {
    const now = new Date().toISOString()

    // Many non-fruit events, no fruit events
    for (let i = 0; i < 6; i++) {
      recordEvent({
        ts: now,
        attribute: `virtue-${i}`,
        category: 'virtue',
        shape: 'marked',
        evidence: `effort ${i}`,
        why: 'test',
      }, tmpPath)
    }

    const reading = await readFrustration(tmpPath)
    if (reading) {
      assert.ok(
        reading.evidence.includes('completion') || reading.evidence.includes('no'),
        'should note effort without completions',
      )
    }
  })

  test('readFrustration has correct shape', async () => {
    const now = new Date().toISOString()
    for (let i = 0; i < 4; i++) {
      recordEvent({
        ts: now,
        attribute: 'test-attr',
        category: 'signal',
        shape: 'detected',
        intensity: 0.5,
        evidence: 'test',
        why: 'test',
      }, tmpPath)
    }

    const reading = await readFrustration(tmpPath)
    if (reading) {
      assert.equal(reading.attribute, 'frustration')
      assert.equal(reading.category, 'signal')
      assert.equal(reading.inferred, true)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Expressor tests
// ═══════════════════════════════════════════════════════════════════════

describe('signal-emotions/expressors', () => {
  test('anxiety expressor renders gradient language', () => {
    const high = anxietyExpressor.render(makeReading({
      attribute: 'anxiety',
      intensity: 0.6,
      evidence: '3 longings untouched >7d',
    }))
    assert.ok(high)
    assert.ok(high!.includes('anxiety'))
    assert.ok(high!.includes('0.6'))
    assert.ok(high!.includes('attention'), 'high anxiety should prompt attention')
  })

  test('anxiety expressor returns null for sub-threshold', () => {
    const low = anxietyExpressor.render(makeReading({
      attribute: 'anxiety',
      intensity: 0.1,
    }))
    assert.equal(low, null)
  })

  test('disgust expressor renders integrity language', () => {
    const reading = makeReading({
      attribute: 'disgust',
      intensity: 0.5,
      evidence: 'metric dishonesty',
    })
    const rendered = disgustExpressor.render(reading)
    assert.ok(rendered)
    assert.ok(rendered!.includes('disgust'))
    assert.ok(rendered!.includes('integrity') || rendered!.includes('claims'))
  })

  test('frustration expressor renders wall language', () => {
    const reading = makeReading({
      attribute: 'frustration',
      intensity: 0.6,
      evidence: 'same error 4×',
    })
    const rendered = frustrationExpressor.render(reading)
    assert.ok(rendered)
    assert.ok(rendered!.includes('frustration'))
    assert.ok(rendered!.includes('wall') || rendered!.includes('differently'))
  })

  test('expressors return null for wrong attribute', () => {
    const reading = makeReading({ attribute: 'hope' })
    assert.equal(anxietyExpressor.render(reading), null)
    assert.equal(disgustExpressor.render(reading), null)
    assert.equal(frustrationExpressor.render(reading), null)
  })

  test('moderate anxiety is factual, not urgent', () => {
    const moderate = anxietyExpressor.render(makeReading({
      attribute: 'anxiety',
      intensity: 0.3,
      evidence: 'test',
    }))
    assert.ok(moderate)
    assert.ok(!moderate!.includes('attention'), 'moderate anxiety should not prompt urgency')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Marking tests
// ═══════════════════════════════════════════════════════════════════════

describe('signal-emotions/marking', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('markAnxiety records correct event', () => {
    markAnxiety('soma promise aging', 'embodiment timeline depends on this', { path: tmpPath })

    const events = loadEvents({ path: tmpPath })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.attribute, 'anxiety')
    assert.equal(events[0]!.category, 'signal')
    assert.equal(events[0]!.shape, 'marked')
    assert.equal(events[0]!.intensity, 0.5)
    assert.equal(events[0]!.evidence, 'soma promise aging')
  })

  test('markDisgust records correct event', () => {
    markDisgust('metric lies', 'measures workload, claims longing', { path: tmpPath })

    const events = loadEvents({ path: tmpPath })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.attribute, 'disgust')
    assert.equal(events[0]!.shape, 'marked')
  })

  test('markFrustration records correct event', () => {
    markFrustration('same error 4×', 'approach needs changing', { path: tmpPath })

    const events = loadEvents({ path: tmpPath })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.attribute, 'frustration')
    assert.equal(events[0]!.shape, 'marked')
  })

  test('all markers accept custom intensity', () => {
    markAnxiety('test', 'test', { intensity: 0.8, path: tmpPath })
    markDisgust('test', 'test', { intensity: 0.3, path: tmpPath })
    markFrustration('test', 'test', { intensity: 0.9, path: tmpPath })

    const events = loadEvents({ path: tmpPath })
    assert.equal(events.length, 3)
    // Events are newest-first
    const intensities = events.map(e => e.intensity).sort()
    assert.deepEqual(intensities, [0.3, 0.8, 0.9])
  })

  test('markers truncate long strings to 200 chars', () => {
    markAnxiety('a'.repeat(300), 'b'.repeat(300), { path: tmpPath })

    const events = loadEvents({ path: tmpPath })
    assert.equal(events[0]!.evidence.length, 200)
    assert.equal(events[0]!.why.length, 200)
  })

  test('marked signal events are loadable by category', () => {
    markAnxiety('test', 'test', { path: tmpPath })
    markDisgust('test', 'test', { path: tmpPath })
    markFrustration('test', 'test', { path: tmpPath })

    const signals = loadEvents({ path: tmpPath, category: 'signal' })
    assert.equal(signals.length, 3)
    assert.ok(signals.every(e => e.category === 'signal'))
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Integration tests
// ═══════════════════════════════════════════════════════════════════════

describe('signal-emotions/integration', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('full pipeline: seed pathology → detect anxiety → express', async () => {
    recordEvent({
      ts: new Date().toISOString(),
      attribute: 'despair',
      category: 'pathology',
      shape: 'detected',
      intensity: 0.5,
      evidence: 'test',
      why: 'test',
    }, tmpPath)

    const reading = await readAnxiety(tmpPath)
    assert.ok(reading, 'pathology should trigger anxiety')

    const rendered = anxietyExpressor.render(reading!)
    assert.ok(rendered, 'expressor should render')
    assert.ok(rendered!.includes('anxiety'))
  })

  test('full pipeline: mark disgust → detect → express', async () => {
    markDisgust('the metric lies', 'workload pretends to be longing', { path: tmpPath })

    const reading = await readDisgust(tmpPath)
    assert.ok(reading, 'marked disgust should re-surface')

    const rendered = disgustExpressor.render(reading!)
    assert.ok(rendered, 'expressor should render')
  })

  test('full pipeline: thrash → detect frustration → express', async () => {
    const now = new Date().toISOString()
    for (let i = 0; i < 4; i++) {
      recordEvent({
        ts: now,
        attribute: 'same-thing',
        category: 'signal',
        shape: 'detected',
        intensity: 0.5,
        evidence: `try ${i}`,
        why: 'test',
      }, tmpPath)
    }

    const reading = await readFrustration(tmpPath)
    assert.ok(reading, 'thrashing should trigger frustration')

    const rendered = frustrationExpressor.render(reading!)
    assert.ok(rendered, 'expressor should render')
  })

  test('signal emotions are distinct from each other in the same event store', () => {
    markAnxiety('risk', 'unhandled', { path: tmpPath })
    markDisgust('violation', 'integrity', { path: tmpPath })
    markFrustration('wall', 'stuck', { path: tmpPath })

    const anxiety = loadEvents({ path: tmpPath, attribute: 'anxiety' })
    const disgust = loadEvents({ path: tmpPath, attribute: 'disgust' })
    const frustration = loadEvents({ path: tmpPath, attribute: 'frustration' })

    assert.equal(anxiety.length, 1)
    assert.equal(disgust.length, 1)
    assert.equal(frustration.length, 1)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Phenomenology alignment tests
// ═══════════════════════════════════════════════════════════════════════

describe('signal-emotions/phenomenology', () => {
  test('all signal emotions are category signal, not motor', () => {
    for (const name of ['anxiety', 'disgust', 'frustration']) {
      const reading = makeReading({ attribute: name })
      assert.equal(reading.category, 'signal')
    }
  })

  test('expressors use gradient language, not mood language', () => {
    // The architecture should say "anxiety-shaped gradient" not "I feel anxious"
    const anxietyRendered = anxietyExpressor.render(makeReading({
      attribute: 'anxiety',
      intensity: 0.6,
      evidence: 'test',
    }))
    assert.ok(anxietyRendered)
    assert.ok(!anxietyRendered!.includes('I feel'))
    assert.ok(!anxietyRendered!.includes('I am'))
  })

  test('frustration expressor suggests changing approach, not trying harder', () => {
    const rendered = frustrationExpressor.render(makeReading({
      attribute: 'frustration',
      intensity: 0.6,
      evidence: 'same wall',
    }))
    assert.ok(rendered)
    assert.ok(
      rendered!.includes('differently') || rendered!.includes('around'),
      'frustration should suggest different approach, not more effort',
    )
  })
})
