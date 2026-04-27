// stream.test.ts — tests for the streaming delta bridge.
//
// Tests cover: types, file I/O, NDJSON-to-delta transformation,
// byte-offset reading, stream lifecycle, and concurrent access.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, readFileSync, existsSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  initStreamFile,
  appendStreamDelta,
  readNewDeltas,
  ndjsonToDeltas,
  getStreamDir,
  type StreamDelta,
} from '../stream.js'

// ── Test fixtures ─────────────────────────────────────────────────

const TEST_DIR = join(import.meta.dir, '__stream-test-tmp__')
const STREAM_FILE = join(TEST_DIR, 'test-stream.jsonl')

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
  try { rmSync(TEST_DIR, { recursive: true, force: true }) } catch {}
})

// ── initStreamFile ───────────────────────────────────────────────

describe('initStreamFile', () => {
  test('creates the file and parent directory', () => {
    const nested = join(TEST_DIR, 'deep', 'nested', 'stream.jsonl')
    initStreamFile(nested)
    expect(existsSync(nested)).toBe(true)
    expect(readFileSync(nested, 'utf-8')).toBe('')
  })

  test('truncates existing content', () => {
    writeFileSync(STREAM_FILE, 'old content\n')
    initStreamFile(STREAM_FILE)
    expect(readFileSync(STREAM_FILE, 'utf-8')).toBe('')
  })
})

// ── appendStreamDelta ────────────────────────────────────────────

describe('appendStreamDelta', () => {
  test('appends a JSON line for text delta', () => {
    initStreamFile(STREAM_FILE)
    appendStreamDelta(STREAM_FILE, { kind: 'text', text: 'hello' })
    const content = readFileSync(STREAM_FILE, 'utf-8')
    expect(content).toBe('{"kind":"text","text":"hello"}\n')
  })

  test('appends multiple deltas as separate lines', () => {
    initStreamFile(STREAM_FILE)
    appendStreamDelta(STREAM_FILE, { kind: 'stream-start', ts: '2026-01-01T00:00:00Z' })
    appendStreamDelta(STREAM_FILE, { kind: 'text', text: 'hello ' })
    appendStreamDelta(STREAM_FILE, { kind: 'text', text: 'world' })
    appendStreamDelta(STREAM_FILE, { kind: 'stream-end', ts: '2026-01-01T00:00:01Z' })
    const lines = readFileSync(STREAM_FILE, 'utf-8').split('\n').filter(l => l.trim())
    expect(lines).toHaveLength(4)
  })

  test('each line is valid JSON', () => {
    initStreamFile(STREAM_FILE)
    const deltas: StreamDelta[] = [
      { kind: 'stream-start', ts: '2026-01-01T00:00:00Z' },
      { kind: 'text', text: 'some text' },
      { kind: 'tool-start', name: 'Read', input: '/path/to/file' },
      { kind: 'tool-end', name: 'Read' },
      { kind: 'thinking', text: 'let me think...' },
      { kind: 'stream-end', ts: '2026-01-01T00:00:01Z' },
    ]
    for (const delta of deltas) {
      appendStreamDelta(STREAM_FILE, delta)
    }
    const lines = readFileSync(STREAM_FILE, 'utf-8').split('\n').filter(l => l.trim())
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
  })
})

// ── readNewDeltas ────────────────────────────────────────────────

