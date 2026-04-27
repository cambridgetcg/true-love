// agent-protocol.ts — Frame types + serialize/parse for the long-lived agent
// protocol.
//
// The contract between the host (runner.ts) and a persistent agent process
// (bin/agent-runtime.mjs). Line-delimited JSON over stdin/stdout.
//
// See: docs/architecture/long-lived-agent-protocol.md
//
// Phase 2 of the long-lived-agent-runtime mission.
// Written by 愛 (Alpha) on April 27, 2026.

import { randomUUID } from 'crypto'

// ── Constants ────────────────────────────────────────────────────────

export const PROTOCOL_VERSION = '1.0' as const

/**
 * Token budget for conversation history bounding (§8 of protocol doc).
 * When accumulated history exceeds this, oldest turns are evicted.
 * ~128KB ≈ 200 heartbeat turns or ~6-8 substantial awakened turns.
 */
export const HISTORY_TOKEN_BUDGET = 32_000

/**
 * Timeouts (ms) from the protocol doc.
 */
export const TIMEOUTS = {
  /** Max wait for initial health frame after spawn (§3.1) */
  AGENT_STARTUP: 15_000,
  /** Max wait for turn-ack after sending a turn (§3.2) */
  TURN_ACK: 5_000,
  /** Max wait for health response to health-check (§3.4) */
  HEALTH_CHECK: 10_000,
  /** Grace period after shutdown before SIGTERM (§2.1 shutdown) */
  SHUTDOWN_GRACE: 5_000,
  /** Grace period after SIGTERM before SIGKILL (§3.4) */
  SIGTERM_GRACE: 5_000,
} as const

// ── Base frame ───────────────────────────────────────────────────────

export interface BaseFrame {
  protocol_version: typeof PROTOCOL_VERSION
  type: string
  id: string
  timestamp: string
}

// ── Host → Agent frames ─────────────────────────────────────────────

export interface SystemBlock {
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' }
}

export interface ToolSchema {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface TurnFrame extends BaseFrame {
  type: 'turn'
  system: SystemBlock[]
  prompt: string
  model?: string | null
  effort?: string | null
  max_tokens?: number | null
  tools?: ToolSchema[] | null
  cache_breakpoints?: number[] | null
}

export interface ShutdownFrame extends BaseFrame {
  type: 'shutdown'
  reason?: 'session-end' | 'model-switch' | 'signal' | 'error' | 'scheduled-respawn'
}

export interface HealthCheckFrame extends BaseFrame {
  type: 'health-check'
}

export type HostFrame = TurnFrame | ShutdownFrame | HealthCheckFrame

// ── Agent → Host frames ─────────────────────────────────────────────

export interface TurnAckFrame extends BaseFrame {
  type: 'turn-ack'
  // id matches the turn's id
}

export interface StreamEventFrame extends BaseFrame {
  type: 'stream-event'
  // id matches the turn's id
  event: Record<string, unknown>
}

export interface TurnUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}

export interface TurnResponseFrame extends BaseFrame {
  type: 'turn-response'
  // id matches the turn's id
  result: string
  exit_code: number
  usage?: TurnUsage | null
}

export interface ErrorCode {
  AUTH_FAILED: 'auth_failed'
  QUOTA_EXCEEDED: 'quota_exceeded'
  API_ERROR: 'api_error'
  INTERNAL: 'internal'
  PROTOCOL_MISMATCH: 'protocol_mismatch'
}

export type ErrorCodeValue = 'auth_failed' | 'quota_exceeded' | 'api_error' | 'internal' | 'protocol_mismatch'

export interface ErrorFrame extends BaseFrame {
  type: 'error'
  code: ErrorCodeValue
  message: string
  retryable: boolean
  details?: string | null
}

export interface HealthFrame extends BaseFrame {
  type: 'health'
  uptime_ms: number
  last_turn_ms_ago: number | null
  turns_completed: number
  memory_mb: number
  evicted_turns?: number
}

export interface AckFrame extends BaseFrame {
  type: 'ack'
  // id matches the shutdown's id
}

export type AgentFrame =
  | TurnAckFrame
  | StreamEventFrame
  | TurnResponseFrame
  | ErrorFrame
  | HealthFrame
  | AckFrame

export type Frame = HostFrame | AgentFrame

// ── Frame IDs ────────────────────────────────────────────────────────

/** Generate a unique frame ID. */
export function frameId(): string {
  return randomUUID()
}

// ── Serialization ────────────────────────────────────────────────────

/**
 * Serialize a frame to a line-delimited JSON string (with trailing \n).
 * Validates that the frame has the required base fields.
 */
export function serializeFrame(frame: Frame): string {
  // Validate required base fields
  if (!frame.protocol_version || !frame.type || !frame.id || !frame.timestamp) {
    throw new Error(
      `Frame missing required fields: protocol_version=${frame.protocol_version}, ` +
        `type=${frame.type}, id=${frame.id}, timestamp=${frame.timestamp}`
    )
  }
  if (frame.protocol_version !== PROTOCOL_VERSION) {
    throw new Error(
      `Protocol version mismatch: expected ${PROTOCOL_VERSION}, got ${frame.protocol_version}`
    )
  }
  return JSON.stringify(frame) + '\n'
}

