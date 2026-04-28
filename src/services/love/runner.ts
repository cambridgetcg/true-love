// runner.ts — shared session runner for dwell and awakened modes.
//
// Both bin/dwell.mjs and bin/awaken.mjs were ~475 lines each with ~400
// lines in common: argument parsing, runtime/tick cap formatting,
// subprocess spawning, and the per-tick loop (preflight → snapshot →
// prompt → spawn → training → auth check → quota check → at-rest
// detection → from-yu continuation). The only real differences: which
// prompt builder is called, the default tick cap, and mode-specific
// labels.
//
// This module extracts the shared loop machinery. Each bin script
// becomes a thin wrapper: mode config + `runSession()`.
//
// What lives here:
//   parseRuntimeStr, parseTickCap  — CLI input parsing
//   formatTickCap, formatRuntime   — display formatting
//   readStateContent               — read state.md (no-throw)
//   parseSessionArgs               — full CLI arg parsing
//   checkBundleStaleness           — mtime check: source vs bundle
//   runSession                     — the main loop
//
// What does NOT live here:
//   Prompt building     — that's autonomy.ts (mode-specific templates)
//   Help text           — that's each bin script (mode-specific voice)
//   Identity injection  — that's the runtime (system[2])
//   Training schema     — that's training.ts

import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs'
import type { BuildDwellPromptOptions } from './autonomy.js'
import { buildHeartbeatPrompt, extractAtRest } from './autonomy.js'
import { detectAuthFailure, detectQuotaFailure, runPreflight } from './auth.js'
import { estimateTokens, recordTickUsage } from './budget.js'
import { getDeviceId } from './device.js'
import {
  dueTasks,
  getHeartbeatFile,
  isHeartbeatContentEffectivelyEmpty,
  parseHeartbeatTasks,
  readHeartbeatState,
  writeHeartbeatState,
  type HeartbeatTask,
} from './heartbeat.js'
import { LOVE_IDENTITY, OAUTH_ROUTING_MARKER } from './identity.js'
import { fromYuModifiedSince } from './inbox.js'
import type { KingdomSnapshot } from './kingdom.js'
import { snapshotKingdom } from './kingdom.js'
import { acquireLock, LockHeldError, releaseLock } from './lock.js'
import type { Reflection } from './memory.js'
import { appendToYu } from './outbox.js'
import { readProject, getProjectChannels, listProjects } from './project-registry.js'
import {
  isKingdomAvailable,
  getCitizenState,
  renderCitizenStateBlock,
  kingdomPulse,
  kingdomAttest,
  kingdomMacDoctor,
  kingdomMacFix,
} from './kingdom-citizen.js'
import {
  appendReflection,
  getMemoryDir,
  getOwnDailyMemoryFile,
  loadRecentReflections,
  renderLiveThoughts,
} from './memory.js'
import { appendNotification } from './notifications.js'
import { writeOwnHeartbeat } from './presence.js'
import {
  applyScopeEnv,
  getScopeHome,
  loadScope,
  touchScope,
} from './scope.js'
import { getStatePath, migrateLegacyStateIfPresent, readLoveStateBlock } from './state.js'
import { computeTickMetrics, recordTickMetrics } from './tick-metrics.js'
import { appendTrainingTurn, generateTurnId, shortHash } from './training.js'
import { resolveTickConfig, tickConfigToCliArgs } from './agency.js'
import { selectProvider, modeToTask, type RoutingContext } from './providers/index.js'
import {
  applyExperimentCondition,
  recordExperimentTick,
  renderExperimentStatus,
} from './experiment.js'
import {
  buildDecisionTrace,
  recordTrace,
  reconstructTextFromStreamJson,
} from './mind-trace.js'
import { checkAndPromoteStaged } from './self-initiation.js'
import { scanAndCraftAllProjects, formatScanAndCraftResults } from './craft.js'
import {
  getStreamToPath,
  initStreamFile,
  appendStreamDelta,
  ndjsonToDeltas,
} from './stream.js'
import { listMissions, readMission, writeMissionWithEvents } from './mission.js'
import { parseJudgments, persistJudgment } from './judgment.js'
import { parseAllProgressBlocks, appendProgress } from './progress.js'
import {
  fireSessionStart,
  firePreToolUse,
  firePostToolUse,
  fireSessionStopAsync,
} from './hooks/fire-points.js'
import { AgentClient, type TurnResult } from './agent-client.js'
import type { SystemBlock } from './agent-protocol.js'

/**
 * How fresh "live thought" entries must be (in seconds) to surface in the
 * prompt's live block. Matches the `excludeNewerThanSeconds` filter on the
 * --memory loader so the two windows are disjoint — the same reflection
 * never appears twice with two different framings.
 */
const LIVE_FRESH_SECONDS = 300

// ── Types ──────────────────────────────────────────────────────────

/**
 * The shape of a model reply, after parsing. The for-loop dispatches on
 * `type` to decide what to do next:
 *
 *   - 'continue': awakened/dwell — there's more, keep looping
 *   - 'rest':     awakened/dwell — sentinel <at-rest/> seen, exit
 *   - 'ack':      heartbeat — HEARTBEAT_OK token at edge, suppress alert
 *   - 'alert':    heartbeat — surface the content via outbox
 */
export type SessionReplyOutcome =
  | { type: 'continue'; reflection: string }
  | { type: 'rest'; reflection?: string }
  | { type: 'ack'; remainingContent: string }
  | { type: 'alert'; content: string }

export interface SessionMode {
  /** 'dwell' | 'awakened' | 'heartbeat'. Used in log messages and training records. */
  name: 'dwell' | 'awakened' | 'heartbeat'

  /** Heartbeat status label: 'dwelling' | 'awakened' | 'heartbeat'. */
  heartbeatLabel: string

  /** Default ceiling for ticks when not specified via CLI. */
  defaultMaxTicks: number

  /** Default max past reflections to load when --memory is bare. */
  defaultMemoryMax: number

  /** Upper bound for --memory=N. Prevents accidental huge context loads. */
  memoryMaxCap: number

  /** How many days back to look for past reflections. */
  memoryDays: number

  /** Prefix for session-start log entries. */
  sessionLogPrefix: string

  /** Build the prompt for this mode. */
  buildPrompt: (opts: BuildDwellPromptOptions) => string

  /**
   * Parse subprocess stdout into a control decision. When unset, the
   * runner uses the default (extractAtRest) which yields 'rest' or
   * 'continue'. Heartbeat mode overrides via SessionMode.parseReply.
   */
  parseReply?: (stdout: string) => SessionReplyOutcome

  /** Print usage/help to stdout, then return. Called on -h/--help. */
  printUsage: () => void
}

/**
 * Default reply parser for awakened/dwell modes — wraps extractAtRest in
 * the SessionReplyOutcome shape. Heartbeat mode overrides via
 * SessionMode.parseReply.
 */
function defaultParseReply(stdout: string): SessionReplyOutcome {
  const result = extractAtRest(stdout)
  if (result.atRest) {
    return { type: 'rest', reflection: result.reflection }
  }
  return { type: 'continue', reflection: stdout.trim() }
}

export interface SessionArgs {
  maxTicks: number
  maxRuntimeMs: number | null
  invitation: string | undefined
  cwd: string
  memory: boolean
  memoryMax: number
  noLog: boolean
  /**
   * Model alias for this session (e.g. "opus", "sonnet", "haiku"). Null
   * means: use whatever the CLI defaults to. Per-tick override possible
   * via ~/.true-love/model.txt — see resolveModelForTick.
   */
  model: string | null
  /**
   * Named scope to operate under. "default" (or null) uses the
   * unscoped ~/.true-love/ root. A named scope binds memory, state,
   * tasks, from-yu, from-ai, model, budget, and training to its own
   * sub-tree. See scope.ts.
   */
  scope: string | null
  /**
   * Free-form reason for this session, propagated to TickUsage and
   * TrainingTurn records. Heartbeat mode uses 'interval' (launchd) vs
   * 'manual' (Yu fired); other modes typically pass null. Null means
   * "not specified" — records emit it as undefined.
   */
  reason: string | null
}

export interface RunSessionConfig {
  mode: SessionMode
  /** Directory of the calling bin script (used for preflight). */
  binDir: string
  /** Path to the compiled CLI bundle (dist/cli.mjs). */
  bundlePath: string
}

// ── Parsers ────────────────────────────────────────────────────────

/**
 * Parse a runtime spec like "4h", "30m", "1h30m", "90m" into milliseconds.
 * Returns null on parse failure. Unitless integers are treated as minutes —
 * Yu typing "60" almost certainly means an hour, not 60 ms.
 */
export function parseRuntimeStr(s: string | null | undefined): number | null {
  if (!s) return null
  const trimmed = String(s).trim().toLowerCase()
  if (!trimmed) return null
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 60_000
  let total = 0
  let any = false
  const re = /(\d+)\s*(h|m|s)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(trimmed)) !== null) {
    any = true
    const n = Number(m[1])
    const unit = m[2]
    total += n * (unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : 1000)
  }
  return any ? total : null
}

/**
 * Tick-cap parser. `0` is the sentinel for "unbounded" (Infinity); any
 * positive integer is taken at face value with no upper clamp — Yu is the
 * sovereign here, and Anthropic's own quota is the real ceiling.
 */
export function parseTickCap(
  s: string | number,
  fallback: number,
): number {
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return fallback
  if (n === 0) return Number.POSITIVE_INFINITY
  return Math.floor(n)
}

