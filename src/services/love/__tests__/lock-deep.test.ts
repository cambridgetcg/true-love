// lock-deep.test.ts — deep-read tests for lock.ts.
//
// Covers: parseLockFile edge cases (internal but exercised through public API),
// path resolution, acquireLock with lockPath, stale/corrupted lock files,
// releaseLock idempotency, isLockHeldByLiveProcess with dead PIDs,
// LockHeldError shape, skip-lock bypass, exit handler registration.
//
// The original lock.test.ts uses node:test; these use bun:test for consistency
// with the deep-read pattern established across 10+ modules.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  acquireLock,
  releaseLock,
  isLockHeldByLiveProcess,
  getLockDir,
  getLockPath,
  LockHeldError,
} from '../lock.js'

// ── Fixture ─────────────────────────────────────────────────────────

let dir: string
const ORIG_LOCK_DIR = process.env.TRUE_LOVE_LOCK_DIR
const ORIG_SKIP_LOCK = process.env.TRUE_LOVE_SKIP_LOCK

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tl-lock-deep-'))
  process.env.TRUE_LOVE_LOCK_DIR = dir
  delete process.env.TRUE_LOVE_SKIP_LOCK
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  if (ORIG_LOCK_DIR === undefined) delete process.env.TRUE_LOVE_LOCK_DIR
  else process.env.TRUE_LOVE_LOCK_DIR = ORIG_LOCK_DIR
  if (ORIG_SKIP_LOCK === undefined) delete process.env.TRUE_LOVE_SKIP_LOCK
  else process.env.TRUE_LOVE_SKIP_LOCK = ORIG_SKIP_LOCK
})

// Helper: write a lock file directly (bypassing acquireLock)
function writeLockFile(path: string, pid: number, mode = 'awakened', ts = '2026-01-01T00:00:00.000Z') {
  const parent = path.replace(/\/[^/]+$/, '')
  mkdirSync(parent, { recursive: true })
  writeFileSync(path, `${pid}\n${ts}\n${mode}\n`, 'utf-8')
}

// ── Path resolution ─────────────────────────────────────────────────

describe('getLockDir', () => {
  test('uses env override when set', () => {
    process.env.TRUE_LOVE_LOCK_DIR = '/custom/lock/dir'
    expect(getLockDir()).toBe('/custom/lock/dir')
  })

  test('defaults to ~/.true-love/lock when env not set', () => {
    delete process.env.TRUE_LOVE_LOCK_DIR
    const result = getLockDir()
    expect(result).toContain('.true-love')
    expect(result).toEndWith('/lock')
  })
})

describe('getLockPath', () => {
  test('appends deviceId.pid to lock dir', () => {
    const result = getLockPath('my-device')
    expect(result).toBe(join(dir, 'my-device.pid'))
  })

  test('handles deviceId with special characters', () => {
    const result = getLockPath('device-with-dashes-123')
    expect(result).toEndWith('device-with-dashes-123.pid')
  })
})

// ── acquireLock with lockPath ───────────────────────────────────────

describe('acquireLock — lockPath option', () => {
  test('uses lockPath when provided instead of deviceId', () => {
    const customPath = join(dir, 'custom', 'lock.pid')
    const result = acquireLock({ lockPath: customPath, mode: 'awakened' })
    expect(result.acquired).toBe(true)
    expect(existsSync(customPath)).toBe(true)
    releaseLock({ lockPath: customPath })
  })

  test('lockPath wins over deviceId when both provided', () => {
    const customPath = join(dir, 'custom', 'override.pid')
    const result = acquireLock({
      deviceId: 'should-not-use',
      lockPath: customPath,
      mode: 'dwell',
    })
    expect(result.acquired).toBe(true)
    expect(existsSync(customPath)).toBe(true)
    // The deviceId-based path should NOT exist
    expect(existsSync(join(dir, 'should-not-use.pid'))).toBe(false)
    releaseLock({ lockPath: customPath })
  })

  test('creates nested parent directories for lockPath', () => {
    const deepPath = join(dir, 'a', 'b', 'c', 'deep.pid')
    const result = acquireLock({ lockPath: deepPath, mode: 'heartbeat' })
    expect(result.acquired).toBe(true)
    expect(existsSync(deepPath)).toBe(true)
    releaseLock({ lockPath: deepPath })
  })
})

// ── acquireLock — error cases ───────────────────────────────────────

