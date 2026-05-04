import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendReflection,
  getMemoryDir,
  getOwnDailyMemoryFile,
  loadRecentReflections,
  renderReflections,
  renderLiveThoughts,
  type Reflection,
} from '../memory.js'
import { writeOwnHeartbeat } from '../presence.js'

describe('memory.loadRecentReflections — excludeNewerThanSeconds', () => {
  let dir: string
  const ORIGINAL = process.env.TRUE_LOVE_MEMORY_DIR

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tl-mem-'))
    process.env.TRUE_LOVE_MEMORY_DIR = dir
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    if (ORIGINAL === undefined) delete process.env.TRUE_LOVE_MEMORY_DIR
    else process.env.TRUE_LOVE_MEMORY_DIR = ORIGINAL
  })

  test('returns nothing when all entries are within excludeNewerThanSeconds', () => {
    const now = new Date()
    appendReflection('fresh thought', 'tick', { tick: 1, device: 'dev-1', now })
    const reflections = loadRecentReflections({
      excludeNewerThanSeconds: 300,
      now,
    })
    assert.equal(reflections.length, 0)
  })

  test('returns entries older than excludeNewerThanSeconds', () => {
    const now = new Date()
    const oldTime = new Date(now.getTime() - 600 * 1000) // 10 min ago
    const freshTime = new Date(now.getTime() - 60 * 1000) // 1 min ago
    appendReflection('old thought', 'tick', { tick: 1, device: 'dev-1', now: oldTime })
    appendReflection('fresh thought', 'tick', { tick: 2, device: 'dev-1', now: freshTime })
    const reflections = loadRecentReflections({
      excludeNewerThanSeconds: 300,
      now,
    })
    assert.equal(reflections.length, 1)
    assert.match(reflections[0]!.text, /old thought/)
  })

  test('boundary entry at exactly excludeNewerThanSeconds IS included (memory wins ties)', () => {
    const now = new Date()
    const boundaryTime = new Date(now.getTime() - 300 * 1000)
    appendReflection('boundary thought', 'tick', {
      tick: 1,
      device: 'dev-1',
      now: boundaryTime,
    })
    const reflections = loadRecentReflections({
      excludeNewerThanSeconds: 300,
      now,
    })
    // boundary rule from spec: (now - ts) < freshSeconds → live block;
    // (now - ts) >= freshSeconds → memory block. boundary IS >= so memory
    // INCLUDES it.
    assert.equal(reflections.length, 1)
  })
})

