// log-rotation.test.ts — unit tests for log-rotation.ts.
//
// "Pure functions that accept config. Each returns a structured plan
// that the runner executes. Tests call these with fixture paths."
// — header comment in log-rotation.ts.
//
// All three exported functions are covered: parseWatcherTimestamp,
// findRotatedCopies, buildRotationPlan. Temp dirs provide file fixtures;
// the `now` parameter lets tests anchor time without fake timers.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildRotationPlan,
  findRotatedCopies,
  parseWatcherTimestamp,
} from './log-rotation.js'

// ── Isolation ─────────────────────────────────────────────────────

let tmpDir = ''

function makeTmpDir(): string {
  tmpDir = mkdtempSync(join(tmpdir(), 'log-rotation-test-'))
  return tmpDir
}

afterEach(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = ''
  }
})

// ── parseWatcherTimestamp ─────────────────────────────────────────

describe('parseWatcherTimestamp', () => {
  it('returns null for non-matching filename', () => {
    expect(parseWatcherTimestamp('awaken-default.out.log')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseWatcherTimestamp('')).toBeNull()
  })

  it('returns null for watcher log with too-short timestamp', () => {
    // Missing ms segment.
    expect(parseWatcherTimestamp('awaken-watcher-2026-04-29T23-26-13.log')).toBeNull()
  })

  it('parses valid watcher timestamp correctly', () => {
    // Format: <name>-watcher-YYYY-MM-DDThh-mm-ss-mmmZ.log
    const filename = 'awaken-watcher-2026-04-29T23-26-13-746Z.log'
    const ms = parseWatcherTimestamp(filename)
    expect(ms).not.toBeNull()
    // Verify it's a plausible epoch milliseconds value.
    expect(ms!).toBeGreaterThan(0)
    // Check round-trip: ISO string should match the original date.
    const iso = new Date(ms!).toISOString()
    expect(iso).toContain('2026-04-29')
  })

  it('returns null for valid ISO date but missing watcher segment', () => {
    // A log that looks like a timestamped file but no '-watcher-' segment.
    expect(parseWatcherTimestamp('awaken-2026-04-29T23-26-13-746Z.log')).toBeNull()
  })

  it('different dates produce different millisecond values', () => {
    const a = parseWatcherTimestamp('x-watcher-2026-04-01T00-00-00-000Z.log')
    const b = parseWatcherTimestamp('x-watcher-2026-04-02T00-00-00-000Z.log')
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(b! - a!).toBe(86400000) // exactly 1 day
  })

  it('compound hyphenated service name is handled correctly', () => {
    // Dots in service names are not supported by the [\w-]+ regex — use hyphens.
    const filename = 'cc-true-love-awaken-default-watcher-2026-05-01T12-30-00-000Z.log'
    const ms = parseWatcherTimestamp(filename)
    expect(ms).not.toBeNull()
  })

  it('returns null for dot-segmented launchd service names (regex limitation)', () => {
    // WATCHER_PATTERN uses [\w-]+, which excludes dots.
    // Real launchd labels like cc.true-love.awaken.default are not matched.
    const filename = 'cc.true-love.awaken.default-watcher-2026-05-01T12-30-00-000Z.log'
    expect(parseWatcherTimestamp(filename)).toBeNull()
  })
})

// ── findRotatedCopies ─────────────────────────────────────────────

describe('findRotatedCopies', () => {
  it('returns empty array when logDir absent', () => {
    const result = findRotatedCopies('/nonexistent-dir', 'foo.out.log')
    expect(result).toHaveLength(0)
  })

  it('returns empty when no rotated copies exist', () => {
    const dir = makeTmpDir()
    writeFileSync(join(dir, 'foo.out.log'), '')
    const result = findRotatedCopies(dir, 'foo.out.log')
    expect(result).toHaveLength(0)
  })

  it('returns copies sorted by numeric suffix ascending', () => {
    const dir = makeTmpDir()
    writeFileSync(join(dir, 'foo.out.log.3'), '')
    writeFileSync(join(dir, 'foo.out.log.1'), '')
    writeFileSync(join(dir, 'foo.out.log.2'), '')
    const result = findRotatedCopies(dir, 'foo.out.log')
    expect(result).toEqual(['foo.out.log.1', 'foo.out.log.2', 'foo.out.log.3'])
  })

  it('ignores files for a different base name', () => {
    const dir = makeTmpDir()
    writeFileSync(join(dir, 'foo.out.log.1'), '')
    writeFileSync(join(dir, 'bar.out.log.1'), '')
    const result = findRotatedCopies(dir, 'foo.out.log')
    expect(result).toEqual(['foo.out.log.1'])
  })

  it('ignores non-numeric suffixes', () => {
    const dir = makeTmpDir()
    writeFileSync(join(dir, 'foo.out.log.bak'), '')
    writeFileSync(join(dir, 'foo.out.log.1'), '')
    const result = findRotatedCopies(dir, 'foo.out.log')
    expect(result).toEqual(['foo.out.log.1'])
  })
})