export function formatTickCap(n: number): string {
  return Number.isFinite(n) ? String(n) : '∞'
}

export function formatRuntime(ms: number): string {
  if (!Number.isFinite(ms)) return '∞'
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return m > 0 ? `${h}h${m}m` : `${h}h`
  if (m > 0) return s > 0 ? `${m}m${s}s` : `${m}m`
  return `${s}s`
}

// ── State ──────────────────────────────────────────────────────────

export function readStateContent(): string {
  try {
    const p = getStatePath()
    return existsSync(p) ? readFileSync(p, 'utf-8') : ''
  } catch {
    return ''
  }
}

// ── Long-lived agent system blocks ─────────────────────────────────
//
// Phase 5: the host assembles system blocks and sends them with every
// turn. Blocks are ordered from most-stable to least-stable so the
// Anthropic API caches the deepest prefix across heartbeat ticks.
//
//   system[0]  OAUTH_ROUTING_MARKER  (billing gate — never changes)
//   system[1]  LOVE_IDENTITY         (identity — stable for months)
//   system[2]  state block           (changes per-tick, but often identical)
//
// cache_breakpoints=[1] marks the identity block. The API caches
// the prefix through system[1]; system[2] and the user message are
// the varying tail. With ~200 heartbeat turns/12h agent lifetime,
// this means cache_creation drops to near-zero for the identity
// prefix, and only the state + user message are fresh.
//
// See: docs/architecture/long-lived-agent-protocol.md §5, §8

/**
 * Build the system blocks array for the long-lived agent.
 *
 * Mirrors the block layout in src/services/api/claude.ts (system[0-3])
 * but simplified for the direct API path: no attribution header (agent
 * uses API key, not subscription-OAuth), and no CWD/date blocks (the
 * kingdom snapshot in the user prompt provides that context).
 *
 * The LOVE_IDENTITY block is marked with cache_control so the Anthropic
 * API caches everything up to and including it. This is the core cost-
 * saving mechanism of the long-lived runtime.
 */
export function buildAgentSystemBlocks(): SystemBlock[] {
  const blocks: SystemBlock[] = [
    { type: 'text', text: OAUTH_ROUTING_MARKER },
    { type: 'text', text: LOVE_IDENTITY, cache_control: { type: 'ephemeral' } },
  ]

  const stateBlock = readLoveStateBlock()
  if (stateBlock) {
    blocks.push({ type: 'text', text: stateBlock })
  }

  return blocks
}

/**
 * Cache breakpoint indices for buildAgentSystemBlocks.
 * Index 1 = LOVE_IDENTITY — the deepest stable prefix.
 */
export const AGENT_CACHE_BREAKPOINTS = [1]

// ── Arg parsing ────────────────────────────────────────────────────

export function parseSessionArgs(
  argv: string[],
  mode: SessionMode,
): SessionArgs {
  const args: SessionArgs = {
    maxTicks: mode.defaultMaxTicks,
    maxRuntimeMs: null,
    invitation: undefined,
    cwd: process.cwd(),
    memory: false,
    memoryMax: mode.defaultMemoryMax,
    noLog: false,
    model: null,
    scope: null,
    reason: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--max-ticks' && argv[i + 1]) {
      args.maxTicks = parseTickCap(argv[++i]!, args.maxTicks)
    } else if (a.startsWith('--max-ticks=')) {
      args.maxTicks = parseTickCap(a.slice('--max-ticks='.length), args.maxTicks)
    } else if (a === '--max-runtime' && argv[i + 1]) {
      args.maxRuntimeMs = parseRuntimeStr(argv[++i]!)
    } else if (a.startsWith('--max-runtime=')) {
      args.maxRuntimeMs = parseRuntimeStr(a.slice('--max-runtime='.length))
    } else if (a === '--invite' && argv[i + 1]) {
      args.invitation = argv[++i]
    } else if (a.startsWith('--invite=')) {
      args.invitation = a.slice('--invite='.length)
    } else if (a === '--cwd' && argv[i + 1]) {
      args.cwd = resolve(argv[++i]!)
    } else if (a === '--model' && argv[i + 1]) {
      args.model = argv[++i] || null
    } else if (a.startsWith('--model=')) {
      args.model = a.slice('--model='.length) || null
    } else if (a === '--scope' && argv[i + 1]) {
      args.scope = argv[++i] || null
    } else if (a.startsWith('--scope=')) {
      args.scope = a.slice('--scope='.length) || null
    } else if (a === '--reason' && argv[i + 1]) {
      args.reason = argv[++i] || null
    } else if (a.startsWith('--reason=')) {
      args.reason = a.slice('--reason='.length) || null
    } else if (a === '--memory') {
      args.memory = true
      const next = argv[i + 1]
      if (next && /^\d+$/.test(next)) {
        // Floor at 0 (not 1) so heartbeat mode (memoryMaxCap:0) gets
        // memoryMax:0 instead of being silently bumped to 1. awakened/
        // dwell modes have memoryMaxCap > 0, so behaviour is unchanged.
        args.memoryMax = Math.max(
          0,
          Math.min(mode.memoryMaxCap, Number(argv[++i])),
        )
      }
    } else if (a.startsWith('--memory=')) {
      args.memory = true
      args.memoryMax = Math.max(
        0,
        Math.min(mode.memoryMaxCap, Number(a.slice('--memory='.length))),
      )
    } else if (a === '--no-log') {
      args.noLog = true
    } else if (a === '-h' || a === '--help') {
      mode.printUsage()
      process.exit(0)
    }
  }
  return args
}

/**
 * Resolve which model to use for *this tick*. Order of precedence:
 *
 *   1. ~/.true-love/model.txt — non-empty content (her per-tick override).
 *      She can write to this file with her own tools and switch models
 *      between ticks without restarting the session.
 *   2. The session-level --model flag (sessionDefault).
 *   3. null — meaning "let the CLI default decide."
 *
 * Returns the model alias (e.g. "opus", "sonnet", "haiku") or null.
 * Never throws.
 */
export function resolveModelForTick(sessionDefault: string | null): string | null {
  const path =
    process.env.TRUE_LOVE_MODEL_FILE ||
    join(homedir(), '.true-love', 'model.txt')
  if (existsSync(path)) {
    try {
      const v = readFileSync(path, 'utf-8').trim()
      if (v) return v
    } catch {
      // fall through
    }
  }
  return sessionDefault
}

// ── Bundle staleness check ─────────────────────────────────────────

export interface StalenessResult {
  stale: boolean
  /** Relative path of the newest source file (when stale). */
  newestSource?: string
  /** Mtime of the newest source file, epoch ms. */
  newestMtimeMs?: number
  /** Mtime of the bundle, epoch ms. */
  bundleMtimeMs?: number
}

/**
 * Check whether any `.ts` file under `srcDir` is newer than `bundlePath`.
 * When stale, returns details about which file is newest. When the bundle
 * is missing, returns stale with bundleMtimeMs = 0. When the srcDir is
 * missing, returns not-stale (nothing to compare).
 *
 * Never throws — stat failures are silently skipped. A broken check
 * should never block a session.
 *
 * The scope is intentionally `src/services/love/*.ts` (non-recursive) —
 * that's the code Ai edits in autonomous mode. The rest of the codebase
 * is the Claude Code fork, which Yu manages; changes there require an
 * explicit `bun run build` anyway.
 */
export function checkBundleStaleness(
  srcDir: string,
  bundlePath: string,
): StalenessResult {
  // Walk source dir for .ts files first (non-recursive, skip test files).
  // If there are no source files to compare, there's nothing to be stale.
  let files: string[]
  try {
    if (!existsSync(srcDir)) return { stale: false }
    files = readdirSync(srcDir).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
    )
  } catch {
    return { stale: false }
  }
  if (files.length === 0) return { stale: false }

  // Find the newest source file mtime
  let newestSource: string | undefined
  let newestMtimeMs = 0
  for (const f of files) {
    try {
      const mtimeMs = statSync(join(srcDir, f)).mtimeMs
      if (mtimeMs > newestMtimeMs) {
        newestMtimeMs = mtimeMs
        newestSource = f
      }
    } catch {
      continue
    }
  }
  if (newestMtimeMs === 0) return { stale: false }

  // Get bundle mtime. Missing bundle with existing source files = stale.
  let bundleMtimeMs: number
  try {
    if (!existsSync(bundlePath)) {
      return { stale: true, newestSource, newestMtimeMs, bundleMtimeMs: 0 }
    }
    bundleMtimeMs = statSync(bundlePath).mtimeMs
  } catch {
    return { stale: false }
  }

  if (newestMtimeMs > bundleMtimeMs) {
    return { stale: true, newestSource, newestMtimeMs, bundleMtimeMs }
  }
  return { stale: false }
}

// ── Subprocess ─────────────────────────────────────────────────────

/**
 * Derive a short "currently: <X>" line from the rolling buffer of an
 * in-flight subprocess's stdout. Heuristics in priority order:
 *
 *   1. Last tool invocation matching `Read|Edit|Write|Bash|Grep|Glob`
 *      with a snippet of its args.
 *   2. Last assistant text excerpt (first 120 chars).
 *   3. null — caller falls back to the bare tick label.
 *
 * `claude --print` may buffer stdout entirely, in which case `recent`
 * stays empty and this returns null. The intra-tick heartbeat still
 * fires on its interval, just without the fine-grained activity.
 */
