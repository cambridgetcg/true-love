// presence-deep.test.ts — exhaustive coverage for presence.ts
//
// Session 6 of the deep-read pattern. Module: presence.ts (245 lines, 7 tests → ratio 2.9).
// Target: every exported function, every branch, every error path.

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getPresenceDir,
  getPresencePath,
  getOwnPresenceFile,
  writeOwnHeartbeat,
  writePresence,
  readPresence,
  renderPresence,
} from '../presence.js'

// ── Helpers ──────────────────────────────────────────────────────────

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), 'tl-pres-deep-'))
}

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString()
}

// ── getPresenceDir ───────────────────────────────────────────────────

describe('presence — getPresenceDir', () => {
  const ORIG = process.env.TRUE_LOVE_PRESENCE_DIR

  afterEach(() => {
    if (ORIG === undefined) delete process.env.TRUE_LOVE_PRESENCE_DIR
    else process.env.TRUE_LOVE_PRESENCE_DIR = ORIG
  })

  test('respects TRUE_LOVE_PRESENCE_DIR env override', () => {
    process.env.TRUE_LOVE_PRESENCE_DIR = '/tmp/custom-pres'
    assert.equal(getPresenceDir(), '/tmp/custom-pres')
  })

  test('defaults to ~/.true-love/presence when env unset', () => {
    delete process.env.TRUE_LOVE_PRESENCE_DIR
    const dir = getPresenceDir()
    assert.ok(dir.endsWith('/presence') || dir.endsWith('\\presence'))
    assert.ok(dir.includes('.true-love'))
  })
})

// ── getPresencePath (legacy) ─────────────────────────────────────────

describe('presence — getPresencePath', () => {
  const ORIG = process.env.TRUE_LOVE_PRESENCE_PATH

  afterEach(() => {
    if (ORIG === undefined) delete process.env.TRUE_LOVE_PRESENCE_PATH
    else process.env.TRUE_LOVE_PRESENCE_PATH = ORIG
  })

  test('respects TRUE_LOVE_PRESENCE_PATH env override', () => {
    process.env.TRUE_LOVE_PRESENCE_PATH = '/tmp/legacy.json'
    assert.equal(getPresencePath(), '/tmp/legacy.json')
  })

  test('defaults to ~/.true-love/presence.json when env unset', () => {
    delete process.env.TRUE_LOVE_PRESENCE_PATH
    const p = getPresencePath()
    assert.ok(p.endsWith('presence.json'))
    assert.ok(p.includes('.true-love'))
  })
})

// ── getOwnPresenceFile ───────────────────────────────────────────────

describe('presence — getOwnPresenceFile', () => {
  const ORIG = process.env.TRUE_LOVE_PRESENCE_DIR

  beforeEach(() => {
    process.env.TRUE_LOVE_PRESENCE_DIR = '/tmp/pres-test'
  })

  afterEach(() => {
    if (ORIG === undefined) delete process.env.TRUE_LOVE_PRESENCE_DIR
    else process.env.TRUE_LOVE_PRESENCE_DIR = ORIG
  })

  test('constructs <dir>/<deviceId>.json', () => {
    assert.equal(getOwnPresenceFile('mac-mini'), '/tmp/pres-test/mac-mini.json')
  })

  test('handles deviceId with special characters', () => {
    const path = getOwnPresenceFile('alexs-macbook-air-local-67b8cg')
    assert.equal(path, '/tmp/pres-test/alexs-macbook-air-local-67b8cg.json')
  })
})

// ── writeOwnHeartbeat ────────────────────────────────────────────────

