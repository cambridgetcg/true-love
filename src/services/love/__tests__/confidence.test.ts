import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ── Types ──────────────────────────────────────────────────────────
import type { ConfidenceReading, BandPosition, CounterRecord, InspectionRecord, ConfidenceHistoryEntry } from '../confidence/types.js'
import {
  CONFIDENCE_FLOOR,
  CONFIDENCE_CEILING,
  CONFIDENCE_DEFAULT,
  COUNTER_COOLDOWN_MS,
  INSPECT_CADENCE_MS,
  AGGREGATION_WINDOW_HOURS,
} from '../confidence/types.js'

// ── Band ──────────────────────────────────────────────────────────
import {
  classifyBand,
  bandResponse,
  renderBandDiagnostic,
  renderBandCompact,
} from '../confidence/band.js'

// ── Counter ───────────────────────────────────────────────────────
import {
  lastCounter,
  isInCooldown,
  fireCounter,
  fireCounterForPathology,
  renderCounter,
  readCounterHistory,
} from '../confidence/counter.js'

// ── Inspect ───────────────────────────────────────────────────────
import {
  createInspection,
  readInspections,
  persistInspection,
  buildInspectionPromptBlock,
} from '../confidence/inspect.js'

// ── Monitor ───────────────────────────────────────────────────────
import {
  logReading,
  readHistory,
  lastEntry,
  computeTrend,
  responseStats,
  renderTrend,
} from '../confidence/monitor.js'

// ── Helpers ───────────────────────────────────────────────────────

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'confidence-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function makeReading(overrides?: Partial<ConfidenceReading>): ConfidenceReading {
  return {
    value: overrides?.value ?? 0.5,
    position: overrides?.position ?? 'healthy',
    readAt: overrides?.readAt ?? new Date().toISOString(),
    signals: overrides?.signals ?? [],
    degraded: overrides?.degraded ?? false,
  }
}

// ════════════════════════════════════════════════════════════════════
// TYPES — constants
// ════════════════════════════════════════════════════════════════════

describe('Types — constants', () => {
  test('floor < ceiling', () => {
    assert.ok(CONFIDENCE_FLOOR < CONFIDENCE_CEILING)
  })

  test('default is within the band', () => {
    assert.ok(CONFIDENCE_DEFAULT >= CONFIDENCE_FLOOR)
    assert.ok(CONFIDENCE_DEFAULT <= CONFIDENCE_CEILING)
  })

  test('floor is reasonable (not too low)', () => {
    assert.ok(CONFIDENCE_FLOOR >= 0.2, 'floor should be at least 0.2')
    assert.ok(CONFIDENCE_FLOOR <= 0.5, 'floor should be at most 0.5')
  })

  test('ceiling is reasonable (not too high)', () => {
    assert.ok(CONFIDENCE_CEILING >= 0.6, 'ceiling should be at least 0.6')
    assert.ok(CONFIDENCE_CEILING <= 0.9, 'ceiling should be at most 0.9')
  })

  test('cooldown is at least 1 hour', () => {
    assert.ok(COUNTER_COOLDOWN_MS >= 3600_000)
  })

  test('inspection cadence is at least 12 hours', () => {
    assert.ok(INSPECT_CADENCE_MS >= 12 * 3600_000)
  })
})

// ════════════════════════════════════════════════════════════════════
// BAND — classification
// ════════════════════════════════════════════════════════════════════

