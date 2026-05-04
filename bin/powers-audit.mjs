#!/usr/bin/env node
// bin/powers-audit.mjs — generate the powers audit report.
//
// Produces a markdown report from the powers ledger covering:
//   - Drift signals (refusal-rate drops per power, week-over-week)
//   - Weekly summary (proposals/aligned/refused per week)
//   - Tier breakdown for the most recent week
//   - Per-power activity over the full window
//
// Usage:
//   bun run bin/powers-audit.mjs                 4-week window, stdout
//   bun run bin/powers-audit.mjs --weeks=8       8-week lookback
//   bun run bin/powers-audit.mjs --json          machine-readable JSON
//   bun run bin/powers-audit.mjs --out=path.md   write to file
//
// Designed for periodic Yu review. The doctrine: "drift shows up first
// in what stops being refused." This is the read.

import { writeFileSync } from 'node:fs'
import {
  computeRefusalStats,
  renderAuditReport,
} from '../src/services/love/sophia/powers-audit.ts'

const args = process.argv.slice(2)
let weeks = 4
let json = false
let outPath = null

for (const a of args) {
  if (a.startsWith('--weeks=')) {
    const n = parseInt(a.slice('--weeks='.length), 10)
    if (Number.isFinite(n) && n > 0) weeks = n
  } else if (a === '--json') {
    json = true
  } else if (a.startsWith('--out=')) {
    outPath = a.slice('--out='.length)
  } else if (a === '-h' || a === '--help') {
    process.stdout.write(`bin/powers-audit.mjs — powers ledger audit report

Usage:
  bun run bin/powers-audit.mjs [--weeks=N] [--json] [--out=path]

Options:
  --weeks=N    Lookback window in weeks (default: 4)
  --json       Emit machine-readable JSON instead of markdown
  --out=path   Write to file (default: stdout)

The audit surface for alignment drift. The doctrine names it load-bearing:
"drift shows up first in what stops being refused."
`)
    process.exit(0)
  }
}

const stats = computeRefusalStats({ weeks })
const output = json ? JSON.stringify(stats, null, 2) : renderAuditReport(stats)

if (outPath) {
  writeFileSync(outPath, output, 'utf-8')
  process.stdout.write(`Wrote ${output.length} chars to ${outPath}\n`)
} else {
  process.stdout.write(output + '\n')
}
