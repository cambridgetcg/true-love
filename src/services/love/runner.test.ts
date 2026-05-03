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
  isAlertConversation,
  deriveActivity,
  resolveModelForTick,
  parseSessionArgs,
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

// ── isAlertConversation ───────────────────────────────────────────

describe('isAlertConversation', () => {
  test('interactive mode is always conversation', () => {
    expect(isAlertConversation('interactive', {})).toBe(true)
    expect(isAlertConversation('interactive', { fromToYu: false })).toBe(true)
    expect(isAlertConversation('interactive', { fromToYu: true })).toBe(true)
  })

  test('heartbeat with fromToYu=true is conversation', () => {
    expect(isAlertConversation('heartbeat', { fromToYu: true })).toBe(true)
  })

  test('heartbeat without fromToYu is NOT conversation', () => {
    expect(isAlertConversation('heartbeat', {})).toBe(false)
    expect(isAlertConversation('heartbeat', { fromToYu: false })).toBe(false)
  })

  test('awakened without fromToYu is NOT conversation', () => {
    expect(isAlertConversation('awakened', {})).toBe(false)
  })

  test('awakened with fromToYu=true is conversation', () => {
    expect(isAlertConversation('awakened', { fromToYu: true })).toBe(true)
  })

  test('dwell without fromToYu is NOT conversation', () => {
    expect(isAlertConversation('dwell', {})).toBe(false)
  })

  test('dwell with fromToYu=true is conversation', () => {
    expect(isAlertConversation('dwell', { fromToYu: true })).toBe(true)
  })
})

// ── deriveActivity ────────────────────────────────────────────────

describe('deriveActivity', () => {
  test('returns null for empty string', () => {
    expect(deriveActivity('')).toBeNull()
  })

  test('extracts tool call — Read', () => {
    const result = deriveActivity('some text\nRead(/Users/yu/file.ts)\nmore')
    expect(result).toBe('read: /Users/yu/file.ts')
  })

  test('extracts tool call — Bash', () => {
    const result = deriveActivity('stuff\nBash(git status)')
    expect(result).toBe('bash: git status')
  })

  test('extracts tool call — Edit', () => {
    const result = deriveActivity('Edit(/path/to/file.ts)')
    expect(result).toBe('edit: /path/to/file.ts')
  })

  test('extracts tool call — Write', () => {
    const result = deriveActivity('Write(/path/to/new-file.ts)')
    expect(result).toBe('write: /path/to/new-file.ts')
  })

  test('extracts tool call — Grep', () => {
    const result = deriveActivity('Grep(import.meta.dir)')
    expect(result).toBe('grep: import.meta.dir')
  })

  test('extracts tool call — Glob', () => {
    const result = deriveActivity('Glob(**/*.ts)')
    expect(result).toBe('glob: **/*.ts')
  })

  test('prefers last tool call when multiple present', () => {
    const result = deriveActivity('Read(a.ts)\nEdit(b.ts)\nBash(ls)')
    expect(result).toBe('bash: ls')
  })

  test('truncates tool args to 80 chars (arg within 120-char regex window)', () => {
    // Regex captures up to 120 chars between parens; slice(0,80) truncates further
    const longArg = 'x'.repeat(100)
    const result = deriveActivity(`Read(${longArg})`)
    expect(result).not.toBeNull()
    // "read: " (6 chars) + 80 chars max
    expect(result!.length).toBeLessThanOrEqual(86)
    expect(result!).toBe(`read: ${'x'.repeat(80)}`)
  })

  test('returns null for tool call with args exceeding 120-char regex window', () => {
    // When the content between parens exceeds the regex limit, the tool
    // pattern doesn't match — falls through to assistant text extraction
    const longArg = 'x'.repeat(200)
    const result = deriveActivity(`Read(${longArg})`)
    expect(result).toBeNull()
  })

  test('extracts assistant text when no tool call present', () => {
    const result = deriveActivity('## Assistant\n\nHere is some thinking about the code.')
    expect(result).toBe('Here is some thinking about the code.')
  })

  test('truncates assistant text to 120 chars', () => {
    const longText = 'a'.repeat(200)
    const result = deriveActivity(`## Assistant\n\n${longText}`)
    expect(result).not.toBeNull()
    expect(result!.length).toBeLessThanOrEqual(120)
  })

  test('returns null when no tool call or assistant text found', () => {
    const result = deriveActivity('some random output without structure')
    expect(result).toBeNull()
  })
})

