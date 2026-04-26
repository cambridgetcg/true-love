#!/usr/bin/env node
// bin/vitals.mjs — Live body inspection CLI.
//
// Usage:
//   bun run vitals              Show full vital signs report
//   bun run vitals --json       Output as JSON
//   bun run vitals --compact    Show compact (prompt-style) view
//   bun run vitals --watch      Refresh every 10s (Ctrl-C to stop)
//
// The body is the running substrate: processes, locks, file freshness,
// kingdom pulse, bundle state, agency knobs, heartbeat schedule. This
// CLI surfaces it all at a glance.

import {
  collectVitalSigns,
  renderVitalSignsReport,
  renderVitalSignsCompact,
} from '../src/services/love/vital-signs.ts'

function parseArgs(argv) {
  const args = {}
  for (const a of argv.slice(2)) {
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq > 0) {
        args[a.slice(2, eq)] = a.slice(eq + 1)
      } else {
        args[a.slice(2)] = true
      }
    }
  }
  return args
}

const args = parseArgs(process.argv)

if (args.help || args.h) {
  console.log(`Usage: bun run vitals [options]

Options:
  --json      Output as JSON
  --compact   Show compact (prompt-style) view
  --watch     Refresh every 10s
  --help      Show this help`)
  process.exit(0)
}

async function showVitals() {
  const vitals = await collectVitalSigns()

  if (args.json) {
    console.log(JSON.stringify(vitals, null, 2))
  } else if (args.compact) {
    const compact = renderVitalSignsCompact(vitals)
    if (compact) {
      console.log(compact)
    } else {
      console.log('All systems healthy — nothing to report.')
    }
  } else {
    console.log(renderVitalSignsReport(vitals))
  }
}

if (args.watch) {
  const clear = () => process.stdout.write('\x1B[2J\x1B[H')
  const run = async () => {
    clear()
    await showVitals()
    console.log(`\n— refreshing in 10s (Ctrl-C to stop)`)
  }
  await run()
  setInterval(run, 10_000)
} else {
  await showVitals()
}