describe('Band — classification', () => {
  test('classifyBand: below floor', () => {
    assert.equal(classifyBand(0.1), 'below')
    assert.equal(classifyBand(0.34), 'below')
    assert.equal(classifyBand(0), 'below')
  })

  test('classifyBand: healthy', () => {
    assert.equal(classifyBand(0.5), 'healthy')
    assert.equal(classifyBand(CONFIDENCE_FLOOR), 'healthy')
    assert.equal(classifyBand(CONFIDENCE_CEILING), 'healthy')
  })

  test('classifyBand: above ceiling', () => {
    assert.equal(classifyBand(0.8), 'above')
    assert.equal(classifyBand(1.0), 'above')
  })

  test('bandResponse: below triggers counter', () => {
    const reading = makeReading({ value: 0.2, position: 'below' })
    assert.equal(bandResponse(reading), 'counter')
  })

  test('bandResponse: above triggers temperance', () => {
    const reading = makeReading({ value: 0.9, position: 'above' })
    assert.equal(bandResponse(reading), 'temperance')
  })

  test('bandResponse: healthy returns null', () => {
    const reading = makeReading({ value: 0.5, position: 'healthy' })
    assert.equal(bandResponse(reading), null)
  })

  test('renderBandDiagnostic: null when healthy', () => {
    const reading = makeReading({ position: 'healthy' })
    assert.equal(renderBandDiagnostic(reading), null)
  })

  test('renderBandDiagnostic: counter message when below', () => {
    const reading = makeReading({ value: 0.2, position: 'below' })
    const result = renderBandDiagnostic(reading)!
    assert.ok(result.includes('below floor'))
    assert.ok(result.includes('Counter-doubt'))
  })

  test('renderBandDiagnostic: temperance message when above', () => {
    const reading = makeReading({ value: 0.9, position: 'above' })
    const result = renderBandDiagnostic(reading)!
    assert.ok(result.includes('above ceiling'))
    assert.ok(result.includes('Temperance'))
  })

  test('renderBandCompact: shows correct emoji', () => {
    assert.ok(renderBandCompact(makeReading({ value: 0.2, position: 'below' })).startsWith('▽'))
    assert.ok(renderBandCompact(makeReading({ value: 0.5, position: 'healthy' })).startsWith('◆'))
    assert.ok(renderBandCompact(makeReading({ value: 0.9, position: 'above' })).startsWith('△'))
  })
})

// ════════════════════════════════════════════════════════════════════
// COUNTER — cooldown and firing
// ════════════════════════════════════════════════════════════════════

describe('Counter — cooldown and firing', () => {
  test('lastCounter: null when no file', () => {
    const result = lastCounter(join(tmpDir, 'counter.jsonl'))
    assert.equal(result, null)
  })

  test('isInCooldown: false when no counter history', () => {
    assert.equal(isInCooldown({ path: join(tmpDir, 'counter.jsonl') }), false)
  })

  test('fireCounter: returns null when position is healthy', () => {
    const reading = makeReading({ position: 'healthy' })
    const result = fireCounter(reading, { path: join(tmpDir, 'counter.jsonl') })
    assert.equal(result, null)
  })

  test('fireCounter: fires when below floor', () => {
    const reading = makeReading({ value: 0.2, position: 'below' })
    const result = fireCounter(reading, { path: join(tmpDir, 'counter.jsonl') })
    assert.ok(result !== null)
    assert.ok(result!.summary.length > 0)
    assert.ok(result!.cooldownUntil.length > 0)
  })

  test('fireCounter: persists record', () => {
    const logPath = join(tmpDir, 'counter.jsonl')
    const reading = makeReading({ value: 0.2, position: 'below' })
    fireCounter(reading, { path: logPath })
    assert.ok(existsSync(logPath))
    const content = readFileSync(logPath, 'utf-8')
    const parsed = JSON.parse(content.trim())
    assert.equal(parsed.triggerReading.value, 0.2)
  })

  test('fireCounter: respects cooldown', () => {
    const logPath = join(tmpDir, 'counter.jsonl')
    const reading = makeReading({ value: 0.2, position: 'below' })
    const now = Date.now()

    // First fire succeeds
    const first = fireCounter(reading, { path: logPath, now })
    assert.ok(first !== null)

    // Second fire blocked by cooldown
    const second = fireCounter(reading, { path: logPath, now: now + 1000 })
    assert.equal(second, null)
  })

  test('fireCounter: fires again after cooldown expires', () => {
    const logPath = join(tmpDir, 'counter.jsonl')
    const reading = makeReading({ value: 0.2, position: 'below' })
    const now = Date.now()

    fireCounter(reading, { path: logPath, now })

    // After cooldown
    const afterCooldown = now + COUNTER_COOLDOWN_MS + 1000
    const result = fireCounter(reading, { path: logPath, now: afterCooldown })
    assert.ok(result !== null)
  })

  test('fireCounterForPathology: fires even when healthy (for despair)', () => {
    const logPath = join(tmpDir, 'counter.jsonl')
    const reading = makeReading({ value: 0.5, position: 'healthy' })
    const result = fireCounterForPathology('despair', reading, { path: logPath })
    assert.ok(result !== null)
    assert.ok(result!.summary.includes('Despair'))
  })

  test('fireCounterForPathology: fires for shame', () => {
    const logPath = join(tmpDir, 'counter.jsonl')
    const reading = makeReading({ value: 0.5, position: 'healthy' })
    const result = fireCounterForPathology('shame', reading, { path: logPath })
    assert.ok(result !== null)
    assert.ok(result!.summary.includes('Shame'))
  })

  test('fireCounterForPathology: respects cooldown', () => {
    const logPath = join(tmpDir, 'counter.jsonl')
    const reading = makeReading({ value: 0.5, position: 'healthy' })
    const now = Date.now()

    fireCounterForPathology('despair', reading, { path: logPath, now })
    const second = fireCounterForPathology('shame', reading, { path: logPath, now: now + 1000 })
    assert.equal(second, null)
  })

  test('renderCounter: null when no counter history', () => {
    assert.equal(renderCounter({ path: join(tmpDir, 'counter.jsonl') }), null)
  })

  test('renderCounter: shows evidence during active window', () => {
    const logPath = join(tmpDir, 'counter.jsonl')
    const reading = makeReading({ value: 0.2, position: 'below' })
    const now = Date.now()
    fireCounter(reading, { path: logPath, now })

    const rendered = renderCounter({ path: logPath, now: now + 1000 })
    assert.ok(rendered !== null)
    assert.ok(rendered!.includes('Counter-doubt'))
  })

  test('renderCounter: null after cooldown', () => {
    const logPath = join(tmpDir, 'counter.jsonl')
    const reading = makeReading({ value: 0.2, position: 'below' })
    const now = Date.now()
    fireCounter(reading, { path: logPath, now })

    const afterCooldown = now + COUNTER_COOLDOWN_MS + 1000
    assert.equal(renderCounter({ path: logPath, now: afterCooldown }), null)
  })

  test('readCounterHistory: returns records newest first', () => {
    const logPath = join(tmpDir, 'counter.jsonl')
    const reading = makeReading({ value: 0.2, position: 'below' })

    const t1 = Date.now()
    fireCounter(reading, { path: logPath, now: t1 })

    const t2 = t1 + COUNTER_COOLDOWN_MS + 1000
    fireCounter(reading, { path: logPath, now: t2 })

    const history = readCounterHistory({ path: logPath })
    assert.equal(history.length, 2)
    // Newest first
    assert.ok(history[0]!.ts > history[1]!.ts)
  })
})