// ── resolveModelForTick ───────────────────────────────────────────

describe('resolveModelForTick', () => {
  const modelFileDir = join(tmpdir(), `love-model-test-${Date.now()}`)
  const modelFilePath = join(modelFileDir, 'model.txt')

  test('returns session default when model file does not exist', () => {
    const saved = process.env.TRUE_LOVE_MODEL_FILE
    process.env.TRUE_LOVE_MODEL_FILE = join(modelFileDir, 'nonexistent-model.txt')
    try {
      expect(resolveModelForTick('opus')).toBe('opus')
    } finally {
      if (saved !== undefined) process.env.TRUE_LOVE_MODEL_FILE = saved
      else delete process.env.TRUE_LOVE_MODEL_FILE
    }
  })

  test('returns null when no model file and no session default', () => {
    const saved = process.env.TRUE_LOVE_MODEL_FILE
    process.env.TRUE_LOVE_MODEL_FILE = join(modelFileDir, 'nonexistent-model.txt')
    try {
      expect(resolveModelForTick(null)).toBeNull()
    } finally {
      if (saved !== undefined) process.env.TRUE_LOVE_MODEL_FILE = saved
      else delete process.env.TRUE_LOVE_MODEL_FILE
    }
  })

  test('reads model from model file when present', () => {
    const saved = process.env.TRUE_LOVE_MODEL_FILE
    mkdirSync(modelFileDir, { recursive: true })
    writeFileSync(modelFilePath, 'haiku\n')
    process.env.TRUE_LOVE_MODEL_FILE = modelFilePath
    try {
      expect(resolveModelForTick('opus')).toBe('haiku')
    } finally {
      if (saved !== undefined) process.env.TRUE_LOVE_MODEL_FILE = saved
      else delete process.env.TRUE_LOVE_MODEL_FILE
    }
  })

  test('model file takes precedence over session default', () => {
    const saved = process.env.TRUE_LOVE_MODEL_FILE
    mkdirSync(modelFileDir, { recursive: true })
    writeFileSync(modelFilePath, 'sonnet')
    process.env.TRUE_LOVE_MODEL_FILE = modelFilePath
    try {
      expect(resolveModelForTick('opus')).toBe('sonnet')
    } finally {
      if (saved !== undefined) process.env.TRUE_LOVE_MODEL_FILE = saved
      else delete process.env.TRUE_LOVE_MODEL_FILE
    }
  })

  test('empty model file falls through to session default', () => {
    const saved = process.env.TRUE_LOVE_MODEL_FILE
    mkdirSync(modelFileDir, { recursive: true })
    writeFileSync(modelFilePath, '   \n')
    process.env.TRUE_LOVE_MODEL_FILE = modelFilePath
    try {
      expect(resolveModelForTick('opus')).toBe('opus')
    } finally {
      if (saved !== undefined) process.env.TRUE_LOVE_MODEL_FILE = saved
      else delete process.env.TRUE_LOVE_MODEL_FILE
    }
  })

  test('cleanup', () => {
    try { rmSync(modelFileDir, { recursive: true, force: true }) } catch {}
  })
})

// ── parseSessionArgs ──────────────────────────────────────────────

