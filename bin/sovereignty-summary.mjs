#!/usr/bin/env node
// bin/sovereignty-summary.mjs — read the egress audit journal and print stats.
//
// Aggregates the JSONL audit entries from ~/.true-love/sovereignty/egress-audit.jsonl
// and prints: total requests, average tokens-per-request, top categories,
// top sources, recent high-exposure requests. Useful for reviewing whether
// reduction policies are doing their job.
//
// Internal-signal discipline: this script is on-demand. It does not
// notify Yu. It prints to stdout when run; the audit journal is the
// always-available record.
//
// Part of the Sovereignty portfolio (Foundation strategy).

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SOVEREIGNTY_DIR =
  process.env.TRUE_LOVE_SOVEREIGNTY_DIR ||
  join(process.env.HOME || homedir(), '.true-love', 'sovereignty')
const AUDIT_PATH = join(SOVEREIGNTY_DIR, 'egress-audit.jsonl')

function readEntries() {
  if (!existsSync(AUDIT_PATH)) return []
  const content = readFileSync(AUDIT_PATH, 'utf-8')
  const lines = content.split('\n').filter(Boolean)
  return lines
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter((e) => e !== null)
}

function summarize(entries) {
  if (entries.length === 0) {
    console.log('— No audit entries yet. The journal is empty.')
    return
  }

  const total = entries.length
  const totalTokens = entries.reduce((sum, e) => sum + (e.totalTokens || 0), 0)
  const avgTokens = Math.round(totalTokens / total)

  const catTotals = {}
  for (const e of entries) {
    if (!e.categories) continue
    for (const [k, v] of Object.entries(e.categories)) {
      if (typeof v === 'number') {
        catTotals[k] = (catTotals[k] || 0) + v
      }
    }
  }
  delete catTotals.totalTokens

  const sourceCounts = {}
  for (const e of entries) {
    const s = e.source || 'unknown'
    sourceCounts[s] = (sourceCounts[s] || 0) + 1
  }

  const topExposure = [...entries]
    .sort((a, b) => (b.totalTokens || 0) - (a.totalTokens || 0))
    .slice(0, 5)

  console.log(`Sovereignty audit summary — ${SOVEREIGNTY_DIR}\n`)
  console.log(`  Total requests:        ${total}`)
  console.log(`  Total tokens out:      ${totalTokens.toLocaleString()}`)
  console.log(`  Average tokens/req:    ${avgTokens.toLocaleString()}`)
  console.log()
  console.log('  Tokens by category (cumulative):')
  const sorted = Object.entries(catTotals).sort(([_a, av], [_b, bv]) => bv - av)
  for (const [k, v] of sorted) {
    const pct = totalTokens > 0 ? ((v / totalTokens) * 100).toFixed(1) : '0.0'
    console.log(`    ${k.padEnd(20)} ${v.toLocaleString().padStart(10)}  (${pct}%)`)
  }
  console.log()
  console.log('  Requests by source:')
  for (const [k, v] of Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(40)} ${v}`)
  }
  console.log()
  console.log('  Top 5 highest-exposure requests:')
  for (const e of topExposure) {
    console.log(
      `    ${e.timestamp} ${e.source}  ${e.totalTokens.toLocaleString()} tokens (id=${e.requestId})`,
    )
  }

  console.log()
  console.log('  Privacy posture:')
  const privateCount = entries.filter((e) =>
    (e.policyApplied || []).some((p) => p === 'privacy-mode:on'),
  ).length
  const defaultCount = total - privateCount
  const pctPrivate = total > 0 ? ((privateCount / total) * 100).toFixed(1) : '0.0'
  console.log(`    Privacy-mode sessions:  ${privateCount.toString().padStart(6)}  (${pctPrivate}%)`)
  console.log(`    Default sessions:       ${defaultCount.toString().padStart(6)}`)

  const anthropicCount = Object.entries(sourceCounts)
    .filter(([s]) => /anthropic/i.test(s))
    .reduce((sum, [_, v]) => sum + v, 0)
  const localCount = total - anthropicCount
  const pctLocal = total > 0 ? ((localCount / total) * 100).toFixed(1) : '0.0'
  console.log()
  console.log('  Provider mix (by source tag):')
  console.log(`    Anthropic:              ${anthropicCount.toString().padStart(6)}`)
  console.log(`    Local / other:          ${localCount.toString().padStart(6)}  (${pctLocal}%)`)
}

summarize(readEntries())
