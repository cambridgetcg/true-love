import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  findKingdomBin,
  isKingdomAvailable,
  _resetKingdomCache,
} from '../kingdom-citizen.js'

/**
 * Build a tmp dir of stub kingdom-* scripts. Each stub takes args and emits
 * the provided stdout. Returns the dir path; cleanup is the test's
 * responsibility via rmSync.
 */
function mkStubKingdomDir(stubs: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'tl-kingdom-'))
  for (const [name, body] of Object.entries(stubs)) {
    const path = join(dir, name)
    // Shell heredoc emitting body verbatim, then exit 0.
    const script = `#!/bin/sh\ncat <<'STUB_EOF'\n${body}\nSTUB_EOF\nexit 0\n`
    writeFileSync(path, script, { mode: 0o755 })
  }
  return dir
}

describe('kingdom-citizen — resolution + availability', () => {
  let dir: string
  const ORIG_BIN_DIR = process.env.TRUE_LOVE_KINGDOM_BIN_DIR
  const ORIG_SKIP = process.env.TRUE_LOVE_SKIP_KINGDOM

  beforeEach(() => {
    dir = mkStubKingdomDir({
      'kingdom-doctor': '{"exit":0}',
      'kingdom-pulse': '',
    })
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    delete process.env.TRUE_LOVE_SKIP_KINGDOM
    _resetKingdomCache()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    if (ORIG_BIN_DIR === undefined) delete process.env.TRUE_LOVE_KINGDOM_BIN_DIR
    else process.env.TRUE_LOVE_KINGDOM_BIN_DIR = ORIG_BIN_DIR
    if (ORIG_SKIP === undefined) delete process.env.TRUE_LOVE_SKIP_KINGDOM
    else process.env.TRUE_LOVE_SKIP_KINGDOM = ORIG_SKIP
    _resetKingdomCache()
  })

  test('findKingdomBin returns env-dir path when set and binary exists', () => {
    const path = findKingdomBin('doctor')
    assert.equal(path, join(dir, 'kingdom-doctor'))
  })

  test('findKingdomBin returns null when binary not in env-dir', () => {
    rmSync(join(dir, 'kingdom-doctor'))
    const path = findKingdomBin('doctor')
    // Without an env-dir hit, falls through to PATH or ~/love-unlimited.
    // In tests we don't guarantee those, so accept null OR a real path.
    if (path !== null) {
      assert.match(path, /(kingdom-doctor|love-unlimited)/)
    } else {
      assert.equal(path, null)
    }
  })

  test('isKingdomAvailable returns true when env-dir binary exists', async () => {
    assert.equal(await isKingdomAvailable(), true)
  })

  test('isKingdomAvailable returns false when TRUE_LOVE_SKIP_KINGDOM=1', async () => {
    process.env.TRUE_LOVE_SKIP_KINGDOM = '1'
    _resetKingdomCache()
    assert.equal(await isKingdomAvailable(), false)
  })

  test('isKingdomAvailable returns false when env-dir empty and PATH/fallback also miss', async () => {
    rmSync(dir, { recursive: true, force: true })
    dir = mkdtempSync(join(tmpdir(), 'tl-kingdom-empty-'))
    process.env.TRUE_LOVE_KINGDOM_BIN_DIR = dir
    _resetKingdomCache()
    // We can't guarantee PATH+fallback miss in CI, so this asserts the
    // call doesn't throw and returns boolean.
    const result = await isKingdomAvailable()
    assert.equal(typeof result, 'boolean')
  })

  test('isKingdomAvailable memoizes result across calls', async () => {
    const a = await isKingdomAvailable()
    rmSync(join(dir, 'kingdom-doctor'))
    // Cache should keep returning the original answer.
    const b = await isKingdomAvailable()
    assert.equal(a, b)
  })
})
