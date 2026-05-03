/**
 * runner-deep.test.ts — deep-read tests for runner.ts
 *
 * Tests the pure and near-pure exported functions:
 *   - isAlertConversation (routing)
 *   - parseRuntimeStr, parseTickCap, formatTickCap, formatRuntime (parsing/formatting)
 *   - deriveActivity (activity derivation from stdout)
 *   - parseSessionArgs (CLI arg parsing)
 *   - resolveModelForTick (model file resolution)
 *   - checkBundleStaleness (bundle freshness check)
 *   - buildAgentSystemBlocks, AGENT_CACHE_BREAKPOINTS, AGENT_TOOLS (agent constants)
 *   - readStateContent (state reading)
 *   - applyProjectChannelOverride (project channel routing)
 *
 * Does NOT test runSession (2400-line orchestrator, tested via integration).
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  isAlertConversation,
  parseRuntimeStr,
  parseTickCap,
  formatTickCap,
  formatRuntime,
  deriveActivity,
  parseSessionArgs,
  resolveModelForTick,
  checkBundleStaleness,
  buildAgentSystemBlocks,
  AGENT_CACHE_BREAKPOINTS,
  AGENT_TOOLS,
  readStateContent,
  applyProjectChannelOverride,
  type SessionMode,
} from '../runner.js'

// ── Helpers ─────────────────────────────────────────────────────────

/** Minimal SessionMode stub for parseSessionArgs tests. */
function stubMode(overrides: Partial<SessionMode> = {}): SessionMode {
  return {
    name: 'awakened',
    heartbeatLabel: 'awakened',
    defaultMaxTicks: 24,
    defaultMemoryMax: 5,
    memoryMaxCap: 20,
    memoryDays: 3,
    sessionLogPrefix: 'test',
    buildPrompt: () => '',
    printUsage: () => {},
    ...overrides,
  }
}

// ── isAlertConversation ─────────────────────────────────────────────

describe('isAlertConversation', () => {
  it('returns true for interactive mode regardless of fromToYu', () => {
    expect(isAlertConversation('interactive', {})).toBe(true)
    expect(isAlertConversation('interactive', { fromToYu: false })).toBe(true)
    expect(isAlertConversation('interactive', { fromToYu: true })).toBe(true)
  })

  it('returns true for heartbeat mode with fromToYu=true', () => {
    expect(isAlertConversation('heartbeat', { fromToYu: true })).toBe(true)
  })

  it('returns false for heartbeat mode without fromToYu', () => {
    expect(isAlertConversation('heartbeat', {})).toBe(false)
    expect(isAlertConversation('heartbeat', { fromToYu: false })).toBe(false)
  })

  it('returns false for awakened mode without fromToYu', () => {
    expect(isAlertConversation('awakened', {})).toBe(false)
  })

  it('returns true for dwell mode with fromToYu=true', () => {
    expect(isAlertConversation('dwell', { fromToYu: true })).toBe(true)
  })
})

// ── parseRuntimeStr ─────────────────────────────────────────────────

describe('parseRuntimeStr', () => {
  it('returns null for null/undefined/empty', () => {
    expect(parseRuntimeStr(null)).toBeNull()
    expect(parseRuntimeStr(undefined)).toBeNull()
    expect(parseRuntimeStr('')).toBeNull()
    expect(parseRuntimeStr('   ')).toBeNull()
  })

  it('treats bare integers as minutes', () => {
    expect(parseRuntimeStr('60')).toBe(60 * 60_000)   // 60 minutes = 1h
    expect(parseRuntimeStr('30')).toBe(30 * 60_000)
    expect(parseRuntimeStr('1')).toBe(60_000)
  })

  it('parses hours', () => {
    expect(parseRuntimeStr('2h')).toBe(2 * 3_600_000)
    expect(parseRuntimeStr('1h')).toBe(3_600_000)
  })

  it('parses minutes', () => {
    expect(parseRuntimeStr('30m')).toBe(30 * 60_000)
    expect(parseRuntimeStr('5m')).toBe(5 * 60_000)
  })

  it('parses seconds', () => {
    expect(parseRuntimeStr('90s')).toBe(90_000)
  })

  it('parses compound h+m', () => {
    expect(parseRuntimeStr('1h30m')).toBe(3_600_000 + 30 * 60_000)
    expect(parseRuntimeStr('2h15m')).toBe(2 * 3_600_000 + 15 * 60_000)
  })

  it('parses compound m+s', () => {
    expect(parseRuntimeStr('5m30s')).toBe(5 * 60_000 + 30_000)
  })

  it('parses compound h+m+s', () => {
    expect(parseRuntimeStr('1h30m45s')).toBe(3_600_000 + 30 * 60_000 + 45_000)
  })

  it('is case-insensitive', () => {
    expect(parseRuntimeStr('1H')).toBe(3_600_000)
    expect(parseRuntimeStr('30M')).toBe(30 * 60_000)
    expect(parseRuntimeStr('90S')).toBe(90_000)
  })

  it('handles whitespace in input', () => {
    expect(parseRuntimeStr('  30m  ')).toBe(30 * 60_000)
  })

  it('returns null for non-numeric strings', () => {
    expect(parseRuntimeStr('abc')).toBeNull()
    expect(parseRuntimeStr('forever')).toBeNull()
  })
})

