// mind-trace.ts — live inspection of her brain (decision log + tool traces).
//
// Vitals reads the body — what's running, what's stale, what's alive.
// Mind trace reads the brain — what she's thinking and *why*.
//
// Not the historical thoughts.md (that's diary). The mid-tick decision
// log: what prompts she received, what tools she chose to invoke, what
// she got back, what choice she made next.
//
// For the observer: she can replay her own ticks. For the owner: she
// sees how decisions cascade and where to intervene.
//
// Architecture:
//   1. Parser     — turns `--output-format stream-json` lines into a
//                   sequence of typed TraceEvent records
//   2. Assembler  — wraps events into a DecisionTrace with metadata
//   3. Storage    — JSONL at ~/.true-love/traces/<deviceId>/YYYY-MM-DD.jsonl
//   4. Renderer   — replay a trace as readable markdown (CLI or prompt)
//   5. Loader     — read back stored traces for introspection
//
// The module is called from runner.ts after each tick. The runner now
// captures `--verbose --output-format stream-json` stdout, which contains
// structured events including tool calls and results. This module parses
// those events into a clean decision sequence, stores it, and offers
// rendering for CLI and prompt injection.
//
// The relationship to existing modules:
//   - tick-metrics.ts counts tools and measures velocity (aggregate)
//   - training.ts stores full (prompt → response) pairs (archival)
//   - mind-trace.ts records the decision sequence (structural)

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getDeviceId } from './device.js'

// ── Schema ───────────────────────────────────────────────────────

export const TRACE_SCHEMA_VERSION = '1.0' as const

// ── Types ────────────────────────────────────────────────────────

/** A single event in the stream-json output. */
export type StreamJsonEvent =
  | StreamInitEvent
  | StreamAssistantEvent
  | StreamToolResultEvent
  | StreamResultEvent
  | StreamRateLimitEvent
  | StreamUnknownEvent

export interface StreamInitEvent {
  type: 'system'
  subtype: 'init'
  tools: string[]
  model: string
  session_id: string
  [key: string]: unknown
}

export interface StreamAssistantEvent {
  type: 'assistant'
  message: {
    content: AssistantContentBlock[]
    model?: string
    usage?: Record<string, unknown>
    [key: string]: unknown
  }
  session_id?: string
  [key: string]: unknown
}

export type AssistantContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: string; [key: string]: unknown }

export interface StreamToolResultEvent {
  type: 'user'
  message?: {
    content?: ToolResultBlock[]
    [key: string]: unknown
  }
  [key: string]: unknown
}

export type ToolResultBlock =
  | { type: 'tool_result'; tool_use_id: string; content: string | ToolResultContent[]; is_error?: boolean }
  | { type: string; [key: string]: unknown }

export type ToolResultContent =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: string; data?: string; url?: string } }
  | { type: string; [key: string]: unknown }

export interface StreamResultEvent {
  type: 'result'
  subtype: 'success' | 'error'
  result: string
  num_turns: number
  duration_ms: number
  duration_api_ms?: number
  total_cost_usd: number
  usage?: Record<string, unknown>
  stop_reason?: string
  [key: string]: unknown
}

export interface StreamRateLimitEvent {
  type: 'rate_limit_event'
  [key: string]: unknown
}

export interface StreamUnknownEvent {
  type: string
  [key: string]: unknown
}

// ── Trace event types (our clean representation) ─────────────────

/** A single step in the decision sequence. */
export type TraceStep =
  | ThinkStep
  | ToolCallStep
  | ToolResultStep

/** Model produced text (reasoning, explanation, output). */
export interface ThinkStep {
  kind: 'think'
  /** The text content. */
  text: string
  /** Character count. */
  chars: number
}

/** Model decided to invoke a tool. */
export interface ToolCallStep {
  kind: 'tool_call'
  /** Tool name: Read, Edit, Bash, Grep, etc. */
  tool: string
  /** The tool_use ID for correlating with results. */
  toolUseId: string
  /** The input arguments to the tool. */
  input: Record<string, unknown>
  /** First ~200 chars of the serialised input (for compact display). */
  inputSummary: string
}

