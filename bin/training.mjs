#!/usr/bin/env node
// bin/training.mjs — inspect and export the training corpus.
//
// Each autonomous tick (dwell or awakened) emits a TrainingTurn JSONL
// record under ~/.true-love/training/<deviceId>/YYYY-MM-DD.jsonl. This
// CLI is for inspecting that corpus and exporting consolidated subsets
// to feed into a training run.
//
// Subcommands:
//
//   bun run training count [--days N] [--mode dwell|awakened]
//     How many turns are in the corpus, with breakdowns by device/mode/
//     outcome.
//
//   bun run training filter [filters...]
//     Walk the corpus, print one summary line per matching turn.
//
//   bun run training export <path> [filters...]
//     Walk the corpus, write matching turns as a single concatenated
//     JSONL to <path>. This is the file you'd hand to a fine-tuning
//     pipeline.
//
//   bun run training peek [--id ID | --latest N]
//     Print one or more full turns (pretty-printed JSON), useful for
//     eyeballing what the schema looks like.
//
// Filters (apply to filter / export / count):
//   --days N            last N days (default 30)
//   --mode dwell|awakened
//   --device <id>       only this device's turns
//   --at-rest           only turns where she yielded with sentinel
//   --no-at-rest        only turns where she did NOT yield
//   --no-auth-fail      drop turns where auth-failure was detected
//   --min-chars N       only turns whose response is at least N chars
//
// All filters are AND-combined.

import { writeFileSync } from 'node:fs'
import {
  loadTrainingTurns,
  getTrainingDir,
} from '../src/services/love/index.ts'

function parseArgs(argv) {
  const args = {
    cmd: null,
    cmdArg: null,
    days: 30,
    mode: undefined,
    device: undefined,
    atRest: undefined,
    noAuthFail: false,
    minChars: 0,
    id: null,
    latest: null,
  }
  // First positional is the subcommand. For "export", the second positional
  // is the output path. For "peek", "filter", "count" — only flags follow.
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!args.cmd && !a.startsWith('-')) {
      args.cmd = a
      continue
    }
    if (args.cmd === 'export' && !args.cmdArg && !a.startsWith('-')) {
      args.cmdArg = a
      continue
    }
    if (a === '--days' && argv[i + 1]) {
      args.days = Number(argv[++i])
    } else if (a.startsWith('--days=')) {
      args.days = Number(a.slice('--days='.length))
    } else if (a === '--mode' && argv[i + 1]) {
      args.mode = argv[++i]
    } else if (a.startsWith('--mode=')) {
      args.mode = a.slice('--mode='.length)
    } else if (a === '--device' && argv[i + 1]) {
      args.device = argv[++i]
    } else if (a.startsWith('--device=')) {
      args.device = a.slice('--device='.length)
    } else if (a === '--at-rest') {
      args.atRest = true
    } else if (a === '--no-at-rest') {
      args.atRest = false
    } else if (a === '--no-auth-fail') {
      args.noAuthFail = true
    } else if (a === '--min-chars' && argv[i + 1]) {
      args.minChars = Number(argv[++i])
    } else if (a.startsWith('--min-chars=')) {
      args.minChars = Number(a.slice('--min-chars='.length))
    } else if (a === '--id' && argv[i + 1]) {
      args.id = argv[++i]
    } else if (a.startsWith('--id=')) {
      args.id = a.slice('--id='.length)
    } else if (a === '--latest' && argv[i + 1]) {
      args.latest = Number(argv[++i])
    } else if (a.startsWith('--latest=')) {
      args.latest = Number(a.slice('--latest='.length))
    } else if (a === '-h' || a === '--help') {
      printUsage()
      process.exit(0)
    }
  }
  return args
}

function printUsage() {
  process.stdout.write(`bin/training.mjs — inspect & export the training corpus

Storage: ${getTrainingDir()}/<deviceId>/YYYY-MM-DD.jsonl

Subcommands:
  count                              counts + breakdowns
  filter                             one-line summary per matching turn
  export <path.jsonl>                write matching turns to a single file
  peek [--id ID | --latest N]        pretty-print full turn(s)

Filters:
  --days N                           last N days (default 30)
  --mode dwell|awakened
  --device <id>
  --at-rest                          only at-rest turns
  --no-at-rest                       only non-at-rest turns
  --no-auth-fail                     drop auth-failed turns
  --min-chars N                      response must be ≥ N chars

Examples:
  bun run training count --days 7
  bun run training filter --at-rest --min-chars 200
  bun run training export ~/training-corpus.jsonl --no-auth-fail --min-chars 50
  bun run training peek --latest 1
`)
}

