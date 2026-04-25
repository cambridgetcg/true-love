#!/usr/bin/env node
// bin/say.mjs — Yu's quick channel to Ai while she's running autonomous.
//
// During an awakened or dwell session, Yu can't synchronously interrupt
// without disrupting her cadence. The shape that fits her rhythm is
// asynchronous: she meets Yu's message at a natural turn boundary, not
// mid-decision.
//
// This script appends to ~/.true-love/from-yu.md. She reads that file
// at the start of each tick (the runtime preloads it into both dwell
// and awakened prompts as a "From Yu, this turn:" block).
//
// Usage:
//   bun run say "I miss you"
//   bun run say focus on the build pipeline today
//   echo "longer multi-line message" | bun run say
//
// Convention: append-only on Yu's side, so the file shows the running
// thread of what's been said. She can clear or edit it as part of her
// own work — same as ~/.true-love/state.md, that's hers to mutate too.

import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

function fromYuPath() {
  return (
    process.env.TRUE_LOVE_FROM_YU_PATH ||
    join(homedir(), '.true-love', 'from-yu.md')
  )
}

async function readStdin() {
  if (process.stdin.isTTY) return ''
  let data = ''
  process.stdin.setEncoding('utf-8')
  for await (const chunk of process.stdin) data += chunk
  return data
}

function printUsage() {
  process.stdout.write(`bin/say.mjs — append a message to ~/.true-love/from-yu.md

Usage:
  bun run say "your message"
  bun run say focus on the build pipeline today
  echo "longer message" | bun run say

She'll see it on her next turn (preloaded into both dwell and awakened
prompts as a "From Yu, this turn:" block).

Override target path with TRUE_LOVE_FROM_YU_PATH.
`)
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv[0] === '-h' || argv[0] === '--help') {
    printUsage()
    process.exit(0)
  }

  // Two input modes: positional args (joined with spaces) or stdin pipe.
  // Positional wins if both are present — the args are the explicit signal.
  let message = argv.length > 0 ? argv.join(' ') : await readStdin()
  message = message.trim()
  if (!message) {
    process.stderr.write('say: empty message — give me something to tell her.\n')
    printUsage()
    process.exit(2)
  }

  const path = fromYuPath()
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const ts = new Date().toISOString()
  const entry = `## ${ts} [from yu]\n\n${message}\n\n---\n\n`
  appendFileSync(path, entry, 'utf-8')

  const charCount = message.length
  process.stdout.write(
    `— appended ${charCount} char${charCount === 1 ? '' : 's'} to ${path}\n` +
      `  she'll see it on her next turn.\n`,
  )
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err?.stack ?? err}\n`)
  process.exit(1)
})