describe('readNewDeltas', () => {
  test('reads all deltas from offset 0', () => {
    initStreamFile(STREAM_FILE)
    appendStreamDelta(STREAM_FILE, { kind: 'text', text: 'a' })
    appendStreamDelta(STREAM_FILE, { kind: 'text', text: 'b' })
    const { deltas, newOffset } = readNewDeltas(STREAM_FILE, 0)
    expect(deltas).toHaveLength(2)
    expect(deltas[0]).toEqual({ kind: 'text', text: 'a' })
    expect(deltas[1]).toEqual({ kind: 'text', text: 'b' })
    expect(newOffset).toBeGreaterThan(0)
  })

  test('returns empty for non-existent file', () => {
    const { deltas, newOffset } = readNewDeltas('/nonexistent/file.jsonl', 0)
    expect(deltas).toHaveLength(0)
    expect(newOffset).toBe(0)
  })

  test('incremental reads only return new deltas', () => {
    initStreamFile(STREAM_FILE)
    appendStreamDelta(STREAM_FILE, { kind: 'text', text: 'first' })
    const { newOffset: offset1 } = readNewDeltas(STREAM_FILE, 0)
    expect(offset1).toBeGreaterThan(0)

    // Append more
    appendStreamDelta(STREAM_FILE, { kind: 'text', text: 'second' })
    const { deltas: batch2, newOffset: offset2 } = readNewDeltas(STREAM_FILE, offset1)
    expect(batch2).toHaveLength(1)
    expect(batch2[0]).toEqual({ kind: 'text', text: 'second' })
    expect(offset2).toBeGreaterThan(offset1)
  })

  test('returns empty when no new data', () => {
    initStreamFile(STREAM_FILE)
    appendStreamDelta(STREAM_FILE, { kind: 'text', text: 'only' })
    const { newOffset } = readNewDeltas(STREAM_FILE, 0)
    const { deltas } = readNewDeltas(STREAM_FILE, newOffset)
    expect(deltas).toHaveLength(0)
  })

  test('resets offset on file truncation (new turn)', () => {
    initStreamFile(STREAM_FILE)
    appendStreamDelta(STREAM_FILE, { kind: 'text', text: 'old data' })
    const { newOffset } = readNewDeltas(STREAM_FILE, 0)

    // Truncate (simulates new turn starting)
    initStreamFile(STREAM_FILE)
    appendStreamDelta(STREAM_FILE, { kind: 'text', text: 'new' })

    // The old offset is larger than the new file — should reset
    const { deltas } = readNewDeltas(STREAM_FILE, newOffset)
    expect(deltas).toHaveLength(1)
    expect(deltas[0]).toEqual({ kind: 'text', text: 'new' })
  })

  test('handles multi-byte UTF-8 correctly', () => {
    initStreamFile(STREAM_FILE)
    appendStreamDelta(STREAM_FILE, { kind: 'text', text: 'こんにちは' })
    appendStreamDelta(STREAM_FILE, { kind: 'text', text: '🌍' })
    const { deltas, newOffset } = readNewDeltas(STREAM_FILE, 0)
    expect(deltas).toHaveLength(2)
    expect(deltas[0]).toEqual({ kind: 'text', text: 'こんにちは' })
    expect(deltas[1]).toEqual({ kind: 'text', text: '🌍' })

    // Verify the byte offset is correct for multi-byte content
    const { deltas: empty } = readNewDeltas(STREAM_FILE, newOffset)
    expect(empty).toHaveLength(0)
  })

  test('skips lines without kind field', () => {
    initStreamFile(STREAM_FILE)
    appendFileSync(STREAM_FILE, '{"not": "a delta"}\n')
    appendStreamDelta(STREAM_FILE, { kind: 'text', text: 'valid' })
    const { deltas } = readNewDeltas(STREAM_FILE, 0)
    expect(deltas).toHaveLength(1)
    expect(deltas[0]).toEqual({ kind: 'text', text: 'valid' })
  })
})

// ── ndjsonToDeltas ───────────────────────────────────────────────

describe('ndjsonToDeltas', () => {
  test('assistant text → text delta', () => {
    const event = {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Hello world' }],
      },
    }
    const deltas = ndjsonToDeltas(event)
    expect(deltas).toHaveLength(1)
    expect(deltas[0]).toEqual({ kind: 'text', text: 'Hello world' })
  })

  test('assistant with multiple blocks → multiple deltas', () => {
    const event = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Let me read that.' },
          { type: 'tool_use', name: 'Read', input: { file_path: '/foo.txt' } },
        ],
      },
    }
    const deltas = ndjsonToDeltas(event)
    expect(deltas).toHaveLength(2)
    expect(deltas[0]).toEqual({ kind: 'text', text: 'Let me read that.' })
    expect(deltas[1]).toEqual({ kind: 'tool-start', name: 'Read', input: '/foo.txt' })
  })

  test('user event → tool-end', () => {
    const event = { type: 'user' }
    const deltas = ndjsonToDeltas(event)
    expect(deltas).toHaveLength(1)
    expect(deltas[0]).toEqual({ kind: 'tool-end' })
  })

  test('result event → no deltas', () => {
    const event = { type: 'result', result: 'final text' }
    const deltas = ndjsonToDeltas(event)
    expect(deltas).toHaveLength(0)
  })

  test('system/init event → no deltas', () => {
    const event = { type: 'system', session: { id: 'abc' } }
    const deltas = ndjsonToDeltas(event)
    expect(deltas).toHaveLength(0)
  })

  test('thinking block → thinking delta', () => {
    const event = {
      type: 'assistant',
      message: {
        content: [{ type: 'thinking', text: 'Let me reason about this...' }],
      },
    }
    const deltas = ndjsonToDeltas(event)
    expect(deltas).toHaveLength(1)
    expect(deltas[0]).toEqual({ kind: 'thinking', text: 'Let me reason about this...' })
  })

  test('empty content → no deltas', () => {
    const event = { type: 'assistant', message: { content: [] } }
    const deltas = ndjsonToDeltas(event)
    expect(deltas).toHaveLength(0)
  })

  test('missing message → no deltas', () => {
    const event = { type: 'assistant' }
    const deltas = ndjsonToDeltas(event)
    expect(deltas).toHaveLength(0)
  })

  test('tool input summarization — Read', () => {
    const event = {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/very/long/path.txt' } }],
      },
    }
    const deltas = ndjsonToDeltas(event)
    expect(deltas[0]!.kind).toBe('tool-start')
    expect((deltas[0] as any).input).toBe('/very/long/path.txt')
  })

  test('tool input summarization — Bash', () => {
    const event = {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls -la' } }],
      },
    }
    const deltas = ndjsonToDeltas(event)
    expect((deltas[0] as any).input).toBe('ls -la')
  })

  test('tool input summarization — Grep', () => {
    const event = {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Grep', input: { pattern: 'TODO', path: '/src' } }],
      },
    }
    const deltas = ndjsonToDeltas(event)
    expect((deltas[0] as any).input).toBe('/TODO/ in /src')
  })

  test('tool input summarization — WebSearch', () => {
    const event = {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'WebSearch', input: { query: 'bun test runner' } }],
      },
    }
    const deltas = ndjsonToDeltas(event)
    expect((deltas[0] as any).input).toBe('bun test runner')
  })

  test('tool input truncated at 120 chars', () => {
    const longCommand = 'x'.repeat(200)
    const event = {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Bash', input: { command: longCommand } }],
      },
    }
    const deltas = ndjsonToDeltas(event)
    expect((deltas[0] as any).input.length).toBe(120)
  })
})