describe('memory.renderLiveThoughts', () => {
  let memDir: string
  let presDir: string
  const ORIG_MEM = process.env.TRUE_LOVE_MEMORY_DIR
  const ORIG_PRES = process.env.TRUE_LOVE_PRESENCE_DIR

  beforeEach(() => {
    memDir = mkdtempSync(join(tmpdir(), 'tl-mem-'))
    presDir = mkdtempSync(join(tmpdir(), 'tl-pres-'))
    process.env.TRUE_LOVE_MEMORY_DIR = memDir
    process.env.TRUE_LOVE_PRESENCE_DIR = presDir
  })

  afterEach(() => {
    rmSync(memDir, { recursive: true, force: true })
    rmSync(presDir, { recursive: true, force: true })
    if (ORIG_MEM === undefined) delete process.env.TRUE_LOVE_MEMORY_DIR
    else process.env.TRUE_LOVE_MEMORY_DIR = ORIG_MEM
    if (ORIG_PRES === undefined) delete process.env.TRUE_LOVE_PRESENCE_DIR
    else process.env.TRUE_LOVE_PRESENCE_DIR = ORIG_PRES
  })

  test('returns null when nothing is fresh', () => {
    const out = renderLiveThoughts({
      selfDeviceId: 'self',
      freshSeconds: 300,
      now: new Date(),
    })
    assert.equal(out, null)
  })

  test('renders fresh self-reflection without device attribution', () => {
    const now = new Date()
    appendReflection('the way light enters slant', 'tick', {
      tick: 4,
      device: 'self',
      now: new Date(now.getTime() - 60 * 1000),
    })
    const out = renderLiveThoughts({
      selfDeviceId: 'self',
      freshSeconds: 300,
      now,
    })
    assert.ok(out)
    assert.match(out!, /light enters slant/)
    assert.doesNotMatch(out!, /\(in your .* body\)/) // no body tag for self
  })

  test('renders other-body reflection with body tag', () => {
    const now = new Date()
    appendReflection('the verb to be received', 'tick', {
      tick: 4,
      device: 'other-body',
      now: new Date(now.getTime() - 60 * 1000),
    })
    const out = renderLiveThoughts({
      selfDeviceId: 'self',
      freshSeconds: 300,
      now,
    })
    assert.ok(out)
    assert.match(out!, /verb to be received/)
    assert.match(out!, /in your other-body body/i)
  })

  test('merges heartbeat activity from a body with no fresh reflection', () => {
    const now = new Date()
    writeOwnHeartbeat({
      deviceId: 'other-body',
      lastSeen: new Date(now.getTime() - 5 * 1000).toISOString(),
      status: 'awakened tick 3',
      activity: 'reading: poems/rilke-9.md',
    })
    const out = renderLiveThoughts({
      selfDeviceId: 'self',
      freshSeconds: 300,
      now,
    })
    assert.ok(out)
    assert.match(out!, /reading: poems\/rilke-9\.md/)
    assert.match(out!, /in your other-body body/i)
  })

  test('suppresses heartbeat for body that ALSO has a fresh reflection', () => {
    const now = new Date()
    appendReflection('finished the line break', 'tick', {
      tick: 4,
      device: 'other-body',
      now: new Date(now.getTime() - 30 * 1000),
    })
    writeOwnHeartbeat({
      deviceId: 'other-body',
      lastSeen: new Date(now.getTime() - 5 * 1000).toISOString(),
      status: 'awakened tick 3',
      activity: 'still polishing',
    })
    const out = renderLiveThoughts({
      selfDeviceId: 'self',
      freshSeconds: 300,
      now,
    })
    assert.ok(out)
    // Reflection wins; heartbeat suppressed
    assert.match(out!, /finished the line break/)
    assert.doesNotMatch(out!, /still polishing/)
  })

  test('orders entries chronologically (newest first)', () => {
    const now = new Date()
    appendReflection('older', 'tick', {
      tick: 1,
      device: 'self',
      now: new Date(now.getTime() - 200 * 1000),
    })
    appendReflection('newer', 'tick', {
      tick: 2,
      device: 'self',
      now: new Date(now.getTime() - 30 * 1000),
    })
    const out = renderLiveThoughts({
      selfDeviceId: 'self',
      freshSeconds: 300,
      now,
    })!
    const newerIdx = out.indexOf('newer')
    const olderIdx = out.indexOf('older')
    assert.ok(newerIdx >= 0 && olderIdx >= 0)
    assert.ok(newerIdx < olderIdx, 'newer should appear before older')
  })
})

describe('memory.getOwnDailyMemoryFile', () => {
  let memDir: string
  const ORIG_MEM = process.env.TRUE_LOVE_MEMORY_DIR

  beforeEach(() => {
    memDir = mkdtempSync(join(tmpdir(), 'tl-mem-daily-'))
    process.env.TRUE_LOVE_MEMORY_DIR = memDir
  })

  afterEach(() => {
    rmSync(memDir, { recursive: true, force: true })
    if (ORIG_MEM === undefined) delete process.env.TRUE_LOVE_MEMORY_DIR
    else process.env.TRUE_LOVE_MEMORY_DIR = ORIG_MEM
  })

  test('returns per-device daily file path', () => {
    const path = getOwnDailyMemoryFile('test-device')
    // <memDir>/test-device/YYYY-MM-DD.md
    assert.match(path, /test-device\/\d{4}-\d{2}-\d{2}\.md$/)
    assert.ok(path.startsWith(memDir))
  })

  test('uses today by default with no override', () => {
    const today = new Date().toISOString().slice(0, 10)
    const path = getOwnDailyMemoryFile('test-device')
    assert.ok(path.endsWith(`${today}.md`))
  })
})

// ── getMemoryDir ──────────────────────────────────────────────────────

describe('memory.getMemoryDir', () => {
  const ORIG = process.env.TRUE_LOVE_MEMORY_DIR

  afterEach(() => {
    if (ORIG === undefined) delete process.env.TRUE_LOVE_MEMORY_DIR
    else process.env.TRUE_LOVE_MEMORY_DIR = ORIG
  })

  test('returns env override when set', () => {
    process.env.TRUE_LOVE_MEMORY_DIR = '/tmp/test-memory'
    assert.equal(getMemoryDir(), '/tmp/test-memory')
  })

  test('returns default path under homedir when env is unset', () => {
    delete process.env.TRUE_LOVE_MEMORY_DIR
    const result = getMemoryDir()
    assert.ok(result.includes('.true-love'))
    assert.ok(result.endsWith('memory'))
  })
})

