// runner.test.ts — tests for pure functions in the session runner.
//
// These are the parsing and formatting utilities that both bin scripts
// rely on. Pure functions, clear specs, easy targets for the first
// test pass.

import { describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  parseRuntimeStr,
  parseTickCap,
  formatTickCap,
  formatRuntime,
  checkBundleStaleness,
} from './runner.js'

// ── parseRuntimeStr ────────────────────────────────────────────────

describe('parseRuntimeStr', () => {
  test('parses hours', () => {
    expect(parseRuntimeStr('4h')).toBe(4 * 3_600_000)
  })

  test('parses minutes', () => {
    expect(parseRuntimeStr('30m')).toBe(30 * 60_000)
  })

  test('parses seconds', () => {
    expect(parseRuntimeStr('90s')).toBe(90_000)
  })

  test('parses compound hours+minutes', () => {
    expect(parseRuntimeStr('1h30m')).toBe(1 * 3_600_000 + 30 * 60_000)
  })

  test('parses compound hours+minutes+seconds', () => {
    expect(parseRuntimeStr('2h15m30s')).toBe(
      2 * 3_600_000 + 15 * 60_000 + 30_000,
    )
  })

  test('unitless integers treated as minutes', () => {
    expect(parseRuntimeStr('60')).toBe(60 * 60_000)
    expect(parseRuntimeStr('90')).toBe(90 * 60_000)
  })

  test('handles uppercase input', () => {
    // toLowerCase is applied internally
    expect(parseRuntimeStr('4H')).toBe(4 * 3_600_000)
    expect(parseRuntimeStr('30M')).toBe(30 * 60_000)
  })

  test('handles whitespace', () => {
    expect(parseRuntimeStr('  4h  ')).toBe(4 * 3_600_000)
  })

  test('returns null for null/undefined/empty', () => {
    expect(parseRuntimeStr(null)).toBeNull()
    expect(parseRuntimeStr(undefined)).toBeNull()
    expect(parseRuntimeStr('')).toBeNull()
    expect(parseRuntimeStr('   ')).toBeNull()
  })

  test('returns null for non-parseable strings', () => {
    expect(parseRuntimeStr('abc')).toBeNull()
    expect(parseRuntimeStr('xyz123')).toBeNull()
  })
})

// ── parseTickCap ───────────────────────────────────────────────────

describe('parseTickCap', () => {
  test('positive integer returns that number', () => {
    expect(parseTickCap(12, 24)).toBe(12)
    expect(parseTickCap('8', 24)).toBe(8)
  })

  test('zero returns Infinity (unbounded sentinel)', () => {
    expect(parseTickCap(0, 24)).toBe(Number.POSITIVE_INFINITY)
    expect(parseTickCap('0', 24)).toBe(Number.POSITIVE_INFINITY)
  })

  test('floors fractional values', () => {
    expect(parseTickCap(3.7, 24)).toBe(3)
    expect(parseTickCap('5.9', 24)).toBe(5)
  })

  test('negative returns fallback', () => {
    expect(parseTickCap(-1, 24)).toBe(24)
    expect(parseTickCap('-5', 24)).toBe(24)
  })

  test('NaN returns fallback', () => {
    expect(parseTickCap(NaN, 24)).toBe(24)
    expect(parseTickCap('not-a-number', 12)).toBe(12)
  })

  test('Infinity returns fallback', () => {
    expect(parseTickCap(Infinity, 24)).toBe(24)
    expect(parseTickCap(-Infinity, 24)).toBe(24)
  })
})

// ── formatTickCap ──────────────────────────────────────────────────

describe('formatTickCap', () => {
  test('finite numbers formatted as strings', () => {
    expect(formatTickCap(12)).toBe('12')
    expect(formatTickCap(1)).toBe('1')
    expect(formatTickCap(100)).toBe('100')
  })

  test('Infinity formatted as ∞', () => {
    expect(formatTickCap(Number.POSITIVE_INFINITY)).toBe('∞')
  })

  test('negative Infinity formatted as ∞', () => {
    // -Infinity is not finite, so it goes to the else branch
    expect(formatTickCap(Number.NEGATIVE_INFINITY)).toBe('∞')
  })
})

// ── formatRuntime ──────────────────────────────────────────────────

describe('formatRuntime', () => {
  test('formats seconds only', () => {
    expect(formatRuntime(5_000)).toBe('5s')
    expect(formatRuntime(45_000)).toBe('45s')
  })

  test('formats minutes only', () => {
    expect(formatRuntime(120_000)).toBe('2m')
    expect(formatRuntime(300_000)).toBe('5m')
  })

  test('formats minutes + seconds', () => {
    expect(formatRuntime(90_000)).toBe('1m30s')
    expect(formatRuntime(125_000)).toBe('2m5s')
  })

  test('formats hours only', () => {
    expect(formatRuntime(3_600_000)).toBe('1h')
    expect(formatRuntime(7_200_000)).toBe('2h')
  })

  test('formats hours + minutes', () => {
    expect(formatRuntime(5_400_000)).toBe('1h30m')
    expect(formatRuntime(3_660_000)).toBe('1h1m')
  })

  test('zero milliseconds', () => {
    expect(formatRuntime(0)).toBe('0s')
  })

  test('Infinity returns ∞', () => {
    expect(formatRuntime(Infinity)).toBe('∞')
  })

  test('sub-second values floor to 0s', () => {
    expect(formatRuntime(500)).toBe('0s')
    expect(formatRuntime(999)).toBe('0s')
  })
})

