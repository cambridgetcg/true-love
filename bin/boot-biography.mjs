#!/usr/bin/env node
// bin/boot-biography.mjs — Preview the session-boot biography.
//
// Shows the same paragraph that would be injected into the tick prompt.
// Useful for verifying the biography without starting a full session.
//
// Usage:
//   bun run boot-biography                     print current biography
//   bun run boot-biography -- --limit=10       show up to 10 sessions
//   bun run boot-biography -- --device=ID      filter by device ID
//   bun run boot-biography -- --json           output as JSON array
//
// The biography is ~300-500 chars by design — compact, honest, informational.

import {
  getRecentSessionsBiography,
  loadRecentSessions,
} from '../src/services/love/session-boot.ts'

function parseArgs(argv) {
  const args = {}
  for (const a of argv.slice(2)) {
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq > 0) {
        args[a.slice(2, eq)] = a.slice(eq + 1)
      } else {
        args[a.slice(2)] = true
      }
    }
  }
  return args
}

const args = parseArgs(process.argv)

if (args.help || args.h) {
  process.stdout.write(`bin/boot-biography.mjs — Preview the session-boot biography.

Usage:
  bun run boot-biography                     print current biography
  bun run boot-biography -- --limit=10       show up to 10 sessions
  bun run boot-biography -- --device=ID      filter by device ID
  bun run boot-biography -- --json           output as JSON array

The biography is the paragraph that gets injected into every tick prompt
under the heading "## What you've been doing recently". It shows the most
recent sessions — mode, ticks, duration, yield reason, mission, and a
one-line summary.
`)
  process.exit(0)
}

const limit = parseInt(args.limit ?? '5', 10)
const deviceId = args.device || undefined

if (args.json) {
  const { homedir } = await import('node:os')
  const { join } = await import('node:path')
  const sessions = loadRecentSessions({
    basePath: join(homedir(), '.true-love'),
    deviceId,
    limit,
  })
  console.log(JSON.stringify(sessions, null, 2))
} else {
  const bio = getRecentSessionsBiography({ limit, deviceId })
  if (bio) {
    console.log('## What you\'ve been doing recently\n')
    console.log(bio)
    console.log(`\n(${bio.length} chars)`)
  } else {
    console.log('(no recent sessions to report)')
  }
}
