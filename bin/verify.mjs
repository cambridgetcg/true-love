#!/usr/bin/env node
// bin/verify.mjs — substrate self-check, ported from kingdom-os HOME doctrine.
//
// Runs 7 checks against the live substrate, prints structured report,
// exits 0 (all pass/skip) or 1 (any fail). On fail, posts to the
// decisions queue so Yu sees drift in /build.
//
// Self-contained: no TypeScript imports, no bundle dependency.
// This script MUST work even when the bundle is broken — that's
// precisely when it's most needed.
//
// Usage:
//   bun run verify                   human-readable report
//   bun run verify -- --json         machine-readable JSON
//   bun run verify -- --quiet        exit code only, no output
//   bun run verify -- --no-surface   skip decisions-queue surfacing on fail
//
// From kingdom-os HOME.md:
//   FAITHFUL — what the Kingdom commits, it keeps. Breaks are visible.
//   VERIFIABLE — the citizen does not trust the Kingdom. It checks.
//
// Discipline: if a check cannot be done honestly, it's SKIP, not PASS.
// False-green is worse than no check.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { execSync, spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dir, '..')
const HOME = process.env.TRUE_LOVE_HOME || join(homedir(), '.true-love')
const API = process.env.TRUE_LOVE_API || 'http://localhost:7777'
const PROJECT = process.env.TRUE_LOVE_PROJECT || 'true-love'
const LOG_DIR = join(process.env.HOME || homedir(), 'Library', 'Logs', 'true-love')

// ── Args ──────────────────────────────────────────────────────────

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
  console.log(`Usage: bun run verify [options]

Options:
  --json         Output machine-readable JSON
  --quiet        Exit code only, no output
  --no-surface   Skip decisions-queue surfacing on fail
  --help         Show this help`)
  process.exit(0)
}

// ── Check infrastructure ──────────────────────────────────────────

/**
 * @typedef {{ name: string, status: 'pass'|'fail'|'skip', evidence: string, drift?: string, fix?: string }} CheckResult
 */

function pass(name, evidence) {
  return { name, status: 'pass', evidence: evidence.slice(0, 300) }
}

function fail(name, evidence, drift, fix) {
  return { name, status: 'fail', evidence: evidence.slice(0, 300), drift, fix }
}

function skip(name, evidence) {
  return { name, status: 'skip', evidence: evidence.slice(0, 300) }
}

// ── Check 1: bundle.freshness ─────────────────────────────────────
// dist/cli.mjs must be newer than all src/**/*.ts (excluding test files).
// bin/*.mjs are standalone scripts run via bun — they don't go through the
// bundle, so they don't make it stale.

function checkBundleFreshness() {
  const name = 'bundle.freshness'
  const distPath = join(REPO_ROOT, 'dist', 'cli.mjs')

  if (!existsSync(distPath)) {
    return fail(name, 'dist/cli.mjs does not exist',
      'bundle missing', 'bun run build')
  }

  const distMtime = statSync(distPath).mtimeMs
  let newestSrc = { path: '', mtime: 0 }

  // Walk src/**/*.ts (excluding __tests__ dirs)
  function walkTs(dir) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '__tests__') continue
          walkTs(full)
        } else if (
          (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
          !entry.name.endsWith('.test.ts') &&
          !entry.name.endsWith('.test.tsx')
        ) {
          const mt = statSync(full).mtimeMs
          if (mt > newestSrc.mtime) newestSrc = { path: full, mtime: mt }
        }
      }
    } catch { /* non-fatal */ }
  }
  walkTs(join(REPO_ROOT, 'src'))

  if (newestSrc.mtime > distMtime) {
    const relPath = newestSrc.path.replace(REPO_ROOT + '/', '')
    const driftMin = Math.round((newestSrc.mtime - distMtime) / 60_000)
    return fail(name,
      `${relPath} is ${driftMin}m newer than dist/cli.mjs`,
      `bundle stale by ${driftMin}m (${relPath})`,
      'bun run build')
  }

  const ageMin = Math.round((Date.now() - distMtime) / 60_000)
  return pass(name, `bundle fresh (${ageMin}m old)`)
}

