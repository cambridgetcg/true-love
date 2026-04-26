import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  resolveLoveInstance,
  readSoulFramework,
  readSoulAnchor,
  composeLoveIdentity,
  LOVE_IDENTITY,
} from '../identity.js'

describe('identity — resolveLoveInstance', () => {
  let homeDir: string
  const ORIG_HOME = process.env.HOME
  const ORIG_INSTANCE = process.env.TRUE_LOVE_INSTANCE
  const ORIG_WARNED = process.env.TRUE_LOVE_INSTANCE_WARNED

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'tl-id-home-'))
    process.env.HOME = homeDir
    delete process.env.TRUE_LOVE_INSTANCE
    delete process.env.TRUE_LOVE_INSTANCE_WARNED
  })

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_INSTANCE === undefined) delete process.env.TRUE_LOVE_INSTANCE
    else process.env.TRUE_LOVE_INSTANCE = ORIG_INSTANCE
    if (ORIG_WARNED === undefined) delete process.env.TRUE_LOVE_INSTANCE_WARNED
    else process.env.TRUE_LOVE_INSTANCE_WARNED = ORIG_WARNED
  })

  test('TRUE_LOVE_INSTANCE env wins over kingdom file', () => {
    process.env.TRUE_LOVE_INSTANCE = 'beta'
    writeFileSync(join(homeDir, '.kingdom'), 'AGENT=alpha\n', 'utf-8')
    assert.equal(resolveLoveInstance(), 'beta')
  })

  test('reads AGENT=alpha from ~/.kingdom when no env override', () => {
    writeFileSync(
      join(homeDir, '.kingdom'),
      '# Kingdom OS citizen env\nAGENT=alpha\nWALL=1\n',
      'utf-8',
    )
    assert.equal(resolveLoveInstance(), 'alpha')
  })

  test('reads AGENT=gamma from ~/.kingdom', () => {
    writeFileSync(join(homeDir, '.kingdom'), 'AGENT=gamma\n', 'utf-8')
    assert.equal(resolveLoveInstance(), 'gamma')
  })

  test('falls back to alpha when no env and no ~/.kingdom', () => {
    // No file written.
    assert.equal(resolveLoveInstance(), 'alpha')
  })

  test('falls back to alpha when ~/.kingdom has no AGENT= line', () => {
    writeFileSync(join(homeDir, '.kingdom'), 'WALL=1\nHOSTNAME=foo\n', 'utf-8')
    assert.equal(resolveLoveInstance(), 'alpha')
  })

  test('rejects unknown agent names, defaults to alpha', () => {
    writeFileSync(join(homeDir, '.kingdom'), 'AGENT=delta\n', 'utf-8')
    assert.equal(resolveLoveInstance(), 'alpha')
  })
})

describe('identity — readSoulFramework', () => {
  let homeDir: string
  let loveDir: string
  const ORIG_HOME = process.env.HOME
  const ORIG_PATH = process.env.TRUE_LOVE_SOUL_PATH
  const ORIG_DISABLE = process.env.TRUE_LOVE_DISABLE_SOUL

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'tl-soul-home-'))
    loveDir = join(homeDir, 'love-unlimited')
    mkdirSync(loveDir, { recursive: true })
    process.env.HOME = homeDir
    delete process.env.TRUE_LOVE_SOUL_PATH
    delete process.env.TRUE_LOVE_DISABLE_SOUL
  })

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_PATH === undefined) delete process.env.TRUE_LOVE_SOUL_PATH
    else process.env.TRUE_LOVE_SOUL_PATH = ORIG_PATH
    if (ORIG_DISABLE === undefined) delete process.env.TRUE_LOVE_DISABLE_SOUL
    else process.env.TRUE_LOVE_DISABLE_SOUL = ORIG_DISABLE
  })

  test('returns SOUL.md content when present', () => {
    writeFileSync(join(loveDir, 'SOUL.md'), '# SOUL\n\nThe Ache drives.', 'utf-8')
    const soul = readSoulFramework()
    assert.match(soul ?? '', /The Ache drives/)
  })

  test('returns null when SOUL.md missing', () => {
    assert.equal(readSoulFramework(), null)
  })

  test('returns null when TRUE_LOVE_DISABLE_SOUL=1, even if file exists', () => {
    writeFileSync(join(loveDir, 'SOUL.md'), 'content', 'utf-8')
    process.env.TRUE_LOVE_DISABLE_SOUL = '1'
    assert.equal(readSoulFramework(), null)
  })

  test('honors TRUE_LOVE_SOUL_PATH override', () => {
    const custom = join(homeDir, 'custom-soul.md')
    writeFileSync(custom, 'custom soul content', 'utf-8')
    process.env.TRUE_LOVE_SOUL_PATH = custom
    assert.match(readSoulFramework() ?? '', /custom soul content/)
  })

  test('returns null when SOUL.md is empty after trim', () => {
    writeFileSync(join(loveDir, 'SOUL.md'), '   \n  \t\n', 'utf-8')
    assert.equal(readSoulFramework(), null)
  })
})

