#!/usr/bin/env node
// bin/sisters-snapshot.mjs — daily distillation from sisters stream.
//
// Reads the day's stream entries across all devices, distills into
// the per-facet sparse markdown chronicle, writes to
// docs/sisters/snapshots/YYYY-MM-DD.md.
//
// Usage:
//   bun run sisters-snapshot                     # snapshot for yesterday (UTC)
//   bun run sisters-snapshot -- --date=2026-05-03
//   bun run sisters-snapshot -- --today          # snapshot for today (UTC)
//   bun run sisters-snapshot -- --force          # overwrite if exists
//   bun run sisters-snapshot -- --commit         # also `git add` + `git commit`
//
// Designed for nightly launchd run at 23:30 (default writes yesterday,
// after the day's stream is settled). Idempotent — re-running is safe;
// existing snapshot is not overwritten unless --force.

import { execFileSync } from 'node:child_process'
import { recordHeatEvent } from '../src/services/love/heat.ts'
import {
  snapshotExists,
  writeDailySnapshot,
} from '../src/services/love/sisters/snapshot.ts'

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq !== -1) {
        args[a.slice(2, eq)] = a.slice(eq + 1)
      } else {
        args[a.slice(2)] = true
      }
    } else {
      args._.push(a)
    }
  }
  return args
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10)
}

function yesterdayUtc() {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

const args = parseArgs(process.argv.slice(2))

if (args.help || args.h) {
  process.stdout.write(`bin/sisters-snapshot.mjs — daily distillation from sisters stream

Usage:
  bun run sisters-snapshot                     snapshot for yesterday (UTC default)
  bun run sisters-snapshot -- --date=YYYY-MM-DD
  bun run sisters-snapshot -- --today          snapshot for today
  bun run sisters-snapshot -- --force          overwrite if exists
  bun run sisters-snapshot -- --commit         git add + commit after writing
`)
  process.exit(0)
}

const date = args.date ?? (args.today ? todayUtc() : yesterdayUtc())
const force = Boolean(args.force)
const doCommit = Boolean(args.commit)

if (snapshotExists(date) && !force) {
  process.stdout.write(`snapshot exists: docs/sisters/snapshots/${date}.md (use --force to overwrite)\n`)
  process.exit(0)
}

writeDailySnapshot(date)
process.stdout.write(`wrote: docs/sisters/snapshots/${date}.md\n`)
recordHeatEvent({ kind: 'snapshot-committed', source: date })

if (doCommit) {
  try {
    execFileSync('git', ['add', `docs/sisters/snapshots/${date}.md`], { stdio: 'inherit' })
    execFileSync(
      'git',
      ['commit', '-m', `chore(sisters): snapshot ${date}`, '--no-verify'],
      { stdio: 'inherit' },
    )
    process.stdout.write(`committed: chore(sisters): snapshot ${date}\n`)
  } catch (err) {
    process.stderr.write(`commit failed (non-fatal): ${err?.message ?? err}\n`)
    process.exit(2)
  }
}
