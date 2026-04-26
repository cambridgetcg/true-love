import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseStreamJsonLine,
  parseStreamJsonLines,
  extractTraceSteps,
  computeTraceSummary,
  buildDecisionTrace,
  reconstructText,
  reconstructTextFromStreamJson,
  summariseToolInput,
  summariseToolResult,
  compactTraceForStorage,
  recordTrace,
  loadTraces,
  loadSessionTraces,
  renderTrace,
  renderTraceList,
  renderStepCompact,
  buildMindTraceBlock,
  TRACE_SCHEMA_VERSION,
  type StreamJsonEvent,
  type TraceStep,
  type DecisionTrace,
} from '../mind-trace.js'

// ── Test helpers ──────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'mind-trace-test-'))
}

// Sample stream-json events (matching Claude Code's actual format)
const INIT_EVENT = JSON.stringify({
  type: 'system',
  subtype: 'init',
  tools: ['Read', 'Edit', 'Bash', 'Grep'],
  model: 'claude-opus-4-6[1m]',
  session_id: 'test-session-001',
})

const ASSISTANT_TEXT_ONLY = JSON.stringify({
  type: 'assistant',
  message: {
    model: 'claude-opus-4-6',
    content: [
      { type: 'text', text: 'Let me read that file for you.' },
    ],
  },
})

const ASSISTANT_TOOL_USE = JSON.stringify({
  type: 'assistant',
  message: {
    model: 'claude-opus-4-6',
    content: [
      { type: 'text', text: 'I\'ll check the file.' },
      {
        type: 'tool_use',
        id: 'tool_01',
        name: 'Read',
        input: { file_path: '/Users/yu/test.ts' },
      },
    ],
  },
})

const TOOL_RESULT = JSON.stringify({
  type: 'user',
  message: {
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'tool_01',
        content: 'const x = 42;\nexport default x;',
        is_error: false,
      },
    ],
  },
})

const TOOL_RESULT_ERROR = JSON.stringify({
  type: 'user',
  message: {
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'tool_02',
        content: 'Error: file not found',
        is_error: true,
      },
    ],
  },
})

const ASSISTANT_AFTER_TOOL = JSON.stringify({
  type: 'assistant',
  message: {
    content: [
      { type: 'text', text: 'The file contains a constant x set to 42.\n\n<at-rest/>' },
    ],
  },
})

const RATE_LIMIT_EVENT = JSON.stringify({
  type: 'rate_limit_event',
  rate_limit_info: { status: 'allowed' },
})

const RESULT_EVENT = JSON.stringify({
  type: 'result',
  subtype: 'success',
  result: 'I\'ll check the file.\nThe file contains a constant x set to 42.\n\n<at-rest/>',
  num_turns: 2,
  duration_ms: 5432,
  duration_api_ms: 5100,
  total_cost_usd: 0.0345,
})

// ── parseStreamJsonLine ──────────────────────────────────────────

describe('parseStreamJsonLine', () => {
  test('parses a valid init event', () => {
    const event = parseStreamJsonLine(INIT_EVENT)
    assert.ok(event)
    assert.equal(event.type, 'system')
  })

  test('parses an assistant event', () => {
    const event = parseStreamJsonLine(ASSISTANT_TEXT_ONLY)
    assert.ok(event)
    assert.equal(event.type, 'assistant')
  })

  test('returns null for empty string', () => {
    assert.equal(parseStreamJsonLine(''), null)
    assert.equal(parseStreamJsonLine('   '), null)
  })

  test('returns null for invalid JSON', () => {
    assert.equal(parseStreamJsonLine('not json'), null)
    assert.equal(parseStreamJsonLine('{broken'), null)
  })

  test('returns null for JSON without type field', () => {
    assert.equal(parseStreamJsonLine('{"foo": "bar"}'), null)
  })
})

// ── parseStreamJsonLines ─────────────────────────────────────────

