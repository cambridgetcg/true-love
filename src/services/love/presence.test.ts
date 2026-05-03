// presence.test.ts — tests for the presence/heartbeat system.
//
// Covers: writeOwnHeartbeat, readPresence (per-device and legacy layouts),
// renderPresence (freshness filtering, self-exclusion, humanized time).
//
// Uses TRUE_LOVE_PRESENCE_DIR and TRUE_LOVE_PRESENCE_PATH for isolation.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  writeOwnHeartbeat,
  readPresence,
  renderPresence,
  getPresenceDir,
  getPresencePath,
  getOwnPresenceFile,
  type PresenceEntry,
} from './presence.js'

const TEST_DIR = '/tmp/true-love-presence-test'

describe('presence', () => {
  let savedDir: string | undefined
  let savedPath: string | undefined

  beforeEach(() => {
    savedDir = process.env.TRUE_LOVE_PRESENCE_DIR
    savedPath = process.env.TRUE_LOVE_PRESENCE_PATH
    rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(TEST_DIR, { recursive: true })
    process.env.TRUE_LOVE_PRESENCE_DIR = join(TEST_DIR, 'presence')
    process.env.TRUE_LOVE_PRESENCE_PATH = join(TEST_DIR, 'presence.json')
  })

  afterEach(() => {
    if (savedDir === undefined) {
      delete process.env.TRUE_LOVE_PRESENCE_DIR
    } else {
      process.env.TRUE_LOVE_PRESENCE_DIR = savedDir
    }
    if (savedPath === undefined) {
      delete process.env.TRUE_LOVE_PRESENCE_PATH
    } else {
      process.env.TRUE_LOVE_PRESENCE_PATH = savedPath
    }
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  // ── Path helpers ────────────────────────────────────────────────

  test('getPresenceDir respects env override', () => {
    expect(getPresenceDir()).toBe(join(TEST_DIR, 'presence'))
  })

  test('getPresencePath respects env override', () => {
    expect(getPresencePath()).toBe(join(TEST_DIR, 'presence.json'))
  })

  test('getOwnPresenceFile returns path under presence dir', () => {
    const path = getOwnPresenceFile('dev-a')
    expect(path).toBe(join(TEST_DIR, 'presence', 'dev-a.json'))
  })

  // ── writeOwnHeartbeat ──────────────────────────────────────────

  test('creates presence directory and device file', () => {
    const entry: PresenceEntry = {
      deviceId: 'dev-a',
      lastSeen: new Date().toISOString(),
      status: 'awakened',
    }
    writeOwnHeartbeat(entry)
    const file = getOwnPresenceFile('dev-a')
    expect(existsSync(file)).toBe(true)
  })

  test('writes valid JSON with all fields', () => {
    const entry: PresenceEntry = {
      deviceId: 'dev-a',
      lastSeen: '2026-04-27T12:00:00.000Z',
      status: 'dwelling',
    }
    writeOwnHeartbeat(entry)
    const raw = readFileSync(getOwnPresenceFile('dev-a'), 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed.deviceId).toBe('dev-a')
    expect(parsed.lastSeen).toBe('2026-04-27T12:00:00.000Z')
    expect(parsed.status).toBe('dwelling')
  })

  test('overwrites previous heartbeat (not append)', () => {
    writeOwnHeartbeat({
      deviceId: 'dev-a',
      lastSeen: '2026-04-27T10:00:00Z',
    })
    writeOwnHeartbeat({
      deviceId: 'dev-a',
      lastSeen: '2026-04-27T12:00:00Z',
    })
    const raw = readFileSync(getOwnPresenceFile('dev-a'), 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed.lastSeen).toBe('2026-04-27T12:00:00Z')
  })

  // ── readPresence ───────────────────────────────────────────────

  test('returns empty roster for missing directory', () => {
    const roster = readPresence()
    expect(roster.devices).toEqual([])
    expect(roster.updatedAt).toBeTruthy()
  })

  test('reads per-device layout', () => {
    writeOwnHeartbeat({
      deviceId: 'dev-a',
      lastSeen: '2026-04-27T12:00:00Z',
      status: 'awakened',
    })
    writeOwnHeartbeat({
      deviceId: 'dev-b',
      lastSeen: '2026-04-27T12:01:00Z',
    })

    const roster = readPresence()
    expect(roster.devices.length).toBe(2)
    const ids = roster.devices.map((d) => d.deviceId).sort()
    expect(ids).toEqual(['dev-a', 'dev-b'])
  })

  test('reads legacy single-file layout', () => {
    const legacyRoster = {
      updatedAt: '2026-04-27T12:00:00Z',
      devices: [
        { deviceId: 'legacy-dev', lastSeen: '2026-04-27T12:00:00Z' },
      ],
    }
    writeFileSync(getPresencePath(), JSON.stringify(legacyRoster))

    const roster = readPresence()
    expect(roster.devices.length).toBe(1)
    expect(roster.devices[0].deviceId).toBe('legacy-dev')
  })

  test('deduplicates devices across layouts (per-device wins)', () => {
    // Write same device in both layouts
    writeOwnHeartbeat({
      deviceId: 'dev-a',
      lastSeen: '2026-04-27T12:00:00Z',
      status: 'fresh',
    })
    const legacyRoster = {
      updatedAt: '2026-04-27T11:00:00Z',
      devices: [
        { deviceId: 'dev-a', lastSeen: '2026-04-27T11:00:00Z' },
      ],
    }
    writeFileSync(getPresencePath(), JSON.stringify(legacyRoster))

    const roster = readPresence()
    // Should only appear once (per-device layout is read first)
    const devAs = roster.devices.filter((d) => d.deviceId === 'dev-a')
    expect(devAs.length).toBe(1)
    expect(devAs[0].lastSeen).toBe('2026-04-27T12:00:00Z')
  })

  test('skips malformed JSON files', () => {
    const dir = getPresenceDir()
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'bad.json'), 'not json')
    writeOwnHeartbeat({
      deviceId: 'good-dev',
      lastSeen: '2026-04-27T12:00:00Z',
    })

    const roster = readPresence()
    expect(roster.devices.length).toBe(1)
    expect(roster.devices[0].deviceId).toBe('good-dev')
  })

  test('skips non-json files in presence directory', () => {
    const dir = getPresenceDir()
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'notes.txt'), 'not a presence file')
    writeOwnHeartbeat({
      deviceId: 'dev-a',
      lastSeen: '2026-04-27T12:00:00Z',
    })

    const roster = readPresence()
    expect(roster.devices.length).toBe(1)
  })

  // ── renderPresence ─────────────────────────────────────────────

  test('returns null when no other devices are present', () => {
    const result = renderPresence({ selfDeviceId: 'my-device' })
    expect(result).toBeNull()
  })

  test('excludes self device', () => {
    writeOwnHeartbeat({
      deviceId: 'my-device',
      lastSeen: new Date().toISOString(),
      status: 'awakened',
    })

    const result = renderPresence({ selfDeviceId: 'my-device' })
    expect(result).toBeNull()
  })

  test('shows fresh devices from other machines', () => {
    writeOwnHeartbeat({
      deviceId: 'other-device',
      lastSeen: new Date().toISOString(),
      status: 'dwelling',
    })

    const result = renderPresence({
      selfDeviceId: 'my-device',
      freshSeconds: 120,
    })
    expect(result).not.toBeNull()
    expect(result).toContain('other-device')
    expect(result).toContain('dwelling')
    expect(result).toContain("You're also awake elsewhere:")
  })

  test('filters out stale devices', () => {
    writeOwnHeartbeat({
      deviceId: 'stale-device',
      lastSeen: '2020-01-01T12:00:00Z', // very old
    })

    const result = renderPresence({
      selfDeviceId: 'my-device',
      freshSeconds: 120,
    })
    expect(result).toBeNull()
  })

  test('humanizes time in presence output', () => {
    writeOwnHeartbeat({
      deviceId: 'other-device',
      lastSeen: new Date(Date.now() - 10_000).toISOString(), // 10s ago
    })

    const result = renderPresence({
      selfDeviceId: 'my-device',
      freshSeconds: 120,
    })
    expect(result).not.toBeNull()
    // Should contain humanized time like "10s ago" or "just now"
    expect(result).toMatch(/(just now|\d+s ago)/)
  })
})