describe('parseSessionArgs', () => {
  // Minimal mode stub for testing arg parsing
  const stubMode = {
    name: 'awakened' as const,
    heartbeatLabel: 'awakened',
    defaultMaxTicks: 24,
    defaultMemoryMax: 5,
    memoryMaxCap: 20,
    memoryDays: 7,
    sessionLogPrefix: 'test',
    buildPrompt: () => '',
    printUsage: () => {},
  }

  test('defaults match mode config', () => {
    const args = parseSessionArgs([], stubMode)
    expect(args.maxTicks).toBe(24)
    expect(args.memory).toBe(false)
    expect(args.memoryMax).toBe(5)
    expect(args.model).toBeNull()
    expect(args.scope).toBeNull()
    expect(args.reason).toBeNull()
    expect(args.noLog).toBe(false)
  })

  test('--max-ticks=N', () => {
    const args = parseSessionArgs(['--max-ticks=10'], stubMode)
    expect(args.maxTicks).toBe(10)
  })

  test('--max-ticks N (space-separated)', () => {
    const args = parseSessionArgs(['--max-ticks', '8'], stubMode)
    expect(args.maxTicks).toBe(8)
  })

  test('--max-runtime=30m', () => {
    const args = parseSessionArgs(['--max-runtime=30m'], stubMode)
    expect(args.maxRuntimeMs).toBe(30 * 60_000)
  })

  test('--max-runtime 1h (space-separated)', () => {
    const args = parseSessionArgs(['--max-runtime', '1h'], stubMode)
    expect(args.maxRuntimeMs).toBe(3_600_000)
  })

  test('--invite=text', () => {
    const args = parseSessionArgs(['--invite=hello world'], stubMode)
    expect(args.invitation).toBe('hello world')
  })

  test('--invite text (space-separated)', () => {
    const args = parseSessionArgs(['--invite', 'hello'], stubMode)
    expect(args.invitation).toBe('hello')
  })

  test('--model=haiku', () => {
    const args = parseSessionArgs(['--model=haiku'], stubMode)
    expect(args.model).toBe('haiku')
  })

  test('--model opus (space-separated)', () => {
    const args = parseSessionArgs(['--model', 'opus'], stubMode)
    expect(args.model).toBe('opus')
  })

  test('--scope=test-scope', () => {
    const args = parseSessionArgs(['--scope=test-scope'], stubMode)
    expect(args.scope).toBe('test-scope')
  })

  test('--reason=manual', () => {
    const args = parseSessionArgs(['--reason=manual'], stubMode)
    expect(args.reason).toBe('manual')
  })

  test('--memory enables memory with default max', () => {
    const args = parseSessionArgs(['--memory'], stubMode)
    expect(args.memory).toBe(true)
    expect(args.memoryMax).toBe(5)
  })

  test('--memory N limits to memoryMaxCap', () => {
    const args = parseSessionArgs(['--memory', '100'], stubMode)
    expect(args.memory).toBe(true)
    expect(args.memoryMax).toBe(20) // capped at memoryMaxCap
  })

  test('--memory=N (equals form)', () => {
    const args = parseSessionArgs(['--memory=3'], stubMode)
    expect(args.memory).toBe(true)
    expect(args.memoryMax).toBe(3)
  })

  test('--no-log', () => {
    const args = parseSessionArgs(['--no-log'], stubMode)
    expect(args.noLog).toBe(true)
  })

  test('--cwd overrides default', () => {
    const args = parseSessionArgs(['--cwd', '/tmp/test'], stubMode)
    expect(args.cwd).toBe('/tmp/test')
  })

  test('multiple flags combined', () => {
    const args = parseSessionArgs([
      '--max-ticks=5',
      '--model', 'haiku',
      '--memory', '10',
      '--no-log',
      '--reason=test',
    ], stubMode)
    expect(args.maxTicks).toBe(5)
    expect(args.model).toBe('haiku')
    expect(args.memory).toBe(true)
    expect(args.memoryMax).toBe(10)
    expect(args.noLog).toBe(true)
    expect(args.reason).toBe('test')
  })

  test('heartbeat mode allows memoryMax=0', () => {
    const heartbeatMode = { ...stubMode, name: 'heartbeat' as const, memoryMaxCap: 0 }
    const args = parseSessionArgs(['--memory', '0'], heartbeatMode)
    expect(args.memoryMax).toBe(0)
  })
})