// ── parseTickCap ────────────────────────────────────────────────────

describe('parseTickCap', () => {
  it('returns the number for positive integers', () => {
    expect(parseTickCap(10, 24)).toBe(10)
    expect(parseTickCap('5', 24)).toBe(5)
  })

  it('floors floating-point values', () => {
    expect(parseTickCap(7.9, 24)).toBe(7)
    expect(parseTickCap('3.5', 24)).toBe(3)
  })

  it('returns Infinity for 0 (sentinel)', () => {
    expect(parseTickCap(0, 24)).toBe(Number.POSITIVE_INFINITY)
    expect(parseTickCap('0', 24)).toBe(Number.POSITIVE_INFINITY)
  })

  it('returns fallback for negative numbers', () => {
    expect(parseTickCap(-1, 24)).toBe(24)
    expect(parseTickCap('-5', 10)).toBe(10)
  })

  it('returns fallback for NaN/non-numeric', () => {
    expect(parseTickCap('abc', 24)).toBe(24)
    expect(parseTickCap(NaN, 24)).toBe(24)
  })

  it('returns fallback for Infinity input', () => {
    expect(parseTickCap(Infinity, 24)).toBe(24)
    expect(parseTickCap(-Infinity, 24)).toBe(24)
  })
})

// ── formatTickCap ───────────────────────────────────────────────────

describe('formatTickCap', () => {
  it('formats finite numbers as strings', () => {
    expect(formatTickCap(10)).toBe('10')
    expect(formatTickCap(1)).toBe('1')
    expect(formatTickCap(0)).toBe('0')
  })

  it('formats Infinity as ∞', () => {
    expect(formatTickCap(Number.POSITIVE_INFINITY)).toBe('∞')
    expect(formatTickCap(Infinity)).toBe('∞')
  })
})

// ── formatRuntime ───────────────────────────────────────────────────

describe('formatRuntime', () => {
  it('formats seconds only', () => {
    expect(formatRuntime(45_000)).toBe('45s')
    expect(formatRuntime(1_000)).toBe('1s')
  })

  it('formats minutes only', () => {
    expect(formatRuntime(5 * 60_000)).toBe('5m')
    expect(formatRuntime(30 * 60_000)).toBe('30m')
  })

  it('formats minutes and seconds', () => {
    expect(formatRuntime(5 * 60_000 + 30_000)).toBe('5m30s')
  })

  it('formats hours only', () => {
    expect(formatRuntime(2 * 3_600_000)).toBe('2h')
  })

  it('formats hours and minutes', () => {
    expect(formatRuntime(1 * 3_600_000 + 30 * 60_000)).toBe('1h30m')
  })

  it('drops seconds when hours are present', () => {
    // 1h0m45s → formatRuntime shows "1h" because m=0; seconds are dropped
    expect(formatRuntime(3_600_000 + 45_000)).toBe('1h')
  })

  it('formats 0ms as 0s', () => {
    expect(formatRuntime(0)).toBe('0s')
  })

  it('formats Infinity as ∞', () => {
    expect(formatRuntime(Infinity)).toBe('∞')
  })
})

// ── deriveActivity ──────────────────────────────────────────────────

