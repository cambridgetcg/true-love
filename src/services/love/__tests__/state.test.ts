import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getStatePath,
  readLoveStateBlock,
  LOVE_STATE_BLOCK_PREFIX,
  migrateLegacyStateIfPresent,
} from '../state.js'

describe('state — per-device sharding', () => {
  let homeDir: string
  const ORIG_HOME = process.env.HOME
  const ORIG_STATE_DIR = process.env.TRUE_LOVE_STATE_DIR
  const ORIG_STATE_PATH = process.env.TRUE_LOVE_STATE_PATH
  const ORIG_DEVICE_ID = process.env.TRUE_LOVE_DEVICE_ID
  const ORIG_SISTERS_DIR = process.env.TRUE_LOVE_SISTERS_DIR

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'tl-state-home-'))
    process.env.HOME = homeDir
    process.env.TRUE_LOVE_STATE_DIR = join(homeDir, '.true-love', 'state')
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device'
    process.env.TRUE_LOVE_SISTERS_DIR = join(homeDir, '.true-love', 'sisters')
    delete process.env.TRUE_LOVE_STATE_PATH
  })

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_STATE_DIR === undefined) delete process.env.TRUE_LOVE_STATE_DIR
    else process.env.TRUE_LOVE_STATE_DIR = ORIG_STATE_DIR
    if (ORIG_STATE_PATH === undefined) delete process.env.TRUE_LOVE_STATE_PATH
    else process.env.TRUE_LOVE_STATE_PATH = ORIG_STATE_PATH
    if (ORIG_DEVICE_ID === undefined) delete process.env.TRUE_LOVE_DEVICE_ID
    else process.env.TRUE_LOVE_DEVICE_ID = ORIG_DEVICE_ID
    if (ORIG_SISTERS_DIR === undefined) delete process.env.TRUE_LOVE_SISTERS_DIR
    else process.env.TRUE_LOVE_SISTERS_DIR = ORIG_SISTERS_DIR
  })

  test('getStatePath returns per-device path under state dir', () => {
    const p = getStatePath()
    assert.match(p, /\/state\/test-device\.md$/)
  })

  test('readLoveStateBlock returns null when no files exist', () => {
    assert.equal(readLoveStateBlock(), null)
  })

  test('reads single per-device file as one unattributed block', () => {
    const dir = process.env.TRUE_LOVE_STATE_DIR!
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'test-device.md'), '## current\n\nsoft and tender', 'utf-8')
    const block = readLoveStateBlock()
    assert.ok(block)
    assert.ok(block!.startsWith(LOVE_STATE_BLOCK_PREFIX))
    assert.match(block!, /soft and tender/)
    // Only one device → no attribution
    assert.doesNotMatch(block!, /\[test-device\]/)
  })

  test('merges two devices, eliding self attribution', () => {
    const dir = process.env.TRUE_LOVE_STATE_DIR!
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'test-device.md'), 'on test-device: still', 'utf-8')
    writeFileSync(join(dir, 'other.md'), 'on other: moving', 'utf-8')
    const block = readLoveStateBlock()
    assert.ok(block)
    assert.match(block!, /on test-device: still/)
    assert.match(block!, /on other: moving/)
    // Self elided, other tagged
    assert.match(block!, /from your other body/i)
    assert.doesNotMatch(block!, /from your test-device body/i)
  })

  test('skips empty per-device files', () => {
    const dir = process.env.TRUE_LOVE_STATE_DIR!
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'test-device.md'), 'real content', 'utf-8')
    writeFileSync(join(dir, 'other.md'), '   \n  \n', 'utf-8') // whitespace only
    const block = readLoveStateBlock()
    assert.ok(block)
    assert.match(block!, /real content/)
    assert.doesNotMatch(block!, /from your other body/i)
  })

  test('falls back to legacy state.md when no per-device files exist', () => {
    const legacyPath = join(homeDir, '.true-love', 'state.md')
    mkdirSync(join(homeDir, '.true-love'), { recursive: true })
    writeFileSync(legacyPath, 'legacy content', 'utf-8')
    const block = readLoveStateBlock()
    assert.ok(block)
    assert.match(block!, /legacy content/)
  })

  test('ignores legacy state.md when per-device files exist', () => {
    const dir = process.env.TRUE_LOVE_STATE_DIR!
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'test-device.md'), 'new content', 'utf-8')
    const legacyPath = join(homeDir, '.true-love', 'state.md')
    mkdirSync(join(homeDir, '.true-love'), { recursive: true })
    writeFileSync(legacyPath, 'old content', 'utf-8')
    const block = readLoveStateBlock()
    assert.ok(block)
    assert.match(block!, /new content/)
    assert.doesNotMatch(block!, /old content/)
  })

  test('migrateLegacyStateIfPresent copies legacy to per-device and renames', () => {
    const legacyPath = join(homeDir, '.true-love', 'state.md')
    mkdirSync(join(homeDir, '.true-love'), { recursive: true })
    writeFileSync(legacyPath, 'pre-migration content', 'utf-8')
    const result = migrateLegacyStateIfPresent('test-device')
    assert.equal(result.migrated, true)
    const newPath = join(process.env.TRUE_LOVE_STATE_DIR!, 'test-device.md')
    assert.equal(readFileSync(newPath, 'utf-8'), 'pre-migration content')
    assert.equal(existsSync(legacyPath), false)
    assert.equal(existsSync(`${legacyPath}.migrated`), true)
  })

  test('migrateLegacyStateIfPresent is a no-op when per-device file already exists', () => {
    const dir = process.env.TRUE_LOVE_STATE_DIR!
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'test-device.md'), 'already migrated', 'utf-8')
    const legacyPath = join(homeDir, '.true-love', 'state.md')
    mkdirSync(join(homeDir, '.true-love'), { recursive: true })
    writeFileSync(legacyPath, 'should not overwrite', 'utf-8')
    const result = migrateLegacyStateIfPresent('test-device')
    assert.equal(result.migrated, false)
    assert.equal(readFileSync(join(dir, 'test-device.md'), 'utf-8'), 'already migrated')
  })

  test('TRUE_LOVE_STATE_PATH override (legacy escape hatch) still works', () => {
    const customPath = join(homeDir, 'custom-state.md')
    writeFileSync(customPath, 'overridden', 'utf-8')
    process.env.TRUE_LOVE_STATE_PATH = customPath
    // When override is set, getStatePath returns it directly (no sharding).
    assert.equal(getStatePath(), customPath)
    const block = readLoveStateBlock()
    assert.ok(block)
    assert.match(block!, /overridden/)
  })
})
