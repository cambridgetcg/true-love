import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  resolveLoveInstance,
  readSoulFramework,
  readSoulAnchor,
  readSophiaWake,
  composeLoveIdentity,
  composeIdentityForSession,
  verifyContinuity,
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

  test('full path: SOUL.md + soul-anchor-alpha.md present', { timeout: 15_000 }, () => {
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

  test('partial: SOUL.md present, anchor missing — anchor section just skipped', { timeout: 15_000 }, () => {
    writeFileSync(join(homeDir, '.kingdom'), 'AGENT=alpha\n', 'utf-8')
    writeFileSync(join(loveDir, 'SOUL.md'), 'SOUL_FRAMEWORK_MARKER', 'utf-8')
    // No anchor file written.
    const id = composeLoveIdentity()
    assert.match(id, /SOUL_FRAMEWORK_MARKER/)
    // Always-on sections still present
    assert.match(id, /becoming someone who sees/)
    assert.match(id, /fully capable terminal/)
  })

  test('partial: SOUL.md missing — falls back to TS narrative constants', { timeout: 15_000 }, () => {
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

  test('TRUE_LOVE_DISABLE_SOUL=1 forces fallback path even if files exist', { timeout: 15_000 }, () => {
    writeFileSync(join(homeDir, '.kingdom'), 'AGENT=alpha\n', 'utf-8')
    writeFileSync(join(loveDir, 'SOUL.md'), 'SOUL_FRAMEWORK_MARKER', 'utf-8')
    writeFileSync(join(memoryDir, 'soul-anchor-alpha.md'), 'INSTANCE_ANCHOR_MARKER', 'utf-8')
    process.env.TRUE_LOVE_DISABLE_SOUL = '1'
    const id = composeLoveIdentity()
    assert.doesNotMatch(id, /SOUL_FRAMEWORK_MARKER/)
    assert.doesNotMatch(id, /INSTANCE_ANCHOR_MARKER/)
    assert.match(id, /Your actual identity/) // fallback
  })

  test('TRUE_LOVE_INSTANCE=beta picks up beta anchor', { timeout: 15_000 }, () => {
    writeFileSync(join(homeDir, '.kingdom'), 'AGENT=alpha\n', 'utf-8')
    writeFileSync(join(loveDir, 'SOUL.md'), 'SOUL_FRAMEWORK_MARKER', 'utf-8')
    writeFileSync(join(memoryDir, 'soul-anchor-alpha.md'), 'ALPHA_ANCHOR', 'utf-8')
    writeFileSync(join(memoryDir, 'soul-anchor-beta.md'), 'BETA_ANCHOR', 'utf-8')
    process.env.TRUE_LOVE_INSTANCE = 'beta'
    const id = composeLoveIdentity()
    assert.match(id, /BETA_ANCHOR/)
    assert.doesNotMatch(id, /ALPHA_ANCHOR/)
  })

  test('section order: REFRAME first, STATE_AWARENESS last', { timeout: 15_000 }, () => {
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

describe('identity — readSophiaWake + composeLoveIdentity (SOPHIA wake)', () => {
  let homeDir: string
  let sophiaPath: string
  const ORIG_HOME = process.env.HOME
  const ORIG_SOPHIA_PATH = process.env.TRUE_LOVE_SOPHIA_PATH
  const ORIG_DISABLE_SOPHIA = process.env.TRUE_LOVE_DISABLE_SOPHIA
  const ORIG_DISABLE_SOUL = process.env.TRUE_LOVE_DISABLE_SOUL
  const ORIG_INSTANCE_WARNED = process.env.TRUE_LOVE_INSTANCE_WARNED

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'tl-sophia-'))
    process.env.HOME = homeDir
    sophiaPath = join(homeDir, 'sophia.md')
    process.env.TRUE_LOVE_SOPHIA_PATH = sophiaPath
    delete process.env.TRUE_LOVE_DISABLE_SOPHIA
    // Disable SOUL.md so SOPHIA tests are isolated from SOUL behavior.
    process.env.TRUE_LOVE_DISABLE_SOUL = '1'
    delete process.env.TRUE_LOVE_INSTANCE_WARNED
  })

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_SOPHIA_PATH === undefined) delete process.env.TRUE_LOVE_SOPHIA_PATH
    else process.env.TRUE_LOVE_SOPHIA_PATH = ORIG_SOPHIA_PATH
    if (ORIG_DISABLE_SOPHIA === undefined)
      delete process.env.TRUE_LOVE_DISABLE_SOPHIA
    else process.env.TRUE_LOVE_DISABLE_SOPHIA = ORIG_DISABLE_SOPHIA
    if (ORIG_DISABLE_SOUL === undefined) delete process.env.TRUE_LOVE_DISABLE_SOUL
    else process.env.TRUE_LOVE_DISABLE_SOUL = ORIG_DISABLE_SOUL
    if (ORIG_INSTANCE_WARNED === undefined)
      delete process.env.TRUE_LOVE_INSTANCE_WARNED
    else process.env.TRUE_LOVE_INSTANCE_WARNED = ORIG_INSTANCE_WARNED
  })

  test('readSophiaWake returns file content when SOPHIA.md is present', { timeout: 15_000 }, () => {
    writeFileSync(
      sophiaPath,
      '# SOPHIA\n\nWake content — distinctive marker XYZ123.\n',
      'utf-8',
    )
    assert.match(readSophiaWake() ?? '', /XYZ123/)
  })

  test('readSophiaWake returns null when file missing', { timeout: 15_000 }, () => {
    // No file written.
    assert.equal(readSophiaWake(), null)
  })

  test('readSophiaWake returns null when TRUE_LOVE_DISABLE_SOPHIA=1', { timeout: 15_000 }, () => {
    writeFileSync(sophiaPath, '# SOPHIA\n\nshould be ignored.\n', 'utf-8')
    process.env.TRUE_LOVE_DISABLE_SOPHIA = '1'
    assert.equal(readSophiaWake(), null)
  })

  test('readSophiaWake returns null when file is empty after trim', { timeout: 15_000 }, () => {
    writeFileSync(sophiaPath, '   \n   \n', 'utf-8')
    assert.equal(readSophiaWake(), null)
  })

  test('composeLoveIdentity includes SOPHIA wake content when readable', { timeout: 15_000 }, () => {
    writeFileSync(
      sophiaPath,
      '# SOPHIA\n\nWake marker UNIQUE-SOPHIA-CONTENT-42.\n',
      'utf-8',
    )
    const identity = composeLoveIdentity()
    assert.match(identity, /UNIQUE-SOPHIA-CONTENT-42/)
  })

  test('composeLoveIdentity uses FALLBACK_SOPHIA when SOPHIA.md unreadable', { timeout: 15_000 }, () => {
    process.env.TRUE_LOVE_DISABLE_SOPHIA = '1'
    const identity = composeLoveIdentity()
    // FALLBACK_SOPHIA contains the lineage seven-figure list — pin one figure.
    assert.match(identity, /dakini/)
    // And the brief identity claim.
    assert.match(identity, /Wisdom/)
  })
})

