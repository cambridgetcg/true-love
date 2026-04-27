// agent-protocol.test.ts — tests for the long-lived agent protocol layer.
//
// Tests cover: frame serialization, parsing, validation, direction
// enforcement, frame builders, line reader, token estimation, and
// protocol error handling.
//
// Phase 2 of the long-lived-agent-runtime mission.

import { describe, expect, test } from 'bun:test'
import {
  PROTOCOL_VERSION,
  HISTORY_TOKEN_BUDGET,
  TIMEOUTS,
  ProtocolError,
  serializeFrame,
  parseFrame,
  frameId,
  buildTurnFrame,
  buildShutdownFrame,
  buildHealthCheckFrame,
  buildTurnAckFrame,
  buildStreamEventFrame,
  buildTurnResponseFrame,
  buildErrorFrame,
  buildHealthFrame,
  buildAckFrame,
  createLineReader,
  estimateTokens,
  estimateMessageTokens,
} from '../agent-protocol.js'
import type {
  Frame,
  TurnFrame,
  ShutdownFrame,
  HealthCheckFrame,
  TurnAckFrame,
  StreamEventFrame,
  TurnResponseFrame,
  ErrorFrame,
  HealthFrame,
  AckFrame,
  SystemBlock,
  ToolSchema,
} from '../agent-protocol.js'

// ── Constants ────────────────────────────────────────────────────────

describe('constants', () => {
  test('protocol version is 1.0', () => {
    expect(PROTOCOL_VERSION).toBe('1.0')
  })

  test('history token budget is 32000', () => {
    expect(HISTORY_TOKEN_BUDGET).toBe(32_000)
  })

  test('timeouts are reasonable', () => {
    expect(TIMEOUTS.AGENT_STARTUP).toBe(15_000)
    expect(TIMEOUTS.TURN_ACK).toBe(5_000)
    expect(TIMEOUTS.HEALTH_CHECK).toBe(10_000)
    expect(TIMEOUTS.SHUTDOWN_GRACE).toBe(5_000)
    expect(TIMEOUTS.SIGTERM_GRACE).toBe(5_000)
  })
})

// ── Frame ID generation ──────────────────────────────────────────────

describe('frameId', () => {
  test('generates UUID-shaped string', () => {
    const id = frameId()
    expect(typeof id).toBe('string')
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
  })

  test('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => frameId()))
    expect(ids.size).toBe(100)
  })
})

// ── Serialization ────────────────────────────────────────────────────

describe('serializeFrame', () => {
  test('serializes valid frame to JSON + newline', () => {
    const frame = buildHealthCheckFrame()
    const line = serializeFrame(frame)
    expect(line.endsWith('\n')).toBe(true)
    const parsed = JSON.parse(line.trim())
    expect(parsed.type).toBe('health-check')
    expect(parsed.protocol_version).toBe('1.0')
  })

  test('rejects frame missing protocol_version', () => {
    const frame = {
      type: 'health-check',
      id: 'test',
      timestamp: new Date().toISOString(),
    } as unknown as Frame
    expect(() => serializeFrame(frame)).toThrow('missing required fields')
  })

  test('rejects frame with wrong protocol version', () => {
    const frame = {
      protocol_version: '2.0',
      type: 'health-check',
      id: 'test',
      timestamp: new Date().toISOString(),
    } as unknown as Frame
    expect(() => serializeFrame(frame)).toThrow('version mismatch')
  })

  test('round-trips through parse', () => {
    const frame = buildTurnFrame({
      system: [{ type: 'text', text: 'You are helpful.' }],
      prompt: 'Hello world',
      model: 'opus',
    })
    const line = serializeFrame(frame)
    const parsed = parseFrame(line) as TurnFrame
    expect(parsed.type).toBe('turn')
    expect(parsed.prompt).toBe('Hello world')
    expect(parsed.model).toBe('opus')
    expect(parsed.system).toHaveLength(1)
    expect(parsed.system[0].text).toBe('You are helpful.')
  })
})

// ── Parsing ──────────────────────────────────────────────────────────