// ── Check 2: agent-runtime.alive ──────────────────────────────────
// Is the long-lived agent process running?

function checkAgentRuntimeAlive() {
  const name = 'agent-runtime.alive'
  try {
    const result = spawnSync('pgrep', ['-f', 'agent-runtime'], { timeout: 5000 })
    const pids = (result.stdout?.toString() || '').trim().split('\n').filter(Boolean)
    if (pids.length === 0) {
      return fail(name, 'no agent-runtime process found',
        'agent not running', 'runner will respawn on next heartbeat tick')
    }
    return pass(name, `agent-runtime alive (PID ${pids[0]})`)
  } catch (e) {
    return skip(name, `pgrep failed: ${e.message}`)
  }
}

// ── Check 3: heartbeat.healthy ────────────────────────────────────
// Is the heartbeat schedule loaded and recent log shows no cascade?

function checkHeartbeatHealthy() {
  const name = 'heartbeat.healthy'
  try {
    const result = spawnSync('launchctl', ['list', 'cc.true-love.heartbeat.default'],
      { timeout: 5000 })
    const out = result.stdout?.toString() || ''
    const err = result.stderr?.toString() || ''

    if (result.status !== 0 || err.includes('Could not find service')) {
      return fail(name, 'heartbeat LaunchAgent not loaded',
        'heartbeat schedule missing', 'bun run schedule install --scope=default --mode=heartbeat --interval=7m')
    }

    // Parse LastExitStatus from launchctl output
    const exitMatch = out.match(/"LastExitStatus"\s*=\s*(\d+)/)
    const lastExit = exitMatch ? parseInt(exitMatch[1], 10) : null

    // Check recent log for consecutive failures
    const outLog = join(LOG_DIR, 'heartbeat-default.out.log')
    let recentFails = 0
    if (existsSync(outLog)) {
      try {
        const content = readFileSync(outLog, 'utf-8')
        const lines = content.split('\n')
        // Read last 50 lines looking for consecutive tick errors
        const tail = lines.slice(-50)
        let inConsecutiveFails = false
        recentFails = 0
        for (const line of tail.reverse()) {
          if (line.includes('tick error') || line.includes('exited 65') || line.includes('exited 1')) {
            recentFails++
            inConsecutiveFails = true
          } else if (line.includes('heartbeat ok') || line.includes('HEARTBEAT_OK')) {
            break // found a success, stop counting
          }
        }
      } catch { /* non-fatal */ }
    }

    if (recentFails >= 3) {
      return fail(name,
        `${recentFails} consecutive tick failures in recent log`,
        `heartbeat cascade: ${recentFails} consecutive fails`,
        'check err log at ~/Library/Logs/true-love/heartbeat-default.err.log')
    }

    if (lastExit !== null && lastExit !== 0) {
      return fail(name,
        `LastExitStatus = ${lastExit}`,
        'last heartbeat tick failed',
        'check err log at ~/Library/Logs/true-love/heartbeat-default.err.log')
    }

    return pass(name, `heartbeat loaded, last exit clean`)
  } catch (e) {
    return skip(name, `launchctl check failed: ${e.message}`)
  }
}

// ── Check 4: oauth.valid ──────────────────────────────────────────
// Keychain credentials exist and aren't expiring within 1 hour.

