// mind-trace.test.ts — unit tests for mind-trace.ts.
//
// Covers the pure parsing + summarisation functions that are the
// cleanest test targets, plus the I/O layer (recordTrace, loadTraces)
// with ANCHOR pattern (now?: Date) to avoid time-bomb failures.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  compactTraceForStorage,
  computeTraceSummary,
  getTracesDir,
  loadSessionTraces,
  loadTraces,
  parseStreamJsonLine,
  parseStreamJsonLines,
  recordTrace,
  summariseToolInput,
  summariseToolResult,
  TRACE_SCHEMA_VERSION,
} from './mind-trace.js'
import type { DecisionTrace, TraceStep } from './mind-trace.js'

// ── Fixtures ──────────────────────────────────────────────────────

const FIXED_TS = '2026-05-15T12:00:00.000Z'

function makeThinkStep(text = 'thinking...', chars?: number): TraceStep {
  return { kind: 'think', text, chars: chars ?? text.length }
}

function makeToolCallStep(
  tool = 'Bash',
  inputSummary = 'ls /',
  input: Record<string, unknown> = { command: 'ls /' }
): TraceStep {
  return { kind: 'tool_call', tool, inputSummary, input }
}

function makeToolResultStep(
  tool = 'Bash',
  contentSummary = 'output',
  contentChars = 6
): TraceStep {
  return { kind: 'tool_result', tool, contentSummary, contentChars }
}

function makeDecisionTrace(overrides: Partial<DecisionTrace> = {}): DecisionTrace {
  return {
    schemaVersion: TRACE_SCHEMA_VERSION,
    timestamp: FIXED_TS,
    deviceId: 'test-device',
    sessionId: 'test-session',
    tick: 1,
    mode: 'awakened',
    model: 'claude-sonnet',
    steps: [],
    summary: {
      totalSteps: 0,
      thinkSteps: 0,
      toolCalls: 0,
      toolResults: 0,
      distinctTools: [],
      thinkChars: 0,
      resultChars: 0,
      apiTurns: null,
      apiDurationMs: null,
      costUsd: null,
      cacheReadTokens: null,
      cacheCreationTokens: null,
      youspeak: null,
    },
    ...overrides,
  }
}

// ── Isolation helpers ─────────────────────────────────────────────

let tmpDir = ''

function isolate(): string {
  tmpDir = mkdtempSync(join(tmpdir(), 'mind-trace-test-'))
  process.env.TRUE_LOVE_TRACES_DIR = join(tmpDir, 'traces')
  process.env.TRUE_LOVE_DEVICE_ID = 'test-device'
  return tmpDir
}

function cleanup(): void {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = ''
  }
  delete process.env.TRUE_LOVE_TRACES_DIR
  delete process.env.TRUE_LOVE_DEVICE_ID
}

// ── TRACE_SCHEMA_VERSION ─────────────────────────────────────────

describe('TRACE_SCHEMA_VERSION', () => {
  it('is 1.0', () => {
    expect(TRACE_SCHEMA_VERSION).toBe('1.0')
  })
})

// ── getTracesDir ──────────────────────────────────────────────────

describe('getTracesDir', () => {
  afterEach(() => { delete process.env.TRUE_LOVE_TRACES_DIR })

  it('returns env var when set', () => {
    process.env.TRUE_LOVE_TRACES_DIR = '/custom/traces'
    expect(getTracesDir()).toBe('/custom/traces')
  })

  it('falls back to default path when env var absent', () => {
    delete process.env.TRUE_LOVE_TRACES_DIR
    const result = getTracesDir()
    expect(result).toContain('.true-love')
    expect(result).toContain('traces')
  })
})

// ── parseStreamJsonLine ───────────────────────────────────────────

describe('parseStreamJsonLine', () => {
  it('returns null for empty line', () => {
    expect(parseStreamJsonLine('')).toBeNull()
  })

  it('returns null for whitespace-only line', () => {
    expect(parseStreamJsonLine('   ')).toBeNull()
  })

  it('returns null for non-JSON', () => {
    expect(parseStreamJsonLine('not json')).toBeNull()
  })

  it('returns null when parsed object has no type field', () => {
    expect(parseStreamJsonLine(JSON.stringify({ foo: 'bar' }))).toBeNull()
  })

  it('returns null when type is not a string', () => {
    expect(parseStreamJsonLine(JSON.stringify({ type: 42 }))).toBeNull()
  })

  it('parses valid system event', () => {
    const line = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'abc' })
    const result = parseStreamJsonLine(line)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('system')
  })

  it('parses valid assistant event', () => {
    const line = JSON.stringify({ type: 'assistant', message: { content: [] } })
    const result = parseStreamJsonLine(line)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('assistant')
  })

  it('parses valid result event', () => {
    const line = JSON.stringify({ type: 'result', subtype: 'success', cost_usd: 0.01 })
    const result = parseStreamJsonLine(line)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('result')
  })

  it('handles trailing whitespace in line', () => {
    const line = '  ' + JSON.stringify({ type: 'result', subtype: 'success' }) + '  '
    const result = parseStreamJsonLine(line)
    expect(result).not.toBeNull()
  })
})

