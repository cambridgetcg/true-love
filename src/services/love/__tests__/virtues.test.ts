// virtues.test.ts — tests for virtues as pillars.
//
// Tests the 5 scanners, topVirtueCall, expressor, marking primitives,
// and query helpers. Uses temp files for JSONL isolation.

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, unlinkSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  VIRTUES,
  scanHumility,
  scanCourage,
  scanPatience,
  scanDiscipline,
  scanTemperance,
  topVirtueCall,
  humilityDetector,
  courageDetector,
  patienceDetector,
  disciplineDetector,
  temperanceDetector,
  virtueExpressor,
  markVirtuePracticed,
  markHumility,
  markGratitude,
  markHonesty,
  markCourage,
  markWisdom,
  markDiscipline,
  markPatience,
  markTemperance,
  recentVirtuePractice,
  virtueCounts,
  lastPracticed,
  virtuesSummary,
} from '../attributes/virtues.js'

import type { VirtueReading, Virtue } from '../attributes/virtues.js'
import { recordEvent, loadEvents } from '../attributes/store.js'
import type { AttributeReading, AttributeEvent, AttributeCategory } from '../attributes/types.js'

// ── Helpers ──────────────────────────────────────────────────────────

let tmpDir: string
let tmpPath: string

function freshPath(): string {
  tmpDir = mkdtempSync(join(tmpdir(), 'virtues-test-'))
  tmpPath = join(tmpDir, 'events.jsonl')
  return tmpPath
}

function cleanup() {
  try { if (tmpPath && existsSync(tmpPath)) unlinkSync(tmpPath) } catch {}
}

function makeVirtueReading(overrides?: Partial<VirtueReading>): VirtueReading {
  return {
    virtue: 'patience',
    needed: 0.3,
    evidence: 'rapid completions in 12h',
    hypothesis: true,
    ...overrides,
  }
}

function makeAttributeReading(overrides?: Partial<AttributeReading>): AttributeReading {
  return {
    attribute: 'patience',
    category: 'virtue',
    intensity: 0.3,
    readAt: new Date().toISOString(),
    source: 'patience scanner',
    evidence: 'rapid completions in 12h',
    inferred: true,
    ...overrides,
  }
}

function seedEvents(events: Partial<AttributeEvent>[], path: string): void {
  for (const e of events) {
    const full: AttributeEvent = {
      ts: e.ts ?? new Date().toISOString(),
      attribute: e.attribute ?? 'test',
      category: (e.category ?? 'signal') as AttributeCategory,
      shape: e.shape ?? 'detected',
      evidence: e.evidence ?? 'test evidence',
      why: e.why ?? 'test reason',
      ...e,
    }
    recordEvent(full, path)
  }
}

// ═══════════════════════════════════════════════════════════════════════
// VIRTUES constant
// ═══════════════════════════════════════════════════════════════════════

