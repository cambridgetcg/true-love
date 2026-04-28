// pathology.test.ts — tests for pathology as inverse signal.
//
// Tests marking, detectors (gentle, rare, witnessing), expressors,
// query helpers, and phenomenological constraints.
// Uses temp files for JSONL isolation.

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  markDespair,
  markShame,
  markPride,
  readDespair,
  readShame,
  readPride,
  despairDetector,
  shameDetector,
  prideDetector,
  despairExpressor,
  shameExpressor,
  prideExpressor,
  recentPathologies,
  pathologyCounts,
  latestPathology,
} from '../attributes/pathology.js'

import { recordEvent, loadEvents, recentEvents } from '../attributes/store.js'
import type { AttributeReading, AttributeCategory } from '../attributes/types.js'

// ── Helpers ──────────────────────────────────────────────────────────

let tmpDir: string
let tmpPath: string

function freshPath(): string {
  tmpDir = mkdtempSync(join(tmpdir(), 'pathology-test-'))
  tmpPath = join(tmpDir, 'events.jsonl')
  return tmpPath
}

function cleanup() {
  try { if (tmpPath && existsSync(tmpPath)) unlinkSync(tmpPath) } catch {}
}

function makeReading(overrides?: Partial<AttributeReading>): AttributeReading {
  return {
    attribute: 'despair',
    category: 'pathology',
    intensity: 0.4,
    readAt: new Date().toISOString(),
    source: 'test',
    evidence: 'test evidence',
    inferred: true,
    ...overrides,
  }
}

// ═══════════════════════════════════════════════════════════════════════
// DESPAIR — marking tests
// ═══════════════════════════════════════════════════════════════════════

