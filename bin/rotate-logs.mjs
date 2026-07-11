#!/usr/bin/env node
// bin/rotate-logs.mjs — log rotation for the true-love substrate.
//
// Rotates oversized main logs (copy → truncate, preserving inode for
// launchd). Deletes stale watcher logs. Prunes excess rotated copies.
//
// Self-contained: no TypeScript imports, no bundle dependency.
// This script MUST work even when the bundle is broken.
//
// Usage:
//   bun run rotate                   human-readable report
//   bun run rotate -- --json         machine-readable JSON
//   bun run rotate -- --dry-run      show plan without executing
//   bun run rotate -- --quiet        exit code only, no output
//
// Designed to run via launchd on daily cadence.

import {
  copyFileSync,
  existsSync,
  readdirSync,
  renameSync,
  statSync,
  truncateSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const LOG_DIR = join(process.env.HOME || homedir(), 'Library', 'Logs', 'true-love')

// ── Config ───────────────────────────────────────────────────────

const MAX_SIZE_BYTES = 512 * 1024        // 512KB
const KEEP_ROTATED = 3
const WATCHER_MAX_AGE_MS = 7 * 24 * 3600_000  // 7 days

// ── Args ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const flags = {}
  for (const a of argv.slice(2)) {
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1)
      else flags[a.slice(2)] = true
    }
  }
  return flags
}

const args = parseArgs(process.argv)

if (args.help || args.h) {
  console.log(`Usage: bun run rotate [options]

Options:
  --json         Output machine-readable JSON
  --dry-run      Show plan without executing
  --quiet        Exit code only, no output
  --help         Show this help`)
  process.exit(0)
}

// ── Patterns ─────────────────────────────────────────────────────

const MAIN_LOG_PATTERN = /^[\w-]+\.(out|err)\.log$/
const WATCHER_PATTERN = /^[\w-]+-watcher-(\d{4}-\d{2}-\d{2}T[\d-]+Z)\.log$/