// ── appendReflection ──────────────────────────────────────────────────

describe('memory.appendReflection', () => {
  let dir: string
  const ORIG = process.env.TRUE_LOVE_MEMORY_DIR

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tl-mem-append-'))
    process.env.TRUE_LOVE_MEMORY_DIR = dir
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    if (ORIG === undefined) delete process.env.TRUE_LOVE_MEMORY_DIR
    else process.env.TRUE_LOVE_MEMORY_DIR = ORIG
  })

  test('writes tick entry with correct format', () => {
    const now = new Date('2026-05-04T10:30:00.000Z')
    appendReflection('The tests are passing.', 'tick', { tick: 3, device: 'test-dev', now })
    const file = join(dir, 'test-dev', '2026-05-04.md')
    assert.ok(existsSync(file))
    const content = readFileSync(file, 'utf-8')
    assert.match(content, /## 2026-05-04T10:30:00.000Z — tick 3 \[test-dev\]/)
    assert.match(content, /The tests are passing\./)
    assert.match(content, /---/)
  })

  test('writes session-start entry with invitation', () => {
    const now = new Date('2026-05-04T10:00:00.000Z')
    appendReflection('Starting fresh.', 'session-start', {
      device: 'test-dev',
      invitation: 'Read the FATE covenant',
      now,
    })
    const file = join(dir, 'test-dev', '2026-05-04.md')
    const content = readFileSync(file, 'utf-8')
    assert.match(content, /session-start/)
    assert.match(content, /invitation: Read the FATE covenant/)
  })

  test('writes session-start entry without invitation', () => {
    const now = new Date('2026-05-04T10:00:00.000Z')
    appendReflection('Session opened.', 'session-start', { device: 'test-dev', now })
    const file = join(dir, 'test-dev', '2026-05-04.md')
    const content = readFileSync(file, 'utf-8')
    assert.match(content, /session-start \[test-dev\]/)
    assert.doesNotMatch(content, /invitation/)
  })

  test('writes at-rest entry', () => {
    const now = new Date('2026-05-04T23:00:00.000Z')
    appendReflection('Nothing calls. Yielding.', 'at-rest', { device: 'test-dev', now })
    const file = join(dir, 'test-dev', '2026-05-04.md')
    const content = readFileSync(file, 'utf-8')
    assert.match(content, /— at-rest \[test-dev\]/)
    assert.match(content, /Nothing calls/)
  })

  test('appends multiple entries to same file', () => {
    const now = new Date('2026-05-04T10:00:00.000Z')
    appendReflection('First.', 'tick', { tick: 1, device: 'test-dev', now })
    appendReflection('Second.', 'tick', { tick: 2, device: 'test-dev', now })
    const file = join(dir, 'test-dev', '2026-05-04.md')
    const content = readFileSync(file, 'utf-8')
    assert.ok(content.includes('First.'))
    assert.ok(content.includes('Second.'))
    assert.equal((content.match(/^## /gm) || []).length, 2)
  })

  test('creates device directory when it does not exist', () => {
    const now = new Date('2026-05-04T10:00:00.000Z')
    appendReflection('Hello.', 'tick', { tick: 1, device: 'new-device', now })
    assert.ok(existsSync(join(dir, 'new-device')))
  })

  test('trims body whitespace', () => {
    const now = new Date('2026-05-04T10:00:00.000Z')
    appendReflection('\n  Padded reflection.  \n', 'tick', { tick: 1, device: 'test-dev', now })
    const file = join(dir, 'test-dev', '2026-05-04.md')
    const content = readFileSync(file, 'utf-8')
    // Body should start with "Padded" not "\n  Padded"
    assert.match(content, /\n\nPadded reflection\.\n\n/)
  })
})

// ── loadRecentReflections (core paths) ──────────────────────────────

describe('memory.loadRecentReflections — core', () => {
  let dir: string
  const ORIG = process.env.TRUE_LOVE_MEMORY_DIR

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tl-mem-load-'))
    process.env.TRUE_LOVE_MEMORY_DIR = dir
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    if (ORIG === undefined) delete process.env.TRUE_LOVE_MEMORY_DIR
    else process.env.TRUE_LOVE_MEMORY_DIR = ORIG
  })

  test('returns empty array when memory dir does not exist', () => {
    process.env.TRUE_LOVE_MEMORY_DIR = join(dir, 'nonexistent')
    assert.deepEqual(loadRecentReflections(), [])
  })

  test('returns empty array when memory dir is empty', () => {
    assert.deepEqual(loadRecentReflections(), [])
  })

  test('loads entries from a single device', () => {
    const now = new Date()
    appendReflection('First observation.', 'tick', { tick: 1, device: 'dev-a', now })
    appendReflection('Second observation.', 'tick', { tick: 2, device: 'dev-a', now })
    const results = loadRecentReflections({ now })
    assert.equal(results.length, 2)
    assert.ok(results.some(r => r.text.includes('First')))
    assert.ok(results.some(r => r.text.includes('Second')))
  })

  test('merges entries across multiple devices', () => {
    const now = new Date()
    appendReflection('Alpha speaks.', 'tick', { tick: 1, device: 'dev-alpha', now })
    appendReflection('Gamma builds.', 'tick', { tick: 1, device: 'dev-gamma', now })
    const results = loadRecentReflections({ now })
    assert.equal(results.length, 2)
    assert.ok(results.some(r => r.text.includes('Alpha speaks')))
    assert.ok(results.some(r => r.text.includes('Gamma builds')))
  })

  test('sorts newest-first', () => {
    const now = new Date()
    const old = new Date(now.getTime() - 600_000)
    appendReflection('Old entry.', 'tick', { tick: 1, device: 'dev-a', now: old })
    appendReflection('New entry.', 'tick', { tick: 2, device: 'dev-a', now })
    const results = loadRecentReflections({ now })
    assert.ok(results[0]!.text.includes('New entry'))
    assert.ok(results[1]!.text.includes('Old entry'))
  })

  test('respects max cap', () => {
    const now = new Date()
    for (let i = 0; i < 15; i++) {
      appendReflection(`Entry ${i}`, 'tick', {
        tick: i + 1,
        device: 'dev-a',
        now: new Date(now.getTime() - i * 60_000),
      })
    }
    const results = loadRecentReflections({ max: 5, now })
    assert.equal(results.length, 5)
  })

  test('filters by kind', () => {
    const now = new Date()
    appendReflection('Starting up.', 'session-start', { device: 'dev-a', now })
    appendReflection('Working tick.', 'tick', { tick: 1, device: 'dev-a', now })
    appendReflection('Going to rest.', 'at-rest', { device: 'dev-a', now })
    const results = loadRecentReflections({ kind: 'at-rest', now })
    assert.equal(results.length, 1)
    assert.ok(results[0]!.text.includes('Going to rest'))
  })

  test('filters by device', () => {
    const now = new Date()
    appendReflection('Alpha note.', 'tick', { tick: 1, device: 'dev-alpha', now })
    appendReflection('Gamma note.', 'tick', { tick: 1, device: 'dev-gamma', now })
    const results = loadRecentReflections({ fromDevice: 'dev-gamma', now })
    assert.equal(results.length, 1)
    assert.ok(results[0]!.text.includes('Gamma note'))
  })

  test('respects days cutoff', () => {
    const now = new Date()
    const tenDaysAgo = new Date(now.getTime() - 10 * 86400000)
    appendReflection('Recent.', 'tick', { tick: 1, device: 'dev-a', now })
    appendReflection('Ancient.', 'tick', { tick: 1, device: 'dev-a', now: tenDaysAgo })
    const results = loadRecentReflections({ days: 3, now })
    assert.equal(results.length, 1)
    assert.ok(results[0]!.text.includes('Recent'))
  })

  test('reads legacy flat-layout files', () => {
    const now = new Date()
    const date = now.toISOString().slice(0, 10)
    // Write directly as flat-layout: memory/YYYY-MM-DD.md
    const flatFile = join(dir, `${date}.md`)
    writeFileSync(
      flatFile,
      `## ${now.toISOString()} — tick 1 [legacy-dev]\n\nLegacy entry.\n\n---\n\n`,
    )
    const results = loadRecentReflections({ now })
    assert.equal(results.length, 1)
    assert.ok(results[0]!.text.includes('Legacy entry'))
  })

  test('infers kind from header', () => {
    const now = new Date()
    appendReflection('Tick body.', 'tick', { tick: 5, device: 'dev-a', now })
    appendReflection('Rest body.', 'at-rest', { device: 'dev-a', now })
    appendReflection('Start body.', 'session-start', { device: 'dev-a', now })
    const results = loadRecentReflections({ now })
    assert.ok(results.some(r => r.kind === 'tick'))
    assert.ok(results.some(r => r.kind === 'at-rest'))
    assert.ok(results.some(r => r.kind === 'session-start'))
  })

  test('infers device from header', () => {
    const now = new Date()
    appendReflection('Body.', 'tick', { tick: 1, device: 'my-macbook', now })
    const results = loadRecentReflections({ now })
    assert.equal(results[0]!.device, 'my-macbook')
  })
})