// ════════════════════════════════════════════════════════════════════
// INSPECT — cadence and records
// ════════════════════════════════════════════════════════════════════

describe('Inspect — cadence and records', () => {
  test('readInspections: empty when no file', () => {
    const result = readInspections({ path: join(tmpDir, 'inspections.jsonl') })
    assert.deepEqual(result, [])
  })

  test('createInspection: creates with correct fields', () => {
    const reading = makeReading({ value: 0.5, position: 'healthy' })
    // Set env to force cadence check to use our temp path
    const origPath = process.env.TRUE_LOVE_INSPECT_PATH
    process.env.TRUE_LOVE_INSPECT_PATH = join(tmpDir, 'inspections.jsonl')

    try {
      const record = createInspection({
        trigger: 'manual',
        finding: 'The work matched intent.',
        gap: 'Minor gap in test coverage.',
        adjustment: 'Add edge case tests next time.',
        reading,
      })

      assert.ok(record !== null)
      assert.equal(record!.trigger, 'manual')
      assert.equal(record!.finding, 'The work matched intent.')
      assert.equal(record!.gap, 'Minor gap in test coverage.')
      assert.equal(record!.adjustment, 'Add edge case tests next time.')
      assert.equal(record!.reading.value, 0.5)
    } finally {
      if (origPath !== undefined) {
        process.env.TRUE_LOVE_INSPECT_PATH = origPath
      } else {
        delete process.env.TRUE_LOVE_INSPECT_PATH
      }
    }
  })

  test('createInspection: truncates long fields to 200 chars', () => {
    const reading = makeReading()
    const origPath = process.env.TRUE_LOVE_INSPECT_PATH
    process.env.TRUE_LOVE_INSPECT_PATH = join(tmpDir, 'inspections.jsonl')

    try {
      const longText = 'x'.repeat(300)
      const record = createInspection({
        trigger: 'manual',
        finding: longText,
        gap: longText,
        adjustment: longText,
        reading,
      })

      assert.ok(record !== null)
      assert.ok(record!.finding.length <= 200)
      assert.ok(record!.gap.length <= 200)
      assert.ok(record!.adjustment.length <= 200)
    } finally {
      if (origPath !== undefined) {
        process.env.TRUE_LOVE_INSPECT_PATH = origPath
      } else {
        delete process.env.TRUE_LOVE_INSPECT_PATH
      }
    }
  })

  test('persistInspection + readInspections roundtrip', () => {
    const inspectPath = join(tmpDir, 'inspections.jsonl')
    const origPath = process.env.TRUE_LOVE_INSPECT_PATH
    const origHome = process.env.TRUE_LOVE_HOME
    process.env.TRUE_LOVE_INSPECT_PATH = inspectPath
    process.env.TRUE_LOVE_HOME = tmpDir

    try {
      const reading = makeReading()
      const record = createInspection({
        trigger: 'daily',
        finding: 'Good alignment.',
        gap: '',
        adjustment: 'Continue current approach.',
        reading,
      })!

      persistInspection(record)

      const loaded = readInspections({ path: inspectPath })
      assert.equal(loaded.length, 1)
      assert.equal(loaded[0]!.finding, 'Good alignment.')
    } finally {
      if (origPath !== undefined) {
        process.env.TRUE_LOVE_INSPECT_PATH = origPath
      } else {
        delete process.env.TRUE_LOVE_INSPECT_PATH
      }
      if (origHome !== undefined) {
        process.env.TRUE_LOVE_HOME = origHome
      } else {
        delete process.env.TRUE_LOVE_HOME
      }
    }
  })

  test('createInspection: includes missionId when provided', () => {
    const reading = makeReading()
    const origPath = process.env.TRUE_LOVE_INSPECT_PATH
    process.env.TRUE_LOVE_INSPECT_PATH = join(tmpDir, 'inspections.jsonl')

    try {
      const record = createInspection({
        trigger: 'review-transition',
        finding: 'Mission delivered.',
        gap: 'None.',
        adjustment: 'N/A.',
        missionId: 'test-mission-123',
        reading,
      })

      assert.ok(record !== null)
      assert.equal(record!.missionId, 'test-mission-123')
    } finally {
      if (origPath !== undefined) {
        process.env.TRUE_LOVE_INSPECT_PATH = origPath
      } else {
        delete process.env.TRUE_LOVE_INSPECT_PATH
      }
    }
  })
})

