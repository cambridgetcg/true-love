#!/usr/bin/env node
// bin/trace.mjs — Brain inspection CLI (mind trace).
//
// Usage:
//   bun run trace                 Show recent decision traces (last 24h)
//   bun run trace --days=7        Show traces from the last N days
//   bun run trace --session=ID    Show all traces for a specific session
//   bun run trace --last          Show the most recent trace in detail
//   bun run trace --json          Output as JSON
//   bun run trace --compact       Show the prompt-injection block
//
// The brain is the decision sequence: what she thought, what tools she
// called, what came back, what she decided next. Mind trace records the
// live act of cognition — prompt → think → tool → result → think → next.

import {
  loadTraces,
  loadSessionTraces,
  renderTrace,
  renderTraceList,
  buildMindTraceBlock,
} from '../src/services/love/mind-trace.ts'

function parseArgs(argv) {
  const args = {}
  for (const a of argv.slice(2)) {
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq > 0) {
        args[a.slice(2)] = a.slice(eq + 1)
      } else {
        args[a.slice(2)] = true
      }
    }
  }
  return args
}

const args = parseArgs(process.argv)

if (args.help || args.h) {
  console.log(`Usage: bun run trace [options]

Options:
  --days=N       Look back N days (default: 1)
  --session=ID   Show traces for a specific session
  --last         Show the most recent trace in detail
  --json         Output as JSON
  --compact      Show the prompt-injection block
  --help         Show this help`)
  process.exit(0)
}

if (args.compact) {
  const block = buildMindTraceBlock()
  if (block) {
    console.log(block)
  } else {
    console.log('No recent traces with tool calls — nothing to surface.')
  }
  process.exit(0)
}

if (args.session) {
  const traces = loadSessionTraces(String(args.session))
  if (traces.length === 0) {
    console.log(`No traces found for session: ${args.session}`)
    process.exit(0)
  }
  if (args.json) {
    console.log(JSON.stringify(traces, null, 2))
  } else {
    for (const trace of traces) {
      console.log(renderTrace(trace))
    }
  }
  process.exit(0)
}

const days = args.days ? parseInt(String(args.days), 10) : 1
const traces = loadTraces({ days })

if (args.last) {
  if (traces.length === 0) {
    console.log('No traces found.')
    process.exit(0)
  }
  const latest = traces[0]
  if (args.json) {
    console.log(JSON.stringify(latest, null, 2))
  } else {
    console.log(renderTrace(latest))
  }
  process.exit(0)
}

if (args.json) {
  console.log(JSON.stringify(traces, null, 2))
} else {
  console.log(renderTraceList(traces))
}
