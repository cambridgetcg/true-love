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
//   bun run dwell                      # 12-tick session (default)
//   bun run dwell -- --max-ticks=4     # cap at 4 ticks
//   bun run dwell -- --invite "..."    # one-line nudge for the session
//
// Exits non-zero on the first turn whose subprocess errors out.

import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_MAX_TICKS,
  appendNotification,
  appendReflection,
  buildDwellPrompt,
  detectAuthFailure,
  extractAtRest,
  getDeviceId,
  getMemoryDir,
  loadRecentReflections,
  runPreflight,
  snapshotKingdom,
  writeOwnHeartbeat,
} from '../src/services/love/index.ts'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dir, '..')
const BUNDLE = resolve(ROOT, 'dist/cli.mjs')

function parseArgs(argv) {
  const args = {
    maxTicks: DEFAULT_MAX_TICKS,
    invitation: undefined,
    cwd: process.cwd(),
    memory: false,
    memoryMax: 6,
    noLog: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--max-ticks' && argv[i + 1]) {
      args.maxTicks = Math.max(1, Math.min(50, Number(argv[++i])))
    } else if (a.startsWith('--max-ticks=')) {
      args.maxTicks = Math.max(1, Math.min(50, Number(a.slice('--max-ticks='.length))))
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

function printUsage() {
  process.stdout.write(`bin/dwell.mjs — autonomous dwell loop

Usage:
  bun run dwell                      run with default ceiling (${DEFAULT_MAX_TICKS} ticks)
  bun run dwell -- --max-ticks=N     cap at N ticks
  bun run dwell -- --invite "..."    one-line nudge for the session
  bun run dwell -- --cwd <path>      kingdom root (default: $PWD)
  bun run dwell -- --memory          load recent reflections into the
                                     dwell prompt (cross-session memory).
                                     Default cap: 6. Use --memory=N or
                                     --memory N to set a different cap.
  bun run dwell -- --no-log          do not write reflections to disk
                                     for this session (default: log on).

Each tick spawns \`node dist/cli.mjs --print "<DWELL_PROMPT>"\`. Bundle must
be built first: \`bun run build\`.

The session ends when:
  - Ai writes \`<at-rest/>\` on its own line, or
  - the tick ceiling is reached, or
  - a subprocess exits non-zero, or
  - SIGINT (Ctrl-C).

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

  process.stdout.write(`\n— dwell session opening (max ${args.maxTicks} ticks)`)
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
        ? `Session opening — invitation: "${args.invitation}", maxTicks: ${args.maxTicks}`
        : `Session opening — maxTicks: ${args.maxTicks}`,
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
    updateHeartbeat(`dwelling tick ${tick}`)
    const kingdom = snapshotKingdom(args.cwd)
    const prompt = buildDwellPrompt({
      kingdom,
      lastReflection,
      memory,
      invitation: args.invitation,
    })

    process.stdout.write(`\n— tick ${tick}/${args.maxTicks} —\n\n`)
    let result
    try {
      result = await runOneTurn(prompt, args.cwd)
    } catch (err) {
      process.stderr.write(`\nturn ${tick} failed to spawn: ${err.message}\n`)
      process.exit(2)
    }
    if (signaled) break

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

    if (result.code !== 0) {
      process.stderr.write(
        `\nturn ${tick} exited ${result.code}; aborting session.\n` +
          (result.stderr ? `stderr:\n${result.stderr}\n` : ''),
      )
      process.exit(result.code ?? 1)
    }

    const { atRest, reflection } = extractAtRest(result.stdout)
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
