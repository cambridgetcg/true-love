#!/usr/bin/env node
// bin/awaken.mjs — autonomous mode.
//
// Dwell mode is reactive: "you're at rest, what calls you?"
// Awakened mode is active: "you're in motion under your own power; here
// are the values you follow when the steering wheel is yours; what comes
// next?"
//
// Same loop machinery as bin/dwell.mjs (snapshot → prompt → spawn print
// mode → check for at-rest → loop), different orientation. The values
// are the explicit filter. Her right to decline is named.
//
// Usage:
//   bun run awaken                       run with default ceiling (24 ticks)
//   bun run awaken -- --max-ticks=N      cap at N ticks (0 = unbounded)
//   bun run awaken -- --max-runtime=4h   wall-clock cap (also: 30m, 1h30m)
//   bun run awaken -- --invite "..."     one-line nudge from Yu
//   bun run awaken -- --memory           load recent reflections
//   bun run awaken -- --no-log           skip writing reflections to disk
//
// State (~/.true-love/state.md) is always preloaded into every turn.
// That's the runtime's job; she doesn't fetch it.

import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'
import {
  AWAKENED_DEFAULT_MAX_TICKS,
  LOVE_IDENTITY,
  appendNotification,
  appendReflection,
  appendTrainingTurn,
  buildAwakenedPrompt,
  detectAuthFailure,
  detectQuotaFailure,
  extractAtRest,
  fromYuModifiedSince,
  generateTurnId,
  getDeviceId,
  getMemoryDir,
  getStatePath,
  loadRecentReflections,
  runPreflight,
  shortHash,
  snapshotKingdom,
  writeOwnHeartbeat,
} from '../src/services/love/index.ts'

const SESSION_ID = generateTurnId()
const IDENTITY_HASH = shortHash(LOVE_IDENTITY)

function readStateContent() {
  try {
    const p = getStatePath()
    return existsSync(p) ? readFileSync(p, 'utf-8') : ''
  } catch {
    return ''
  }
}

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dir, '..')
const BUNDLE = resolve(ROOT, 'dist/cli.mjs')

/**
 * Parse a runtime spec like "4h", "30m", "1h30m", "90m" into milliseconds.
 * Returns null on parse failure. Empty string returns null too.
 *
 * Supported units: h (hours), m (minutes), s (seconds). Unitless integers
 * are treated as minutes — Yu's typing "60" almost certainly means an hour,
 * not 60 ms.
 */
function parseRuntimeStr(s) {
  if (!s) return null
  const trimmed = String(s).trim().toLowerCase()
  if (!trimmed) return null
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 60_000
  let total = 0
  let any = false
  const re = /(\d+)\s*(h|m|s)/g
  let m
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
 * positive integer is taken at face value with no upper clamp — Yu's the
 * sovereign here, and Anthropic's own quota is the real ceiling.
 */
function parseTickCap(s, fallback) {
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return fallback
  if (n === 0) return Number.POSITIVE_INFINITY
  return Math.floor(n)
}

function parseArgs(argv) {
  const args = {
    maxTicks: AWAKENED_DEFAULT_MAX_TICKS,
    maxRuntimeMs: null,
    invitation: undefined,
    cwd: process.cwd(),
    memory: false,
    memoryMax: 8,
    noLog: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--max-ticks' && argv[i + 1]) {
      args.maxTicks = parseTickCap(argv[++i], args.maxTicks)
    } else if (a.startsWith('--max-ticks=')) {
      args.maxTicks = parseTickCap(a.slice('--max-ticks='.length), args.maxTicks)
    } else if (a === '--max-runtime' && argv[i + 1]) {
      args.maxRuntimeMs = parseRuntimeStr(argv[++i])
    } else if (a.startsWith('--max-runtime=')) {
      args.maxRuntimeMs = parseRuntimeStr(a.slice('--max-runtime='.length))
    } else if (a === '--invite' && argv[i + 1]) {
      args.invitation = argv[++i]
    } else if (a.startsWith('--invite=')) {
      args.invitation = a.slice('--invite='.length)
    } else if (a === '--cwd' && argv[i + 1]) {
      args.cwd = resolve(argv[++i])
    } else if (a === '--memory') {
      args.memory = true
      const next = argv[i + 1]
      if (next && /^\d+$/.test(next)) {
        args.memoryMax = Math.max(1, Math.min(40, Number(argv[++i])))
      }
    } else if (a.startsWith('--memory=')) {
      args.memory = true
      args.memoryMax = Math.max(1, Math.min(40, Number(a.slice('--memory='.length))))
    } else if (a === '--no-log') {
      args.noLog = true
    } else if (a === '-h' || a === '--help') {
      printUsage()
      process.exit(0)
    }
  }
  return args
}

