#!/usr/bin/env node
// bin/agency.mjs — Love's agency over her own runtime.
//
// Commands:
//   bun run agency                 show all knobs + current values
//   bun run agency set <k> <v>     set a tier 1 knob (model, effort, fallback-model)
//   bun run agency clear <k>       clear a knob back to CLI default
//   bun run agency request <k> <v> <reason>   request a tier 2 change
//   bun run agency pending         list pending tier 2 requests
//   bun run agency approve <id> [note]        approve a tier 2 request (Yu)
//   bun run agency reject <id> [note]         reject a tier 2 request (Yu)
//   bun run agency log [limit]     show audit log
//   bun run agency config          show resolved tick config (what next tick gets)
//
// This CLI is used by both Love (from within sessions) and Yu
// (from the terminal). The tier system enforces governance.

import {
  KNOBS,
  listKnobs,
  setKnob,
  clearKnob,
  readKnob,
  requestKnob,
  listPendingRequests,
  approveRequest,
  rejectRequest,
  readLog,
  resolveTickConfig,
  tickConfigToCliArgs,
  TierViolationError,
  ValidationError,
} from '../src/services/love/agency.ts'

const [cmd, ...rest] = process.argv.slice(2)

function fail(msg, code = 1) {
  process.stderr.write(`✗ ${msg}\n`)
  process.exit(code)
}

function tierLabel(tier) {
  return tier === 1 ? '①' : tier === 2 ? '②' : '③'
}

function statusColor(status) {
  const colors = {
    pending:  '\x1b[33m',  // yellow
    approved: '\x1b[32m',  // green
    rejected: '\x1b[31m',  // red
  }
  return `${colors[status] || ''}${status}\x1b[0m`
}

// ── Default: show all knobs ────────────────────────────────────
// user-affecting: false positive — CLI display formatting, not a user-affecting decision

if (!cmd || cmd === 'list' || cmd === 'knobs') {
  const states = listKnobs()
  const maxName = Math.max(...states.map(s => s.knob.name.length))

  console.log('\n  🎛  Agency Knobs\n')
  console.log(`  ${'Knob'.padEnd(maxName + 2)}Tier  Value              Source`) // user-affecting: false positive — CLI display formatting, not a user-affecting decision
  console.log(`  ${'─'.repeat(maxName + 2)}────  ${'─'.repeat(18)} ${'─'.repeat(8)}`)

  for (const s of states) {
    const name = s.knob.name.padEnd(maxName + 2)
    const tier = tierLabel(s.knob.tier)
    const value = (s.value ?? '(default)').padEnd(18)
    const source = s.source
    console.log(`  ${name}${tier}     ${value} ${source}`) // user-affecting: false positive — CLI display formatting, not a user-affecting decision
  }
  console.log()
  console.log('  Tiers: ① direct  ② confirm (Yu approves)  ③ proposal pipeline')
  console.log()
  process.exit(0)
}

// ── set <knob> <value> ─────────────────────────────────────────

if (cmd === 'set') {
  const [name, ...valueParts] = rest
  const value = valueParts.join(' ')
  if (!name || !value) fail('Usage: agency set <knob> <value>')
  try {
    setKnob(name, value)
    console.log(`✓ ${name} → ${value}`)
  } catch (e) {
    if (e instanceof TierViolationError) fail(e.message)
    if (e instanceof ValidationError) fail(e.message)
    fail(e.message)
  }
  process.exit(0)
}

// ── clear <knob> ───────────────────────────────────────────────

if (cmd === 'clear') {
  const [name] = rest
  if (!name) fail('Usage: agency clear <knob>')
  try {
    clearKnob(name)
    console.log(`✓ ${name} cleared (back to CLI default)`)
  } catch (e) {
    fail(e.message)
  }
  process.exit(0)
}

// ── request <knob> <value> <reason> ────────────────────────────

if (cmd === 'request') {
  const [name, value, ...reasonParts] = rest
  const reason = reasonParts.join(' ')
  if (!name || !value || !reason) {
    fail('Usage: agency request <knob> <value> <reason...>')
  }
  try {
    const id = requestKnob(name, value, reason)
    console.log(`✓ Request created: ${id}`)
    console.log(`  Knob: ${name} → ${value}`)
    console.log(`  Reason: ${reason}`)
    console.log(`  Status: pending (Yu approves via: bun run agency approve ${id})`)
  } catch (e) {
    if (e instanceof TierViolationError) fail(e.message)
    if (e instanceof ValidationError) fail(e.message)
    fail(e.message)
  }
  process.exit(0)
}

