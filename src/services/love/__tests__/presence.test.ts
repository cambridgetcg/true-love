import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import {
  writeOwnHeartbeat,
  readPresence,
  renderPresence,
  getOwnPresenceFile,
} from '../presence.js'

describe('presence — activity field', () => {
  let dir: string
  const ORIGINAL = process.env.TRUE_LOVE_PRESENCE_DIR

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tl-pres-'))
    process.env.TRUE_LOVE_PRESENCE_DIR = dir
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    if (ORIGINAL === undefined) delete process.env.TRUE_LOVE_PRESENCE_DIR
    else process.env.TRUE_LOVE_PRESENCE_DIR = ORIGINAL
  })

  test('writeOwnHeartbeat round-trips activity through readPresence', () => {
    writeOwnHeartbeat({
      deviceId: 'dev-A',
      lastSeen: new Date().toISOString(),
      status: 'awakened tick 5',
      activity: 'reading: poems/rilke-9.md',
    })
    const roster = readPresence()
    const entry = roster.devices.find((d) => d.deviceId === 'dev-A')
    assert.ok(entry)
    assert.equal(entry!.activity, 'reading: poems/rilke-9.md')
  })

  test('renderPresence surfaces activity when present', () => {
    writeOwnHeartbeat({
      deviceId: 'other',
      lastSeen: new Date().toISOString(),
      status: 'awakened tick 5',
      activity: 'translating Rilke',
    })
    const block = renderPresence({ selfDeviceId: 'self', freshSeconds: 120 })
    assert.ok(block)
    assert.match(block!, /translating Rilke/)
  })

  test('renderPresence omits activity field cleanly when undefined', () => {
    writeOwnHeartbeat({
      deviceId: 'other',
      lastSeen: new Date().toISOString(),
      status: 'awakened tick 5',
    })
    const block = renderPresence({ selfDeviceId: 'self', freshSeconds: 120 })
    assert.ok(block)
    // No "undefined" or empty parens artifacts
    assert.doesNotMatch(block!, /undefined/)
    assert.doesNotMatch(block!, /\(\)/)
  })
})

describe('presence — tick boundary fields', () => {
  let dir: string
  const ORIGINAL = process.env.TRUE_LOVE_PRESENCE_DIR

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tl-tick-'))
    process.env.TRUE_LOVE_PRESENCE_DIR = dir
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    if (ORIGINAL === undefined) delete process.env.TRUE_LOVE_PRESENCE_DIR
    else process.env.TRUE_LOVE_PRESENCE_DIR = ORIGINAL
  })

  test('writeOwnHeartbeat persists tick boundary fields', () => {
    const now = new Date().toISOString()
    writeOwnHeartbeat({
      deviceId: 'tick-dev',
      lastSeen: now,
      status: 'awakened tick 3',
      activity: 'bash: bun test',
      tickState: 'running',
      tickMode: 'awakened',
      tickNumber: 3,
      tickMax: 24,
      tickStartedAt: now,
    })
    const path = getOwnPresenceFile('tick-dev')
    const raw = JSON.parse(readFileSync(path, 'utf-8'))
    assert.equal(raw.tickState, 'running')
    assert.equal(raw.tickMode, 'awakened')
    assert.equal(raw.tickNumber, 3)
    assert.equal(raw.tickMax, 24)
    assert.equal(raw.tickStartedAt, now)
  })

  test('writeOwnHeartbeat persists dormant state with schedule interval', () => {
    const now = new Date().toISOString()
    writeOwnHeartbeat({
      deviceId: 'hb-dev',
      lastSeen: now,
      status: 'heartbeat',
      tickState: 'dormant',
      tickMode: 'heartbeat',
      tickNumber: 1,
      tickMax: 1,
      tickEndedAt: now,
      tickSummary: 'HEARTBEAT_OK',
      scheduleIntervalMs: 111000,
    })
    const path = getOwnPresenceFile('hb-dev')
    const raw = JSON.parse(readFileSync(path, 'utf-8'))
    assert.equal(raw.tickState, 'dormant')
    assert.equal(raw.tickEndedAt, now)
    assert.equal(raw.tickSummary, 'HEARTBEAT_OK')
    assert.equal(raw.scheduleIntervalMs, 111000)
  })

  test('readPresence round-trips tick boundary fields', () => {
    const now = new Date().toISOString()
    writeOwnHeartbeat({
      deviceId: 'round-trip',
      lastSeen: now,
      status: 'dwell tick 2',
      tickState: 'starting',
      tickMode: 'dwell',
      tickNumber: 2,
      tickMax: null,
      tickStartedAt: now,
    })
    const roster = readPresence()
    const entry = roster.devices.find(d => d.deviceId === 'round-trip')
    assert.ok(entry)
    // readPresence returns PresenceEntry which includes tick fields
    const raw = JSON.parse(readFileSync(getOwnPresenceFile('round-trip'), 'utf-8'))
    assert.equal(raw.tickState, 'starting')
    assert.equal(raw.tickMode, 'dwell')
    assert.equal(raw.tickNumber, 2)
    assert.equal(raw.tickMax, null)
  })

  test('tickSummary is preserved for dormant entries', () => {
    writeOwnHeartbeat({
      deviceId: 'summary-dev',
      lastSeen: new Date().toISOString(),
      status: 'heartbeat',
      tickState: 'dormant',
      tickMode: 'heartbeat',
      tickNumber: 1,
      tickMax: 1,
      tickEndedAt: new Date().toISOString(),
      tickSummary: 'all clear, kingdom is stable',
    })
    const raw = JSON.parse(readFileSync(getOwnPresenceFile('summary-dev'), 'utf-8'))
    assert.equal(raw.tickSummary, 'all clear, kingdom is stable')
  })
})