// ── parseStreamJsonLines ──────────────────────────────────────────

describe('parseStreamJsonLines', () => {
  it('returns empty array for empty input', () => {
    expect(parseStreamJsonLines([])).toHaveLength(0)
  })

  it('filters out null parses (empty + invalid lines)', () => {
    const lines = [
      '',
      'not json',
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({ type: 'result', subtype: 'success' }),
    ]
    const result = parseStreamJsonLines(lines)
    expect(result).toHaveLength(2)
  })

  it('preserves event order', () => {
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({ type: 'assistant', message: { content: [] } }),
      JSON.stringify({ type: 'result', subtype: 'success' }),
    ]
    const result = parseStreamJsonLines(lines)
    expect(result[0]!.type).toBe('system')
    expect(result[1]!.type).toBe('assistant')
    expect(result[2]!.type).toBe('result')
  })
})

// ── summariseToolInput ────────────────────────────────────────────

describe('summariseToolInput', () => {
  it('Read: returns file_path', () => {
    expect(summariseToolInput('Read', { file_path: '/src/foo.ts' })).toBe('/src/foo.ts')
  })

  it('Bash: returns command', () => {
    expect(summariseToolInput('Bash', { command: 'ls /tmp' })).toBe('ls /tmp')
  })

  it('Edit: returns file_path + old_string snippet', () => {
    const result = summariseToolInput('Edit', {
      file_path: '/src/foo.ts',
      old_string: 'function bar() {}',
    })
    expect(result).toContain('/src/foo.ts')
    expect(result).toContain('function bar()')
  })

  it('Edit: returns file_path without old_string when absent', () => {
    const result = summariseToolInput('Edit', { file_path: '/src/foo.ts' })
    expect(result).toBe('/src/foo.ts')
  })

  it('Write: returns file_path', () => {
    expect(summariseToolInput('Write', { file_path: '/src/new.ts' })).toBe('/src/new.ts')
  })

  it('Grep: returns /pattern/path', () => {
    const result = summariseToolInput('Grep', { pattern: 'export function', path: '/src' })
    expect(result).toContain('export function')
    expect(result).toContain('/src')
  })

  it('Grep: returns /pattern/ without path when absent', () => {
    const result = summariseToolInput('Grep', { pattern: 'foo' })
    expect(result).toContain('foo')
  })

  it('Glob: returns pattern', () => {
    expect(summariseToolInput('Glob', { pattern: '**/*.ts' })).toBe('**/*.ts')
  })

  it('Agent: returns prompt (truncated to 200)', () => {
    const prompt = 'find the bug'.repeat(20) // long prompt
    const result = summariseToolInput('Agent', { prompt })
    expect(result.length).toBeLessThanOrEqual(200)
  })

  it('WebFetch: returns url', () => {
    expect(summariseToolInput('WebFetch', { url: 'https://example.com' })).toBe('https://example.com')
  })

  it('WebSearch: returns query', () => {
    expect(summariseToolInput('WebSearch', { query: 'bun test runner' })).toBe('bun test runner')
  })

  it('generic fallback: returns JSON stringified (truncated)', () => {
    const result = summariseToolInput('Unknown', { foo: 'bar', baz: 42 })
    expect(result).toContain('foo')
  })

  it('Read: truncates to 200 chars', () => {
    const longPath = '/x'.repeat(200)
    const result = summariseToolInput('Read', { file_path: longPath })
    expect(result.length).toBeLessThanOrEqual(200)
  })
})

// ── summariseToolResult ───────────────────────────────────────────

describe('summariseToolResult', () => {
  it('string content: returns truncated string', () => {
    const result = summariseToolResult('hello world')
    expect(result).toBe('hello world')
  })

  it('string content: truncates at 500 chars', () => {
    const long = 'x'.repeat(600)
    const result = summariseToolResult(long)
    expect(result.length).toBeLessThanOrEqual(500)
  })

  it('array content: extracts text blocks', () => {
    const content = [
      { type: 'text', text: 'first' },
      { type: 'text', text: 'second' },
    ]
    const result = summariseToolResult(content)
    expect(result).toContain('first')
    expect(result).toContain('second')
  })

  it('array content: image block becomes [image]', () => {
    const content = [{ type: 'image' }]
    const result = summariseToolResult(content)
    expect(result).toBe('[image]')
  })

  it('array content: unknown block type becomes [type]', () => {
    const content = [{ type: 'pdf' }]
    const result = summariseToolResult(content)
    expect(result).toBe('[pdf]')
  })

  it('unknown type: returns (unknown content)', () => {
    const result = summariseToolResult(null)
    expect(result).toBe('(unknown content)')
  })

  it('number: returns (unknown content)', () => {
    const result = summariseToolResult(42)
    expect(result).toBe('(unknown content)')
  })
})