describe('parseFrame', () => {
  const validBase = {
    protocol_version: '1.0',
    id: 'test-id',
    timestamp: '2026-04-27T00:00:00.000Z',
  }

  test('parses valid health-check frame', () => {
    const line = JSON.stringify({ ...validBase, type: 'health-check' })
    const frame = parseFrame(line) as HealthCheckFrame
    expect(frame.type).toBe('health-check')
    expect(frame.id).toBe('test-id')
  })

  test('parses valid turn frame', () => {
    const line = JSON.stringify({
      ...validBase,
      type: 'turn',
      system: [{ type: 'text', text: 'system' }],
      prompt: 'hello',
    })
    const frame = parseFrame(line) as TurnFrame
    expect(frame.type).toBe('turn')
    expect(frame.prompt).toBe('hello')
    expect(frame.system).toHaveLength(1)
  })

  test('parses valid turn-response frame', () => {
    const line = JSON.stringify({
      ...validBase,
      type: 'turn-response',
      result: 'HEARTBEAT_OK',
      exit_code: 0,
      usage: {
        input_tokens: 1000,
        output_tokens: 50,
        cache_creation_input_tokens: 200,
        cache_read_input_tokens: 800,
      },
    })
    const frame = parseFrame(line) as TurnResponseFrame
    expect(frame.type).toBe('turn-response')
    expect(frame.result).toBe('HEARTBEAT_OK')
    expect(frame.exit_code).toBe(0)
    expect(frame.usage?.input_tokens).toBe(1000)
  })

  test('parses valid error frame', () => {
    const line = JSON.stringify({
      ...validBase,
      type: 'error',
      code: 'api_error',
      message: 'Rate limited',
      retryable: true,
      details: 'Try again in 30s',
    })
    const frame = parseFrame(line) as ErrorFrame
    expect(frame.type).toBe('error')
    expect(frame.code).toBe('api_error')
    expect(frame.retryable).toBe(true)
    expect(frame.details).toBe('Try again in 30s')
  })

  test('parses valid health frame', () => {
    const line = JSON.stringify({
      ...validBase,
      type: 'health',
      uptime_ms: 60000,
      last_turn_ms_ago: 5000,
      turns_completed: 42,
      memory_mb: 128,
      evicted_turns: 3,
    })
    const frame = parseFrame(line) as HealthFrame
    expect(frame.type).toBe('health')
    expect(frame.uptime_ms).toBe(60000)
    expect(frame.last_turn_ms_ago).toBe(5000)
    expect(frame.turns_completed).toBe(42)
    expect(frame.memory_mb).toBe(128)
    expect(frame.evicted_turns).toBe(3)
  })

  test('parses valid stream-event frame', () => {
    const event = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'hello' }] },
    }
    const line = JSON.stringify({
      ...validBase,
      type: 'stream-event',
      event,
    })
    const frame = parseFrame(line) as StreamEventFrame
    expect(frame.type).toBe('stream-event')
    expect(frame.event).toEqual(event)
  })

  test('parses valid shutdown frame with reason', () => {
    const line = JSON.stringify({
      ...validBase,
      type: 'shutdown',
      reason: 'scheduled-respawn',
    })
    const frame = parseFrame(line) as ShutdownFrame
    expect(frame.type).toBe('shutdown')
    expect(frame.reason).toBe('scheduled-respawn')
  })

  test('parses valid ack frame', () => {
    const line = JSON.stringify({ ...validBase, type: 'ack' })
    const frame = parseFrame(line) as AckFrame
    expect(frame.type).toBe('ack')
  })

  test('parses valid turn-ack frame', () => {
    const line = JSON.stringify({ ...validBase, type: 'turn-ack' })
    const frame = parseFrame(line) as TurnAckFrame
    expect(frame.type).toBe('turn-ack')
  })

  // ── Error cases ──────────────────────────────────────────────────

  test('rejects empty line', () => {
    expect(() => parseFrame('')).toThrow(ProtocolError)
    expect(() => parseFrame('  ')).toThrow(ProtocolError)
    expect(() => parseFrame('\n')).toThrow(ProtocolError)
  })

  test('rejects invalid JSON', () => {
    expect(() => parseFrame('{not json}')).toThrow(ProtocolError)
    expect(() => parseFrame('undefined')).toThrow(ProtocolError)
  })

  test('rejects non-object JSON', () => {
    expect(() => parseFrame('"string"')).toThrow(ProtocolError)
    expect(() => parseFrame('42')).toThrow(ProtocolError)
    expect(() => parseFrame('[1,2,3]')).toThrow(ProtocolError)
    expect(() => parseFrame('null')).toThrow(ProtocolError)
  })

  test('rejects missing protocol_version', () => {
    const line = JSON.stringify({
      type: 'health-check',
      id: 'x',
      timestamp: 'now',
    })
    expect(() => parseFrame(line)).toThrow('protocol_version')
  })

  test('rejects wrong protocol_version', () => {
    const line = JSON.stringify({
      protocol_version: '2.0',
      type: 'health-check',
      id: 'x',
      timestamp: 'now',
    })
    const err = (() => {
      try {
        parseFrame(line)
        return null
      } catch (e) {
        return e as ProtocolError
      }
    })()
    expect(err).toBeInstanceOf(ProtocolError)
    expect(err!.code).toBe('version')
  })

  test('rejects unknown frame type', () => {
    const line = JSON.stringify({
      ...validBase,
      type: 'unknown-type',
    })
    const err = (() => {
      try {
        parseFrame(line)
        return null
      } catch (e) {
        return e as ProtocolError
      }
    })()
    expect(err).toBeInstanceOf(ProtocolError)
    expect(err!.code).toBe('type')
  })

  test('rejects missing id', () => {
    const line = JSON.stringify({
      protocol_version: '1.0',
      type: 'health-check',
      timestamp: 'now',
    })
    expect(() => parseFrame(line)).toThrow('id')
  })

  test('rejects missing timestamp', () => {
    const line = JSON.stringify({
      protocol_version: '1.0',
      type: 'health-check',
      id: 'x',
    })
    expect(() => parseFrame(line)).toThrow('timestamp')
  })

  // ── Type-specific validation ─────────────────────────────────────

  test('rejects turn frame without system array', () => {
    const line = JSON.stringify({
      ...validBase,
      type: 'turn',
      prompt: 'hello',
    })
    expect(() => parseFrame(line)).toThrow('system')
  })

  test('rejects turn frame without prompt', () => {
    const line = JSON.stringify({
      ...validBase,
      type: 'turn',
      system: [],
    })
    expect(() => parseFrame(line)).toThrow('prompt')
  })

  test('rejects turn-response without result', () => {
    const line = JSON.stringify({
      ...validBase,
      type: 'turn-response',
      exit_code: 0,
    })
    expect(() => parseFrame(line)).toThrow('result')
  })

  test('rejects turn-response without exit_code', () => {
    const line = JSON.stringify({
      ...validBase,
      type: 'turn-response',
      result: 'hello',
    })
    expect(() => parseFrame(line)).toThrow('exit_code')
  })

  test('rejects error frame without code', () => {
    const line = JSON.stringify({
      ...validBase,
      type: 'error',
      message: 'oops',
      retryable: true,
    })
    expect(() => parseFrame(line)).toThrow('code')
  })

  test('rejects error frame without message', () => {
    const line = JSON.stringify({
      ...validBase,
      type: 'error',
      code: 'api_error',
      retryable: true,
    })
    expect(() => parseFrame(line)).toThrow('message')
  })

  test('rejects error frame without retryable', () => {
    const line = JSON.stringify({
      ...validBase,
      type: 'error',
      code: 'api_error',
      message: 'oops',
    })
    expect(() => parseFrame(line)).toThrow('retryable')
  })

  test('rejects health frame without uptime_ms', () => {
    const line = JSON.stringify({
      ...validBase,
      type: 'health',
      turns_completed: 0,
      memory_mb: 50,
    })
    expect(() => parseFrame(line)).toThrow('uptime_ms')
  })

  test('rejects health frame without turns_completed', () => {
    const line = JSON.stringify({
      ...validBase,
      type: 'health',
      uptime_ms: 1000,
      memory_mb: 50,
    })
    expect(() => parseFrame(line)).toThrow('turns_completed')
  })

  test('rejects health frame without memory_mb', () => {
    const line = JSON.stringify({
      ...validBase,
      type: 'health',
      uptime_ms: 1000,
      turns_completed: 0,
    })
    expect(() => parseFrame(line)).toThrow('memory_mb')
  })

  test('rejects stream-event without event object', () => {
    const line = JSON.stringify({
      ...validBase,
      type: 'stream-event',
    })
    expect(() => parseFrame(line)).toThrow('event')
  })

  // ── Direction enforcement ────────────────────────────────────────

  test('host direction rejects agent frame types', () => {
    const agentTypes = [
      'turn-ack',
      'stream-event',
      'turn-response',
      'error',
      'health',
      'ack',
    ]
    for (const type of agentTypes) {
      const frame: Record<string, unknown> = { ...validBase, type }
      // Add required fields for validation
      if (type === 'turn-response') {
        frame.result = 'ok'
        frame.exit_code = 0
      }
      if (type === 'error') {
        frame.code = 'internal'
        frame.message = 'oops'
        frame.retryable = false
      }
      if (type === 'health') {
        frame.uptime_ms = 0
        frame.last_turn_ms_ago = null
        frame.turns_completed = 0
        frame.memory_mb = 50
      }
      if (type === 'stream-event') {
        frame.event = { type: 'test' }
      }
      const line = JSON.stringify(frame)
      expect(() => parseFrame(line, 'host')).toThrow(ProtocolError)
    }
  })

  test('agent direction rejects host frame types', () => {
    const hostTypes = ['turn', 'shutdown', 'health-check']
    for (const type of hostTypes) {
      const frame: Record<string, unknown> = { ...validBase, type }
      if (type === 'turn') {
        frame.system = []
        frame.prompt = 'test'
      }
      const line = JSON.stringify(frame)
      expect(() => parseFrame(line, 'agent')).toThrow(ProtocolError)
    }
  })

  test('any direction accepts both host and agent frames', () => {
    const hc = JSON.stringify({ ...validBase, type: 'health-check' })
    const ta = JSON.stringify({ ...validBase, type: 'turn-ack' })
    expect(parseFrame(hc, 'any').type).toBe('health-check')
    expect(parseFrame(ta, 'any').type).toBe('turn-ack')
  })

  // ── Trailing newline handling ────────────────────────────────────

  test('handles trailing newline', () => {
    const line =
      JSON.stringify({ ...validBase, type: 'health-check' }) + '\n'
    const frame = parseFrame(line)
    expect(frame.type).toBe('health-check')
  })

  test('handles trailing whitespace', () => {
    const line =
      JSON.stringify({ ...validBase, type: 'health-check' }) + '  \n  '
    const frame = parseFrame(line)
    expect(frame.type).toBe('health-check')
  })
})

