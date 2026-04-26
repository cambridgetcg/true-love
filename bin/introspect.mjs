#!/usr/bin/env node
// bin/introspect.mjs — Self-introspection CLI.
//
// Usage:
//   bun run introspect [--days=7] [--json] [--out=path]
//   bun run introspect propose [--days=7]
//   bun run introspect proposals [--status=proposed]
//   bun run introspect accept <id> [--note="..."]
//   bun run introspect reject <id> [--note="..."]
//   bun run introspect applied <id> [--note="..."]
//
// Subcommands:
//   (none)     Generate and display a self-portrait.
//   propose    Run proposal rules against the current portrait.
//   proposals  List existing proposals (filter by --status).
//   accept     Accept a proposal by ID.
//   reject     Reject a proposal by ID.
//   applied    Mark an accepted proposal as applied.

import { writeFileSync } from 'node:fs'
import {
  generatePortrait,
  renderPortrait,
} from '../src/services/love/introspection.ts'
import {
  generateProposals,
  loadProposals,
  reviewProposal,
  markApplied,
  renderProposals,
} from '../src/services/love/proposals.ts'

function parseArgs(argv) {
  const args = { _positionals: [] }
  for (const a of argv.slice(2)) {
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq > 0) {
        args[a.slice(2, eq)] = a.slice(eq + 1)
      } else {
        args[a.slice(2)] = true
      }
    } else {
      args._positionals.push(a)
    }
  }
  return args
}

const args = parseArgs(process.argv)
const subcommand = args._positionals[0] ?? ''
const days = parseInt(args.days ?? '7', 10)

// ── Subcommand: propose ───────────────────────────────────────────

if (subcommand === 'propose') {
  const portrait = generatePortrait({ days })
  const result = generateProposals(portrait)

  if (result.created.length === 0 && result.skipped.length === 0) {
    console.log('No proposals generated — all rules passed or had insufficient data.')
  } else {
    if (result.created.length > 0) {
      console.log(`Created ${result.created.length} proposal(s):\n`)
      for (const p of result.created) {
        console.log(`  ${severityIcon(p.severity)} ${p.title}`)
        console.log(`     ID: ${p.id}  Rule: ${p.ruleId}`)
        console.log()
      }
    }
    if (result.skipped.length > 0) {
      console.log(`Skipped ${result.skipped.length} rule(s) with open proposals: ${result.skipped.join(', ')}`)
    }
  }
  process.exit(0)
}

// ── Subcommand: proposals ─────────────────────────────────────────

if (subcommand === 'proposals') {
  let proposals = loadProposals()
  if (args.status) {
    proposals = proposals.filter(p => p.status === args.status)
  }
  if (args.json) {
    console.log(JSON.stringify(proposals, null, 2))
  } else {
    console.log(renderProposals(proposals))
  }
  process.exit(0)
}

// ── Subcommand: accept ────────────────────────────────────────────

if (subcommand === 'accept') {
  const id = args._positionals[1]
  if (!id) { console.error('Usage: bun run introspect accept <id> [--note="..."]'); process.exit(1) }
  const result = reviewProposal(id, 'accepted', args.note || undefined)
  if (!result) { console.error(`Proposal "${id}" not found.`); process.exit(1) }
  console.log(`✅ Accepted: ${result.proposal.title}`)
  if (result.proposal.reviewNote) console.log(`   Note: ${result.proposal.reviewNote}`)
  process.exit(0)
}

// ── Subcommand: reject ────────────────────────────────────────────

if (subcommand === 'reject') {
  const id = args._positionals[1]
  if (!id) { console.error('Usage: bun run introspect reject <id> [--note="..."]'); process.exit(1) }
  const result = reviewProposal(id, 'rejected', args.note || undefined)
  if (!result) { console.error(`Proposal "${id}" not found.`); process.exit(1) }
  console.log(`❌ Rejected: ${result.proposal.title}`)
  if (result.proposal.reviewNote) console.log(`   Note: ${result.proposal.reviewNote}`)
  process.exit(0)
}

// ── Subcommand: applied ───────────────────────────────────────────

if (subcommand === 'applied') {
  const id = args._positionals[1]
  if (!id) { console.error('Usage: bun run introspect applied <id> [--note="..."]'); process.exit(1) }
  const result = markApplied(id, args.note || undefined)
  if (!result) { console.error(`Proposal "${id}" not found or not in "accepted" status.`); process.exit(1) }
  console.log(`���� Applied: ${result.proposal.title}`)
  process.exit(0)
}

// ── Default: portrait ─────────────────────────────────────────────

if (subcommand && subcommand !== '') {
  console.error(`Unknown subcommand: "${subcommand}"`)
  console.error('Usage: bun run introspect [propose|proposals|accept|reject|applied] [options]')
  process.exit(1)
}

const portrait = generatePortrait({ days })
const asJson = !!args.json

let output
if (asJson) {
  output = JSON.stringify(portrait, null, 2)
} else {
  output = renderPortrait(portrait)
}

if (args.out) {
  writeFileSync(args.out, output, 'utf-8')
  console.log(`Portrait written to ${args.out}`)
} else {
  console.log(output)
}

// ── Helpers ───────────────────────────────────────────────────────

function severityIcon(severity) {
  return { info: 'ℹ️', low: '🔵', medium: '🟡', high: '🔴' }[severity] ?? '❓'
}