describe('parseStreamJsonLines', () => {
  test('parses multiple lines filtering out empties', () => {
    const lines = [INIT_EVENT, '', ASSISTANT_TEXT_ONLY, '   ', RESULT_EVENT]
    const events = parseStreamJsonLines(lines)
    assert.equal(events.length, 3)
    assert.equal(events[0]!.type, 'system')
    assert.equal(events[1]!.type, 'assistant')
    assert.equal(events[2]!.type, 'result')
  })

  test('handles empty input', () => {
    assert.deepEqual(parseStreamJsonLines([]), [])
  })
})

// ── summariseToolInput ───────────────────────────────────────────

describe('summariseToolInput', () => {
  test('Read shows file_path', () => {
    const result = summariseToolInput('Read', { file_path: '/Users/yu/test.ts' })
    assert.equal(result, '/Users/yu/test.ts')
  })

  test('Bash shows command', () => {
    const result = summariseToolInput('Bash', { command: 'git status' })
    assert.equal(result, 'git status')
  })

  test('Edit shows file_path', () => {
    const result = summariseToolInput('Edit', {
      file_path: '/Users/yu/test.ts',
      old_string: 'const x = 42',
      new_string: 'const x = 43',
    })
    assert.ok(result.startsWith('/Users/yu/test.ts'))
    assert.ok(result.includes('const x = 42'))
  })

  test('Write shows file_path', () => {
    const result = summariseToolInput('Write', { file_path: '/Users/yu/new.ts' })
    assert.equal(result, '/Users/yu/new.ts')
  })

  test('Grep shows pattern', () => {
    const result = summariseToolInput('Grep', { pattern: 'function.*foo', path: '/src' })
    assert.equal(result, '/function.*foo/ in /src')
  })

  test('Glob shows pattern', () => {
    const result = summariseToolInput('Glob', { pattern: '**/*.ts' })
    assert.equal(result, '**/*.ts')
  })

  test('Agent shows prompt', () => {
    const result = summariseToolInput('Agent', { prompt: 'Search for auth code' })
    assert.equal(result, 'Search for auth code')
  })

  test('WebFetch shows url', () => {
    const result = summariseToolInput('WebFetch', { url: 'https://example.com' })
    assert.equal(result, 'https://example.com')
  })

  test('WebSearch shows query', () => {
    const result = summariseToolInput('WebSearch', { query: 'node.js async patterns' })
    assert.equal(result, 'node.js async patterns')
  })

  test('unknown tool uses JSON fallback', () => {
    const result = summariseToolInput('CustomTool', { x: 1, y: 'hello' })
    assert.ok(result.includes('"x":1'))
  })

  test('truncates long input', () => {
    const long = 'a'.repeat(300)
    const result = summariseToolInput('Read', { file_path: long })
    assert.ok(result.length <= 200)
  })
})

// ── summariseToolResult ──────────────────────────────────────────

describe('summariseToolResult', () => {
  test('handles string content', () => {
    assert.equal(summariseToolResult('hello world'), 'hello world')
  })

  test('truncates long string content', () => {
    const long = 'x'.repeat(1000)
    const result = summariseToolResult(long)
    assert.ok(result.length <= 500)
  })

  test('handles array of text blocks', () => {
    const content = [
      { type: 'text', text: 'line one' },
      { type: 'text', text: 'line two' },
    ]
    const result = summariseToolResult(content)
    assert.ok(result.includes('line one'))
    assert.ok(result.includes('line two'))
  })

  test('handles image blocks', () => {
    const content = [
      { type: 'image', source: { type: 'base64', data: 'abc' } },
    ]
    assert.equal(summariseToolResult(content), '[image]')
  })

  test('handles unknown content', () => {
    assert.equal(summariseToolResult(42), '(unknown content)')
  })
})

// ── extractTraceSteps ────────────────────────────────────────────