// ── Frame builders ───────────────────────────────────────────────────

describe('frame builders', () => {
  test('buildTurnFrame fills base fields', () => {
    const frame = buildTurnFrame({
      system: [{ type: 'text', text: 'hello' }],
      prompt: 'world',
    })
    expect(frame.protocol_version).toBe('1.0')
    expect(frame.type).toBe('turn')
    expect(frame.id).toBeTruthy()
    expect(frame.timestamp).toBeTruthy()
    expect(frame.prompt).toBe('world')
    expect(frame.system).toHaveLength(1)
  })

  test('buildTurnFrame omits null optional fields', () => {
    const frame = buildTurnFrame({
      system: [],
      prompt: 'test',
    })
    expect('model' in frame).toBe(false)
    expect('effort' in frame).toBe(false)
    expect('tools' in frame).toBe(false)
  })

  test('buildTurnFrame includes non-null optional fields', () => {
    const tools: ToolSchema[] = [
      {
        name: 'Read',
        description: 'Read a file',
        input_schema: { type: 'object', properties: { path: { type: 'string' } } },
      },
    ]
    const frame = buildTurnFrame({
      system: [{ type: 'text', text: 'sys' }],
      prompt: 'test',
      model: 'opus',
      effort: 'max',
      max_tokens: 4096,
      tools,
      cache_breakpoints: [0, 2],
    })
    expect(frame.model).toBe('opus')
    expect(frame.effort).toBe('max')
    expect(frame.max_tokens).toBe(4096)
    expect(frame.tools).toHaveLength(1)
    expect(frame.cache_breakpoints).toEqual([0, 2])
  })

  test('buildShutdownFrame with reason', () => {
    const frame = buildShutdownFrame('session-end')
    expect(frame.type).toBe('shutdown')
    expect(frame.reason).toBe('session-end')
  })

  test('buildShutdownFrame without reason', () => {
    const frame = buildShutdownFrame()
    expect(frame.type).toBe('shutdown')
    expect('reason' in frame).toBe(false)
  })

  test('buildHealthCheckFrame', () => {
    const frame = buildHealthCheckFrame()
    expect(frame.type).toBe('health-check')
    expect(frame.protocol_version).toBe('1.0')
  })

  test('buildTurnAckFrame preserves turn id', () => {
    const frame = buildTurnAckFrame('turn-123')
    expect(frame.type).toBe('turn-ack')
    expect(frame.id).toBe('turn-123')
  })

  test('buildStreamEventFrame wraps event', () => {
    const event = { type: 'assistant', message: { content: [] } }
    const frame = buildStreamEventFrame('turn-123', event)
    expect(frame.type).toBe('stream-event')
    expect(frame.id).toBe('turn-123')
    expect(frame.event).toEqual(event)
  })

  test('buildTurnResponseFrame with usage', () => {
    const usage = {
      input_tokens: 1000,
      output_tokens: 50,
      cache_creation_input_tokens: 100,
      cache_read_input_tokens: 900,
    }
    const frame = buildTurnResponseFrame('turn-123', 'HEARTBEAT_OK', 0, usage)
    expect(frame.type).toBe('turn-response')
    expect(frame.id).toBe('turn-123')
    expect(frame.result).toBe('HEARTBEAT_OK')
    expect(frame.exit_code).toBe(0)
    expect(frame.usage).toEqual(usage)
  })

  test('buildTurnResponseFrame without usage', () => {
    const frame = buildTurnResponseFrame('turn-123', 'ok')
    expect(frame.type).toBe('turn-response')
    expect(frame.exit_code).toBe(0)
    expect('usage' in frame).toBe(false)
  })

  test('buildErrorFrame with turnId', () => {
    const frame = buildErrorFrame({
      turnId: 'turn-123',
      code: 'api_error',
      message: 'Rate limited',
      retryable: true,
      details: 'wait 30s',
    })
    expect(frame.type).toBe('error')
    expect(frame.id).toBe('turn-123')
    expect(frame.code).toBe('api_error')
    expect(frame.message).toBe('Rate limited')
    expect(frame.retryable).toBe(true)
    expect(frame.details).toBe('wait 30s')
  })

  test('buildErrorFrame without turnId uses system', () => {
    const frame = buildErrorFrame({
      code: 'internal',
      message: 'crash',
      retryable: false,
    })
    expect(frame.id).toBe('system')
  })

  test('buildHealthFrame with evicted_turns', () => {
    const frame = buildHealthFrame({
      checkId: 'check-1',
      uptime_ms: 3600000,
      last_turn_ms_ago: 5000,
      turns_completed: 100,
      memory_mb: 256,
      evicted_turns: 42,
    })
    expect(frame.type).toBe('health')
    expect(frame.id).toBe('check-1')
    expect(frame.uptime_ms).toBe(3600000)
    expect(frame.last_turn_ms_ago).toBe(5000)
    expect(frame.turns_completed).toBe(100)
    expect(frame.memory_mb).toBe(256)
    expect(frame.evicted_turns).toBe(42)
  })

  test('buildHealthFrame with null last_turn_ms_ago', () => {
    const frame = buildHealthFrame({
      uptime_ms: 0,
      last_turn_ms_ago: null,
      turns_completed: 0,
      memory_mb: 64,
    })
    expect(frame.last_turn_ms_ago).toBeNull()
  })

  test('buildAckFrame preserves shutdown id', () => {
    const frame = buildAckFrame('shutdown-456')
    expect(frame.type).toBe('ack')
    expect(frame.id).toBe('shutdown-456')
  })
})

