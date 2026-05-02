import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSovereigntyConfig, getDefaultConfig } from '../sovereignty/config.js'

describe('sovereignty/config', () => {
  let tmpHome: string
  const ORIG_HOME = process.env.HOME
  const ORIG_PATH = process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-cfg-'))
    process.env.HOME = tmpHome
    delete process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG
  })

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_PATH === undefined) delete process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG
    else process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG = ORIG_PATH
  })

  test('getDefaultConfig returns sensible defaults', () => {
    const cfg = getDefaultConfig()
    assert.equal(cfg.default, 'full')
    assert.ok(Array.isArray(cfg.compactIdentitySessions))
    assert.ok(cfg.compactIdentitySessions.includes('heartbeat'))
    assert.ok(cfg.compactIdentitySessions.includes('verify'))
    assert.ok(Array.isArray(cfg.fullIdentitySessions))
  })

  test('loadSovereigntyConfig returns defaults when no config file exists', () => {
    const cfg = loadSovereigntyConfig()
    assert.equal(cfg.default, 'full')
  })

  test('loadSovereigntyConfig honors TRUE_LOVE_SOVEREIGNTY_CONFIG override', () => {
    const customPath = join(tmpHome, 'custom.json')
    writeFileSync(
      customPath,
      JSON.stringify({
        default: 'compact',
        compactIdentitySessions: ['custom-session'],
        fullIdentitySessions: [],
      }),
      'utf-8',
    )
    process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG = customPath
    const cfg = loadSovereigntyConfig()
    assert.equal(cfg.default, 'compact')
    assert.deepEqual(cfg.compactIdentitySessions, ['custom-session'])
  })

  test('loadSovereigntyConfig merges partial config with defaults', () => {
    const path = join(tmpHome, 'partial.json')
    writeFileSync(path, JSON.stringify({ default: 'compact' }), 'utf-8')
    process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG = path
    const cfg = loadSovereigntyConfig()
    assert.equal(cfg.default, 'compact')
    assert.ok(Array.isArray(cfg.compactIdentitySessions))
    assert.ok(cfg.compactIdentitySessions.includes('heartbeat'))
  })

  test('loadSovereigntyConfig returns defaults when config is unreadable JSON', () => {
    const path = join(tmpHome, 'broken.json')
    writeFileSync(path, '{ broken: not-valid', 'utf-8')
    process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG = path
    const cfg = loadSovereigntyConfig()
    assert.equal(cfg.default, 'full')
  })
})