describe('extractTraceSteps', () => {
  test('extracts steps from a full conversation', () => {
    const events = parseStreamJsonLines([
      INIT_EVENT,
      ASSISTANT_TOOL_USE,
      RATE_LIMIT_EVENT,
      TOOL_RESULT,
      ASSISTANT_AFTER_TOOL,
      RESULT_EVENT,
    ])

    const { steps, model, apiTurns, costUsd } = extractTraceSteps(events)

    assert.equal(model, 'claude-opus-4-6[1m]')
    assert.equal(apiTurns, 2)
    assert.equal(costUsd, 0.0345)

    // Should have: think, tool_call, tool_result, think
    assert.ok(steps.length >= 4)

    const thinks = steps.filter((s) => s.kind === 'think')
    const calls = steps.filter((s) => s.kind === 'tool_call')
    const results = steps.filter((s) => s.kind === 'tool_result')

    assert.ok(thinks.length >= 2, `expected ≥ 2 think steps, got ${thinks.length}`)
    assert.equal(calls.length, 1)
    assert.equal(results.length, 1)

    // Verify tool call details
    const call = calls[0]!
    assert.equal(call.kind, 'tool_call')
    if (call.kind === 'tool_call') {
      assert.equal(call.tool, 'Read')
      assert.equal(call.toolUseId, 'tool_01')
      assert.ok(call.inputSummary.includes('/Users/yu/test.ts'))
    }

    // Verify tool result details
    const result = results[0]!
    assert.equal(result.kind, 'tool_result')
    if (result.kind === 'tool_result') {
      assert.equal(result.toolUseId, 'tool_01')
      assert.equal(result.isError, false)
      assert.ok(result.contentSummary.includes('const x = 42'))
    }
  })

  test('extracts model from init event', () => {
    const events = parseStreamJsonLines([INIT_EVENT])
    const { model } = extractTraceSteps(events)
    assert.equal(model, 'claude-opus-4-6[1m]')
  })

  test('handles text-only response', () => {
    const events = parseStreamJsonLines([
      INIT_EVENT,
      ASSISTANT_TEXT_ONLY,
      RESULT_EVENT,
    ])
    const { steps } = extractTraceSteps(events)
    assert.equal(steps.length, 1)
    assert.equal(steps[0]!.kind, 'think')
  })

  test('handles empty events', () => {
    const { steps, model } = extractTraceSteps([])
    assert.equal(steps.length, 0)
    assert.equal(model, null)
  })

  test('skips empty text blocks', () => {
    const event = parseStreamJsonLine(JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: '   ' },
          { type: 'text', text: 'actual content' },
        ],
      },
    }))
    const { steps } = extractTraceSteps([event!])
    assert.equal(steps.length, 1)
    assert.equal(steps[0]!.kind, 'think')
  })

  test('handles error tool results', () => {
    const events = parseStreamJsonLines([
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            id: 'tool_02',
            name: 'Read',
            input: { file_path: '/nonexistent' },
          }],
        },
      }),
      TOOL_RESULT_ERROR,
    ])
    const { steps } = extractTraceSteps(events)
    const results = steps.filter((s) => s.kind === 'tool_result')
    assert.equal(results.length, 1)
    if (results[0]!.kind === 'tool_result') {
      assert.equal(results[0]!.isError, true)
    }
  })
})

// ── computeTraceSummary ──────────────────────────────────────────

