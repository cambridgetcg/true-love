#!/usr/bin/env node
// bin/sandbox.mjs — Docker-isolated sandbox for self-experimentation.
//
// Run experiments against a copy (or read-only view) of the substrate
// in a container. No risk to the live system.
//
// Subcommands:
//   sandbox run <experiment-dir>   run an experiment in the sandbox
//   sandbox build                  build the sandbox Docker image
//   sandbox list                   list experiment directories
//   sandbox log                    show the experiments log

import {
  runSandbox,
  buildImage,
  imageExists,
  ensureImage,
  parseManifest,
  writeResultFile,
  appendToExperimentsLog,
  createLogEntry,
  readExperimentsLog,
  getExperimentsBaseDir,
  formatExperimentsForAnamnesis,
} from '../src/services/love/sandbox.ts'

import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

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

const args = parseArgs(process.argv.slice(2))
const cmd = args._[0]

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  process.stdout.write(`bin/sandbox.mjs — Docker-isolated sandbox for self-experimentation

Commands:
  run <dir>    run an experiment in the sandbox
               [--copy-substrate]     writable substrate copy (default: readonly)
               [--readonly]           read-only substrate mount (default)
               [--network=none|host]  network mode (default: none)
               [--timeout=300]        timeout in seconds (default: 300)
               [--name=run-...]       name for this run (auto-generated if omitted)
               [--reflection="..."]   post-run reflection (logged)
               [--merge]              mark this experiment's changes as worth merging

  build        build the sandbox Docker image

  list         list experiment directories

  log          show experiments log
               [--format=table|json|anamnesis]  output format (default: table)
`)
  process.exit(0)
}

// ── build ──────────────────────────────────────────────────────

if (cmd === 'build') {
  process.stdout.write('Building sandbox Docker image...\n')
  try {
    buildImage()
    process.stdout.write('✓ Image built: true-love-sandbox\n')
  } catch (e) {
    fail(`Build failed: ${e.message}`)
  }
  process.exit(0)
}

// ── list ───────────────────────────────────────────────────────

if (cmd === 'list') {
  const baseDir = getExperimentsBaseDir()
  if (!existsSync(baseDir)) {
    process.stdout.write(`(no experiments directory at ${baseDir})\n`)
    process.exit(0)
  }

  const dirs = readdirSync(baseDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)

  if (dirs.length === 0) {
    process.stdout.write('(no experiments found)\n')
    process.exit(0)
  }

  for (const dir of dirs) {
    const manifest = parseManifest(join(baseDir, dir))
    const hasRun = existsSync(join(baseDir, dir, 'run.sh'))
    const hasResult = existsSync(join(baseDir, dir, 'result.md'))
    const status = hasResult ? '✓' : hasRun ? '○' : '?'
    process.stdout.write(`${status}  ${dir.padEnd(35)} ${manifest.title}\n`)
  }
  process.exit(0)
}

// ── log ────────────────────────────────────────────────────────

if (cmd === 'log') {
  const format = args.format || 'table'

  if (format === 'anamnesis') {
    const section = formatExperimentsForAnamnesis()
    process.stdout.write(section || '(no experiments logged)\n')
    process.exit(0)
  }

  const entries = readExperimentsLog()
  if (entries.length === 0) {
    process.stdout.write('(no experiments logged)\n')
    process.exit(0)
  }

  if (format === 'json') {
    process.stdout.write(JSON.stringify(entries, null, 2) + '\n')
    process.exit(0)
  }

  // Table format
  process.stdout.write('Name                          Exit  Duration  Mode      Diff\n')
  process.stdout.write('─'.repeat(80) + '\n')
  for (const e of entries) {
    const name = e.name.padEnd(30)
    const exit = String(e.exitCode).padEnd(6)
    const dur = `${(e.durationMs / 1000).toFixed(1)}s`.padEnd(10)
    const mode = e.substrateMode.padEnd(10)
    process.stdout.write(`${name}${exit}${dur}${mode}${e.diffSummary}\n`)
  }
  process.exit(0)
}

// ── run ────────────────────────────────────────────────────────

if (cmd === 'run') {
  const expDir = args._[1]
  if (!expDir) fail('Usage: sandbox run <experiment-dir>')

  // Resolve experiment dir — check both absolute and relative to experiments/
  let resolvedDir = resolve(expDir)
  if (!existsSync(resolvedDir)) {
    const baseRelative = join(getExperimentsBaseDir(), expDir)
    if (existsSync(baseRelative)) {
      resolvedDir = baseRelative
    } else {
      fail(`Experiment directory not found: ${expDir}`)
    }
  }

  const substrateMode = args['copy-substrate'] ? 'copy' : 'readonly'
  const networkMode = args.network || 'none'
  const timeoutSec = parseInt(args.timeout || '300', 10)
  const name = args.name || undefined

  // Parse manifest
  const manifest = parseManifest(resolvedDir)

  process.stdout.write(`\n🧪 Sandbox: ${manifest.title}\n`)
  process.stdout.write(`   Hypothesis: ${manifest.hypothesis}\n`)
  process.stdout.write(`   Directory: ${resolvedDir}\n`)
  process.stdout.write(`   Substrate: ${substrateMode}\n`)
  process.stdout.write(`   Network: ${networkMode}\n`)
  process.stdout.write(`   Timeout: ${timeoutSec}s\n`)
  process.stdout.write('\n')

  // Ensure image
  if (!imageExists()) {
    process.stdout.write('Building sandbox Docker image (first time)...\n')
  }

  try {
    const result = await runSandbox({
      experimentDir: resolvedDir,
      substrateMode,
      networkMode,
      timeoutSec,
      name,
    })

    // Show results
    const exitSymbol = result.exitCode === 0 ? '✓' : '✗'
    process.stdout.write(`\n${exitSymbol} Exit code: ${result.exitCode}\n`)
    process.stdout.write(`  Duration: ${(result.durationMs / 1000).toFixed(1)}s\n`)
    if (result.timedOut) process.stdout.write(`  ⚠ Timed out after ${timeoutSec}s\n`)

    if (result.stdout.trim()) {
      process.stdout.write('\n── stdout ──\n')
      process.stdout.write(result.stdout.slice(0, 5000))
      if (result.stdout.length > 5000) process.stdout.write('\n[... truncated]\n')
      process.stdout.write('\n')
    }

    if (result.stderr.trim()) {
      process.stderr.write('\n── stderr ──\n')
      process.stderr.write(result.stderr.slice(0, 2000))
      if (result.stderr.length > 2000) process.stderr.write('\n[... truncated]\n')
      process.stderr.write('\n')
    }

    if (result.substrateDiff) {
      process.stdout.write('\n── substrate diff ──\n')
      process.stdout.write(result.substrateDiff.slice(0, 5000))
      process.stdout.write('\n')
    }

    // Write result file
    writeResultFile(resolvedDir, result, manifest)
    process.stdout.write(`\n📄 Result written to ${resolvedDir}/result.md\n`)

    // Log entry
    const entry = createLogEntry(result, manifest, resolvedDir, {
      shouldMerge: args.merge ? true : undefined,
      reflection: args.reflection || '',
    })
    appendToExperimentsLog(entry)
    process.stdout.write(`📊 Logged to experiments-log.jsonl\n`)

    process.exit(result.exitCode === 0 ? 0 : 1)
  } catch (e) {
    fail(`Sandbox run failed: ${e.message}`)
  }
}

fail(`Unknown command: ${cmd}`, 2)