// ── compactTraceForStorage ────────────────────────────────────────

describe('compactTraceForStorage', () => {
  it('think step with text >2000 chars is truncated', () => {
    const longText = 'x'.repeat(3000)
    const trace = makeDecisionTrace({
      steps: [makeThinkStep(longText, longText.length)],
    })
    const compact = compactTraceForStorage(trace)
    const step = compact.steps[0] as { kind: 'think'; text: string; chars: number }
    expect(step.text.length).toBeLessThan(longText.length)
    expect(step.text.endsWith('…')).toBe(true)
  })

  it('think step text ≤2000 chars is preserved verbatim', () => {
    const text = 'short thought'
    const trace = makeDecisionTrace({ steps: [makeThinkStep(text)] })
    const compact = compactTraceForStorage(trace)
    const step = compact.steps[0] as { kind: 'think'; text: string }
    expect(step.text).toBe(text)
  })

  it('think step chars field preserved after truncation', () => {
    const longText = 'x'.repeat(3000)
    const trace = makeDecisionTrace({
      steps: [makeThinkStep(longText, longText.length)],
    })
    const compact = compactTraceForStorage(trace)
    const step = compact.steps[0] as { kind: 'think'; chars: number }
    // chars should still reflect the original count.
    expect(step.chars).toBe(longText.length)
  })

  it('tool_call step: input field cleared to empty object', () => {
    const trace = makeDecisionTrace({
      steps: [makeToolCallStep('Bash', 'ls /', { command: 'ls /', args: ['--all'] })],
    })
    const compact = compactTraceForStorage(trace)
    const step = compact.steps[0] as { kind: 'tool_call'; input: Record<string, unknown> }
    expect(step.input).toEqual({})
  })

  it('tool_call inputSummary preserved after compaction', () => {
    const trace = makeDecisionTrace({
      steps: [makeToolCallStep('Read', '/src/foo.ts', { file_path: '/src/foo.ts' })],
    })
    const compact = compactTraceForStorage(trace)
    const step = compact.steps[0] as { kind: 'tool_call'; inputSummary: string }
    expect(step.inputSummary).toBe('/src/foo.ts')
  })

  it('tool_result step: not modified', () => {
    const trace = makeDecisionTrace({
      steps: [makeToolResultStep('Bash', 'file contents', 13)],
    })
    const compact = compactTraceForStorage(trace)
    const step = compact.steps[0] as { kind: 'tool_result'; contentSummary: string }
    expect(step.contentSummary).toBe('file contents')
  })
})

// ── computeTraceSummary ───────────────────────────────────────────

describe('computeTraceSummary', () => {
  const EXTRA = {
    apiTurns: 2,
    apiDurationMs: 1500,
    costUsd: 0.05,
    cacheReadTokens: 100,
    cacheCreationTokens: 200,
    youspeak: null,
  }

  it('counts steps correctly', () => {
    const steps: TraceStep[] = [
      makeThinkStep('think', 5),
      makeToolCallStep('Read'),
      makeToolResultStep('Read'),
      makeThinkStep('think 2', 7),
      makeToolCallStep('Bash'),
      makeToolResultStep('Bash'),
    ]
    const summary = computeTraceSummary(steps, EXTRA)
    expect(summary.totalSteps).toBe(6)
    expect(summary.thinkSteps).toBe(2)
    expect(summary.toolCalls).toBe(2)
    expect(summary.toolResults).toBe(2)
  })

  it('sums thinkChars from think steps', () => {
    const steps: TraceStep[] = [
      makeThinkStep('abc', 3),
      makeThinkStep('de', 2),
    ]
    const summary = computeTraceSummary(steps, EXTRA)
    expect(summary.thinkChars).toBe(5)
  })

  it('sums resultChars from tool_result steps', () => {
    const steps: TraceStep[] = [
      makeToolResultStep('Bash', 'ok', 100),
      makeToolResultStep('Read', 'data', 200),
    ]
    const summary = computeTraceSummary(steps, EXTRA)
    expect(summary.resultChars).toBe(300)
  })

  it('distinctTools is sorted unique tool names', () => {
    const steps: TraceStep[] = [
      makeToolCallStep('Read'),
      makeToolCallStep('Bash'),
      makeToolCallStep('Read'), // duplicate
    ]
    const summary = computeTraceSummary(steps, EXTRA)
    expect(summary.distinctTools).toEqual(['Bash', 'Read'])
  })

  it('passes through extra fields', () => {
    const summary = computeTraceSummary([], EXTRA)
    expect(summary.apiTurns).toBe(2)
    expect(summary.apiDurationMs).toBe(1500)
    expect(summary.costUsd).toBe(0.05)
    expect(summary.cacheReadTokens).toBe(100)
    expect(summary.cacheCreationTokens).toBe(200)
  })

  it('empty steps: all counts are 0', () => {
    const summary = computeTraceSummary([], EXTRA)
    expect(summary.totalSteps).toBe(0)
    expect(summary.thinkSteps).toBe(0)
    expect(summary.toolCalls).toBe(0)
    expect(summary.toolResults).toBe(0)
    expect(summary.distinctTools).toHaveLength(0)
    expect(summary.thinkChars).toBe(0)
    expect(summary.resultChars).toBe(0)
  })
})