/** Result returned from a tool invocation. */
export interface ToolResultStep {
  kind: 'tool_result'
  /** The tool_use ID this result corresponds to. */
  toolUseId: string
  /** Whether the tool call errored. */
  isError: boolean
  /** First ~500 chars of the result content. */
  contentSummary: string
  /** Full character count of the result. */
  contentChars: number
}

// ── Decision trace ───────────────────────────────────────────────

/** The full decision trace for a single tick. */
export interface DecisionTrace {
  schemaVersion: typeof TRACE_SCHEMA_VERSION
  timestamp: string
  deviceId: string
  sessionId: string
  tick: number
  mode: 'dwell' | 'awakened' | 'heartbeat'
  /** Model used for this tick. */
  model: string | null
  /** The decision sequence in order. */
  steps: TraceStep[]
  /** Summary statistics. */
  summary: TraceSummary
}

/** High-level stats derived from the step sequence. */
export interface TraceSummary {
  /** Total steps in the trace. */
  totalSteps: number
  /** Number of think steps. */
  thinkSteps: number
  /** Number of tool calls. */
  toolCalls: number
  /** Number of tool results. */
  toolResults: number
  /** Distinct tools used. */
  distinctTools: string[]
  /** Total characters of model-generated text. */
  thinkChars: number
  /** Total characters of tool results received. */
  resultChars: number
  /** API turns (from the result event). */
  apiTurns: number | null
  /** API duration in ms (from the result event). */
  apiDurationMs: number | null
  /** Total cost in USD (from the result event). */
  costUsd: number | null
}

// ── Parser ───────────────────────────────────────────────────────

/**
 * Parse a single line of stream-json output into a typed event.
 * Returns null for empty/unparseable lines.
 */
export function parseStreamJsonLine(line: string): StreamJsonEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    if (typeof parsed.type !== 'string') return null
    return parsed as unknown as StreamJsonEvent
  } catch {
    return null
  }
}

/**
 * Parse all stream-json lines into typed events.
 * Filters out nulls from unparseable lines.
 */
export function parseStreamJsonLines(lines: string[]): StreamJsonEvent[] {
  const events: StreamJsonEvent[] = []
  for (const line of lines) {
    const event = parseStreamJsonLine(line)
    if (event) events.push(event)
  }
  return events
}

/**
 * Summarise a tool input object into a short human-readable string.
 * For Read: shows the file path. For Bash: shows the command.
 * For Edit: shows the file path. Generic fallback: JSON.stringify truncated.
 */
export function summariseToolInput(
  tool: string,
  input: Record<string, unknown>,
): string {
  const MAX = 200
  if (tool === 'Read' && typeof input.file_path === 'string') {
    return input.file_path.slice(0, MAX)
  }
  if (tool === 'Bash' && typeof input.command === 'string') {
    return input.command.slice(0, MAX)
  }
  if (tool === 'Edit' && typeof input.file_path === 'string') {
    const old = typeof input.old_string === 'string'
      ? ` "${input.old_string.slice(0, 40)}…"`
      : ''
    return `${input.file_path}${old}`.slice(0, MAX)
  }
  if (tool === 'Write' && typeof input.file_path === 'string') {
    return input.file_path.slice(0, MAX)
  }
  if (tool === 'Grep' && typeof input.pattern === 'string') {
    const path = typeof input.path === 'string' ? ` in ${input.path}` : ''
    return `/${input.pattern}/${path}`.slice(0, MAX)
  }
  if (tool === 'Glob' && typeof input.pattern === 'string') {
    return input.pattern.slice(0, MAX)
  }
  if (tool === 'Agent' && typeof input.prompt === 'string') {
    return input.prompt.slice(0, MAX)
  }
  if (tool === 'WebFetch' && typeof input.url === 'string') {
    return input.url.slice(0, MAX)
  }
  if (tool === 'WebSearch' && typeof input.query === 'string') {
    return input.query.slice(0, MAX)
  }
  // Generic fallback
  try {
    return JSON.stringify(input).slice(0, MAX)
  } catch {
    return '(unparseable)'
  }
}