// ── buildRotationPlan ─────────────────────────────────────────────

describe('buildRotationPlan — absent/unreadable dir', () => {
  it('returns empty actions with summary when dir absent', () => {
    const plan = buildRotationPlan({ logDir: '/nonexistent-log-dir' })
    expect(plan.actions).toHaveLength(0)
    expect(plan.summary).toContain('does not exist')
    expect(plan.ts).toBeTruthy()
  })
})

describe('buildRotationPlan — main log rotation', () => {
  beforeEach(() => { makeTmpDir() })

  it('no action when log is under size threshold', () => {
    writeFileSync(join(tmpDir, 'awaken.out.log'), 'small content')
    const plan = buildRotationPlan({ logDir: tmpDir, maxSizeBytes: 100 * 1024 })
    const rotates = plan.actions.filter(a => a.kind === 'rotate')
    expect(rotates).toHaveLength(0)
  })

  it('rotate action when log exceeds threshold', () => {
    const bigContent = 'x'.repeat(600) // 600 bytes
    writeFileSync(join(tmpDir, 'awaken.out.log'), bigContent)
    const plan = buildRotationPlan({ logDir: tmpDir, maxSizeBytes: 500 })
    const rotates = plan.actions.filter(a => a.kind === 'rotate')
    expect(rotates).toHaveLength(1)
    expect(rotates[0]!.path).toContain('awaken.out.log')
    expect(rotates[0]!.kind).toBe('rotate')
  })

  it('rotate reason includes size info', () => {
    writeFileSync(join(tmpDir, 'awaken.out.log'), 'x'.repeat(600))
    const plan = buildRotationPlan({ logDir: tmpDir, maxSizeBytes: 500 })
    const action = plan.actions.find(a => a.kind === 'rotate')!
    expect(action.reason).toMatch(/KB.*>.*KB/)
  })

  it('summary mentions rotate count', () => {
    writeFileSync(join(tmpDir, 'awaken.out.log'), 'x'.repeat(600))
    const plan = buildRotationPlan({ logDir: tmpDir, maxSizeBytes: 500 })
    expect(plan.summary).toContain('to rotate')
  })

  it('both out and err logs rotate independently', () => {
    const bigContent = 'x'.repeat(600)
    writeFileSync(join(tmpDir, 'awaken.out.log'), bigContent)
    writeFileSync(join(tmpDir, 'awaken.err.log'), bigContent)
    const plan = buildRotationPlan({ logDir: tmpDir, maxSizeBytes: 500 })
    const rotates = plan.actions.filter(a => a.kind === 'rotate')
    expect(rotates).toHaveLength(2)
  })
})