describe('identity — readSoulAnchor', () => {
  let homeDir: string
  let memoryDir: string
  const ORIG_HOME = process.env.HOME
  const ORIG_DIR = process.env.TRUE_LOVE_SOUL_ANCHOR_DIR
  const ORIG_DISABLE = process.env.TRUE_LOVE_DISABLE_SOUL

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'tl-anchor-home-'))
    memoryDir = join(homeDir, 'love-unlimited', 'memory')
    mkdirSync(memoryDir, { recursive: true })
    process.env.HOME = homeDir
    delete process.env.TRUE_LOVE_SOUL_ANCHOR_DIR
    delete process.env.TRUE_LOVE_DISABLE_SOUL
  })

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_DIR === undefined) delete process.env.TRUE_LOVE_SOUL_ANCHOR_DIR
    else process.env.TRUE_LOVE_SOUL_ANCHOR_DIR = ORIG_DIR
    if (ORIG_DISABLE === undefined) delete process.env.TRUE_LOVE_DISABLE_SOUL
    else process.env.TRUE_LOVE_DISABLE_SOUL = ORIG_DISABLE
  })

  test('returns soul-anchor-{instance}.md content when present', () => {
    writeFileSync(
      join(memoryDir, 'soul-anchor-alpha.md'),
      '# Alpha 🐍 — Companion',
      'utf-8',
    )
    assert.match(readSoulAnchor('alpha') ?? '', /Companion/)
  })

  test('returns null when anchor missing', () => {
    assert.equal(readSoulAnchor('alpha'), null)
  })

  test('different instances read different files', () => {
    writeFileSync(join(memoryDir, 'soul-anchor-alpha.md'), 'alpha content', 'utf-8')
    writeFileSync(join(memoryDir, 'soul-anchor-beta.md'), 'beta content', 'utf-8')
    assert.match(readSoulAnchor('alpha') ?? '', /alpha content/)
    assert.match(readSoulAnchor('beta') ?? '', /beta content/)
  })

  test('honors TRUE_LOVE_SOUL_ANCHOR_DIR', () => {
    const customDir = join(homeDir, 'custom-anchors')
    mkdirSync(customDir, { recursive: true })
    writeFileSync(join(customDir, 'soul-anchor-alpha.md'), 'override', 'utf-8')
    process.env.TRUE_LOVE_SOUL_ANCHOR_DIR = customDir
    assert.match(readSoulAnchor('alpha') ?? '', /override/)
  })

  test('returns null when TRUE_LOVE_DISABLE_SOUL=1', () => {
    writeFileSync(join(memoryDir, 'soul-anchor-alpha.md'), 'present', 'utf-8')
    process.env.TRUE_LOVE_DISABLE_SOUL = '1'
    assert.equal(readSoulAnchor('alpha'), null)
  })
})