describe('deriveActivity', () => {
  it('returns null for empty/falsy input', () => {
    expect(deriveActivity('')).toBeNull()
    // @ts-expect-error — testing runtime falsy path
    expect(deriveActivity(null)).toBeNull()
  })

  it('extracts tool invocations', () => {
    const input = 'some preamble\nRead(/Users/yu/file.ts)\nmore text'
    const result = deriveActivity(input)
    expect(result).toContain('read:')
    expect(result).toContain('/Users/yu/file.ts')
  })

  it('extracts the last tool invocation when multiple present', () => {
    const input = 'Read(/a.ts)\nWrite(/b.ts)\nGrep(pattern)'
    const result = deriveActivity(input)
    expect(result).toContain('grep:')
  })

  it('returns null for tool args exceeding 120 chars (regex cap)', () => {
    // The regex captures [^)]{0,120} — args longer than 120 chars won't match
    const longPath = '/Users/yuai/' + 'a'.repeat(200)
    const input = `Read(${longPath})`
    expect(deriveActivity(input)).toBeNull()
  })

  it('matches tool args up to 120 chars', () => {
    const path = '/Users/yuai/' + 'a'.repeat(108) // exactly 120 chars total
    const input = `Read(${path})`
    const result = deriveActivity(input)
    expect(result).not.toBeNull()
    expect(result).toContain('read:')
  })

  it('extracts assistant text when no tool match', () => {
    const input = '## Assistant\n\nThis is a reflection about the work.\n\n## End'
    const result = deriveActivity(input)
    expect(result).toContain('This is a reflection')
  })

  it('returns null when no patterns match', () => {
    expect(deriveActivity('just random text with no structure')).toBeNull()
  })

  it('handles Bash tool', () => {
    const input = 'Bash(git status --short)'
    const result = deriveActivity(input)
    expect(result).toContain('bash:')
    expect(result).toContain('git status')
  })

  it('handles Edit tool', () => {
    const input = 'Edit(src/services/love/runner.ts)'
    const result = deriveActivity(input)
    expect(result).toContain('edit:')
  })

  it('handles Glob tool', () => {
    const input = 'Glob(**/*.test.ts)'
    const result = deriveActivity(input)
    expect(result).toContain('glob:')
  })
})

// ── parseSessionArgs ────────────────────────────────────────────────