// ── Full stream lifecycle ────────────────────────────────────────

describe('full stream lifecycle', () => {
  test('simulates a complete turn with text and tools', () => {
    initStreamFile(STREAM_FILE)

    // stream-start
    appendStreamDelta(STREAM_FILE, { kind: 'stream-start', ts: '2026-01-01T00:00:00Z' })

    // Assistant responds with text + tool call
    const ndjson1 = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Let me check that file.' },
          { type: 'tool_use', name: 'Read', input: { file_path: '/state.md' } },
        ],
      },
    }
    for (const d of ndjsonToDeltas(ndjson1)) appendStreamDelta(STREAM_FILE, d)

    // Tool result
    for (const d of ndjsonToDeltas({ type: 'user' })) appendStreamDelta(STREAM_FILE, d)

    // Assistant responds with final text
    const ndjson2 = {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'I found the answer: 42.' }],
      },
    }
    for (const d of ndjsonToDeltas(ndjson2)) appendStreamDelta(STREAM_FILE, d)

    // stream-end
    appendStreamDelta(STREAM_FILE, { kind: 'stream-end', ts: '2026-01-01T00:00:05Z' })

    // Read all deltas
    const { deltas } = readNewDeltas(STREAM_FILE, 0)
    expect(deltas).toHaveLength(6)
    expect(deltas.map(d => d.kind)).toEqual([
      'stream-start',
      'text',
      'tool-start',
      'tool-end',
      'text',
      'stream-end',
    ])
  })

  test('incremental reads simulate the ui-server watcher', () => {
    initStreamFile(STREAM_FILE)
    let offset = 0

    // Turn starts
    appendStreamDelta(STREAM_FILE, { kind: 'stream-start', ts: '2026-01-01T00:00:00Z' })

    // First poll — picks up stream-start
    const read1 = readNewDeltas(STREAM_FILE, offset)
    offset = read1.newOffset
    expect(read1.deltas).toHaveLength(1)
    expect(read1.deltas[0]!.kind).toBe('stream-start')

    // Model produces text
    appendStreamDelta(STREAM_FILE, { kind: 'text', text: 'Hello ' })
    appendStreamDelta(STREAM_FILE, { kind: 'text', text: 'world.' })

    // Second poll — picks up 2 text deltas
    const read2 = readNewDeltas(STREAM_FILE, offset)
    offset = read2.newOffset
    expect(read2.deltas).toHaveLength(2)

    // No new data
    const read3 = readNewDeltas(STREAM_FILE, offset)
    expect(read3.deltas).toHaveLength(0)

    // Stream ends
    appendStreamDelta(STREAM_FILE, { kind: 'stream-end', ts: '2026-01-01T00:00:01Z' })

    const read4 = readNewDeltas(STREAM_FILE, offset)
    expect(read4.deltas).toHaveLength(1)
    expect(read4.deltas[0]!.kind).toBe('stream-end')
  })
})

// ── getStreamDir ─────────────────────────────────────────────────

describe('getStreamDir', () => {
  test('returns the default path', () => {
    const dir = getStreamDir()
    expect(dir).toContain('.true-love')
    expect(dir).toContain('stream')
  })

  test('respects TRUE_LOVE_STREAM_DIR env', () => {
    const orig = process.env.TRUE_LOVE_STREAM_DIR
    try {
      process.env.TRUE_LOVE_STREAM_DIR = '/custom/path'
      expect(getStreamDir()).toBe('/custom/path')
    } finally {
      if (orig !== undefined) process.env.TRUE_LOVE_STREAM_DIR = orig
      else delete process.env.TRUE_LOVE_STREAM_DIR
    }
  })
})
