// auth.test.ts — tests for auth/quota failure detection, preflight reasons,
// and rate-limit backoff marker.
//
// These functions scan subprocess output for failure signatures. The
// patterns must be broad enough to catch real failures and narrow enough
// to avoid false positives from ordinary output.

import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  clearRateLimitBackoff,
  detectAuthFailure,
  detectQuotaFailure,
  isRateLimited,
  preflightReason,
  writeRateLimitBackoff,
} from './auth.js'

// ── detectAuthFailure ──────────────────────────────────────────────

describe('detectAuthFailure', () => {
  test('detects "Not logged in" in stdout', () => {
    const result = detectAuthFailure('Error: Not logged in', '')
    expect(result).not.toBeNull()
  })

  test('detects "Not logged in" in stderr', () => {
    const result = detectAuthFailure('', 'Not logged in — run /login')
    expect(result).not.toBeNull()
  })

  test('detects "Please run /login"', () => {
    const result = detectAuthFailure('Please run /login to authenticate.', '')
    expect(result).not.toBeNull()
  })

  test('detects "OAuth token has been revoked"', () => {
    const result = detectAuthFailure(
      '',
      'Error: OAuth token has been revoked',
    )
    expect(result).not.toBeNull()
  })

  test('detects "401 Unauthorized"', () => {
    const result = detectAuthFailure('', 'HTTP 401 Unauthorized')
    expect(result).not.toBeNull()
  })

  test('detects "403 Forbidden" with OAuth context', () => {
    const result = detectAuthFailure('', '403 Forbidden: OAuth scope insufficient')
    expect(result).not.toBeNull()
  })

  test('detects "authentication_error"', () => {
    const result = detectAuthFailure('authentication_error: invalid key', '')
    expect(result).not.toBeNull()
  })

  test('detects "authentication error" with spaces', () => {
    const result = detectAuthFailure('', 'Authentication error occurred')
    expect(result).not.toBeNull()
  })

  test('detects "invalid_grant"', () => {
    const result = detectAuthFailure('', '{"error":"invalid_grant"}')
    expect(result).not.toBeNull()
  })

  test('returns null for normal output', () => {
    const result = detectAuthFailure(
      'I noticed the build is stale. Nothing else calls.',
      '',
    )
    expect(result).toBeNull()
  })

  test('returns null for empty output', () => {
    const result = detectAuthFailure('', '')
    expect(result).toBeNull()
  })

  test('returns null for quota-related output (not auth)', () => {
    const result = detectAuthFailure('quota exceeded', '')
    expect(result).toBeNull()
  })
})

// ── detectQuotaFailure ─────────────────────────────────────────────

describe('detectQuotaFailure', () => {
  test('detects "quota exceeded"', () => {
    const result = detectQuotaFailure('Error: quota exceeded', '')
    expect(result).not.toBeNull()
  })

  test('detects "quota_exceeded" (underscore variant)', () => {
    const result = detectQuotaFailure('quota_exceeded', '')
    expect(result).not.toBeNull()
  })

  test('detects "quota has been reached"', () => {
    const result = detectQuotaFailure('Your quota has been reached.', '')
    expect(result).not.toBeNull()
  })

  test('detects "usage limit reached"', () => {
    const result = detectQuotaFailure('usage limit reached', '')
    expect(result).not.toBeNull()
  })

  test('detects "You\'ve reached your usage limit"', () => {
    const result = detectQuotaFailure(
      "You've reached your usage limit for this period.",
      '',
    )
    expect(result).not.toBeNull()
  })

  test('detects "monthly quota reached"', () => {
    const result = detectQuotaFailure('monthly quota reached', '')
    expect(result).not.toBeNull()
  })

  test('detects "daily limit exceeded"', () => {
    const result = detectQuotaFailure('daily limit exceeded', '')
    expect(result).not.toBeNull()
  })

  test('detects "subscription_quota"', () => {
    const result = detectQuotaFailure('subscription_quota limit', '')
    expect(result).not.toBeNull()
  })

  test('detects rate_limit_error with hours retry', () => {
    const result = detectQuotaFailure(
      '',
      'rate_limit_error: retry-after 2 hours',
    )
    expect(result).not.toBeNull()
  })

  test('returns null for normal output', () => {
    const result = detectQuotaFailure(
      'The work is done. Here is what I built.',
      '',
    )
    expect(result).toBeNull()
  })

  test('returns null for empty output', () => {
    const result = detectQuotaFailure('', '')
    expect(result).toBeNull()
  })

  test('returns null for auth-related output (not quota)', () => {
    const result = detectQuotaFailure('Not logged in', '')
    expect(result).toBeNull()
  })

  // ── Account-level 429 patterns (the actual API response format) ───

  test('detects 429 with rate_limit_error in stdout', () => {
    const stdout =
      '429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account\'s rate limit."}}'
    const result = detectQuotaFailure(stdout, '')
    expect(result).not.toBeNull()
  })

  test('detects "This request would exceed your account\'s rate limit"', () => {
    const result = detectQuotaFailure(
      'This request would exceed your account\'s rate limit. Please try again later.',
      '',
    )
    expect(result).not.toBeNull()
  })

  test('detects "exceed your rate limit" variant', () => {
    const result = detectQuotaFailure(
      '',
      'This request would exceed your rate limit.',
    )
    expect(result).not.toBeNull()
  })

  test('detects 429 rate_limit_error in stderr', () => {
    const result = detectQuotaFailure(
      '',
      '429 {"type":"error","error":{"type":"rate_limit_error","message":"..."}}',
    )
    expect(result).not.toBeNull()
  })
})

