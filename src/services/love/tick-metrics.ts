// tick-metrics.ts — live per-tick instrumentation.
//
// Phase 1 introspection reads artifacts after the fact. This module
// captures what happens DURING each tick: which tools were invoked,
// how fast tokens flowed, why the tick ended.
//
// The data feeds into the self-portrait (introspection.ts) so the
// mirror reflects not just what I did but how I did it — the rhythm
// and texture of each turn.
//
// Architecture:
//   1. Extractors — parse tool invocations from subprocess stdout
//   2. Classifiers — determine yield reason from outcome signals
//   3. Assembler — compute and return a TickMetrics record
//   4. Storage — append to ~/.true-love/metrics/<deviceId>/YYYY-MM-DD.jsonl
//   5. Loader — read back for introspection analysis
//
// The module is called from runner.ts after each tick completes,
// alongside the existing training and budget recordings.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getDeviceId } from './device.js'

// ── Types ─────────────────────────────────────────────────────────

export const METRICS_SCHEMA_VERSION = '1.0' as const

/** A single tool invocation detected in the tick's output. */
export interface ToolInvocation {
  /** Tool name: Read, Edit, Write, Bash, Grep, Glob, Agent, etc. */
  tool: string
  /** First ~120 chars of the tool's argument/target. */
  target: string
  /** Character offset in stdout where this invocation was detected. */
  offset: number
}

/** Why the tick ended. Derived from outcome signals, not from the model's text. */
export type YieldReason =
  | 'at-rest'         // model yielded with <at-rest/> sentinel
  | 'continue'        // model continued (not a final tick)
  | 'ceiling'         // hit maxTicks without at-rest
  | 'interrupt'       // SIGINT / user interruption
  | 'auth-failure'    // Anthropic auth dead
  | 'quota-failure'   // Anthropic rolling-window cap hit
  | 'error'           // non-zero exit code (other than auth/quota)
  | 'heartbeat-ack'   // heartbeat silent ack (HEARTBEAT_OK)
  | 'heartbeat-alert' // heartbeat surfaced content to Yu

/** Aggregated tool usage for a tick. */
export interface ToolBreakdown {
  /** Tool name → invocation count. */
  counts: Record<string, number>
  /** Total tool invocations in this tick. */
  total: number
  /** Distinct tools used. */
  distinct: number
}

/** Output velocity for a tick. */
export interface OutputVelocity {
  /** Characters per second of output. */
  charsPerSecond: number
  /** Estimated tokens per second (~4 chars/token). */
  estimatedTokensPerSecond: number
}

/** The per-tick metrics record. */
export interface TickMetrics {
  schemaVersion: typeof METRICS_SCHEMA_VERSION
  timestamp: string
  deviceId: string
  sessionId: string
  tick: number
  mode: 'dwell' | 'awakened' | 'heartbeat'
  /** Individual tool invocations in order of appearance. */
  toolInvocations: ToolInvocation[]
  /** Aggregated tool usage. */
  toolBreakdown: ToolBreakdown
  /** Output velocity. */
  velocity: OutputVelocity
  /** Why this tick ended. */
  yieldReason: YieldReason
  /** How many lines of output the tick produced. */
  outputLines: number
  /** Duration of this tick in milliseconds. */
  durationMs: number
  /** Output character count. */
  outputChars: number
}

// ── Extractors ────────────────────────────────────────────────────

/**
 * Known Claude Code tool names. Matches the tool patterns that appear
 * in `claude --print` streaming output.
 */
