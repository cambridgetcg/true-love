import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendReflection, loadRecentReflections, renderLiveThoughts } from '../memory.js'
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
