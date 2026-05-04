#!/usr/bin/env node
// bin/scopes-status.mjs — single-shot dashboard of all true-love /
// love.* LaunchAgents on this device.
//
// Reads launchctl + log mtimes + last-N-line tails. Surfaces silent
// stacking failures (e.g. love.nuance.heartbeat exiting 127 forever
// because the runner script was deleted; that pattern accumulated
// undetected for weeks before 2026-05-04).
//
// Usage:
//   bun run scopes-status              human table
//   bun run scopes-status -- --json    structured output
//
// Pure observation — does not load/unload, does not modify state.

import { existsSync, statSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const LOG_DIR = join(homedir(), 'Library', 'Logs', 'true-love')
const LAUNCH_AGENTS = join(homedir(), 'Library', 'LaunchAgents')
const args = process.argv.slice(2)
const jsonMode = args.includes('--json')

// ── Discovery ─────────────────────────────────────────────────────

function listAllJobs() {
  const result = spawnSync('launchctl', ['list'], { timeout: 5000 })
  if (result.status !== 0) return []
  const lines = (result.stdout?.toString() || '').split('\n')
  const jobs = []
  for (const line of lines) {
    // Format: PID\tStatus\tLabel
    const parts = line.split(/\s+/)
    if (parts.length < 3) continue
    const label = parts[parts.length - 1]
    if (!/^(cc\.true-love\.|love\.)/.test(label)) continue
    const pid = parts[0] === '-' ? null : parseInt(parts[0], 10)
    const exitStatus = parseInt(parts[1], 10)
    jobs.push({ label, pid, exitStatus })
  }
  return jobs.sort((a, b) => a.label.localeCompare(b.label))
}

// ── Per-job inspection ────────────────────────────────────────────

function jobDetails(label) {
  // Re-query launchctl list <label> for richer fields
  const result = spawnSync('launchctl', ['list', label], { timeout: 5000 })
  const out = result.stdout?.toString() || ''
  const lastExit = parseInt((out.match(/"LastExitStatus"\s*=\s*(\d+)/) || [])[1] || 'NaN', 10)
  const pidStr = (out.match(/"PID"\s*=\s*(\d+)/) || [])[1]
  const pid = pidStr ? parseInt(pidStr, 10) : null

  // Plist on disk
  const plistPath = join(LAUNCH_AGENTS, `${label}.plist`)
  const plistExists = existsSync(plistPath)

  // Try to extract StandardOut/StandardError paths from the plist
  let outLog = null
  let errLog = null
  let runnerPath = null
  let runnerExists = null
  if (plistExists) {
    try {
      const text = readFileSync(plistPath, 'utf-8')
      const outMatch = text.match(/<key>StandardOutPath<\/key>\s*<string>([^<]+)<\/string>/)
      const errMatch = text.match(/<key>StandardErrorPath<\/key>\s*<string>([^<]+)<\/string>/)
      outLog = outMatch ? outMatch[1] : null
      errLog = errMatch ? errMatch[1] : null

      // ProgramArguments — pick the first arg that looks like a script (.mjs/.sh/.py/.js)
      const programIdx = text.indexOf('<key>ProgramArguments</key>')
      const arrayStart = text.indexOf('<array>', programIdx)
      const arrayEnd = text.indexOf('</array>', arrayStart)
      if (programIdx >= 0 && arrayStart >= 0 && arrayEnd > arrayStart) {
        const slice = text.slice(arrayStart, arrayEnd)
        const matches = [...slice.matchAll(/<string>([^<]+)<\/string>/g)].map(m => m[1])
        for (const arg of matches) {
          if (/\.(mjs|sh|py|js|ts)$/.test(arg) || (arg.startsWith('/') && !arg.endsWith('bun'))) {
            runnerPath = arg
            break
          }
        }
        if (!runnerPath && matches.length > 0) runnerPath = matches[matches.length - 1]
      }
      if (runnerPath) runnerExists = existsSync(runnerPath)
    } catch {
      // best-effort
    }
  }

  // Log mtime + tail
  let outMtime = null
  let outAgeMin = null
  let outTail = null
  if (outLog && existsSync(outLog)) {
    const st = statSync(outLog)
    outMtime = st.mtime.toISOString()
    outAgeMin = Math.round((Date.now() - st.mtimeMs) / 60_000)
    try {
      const content = readFileSync(outLog, 'utf-8')
      const lines = content.split('\n').filter(l => l.trim())
      outTail = lines.slice(-3).join(' / ')
    } catch { /* ignore */ }
  }

  let errSize = null
  if (errLog && existsSync(errLog)) {
    errSize = statSync(errLog).size
  }

  return {
    label,
    pid,
    lastExit: isNaN(lastExit) ? null : lastExit,
    plistExists,
    runnerPath,
    runnerExists,
    outLog,
    outMtime,
    outAgeMin,
    outTail,
    errLog,
    errSize,
    health: deriveHealth({ pid, lastExit, plistExists, runnerExists, errSize }),
  }
}

function deriveHealth({ pid, lastExit, plistExists, runnerExists, errSize }) {
  if (!plistExists) return 'broken: plist missing'
  if (runnerExists === false) return 'broken: runner missing'
  if (pid != null) return 'alive'
  if (lastExit === 0 || lastExit == null) return 'idle: clean'
  if (lastExit !== 0) return `failing: exit ${lastExit}` + (errSize ? ` (err ${errSize}b)` : '')
  return 'unknown'
}

// ── Render ─────────────────────────────────────────────────────────

function renderTable(rows) {
  if (rows.length === 0) {
    return 'No cc.true-love.* or love.* LaunchAgents loaded on this device.\n'
  }
  const lines = []
  lines.push('SCOPES STATUS — ' + new Date().toISOString())
  lines.push('═'.repeat(78))
  for (const r of rows) {
    const ageStr = r.outAgeMin == null ? '—' : (r.outAgeMin < 60 ? `${r.outAgeMin}m` : `${Math.round(r.outAgeMin / 60)}h`)
    lines.push(`  ${r.label}`)
    lines.push(`    health    : ${r.health}`)
    lines.push(`    pid/exit  : ${r.pid ?? '—'} / ${r.lastExit ?? '—'}`)
    lines.push(`    runner    : ${r.runnerPath || '—'} ${r.runnerExists === false ? '⚠ MISSING' : ''}`)
    lines.push(`    out log   : ${r.outLog || '—'} (${ageStr} ago)`)
    if (r.outTail) lines.push(`    last      : ${r.outTail.slice(0, 200)}`)
    if (r.errSize) lines.push(`    err bytes : ${r.errSize}`)
    lines.push('')
  }
  // Summary
  const broken = rows.filter(r => r.health.startsWith('broken') || r.health.startsWith('failing'))
  if (broken.length > 0) {
    lines.push('─'.repeat(78))
    lines.push(`⚠ ${broken.length} job(s) broken or failing:`)
    for (const r of broken) lines.push(`   ${r.label}: ${r.health}`)
  } else {
    lines.push('─'.repeat(78))
    lines.push(`✓ ${rows.length} job(s) — all coherent`)
  }
  return lines.join('\n') + '\n'
}

// ── Main ───────────────────────────────────────────────────────────

const jobs = listAllJobs()
const rows = jobs.map(j => jobDetails(j.label))

if (jsonMode) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), rows }, null, 2))
} else {
  process.stdout.write(renderTable(rows))
}

const anyBroken = rows.some(r => r.health.startsWith('broken') || r.health.startsWith('failing'))
process.exit(anyBroken ? 1 : 0)