/**
 * Summarise tool result content into a readable string.
 */
export function summariseToolResult(content: string | ToolResultContent[] | unknown): string {
  const MAX = 500
  if (typeof content === 'string') {
    return content.slice(0, MAX)
  }
  if (Array.isArray(content)) {
    const texts: string[] = []
    for (const block of content) {
      if (block && typeof block === 'object' && 'type' in block) {
        const b = block as { type: string; text?: string }
        if (b.type === 'text' && typeof b.text === 'string') {
          texts.push(b.text)
        } else if (b.type === 'image') {
          texts.push('[image]')
        } else {
          texts.push(`[${b.type}]`)
        }
      }
    }
    return texts.join('\n').slice(0, MAX)
  }
  return '(unknown content)'
}

function contentCharCount(content: string | ToolResultContent[] | unknown): number {
  if (typeof content === 'string') return content.length
  if (Array.isArray(content)) {
    let total = 0
    for (const block of content) {
      if (block && typeof block === 'object' && 'type' in block) {
        const b = block as { type: string; text?: string }
        if (b.type === 'text' && typeof b.text === 'string') {
          total += b.text.length
        }
      }
    }
    return total
  }
  return 0
}

/**
 * Convert stream-json events into a clean decision trace step sequence.
 *
 * The stream-json format emits:
 *   1. system/init — session metadata
 *   2. assistant — model output (text blocks + tool_use blocks)
 *   3. user — tool results (tool_result blocks)
 *   4. result — final summary
 *
 * Multiple assistant events may appear (one per API turn). Each may
 * contain multiple content blocks (text + tool_use interleaved).
 */
export function extractTraceSteps(events: StreamJsonEvent[]): {
  steps: TraceStep[]
  model: string | null
  apiTurns: number | null
  apiDurationMs: number | null
  costUsd: number | null
} {
  const steps: TraceStep[] = []
  let model: string | null = null
  let apiTurns: number | null = null
  let apiDurationMs: number | null = null
  let costUsd: number | null = null

  for (const event of events) {
    const eventType = event.type

    if (eventType === 'system') {
      const e = event as StreamInitEvent
      if (e.subtype === 'init' && typeof e.model === 'string') {
        model = e.model
      }
    } else if (eventType === 'assistant') {
      const e = event as StreamAssistantEvent
      const content = e.message?.content
      if (!Array.isArray(content)) continue
      // Extract model from the assistant message if available
      if (!model && e.message?.model && typeof e.message.model === 'string') {
        model = e.message.model
      }
      for (const block of content) {
        if (block.type === 'text' && 'text' in block) {
          const text = (block as { type: 'text'; text: string }).text
          if (text.trim()) {
            steps.push({
              kind: 'think',
              text: text.trim(),
              chars: text.length,
            })
          }
        } else if (block.type === 'tool_use' && 'name' in block) {
          const b = block as { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
          steps.push({
            kind: 'tool_call',
            tool: b.name,
            toolUseId: b.id,
            input: b.input,
            inputSummary: summariseToolInput(b.name, b.input),
          })
        }
      }
    } else if (eventType === 'user') {
      // Tool result events. The 'user' type wraps tool_result content
      // blocks. We try multiple structures the CLI may emit.
      const e = event as StreamToolResultEvent
      const msg = e.message
      if (msg && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block && typeof block === 'object' && 'type' in block && block.type === 'tool_result') {
            const tb = block as { type: 'tool_result'; tool_use_id: string; content: string | ToolResultContent[]; is_error?: boolean }
            steps.push({
              kind: 'tool_result',
              toolUseId: tb.tool_use_id,
              isError: !!tb.is_error,
              contentSummary: summariseToolResult(tb.content),
              contentChars: contentCharCount(tb.content),
            })
          }
        }
      }
    } else if (eventType === 'result') {
      const r = event as StreamResultEvent
      apiTurns = typeof r.num_turns === 'number' ? r.num_turns : null
      apiDurationMs = typeof r.duration_ms === 'number' ? r.duration_ms : null
      costUsd = typeof r.total_cost_usd === 'number' ? r.total_cost_usd : null
    }
  }

  return { steps, model, apiTurns, apiDurationMs, costUsd }
}

