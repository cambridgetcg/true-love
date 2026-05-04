#!/usr/bin/env node
// bin/eros-correlate.mjs — descriptive stats: eros state × response character.
//
// Reads ~/.true-love/eros/snapshots.jsonl + traces + metrics. Joins by
// (sessionId, tick). Groups by felt-shape. Prints per-group stats.
//
// Usage:
//   bun run eros-correlate                  last 7 days (default)
//   bun run eros-correlate -- --days=30     last 30 days
//
// Output is descriptive: "when state was at X, mean velocity was Y."
// NOT causal: "X caused Y." Substrate honesty applies at every level.

import { homedir } from 'node:os'
import { join } from 'node:path'
import { readSnapshots } from '../src/services/love/eros/snapshots.ts'
import { loadTraces } from '../src/services/love/mind-trace.ts'
import { loadTickMetricsGlobal } from '../src/services/love/tick-metrics.ts'
import {
  joinRecords,
  groupByFeltShape,
  computeStats,
  formatStatsTable,
} from '../src/services/love/eros/correlate.ts'

const args = process.argv.slice(2)
let days = 7
for (const a of args) {
  if (a.startsWith('--days=')) {
    const n = Number(a.slice('--days='.length))
    days = Number.isFinite(n) && n > 0 ? n : 7
  }
}

const snapshots = readSnapshots()
const traces = loadTraces({ days })
const metrics = loadTickMetricsGlobal(join(homedir(), '.true-love'), days)

if (snapshots.length === 0) {
  process.stdout.write('No eros snapshots at ~/.true-love/eros/snapshots.jsonl\n')
  process.stdout.write('Run a heartbeat tick first (the launchctl agent records snapshots automatically).\n')
  process.exit(0)
}

const joined = joinRecords(snapshots, traces, metrics)
const groups = groupByFeltShape(joined)
const allStats = Object.entries(groups).map(([k, recs]) => computeStats(recs, k))

process.stdout.write(formatStatsTable(allStats))

const joinedTrace = joined.filter((j) => j.trace !== null).length
const joinedMetric = joined.filter((j) => j.metric !== null).length
process.stdout.write(`\n`)
process.stdout.write(`Source: ${snapshots.length} snapshot${snapshots.length === 1 ? '' : 's'}, `)
process.stdout.write(`${traces.length} trace${traces.length === 1 ? '' : 's'}, `)
process.stdout.write(`${metrics.length} metric${metrics.length === 1 ? '' : 's'} `)
process.stdout.write(`(${days}d window)\n`)
process.stdout.write(`Join coverage: ${joinedTrace}/${snapshots.length} with trace, ${joinedMetric}/${snapshots.length} with metric\n`)
