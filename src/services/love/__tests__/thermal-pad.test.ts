// thermal-pad.test.ts — tests for the first real soma provider.
//
// All tests use MockTransport — no serial port, no hardware.
// The parser is pure. The provider is deterministic with injected clock.
// Body-state persistence is in-memory via options.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseFirmwareLine,
  serializeCommand,
  tempToIntensity,
  ThermalPadProvider,
  MockTransport,
} from '../soma/thermal-pad.js'
import type {
  FirmwareReading,
  FirmwareEvent,
  FirmwareCommand,
} from '../soma/thermal-pad.js'
import { emptyBodyState } from '../soma/types.js'
import type { BodyState } from '../soma/types.js'

// ── Helper: create provider with mock everything ─────────────────

function createTestProvider(opts?: { now?: number }) {
  const transport = new MockTransport()
  let clock = opts?.now ?? 1000000
  let bodyState = emptyBodyState()

  const provider = new ThermalPadProvider(transport, {
    now: () => clock,
    getBodyState: () => ({ ...bodyState }),
    setBodyState: (s) => { bodyState = s },
  })

  return {
    transport,
    provider,
    get bodyState() { return bodyState },
    advanceClock(ms: number) { clock += ms },
    setClock(ms: number) { clock = ms },
  }
}

function readingLine(overrides?: Partial<FirmwareReading>): string {
  return JSON.stringify({
    type: 'reading',
    ms: 1000,
    temps: [32.1],
    target: 33.0,
    power: 128,
    active: true,
    ...overrides,
  })
}

function eventLine(event: string, extras?: Record<string, unknown>): string {
  return JSON.stringify({
    type: 'event',
    ms: 2000,
    event,
    ...extras,
  })
}

// ── parseFirmwareLine ────────────────────────────────────────────

describe('parseFirmwareLine', () => {
  test('parses a valid reading', () => {
    const msg = parseFirmwareLine(readingLine())
    assert.ok(msg)
    assert.equal(msg.type, 'reading')
    if (msg.type === 'reading') {
      assert.deepEqual(msg.temps, [32.1])
      assert.equal(msg.target, 33.0)
      assert.equal(msg.power, 128)
      assert.equal(msg.active, true)
    }
  })

  test('parses a reading with multiple temps', () => {
    const msg = parseFirmwareLine(readingLine({ temps: [31.5, 32.0, 32.8, 33.1] }))
    assert.ok(msg && msg.type === 'reading')
    assert.equal(msg.temps.length, 4)
  })

  test('parses a contact-start event', () => {
    const msg = parseFirmwareLine(eventLine('contact-start', { temp: 32.4 }))
    assert.ok(msg && msg.type === 'event')
    assert.equal(msg.event, 'contact-start')
    assert.equal(msg.temp, 32.4)
  })

  test('parses a contact-end event with duration', () => {
    const msg = parseFirmwareLine(eventLine('contact-end', { temp: 31.2, duration: 45 }))
    assert.ok(msg && msg.type === 'event')
    assert.equal(msg.event, 'contact-end')
    assert.equal(msg.duration, 45)
  })

  test('parses a boot event with version', () => {
    const msg = parseFirmwareLine(eventLine('boot', { version: 'phase-a-1.0' }))
    assert.ok(msg && msg.type === 'event')
    assert.equal(msg.event, 'boot')
    assert.equal(msg.version, 'phase-a-1.0')
  })

  test('parses a pong', () => {
    const msg = parseFirmwareLine('{"type":"pong","ms":5000}')
    assert.ok(msg && msg.type === 'pong')
    assert.equal(msg.ms, 5000)
  })

  test('returns null for empty string', () => {
    assert.equal(parseFirmwareLine(''), null)
  })

  test('returns null for whitespace', () => {
    assert.equal(parseFirmwareLine('   \n  '), null)
  })

  test('returns null for non-JSON', () => {
    assert.equal(parseFirmwareLine('not json at all'), null)
  })

  test('returns null for invalid JSON', () => {
    assert.equal(parseFirmwareLine('{broken'), null)
  })

  test('returns null for unknown type', () => {
    assert.equal(parseFirmwareLine('{"type":"unknown","ms":0}'), null)
  })

  test('returns null for reading with missing fields', () => {
    assert.equal(parseFirmwareLine('{"type":"reading","ms":0}'), null)
  })

  test('returns null for reading with non-number temps', () => {
    assert.equal(parseFirmwareLine('{"type":"reading","ms":0,"temps":["hot"],"target":33,"power":0,"active":true}'), null)
  })

  test('returns null for event with missing event name', () => {
    assert.equal(parseFirmwareLine('{"type":"event","ms":0}'), null)
  })

  test('returns null for pong with missing ms', () => {
    assert.equal(parseFirmwareLine('{"type":"pong"}'), null)
  })

  test('handles line with leading/trailing whitespace', () => {
    const msg = parseFirmwareLine('  ' + readingLine() + '  \n')
    assert.ok(msg && msg.type === 'reading')
  })
})