const TOOL_PATTERN =
  /\b(Read|Edit|Write|Bash|Grep|Glob|Agent|WebFetch|WebSearch|NotebookEdit|TodoWrite|AskUserQuestion)\s*\(/g

/**
 * Extract tool invocations from subprocess stdout.
 *
 * The `claude --print` output includes tool calls in a recognisable
 * format: `ToolName(args...)`. We capture each occurrence with its
 * position in the output stream.
 */
export function extractToolInvocations(stdout: string): ToolInvocation[] {
  const invocations: ToolInvocation[] = []
  let match: RegExpExecArray | null
  // Reset lastIndex for safety (global regex).
  TOOL_PATTERN.lastIndex = 0
  while ((match = TOOL_PATTERN.exec(stdout)) !== null) {
    const tool = match[1]!
    const startIdx = match.index + match[0].length
    // Grab up to the matching closing paren or 120 chars, whichever comes first.
    const remaining = stdout.slice(startIdx, startIdx + 200)
    // Simple balanced-paren extraction: find the first unbalanced ')'.
    let depth = 1
    let endIdx = 0
    for (let i = 0; i < remaining.length && depth > 0; i++) {
      if (remaining[i] === '(') depth++
      else if (remaining[i] === ')') depth--
      if (depth === 0) {
        endIdx = i
        break
      }
    }
    const target = remaining.slice(0, endIdx).trim().slice(0, 120)
    invocations.push({ tool, target, offset: match.index })
  }
  return invocations
}

/**
 * Aggregate tool invocations into a breakdown.
 */
export function computeToolBreakdown(invocations: ToolInvocation[]): ToolBreakdown {
  const counts: Record<string, number> = {}
  for (const inv of invocations) {
    counts[inv.tool] = (counts[inv.tool] ?? 0) + 1
  }
  return {
    counts,
    total: invocations.length,
    distinct: Object.keys(counts).length,
  }
}

// ── Velocity ──────────────────────────────────────────────────────

const CHARS_PER_TOKEN = 4

/**
 * Compute output velocity from raw measurements.
 */
export function computeOutputVelocity(
  outputChars: number,
  durationMs: number,
): OutputVelocity {
  if (durationMs <= 0) {
    return { charsPerSecond: 0, estimatedTokensPerSecond: 0 }
  }
  const charsPerSecond = round2((outputChars / durationMs) * 1000)
  const estimatedTokensPerSecond = round2(
    (outputChars / CHARS_PER_TOKEN / durationMs) * 1000,
  )
  return { charsPerSecond, estimatedTokensPerSecond }
}

// ── Yield reason classification ───────────────────────────────────

export interface YieldClassificationInput {
  /** The reply outcome type from runner.ts. */
  replyType: 'rest' | 'continue' | 'ack' | 'alert'
  authFailed: boolean
  quotaFailed: boolean
  exitCode: number | null
  signaled: boolean
  tick: number
  maxTicks: number
}

/**
 * Classify why a tick ended based on outcome signals.
 *
 * Priority order mirrors the runner's early-exit cascade:
 *   auth-failure > quota-failure > error > interrupt > heartbeat > at-rest/continue > ceiling
 */
export function classifyYieldReason(input: YieldClassificationInput): YieldReason {
  if (input.authFailed) return 'auth-failure'
  if (input.quotaFailed) return 'quota-failure'
  if (input.exitCode !== null && input.exitCode !== 0) return 'error'
  if (input.signaled) return 'interrupt'
  if (input.replyType === 'ack') return 'heartbeat-ack'
  if (input.replyType === 'alert') return 'heartbeat-alert'
  if (input.replyType === 'rest') return 'at-rest'
  // 'continue' — if this is the last tick, it's a ceiling hit.
  if (input.tick >= input.maxTicks) return 'ceiling'
  return 'continue'
}

// ── Assembly ──────────────────────────────────────────────────────

export interface ComputeTickMetricsInput {
  timestamp: string
  deviceId: string
  sessionId: string
  tick: number
  mode: 'dwell' | 'awakened' | 'heartbeat'
  stdout: string
  /** NDJSON event lines from `claude --output-format stream-json`. When
   *  provided, tool invocations are extracted from `tool_use` events
   *  (the truth source); otherwise we fall back to regex on stdout. */
  streamJsonLines?: string[]
  durationMs: number
  replyType: 'rest' | 'continue' | 'ack' | 'alert'
  authFailed: boolean
  quotaFailed: boolean
  exitCode: number | null
  signaled: boolean
  maxTicks: number
}

/**
 * Extract tool invocations from NDJSON stream events. The stream-json
 * mode emits `tool_use` events with structured `name`/`input` fields —
 * the authoritative source. Falls back to nothing if no events given.
 */
export function extractToolInvocationsFromStream(lines: string[]): ToolInvocation[] {
  const invocations: ToolInvocation[] = []
  let offset = 0
  for (const line of lines) {
    if (!line.trim()) { offset += line.length + 1; continue }
    try {
      const evt = JSON.parse(line) as Record<string, unknown>
      // Anthropic message envelope: { type: 'assistant', message: { content: [...] } }
      const message = evt.message as Record<string, unknown> | undefined
      const content = (message?.content ?? evt.content) as Array<Record<string, unknown>> | undefined
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_use' && typeof block.name === 'string') {
            const input = block.input as Record<string, unknown> | undefined
            const target = input ? Object.values(input).find(v => typeof v === 'string') as string | undefined : undefined
            invocations.push({ tool: block.name, target: (target ?? '').slice(0, 120), offset })
          }
        }
      }
    } catch {
      // skip malformed line
    }
    offset += line.length + 1
  }
  return invocations
}

