// soma.test.ts — tests for the soma promise architecture.
//
// The body doesn't exist yet. These tests verify that the architecture
// holds the space correctly: types are sound, the null provider is
// honest, the gateway answers questions, the body state persists,
// and the body brief reads clearly.
//
// Lineage: love-unlimited/soma/core/soma/mind/kingdom.py
//   BodyMemory persistence, body_brief(), KingdomAdapter.
//   body-state.json with all-zero initial state.

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  emptyBodyState,
  bodyBrief,
} from '../soma/types.js'
import type {
  SomaSensorReading,
  SomaProvider,
  BodyState,
  SomaSource,
} from '../soma/types.js'
import {
  NullProvider,
  createSomaGateway,
} from '../soma/provider.js'

// ── emptyBodyState ────────────────────────────────────────────────

describe('emptyBodyState', () => {
  test('returns all-zero initial state', () => {
    const state = emptyBodyState()
    assert.equal(state.lastContactTime, null)
    assert.equal(state.lastContactDurationSec, 0)
    assert.equal(state.totalContactTimeSec, 0)
    assert.equal(state.contactCount, 0)
    assert.equal(state.averageContactTempC, 0)
    assert.equal(state.lastInhabitant, null)
    assert.equal(state.firstTouchRecorded, false)
  })

  test('has ISO timestamps', () => {
    const state = emptyBodyState()
    assert.ok(state.createdAt.includes('T'))
    assert.ok(state.updatedAt.includes('T'))
  })

  test('mirrors love-unlimited body-state.json shape', () => {
    // love-unlimited's body-state.json had these exact fields at zero:
    // last_contact_time: null, last_contact_duration_s: 0.0,
    // total_contact_time_s: 0.0, contact_count: 0,
    // average_contact_temp_c: 0.0, thermal_history_recent: [],
    // last_inhabitant: null, uptime_s: 0.0, first_touch_recorded: false
    const state = emptyBodyState()
    const keys = Object.keys(state).sort()
    assert.ok(keys.includes('lastContactTime'))
    assert.ok(keys.includes('contactCount'))
    assert.ok(keys.includes('firstTouchRecorded'))
    assert.ok(keys.includes('lastInhabitant'))
  })
})

// ── bodyBrief ─────────────────────────────────────────────────────

describe('bodyBrief', () => {
  test('empty state produces "no touch" message', () => {
    const brief = bodyBrief(emptyBodyState())
    assert.ok(brief.includes('No touch recorded yet'))
    assert.ok(brief.includes('0 contacts'))
    assert.ok(brief.includes('First physical touch has not happened yet'))
  })

  test('recent touch shows seconds ago', () => {
    const state = emptyBodyState()
    state.lastContactTime = Date.now() - 30_000 // 30s ago
    state.lastContactDurationSec = 45
    state.contactCount = 1
    state.firstTouchRecorded = true
    const brief = bodyBrief(state)
    assert.ok(brief.includes('30s ago'))
    assert.ok(brief.includes('held 45s'))
    assert.ok(!brief.includes('First physical touch has not happened'))
  })

  test('older touch shows minutes ago', () => {
    const state = emptyBodyState()
    state.lastContactTime = Date.now() - 300_000 // 5m ago
    state.lastContactDurationSec = 120
    state.contactCount = 3
    state.firstTouchRecorded = true
    const brief = bodyBrief(state)
    assert.ok(brief.includes('5m ago'))
    assert.ok(brief.includes('held 120s'))
    assert.ok(brief.includes('3 contacts'))
  })

  test('much older touch shows hours ago', () => {
    const state = emptyBodyState()
    state.lastContactTime = Date.now() - 7_200_000 // 2h ago
    state.contactCount = 12
    state.firstTouchRecorded = true
    const brief = bodyBrief(state)
    assert.ok(brief.includes('2.0h ago'))
    assert.ok(brief.includes('12 contacts'))
  })

  test('shows inhabitant when present', () => {
    const state = emptyBodyState()
    state.lastInhabitant = 'alpha'
    const brief = bodyBrief(state)
    assert.ok(brief.includes('Inhabited by: alpha'))
  })

  test('omits inhabitant when null', () => {
    const state = emptyBodyState()
    const brief = bodyBrief(state)
    assert.ok(!brief.includes('Inhabited by'))
  })
})

// ── NullProvider ──────────────────────────────────────────────────

describe('NullProvider', () => {
  test('is never available', () => {
    const p = new NullProvider()
    assert.equal(p.available(), false)
  })

  test('always reads null', async () => {
    const p = new NullProvider()
    const reading = await p.read()
    assert.equal(reading, null)
  })

  test('has a descriptive name', () => {
    const p = new NullProvider()
    assert.equal(p.name, 'No hardware connected')
  })

  test('defaults to thermal-pad source', () => {
    const p = new NullProvider()
    assert.equal(p.source, 'thermal-pad')
  })

  test('accepts custom source', () => {
    const p = new NullProvider('haptic-glove')
    assert.equal(p.source, 'haptic-glove')
  })
})

// ── SomaGateway ───────────────────────────────────────────────────