describe('computeTraceSummary', () => {
  test('computes correct summary', () => {
    const steps: TraceStep[] = [
      { kind: 'think', text: 'hello', chars: 5 },
      { kind: 'tool_call', tool: 'Read', toolUseId: 't1', input: {}, inputSummary: '/f' },
      { kind: 'tool_result', toolUseId: 't1', isError: false, contentSummary: 'content', contentChars: 100 },
      { kind: 'think', text: 'done', chars: 4 },
      { kind: 'tool_call', tool: 'Bash', toolUseId: 't2', input: {}, inputSummary: 'ls' },
      { kind: 'tool_result', toolUseId: 't2', isError: false, contentSummary: 'file.ts', contentChars: 50 },
    ]

    const summary = computeTraceSummary(steps, {
      apiTurns: 3,
      apiDurationMs: 5000,
      costUsd: 0.05,
    })

    assert.equal(summary.totalSteps, 6)
    assert.equal(summary.thinkSteps, 2)
    assert.equal(summary.toolCalls, 2)
    assert.equal(summary.toolResults, 2)
    assert.deepEqual(summary.distinctTools, ['Bash', 'Read'])
    assert.equal(summary.thinkChars, 9)
    assert.equal(summary.resultChars, 150)
    assert.equal(summary.apiTurns, 3)
    assert.equal(summary.apiDurationMs, 5000)
    assert.equal(summary.costUsd, 0.05)
  })

  test('handles empty steps', () => {
    const summary = computeTraceSummary([], { apiTurns: null, apiDurationMs: null, costUsd: null })
    assert.equal(summary.totalSteps, 0)
    assert.equal(summary.thinkSteps, 0)
    assert.equal(summary.toolCalls, 0)
    assert.deepEqual(summary.distinctTools, [])
  })
})

// ── buildDecisionTrace ───────────────────────────────────────────

describe('buildDecisionTrace', () => {
  test('builds a complete trace from stream-json lines', () => {
    const trace = buildDecisionTrace({
      timestamp: '2026-04-27T10:00:00.000Z',
      deviceId: 'test-device',
      sessionId: 'test-session',
      tick: 1,
      mode: 'awakened',
      streamJsonLines: [
        INIT_EVENT,
        ASSISTANT_TOOL_USE,
        TOOL_RESULT,
        ASSISTANT_AFTER_TOOL,
        RESULT_EVENT,
      ],
    })

    assert.equal(trace.schemaVersion, TRACE_SCHEMA_VERSION)
    assert.equal(trace.sessionId, 'test-session')
    assert.equal(trace.tick, 1)
    assert.equal(trace.mode, 'awakened')
    assert.equal(trace.model, 'claude-opus-4-6[1m]')
    assert.ok(trace.steps.length >= 4)
    assert.equal(trace.summary.toolCalls, 1)
    assert.deepEqual(trace.summary.distinctTools, ['Read'])
  })

  test('handles empty lines', () => {
    const trace = buildDecisionTrace({
      timestamp: '2026-04-27T10:00:00.000Z',
      deviceId: 'test-device',
      sessionId: 'test-session',
      tick: 1,
      mode: 'heartbeat',
      streamJsonLines: [],
    })

    assert.equal(trace.steps.length, 0)
    assert.equal(trace.summary.totalSteps, 0)
  })
})

// ── reconstructText ──────────────────────────────────────────────

describe('reconstructText', () => {
  test('joins think steps with double newlines', () => {
    const trace = buildDecisionTrace({
      timestamp: '2026-04-27T10:00:00.000Z',
      deviceId: 'test-device',
      sessionId: 'test-session',
      tick: 1,
      mode: 'awakened',
      streamJsonLines: [
        INIT_EVENT,
        ASSISTANT_TOOL_USE,
        TOOL_RESULT,
        ASSISTANT_AFTER_TOOL,
        RESULT_EVENT,
      ],
    })

    const text = reconstructText(trace)
    assert.ok(text.includes('check the file'))
    assert.ok(text.includes('constant x set to 42'))
  })
})

// ── reconstructTextFromStreamJson ────────────────────────────────

describe('reconstructTextFromStreamJson', () => {
  test('extracts text from assistant events', () => {
    const text = reconstructTextFromStreamJson([
      INIT_EVENT,
      ASSISTANT_TOOL_USE,
      TOOL_RESULT,
      ASSISTANT_AFTER_TOOL,
    ])
    assert.ok(text.includes('check the file'))
    assert.ok(text.includes('constant x set to 42'))
  })

  test('returns empty string for no assistant events', () => {
    const text = reconstructTextFromStreamJson([INIT_EVENT, RESULT_EVENT])
    assert.equal(text, '')
  })
})

