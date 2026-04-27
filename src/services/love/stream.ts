// stream.ts — streaming delta bridge between subprocess and UI.
//
// When a runner subprocess has TRUE_LOVE_STREAM_TO set, it writes each
// NDJSON event as a StreamDelta to a file. The ui-server watches that
// file and pipes new deltas as SSE events to /visit clients.
//
// The file format is JSONL: one JSON object per line, each a StreamDelta.
// The ui-server reads from a byte offset, so it only gets new events.
// The file is truncated at turn start and left on disk until the next
// turn (for debugging). A sentinel `stream-end` delta marks completion.
//
// This module is intentionally minimal: types + file I/O. No network,
// no SSE, no SDK calls. Those belong in ui-server.ts and runner.ts.

import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

// ── Types ────────────────────────��─────────────────────────────────

/** A single streaming event flowing from runner → UI. */
export type StreamDelta =
  | { kind: 'stream-start'; ts: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool-start'; name: string; input: string }
  | { kind: 'tool-end'; name?: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'stream-end'; ts: string }

// ── Paths ─────���────────────────────────────────────────────────────

function resolveHome(): string {
  return process.env.HOME || homedir()
}

/** Root directory for stream files: ~/.true-love/stream/ */
export function getStreamDir(): string {
  return process.env.TRUE_LOVE_STREAM_DIR ||
    join(resolveHome(), '.true-love', 'stream')
}

/** The path the runner should write to, if streaming is enabled. */
export function getStreamToPath(): string | null {
  return process.env.TRUE_LOVE_STREAM_TO || null
}

// ── File I/O ──────────────────────────────────────────────────────

/**
 * Initialize (create/truncate) a stream file. Ensures parent dir exists.
 */
export function initStreamFile(filePath: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(filePath, '', 'utf-8')
}

/**
 * Append a single delta to the stream file. Each delta is one JSON
 * line terminated by \n. Uses appendFileSync for atomicity within
 * a single write (important for the watcher on the other side).
 */
export function appendStreamDelta(filePath: string, delta: StreamDelta): void {
  appendFileSync(filePath, JSON.stringify(delta) + '\n', 'utf-8')
}

/**
 * Read new deltas from a stream file starting at a byte offset.
 * Returns the parsed deltas and the new byte offset.
 *
 * The caller (ui-server) tracks the offset across calls to avoid
 * re-reading events. If the file is smaller than `fromByte` (truncated),
 * resets to 0 and reads from the beginning.
 */
export function readNewDeltas(
  filePath: string,
  fromByte: number,
): { deltas: StreamDelta[]; newOffset: number } {
  if (!existsSync(filePath)) {
    return { deltas: [], newOffset: 0 }
  }

  let fileSize: number
  try {
    fileSize = statSync(filePath).size
  } catch {
    return { deltas: [], newOffset: fromByte }
  }

  // File was truncated (new turn started) — read from beginning
  if (fileSize < fromByte) {
    fromByte = 0
  }

  // Nothing new
  if (fileSize === fromByte) {
    return { deltas: [], newOffset: fromByte }
  }

  // Read the new bytes
  const buffer = Buffer.alloc(fileSize - fromByte)
  const fd = require('node:fs').openSync(filePath, 'r')
  try {
    require('node:fs').readSync(fd, buffer, 0, buffer.length, fromByte)
  } finally {
    require('node:fs').closeSync(fd)
  }

  const text = buffer.toString('utf-8')
  const lines = text.split('\n')
  const deltas: StreamDelta[] = []
  let bytesConsumed = 0

  // The last element from split('\n') is either '' (text ended with \n)
  // or a partial line (mid-write). Either way, skip it — only process
  // complete lines. For partial lines, the next call will re-read.
  const completeLines = lines.slice(0, -1)

  for (const line of completeLines) {
    const lineBytes = Buffer.byteLength(line + '\n', 'utf-8')
    if (!line.trim()) {
      bytesConsumed += lineBytes
      continue
    }
    try {
      const parsed = JSON.parse(line) as StreamDelta
      if (typeof parsed.kind === 'string') {
        deltas.push(parsed)
      }
      bytesConsumed += lineBytes
    } catch {
      // Incomplete or malformed line — stop here.
      break
    }
  }

  return { deltas, newOffset: fromByte + bytesConsumed }
}

// ── NDJSON → StreamDelta transformation ───────────────────────────

/**
 * Transform a raw NDJSON event (from the CLI's --output-format stream-json)
 * into StreamDelta events. One NDJSON event may produce multiple deltas
 * (e.g., an assistant message with text + tool_use blocks).
 *
 * Returns an empty array for events that don't produce visible output
 * (e.g., system/init events, or events we don't recognize).
 */
export function ndjsonToDeltas(event: Record<string, unknown>): StreamDelta[] {
  const eventType = event.type as string
  const deltas: StreamDelta[] = []

  if (eventType === 'assistant') {
    const msg = event.message as {
      content?: Array<{
        type: string
        text?: string
        name?: string
        input?: unknown
      }>
    } | undefined

    for (const block of msg?.content ?? []) {
      if (block.type === 'text' && block.text) {
        deltas.push({ kind: 'text', text: block.text })
      } else if (block.type === 'thinking' && block.text) {
        deltas.push({ kind: 'thinking', text: block.text })
      } else if (block.type === 'tool_use' && block.name) {
        const inputStr = summarizeInput(block.name, block.input)
        deltas.push({ kind: 'tool-start', name: block.name, input: inputStr })
      }
    }
  } else if (eventType === 'user') {
    // Tool result — signals the tool has finished.
    deltas.push({ kind: 'tool-end' })
  }
  // 'result' and 'system' events don't produce deltas — they're handled
  // by the runner for completion/metadata.

  return deltas
}

/**
 * Summarize a tool input for display. Shows the most relevant field
 * for each tool type. Reuses the pattern from mind-trace.ts but
 * simpler — this is for the streaming UI, not for the trace.
 */
function summarizeInput(tool: string, input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const obj = input as Record<string, unknown>
  const MAX = 120

  if (tool === 'Read' && typeof obj.file_path === 'string') {
    return obj.file_path.slice(0, MAX)
  }
  if (tool === 'Bash' && typeof obj.command === 'string') {
    return obj.command.slice(0, MAX)
  }
  if (tool === 'Edit' && typeof obj.file_path === 'string') {
    return obj.file_path.slice(0, MAX)
  }
  if (tool === 'Write' && typeof obj.file_path === 'string') {
    return obj.file_path.slice(0, MAX)
  }
  if (tool === 'Grep' && typeof obj.pattern === 'string') {
    const path = typeof obj.path === 'string' ? ` in ${obj.path}` : ''
    return `/${obj.pattern}/${path}`.slice(0, MAX)
  }
  if (tool === 'Glob' && typeof obj.pattern === 'string') {
    return obj.pattern.slice(0, MAX)
  }
  if (tool === 'Agent' && typeof obj.prompt === 'string') {
    return obj.prompt.slice(0, MAX)
  }
  if (tool === 'WebFetch' && typeof obj.url === 'string') {
    return obj.url.slice(0, MAX)
  }
  if (tool === 'WebSearch' && typeof obj.query === 'string') {
    return obj.query.slice(0, MAX)
  }
  try {
    return JSON.stringify(input).slice(0, MAX)
  } catch {
    return ''
  }
}