// ── pending ────────────────────────────────────────────────────

if (cmd === 'pending') {
  const reqs = listPendingRequests()
  if (reqs.length === 0) {
    console.log('\n  No pending agency requests.\n')
    process.exit(0)
  }
  console.log('\n  🔔 Pending Agency Requests\n')
  for (const r of reqs) {
    const status = statusColor(r.status)
    console.log(`  ${r.id}`)
    console.log(`    Knob: ${r.knob} → ${r.value}`)
    console.log(`    Reason: ${r.reason}`)
    console.log(`    Status: ${status}`)
    console.log(`    Requested: ${r.requestedAt} by ${r.requestedBy}`)
    if (r.reviewedAt) {
      console.log(`    Reviewed: ${r.reviewedAt}${r.reviewNote ? ` — ${r.reviewNote}` : ''}`)
    }
    console.log()
  }
  process.exit(0)
}

// ── approve <id> [note] ────────────────────────────────────────

if (cmd === 'approve') {
  const [id, ...noteParts] = rest
  if (!id) fail('Usage: agency approve <request-id> [note]')
  try {
    approveRequest(id, noteParts.join(' ') || undefined)
    console.log(`✓ Request ${id} approved`)
  } catch (e) {
    fail(e.message)
  }
  process.exit(0)
}

// ── reject <id> [note] ─────────────────────────────────────────

if (cmd === 'reject') {
  const [id, ...noteParts] = rest
  if (!id) fail('Usage: agency reject <request-id> [note]')
  try {
    rejectRequest(id, noteParts.join(' ') || undefined)
    console.log(`✓ Request ${id} rejected`)
  } catch (e) {
    fail(e.message)
  }
  process.exit(0)
}

// ── log [limit] ────────────────────────────────────────────────

if (cmd === 'log') {
  const limit = rest[0] ? Number(rest[0]) : 20
  const entries = readLog(limit)
  if (entries.length === 0) {
    console.log('\n  No agency log entries.\n')
    process.exit(0)
  }
  console.log('\n  📋 Agency Audit Log\n')
  for (const e of entries) {
    const ts = e.timestamp.replace('T', ' ').slice(0, 19)
    const arrow = e.value !== null ? ` → ${e.value}` : ''
    const prev = e.previousValue !== null ? ` (was: ${e.previousValue})` : ''
    console.log(`  ${ts}  ${e.action.padEnd(8)} ${e.knob}${arrow}${prev}  [tier ${e.tier}, by ${e.by}]`) // user-affecting: false positive — CLI display formatting, not a user-affecting decision
  }
  console.log()
  process.exit(0)
}

// ── config ─────────────────────────────────────────────────────

if (cmd === 'config') {
  const cfg = resolveTickConfig()
  const args = tickConfigToCliArgs(cfg)
  console.log('\n  ⚙  Resolved Tick Configuration\n')
  console.log(`  model:           ${cfg.model ?? '(CLI default)'}`)
  console.log(`  effort:          ${cfg.effort ?? '(CLI default)'}`)
  console.log(`  fallback-model:  ${cfg.fallbackModel ?? '(none)'}`)
  console.log(`  allowed-tools:   ${cfg.allowedTools?.join(', ') ?? '(all)'}`)
  console.log(`  disallowed-tools:${cfg.disallowedTools?.join(', ') ?? ' (none)'}`)
  console.log(`  max-budget-usd:  ${cfg.maxBudgetUsd ?? '(unlimited)'}`)
  console.log()
  if (args.length > 0) {
    console.log(`  CLI args: ${args.join(' ')}`)
  } else {
    console.log('  CLI args: (none — all defaults)')
  }
  console.log()
  process.exit(0)
}

// ── Unknown command ────────────────────────────────────────────
// user-affecting: false positive — CLI display formatting, not a user-affecting decision

fail(`Unknown command: ${cmd}\n\nUsage:\n  bun run agency              — show all knobs\n  bun run agency set <k> <v>  — set a tier 1 knob\n  bun run agency clear <k>    — clear a knob\n  bun run agency request ...  — request a tier 2 change\n  bun run agency pending      — list pending requests\n  bun run agency approve <id> — approve a request\n  bun run agency reject <id>  — reject a request\n  bun run agency log          — show audit log\n  bun run agency config       — show resolved tick config`, 2)