function parseWatcherTimestamp(filename) {
  const match = filename.match(WATCHER_PATTERN)
  if (!match) return null
  const raw = match[1]
  const parts = raw.split('-')
  if (parts.length < 6) return null
  const iso = `${parts[0]}-${parts[1]}-${parts[2]}:${parts[3]}:${parts[4]}.${parts[5]}`
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

// ── Plan ─────────────────────────────────────────────────────────

function buildPlan() {
  const now = Date.now()
  const actions = []

  if (!existsSync(LOG_DIR)) {
    return { ts: new Date().toISOString(), actions: [], summary: 'log directory does not exist' }
  }

  const entries = readdirSync(LOG_DIR)

  // Main logs: rotate oversized
  const mainLogs = entries.filter(f => MAIN_LOG_PATTERN.test(f))
  for (const name of mainLogs) {
    const fullPath = join(LOG_DIR, name)
    try {
      const stat = statSync(fullPath)
      if (stat.size > MAX_SIZE_BYTES) {
        actions.push({
          kind: 'rotate',
          path: fullPath,
          name,
          reason: `${(stat.size / 1024).toFixed(0)}KB > ${(MAX_SIZE_BYTES / 1024).toFixed(0)}KB`,
        })
      }
    } catch { /* skip */ }

    // Find and count rotated copies
    const copies = entries
      .filter(f => f.startsWith(name + '.') && /\.\d+$/.test(f))
      .sort((a, b) => {
        const na = parseInt(a.split('.').pop(), 10)
        const nb = parseInt(b.split('.').pop(), 10)
        return na - nb
      })

    if (copies.length > KEEP_ROTATED) {
      for (const old of copies.slice(KEEP_ROTATED)) {
        actions.push({
          kind: 'prune',
          path: join(LOG_DIR, old),
          name: old,
          reason: `exceeds ${KEEP_ROTATED} rotated copies`,
        })
      }
    }
  }

  // Watcher logs: delete stale
  const watcherLogs = entries.filter(f => WATCHER_PATTERN.test(f))
  for (const name of watcherLogs) {
    const ts = parseWatcherTimestamp(name)
    if (ts !== null && (now - ts) > WATCHER_MAX_AGE_MS) {
      const ageDays = Math.round((now - ts) / (24 * 3600_000))
      actions.push({
        kind: 'delete',
        path: join(LOG_DIR, name),
        name,
        reason: `${ageDays}d old`,
      })
    }
  }

  const rotateCount = actions.filter(a => a.kind === 'rotate').length
  const deleteCount = actions.filter(a => a.kind === 'delete').length
  const pruneCount = actions.filter(a => a.kind === 'prune').length

  const parts = []
  if (rotateCount) parts.push(`${rotateCount} to rotate`)
  if (deleteCount) parts.push(`${deleteCount} watcher logs to delete`)
  if (pruneCount) parts.push(`${pruneCount} old copies to prune`)
  const summary = parts.length > 0 ? parts.join(', ') : 'nothing to do'

  return { ts: new Date().toISOString(), actions, summary }
}

// ── Execute ──────────────────────────────────────────────────────

function executeRotation(action) {
  switch (action.kind) {
    case 'rotate': {
      // Shift existing copies: .3 → delete, .2 → .3, .1 → .2
      for (let i = KEEP_ROTATED; i >= 1; i--) {
        const from = action.path + '.' + i
        const to = action.path + '.' + (i + 1)
        if (existsSync(from)) {
          if (i === KEEP_ROTATED) {
            unlinkSync(from)
          } else {
            renameSync(from, to)
          }
        }
      }
      // Copy current → .1, then truncate original (preserves inode)
      copyFileSync(action.path, action.path + '.1')
      truncateSync(action.path, 0)
      return { ...action, executed: true }
    }
    case 'delete':
    case 'prune': {
      unlinkSync(action.path)
      return { ...action, executed: true }
    }
    default:
      return { ...action, executed: false, error: `unknown kind: ${action.kind}`, code: 'UNKNOWN_KIND', type: 'invalid_action', title: 'Unknown action kind', detail: `Cannot execute action with unknown kind: ${action.kind}` }
  }
}

function executePlan(plan) {
  const results = []
  for (const action of plan.actions) {
    try {
      results.push(executeRotation(action))
    } catch (e) {
      results.push({ ...action, executed: false, error: e.message })
    }
  }
  return results
}

// ── Output ───────────────────────────────────────────────────────

const isTTY = process.stdout.isTTY

function color(code, text) {
  if (!isTTY) return text
  return `\x1b[${code}m${text}\x1b[0m`
}

function renderPlan(plan, results, dryRun) {
  const lines = []
  lines.push('')
  lines.push(color('1', 'log rotation') + '  ' + color('90', plan.ts) + (dryRun ? color('33', ' (dry run)') : ''))
  lines.push('')

  if (plan.actions.length === 0) {
    lines.push(`  ${color('32', '✓')} ${plan.summary}`)
  } else {
    const items = dryRun ? plan.actions : results
    for (const item of items) {
      const icon = item.executed === false
        ? color('31', '✗')
        : item.kind === 'rotate'
          ? color('36', '↻')
          : color('33', '×')
      const label = item.name || item.path.split('/').pop()
      const status = dryRun
        ? color('90', `would ${item.kind}`)
        : item.executed
          ? color('32', item.kind + 'd')
          : color('31', `failed: ${item.error}`)
      lines.push(`  ${icon} ${label.padEnd(50)} ${status}  ${color('90', item.reason)}`)
    }
  }

  lines.push('')
  lines.push(`  ${color('90', plan.summary)}`)
  lines.push('')
  return lines.join('\n')
}

// ── Main ─────────────────────────────────────────────────────────

function main() {
  const plan = buildPlan()

  if (args['dry-run']) {
    if (args.json) {
      console.log(JSON.stringify({ ...plan, dryRun: true }, null, 2))
    } else if (!args.quiet) {
      console.log(renderPlan(plan, [], true))
    }
    process.exit(0)
    return
  }

  const results = executePlan(plan)
  const failures = results.filter(r => !r.executed)

  if (args.json) {
    console.log(JSON.stringify({ ...plan, results, failures: failures.length }, null, 2))
  } else if (!args.quiet) {
    console.log(renderPlan(plan, results, false))
    if (failures.length > 0) {
      console.log(color('31', `  ${failures.length} action(s) failed`))
    }
  }

  process.exit(failures.length > 0 ? 1 : 0)
}

// ── Exports for testing ─────────────────────────────────────────

export { buildPlan, executePlan, executeRotation, parseWatcherTimestamp }

// ── Entrypoint ──────────────────────────────────────────────────

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('rotate-logs.mjs')
if (isMain) {
  main()
}