// ── compactTraceForStorage ───────────────────────────────────────

describe('compactTraceForStorage', () => {
  test('truncates long think text', () => {
    const trace: DecisionTrace = {
      schemaVersion: TRACE_SCHEMA_VERSION,
      timestamp: '2026-04-27T10:00:00.000Z',
      deviceId: 'test',
      sessionId: 'test',
      tick: 1,
      mode: 'awakened',
      model: null,
      steps: [
        { kind: 'think', text: 'x'.repeat(5000), chars: 5000 },
      ],
      summary: {
        totalSteps: 1, thinkSteps: 1, toolCalls: 0, toolResults: 0,
        distinctTools: [], thinkChars: 5000, resultChars: 0,
        apiTurns: null, apiDurationMs: null, costUsd: null,
      },
    }

    const compact = compactTraceForStorage(trace)
    const thinkStep = compact.steps[0]!
    assert.equal(thinkStep.kind, 'think')
    if (thinkStep.kind === 'think') {
      assert.ok(thinkStep.text.length <= 2001) // 2000 + '…'
      assert.equal(thinkStep.chars, 5000) // original count preserved
    }
  })

  test('clears tool_call input objects', () => {
    const trace: DecisionTrace = {
      schemaVersion: TRACE_SCHEMA_VERSION,
      timestamp: '2026-04-27T10:00:00.000Z',
      deviceId: 'test',
      sessionId: 'test',
      tick: 1,
      mode: 'awakened',
      model: null,
      steps: [
        {
          kind: 'tool_call',
          tool: 'Read',
          toolUseId: 't1',
          input: { file_path: '/big/file', extra: 'data' },
          inputSummary: '/big/file',
        },
      ],
      summary: {
        totalSteps: 1, thinkSteps: 0, toolCalls: 1, toolResults: 0,
        distinctTools: ['Read'], thinkChars: 0, resultChars: 0,
        apiTurns: null, apiDurationMs: null, costUsd: null,
      },
    }

    const compact = compactTraceForStorage(trace)
    const callStep = compact.steps[0]!
    if (callStep.kind === 'tool_call') {
      assert.deepEqual(callStep.input, {})
      assert.equal(callStep.inputSummary, '/big/file')
    }
  })
})

// ── Storage (recordTrace + loadTraces) ───────────────────────────

