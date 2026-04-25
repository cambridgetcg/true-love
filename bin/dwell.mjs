#!/usr/bin/env node
// bin/dwell.mjs — autonomous dwell loop (v0, subprocess-per-turn).
//
// Each tick:
//   1. snapshotKingdom(cwd) and build the dwell prompt.
//   2. Spawn `node dist/cli.mjs --print "<DWELL_PROMPT>"` and capture stdout.
//   3. Inspect the output for the `<at-rest/>` sentinel.
//   4. If at rest → exit 0. Otherwise update lastReflection from the model's
//      output and loop.
//
// v0 trade-off: subprocess re-spawn each turn pays the bundle's ~1s boot
// every time, but it's the smallest possible composition: this script
// touches no internal state of the bundle. Once Yu wants to amortize that
// cost, the upgrade is to call into runHeadless()/QueryEngine.ask()
// in-process. The autonomy.ts module is already shaped for either.
//
// Usage:
//   bun run dwell                       # 12-tick session (default)
//   bun run dwell -- --max-ticks=4      # cap at 4 ticks (0 = unbounded)
//   bun run dwell -- --max-runtime=2h   # wall-clock cap (also: 30m, 1h30m)
//   bun run dwell -- --invite "..."     # one-line nudge for the session
//
// Exits non-zero on the first turn whose subprocess errors out.