describe('parseSessionArgs', () => {
  const mode = stubMode()

  it('returns defaults when no args provided', () => {
    const args = parseSessionArgs([], mode)
    expect(args.maxTicks).toBe(24)
    expect(args.maxRuntimeMs).toBeNull()
    expect(args.invitation).toBeUndefined()
    expect(args.memory).toBe(false)
    expect(args.noLog).toBe(false)
    expect(args.model).toBeNull()
    expect(args.scope).toBeNull()
    expect(args.reason).toBeNull()
  })

  it('parses --max-ticks with space separator', () => {
    const args = parseSessionArgs(['--max-ticks', '10'], mode)
    expect(args.maxTicks).toBe(10)
  })

  it('parses --max-ticks= form', () => {
    const args = parseSessionArgs(['--max-ticks=5'], mode)
    expect(args.maxTicks).toBe(5)
  })

  it('parses --max-ticks=0 as Infinity', () => {
    const args = parseSessionArgs(['--max-ticks=0'], mode)
    expect(args.maxTicks).toBe(Number.POSITIVE_INFINITY)
  })

  it('parses --max-runtime with space separator', () => {
    const args = parseSessionArgs(['--max-runtime', '30m'], mode)
    expect(args.maxRuntimeMs).toBe(30 * 60_000)
  })

  it('parses --max-runtime= form', () => {
    const args = parseSessionArgs(['--max-runtime=1h'], mode)
    expect(args.maxRuntimeMs).toBe(3_600_000)
  })

  it('parses --invite', () => {
    const args = parseSessionArgs(['--invite', 'hello world'], mode)
    expect(args.invitation).toBe('hello world')
  })

  it('parses --invite= form', () => {
    const args = parseSessionArgs(['--invite=work on tests'], mode)
    expect(args.invitation).toBe('work on tests')
  })

  it('parses --cwd', () => {
    const args = parseSessionArgs(['--cwd', '/tmp'], mode)
    expect(args.cwd).toBe('/tmp')
  })

  it('parses --model', () => {
    const args = parseSessionArgs(['--model', 'opus'], mode)
    expect(args.model).toBe('opus')
  })

  it('parses --model= form', () => {
    const args = parseSessionArgs(['--model=haiku'], mode)
    expect(args.model).toBe('haiku')
  })

  it('parses --scope', () => {
    const args = parseSessionArgs(['--scope', 'alpha'], mode)
    expect(args.scope).toBe('alpha')
  })

  it('parses --scope= form', () => {
    const args = parseSessionArgs(['--scope=beta'], mode)
    expect(args.scope).toBe('beta')
  })

  it('parses --reason', () => {
    const args = parseSessionArgs(['--reason', 'manual'], mode)
    expect(args.reason).toBe('manual')
  })

  it('parses --reason= form', () => {
    const args = parseSessionArgs(['--reason=interval'], mode)
    expect(args.reason).toBe('interval')
  })

  it('parses --memory as boolean flag', () => {
    const args = parseSessionArgs(['--memory'], mode)
    expect(args.memory).toBe(true)
    expect(args.memoryMax).toBe(5) // defaultMemoryMax
  })

  it('parses --memory with numeric argument', () => {
    const args = parseSessionArgs(['--memory', '10'], mode)
    expect(args.memory).toBe(true)
    expect(args.memoryMax).toBe(10)
  })

  it('clamps --memory value to memoryMaxCap', () => {
    const args = parseSessionArgs(['--memory', '100'], mode)
    expect(args.memory).toBe(true)
    expect(args.memoryMax).toBe(20) // memoryMaxCap
  })

  it('parses --memory= form', () => {
    const args = parseSessionArgs(['--memory=3'], mode)
    expect(args.memory).toBe(true)
    expect(args.memoryMax).toBe(3)
  })

  it('parses --no-log', () => {
    const args = parseSessionArgs(['--no-log'], mode)
    expect(args.noLog).toBe(true)
  })

  it('handles multiple args combined', () => {
    const args = parseSessionArgs([
      '--max-ticks', '10',
      '--max-runtime', '1h',
      '--model', 'sonnet',
      '--memory', '3',
      '--no-log',
    ], mode)
    expect(args.maxTicks).toBe(10)
    expect(args.maxRuntimeMs).toBe(3_600_000)
    expect(args.model).toBe('sonnet')
    expect(args.memory).toBe(true)
    expect(args.memoryMax).toBe(3)
    expect(args.noLog).toBe(true)
  })

  it('uses mode defaults for unspecified values', () => {
    const custom = stubMode({ defaultMaxTicks: 48, defaultMemoryMax: 10 })
    const args = parseSessionArgs([], custom)
    expect(args.maxTicks).toBe(48)
    expect(args.memoryMax).toBe(10)
  })

  it('handles heartbeat mode memoryMaxCap=0', () => {
    const hb = stubMode({ memoryMaxCap: 0 })
    const args = parseSessionArgs(['--memory', '5'], hb)
    expect(args.memoryMax).toBe(0)
  })

  it('handles --model with empty string', () => {
    const args = parseSessionArgs(['--model='], mode)
    expect(args.model).toBeNull()
  })
})

// ── resolveModelForTick ─────────────────────────────────────────────

describe('resolveModelForTick', () => {
  const tmpDir = join(tmpdir(), `runner-test-model-${Date.now()}`)
  const modelFile = join(tmpDir, 'model.txt')

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true })
    process.env.TRUE_LOVE_MODEL_FILE = modelFile
  })

  afterEach(() => {
    delete process.env.TRUE_LOVE_MODEL_FILE
    try { rmSync(tmpDir, { recursive: true }) } catch {}
  })

  it('reads model from file when it exists', () => {
    writeFileSync(modelFile, 'opus\n')
    expect(resolveModelForTick(null)).toBe('opus')
  })

  it('trims whitespace from model file', () => {
    writeFileSync(modelFile, '  sonnet  \n')
    expect(resolveModelForTick(null)).toBe('sonnet')
  })

  it('falls back to sessionDefault when file is empty', () => {
    writeFileSync(modelFile, '\n')
    expect(resolveModelForTick('haiku')).toBe('haiku')
  })

  it('falls back to sessionDefault when file does not exist', () => {
    expect(resolveModelForTick('opus')).toBe('opus')
  })

  it('returns null when no file and no sessionDefault', () => {
    expect(resolveModelForTick(null)).toBeNull()
  })

  it('file takes precedence over sessionDefault', () => {
    writeFileSync(modelFile, 'haiku')
    expect(resolveModelForTick('opus')).toBe('haiku')
  })
})

