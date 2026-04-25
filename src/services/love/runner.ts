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
import { extractAtRest } from './autonomy.js'
import { detectAuthFailure, detectQuotaFailure, runPreflight } from './auth.js'
import { estimateTokens, recordTickUsage } from './budget.js'
import { getDeviceId } from './device.js'
import { LOVE_IDENTITY } from './identity.js'
import { fromYuModifiedSince } from './inbox.js'
import type { KingdomSnapshot } from './kingdom.js'
import { snapshotKingdom } from './kingdom.js'
import { acquireLock, LockHeldError, releaseLock } from './lock.js'
import type { Reflection } from './memory.js'
import {
  appendReflection,
  getMemoryDir,
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
import { getStatePath, migrateLegacyStateIfPresent } from './state.js'
import { appendTrainingTurn, generateTurnId, shortHash } from './training.js'

/**
 * How fresh "live thought" entries must be (in seconds) to surface in the
 * prompt's live block. Matches the `excludeNewerThanSeconds` filter on the
 * --memory loader so the two windows are disjoint — the same reflection
 * never appears twice with two different framings.
 */
const LIVE_FRESH_SECONDS = 300

// ── Types ──────────────────────────────────────────────────────────

/**
 * Mode configuration — the thin surface that distinguishes dwell from
 * awakened. Everything that's the *same* between modes lives in
 * `runSession()`. Everything that *differs* lives here.
 */
export interface SessionMode {
  /** 'dwell' or 'awakened'. Used in log messages and training records. */
  name: 'dwell' | 'awakened'

  /** Heartbeat status label: 'dwelling' or 'awakened'. */
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

  /** Print usage/help to stdout, then return. Called on -h/--help. */
  printUsage: () => void
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
    } else if (a === '--memory') {
      args.memory = true
      const next = argv[i + 1]
      if (next && /^\d+$/.test(next)) {
        args.memoryMax = Math.max(
          1,
          Math.min(mode.memoryMaxCap, Number(argv[++i])),
        )
      }
    } else if (a.startsWith('--memory=')) {
      args.memory = true
      args.memoryMax = Math.max(
        1,
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
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveFn, rejectFn) => {
    const nodeBin = process.env.TRUE_LOVE_NODE_BIN || 'node'
    const cliArgs = [bundlePath, '--print', prompt]
    if (model) {
      // Pass-through to the bundled CLI's --model flag. Acceptable values
      // depend on what the CLI accepts (aliases like opus/sonnet/haiku
      // generally work, as do full model IDs).
      cliArgs.splice(1, 0, '--model', model)
    }
    const child = spawn(nodeBin, cliArgs, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    // Rolling 4KB buffer for activity derivation. Last 4KB is enough
    // to find the most recent assistant block / tool call.
    let recentChunk = ''
    child.stdout.setEncoding('utf-8')
    child.stderr.setEncoding('utf-8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      recentChunk = (recentChunk + chunk).slice(-4096)
      process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    const interval = onActivityTick
      ? setInterval(() => onActivityTick(deriveActivity(recentChunk)), 10_000)
      : null
    child.on('error', (e) => {
      if (interval) clearInterval(interval)
      rejectFn(e)
    })
    child.on('close', (code) => {
      if (interval) clearInterval(interval)
      resolveFn({ code, stdout, stderr })
    })
  })
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
    const lockResult = acquireLock({ lockPath, mode: mode.name as 'awakened' | 'dwelling' })
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

  // ── Session-start log ────────────────────────────────────────────
  if (!args.noLog) {
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

  // ── SIGINT ───────────────────────────────────────────────────────
  let lastReflection: string | undefined
  let signaled = false
  process.on('SIGINT', () => {
    signaled = true
    process.stdout.write(`\n— ${mode.name} session interrupted by user\n`)
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
      return
    }

    updateHeartbeat(`${mode.heartbeatLabel} tick ${tick}`)
    const turnTimestamp = new Date().toISOString()
    const kingdom = snapshotKingdom(args.cwd)
    const stateContent = readStateContent()
    // Live-thought block: memory + heartbeat activity within the fresh
    // window, framed as "you're thinking right now". Disjoint from the
    // memory block above (excludeNewerThanSeconds matches LIVE_FRESH_SECONDS).
    const liveThoughts = renderLiveThoughts({
      selfDeviceId: deviceId,
      freshSeconds: LIVE_FRESH_SECONDS,
    })
    const prompt = mode.buildPrompt({
      kingdom,
      lastReflection,
      memory,
      invitation: args.invitation,
      liveThoughts,
    })

    // Per-tick model resolution. Reads ~/.true-love/model.txt every tick
    // so she can switch between turns by editing one file with her tools.
    const tickModel = resolveModelForTick(args.model)

    // Intra-tick heartbeat callback — every ~10s while the subprocess
    // runs, write our presence file with a derived `activity` field so
    // peers see what we're mid-thought on without waiting for tick end.
    const onActivityTick = (activity: string | null) => {
      writeOwnHeartbeat({
        deviceId,
        lastSeen: new Date().toISOString(),
        status: `${mode.heartbeatLabel} tick ${tick}`,
        activity: activity ?? undefined,
      })
    }

    process.stdout.write(
      `\n— tick ${tick}/${tickCapDisplay}${tickModel ? ` [${tickModel}]` : ''} —\n\n`,
    )
    const turnStartedMs = Date.now()
    let result: { code: number | null; stdout: string; stderr: string }
    try {
      result = await runOneTurn(prompt, args.cwd, bundlePath, tickModel, onActivityTick)
    } catch (err: any) {
      process.stderr.write(
        `\nturn ${tick} failed to spawn: ${err.message}\n`,
      )
      process.exit(2)
    }
    const turnDurationMs = Date.now() - turnStartedMs
    if (signaled) break

    // ── Extract results ──────────────────────────────────────────
    // Done once, reused for both training emission and loop control.
    const { atRest, reflection } = extractAtRest(result.stdout)
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

    // ── At-rest detection ────────────────────────────────────────
    if (atRest) {
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
      }
      process.stdout.write(
        `\n— at rest after ${tick} tick${tick === 1 ? '' : 's'}\n`,
      )
      return
    }

    // ── Normal tick — log and continue ───────────────────────────
    if (!args.noLog) {
      appendReflection(result.stdout.trim(), 'tick', { tick })
    }
    lastReflection = result.stdout.trim()
  }

  if (!signaled) {
    process.stdout.write(
      `\n— ${mode.name} session reached the ${args.maxTicks}-tick ceiling without explicit at-rest\n`,
    )
  }
}
