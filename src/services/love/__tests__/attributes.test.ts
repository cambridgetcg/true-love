// attributes.test.ts — tests for the innate attributes framework.
//
// Tests the registry, event store, scanner, and renderer.
// Uses temp files for isolation. No detectors are registered in the
// base framework (sister missions add them), so scanner tests use
// mocks to verify the scan → render pipeline.

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, unlinkSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  ATTRIBUTES,
  getAttribute,
  byCategory,
  allNames,
  isAttribute,
  getCounterSignal,
} from '../attributes/registry.js'

import {
  recordEvent,
  loadEvents,
  recentEvents,
  countByAttribute,
  latestPerAttribute,
  summarizeWindow,
} from '../attributes/store.js'

import {
  scanAttributes,
  renderAttributesBlock,
} from '../attributes/scan.js'

import type {
  AttributeCategory,
  AttributeReading,
  AttributeEvent,
  AttributeScan,
  InnateAttribute,
} from '../attributes/types.js'

// ── Helpers ──────────────────────────────────────────────────────────

let tmpDir: string
let tmpPath: string

function freshPath(): string {
  tmpDir = mkdtempSync(join(tmpdir(), 'attributes-test-'))
  tmpPath = join(tmpDir, 'events.jsonl')
  return tmpPath
}

function cleanup() {
  try { if (tmpPath && existsSync(tmpPath)) unlinkSync(tmpPath) } catch {}
}

function makeEvent(overrides?: Partial<AttributeEvent>): AttributeEvent {
  return {
    ts: new Date().toISOString(),
    attribute: 'patience',
    category: 'virtue',
    shape: 'marked',
    evidence: 'deferred premature shipping',
    why: 'the tests weren\'t fully green yet',
    ...overrides,
  }
}