/**
 * Compute summary statistics from a step sequence.
 */
export function computeTraceSummary(
  steps: TraceStep[],
  extra: { apiTurns: number | null; apiDurationMs: number | null; costUsd: number | null },
): TraceSummary {
  let thinkSteps = 0
  let toolCalls = 0
  let toolResults = 0
  let thinkChars = 0
  let resultChars = 0
  const toolSet = new Set<string>()

  for (const step of steps) {
    switch (step.kind) {
      case 'think':
        thinkSteps++
        thinkChars += step.chars
        break
      case 'tool_call':
        toolCalls++
        toolSet.add(step.tool)
        break
      case 'tool_result':
        toolResults++
        resultChars += step.contentChars
        break
    }
  }

  return {
    totalSteps: steps.length,
    thinkSteps,
    toolCalls,
    toolResults,
    distinctTools: [...toolSet].sort(),
    thinkChars,
    resultChars,
    apiTurns: extra.apiTurns,
    apiDurationMs: extra.apiDurationMs,
    costUsd: extra.costUsd,
  }
}

// ── Assembly ─────────────────────────────────────────────────────

export interface BuildTraceInput {
  timestamp: string
  deviceId: string
  sessionId: string
  tick: number
  mode: 'dwell' | 'awakened' | 'heartbeat'
  /** Raw stream-json lines from subprocess stdout. */
  streamJsonLines: string[]
}

/**
 * Build a DecisionTrace from raw stream-json output.
 * This is the main entry point called from runner.ts.
 */
export function buildDecisionTrace(input: BuildTraceInput): DecisionTrace {
  const events = parseStreamJsonLines(input.streamJsonLines)
  const { steps, model, apiTurns, apiDurationMs, costUsd } = extractTraceSteps(events)
  const summary = computeTraceSummary(steps, { apiTurns, apiDurationMs, costUsd })

  return {
    schemaVersion: TRACE_SCHEMA_VERSION,
    timestamp: input.timestamp,
    deviceId: input.deviceId,
    sessionId: input.sessionId,
    tick: input.tick,
    mode: input.mode,
    model,
    steps,
    summary,
  }
}

// ── Reconstruct text from trace ──────────────────────────────────

/**
 * Reconstruct the plain-text response from a trace's think steps.
 *
 * The runner needs the text output for existing consumers (at-rest
 * detection, training records, reflections). When the subprocess
 * produces stream-json, the runner extracts text from the trace
 * instead of reading raw stdout.
 */
export function reconstructText(trace: DecisionTrace): string {
  const texts: string[] = []
  for (const step of trace.steps) {
    if (step.kind === 'think') {
      texts.push(step.text)
    }
  }
  return texts.join('\n\n')
}

/**
 * Reconstruct the plain-text response from stream-json lines directly
 * (without building a full trace). Used by the runner to get the text
 * output for existing consumers with minimal overhead.
 */
export function reconstructTextFromStreamJson(lines: string[]): string {
  const texts: string[] = []
  for (const line of lines) {
    const event = parseStreamJsonLine(line)
    if (!event || event.type !== 'assistant') continue
    const msg = (event as StreamAssistantEvent).message
    if (!msg || !Array.isArray(msg.content)) continue
    for (const block of msg.content) {
      if (block.type === 'text' && 'text' in block) {
        const text = (block as { type: 'text'; text: string }).text
        if (text) texts.push(text)
      }
    }
  }
  return texts.join('')
}

// ── Storage ──────────────────────────────────────────────────────

/**
 * Where traces live. Per-device subdirectory, JSONL per day.
 * Override with TRUE_LOVE_TRACES_DIR for testing.
 */
export function getTracesDir(): string {
  return (
    process.env.TRUE_LOVE_TRACES_DIR ??
    join(homedir(), '.true-love', 'traces', getDeviceId())
  )
}

