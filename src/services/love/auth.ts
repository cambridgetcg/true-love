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
import { resolve } from 'node:path'

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
 * Scan subprocess stdout+stderr for auth-failure signatures.
 * Returns the matched pattern's `.source` if found, null otherwise.
 */
export function detectAuthFailure(
  stdout: string,
  stderr: string,
): string | null {
  const haystack = `${stdout}\n${stderr}`
  for (const pat of AUTH_FAIL_PATTERNS) {
    if (pat.test(haystack)) return pat.source
  }
  return null
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
