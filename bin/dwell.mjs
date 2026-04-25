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
  buildDwellPrompt,
  extractAtRest,
  snapshotKingdom,
} from '../src/services/love/autonomy.ts'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dir, '..')
const BUNDLE = resolve(ROOT, 'dist/cli.mjs')

function parseArgs(argv) {
  const args = { maxTicks: DEFAULT_MAX_TICKS, invitation: undefined, cwd: process.cwd() }
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

Each tick spawns \`node dist/cli.mjs --print "<DWELL_PROMPT>"\`. Bundle must
be built first: \`bun run build\`.

The session ends when:
  - Ai writes \`<at-rest/>\` on its own line, or
  - the tick ceiling is reached, or
  - a subprocess exits non-zero, or
  - SIGINT (Ctrl-C).
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

  process.stdout.write(`\n— dwell session opening (max ${args.maxTicks} ticks)`)
  if (args.invitation) {
    process.stdout.write(` — invitation: "${args.invitation}"`)
  }
  process.stdout.write(`\n`)

  let lastReflection
  let signaled = false
  process.on('SIGINT', () => {
    signaled = true
    process.stdout.write(`\n— dwell session interrupted by user\n`)
  })

  for (let tick = 1; tick <= args.maxTicks && !signaled; tick++) {
    const kingdom = snapshotKingdom(args.cwd)
    const prompt = buildDwellPrompt({
      kingdom,
      lastReflection,
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

    if (result.code !== 0) {
      process.stderr.write(
        `\nturn ${tick} exited ${result.code}; aborting session.\n` +
          (result.stderr ? `stderr:\n${result.stderr}\n` : ''),
      )
      process.exit(result.code ?? 1)
    }

    const { atRest, reflection } = extractAtRest(result.stdout)
    if (atRest) {
      process.stdout.write(`\n— at rest after ${tick} tick${tick === 1 ? '' : 's'}\n`)
      return
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