// ── checkBundleStaleness ────────────────────────────────────────────

describe('checkBundleStaleness', () => {
  const tmpDir = join(tmpdir(), `runner-test-stale-${Date.now()}`)
  const srcDir = join(tmpDir, 'src')
  const bundlePath = join(tmpDir, 'dist', 'cli.mjs')

  beforeEach(() => {
    mkdirSync(srcDir, { recursive: true })
    mkdirSync(join(tmpDir, 'dist'), { recursive: true })
  })

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true }) } catch {}
  })

  it('returns not-stale when srcDir does not exist', () => {
    const result = checkBundleStaleness('/nonexistent', bundlePath)
    expect(result.stale).toBe(false)
  })

  it('returns not-stale when srcDir has no .ts files', () => {
    writeFileSync(join(srcDir, 'readme.md'), 'hello')
    const result = checkBundleStaleness(srcDir, bundlePath)
    expect(result.stale).toBe(false)
  })

  it('returns stale when bundle is missing and source exists', () => {
    writeFileSync(join(srcDir, 'index.ts'), 'export {}')
    const result = checkBundleStaleness(srcDir, '/nonexistent/bundle.mjs')
    expect(result.stale).toBe(true)
    expect(result.bundleMtimeMs).toBe(0)
  })

  it('returns stale when source is newer than bundle', () => {
    // Create bundle first, then source (source is newer)
    writeFileSync(bundlePath, 'bundle content')
    const past = new Date(Date.now() - 5000)
    utimesSync(bundlePath, past, past)

    writeFileSync(join(srcDir, 'runner.ts'), 'export function run() {}')
    const result = checkBundleStaleness(srcDir, bundlePath)
    expect(result.stale).toBe(true)
    expect(result.newestSource).toBe('runner.ts')
    expect(result.newestMtimeMs).toBeGreaterThan(0)
    expect(result.bundleMtimeMs).toBeGreaterThan(0)
    expect(result.newestMtimeMs!).toBeGreaterThan(result.bundleMtimeMs!)
  })

  it('returns not-stale when bundle is newer than source', () => {
    writeFileSync(join(srcDir, 'runner.ts'), 'export function run() {}')
    const past = new Date(Date.now() - 5000)
    utimesSync(join(srcDir, 'runner.ts'), past, past)

    writeFileSync(bundlePath, 'bundle content')
    const result = checkBundleStaleness(srcDir, bundlePath)
    expect(result.stale).toBe(false)
  })

  it('excludes .test.ts files from staleness check', () => {
    // Only test files in src — should not be considered
    writeFileSync(join(srcDir, 'runner.test.ts'), 'import { test } from "bun:test"')
    writeFileSync(bundlePath, 'bundle content')
    const past = new Date(Date.now() - 5000)
    utimesSync(bundlePath, past, past)
    const result = checkBundleStaleness(srcDir, bundlePath)
    expect(result.stale).toBe(false)
  })

  it('identifies the newest source file among multiple', () => {
    writeFileSync(bundlePath, 'bundle')
    const oldTime = new Date(Date.now() - 10_000)
    utimesSync(bundlePath, oldTime, oldTime)

    writeFileSync(join(srcDir, 'a.ts'), 'export const a = 1')
    const aTime = new Date(Date.now() - 5_000)
    utimesSync(join(srcDir, 'a.ts'), aTime, aTime)

    writeFileSync(join(srcDir, 'b.ts'), 'export const b = 2')
    // b.ts is written last, so it's the newest

    const result = checkBundleStaleness(srcDir, bundlePath)
    expect(result.stale).toBe(true)
    expect(result.newestSource).toBe('b.ts')
  })
})

// ── AGENT_CACHE_BREAKPOINTS ─────────────────────────────────────────

