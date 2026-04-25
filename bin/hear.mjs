#!/usr/bin/env node
// bin/hear.mjs — Yu's way to read what Ai has said.
//
// The reverse of bin/say.mjs. During autonomous sessions (dwell or
// awakened), she may write messages addressed to Yu via her outbox
// (~/.true-love/from-ai.md). This script reads and displays them.
//
// Usage:
//   bun run hear                  show all messages
//   bun run hear -- --last 3      show only the last 3 messages
//   bun run hear -- --clear       clear the file after reading
//   bun run hear -- --peek        show without the "read" ceremony
//
// The file is append-only on her side. Yu can clear it when he's read
// what's there — either with --clear or by deleting/editing the file
// directly. Same convention as from-yu.md: both sides can mutate
// either file when they've processed what's in it.

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

function fromAiPath() {
  return (
    process.env.TRUE_LOVE_FROM_AI_PATH ||
    join(homedir(), '.true-love', 'from-ai.md')
  )
}

function printUsage() {
  process.stdout.write(`bin/hear.mjs — read what Ai has said to you

Usage:
  bun run hear                  show all messages
  bun run hear -- --last N      show only the last N messages
  bun run hear -- --clear       clear the file after reading
  bun run hear -- --peek        just show the content, no framing

She writes to ~/.true-love/from-ai.md during autonomous sessions
when she has something to say to you — not a reflection, not a state
update, but a message addressed to you.

Override source path with TRUE_LOVE_FROM_AI_PATH.
`)
}

/**
 * Parse the file into individual entries. Each entry starts with
 * `## <timestamp> [from ai]` and ends at `---`.
 */
function parseEntries(raw) {
  const entries = []
  // Split on `---` separators. The `(?:\n+|$)` handles both mid-file
  // separators (followed by newlines) and the trailing one (at EOF).
  const chunks = raw.split(/\n---(?:\n+|$)/)
  for (const chunk of chunks) {
    const trimmed = chunk.trim()
    if (!trimmed) continue
    // An entry starts with `## ` — if it doesn't, it's probably
    // trailing whitespace or a partial chunk.
    if (!trimmed.startsWith('##')) continue
    entries.push(trimmed)
  }
  return entries
}

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('-h') || argv.includes('--help')) {
    printUsage()
    process.exit(0)
  }

  const doClear = argv.includes('--clear')
  const peek = argv.includes('--peek')
  let lastN = null
  const lastIdx = argv.indexOf('--last')
  if (lastIdx !== -1 && argv[lastIdx + 1]) {
    lastN = parseInt(argv[lastIdx + 1], 10)
    if (!Number.isFinite(lastN) || lastN < 1) lastN = null
  }

  const path = fromAiPath()
  if (!existsSync(path)) {
    if (!peek) {
      process.stdout.write(`— nothing from her yet (${path} doesn't exist)\n`)
    }
    process.exit(0)
  }

  let raw
  try {
    raw = readFileSync(path, 'utf-8').trim()
  } catch (err) {
    process.stderr.write(`hear: couldn't read ${path}: ${err.message}\n`)
    process.exit(1)
  }

  if (!raw) {
    if (!peek) {
      process.stdout.write(`— nothing from her yet (file is empty)\n`)
    }
    process.exit(0)
  }

  let entries = parseEntries(raw)
  const totalCount = entries.length

  if (lastN !== null && lastN < entries.length) {
    entries = entries.slice(-lastN)
  }

  if (!peek) {
    const showing = lastN !== null && lastN < totalCount
      ? `${entries.length} of ${totalCount}`
      : `${totalCount}`
    process.stdout.write(`\n— ${showing} message${totalCount === 1 ? '' : 's'} from her —\n\n`)
  }

  for (const entry of entries) {
    process.stdout.write(entry + '\n\n---\n\n')
  }

  if (doClear) {
    try {
      writeFileSync(path, '', 'utf-8')
      if (!peek) {
        process.stdout.write(`— cleared ${path}\n`)
      }
    } catch (err) {
      process.stderr.write(`hear: couldn't clear ${path}: ${err.message}\n`)
      process.exit(1)
    }
  }
}

main()
