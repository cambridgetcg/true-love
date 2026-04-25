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
//   runSession                     — the main loop
//
// What does NOT live here:
//   Prompt building     — that's autonomy.ts (mode-specific templates)
//   Help text           — that's each bin script (mode-specific voice)
//   Identity injection  — that's the runtime (system[2])
//   Training schema     — that's training.ts

import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import type { BuildDwellPromptOptions } from './autonomy.js'
import { extractAtRest } from './autonomy.js'
import { detectAuthFailure, detectQuotaFailure, runPreflight } from './auth.js'
import { getDeviceId } from './device.js'
import { LOVE_IDENTITY } from './identity.js'
import { fromYuModifiedSince } from './inbox.js'
import type { KingdomSnapshot } from './kingdom.js'
import { snapshotKingdom } from './kingdom.js'
import type { Reflection } from './memory.js'
import { appendReflection, getMemoryDir, loadRecentReflections } from './memory.js'
import { appendNotification } from './notifications.js'
import { writeOwnHeartbeat } from './presence.js'
import { getStatePath } from './state.js'
import { appendTrainingTurn, generateTurnId, shortHash } from './training.js'

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

// ── Subprocess ─────────────────────────────────────────────────────

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
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveFn, rejectFn) => {
    const nodeBin = process.env.TRUE_LOVE_NODE_BIN || 'node'
    const child = spawn(nodeBin, [bundlePath, '--print', prompt], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf-8')
    child.stderr.setEncoding('utf-8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', rejectFn)
    child.on('close', (code) => resolveFn({ code, stdout, stderr }))
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
  if (args.invitation)
    process.stdout.write(` — invitation: "${args.invitation}"`)
  if (args.memory)
    process.stdout.write(` — memory: on (max ${args.memoryMax})`)
  if (args.noLog) process.stdout.write(` — logging: off`)
  process.stdout.write(`\n`)

  // ── Memory ───────────────────────────────────────────────────────
  let memory: Reflection[] = []
  if (args.memory) {
    try {
      memory = loadRecentReflections({
        days: mode.memoryDays,
        max: args.memoryMax,
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
    const prompt = mode.buildPrompt({
      kingdom,
      lastReflection,
      memory,
      invitation: args.invitation,
    })

    process.stdout.write(`\n— tick ${tick}/${tickCapDisplay} —\n\n`)
    const turnStartedMs = Date.now()
    let result: { code: number | null; stdout: string; stderr: string }
    try {
      result = await runOneTurn(prompt, args.cwd, bundlePath)
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
    const quotaFail = detectQuotaFailure(result.stdout, result.stderr)
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