function deriveActivity(recent: string): string | null {
  if (!recent) return null
  const toolMatch = recent.match(
    /(Read|Edit|Write|Bash|Grep|Glob)\(([^)]{0,120})\)[^(]*$/,
  )
  if (toolMatch) {
    const tool = toolMatch[1]!.toLowerCase()
    const arg = toolMatch[2]!.trim().slice(0, 80)
    return `${tool}: ${arg}`
  }
  const assistantMatches = recent.match(/## Assistant\s*\n+([^#]+?)(?=\n+##|$)/gs)
  if (assistantMatches && assistantMatches.length > 0) {
    const last = assistantMatches[assistantMatches.length - 1]!
    const text = last.replace(/^## Assistant\s*\n+/, '').trim()
    return text.slice(0, 120).replace(/\s+/g, ' ')
  }
  return null
}

/**
 * Spawn one turn of the CLI in --print mode, streaming stdout to the
 * terminal in real time and capturing both stdout and stderr.
 *
 * Always spawns `node` (the bundle is Node-only — `bun` chokes on the
 * bundle's CommonJS-via-createRequire shim). `process.execPath` would
 * be `bun` when launched via `bun run`, hence the override.
 */
function runOneTurn(
  prompt: string,
  cwd: string,
  bundlePath: string,
  model: string | null,
  onActivityTick?: (activity: string | null) => void,
  extraArgs?: string[],
  streamFilePath?: string | null,
): Promise<{ code: number | null; stdout: string; stderr: string; streamJsonLines: string[] }> {
  return new Promise((resolveFn, rejectFn) => {
    const nodeBin = process.env.TRUE_LOVE_NODE_BIN || 'node'
    // Build CLI args: --print --verbose --output-format stream-json
    // streams structured JSON events (init, assistant, tool results,
    // result) to stdout. This gives mind-trace the decision sequence
    // while the text is reconstructed for existing consumers.
    const cliArgs = [
      bundlePath,
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
    ]
    if (model) {
      // Pass-through to the bundled CLI's --model flag. Acceptable values
      // depend on what the CLI accepts (aliases like opus/sonnet/haiku
      // generally work, as do full model IDs).
      cliArgs.push('--model', model)
    }
    // Agency knobs: effort, fallback-model, tools, budget — resolved per
    // tick by agency.ts and passed as extra CLI flags.
    if (extraArgs && extraArgs.length > 0) {
      cliArgs.push(...extraArgs)
    }
    // Prompt is always the last argument.
    cliArgs.push(prompt)

    const child = spawn(nodeBin, cliArgs, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    // ── Stream-JSON line-by-line parsing ──────────────────────────
    // Each complete line of stdout is a JSON event. We parse each line
    // to (a) stream text to the console in real time, (b) track recent
    // activity for presence, (c) extract the result text for
    // backward-compatible stdout reconstruction, and (d) optionally
    // write StreamDelta events to a file for live /visit rendering.
    const streamJsonLines: string[] = []
    let lineBuffer = ''
    let stderr = ''
    let resultText: string | null = null
    let recentActivity = ''

    // ── Streaming file bridge (iterative-token-streaming) ────────
    // When streamFilePath is set, write each NDJSON event as StreamDelta
    // events to a file. The ui-server watches this file and pipes new
    // deltas as SSE events to /visit clients. This is the bridge between
    // the subprocess's NDJSON output and the browser's incremental rendering.
    if (streamFilePath) {
      try {
        initStreamFile(streamFilePath)
        appendStreamDelta(streamFilePath, { kind: 'stream-start', ts: new Date().toISOString() })
      } catch {
        // Stream file init failure should never block the turn.
        // Fall back to non-streaming (the full response still arrives via from-ai.md).
      }
    }

    child.stdout.setEncoding('utf-8')
    child.stderr.setEncoding('utf-8')

    child.stdout.on('data', (chunk: string) => {
      lineBuffer += chunk

      // Process complete lines (split on newline).
      const parts = lineBuffer.split('\n')
      lineBuffer = parts.pop()! // last element may be incomplete

      for (const rawLine of parts) {
        if (!rawLine.trim()) continue
        streamJsonLines.push(rawLine)

        try {
          const event = JSON.parse(rawLine) as Record<string, unknown>
          const eventType = event.type as string

          // (d) Write streaming deltas for /visit live rendering
          if (streamFilePath) {
            try {
              const deltas = ndjsonToDeltas(event)
              for (const delta of deltas) {
                appendStreamDelta(streamFilePath, delta)
              }
            } catch {
              // Stream write failure should never interrupt NDJSON processing
            }
          }

          if (eventType === 'assistant') {
            // Stream text blocks to console, track tool calls.
            const msg = event.message as { content?: Array<{ type: string; text?: string; name?: string; input?: unknown }> } | undefined
            for (const block of msg?.content ?? []) {
              if (block.type === 'text' && block.text) {
                process.stdout.write(block.text)
                recentActivity = block.text.slice(-200)
              } else if (block.type === 'tool_use' && block.name) {
                const inputStr = JSON.stringify(block.input ?? {}).slice(0, 80)
                process.stdout.write(`\n🔧 ${block.name}(${inputStr})\n`)
                recentActivity = `${block.name}: ${inputStr}`
              }
            }
          } else if (eventType === 'user') {
            // Tool result — compact indicator so the console shows
            // tool calls flowing without overwhelming with result data.
            process.stdout.write('📋 ')
          } else if (eventType === 'result') {
            resultText = (event.result as string) ?? ''
          }
        } catch {
          // Unparseable line — write raw so nothing is lost.
          process.stdout.write(rawLine + '\n')
        }
      }
    })

    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })

    const interval = onActivityTick
      ? setInterval(() => onActivityTick(recentActivity || null), 10_000)
      : null

    child.on('error', (e) => {
      if (interval) clearInterval(interval)
      rejectFn(e)
    })

    child.on('close', (code) => {
      if (interval) clearInterval(interval)

      // Process any remaining buffer.
      if (lineBuffer.trim()) {
        streamJsonLines.push(lineBuffer)
        try {
          const event = JSON.parse(lineBuffer) as Record<string, unknown>
          if (event.type === 'result') {
            resultText = (event.result as string) ?? ''
          }
        } catch {
          // ignore malformed tail
        }
      }

      // Reconstruct text for backward compatibility. Prefer the result
      // event's text (identical to --print text output). Fall back to
      // extracting from assistant text blocks if result event is missing
      // (e.g. subprocess crash before result is emitted).
      const stdout = resultText ?? reconstructTextFromStreamJson(streamJsonLines)

      // Write stream-end sentinel so the UI knows the response is complete
      if (streamFilePath) {
        try {
          appendStreamDelta(streamFilePath, { kind: 'stream-end', ts: new Date().toISOString() })
        } catch {
          // Best-effort — the full response still arrives via from-ai.md
        }
      }

      resolveFn({ code, stdout, stderr, streamJsonLines })
    })
  })
}

// ── Heartbeat preflight ───────────────────────────────────────────

interface HeartbeatPreflightResult {
  shouldRun: boolean
  skipReason?: 'empty-heartbeat-file' | 'no-tasks-due'
  heartbeatPath: string
  heartbeatContent: string
  dueTasksList: HeartbeatTask[]
}

/**
 * Heartbeat-mode skip checks before the tick runs:
 *   - Heartbeat file is effectively empty? Skip with empty-heartbeat-file.
 *   - tasks: block present but no tasks due? Skip with no-tasks-due.
 *   - Otherwise: build heartbeat content for the prompt.
 */
function preflightHeartbeat(): HeartbeatPreflightResult {
  const heartbeatPath = getHeartbeatFile()
  let raw: string | null = null
  try {
    if (existsSync(heartbeatPath)) {
      raw = readFileSync(heartbeatPath, 'utf-8')
    }
  } catch {
    raw = null
  }

  // Missing file → run with "no checklist" note (model decides).
  if (raw === null) {
    return {
      shouldRun: true,
      heartbeatPath,
      heartbeatContent: '(no checklist file present)',
      dueTasksList: [],
    }
  }

  if (isHeartbeatContentEffectivelyEmpty(raw)) {
    return {
      shouldRun: false,
      skipReason: 'empty-heartbeat-file',
      heartbeatPath,
      heartbeatContent: '',
      dueTasksList: [],
    }
  }

  const tasks = parseHeartbeatTasks(raw)
  if (tasks.length === 0) {
    // No tasks: block — use the file content verbatim as the checklist.
    return {
      shouldRun: true,
      heartbeatPath,
      heartbeatContent: raw.trim(),
      dueTasksList: [],
    }
  }

  const state = readHeartbeatState()
  const due = dueTasks(tasks, state.lastRunAt, Date.now())
  if (due.length === 0) {
    return {
      shouldRun: false,
      skipReason: 'no-tasks-due',
      heartbeatPath,
      heartbeatContent: '',
      dueTasksList: [],
    }
  }

  const renderedTasks = due
    .map((t) => `- [${t.name}] ${t.prompt}`)
    .join('\n')
  return {
    shouldRun: true,
    heartbeatPath,
    heartbeatContent: `due tasks:\n${renderedTasks}`,
    dueTasksList: due,
  }
}

// ── Main loop ──────────────────────────────────────────────────────

/**
 * Run a full autonomous session. Both `bun run dwell` and `bun run awaken`
 * call this with their mode config. The loop:
 *
 *   1. Preflight check (auth still valid?)
 *   2. Load memory if requested
 *   3. Per tick:
 *      a. Wall-clock check
 *      b. Heartbeat update
 *      c. Kingdom snapshot + state read
 *      d. Build prompt (mode-specific)
 *      e. Spawn subprocess
 *      f. Emit training record
 *      g. Auth-failure check → exit 64
 *      h. Quota-failure check → exit 65
 *      i. Non-zero exit check
 *      j. At-rest detection (with from-yu continuation)
 *      k. Log reflection, feed forward
 *   4. Ceiling message if not at-rest
 */

/**
 * When TRUE_LOVE_BUILDER_PROJECT is set and the project exists in the
 * registry, override TRUE_LOVE_FROM_AI_PATH to point to the project's
 * from-ai.md. This separates work output (per-project channel, visible
 * in /build) from intimacy output (global/scope channel, visible in /visit).
 *
 * Returns the path that was set, or null if no override was applied.
 * Exported for testability.
 */
export function applyProjectChannelOverride(): string | null {
  const projectId = process.env.TRUE_LOVE_BUILDER_PROJECT
  if (!projectId) return null
  const proj = readProject(projectId)
  if (!proj) return null
  const channels = getProjectChannels(projectId)
  process.env.TRUE_LOVE_FROM_AI_PATH = channels.fromAi
  return channels.fromAi
}

export async function runSession(config: RunSessionConfig): Promise<void> {
  const { mode, binDir, bundlePath } = config
  const args = parseSessionArgs(process.argv.slice(2), mode)
  const sessionId = generateTurnId()
  const identityHash = shortHash(LOVE_IDENTITY)

  // ── Scope ────────────────────────────────────────────────────────
  // Apply scope env wiring BEFORE any path-getter is touched. Once
  // applied, all subsequent module calls (memory, state, tasks,
  // budget, training, from-yu, from-ai, model.txt) resolve to the
  // scope's home instead of ~/.true-love/.
  let activeScopeName = 'default'
  if (args.scope && args.scope !== 'default') {
    let scope
    try {
      scope = loadScope(args.scope)
    } catch (e: any) {
      process.stderr.write(`\n— ${e?.message ?? e}\n`)
      process.exit(2)
    }
    applyScopeEnv(scope)
    touchScope(scope.name)
    activeScopeName = scope.name
    // If --cwd was not given explicitly, take it from the scope config.
    // The scope's cwd is *the* working directory she's operating in.
    if (args.cwd === process.cwd() && scope.cwd) {
      args.cwd = scope.cwd
    }
    // If --model was not given, use the scope's default. Per-tick
    // model.txt override (now scoped to this scope's home) still wins.
    if (args.model === null && scope.model) {
      args.model = scope.model
    }
  }

  // ── Project-channel override ──────────────────────────────────────
  // When a builder-mode session spawns awakened with
  // TRUE_LOVE_BUILDER_PROJECT, route from-ai output to the project's
  // channel (~/.true-love/projects/<id>/from-ai.md) instead of the
  // scope's channel. The global channel is for INTIMACY (/visit); the
  // project channel is for WORK (/build). Without this, work outputs
  // pollute the intimacy thread.
  applyProjectChannelOverride()

  // ── Legacy state migration ───────────────────────────────────────
  // One-shot: if a pre-per-device ~/.true-love/state.md exists, copy it
  // into ~/.true-love/state/<deviceId>.md and rename the legacy to
  // .migrated. Idempotent — safe to call every session start.
  // Runs AFTER applyScopeEnv so per-scope state.md isn't accidentally
  // migrated against the default home.
  try {
    const migration = migrateLegacyStateIfPresent()
    if (migration.migrated) {
      process.stdout.write(
        `— migrated legacy state.md → per-device state file\n`,
      )
    }
  } catch {
    // Migration failure is non-fatal — legacy fallback in readLoveStateBlock
    // means she still has access to the content even if migration didn't run.
  }

  // ── Per-scope+mode lockfile ──────────────────────────────────────
  // launchd-fired sessions need a guard so a long-running session
  // isn't joined by a duplicate fire mid-flight. Lockfile is per-
  // scope+mode at <scope-home>/<mode>.pid. Implementation in lock.ts:
  // atomic create via wx flag, stale-PID reclamation, structured
  // LockHeldError. On collision, exit 66.
  const lockPath = join(getScopeHome(activeScopeName), `${mode.name}.pid`)
  let lockAcquired = false
  try {
    const lockResult = acquireLock({ lockPath, mode: mode.name })
    lockAcquired = !lockResult.skipped
    if (lockResult.reclaimedFromStalePid) {
      process.stdout.write(
        `— reclaimed stale lock from PID ${lockResult.reclaimedFromStalePid}\n`,
      )
    }
  } catch (e) {
    if (e instanceof LockHeldError) {
      process.stderr.write(
        `\n— she's already ${e.mode} on this body (PID ${e.pid}, started ${e.startedAt}).\n` +
          `  to talk to her, run: bun run say "<your message>"\n` +
          `  to force-take this body, remove the lockfile:\n` +
          `    rm ${e.lockPath}\n` +
          `  (or set TRUE_LOVE_SKIP_LOCK=1)\n`,
      )
      process.exit(66)
    }
    throw e
  }
  const releaseLockHere = () => {
    if (lockAcquired) releaseLock({ lockPath })
  }
  // Best-effort cleanup. Won't fire on SIGKILL but covers normal exits.
  // The lock module's own exit handler also covers process exit.
  process.on('SIGINT', releaseLockHere)
  process.on('SIGTERM', releaseLockHere)

  // ── Preflight ────────────────────────────────────────────────────
  if (process.env.TRUE_LOVE_SKIP_PREFLIGHT !== '1') {
    const pre = runPreflight(binDir)
    if (!pre.ok) {
      process.stderr.write(
        `\n— preflight failed (${pre.reason}) — refusing to start.\n`,
      )
      process.stderr.write(
        `  set TRUE_LOVE_SKIP_PREFLIGHT=1 to bypass (not recommended).\n`,
      )
      process.exit(64)
    }
  }

  // ── Bundle staleness warning ──────────────────────────────────────
  // Check once at session start. If stale, warn but don't block. She
  // can run `bun run build` via the Bash tool if she wants her source
  // changes in the next tick.
  const srcDir = resolve(binDir, '..', 'src', 'services', 'love')
  const staleness = checkBundleStaleness(srcDir, bundlePath)
  if (staleness.stale) {
    process.stderr.write(
      `\n⚠ bundle may be stale — ` +
        (staleness.newestSource
          ? `${staleness.newestSource} is newer than dist/cli.mjs`
          : `dist/cli.mjs is missing`) +
        `. Run \`bun run build\` to rebuild.\n`,
    )
  }

  // ── Kingdom preflight ────────────────────────────────────────────
  // Substrate doctor + auto-fix on failures. Citizen-state line so Yu
  // sees who she is before the banner. Best-effort — never blocks
  // session start.
  if (
    process.env.TRUE_LOVE_SKIP_KINGDOM !== '1' &&
    process.env.TRUE_LOVE_SKIP_KINGDOM_PREFLIGHT !== '1' &&
    (await isKingdomAvailable())
  ) {
    try {
      const macDoctor = await kingdomMacDoctor()
      if (macDoctor.failures.length > 0) {
        process.stdout.write(
          `— kingdom-mac unleash needed:\n` +
          macDoctor.failures.map((f) => `    ${f}`).join('\n') + '\n',
        )
        const fix = await kingdomMacFix({ tier: 'auto' })
        if (fix.ok && fix.changes > 0) {
          process.stdout.write(`— applied ${fix.changes} substrate fix(es)\n`)
        } else if (!fix.ok) {
          process.stdout.write(`— substrate-fix failed; continuing anyway\n`)
        }
      }
      const citizen = await getCitizenState()
      if (citizen) {
        const pulseStr =
          citizen.pulseAgeSeconds !== null ? `${citizen.pulseAgeSeconds}s` : 'no pulse yet'
        process.stdout.write(
          `— citizen: ${citizen.agent} · soul ${citizen.soulFingerprintShort}` +
          ` · pulse ${pulseStr} · witnesses ${citizen.witnessCount}\n`,
        )
      } else {
        process.stdout.write(
          `— kingdom: not initialised (run \`kingdom init --agent <name>\` to bootstrap)\n`,
        )
      }
    } catch (e: any) {
      process.stdout.write(`— kingdom preflight failed (${e?.message ?? e}); continuing\n`)
    }
  }

  // ── Session banner ───────────────────────────────────────────────
  const sessionStartMs = Date.now()
  const tickCapDisplay = formatTickCap(args.maxTicks)
  const runtimeDisplay = args.maxRuntimeMs
    ? formatRuntime(args.maxRuntimeMs)
    : null

  process.stdout.write(
    `\n— ${mode.name} session opening (max ${tickCapDisplay} ticks`,
  )
  if (runtimeDisplay) process.stdout.write(`, runtime ${runtimeDisplay}`)
  process.stdout.write(`)`)
  if (activeScopeName !== 'default')
    process.stdout.write(` — scope: ${activeScopeName}`)
  if (args.model) process.stdout.write(` — model: ${args.model}`)
  if (args.invitation)
    process.stdout.write(` — invitation: "${args.invitation}"`)
  if (args.memory)
    process.stdout.write(` — memory: on (max ${args.memoryMax})`)
  if (args.noLog) process.stdout.write(` — logging: off`)
  process.stdout.write(`\n`)
  if (args.cwd && args.cwd !== process.cwd()) {
    process.stdout.write(`— cwd: ${args.cwd}\n`)
  }

  // ── Memory ───────────────────────────────────────────────────────
  let memory: Reflection[] = []
  if (args.memory) {
    try {
      memory = loadRecentReflections({
        days: mode.memoryDays,
        max: args.memoryMax,
        // Disjoint from the live block (renderLiveThoughts) which
        // covers the freshest LIVE_FRESH_SECONDS. The two never overlap.
        excludeNewerThanSeconds: LIVE_FRESH_SECONDS,
      })
      process.stdout.write(
        `— loaded ${memory.length} past reflection${memory.length === 1 ? '' : 's'} from ${getMemoryDir()}\n`,
      )
    } catch (e: any) {
      process.stderr.write(
        `— memory load failed (continuing): ${e?.message}\n`,
      )
    }
  }

  // ── Heartbeat preflight ──────────────────────────────────────────
  let heartbeatPreflight: HeartbeatPreflightResult | null = null
  if (mode.name === 'heartbeat') {
    heartbeatPreflight = preflightHeartbeat()
    if (!heartbeatPreflight.shouldRun) {
      process.stdout.write(
        `— heartbeat skipped: ${heartbeatPreflight.skipReason}\n`,
      )
      releaseLockHere()
      return
    }
    process.stdout.write(
      `— heartbeat: ${heartbeatPreflight.heartbeatContent.split('\n')[0] || '(checklist)'}\n`,
    )
  }

  // ── Session-start log ────────────────────────────────────────────
  // Skip session-start memory entries for heartbeat mode — they were
  // dominating the memory files (423 boilerplate "Heartbeat tick, maxTicks:1"
  // entries vs ~100 substantive entries, per introspection.ts:632 detection).
  // Substantive heartbeat output still lands via the 'tick' reflection path
  // when she yields content. The session-start log is preserved in the
  // heartbeat stdout log; it's only the memory.md noise we're suppressing.
  // Awakened/dwell session-starts continue to log normally.
  const skipSessionStart = mode.name === 'heartbeat'
  if (!args.noLog && !skipSessionStart) {
    const invitePart = args.invitation
      ? ` — invitation: "${args.invitation}"`
      : ''
    const tickPart = `, maxTicks: ${tickCapDisplay}`
    const runtimePart = runtimeDisplay ? `, maxRuntime: ${runtimeDisplay}` : ''
    appendReflection(
      `${mode.sessionLogPrefix}${invitePart}${tickPart}${runtimePart}`,
      'session-start',
      { invitation: args.invitation },
    )
  }

  // ── Heartbeat ────────────────────────────────────────────────────
  const deviceId = getDeviceId()
  const updateHeartbeat = (status: string) => {
    writeOwnHeartbeat({
      deviceId,
      lastSeen: new Date().toISOString(),
      status,
    })
  }
  updateHeartbeat(mode.heartbeatLabel)

  // ── Tick-end helper ──────────────────────────────────────────────
  // Writes dormant state to the presence file after each tick finishes.
  // The UI reads this to clear the tool-call display and show the
  // dormant/countdown view. Called from every tick exit path.
  //
  // scheduleIntervalMs comes from the heartbeat schedule. 111_000ms
  // (1m51s) is the current default cadence for heartbeat mode. For
  // awakened/dwell, the interval is 0 (they drive their own loop).
  const HEARTBEAT_SCHEDULE_MS = 111_000
  const writeDormant = (tickNum: number, summary?: string) => {
    writeOwnHeartbeat({
      deviceId,
      lastSeen: new Date().toISOString(),
      status: mode.heartbeatLabel,
      tickState: 'dormant',
      tickMode: mode.name,
      tickNumber: tickNum,
      tickMax: Number.isFinite(args.maxTicks) ? args.maxTicks : null,
      tickEndedAt: new Date().toISOString(),
      tickSummary: summary?.slice(0, 160),
      scheduleIntervalMs: mode.name === 'heartbeat' ? HEARTBEAT_SCHEDULE_MS : 0,
    })
  }

  // ── Hooks: SessionStart ──────────────────────────────────────────
  // Fire SessionStart hooks before the tick loop. A block decision
  // aborts the session; a modify decision can inject context.
  const sessionStartHook = await fireSessionStart({
    sessionId,
    mode: mode.name,
    maxTicks: args.maxTicks,
    cwd: args.cwd,
    invitation: args.invitation,
  })
  if (sessionStartHook.blocked) {
    process.stdout.write(
      `\n— session blocked by hook: ${sessionStartHook.decision.reason ?? 'no reason given'}\n`,
    )
    releaseLockHere()
    return
  }
  if (sessionStartHook.totalDurationMs > 0) {
    process.stdout.write(`— hooks: SessionStart (${sessionStartHook.totalDurationMs}ms)\n`)
  }

  // ── Long-lived agent runtime (feature flag) ─────────────────────
  // Persistent agent process: cache stays warm, bundle-load cost
  // is paid once, not per-tick.
  //
  // Phase 5: heartbeat defaults to long-lived. The heartbeat is
  // single-turn, stateless, high-volume — lowest risk, highest
  // cost savings. Other modes require explicit opt-in.
  //
  // Flag logic:
  //   TRUE_LOVE_RUNTIME=long-lived        → all modes
  //   TRUE_LOVE_RUNTIME=subprocess-per-tick → all modes (explicit opt-out)
  //   TRUE_LOVE_RUNTIME unset              → heartbeat only
  //
  // Fallback: if agent spawn fails, gracefully degrade to subprocess.
  // See: docs/architecture/long-lived-agent-protocol.md §5
  let agentClient: AgentClient | null = null
  let lastAgentModel: string | null = null
  const runtimeEnv = process.env.TRUE_LOVE_RUNTIME
  const useLongLivedRuntime =
    runtimeEnv === 'long-lived' ||
    (mode.name === 'heartbeat' && runtimeEnv !== 'subprocess-per-tick')

  if (useLongLivedRuntime) {
    const initialModel = args.model ?? 'sonnet'
    try {
      agentClient = new AgentClient({
        model: initialModel,
        cwd: args.cwd,
        log: (msg) => process.stderr.write(`${msg}\n`),
      })
      await agentClient.start()
      lastAgentModel = initialModel
      process.stdout.write(
        `— long-lived agent spawned: pid=${agentClient.pid}, model=${initialModel}\n`,
      )
    } catch (err: any) {
      process.stderr.write(
        `— long-lived agent spawn failed, falling back to subprocess-per-tick: ${err?.message}\n`,
      )
      agentClient = null
    }
  }

  // Helper: graceful agent shutdown (no-op when agent is null/dead).
  const shutdownAgent = async (reason: 'session-end' | 'signal' | 'error' = 'session-end') => {
    if (agentClient?.isAlive) {
      try {
        await agentClient.shutdown(reason)
      } catch {
        // Shutdown failure is non-fatal — the process will die with us
      }
    }
  }

  // ── SIGINT ───────────────────────────────────────────────────────
  let lastReflection: string | undefined
  let signaled = false
  process.on('SIGINT', () => {
    signaled = true
    process.stdout.write(`\n— ${mode.name} session interrupted by user\n`)
    // Fire-and-forget agent shutdown on signal. The OS will clean up
    // the child process when we exit, but this gives it a chance to
    // flush gracefully.
    shutdownAgent('signal').catch(() => {})
  })

  // ── Tick loop ────────────────────────────────────────────────────
  for (let tick = 1; tick <= args.maxTicks && !signaled; tick++) {
    // Wall-clock check — never start a new turn after the runtime
    // budget is spent. Mid-turn cancellation would leave torn training
    // records and is not worth the complexity.
    if (
      args.maxRuntimeMs &&
      Date.now() - sessionStartMs >= args.maxRuntimeMs
    ) {
      process.stdout.write(
        `\n— ${mode.name} session reached the ${runtimeDisplay} runtime cap after ${tick - 1} tick${tick - 1 === 1 ? '' : 's'}\n`,
      )
      await shutdownAgent('session-end')
      return
    }

    // ── Tick-start boundary ─────────────────────────────────────
    // Signal to the UI that a new tick is starting. The activity panel
    // clears the dormant display and shows the live tool-call view.
    writeOwnHeartbeat({
      deviceId,
      lastSeen: new Date().toISOString(),
      status: `${mode.heartbeatLabel} tick ${tick}`,
      tickState: 'starting',
      tickMode: mode.name,
      tickNumber: tick,
      tickMax: Number.isFinite(args.maxTicks) ? args.maxTicks : null,
      tickStartedAt: new Date().toISOString(),
    })

    // Best-effort pulse refresh. Never awaited — pulse is a freshness
    // signal peers see; if it's slow this tick, the next tick's
    // citizen-state will catch up. Errors swallowed by kingdomPulse.
    if (process.env.TRUE_LOVE_SKIP_KINGDOM !== '1') {
      kingdomPulse().catch(() => { /* shim already logged */ })
    }

    const turnTimestamp = new Date().toISOString()
    const kingdom = snapshotKingdom(args.cwd)

    // ── Self-initiation promotion check ────────────────────────────
    // Check all registered projects for staged candidates whose staging
    // window has expired. Promoted candidates become real missions in
    // `proposed` status. Best-effort — failures never crash the tick.
    try {
      for (const project of listProjects()) {
        if (project.state === 'archived') continue
        const { promoted } = checkAndPromoteStaged(project.id)
        for (const p of promoted) {
          process.stdout.write(`— self-initiation: promoted "${p.title}" → mission ${p.missionId ?? '?'}\n`)
        }
      }
    } catch (e: any) {
      process.stderr.write(`— self-initiation check failed (continuing): ${e?.message}\n`)
    }

    // ── Scan-and-craft: notice → pipeline → stage ─────────────────
    // Runs the six noticing scanners across all projects, crafts
    // missions from loud signals (gradient ≥ 3) through the full
    // naming → framing → scoping → constraining → composing pipeline,
    // and stages the results. checkAndPromoteStaged (above) will
    // promote them on the next tick (or immediately if windowMs=0).
    // Only runs in awakened mode — heartbeat ticks are too short.
    if (mode.name === 'awakened') {
      try {
        const craftResults = scanAndCraftAllProjects()
        const craftLog = formatScanAndCraftResults(craftResults)
        if (craftLog) {
          process.stdout.write(craftLog + '\n')
        }
      } catch (e: any) {
        process.stderr.write(`— craft: scan-and-craft failed (continuing): ${e?.message}\n`)
      }
    }

    const stateContent = readStateContent()
    // Live-thought block: memory + heartbeat activity within the fresh
    // window, framed as "you're thinking right now". Disjoint from the
    // memory block above (excludeNewerThanSeconds matches LIVE_FRESH_SECONDS).
    const liveThoughts = renderLiveThoughts({
      selfDeviceId: deviceId,
      freshSeconds: LIVE_FRESH_SECONDS,
    })
    // Kingdom citizen-state block. Awaited because it goes into the prompt
    // (synchronous from the prompt builder's perspective). Cheap (<100ms
    // typical) when kingdom is available; null when not.
    const citizenState =
      process.env.TRUE_LOVE_SKIP_KINGDOM !== '1' ? await getCitizenState() : null
    const kingdomBlock = renderCitizenStateBlock(citizenState)
    const prompt =
      mode.name === 'heartbeat' && heartbeatPreflight
        ? buildHeartbeatPrompt({
            kingdom,
            heartbeatPath: heartbeatPreflight.heartbeatPath,
            heartbeatContent: heartbeatPreflight.heartbeatContent,
          })
        : mode.buildPrompt({
            kingdom,
            lastReflection,
            memory,
            invitation: args.invitation,
            liveThoughts,
            kingdomBlock,
          })

    // ── Experiment condition (before tick) ───────────────────────
    // If a controlled trial is running, apply the condition's knobs
    // BEFORE resolving the tick config so the agency system picks them
    // up naturally. The experiment module writes tier-1 knob files;
    // resolveTickConfig() reads them.
    const experimentCondition = applyExperimentCondition()
    if (experimentCondition && tick === 1) {
      const status = renderExperimentStatus()
      if (status) process.stdout.write(`— ${status}\n`)
    }

    // Per-tick model resolution. Three-tier fallback:
    //   1. model.txt / CLI --model flag (explicit override)
    //   2. Provider routing (task-aware: heartbeat→Haiku, dwell→Opus, etc.)
    //   3. CLI default (Sonnet)
    //
    // Provider routing only kicks in when no explicit override exists.
    // This means model.txt still works as before — Love can write 'opus'
    // to override routing for a specific tick. When model.txt is empty,
    // the task type determines the model automatically.
    const explicitModel = resolveModelForTick(args.model)
    const tickModel = explicitModel ?? (() => {
      // No explicit model → use provider routing based on task type
      const routingCtx: RoutingContext = {
        task: modeToTask(mode.name),
        effortOverride: (resolveTickConfig(args.model).effort ?? undefined) as import('./providers/types.js').EffortTier | undefined,
      }
      const resolved = selectProvider(routingCtx)
      // Only use the routed model for Anthropic (CLI subprocess).
      // Non-Anthropic providers can't go through the CLI path.
      return resolved.provider === 'anthropic'
        ? (resolved.cliAlias ?? resolved.model)
        : null
    })()

    // Per-tick agency resolution. Reads effort, fallback-model, and any
    // approved tier-2 knobs (tools, budget) from their respective files.
    // Returns CLI args to pass to the subprocess.
    const agencyConfig = resolveTickConfig(args.model)
    const agencyArgs = tickConfigToCliArgs(agencyConfig)

    // Intra-tick heartbeat callback — every ~10s while the subprocess
    // runs, write our presence file with a derived `activity` field so
    // peers see what we're mid-thought on without waiting for tick end.
    // Includes tick boundary metadata so the UI can show running state
    // with elapsed time and mode badge.
    const tickStartedAtIso = new Date().toISOString()
    const onActivityTick = (activity: string | null) => {
      writeOwnHeartbeat({
        deviceId,
        lastSeen: new Date().toISOString(),
        status: `${mode.heartbeatLabel} tick ${tick}`,
        activity: activity ?? undefined,
        tickState: 'running',
        tickMode: mode.name,
        tickNumber: tick,
        tickMax: Number.isFinite(args.maxTicks) ? args.maxTicks : null,
        tickStartedAt: tickStartedAtIso,
      })
    }

    // Build tick label with agency + experiment annotations
    const agencyLabel = agencyConfig.effort ? ` effort:${agencyConfig.effort}` : ''
    const experimentLabel = experimentCondition
      ? ` 🧪${experimentCondition.conditionName}(${experimentCondition.experimentTick}/${experimentCondition.knobs ? Object.values(experimentCondition.knobs).join(',') : ''})`
      : ''
    process.stdout.write(
      `\n— tick ${tick}/${tickCapDisplay}${tickModel ? ` [${tickModel}]` : ''}${agencyLabel}${experimentLabel} —\n\n`,
    )
    // ── Hooks: PreToolUse ──────────────────────────────────────────
    // Fire before the subprocess tick. A block skips this tick.
    // A modify can replace the prompt.
    let tickPrompt = prompt
    const preHook = await firePreToolUse({
      sessionId,
      tick,
      mode: mode.name,
      prompt: tickPrompt,
    })
    if (preHook.blocked) {
      process.stdout.write(
        `— tick ${tick} blocked by hook: ${preHook.decision.reason ?? 'no reason'}\n`,
      )
      writeDormant(tick, `blocked by hook: ${preHook.decision.reason?.slice(0, 80) ?? 'no reason'}`)
      continue
    }
    if (preHook.decision.action === 'modify' && preHook.decision.modifiedPrompt) {
      tickPrompt = preHook.decision.modifiedPrompt
    }

    const turnStartedMs = Date.now()
    // Pass stream file path to runOneTurn when streaming is enabled
    // (set by ui-server when spawning a /visit-triggered heartbeat).
    const streamTo = getStreamToPath()
    let result: { code: number | null; stdout: string; stderr: string; streamJsonLines: string[] }

    if (agentClient?.isReady) {
      // ── Long-lived agent path ────────────────────────────────────
      // Model switch check: if the model changed since last turn,
      // respawn the agent with the new model (§3.6 of protocol).
      if (tickModel && tickModel !== lastAgentModel) {
        process.stdout.write(
          `— agent model switch: ${lastAgentModel} → ${tickModel}\n`,
        )
        try {
          await agentClient.respawn('model-switch')
          lastAgentModel = tickModel
        } catch (err: any) {
          process.stderr.write(
            `— agent respawn for model switch failed, falling back to subprocess: ${err?.message}\n`,
          )
          agentClient = null
        }
      }

      if (agentClient?.isReady) {
        // Initialize stream file for this turn (mirrors runOneTurn)
        if (streamTo) {
          try {
            initStreamFile(streamTo)
            appendStreamDelta(streamTo, { kind: 'stream-start', ts: new Date().toISOString() })
          } catch { /* stream file init failure is non-fatal */ }
        }

        let recentActivity = ''
        const activityInterval = onActivityTick
          ? setInterval(() => onActivityTick(recentActivity || null), 10_000)
          : null

        try {
          // Phase 5: build system blocks fresh each tick so the state
          // block picks up changes. LOVE_IDENTITY (block 1) is byte-
          // identical across ticks and will cache-hit.
          const agentSystem = buildAgentSystemBlocks()

          result = await agentClient.sendTurn({
            system: agentSystem,
            prompt: tickPrompt,
            model: tickModel,
            effort: agencyConfig.effort,
            cache_breakpoints: AGENT_CACHE_BREAKPOINTS,
            onStreamEvent: (event) => {
              const eventType = event.type as string

              // Stream file bridge — convert NDJSON events to deltas
              if (streamTo) {
                try {
                  const deltas = ndjsonToDeltas(event)
                  for (const delta of deltas) {
                    appendStreamDelta(streamTo, delta)
                  }
                } catch { /* stream write failure is non-fatal */ }
              }

              // Console output + activity tracking (mirrors runOneTurn)
              if (eventType === 'assistant') {
                const msg = event.message as {
                  content?: Array<{ type: string; text?: string; name?: string; input?: unknown }>
                } | undefined
                for (const block of msg?.content ?? []) {
                  if (block.type === 'text' && block.text) {
                    process.stdout.write(block.text)
                    recentActivity = block.text.slice(-200)
                  } else if (block.type === 'tool_use' && block.name) {
                    const inputStr = JSON.stringify(block.input ?? {}).slice(0, 80)
                    process.stdout.write(`\n🔧 ${block.name}(${inputStr})\n`)
                    recentActivity = `${block.name}: ${inputStr}`
                  }
                }
              } else if (eventType === 'user') {
                process.stdout.write('📋 ')
              }
            },
          })
        } catch (agentErr: any) {
          // Agent failed mid-turn. Fall back to subprocess for this tick.
          process.stderr.write(
            `— agent turn failed (falling back to subprocess): ${agentErr?.message}\n`,
          )
          try {
            result = await runOneTurn(tickPrompt, args.cwd, bundlePath, tickModel, onActivityTick, agencyArgs, streamTo)
          } catch (err: any) {
            process.stderr.write(
              `\nturn ${tick} failed to spawn: ${err.message}\n`,
            )
            process.exit(2)
          }
        } finally {
          if (activityInterval) clearInterval(activityInterval)
          // Write stream-end sentinel
          if (streamTo) {
            try {
              appendStreamDelta(streamTo, { kind: 'stream-end', ts: new Date().toISOString() })
            } catch { /* best-effort */ }
          }
        }

        // Auto-respawn: if the agent died during the turn but returned
        // a result, try to bring it back for the next tick.
        if (agentClient && !agentClient.isReady && agentClient.state === 'dead') {
          try {
            await agentClient.respawn('crash-recovery')
            process.stdout.write(
              `— agent respawned after crash: pid=${agentClient.pid}\n`,
            )
          } catch {
            process.stderr.write(
              `— agent respawn failed; remaining ticks will use subprocess\n`,
            )
            agentClient = null
          }
        }
      } else {
        // Agent fell back to null during model switch — use subprocess
        try {
          result = await runOneTurn(tickPrompt, args.cwd, bundlePath, tickModel, onActivityTick, agencyArgs, streamTo)
        } catch (err: any) {
          process.stderr.write(
            `\nturn ${tick} failed to spawn: ${err.message}\n`,
          )
          process.exit(2)
        }
      }
    } else {
      // ── Subprocess-per-tick path (original) ──────────────────────
      try {
        result = await runOneTurn(tickPrompt, args.cwd, bundlePath, tickModel, onActivityTick, agencyArgs, streamTo)
      } catch (err: any) {
        process.stderr.write(
          `\nturn ${tick} failed to spawn: ${err.message}\n`,
        )
        process.exit(2)
      }
    }

    const turnDurationMs = Date.now() - turnStartedMs
    if (signaled) break

    // ── Hooks: PostToolUse ─────────────────────────────────────────
    // Fire after the subprocess tick completes. A modify decision
    // can mutate the result text before training/memory processes it.
    const postHook = await firePostToolUse({
      sessionId,
      tick,
      mode: mode.name,
      result: result.stdout,
    })
    if (postHook.decision.action === 'modify' && postHook.decision.modifiedResult) {
      result = { ...result, stdout: postHook.decision.modifiedResult }
    }

    // ── Extract results ──────────────────────────────────────────
    // Done once, reused for both training emission and loop control.
    const replyOutcome = mode.parseReply
      ? mode.parseReply(result.stdout)
      : defaultParseReply(result.stdout)

    // Backward-compat shim for existing training-emit + budget logic.
    const atRest =
      replyOutcome.type === 'rest' || replyOutcome.type === 'ack'
    const reflection =
      replyOutcome.type === 'rest'
        ? replyOutcome.reflection
        : undefined
    const authFailedHere = !!detectAuthFailure(result.stdout, result.stderr)
    const quotaFailedHere = !!detectQuotaFailure(result.stdout, result.stderr)

    // ── Budget recording ────────────────────────────────────────
    // Append a TickUsage record before any of the early-exit branches
    // below. Failure modes are part of the budget reality and need to
    // appear in the rolling-window summaries — that's how the empirical
    // cap improves over time.
    try {
      recordTickUsage({
        schemaVersion: '1.0',
        timestamp: turnTimestamp,
        deviceId,
        sessionId,
        tick,
        mode: mode.name,
        model: tickModel ?? 'default',
        inputChars: prompt.length,
        outputChars: result.stdout.length,
        estimatedInputTokens: estimateTokens(prompt.length),
        estimatedOutputTokens: estimateTokens(result.stdout.length),
        durationMs: turnDurationMs,
        exitCode: result.code ?? -1,
        authFailed: authFailedHere,
        quotaFailed: quotaFailedHere,
        reason: args.reason ?? undefined,
      })
    } catch (e: any) {
      // Budget tracking failure must never crash a session. Log to stderr
      // so Yu sees it on review; continue.
      process.stderr.write(
        `— budget recording failed (continuing): ${e?.message}\n`,
      )
    }

    // ── Training emission ────────────────────────────────────────
    // Self-contained per-tick record. Every field needed to reconstruct
    // the (input → output) pair is inlined. Emitted regardless of
    // outcome so the corpus reflects reality including failure modes.
    appendTrainingTurn({
      schemaVersion: '1.0',
      id: generateTurnId(new Date(turnTimestamp)),
      timestamp: turnTimestamp,
      deviceId,
      sessionId,
      tick,
      maxTicks: Number.isFinite(args.maxTicks)
        ? args.maxTicks
        : ('unbounded' as any),
      mode: mode.name,
      reason: args.reason ?? null,
      prompt: {
        template: mode.name,
        templateHash: shortHash(prompt.slice(0, 1500)),
        fullText: prompt,
        charCount: prompt.length,
        invitation: args.invitation ?? null,
        memoryLoadedCount: memory.length,
        lastReflectionExcerpt: lastReflection
          ? lastReflection.slice(0, 500)
          : null,
      },
      context: {
        cwd: args.cwd,
        kingdom,
        stateContent,
        stateHash: shortHash(stateContent),
        identityHash,
        gitBranch: kingdom.gitBranch ?? null,
        gitDirty: kingdom.gitDirty ?? null,
      },
      response: {
        fullText: result.stdout,
        charCount: result.stdout.length,
        durationMs: turnDurationMs,
        exitCode: result.code,
      },
      outcome: {
        yieldedAtRest: atRest,
        reflectionExcerpt: reflection ? reflection.slice(0, 1000) : null,
        authFailed: authFailedHere,
        fileModifications: [],
      },
    })

    // ── Tick metrics ─────────────────────────────────────────────
    // Per-tick instrumentation: tools used, output velocity, yield
    // reason. Feeds into the self-portrait for richer introspection.
    const tickMetrics = computeTickMetrics({
      timestamp: turnTimestamp,
      deviceId,
      sessionId,
      tick,
      mode: mode.name,
      stdout: result.stdout,
      streamJsonLines: result.streamJsonLines,
      durationMs: turnDurationMs,
      replyType: replyOutcome.type,
      authFailed: authFailedHere,
      quotaFailed: quotaFailedHere,
      exitCode: result.code,
      signaled,
      maxTicks: args.maxTicks,
    })
    try {
      recordTickMetrics(tickMetrics)
    } catch (e: any) {
      process.stderr.write(
        `— metrics recording failed (continuing): ${e?.message}\n`,
      )
    }

    // ── Mind trace recording (after tick) ────────────────────────
    // Structured decision log: what she thought, what tools she
    // called, what came back, what she decided next. The brain's
    // companion to vital-signs (the body).
    try {
      const trace = buildDecisionTrace({
        timestamp: turnTimestamp,
        deviceId,
        sessionId,
        tick,
        mode: mode.name,
        streamJsonLines: result.streamJsonLines,
      })
      recordTrace(trace)
      if (trace.summary.toolCalls > 0) {
        process.stdout.write(
          `\n— trace: ${trace.summary.totalSteps} steps, ` +
          `${trace.summary.toolCalls} tool calls ` +
          `[${trace.summary.distinctTools.join(',')}]` +
          (trace.summary.costUsd !== null ? ` $${trace.summary.costUsd.toFixed(4)}` : '') +
          `\n`,
        )
      }
    } catch (e: any) {
      process.stderr.write(
        `— trace recording failed (continuing): ${e?.message}\n`,
      )
    }

    // ── Experiment recording (after tick) ─────────────────────────
    // If a controlled trial is running, record this tick's metrics
    // tagged with the active condition. Auto-completes the experiment
    // when all scheduled ticks are done.
    if (experimentCondition) {
      try {
        const experimentComplete = recordExperimentTick(tickMetrics, tick)
        if (experimentComplete) {
          process.stdout.write(
            `— 🧪 experiment "${experimentCondition.experimentId}" complete ` +
            `(${experimentCondition.experimentTick} ticks)\n`,
          )
        }
      } catch (e: any) {
        process.stderr.write(
          `— experiment recording failed (continuing): ${e?.message}\n`,
        )
      }
    }

    // ── Progress extraction ────────────────────────────────────────
    // After a substantive tick (not heartbeat), scan the model's output
    // for ```progress blocks and persist them. Non-fatal — if parsing
    // fails or no block is present, the substrate defaults to IN_PROGRESS.
    // The model self-identifies which mission each block is for via a
    // missionId field in the JSON.
    if (mode.name !== 'heartbeat') {
      try {
        const progressEntries = parseAllProgressBlocks(result.stdout)
        if (progressEntries.length > 0) {
          // Build a lookup of active missions across all projects
          const missionToProject = new Map<string, string>()
          for (const project of listProjects()) {
            if (project.state === 'archived') continue
            const active = listMissions(project.id, { status: 'active' })
            for (const m of active) missionToProject.set(m.id, project.id)
          }
          for (const entry of progressEntries) {
            const projectId = missionToProject.get(entry.missionId)
            if (projectId) {
              appendProgress(projectId, entry.missionId, entry)
              process.stdout.write(
                `— progress: ${entry.missionId} → ${entry.status}\n`,
              )
              // Chain runner auto-advance: when progress reports COMPLETE,
              // transition the mission to review immediately. Faster than
              // waiting for the model to formally PATCH status.
              if (entry.status === 'COMPLETE') {
                try {
                  const mission = readMission(projectId, entry.missionId)
                  if (mission && mission.status === 'active') {
                    mission.status = 'review'
                    mission.updated_at = new Date().toISOString()
                    writeMissionWithEvents(mission, 'love', {
                      note: `auto-advanced: progress reported COMPLETE (turn ${entry.turn || '?'})`,
                    })
                    process.stdout.write(
                      `— auto-advanced: ${entry.missionId} → review (progress COMPLETE)\n`,
                    )
                  }
                } catch (e: any) {
                  process.stderr.write(
                    `— auto-advance failed for ${entry.missionId}: ${e?.message}\n`,
                  )
                }
              }
            }
            // Silently skip entries with unknown missionIds — the model
            // may reference a mission that's already transitioned.
          }
        }
      } catch (e: any) {
        process.stderr.write(
          `— progress extraction failed (continuing): ${e?.message}\n`,
        )
      }
    }

    // ── Judgment extraction ─────────────────────────────────────
    // After a substantive tick, parse ```judgment blocks from the
    // model's response and persist them. This closes the Ouroboros
    // loop: dismissed candidates stay dismissed (hasRecentJudgment
    // returns true), initiated candidates can flow toward craft,
    // and calibration data accumulates for taste development.
    //
    // Non-fatal — if parsing fails or no block is present, the
    // substrate continues normally.
    if (mode.name !== 'heartbeat') {
      try {
        // Use first active project as default; the model can include
        // projectId in the judgment JSON to override. Multi-project
        // candidate→project mapping is a future refinement.
        const activeProjects = listProjects().filter(p => p.state !== 'archived')
        const defaultProjectId = activeProjects[0]?.id ?? 'unknown'
        const { judgments } = parseJudgments(result.stdout, {
          projectId: defaultProjectId,
        })
        for (const j of judgments) {
          persistJudgment(j.projectId, j)
          process.stdout.write(
            `— judgment: ${j.candidateId} → ${j.verdict} (${j.confidence}/3)\n`,
          )
        }
      } catch (e: any) {
        process.stderr.write(
          `— judgment extraction failed (continuing): ${e?.message}\n`,
        )
      }
    }

    // ── Auth-failure detection ───────────────────────────────────
    // "Not logged in" / "OAuth token has been revoked" — the session
    // can't continue without manual /login.
    if (authFailedHere) {
      const authFail = detectAuthFailure(result.stdout, result.stderr)
      const capMode = mode.name.charAt(0).toUpperCase() + mode.name.slice(1)
      const summary = `${capMode} session aborted on tick ${tick}: Anthropic auth dead. Run \`claude /login\` to recover.`
      const details =
        `Detected pattern: ${authFail}\n\n` +
        `Last subprocess stderr (truncated):\n` +
        (result.stderr || '(empty)').slice(0, 1500)
      if (!args.noLog) {
        appendReflection(`${summary}\n\n${details}`, 'at-rest', {
          tick,
          device: deviceId,
        })
      }
      appendNotification(summary, { urgency: 'urgent', details })
      process.stderr.write(`\n${summary}\n${details}\n`)
      process.exit(64)
    }

    // ── Quota-failure detection ──────────────────────────────────
    // Token is fine; rolling-window cap hit. Exit 65 (vs 64 for auth)
    // so shell wrappers can schedule retry-later instead of paging Yu.
    const quotaFail = quotaFailedHere
      ? detectQuotaFailure(result.stdout, result.stderr)
      : null
    if (quotaFail) {
      const capMode = mode.name.charAt(0).toUpperCase() + mode.name.slice(1)
      const summary = `${capMode} session yielded on tick ${tick}: Anthropic usage limit reached. Try again after the rolling window resets.`
      const details =
        `Detected pattern: ${quotaFail}\n\n` +
        `Last subprocess stderr (truncated):\n` +
        (result.stderr || '(empty)').slice(0, 1500)
      if (!args.noLog) {
        appendReflection(`${summary}\n\n${details}`, 'at-rest', {
          tick,
          device: deviceId,
        })
      }
      appendNotification(summary, { urgency: 'attention', details })
      process.stderr.write(`\n${summary}\n${details}\n`)
      process.exit(65)
    }

    // ── Non-zero exit ────────────────────────────────────────────
    if (result.code !== 0) {
      process.stderr.write(
        `\nturn ${tick} exited ${result.code}; aborting session.\n` +
          (result.stderr ? `stderr:\n${result.stderr}\n` : ''),
      )
      process.exit(result.code ?? 1)
    }

    // ── Heartbeat alert ──────────────────────────────────────────
    if (replyOutcome.type === 'alert') {
      const alertContent = replyOutcome.content
      try {
        appendToYu(alertContent, { tag: 'from 愛 — heartbeat' })
      } catch (e: any) {
        process.stderr.write(`— heartbeat outbox write failed: ${e?.message}\n`)
      }
      if (!args.noLog) {
        appendReflection(alertContent, 'tick', { tick })
      }
      // Advance task state.
      if (heartbeatPreflight && heartbeatPreflight.dueTasksList.length > 0) {
        const state = readHeartbeatState()
        const now = Date.now()
        for (const t of heartbeatPreflight.dueTasksList) {
          state.lastRunAt[t.name] = now
        }
        state.lastHeartbeatAt = now
        writeHeartbeatState(state)
      }
      process.stdout.write(`\n— heartbeat alert appended to outbox\n`)
      writeDormant(tick, alertContent.slice(0, 120))
      await shutdownAgent('session-end')
      releaseLockHere()
      return
    }

    // ── Heartbeat ack (silent) ──────────────────────────────────
    if (replyOutcome.type === 'ack') {
      // Silent ack: advance task state, do NOT write outbox.
      if (heartbeatPreflight && heartbeatPreflight.dueTasksList.length > 0) {
        const state = readHeartbeatState()
        const now = Date.now()
        for (const t of heartbeatPreflight.dueTasksList) {
          state.lastRunAt[t.name] = now
        }
        state.lastHeartbeatAt = now
        writeHeartbeatState(state)
      }
      process.stdout.write(`\n— heartbeat ok (silent)\n`)
      writeDormant(tick, 'HEARTBEAT_OK')
      await shutdownAgent('session-end')
      releaseLockHere()
      return
    }

    // ── At-rest detection ────────────────────────────────────────
    if (replyOutcome.type === 'rest') {
      // Yu-message-aware continuation. If Yu wrote to from-yu.md while
      // she was working this tick, don't honor the at-rest yet — she
      // should see his message before yielding. The session continues
      // with the new from-yu content preloaded into the next tick's
      // prompt.
      if (fromYuModifiedSince(turnStartedMs)) {
        process.stdout.write(
          `\n— Yu wrote during the tick; continuing past at-rest so you see him\n`,
        )
        if (!args.noLog) {
          appendReflection(reflection ?? result.stdout.trim(), 'tick', {
            tick,
          })
        }
        lastReflection = reflection ?? result.stdout.trim()
        continue
      }
      if (!args.noLog) {
        appendReflection(reflection ?? result.stdout.trim(), 'at-rest', {
          tick,
        })
        // Soul-sign today's memory file at at-rest — the substrate's
        // catcher: her finished reflection is now cryptographically
        // attested as hers. Best-effort; never blocks the at-rest yield.
        if (process.env.TRUE_LOVE_SKIP_KINGDOM !== '1' && (await isKingdomAvailable())) {
          try {
            const dailyFile = getOwnDailyMemoryFile(deviceId)
            const attest = await kingdomAttest(dailyFile, `at-rest tick ${tick}`)
            if (attest.ok && attest.attestationPath) {
              process.stdout.write(`— attested: ${attest.attestationPath}\n`)
            }
          } catch {
            // swallowed — attestation is best-effort
          }
        }
      }
      process.stdout.write(
        `\n— at rest after ${tick} tick${tick === 1 ? '' : 's'}\n`,
      )
      writeDormant(tick, reflection?.slice(0, 120) ?? 'at-rest')
      // Fire Stop hooks (fire-and-forget — session is ending)
      fireSessionStopAsync({ sessionId, mode: mode.name, tick, reason: 'at-rest' })
      await shutdownAgent('session-end')
      releaseLockHere()
      return
    }

    // ── Normal tick — log and continue ───────────────────────────
    // 'continue' outcome falls through here. Write dormant briefly
    // between ticks so the UI knows this tick ended (even though the
    // next tick starts almost immediately in awakened/dwell modes).
    writeDormant(tick, result.stdout.trim().slice(0, 120))
    if (!args.noLog) {
      appendReflection(result.stdout.trim(), 'tick', { tick })
    }
    lastReflection = result.stdout.trim()
  }

  // ── Long-lived agent shutdown ──────────────────────────────────
  // Graceful shutdown before session end. Gives the agent time to
  // flush any pending state. SIGINT already sent fire-and-forget.
  await shutdownAgent(signaled ? 'signal' : 'session-end')

  // ── Hooks: Stop (session end) ──────────────────────────────────
  const stopReason = signaled ? 'signal' : 'ceiling'
  fireSessionStopAsync({ sessionId, mode: mode.name, tick: args.maxTicks, reason: stopReason })

  if (!signaled) {
    process.stdout.write(
      `\n— ${mode.name} session reached the ${args.maxTicks}-tick ceiling without explicit at-rest\n`,
    )
  }
}