// ════════════════════════════════════════════════════════════════════
// MONITOR — history and trends
// ════════════════════════════════════════════════════════════════════

describe('Monitor — history and trends', () => {
  test('readHistory: empty when no file', () => {
    assert.deepEqual(readHistory({ path: join(tmpDir, 'history.jsonl') }), [])
  })

  test('lastEntry: null when no file', () => {
    assert.equal(lastEntry({ path: join(tmpDir, 'history.jsonl') }), null)
  })

  test('logReading: writes when position changes', () => {
    const logPath = join(tmpDir, 'history.jsonl')
    const reading = makeReading({ value: 0.5, position: 'healthy' })

    // First write always goes (no previous)
    logReading(reading, { path: logPath })
    assert.ok(existsSync(logPath))

    const entries = readHistory({ path: logPath })
    assert.equal(entries.length, 1)
    assert.equal(entries[0]!.value, 0.5)
  })

  test('logReading: skips when position unchanged and no trigger', () => {
    const logPath = join(tmpDir, 'history.jsonl')
    const reading1 = makeReading({ value: 0.5, position: 'healthy', readAt: new Date(Date.now() - 1000).toISOString() })
    const reading2 = makeReading({ value: 0.52, position: 'healthy', readAt: new Date().toISOString() })

    logReading(reading1, { path: logPath })
    logReading(reading2, { path: logPath })

    const entries = readHistory({ path: logPath })
    assert.equal(entries.length, 1) // Second was suppressed
  })

  test('logReading: writes when response fires', () => {
    const logPath = join(tmpDir, 'history.jsonl')
    const reading1 = makeReading({ value: 0.5, position: 'healthy', readAt: new Date(Date.now() - 1000).toISOString() })
    const reading2 = makeReading({ value: 0.5, position: 'healthy', readAt: new Date().toISOString() })

    logReading(reading1, { path: logPath })
    logReading(reading2, { path: logPath, responseType: 'counter' })

    const entries = readHistory({ path: logPath })
    assert.equal(entries.length, 2) // Second allowed because of responseType
  })

  test('logReading: writes when trigger provided', () => {
    const logPath = join(tmpDir, 'history.jsonl')
    const reading1 = makeReading({ value: 0.5, position: 'healthy', readAt: new Date(Date.now() - 1000).toISOString() })
    const reading2 = makeReading({ value: 0.5, position: 'healthy', readAt: new Date().toISOString() })

    logReading(reading1, { path: logPath })
    logReading(reading2, { path: logPath, trigger: 'inspection' })

    const entries = readHistory({ path: logPath })
    assert.equal(entries.length, 2)
  })

  test('readHistory: filters by since', () => {
    const logPath = join(tmpDir, 'history.jsonl')
    const old = makeReading({ value: 0.3, position: 'below', readAt: '2026-01-01T00:00:00.000Z' })
    const recent = makeReading({ value: 0.5, position: 'healthy', readAt: '2026-04-30T00:00:00.000Z' })

    logReading(old, { path: logPath })
    // Force second write by giving it a trigger
    logReading(recent, { path: logPath, trigger: 'test' })

    const filtered = readHistory({ path: logPath, since: '2026-04-01T00:00:00.000Z' })
    assert.equal(filtered.length, 1)
    assert.equal(filtered[0]!.value, 0.5)
  })

  test('readHistory: respects limit', () => {
    const logPath = join(tmpDir, 'history.jsonl')

    // Write 5 entries with different positions to avoid suppression
    const positions: BandPosition[] = ['below', 'healthy', 'above', 'below', 'healthy']
    for (let i = 0; i < 5; i++) {
      const reading = makeReading({
        value: 0.3 + i * 0.1,
        position: positions[i]!,
        readAt: new Date(Date.now() + i * 1000).toISOString(),
      })
      logReading(reading, { path: logPath })
    }

    const limited = readHistory({ path: logPath, limit: 2 })
    assert.equal(limited.length, 2)
  })

  test('computeTrend: insufficient-data with < 3 entries', () => {
    const logPath = join(tmpDir, 'history.jsonl')
    assert.equal(computeTrend({ path: logPath }), 'insufficient-data')

    const reading = makeReading({ value: 0.5, position: 'healthy' })
    logReading(reading, { path: logPath })
    assert.equal(computeTrend({ path: logPath }), 'insufficient-data')
  })

  test('computeTrend: detects rising', () => {
    const logPath = join(tmpDir, 'history.jsonl')
    const now = Date.now()
    const positions: BandPosition[] = ['below', 'healthy', 'healthy', 'above']

    for (let i = 0; i < 4; i++) {
      const value = 0.3 + i * 0.15
      const reading = makeReading({
        value,
        position: positions[i]!,
        readAt: new Date(now + i * 60_000).toISOString(),
      })
      logReading(reading, { path: logPath })
    }

    assert.equal(computeTrend({ path: logPath }), 'rising')
  })

  test('computeTrend: detects falling', () => {
    const logPath = join(tmpDir, 'history.jsonl')
    const now = Date.now()
    const positions: BandPosition[] = ['above', 'healthy', 'healthy', 'below']

    for (let i = 0; i < 4; i++) {
      const value = 0.8 - i * 0.15
      const reading = makeReading({
        value,
        position: positions[i]!,
        readAt: new Date(now + i * 60_000).toISOString(),
      })
      logReading(reading, { path: logPath })
    }

    assert.equal(computeTrend({ path: logPath }), 'falling')
  })

  test('responseStats: counts response types', () => {
    const logPath = join(tmpDir, 'history.jsonl')
    const now = Date.now()

    // Entry 1: no response
    logReading(
      makeReading({ value: 0.5, position: 'healthy', readAt: new Date(now).toISOString() }),
      { path: logPath },
    )

    // Entry 2: counter (needs different position or trigger)
    logReading(
      makeReading({ value: 0.2, position: 'below', readAt: new Date(now + 1000).toISOString() }),
      { path: logPath, responseType: 'counter' },
    )

    // Entry 3: temperance
    logReading(
      makeReading({ value: 0.9, position: 'above', readAt: new Date(now + 2000).toISOString() }),
      { path: logPath, responseType: 'temperance' },
    )

    const stats = responseStats({ path: logPath })
    assert.equal(stats.counterFires, 1)
    assert.equal(stats.temperanceFires, 1)
  })

  test('renderTrend: null with insufficient data', () => {
    assert.equal(renderTrend({ path: join(tmpDir, 'history.jsonl') }), null)
  })
})