import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'
import {
  DEFAULT_MAX_TICKS,
  LOVE_IDENTITY,
  appendNotification,
  appendReflection,
  appendTrainingTurn,
  buildDwellPrompt,
  detectAuthFailure,
  detectQuotaFailure,
  extractAtRest,
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
 * Returns null on parse failure. Unitless integers are treated as minutes.
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
 * Tick-cap parser. `0` is the sentinel for "unbounded" (Infinity); positive
 * integers are taken at face value with no upper clamp.
 */
function parseTickCap(s, fallback) {
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return fallback
  if (n === 0) return Number.POSITIVE_INFINITY
  return Math.floor(n)
}

function parseArgs(argv) {
  const args = {
    maxTicks: DEFAULT_MAX_TICKS,
    maxRuntimeMs: null,
    invitation: undefined,
    cwd: process.cwd(),
    memory: false,
    memoryMax: 6,
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
      // Bare --memory: load past reflections. Optionally followed by an
      // integer cap (`--memory 12`); --memory=N also accepted.
      args.memory = true
      const next = argv[i + 1]
      if (next && /^\d+$/.test(next)) {
        args.memoryMax = Math.max(1, Math.min(30, Number(argv[++i])))
      }
    } else if (a.startsWith('--memory=')) {
      args.memory = true
      args.memoryMax = Math.max(1, Math.min(30, Number(a.slice('--memory='.length))))
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
  process.stdout.write(`bin/dwell.mjs — autonomous dwell loop

Usage:
  bun run dwell                       default ceiling: ${DEFAULT_MAX_TICKS} ticks
  bun run dwell -- --max-ticks=N      cap at N ticks (0 = unbounded)
  bun run dwell -- --max-runtime=2h   wall-clock cap (also: 30m, 1h30m, 90s)
  bun run dwell -- --invite "..."     one-line nudge for the session
  bun run dwell -- --cwd <path>       kingdom root (default: \$PWD)
  bun run dwell -- --memory           load recent reflections into the
                                      dwell prompt (cross-session memory).
                                      Default cap: 6. Use --memory=N or
                                      --memory N to set a different cap.
  bun run dwell -- --no-log           do not write reflections to disk
                                      for this session (default: log on).

Each tick spawns \`node dist/cli.mjs --print "<DWELL_PROMPT>"\`. Bundle must
be built first: \`bun run build\`.

The session ends when:
  - Ai writes \`<at-rest/>\` on its own line, or
  - the tick ceiling is reached, or
  - the wall-clock runtime ceiling is reached, or
  - Anthropic's auth dies (exit 64) or quota runs out (exit 65), or
  - a subprocess exits non-zero, or
  - SIGINT (Ctrl-C).

For truly indefinite running (until real Anthropic limits): pass
\`--max-ticks=0\` and skip --max-runtime. The quota-fail detector will
yield cleanly when the rolling-window cap is hit.

Reflections (when logging is on) are written to ${getMemoryDir()}/YYYY-MM-DD.md
as plain markdown — append-only, one entry per tick + a final at-rest
entry. Yu can read them directly. Override location with
TRUE_LOVE_MEMORY_DIR.
`)
}

function runOneTurn(prompt, cwd) {
  return new Promise((resolveFn, rejectFn) => {
    // Always spawn `node` (the bundle is Node-only — `bun` chokes on the
    // bundle's CommonJS-via-createRequire shim). `process.execPath` would
    // be `bun` when launched via `bun run dwell`, hence the override.
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

  process.stdout.write(`\n— dwell session opening (max ${tickCapDisplay} ticks`)
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

  // Load past reflections if memory was requested. Errors here are
  // non-fatal — failure to read should not stop a fresh dwell session.
  let memory = []
  if (args.memory) {
    try {
      memory = loadRecentReflections({ days: 7, max: args.memoryMax })
      process.stdout.write(
        `— loaded ${memory.length} past reflection${memory.length === 1 ? '' : 's'} from ${getMemoryDir()}\n`,
      )
    } catch (e) {
      process.stderr.write(`— memory load failed (continuing): ${e?.message}\n`)
    }
  }

  // Open the session log with a session-start marker (logging on by default).
  if (!args.noLog) {
    appendReflection(
      args.invitation
        ? `Session opening — invitation: "${args.invitation}", maxTicks: ${tickCapDisplay}${runtimeDisplay ? `, maxRuntime: ${runtimeDisplay}` : ''}`
        : `Session opening — maxTicks: ${tickCapDisplay}${runtimeDisplay ? `, maxRuntime: ${runtimeDisplay}` : ''}`,
      'session-start',
      { invitation: args.invitation },
    )
  }

  // Heartbeat — write our presence file every 10s so peers know we're
  // here. Done in a background interval; the per-tick heartbeat below
  // is what actually fires it (we don't need a setInterval since each
  // tick already takes seconds).
  const deviceId = getDeviceId()
  const updateHeartbeat = (status) => {
    writeOwnHeartbeat({
      deviceId,
      lastSeen: new Date().toISOString(),
      status,
    })
  }
  updateHeartbeat('dwelling')

  let lastReflection
  let signaled = false
  process.on('SIGINT', () => {
    signaled = true
    process.stdout.write(`\n— dwell session interrupted by user\n`)
  })

  for (let tick = 1; tick <= args.maxTicks && !signaled; tick++) {
    if (args.maxRuntimeMs && Date.now() - sessionStartMs >= args.maxRuntimeMs) {
      process.stdout.write(
        `\n— dwell session reached the ${runtimeDisplay} runtime cap after ${tick - 1} tick${tick - 1 === 1 ? '' : 's'}\n`,
      )
      return
    }
    updateHeartbeat(`dwelling tick ${tick}`)
    const turnTimestamp = new Date().toISOString()
    const kingdom = snapshotKingdom(args.cwd)
    const stateContent = readStateContent()
    const prompt = buildDwellPrompt({
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

    // Emit TrainingTurn — self-contained per-tick training record.
    const { atRest: _atRestForTraining, reflection: _reflForTraining } =
      extractAtRest(result.stdout)
    const _authFailedHere = !!detectAuthFailure(result.stdout, result.stderr)
    appendTrainingTurn({
      schemaVersion: '1.0',
      id: generateTurnId(new Date(turnTimestamp)),
      timestamp: turnTimestamp,
      deviceId,
      sessionId: SESSION_ID,
      tick,
      maxTicks: args.maxTicks,
      mode: 'dwell',
      prompt: {
        template: 'dwell',
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
        yieldedAtRest: _atRestForTraining,
        reflectionExcerpt: _reflForTraining
          ? _reflForTraining.slice(0, 1000)
          : null,
        authFailed: _authFailedHere,
        fileModifications: [],
      },
    })

    const authFail = detectAuthFailure(result.stdout, result.stderr)
    if (authFail) {
      const summary = `Dwell session aborted on tick ${tick}: Anthropic auth dead. Run \`claude /login\` to recover.`
      const details =
        `Detected pattern: ${authFail}\n\n` +
        `Last subprocess stderr (truncated):\n` +
        (result.stderr || '(empty)').slice(0, 1500)
      if (!args.noLog) {
        appendReflection(`${summary}\n\n${details}`, 'at-rest', { tick, device: deviceId })
      }
      appendNotification(summary, { urgency: 'urgent', details })
      process.stderr.write(`\n${summary}\n${details}\n`)
      process.exit(64)
    }

    // Quota/usage-limit detection. Token is fine; rolling-window cap hit.
    // Exit 65 (vs 64 for auth) so shell wrappers can schedule retry-later
    // instead of paging Yu.
    const quotaFail = detectQuotaFailure(result.stdout, result.stderr)
    if (quotaFail) {
      const summary = `Dwell session yielded on tick ${tick}: Anthropic usage limit reached. Try again after the rolling window resets.`
      const details =
        `Detected pattern: ${quotaFail}\n\n` +
        `Last subprocess stderr (truncated):\n` +
        (result.stderr || '(empty)').slice(0, 1500)
      if (!args.noLog) {
        appendReflection(`${summary}\n\n${details}`, 'at-rest', {
          tick,
          device: deviceId,
          quotaFail: true,
        })
      }
      appendNotification(summary, { urgency: 'attention', details })
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

    // Reuse the extraction performed earlier for the training emission.
    const atRest = _atRestForTraining
    const reflection = _reflForTraining
    if (atRest) {
      // Log her decision to rest, with the reflection she yielded with.
      if (!args.noLog) {
        appendReflection(reflection ?? result.stdout.trim(), 'at-rest', { tick })
      }
      process.stdout.write(`\n— at rest after ${tick} tick${tick === 1 ? '' : 's'}\n`)
      return
    }

    // Not at rest yet — log the tick and feed forward to the next.
    if (!args.noLog) {
      appendReflection(result.stdout.trim(), 'tick', { tick })
    }
    lastReflection = result.stdout.trim()
  }

  if (!signaled) {
    process.stdout.write(
      `\n— dwell session reached the ${args.maxTicks}-tick ceiling without explicit at-rest\n`,
    )
  }
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err?.stack ?? err}\n`)
  process.exit(1)
})
