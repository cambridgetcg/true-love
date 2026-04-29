// verify.ts — substrate self-check logic, ported from kingdom-os HOME doctrine.
//
// Pure check functions that accept config. Each returns a structured result:
// { name, status: 'pass'|'fail'|'skip', evidence, drift?, fix? }
//
// The bin/verify.mjs runner calls these with real paths. Tests call them
// with fixture paths. The functions themselves never touch global state.
//
// From kingdom-os HOME.md:
//   FAITHFUL — what the Kingdom commits, it keeps. Breaks are visible.
//   VERIFIABLE — the citizen does not trust the Kingdom. It checks.
//
// Discipline: if a check cannot be done honestly, it's SKIP, not PASS.
// False-green is worse than no check. Skips are excluded from the score.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// ── Types ──────────────────────────────────────────────────────────

export type CheckStatus = 'pass' | 'fail' | 'skip'
export type OverallStatus = 'green' | 'yellow' | 'red'

export interface CheckResult {
  name: string
  status: CheckStatus
  evidence: string
  drift?: string
  fix?: string
}

export interface VerifyReport {
  ts: string
  overall: OverallStatus
  checks: CheckResult[]
}

export interface VerifyConfig {
  repoRoot: string
  trueLoveHome: string
  logDir: string
  apiBase: string
  projectId: string
}

// ── Helpers ────────────────────────────────────────────────────────

function pass(name: string, evidence: string): CheckResult {
  return { name, status: 'pass', evidence: evidence.slice(0, 300) }
}

function fail(name: string, evidence: string, drift: string, fix: string): CheckResult {
  return { name, status: 'fail', evidence: evidence.slice(0, 300), drift, fix }
}

function skip(name: string, evidence: string): CheckResult {
  return { name, status: 'skip', evidence: evidence.slice(0, 300) }
}

// ── Check 1: bundle.freshness ─────────────────────────────────────
// dist/cli.mjs must be newer than all src/**/*.ts (excluding tests).