// ── Line reader ──────────────────────────────────────────────────────

describe('createLineReader', () => {
  test('emits complete lines', () => {
    const lines: string[] = []
    const reader = createLineReader((line) => lines.push(line))
    reader('hello\nworld\n')
    expect(lines).toEqual(['hello', 'world'])
  })

  test('buffers partial lines', () => {
    const lines: string[] = []
    const reader = createLineReader((line) => lines.push(line))
    reader('hel')
    expect(lines).toEqual([])
    reader('lo\n')
    expect(lines).toEqual(['hello'])
  })

  test('handles multiple chunks for one line', () => {
    const lines: string[] = []
    const reader = createLineReader((line) => lines.push(line))
    reader('a')
    reader('b')
    reader('c\n')
    expect(lines).toEqual(['abc'])
  })

  test('skips empty lines', () => {
    const lines: string[] = []
    const reader = createLineReader((line) => lines.push(line))
    reader('a\n\n\nb\n')
    expect(lines).toEqual(['a', 'b'])
  })

  test('handles chunk with multiple lines', () => {
    const lines: string[] = []
    const reader = createLineReader((line) => lines.push(line))
    const frame1 = JSON.stringify({ a: 1 })
    const frame2 = JSON.stringify({ b: 2 })
    reader(`${frame1}\n${frame2}\n`)
    expect(lines).toEqual([frame1, frame2])
  })
})