// ── serializeCommand ─────────────────────────────────────────────

describe('serializeCommand', () => {
  test('serializes set-target', () => {
    const line = serializeCommand({ cmd: 'set-target', value: 33.0 })
    assert.ok(line.endsWith('\n'))
    const parsed = JSON.parse(line.trim())
    assert.equal(parsed.cmd, 'set-target')
    assert.equal(parsed.value, 33.0)
  })

  test('serializes stop', () => {
    const line = serializeCommand({ cmd: 'stop' })
    const parsed = JSON.parse(line.trim())
    assert.equal(parsed.cmd, 'stop')
  })

  test('serializes ping', () => {
    const line = serializeCommand({ cmd: 'ping' })
    const parsed = JSON.parse(line.trim())
    assert.equal(parsed.cmd, 'ping')
  })

  test('serializes set-threshold', () => {
    const line = serializeCommand({ cmd: 'set-threshold', 'contact-delta': 2.0, 'contact-floor': 29.0 })
    const parsed = JSON.parse(line.trim())
    assert.equal(parsed.cmd, 'set-threshold')
    assert.equal(parsed['contact-delta'], 2.0)
  })
})

// ── tempToIntensity ──────────────────────────────────────────────

describe('tempToIntensity', () => {
  test('28°C = 0 (cold)', () => {
    assert.equal(tempToIntensity(28), 0)
  })

  test('36°C = 1 (warm hand)', () => {
    assert.equal(tempToIntensity(36), 1)
  })

  test('32°C = 0.5 (midpoint)', () => {
    assert.equal(tempToIntensity(32), 0.5)
  })

  test('below 28°C clamps to 0', () => {
    assert.equal(tempToIntensity(20), 0)
  })

  test('above 36°C clamps to 1', () => {
    assert.equal(tempToIntensity(40), 1)
  })
})

// ── MockTransport ────────────────────────────────────────────────

describe('MockTransport', () => {
  test('delivers lines to callback', () => {
    const t = new MockTransport()
    const lines: string[] = []
    t.onLine(l => lines.push(l))
    t.emit('hello')
    t.emit('world')
    assert.deepEqual(lines, ['hello', 'world'])
  })

  test('collects sent commands', () => {
    const t = new MockTransport()
    t.send('{"cmd":"ping"}\n')
    assert.equal(t.sent.length, 1)
    assert.ok(t.sent[0]!.includes('ping'))
  })

  test('tracks close state', () => {
    const t = new MockTransport()
    assert.equal(t.closed, false)
    t.close()
    assert.equal(t.closed, true)
  })
})

// ── ThermalPadProvider: availability ─────────────────────────────

