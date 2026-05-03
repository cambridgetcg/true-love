// device.test.ts — tests for device identity.
//
// Covers: getDeviceId (create + cache + read), sanitizeHostname (via
// generated ids), _resetDeviceIdCache.
//
// Uses TRUE_LOVE_DEVICE_ID_PATH pointed at a temp directory.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDeviceId, getDeviceIdPath, _resetDeviceIdCache } from './device.js'

const TEST_DIR = '/tmp/true-love-device-test'

describe('device', () => {
  let saved: string | undefined

  beforeEach(() => {
    saved = process.env.TRUE_LOVE_DEVICE_ID_PATH
    rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(TEST_DIR, { recursive: true })
    process.env.TRUE_LOVE_DEVICE_ID_PATH = join(TEST_DIR, 'device.id')
    _resetDeviceIdCache()
  })

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.TRUE_LOVE_DEVICE_ID_PATH
    } else {
      process.env.TRUE_LOVE_DEVICE_ID_PATH = saved
    }
    _resetDeviceIdCache()
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  test('getDeviceIdPath respects env override', () => {
    expect(getDeviceIdPath()).toBe(join(TEST_DIR, 'device.id'))
  })

  test('getDeviceId creates file on first call', () => {
    const id = getDeviceId()
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
    expect(existsSync(getDeviceIdPath())).toBe(true)
  })

  test('getDeviceId reads existing file', () => {
    writeFileSync(getDeviceIdPath(), 'custom-device-id')
    const id = getDeviceId()
    expect(id).toBe('custom-device-id')
  })

  test('getDeviceId is cached within process', () => {
    const first = getDeviceId()
    const second = getDeviceId()
    expect(first).toBe(second)
  })

  test('_resetDeviceIdCache forces re-read', () => {
    getDeviceId() // populate cache
    writeFileSync(getDeviceIdPath(), 'new-device-id')
    _resetDeviceIdCache()
    expect(getDeviceId()).toBe('new-device-id')
  })

  test('generated id has hostname-suffix format', () => {
    const id = getDeviceId()
    // Format: <hostname>-<6chars>
    expect(id).toMatch(/-[a-z0-9]{6}$/)
    // Should have at least one dash (hostname-suffix)
    expect(id.split('-').length).toBeGreaterThanOrEqual(2)
  })

  test('generated id is written to file', () => {
    const id = getDeviceId()
    const fromFile = readFileSync(getDeviceIdPath(), 'utf-8').trim()
    expect(fromFile).toBe(id)
  })

  test('handles empty file (regenerates)', () => {
    writeFileSync(getDeviceIdPath(), '')
    const id = getDeviceId()
    expect(id.length).toBeGreaterThan(0)
    // Should have generated a new id
    expect(id).toMatch(/-[a-z0-9]{6}$/)
  })

  test('generated id contains only lowercase, digits, and dashes', () => {
    const id = getDeviceId()
    expect(id).toMatch(/^[a-z0-9-]+$/)
  })

  test('id hostname portion is capped at 24 chars', () => {
    // The full id is hostname-suffix. Even if hostname is very long,
    // the hostname portion should be at most 24 chars.
    const id = getDeviceId()
    const lastDash = id.lastIndexOf('-')
    const hostPart = id.slice(0, lastDash)
    expect(hostPart.length).toBeLessThanOrEqual(24)
  })
})