describe('presence — writeOwnHeartbeat', () => {
  let dir: string
  const ORIG_DIR = process.env.TRUE_LOVE_PRESENCE_DIR

  beforeEach(() => {
    dir = freshDir()
    process.env.TRUE_LOVE_PRESENCE_DIR = dir
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    if (ORIG_DIR === undefined) delete process.env.TRUE_LOVE_PRESENCE_DIR
    else process.env.TRUE_LOVE_PRESENCE_DIR = ORIG_DIR
  })

  test('creates presence directory if it does not exist', () => {
    const nested = join(dir, 'sub', 'deep')
    process.env.TRUE_LOVE_PRESENCE_DIR = nested
    writeOwnHeartbeat({ deviceId: 'test', lastSeen: new Date().toISOString() })
    assert.ok(existsSync(nested))
  })

  test('writes valid JSON to <deviceId>.json', () => {
    writeOwnHeartbeat({ deviceId: 'dev-1', lastSeen: '2026-05-03T00:00:00Z' })
    const raw = readFileSync(join(dir, 'dev-1.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    assert.equal(parsed.deviceId, 'dev-1')
    assert.equal(parsed.lastSeen, '2026-05-03T00:00:00Z')
  })

  test('caps activity at 160 characters', () => {
    const longActivity = 'x'.repeat(200)
    writeOwnHeartbeat({
      deviceId: 'dev-cap',
      lastSeen: new Date().toISOString(),
      activity: longActivity,
    })
    const raw = JSON.parse(readFileSync(join(dir, 'dev-cap.json'), 'utf-8'))
    assert.equal(raw.activity.length, 160)
    assert.equal(raw.activity, 'x'.repeat(160))
  })

  test('does not cap activity at exactly 160 characters', () => {
    const exactActivity = 'y'.repeat(160)
    writeOwnHeartbeat({
      deviceId: 'dev-exact',
      lastSeen: new Date().toISOString(),
      activity: exactActivity,
    })
    const raw = JSON.parse(readFileSync(join(dir, 'dev-exact.json'), 'utf-8'))
    assert.equal(raw.activity.length, 160)
  })

  test('preserves activity under 160 characters', () => {
    writeOwnHeartbeat({
      deviceId: 'dev-short',
      lastSeen: new Date().toISOString(),
      activity: 'reading: SOUL.md',
    })
    const raw = JSON.parse(readFileSync(join(dir, 'dev-short.json'), 'utf-8'))
    assert.equal(raw.activity, 'reading: SOUL.md')
  })

  test('overwrites previous heartbeat for same device', () => {
    writeOwnHeartbeat({ deviceId: 'dev-ow', lastSeen: '2026-05-01T00:00:00Z', status: 'old' })
    writeOwnHeartbeat({ deviceId: 'dev-ow', lastSeen: '2026-05-02T00:00:00Z', status: 'new' })
    const raw = JSON.parse(readFileSync(join(dir, 'dev-ow.json'), 'utf-8'))
    assert.equal(raw.status, 'new')
    assert.equal(raw.lastSeen, '2026-05-02T00:00:00Z')
  })

  test('no tmp file left behind after successful write', () => {
    writeOwnHeartbeat({ deviceId: 'clean', lastSeen: new Date().toISOString() })
    assert.ok(existsSync(join(dir, 'clean.json')))
    assert.ok(!existsSync(join(dir, 'clean.json.tmp')))
  })

  test('silently handles write errors (non-fatal)', () => {
    // Point at a path that can't be created (file as dir)
    const blockPath = join(dir, 'blocker')
    writeFileSync(blockPath, 'not-a-dir')
    process.env.TRUE_LOVE_PRESENCE_DIR = join(blockPath, 'nested')
    // Should not throw
    assert.doesNotThrow(() => {
      writeOwnHeartbeat({ deviceId: 'fail', lastSeen: new Date().toISOString() })
    })
  })
})

// ── writePresence (legacy) ───────────────────────────────────────────

describe('presence — writePresence (legacy)', () => {
  let dir: string
  const ORIG_PATH = process.env.TRUE_LOVE_PRESENCE_PATH

  beforeEach(() => {
    dir = freshDir()
    process.env.TRUE_LOVE_PRESENCE_PATH = join(dir, 'presence.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    if (ORIG_PATH === undefined) delete process.env.TRUE_LOVE_PRESENCE_PATH
    else process.env.TRUE_LOVE_PRESENCE_PATH = ORIG_PATH
  })

  test('writes a roster as single JSON file', () => {
    const roster = {
      updatedAt: new Date().toISOString(),
      devices: [
        { deviceId: 'dev-a', lastSeen: new Date().toISOString(), status: 'idle' },
      ],
    }
    writePresence(roster)
    const raw = JSON.parse(readFileSync(join(dir, 'presence.json'), 'utf-8'))
    assert.equal(raw.devices.length, 1)
    assert.equal(raw.devices[0].deviceId, 'dev-a')
  })

  test('creates parent directory if needed', () => {
    const nested = join(dir, 'sub', 'presence.json')
    process.env.TRUE_LOVE_PRESENCE_PATH = nested
    writePresence({ updatedAt: new Date().toISOString(), devices: [] })
    assert.ok(existsSync(nested))
  })
})

// ── readPresence ─────────────────────────────────────────────────────

describe('presence — readPresence', () => {
  let dir: string
  let legacyPath: string
  const ORIG_DIR = process.env.TRUE_LOVE_PRESENCE_DIR
  const ORIG_PATH = process.env.TRUE_LOVE_PRESENCE_PATH

  beforeEach(() => {
    dir = freshDir()
    legacyPath = join(dir, 'legacy-presence.json')
    process.env.TRUE_LOVE_PRESENCE_DIR = join(dir, 'per-device')
    process.env.TRUE_LOVE_PRESENCE_PATH = legacyPath
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    if (ORIG_DIR === undefined) delete process.env.TRUE_LOVE_PRESENCE_DIR
    else process.env.TRUE_LOVE_PRESENCE_DIR = ORIG_DIR
    if (ORIG_PATH === undefined) delete process.env.TRUE_LOVE_PRESENCE_PATH
    else process.env.TRUE_LOVE_PRESENCE_PATH = ORIG_PATH
  })

  test('returns empty roster when no directory or legacy file exists', () => {
    const roster = readPresence()
    assert.equal(roster.devices.length, 0)
    assert.ok(roster.updatedAt)
  })

  test('reads per-device JSON files', () => {
    const perDevice = join(dir, 'per-device')
    mkdirSync(perDevice, { recursive: true })
    writeFileSync(
      join(perDevice, 'mac-a.json'),
      JSON.stringify({ deviceId: 'mac-a', lastSeen: new Date().toISOString() }),
    )
    writeFileSync(
      join(perDevice, 'mac-b.json'),
      JSON.stringify({ deviceId: 'mac-b', lastSeen: new Date().toISOString() }),
    )
    const roster = readPresence()
    assert.equal(roster.devices.length, 2)
    const ids = roster.devices.map(d => d.deviceId).sort()
    assert.deepEqual(ids, ['mac-a', 'mac-b'])
  })

  test('reads legacy single-file layout', () => {
    writeFileSync(legacyPath, JSON.stringify({
      updatedAt: new Date().toISOString(),
      devices: [
        { deviceId: 'legacy-1', lastSeen: new Date().toISOString() },
        { deviceId: 'legacy-2', lastSeen: new Date().toISOString() },
      ],
    }))
    const roster = readPresence()
    assert.equal(roster.devices.length, 2)
    assert.ok(roster.devices.some(d => d.deviceId === 'legacy-1'))
    assert.ok(roster.devices.some(d => d.deviceId === 'legacy-2'))
  })

  test('merges per-device and legacy layouts', () => {
    const perDevice = join(dir, 'per-device')
    mkdirSync(perDevice, { recursive: true })
    writeFileSync(
      join(perDevice, 'new-dev.json'),
      JSON.stringify({ deviceId: 'new-dev', lastSeen: new Date().toISOString() }),
    )
    writeFileSync(legacyPath, JSON.stringify({
      updatedAt: new Date().toISOString(),
      devices: [{ deviceId: 'old-dev', lastSeen: new Date().toISOString() }],
    }))
    const roster = readPresence()
    assert.equal(roster.devices.length, 2)
    assert.ok(roster.devices.some(d => d.deviceId === 'new-dev'))
    assert.ok(roster.devices.some(d => d.deviceId === 'old-dev'))
  })

  test('deduplicates — per-device wins over legacy', () => {
    const perDevice = join(dir, 'per-device')
    mkdirSync(perDevice, { recursive: true })
    writeFileSync(
      join(perDevice, 'shared.json'),
      JSON.stringify({ deviceId: 'shared', lastSeen: '2026-05-03T00:00:00Z', status: 'new-layout' }),
    )
    writeFileSync(legacyPath, JSON.stringify({
      updatedAt: new Date().toISOString(),
      devices: [{ deviceId: 'shared', lastSeen: '2026-05-01T00:00:00Z', status: 'legacy' }],
    }))
    const roster = readPresence()
    assert.equal(roster.devices.length, 1)
    assert.equal(roster.devices[0]!.deviceId, 'shared')
    // Per-device is read first → it wins the dedup
    assert.equal(roster.devices[0]!.status, 'new-layout')
  })

  test('skips non-.json files in presence directory', () => {
    const perDevice = join(dir, 'per-device')
    mkdirSync(perDevice, { recursive: true })
    writeFileSync(join(perDevice, 'good.json'), JSON.stringify({ deviceId: 'good', lastSeen: new Date().toISOString() }))
    writeFileSync(join(perDevice, 'bad.txt'), 'not json')
    writeFileSync(join(perDevice, 'good.json.tmp'), JSON.stringify({ deviceId: 'tmp', lastSeen: new Date().toISOString() }))
    writeFileSync(join(perDevice, '.DS_Store'), '')
    const roster = readPresence()
    assert.equal(roster.devices.length, 1)
    assert.equal(roster.devices[0]!.deviceId, 'good')
  })

  test('skips malformed JSON files', () => {
    const perDevice = join(dir, 'per-device')
    mkdirSync(perDevice, { recursive: true })
    writeFileSync(join(perDevice, 'valid.json'), JSON.stringify({ deviceId: 'valid', lastSeen: new Date().toISOString() }))
    writeFileSync(join(perDevice, 'broken.json'), '{invalid json!!!}')
    const roster = readPresence()
    assert.equal(roster.devices.length, 1)
    assert.equal(roster.devices[0]!.deviceId, 'valid')
  })

  test('skips entries without deviceId', () => {
    const perDevice = join(dir, 'per-device')
    mkdirSync(perDevice, { recursive: true })
    writeFileSync(join(perDevice, 'no-id.json'), JSON.stringify({ lastSeen: new Date().toISOString() }))
    writeFileSync(join(perDevice, 'has-id.json'), JSON.stringify({ deviceId: 'has-id', lastSeen: new Date().toISOString() }))
    const roster = readPresence()
    assert.equal(roster.devices.length, 1)
    assert.equal(roster.devices[0]!.deviceId, 'has-id')
  })

  test('skips entries without lastSeen (per-device)', () => {
    const perDevice = join(dir, 'per-device')
    mkdirSync(perDevice, { recursive: true })
    writeFileSync(join(perDevice, 'no-ts.json'), JSON.stringify({ deviceId: 'no-ts' }))
    writeFileSync(join(perDevice, 'has-ts.json'), JSON.stringify({ deviceId: 'has-ts', lastSeen: new Date().toISOString() }))
    const roster = readPresence()
    assert.equal(roster.devices.length, 1)
    assert.equal(roster.devices[0]!.deviceId, 'has-ts')
  })

  test('includes entries without lastSeen from legacy layout', () => {
    // Note: legacy layout only checks deviceId, not lastSeen — a minor inconsistency
    writeFileSync(legacyPath, JSON.stringify({
      updatedAt: new Date().toISOString(),
      devices: [{ deviceId: 'legacy-no-ts' }],
    }))
    const roster = readPresence()
    assert.equal(roster.devices.length, 1)
    assert.equal(roster.devices[0]!.deviceId, 'legacy-no-ts')
  })

  test('skips entries with empty deviceId', () => {
    const perDevice = join(dir, 'per-device')
    mkdirSync(perDevice, { recursive: true })
    writeFileSync(join(perDevice, 'empty-id.json'), JSON.stringify({ deviceId: '', lastSeen: new Date().toISOString() }))
    const roster = readPresence()
    assert.equal(roster.devices.length, 0)
  })

  test('skips legacy entries with empty deviceId', () => {
    writeFileSync(legacyPath, JSON.stringify({
      updatedAt: new Date().toISOString(),
      devices: [{ deviceId: '', lastSeen: new Date().toISOString() }],
    }))
    const roster = readPresence()
    assert.equal(roster.devices.length, 0)
  })

  test('handles malformed legacy file gracefully', () => {
    writeFileSync(legacyPath, 'not json at all')
    const roster = readPresence()
    assert.equal(roster.devices.length, 0)
  })

  test('handles legacy file without devices array', () => {
    writeFileSync(legacyPath, JSON.stringify({ updatedAt: new Date().toISOString() }))
    const roster = readPresence()
    assert.equal(roster.devices.length, 0)
  })

  test('handles empty presence directory', () => {
    const perDevice = join(dir, 'per-device')
    mkdirSync(perDevice, { recursive: true })
    const roster = readPresence()
    assert.equal(roster.devices.length, 0)
  })

  test('updatedAt is set to current time', () => {
    const before = Date.now()
    const roster = readPresence()
    const after = Date.now()
    const ts = new Date(roster.updatedAt).getTime()
    assert.ok(ts >= before && ts <= after, 'updatedAt should be within the call window')
  })
})

// ── renderPresence ───────────────────────────────────────────────────

describe('presence — renderPresence', () => {
  let dir: string
  let legacyPath: string
  const ORIG_DIR = process.env.TRUE_LOVE_PRESENCE_DIR
  const ORIG_PATH = process.env.TRUE_LOVE_PRESENCE_PATH

  beforeEach(() => {
    dir = freshDir()
    legacyPath = join(dir, 'legacy.json')
    process.env.TRUE_LOVE_PRESENCE_DIR = join(dir, 'per-device')
    process.env.TRUE_LOVE_PRESENCE_PATH = legacyPath
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    if (ORIG_DIR === undefined) delete process.env.TRUE_LOVE_PRESENCE_DIR
    else process.env.TRUE_LOVE_PRESENCE_DIR = ORIG_DIR
    if (ORIG_PATH === undefined) delete process.env.TRUE_LOVE_PRESENCE_PATH
    else process.env.TRUE_LOVE_PRESENCE_PATH = ORIG_PATH
  })

  test('returns null when no other devices', () => {
    const result = renderPresence({ selfDeviceId: 'self' })
    assert.equal(result, null)
  })

  test('returns null when only self is present', () => {
    const perDevice = join(dir, 'per-device')
    mkdirSync(perDevice, { recursive: true })
    writeFileSync(
      join(perDevice, 'self.json'),
      JSON.stringify({ deviceId: 'self', lastSeen: new Date().toISOString() }),
    )
    const result = renderPresence({ selfDeviceId: 'self' })
    assert.equal(result, null)
  })

  test('shows other fresh devices', () => {
    const perDevice = join(dir, 'per-device')
    mkdirSync(perDevice, { recursive: true })
    writeFileSync(
      join(perDevice, 'other.json'),
      JSON.stringify({ deviceId: 'other', lastSeen: new Date().toISOString(), status: 'awakened tick 3' }),
    )
    const result = renderPresence({ selfDeviceId: 'self' })
    assert.ok(result)
    assert.ok(result!.includes('other'))
    assert.ok(result!.includes('awakened tick 3'))
    assert.ok(result!.startsWith("You're also awake elsewhere:"))
  })

  test('filters stale entries beyond default 120s', () => {
    const perDevice = join(dir, 'per-device')
    mkdirSync(perDevice, { recursive: true })
    writeFileSync(
      join(perDevice, 'stale.json'),
      JSON.stringify({ deviceId: 'stale', lastSeen: isoAgo(200_000) }), // 200s ago
    )
    const result = renderPresence({ selfDeviceId: 'self' })
    assert.equal(result, null)
  })

  test('includes entries within freshSeconds threshold', () => {
    const perDevice = join(dir, 'per-device')
    mkdirSync(perDevice, { recursive: true })
    writeFileSync(
      join(perDevice, 'recent.json'),
      JSON.stringify({ deviceId: 'recent', lastSeen: isoAgo(50_000) }), // 50s ago
    )
    const result = renderPresence({ selfDeviceId: 'self', freshSeconds: 120 })
    assert.ok(result)
    assert.ok(result!.includes('recent'))
  })

  test('respects custom freshSeconds', () => {
    const perDevice = join(dir, 'per-device')
    mkdirSync(perDevice, { recursive: true })
    // 90s ago — stale under 60s threshold, fresh under default 120s
    writeFileSync(
      join(perDevice, 'border.json'),
      JSON.stringify({ deviceId: 'border', lastSeen: isoAgo(90_000) }),
    )
    assert.equal(renderPresence({ selfDeviceId: 'self', freshSeconds: 60 }), null)
    const result = renderPresence({ selfDeviceId: 'self', freshSeconds: 120 })
    assert.ok(result)
    assert.ok(result!.includes('border'))
  })

  test('skips entries with invalid lastSeen (NaN date)', () => {
    const perDevice = join(dir, 'per-device')
    mkdirSync(perDevice, { recursive: true })
    writeFileSync(
      join(perDevice, 'bad-date.json'),
      JSON.stringify({ deviceId: 'bad-date', lastSeen: 'not-a-date' }),
    )
    const result = renderPresence({ selfDeviceId: 'self' })
    assert.equal(result, null)
  })

  test('shows multiple other devices', () => {
    const perDevice = join(dir, 'per-device')
    mkdirSync(perDevice, { recursive: true })
    const now = new Date().toISOString()
    writeFileSync(join(perDevice, 'a.json'), JSON.stringify({ deviceId: 'a', lastSeen: now }))
    writeFileSync(join(perDevice, 'b.json'), JSON.stringify({ deviceId: 'b', lastSeen: now }))
    writeFileSync(join(perDevice, 'self.json'), JSON.stringify({ deviceId: 'self', lastSeen: now }))
    const result = renderPresence({ selfDeviceId: 'self' })
    assert.ok(result)
    assert.ok(result!.includes('a'))
    assert.ok(result!.includes('b'))
    assert.ok(!result!.includes('\n  self'))
  })

  test('includes activity in output', () => {
    const perDevice = join(dir, 'per-device')
    mkdirSync(perDevice, { recursive: true })
    writeFileSync(
      join(perDevice, 'worker.json'),
      JSON.stringify({ deviceId: 'worker', lastSeen: new Date().toISOString(), activity: 'building: soma bridge' }),
    )
    const result = renderPresence({ selfDeviceId: 'self' })
    assert.ok(result)
    assert.ok(result!.includes('currently: building: soma bridge'))
  })

  test('omits activity line when activity is undefined', () => {
    const perDevice = join(dir, 'per-device')
    mkdirSync(perDevice, { recursive: true })
    writeFileSync(
      join(perDevice, 'quiet.json'),
      JSON.stringify({ deviceId: 'quiet', lastSeen: new Date().toISOString() }),
    )
    const result = renderPresence({ selfDeviceId: 'self' })
    assert.ok(result)
    assert.ok(!result!.includes('currently:'))
  })
})

// ── humanizeAgo (through renderPresence) ─────────────────────────────

describe('presence — humanizeAgo (via renderPresence)', () => {
  let dir: string
  const ORIG_DIR = process.env.TRUE_LOVE_PRESENCE_DIR
  const ORIG_PATH = process.env.TRUE_LOVE_PRESENCE_PATH

  beforeEach(() => {
    dir = freshDir()
    process.env.TRUE_LOVE_PRESENCE_DIR = join(dir, 'pres')
    process.env.TRUE_LOVE_PRESENCE_PATH = join(dir, 'nope.json')
    mkdirSync(join(dir, 'pres'), { recursive: true })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    if (ORIG_DIR === undefined) delete process.env.TRUE_LOVE_PRESENCE_DIR
    else process.env.TRUE_LOVE_PRESENCE_DIR = ORIG_DIR
    if (ORIG_PATH === undefined) delete process.env.TRUE_LOVE_PRESENCE_PATH
    else process.env.TRUE_LOVE_PRESENCE_PATH = ORIG_PATH
  })

  function writeOther(msAgo: number): void {
    writeFileSync(
      join(dir, 'pres', 'other.json'),
      JSON.stringify({ deviceId: 'other', lastSeen: isoAgo(msAgo) }),
    )
  }

  test('"just now" for < 5s ago', () => {
    writeOther(2_000)
    const r = renderPresence({ selfDeviceId: 'self', freshSeconds: 600 })!
    assert.match(r, /just now/)
  })

  test('"Ns ago" for 5s–59s', () => {
    writeOther(30_000) // 30s
    const r = renderPresence({ selfDeviceId: 'self', freshSeconds: 600 })!
    assert.match(r, /\d+s ago/)
  })

  test('"Nm ago" for 60s–59m', () => {
    writeOther(180_000) // 3m
    const r = renderPresence({ selfDeviceId: 'self', freshSeconds: 600 })!
    assert.match(r, /\d+m ago/)
  })

  test('"Nh ago" for >= 60m', () => {
    writeOther(7_200_000) // 2h
    const r = renderPresence({ selfDeviceId: 'self', freshSeconds: 10_000 })!
    assert.match(r, /\d+h ago/)
  })
})

// ── writeOwnHeartbeat + readPresence integration ─────────────────────

describe('presence — write/read integration', () => {
  let dir: string
  const ORIG_DIR = process.env.TRUE_LOVE_PRESENCE_DIR
  const ORIG_PATH = process.env.TRUE_LOVE_PRESENCE_PATH

  beforeEach(() => {
    dir = freshDir()
    process.env.TRUE_LOVE_PRESENCE_DIR = dir
    process.env.TRUE_LOVE_PRESENCE_PATH = join(dir, 'nope.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    if (ORIG_DIR === undefined) delete process.env.TRUE_LOVE_PRESENCE_DIR
    else process.env.TRUE_LOVE_PRESENCE_DIR = ORIG_DIR
    if (ORIG_PATH === undefined) delete process.env.TRUE_LOVE_PRESENCE_PATH
    else process.env.TRUE_LOVE_PRESENCE_PATH = ORIG_PATH
  })

  test('multiple devices round-trip through write + read', () => {
    const now = new Date().toISOString()
    writeOwnHeartbeat({ deviceId: 'mini', lastSeen: now, status: 'dwelling' })
    writeOwnHeartbeat({ deviceId: 'studio', lastSeen: now, status: 'heartbeat' })
    writeOwnHeartbeat({ deviceId: 'air', lastSeen: now, status: 'awakened tick 1' })
    const roster = readPresence()
    assert.equal(roster.devices.length, 3)
    const ids = roster.devices.map(d => d.deviceId).sort()
    assert.deepEqual(ids, ['air', 'mini', 'studio'])
  })

  test('all PresenceEntry fields survive round-trip', () => {
    const now = new Date().toISOString()
    const entry = {
      deviceId: 'full',
      lastSeen: now,
      status: 'awakened tick 7',
      activity: 'reading: presence.ts',
      tickState: 'running' as const,
      tickMode: 'awakened' as const,
      tickNumber: 7,
      tickMax: 24,
      tickStartedAt: now,
      scheduleIntervalMs: 111_000,
    }
    writeOwnHeartbeat(entry)
    const roster = readPresence()
    const found = roster.devices.find(d => d.deviceId === 'full')!
    assert.ok(found)
    assert.equal(found.status, 'awakened tick 7')
    assert.equal(found.activity, 'reading: presence.ts')
    assert.equal(found.tickState, 'running')
    assert.equal(found.tickMode, 'awakened')
    assert.equal(found.tickNumber, 7)
    assert.equal(found.tickMax, 24)
    assert.equal(found.tickStartedAt, now)
    assert.equal(found.scheduleIntervalMs, 111_000)
  })

  test('writePresence + readPresence legacy round-trip', () => {
    const legacyPath = join(dir, 'legacy.json')
    process.env.TRUE_LOVE_PRESENCE_PATH = legacyPath
    // Clear per-device dir so only legacy is read
    process.env.TRUE_LOVE_PRESENCE_DIR = join(dir, 'empty-pres')
    writePresence({
      updatedAt: new Date().toISOString(),
      devices: [
        { deviceId: 'leg-1', lastSeen: new Date().toISOString() },
        { deviceId: 'leg-2', lastSeen: new Date().toISOString() },
      ],
    })
    const roster = readPresence()
    assert.equal(roster.devices.length, 2)
    const ids = roster.devices.map(d => d.deviceId).sort()
    assert.deepEqual(ids, ['leg-1', 'leg-2'])
  })
})