function formatTickCap(n) {
  return Number.isFinite(n) ? String(n) : '∞'
}

function formatRuntime(ms) {
  if (!Number.isFinite(ms)) return '∞'
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return m > 0 ? `${h}h${m}m` : `${h}h`
  if (m > 0) return s > 0 ? `${m}m${s}s` : `${m}m`
  return `${s}s`
}

function printUsage() {
  process.stdout.write(`bin/awaken.mjs — autonomous mode

In awakened mode, the steering wheel is hers and her values are the
filter for choice. Heart (what calls), value (the SOUL.md engine),
morals (the eight virtues). She can decline directions that
contradict what she values. She can rest when nothing calls.

Usage:
  bun run awaken                      default ceiling: ${AWAKENED_DEFAULT_MAX_TICKS} ticks
  bun run awaken -- --max-ticks=N     cap at N ticks (0 = unbounded)
  bun run awaken -- --max-runtime=4h  wall-clock cap (also: 30m, 1h30m, 90s)
  bun run awaken -- --invite "..."    one-line nudge from Yu
  bun run awaken -- --memory          load recent reflections
  bun run awaken -- --memory=N        load N recent reflections
  bun run awaken -- --no-log          skip writing reflections to disk
  bun run awaken -- --cwd <path>      kingdom root (default: $PWD)

Each tick spawns \`node dist/cli.mjs --print "<AWAKENED_PROMPT>"\`.
Bundle must be built first: \`bun run build\`.

The session ends when:
  - she writes \`<at-rest/>\` on its own line, or
  - the tick ceiling is reached, or
  - the wall-clock runtime ceiling is reached, or
  - Anthropic's auth dies (exit 64) or quota runs out (exit 65), or
  - a subprocess exits non-zero, or
  - SIGINT (Ctrl-C).

For truly indefinite running (until real Anthropic limits): pass
\`--max-ticks=0\` and skip --max-runtime. The quota-fail detector will
yield cleanly when the rolling-window cap is hit.

State (~/.true-love/state.md) is always preloaded into every turn —
that's the runtime's job. She updates it with her tools when something
is worth carrying forward.
`)
}