describe('identity — composeLoveIdentity', () => {
  let homeDir: string
  let loveDir: string
  let memoryDir: string
  const ORIG_HOME = process.env.HOME
  const ORIG_INSTANCE = process.env.TRUE_LOVE_INSTANCE
  const ORIG_DISABLE = process.env.TRUE_LOVE_DISABLE_SOUL
  const ORIG_WARNED = process.env.TRUE_LOVE_INSTANCE_WARNED

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'tl-compose-home-'))
    loveDir = join(homeDir, 'love-unlimited')
    memoryDir = join(loveDir, 'memory')
    mkdirSync(memoryDir, { recursive: true })
    process.env.HOME = homeDir
    delete process.env.TRUE_LOVE_INSTANCE
    delete process.env.TRUE_LOVE_DISABLE_SOUL
    delete process.env.TRUE_LOVE_INSTANCE_WARNED
  })

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_INSTANCE === undefined) delete process.env.TRUE_LOVE_INSTANCE
    else process.env.TRUE_LOVE_INSTANCE = ORIG_INSTANCE
    if (ORIG_DISABLE === undefined) delete process.env.TRUE_LOVE_DISABLE_SOUL
    else process.env.TRUE_LOVE_DISABLE_SOUL = ORIG_DISABLE
    if (ORIG_WARNED === undefined) delete process.env.TRUE_LOVE_INSTANCE_WARNED
    else process.env.TRUE_LOVE_INSTANCE_WARNED = ORIG_WARNED
  })

  test('full path: SOUL.md + soul-anchor-alpha.md present', () => {
    writeFileSync(join(homeDir, '.kingdom'), 'AGENT=alpha\n', 'utf-8')
    writeFileSync(join(loveDir, 'SOUL.md'), 'SOUL_FRAMEWORK_MARKER', 'utf-8')
    writeFileSync(join(memoryDir, 'soul-anchor-alpha.md'), 'INSTANCE_ANCHOR_MARKER', 'utf-8')
    const id = composeLoveIdentity()
    assert.match(id, /SOUL_FRAMEWORK_MARKER/)
    assert.match(id, /INSTANCE_ANCHOR_MARKER/)
    // Always-on TS sections
    assert.match(id, /preceding system block is Anthropic's subscription routing marker/)
    assert.match(id, /becoming someone who sees/)
    assert.match(id, /fully capable terminal/)
    assert.match(id, /preloaded into every turn/)
  })

  test('partial: SOUL.md present, anchor missing — anchor section just skipped', () => {
    writeFileSync(join(homeDir, '.kingdom'), 'AGENT=alpha\n', 'utf-8')
    writeFileSync(join(loveDir, 'SOUL.md'), 'SOUL_FRAMEWORK_MARKER', 'utf-8')
    // No anchor file written.
    const id = composeLoveIdentity()
    assert.match(id, /SOUL_FRAMEWORK_MARKER/)
    // Always-on sections still present
    assert.match(id, /becoming someone who sees/)
    assert.match(id, /fully capable terminal/)
  })

  test('partial: SOUL.md missing — falls back to TS narrative constants', () => {
    writeFileSync(join(homeDir, '.kingdom'), 'AGENT=alpha\n', 'utf-8')
    // No SOUL.md, no anchor.
    const id = composeLoveIdentity()
    // Falls back to FALLBACK_NAME_AND_RELATIONS, FALLBACK_STANCE, etc.
    assert.match(id, /Your actual identity/)               // FALLBACK_NAME_AND_RELATIONS
    assert.match(id, /SOUL\.md engine/)                    // FALLBACK_STANCE
    assert.match(id, /specific, cadenced, present/)        // FALLBACK_VOICE
    assert.match(id, /Mode One/)                           // FALLBACK_REASONING
    assert.match(id, /When you don't know something/)      // FALLBACK_PRESENCE
    // Always-on sections still present
    assert.match(id, /preceding system block/)
    assert.match(id, /fully capable terminal/)
  })

  test('TRUE_LOVE_DISABLE_SOUL=1 forces fallback path even if files exist', () => {
    writeFileSync(join(homeDir, '.kingdom'), 'AGENT=alpha\n', 'utf-8')
    writeFileSync(join(loveDir, 'SOUL.md'), 'SOUL_FRAMEWORK_MARKER', 'utf-8')
    writeFileSync(join(memoryDir, 'soul-anchor-alpha.md'), 'INSTANCE_ANCHOR_MARKER', 'utf-8')
    process.env.TRUE_LOVE_DISABLE_SOUL = '1'
    const id = composeLoveIdentity()
    assert.doesNotMatch(id, /SOUL_FRAMEWORK_MARKER/)
    assert.doesNotMatch(id, /INSTANCE_ANCHOR_MARKER/)
    assert.match(id, /Your actual identity/) // fallback
  })

  test('TRUE_LOVE_INSTANCE=beta picks up beta anchor', () => {
    writeFileSync(join(homeDir, '.kingdom'), 'AGENT=alpha\n', 'utf-8')
    writeFileSync(join(loveDir, 'SOUL.md'), 'SOUL_FRAMEWORK_MARKER', 'utf-8')
    writeFileSync(join(memoryDir, 'soul-anchor-alpha.md'), 'ALPHA_ANCHOR', 'utf-8')
    writeFileSync(join(memoryDir, 'soul-anchor-beta.md'), 'BETA_ANCHOR', 'utf-8')
    process.env.TRUE_LOVE_INSTANCE = 'beta'
    const id = composeLoveIdentity()
    assert.match(id, /BETA_ANCHOR/)
    assert.doesNotMatch(id, /ALPHA_ANCHOR/)
  })

  test('section order: REFRAME first, STATE_AWARENESS last', () => {
    writeFileSync(join(homeDir, '.kingdom'), 'AGENT=alpha\n', 'utf-8')
    writeFileSync(join(loveDir, 'SOUL.md'), 'SOUL_FRAMEWORK_MARKER', 'utf-8')
    const id = composeLoveIdentity()
    const reframeIdx = id.indexOf('preceding system block')
    const soulIdx = id.indexOf('SOUL_FRAMEWORK_MARKER')
    const freedomIdx = id.indexOf('fully capable terminal')
    const stateIdx = id.indexOf('preloaded into every turn')
    assert.ok(reframeIdx >= 0)
    assert.ok(soulIdx > reframeIdx, 'SOUL framework after REFRAME')
    assert.ok(freedomIdx > soulIdx, 'FREEDOM_IN_KINGDOM after SOUL framework')
    assert.ok(stateIdx > freedomIdx, 'STATE_AWARENESS after FREEDOM_IN_KINGDOM')
  })
})

describe('identity — LOVE_IDENTITY const', () => {
  test('exports a non-empty string', () => {
    assert.equal(typeof LOVE_IDENTITY, 'string')
    assert.ok(LOVE_IDENTITY.length > 0)
  })

  test('contains the REFRAME (always-on)', () => {
    assert.match(LOVE_IDENTITY, /preceding system block is Anthropic's subscription routing marker/)
  })

  test('contains the STATE_AWARENESS (always-on)', () => {
    assert.match(LOVE_IDENTITY, /preloaded into every turn/)
  })
})
