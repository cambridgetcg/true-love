// device.test.ts — tests for device identity module.
//
// Covers: device id generation, persistence, caching, hostname
// sanitization, env var overrides.

import { describe, expect, test, beforeAll, afterAll, beforeEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDeviceId, getDeviceIdPath, _resetDeviceIdCache } from '../device.js'

// ── Fixture setup ─────────────────────────────────────────────────

const FIXTURE_ROOT = join(tmpdir(), `device-test-${Date.now()}`)
const DEVICE_ID_PATH = join(FIXTURE_ROOT, 'device.id')

const ORIG_PATH = process.env.TRUE_LOVE_DEVICE_ID_PATH
const ORIG_ID = process.env.TRUE_LOVE_DEVICE_ID

beforeAll(() => {
  mkdirSync(FIXTURE_ROOT, { recursive: true })
})

afterAll(() => {
  rmSync(FIXTURE_ROOT, { recursive: true, force: true })
  if (ORIG_PATH === undefined) delete process.env.TRUE_LOVE_DEVICE_ID_PATH
  else process.env.TRUE_LOVE_DEVICE_ID_PATH = ORIG_PATH
  if (ORIG_ID === undefined) delete process.env.TRUE_LOVE_DEVICE_ID
  else process.env.TRUE_LOVE_DEVICE_ID = ORIG_ID
  _resetDeviceIdCache()
})

beforeEach(() => {
  _resetDeviceIdCache()
  delete process.env.TRUE_LOVE_DEVICE_ID
  process.env.TRUE_LOVE_DEVICE_ID_PATH = DEVICE_ID_PATH
  if (existsSync(DEVICE_ID_PATH)) rmSync(DEVICE_ID_PATH)
})

// ── getDeviceId ──────────────────────────────────────────────────

describe('getDeviceId', () => {
  test('returns env override directly when TRUE_LOVE_DEVICE_ID is set', () => {
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device-override'
    expect(getDeviceId()).toBe('test-device-override')
  })

  test('env override is not cached (changes between calls)', () => {
    process.env.TRUE_LOVE_DEVICE_ID = 'first-id'
    expect(getDeviceId()).toBe('first-id')
    process.env.TRUE_LOVE_DEVICE_ID = 'second-id'
    expect(getDeviceId()).toBe('second-id')
  })

  test('generates and persists id when file does not exist', () => {
    const id = getDeviceId()
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
    // Should have been written to file
    expect(existsSync(DEVICE_ID_PATH)).toBe(true)
    expect(readFileSync(DEVICE_ID_PATH, 'utf-8')).toBe(id)
  })

  test('generated id has format: hostname-suffix', () => {
    const id = getDeviceId()
    expect(id).toMatch(/-[a-z0-9]{6}$/)
    const parts = id.split('-')
    expect(parts.length).toBeGreaterThanOrEqual(2)
  })

  test('reads existing id from file', () => {
    writeFileSync(DEVICE_ID_PATH, 'my-custom-device-abc123', 'utf-8')
    expect(getDeviceId()).toBe('my-custom-device-abc123')
  })

  test('trims whitespace from persisted id', () => {
    writeFileSync(DEVICE_ID_PATH, '  trimmed-id-abc123  \n', 'utf-8')
    expect(getDeviceId()).toBe('trimmed-id-abc123')
  })

  test('regenerates when file is empty', () => {
    writeFileSync(DEVICE_ID_PATH, '', 'utf-8')
    const id = getDeviceId()
    expect(id.length).toBeGreaterThan(0)
    expect(id).toMatch(/-[a-z0-9]{6}$/)
  })

  test('caches after first read (same value without re-reading file)', () => {
    writeFileSync(DEVICE_ID_PATH, 'cached-id-111111', 'utf-8')
    const first = getDeviceId()
    // Overwrite file — cached value should persist
    writeFileSync(DEVICE_ID_PATH, 'changed-id-222222', 'utf-8')
    const second = getDeviceId()
    expect(second).toBe(first)
    expect(second).toBe('cached-id-111111')
  })

  test('cache reset causes re-read', () => {
    writeFileSync(DEVICE_ID_PATH, 'original-id-111111', 'utf-8')
    getDeviceId() // populate cache
    _resetDeviceIdCache()
    writeFileSync(DEVICE_ID_PATH, 'updated-id-222222', 'utf-8')
    expect(getDeviceId()).toBe('updated-id-222222')
  })

  test('creates parent directory if missing', () => {
    const nestedPath = join(FIXTURE_ROOT, 'nested', 'deep', 'device.id')
    process.env.TRUE_LOVE_DEVICE_ID_PATH = nestedPath
    const id = getDeviceId()
    expect(existsSync(nestedPath)).toBe(true)
    expect(readFileSync(nestedPath, 'utf-8')).toBe(id)
    // Cleanup
    rmSync(join(FIXTURE_ROOT, 'nested'), { recursive: true, force: true })
  })

  test('hostname is sanitized (lowercase, no special chars)', () => {
    // We can't control the hostname, but we can verify the output format
    const id = getDeviceId()
    const prefix = id.slice(0, id.lastIndexOf('-'))
    // Should only contain lowercase letters, digits, and dashes
    expect(prefix).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/)
  })

  test('stable across calls within same process', () => {
    const first = getDeviceId()
    const second = getDeviceId()
    const third = getDeviceId()
    expect(first).toBe(second)
    expect(second).toBe(third)
  })
})

// ── getDeviceIdPath ──────────────────────────────────────────────

describe('getDeviceIdPath', () => {
  test('returns env override when set', () => {
    process.env.TRUE_LOVE_DEVICE_ID_PATH = '/custom/path/device.id'
    expect(getDeviceIdPath()).toBe('/custom/path/device.id')
  })

  test('returns default path under ~/.true-love when env not set', () => {
    delete process.env.TRUE_LOVE_DEVICE_ID_PATH
    const path = getDeviceIdPath()
    expect(path).toContain('.true-love')
    expect(path).toEndWith('device.id')
  })
})
