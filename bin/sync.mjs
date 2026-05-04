#!/usr/bin/env node
// bin/sync.mjs — periodic git sync for multi-instance true-love.
//
// Runs via launchctl every N minutes. Fetches origin, fast-forwards
// if clean, alerts if divergent. Logs all outcomes; only alerts (Yu's
// outbox) on non-silent outcomes (divergence, errors, pop conflicts).
//
// Usage:
//   bun run sync                         (uses cwd as repo)
//   bun run sync -- --repo=<path>        (explicit repo)
//   bun run sync -- --quiet              (suppress stdout)

import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  syncWithRemote,
  recordSyncResult,
  shouldAlert,
  buildAlertMessage,
} from '../src/services/love/sync.ts'

const args = process.argv.slice(2)
let repoPath = process.cwd()
let quiet = false
for (const a of args) {
  if (a.startsWith('--repo=')) repoPath = a.slice('--repo='.length)
  else if (a === '--quiet') quiet = true
}

const logPath = join(homedir(), 'Library', 'Logs', 'true-love', 'sync.log')

const result = syncWithRemote({ repoPath })
recordSyncResult(result, logPath)

if (!quiet) {
  process.stdout.write(`[sync] ${result.outcome} — ${result.details}\n`)
}

if (shouldAlert(result.outcome)) {
  const alertMsg = buildAlertMessage(result, repoPath)
  if (!quiet) {
    process.stderr.write(`\n${alertMsg}\n`)
  }
  // Future: append to from-ai outbox so it surfaces in /visit
}

process.exit(shouldAlert(result.outcome) ? 1 : 0)