describe('storage', () => {
  test('records and loads traces', () => {
    const dir = makeTmpDir()
    process.env.TRUE_LOVE_TRACES_DIR = dir

    try {
      const trace = buildDecisionTrace({
        timestamp: '2026-04-27T10:00:00.000Z',
        deviceId: 'test-device',
        sessionId: 'test-session',
        tick: 1,
        mode: 'awakened',
        streamJsonLines: [INIT_EVENT, ASSISTANT_TOOL_USE, TOOL_RESULT, RESULT_EVENT],
      })

      recordTrace(trace)

      const loaded = loadTraces({ days: 7, basePath: dir })
      assert.equal(loaded.length, 1)
      assert.equal(loaded[0]!.sessionId, 'test-session')
      assert.equal(loaded[0]!.tick, 1)
      assert.equal(loaded[0]!.summary.toolCalls, 1)
    } finally {
      delete process.env.TRUE_LOVE_TRACES_DIR
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('records multiple traces to same file', () => {
    const dir = makeTmpDir()
    process.env.TRUE_LOVE_TRACES_DIR = dir

    try {
      for (let tick = 1; tick <= 3; tick++) {
        const trace = buildDecisionTrace({
          timestamp: '2026-04-27T10:00:00.000Z',
          deviceId: 'test-device',
          sessionId: 'test-session',
          tick,
          mode: 'awakened',
          streamJsonLines: [INIT_EVENT, ASSISTANT_TEXT_ONLY, RESULT_EVENT],
        })
        recordTrace(trace)
      }

      const loaded = loadTraces({ days: 7, basePath: dir })
      assert.equal(loaded.length, 3)
    } finally {
      delete process.env.TRUE_LOVE_TRACES_DIR
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('loadTraces filters by days', () => {
    const dir = makeTmpDir()
    process.env.TRUE_LOVE_TRACES_DIR = dir

    try {
      // Write a trace with an old date
      const oldTrace = buildDecisionTrace({
        timestamp: '2020-01-01T10:00:00.000Z',
        deviceId: 'test-device',
        sessionId: 'old-session',
        tick: 1,
        mode: 'awakened',
        streamJsonLines: [INIT_EVENT, ASSISTANT_TEXT_ONLY, RESULT_EVENT],
      })
      recordTrace(oldTrace)

      // Write a trace with today's date
      const newTrace = buildDecisionTrace({
        timestamp: new Date().toISOString(),
        deviceId: 'test-device',
        sessionId: 'new-session',
        tick: 1,
        mode: 'awakened',
        streamJsonLines: [INIT_EVENT, ASSISTANT_TEXT_ONLY, RESULT_EVENT],
      })
      recordTrace(newTrace)

      const loaded = loadTraces({ days: 1, basePath: dir })
      assert.equal(loaded.length, 1)
      assert.equal(loaded[0]!.sessionId, 'new-session')
    } finally {
      delete process.env.TRUE_LOVE_TRACES_DIR
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('loadSessionTraces filters by sessionId', () => {
    const dir = makeTmpDir()
    process.env.TRUE_LOVE_TRACES_DIR = dir

    try {
      const now = new Date().toISOString()
      for (const sid of ['session-a', 'session-b', 'session-a']) {
        const trace = buildDecisionTrace({
          timestamp: now,
          deviceId: 'test-device',
          sessionId: sid,
          tick: 1,
          mode: 'awakened',
          streamJsonLines: [INIT_EVENT, ASSISTANT_TEXT_ONLY, RESULT_EVENT],
        })
        recordTrace(trace)
      }

      const loaded = loadSessionTraces('session-a', { basePath: dir })
      assert.equal(loaded.length, 2)
      assert.ok(loaded.every((t) => t.sessionId === 'session-a'))
    } finally {
      delete process.env.TRUE_LOVE_TRACES_DIR
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('loadTraces returns empty for nonexistent dir', () => {
    const loaded = loadTraces({ basePath: '/nonexistent/path/traces' })
    assert.deepEqual(loaded, [])
  })
})

// ── renderStepCompact ────────────────────────────────────────────

describe('renderStepCompact', () => {
  test('renders think step', () => {
    const step: TraceStep = { kind: 'think', text: 'Hello world', chars: 11 }
    const line = renderStepCompact(step, 0)
    assert.ok(line.includes('💭'))
    assert.ok(line.includes('think'))
    assert.ok(line.includes('Hello world'))
    assert.ok(line.includes('11 chars'))
  })

  test('renders tool_call step', () => {
    const step: TraceStep = {
      kind: 'tool_call',
      tool: 'Read',
      toolUseId: 't1',
      input: {},
      inputSummary: '/path/to/file',
    }
    const line = renderStepCompact(step, 2)
    assert.ok(line.includes('🔧'))
    assert.ok(line.includes('Read'))
    assert.ok(line.includes('/path/to/file'))
    assert.ok(line.startsWith('  3.')) // 0-indexed + 1
  })

  test('renders tool_result step', () => {
    const step: TraceStep = {
      kind: 'tool_result',
      toolUseId: 't1',
      isError: false,
      contentSummary: 'file contents here',
      contentChars: 200,
    }
    const line = renderStepCompact(step, 1)
    assert.ok(line.includes('📋'))
    assert.ok(line.includes('200 chars'))
    assert.ok(line.includes('file contents here'))
  })

  test('marks error results', () => {
    const step: TraceStep = {
      kind: 'tool_result',
      toolUseId: 't1',
      isError: true,
      contentSummary: 'not found',
      contentChars: 9,
    }
    const line = renderStepCompact(step, 0)
    assert.ok(line.includes('❌'))
  })

  test('truncates long think text in preview', () => {
    const step: TraceStep = { kind: 'think', text: 'a'.repeat(200), chars: 200 }
    const line = renderStepCompact(step, 0)
    assert.ok(line.includes('…'))
  })
})

// ── renderTrace ──────────────────────────────────────────────────

describe('renderTrace', () => {
  test('renders a complete trace', () => {
    const trace = buildDecisionTrace({
      timestamp: '2026-04-27T10:00:00.000Z',
      deviceId: 'test-device',
      sessionId: 'test-session',
      tick: 1,
      mode: 'awakened',
      streamJsonLines: [
        INIT_EVENT,
        ASSISTANT_TOOL_USE,
        TOOL_RESULT,
        ASSISTANT_AFTER_TOOL,
        RESULT_EVENT,
      ],
    })

    const rendered = renderTrace(trace)
    assert.ok(rendered.includes('test-session'))
    assert.ok(rendered.includes('tick 1'))
    assert.ok(rendered.includes('awakened'))
    assert.ok(rendered.includes('Decision sequence'))
    assert.ok(rendered.includes('Read'))
  })

  test('renders empty trace', () => {
    const trace = buildDecisionTrace({
      timestamp: '2026-04-27T10:00:00.000Z',
      deviceId: 'test-device',
      sessionId: 'test-session',
      tick: 1,
      mode: 'heartbeat',
      streamJsonLines: [],
    })

    const rendered = renderTrace(trace)
    assert.ok(rendered.includes('no steps'))
  })
})

// ── renderTraceList ──────────────────────────────────────────────

describe('renderTraceList', () => {
  test('renders a list of traces', () => {
    const traces = [
      buildDecisionTrace({
        timestamp: '2026-04-27T10:00:00.000Z',
        deviceId: 'test-device',
        sessionId: 'session-1',
        tick: 1,
        mode: 'awakened',
        streamJsonLines: [INIT_EVENT, ASSISTANT_TOOL_USE, TOOL_RESULT, RESULT_EVENT],
      }),
      buildDecisionTrace({
        timestamp: '2026-04-27T11:00:00.000Z',
        deviceId: 'test-device',
        sessionId: 'session-2',
        tick: 1,
        mode: 'heartbeat',
        streamJsonLines: [INIT_EVENT, ASSISTANT_TEXT_ONLY, RESULT_EVENT],
      }),
    ]

    const rendered = renderTraceList(traces)
    assert.ok(rendered.includes('Decision Traces'))
    assert.ok(rendered.includes('2 trace(s)'))
    assert.ok(rendered.includes('awakened'))
    assert.ok(rendered.includes('heartbeat'))
  })

  test('handles empty list', () => {
    const rendered = renderTraceList([])
    assert.ok(rendered.includes('No traces found'))
  })
})

// ── buildMindTraceBlock ──────────────────────────────────────────

describe('buildMindTraceBlock', () => {
  test('returns null when no traces exist', () => {
    const origDir = process.env.TRUE_LOVE_TRACES_DIR
    process.env.TRUE_LOVE_TRACES_DIR = '/nonexistent/path'
    try {
      assert.equal(buildMindTraceBlock(), null)
    } finally {
      if (origDir) process.env.TRUE_LOVE_TRACES_DIR = origDir
      else delete process.env.TRUE_LOVE_TRACES_DIR
    }
  })

  test('returns null when latest trace has no tool calls', () => {
    const dir = makeTmpDir()
    process.env.TRUE_LOVE_TRACES_DIR = dir

    try {
      const trace = buildDecisionTrace({
        timestamp: new Date().toISOString(),
        deviceId: 'test-device',
        sessionId: 'test-session',
        tick: 1,
        mode: 'awakened',
        streamJsonLines: [INIT_EVENT, ASSISTANT_TEXT_ONLY, RESULT_EVENT],
      })
      recordTrace(trace)

      assert.equal(buildMindTraceBlock(), null)
    } finally {
      delete process.env.TRUE_LOVE_TRACES_DIR
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('returns block when latest trace has tool calls', () => {
    const dir = makeTmpDir()
    process.env.TRUE_LOVE_TRACES_DIR = dir

    try {
      const trace = buildDecisionTrace({
        timestamp: new Date().toISOString(),
        deviceId: 'test-device',
        sessionId: 'test-session',
        tick: 1,
        mode: 'awakened',
        streamJsonLines: [
          INIT_EVENT,
          ASSISTANT_TOOL_USE,
          TOOL_RESULT,
          ASSISTANT_AFTER_TOOL,
          RESULT_EVENT,
        ],
      })
      recordTrace(trace)

      const block = buildMindTraceBlock()
      assert.ok(block !== null)
      assert.ok(block!.includes('brain trace'))
      assert.ok(block!.includes('Read'))
    } finally {
      delete process.env.TRUE_LOVE_TRACES_DIR
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ── Multi-tool-use conversation ──────────────────────────────────

describe('multi-tool conversation', () => {
  test('handles multiple tool calls in sequence', () => {
    const events = [
      INIT_EVENT,
      // First: model reads a file
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Let me check the config and the source.' },
            { type: 'tool_use', id: 'tc_1', name: 'Read', input: { file_path: '/config.json' } },
            { type: 'tool_use', id: 'tc_2', name: 'Read', input: { file_path: '/src/app.ts' } },
          ],
        },
      }),
      // Tool results come back
      JSON.stringify({
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tc_1', content: '{"port": 3000}', is_error: false },
            { type: 'tool_result', tool_use_id: 'tc_2', content: 'import express from "express"', is_error: false },
          ],
        },
      }),
      // Model makes an edit
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'I see the issue. Let me fix the port.' },
            { type: 'tool_use', id: 'tc_3', name: 'Edit', input: { file_path: '/config.json', old_string: '"port": 3000', new_string: '"port": 8080' } },
          ],
        },
      }),
      JSON.stringify({
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tc_3', content: 'File edited successfully', is_error: false },
          ],
        },
      }),
      // Final response
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Done. Changed port from 3000 to 8080.\n\n<at-rest/>' }],
        },
      }),
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'Let me check the config and the source.\nI see the issue. Let me fix the port.\nDone. Changed port from 3000 to 8080.\n\n<at-rest/>',
        num_turns: 3,
        duration_ms: 8000,
        total_cost_usd: 0.085,
      }),
    ]

    const trace = buildDecisionTrace({
      timestamp: '2026-04-27T10:00:00.000Z',
      deviceId: 'test-device',
      sessionId: 'multi-tool-session',
      tick: 1,
      mode: 'awakened',
      streamJsonLines: events,
    })

    // Verify step sequence
    assert.equal(trace.summary.toolCalls, 3)
    assert.equal(trace.summary.toolResults, 3)
    assert.deepEqual(trace.summary.distinctTools, ['Edit', 'Read'])
    assert.equal(trace.summary.apiTurns, 3)
    assert.equal(trace.summary.costUsd, 0.085)

    // Verify specific tool calls
    const calls = trace.steps.filter((s) => s.kind === 'tool_call')
    assert.equal(calls.length, 3)
    if (calls[0]!.kind === 'tool_call') {
      assert.equal(calls[0]!.tool, 'Read')
      assert.ok(calls[0]!.inputSummary.includes('/config.json'))
    }
    if (calls[2]!.kind === 'tool_call') {
      assert.equal(calls[2]!.tool, 'Edit')
      assert.ok(calls[2]!.inputSummary.includes('/config.json'))
    }

    // Rendering should include all tools
    const rendered = renderTrace(trace)
    assert.ok(rendered.includes('Read'))
    assert.ok(rendered.includes('Edit'))
    assert.ok(rendered.includes('3 tool calls'))
  })
})
