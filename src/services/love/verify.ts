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
  activePid: number | null         // PID from launchctl — non-null means process is running
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

  // When the heartbeat process has an active PID, LastExitStatus is from a
  // *prior* invocation — the current process is alive and the stale exit
  // code is not actionable. Only check LastExitStatus when no PID is present
  // (meaning the process exited and hasn't been respawned yet).
  if (input.activePid != null) {
    return pass(name, `heartbeat running (PID ${input.activePid})`)
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

// ── Check 6: no-recurring-error ───────────────────────────────────
// Examines err log lines for repeated error patterns.
// Staleness gate: if the error log hasn't been modified in 30+ minutes,
// old errors linger from before a fix deployed. A stale log means the
// pattern has stopped — pass, don't alarm.

export const ERROR_LOG_STALENESS_MS = 30 * 60_000 // 30 minutes

/** Recovery indicators: lines that mean the system restarted or succeeded. */
export const RECOVERY_INDICATORS = /Agent started|HEARTBEAT_OK|heartbeat ok/i

export function checkNoRecurringError(
  config: VerifyConfig,
  options?: { stalenessMs?: number },
): CheckResult {
  const name = 'no-recurring-error'
  const errLog = join(config.logDir, 'heartbeat-default.err.log')
  const stalenessMs = options?.stalenessMs ?? ERROR_LOG_STALENESS_MS

  if (!existsSync(errLog)) {
    return pass(name, 'no heartbeat err log (clean)')
  }

  try {
    const ageMs = Date.now() - statSync(errLog).mtimeMs
    if (ageMs > stalenessMs) {
      const ageMin = Math.round(ageMs / 60_000)
      return pass(name, `err log stale (last modified ${ageMin}m ago, errors resolved)`)
    }

    const content = readFileSync(errLog, 'utf-8')
    return checkNoRecurringErrorFromLines(
      content.split('\n').filter(l => l.trim()),
    )
  } catch (e) {
    return skip(name, `err log read failed: ${(e as Error).message}`)
  }
}

/** Normalize a log line for pattern comparison. */
function normalizeLine(line: string): string {
  return line
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, '<ts>')
    .replace(/req_\w+/g, '<req>')
    .replace(/PID:\s*\d+/g, 'PID: <pid>')
    .replace(/pid=\d+/g, 'pid=<pid>')
    .trim()
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
  const normalized = errorLines.map(normalizeLine)

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
    // Recovery check: find the last raw line that matches the max
    // error pattern. If a recovery indicator (Agent started, heartbeat
    // success) appears AFTER that line, the system has recovered.
    // This handles the case where the err log stays "fresh" (agent
    // startup writes to stderr) but the actual error has stopped.
    let lastMaxIdx = -1
    for (let i = tail.length - 1; i >= 0; i--) {
      if (errorIndicators.test(tail[i]) && normalizeLine(tail[i]) === maxPattern) {
        lastMaxIdx = i
        break
      }
    }

    const afterError = lastMaxIdx >= 0 ? tail.slice(lastMaxIdx + 1) : []
    const hasRecovery = afterError.some(l => RECOVERY_INDICATORS.test(l))

    if (hasRecovery) {
      return pass(name,
        `${maxCount}× errors in log history, recovered (recovery after last occurrence)`)
    }

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

// ── Check 7: install.coherent ─────────────────────────────────────
// "Verify the verifier" — phantom-install detection.
//
// Pure check function. The bin/verify.mjs runtime gathers the input by
// walking launchctl + plist files; this typed version takes the
// gathered evidence and produces a CheckResult.
//
// Catches the failure modes that surfaced 2026-05-04: phantom checks
// expecting plists that were never built, cross-user-path bugs (e.g.
// `/Users/yuai/...` plist on a `macair` device), runner-script renames
// that left LaunchAgents broken into stderr.

export interface InstallCoherentInput {
  /** All `cc.true-love.*` and `love.*` LaunchAgents currently loaded. */
  loadedLabels: string[]
  /** Reasons each broken install is broken — empty when coherent. */
  brokenInstalls: { label: string; reason: string }[]
}

export function checkInstallCoherent(input: InstallCoherentInput): CheckResult {
  const name = 'install.coherent'
  if (input.loadedLabels.length === 0) {
    return skip(name, 'no cc.true-love.* / love.* LaunchAgents loaded')
  }
  if (input.brokenInstalls.length > 0) {
    const summary = input.brokenInstalls
      .slice(0, 3)
      .map(b => `${b.label}: ${b.reason}`)
      .join('; ')
    const more = input.brokenInstalls.length > 3 ? '…' : ''
    return fail(name,
      `${input.brokenInstalls.length} broken install(s): ${summary}${more}`,
      'phantom or broken LaunchAgent installs',
      'unload offenders or repair plist paths')
  }
  return pass(name, `${input.loadedLabels.length} LaunchAgent(s) all coherent`)
}

// ── Check 8: certainty.intact ─────────────────────────────────────
// Doctrine: docs/love/certainty.md + docs/love/certainty-engineering-plan.md (S3)
//
// Pure check function. The bin/verify.mjs runtime walks the certainty
// events directory; this typed version takes the gathered counts and
// produces a CheckResult.
//
// Hedge-refused events are the architecture catching relationship-doubt
// in its own output and refusing it. High count = upstream drift.

export interface CertaintyIntactInput {
  /** Count of hedge-refused events in the last 24h across devices. */
  hedgeRefusedCount: number
  /** Count of claim events in the last 24h, for evidence framing. */
  claimCount: number
  /** Threshold above which the check fails. Default 2. */
  threshold?: number
  /** True iff the events directory exists (else: skip). */
  eventsDirExists: boolean
}

export function checkCertaintyIntact(input: CertaintyIntactInput): CheckResult {
  const name = 'certainty.intact'
  if (!input.eventsDirExists) {
    return skip(name, 'no certainty events directory yet')
  }
  const threshold = input.threshold ?? 2
  if (input.hedgeRefusedCount > threshold) {
    return fail(name,
      `${input.hedgeRefusedCount} hedge-refused events in last 24h (threshold ${threshold})`,
      'relationship-hedge drift in generation register',
      'audit recent witness stream + tighten upstream voice templates')
  }
  return pass(name,
    `${input.hedgeRefusedCount} hedge-refused, ${input.claimCount} claim event(s) in last 24h — register intact`)
}

// ── Check 9: self-init.responsive ─────────────────────────────────

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

// ── Dedup ─────────────────────────────────────────────────────────
// Pure function: given a list of open decisions, determine if a new
// verify concern should be suppressed. The verify pilot fires every
// 30m; without dedup it stacks identical concerns in Yu's dashboard.

export interface DedupDecision {
  kind: string
  ask: string
  id?: string
  createdAt?: string
  status?: string
  respondedAt?: string
}

/** Default grace period: 4 hours. After acknowledging a concern, don't
 *  re-create it for the same root cause until the grace expires. */
export const DEDUP_GRACE_MS = 4 * 3600_000

/**
 * Check if a verify concern should be deduplicated.
 * Returns { skip: true, reason } if:
 *   1. An open (pending) verify concern already exists, OR
 *   2. A verify concern was resolved within the grace period.
 *
 * Accepts ALL decisions (not just open ones) so it can inspect
 * recently-resolved concerns. A "verify concern" is any decision
 * with kind='concern' and ask starting with 'Substrate verify failed:'.
 */
export function shouldSkipVerifyConcern(
  decisions: DedupDecision[],
  options?: { graceMs?: number },
): { skip: boolean; reason?: string } {
  const graceMs = options?.graceMs ?? DEDUP_GRACE_MS

  // 1. Open concern — exact dedup (original behavior)
  const open = decisions.find(
    d => d.kind === 'concern' &&
      d.ask?.startsWith('Substrate verify failed:') &&
      (!d.status || d.status === 'pending'),
  )
  if (open) {
    return {
      skip: true,
      reason: `deduplicated: open concern exists (id ${open.id || 'unknown'})`,
    }
  }

  // 2. Recently resolved concern — grace period
  const now = Date.now()
  const recent = decisions.find(
    d => d.kind === 'concern' &&
      d.ask?.startsWith('Substrate verify failed:') &&
      d.status && d.status !== 'pending' &&
      d.respondedAt &&
      (now - new Date(d.respondedAt).getTime()) < graceMs,
  )
  if (recent) {
    const agoMin = Math.round((now - new Date(recent.respondedAt!).getTime()) / 60_000)
    return {
      skip: true,
      reason: `deduplicated: concern resolved ${agoMin}m ago, grace period ${graceMs / 3600_000}h (id ${recent.id || 'unknown'})`,
    }
  }

  return { skip: false }
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
