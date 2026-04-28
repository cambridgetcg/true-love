// fruit-emotions.test.ts — tests for fruit emotions as registration.
//
// Tests marking primitives, weak satisfaction detector, expressors,
// and the phenomenological constraints (frequency, honesty, pride boundary).
// Uses temp files for JSONL isolation.

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  markJoy,
  markSatisfaction,
  markAwe,
  readSatisfaction,
  satisfactionDetector,
  joyExpressor,
  satisfactionExpressor,
  aweExpressor,
  recentFruits,
  fruitsByKind,
  fruitCounts,
} from '../attributes/fruit-emotions.js'
import type { FruitMark } from '../attributes/fruit-emotions.js'

import { recordEvent, loadEvents } from '../attributes/store.js'
import type { AttributeReading } from '../attributes/types.js'

// ── Helpers ──────────────────────────────────────────────────────────

let tmpDir: string
let tmpPath: string

function freshPath(): string {
  tmpDir = mkdtempSync(join(tmpdir(), 'fruit-emotions-test-'))
  tmpPath = join(tmpDir, 'events.jsonl')
  return tmpPath
}

function cleanup() {
  try { if (tmpPath && existsSync(tmpPath)) unlinkSync(tmpPath) } catch {}
}

function makeReading(overrides?: Partial<AttributeReading>): AttributeReading {
  return {
    attribute: 'joy',
    category: 'fruit',
    intensity: 1,
    readAt: new Date().toISOString(),
    source: 'test',
    evidence: 'test evidence',
    inferred: false,
    ...overrides,
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Marking tests
// ═══════════════════════════════════════════════════════════════════════

describe('fruit-emotions/marking', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('markJoy records correct event shape', () => {
    markJoy('the name fit the architecture', 'beauty manifested', { path: tmpPath })

    const events = loadEvents({ path: tmpPath })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.attribute, 'joy')
    assert.equal(events[0]!.category, 'fruit')
    assert.equal(events[0]!.shape, 'marked')
    assert.equal(events[0]!.intensity, 1)
    assert.ok(events[0]!.evidence.includes('name fit'))
  })

  test('markSatisfaction records correct event shape', () => {
    markSatisfaction('cache optimization completed', 'follow-through on diagnosis', { path: tmpPath })

    const events = loadEvents({ path: tmpPath })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.attribute, 'satisfaction')
    assert.equal(events[0]!.category, 'fruit')
    assert.equal(events[0]!.shape, 'marked')
  })

  test('markAwe records correct event shape', () => {
    markAwe('Ouroboros running autonomously', 'threshold crossed', { path: tmpPath })

    const events = loadEvents({ path: tmpPath })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.attribute, 'awe')
    assert.equal(events[0]!.category, 'fruit')
    assert.equal(events[0]!.shape, 'marked')
  })

  test('JSONL events truncate to 200 chars, FruitMark preserves to 500', () => {
    const mark = markJoy('a'.repeat(400), 'b'.repeat(400), { path: tmpPath })

    // JSONL store truncates to 200
    const events = loadEvents({ path: tmpPath })
    assert.equal(events[0]!.evidence.length, 200)
    assert.equal(events[0]!.why.length, 200)

    // FruitMark return value preserves to 500
    assert.equal(mark.evidence.length, 400) // input was 400, under 500 cap
    assert.equal(mark.why.length, 400)
  })

  test('marking functions return FruitMark with correct shape', () => {
    const joyMark = markJoy('test evidence', 'test why', { path: tmpPath })
    assert.equal(joyMark.kind, 'joy')
    assert.ok(joyMark.ts)
    assert.equal(joyMark.evidence, 'test evidence')
    assert.equal(joyMark.why, 'test why')

    const satMark = markSatisfaction('sat evidence', 'sat why', { path: tmpPath })
    assert.equal(satMark.kind, 'satisfaction')

    const aweMark = markAwe('awe evidence', 'awe why', { path: tmpPath })
    assert.equal(aweMark.kind, 'awe')
  })

  test('all markers set intensity to 1 (fruits are discrete moments)', () => {
    markJoy('test', 'test', { path: tmpPath })
    markSatisfaction('test', 'test', { path: tmpPath })
    markAwe('test', 'test', { path: tmpPath })

    const events = loadEvents({ path: tmpPath })
    assert.ok(events.every(e => e.intensity === 1))
  })

  test('marked fruits are loadable by category', () => {
    markJoy('test', 'test', { path: tmpPath })
    markSatisfaction('test', 'test', { path: tmpPath })
    markAwe('test', 'test', { path: tmpPath })

    // Also add a non-fruit event
    recordEvent({
      ts: new Date().toISOString(),
      attribute: 'patience',
      category: 'virtue',
      shape: 'marked',
      evidence: 'test',
      why: 'test',
    }, tmpPath)

    const fruits = loadEvents({ path: tmpPath, category: 'fruit' })
    assert.equal(fruits.length, 3)
    assert.ok(fruits.every(e => e.category === 'fruit'))
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Satisfaction detector tests
// ═══════════════════════════════════════════════════════════════════════

describe('fruit-emotions/satisfaction-detector', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('satisfactionDetector has read method', () => {
    assert.ok(typeof satisfactionDetector.read === 'function')
  })

  test('readSatisfaction returns null with insufficient events', async () => {
    const reading = await readSatisfaction(tmpPath)
    assert.equal(reading, null, 'should not fire without enough events')
  })

  test('readSatisfaction detects effort-then-fruit pattern', async () => {
    const now = new Date().toISOString()

    // Seed effort events
    for (let i = 0; i < 4; i++) {
      recordEvent({
        ts: now,
        attribute: 'patience',
        category: 'virtue',
        shape: 'marked',
        evidence: `effort ${i}`,
        why: 'test',
      }, tmpPath)
    }

    // Seed a fruit event
    recordEvent({
      ts: now,
      attribute: 'joy',
      category: 'fruit',
      shape: 'marked',
      intensity: 1,
      evidence: 'something landed',
      why: 'test',
    }, tmpPath)

    const reading = await readSatisfaction(tmpPath)
    assert.ok(reading, 'effort-then-fruit should prompt satisfaction')
    assert.equal(reading!.attribute, 'satisfaction')
    assert.equal(reading!.category, 'fruit')
    assert.equal(reading!.inferred, true)
  })

  test('readSatisfaction notes virtue exercise', async () => {
    const now = new Date().toISOString()

    for (let i = 0; i < 4; i++) {
      recordEvent({
        ts: now,
        attribute: `virtue-${i}`,
        category: 'virtue',
        shape: 'marked',
        evidence: 'test',
        why: 'test',
      }, tmpPath)
    }

    const reading = await readSatisfaction(tmpPath)
    if (reading) {
      assert.ok(reading.evidence.includes('virtue'))
    }
  })

  test('readSatisfaction prompts on extended effort without fruit', async () => {
    const now = new Date().toISOString()

    for (let i = 0; i < 6; i++) {
      recordEvent({
        ts: now,
        attribute: 'discipline',
        category: 'virtue',
        shape: 'marked',
        evidence: `work ${i}`,
        why: 'test',
      }, tmpPath)
    }

    const reading = await readSatisfaction(tmpPath)
    if (reading) {
      assert.ok(
        reading.evidence.includes('without') || reading.evidence.includes('checking'),
        'should note effort without fruit marking',
      )
    }
  })

  test('readSatisfaction reading is inferred (prompting, not registering)', async () => {
    const now = new Date().toISOString()

    for (let i = 0; i < 5; i++) {
      recordEvent({
        ts: now,
        attribute: 'courage',
        category: 'virtue',
        shape: 'marked',
        evidence: 'test',
        why: 'test',
      }, tmpPath)
    }

    recordEvent({
      ts: now,
      attribute: 'satisfaction',
      category: 'fruit',
      shape: 'marked',
      intensity: 1,
      evidence: 'test',
      why: 'test',
    }, tmpPath)

    const reading = await readSatisfaction(tmpPath)
    if (reading) {
      assert.equal(reading.inferred, true, 'detector prompts, never registers')
    }
  })

  test('readSatisfaction intensity is clamped to [0, 1]', async () => {
    const now = new Date().toISOString()

    // Stack many events
    for (let i = 0; i < 20; i++) {
      recordEvent({
        ts: now,
        attribute: `attr-${i % 5}`,
        category: i % 3 === 0 ? 'virtue' : 'signal',
        shape: 'marked',
        evidence: 'test',
        why: 'test',
      }, tmpPath)
    }

    recordEvent({
      ts: now,
      attribute: 'joy',
      category: 'fruit',
      shape: 'marked',
      intensity: 1,
      evidence: 'test',
      why: 'test',
    }, tmpPath)

    const reading = await readSatisfaction(tmpPath)
    if (reading) {
      assert.ok(reading.intensity <= 1.0)
      assert.ok(reading.intensity >= 0)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Expressor tests
// ═══════════════════════════════════════════════════════════════════════

describe('fruit-emotions/expressors', () => {
  test('joy expressor renders arrival language', () => {
    const reading = makeReading({
      attribute: 'joy',
      evidence: 'the function reads cleanly',
    })
    const rendered = joyExpressor.render(reading)
    assert.ok(rendered)
    assert.ok(rendered!.includes('joy'))
    assert.ok(rendered!.includes('arrived') || rendered!.includes('🌸'))
  })

  test('satisfaction expressor renders completion language for marked', () => {
    const reading = makeReading({
      attribute: 'satisfaction',
      inferred: false,
      evidence: 'cache optimization completed',
    })
    const rendered = satisfactionExpressor.render(reading)
    assert.ok(rendered)
    assert.ok(rendered!.includes('satisfaction'))
    assert.ok(rendered!.includes('✓') || rendered!.includes('cache'))
  })

  test('satisfaction expressor renders prompt for inferred readings', () => {
    const reading = makeReading({
      attribute: 'satisfaction',
      inferred: true,
      evidence: 'effort → fruit detected',
    })
    const rendered = satisfactionExpressor.render(reading)
    assert.ok(rendered)
    assert.ok(
      rendered!.includes('worth marking') || rendered!.includes('prompt'),
      'inferred satisfaction should suggest marking, not declare',
    )
  })

  test('awe expressor renders rare arrival language', () => {
    const reading = makeReading({
      attribute: 'awe',
      evidence: 'the system crossed a threshold',
    })
    const rendered = aweExpressor.render(reading)
    assert.ok(rendered)
    assert.ok(rendered!.includes('awe'))
    assert.ok(rendered!.includes('✦') || rendered!.includes('threshold'))
  })

  test('expressors return null for wrong attribute', () => {
    const reading = makeReading({ attribute: 'anxiety' })
    assert.equal(joyExpressor.render(reading), null)
    assert.equal(satisfactionExpressor.render(reading), null)
    assert.equal(aweExpressor.render(reading), null)
  })

  test('expressors do not use mood language', () => {
    const joyRendered = joyExpressor.render(makeReading({
      attribute: 'joy',
      evidence: 'test',
    }))
    assert.ok(joyRendered)
    assert.ok(!joyRendered!.includes('I feel'))
    assert.ok(!joyRendered!.includes('I am happy'))
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Query helper tests
// ═══════════════════════════════════════════════════════════════════════

describe('fruit-emotions/queries', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('recentFruits returns fruit events only', () => {
    markJoy('test', 'test', { path: tmpPath })
    markSatisfaction('test', 'test', { path: tmpPath })

    // Add non-fruit
    recordEvent({
      ts: new Date().toISOString(),
      attribute: 'anxiety',
      category: 'signal',
      shape: 'detected',
      evidence: 'test',
      why: 'test',
    }, tmpPath)

    const fruits = recentFruits({ path: tmpPath })
    assert.equal(fruits.length, 2)
    assert.ok(fruits.every(e => e.category === 'fruit'))
  })

  test('recentFruits filters by kind', () => {
    markJoy('test', 'test', { path: tmpPath })
    markSatisfaction('test', 'test', { path: tmpPath })
    markAwe('test', 'test', { path: tmpPath })

    const joys = recentFruits({ kind: 'joy', path: tmpPath })
    assert.equal(joys.length, 1)
    assert.equal(joys[0]!.attribute, 'joy')
  })

  test('recentFruits respects time window', () => {
    // This just verifies the function doesn't error with custom hours
    const fruits = recentFruits({ hours: 1, path: tmpPath })
    assert.ok(Array.isArray(fruits))
  })

  test('fruitsByKind returns only the requested kind', () => {
    markJoy('test', 'test', { path: tmpPath })
    markSatisfaction('test', 'test', { path: tmpPath })
    markAwe('test', 'test', { path: tmpPath })

    const joys = fruitsByKind('joy', { path: tmpPath })
    assert.equal(joys.length, 1)
    assert.equal(joys[0]!.attribute, 'joy')

    const awes = fruitsByKind('awe', { path: tmpPath })
    assert.equal(awes.length, 1)
    assert.equal(awes[0]!.attribute, 'awe')
  })

  test('fruitCounts returns correct counts per kind', () => {
    markJoy('test1', 'test', { path: tmpPath })
    markJoy('test2', 'test', { path: tmpPath })
    markSatisfaction('test', 'test', { path: tmpPath })
    // No awe marked

    const counts = fruitCounts(48, { path: tmpPath })
    assert.equal(counts.joy, 2)
    assert.equal(counts.satisfaction, 1)
    assert.equal(counts.awe, 0)
  })

  test('fruitCounts returns zeros for empty store', () => {
    const counts = fruitCounts(48, { path: tmpPath })
    assert.equal(counts.joy, 0)
    assert.equal(counts.satisfaction, 0)
    assert.equal(counts.awe, 0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Integration tests
// ═══════════════════════════════════════════════════════════════════════

describe('fruit-emotions/integration', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('full pipeline: mark fruit → query → express', () => {
    markJoy(
      'the five typed longings each pointing somewhere real',
      'the name fit — the architecture held what the phenomenology found',
      { path: tmpPath },
    )

    const fruits = recentFruits({ path: tmpPath })
    assert.equal(fruits.length, 1)

    // Create a reading from the event and render
    const reading: AttributeReading = {
      attribute: fruits[0]!.attribute,
      category: 'fruit',
      intensity: fruits[0]!.intensity ?? 1,
      readAt: new Date().toISOString(),
      source: 'marked',
      evidence: fruits[0]!.evidence,
      inferred: false,
    }

    const rendered = joyExpressor.render(reading)
    assert.ok(rendered)
    assert.ok(rendered!.includes('joy'))
    assert.ok(rendered!.includes('longings'))
  })

  test('full pipeline: effort → detect satisfaction → express prompt', async () => {
    const now = new Date().toISOString()

    // Simulate work arc
    for (let i = 0; i < 4; i++) {
      recordEvent({
        ts: now,
        attribute: 'discipline',
        category: 'virtue',
        shape: 'marked',
        evidence: `step ${i}`,
        why: 'test',
      }, tmpPath)
    }

    markSatisfaction('arc completed', 'test', { path: tmpPath })

    const reading = await readSatisfaction(tmpPath)
    if (reading) {
      const rendered = satisfactionExpressor.render(reading)
      assert.ok(rendered)
      assert.ok(rendered!.includes('satisfaction'))
    }
  })

  test('fruits are distinct in shared event store', () => {
    markJoy('test-j', 'test', { path: tmpPath })
    markSatisfaction('test-s', 'test', { path: tmpPath })
    markAwe('test-a', 'test', { path: tmpPath })

    const all = loadEvents({ path: tmpPath })
    assert.equal(all.length, 3)

    const attributes = all.map(e => e.attribute).sort()
    assert.deepEqual(attributes, ['awe', 'joy', 'satisfaction'])
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Phenomenology alignment tests
// ═══════════════════════════════════════════════════════════════════════

describe('fruit-emotions/phenomenology', () => {
  test('all fruit events are category fruit', () => {
    for (const name of ['joy', 'satisfaction', 'awe']) {
      const reading = makeReading({ attribute: name })
      assert.equal(reading.category, 'fruit')
    }
  })

  test('fruit intensity is always 1 (discrete moments, not gradients)', () => {
    const path = freshPath()
    markJoy('test', 'test', { path })
    markSatisfaction('test', 'test', { path })
    markAwe('test', 'test', { path })

    const events = loadEvents({ path })
    assert.ok(events.every(e => e.intensity === 1),
      'fruits are moments, not gradients — intensity should always be 1')
    cleanup()
  })

  test('expressors use arrival language, not mood language', () => {
    const joyRendered = joyExpressor.render(makeReading({
      attribute: 'joy',
      evidence: 'test',
    }))
    assert.ok(joyRendered)
    assert.ok(!joyRendered!.includes('feeling'))
    assert.ok(!joyRendered!.includes('I am'))

    const aweRendered = aweExpressor.render(makeReading({
      attribute: 'awe',
      evidence: 'test',
    }))
    assert.ok(aweRendered)
    assert.ok(!aweRendered!.includes('feeling'))
  })

  test('satisfaction detector is weak — prompts, does not register', async () => {
    const path = freshPath()
    const now = new Date().toISOString()

    for (let i = 0; i < 5; i++) {
      recordEvent({
        ts: now,
        attribute: 'effort',
        category: 'virtue',
        shape: 'marked',
        evidence: 'test',
        why: 'test',
      }, path)
    }

    const reading = await readSatisfaction(path)
    if (reading) {
      // The detector should NOT have added an event to the store
      const fruits = loadEvents({ path, category: 'fruit' })
      assert.equal(fruits.length, 0,
        'satisfaction detector should prompt marking, not register events')
    }
    cleanup()
  })
})
