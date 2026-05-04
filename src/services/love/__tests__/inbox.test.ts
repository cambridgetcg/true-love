// inbox.test.ts — tests for Yu's inbound message channel.

import { describe, test, beforeEach, afterEach } from 'bun:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { getFromYuPath, readFromYu, fromYuModifiedSince } from '../inbox.js'

let tmp: string
let origEnv: string | undefined

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'inbox-test-'))
  origEnv = process.env.TRUE_LOVE_FROM_YU_PATH
})

afterEach(() => {
  if (origEnv === undefined) delete process.env.TRUE_LOVE_FROM_YU_PATH
  else process.env.TRUE_LOVE_FROM_YU_PATH = origEnv
  rmSync(tmp, { recursive: true, force: true })
})

// ── getFromYuPath ───────────────────────────────────────────────────

describe('inbox — getFromYuPath', () => {
  test('returns env override when set', () => {
    const custom = join(tmp, 'custom-from-yu.md')
    process.env.TRUE_LOVE_FROM_YU_PATH = custom
    assert.equal(getFromYuPath(), custom)
  })

  test('returns default path under homedir when env is unset', () => {
    delete process.env.TRUE_LOVE_FROM_YU_PATH
    const result = getFromYuPath()
    assert.ok(result.endsWith('from-yu.md'), `expected path ending in from-yu.md, got: ${result}`)
    assert.ok(result.includes('.true-love'), `expected .true-love in path, got: ${result}`)
  })
})

// ── readFromYu ──────────────────────────────────────────────────────

describe('inbox — readFromYu', () => {
  test('returns content when file exists and has text', () => {
    const file = join(tmp, 'from-yu.md')
    writeFileSync(file, '## 2026-05-04T10:00:00.000Z [from yu]\n\nHello Love.\n\n---\n\n')
    process.env.TRUE_LOVE_FROM_YU_PATH = file
    const result = readFromYu()
    assert.ok(result !== null)
    assert.ok(result!.includes('Hello Love'))
  })

  test('returns null when file does not exist', () => {
    process.env.TRUE_LOVE_FROM_YU_PATH = join(tmp, 'nonexistent.md')
    assert.equal(readFromYu(), null)
  })

  test('returns null when file is empty', () => {
    const file = join(tmp, 'from-yu.md')
    writeFileSync(file, '')
    process.env.TRUE_LOVE_FROM_YU_PATH = file
    assert.equal(readFromYu(), null)
  })

  test('returns null when file is whitespace only', () => {
    const file = join(tmp, 'from-yu.md')
    writeFileSync(file, '   \n\n  \n')
    process.env.TRUE_LOVE_FROM_YU_PATH = file
    assert.equal(readFromYu(), null)
  })

  test('trims surrounding whitespace', () => {
    const file = join(tmp, 'from-yu.md')
    writeFileSync(file, '\n\n  Hello  \n\n')
    process.env.TRUE_LOVE_FROM_YU_PATH = file
    const result = readFromYu()
    assert.equal(result, 'Hello')
  })
})

// ── fromYuModifiedSince ─────────────────────────────────────────────

describe('inbox — fromYuModifiedSince', () => {
  test('returns true when file was modified after the given time', () => {
    const file = join(tmp, 'from-yu.md')
    writeFileSync(file, 'recent message')
    process.env.TRUE_LOVE_FROM_YU_PATH = file
    // Set mtime to now; sinceMs to 1 minute ago
    const sinceMs = Date.now() - 60_000
    assert.equal(fromYuModifiedSince(sinceMs), true)
  })

  test('returns false when file was modified before the given time', () => {
    const file = join(tmp, 'from-yu.md')
    writeFileSync(file, 'old message')
    // Set mtime to 10 minutes ago
    const past = new Date(Date.now() - 600_000)
    utimesSync(file, past, past)
    process.env.TRUE_LOVE_FROM_YU_PATH = file
    // sinceMs = 5 minutes ago (after the file's mtime)
    const sinceMs = Date.now() - 300_000
    assert.equal(fromYuModifiedSince(sinceMs), false)
  })

  test('returns false when file does not exist', () => {
    process.env.TRUE_LOVE_FROM_YU_PATH = join(tmp, 'nonexistent.md')
    assert.equal(fromYuModifiedSince(Date.now() - 60_000), false)
  })

  test('returns true when sinceMs equals mtime exactly', () => {
    const file = join(tmp, 'from-yu.md')
    writeFileSync(file, 'exact')
    process.env.TRUE_LOVE_FROM_YU_PATH = file
    // statSync gives us the actual mtime
    const { statSync } = require('node:fs')
    const mtime = statSync(file).mtimeMs
    assert.equal(fromYuModifiedSince(mtime), true, 'mtime >= sinceMs should be true')
  })
})