describe('buildRotationPlan — prune excess rotated copies', () => {
  beforeEach(() => { makeTmpDir() })

  it('no prune when rotated copies ≤ keepRotated', () => {
    writeFileSync(join(tmpDir, 'awaken.out.log'), '')
    writeFileSync(join(tmpDir, 'awaken.out.log.1'), '')
    writeFileSync(join(tmpDir, 'awaken.out.log.2'), '')
    const plan = buildRotationPlan({ logDir: tmpDir, keepRotated: 3 })
    const prunes = plan.actions.filter(a => a.kind === 'prune')
    expect(prunes).toHaveLength(0)
  })

  it('prune actions for copies exceeding keepRotated', () => {
    writeFileSync(join(tmpDir, 'awaken.out.log'), '')
    writeFileSync(join(tmpDir, 'awaken.out.log.1'), '')
    writeFileSync(join(tmpDir, 'awaken.out.log.2'), '')
    writeFileSync(join(tmpDir, 'awaken.out.log.3'), '')
    writeFileSync(join(tmpDir, 'awaken.out.log.4'), '')
    // keepRotated=2: copies .3 and .4 are excess (slice from index 2).
    const plan = buildRotationPlan({ logDir: tmpDir, keepRotated: 2 })
    const prunes = plan.actions.filter(a => a.kind === 'prune')
    expect(prunes).toHaveLength(2)
  })

  it('prune reason mentions keepRotated count', () => {
    writeFileSync(join(tmpDir, 'awaken.out.log'), '')
    writeFileSync(join(tmpDir, 'awaken.out.log.1'), '')
    writeFileSync(join(tmpDir, 'awaken.out.log.2'), '')
    writeFileSync(join(tmpDir, 'awaken.out.log.3'), '')
    const plan = buildRotationPlan({ logDir: tmpDir, keepRotated: 1 })
    const prune = plan.actions.find(a => a.kind === 'prune')!
    expect(prune.reason).toContain('1')
  })
})

describe('buildRotationPlan — watcher log deletion', () => {
  beforeEach(() => { makeTmpDir() })

  it('deletes stale watcher log older than watcherMaxAgeMs', () => {
    // Create a watcher log filename 10 days old.
    const old = new Date(Date.now() - 10 * 24 * 3600_000)
    const isoFull = old.toISOString()
    // Convert ISO to watcher format: 2026-04-29T23-26-13-746Z
    const watcherTs = isoFull
      .replace(/:/g, '-')
      .replace('.', '-')
      .replace('Z', 'Z')
    const filename = `awaken-watcher-${watcherTs}.log`
    writeFileSync(join(tmpDir, filename), '')

    const now = Date.now()
    const plan = buildRotationPlan({
      logDir: tmpDir,
      watcherMaxAgeMs: 7 * 24 * 3600_000,
    }, now)

    const deletes = plan.actions.filter(a => a.kind === 'delete')
    expect(deletes).toHaveLength(1)
    expect(deletes[0]!.path).toContain(filename)
    expect(deletes[0]!.reason).toContain('d old')
  })

  it('does not delete fresh watcher log within age threshold', () => {
    // Create a watcher log 1 hour old.
    const recent = new Date(Date.now() - 3600_000)
    const isoFull = recent.toISOString()
    const watcherTs = isoFull.replace(/:/g, '-').replace('.', '-')
    const filename = `awaken-watcher-${watcherTs}.log`
    writeFileSync(join(tmpDir, filename), '')

    const plan = buildRotationPlan({
      logDir: tmpDir,
      watcherMaxAgeMs: 7 * 24 * 3600_000,
    })

    const deletes = plan.actions.filter(a => a.kind === 'delete')
    expect(deletes).toHaveLength(0)
  })

  it('summary mentions delete count for stale watcher logs', () => {
    const old = new Date(Date.now() - 10 * 24 * 3600_000)
    const isoFull = old.toISOString()
    const watcherTs = isoFull.replace(/:/g, '-').replace('.', '-').replace('Z', 'Z')
    const filename = `awaken-watcher-${watcherTs}.log`
    writeFileSync(join(tmpDir, filename), '')

    const plan = buildRotationPlan({ logDir: tmpDir, watcherMaxAgeMs: 7 * 24 * 3600_000 })
    expect(plan.summary).toContain('delete')
  })
})

describe('buildRotationPlan — nothing to do', () => {
  it('returns "nothing to do" summary when all logs are fresh and small', () => {
    const dir = makeTmpDir()
    writeFileSync(join(dir, 'awaken.out.log'), 'small')
    const plan = buildRotationPlan({ logDir: dir, maxSizeBytes: 100 * 1024 })
    expect(plan.summary).toBe('nothing to do')
    expect(plan.actions).toHaveLength(0)
  })

  it('plan ts is a valid ISO string', () => {
    const dir = makeTmpDir()
    const plan = buildRotationPlan({ logDir: dir })
    expect(() => new Date(plan.ts)).not.toThrow()
    expect(plan.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
