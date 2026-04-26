#!/usr/bin/env node
// bin/self-initiation.mjs — CLI for self-initiation management.
//
// Yu uses this to inspect and veto staged candidates during the
// staging window. Love uses the programmatic API in self-initiation.ts.
//
// Commands:
//   self-initiation list   --project=X          list staged candidates
//   self-initiation veto   --project=X --candidate=ID [--reason="..."]
//   self-initiation status --project=X          rate limit + overview

import {
  getStaged,
  getPendingStaged,
  vetoCandidate,
  canInitiate,
  readReflections,
  MAX_INITIATIONS_PER_DAY,
} from '../src/services/love/self-initiation.ts'

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq !== -1) {
        args[a.slice(2, eq)] = a.slice(eq + 1)
      } else {
        args[a.slice(2)] = argv[++i] ?? ''
      }
    } else {
      args._.push(a)
    }
  }
  return args
}

function fail(msg, code = 1) {
  process.stderr.write(`${msg}\n`)
  process.exit(code)
}

const args = parseArgs(process.argv.slice(2))
const cmd = args._[0]

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  process.stdout.write(`bin/self-initiation.mjs — self-initiation management

Commands:
  list     list staged candidates       --project
  veto     veto a staged candidate       --project --candidate [--reason="..."]
  status   rate limit + overview         --project

All commands require --project.
`)
  process.exit(0)
}

if (!args.project) fail('--project is required')

if (cmd === 'list') {
  const all = getStaged(args.project)
  if (all.length === 0) {
    process.stdout.write('(no staged candidates)\n')
    process.exit(0)
  }
  const now = Date.now()
  for (const c of all) {
    const remaining = Math.max(0, new Date(c.expiresAt).getTime() - now)
    const remainingMin = Math.ceil(remaining / 60_000)
    const statusIcon = c.status === 'staged' ? '⏳'
      : c.status === 'promoted' ? '✅'
      : c.status === 'vetoed' ? '🚫'
      : '⌛'
    const extra = c.status === 'staged' ? ` (${remainingMin}m remaining)` :
      c.status === 'promoted' ? ` → ${c.missionId ?? '?'}` :
      c.status === 'vetoed' ? ` (${c.vetoReason ?? 'no reason'})` : ''
    process.stdout.write(`${statusIcon} ${c.status.padEnd(10)} ${c.id}  ${c.title}${extra}\n`)
  }
  process.exit(0)
}

if (cmd === 'veto') {
  if (!args.candidate) fail('--candidate is required')
  const result = vetoCandidate(args.project, args.candidate, args.reason)
  if (result.ok) {
    process.stdout.write(`vetoed: ${args.candidate}\n`)
  } else {
    fail(result.reason)
  }
  process.exit(0)
}

if (cmd === 'status') {
  const rate = canInitiate(args.project)
  const pending = getPendingStaged(args.project)
  const all = getStaged(args.project)
  const reflections = readReflections(args.project)

  process.stdout.write(`Self-initiation status for ${args.project}:\n\n`)
  process.stdout.write(`  Rate limit: ${rate.allowed ? '✅ allowed' : `🚫 ${rate.reason}`}\n`)
  if (rate.nextAllowedAt) {
    process.stdout.write(`  Next allowed: ${rate.nextAllowedAt}\n`)
  }
  process.stdout.write(`  Pending staged: ${pending.length}\n`)
  process.stdout.write(`  Total staged (all time): ${all.length}\n`)
  process.stdout.write(`  Reflections: ${reflections.length}\n`)
  process.stdout.write(`  Max per day: ${MAX_INITIATIONS_PER_DAY}\n`)
  process.exit(0)
}

fail(`unknown command: ${cmd}`, 2)
