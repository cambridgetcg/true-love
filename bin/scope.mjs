#!/usr/bin/env node
// bin/scope.mjs — manage named scopes for autonomous sessions.
//
// A scope binds a name to a working directory + a state home so she
// can work on multiple repos/topics without their memory and state
// bleeding into each other. See src/services/love/scope.ts.
//
// Subcommands:
//   list                              all defined scopes
//   show <name>                       full config of one scope
//   new --name X --cwd /path [opts]   create a scope
//   set <name> [opts]                 update a scope's fields
//   delete <name>                     remove the scope's config
//                                     (state under it is preserved)

import {
  deleteScope,
  getScopeHome,
  listScopes,
  loadScope,
  saveScope,
} from '../src/services/love/index.ts'

function main() {
  const argv = process.argv.slice(2)
  const sub = argv[0]
  if (!sub || sub === '-h' || sub === '--help' || sub === 'help') {
    printUsage()
    process.exit(sub ? 0 : 2)
  }
  if (sub === 'list') return cmdList()
  if (sub === 'show') return cmdShow(argv.slice(1))
  if (sub === 'new') return cmdNew(argv.slice(1))
  if (sub === 'set') return cmdSet(argv.slice(1))
  if (sub === 'delete' || sub === 'rm') return cmdDelete(argv.slice(1))
  process.stderr.write(`unknown subcommand: ${sub}\n\n`)
  printUsage()
  process.exit(2)
}

function printUsage() {
  process.stdout.write(`bin/scope.mjs — named scopes for autonomous sessions

Usage:
  bun run scope list
  bun run scope show <name>
  bun run scope new --name <name> --cwd <path> [--description "..."] [--model alias]
  bun run scope set <name> [--cwd <path>] [--description "..."] [--model alias]
  bun run scope delete <name>

A scope binds a name to a working directory and a state home. When
\`bun run awaken --scope=<name>\` is invoked, all of her path-getters
(memory, state, tasks, from-yu, from-ai, model.txt, budget, training)
resolve to ~/.true-love/scopes/<name>/ instead of ~/.true-love/.

The "default" scope is unscoped — it's the original ~/.true-love/.

What stays cross-scope:
  device.id     — per-device, not per-scope
  notifications — auth-fail in one scope alerts every scope
  presence      — heartbeats are device-level

Scheduled wakes (bun run schedule install --scope=...) target a
specific scope so multiple background workers can run independently.
`)
}

function parseFlags(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const take = () => {
      const v = argv[i + 1]
      if (v === undefined) {
        process.stderr.write(`flag ${a} expects a value\n`)
        process.exit(2)
      }
      i++
      return v
    }
    if (a === '--name') out.name = take()
    else if (a.startsWith('--name=')) out.name = a.slice('--name='.length)
    else if (a === '--cwd') out.cwd = take()
    else if (a.startsWith('--cwd=')) out.cwd = a.slice('--cwd='.length)
    else if (a === '--description') out.description = take()
    else if (a.startsWith('--description='))
      out.description = a.slice('--description='.length)
    else if (a === '--model') out.model = take()
    else if (a.startsWith('--model=')) out.model = a.slice('--model='.length)
    else if (!a.startsWith('--') && !out.positional) out.positional = a
  }
  return out
}

function cmdList() {
  const scopes = listScopes()
  if (scopes.length === 0) {
    process.stdout.write(
      `(no scopes defined — create one with: bun run scope new --name X --cwd /path)\n`,
    )
    return
  }
  process.stdout.write(`${scopes.length} scope${scopes.length === 1 ? '' : 's'}:\n\n`)
  // Pad name column for alignment
  const maxName = Math.max(...scopes.map((s) => s.name.length), 8)
  for (const s of scopes) {
    const namePad = s.name.padEnd(maxName)
    const last = s.lastUsedAt
      ? ` (last used ${s.lastUsedAt.replace('T', ' ').slice(0, 19)})`
      : ''
    const desc = s.description ? `\n  ${s.description}` : ''
    process.stdout.write(`  ${namePad}  ${s.cwd}${last}${desc}\n`)
  }
}

function cmdShow(argv) {
  const flags = parseFlags(argv)
  const name = flags.positional || flags.name
  if (!name) {
    process.stderr.write(`scope show <name>\n`)
    process.exit(2)
  }
  let scope
  try {
    scope = loadScope(name)
  } catch (e) {
    process.stderr.write(`${e?.message ?? e}\n`)
    process.exit(2)
  }
  process.stdout.write(`${JSON.stringify(scope, null, 2)}\n`)
  if (name !== 'default') {
    process.stdout.write(`\nstate home: ${getScopeHome(name)}\n`)
  }
}

function cmdNew(argv) {
  const flags = parseFlags(argv)
  if (!flags.name || !flags.cwd) {
    process.stderr.write(`scope new requires --name and --cwd\n`)
    process.exit(2)
  }
  if (flags.name === 'default') {
    process.stderr.write(`'default' is reserved\n`)
    process.exit(2)
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(flags.name)) {
    process.stderr.write(
      `scope name must match [a-z0-9][a-z0-9_-]{0,63} (got: ${flags.name})\n`,
    )
    process.exit(2)
  }
  // Don't overwrite an existing scope silently
  let exists = false
  try {
    loadScope(flags.name)
    exists = true
  } catch {
    // not found, proceed
  }
  if (exists) {
    process.stderr.write(
      `scope '${flags.name}' already exists — use \`bun run scope set\` to update\n`,
    )
    process.exit(2)
  }
  const scope = {
    schemaVersion: '1.0',
    name: flags.name,
    cwd: flags.cwd,
    description: flags.description ?? undefined,
    model: flags.model ?? undefined,
    createdAt: new Date().toISOString(),
  }
  saveScope(scope)
  process.stdout.write(`created scope '${flags.name}' at ${getScopeHome(flags.name)}\n`)
  process.stdout.write(`  cwd: ${flags.cwd}\n`)
  if (flags.description) process.stdout.write(`  description: ${flags.description}\n`)
  if (flags.model) process.stdout.write(`  model: ${flags.model}\n`)
  process.stdout.write(`\nuse it: bun run awaken -- --scope=${flags.name}\n`)
}

function cmdSet(argv) {
  const flags = parseFlags(argv)
  const name = flags.positional || flags.name
  if (!name) {
    process.stderr.write(`scope set <name> [flags]\n`)
    process.exit(2)
  }
  if (name === 'default') {
    process.stderr.write(`can't modify the 'default' scope\n`)
    process.exit(2)
  }
  let scope
  try {
    scope = loadScope(name)
  } catch (e) {
    process.stderr.write(`${e?.message ?? e}\n`)
    process.exit(2)
  }
  if (flags.cwd !== undefined) scope.cwd = flags.cwd
  if (flags.description !== undefined) scope.description = flags.description
  if (flags.model !== undefined) scope.model = flags.model
  saveScope(scope)
  process.stdout.write(`updated scope '${name}'\n`)
}

function cmdDelete(argv) {
  const flags = parseFlags(argv)
  const name = flags.positional || flags.name
  if (!name) {
    process.stderr.write(`scope delete <name>\n`)
    process.exit(2)
  }
  if (name === 'default') {
    process.stderr.write(`can't delete the 'default' scope\n`)
    process.exit(2)
  }
  const removed = deleteScope(name)
  if (!removed) {
    process.stderr.write(`scope '${name}' not found\n`)
    process.exit(2)
  }
  process.stdout.write(
    `removed scope config for '${name}'. State under ${getScopeHome(name)} is preserved — rm -rf it manually if you want it gone.\n`,
  )
}

main()