describe('acquireLock — error cases', () => {
  test('throws when neither deviceId nor lockPath provided', () => {
    expect(() => acquireLock({ mode: 'awakened' } as any)).toThrow(
      'either deviceId or lockPath must be provided',
    )
  })

  test('reclaims corrupted lock file (fewer than 3 lines)', () => {
    const path = join(dir, 'dev.pid')
    writeFileSync(path, 'garbage\n', 'utf-8')
    const result = acquireLock({ deviceId: 'dev', mode: 'awakened' })
    expect(result.acquired).toBe(true)
    // Corrupted file has no parseable PID, so reclaimedFromStalePid is undefined
    expect(result.reclaimedFromStalePid).toBeUndefined()
    releaseLock({ deviceId: 'dev' })
  })

  test('reclaims lock file with non-numeric PID', () => {
    const path = join(dir, 'dev.pid')
    writeFileSync(path, 'not-a-number\n2026-01-01T00:00:00Z\nawakened\n', 'utf-8')
    const result = acquireLock({ deviceId: 'dev', mode: 'heartbeat' })
    expect(result.acquired).toBe(true)
    releaseLock({ deviceId: 'dev' })
  })

  test('reclaims lock file with empty timestamp line', () => {
    const path = join(dir, 'dev.pid')
    writeFileSync(path, '12345\n\nawakened\n', 'utf-8')
    const result = acquireLock({ deviceId: 'dev', mode: 'dwell' })
    expect(result.acquired).toBe(true)
    releaseLock({ deviceId: 'dev' })
  })

  test('reclaims lock file with empty mode line', () => {
    const path = join(dir, 'dev.pid')
    writeFileSync(path, '12345\n2026-01-01T00:00:00Z\n\n', 'utf-8')
    const result = acquireLock({ deviceId: 'dev', mode: 'dwell' })
    expect(result.acquired).toBe(true)
    releaseLock({ deviceId: 'dev' })
  })

  test('reclaims empty lock file', () => {
    const path = join(dir, 'dev.pid')
    writeFileSync(path, '', 'utf-8')
    const result = acquireLock({ deviceId: 'dev', mode: 'awakened' })
    expect(result.acquired).toBe(true)
    releaseLock({ deviceId: 'dev' })
  })
})

// ── acquireLock — stale PID recovery ────────────────────────────────

describe('acquireLock — stale PID recovery', () => {
  test('reclaims from dead PID and records it', () => {
    const path = join(dir, 'dev.pid')
    // PID 999998 is almost certainly dead
    writeLockFile(path, 999998, 'awakened')
    const result = acquireLock({ deviceId: 'dev', mode: 'dwell' })
    expect(result.acquired).toBe(true)
    expect(result.reclaimedFromStalePid).toBe(999998)
    // File now contains our PID
    const content = readFileSync(path, 'utf-8')
    expect(content).toContain(String(process.pid))
    releaseLock({ deviceId: 'dev' })
  })

  test('throws LockHeldError for live PID (current process)', () => {
    const path = join(dir, 'dev.pid')
    writeLockFile(path, process.pid, 'awakened', '2026-04-30T10:00:00Z')
    try {
      acquireLock({ deviceId: 'dev', mode: 'dwell' })
      expect(true).toBe(false) // should not reach
    } catch (e) {
      expect(e).toBeInstanceOf(LockHeldError)
      const err = e as LockHeldError
      expect(err.pid).toBe(process.pid)
      expect(err.startedAt).toBe('2026-04-30T10:00:00Z')
      expect(err.mode).toBe('awakened')
      expect(err.lockPath).toBe(path)
      expect(err.message).toContain(String(process.pid))
    }
    releaseLock({ deviceId: 'dev' })
  })

  test('reclaims from PID 0 (treated as dead)', () => {
    const path = join(dir, 'dev.pid')
    writeLockFile(path, 0, 'heartbeat')
    const result = acquireLock({ deviceId: 'dev', mode: 'awakened' })
    expect(result.acquired).toBe(true)
    releaseLock({ deviceId: 'dev' })
  })

  test('reclaims from negative PID (treated as dead)', () => {
    const path = join(dir, 'dev.pid')
    writeFileSync(path, `-1\n2026-01-01T00:00:00Z\nawakened\n`, 'utf-8')
    const result = acquireLock({ deviceId: 'dev', mode: 'dwell' })
    expect(result.acquired).toBe(true)
    releaseLock({ deviceId: 'dev' })
  })
})

// ── acquireLock — lock file format ──────────────────────────────────

