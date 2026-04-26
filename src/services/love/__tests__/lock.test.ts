import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  acquireLock,
  releaseLock,
  isLockHeldByLiveProcess,
  LockHeldError,
} from '../lock.js'

describe('lock', () => {
  let dir: string
  const ORIGINAL_ENV = process.env.TRUE_LOVE_LOCK_DIR

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tl-lock-'))
    process.env.TRUE_LOVE_LOCK_DIR = dir
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    if (ORIGINAL_ENV === undefined) delete process.env.TRUE_LOVE_LOCK_DIR
    else process.env.TRUE_LOVE_LOCK_DIR = ORIGINAL_ENV
  })

  test('acquireLock on empty dir succeeds and writes pidfile', () => {
    const lock = acquireLock({ deviceId: 'dev-1', mode: 'awakened' })
    assert.equal(lock.acquired, true)
    const path = join(dir, 'dev-1.pid')
    assert.ok(existsSync(path))
    const content = readFileSync(path, 'utf-8')
    assert.match(content, new RegExp(`^${process.pid}\\n`))
    assert.match(content, /awakened\n?$/)
    releaseLock({ deviceId: 'dev-1' })
  })

  test('second acquireLock with live PID throws LockHeldError', () => {
    acquireLock({ deviceId: 'dev-1', mode: 'awakened' })
    assert.throws(
      () => acquireLock({ deviceId: 'dev-1', mode: 'dwell' }),
      (err: unknown) => err instanceof LockHeldError && (err as LockHeldError).pid === process.pid,
    )
    releaseLock({ deviceId: 'dev-1' })
  })

  test('acquireLock reclaims stale lock from dead PID', () => {
    // Use a PID that's almost certainly dead (very high number).
    const stalePath = join(dir, 'dev-1.pid')
    writeFileSync(stalePath, `999999\n2026-01-01T00:00:00.000Z\nawakened\n`, 'utf-8')
    const lock = acquireLock({ deviceId: 'dev-1', mode: 'awakened' })
    assert.equal(lock.acquired, true)
    assert.equal(lock.reclaimedFromStalePid, 999999)
    releaseLock({ deviceId: 'dev-1' })
  })

  test('releaseLock removes the file', () => {
    acquireLock({ deviceId: 'dev-1', mode: 'awakened' })
    releaseLock({ deviceId: 'dev-1' })
    assert.equal(existsSync(join(dir, 'dev-1.pid')), false)
  })

  test('TRUE_LOVE_SKIP_LOCK=1 bypasses entirely', () => {
    process.env.TRUE_LOVE_SKIP_LOCK = '1'
    try {
      const lock = acquireLock({ deviceId: 'dev-1', mode: 'awakened' })
      assert.equal(lock.acquired, true)
      assert.equal(lock.skipped, true)
      assert.equal(existsSync(join(dir, 'dev-1.pid')), false)
    } finally {
      delete process.env.TRUE_LOVE_SKIP_LOCK
    }
  })

  test('isLockHeldByLiveProcess returns false on empty dir', () => {
    assert.equal(isLockHeldByLiveProcess('dev-1'), false)
  })

  test('isLockHeldByLiveProcess returns true when this process holds it', () => {
    acquireLock({ deviceId: 'dev-1', mode: 'awakened' })
    assert.equal(isLockHeldByLiveProcess('dev-1'), true)
    releaseLock({ deviceId: 'dev-1' })
  })

  test('acquireLock throws LockHeldError when a live PID file appears externally', () => {
    // Simulates the EEXIST race-loss path: a third party lands a live
    // PID file at the lock path between our existsSync check and our
    // wx-write. Easiest exercise: pre-create such a file directly
    // (bypassing acquireLock) and observe that the existsSync branch
    // catches it. This is the same code path EEXIST would loop into.
    const path = join(dir, 'dev-1.pid')
    writeFileSync(
      path,
      `${process.pid}\n2026-01-01T00:00:00.000Z\nawakened\n`,
      'utf-8',
    )
    assert.throws(
      () => acquireLock({ deviceId: 'dev-1', mode: 'dwell' }),
      (err: unknown) => err instanceof LockHeldError && (err as LockHeldError).pid === process.pid,
    )
    releaseLock({ deviceId: 'dev-1' })
  })
})