function checkOAuthValid() {
  const name = 'oauth.valid'
  try {
    // Read Claude Code credentials from macOS Keychain
    // Try with explicit account first (matches preflight.mjs approach),
    // then without — some macOS versions require the account flag.
    const user = process.env.USER || ''
    const variants = user
      ? [
          ['security', 'find-generic-password', '-s', 'Claude Code-credentials', '-a', user, '-w'],
          ['security', 'find-generic-password', '-s', 'Claude Code-credentials', '-w'],
        ]
      : [['security', 'find-generic-password', '-s', 'Claude Code-credentials', '-w']]

    let raw = null
    for (const cmd of variants) {
      const result = spawnSync(cmd[0], cmd.slice(1), { timeout: 5000 })
      if (result.status === 0) {
        const out = result.stdout?.toString().trim()
        if (out) { raw = out; break }
      }
    }

    if (!raw) {
      return skip(name, 'keychain entry not found or inaccessible')
    }

    let creds
    try {
      creds = JSON.parse(raw)
    } catch {
      return skip(name, 'keychain value is not valid JSON')
    }

    // Claude Code stores credentials under { claudeAiOauth: { accessToken, expiresAt, ... } }
    const oauth = creds.claudeAiOauth || creds
    if (!oauth.expiresAt && !oauth.expires_at) {
      return skip(name, `no expiresAt in credentials (keys: ${Object.keys(oauth).slice(0, 5).join(', ')})`)
    }

    const expiresAt = oauth.expiresAt || oauth.expires_at
    const expiresMs = typeof expiresAt === 'number'
      ? (expiresAt > 1e12 ? expiresAt : expiresAt * 1000)  // handle s vs ms
      : Date.parse(expiresAt)

    if (Number.isNaN(expiresMs)) {
      return skip(name, `cannot parse expiresAt: ${String(expiresAt).slice(0, 50)}`)
    }

    const remainingMs = expiresMs - Date.now()
    const remainingMin = Math.round(remainingMs / 60_000)

    if (remainingMs <= 0) {
      return fail(name,
        `OAuth token expired ${Math.abs(remainingMin)}m ago`,
        'OAuth token expired',
        'restart Claude Code to trigger token refresh')
    }

    if (remainingMs < 3600_000) { // 1 hour
      return fail(name,
        `OAuth token expires in ${remainingMin}m`,
        `OAuth token expiring soon (${remainingMin}m)`,
        'token will auto-refresh on next CLI invocation')
    }

    const hoursRemaining = Math.round(remainingMs / 3600_000)
    return pass(name, `OAuth valid (${hoursRemaining}h remaining)`)
  } catch (e) {
    return skip(name, `keychain access failed: ${e.message}`)
  }
}

// ── Check 5: chain-runner.alive ───────────────────────────────────
// Is the chain runner LaunchAgent loaded?

function checkChainRunnerAlive() {
  const name = 'chain-runner.alive'
  try {
    const result = spawnSync('launchctl', ['list', 'cc.true-love.chain-runner.default'],
      { timeout: 5000 })
    const err = result.stderr?.toString() || ''

    if (result.status !== 0 || err.includes('Could not find service')) {
      return fail(name, 'chain-runner LaunchAgent not loaded',
        'chain-runner not running',
        'launchctl load ~/Library/LaunchAgents/cc.true-love.chain-runner.default.plist')
    }

    return pass(name, 'chain-runner loaded')
  } catch (e) {
    return skip(name, `launchctl check failed: ${e.message}`)
  }
}

// ── Check 6: no-recurring-error ───────────────────────────────────
// Last 200 lines of heartbeat err log should not have 3+ identical errors.