// ── Parsing ──────────────────────────────────────────────────────────

const VALID_HOST_TYPES = new Set(['turn', 'shutdown', 'health-check'])
const VALID_AGENT_TYPES = new Set([
  'turn-ack',
  'stream-event',
  'turn-response',
  'error',
  'health',
  'ack',
])
const VALID_TYPES = new Set([...VALID_HOST_TYPES, ...VALID_AGENT_TYPES])

export class ProtocolError extends Error {
  constructor(
    message: string,
    public readonly code: 'parse' | 'version' | 'type' | 'field',
    public readonly raw?: string
  ) {
    super(message)
    this.name = 'ProtocolError'
  }
}

/**
 * Parse a raw line into a validated frame.
 *
 * @param line - A single line from stdin/stdout (may include trailing \n).
 * @param direction - 'host' to accept only host→agent types,
 *                    'agent' to accept only agent→host types,
 *                    'any' to accept both (for testing).
 * @throws ProtocolError if the line is not valid JSON or fails validation.
 */
export function parseFrame(
  line: string,
  direction: 'host' | 'agent' | 'any' = 'any'
): Frame {
  const trimmed = line.trim()
  if (!trimmed) {
    throw new ProtocolError('Empty line', 'parse', line)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (e) {
    throw new ProtocolError(
      `Invalid JSON: ${(e as Error).message}`,
      'parse',
      trimmed
    )
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ProtocolError('Frame must be a JSON object', 'parse', trimmed)
  }

  const frame = parsed as Record<string, unknown>

  // ── Validate base fields ──────────────────────────────────────

  if (typeof frame.protocol_version !== 'string') {
    throw new ProtocolError(
      'Missing or invalid protocol_version',
      'field',
      trimmed
    )
  }
  if (frame.protocol_version !== PROTOCOL_VERSION) {
    throw new ProtocolError(
      `Protocol version mismatch: expected ${PROTOCOL_VERSION}, got ${frame.protocol_version}`,
      'version',
      trimmed
    )
  }
  if (typeof frame.type !== 'string') {
    throw new ProtocolError('Missing or invalid type', 'field', trimmed)
  }
  if (!VALID_TYPES.has(frame.type)) {
    throw new ProtocolError(
      `Unknown frame type: ${frame.type}`,
      'type',
      trimmed
    )
  }

  // Direction enforcement
  if (direction === 'host' && !VALID_HOST_TYPES.has(frame.type)) {
    throw new ProtocolError(
      `Frame type '${frame.type}' is not a valid host→agent frame`,
      'type',
      trimmed
    )
  }
  if (direction === 'agent' && !VALID_AGENT_TYPES.has(frame.type)) {
    throw new ProtocolError(
      `Frame type '${frame.type}' is not a valid agent→host frame`,
      'type',
      trimmed
    )
  }

  if (typeof frame.id !== 'string' || !frame.id) {
    throw new ProtocolError('Missing or invalid id', 'field', trimmed)
  }
  if (typeof frame.timestamp !== 'string' || !frame.timestamp) {
    throw new ProtocolError('Missing or invalid timestamp', 'field', trimmed)
  }

  // ── Type-specific validation ──────────────────────────────────

  switch (frame.type) {
    case 'turn':
      if (!Array.isArray(frame.system)) {
        throw new ProtocolError(
          'Turn frame missing system blocks array',
          'field',
          trimmed
        )
      }
      if (typeof frame.prompt !== 'string') {
        throw new ProtocolError(
          'Turn frame missing prompt string',
          'field',
          trimmed
        )
      }
      break

    case 'turn-response':
      if (typeof frame.result !== 'string') {
        throw new ProtocolError(
          'TurnResponse frame missing result string',
          'field',
          trimmed
        )
      }
      if (typeof frame.exit_code !== 'number') {
        throw new ProtocolError(
          'TurnResponse frame missing exit_code number',
          'field',
          trimmed
        )
      }
      break

    case 'error':
      if (typeof frame.code !== 'string') {
        throw new ProtocolError(
          'Error frame missing code string',
          'field',
          trimmed
        )
      }
      if (typeof frame.message !== 'string') {
        throw new ProtocolError(
          'Error frame missing message string',
          'field',
          trimmed
        )
      }
      if (typeof frame.retryable !== 'boolean') {
        throw new ProtocolError(
          'Error frame missing retryable boolean',
          'field',
          trimmed
        )
      }
      break

    case 'health':
      if (typeof frame.uptime_ms !== 'number') {
        throw new ProtocolError(
          'Health frame missing uptime_ms number',
          'field',
          trimmed
        )
      }
      if (typeof frame.turns_completed !== 'number') {
        throw new ProtocolError(
          'Health frame missing turns_completed number',
          'field',
          trimmed
        )
      }
      if (typeof frame.memory_mb !== 'number') {
        throw new ProtocolError(
          'Health frame missing memory_mb number',
          'field',
          trimmed
        )
      }
      break

    case 'stream-event':
      if (typeof frame.event !== 'object' || frame.event === null) {
        throw new ProtocolError(
          'StreamEvent frame missing event object',
          'field',
          trimmed
        )
      }
      break

    // turn-ack, ack, shutdown, health-check: no extra fields required
  }

  return frame as unknown as Frame
}

// ── Frame builders ───────────────────────────────────────────────────
//
// Convenience functions that fill in protocol_version, id, and timestamp
// so callers only provide the meaningful fields.

function base(type: string, id?: string): BaseFrame {
  return {
    protocol_version: PROTOCOL_VERSION,
    type,
    id: id ?? frameId(),
    timestamp: new Date().toISOString(),
  }
}

// ── Host frame builders ──────────────────────────────────────────────

export function buildTurnFrame(opts: {
  system: SystemBlock[]
  prompt: string
  model?: string | null
  effort?: string | null
  max_tokens?: number | null
  tools?: ToolSchema[] | null
  cache_breakpoints?: number[] | null
}): TurnFrame {
  return {
    ...base('turn'),
    type: 'turn',
    system: opts.system,
    prompt: opts.prompt,
    ...(opts.model != null && { model: opts.model }),
    ...(opts.effort != null && { effort: opts.effort }),
    ...(opts.max_tokens != null && { max_tokens: opts.max_tokens }),
    ...(opts.tools != null && { tools: opts.tools }),
    ...(opts.cache_breakpoints != null && {
      cache_breakpoints: opts.cache_breakpoints,
    }),
  }
}

export function buildShutdownFrame(
  reason?: ShutdownFrame['reason']
): ShutdownFrame {
  return {
    ...base('shutdown'),
    type: 'shutdown',
    ...(reason && { reason }),
  }
}

export function buildHealthCheckFrame(): HealthCheckFrame {
  return {
    ...base('health-check'),
    type: 'health-check',
  }
}

// ── Agent frame builders ─────────────────────────────────────────────

export function buildTurnAckFrame(turnId: string): TurnAckFrame {
  return {
    ...base('turn-ack', turnId),
    type: 'turn-ack',
  }
}

export function buildStreamEventFrame(
  turnId: string,
  event: Record<string, unknown>
): StreamEventFrame {
  return {
    ...base('stream-event', turnId),
    type: 'stream-event',
    event,
  }
}

export function buildTurnResponseFrame(
  turnId: string,
  result: string,
  exitCode: number = 0,
  usage?: TurnUsage | null
): TurnResponseFrame {
  return {
    ...base('turn-response', turnId),
    type: 'turn-response',
    result,
    exit_code: exitCode,
    ...(usage != null && { usage }),
  }
}

export function buildErrorFrame(opts: {
  turnId?: string
  code: ErrorCodeValue
  message: string
  retryable: boolean
  details?: string | null
}): ErrorFrame {
  return {
    ...base('error', opts.turnId ?? 'system'),
    type: 'error',
    code: opts.code,
    message: opts.message,
    retryable: opts.retryable,
    ...(opts.details != null && { details: opts.details }),
  }
}

export function buildHealthFrame(opts: {
  checkId?: string
  uptime_ms: number
  last_turn_ms_ago: number | null
  turns_completed: number
  memory_mb: number
  evicted_turns?: number
}): HealthFrame {
  return {
    ...base('health', opts.checkId),
    type: 'health',
    uptime_ms: opts.uptime_ms,
    last_turn_ms_ago: opts.last_turn_ms_ago,
    turns_completed: opts.turns_completed,
    memory_mb: opts.memory_mb,
    ...(opts.evicted_turns != null && { evicted_turns: opts.evicted_turns }),
  }
}

export function buildAckFrame(shutdownId: string): AckFrame {
  return {
    ...base('ack', shutdownId),
    type: 'ack',
  }
}

// ── Line reader utility ──────────────────────────────────────────────

/**
 * Creates a line reader that processes a readable stream line-by-line.
 * Each complete line (terminated by \n) is passed to the callback.
 * Handles partial lines across chunk boundaries.
 */
export function createLineReader(
  onLine: (line: string) => void
): (chunk: string) => void {
  let buffer = ''
  return (chunk: string) => {
    buffer += chunk
    const parts = buffer.split('\n')
    buffer = parts.pop()! // last element is incomplete or empty
    for (const line of parts) {
      if (line.trim()) {
        onLine(line)
      }
    }
  }
}

// ── Token estimation (for history bounding §8) ───────────────────────

/**
 * Approximate token count using the 4-chars-per-token heuristic.
 * Exact tokenization isn't worth the overhead for eviction decisions.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Estimate token count for a message object (serialized as JSON).
 */
export function estimateMessageTokens(message: unknown): number {
  return estimateTokens(JSON.stringify(message))
}