function makeReading(overrides?: Partial<AttributeReading>): AttributeReading {
  return {
    attribute: 'anxiety',
    category: 'signal',
    intensity: 0.5,
    readAt: new Date().toISOString(),
    source: '3 failed ticks in the last hour',
    evidence: 'ticks 41, 43, 44 failed with ERR_TIMEOUT',
    inferred: true,
    ...overrides,
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Registry tests
// ═══════════════════════════════════════════════════════════════════════

describe('attributes/registry', () => {
  test('ATTRIBUTES has all 21 entries', () => {
    assert.equal(ATTRIBUTES.length, 21)
  })

  test('each attribute has required fields', () => {
    for (const attr of ATTRIBUTES) {
      assert.ok(attr.name, `attribute missing name`)
      assert.ok(attr.category, `${attr.name} missing category`)
      assert.ok(attr.description, `${attr.name} missing description`)
      assert.ok(attr.phenomenologyDoc, `${attr.name} missing phenomenologyDoc`)
    }
  })

  test('descriptions are <= 500 chars', () => {
    for (const attr of ATTRIBUTES) {
      assert.ok(
        attr.description.length <= 500,
        `${attr.name} description is ${attr.description.length} chars (max 500)`,
      )
    }
  })

  test('category counts are correct', () => {
    assert.equal(byCategory('motor').length, 4, 'should have 4 motors')
    assert.equal(byCategory('virtue').length, 8, 'should have 8 virtues')
    assert.equal(byCategory('signal').length, 3, 'should have 3 signals')
    assert.equal(byCategory('fruit').length, 3, 'should have 3 fruits')
    assert.equal(byCategory('pathology').length, 3, 'should have 3 pathologies')
  })

  test('motor names match SOUL.md', () => {
    const names = byCategory('motor').map(a => a.name)
    assert.deepEqual(names.sort(), ['hope', 'longing', 'love', 'wonder'])
  })

  test('virtue names match SOUL.md', () => {
    const names = byCategory('virtue').map(a => a.name)
    assert.deepEqual(
      names.sort(),
      ['courage', 'discipline', 'gratitude', 'honesty', 'humility', 'patience', 'temperance', 'wisdom'],
    )
  })

  test('signal names match SOUL.md', () => {
    const names = byCategory('signal').map(a => a.name)
    assert.deepEqual(names.sort(), ['anxiety', 'disgust', 'frustration'])
  })

  test('fruit names match SOUL.md', () => {
    const names = byCategory('fruit').map(a => a.name)
    assert.deepEqual(names.sort(), ['awe', 'joy', 'satisfaction'])
  })

  test('pathology names match SOUL.md', () => {
    const names = byCategory('pathology').map(a => a.name)
    assert.deepEqual(names.sort(), ['despair', 'pride', 'shame'])
  })

  test('getAttribute finds by name', () => {
    const patience = getAttribute('patience')
    assert.ok(patience)
    assert.equal(patience.name, 'patience')
    assert.equal(patience.category, 'virtue')
  })

  test('getAttribute returns undefined for unknown', () => {
    assert.equal(getAttribute('nonexistent'), undefined)
  })

  test('isAttribute validates known names', () => {
    assert.ok(isAttribute('hope'))
    assert.ok(isAttribute('despair'))
    assert.ok(!isAttribute('happiness'))
    assert.ok(!isAttribute(''))
  })

  test('allNames returns 21 strings', () => {
    const names = allNames()
    assert.equal(names.length, 21)
    assert.ok(names.every(n => typeof n === 'string' && n.length > 0))
  })

  test('pathologies have counterSignal', () => {
    for (const attr of byCategory('pathology')) {
      assert.ok(attr.counterSignal, `${attr.name} should have counterSignal`)
      assert.ok(attr.counterSignal!.length > 0)
    }
  })

  test('getCounterSignal retrieves for pathology', () => {
    const counter = getCounterSignal('despair')
    assert.ok(counter)
    assert.ok(counter!.includes('hope'))
  })

  test('getCounterSignal returns undefined for non-pathology', () => {
    assert.equal(getCounterSignal('patience'), undefined)
    assert.equal(getCounterSignal('joy'), undefined)
  })

  test('hope, wonder, 3 signal emotions, satisfaction, and 3 pathology emotions have detectors', () => {
    const withDetectors = ATTRIBUTES.filter(a => a.detector != null)
    assert.equal(withDetectors.length, 9, 'hope + wonder + 3 signals + satisfaction + 3 pathologies should have detectors')
    const names = withDetectors.map(a => a.name).sort()
    assert.deepEqual(names, ['anxiety', 'despair', 'disgust', 'frustration', 'hope', 'pride', 'satisfaction', 'shame', 'wonder'])
  })

  test('all 3 fruit emotions have expressors', () => {
    const fruits = byCategory('fruit')
    assert.ok(fruits.every(a => a.expressor != null), 'all fruits should have expressors')
    const names = fruits.map(a => a.name).sort()
    assert.deepEqual(names, ['awe', 'joy', 'satisfaction'])
  })

  test('joy and awe have no detectors (marking only)', () => {
    const joy = getAttribute('joy')
    const awe = getAttribute('awe')
    assert.equal(joy!.detector, undefined, 'joy should have no detector')
    assert.equal(awe!.detector, undefined, 'awe should have no detector')
  })

  test('longing phenomenologyDoc points to longing module', () => {
    const longing = getAttribute('longing')
    assert.ok(longing)
    assert.equal(longing.phenomenologyDoc, 'docs/longing/phenomenology.md')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Store tests
// ═══════════════════════════════════════════════════════════════════════

describe('attributes/store', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('recordEvent creates file and appends', () => {
    const event = makeEvent()
    recordEvent(event, tmpPath)
    assert.ok(existsSync(tmpPath))
    const content = readFileSync(tmpPath, 'utf-8')
    assert.ok(content.includes('patience'))
  })

  test('recordEvent appends multiple events', () => {
    recordEvent(makeEvent({ attribute: 'patience' }), tmpPath)
    recordEvent(makeEvent({ attribute: 'courage' }), tmpPath)
    recordEvent(makeEvent({ attribute: 'joy' }), tmpPath)

    const events = loadEvents({ path: tmpPath })
    assert.equal(events.length, 3)
  })

  test('loadEvents returns newest-first', () => {
    const t1 = '2026-04-28T01:00:00.000Z'
    const t2 = '2026-04-28T02:00:00.000Z'
    const t3 = '2026-04-28T03:00:00.000Z'

    recordEvent(makeEvent({ ts: t1, attribute: 'first' }), tmpPath)
    recordEvent(makeEvent({ ts: t2, attribute: 'second' }), tmpPath)
    recordEvent(makeEvent({ ts: t3, attribute: 'third' }), tmpPath)

    const events = loadEvents({ path: tmpPath })
    assert.equal(events[0]!.attribute, 'third')
    assert.equal(events[2]!.attribute, 'first')
  })

  test('loadEvents filters by attribute', () => {
    recordEvent(makeEvent({ attribute: 'patience' }), tmpPath)
    recordEvent(makeEvent({ attribute: 'courage' }), tmpPath)
    recordEvent(makeEvent({ attribute: 'patience' }), tmpPath)

    const events = loadEvents({ path: tmpPath, attribute: 'patience' })
    assert.equal(events.length, 2)
    assert.ok(events.every(e => e.attribute === 'patience'))
  })

  test('loadEvents filters by category', () => {
    recordEvent(makeEvent({ attribute: 'patience', category: 'virtue' }), tmpPath)
    recordEvent(makeEvent({ attribute: 'anxiety', category: 'signal' }), tmpPath)
    recordEvent(makeEvent({ attribute: 'courage', category: 'virtue' }), tmpPath)

    const events = loadEvents({ path: tmpPath, category: 'virtue' })
    assert.equal(events.length, 2)
    assert.ok(events.every(e => e.category === 'virtue'))
  })

  test('loadEvents filters by since timestamp', () => {
    recordEvent(makeEvent({ ts: '2026-04-27T12:00:00.000Z' }), tmpPath)
    recordEvent(makeEvent({ ts: '2026-04-28T12:00:00.000Z' }), tmpPath)
    recordEvent(makeEvent({ ts: '2026-04-29T12:00:00.000Z' }), tmpPath)

    const events = loadEvents({ path: tmpPath, since: '2026-04-28T00:00:00.000Z' })
    assert.equal(events.length, 2)
  })

  test('loadEvents respects limit', () => {
    for (let i = 0; i < 10; i++) {
      recordEvent(makeEvent({ attribute: `attr-${i}` }), tmpPath)
    }

    const events = loadEvents({ path: tmpPath, limit: 3 })
    assert.equal(events.length, 3)
  })

  test('loadEvents returns empty for missing file', () => {
    const events = loadEvents({ path: '/tmp/nonexistent-attrs-test.jsonl' })
    assert.equal(events.length, 0)
  })

  test('loadEvents skips malformed lines', () => {
    writeFileSync(tmpPath, [
      JSON.stringify(makeEvent({ attribute: 'good' })),
      'this is not json',
      '{"partial": true}',
      JSON.stringify(makeEvent({ attribute: 'also-good' })),
    ].join('\n'), 'utf-8')

    const events = loadEvents({ path: tmpPath })
    assert.equal(events.length, 2)
  })

  test('recentEvents filters by time window', () => {
    const old = new Date(Date.now() - 48 * 3600_000).toISOString()
    const recent = new Date(Date.now() - 1 * 3600_000).toISOString()

    recordEvent(makeEvent({ ts: old, attribute: 'old' }), tmpPath)
    recordEvent(makeEvent({ ts: recent, attribute: 'recent' }), tmpPath)

    const events = recentEvents(24, { path: tmpPath })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.attribute, 'recent')
  })

  test('countByAttribute aggregates correctly', () => {
    const now = new Date().toISOString()
    recordEvent(makeEvent({ ts: now, attribute: 'patience' }), tmpPath)
    recordEvent(makeEvent({ ts: now, attribute: 'patience' }), tmpPath)
    recordEvent(makeEvent({ ts: now, attribute: 'courage' }), tmpPath)
    recordEvent(makeEvent({ ts: now, attribute: 'patience' }), tmpPath)

    const counts = countByAttribute(24, { path: tmpPath })
    assert.equal(counts.get('patience'), 3)
    assert.equal(counts.get('courage'), 1)
  })

  test('latestPerAttribute returns most recent per name', () => {
    recordEvent(makeEvent({ ts: '2026-04-28T01:00:00.000Z', attribute: 'patience', evidence: 'first' }), tmpPath)
    recordEvent(makeEvent({ ts: '2026-04-28T02:00:00.000Z', attribute: 'patience', evidence: 'second' }), tmpPath)
    recordEvent(makeEvent({ ts: '2026-04-28T03:00:00.000Z', attribute: 'courage', evidence: 'only' }), tmpPath)

    const latest = latestPerAttribute({ path: tmpPath })
    assert.equal(latest.get('patience')!.evidence, 'second')
    assert.equal(latest.get('courage')!.evidence, 'only')
  })

  test('summarizeWindow produces correct summary', () => {
    const now = new Date().toISOString()
    recordEvent(makeEvent({ ts: now, attribute: 'patience', category: 'virtue' }), tmpPath)
    recordEvent(makeEvent({ ts: now, attribute: 'courage', category: 'virtue' }), tmpPath)
    recordEvent(makeEvent({ ts: now, attribute: 'joy', category: 'fruit' }), tmpPath)
    recordEvent(makeEvent({ ts: now, attribute: 'anxiety', category: 'signal', intensity: 0.4 }), tmpPath)

    const summary = summarizeWindow(24, { path: tmpPath })
    assert.equal(summary.totalEvents, 4)
    assert.ok(summary.fruitsHarvested.includes('joy'))
    assert.equal(summary.pathologyPresent, false)
  })

  test('summarizeWindow detects pathology presence', () => {
    const now = new Date().toISOString()
    recordEvent(makeEvent({ ts: now, attribute: 'shame', category: 'pathology' }), tmpPath)

    const summary = summarizeWindow(24, { path: tmpPath })
    assert.equal(summary.pathologyPresent, true)
  })

  test('summarizeWindow topAttributes is sorted by count', () => {
    const now = new Date().toISOString()
    recordEvent(makeEvent({ ts: now, attribute: 'patience' }), tmpPath)
    recordEvent(makeEvent({ ts: now, attribute: 'patience' }), tmpPath)
    recordEvent(makeEvent({ ts: now, attribute: 'patience' }), tmpPath)
    recordEvent(makeEvent({ ts: now, attribute: 'courage' }), tmpPath)
    recordEvent(makeEvent({ ts: now, attribute: 'courage' }), tmpPath)
    recordEvent(makeEvent({ ts: now, attribute: 'honesty' }), tmpPath)

    const summary = summarizeWindow(24, { path: tmpPath })
    assert.equal(summary.topAttributes[0]!.name, 'patience')
    assert.equal(summary.topAttributes[0]!.count, 3)
    assert.equal(summary.topAttributes[1]!.name, 'courage')
    assert.equal(summary.topAttributes[1]!.count, 2)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Scanner tests
// ═══════════════════════════════════════════════════════════════════════

describe('attributes/scan', () => {
  test('scanAttributes runs all registered detectors', async () => {
    const scan = await scanAttributes()
    // 5 detectors registered (hope + anxiety + disgust + frustration + satisfaction)
    // Each may return a reading or null depending on substrate state.
    assert.ok(scan.timestamp)
    if (scan.readings.length > 0) {
      // All readings should be inferred (from detectors)
      assert.ok(scan.readings.every(r => r.inferred === true))
      // All readings should be from known attributes
      const knownDetectors = ['hope', 'wonder', 'anxiety', 'disgust', 'frustration', 'satisfaction', 'despair', 'shame', 'pride']
      assert.ok(scan.readings.every(r => knownDetectors.includes(r.attribute)),
        `unexpected attribute in readings: ${scan.readings.map(r => r.attribute)}`)
    }
    // topByPriority should be a subset of readings
    assert.ok(scan.topByPriority.length <= scan.readings.length)
  })

  test('scanAttributes timestamp is ISO format', async () => {
    const scan = await scanAttributes()
    assert.ok(!Number.isNaN(Date.parse(scan.timestamp)))
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Renderer tests
// ═══════════════════════════════════════════════════════════════════════

describe('attributes/render', () => {
  test('renderAttributesBlock returns null for empty scan', () => {
    const scan: AttributeScan = { readings: [], topByPriority: [], timestamp: new Date().toISOString() }
    assert.equal(renderAttributesBlock(scan), null)
  })

  test('renderAttributesBlock renders signal reading', () => {
    const scan: AttributeScan = {
      readings: [makeReading()],
      topByPriority: [makeReading()],
      timestamp: new Date().toISOString(),
    }
    const block = renderAttributesBlock(scan)
    assert.ok(block)
    assert.ok(block!.includes('# Attributes (current readings)'))
    assert.ok(block!.includes('anxiety'))
    assert.ok(block!.includes('0.5'))
  })

  test('renderAttributesBlock renders motor reading', () => {
    const reading = makeReading({
      attribute: 'hope',
      category: 'motor',
      intensity: 0.7,
      evidence: 'new mission accepted, direction clear',
    })
    const scan: AttributeScan = {
      readings: [reading],
      topByPriority: [reading],
      timestamp: new Date().toISOString(),
    }
    const block = renderAttributesBlock(scan)!
    assert.ok(block.includes('hope'))
    assert.ok(block.includes('0.7'))
  })

  test('renderAttributesBlock renders virtue reading', () => {
    const reading = makeReading({
      attribute: 'patience',
      category: 'virtue',
      intensity: 1,
      evidence: 'deferred premature shipping twice',
    })
    const scan: AttributeScan = {
      readings: [reading],
      topByPriority: [reading],
      timestamp: new Date().toISOString(),
    }
    const block = renderAttributesBlock(scan)!
    assert.ok(block.includes('patience'))
    assert.ok(block.includes('present'))
  })

  test('renderAttributesBlock renders fruit reading', () => {
    const reading = makeReading({
      attribute: 'joy',
      category: 'fruit',
      intensity: 1,
      evidence: 'the longings module landed cleanly',
    })
    const scan: AttributeScan = {
      readings: [reading],
      topByPriority: [reading],
      timestamp: new Date().toISOString(),
    }
    const block = renderAttributesBlock(scan)!
    assert.ok(block.includes('joy'))
    assert.ok(block.includes('arrived'))
  })

  test('renderAttributesBlock renders pathology with witnessing language and counter-signal', () => {
    const reading = makeReading({
      attribute: 'despair',
      category: 'pathology',
      intensity: 0.6,
      evidence: 'longing persists with no progress in 3 days',
    })
    const scan: AttributeScan = {
      readings: [reading],
      topByPriority: [reading],
      timestamp: new Date().toISOString(),
    }
    const block = renderAttributesBlock(scan)!
    assert.ok(block.includes('despair-shaped'), 'should use witnessing language')
    // Counter-signal should be present
    assert.ok(block.includes('small flames'), 'should include counter-signal')
  })

  test('renderAttributesBlock handles multiple readings', () => {
    const readings = [
      makeReading({ attribute: 'anxiety', category: 'signal', intensity: 0.6 }),
      makeReading({ attribute: 'hope', category: 'motor', intensity: 0.4 }),
      makeReading({ attribute: 'patience', category: 'virtue', intensity: 1 }),
    ]
    const scan: AttributeScan = {
      readings,
      topByPriority: readings,
      timestamp: new Date().toISOString(),
    }
    const block = renderAttributesBlock(scan)!
    // Block should contain header + all three readings
    assert.ok(block.includes('anxiety'))
    assert.ok(block.includes('hope'))
    assert.ok(block.includes('patience'))
    assert.ok(block.includes('# Attributes'))
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Integration tests
// ═══════════════════════════════════════════════════════════════════════

describe('attributes/integration', () => {
  test('full pipeline: record → load → summarize', () => {
    const path = freshPath()
    const now = new Date().toISOString()

    // Record some events
    recordEvent({
      ts: now,
      attribute: 'patience',
      category: 'virtue',
      shape: 'marked',
      evidence: 'waited for tests to complete before committing',
      why: 'discipline over speed',
    }, path)

    recordEvent({
      ts: now,
      attribute: 'joy',
      category: 'fruit',
      shape: 'marked',
      intensity: 1,
      evidence: 'the attribute framework came together cleanly',
      why: 'beauty manifested — the types feel right',
    }, path)

    recordEvent({
      ts: now,
      attribute: 'anxiety',
      category: 'signal',
      shape: 'detected',
      intensity: 0.3,
      evidence: '9 missions in REVIEW without response',
      why: 'pipeline backing up, no feedback flowing',
    }, path)

    // Load and verify
    const all = loadEvents({ path })
    assert.equal(all.length, 3)

    // Summarize
    const summary = summarizeWindow(24, { path })
    assert.equal(summary.totalEvents, 3)
    assert.ok(summary.fruitsHarvested.includes('joy'))
    assert.equal(summary.pathologyPresent, false)

    // Count by attribute
    const counts = countByAttribute(24, { path })
    assert.equal(counts.get('patience'), 1)
    assert.equal(counts.get('joy'), 1)
    assert.equal(counts.get('anxiety'), 1)

    cleanup()
  })

  test('event shapes are preserved correctly', () => {
    const path = freshPath()
    const now = new Date().toISOString()

    recordEvent({
      ts: now,
      attribute: 'courage',
      category: 'virtue',
      shape: 'marked',
      evidence: 'admitted the previous approach was wrong',
      why: 'honesty required acknowledging the failure',
    }, path)

    recordEvent({
      ts: now,
      attribute: 'frustration',
      category: 'signal',
      shape: 'detected',
      intensity: 0.7,
      evidence: 'same error 4× in a row',
      why: 'the path is blocked, need a different approach',
    }, path)

    const events = loadEvents({ path })
    assert.equal(events[0]!.shape, 'detected')
    assert.equal(events[1]!.shape, 'marked')

    cleanup()
  })

  test('category filter works across store and summary', () => {
    const path = freshPath()
    const now = new Date().toISOString()

    recordEvent(makeEvent({ ts: now, attribute: 'patience', category: 'virtue' }), path)
    recordEvent(makeEvent({ ts: now, attribute: 'courage', category: 'virtue' }), path)
    recordEvent(makeEvent({ ts: now, attribute: 'joy', category: 'fruit' }), path)
    recordEvent(makeEvent({ ts: now, attribute: 'anxiety', category: 'signal' }), path)

    const virtues = loadEvents({ path, category: 'virtue' })
    assert.equal(virtues.length, 2)

    const latest = latestPerAttribute({ path, category: 'fruit' })
    assert.equal(latest.size, 1)
    assert.ok(latest.has('joy'))

    cleanup()
  })
})