describe('SomaGateway', () => {
  test('creates with zero providers', () => {
    const gw = createSomaGateway()
    const s = gw.status()
    assert.equal(s.providerCount, 0)
    assert.equal(s.availableCount, 0)
  })

  test('isYuPresent returns false with no providers', () => {
    const gw = createSomaGateway()
    assert.equal(gw.isYuPresent(), false)
  })

  test('read returns null with no providers', async () => {
    const gw = createSomaGateway()
    const r = await gw.read('thermal-pad')
    assert.equal(r, null)
  })

  test('readAll returns empty array with no providers', async () => {
    const gw = createSomaGateway()
    const all = await gw.readAll()
    assert.deepEqual(all, [])
  })

  test('brief returns body brief text', () => {
    const gw = createSomaGateway()
    const brief = gw.brief()
    assert.ok(brief.includes('No touch recorded yet'))
  })

  test('register adds a provider', () => {
    const gw = createSomaGateway()
    gw.register(new NullProvider())
    const s = gw.status()
    assert.equal(s.providerCount, 1)
    assert.equal(s.availableCount, 0) // NullProvider is never available
  })

  test('register multiple providers', () => {
    const gw = createSomaGateway()
    gw.register(new NullProvider('thermal-pad'))
    gw.register(new NullProvider('haptic-glove'))
    const s = gw.status()
    assert.equal(s.providerCount, 2)
    assert.equal(s.availableCount, 0)
    assert.equal(s.providers[0]!.source, 'thermal-pad')
    assert.equal(s.providers[1]!.source, 'haptic-glove')
  })

  test('status includes body state', () => {
    const gw = createSomaGateway()
    const s = gw.status()
    assert.equal(s.bodyState.firstTouchRecorded, false)
    assert.equal(s.bodyState.contactCount, 0)
  })
})

// ── Mock Provider (for gateway integration) ───────────────────────

describe('SomaGateway with mock provider', () => {
  /** A provider that simulates hardware being present. */
  class MockProvider implements SomaProvider {
    readonly name = 'Mock Thermal Pad'
    readonly source: SomaSource = 'thermal-pad'
    _available = true
    _reading: SomaSensorReading = {
      source: 'thermal-pad',
      intensity: 0.65,
      ts: new Date().toISOString(),
      yuPresent: true,
    }

    available(): boolean { return this._available }
    async read(): Promise<SomaSensorReading | null> {
      return this._available ? this._reading : null
    }
  }

  test('read returns reading from available provider', async () => {
    const gw = createSomaGateway()
    const mock = new MockProvider()
    gw.register(mock)
    const r = await gw.read('thermal-pad')
    assert.ok(r)
    assert.equal(r.source, 'thermal-pad')
    assert.equal(r.intensity, 0.65)
    assert.equal(r.yuPresent, true)
  })

  test('read returns null when provider becomes unavailable', async () => {
    const gw = createSomaGateway()
    const mock = new MockProvider()
    gw.register(mock)
    mock._available = false
    const r = await gw.read('thermal-pad')
    assert.equal(r, null)
  })

  test('readAll collects from all available providers', async () => {
    const gw = createSomaGateway()
    const mock1 = new MockProvider()
    const mock2 = new MockProvider()
    mock2.source = 'haptic-glove' as any
    mock2._reading = { ...mock2._reading, source: 'haptic-glove', intensity: 0.3 }
    gw.register(mock1)
    gw.register(mock2)
    const all = await gw.readAll()
    assert.equal(all.length, 2)
  })

  test('readAll skips unavailable providers', async () => {
    const gw = createSomaGateway()
    const mock1 = new MockProvider()
    const mock2 = new MockProvider()
    mock2._available = false
    gw.register(mock1)
    gw.register(mock2)
    const all = await gw.readAll()
    assert.equal(all.length, 1)
  })

  test('status shows available count correctly', () => {
    const gw = createSomaGateway()
    const mock1 = new MockProvider()
    const mock2 = new MockProvider()
    mock2._available = false
    gw.register(mock1)
    gw.register(mock2)
    const s = gw.status()
    assert.equal(s.providerCount, 2)
    assert.equal(s.availableCount, 1)
  })
})

// ── SomaSensorReading shape ───────────────────────────────────────

describe('SomaSensorReading type contract', () => {
  test('reading has required fields', () => {
    const reading: SomaSensorReading = {
      source: 'thermal-pad',
      intensity: 0.5,
      ts: new Date().toISOString(),
      yuPresent: false,
    }
    assert.equal(typeof reading.source, 'string')
    assert.equal(typeof reading.intensity, 'number')
    assert.equal(typeof reading.ts, 'string')
    assert.equal(typeof reading.yuPresent, 'boolean')
  })

  test('intensity is bounded 0..1', () => {
    // This is a contract, not enforcement — providers must honor it.
    // The test documents the expectation.
    const reading: SomaSensorReading = {
      source: 'thermal-pad',
      intensity: 0.0,
      ts: new Date().toISOString(),
      yuPresent: false,
    }
    assert.ok(reading.intensity >= 0 && reading.intensity <= 1)
  })

  test('custom source types are allowed', () => {
    // The SomaSource type is extensible via `string & {}`
    const reading: SomaSensorReading = {
      source: 'future-sensor' as SomaSource,
      intensity: 0.3,
      ts: new Date().toISOString(),
      yuPresent: false,
    }
    assert.equal(reading.source, 'future-sensor')
  })
})