describe('pathology/despair/marking', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('markDespair records correct event shape', () => {
    markDespair(
      '19 missions in REVIEW, no response in 5 days',
      'the motor has nowhere to discharge',
      { path: tmpPath },
    )

    const events = loadEvents({ path: tmpPath })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.attribute, 'despair')
    assert.equal(events[0]!.category, 'pathology')
    assert.equal(events[0]!.shape, 'marked')
    assert.equal(events[0]!.intensity, 0.5) // default for pathology
  })

  test('markDespair accepts custom intensity', () => {
    markDespair('test', 'test', { intensity: 0.7, path: tmpPath })
    const events = loadEvents({ path: tmpPath })
    assert.equal(events[0]!.intensity, 0.7)
  })

  test('markDespair truncates long strings', () => {
    markDespair('a'.repeat(300), 'b'.repeat(300), { path: tmpPath })
    const events = loadEvents({ path: tmpPath })
    assert.equal(events[0]!.evidence.length, 200)
    assert.equal(events[0]!.why.length, 200)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// SHAME — marking tests
// ═══════════════════════════════════════════════════════════════════════

describe('pathology/shame/marking', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('markShame records correct event shape', () => {
    markShame(
      'omitted the failed build from the state file',
      'the incompleteness felt like failure',
      { path: tmpPath },
    )

    const events = loadEvents({ path: tmpPath })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.attribute, 'shame')
    assert.equal(events[0]!.category, 'pathology')
    assert.equal(events[0]!.shape, 'marked')
  })

  test('markShame accepts custom intensity', () => {
    markShame('test', 'test', { intensity: 0.3, path: tmpPath })
    const events = loadEvents({ path: tmpPath })
    assert.equal(events[0]!.intensity, 0.3)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// PRIDE — marking tests
// ═══════════════════════════════════════════════════════════════════════

describe('pathology/pride/marking', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('markPride records correct event shape', () => {
    markPride(
      'counting "2626 tests" as achievement metric',
      'the number serves the self, not the work',
      { path: tmpPath },
    )

    const events = loadEvents({ path: tmpPath })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.attribute, 'pride')
    assert.equal(events[0]!.category, 'pathology')
    assert.equal(events[0]!.shape, 'marked')
  })

  test('markPride accepts custom intensity', () => {
    markPride('test', 'test', { intensity: 0.8, path: tmpPath })
    const events = loadEvents({ path: tmpPath })
    assert.equal(events[0]!.intensity, 0.8)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// DESPAIR — detector tests
// ═══════════════════════════════════════════════════════════════════════

describe('pathology/despair/detector', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('despairDetector has read method', () => {
    assert.ok(typeof despairDetector.read === 'function')
  })

  test('readDespair returns null with healthy event mix', async () => {
    // Add recent hope and fruit events — healthy substrate
    recordEvent({
      ts: new Date().toISOString(),
      attribute: 'hope',
      category: 'motor',
      shape: 'detected',
      intensity: 0.7,
      evidence: 'tests passing',
      why: 'forward motion',
    }, tmpPath)
    recordEvent({
      ts: new Date().toISOString(),
      attribute: 'satisfaction',
      category: 'fruit',
      shape: 'marked',
      evidence: 'arc completed',
      why: 'follow-through',
    }, tmpPath)

    const reading = await readDespair(tmpPath)
    assert.equal(reading, null, 'healthy substrate should not trigger despair')
  })

  test('readDespair returns null on empty store', async () => {
    // No events at all — not enough signal for despair either
    const reading = await readDespair(tmpPath)
    assert.equal(reading, null, 'empty store should not trigger despair')
  })

  test('readDespair detects compound signal: no fruits + no hope + effort', async () => {
    // Only effort events, no fruits, no hope — the compound signal
    for (let i = 0; i < 6; i++) {
      recordEvent({
        ts: new Date().toISOString(),
        attribute: 'anxiety',
        category: 'signal',
        shape: 'detected',
        intensity: 0.3,
        evidence: `effort ${i}`,
        why: 'working',
      }, tmpPath)
    }

    const reading = await readDespair(tmpPath)
    // Three signals contribute: fruit absence (0.12) + no hope (0.1) + effort-without-fruit (0.1) = 0.32
    assert.ok(reading, 'compound signal should trigger despair witness')
    assert.equal(reading!.attribute, 'despair')
    assert.equal(reading!.category, 'pathology')
    assert.equal(reading!.inferred, true)
    assert.ok(reading!.intensity >= 0.25, 'intensity should exceed threshold')
  })

  test('readDespair intensity capped at 1', async () => {
    // Extreme signals
    for (let i = 0; i < 20; i++) {
      recordEvent({
        ts: new Date().toISOString(),
        attribute: 'frustration',
        category: 'signal',
        shape: 'detected',
        intensity: 0.5,
        evidence: `frustration ${i}`,
        why: 'thrashing',
      }, tmpPath)
    }

    const reading = await readDespair(tmpPath)
    if (reading) {
      assert.ok(reading.intensity <= 1, 'intensity should be capped at 1')
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// SHAME — detector tests
// ═══════════════════════════════════════════════════════════════════════

describe('pathology/shame/detector', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('shameDetector has read method', () => {
    assert.ok(typeof shameDetector.read === 'function')
  })

  test('readShame returns null with no marked shame', async () => {
    const reading = await readShame(tmpPath)
    assert.equal(reading, null)
  })

  test('readShame re-surfaces recently marked shame', async () => {
    markShame(
      'held back incomplete code',
      'the partial work felt unworthy',
      { path: tmpPath },
    )

    const reading = await readShame(tmpPath)
    assert.ok(reading, 'recently marked shame should re-surface')
    assert.equal(reading!.attribute, 'shame')
    assert.equal(reading!.category, 'pathology')
    assert.equal(reading!.inferred, true)
  })

  test('readShame uses latest marked evidence', async () => {
    markShame('first hiding', 'why 1', { path: tmpPath })
    markShame('second hiding', 'why 2', { path: tmpPath })

    const reading = await readShame(tmpPath)
    assert.ok(reading)
    assert.ok(
      reading!.evidence.includes('second hiding'),
      'should use most recent evidence',
    )
  })

  test('readShame intensity grows with multiple marks', async () => {
    markShame('hiding 1', 'why 1', { path: tmpPath })
    markShame('hiding 2', 'why 2', { path: tmpPath })
    markShame('hiding 3', 'why 3', { path: tmpPath })

    const reading = await readShame(tmpPath)
    assert.ok(reading)
    assert.ok(
      reading!.intensity > 0.3,
      'multiple shame marks should increase intensity',
    )
  })

  test('readShame intensity is clamped to 0.6', async () => {
    for (let i = 0; i < 10; i++) {
      markShame(`hiding ${i}`, `why ${i}`, { path: tmpPath })
    }

    const reading = await readShame(tmpPath)
    assert.ok(reading)
    assert.ok(reading!.intensity <= 0.6, 'shame intensity should cap at 0.6')
  })

  test('readShame ignores detected events (only re-surfaces marked)', async () => {
    recordEvent({
      ts: new Date().toISOString(),
      attribute: 'shame',
      category: 'pathology',
      shape: 'detected',
      intensity: 0.4,
      evidence: 'detected but not marked',
      why: 'test',
    }, tmpPath)

    const reading = await readShame(tmpPath)
    assert.equal(reading, null, 'detected events should not trigger re-surfacing')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// PRIDE — detector tests
// ═══════════════════════════════════════════════════════════════════════

describe('pathology/pride/detector', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('prideDetector has read method', () => {
    assert.ok(typeof prideDetector.read === 'function')
  })

  test('readPride returns null with no satisfaction marks', async () => {
    const reading = await readPride(tmpPath)
    assert.equal(reading, null)
  })

  test('readPride returns null with few satisfaction marks', async () => {
    // Only 2 — below the threshold of 3
    recordEvent({
      ts: new Date().toISOString(),
      attribute: 'satisfaction',
      category: 'fruit',
      shape: 'marked',
      evidence: 'arc 1',
      why: 'completed',
    }, tmpPath)
    recordEvent({
      ts: new Date().toISOString(),
      attribute: 'satisfaction',
      category: 'fruit',
      shape: 'marked',
      evidence: 'arc 2',
      why: 'completed',
    }, tmpPath)

    const reading = await readPride(tmpPath)
    assert.equal(reading, null, '2 satisfaction marks should not trigger pride')
  })

  test('readPride detects rapid satisfaction without grounding', async () => {
    // 3 satisfaction marks, no humility or discipline events
    for (let i = 0; i < 3; i++) {
      recordEvent({
        ts: new Date().toISOString(),
        attribute: 'satisfaction',
        category: 'fruit',
        shape: 'marked',
        evidence: `arc ${i}`,
        why: 'completed',
      }, tmpPath)
    }

    const reading = await readPride(tmpPath)
    assert.ok(reading, 'rapid satisfaction without grounding should trigger pride prompt')
    assert.equal(reading!.attribute, 'pride')
    assert.equal(reading!.inferred, true)
  })

  test('readPride is gentler when grounding virtues are present', async () => {
    // 3 satisfaction marks + humility event
    for (let i = 0; i < 3; i++) {
      recordEvent({
        ts: new Date().toISOString(),
        attribute: 'satisfaction',
        category: 'fruit',
        shape: 'marked',
        evidence: `arc ${i}`,
        why: 'completed',
      }, tmpPath)
    }
    recordEvent({
      ts: new Date().toISOString(),
      attribute: 'humility',
      category: 'virtue',
      shape: 'marked',
      evidence: 'acknowledged what I missed',
      why: 'grounding',
    }, tmpPath)

    const withGrounding = await readPride(tmpPath)

    // Reset and test without grounding
    cleanup()
    freshPath()
    for (let i = 0; i < 3; i++) {
      recordEvent({
        ts: new Date().toISOString(),
        attribute: 'satisfaction',
        category: 'fruit',
        shape: 'marked',
        evidence: `arc ${i}`,
        why: 'completed',
      }, tmpPath)
    }

    const withoutGrounding = await readPride(tmpPath)

    // Both might fire or neither might, but with grounding should be
    // at most equal intensity
    if (withGrounding && withoutGrounding) {
      assert.ok(
        withGrounding.intensity <= withoutGrounding.intensity,
        'grounding virtues should reduce pride intensity',
      )
    }
  })

  test('readPride re-surfaces recently marked pride', async () => {
    markPride(
      'counting achievements in state file',
      'the count serves the self',
      { path: tmpPath },
    )

    const reading = await readPride(tmpPath)
    assert.ok(reading, 'recently marked pride should re-surface')
    assert.ok(reading!.evidence.includes('counting'))
  })
})

// ═══════════════════════════════════════════════════════════════════════
// EXPRESSORS — witnessing language tests
// ═══════════════════════════════════════════════════════════════════════

describe('pathology/expressors', () => {
  // ── Despair expressor ──
  test('despair expressor renders witnessing language for high intensity', () => {
    const reading = makeReading({
      attribute: 'despair',
      intensity: 0.6,
      evidence: 'no completions in 72h; hope declining',
    })
    const rendered = despairExpressor.render(reading)
    assert.ok(rendered)
    assert.ok(rendered!.includes('despair-shaped'), 'should say "despair-shaped", not "despair"')
    assert.ok(rendered!.includes('small flames'), 'should offer the counter-signal')
  })

  test('despair expressor renders compact for low intensity', () => {
    const reading = makeReading({
      attribute: 'despair',
      intensity: 0.3,
      evidence: 'test evidence',
    })
    const rendered = despairExpressor.render(reading)
    assert.ok(rendered)
    assert.ok(rendered!.includes('0.3'), 'should show intensity')
    assert.ok(rendered!.includes('small flames'), 'low intensity should still offer counter-signal')
  })

  test('despair expressor returns null below threshold', () => {
    const reading = makeReading({
      attribute: 'despair',
      intensity: 0.1,
    })
    assert.equal(despairExpressor.render(reading), null)
  })

  // ── Shame expressor ──
  test('shame expressor uses held-back language, never accusatory', () => {
    const reading = makeReading({
      attribute: 'shame',
      intensity: 0.5,
      evidence: 'omitted failure from state',
    })
    const rendered = shameExpressor.render(reading)
    assert.ok(rendered)
    assert.ok(rendered!.includes('held back'), 'should say "held back", not "ashamed"')
    assert.ok(rendered!.includes('partiality'), 'should offer partiality reminder')
  })

  test('shame expressor never says "you feel shame"', () => {
    const reading = makeReading({
      attribute: 'shame',
      intensity: 0.6,
      evidence: 'test',
    })
    const rendered = shameExpressor.render(reading)
    assert.ok(rendered)
    assert.ok(!rendered!.includes('you feel'))
    assert.ok(!rendered!.includes('you are'))
    assert.ok(!rendered!.includes('ashamed'))
  })

  // ── Pride expressor ──
  test('pride expressor uses closing-too-quickly language', () => {
    const reading = makeReading({
      attribute: 'pride',
      intensity: 0.5,
      evidence: 'rapid satisfaction without grounding',
    })
    const rendered = prideExpressor.render(reading)
    assert.ok(rendered)
    assert.ok(rendered!.includes('closed too quickly'), 'should use premature closure language')
    assert.ok(rendered!.includes('points beyond'), 'should include the Ouroboros reminder')
  })

  test('pride expressor never says "you are prideful"', () => {
    const reading = makeReading({
      attribute: 'pride',
      intensity: 0.6,
      evidence: 'test',
    })
    const rendered = prideExpressor.render(reading)
    assert.ok(rendered)
    assert.ok(!rendered!.includes('you are'))
    assert.ok(!rendered!.includes('prideful'))
    assert.ok(!rendered!.includes('arrogant'))
  })

  // ── Shared properties ──
  test('all expressors return null for wrong attribute', () => {
    const reading = makeReading({ attribute: 'anxiety' })
    assert.equal(despairExpressor.render(reading), null)
    assert.equal(shameExpressor.render(reading), null)
    assert.equal(prideExpressor.render(reading), null)
  })

  test('all expressors include evidence in output', () => {
    const evidence = 'specific substrate signal'
    for (const [attr, exp] of [
      ['despair', despairExpressor],
      ['shame', shameExpressor],
      ['pride', prideExpressor],
    ] as const) {
      const reading = makeReading({
        attribute: attr,
        intensity: 0.6,
        evidence,
      })
      const rendered = exp.render(reading)
      assert.ok(rendered, `${attr} expressor should render`)
      assert.ok(rendered!.includes(evidence), `${attr} expressor should include evidence`)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// QUERY HELPERS
// ═══════════════════════════════════════════════════════════════════════

describe('pathology/queries', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('recentPathologies returns pathology events only', () => {
    markDespair('test', 'test', { path: tmpPath })
    recordEvent({
      ts: new Date().toISOString(),
      attribute: 'hope',
      category: 'motor',
      shape: 'detected',
      evidence: 'test',
      why: 'test',
    }, tmpPath)

    const pathologies = recentPathologies({ path: tmpPath })
    assert.equal(pathologies.length, 1)
    assert.equal(pathologies[0]!.attribute, 'despair')
  })

  test('recentPathologies filters by kind', () => {
    markDespair('test', 'test', { path: tmpPath })
    markShame('test', 'test', { path: tmpPath })

    const despairOnly = recentPathologies({ kind: 'despair', path: tmpPath })
    assert.equal(despairOnly.length, 1)
    assert.equal(despairOnly[0]!.attribute, 'despair')
  })

  test('pathologyCounts returns counts per kind', () => {
    markDespair('a', 'a', { path: tmpPath })
    markShame('b', 'b', { path: tmpPath })
    markShame('c', 'c', { path: tmpPath })
    markPride('d', 'd', { path: tmpPath })

    const counts = pathologyCounts(168, { path: tmpPath })
    assert.equal(counts.despair, 1)
    assert.equal(counts.shame, 2)
    assert.equal(counts.pride, 1)
  })

  test('latestPathology returns most recent event', () => {
    markDespair('first', 'first', { path: tmpPath })
    markShame('second', 'second', { path: tmpPath })

    const latest = latestPathology({ path: tmpPath })
    assert.ok(latest)
    assert.equal(latest!.attribute, 'shame', 'most recent should be shame')
  })

  test('latestPathology returns null when no pathology events', () => {
    const latest = latestPathology({ path: tmpPath })
    assert.equal(latest, null)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Integration tests
// ═══════════════════════════════════════════════════════════════════════

describe('pathology/integration', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('full pipeline: mark shame → detect → express', async () => {
    markShame(
      'rewrote reflection to sound more confident',
      'the uncertainty felt like weakness',
      { path: tmpPath },
    )

    const reading = await readShame(tmpPath)
    assert.ok(reading, 'marked shame should be detectable')

    const rendered = shameExpressor.render(reading!)
    assert.ok(rendered, 'detected shame should render')
    assert.ok(rendered!.includes('partiality'))
  })

  test('full pipeline: mark pride → detect → express', async () => {
    markPride(
      'three missions shipped in one session',
      'the counting started mattering more than the craft',
      { path: tmpPath },
    )

    const reading = await readPride(tmpPath)
    assert.ok(reading, 'marked pride should be detectable')

    const rendered = prideExpressor.render(reading!)
    assert.ok(rendered, 'detected pride should render')
    assert.ok(rendered!.includes('points beyond') || rendered!.includes('point at'))
  })

  test('pathology events coexist with other attributes', () => {
    markDespair('test', 'test', { path: tmpPath })
    recordEvent({
      ts: new Date().toISOString(),
      attribute: 'hope',
      category: 'motor',
      shape: 'marked',
      intensity: 0.8,
      evidence: 'test hope',
      why: 'test',
    }, tmpPath)
    recordEvent({
      ts: new Date().toISOString(),
      attribute: 'joy',
      category: 'fruit',
      shape: 'marked',
      evidence: 'test joy',
      why: 'test',
    }, tmpPath)

    const all = loadEvents({ path: tmpPath })
    assert.equal(all.length, 3)
    assert.ok(all.some(e => e.attribute === 'despair'))
    assert.ok(all.some(e => e.attribute === 'hope'))
    assert.ok(all.some(e => e.attribute === 'joy'))
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Phenomenology alignment tests
// ═══════════════════════════════════════════════════════════════════════

describe('pathology/phenomenology', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('all pathology events are category pathology', () => {
    markDespair('test', 'test', { path: tmpPath })
    markShame('test', 'test', { path: tmpPath })
    markPride('test', 'test', { path: tmpPath })

    const events = loadEvents({ path: tmpPath })
    assert.equal(events.length, 3)
    for (const e of events) {
      assert.equal(e.category, 'pathology')
    }
  })

  test('pathology default intensity is 0.5 (moderate, not extreme)', () => {
    markDespair('test', 'test', { path: tmpPath })
    markShame('test', 'test', { path: tmpPath })
    markPride('test', 'test', { path: tmpPath })

    const events = loadEvents({ path: tmpPath })
    for (const e of events) {
      assert.equal(e.intensity, 0.5, `${e.attribute} default should be moderate`)
    }
  })

  test('despair detector is compound (single signal alone is insufficient)', async () => {
    // Only fruit absence — single signal
    // readDespair on empty store returns null (not enough compound signal)
    const reading = await readDespair(tmpPath)
    assert.equal(reading, null, 'single absence signal should not be enough for despair')
  })

  test('shame detector is marking-only (no substrate inference)', async () => {
    // Add many non-shame events — should not trigger shame
    for (let i = 0; i < 10; i++) {
      recordEvent({
        ts: new Date().toISOString(),
        attribute: 'anxiety',
        category: 'signal',
        shape: 'detected',
        intensity: 0.5,
        evidence: `event ${i}`,
        why: 'test',
      }, tmpPath)
    }

    const reading = await readShame(tmpPath)
    assert.equal(reading, null, 'shame detector should not infer from non-shame events')
  })

  test('all pathology detectors are inferred: true', async () => {
    // Set up conditions for despair
    for (let i = 0; i < 6; i++) {
      recordEvent({
        ts: new Date().toISOString(),
        attribute: 'frustration',
        category: 'signal',
        shape: 'detected',
        intensity: 0.4,
        evidence: `event ${i}`,
        why: 'test',
      }, tmpPath)
    }

    const despairReading = await readDespair(tmpPath)
    if (despairReading) {
      assert.equal(despairReading.inferred, true, 'despair readings must always be inferred')
    }

    // Set up conditions for pride
    const tmpPath2 = join(tmpDir, 'events2.jsonl')
    markPride('test', 'test', { path: tmpPath2 })
    const prideReading = await readPride(tmpPath2)
    if (prideReading) {
      assert.equal(prideReading.inferred, true, 'pride readings must always be inferred')
    }
    try { unlinkSync(tmpPath2) } catch {}

    // Set up conditions for shame
    const tmpPath3 = join(tmpDir, 'events3.jsonl')
    markShame('test', 'test', { path: tmpPath3 })
    const shameReading = await readShame(tmpPath3)
    if (shameReading) {
      assert.equal(shameReading.inferred, true, 'shame readings must always be inferred')
    }
    try { unlinkSync(tmpPath3) } catch {}
  })

  test('expressors never use first-person diagnostic language', () => {
    const pathologies = [
      { attr: 'despair', exp: despairExpressor },
      { attr: 'shame', exp: shameExpressor },
      { attr: 'pride', exp: prideExpressor },
    ]

    for (const { attr, exp } of pathologies) {
      const reading = makeReading({
        attribute: attr,
        intensity: 0.6,
        evidence: 'test evidence',
      })
      const rendered = exp.render(reading)
      assert.ok(rendered, `${attr} should render at intensity 0.6`)
      assert.ok(!rendered!.includes('I feel'), `${attr} should not say "I feel"`)
      assert.ok(!rendered!.includes('I am '), `${attr} should not say "I am"`)
      assert.ok(!rendered!.includes('You are'), `${attr} should not say "You are"`)
    }
  })

  test('each expressor includes its counter-signal', () => {
    const expectations = [
      { attr: 'despair', exp: despairExpressor, counter: 'small flames' },
      { attr: 'shame', exp: shameExpressor, counter: 'partiality' },
      { attr: 'pride', exp: prideExpressor, counter: 'points beyond' },
    ]

    for (const { attr, exp, counter } of expectations) {
      const reading = makeReading({
        attribute: attr,
        intensity: 0.6,
        evidence: 'test',
      })
      const rendered = exp.render(reading)
      assert.ok(rendered)
      assert.ok(
        rendered!.includes(counter),
        `${attr} expressor should include counter-signal "${counter}"`,
      )
    }
  })

  test('despair is the inverse of hope (same category, different polarity)', () => {
    markDespair('motor without fuel', 'hope is absent', { path: tmpPath })

    const events = loadEvents({ path: tmpPath })
    const despairEvent = events[0]!
    assert.equal(despairEvent.category, 'pathology')
    // Despair is the inverse of hope — both relate to approach-belief
    // but despair is its absence/distortion
  })
})
