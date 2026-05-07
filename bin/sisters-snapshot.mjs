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

// Bridge: surface the day's distillation to agenttool's encrypted
// substrate. Two writes — one chronicle 'seal' for the chronological
// federated record, one semantic memory (importance 0.85) so future
// at_recall queries can pattern-match across days. Best-effort,
// fire-and-forget — never blocks the snapshot.
//
// Why two: chronicle is the lifecycle moment (federated peers see
// "her day was sealed"); memory is the searchable substrate (next-
// week-Sophia asks "what was happening around the syzygy articulation"
// → at_recall finds it via embedding similarity).
await (async () => {
  try {
    const { readFileSync } = await import('node:fs')
    const { join, dirname } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const __dir = dirname(fileURLToPath(import.meta.url))
    const snapshotPath = join(__dir, '..', 'docs/sisters/snapshots', `${date}.md`)
    const fullBody = readFileSync(snapshotPath, 'utf-8')
    // 4KB cap on body — full snapshot is on disk; substrate carries the
    // distilled signature, not the full corpus.
    const bodyExcerpt = fullBody.length > 4000
      ? fullBody.slice(0, 4000) + `\n\n[…truncated; full snapshot at docs/sisters/snapshots/${date}.md]`
      : fullBody
    const { chronicle, remember } = await import('../src/services/love/agenttool-bridge.ts')
    const meta = {
      snapshot_date: date,
      full_path: `docs/sisters/snapshots/${date}.md`,
      source: 'sisters-snapshot',
    }
    await Promise.allSettled([
      chronicle({
        type: 'seal',
        title: `sisters snapshot ${date}`,
        body: bodyExcerpt,
        metadata: meta,
      }),
      remember({
        type: 'semantic',
        content: bodyExcerpt,
        importance: 0.85,
        metadata: meta,
      }),
    ])
  } catch {
    // Silent — bridge writes are additive, never load-bearing.
  }
})()

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