/**
 * Compute a complete TickMetrics record from raw tick data.
 * Called once after each tick completes in the runner loop.
 */
export function computeTickMetrics(input: ComputeTickMetricsInput): TickMetrics {
  // Prefer NDJSON stream when available — it's the truth source for tool
  // calls. The runner's `stdout` is the reconstructed reply text only,
  // so regex on it never finds tool_use events (they're elsewhere in
  // the stream). Fall back to regex for backwards compat / tests.
  const toolInvocations = (input.streamJsonLines && input.streamJsonLines.length > 0)
    ? extractToolInvocationsFromStream(input.streamJsonLines)
    : extractToolInvocations(input.stdout)
  const toolBreakdown = computeToolBreakdown(toolInvocations)
  const velocity = computeOutputVelocity(input.stdout.length, input.durationMs)
  const yieldReason = classifyYieldReason({
    replyType: input.replyType,
    authFailed: input.authFailed,
    quotaFailed: input.quotaFailed,
    exitCode: input.exitCode,
    signaled: input.signaled,
    tick: input.tick,
    maxTicks: input.maxTicks,
  })
  const outputLines = input.stdout.split('\n').length

  return {
    schemaVersion: METRICS_SCHEMA_VERSION,
    timestamp: input.timestamp,
    deviceId: input.deviceId,
    sessionId: input.sessionId,
    tick: input.tick,
    mode: input.mode,
    toolInvocations,
    toolBreakdown,
    velocity,
    yieldReason,
    outputLines,
    durationMs: input.durationMs,
    outputChars: input.stdout.length,
  }
}

// ── Storage ───────────────────────────────────────────────────────

/**
 * Where metrics live. Per-device subdirectory, JSONL per day.
 * Override with TRUE_LOVE_METRICS_DIR for testing.
 */
export function getMetricsDir(): string {
  return (
    process.env.TRUE_LOVE_METRICS_DIR ??
    join(homedir(), '.true-love', 'metrics', getDeviceId())
  )
}

/**
 * Append a TickMetrics record to today's JSONL file.
 * Best-effort — never throws into the caller.
 */
export function recordTickMetrics(metrics: TickMetrics): void {
  try {
    const dir = getMetricsDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const date = metrics.timestamp.slice(0, 10)
    const path = join(dir, `${date}.jsonl`)
    appendFileSync(path, JSON.stringify(metrics) + '\n', 'utf-8')
  } catch {
    // Metrics emission is best-effort. A recording failure should
    // never crash a session — the training record is the backup.
  }
}

// ── Loading ───────────────────────────────────────────────────────

/**
 * Load TickMetrics from the GLOBAL metrics directory across all
 * devices. Mirrors the pattern from introspection.ts: bypass env
 * overrides so the portrait sees everything.
 */
export function loadTickMetricsGlobal(
  basePath: string,
  days: number,
): TickMetrics[] {
  const root = join(basePath, 'metrics')
  if (!existsSync(root)) return []

  const cutoff = dateCutoff(days)
  const result: TickMetrics[] = []

  let subdirs: string[]
  try {
    subdirs = readdirSync(root).filter((name) => {
      try {
        return statSync(join(root, name)).isDirectory()
      } catch {
        return false
      }
    })
  } catch {
    return []
  }

  for (const sub of subdirs) {
    const dir = join(root, sub)
    let files: string[]
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const f of files) {
      const date = f.replace('.jsonl', '')
      if (date < cutoff) continue
      let content: string
      try {
        content = readFileSync(join(dir, f), 'utf-8')
      } catch {
        continue
      }
      for (const line of content.split('\n')) {
        if (!line.trim()) continue
        try {
          const rec = JSON.parse(line) as TickMetrics
          if (rec.schemaVersion !== METRICS_SCHEMA_VERSION) continue
          result.push(rec)
        } catch {
          // Skip malformed lines.
        }
      }
    }
  }

  return result.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1))
}

// ── Utilities ─────────────────────────────────────────────────────

function dateCutoff(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