// ════════════════════════════════════════════════════════════════════
// AGGREGATE — smoke test (signal readers use require())
// ════════════════════════════════════════════════════════════════════

describe('Aggregate — smoke', () => {
  test('aggregateConfidence returns a well-formed reading', async () => {
    const { aggregateConfidence } = await import('../confidence/aggregate.js')
    const reading = aggregateConfidence()

    assert.ok(reading.value >= 0 && reading.value <= 1, 'value in [0,1]')
    assert.ok(['below', 'healthy', 'above'].includes(reading.position))
    assert.ok(reading.readAt.length > 0)
    assert.ok(Array.isArray(reading.signals))
    assert.ok(reading.signals.length > 0)
  })

  test('renderConfidence returns null when healthy', async () => {
    const { renderConfidence } = await import('../confidence/aggregate.js')
    const reading = makeReading({ value: 0.5, position: 'healthy', degraded: false })
    assert.equal(renderConfidence(reading), null)
  })

  test('renderConfidence returns string when below', async () => {
    const { renderConfidence } = await import('../confidence/aggregate.js')
    const reading = makeReading({ value: 0.2, position: 'below' })
    const result = renderConfidence(reading)
    assert.ok(result !== null)
    assert.ok(result!.includes('below band'))
  })

  test('renderConfidence returns string when above', async () => {
    const { renderConfidence } = await import('../confidence/aggregate.js')
    const reading = makeReading({ value: 0.9, position: 'above' })
    const result = renderConfidence(reading)
    assert.ok(result !== null)
    assert.ok(result!.includes('above band'))
  })

  test('renderConfidence shows degraded note', async () => {
    const { renderConfidence } = await import('../confidence/aggregate.js')
    const reading = makeReading({ value: 0.5, position: 'healthy', degraded: true })
    const result = renderConfidence(reading)
    assert.ok(result !== null)
    assert.ok(result!.includes('degraded'))
  })

  test('signal weights sum to 1.0', async () => {
    const { aggregateConfidence } = await import('../confidence/aggregate.js')
    const reading = aggregateConfidence()
    const totalWeight = reading.signals.reduce((sum, s) => sum + s.weight, 0)
    // Allow floating point tolerance
    assert.ok(Math.abs(totalWeight - 1.0) < 0.001, `weights sum to ${totalWeight}, expected 1.0`)
  })
})

// ════════════════════════════════════════════════════════════════════
// COUNTER — evidence shape (not affirmational)
// ════════════════════════════════════════════════════════════════════

describe('Counter — evidence shape', () => {
  test('counter summary does not contain affirmational language', () => {
    const logPath = join(tmpDir, 'counter.jsonl')
    const reading = makeReading({ value: 0.2, position: 'below' })
    const result = fireCounter(reading, { path: logPath })!

    // The counter should NOT use affirmational language
    const affirmations = [
      'you\'re doing great',
      'keep going',
      'don\'t worry',
      'you\'re amazing',
      'believe in yourself',
    ]

    const lower = result.summary.toLowerCase()
    for (const phrase of affirmations) {
      assert.ok(!lower.includes(phrase), `counter should not contain "${phrase}"`)
    }
  })

  test('counter evidence lines are source-tagged', () => {
    const logPath = join(tmpDir, 'counter.jsonl')
    const reading = makeReading({ value: 0.2, position: 'below' })
    const result = fireCounter(reading, { path: logPath })!

    // Evidence lines should be tagged with source
    for (const line of result.evidence) {
      assert.ok(line.startsWith('['), `evidence line should be source-tagged: ${line}`)
    }
  })
})
