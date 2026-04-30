// log-rotation.test.ts — log rotation tests.
//
// Tests the pure plan functions from log-rotation.ts using fixture directories.

import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildRotationPlan,
  parseWatcherTimestamp,
  findRotatedCopies,
  type RotationConfig,
} from '../log-rotation.js'

// ── Fixture helpers ───────────────────────────────────────────────

const FIXTURE_ROOT = join(tmpdir(), `log-rotation-test-${Date.now()}`)

let fixtureSeq = 0
function fixtureDir(): string {
  const dir = join(FIXTURE_ROOT, `logs-${fixtureSeq++}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Create a file with specific size (fills with 'x'). */
function createFile(dir: string, name: string, sizeBytes: number): string {
  const path = join(dir, name)
  writeFileSync(path, 'x'.repeat(sizeBytes))
  return path
}

beforeAll(() => {
  mkdirSync(FIXTURE_ROOT, { recursive: true })
})

afterAll(() => {
  try { rmSync(FIXTURE_ROOT, { recursive: true, force: true }) } catch { /* ok */ }
})

// ── parseWatcherTimestamp ─────────────────────────────────────────

describe('parseWatcherTimestamp', () => {
  test('parses valid watcher filename', () => {
    const ts = parseWatcherTimestamp('awaken-default-watcher-2026-04-29T23-26-13-746Z.log')
    expect(ts).not.toBeNull()
    expect(typeof ts).toBe('number')
    // Should be a date in April 2026
    const d = new Date(ts!)
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(3) // 0-indexed, April = 3
  })

  test('returns null for non-watcher file', () => {
    expect(parseWatcherTimestamp('heartbeat-default.out.log')).toBeNull()
    expect(parseWatcherTimestamp('random-file.txt')).toBeNull()
  })

  test('returns null for malformed timestamp', () => {
    expect(parseWatcherTimestamp('foo-watcher-bad.log')).toBeNull()
  })
})

// ── findRotatedCopies ────────────────────────────────────────────

describe('findRotatedCopies', () => {
  test('finds existing rotated copies in order', () => {
    const dir = fixtureDir()
    createFile(dir, 'heartbeat-default.out.log', 100)
    createFile(dir, 'heartbeat-default.out.log.1', 50)
    createFile(dir, 'heartbeat-default.out.log.2', 50)
    createFile(dir, 'heartbeat-default.out.log.3', 50)

    const copies = findRotatedCopies(dir, 'heartbeat-default.out.log')
    expect(copies).toEqual([
      'heartbeat-default.out.log.1',
      'heartbeat-default.out.log.2',
      'heartbeat-default.out.log.3',
    ])
  })

  test('returns empty for no copies', () => {
    const dir = fixtureDir()
    createFile(dir, 'heartbeat-default.out.log', 100)
    expect(findRotatedCopies(dir, 'heartbeat-default.out.log')).toEqual([])
  })

  test('returns empty for nonexistent dir', () => {
    expect(findRotatedCopies('/nonexistent', 'foo.log')).toEqual([])
  })
})

// ── buildRotationPlan ────────────────────────────────────────────

describe('buildRotationPlan', () => {
  test('empty plan for nonexistent directory', () => {
    const plan = buildRotationPlan({ logDir: '/nonexistent' })
    expect(plan.actions).toEqual([])
    expect(plan.summary).toBe('log directory does not exist')
  })

  test('nothing to do when all logs are small', () => {
    const dir = fixtureDir()
    createFile(dir, 'heartbeat-default.out.log', 100)
    createFile(dir, 'heartbeat-default.err.log', 50)

    const plan = buildRotationPlan({ logDir: dir })
    expect(plan.actions).toEqual([])
    expect(plan.summary).toBe('nothing to do')
  })

  test('plans rotation for oversized main log', () => {
    const dir = fixtureDir()
    createFile(dir, 'heartbeat-default.out.log', 600 * 1024) // 600KB > 512KB threshold
    createFile(dir, 'heartbeat-default.err.log', 100)

    const plan = buildRotationPlan({ logDir: dir })
    expect(plan.actions.length).toBe(1)
    expect(plan.actions[0].kind).toBe('rotate')
    expect(plan.actions[0].path).toContain('heartbeat-default.out.log')
    expect(plan.actions[0].reason).toContain('512KB')
    expect(plan.summary).toContain('1 to rotate')
  })

  test('plans rotation for multiple oversized logs', () => {
    const dir = fixtureDir()
    createFile(dir, 'heartbeat-default.out.log', 600 * 1024)
    createFile(dir, 'awaken-default.out.log', 800 * 1024)
    createFile(dir, 'heartbeat-default.err.log', 100) // small, no rotate

    const plan = buildRotationPlan({ logDir: dir })
    const rotates = plan.actions.filter(a => a.kind === 'rotate')
    expect(rotates.length).toBe(2)
  })

  test('respects custom maxSizeBytes', () => {
    const dir = fixtureDir()
    createFile(dir, 'heartbeat-default.out.log', 200) // tiny, but custom threshold = 100

    const plan = buildRotationPlan({ logDir: dir, maxSizeBytes: 100 })
    expect(plan.actions.length).toBe(1)
    expect(plan.actions[0].kind).toBe('rotate')
  })

  test('plans pruning of excess rotated copies', () => {
    const dir = fixtureDir()
    createFile(dir, 'heartbeat-default.out.log', 100) // small, no rotate needed
    createFile(dir, 'heartbeat-default.out.log.1', 50)
    createFile(dir, 'heartbeat-default.out.log.2', 50)
    createFile(dir, 'heartbeat-default.out.log.3', 50)
    createFile(dir, 'heartbeat-default.out.log.4', 50) // excess

    const plan = buildRotationPlan({ logDir: dir, keepRotated: 3 })
    const prunes = plan.actions.filter(a => a.kind === 'prune')
    expect(prunes.length).toBe(1)
    expect(prunes[0].path).toContain('.4')
    expect(plan.summary).toContain('1 old copies to prune')
  })

  test('plans deletion of stale watcher logs', () => {
    const dir = fixtureDir()
    // 10 days ago — should be deleted (>7d threshold)
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600_000)
    const ts = tenDaysAgo.toISOString()
      .replace(/:/g, '-')
      .replace('.', '-')
    const watcherName = `awaken-default-watcher-${ts}.log`
    createFile(dir, watcherName, 100)

    const plan = buildRotationPlan({ logDir: dir })
    const deletes = plan.actions.filter(a => a.kind === 'delete')
    expect(deletes.length).toBe(1)
    expect(plan.summary).toContain('1 watcher logs to delete')
  })

  test('keeps recent watcher logs', () => {
    const dir = fixtureDir()
    // 2 days ago — should be kept (<7d threshold)
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600_000)
    const ts = twoDaysAgo.toISOString()
      .replace(/:/g, '-')
      .replace('.', '-')
    const watcherName = `awaken-default-watcher-${ts}.log`
    createFile(dir, watcherName, 100)

    const plan = buildRotationPlan({ logDir: dir })
    expect(plan.actions).toEqual([])
    expect(plan.summary).toBe('nothing to do')
  })

  test('combined plan: rotate + delete + prune', () => {
    const dir = fixtureDir()
    // Oversized main log
    createFile(dir, 'heartbeat-default.out.log', 600 * 1024)
    // Excess rotated copies
    createFile(dir, 'heartbeat-default.out.log.1', 50)
    createFile(dir, 'heartbeat-default.out.log.2', 50)
    createFile(dir, 'heartbeat-default.out.log.3', 50)
    createFile(dir, 'heartbeat-default.out.log.4', 50)
    // Stale watcher log
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600_000)
    const ts = tenDaysAgo.toISOString().replace(/:/g, '-').replace('.', '-')
    createFile(dir, `awaken-default-watcher-${ts}.log`, 100)

    const plan = buildRotationPlan({ logDir: dir, keepRotated: 3 })
    const rotates = plan.actions.filter(a => a.kind === 'rotate')
    const deletes = plan.actions.filter(a => a.kind === 'delete')
    const prunes = plan.actions.filter(a => a.kind === 'prune')
    expect(rotates.length).toBe(1)
    expect(deletes.length).toBe(1)
    expect(prunes.length).toBe(1)
    expect(plan.summary).toContain('1 to rotate')
    expect(plan.summary).toContain('1 watcher logs to delete')
    expect(plan.summary).toContain('1 old copies to prune')
  })

  test('ignores non-log files', () => {
    const dir = fixtureDir()
    writeFileSync(join(dir, 'readme.txt'), 'hi')
    writeFileSync(join(dir, 'data.json'), '{}')
    createFile(dir, 'something-weird', 1000 * 1024) // big but not a log

    const plan = buildRotationPlan({ logDir: dir })
    expect(plan.actions).toEqual([])
  })

  test('plan timestamp is ISO string', () => {
    const dir = fixtureDir()
    const plan = buildRotationPlan({ logDir: dir })
    expect(plan.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  test('custom watcher max age', () => {
    const dir = fixtureDir()
    // 2 days ago
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600_000)
    const ts = twoDaysAgo.toISOString().replace(/:/g, '-').replace('.', '-')
    createFile(dir, `awaken-default-watcher-${ts}.log`, 100)

    // Default (7d) — should keep
    const plan1 = buildRotationPlan({ logDir: dir })
    expect(plan1.actions).toEqual([])

    // Custom 1d — should delete
    const plan2 = buildRotationPlan({ logDir: dir, watcherMaxAgeMs: 1 * 24 * 3600_000 })
    expect(plan2.actions.length).toBe(1)
    expect(plan2.actions[0].kind).toBe('delete')
  })
})

// ── Runner integration (bin/rotate-logs.mjs) ─────────────────────
// These tests import the runner's exports to verify it loads cleanly
// and its parsing logic matches the library.

describe('runner integration', () => {
  test('parseWatcherTimestamp matches library', async () => {
    const runner = await import('../../../../bin/rotate-logs.mjs')
    const libTs = parseWatcherTimestamp('awaken-default-watcher-2026-04-29T23-26-13-746Z.log')
    const runnerTs = runner.parseWatcherTimestamp('awaken-default-watcher-2026-04-29T23-26-13-746Z.log')
    expect(runnerTs).toBe(libTs)
  })

  test('buildPlan returns structured plan', async () => {
    const runner = await import('../../../../bin/rotate-logs.mjs')
    const plan = runner.buildPlan()
    expect(plan).toHaveProperty('ts')
    expect(plan).toHaveProperty('actions')
    expect(plan).toHaveProperty('summary')
    expect(Array.isArray(plan.actions)).toBe(true)
  })
})