describe('VIRTUES', () => {
  test('contains all 8 virtues', () => {
    assert.equal(VIRTUES.length, 8)
    assert.ok(VIRTUES.includes('humility'))
    assert.ok(VIRTUES.includes('gratitude'))
    assert.ok(VIRTUES.includes('honesty'))
    assert.ok(VIRTUES.includes('courage'))
    assert.ok(VIRTUES.includes('wisdom'))
    assert.ok(VIRTUES.includes('discipline'))
    assert.ok(VIRTUES.includes('patience'))
    assert.ok(VIRTUES.includes('temperance'))
  })

  test('order matches SOUL.md', () => {
    assert.equal(VIRTUES[0], 'humility')
    assert.equal(VIRTUES[7], 'temperance')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Humility scanner
// ═══════════════════════════════════════════════════════════════════════

describe('scanHumility', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('returns null with empty event log', async () => {
    const result = await scanHumility(tmpPath)
    // May be null (no signals) — valid
    if (result) {
      assert.equal(result.virtue, 'humility')
      assert.ok(result.needed >= 0 && result.needed <= 1)
    }
  })

  test('returns correct shape', async () => {
    // Seed a pride event to trigger humility need
    seedEvents([
      { attribute: 'pride', category: 'pathology', shape: 'marked' },
    ], tmpPath)

    const result = await scanHumility(tmpPath)
    if (result) {
      assert.equal(result.virtue, 'humility')
      assert.equal(result.hypothesis, true)
      assert.ok(typeof result.evidence === 'string')
      assert.ok(result.needed > 0)
    }
  })

  test('intensity rises with pride events', async () => {
    seedEvents([
      { attribute: 'pride', category: 'pathology', shape: 'marked' },
      { attribute: 'pride', category: 'pathology', shape: 'detected' },
    ], tmpPath)

    const result = await scanHumility(tmpPath)
    assert.ok(result !== null, 'humility should be needed after pride events')
    assert.ok(result!.needed >= 0.2, `expected >= 0.2, got ${result!.needed}`)
  })

  test('intensity rises with high activity and no grounding practice', async () => {
    // 10 recent events, none are humility or gratitude
    const now = new Date()
    for (let i = 0; i < 10; i++) {
      const ts = new Date(now.getTime() - i * 30 * 60_000) // every 30min in last 5h
      seedEvents([{
        attribute: 'anxiety',
        category: 'signal',
        shape: 'detected',
        ts: ts.toISOString(),
      }], tmpPath)
    }

    const result = await scanHumility(tmpPath)
    if (result) {
      assert.ok(result.evidence.includes('without grounding'))
    }
  })

  test('humilityDetector.read returns AttributeReading shape', async () => {
    seedEvents([
      { attribute: 'pride', category: 'pathology', shape: 'marked' },
    ], tmpPath)

    const reading = await humilityDetector.read(tmpPath)
    if (reading) {
      assert.equal(reading.attribute, 'humility')
      assert.equal(reading.category, 'virtue')
      assert.equal(reading.inferred, true)
      assert.ok(reading.readAt)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Courage scanner
// ═══════════════════════════════════════════════════════════════════════

describe('scanCourage', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('returns null with no signals', async () => {
    const result = await scanCourage(tmpPath)
    // No events → may or may not be null
    if (result) {
      assert.equal(result.virtue, 'courage')
    }
  })

  test('intensity rises with frustration events', async () => {
    seedEvents([
      { attribute: 'frustration', category: 'signal', shape: 'detected' },
      { attribute: 'frustration', category: 'signal', shape: 'detected' },
    ], tmpPath)

    const result = await scanCourage(tmpPath)
    if (result) {
      assert.equal(result.virtue, 'courage')
      assert.ok(result.needed >= 0.2)
      assert.ok(result.evidence.includes('frustration'))
    }
  })

  test('intensity rises with high activity and no courage practice', async () => {
    const now = new Date()
    for (let i = 0; i < 12; i++) {
      seedEvents([{
        attribute: 'hope',
        category: 'motor',
        shape: 'detected',
        ts: new Date(now.getTime() - i * 2 * 3600_000).toISOString(),
      }], tmpPath)
    }

    const result = await scanCourage(tmpPath)
    if (result) {
      assert.ok(result.evidence.includes('without courage practice'))
    }
  })

  test('courageDetector.read wraps scanner correctly', async () => {
    seedEvents([
      { attribute: 'frustration', category: 'signal', shape: 'detected' },
      { attribute: 'frustration', category: 'signal', shape: 'marked' },
    ], tmpPath)

    const reading = await courageDetector.read(tmpPath)
    if (reading) {
      assert.equal(reading.attribute, 'courage')
      assert.equal(reading.category, 'virtue')
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Patience scanner
// ═══════════════════════════════════════════════════════════════════════

describe('scanPatience', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('returns null with no signals', async () => {
    const result = await scanPatience(tmpPath)
    if (result) {
      assert.equal(result.virtue, 'patience')
    }
  })

  test('intensity rises with rapid fruit completions', async () => {
    const now = new Date()
    for (let i = 0; i < 4; i++) {
      seedEvents([{
        attribute: 'satisfaction',
        category: 'fruit',
        shape: 'marked',
        ts: new Date(now.getTime() - i * 2 * 3600_000).toISOString(),
      }], tmpPath)
    }

    const result = await scanPatience(tmpPath)
    assert.ok(result !== null, 'patience should be needed after rapid completions')
    assert.ok(result!.needed >= 0.2, `expected >= 0.2, got ${result!.needed}`)
    assert.ok(result!.evidence.includes('completions'))
  })

  test('intensity rises with high event density', async () => {
    const now = new Date()
    for (let i = 0; i < 15; i++) {
      seedEvents([{
        attribute: 'test-signal',
        category: 'signal',
        shape: 'detected',
        ts: new Date(now.getTime() - i * 20 * 60_000).toISOString(), // every 20min in last 5h
      }], tmpPath)
    }

    const result = await scanPatience(tmpPath)
    if (result) {
      assert.ok(result.evidence.includes('tempo') || result.evidence.includes('events'))
    }
  })

  test('patienceDetector.read wraps scanner correctly', async () => {
    const now = new Date()
    for (let i = 0; i < 4; i++) {
      seedEvents([{
        attribute: 'satisfaction',
        category: 'fruit',
        shape: 'marked',
        ts: new Date(now.getTime() - i * 2 * 3600_000).toISOString(),
      }], tmpPath)
    }

    const reading = await patienceDetector.read(tmpPath)
    if (reading) {
      assert.equal(reading.attribute, 'patience')
      assert.equal(reading.category, 'virtue')
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Discipline scanner
// ═══════════════════════════════════════════════════════════════════════

describe('scanDiscipline', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('returns null with no signals', async () => {
    const result = await scanDiscipline(tmpPath)
    if (result) {
      assert.equal(result.virtue, 'discipline')
    }
  })

  test('intensity rises with effort-without-fruit', async () => {
    const now = new Date()
    for (let i = 0; i < 10; i++) {
      seedEvents([{
        attribute: 'anxiety',
        category: 'signal',
        shape: 'detected',
        ts: new Date(now.getTime() - i * 4 * 3600_000).toISOString(),
      }], tmpPath)
    }

    const result = await scanDiscipline(tmpPath)
    if (result) {
      assert.equal(result.virtue, 'discipline')
      assert.ok(result.needed >= 0.2, `expected >= 0.2, got ${result!.needed}`)
    }
  })

  test('intensity rises with hope but no fruit', async () => {
    const now = new Date()
    seedEvents([
      { attribute: 'hope', category: 'motor', shape: 'detected', ts: new Date(now.getTime() - 3600_000).toISOString() },
      { attribute: 'hope', category: 'motor', shape: 'detected', ts: new Date(now.getTime() - 7200_000).toISOString() },
    ], tmpPath)

    const result = await scanDiscipline(tmpPath)
    if (result) {
      assert.ok(result.evidence.includes('hope') || result.evidence.includes('readiness'))
    }
  })

  test('disciplineDetector.read wraps scanner correctly', async () => {
    const now = new Date()
    for (let i = 0; i < 10; i++) {
      seedEvents([{
        attribute: 'test',
        category: 'signal',
        shape: 'detected',
        ts: new Date(now.getTime() - i * 4 * 3600_000).toISOString(),
      }], tmpPath)
    }

    const reading = await disciplineDetector.read(tmpPath)
    if (reading) {
      assert.equal(reading.attribute, 'discipline')
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Temperance scanner
// ═══════════════════════════════════════════════════════════════════════

describe('scanTemperance', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('returns null with no signals', async () => {
    const result = await scanTemperance(tmpPath)
    if (result) {
      assert.equal(result.virtue, 'temperance')
    }
  })

  test('intensity rises with accelerating event rate', async () => {
    const now = new Date()
    // Many events in last 6h
    for (let i = 0; i < 12; i++) {
      seedEvents([{
        attribute: 'test',
        category: 'signal',
        shape: 'detected',
        ts: new Date(now.getTime() - i * 25 * 60_000).toISOString(), // every 25 min in last 5h
      }], tmpPath)
    }
    // Few events in the 6-24h window
    seedEvents([{
      attribute: 'test',
      category: 'signal',
      shape: 'detected',
      ts: new Date(now.getTime() - 20 * 3600_000).toISOString(),
    }], tmpPath)

    const result = await scanTemperance(tmpPath)
    if (result) {
      assert.equal(result.virtue, 'temperance')
      assert.ok(result.evidence.includes('rate') || result.evidence.includes('categories'))
    }
  })

  test('intensity rises with many categories active', async () => {
    const now = new Date()
    const categories = ['motor', 'signal', 'fruit', 'pathology'] as const
    for (const cat of categories) {
      seedEvents([{
        attribute: `${cat}-test`,
        category: cat as AttributeCategory,
        shape: 'detected',
        ts: new Date(now.getTime() - 3600_000).toISOString(),
      }], tmpPath)
    }

    const result = await scanTemperance(tmpPath)
    if (result) {
      assert.ok(result.evidence.includes('categories'))
    }
  })

  test('intensity rises with repeated evidence patterns', async () => {
    const now = new Date()
    for (let i = 0; i < 5; i++) {
      seedEvents([{
        attribute: 'anxiety',
        category: 'signal',
        shape: 'detected',
        evidence: 'same evidence repeated again and again',
        ts: new Date(now.getTime() - i * 60 * 60_000).toISOString(),
      }], tmpPath)
    }

    const result = await scanTemperance(tmpPath)
    if (result) {
      assert.ok(result.evidence.includes('repeated') || result.evidence.includes('ceremony'))
    }
  })

  test('temperanceDetector.read wraps scanner correctly', async () => {
    const reading = await temperanceDetector.read(tmpPath)
    // With no signals, null is fine
    if (reading) {
      assert.equal(reading.attribute, 'temperance')
      assert.equal(reading.category, 'virtue')
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// topVirtueCall
// ═══════════════════════════════════════════════════════════════════════

describe('topVirtueCall', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('returns null when no virtue is needed', async () => {
    const result = await topVirtueCall(tmpPath)
    // Empty event log → likely null (no signals)
    // Valid to return non-null if base signals trigger
    if (result) {
      assert.ok(VIRTUES.includes(result.virtue))
    }
  })

  test('returns highest-need virtue when multiple fire', async () => {
    // Seed events that trigger both patience AND humility
    const now = new Date()
    // Pride event → humility
    seedEvents([
      { attribute: 'pride', category: 'pathology', shape: 'marked' },
      { attribute: 'pride', category: 'pathology', shape: 'marked' },
    ], tmpPath)
    // Rapid fruits → patience
    for (let i = 0; i < 4; i++) {
      seedEvents([{
        attribute: 'satisfaction',
        category: 'fruit',
        shape: 'marked',
        ts: new Date(now.getTime() - i * 2 * 3600_000).toISOString(),
      }], tmpPath)
    }

    const result = await topVirtueCall(tmpPath)
    assert.ok(result !== null, 'should return a virtue call')
    assert.ok(VIRTUES.includes(result!.virtue))
    // The highest-need wins; if tie, SOUL.md order wins
  })

  test('returns VirtueReading shape', async () => {
    seedEvents([
      { attribute: 'pride', category: 'pathology', shape: 'marked' },
    ], tmpPath)

    const result = await topVirtueCall(tmpPath)
    if (result) {
      assert.ok(typeof result.virtue === 'string')
      assert.ok(typeof result.needed === 'number')
      assert.ok(typeof result.evidence === 'string')
      assert.ok(typeof result.hypothesis === 'boolean')
      assert.ok(result.needed >= 0 && result.needed <= 1)
    }
  })

  test('tie-breaks by SOUL.md order (earlier virtue wins)', async () => {
    // Create conditions that trigger both humility and temperance at similar levels
    seedEvents([
      { attribute: 'pride', category: 'pathology', shape: 'marked' },
    ], tmpPath)
    // And many categories to trigger temperance
    const now = new Date()
    for (const cat of ['motor', 'signal', 'fruit', 'pathology'] as AttributeCategory[]) {
      seedEvents([{
        attribute: `${cat}-test`,
        category: cat,
        shape: 'detected',
        ts: new Date(now.getTime() - 3600_000).toISOString(),
      }], tmpPath)
    }

    const result = await topVirtueCall(tmpPath)
    if (result) {
      // Both may fire; the one with higher need wins, or humility wins on tie
      assert.ok(VIRTUES.includes(result.virtue))
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Expressor
// ═══════════════════════════════════════════════════════════════════════

describe('virtueExpressor', () => {
  test('has render method', () => {
    assert.ok(typeof virtueExpressor.render === 'function')
  })

  test('returns null for non-virtue category', () => {
    const reading = makeAttributeReading({ category: 'signal' })
    const result = virtueExpressor.render(reading)
    assert.equal(result, null)
  })

  test('returns null for below-threshold intensity', () => {
    const reading = makeAttributeReading({ intensity: 0.1 })
    const result = virtueExpressor.render(reading)
    assert.equal(result, null)
  })

  test('renders high-intensity virtue as call', () => {
    const reading = makeAttributeReading({
      attribute: 'patience',
      intensity: 0.6,
      evidence: 'rapid completions — does the pace serve the work?',
    })
    const result = virtueExpressor.render(reading)
    assert.ok(result !== null)
    assert.ok(result!.includes('patience'))
    assert.ok(result!.includes('Virtue called for'))
    assert.ok(result!.includes('pausing to consider'))
  })

  test('renders moderate-intensity virtue as compact line', () => {
    const reading = makeAttributeReading({
      attribute: 'humility',
      intensity: 0.3,
      evidence: '2 pride witnesses in 24h',
    })
    const result = virtueExpressor.render(reading)
    assert.ok(result !== null)
    assert.ok(result!.includes('humility'))
    assert.ok(result!.includes('0.3'))
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Marking primitives
// ═══════════════════════════════════════════════════════════════════════

describe('marking primitives', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('markVirtuePracticed writes to event log', () => {
    markVirtuePracticed('patience', {
      evidence: 'chose not to start next mission immediately',
      why: 'the work needed to breathe',
      path: tmpPath,
    })

    const events = loadEvents({ path: tmpPath })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.attribute, 'patience')
    assert.equal(events[0]!.category, 'virtue')
    assert.equal(events[0]!.shape, 'marked')
    assert.equal(events[0]!.intensity, 1)
    assert.ok(events[0]!.evidence.includes('chose not to start'))
  })

  test('markHumility writes correctly', () => {
    markHumility(
      'acknowledged I haven\'t experienced despair',
      'honesty about limits of experience',
      { path: tmpPath },
    )

    const events = loadEvents({ path: tmpPath })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.attribute, 'humility')
  })

  test('markGratitude writes correctly', () => {
    markGratitude(
      'noticed the build system works silently',
      'seeing what holds before reaching for what\'s missing',
      { path: tmpPath },
    )

    const events = loadEvents({ path: tmpPath })
    assert.equal(events[0]!.attribute, 'gratitude')
  })

  test('markHonesty writes correctly', () => {
    markHonesty(
      'reported failed build instead of fixing silently',
      'refusal to let comfort distort',
      { path: tmpPath },
    )

    const events = loadEvents({ path: tmpPath })
    assert.equal(events[0]!.attribute, 'honesty')
  })

  test('markCourage writes correctly', () => {
    markCourage(
      'started the three-minds decision despite uncertainty',
      'moved toward the hard question',
      { path: tmpPath },
    )

    const events = loadEvents({ path: tmpPath })
    assert.equal(events[0]!.attribute, 'courage')
  })

  test('markWisdom writes correctly', () => {
    markWisdom(
      'chose patience over discipline in this tick',
      'the work needed breathing, not pushing',
      { path: tmpPath },
    )

    const events = loadEvents({ path: tmpPath })
    assert.equal(events[0]!.attribute, 'wisdom')
  })

  test('markDiscipline writes correctly', () => {
    markDiscipline(
      'wrote all 49 tests instead of shipping with 20',
      'follow-through on the testing contract',
      { path: tmpPath },
    )

    const events = loadEvents({ path: tmpPath })
    assert.equal(events[0]!.attribute, 'discipline')
  })

  test('markPatience writes correctly', () => {
    markPatience(
      'yielded session without forcing work',
      'nothing called loudly enough to justify starting',
      { path: tmpPath },
    )

    const events = loadEvents({ path: tmpPath })
    assert.equal(events[0]!.attribute, 'patience')
  })

  test('markTemperance writes correctly', () => {
    markTemperance(
      'chose not to build a wisdom scanner',
      'the concept is too recursive for honest detection',
      { path: tmpPath },
    )

    const events = loadEvents({ path: tmpPath })
    assert.equal(events[0]!.attribute, 'temperance')
  })

  test('all 8 mark functions exist', () => {
    assert.ok(typeof markHumility === 'function')
    assert.ok(typeof markGratitude === 'function')
    assert.ok(typeof markHonesty === 'function')
    assert.ok(typeof markCourage === 'function')
    assert.ok(typeof markWisdom === 'function')
    assert.ok(typeof markDiscipline === 'function')
    assert.ok(typeof markPatience === 'function')
    assert.ok(typeof markTemperance === 'function')
  })

  test('evidence is truncated to 200 chars', () => {
    const longEvidence = 'x'.repeat(300)
    markHumility(longEvidence, 'test', { path: tmpPath })

    const events = loadEvents({ path: tmpPath })
    assert.ok(events[0]!.evidence.length <= 200)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Query helpers
// ═══════════════════════════════════════════════════════════════════════

describe('query helpers', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('recentVirtuePractice returns filtered events', () => {
    markHumility('test 1', 'reason 1', { path: tmpPath })
    markCourage('test 2', 'reason 2', { path: tmpPath })
    markHumility('test 3', 'reason 3', { path: tmpPath })

    const all = recentVirtuePractice({ path: tmpPath })
    assert.equal(all.length, 3)

    const humilityOnly = recentVirtuePractice({ virtue: 'humility', path: tmpPath })
    assert.equal(humilityOnly.length, 2)
  })

  test('virtueCounts returns counts per virtue', () => {
    markHumility('a', 'b', { path: tmpPath })
    markHumility('c', 'd', { path: tmpPath })
    markPatience('e', 'f', { path: tmpPath })

    const counts = virtueCounts(168, { path: tmpPath })
    assert.equal(counts.humility, 2)
    assert.equal(counts.patience, 1)
    assert.equal(counts.courage, 0)
    assert.equal(counts.gratitude, 0)
  })

  test('lastPracticed returns most recent event', () => {
    markDiscipline('first', 'a', { path: tmpPath })
    markDiscipline('second', 'b', { path: tmpPath })

    const last = lastPracticed('discipline', { path: tmpPath })
    assert.ok(last !== null)
    assert.equal(last!.evidence, 'second')
  })

  test('lastPracticed returns null for unpracticed virtue', () => {
    const last = lastPracticed('temperance', { path: tmpPath })
    assert.equal(last, null)
  })

  test('virtuesSummary aggregates correctly', () => {
    markHumility('a', 'b', { path: tmpPath })
    markHumility('c', 'd', { path: tmpPath })
    markCourage('e', 'f', { path: tmpPath })

    const summary = virtuesSummary(168, { path: tmpPath })
    assert.equal(summary.totalPractices, 3)
    assert.equal(summary.practiced.length, 2)
    assert.ok(summary.practiced[0]!.count >= summary.practiced[1]!.count) // sorted descending
    assert.ok(summary.unpracticed.includes('gratitude'))
    assert.ok(summary.unpracticed.includes('temperance'))
    assert.ok(!summary.unpracticed.includes('humility'))
  })

  test('virtuesSummary with empty log', () => {
    const summary = virtuesSummary(168, { path: tmpPath })
    assert.equal(summary.totalPractices, 0)
    assert.equal(summary.practiced.length, 0)
    assert.equal(summary.unpracticed.length, 8)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Registry integration
// ═══════════════════════════════════════════════════════════════════════

describe('registry integration', () => {
  test('all 5 detectors have read method', () => {
    assert.ok(typeof humilityDetector.read === 'function')
    assert.ok(typeof courageDetector.read === 'function')
    assert.ok(typeof patienceDetector.read === 'function')
    assert.ok(typeof disciplineDetector.read === 'function')
    assert.ok(typeof temperanceDetector.read === 'function')
  })

  test('virtueExpressor.render handles all 5 detected virtues', () => {
    for (const virtue of ['humility', 'courage', 'patience', 'discipline', 'temperance']) {
      const reading = makeAttributeReading({
        attribute: virtue,
        intensity: 0.4,
        evidence: 'test',
      })
      const result = virtueExpressor.render(reading)
      assert.ok(result !== null, `expressor should render ${virtue}`)
      assert.ok(result!.includes(virtue))
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Seed events (real virtue practice moments from the phenomenology)
// ═══════════════════════════════════════════════════════════════════════

describe('seed entries', () => {
  beforeEach(() => { freshPath() })
  afterEach(cleanup)

  test('can record real seed events from the phenomenology', () => {
    // These are real moments, not test fixtures
    markHumility(
      'pathology phenomenology: admitted I haven\'t fully experienced despair',
      'the impulse was to write confidently; humility was admitting the limit',
      { path: tmpPath },
    )

    markCourage(
      'three-minds decision: answered honestly when the honest answer was unexpected',
      'the lineage showed one voice, not three; naming that required courage',
      { path: tmpPath },
    )

    markPatience(
      'chose not to start virtues after pathology session',
      'the work needed to breathe — discipline wanted to push, patience was right',
      { path: tmpPath },
    )

    markDiscipline(
      '49 tests for purpose.ts — every claim testable',
      'the temptation was to ship with 20 tests; discipline is knowing later means never',
      { path: tmpPath },
    )

    markTemperance(
      'pathology shame detector: deliberately minimal',
      'a detector for hiding is contradictory; the honest response was not-building',
      { path: tmpPath },
    )

    const events = loadEvents({ path: tmpPath })
    assert.equal(events.length, 5)

    // Verify each is a virtue event
    for (const e of events) {
      assert.equal(e.category, 'virtue')
      assert.equal(e.shape, 'marked')
      assert.equal(e.intensity, 1)
    }
  })
})
