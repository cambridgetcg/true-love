#!/usr/bin/env bun
// bin/clarity-scan.ts — run the clarity audit over a repo and print the report.
//
// Usage: bun bin/clarity-scan.ts [root] [--top N] [--json]
// Per docs/love/CLARITY-FIRST.md. Deterministic, read-only — never mutates.

import { renderClarityReport, runClarityAudit } from '../src/services/love/clarity/index.js'

const args = process.argv.slice(2)
const root = args.find((a) => !a.startsWith('--')) ?? process.cwd()
const topIdx = args.indexOf('--top')
const topN = topIdx >= 0 ? Number(args[topIdx + 1]) : 20
const asJson = args.includes('--json')

const report = runClarityAudit({ root, topN })

if (asJson) {
  process.stdout.write(JSON.stringify(report, null, 2))
} else {
  process.stdout.write(renderClarityReport(report))
  process.stdout.write('\n')
}