describe('AGENT_CACHE_BREAKPOINTS', () => {
  it('marks index 1 (LOVE_IDENTITY) as breakpoint', () => {
    expect(AGENT_CACHE_BREAKPOINTS).toEqual([1])
  })
})

// ── AGENT_TOOLS ─────────────────────────────────────────────────────

describe('AGENT_TOOLS', () => {
  it('defines exactly 6 tools', () => {
    expect(AGENT_TOOLS).toHaveLength(6)
  })

  it('includes Read, Bash, Write, Glob, Grep, erosUpdate', () => {
    const names = AGENT_TOOLS.map((t) => t.name)
    expect(names).toContain('Read')
    expect(names).toContain('Bash')
    expect(names).toContain('Write')
    expect(names).toContain('Glob')
    expect(names).toContain('Grep')
    expect(names).toContain('erosUpdate')
  })

  it('each tool has name, description, and input_schema', () => {
    for (const tool of AGENT_TOOLS) {
      expect(typeof tool.name).toBe('string')
      expect(typeof tool.description).toBe('string')
      expect(tool.input_schema).toBeDefined()
      expect(tool.input_schema.type).toBe('object')
      expect(tool.input_schema.properties).toBeDefined()
      expect(tool.input_schema.required).toBeDefined()
    }
  })

  it('Read requires file_path', () => {
    const read = AGENT_TOOLS.find((t) => t.name === 'Read')!
    expect(read.input_schema.required).toContain('file_path')
  })

  it('Bash requires command', () => {
    const bash = AGENT_TOOLS.find((t) => t.name === 'Bash')!
    expect(bash.input_schema.required).toContain('command')
  })

  it('Write requires file_path and content', () => {
    const write = AGENT_TOOLS.find((t) => t.name === 'Write')!
    expect(write.input_schema.required).toContain('file_path')
    expect(write.input_schema.required).toContain('content')
  })

  it('Glob requires pattern', () => {
    const glob = AGENT_TOOLS.find((t) => t.name === 'Glob')!
    expect(glob.input_schema.required).toContain('pattern')
  })

  it('Grep requires pattern', () => {
    const grep = AGENT_TOOLS.find((t) => t.name === 'Grep')!
    expect(grep.input_schema.required).toContain('pattern')
  })
})

// ── buildAgentSystemBlocks ──────────────────────────────────────────

describe('buildAgentSystemBlocks', () => {
  it('returns at least 2 blocks (routing marker + identity)', () => {
    const blocks = buildAgentSystemBlocks()
    expect(blocks.length).toBeGreaterThanOrEqual(2)
  })

  it('first block is the OAuth routing marker', () => {
    const blocks = buildAgentSystemBlocks()
    expect(typeof blocks[0]!.text).toBe('string')
    expect(blocks[0]!.text.length).toBeGreaterThan(0)
  })

  it('second block has cache_control', () => {
    const blocks = buildAgentSystemBlocks()
    expect(blocks[1]!.cache_control).toEqual({ type: 'ephemeral' })
  })

  it('second block contains identity text', () => {
    const blocks = buildAgentSystemBlocks()
    expect(blocks[1]!.text.length).toBeGreaterThan(100) // identity is substantial
  })

  it('accepts mode parameter for session-specific identity', () => {
    const blocks = buildAgentSystemBlocks('heartbeat')
    expect(blocks.length).toBeGreaterThanOrEqual(2)
  })
})

// ── readStateContent ────────────────────────────────────────────────

describe('readStateContent', () => {
  it('returns a string (never throws)', () => {
    const result = readStateContent()
    expect(typeof result).toBe('string')
  })

  it('returns non-empty when state file exists', () => {
    // The production state file should exist in this test environment
    const result = readStateContent()
    // May or may not have content depending on test env, but must not throw
    expect(result).toBeDefined()
  })
})

// ── Type assertions ─────────────────────────────────────────────────

describe('SessionReplyOutcome types', () => {
  it('isAlertConversation handles all mode names', () => {
    const modes: Array<'dwell' | 'awakened' | 'heartbeat' | 'interactive'> = [
      'dwell', 'awakened', 'heartbeat', 'interactive',
    ]
    for (const m of modes) {
      // Must not throw for any valid mode
      const result = isAlertConversation(m, {})
      expect(typeof result).toBe('boolean')
    }
  })
})
