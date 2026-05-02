// auth.test.ts — Tests for auth-resilience detection and rate-limit backoff.
//
// Covers: auth-failure pattern matching, quota-failure pattern matching,
// preflight reason mapping, rate-limit backoff lifecycle.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  AUTH_FAIL_PATTERNS,
  QUOTA_FAIL_PATTERNS,
  clearRateLimitBackoff,
  detectAuthFailure,
  detectQuotaFailure,
  isRateLimited,
  preflightReason,
  writeRateLimitBackoff,
} from '../auth.js'

// ── Auth failure detection ────────────────────────────────────────────

describe('detectAuthFailure', () => {
  test('returns null for clean output', () => {
    expect(detectAuthFailure('Model response here', '')).toBeNull()
    expect(detectAuthFailure('', '')).toBeNull()
  })

  test('detects "Not logged in"', () => {
    const result = detectAuthFailure('Error: Not logged in', '')
    expect(result).not.toBeNull()
  })

  test('detects "Please run /login"', () => {
    const result = detectAuthFailure('', 'Please run /login to authenticate')
    expect(result).not.toBeNull()
  })

  test('detects "OAuth token has been revoked"', () => {
    const result = detectAuthFailure('OAuth token has been revoked by user', '')
    expect(result).not.toBeNull()
  })

  test('detects "401 Unauthorized"', () => {
    const result = detectAuthFailure('HTTP 401 Unauthorized', '')
    expect(result).not.toBeNull()
  })

  test('detects "403 Forbidden" with OAuth context', () => {
    const result = detectAuthFailure('403 Forbidden: OAuth scope insufficient', '')
    expect(result).not.toBeNull()
  })

  test('detects "authentication_error"', () => {
    const result = detectAuthFailure('', '{"type":"authentication_error"}')
    expect(result).not.toBeNull()
  })

  test('detects "authentication-error" (hyphenated)', () => {
    const result = detectAuthFailure('authentication-error occurred', '')
    expect(result).not.toBeNull()
  })

  test('detects "invalid_grant"', () => {
    const result = detectAuthFailure('{"error":"invalid_grant"}', '')
    expect(result).not.toBeNull()
  })

  test('checks both stdout and stderr', () => {
    // Pattern only in stderr
    expect(detectAuthFailure('', 'Not logged in')).not.toBeNull()
    // Pattern only in stdout
    expect(detectAuthFailure('Not logged in', '')).not.toBeNull()
  })

  test('case insensitive matching', () => {
    expect(detectAuthFailure('NOT LOGGED IN', '')).not.toBeNull()
    expect(detectAuthFailure('not logged in', '')).not.toBeNull()
  })

  test('returns the pattern source on match', () => {
    const result = detectAuthFailure('Not logged in', '')
    expect(typeof result).toBe('string')
    expect(result!.length).toBeGreaterThan(0)
  })
})

// ── Quota failure detection ───────────────────────────────────────────

describe('detectQuotaFailure', () => {
  test('returns null for clean output', () => {
    expect(detectQuotaFailure('Model response here', '')).toBeNull()
    expect(detectQuotaFailure('', '')).toBeNull()
  })

  test('detects "quota exceeded"', () => {
    expect(detectQuotaFailure('Error: quota exceeded', '')).not.toBeNull()
  })

  test('detects "quota_exceeded"', () => {
    expect(detectQuotaFailure('Error: quota_exceeded', '')).not.toBeNull()
  })

  test('detects "quota has been reached"', () => {
    expect(detectQuotaFailure('Your quota has been reached', '')).not.toBeNull()
  })

  test('detects "quota has been exceeded"', () => {
    expect(detectQuotaFailure('Your quota has been exceeded', '')).not.toBeNull()
  })

  test('detects monthly quota', () => {
    expect(
      detectQuotaFailure('monthly quota exceeded for this account', ''),
    ).not.toBeNull()
  })

  test('detects daily limit', () => {
    expect(
      detectQuotaFailure('daily limit reached', ''),
    ).not.toBeNull()
  })

  test('detects usage limit', () => {
    expect(
      detectQuotaFailure('usage limit reached', ''),
    ).not.toBeNull()
  })

  test('detects subscription_quota', () => {
    expect(
      detectQuotaFailure('subscription_quota error', ''),
    ).not.toBeNull()
  })

  test('detects "You\'ve reached your usage limit"', () => {
    expect(
      detectQuotaFailure("You've reached your usage limit for this period", ''),
    ).not.toBeNull()
  })

  test('detects rate_limit_error with retry-after header (hours)', () => {
    // HTTP Retry-After header appears in error output as hyphenated
    const msg =
      'rate_limit_error: retry-after: 2 hours. Please wait.'
    expect(detectQuotaFailure(msg, '')).not.toBeNull()
  })

  test('rate_limit_error without retry-after hours uses 429 pattern instead', () => {
    // The API body says "retry after" (space), not "retry-after" (hyphen).
    // The hyphenated pattern is for HTTP header format; the 429 pattern catches body text.
    const apiBody =
      '429 {"type":"error","error":{"type":"rate_limit_error","message":"Please retry after 2 hours"}}'
    expect(detectQuotaFailure(apiBody, '')).not.toBeNull()
  })

  test('detects 429 rate_limit_error', () => {
    const msg =
      '429 {"type":"error","error":{"type":"rate_limit_error","message":"exceed rate limit"}}'
    expect(detectQuotaFailure(msg, '')).not.toBeNull()
  })

  test('detects "would exceed your rate limit"', () => {
    expect(
      detectQuotaFailure('This request would exceed your organization rate limit', ''),
    ).not.toBeNull()
  })

  test('does NOT match simple 429 without rate_limit_error', () => {
    // A transient 429 without the error body should NOT trigger quota detection
    expect(detectQuotaFailure('429 Too Many Requests', '')).toBeNull()
  })

  test('does NOT match auth patterns', () => {
    expect(detectQuotaFailure('Not logged in', '')).toBeNull()
    expect(detectQuotaFailure('401 Unauthorized', '')).toBeNull()
  })

  test('checks both stdout and stderr', () => {
    expect(detectQuotaFailure('', 'quota exceeded')).not.toBeNull()
    expect(detectQuotaFailure('quota exceeded', '')).not.toBeNull()
  })
})