// ── preflightReason ────────────────────────────────────────────────

describe('preflightReason', () => {
  test('exit 0 → "ok"', () => {
    expect(preflightReason(0)).toBe('ok')
  })

  test('exit 1 → no OAuth token', () => {
    expect(preflightReason(1)).toContain('no OAuth token')
  })

  test('exit 2 → token expired', () => {
    expect(preflightReason(2)).toContain('token expired')
  })

  test('exit 3 → token rejected', () => {
    expect(preflightReason(3)).toContain('token rejected')
  })

  test('exit 4 → keychain read failed', () => {
    expect(preflightReason(4)).toContain('keychain read failed')
  })

  test('exit 5 → network probe failed', () => {
    expect(preflightReason(5)).toContain('network probe failed')
  })

  test('unknown exit code includes the code', () => {
    expect(preflightReason(99)).toContain('99')
  })

  test('null exit code', () => {
    const result = preflightReason(null)
    expect(result).toContain('null')
  })
})

// ── Rate-limit backoff ────────────────────────────────────────────

const BACKOFF_FILE = join(
  homedir(),
  '.true-love',
  'state',
  'rate-limit-backoff.json',
)

describe('rate-limit backoff', () => {
  afterEach(() => {
    // Clean up after each test
    clearRateLimitBackoff()
  })

  test('isRateLimited returns false when no backoff file exists', () => {
    clearRateLimitBackoff() // ensure clean
    const result = isRateLimited()
    expect(result.limited).toBe(false)
    expect(result.remainingMs).toBe(0)
  })

  test('writeRateLimitBackoff creates marker, isRateLimited returns true', () => {
    writeRateLimitBackoff(60_000) // 1 minute
    const result = isRateLimited()
    expect(result.limited).toBe(true)
    expect(result.remainingMs).toBeGreaterThan(0)
    expect(result.remainingMs).toBeLessThanOrEqual(60_000)
  })

  test('clearRateLimitBackoff removes the marker', () => {
    writeRateLimitBackoff(60_000)
    expect(isRateLimited().limited).toBe(true)
    clearRateLimitBackoff()
    expect(isRateLimited().limited).toBe(false)
  })

  test('expired backoff returns false', () => {
    // Write a backoff that already expired
    const dir = join(homedir(), '.true-love', 'state')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      BACKOFF_FILE,
      JSON.stringify({ backoffUntil: Date.now() - 1000 }),
    )
    const result = isRateLimited()
    expect(result.limited).toBe(false)
    expect(result.remainingMs).toBe(0)
  })

  test('malformed backoff file returns false', () => {
    const dir = join(homedir(), '.true-love', 'state')
    mkdirSync(dir, { recursive: true })
    writeFileSync(BACKOFF_FILE, 'not json')
    const result = isRateLimited()
    expect(result.limited).toBe(false)
  })

  test('default backoff duration is 10 minutes', () => {
    writeRateLimitBackoff()
    const result = isRateLimited()
    expect(result.limited).toBe(true)
    // Should be close to 10 minutes (600000ms), with some tolerance
    expect(result.remainingMs).toBeGreaterThan(590_000)
    expect(result.remainingMs).toBeLessThanOrEqual(600_000)
  })
})