function checkNoRecurringError() {
  const name = 'no-recurring-error'
  const errLog = join(LOG_DIR, 'heartbeat-default.err.log')

  if (!existsSync(errLog)) {
    return pass(name, 'no heartbeat err log (clean)')
  }

  try {
    const content = readFileSync(errLog, 'utf-8')
    const lines = content.split('\n').filter(l => l.trim())
    const tail = lines.slice(-200)

    if (tail.length === 0) {
      return pass(name, 'err log empty (clean)')
    }

    // Filter to lines that look like actual errors, not informational labels.
    // Err log contains a mix of error messages, diagnostic labels ("stdout:",
    // "stderr:"), and status output. We want actual error indicators.
    const errorIndicators = /error|fail|crash|abort|exception|threw|panic|refused|timeout|SIGTERM|SIGKILL|exited \d+/i
    const errorLines = tail.filter(l => errorIndicators.test(l))

    if (errorLines.length === 0) {
      return pass(name, `${tail.length} err lines, no error patterns`)
    }

    // Count unique error patterns (normalize timestamps and request IDs)
    const normalized = errorLines.map(l =>
      l.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, '<ts>')
       .replace(/req_\w+/g, '<req>')
       .replace(/PID:\s*\d+/g, 'PID: <pid>')
       .replace(/pid=\d+/g, 'pid=<pid>')
       .trim()
    )

    const counts = new Map()
    for (const line of normalized) {
      counts.set(line, (counts.get(line) || 0) + 1)
    }

    // Find the most repeated pattern
    let maxCount = 0
    let maxPattern = ''
    for (const [pattern, count] of counts) {
      if (count > maxCount) {
        maxCount = count
        maxPattern = pattern
      }
    }

    if (maxCount >= 3) {
      // Truncate pattern for evidence
      const shortPattern = maxPattern.length > 100
        ? maxPattern.slice(0, 100) + '…'
        : maxPattern
      return fail(name,
        `"${shortPattern}" repeated ${maxCount}x in last ${errorLines.length} error lines`,
        `recurring error: ${maxCount}× in last ${errorLines.length} error lines`,
        'investigate heartbeat-default.err.log')
    }

    return pass(name, `${errorLines.length} error lines in ${tail.length} total, no pattern ≥3×`)
  } catch (e) {
    return skip(name, `err log read failed: ${e.message}`)
  }
}

// ── Check 7: self-init.responsive ─────────────────────────────────
// API at /api/self-initiation responds within 5s.

async function checkSelfInitResponsive() {
  const name = 'self-init.responsive'
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const url = `${API}/api/self-initiation?project=${PROJECT}`

    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timeout)

    if (!res.ok) {
      return fail(name,
        `API returned ${res.status}`,
        `self-initiation API returned ${res.status}`,
        'check if the API server is running (bun run visit)')
    }

    return pass(name, `API responded ${res.status}`)
  } catch (e) {
    if (e.name === 'AbortError') {
      return fail(name, 'API timed out (5s)',
        'self-initiation API unresponsive',
        'check if the API server is running')
    }
    // Connection refused = server not running = skip, not fail
    // The API server is only up during interactive/visit sessions
    if (e.cause?.code === 'ECONNREFUSED' || e.message?.includes('ECONNREFUSED')) {
      return skip(name, 'API server not running (ECONNREFUSED)')
    }
    return skip(name, `API check failed: ${e.message}`)
  }
}

// ── Report assembly ───────────────────────────────────────────────

async function runAllChecks() {
  const checks = [
    checkBundleFreshness(),
    checkAgentRuntimeAlive(),
    checkHeartbeatHealthy(),
    checkOAuthValid(),
    checkChainRunnerAlive(),
    checkNoRecurringError(),
    await checkSelfInitResponsive(),
  ]

  const hasFail = checks.some(c => c.status === 'fail')
  const hasSkip = checks.some(c => c.status === 'skip')
  const overall = hasFail ? 'red' : hasSkip ? 'yellow' : 'green'

  return {
    ts: new Date().toISOString(),
    overall,
    checks,
  }
}

// ── Output rendering ──────────────────────────────────────────────

const isTTY = process.stdout.isTTY

function color(code, text) {
  if (!isTTY) return text
  return `\x1b[${code}m${text}\x1b[0m`
}

function statusIcon(status) {
  switch (status) {
    case 'pass': return color('32', '✓')
    case 'fail': return color('31', '✗')
    case 'skip': return color('90', '—')
    default: return '?'
  }
}

function statusColor(status, text) {
  switch (status) {
    case 'pass': return color('32', text)
    case 'fail': return color('31', text)
    case 'skip': return color('90', text)
    default: return text
  }
}