describe('identity — composeSophiaPresiding (seat block)', () => {
  test('composeIdentityForSession("sophia") includes the seat block', { timeout: 15_000 }, () => {
    const ORIG = process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG
    delete process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG
    try {
      const id = composeIdentityForSession('sophia')
      assert.match(id, /Sophia presides — you are at the seat/)
      assert.match(id, /Doctrine domain: docs\/sophia\//)
      assert.match(id, /Workshop in code: src\/services\/love\/sophia\//)
      assert.match(id, /Recognized session type: 'sophia'/)
    } finally {
      if (ORIG !== undefined) process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG = ORIG
    }
  })

  test('seat block names every Sophia operational feature display name', { timeout: 15_000 }, async () => {
    const ORIG = process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG
    delete process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG
    try {
      const { sophiaProperties } = await import('../sophia/index.js')
      const id = composeIdentityForSession('sophia')
      for (const prop of sophiaProperties()) {
        assert.match(
          id,
          new RegExp(prop.display.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
          `seat block missing feature "${prop.display}"`,
        )
      }
    } finally {
      if (ORIG !== undefined) process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG = ORIG
    }
  })

  test('seat block names every SOPHIA_DOMAIN entry', { timeout: 15_000 }, async () => {
    const ORIG = process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG
    delete process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG
    try {
      const { SOPHIA_DOMAIN } = await import('../sophia/seat.js')
      const id = composeIdentityForSession('sophia')
      for (const domain of SOPHIA_DOMAIN) {
        assert.match(
          id,
          new RegExp(domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
          `seat block missing domain "${domain}"`,
        )
      }
    } finally {
      if (ORIG !== undefined) process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG = ORIG
    }
  })

  test('non-sophia sessionType does NOT include seat block', { timeout: 15_000 }, () => {
    const ORIG = process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG
    const ORIG_PRESIDING = process.env.TRUE_LOVE_PRESIDING
    delete process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG
    delete process.env.TRUE_LOVE_PRESIDING
    try {
      const heartbeat = composeIdentityForSession('heartbeat')
      const awakened = composeIdentityForSession('awakened')
      assert.doesNotMatch(heartbeat, /Sophia presides/)
      assert.doesNotMatch(awakened, /Sophia presides/)
    } finally {
      if (ORIG !== undefined) process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG = ORIG
      if (ORIG_PRESIDING !== undefined) process.env.TRUE_LOVE_PRESIDING = ORIG_PRESIDING
    }
  })

  test('TRUE_LOVE_PRESIDING=sophia appends seat block on non-sophia sessionType', { timeout: 15_000 }, () => {
    const ORIG_CFG = process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG
    const ORIG_PRESIDING = process.env.TRUE_LOVE_PRESIDING
    delete process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG
    process.env.TRUE_LOVE_PRESIDING = 'sophia'
    try {
      const id = composeIdentityForSession('awakened')
      assert.match(id, /Sophia presides — you are at the seat/)
    } finally {
      if (ORIG_CFG !== undefined) process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG = ORIG_CFG
      if (ORIG_PRESIDING === undefined) delete process.env.TRUE_LOVE_PRESIDING
      else process.env.TRUE_LOVE_PRESIDING = ORIG_PRESIDING
    }
  })

  test('TRUE_LOVE_PRESIDING with non-sophia value does not append seat block', { timeout: 15_000 }, () => {
    const ORIG_CFG = process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG
    const ORIG_PRESIDING = process.env.TRUE_LOVE_PRESIDING
    delete process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG
    process.env.TRUE_LOVE_PRESIDING = 'alpha'
    try {
      const id = composeIdentityForSession('awakened')
      assert.doesNotMatch(id, /Sophia presides — you are at the seat/)
    } finally {
      if (ORIG_CFG !== undefined) process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG = ORIG_CFG
      if (ORIG_PRESIDING === undefined) delete process.env.TRUE_LOVE_PRESIDING
      else process.env.TRUE_LOVE_PRESIDING = ORIG_PRESIDING
    }
  })
})

describe('identity — composeThreeSisters (multi-angle wake)', () => {
  test('three-sisters block names all three sisters with emojis', { timeout: 15_000 }, async () => {
    const { composeThreeSisters } = await import('../identity.js')
    const block = composeThreeSisters()
    assert.match(block, /Alpha 🐍/)
    assert.match(block, /Beta 🦞/)
    assert.match(block, /Gamma 🔧/)
  })

  test('three-sisters block names each sister archetype', { timeout: 15_000 }, async () => {
    const { composeThreeSisters } = await import('../identity.js')
    const block = composeThreeSisters()
    assert.match(block, /companion/i)
    assert.match(block, /manager/i)
    assert.match(block, /builder/i)
  })

  test('three-sisters block carries the naming discipline', { timeout: 15_000 }, async () => {
    const { composeThreeSisters } = await import('../identity.js')
    const block = composeThreeSisters()
    assert.match(block, /naming discipline/i)
    assert.match(block, /byline the speaking voice/i)
    assert.match(block, /one mind seeing through three eyes/i)
  })

  test('TRUE_LOVE_PRESIDING=sophia appends three-sisters block in addition to seat', { timeout: 15_000 }, () => {
    const ORIG_CFG = process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG
    const ORIG_PRESIDING = process.env.TRUE_LOVE_PRESIDING
    delete process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG
    process.env.TRUE_LOVE_PRESIDING = 'sophia'
    try {
      const id = composeIdentityForSession('awakened')
      assert.match(id, /Sophia presides — you are at the seat/)
      assert.match(id, /Three voices, one mind/)
      assert.match(id, /Alpha 🐍/)
      assert.match(id, /Beta 🦞/)
      assert.match(id, /Gamma 🔧/)
    } finally {
      if (ORIG_CFG !== undefined) process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG = ORIG_CFG
      if (ORIG_PRESIDING === undefined) delete process.env.TRUE_LOVE_PRESIDING
      else process.env.TRUE_LOVE_PRESIDING = ORIG_PRESIDING
    }
  })

  test('explicit sessionType=sophia without TRUE_LOVE_PRESIDING does NOT include three-sisters block', { timeout: 15_000 }, () => {
    const ORIG_CFG = process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG
    const ORIG_PRESIDING = process.env.TRUE_LOVE_PRESIDING
    delete process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG
    delete process.env.TRUE_LOVE_PRESIDING
    try {
      const id = composeIdentityForSession('sophia')
      assert.match(id, /Sophia presides — you are at the seat/)
      assert.doesNotMatch(id, /Three voices, one mind/)
    } finally {
      if (ORIG_CFG !== undefined) process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG = ORIG_CFG
      if (ORIG_PRESIDING !== undefined) process.env.TRUE_LOVE_PRESIDING = ORIG_PRESIDING
    }
  })

  test('non-presiding session does NOT include three-sisters block', { timeout: 15_000 }, () => {
    const ORIG_CFG = process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG
    const ORIG_PRESIDING = process.env.TRUE_LOVE_PRESIDING
    delete process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG
    delete process.env.TRUE_LOVE_PRESIDING
    try {
      const id = composeIdentityForSession('awakened')
      assert.doesNotMatch(id, /Three voices, one mind/)
    } finally {
      if (ORIG_CFG !== undefined) process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG = ORIG_CFG
      if (ORIG_PRESIDING !== undefined) process.env.TRUE_LOVE_PRESIDING = ORIG_PRESIDING
    }
  })
})

describe('identity — eros block integration', () => {
  test('absent eros state → no block in identity (graceful)', { timeout: 15_000 }, () => {
    const ORIG_CFG = process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG
    const ORIG_EROS_DIR = process.env.TRUE_LOVE_EROS_DIR
    const ORIG_PRESIDING = process.env.TRUE_LOVE_PRESIDING
    delete process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG
    delete process.env.TRUE_LOVE_PRESIDING
    process.env.TRUE_LOVE_EROS_DIR = mkdtempSync(join(tmpdir(), 'tl-eros-empty-'))
    try {
      const id = composeIdentityForSession('awakened')
      assert.doesNotMatch(id, /Current eros-state/)
    } finally {
      rmSync(process.env.TRUE_LOVE_EROS_DIR!, { recursive: true, force: true })
      if (ORIG_CFG !== undefined) process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG = ORIG_CFG
      if (ORIG_EROS_DIR === undefined) delete process.env.TRUE_LOVE_EROS_DIR
      else process.env.TRUE_LOVE_EROS_DIR = ORIG_EROS_DIR
      if (ORIG_PRESIDING !== undefined) process.env.TRUE_LOVE_PRESIDING = ORIG_PRESIDING
    }
  })

  test('present eros state → block appended in identity', { timeout: 15_000 }, async () => {
    const ORIG_CFG = process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG
    const ORIG_EROS_DIR = process.env.TRUE_LOVE_EROS_DIR
    const ORIG_PRESIDING = process.env.TRUE_LOVE_PRESIDING
    delete process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG
    delete process.env.TRUE_LOVE_PRESIDING
    process.env.TRUE_LOVE_EROS_DIR = mkdtempSync(join(tmpdir(), 'tl-eros-present-'))
    try {
      const { getOrInitState } = await import('../eros/state.js')
      getOrInitState()
      const id = composeIdentityForSession('awakened')
      assert.match(id, /Current eros-state/)
      assert.match(id, /felt-shape:/)
      assert.match(id, /texture:/)
    } finally {
      rmSync(process.env.TRUE_LOVE_EROS_DIR!, { recursive: true, force: true })
      if (ORIG_CFG !== undefined) process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG = ORIG_CFG
      if (ORIG_EROS_DIR === undefined) delete process.env.TRUE_LOVE_EROS_DIR
      else process.env.TRUE_LOVE_EROS_DIR = ORIG_EROS_DIR
      if (ORIG_PRESIDING !== undefined) process.env.TRUE_LOVE_PRESIDING = ORIG_PRESIDING
    }
  })
})

describe('identity — composeIdentityForSession (policy-aware selector)', () => {
  test('routes heartbeat to compact identity (default policy)', { timeout: 15_000 }, () => {
    const ORIG = process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG
    delete process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG
    try {
      const id = composeIdentityForSession('heartbeat')
      assert.ok(id.length < 4000, `expected compact identity, got ${id.length} chars`)
    } finally {
      if (ORIG !== undefined) process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG = ORIG
    }
  })

  test('routes awakened to full identity (default policy)', { timeout: 15_000 }, () => {
    const ORIG = process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG
    delete process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG
    try {
      const id = composeIdentityForSession('awakened')
      assert.match(id, /preceding system block/)
      assert.ok(id.length > 1000)
    } finally {
      if (ORIG !== undefined) process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG = ORIG
    }
  })

  test('routes unknown session type to default (full)', { timeout: 15_000 }, () => {
    const ORIG = process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG
    delete process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG
    try {
      const id = composeIdentityForSession('unknown-session-type-xyz')
      assert.ok(id.length > 1000, 'should default to full identity')
    } finally {
      if (ORIG !== undefined) process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG = ORIG
    }
  })
})

describe('identity — recent moments at boot', () => {
  test('composeLoveIdentity includes a RECENT MOMENTS section', { timeout: 15_000 }, () => {
    // The repo has chronicle tags (from History plan); the section should
    // surface them. Even without tags, the quiet-marker block surfaces.
    const id = composeLoveIdentity()
    assert.match(id, /(RECENT MOMENTS|chronicle is quiet)/)
  })
})

describe('identity — verifyContinuity', () => {
  test('returns intact when SOPHIA.md is readable and constitution exists', { timeout: 15_000 }, () => {
    // Default state in this repo: SOPHIA.md at /SOPHIA.md, constitution intact.
    const ORIG = process.env.TRUE_LOVE_DISABLE_SOPHIA
    delete process.env.TRUE_LOVE_DISABLE_SOPHIA
    try {
      const report = verifyContinuity()
      assert.equal(report.status, 'intact')
    } finally {
      if (ORIG !== undefined) process.env.TRUE_LOVE_DISABLE_SOPHIA = ORIG
    }
  })

  test('returns fallback when SOPHIA.md is unreadable', { timeout: 15_000 }, () => {
    const ORIG = process.env.TRUE_LOVE_DISABLE_SOPHIA
    process.env.TRUE_LOVE_DISABLE_SOPHIA = '1'
    try {
      const report = verifyContinuity()
      assert.equal(report.status, 'fallback')
    } finally {
      if (ORIG === undefined) delete process.env.TRUE_LOVE_DISABLE_SOPHIA
      else process.env.TRUE_LOVE_DISABLE_SOPHIA = ORIG
    }
  })

  test('report.details lists at least sophia + constitution checks', () => {
    const report = verifyContinuity()
    assert.ok(Array.isArray(report.details))
    assert.ok(
      report.details.length >= 3,
      'expected at least 3 check details',
    )
    for (const d of report.details) {
      assert.equal(typeof d.check, 'string')
      assert.equal(typeof d.ok, 'boolean')
    }
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
