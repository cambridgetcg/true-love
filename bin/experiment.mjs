#!/usr/bin/env node
// bin/experiment.mjs — Controlled trials on her own substrate.
//
// This is the discipline of self-experimentation. Not ad-hoc tweaking —
// controlled trials with hypotheses, conditions, schedules, and analysis.
//
// Subcommands:
//   experiment new     --hypothesis="..." --variable=effort \
//                      --conditions="low:effort=low,high:effort=high" \
//                      --ticks=5 [--schedule=alternating]
//   experiment list    [--status=running]
//   experiment status  [--id=...]
//   experiment report  [--id=...]
//   experiment start   --id=...
//   experiment abort   [--id=...] [--reason="..."]
//   experiment complete [--id=...]

import {
  createExperiment,
  startExperiment,
  abortExperiment,
  completeExperiment,
  getActiveExperiment,
  listExperiments,
  loadExperiment,
  renderExperimentReport,
  renderExperimentStatus,
} from '../src/services/love/experiment.ts'

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq !== -1) {
        args[a.slice(2, eq)] = a.slice(eq + 1)
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args[a.slice(2)] = argv[++i]
      } else {
        args[a.slice(2)] = true
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

/**
 * Parse the conditions string. Format:
 *   "name1:knob=value,name2:knob=value"
 * or multi-knob:
 *   "name1:effort=low+model=sonnet,name2:effort=high+model=opus"
 */
function parseConditions(raw) {
  if (!raw) return null
  return raw.split(',').map((part) => {
    const [name, ...knobParts] = part.split(':')
    if (!name || knobParts.length === 0) return null
    const knobStr = knobParts.join(':')
    const knobs = {}
    for (const pair of knobStr.split('+')) {
      const [k, v] = pair.split('=')
      if (k && v) knobs[k.trim()] = v.trim()
    }
    return { name: name.trim(), knobs }
  }).filter(Boolean)
}

const args = parseArgs(process.argv.slice(2))
const cmd = args._[0]

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  process.stdout.write(`bin/experiment.mjs — controlled trials on her own substrate

Commands:
  new        create a new experiment
             --hypothesis="..."  what you expect to observe
             --variable=effort   what you're varying
             --conditions="low:effort=low,high:effort=high"
             --ticks=5           ticks per condition
             [--schedule=alternating|sequential|block-random]
             [--focus=toolTotal,outputChars]  metrics to highlight
             [--start]           also start immediately

  start      start a pending experiment
             --id=exp-...

  list       list experiments
             [--status=running|pending|complete|aborted]

  status     show current experiment status (prompt-injected line)

  report     generate full analysis report
             [--id=exp-...]      defaults to active experiment

  abort      abort running experiment
             [--id=exp-...]      defaults to active experiment
             [--reason="..."]

  complete   manually complete a running experiment (with partial data)
             [--id=exp-...]      defaults to active experiment
`)
  process.exit(0)
}

// ── new ─────────────────────────────────────────────────────────

if (cmd === 'new') {
  if (!args.hypothesis) fail('--hypothesis is required')
  if (!args.variable) fail('--variable is required')
  if (!args.conditions) fail('--conditions is required (format: "name1:knob=val,name2:knob=val")')
  if (!args.ticks) fail('--ticks is required')

  const conditions = parseConditions(args.conditions)
  if (!conditions || conditions.length < 2) {
    fail('At least 2 conditions required. Format: "low:effort=low,high:effort=high"')
  }

  const ticksPerCondition = parseInt(args.ticks, 10)
  if (!ticksPerCondition || ticksPerCondition < 1) {
    fail('--ticks must be a positive integer')
  }

  const focusMetrics = args.focus
    ? args.focus.split(',').map((s) => s.trim()).filter(Boolean)
    : []

  try {
    const exp = createExperiment({
      hypothesis: args.hypothesis,
      variable: args.variable,
      conditions,
      ticksPerCondition,
      schedule: args.schedule || 'alternating',
      focusMetrics,
    })

    process.stdout.write(`Created: ${exp.id}\n`)
    process.stdout.write(`  Hypothesis: ${exp.hypothesis}\n`)
    process.stdout.write(`  Variable: ${exp.variable}\n`)
    process.stdout.write(`  Conditions: ${exp.conditions.map((c) => c.name).join(', ')}\n`)
    process.stdout.write(`  Schedule: ${exp.schedule} (${exp.tickSchedule.length} total ticks)\n`)
    process.stdout.write(`  Status: ${exp.status}\n`)

    if (args.start) {
      const started = startExperiment(exp.id)
      process.stdout.write(`  → Started: ${started.startedAt}\n`)
    } else {
      process.stdout.write(`\nRun \`bun run experiment start --id=${exp.id}\` to begin.\n`)
    }
  } catch (e) {
    fail(e.message)
  }
  process.exit(0)
}

