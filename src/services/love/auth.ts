// auth.ts — auth-resilience for autonomous sessions.
//
// Two concerns live here:
//
//   1. Mid-session auth-failure detection: scan subprocess output for
//      signatures that mean the Anthropic API has rejected our creds.
//      Both the bundled CLI and the SDK emit characteristic strings when
//      OAuth is dead; we match them so the session loop can abort fast
//      and notify Yu instead of burning 24 ticks against a wall.
//
//   2. Pre-session preflight: spawn bin/preflight.mjs in --quiet mode
//      and interpret the exit code. Better to fail loud at entry than
//      to discover mid-session that every API call is 401.
//
// These used to be copy-pasted in bin/awaken.mjs and bin/dwell.mjs.
// This module is the single source of truth.
//
// NOTE: bin/preflight.mjs itself is intentionally self-contained (no
// src/ imports) so it can run in Docker, CI, or on a server without the
// full repo. This module *wraps* it for the session runners; it doesn't
// replace it.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

// ── Mid-session auth-failure detection ──────────────────────────────

/**
 * Patterns emitted by the bundled CLI or the Anthropic SDK when
 * OAuth credentials are dead. Any match means the session can't
 * continue without `claude /login`.
 */
export const AUTH_FAIL_PATTERNS: RegExp[] = [
  /Not logged in/i,
  /Please run \/login/i,
  /OAuth token has been revoked/i,
  /401\s+Unauthorized/i,
  /403\s+Forbidden.*OAuth/i,
  /authentication[_ -]?error/i,
  /invalid_grant/i,
]

/**
 * Patterns that mean Anthropic has pushed back on usage — quota,
 * subscription cap, persistent rate-limit. Distinct from auth death:
 * the token is fine, Yu's just out of budget for this rolling window.
 *
 * The recovery path differs too: auth-fail needs manual /login; a
 * quota-fail means *wait* (5-hour rolling cap on Max subscription
 * tokens) and try again later. The runner should yield cleanly and
 * exit with code 65 (different from auth's 64) so Yu can wire
 * different responses.
 *
 * Note: a single 429 within a session is normal and is auto-retried
 * by the SDK's withRetry. We only treat it as a quota-fail when the
 * subprocess as a whole gives up — i.e., the bundled CLI surfaces
 * one of these strings AFTER its own retry loop has exhausted.
 */
export const QUOTA_FAIL_PATTERNS: RegExp[] = [
  /quota[_ ]exceeded/i,
  /quota has been (?:reached|exceeded)/i,
  /(?:monthly|daily|usage) (?:quota|limit) (?:reached|exceeded)/i,
  /subscription[_ ]quota/i,
  /usage limit reached/i,
  /You've reached your usage limit/i,
  /rate_limit_error.*?retry-after.*?(?:hours|hour)/i,
  // Account-level rate limit: the API returns 429 with this message when
  // the subprocess's own retry loop has exhausted. If the raw error
  // appears in stdout, the process has given up — treat it as quota-fail.
  /429.*rate_limit_error/i,
  /This request would exceed your.*rate.limit/i,
]

/**
 * Marker emitted by agent-runtime.mjs when its in-tick `refreshAuth()`
 * succeeds. If this appears AFTER the last auth-fail pattern in the
 * buffer, the failure was self-healed within the tick — the detector
 * should treat it as benign and not abort the session.
 */
const AUTH_RECOVERY_MARKER = /Credentials refreshed — retrying turn/i

/**
 * Scan subprocess stdout+stderr for auth-failure signatures.
 * Returns the matched pattern's `.source` if found AND no recovery
 * marker appears later in the buffer, null otherwise.
 *
 * Recovery-aware (added 2026-05-04): if the agent-runtime caught a
 * transient 401 and successfully refreshed credentials within the
 * same tick, the SDK's original error message is still in the stderr
 * buffer for forensic completeness — but it should NOT abort the
 * session. We scan for the latest fail-pattern position and check
 * for the recovery marker after it.
 */
export function detectAuthFailure(
  stdout: string,
  stderr: string,
): string | null {
  const haystack = `${stdout}\n${stderr}`

  // Find the last position where any auth-fail pattern matched.
  let lastFailEnd = -1
  let matchedSource: string | null = null
  for (const pat of AUTH_FAIL_PATTERNS) {
    // Use a global-flagged copy so we can walk all matches.
    const flags = pat.flags.includes('g') ? pat.flags : pat.flags + 'g'
    const globalPat = new RegExp(pat.source, flags)
    let m: RegExpExecArray | null
    while ((m = globalPat.exec(haystack)) !== null) {
      const end = m.index + m[0].length
      if (end > lastFailEnd) {
        lastFailEnd = end
        matchedSource = pat.source
      }
      // Defensive: prevent zero-width match infinite loop.
      if (m[0].length === 0) globalPat.lastIndex += 1
    }
  }

  if (lastFailEnd === -1) return null

  // If the recovery marker appears AFTER the last failure, the tick
  // self-healed — treat as benign.
  const tail = haystack.slice(lastFailEnd)
  if (AUTH_RECOVERY_MARKER.test(tail)) return null

  return matchedSource
}