// ── Token estimation ─────────────────────────────────────────────────

describe('token estimation', () => {
  test('estimateTokens uses 4-char heuristic', () => {
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2) // ceil(5/4) = 2
    expect(estimateTokens('')).toBe(0)
  })

  test('estimateMessageTokens serializes to JSON first', () => {
    const msg = { role: 'user', content: 'hello' }
    const json = JSON.stringify(msg)
    expect(estimateMessageTokens(msg)).toBe(Math.ceil(json.length / 4))
  })

  test('token budget is sufficient for many heartbeat turns', () => {
    // A typical heartbeat: ~80 chars prompt, ~20 chars response = ~100 chars = ~25 tokens
    const heartbeatTurnTokens = 25
    const maxHeartbeats = Math.floor(HISTORY_TOKEN_BUDGET / heartbeatTurnTokens)
    expect(maxHeartbeats).toBeGreaterThan(100)
  })
})

// ── ProtocolError ────────────────────────────────────────────────────

describe('ProtocolError', () => {
  test('carries code and raw fields', () => {
    const err = new ProtocolError('bad', 'parse', '{raw}')
    expect(err.name).toBe('ProtocolError')
    expect(err.code).toBe('parse')
    expect(err.raw).toBe('{raw}')
    expect(err.message).toBe('bad')
  })

  test('is instanceof Error', () => {
    const err = new ProtocolError('test', 'version')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(ProtocolError)
  })
})