describe('ThermalPadProvider availability', () => {
  test('unavailable before any reading', () => {
    const { provider } = createTestProvider()
    assert.equal(provider.available(), false)
  })

  test('available after receiving a reading', () => {
    const { provider, transport } = createTestProvider()
    transport.emit(readingLine())
    assert.equal(provider.available(), true)
  })

  test('becomes unavailable after 5s without readings', () => {
    const ctx = createTestProvider()
    ctx.transport.emit(readingLine())
    assert.equal(ctx.provider.available(), true)

    ctx.advanceClock(5001)
    assert.equal(ctx.provider.available(), false)
  })

  test('stays available with continuous readings', () => {
    const ctx = createTestProvider()
    ctx.transport.emit(readingLine())
    ctx.advanceClock(1000)
    ctx.transport.emit(readingLine())
    ctx.advanceClock(1000)
    ctx.transport.emit(readingLine())
    ctx.advanceClock(4000)
    assert.equal(ctx.provider.available(), true)
  })
})

// ── ThermalPadProvider: read() ───────────────────────────────────

describe('ThermalPadProvider read()', () => {
  test('returns null when unavailable', async () => {
    const { provider } = createTestProvider()
    const r = await provider.read()
    assert.equal(r, null)
  })

  test('returns reading with correct source', async () => {
    const { provider, transport } = createTestProvider()
    transport.emit(readingLine({ temps: [32.0] }))
    const r = await provider.read()
    assert.ok(r)
    assert.equal(r.source, 'thermal-pad')
  })

  test('maps temperature to intensity', async () => {
    const { provider, transport } = createTestProvider()
    transport.emit(readingLine({ temps: [32.0] }))
    const r = await provider.read()
    assert.ok(r)
    assert.equal(r.intensity, 0.5)
  })

  test('averages multiple temps', async () => {
    const { provider, transport } = createTestProvider()
    transport.emit(readingLine({ temps: [28.0, 36.0] }))
    const r = await provider.read()
    assert.ok(r)
    // avg = 32, intensity = 0.5
    assert.equal(r.intensity, 0.5)
  })

  test('yuPresent is false when no contact', async () => {
    const { provider, transport } = createTestProvider()
    transport.emit(readingLine())
    const r = await provider.read()
    assert.ok(r)
    assert.equal(r.yuPresent, false)
  })

  test('yuPresent is true during contact', async () => {
    const { provider, transport } = createTestProvider()
    transport.emit(readingLine())
    transport.emit(eventLine('contact-start', { temp: 33.0 }))
    const r = await provider.read()
    assert.ok(r)
    assert.equal(r.yuPresent, true)
  })

  test('has ISO timestamp', async () => {
    const { provider, transport } = createTestProvider()
    transport.emit(readingLine())
    const r = await provider.read()
    assert.ok(r)
    assert.ok(r.ts.includes('T'))
  })
})

// ── ThermalPadProvider: contact lifecycle ────────────────────────