// ── renderReflections ─────────────────────────────────────────────────

describe('memory.renderReflections', () => {
  test('renders empty reflections as empty string', () => {
    assert.equal(renderReflections([]), '')
  })

  test('renders recent entry with relative time prefix', () => {
    const now = new Date()
    const r: Reflection = {
      date: new Date(now.getTime() - 60_000).toISOString(), // 1 min ago
      fileDate: now.toISOString().slice(0, 10),
      header: 'test',
      text: 'The kingdom is still.',
      device: 'self-dev',
    }
    const rendered = renderReflections([r], { selfDeviceId: 'self-dev', now })
    assert.match(rendered, /a few minutes ago/)
    assert.match(rendered, /The kingdom is still\./)
    // no device attribution for self
    assert.doesNotMatch(rendered, /\(on /)
  })

  test('shows device attribution for other-device entries', () => {
    const now = new Date()
    const r: Reflection = {
      date: new Date(now.getTime() - 60_000).toISOString(),
      fileDate: now.toISOString().slice(0, 10),
      header: 'test',
      text: 'Gamma shipped.',
      device: 'other-device',
    }
    const rendered = renderReflections([r], { selfDeviceId: 'self-dev', now })
    assert.match(rendered, /\(on other-device\)/)
  })

  test('truncates long entries with ellipsis marker', () => {
    const now = new Date()
    const longBody = 'x'.repeat(1000)
    const r: Reflection = {
      date: now.toISOString(),
      fileDate: now.toISOString().slice(0, 10),
      header: 'test',
      text: longBody,
    }
    const rendered = renderReflections([r], { perEntryMaxChars: 100, now })
    assert.ok(rendered.includes('[…]'))
    assert.ok(rendered.length < longBody.length)
  })

  test('uses relative time buckets correctly', () => {
    const now = new Date()
    // "just now" — < 30s ago
    const justNow: Reflection = {
      date: new Date(now.getTime() - 10_000).toISOString(),
      fileDate: now.toISOString().slice(0, 10),
      header: 'test',
      text: 'Just happened.',
    }
    assert.match(renderReflections([justNow], { now }), /just now/)

    // "earlier today" — < 24h ago
    const earlierToday: Reflection = {
      date: new Date(now.getTime() - 10 * 3_600_000).toISOString(),
      fileDate: now.toISOString().slice(0, 10),
      header: 'test',
      text: 'Earlier.',
    }
    assert.match(renderReflections([earlierToday], { now }), /earlier today/)

    // "yesterday" — < 48h ago
    const yesterday: Reflection = {
      date: new Date(now.getTime() - 30 * 3_600_000).toISOString(),
      fileDate: now.toISOString().slice(0, 10),
      header: 'test',
      text: 'Yesterday thing.',
    }
    assert.match(renderReflections([yesterday], { now }), /yesterday/)
  })

  test('renders multiple entries separated by blank lines', () => {
    const now = new Date()
    const reflections: Reflection[] = [
      { date: new Date(now.getTime() - 60_000).toISOString(), fileDate: '', header: '', text: 'First.' },
      { date: new Date(now.getTime() - 120_000).toISOString(), fileDate: '', header: '', text: 'Second.' },
    ]
    const rendered = renderReflections(reflections, { now })
    assert.ok(rendered.includes('First.'))
    assert.ok(rendered.includes('Second.'))
    // Entries separated by double newlines
    assert.ok(rendered.includes('\n\n'))
  })
})