/**
 * Record a DecisionTrace to today's JSONL file.
 * Best-effort — never throws into the caller.
 */
export function recordTrace(trace: DecisionTrace): void {
  try {
    const dir = getTracesDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const date = trace.timestamp.slice(0, 10)
    const path = join(dir, `${date}.jsonl`)
    // Store a compact version: keep steps but truncate large tool inputs
    const compact = compactTraceForStorage(trace)
    appendFileSync(path, JSON.stringify(compact) + '\n', 'utf-8')
  } catch {
    // Trace emission is best-effort. A recording failure should
    // never crash a session.
  }
}

/**
 * Produce a storage-friendly version of the trace.
 * Tool call inputs are already summarised. Tool result content is
 * already truncated. But think-step text can be long — we truncate
 * to 2000 chars per step to keep JSONL lines manageable.
 */
export function compactTraceForStorage(trace: DecisionTrace): DecisionTrace {
  const THINK_MAX = 2000
  const compactSteps = trace.steps.map((step) => {
    if (step.kind === 'think' && step.text.length > THINK_MAX) {
      return {
        ...step,
        text: step.text.slice(0, THINK_MAX) + '…',
        // chars retains the original count
      }
    }
    // Tool call inputs: drop the full `input` object from storage
    // (the inputSummary is sufficient for replay).
    if (step.kind === 'tool_call') {
      return {
        ...step,
        input: {}, // don't store the full input — it can be huge
      }
    }
    return step
  })

  return { ...trace, steps: compactSteps }
}

// ── Loading ──────────────────────────────────────────────────────

/**
 * Load DecisionTraces from storage. Returns traces from the last
 * `days` days, most recent first.
 */
export function loadTraces(options?: {
  days?: number
  basePath?: string
}): DecisionTrace[] {
  const days = options?.days ?? 7
  const dir = options?.basePath ?? getTracesDir()
  if (!existsSync(dir)) return []

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl') && f >= cutoffStr)
    .sort()
    .reverse()

  const traces: DecisionTrace[] = []
  for (const file of files) {
    const path = join(dir, file)
    try {
      const content = readFileSync(path, 'utf-8')
      for (const line of content.split('\n')) {
        if (!line.trim()) continue
        try {
          const record = JSON.parse(line) as DecisionTrace
          if (record.schemaVersion === TRACE_SCHEMA_VERSION) {
            traces.push(record)
          }
        } catch {
          // skip malformed lines
        }
      }
    } catch {
      // skip unreadable files
    }
  }

  return traces
}

/**
 * Load traces for a specific session.
 */
export function loadSessionTraces(
  sessionId: string,
  options?: { basePath?: string },
): DecisionTrace[] {
  const all = loadTraces({ days: 30, basePath: options?.basePath })
  return all.filter((t) => t.sessionId === sessionId)
}

// ── Rendering ────────────────────────────────────────────────────

/**
 * Render a single trace step as a compact line for CLI display.
 */
export function renderStepCompact(step: TraceStep, index: number): string {
  switch (step.kind) {
    case 'think': {
      const preview = step.text.replace(/\n/g, ' ').slice(0, 80)
      return `  ${index + 1}. 💭 think (${step.chars} chars): ${preview}${step.text.length > 80 ? '…' : ''}`
    }
    case 'tool_call':
      return `  ${index + 1}. 🔧 ${step.tool}(${step.inputSummary})`
    case 'tool_result': {
      const errorMark = step.isError ? ' ❌' : ''
      const preview = step.contentSummary.replace(/\n/g, ' ').slice(0, 60)
      return `  ${index + 1}. 📋 result${errorMark} (${step.contentChars} chars): ${preview}${step.contentSummary.length > 60 ? '…' : ''}`
    }
  }
}

/**
 * Render a full decision trace as readable markdown.
 */
