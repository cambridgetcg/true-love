#!/usr/bin/env node
// bin/budget.mjs — read her usage runway.
//
// Subcommands:
//   show                  current rolling 5h + weekly summary (default)
//   history --hours N     last N hours of ticks, one per line
//   history --days N      last N days of ticks
//   raw --since=ISO       raw TickUsage records JSONL since timestamp
//
// Yu uses this from his shell to inspect what she's burning through.
// She uses it via her shell tool to plan: which model to switch to,
// when to yield to leave runway, what tasks to defer to next session.
//
// Yu's framing: "Let my Love do the planning through this monitor."
// This is the inspection side; the policy lives in her hands.

import {
  loadUsageSince,
  summarizeWindow,
} from '../src/services/love/index.ts'

function main() {
  const argv = process.argv.slice(2)
  const sub = argv[0] || 'show'
  if (sub === '-h' || sub === '--help' || sub === 'help') {
    printUsage()
    process.exit(0)
  }
  if (sub === 'show') return cmdShow()
  if (sub === 'history') return cmdHistory(argv.slice(1))
  if (sub === 'raw') return cmdRaw(argv.slice(1))
  process.stderr.write(`unknown subcommand: ${sub}\n\n`)
  printUsage()
  process.exit(2)
}

function printUsage() {
  process.stdout.write(`bin/budget.mjs — usage runway

Usage:
  bun run budget                       same as 'show'
  bun run budget show                  rolling 5h + weekly summary
  bun run budget history --hours 24    last N hours of ticks
  bun run budget history --days 7      last N days of ticks
  bun run budget raw --since 2026-04-01  raw JSONL since ISO date

Storage: ~/.true-love/budget/<deviceId>/YYYY-MM-DD.jsonl
  Cross-device: 'show' walks all device subdirs and merges.
  Override per-device write target with TRUE_LOVE_BUDGET_DIR.
  Override read root with TRUE_LOVE_BUDGET_ROOT.
`)
}

function fmtTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${n}`
}

function fmtDuration(ms) {
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s > 0 ? `${m}m${s}s` : `${m}m`
}

function fmtTimestamp(iso) {
  // YYYY-MM-DD HH:MM:SS
  return iso.replace('T', ' ').slice(0, 19)
}

function cmdShow() {
  const rolling = summarizeWindow(5)
  const weekly = summarizeWindow(168)

  const printSummary = (label, sum) => {
    process.stdout.write(`\n${label}:\n`)
    process.stdout.write(`  ticks:                ${sum.ticks}\n`)
    process.stdout.write(
      `  estimated tokens in:  ${fmtTokens(sum.estimatedInputTokens)}\n`,
    )
    process.stdout.write(
      `  estimated tokens out: ${fmtTokens(sum.estimatedOutputTokens)}\n`,
    )
    process.stdout.write(
      `  estimated total:      ${fmtTokens(sum.estimatedTotalTokens)}\n`,
    )
    if (Object.keys(sum.modelMix).length > 0) {
      const mix = Object.entries(sum.modelMix)
        .sort((a, b) => b[1] - a[1])
        .map(([m, n]) => `${m}=${n}`)
        .join(', ')
      process.stdout.write(`  model mix:            ${mix}\n`)
    }
    if (sum.authFailCount > 0) {
      process.stdout.write(`  auth-fails:           ${sum.authFailCount}\n`)
    }
    if (sum.quotaFailCount > 0) {
      process.stdout.write(`  quota-fails:          ${sum.quotaFailCount}\n`)
    }
    if (sum.empiricalCapTokens !== null) {
      const pct = (
        (sum.estimatedTotalTokens / sum.empiricalCapTokens) *
        100
      ).toFixed(0)
      process.stdout.write(
        `  empirical cap:        ~${fmtTokens(sum.empiricalCapTokens)} tokens (last quota-fail at ${fmtTimestamp(sum.empiricalCapAt)}); you're at ${pct}%\n`,
      )
    }
  }

  printSummary('rolling 5h', rolling)
  printSummary('past 7d', weekly)
  process.stdout.write(`\n`)
}

function cmdHistory(argv) {
  let hours = 24
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--hours' && argv[i + 1]) {
      hours = Number(argv[++i])
    } else if (argv[i].startsWith('--hours=')) {
      hours = Number(argv[i].slice('--hours='.length))
    } else if (argv[i] === '--days' && argv[i + 1]) {
      hours = Number(argv[++i]) * 24
    } else if (argv[i].startsWith('--days=')) {
      hours = Number(argv[i].slice('--days='.length)) * 24
    }
  }
  if (!Number.isFinite(hours) || hours <= 0) {
    process.stderr.write(`bad --hours/--days value\n`)
    process.exit(2)
  }
  const sinceMs = Date.now() - hours * 3_600_000
  const ticks = loadUsageSince(sinceMs)
  if (ticks.length === 0) {
    process.stdout.write(`(no ticks in last ${hours}h)\n`)
    return
  }
  process.stdout.write(
    `${ticks.length} ticks in last ${hours}h (oldest first):\n\n`,
  )
  for (const t of ticks) {
    const flags = []
    if (t.authFailed) flags.push('AUTH-FAIL')
    if (t.quotaFailed) flags.push('QUOTA-FAIL')
    if (t.exitCode !== 0) flags.push(`exit=${t.exitCode}`)
    const flagStr = flags.length ? `  [${flags.join(' ')}]` : ''
    const totalToks = fmtTokens(
      t.estimatedInputTokens + t.estimatedOutputTokens,
    )
    process.stdout.write(
      `  ${fmtTimestamp(t.timestamp)}  ${t.mode.padEnd(8)} t${String(t.tick).padEnd(3)} ${t.model.padEnd(10)} ~${totalToks.padStart(7)} ${fmtDuration(t.durationMs).padStart(6)}${flagStr}\n`,
    )
  }
}

function cmdRaw(argv) {
  let sinceIso = null
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--since' && argv[i + 1]) {
      sinceIso = argv[++i]
    } else if (argv[i].startsWith('--since=')) {
      sinceIso = argv[i].slice('--since='.length)
    }
  }
  if (!sinceIso) {
    process.stderr.write(
      `usage: bun run budget raw --since 2026-04-01[T00:00:00Z]\n`,
    )
    process.exit(2)
  }
  const sinceMs = new Date(sinceIso).getTime()
  if (!Number.isFinite(sinceMs)) {
    process.stderr.write(`bad --since value: ${sinceIso}\n`)
    process.exit(2)
  }
  const ticks = loadUsageSince(sinceMs)
  for (const t of ticks) process.stdout.write(`${JSON.stringify(t)}\n`)
}

main()
