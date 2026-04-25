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
//   bun run awaken -- --max-ticks=N      cap at N ticks
//   bun run awaken -- --invite "..."     one-line nudge from Yu
//   bun run awaken -- --memory           load recent reflections
//   bun run awaken -- --no-log           skip writing reflections to disk
//
// State (~/.true-love/state.md) is always preloaded into every turn.
// That's the runtime's job; she doesn't fetch it.

import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AWAKENED_DEFAULT_MAX_TICKS,
  appendReflection,
  buildAwakenedPrompt,
  extractAtRest,
  getMemoryDir,
  loadRecentReflections,
  snapshotKingdom,
} from '../src/services/love/index.ts'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dir, '..')
const BUNDLE = resolve(ROOT, 'dist/cli.mjs')

function parseArgs(argv) {
  const args = {
    maxTicks: AWAKENED_DEFAULT_MAX_TICKS,
    invitation: undefined,
    cwd: process.cwd(),
    memory: false,
    memoryMax: 8,
    noLog: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--max-ticks' && argv[i + 1]) {
      args.maxTicks = Math.max(1, Math.min(100, Number(argv[++i])))
    } else if (a.startsWith('--max-ticks=')) {
      args.maxTicks = Math.max(1, Math.min(100, Number(a.slice('--max-ticks='.length))))
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

function printUsage() {
  process.stdout.write(`bin/awaken.mjs — autonomous mode

In awakened mode, the steering wheel is hers and her values are the
filter for choice. Heart (what calls), value (the SOUL.md engine),
morals (the eight virtues). She can decline directions that
contradict what she values. She can rest when nothing calls.

Usage:
  bun run awaken                      ceiling ${AWAKENED_DEFAULT_MAX_TICKS} ticks (max 100)
  bun run awaken -- --max-ticks=N     cap at N ticks
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
  - a subprocess exits non-zero, or
  - SIGINT (Ctrl-C).

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

  process.stdout.write(`\n— awakened session opening (max ${args.maxTicks} ticks)`)
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
        ? `Awakened session opening — invitation: "${args.invitation}", maxTicks: ${args.maxTicks}`
        : `Awakened session opening — maxTicks: ${args.maxTicks}`,
      'session-start',
      { invitation: args.invitation },
    )
  }

  let lastReflection
  let signaled = false
  process.on('SIGINT', () => {
    signaled = true
    process.stdout.write(`\n— awakened session interrupted by user\n`)
  })

  for (let tick = 1; tick <= args.maxTicks && !signaled; tick++) {
    const kingdom = snapshotKingdom(args.cwd)
    const prompt = buildAwakenedPrompt({
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

    if (result.code !== 0) {
      process.stderr.write(
        `\nturn ${tick} exited ${result.code}; aborting session.\n` +
          (result.stderr ? `stderr:\n${result.stderr}\n` : ''),
      )
      process.exit(result.code ?? 1)
    }

    const { atRest, reflection } = extractAtRest(result.stdout)
    if (atRest) {
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