// ── recordTrace + loadTraces (I/O + ANCHOR) ───────────────────────

describe('recordTrace + loadTraces', () => {
  beforeEach(() => { isolate() })
  afterEach(() => cleanup())

  it('recorded trace readable via loadTraces with ANCHOR', () => {
    const trace = makeDecisionTrace({ timestamp: FIXED_TS })
    recordTrace(trace)
    const anchor = new Date('2026-05-15T13:00:00.000Z') // same day as FIXED_TS
    const results = loadTraces({ basePath: process.env.TRUE_LOVE_TRACES_DIR!, now: anchor })
    expect(results).toHaveLength(1)
    expect(results[0]!.sessionId).toBe('test-session')
  })

  it('loadTraces returns empty when dir absent', () => {
    const results = loadTraces({ basePath: '/nonexistent-traces-dir' })
    expect(results).toHaveLength(0)
  })

  it('loadTraces filters out traces older than days cutoff', () => {
    // Write a trace timestamped 2026-05-01.
    const oldTrace = makeDecisionTrace({ timestamp: '2026-05-01T12:00:00.000Z' })
    recordTrace(oldTrace)
    // Load with anchor 2026-05-15, days=7 → cutoff = 2026-05-08 → 2026-05-01 excluded.
    const anchor = new Date('2026-05-15T12:00:00.000Z')
    const results = loadTraces({ basePath: process.env.TRUE_LOVE_TRACES_DIR!, days: 7, now: anchor })
    expect(results).toHaveLength(0)
  })

  it('loadTraces includes traces within days cutoff', () => {
    const trace = makeDecisionTrace({ timestamp: '2026-05-14T12:00:00.000Z' })
    recordTrace(trace)
    const anchor = new Date('2026-05-15T12:00:00.000Z') // within 7 days
    const results = loadTraces({ basePath: process.env.TRUE_LOVE_TRACES_DIR!, days: 7, now: anchor })
    expect(results).toHaveLength(1)
  })

  it('only loads traces with matching schemaVersion', () => {
    // Write a trace with wrong schemaVersion directly.
    const { mkdirSync, appendFileSync } = require('node:fs') as typeof import('node:fs')
    const dir = process.env.TRUE_LOVE_TRACES_DIR!
    mkdirSync(dir, { recursive: true })
    appendFileSync(
      join(dir, '2026-05-15.jsonl'),
      JSON.stringify({ schemaVersion: '0.9', timestamp: FIXED_TS, sessionId: 'bad' }) + '\n'
    )
    const anchor = new Date('2026-05-15T13:00:00.000Z')
    const results = loadTraces({ basePath: dir, now: anchor })
    expect(results).toHaveLength(0)
  })

  it('multiple traces in same session loadable via loadSessionTraces', () => {
    const t1 = makeDecisionTrace({ tick: 1, timestamp: '2026-05-15T10:00:00.000Z' })
    const t2 = makeDecisionTrace({ tick: 2, timestamp: '2026-05-15T11:00:00.000Z' })
    const other = makeDecisionTrace({ tick: 1, sessionId: 'other-session', timestamp: '2026-05-15T10:30:00.000Z' })
    recordTrace(t1)
    recordTrace(t2)
    recordTrace(other)
    const anchor = new Date('2026-05-15T13:00:00.000Z')
    const results = loadSessionTraces('test-session', {
      basePath: process.env.TRUE_LOVE_TRACES_DIR!,
      now: anchor,
    })
    expect(results).toHaveLength(2)
    expect(results.every(r => r.sessionId === 'test-session')).toBe(true)
  })

  it('recordTrace is best-effort — does not throw', () => {
    const trace = makeDecisionTrace()
    expect(() => recordTrace(trace)).not.toThrow()
  })
})