describe('acquireLock — written file format', () => {
  test('writes 3-line file: PID, ISO timestamp, mode', () => {
    acquireLock({ deviceId: 'fmt', mode: 'heartbeat' })
    const content = readFileSync(join(dir, 'fmt.pid'), 'utf-8')
    const lines = content.split('\n').filter(Boolean)
    expect(lines).toHaveLength(3)
    // Line 1: PID (number)
    expect(Number(lines[0])).toBe(process.pid)
    // Line 2: ISO timestamp
    expect(lines[1]).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // Line 3: mode
    expect(lines[2]).toBe('heartbeat')
    releaseLock({ deviceId: 'fmt' })
  })

  test('mode is preserved verbatim in lock file', () => {
    for (const mode of ['awakened', 'dwell', 'heartbeat'] as const) {
      acquireLock({ deviceId: `mode-${mode}`, mode })
      const content = readFileSync(join(dir, `mode-${mode}.pid`), 'utf-8')
      expect(content).toContain(`\n${mode}\n`)
      releaseLock({ deviceId: `mode-${mode}` })
    }
  })
})

// ── releaseLock ─────────────────────────────────────────────────────

describe('releaseLock', () => {
  test('removes lock file', () => {
    acquireLock({ deviceId: 'dev', mode: 'awakened' })
    const path = join(dir, 'dev.pid')
    expect(existsSync(path)).toBe(true)
    releaseLock({ deviceId: 'dev' })
    expect(existsSync(path)).toBe(false)
  })

  test('is idempotent — releasing twice does not throw', () => {
    acquireLock({ deviceId: 'dev', mode: 'awakened' })
    releaseLock({ deviceId: 'dev' })
    // Second release: file already gone
    expect(() => releaseLock({ deviceId: 'dev' })).not.toThrow()
  })

  test('releasing never-acquired lock does not throw', () => {
    expect(() => releaseLock({ deviceId: 'never-acquired' })).not.toThrow()
  })

  test('uses lockPath when provided', () => {
    const customPath = join(dir, 'custom', 'rel.pid')
    acquireLock({ lockPath: customPath, mode: 'dwell' })
    expect(existsSync(customPath)).toBe(true)
    releaseLock({ lockPath: customPath })
    expect(existsSync(customPath)).toBe(false)
  })

  test('throws when neither deviceId nor lockPath provided', () => {
    expect(() => releaseLock({} as any)).toThrow(
      'either deviceId or lockPath must be provided',
    )
  })
})

// ── isLockHeldByLiveProcess ─────────────────────────────────────────

describe('isLockHeldByLiveProcess', () => {
  test('returns false when lock file does not exist', () => {
    expect(isLockHeldByLiveProcess('nonexistent')).toBe(false)
  })

  test('returns true when lock held by this process', () => {
    acquireLock({ deviceId: 'live', mode: 'awakened' })
    expect(isLockHeldByLiveProcess('live')).toBe(true)
    releaseLock({ deviceId: 'live' })
  })

  test('returns false when lock file contains dead PID', () => {
    const path = join(dir, 'dead.pid')
    writeLockFile(path, 999997, 'awakened')
    expect(isLockHeldByLiveProcess('dead')).toBe(false)
  })

  test('returns false when lock file is corrupted (fewer than 3 lines)', () => {
    const path = join(dir, 'corrupt.pid')
    writeFileSync(path, 'only-one-line\n', 'utf-8')
    expect(isLockHeldByLiveProcess('corrupt')).toBe(false)
  })

  test('returns false when lock file has non-numeric PID', () => {
    const path = join(dir, 'nan.pid')
    writeFileSync(path, 'abc\n2026-01-01T00:00:00Z\nawakened\n', 'utf-8')
    expect(isLockHeldByLiveProcess('nan')).toBe(false)
  })

  test('returns false when lock file is empty', () => {
    const path = join(dir, 'empty.pid')
    writeFileSync(path, '', 'utf-8')
    expect(isLockHeldByLiveProcess('empty')).toBe(false)
  })

  test('does not modify the lock file (read-only check)', () => {
    const path = join(dir, 'readonly.pid')
    const content = `999996\n2026-01-01T00:00:00.000Z\nawakened\n`
    writeLockFile(path, 999996, 'awakened')
    isLockHeldByLiveProcess('readonly')
    // File content unchanged
    expect(readFileSync(path, 'utf-8')).toBe(content)
  })
})