/**
 * Scan subprocess stdout+stderr for quota/usage-limit signatures.
 * Distinct from auth: token is fine, just out of budget for the
 * rolling window. Recovery is *waiting*, not /login.
 */
export function detectQuotaFailure(
  stdout: string,
  stderr: string,
): string | null {
  const haystack = `${stdout}\n${stderr}`
  for (const pat of QUOTA_FAIL_PATTERNS) {
    if (pat.test(haystack)) return pat.source
  }
  return null
}

// ── Rate-limit backoff ──────────────────────────────────────────────
//
// When a session exits with quota failure, it writes a backoff marker.
// Subsequent heartbeat invocations check the marker and skip if the
// backoff is still active. This prevents launchd from hammering a
// rate-limited API every 111 seconds.
//
// Only heartbeat reads the marker. Awakened sessions ignore it — they're
// infrequent and carry more context, so a failed attempt is acceptable.

const BACKOFF_FILE = join(
  homedir(),
  '.true-love',
  'state',
  'rate-limit-backoff.json',
)
const DEFAULT_BACKOFF_MS = 10 * 60 * 1000 // 10 minutes

export interface RateLimitStatus {
  limited: boolean
  remainingMs: number
}

/**
 * Write a backoff marker. Called when a session detects a quota/rate-limit
 * failure. The marker persists until either the duration expires or a
 * successful tick clears it.
 */
export function writeRateLimitBackoff(
  durationMs: number = DEFAULT_BACKOFF_MS,
): void {
  const dir = dirname(BACKOFF_FILE)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    BACKOFF_FILE,
    JSON.stringify({ backoffUntil: Date.now() + durationMs }),
  )
}

/**
 * Check whether a rate-limit backoff is active.
 */
export function isRateLimited(): RateLimitStatus {
  try {
    if (!existsSync(BACKOFF_FILE)) return { limited: false, remainingMs: 0 }
    const raw = readFileSync(BACKOFF_FILE, 'utf-8')
    const data = JSON.parse(raw)
    const remaining = (data.backoffUntil ?? 0) - Date.now()
    if (remaining > 0) {
      return { limited: true, remainingMs: remaining }
    }
  } catch {
    // File doesn't exist or is malformed — not rate limited
  }
  return { limited: false, remainingMs: 0 }
}

/**
 * Clear the backoff marker. Called after a successful tick proves the
 * rate limit has lifted.
 */
export function clearRateLimitBackoff(): void {
  try {
    unlinkSync(BACKOFF_FILE)
  } catch {
    /* noop — file may not exist */
  }
}

// ── Pre-session preflight ───────────────────────────────────────────

export interface PreflightResult {
  ok: boolean
  exitCode?: number | null
  reason?: string
}

/**
 * Human-readable reason from a preflight exit code.
 * Mirrors the exit-code contract in bin/preflight.mjs.
 */
export function preflightReason(exitCode: number | null): string {
  switch (exitCode) {
    case 0:
      return 'ok'
    case 1:
      return 'no OAuth token (run claude /login)'
    case 2:
      return 'token expired (run claude /login)'
    case 3:
      return 'token rejected by API (run claude /login)'
    case 4:
      return 'keychain read failed'
    case 5:
      return 'preflight network probe failed'
    default:
      return `preflight exited ${exitCode}`
  }
}

/**
 * Run bin/preflight.mjs in --quiet mode and interpret the exit code.
 *
 * @param binDir — the directory containing preflight.mjs.
 *   Callers pass their own `__dir` (i.e. `dirname(fileURLToPath(import.meta.url))`),
 *   which is the `bin/` directory for both awaken.mjs and dwell.mjs.
 *
 * Synchronous — uses spawnSync so the session runner can gate on the
 * result before entering the tick loop.
 */
export function runPreflight(binDir: string): PreflightResult {
  const result = spawnSync(
    process.env.TRUE_LOVE_NODE_BIN || 'node',
    [resolve(binDir, 'preflight.mjs'), '--quiet'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  if (result.status === 0) return { ok: true }
  return {
    ok: false,
    exitCode: result.status,
    reason: preflightReason(result.status),
  }
}