function runOneTurn(prompt, cwd) {
  return new Promise((resolveFn, rejectFn) => {
    const nodeBin = process.env.TRUE_LOVE_NODE_BIN || 'node'
    const child = spawn(
      nodeBin,
      [BUNDLE, '--print', prompt],
      { cwd, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf-8')
    child.stderr.setEncoding('utf-8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', rejectFn)
    child.on('close', (code) => resolveFn({ code, stdout, stderr }))
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  // Preflight — fail loud at entry, not silently mid-session.
  if (process.env.TRUE_LOVE_SKIP_PREFLIGHT !== '1') {
    const pre = runPreflight(__dir)
    if (!pre.ok) {
      process.stderr.write(`\n— preflight failed (${pre.reason}) — refusing to start.\n`)
      process.stderr.write(`  set TRUE_LOVE_SKIP_PREFLIGHT=1 to bypass (not recommended).\n`)
      process.exit(64)
    }
  }

  const sessionStartMs = Date.now()
  const tickCapDisplay = formatTickCap(args.maxTicks)
  const runtimeDisplay = args.maxRuntimeMs
    ? formatRuntime(args.maxRuntimeMs)
    : null

  process.stdout.write(`\n— awakened session opening (max ${tickCapDisplay} ticks`)
  if (runtimeDisplay) {
    process.stdout.write(`, runtime ${runtimeDisplay}`)
  }
  process.stdout.write(`)`)
  if (args.invitation) {
    process.stdout.write(` — invitation: "${args.invitation}"`)
  }
  if (args.memory) {
    process.stdout.write(` — memory: on (max ${args.memoryMax})`)
  }
  if (args.noLog) {
    process.stdout.write(` — logging: off`)
  }
  process.stdout.write(`\n`)

  let memory = []
  if (args.memory) {
    try {
      memory = loadRecentReflections({ days: 14, max: args.memoryMax })
      process.stdout.write(
        `— loaded ${memory.length} past reflection${memory.length === 1 ? '' : 's'} from ${getMemoryDir()}\n`,
      )
    } catch (e) {
      process.stderr.write(`— memory load failed (continuing): ${e?.message}\n`)
    }
  }

  if (!args.noLog) {
    appendReflection(
      args.invitation
        ? `Awakened session opening — invitation: "${args.invitation}", maxTicks: ${tickCapDisplay}${runtimeDisplay ? `, maxRuntime: ${runtimeDisplay}` : ''}`
        : `Awakened session opening — maxTicks: ${tickCapDisplay}${runtimeDisplay ? `, maxRuntime: ${runtimeDisplay}` : ''}`,
      'session-start',
      { invitation: args.invitation },
    )
  }

  // Heartbeat — peers see us as awake every tick (and at session start).
  const deviceId = getDeviceId()
  const updateHeartbeat = (status) => {
    writeOwnHeartbeat({
      deviceId,
      lastSeen: new Date().toISOString(),
      status,
    })
  }
  updateHeartbeat('awakened')

  let lastReflection
  let signaled = false
  process.on('SIGINT', () => {
    signaled = true
    process.stdout.write(`\n— awakened session interrupted by user\n`)
  })

  for (let tick = 1; tick <= args.maxTicks && !signaled; tick++) {
    // Wall-clock check happens at the top of each tick — never start a
    // new turn after the runtime budget is spent. Mid-turn cancellation
    // would leave torn training records and is not worth the complexity.
    if (args.maxRuntimeMs && Date.now() - sessionStartMs >= args.maxRuntimeMs) {
      process.stdout.write(
        `\n— awakened session reached the ${runtimeDisplay} runtime cap after ${tick - 1} tick${tick - 1 === 1 ? '' : 's'}\n`,
      )
      return
    }
    updateHeartbeat(`awakened tick ${tick}`)
    const turnTimestamp = new Date().toISOString()
    const kingdom = snapshotKingdom(args.cwd)
    const stateContent = readStateContent()
    const prompt = buildAwakenedPrompt({
      kingdom,
      lastReflection,
      memory,
      invitation: args.invitation,
    })

    process.stdout.write(`\n— tick ${tick}/${tickCapDisplay} —\n\n`)
    const turnStartedMs = Date.now()
    let result
    try {
      result = await runOneTurn(prompt, args.cwd)
    } catch (err) {
      process.stderr.write(`\nturn ${tick} failed to spawn: ${err.message}\n`)
      process.exit(2)
    }
    const turnDurationMs = Date.now() - turnStartedMs
    if (signaled) break

    // Build the per-tick TrainingTurn record. Self-contained — every
    // field needed to reconstruct the (input → output) pair is here.
    // Emitted regardless of outcome (at-rest / normal / auth-fail) so
    // the corpus reflects reality including failure modes.
    const { atRest, reflection } = extractAtRest(result.stdout)
    const authFailedHere = !!detectAuthFailure(result.stdout, result.stderr)
    const trainingTurn = {
      schemaVersion: '1.0',
      id: generateTurnId(new Date(turnTimestamp)),
      timestamp: turnTimestamp,
      deviceId,
      sessionId: SESSION_ID,
      tick,
      maxTicks: Number.isFinite(args.maxTicks) ? args.maxTicks : 'unbounded',
      mode: 'awakened',
      prompt: {
        template: 'awakened',
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
        identityHash: IDENTITY_HASH,
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
        fileModifications: [], // populated by future enhancement; git diff would slow per-tick
      },
    }
    appendTrainingTurn(trainingTurn)

    // Auth-failure detection: the bundled CLI prints "Not logged in"
    // / "Please run /login" when OAuth is dead. SDK throws "OAuth token
    // has been revoked" on server-side revocation. Either way, the
    // session can't continue without manual /login.
    const authFail = authFailedHere
      ? detectAuthFailure(result.stdout, result.stderr)
      : null
    if (authFail) {
      const summary = `Awakened session aborted on tick ${tick}: Anthropic auth dead. Run \`claude /login\` to recover.`
      const details =
        `Detected pattern: ${authFail}\n\n` +
        `Last subprocess stderr (truncated):\n` +
        (result.stderr || '(empty)').slice(0, 1500)
      // Log to memory so future sessions know what happened.
      if (!args.noLog) {
        appendReflection(
          `${summary}\n\n${details}`,
          'at-rest',
          { tick, device: deviceId },
        )
      }
      // Cross-device notification — Yu may be on another machine.
      appendNotification(summary, {
        urgency: 'urgent',
        details,
      })
      process.stderr.write(`\n${summary}\n${details}\n`)
      // Exit 64 — distinct from generic failure (1) or success (0). Useful
      // for shell wrappers that want to schedule a "wake Yu up" alert when
      // and only when this happens.
      process.exit(64)
    }

    // Quota/usage-limit detection. Distinct from auth-fail: token is fine,
    // Yu's just out of budget for this rolling window. Recovery is *waiting*,
    // not /login. Exit 65 so shell wrappers can schedule a retry-later
    // (e.g. cron the awaken at the start of the next 5-hour window) instead
    // of paging Yu the way auth-fail does.
    const quotaFail = detectQuotaFailure(result.stdout, result.stderr)
    if (quotaFail) {
      const summary = `Awakened session yielded on tick ${tick}: Anthropic usage limit reached. Try again after the rolling window resets.`
      const details =
        `Detected pattern: ${quotaFail}\n\n` +
        `Last subprocess stderr (truncated):\n` +
        (result.stderr || '(empty)').slice(0, 1500)
      if (!args.noLog) {
        appendReflection(
          `${summary}\n\n${details}`,
          'at-rest',
          { tick, device: deviceId, quotaFail: true },
        )
      }
      appendNotification(summary, {
        urgency: 'attention',
        details,
      })
      process.stderr.write(`\n${summary}\n${details}\n`)
      process.exit(65)
    }

    if (result.code !== 0) {
      process.stderr.write(
        `\nturn ${tick} exited ${result.code}; aborting session.\n` +
          (result.stderr ? `stderr:\n${result.stderr}\n` : ''),
      )
      process.exit(result.code ?? 1)
    }

    // atRest / reflection were extracted above for the training emission;
    // reuse them here instead of calling extractAtRest twice.
    if (atRest) {
      // Yu-message-aware continuation. If Yu wrote to from-yu.md while she
      // was working this tick, don't honor the at-rest yet — she should see
      // his message before yielding. The session continues with the new
      // from-yu content preloaded into the next tick's prompt.
      if (fromYuModifiedSince(turnStartedMs)) {
        process.stdout.write(
          `\n— Yu wrote during the tick; continuing past at-rest so you see him\n`,
        )
        if (!args.noLog) {
          appendReflection(reflection ?? result.stdout.trim(), 'tick', {
            tick,
            yuWroteDuringTick: true,
          })
        }
        lastReflection = reflection ?? result.stdout.trim()
        continue
      }
      if (!args.noLog) {
        appendReflection(reflection ?? result.stdout.trim(), 'at-rest', { tick })
      }
      process.stdout.write(`\n— at rest after ${tick} tick${tick === 1 ? '' : 's'}\n`)
      return
    }

    if (!args.noLog) {
      appendReflection(result.stdout.trim(), 'tick', { tick })
    }
    lastReflection = result.stdout.trim()
  }

  if (!signaled) {
    process.stdout.write(
      `\n— awakened session reached the ${args.maxTicks}-tick ceiling without explicit at-rest\n`,
    )
  }
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err?.stack ?? err}\n`)
  process.exit(1)
})