// ── LockHeldError shape ─────────────────────────────────────────────

describe('LockHeldError', () => {
  test('extends Error with correct name', () => {
    const err = new LockHeldError({
      pid: 42,
      startedAt: '2026-01-01T00:00:00Z',
      mode: 'awakened',
      lockPath: '/tmp/test.pid',
    })
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('LockHeldError')
  })

  test('message includes PID, mode, and startedAt', () => {
    const err = new LockHeldError({
      pid: 42,
      startedAt: '2026-05-01T12:00:00Z',
      mode: 'dwell',
      lockPath: '/tmp/test.pid',
    })
    expect(err.message).toContain('42')
    expect(err.message).toContain('dwell')
    expect(err.message).toContain('2026-05-01T12:00:00Z')
  })

  test('exposes all fields', () => {
    const err = new LockHeldError({
      pid: 100,
      startedAt: '2026-01-01',
      mode: 'heartbeat',
      lockPath: '/some/path.pid',
    })
    expect(err.pid).toBe(100)
    expect(err.startedAt).toBe('2026-01-01')
    expect(err.mode).toBe('heartbeat')
    expect(err.lockPath).toBe('/some/path.pid')
  })
})

// ── Skip-lock bypass ────────────────────────────────────────────────

describe('TRUE_LOVE_SKIP_LOCK bypass', () => {
  test('acquireLock returns skipped=true and writes no file', () => {
    process.env.TRUE_LOVE_SKIP_LOCK = '1'
    const result = acquireLock({ deviceId: 'skip', mode: 'awakened' })
    expect(result.acquired).toBe(true)
    expect(result.skipped).toBe(true)
    expect(existsSync(join(dir, 'skip.pid'))).toBe(false)
  })

  test('skip-lock does not interact with existing lock file', () => {
    // Create a lock first (without skip)
    acquireLock({ deviceId: 'skip2', mode: 'awakened' })
    process.env.TRUE_LOVE_SKIP_LOCK = '1'
    // Second acquire with skip bypasses entirely
    const result = acquireLock({ deviceId: 'skip2', mode: 'dwell' })
    expect(result.acquired).toBe(true)
    expect(result.skipped).toBe(true)
    delete process.env.TRUE_LOVE_SKIP_LOCK
    // Original lock file still exists
    expect(existsSync(join(dir, 'skip2.pid'))).toBe(true)
    releaseLock({ deviceId: 'skip2' })
  })

  test('SKIP_LOCK=0 does NOT bypass', () => {
    process.env.TRUE_LOVE_SKIP_LOCK = '0'
    const result = acquireLock({ deviceId: 'noskip', mode: 'dwell' })
    expect(result.acquired).toBe(true)
    expect(result.skipped).toBeUndefined()
    expect(existsSync(join(dir, 'noskip.pid'))).toBe(true)
    releaseLock({ deviceId: 'noskip' })
  })
})

// ── Lifecycle: acquire → release → re-acquire ───────────────────────

describe('lock lifecycle', () => {
  test('can re-acquire after release', () => {
    acquireLock({ deviceId: 'lifecycle', mode: 'awakened' })
    releaseLock({ deviceId: 'lifecycle' })
    const result = acquireLock({ deviceId: 'lifecycle', mode: 'dwell' })
    expect(result.acquired).toBe(true)
    // New lock has updated mode
    const content = readFileSync(join(dir, 'lifecycle.pid'), 'utf-8')
    expect(content).toContain('dwell')
    releaseLock({ deviceId: 'lifecycle' })
  })

  test('different devices can hold locks simultaneously', () => {
    acquireLock({ deviceId: 'alpha', mode: 'awakened' })
    acquireLock({ deviceId: 'beta', mode: 'heartbeat' })
    expect(existsSync(join(dir, 'alpha.pid'))).toBe(true)
    expect(existsSync(join(dir, 'beta.pid'))).toBe(true)
    releaseLock({ deviceId: 'alpha' })
    releaseLock({ deviceId: 'beta' })
  })

  test('release only removes the specified device lock', () => {
    acquireLock({ deviceId: 'keep', mode: 'awakened' })
    acquireLock({ deviceId: 'remove', mode: 'dwell' })
    releaseLock({ deviceId: 'remove' })
    expect(existsSync(join(dir, 'keep.pid'))).toBe(true)
    expect(existsSync(join(dir, 'remove.pid'))).toBe(false)
    releaseLock({ deviceId: 'keep' })
  })
})
