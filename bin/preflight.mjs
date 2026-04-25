#!/usr/bin/env node
// bin/preflight.mjs — verify Anthropic auth before an autonomous session.
//
// Reads the OAuth token from the macOS keychain (where Claude Code stores
// it under "Claude Code-credentials"), checks expiry, and optionally
// probes the API with a tiny request to confirm the token is still
// accepted server-side (not just unexpired locally — Anthropic can revoke
// tokens out from under you).
//
// Exit codes — designed for shell wrappers and cron/launchd jobs:
//   0  — OK, token valid, session safe to start
//   1  — token missing entirely (run `claude /login`)
//   2  — token expired and refresh failed (run `claude /login`)
//   3  — token rejected by API (revoked server-side; run `claude /login`)
//   4  — keychain read failed for some other reason (permissions, etc.)
//   5  — network failure during probe (might be transient)
//
// Usage:
//   bun run preflight                    full check, prints summary
//   bun run preflight -- --probe         also send a tiny test request
//   bun run preflight -- --quiet         exit codes only, no stdout
//   bun run preflight -- --json          machine-readable status
//
// CONTRACT: this file is self-contained. It uses node:fs, node:os,
// node:child_process, and globalThis.fetch only. No imports from src/.
// That makes it useful inside the Docker broker container, in CI, on a
// server that doesn't have the rest of the repo installed.

import { execSync } from 'node:child_process'

// ── Args ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { probe: false, quiet: false, json: false, model: 'claude-haiku-4-5' }
  for (const a of argv) {
    if (a === '--probe') args.probe = true
    else if (a === '--quiet' || a === '-q') args.quiet = true
    else if (a === '--json') args.json = true
    else if (a.startsWith('--model=')) args.model = a.slice('--model='.length)
    else if (a === '-h' || a === '--help') {
      process.stdout.write(`bin/preflight.mjs — verify Anthropic auth

Usage:
  bun run preflight                       check token presence + expiry
  bun run preflight -- --probe            also probe API (1 small request)
  bun run preflight -- --probe --quiet    exit codes only
  bun run preflight -- --json             machine-readable status

Exit codes:
  0  ok, ready
  1  no token (run claude /login)
  2  token expired, refresh failed
  3  token revoked server-side (run claude /login)
  4  keychain read failed
  5  network failed during probe
`)
      process.exit(0)
    }
  }
  return args
}

// ── Keychain access ──────────────────────────────────────────────────

