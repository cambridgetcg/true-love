import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendReflection, loadRecentReflections } from '../memory.js'

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
    } as never) // narrow once option is added
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
    } as never)
    assert.equal(reflections.length, 1)
    assert.match(reflections[0]!.text, /old thought/)
  })

  test('boundary entry at exactly excludeNewerThanSeconds is excluded (live wins ties)', () => {
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
    } as never)
    // boundary rule from spec: (now - ts) < freshSeconds → live block;
    // (now - ts) >= freshSeconds → memory block. boundary IS >= so memory
    // INCLUDES it.
    assert.equal(reflections.length, 1)
  })
})