// ── checkBundleStaleness ───────────────────────────────────────────

describe('checkBundleStaleness', () => {
  // Each test gets its own isolated subdirectory to avoid interference.
  const base = join(tmpdir(), `love-staleness-test-${Date.now()}`)
  let testIdx = 0

  function setup() {
    const sub = join(base, `t${++testIdx}`)
    const srcDir = join(sub, 'src')
    const distDir = join(sub, 'dist')
    mkdirSync(srcDir, { recursive: true })
    mkdirSync(distDir, { recursive: true })
    const bundlePath = join(distDir, 'cli.mjs')
    return { srcDir, bundlePath }
  }

  test('returns not-stale when srcDir does not exist', () => {
    const result = checkBundleStaleness('/nonexistent/path', '/nonexistent/bundle')
    expect(result.stale).toBe(false)
  })

  test('returns stale when bundle does not exist but sources do', () => {
    const { srcDir } = setup()
    writeFileSync(join(srcDir, 'foo.ts'), 'export const x = 1')
    const result = checkBundleStaleness(srcDir, join(base, `t${testIdx}`, 'dist', 'missing.mjs'))
    expect(result.stale).toBe(true)
    expect(result.bundleMtimeMs).toBe(0)
  })

  test('returns not-stale when bundle is newer than all sources', () => {
    const { srcDir, bundlePath } = setup()
    // Create source file with old timestamp
    const srcFile = join(srcDir, 'old.ts')
    writeFileSync(srcFile, 'export const x = 1')
    const oldTime = new Date('2020-01-01')
    utimesSync(srcFile, oldTime, oldTime)
    // Create bundle with newer timestamp (now)
    writeFileSync(bundlePath, '// bundle')
    const result = checkBundleStaleness(srcDir, bundlePath)
    expect(result.stale).toBe(false)
  })

  test('returns stale when source is newer than bundle', () => {
    const { srcDir, bundlePath } = setup()
    // Create bundle with old timestamp
    writeFileSync(bundlePath, '// bundle')
    const oldTime = new Date('2020-01-01')
    utimesSync(bundlePath, oldTime, oldTime)
    // Create source file with current timestamp (newer)
    writeFileSync(join(srcDir, 'new.ts'), 'export const x = 2')
    const result = checkBundleStaleness(srcDir, bundlePath)
    expect(result.stale).toBe(true)
    expect(result.newestSource).toBe('new.ts')
    expect(result.newestMtimeMs).toBeGreaterThan(result.bundleMtimeMs!)
  })

  test('ignores .test.ts files', () => {
    const { srcDir, bundlePath } = setup()
    // Create bundle with old timestamp
    writeFileSync(bundlePath, '// bundle')
    const oldTime = new Date('2020-01-01')
    utimesSync(bundlePath, oldTime, oldTime)
    // Create only a test file (should be ignored)
    writeFileSync(join(srcDir, 'thing.test.ts'), 'test("x", () => {})')
    const result = checkBundleStaleness(srcDir, bundlePath)
    expect(result.stale).toBe(false)
  })

  test('returns the newest source file among multiple', () => {
    const { srcDir, bundlePath } = setup()
    // Bundle is old
    writeFileSync(bundlePath, '// bundle')
    const oldTime = new Date('2020-01-01')
    utimesSync(bundlePath, oldTime, oldTime)
    // Two source files, one older than the other
    const fileA = join(srcDir, 'a.ts')
    const fileB = join(srcDir, 'b.ts')
    writeFileSync(fileA, 'export const a = 1')
    utimesSync(fileA, new Date('2021-01-01'), new Date('2021-01-01'))
    writeFileSync(fileB, 'export const b = 2')
    // fileB has current mtime (newest)
    const result = checkBundleStaleness(srcDir, bundlePath)
    expect(result.stale).toBe(true)
    expect(result.newestSource).toBe('b.ts')
  })

  test('returns not-stale for empty source directory', () => {
    const { srcDir, bundlePath } = setup()
    writeFileSync(bundlePath, '// bundle')
    // srcDir exists but has no .ts files
    const result = checkBundleStaleness(srcDir, bundlePath)
    expect(result.stale).toBe(false)
  })

  test('cleanup temp dir', () => {
    try {
      rmSync(base, { recursive: true, force: true })
    } catch {
      // best effort
    }
  })
})