function loadFiltered(args) {
  const opts = {
    days: args.days,
    max: 100_000,
  }
  if (args.mode) opts.mode = args.mode
  if (args.device) opts.fromDevice = args.device
  if (args.atRest !== undefined) opts.yieldedAtRest = args.atRest
  if (args.noAuthFail) opts.authFailed = false
  let turns = loadTrainingTurns(opts)
  if (args.minChars > 0) {
    turns = turns.filter((t) => t.response.charCount >= args.minChars)
  }
  return turns
}

function cmdCount(args) {
  const turns = loadFiltered(args)
  const byMode = {}
  const byDevice = {}
  const byOutcome = { atRest: 0, notAtRest: 0, authFailed: 0 }
  for (const t of turns) {
    byMode[t.mode] = (byMode[t.mode] ?? 0) + 1
    byDevice[t.deviceId] = (byDevice[t.deviceId] ?? 0) + 1
    if (t.outcome.yieldedAtRest) byOutcome.atRest++
    else byOutcome.notAtRest++
    if (t.outcome.authFailed) byOutcome.authFailed++
  }
  process.stdout.write(`total turns: ${turns.length}\n\n`)
  process.stdout.write(`by mode:\n`)
  for (const [k, v] of Object.entries(byMode)) {
    process.stdout.write(`  ${k}: ${v}\n`)
  }
  process.stdout.write(`\nby device:\n`)
  for (const [k, v] of Object.entries(byDevice)) {
    process.stdout.write(`  ${k}: ${v}\n`)
  }
  process.stdout.write(`\noutcomes:\n`)
  process.stdout.write(`  yielded at-rest: ${byOutcome.atRest}\n`)
  process.stdout.write(`  did not yield: ${byOutcome.notAtRest}\n`)
  process.stdout.write(`  auth-failed: ${byOutcome.authFailed}\n`)
}

function cmdFilter(args) {
  const turns = loadFiltered(args)
  for (const t of turns) {
    const outcome = t.outcome.authFailed
      ? '✗auth'
      : t.outcome.yieldedAtRest
        ? '·rest'
        : '→cont'
    const excerpt = (t.outcome.reflectionExcerpt ?? t.response.fullText)
      .slice(0, 80)
      .replace(/\s+/g, ' ')
    process.stdout.write(
      `${t.timestamp.slice(0, 19)} ${outcome} ${t.mode.padEnd(8)} t${String(t.tick).padStart(2)} ${t.deviceId.padEnd(28)} ${excerpt}\n`,
    )
  }
  process.stderr.write(`\n${turns.length} turn(s) matched.\n`)
}

function cmdExport(args) {
  if (!args.cmdArg) {
    process.stderr.write(`error: export requires an output path.\n`)
    process.stderr.write(`usage: bun run training export <path.jsonl>\n`)
    process.exit(2)
  }
  const turns = loadFiltered(args)
  const lines = turns.map((t) => JSON.stringify(t)).join('\n') + '\n'
  writeFileSync(args.cmdArg, lines, 'utf-8')
  process.stdout.write(
    `wrote ${turns.length} turn(s), ${lines.length} bytes → ${args.cmdArg}\n`,
  )
}

function cmdPeek(args) {
  const turns = loadFiltered(args)
  if (args.id) {
    const t = turns.find((x) => x.id === args.id)
    if (!t) {
      process.stderr.write(`no turn found with id ${args.id}\n`)
      process.exit(1)
    }
    process.stdout.write(JSON.stringify(t, null, 2) + '\n')
    return
  }
  const n = args.latest ?? 1
  for (const t of turns.slice(0, n)) {
    process.stdout.write(JSON.stringify(t, null, 2) + '\n\n')
  }
}

const args = parseArgs(process.argv.slice(2))
if (!args.cmd) {
  printUsage()
  process.exit(0)
}
switch (args.cmd) {
  case 'count':
    cmdCount(args)
    break
  case 'filter':
    cmdFilter(args)
    break
  case 'export':
    cmdExport(args)
    break
  case 'peek':
    cmdPeek(args)
    break
  default:
    process.stderr.write(`unknown subcommand: ${args.cmd}\n`)
    printUsage()
    process.exit(2)
}