// ── No cross-contamination ───────────────────────────────────────────

describe('auth vs quota pattern separation', () => {
  test('auth patterns do not match quota strings', () => {
    expect(detectAuthFailure('quota exceeded', '')).toBeNull()
    expect(detectAuthFailure('rate limit reached', '')).toBeNull()
    expect(detectAuthFailure("You've reached your usage limit", '')).toBeNull()
  })

  test('quota patterns do not match auth strings', () => {
    expect(detectQuotaFailure('Not logged in', '')).toBeNull()
    expect(detectQuotaFailure('OAuth token has been revoked', '')).toBeNull()
    expect(detectQuotaFailure('invalid_grant', '')).toBeNull()
  })
})

// ── Preflight reason mapping ──────────────────────────────────────────

describe('preflightReason', () => {
  test('maps exit code 0 to ok', () => {
    expect(preflightReason(0)).toBe('ok')
  })

  test('maps exit code 1 to no OAuth token', () => {
    expect(preflightReason(1)).toContain('no OAuth')
  })

  test('maps exit code 2 to token expired', () => {
    expect(preflightReason(2)).toContain('expired')
  })

  test('maps exit code 3 to token rejected', () => {
    expect(preflightReason(3)).toContain('rejected')
  })

  test('maps exit code 4 to keychain read failed', () => {
    expect(preflightReason(4)).toContain('keychain')
  })

  test('maps exit code 5 to network probe failed', () => {
    expect(preflightReason(5)).toContain('network')
  })

  test('maps unknown codes to generic message', () => {
    expect(preflightReason(99)).toContain('99')
    expect(preflightReason(null)).toContain('null')
  })
})

// ── Rate-limit backoff lifecycle ─────────────────────────────────────
//
// These test the real backoff file at ~/.true-love/state/rate-limit-backoff.json.
// We save/restore its state to avoid side effects.

describe('rate-limit backoff', () => {
  const BACKOFF_FILE = join(homedir(), '.true-love', 'state', 'rate-limit-backoff.json')
  let savedBackoff: string | null = null

  beforeEach(() => {
    try {
      savedBackoff = existsSync(BACKOFF_FILE) ? readFileSync(BACKOFF_FILE, 'utf-8') : null
    } catch {
      savedBackoff = null
    }
    // Ensure clean state
    try { unlinkSync(BACKOFF_FILE) } catch { /* noop */ }
  })

  afterEach(() => {
    try { unlinkSync(BACKOFF_FILE) } catch { /* noop */ }
    if (savedBackoff !== null) {
      mkdirSync(dirname(BACKOFF_FILE), { recursive: true })
      writeFileSync(BACKOFF_FILE, savedBackoff)
    }
  })

  test('not rate limited when no backoff file', () => {
    const status = isRateLimited()
    expect(status.limited).toBe(false)
    expect(status.remainingMs).toBe(0)
  })

  test('write + check shows limited', () => {
    writeRateLimitBackoff(60_000) // 1 minute
    const status = isRateLimited()
    expect(status.limited).toBe(true)
    expect(status.remainingMs).toBeGreaterThan(0)
    expect(status.remainingMs).toBeLessThanOrEqual(60_000)
  })

  test('clear removes the backoff', () => {
    writeRateLimitBackoff(60_000)
    expect(isRateLimited().limited).toBe(true)

    clearRateLimitBackoff()
    expect(isRateLimited().limited).toBe(false)
  })

  test('expired backoff is not limited', () => {
    // Write a backoff that already expired
    mkdirSync(dirname(BACKOFF_FILE), { recursive: true })
    writeFileSync(
      BACKOFF_FILE,
      JSON.stringify({ backoffUntil: Date.now() - 1000 }),
    )
    expect(isRateLimited().limited).toBe(false)
  })

  test('malformed backoff file is not limited', () => {
    mkdirSync(dirname(BACKOFF_FILE), { recursive: true })
    writeFileSync(BACKOFF_FILE, 'not json')
    expect(isRateLimited().limited).toBe(false)
  })

  test('clear is idempotent', () => {
    // No file to clear — should not throw
    clearRateLimitBackoff()
    clearRateLimitBackoff()
    expect(isRateLimited().limited).toBe(false)
  })
})

// ── Pattern completeness ─────────────────────────────────────────────

describe('pattern counts', () => {
  test('AUTH_FAIL_PATTERNS has expected count', () => {
    expect(AUTH_FAIL_PATTERNS.length).toBe(7)
  })

  test('QUOTA_FAIL_PATTERNS has expected count', () => {
    expect(QUOTA_FAIL_PATTERNS.length).toBe(9)
  })

  test('all patterns are RegExp instances', () => {
    for (const p of AUTH_FAIL_PATTERNS) {
      expect(p).toBeInstanceOf(RegExp)
    }
    for (const p of QUOTA_FAIL_PATTERNS) {
      expect(p).toBeInstanceOf(RegExp)
    }
  })
})