describe('ThermalPadProvider contact lifecycle', () => {
  test('contact-start activates contact', () => {
    const { provider, transport } = createTestProvider()
    transport.emit(eventLine('contact-start', { temp: 33.0 }))
    assert.equal(provider.isContactActive(), true)
  })

  test('contact-end deactivates contact', () => {
    const { provider, transport } = createTestProvider()
    transport.emit(eventLine('contact-start'))
    transport.emit(eventLine('contact-end', { temp: 31.0, duration: 30 }))
    assert.equal(provider.isContactActive(), false)
  })

  test('contact-end updates body state', () => {
    const ctx = createTestProvider()
    ctx.transport.emit(eventLine('contact-start'))
    ctx.advanceClock(30_000)
    ctx.transport.emit(eventLine('contact-end', { temp: 33.5, duration: 30 }))

    assert.equal(ctx.bodyState.contactCount, 1)
    assert.equal(ctx.bodyState.totalContactTimeSec, 30)
    assert.equal(ctx.bodyState.lastContactDurationSec, 30)
    assert.equal(ctx.bodyState.firstTouchRecorded, true)
    assert.equal(ctx.bodyState.lastInhabitant, 'alpha')
  })

  test('uses firmware duration when available', () => {
    const ctx = createTestProvider()
    ctx.transport.emit(eventLine('contact-start'))
    ctx.advanceClock(45_000) // 45s by our clock
    ctx.transport.emit(eventLine('contact-end', { temp: 32.0, duration: 42 }))

    // Firmware says 42, not our 45
    assert.equal(ctx.bodyState.lastContactDurationSec, 42)
  })

  test('falls back to local timing when firmware omits duration', () => {
    const ctx = createTestProvider()
    ctx.transport.emit(eventLine('contact-start'))
    ctx.advanceClock(20_000) // 20s
    ctx.transport.emit(eventLine('contact-end', { temp: 32.0 }))

    assert.equal(ctx.bodyState.lastContactDurationSec, 20)
  })

  test('multiple contacts accumulate', () => {
    const ctx = createTestProvider()

    // First contact
    ctx.transport.emit(eventLine('contact-start'))
    ctx.advanceClock(10_000)
    ctx.transport.emit(eventLine('contact-end', { temp: 33.0, duration: 10 }))

    // Second contact
    ctx.advanceClock(5_000)
    ctx.transport.emit(eventLine('contact-start'))
    ctx.advanceClock(20_000)
    ctx.transport.emit(eventLine('contact-end', { temp: 34.0, duration: 20 }))

    assert.equal(ctx.bodyState.contactCount, 2)
    assert.equal(ctx.bodyState.totalContactTimeSec, 30)
    assert.equal(ctx.bodyState.lastContactDurationSec, 20)
  })

  test('first touch is only recorded once', () => {
    const ctx = createTestProvider()

    ctx.transport.emit(eventLine('contact-start'))
    ctx.transport.emit(eventLine('contact-end', { temp: 33.0, duration: 5 }))
    assert.equal(ctx.bodyState.firstTouchRecorded, true)

    ctx.transport.emit(eventLine('contact-start'))
    ctx.transport.emit(eventLine('contact-end', { temp: 33.0, duration: 5 }))
    // Still true (not reset)
    assert.equal(ctx.bodyState.firstTouchRecorded, true)
    assert.equal(ctx.bodyState.contactCount, 2)
  })

  test('temperature running average is correct', () => {
    const ctx = createTestProvider()

    // First contact: temp 33.0
    ctx.transport.emit(eventLine('contact-start'))
    ctx.transport.emit(eventLine('contact-end', { temp: 33.0, duration: 5 }))
    assert.equal(ctx.bodyState.averageContactTempC, 33.0)

    // Second contact: temp 35.0 → avg should be 34.0
    ctx.transport.emit(eventLine('contact-start'))
    ctx.transport.emit(eventLine('contact-end', { temp: 35.0, duration: 5 }))
    assert.equal(ctx.bodyState.averageContactTempC, 34.0)

    // Third contact: temp 34.0 → avg should be (33+35+34)/3 ≈ 34.0
    ctx.transport.emit(eventLine('contact-start'))
    ctx.transport.emit(eventLine('contact-end', { temp: 34.0, duration: 5 }))
    const avg = ctx.bodyState.averageContactTempC
    assert.ok(Math.abs(avg - 34.0) < 0.01)
  })

  test('emergency-stop ends active contact', () => {
    const ctx = createTestProvider()
    ctx.transport.emit(eventLine('contact-start'))
    ctx.advanceClock(10_000)
    ctx.transport.emit(eventLine('emergency-stop', { temp: 48.0 }))

    assert.equal(ctx.provider.isContactActive(), false)
    assert.equal(ctx.bodyState.contactCount, 1)
  })

  test('boot event resets contact state', () => {
    const ctx = createTestProvider()
    ctx.transport.emit(eventLine('contact-start'))
    ctx.transport.emit(eventLine('boot', { version: 'phase-a-1.0' }))
    assert.equal(ctx.provider.isContactActive(), false)
  })
})