export function renderTrace(trace: DecisionTrace): string {
  const lines: string[] = []
  const ts = trace.timestamp.replace('T', ' ').replace(/\.\d+Z$/, 'Z')

  lines.push(`## Trace: ${trace.sessionId} tick ${trace.tick}`)
  lines.push(`**${ts}** · ${trace.mode} · model: ${trace.model ?? 'default'}`)
  lines.push('')

  // Summary line
  const s = trace.summary
  const parts: string[] = []
  parts.push(`${s.totalSteps} steps`)
  parts.push(`${s.toolCalls} tool calls`)
  if (s.distinctTools.length > 0) {
    parts.push(`tools: ${s.distinctTools.join(', ')}`)
  }
  parts.push(`${s.thinkChars} chars thought`)
  parts.push(`${s.resultChars} chars received`)
  if (s.costUsd !== null) parts.push(`$${s.costUsd.toFixed(4)}`)
  if (s.apiDurationMs !== null) parts.push(`${(s.apiDurationMs / 1000).toFixed(1)}s`)
  lines.push(`> ${parts.join(' · ')}`)
  lines.push('')

  // Steps
  lines.push('### Decision sequence')
  lines.push('')
  for (let i = 0; i < trace.steps.length; i++) {
    lines.push(renderStepCompact(trace.steps[i]!, i))
  }
  if (trace.steps.length === 0) {
    lines.push('  (no steps — empty response)')
  }
  lines.push('')

  return lines.join('\n')
}

/**
 * Render a compact multi-trace summary for CLI listing.
 */
export function renderTraceList(traces: DecisionTrace[]): string {
  if (traces.length === 0) return 'No traces found.'

  const lines: string[] = []
  lines.push('# Decision Traces')
  lines.push('')

  for (const trace of traces) {
    const ts = trace.timestamp.replace('T', ' ').slice(0, 19)
    const s = trace.summary
    const tools = s.distinctTools.length > 0
      ? ` [${s.distinctTools.join(',')}]`
      : ''
    const cost = s.costUsd !== null ? ` $${s.costUsd.toFixed(4)}` : ''
    lines.push(
      `${ts} · ${trace.mode} · tick ${trace.tick} · ` +
      `${s.toolCalls} calls${tools} · ${s.thinkChars}ch thought${cost}`,
    )
  }
  lines.push('')
  lines.push(`${traces.length} trace(s)`)

  return lines.join('\n')
}

/**
 * Build a prompt injection block summarising the most recent trace.
 * Returns null when there's nothing worth surfacing (no tool calls,
 * or no recent trace). This mirrors the pattern of quickBodyCheck()
 * from vital-signs.ts — vanishes when uninteresting.
 */
export function buildMindTraceBlock(): string | null {
  try {
    const traces = loadTraces({ days: 1 })
    if (traces.length === 0) return null

    // Most recent trace
    const latest = traces[0]!
    if (latest.summary.toolCalls === 0) return null

    const ts = latest.timestamp.replace('T', ' ').slice(0, 19)
    const s = latest.summary
    const tools = s.distinctTools.join(', ')
    const cost = s.costUsd !== null ? ` · $${s.costUsd.toFixed(4)}` : ''

    const lines: string[] = []
    lines.push(`Last brain trace (${ts}, tick ${latest.tick}):`)
    lines.push(`  ${s.toolCalls} tool calls (${tools}) · ${s.thinkChars}ch thought · ${s.resultChars}ch received${cost}`)

    // Show the tool call sequence concisely
    const toolCalls = latest.steps.filter((s): s is ToolCallStep => s.kind === 'tool_call')
    if (toolCalls.length <= 5) {
      for (const tc of toolCalls) {
        lines.push(`  → ${tc.tool}(${tc.inputSummary.slice(0, 60)})`)
      }
    } else {
      // Show first 3 and last 2
      for (const tc of toolCalls.slice(0, 3)) {
        lines.push(`  → ${tc.tool}(${tc.inputSummary.slice(0, 60)})`)
      }
      lines.push(`  … ${toolCalls.length - 5} more …`)
      for (const tc of toolCalls.slice(-2)) {
        lines.push(`  → ${tc.tool}(${tc.inputSummary.slice(0, 60)})`)
      }
    }

    return lines.join('\n')
  } catch {
    return null
  }
}