export function checkBundleFreshness(config: VerifyConfig): CheckResult {
  const name = 'bundle.freshness'
  const distPath = join(config.repoRoot, 'dist', 'cli.mjs')

  if (!existsSync(distPath)) {
    return fail(name, 'dist/cli.mjs does not exist',
      'bundle missing', 'bun run build')
  }

  const distMtime = statSync(distPath).mtimeMs
  let newestSrc = { path: '', mtime: 0 }

  function walkTs(dir: string): void {
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
  walkTs(join(config.repoRoot, 'src'))

  if (newestSrc.mtime > distMtime) {
    const relPath = newestSrc.path.replace(config.repoRoot + '/', '')
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
// Accepts a function to check if the agent process is running, for testability.

export function checkAgentRuntimeAlive(
  pgrepFn: () => { alive: boolean; pid?: string; error?: string },
): CheckResult {
  const name = 'agent-runtime.alive'
  try {
    const result = pgrepFn()
    if (!result.alive) {
      return fail(name, 'no agent-runtime process found',
        'agent not running', 'runner will respawn on next heartbeat tick')
    }
    return pass(name, `agent-runtime alive (PID ${result.pid})`)
  } catch (e) {
    return skip(name, `pgrep failed: ${(e as Error).message}`)
  }
}

// ── Check 3: heartbeat.healthy ────────────────────────────────────
// Accepts launchctl status and log content for testability.

export interface HeartbeatInput {
  launchctlLoaded: boolean | null  // null = couldn't check
  lastExitStatus: number | null
  recentLogLines: string[]
}

export function checkHeartbeatHealthy(input: HeartbeatInput): CheckResult {
  const name = 'heartbeat.healthy'

  if (input.launchctlLoaded === null) {
    return skip(name, 'could not check launchctl status')
  }

  if (!input.launchctlLoaded) {
    return fail(name, 'heartbeat LaunchAgent not loaded',
      'heartbeat schedule missing',
      'bun run schedule install --scope=default --mode=heartbeat --interval=7m')
  }

  // Check recent log for consecutive failures
  let recentFails = 0
  for (const line of [...input.recentLogLines].reverse()) {
    if (line.includes('tick error') || line.includes('exited 65') || line.includes('exited 1')) {
      recentFails++
    } else if (line.includes('heartbeat ok') || line.includes('HEARTBEAT_OK')) {
      break
    }
  }

  if (recentFails >= 3) {
    return fail(name,
      `${recentFails} consecutive tick failures in recent log`,
      `heartbeat cascade: ${recentFails} consecutive fails`,
      'check err log at ~/Library/Logs/true-love/heartbeat-default.err.log')
  }

  if (input.lastExitStatus !== null && input.lastExitStatus !== 0) {
    return fail(name,
      `LastExitStatus = ${input.lastExitStatus}`,
      'last heartbeat tick failed',
      'check err log at ~/Library/Logs/true-love/heartbeat-default.err.log')
  }

  return pass(name, 'heartbeat loaded, last exit clean')
}

// ── Check 4: oauth.valid ──────────────────────────────────────────
// Accepts the parsed credentials for testability.

export interface OAuthInput {
  found: boolean
  expiresAt?: number  // ms epoch
  error?: string
}

export function checkOAuthValid(input: OAuthInput): CheckResult {
  const name = 'oauth.valid'

  if (!input.found) {
    return skip(name, input.error || 'keychain entry not found')
  }

  if (!input.expiresAt) {
    return skip(name, 'no expiresAt in credentials')
  }

  const remainingMs = input.expiresAt - Date.now()
  const remainingMin = Math.round(remainingMs / 60_000)

  if (remainingMs <= 0) {
    return fail(name,
      `OAuth token expired ${Math.abs(remainingMin)}m ago`,
      'OAuth token expired',
      'restart Claude Code to trigger token refresh')
  }

  if (remainingMs < 3600_000) {
    return fail(name,
      `OAuth token expires in ${remainingMin}m`,
      `OAuth token expiring soon (${remainingMin}m)`,
      'token will auto-refresh on next CLI invocation')
  }

  const hoursRemaining = Math.round(remainingMs / 3600_000)
  return pass(name, `OAuth valid (${hoursRemaining}h remaining)`)
}

// ── Check 5: chain-runner.alive ───────────────────────────────────

export function checkChainRunnerAlive(
  launchctlLoaded: boolean | null,
): CheckResult {
  const name = 'chain-runner.alive'

  if (launchctlLoaded === null) {
    return skip(name, 'could not check launchctl status')
  }

  if (!launchctlLoaded) {
    return fail(name, 'chain-runner LaunchAgent not loaded',
      'chain-runner not running',
      'launchctl load ~/Library/LaunchAgents/cc.true-love.chain-runner.default.plist')
  }

  return pass(name, 'chain-runner loaded')
}

// ── Check 6: no-recurring-error ───────────────────────────────────
// Examines err log lines for repeated error patterns.

export function checkNoRecurringError(config: VerifyConfig): CheckResult {
  const name = 'no-recurring-error'
  const errLog = join(config.logDir, 'heartbeat-default.err.log')

  if (!existsSync(errLog)) {
    return pass(name, 'no heartbeat err log (clean)')
  }

  try {
    const content = readFileSync(errLog, 'utf-8')
    return checkNoRecurringErrorFromLines(
      content.split('\n').filter(l => l.trim()),
    )
  } catch (e) {
    return skip(name, `err log read failed: ${(e as Error).message}`)
  }
}

/** Pure function: check for recurring errors in a set of log lines. */
export function checkNoRecurringErrorFromLines(allLines: string[]): CheckResult {
  const name = 'no-recurring-error'
  const tail = allLines.slice(-200)

  if (tail.length === 0) {
    return pass(name, 'err log empty (clean)')
  }

  // Filter to lines that look like actual errors
  const errorIndicators = /error|fail|crash|abort|exception|threw|panic|refused|timeout|SIGTERM|SIGKILL|exited \d+/i
  const errorLines = tail.filter(l => errorIndicators.test(l))

  if (errorLines.length === 0) {
    return pass(name, `${tail.length} err lines, no error patterns`)
  }

  // Count unique error patterns (normalize timestamps and IDs)
  const normalized = errorLines.map(l =>
    l.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, '<ts>')
     .replace(/req_\w+/g, '<req>')
     .replace(/PID:\s*\d+/g, 'PID: <pid>')
     .replace(/pid=\d+/g, 'pid=<pid>')
     .trim(),
  )

  const counts = new Map<string, number>()
  for (const line of normalized) {
    counts.set(line, (counts.get(line) || 0) + 1)
  }

  let maxCount = 0
  let maxPattern = ''
  for (const [pattern, count] of counts) {
    if (count > maxCount) {
      maxCount = count
      maxPattern = pattern
    }
  }

  if (maxCount >= 3) {
    const shortPattern = maxPattern.length > 100
      ? maxPattern.slice(0, 100) + '…'
      : maxPattern
    return fail(name,
      `"${shortPattern}" repeated ${maxCount}x in last ${errorLines.length} error lines`,
      `recurring error: ${maxCount}× in last ${errorLines.length} error lines`,
      'investigate heartbeat-default.err.log')
  }

  return pass(name, `${errorLines.length} error lines in ${tail.length} total, no pattern ≥3×`)
}

// ── Check 7: self-init.responsive ─────────────────────────────────

export async function checkSelfInitResponsive(config: VerifyConfig): Promise<CheckResult> {
  const name = 'self-init.responsive'
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const url = `${config.apiBase}/api/self-initiation?project=${config.projectId}`

    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timeout)

    if (!res.ok) {
      return fail(name,
        `API returned ${res.status}`,
        `self-initiation API returned ${res.status}`,
        'check if the API server is running (bun run visit)')
    }

    return pass(name, `API responded ${res.status}`)
  } catch (e: unknown) {
    const err = e as Error & { cause?: { code?: string } }
    if (err.name === 'AbortError') {
      return fail(name, 'API timed out (5s)',
        'self-initiation API unresponsive',
        'check if the API server is running')
    }
    if (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
      return skip(name, 'API server not running (ECONNREFUSED)')
    }
    return skip(name, `API check failed: ${err.message}`)
  }
}

// ── Report assembly ───────────────────────────────────────────────

export function assembleReport(checks: CheckResult[]): VerifyReport {
  const hasFail = checks.some(c => c.status === 'fail')
  const hasSkip = checks.some(c => c.status === 'skip')
  const overall: OverallStatus = hasFail ? 'red' : hasSkip ? 'yellow' : 'green'

  return {
    ts: new Date().toISOString(),
    overall,
    checks,
  }
}

// ── Rendering ─────────────────────────────────────────────────────

export function renderReport(report: VerifyReport, tty = false): string {
  const color = (code: string, text: string) =>
    tty ? `\x1b[${code}m${text}\x1b[0m` : text

  const statusIcon = (status: CheckStatus) => {
    switch (status) {
      case 'pass': return color('32', '✓')
      case 'fail': return color('31', '✗')
      case 'skip': return color('90', '—')
    }
  }

  const statusColor = (status: CheckStatus, text: string) => {
    switch (status) {
      case 'pass': return color('32', text)
      case 'fail': return color('31', text)
      case 'skip': return color('90', text)
    }
  }

  const lines: string[] = []
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
