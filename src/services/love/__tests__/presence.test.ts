import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  writeOwnHeartbeat,
  readPresence,
  renderPresence,
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