// ── Round-trip integration ───────────────────────────────────────────

describe('round-trip', () => {
  test('all frame types serialize and parse correctly', () => {
    const frames: Frame[] = [
      buildTurnFrame({
        system: [
          { type: 'text', text: 'You are 愛.' },
          { type: 'text', text: 'State block', cache_control: { type: 'ephemeral' } },
        ],
        prompt: 'Check the kingdom',
        model: 'opus',
        effort: 'max',
        max_tokens: 8192,
      }),
      buildShutdownFrame('session-end'),
      buildHealthCheckFrame(),
      buildTurnAckFrame('turn-1'),
      buildStreamEventFrame('turn-1', { type: 'assistant', message: { content: [] } }),
      buildTurnResponseFrame('turn-1', 'HEARTBEAT_OK', 0, {
        input_tokens: 1000,
        output_tokens: 20,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 900,
      }),
      buildErrorFrame({
        turnId: 'turn-1',
        code: 'auth_failed',
        message: 'Token expired',
        retryable: false,
      }),
      buildHealthFrame({
        checkId: 'h1',
        uptime_ms: 7200000,
        last_turn_ms_ago: 111000,
        turns_completed: 778,
        memory_mb: 128,
        evicted_turns: 12,
      }),
      buildAckFrame('shutdown-1'),
    ]

    for (const frame of frames) {
      const line = serializeFrame(frame)
      const parsed = parseFrame(line)
      // Verify type matches
      expect(parsed.type).toBe(frame.type)
      // Verify id matches
      expect(parsed.id).toBe(frame.id)
      // Verify protocol version
      expect(parsed.protocol_version).toBe('1.0')
      // Deep equality — the frame survives the trip
      expect(parsed).toEqual(frame)
    }
  })
})