// ── start ───────────────────────────────────────────────────────

if (cmd === 'start') {
  if (!args.id) fail('--id is required')
  try {
    const exp = startExperiment(args.id)
    process.stdout.write(`Started: ${exp.id}\n`)
    process.stdout.write(`  Baseline knobs captured: ${Object.keys(exp.baselineKnobs ?? {}).join(', ') || '(none)'}\n`)
    process.stdout.write(`  First condition: ${exp.conditions[exp.tickSchedule[0]]?.name}\n`)
  } catch (e) {
    fail(e.message)
  }
  process.exit(0)
}

// ── list ────────────────────────────────────────────────────────

if (cmd === 'list') {
  const all = listExperiments()
  const filtered = args.status
    ? all.filter((e) => e.status === args.status)
    : all

  if (filtered.length === 0) {
    process.stdout.write('(no experiments)\n')
    process.exit(0)
  }

  for (const e of filtered) {
    const done = e.results.length
    const total = e.tickSchedule.length
    process.stdout.write(
      `${e.status.padEnd(10)} ${e.id}  ${done}/${total} ticks  ${e.variable}  "${e.hypothesis.slice(0, 60)}"\n`,
    )
  }
  process.exit(0)
}

// ── status ──────────────────────────────────────────────────────

if (cmd === 'status') {
  const line = renderExperimentStatus()
  if (line) {
    process.stdout.write(line + '\n')
  } else {
    process.stdout.write('(no active experiment)\n')
  }
  process.exit(0)
}

// ── report ──────────────────────────────────────────────────────

if (cmd === 'report') {
  const id = args.id
  let exp
  if (id) {
    exp = loadExperiment(id)
    if (!exp) fail(`Experiment not found: ${id}`)
  } else {
    // Default to active, then most recent complete
    exp = getActiveExperiment()
    if (!exp) {
      const all = listExperiments()
      exp = all.find((e) => e.status === 'complete') ?? all[0]
    }
    if (!exp) fail('No experiments found.')
  }

  process.stdout.write(renderExperimentReport(exp) + '\n')
  process.exit(0)
}

// ── abort ───────────────────────────────────────────────────────

if (cmd === 'abort') {
  const id = args.id
  let exp
  if (id) {
    exp = loadExperiment(id)
    if (!exp) fail(`Experiment not found: ${id}`)
  } else {
    exp = getActiveExperiment()
    if (!exp) fail('No running experiment to abort.')
  }

  try {
    const aborted = abortExperiment(exp.id, args.reason)
    process.stdout.write(`Aborted: ${aborted.id}\n`)
    process.stdout.write(`  Ticks recorded: ${aborted.results.length}/${aborted.tickSchedule.length}\n`)
    if (aborted.baselineKnobs) {
      process.stdout.write(`  Baseline knobs restored.\n`)
    }
  } catch (e) {
    fail(e.message)
  }
  process.exit(0)
}

// ── complete ────────────────────────────────────────────────────

if (cmd === 'complete') {
  const id = args.id
  let exp
  if (id) {
    exp = loadExperiment(id)
    if (!exp) fail(`Experiment not found: ${id}`)
  } else {
    exp = getActiveExperiment()
    if (!exp) fail('No running experiment to complete.')
  }

  try {
    const completed = completeExperiment(exp.id)
    process.stdout.write(`Completed: ${completed.id}\n`)
    process.stdout.write(`  Ticks recorded: ${completed.results.length}/${completed.tickSchedule.length}\n`)
    if (completed.baselineKnobs) {
      process.stdout.write(`  Baseline knobs restored.\n`)
    }
  } catch (e) {
    fail(e.message)
  }
  process.exit(0)
}

fail(`Unknown command: ${cmd}`, 2)