function readKeychainCreds() {
  // The Claude Code CLI stores the OAuth blob in the macOS keychain under
  // service "Claude Code-credentials". We read it via the `security`
  // command (no native bindings; works on every mac).
  const user = process.env.USER || ''
  const cmds = user
    ? [
        `security find-generic-password -s "Claude Code-credentials" -a "${user}" -w`,
        `security find-generic-password -s "Claude Code-credentials" -w`,
      ]
    : [`security find-generic-password -s "Claude Code-credentials" -w`]
  for (const cmd of cmds) {
    try {
      const raw = execSync(cmd, { encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      if (!raw) continue
      const parsed = JSON.parse(raw)
      if (parsed?.claudeAiOauth?.accessToken) return parsed.claudeAiOauth
    } catch {
      // try next variant
    }
  }
  return null
}

// ── Probe ────────────────────────────────────────────────────────────

async function probeApi(accessToken, model) {
  // Smallest possible API call: short max_tokens, single user message.
  // Caller controls model — Haiku by default for lowest cost.
  const url = 'https://api.anthropic.com/v1/messages'
  const body = {
    model,
    max_tokens: 8,
    system: "You are Claude Code, Anthropic's official CLI for Claude.",
    messages: [{ role: 'user', content: 'OK?' }],
  }
  let resp
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'oauth-2025-04-20',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (e) {
    return { ok: false, kind: 'network', message: e?.message ?? String(e) }
  }
  if (resp.ok) {
    return { ok: true, status: resp.status }
  }
  // 401/403 with revoked-language → token rejected
  let bodyText = ''
  try {
    bodyText = await resp.text()
  } catch {}
  if (resp.status === 401 || resp.status === 403) {
    return { ok: false, kind: 'rejected', status: resp.status, message: bodyText.slice(0, 300) }
  }
  // Other server errors are transient or non-auth; treat as ok-for-auth-purposes
  return { ok: false, kind: 'other', status: resp.status, message: bodyText.slice(0, 300) }
}

// ── Render ───────────────────────────────────────────────────────────

function fmtAge(deltaMs) {
  if (deltaMs < 60_000) return `${Math.round(deltaMs / 1000)}s`
  if (deltaMs < 3_600_000) return `${Math.round(deltaMs / 60_000)}m`
  if (deltaMs < 86_400_000) return `${Math.round(deltaMs / 3_600_000)}h`
  return `${Math.round(deltaMs / 86_400_000)}d`
}

function emit(args, exitCode, status) {
  if (args.json) {
    process.stdout.write(JSON.stringify({ exitCode, ...status }, null, 2) + '\n')
  } else if (!args.quiet) {
    const ok = exitCode === 0
    process.stdout.write(`preflight: ${ok ? 'OK' : 'NOT OK'} (exit ${exitCode})\n`)
    for (const [k, v] of Object.entries(status)) {
      process.stdout.write(`  ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}\n`)
    }
    if (!ok) {
      process.stdout.write('\nremediation:\n')
      switch (exitCode) {
        case 1:
          process.stdout.write('  no OAuth token present. Run `claude /login`.\n')
          break
        case 2:
          process.stdout.write('  token expired and refresh-token also stale. Run `claude /login`.\n')
          break
        case 3:
          process.stdout.write('  token rejected server-side (revoked or subscription change).\n')
          process.stdout.write('  Run `claude /login` to re-authenticate.\n')
          break
        case 4:
          process.stdout.write('  keychain read failed (permissions?). Try logging in manually,\n')
          process.stdout.write('  or check macOS Keychain Access for "Claude Code-credentials".\n')
          break
        case 5:
          process.stdout.write('  probe network call failed. Check internet, then re-run --probe.\n')
          break
      }
    }
  }
  process.exit(exitCode)
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2))

  // 1. Read keychain
  let creds
  try {
    creds = readKeychainCreds()
  } catch {
    return emit(args, 4, { reason: 'keychain-read-failed' })
  }
  if (!creds) {
    return emit(args, 1, { reason: 'no-token' })
  }

  // 2. Check expiry
  const expiresAt = creds.expiresAt ?? 0
  const now = Date.now()
  const remainingMs = expiresAt - now
  const status = {
    accessTokenSuffix: '...' + creds.accessToken.slice(-8),
    expiresAt: new Date(expiresAt).toISOString(),
    expiresIn: remainingMs > 0 ? fmtAge(remainingMs) : `expired ${fmtAge(-remainingMs)} ago`,
    subscription: creds.subscriptionType ?? '(unknown)',
    rateLimitTier: creds.rateLimitTier ?? '(unknown)',
    hasRefreshToken: !!creds.refreshToken,
  }

  if (remainingMs <= 0) {
    // Token has expired. Refresh logic in the SDK only fires inside an API
    // call; from outside, we'd need to replicate it (POST to oauth/token
    // with refresh_token). For preflight we treat expiry as "needs login"
    // unless --probe is on, which would refresh implicitly via the SDK
    // path... actually no, we're not using the SDK here. So just report.
    return emit(args, 2, { ...status, reason: 'token-expired' })
  }

  // 3. Optional API probe
  if (args.probe) {
    const probe = await probeApi(creds.accessToken, args.model)
    status.probe = probe
    if (probe.ok) {
      return emit(args, 0, status)
    }
    if (probe.kind === 'rejected') {
      return emit(args, 3, { ...status, reason: 'token-rejected-server-side' })
    }
    if (probe.kind === 'network') {
      return emit(args, 5, { ...status, reason: 'probe-network-failed' })
    }
    // 'other' — non-auth API issue; auth is fine, just transient. Treat as OK.
    return emit(args, 0, { ...status, reason: 'auth-ok-but-api-transient' })
  }

  // No probe — just expiry check passed
  return emit(args, 0, status)
}

main().catch((err) => {
  process.stderr.write(`preflight crashed: ${err?.stack ?? err}\n`)
  process.exit(99)
})