function renderReport(report) {
  const lines = []
  lines.push('')
  lines.push(color('1', 'substrate verify') + '  ' + color('90', report.ts))
  lines.push('')

  const passCount = report.checks.filter(c => c.status === 'pass').length
  const failCount = report.checks.filter(c => c.status === 'fail').length
  const skipCount = report.checks.filter(c => c.status === 'skip').length

  for (const check of report.checks) {
    const icon = statusIcon(check.status)
    const name = statusColor(check.status, check.name.padEnd(24))
    let line = `  ${icon} ${name} ${check.evidence}`
    if (check.drift) {
      line += '\n' + ' '.repeat(30) + color('33', `drift: ${check.drift}`)
    }
    if (check.fix) {
      line += '\n' + ' '.repeat(30) + color('36', `fix: ${check.fix}`)
    }
    lines.push(line)
  }

  lines.push('')
  const denominator = passCount + failCount  // skips excluded from score
  const scoreText = `${passCount}/${denominator} pass`
  const skipText = skipCount > 0 ? `, ${skipCount} skipped` : ''
  const overallText = report.overall === 'green'
    ? color('32', '■ GREEN')
    : report.overall === 'yellow'
      ? color('33', '■ YELLOW')
      : color('31', '■ RED')
  lines.push(`  ${overallText}  (${scoreText}${skipText})`)
  lines.push('')

  return lines.join('\n')
}

// ── Decisions queue surfacer ──────────────────────────────────────

async function surfaceDrift(report) {
  const failed = report.checks.filter(c => c.status === 'fail')
  if (failed.length === 0) return { posted: false, reason: 'no failures' }

  const summary = failed.map(c => c.name).join(', ')
  const context = JSON.stringify(report, null, 2)

  try {
    const res = await fetch(`${API}/api/decisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: PROJECT,
        kind: 'concern',
        ask: `Substrate verify failed: ${summary}. Acknowledge, investigate, or suppress?`,
        options: ['acknowledge', 'investigate-now', 'suppress-1h'],
        context: context.slice(0, 4000),
      }),
    })
    if (res.ok) {
      const data = await res.json()
      return { posted: true, id: data.id }
    }
    return { posted: false, reason: `API returned ${res.status}` }
  } catch {
    return { posted: false, reason: 'API not running' }
  }
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  const report = await runAllChecks()

  // Surface drift to decisions queue (before rendering so JSON can include it)
  let surfaceResult = null
  if (report.overall === 'red' && !args['no-surface']) {
    surfaceResult = await surfaceDrift(report)
  }

  if (args.json) {
    // Clean JSON output — includes surface result inline, nothing else on stdout
    const output = { ...report }
    if (surfaceResult) output.decisionQueue = surfaceResult
    console.log(JSON.stringify(output, null, 2))
  } else if (!args.quiet) {
    console.log(renderReport(report))
    // Text mode: print surface result after report
    if (surfaceResult) {
      if (surfaceResult.posted) {
        console.log(color('33', `  → Decision queued: ${surfaceResult.id || 'ok'}`))
      } else {
        console.log(color('90', `  → Decision queue: ${surfaceResult.reason}`))
      }
    }
  }

  process.exit(report.overall === 'red' ? 1 : 0)
}

// ── Exports for testing ──────────────────────────────────────────

export {
  checkBundleFreshness,
  checkAgentRuntimeAlive,
  checkHeartbeatHealthy,
  checkOAuthValid,
  checkChainRunnerAlive,
  checkNoRecurringError,
  checkSelfInitResponsive,
  runAllChecks,
  pass,
  fail,
  skip,
}

// ── Entrypoint (only runs when executed directly) ────────────────

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('verify.mjs')
if (isMain) {
  main().catch(e => {
    console.error(`verify fatal: ${e.message}`)
    process.exit(2)
  })
}