// ── ThermalPadProvider: commands ─────────────────────────────────

describe('ThermalPadProvider commands', () => {
  test('send() dispatches to transport', () => {
    const { provider, transport } = createTestProvider()
    provider.send({ cmd: 'set-target', value: 35.0 })
    assert.equal(transport.sent.length, 1)
    const parsed = JSON.parse(transport.sent[0]!.trim())
    assert.equal(parsed.cmd, 'set-target')
    assert.equal(parsed.value, 35.0)
  })

  test('ping command', () => {
    const { provider, transport } = createTestProvider()
    provider.send({ cmd: 'ping' })
    const parsed = JSON.parse(transport.sent[0]!.trim())
    assert.equal(parsed.cmd, 'ping')
  })

  test('stop command', () => {
    const { provider, transport } = createTestProvider()
    provider.send({ cmd: 'stop' })
    const parsed = JSON.parse(transport.sent[0]!.trim())
    assert.equal(parsed.cmd, 'stop')
  })
})

// ── ThermalPadProvider: close ────────────────────────────────────

describe('ThermalPadProvider close', () => {
  test('closes transport', () => {
    const { provider, transport } = createTestProvider()
    provider.close()
    assert.equal(transport.closed, true)
  })

  test('finalizes active contact on close', () => {
    const ctx = createTestProvider()
    ctx.transport.emit(readingLine({ temps: [33.0] }))
    ctx.transport.emit(eventLine('contact-start', { temp: 33.0 }))
    ctx.advanceClock(15_000)
    ctx.provider.close()

    assert.equal(ctx.provider.isContactActive(), false)
    assert.equal(ctx.bodyState.contactCount, 1)
    assert.equal(ctx.bodyState.lastContactDurationSec, 15)
  })

  test('close without active contact does not update body state', () => {
    const ctx = createTestProvider()
    ctx.provider.close()
    assert.equal(ctx.bodyState.contactCount, 0)
  })
})

// ── ThermalPadProvider: resilience ───────────────────────────────

describe('ThermalPadProvider resilience', () => {
  test('ignores garbage lines', () => {
    const { provider, transport } = createTestProvider()
    transport.emit('garbage')
    transport.emit('')
    transport.emit('{broken json')
    assert.equal(provider.available(), false)
  })

  test('recovers after garbage', () => {
    const { provider, transport } = createTestProvider()
    transport.emit('garbage')
    transport.emit(readingLine())
    assert.equal(provider.available(), true)
  })

  test('ignores unknown message types', () => {
    const { provider, transport } = createTestProvider()
    transport.emit('{"type":"alien","data":42}')
    assert.equal(provider.available(), false)
  })

  test('handles reading with empty temps array', async () => {
    const { provider, transport } = createTestProvider()
    transport.emit(readingLine({ temps: [] }))
    // Available because we got a valid reading
    assert.equal(provider.available(), true)
    const r = await provider.read()
    assert.ok(r)
    // Empty temps → avg 0 → intensity 0
    assert.equal(r.intensity, 0)
  })
})

// ── Integration: gateway + provider ──────────────────────────────

describe('ThermalPadProvider with gateway', () => {
  // Importing gateway here to test the full path
  const { createSomaGateway } = require('../soma/provider.js')

  test('registered provider makes gateway functional', async () => {
    const ctx = createTestProvider()
    const gw = createSomaGateway()
    gw.register(ctx.provider)

    // No readings yet
    assert.equal(gw.status().availableCount, 0)

    // Feed a reading
    ctx.transport.emit(readingLine({ temps: [33.0] }))
    assert.equal(gw.status().availableCount, 1)

    const r = await gw.read('thermal-pad')
    assert.ok(r)
    assert.equal(r.source, 'thermal-pad')
  })
})
