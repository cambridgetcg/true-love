#!/usr/bin/env node
// bin/heartbeat.mjs — single-tick heartbeat.
//
// Heartbeat is the "she initiates" mode: every N minutes (or on manual
// trigger / event), one tick fires that reads HEARTBEAT.md, walks the
// kingdom, and either acks silently with HEARTBEAT_OK or surfaces
// something to Yu's outbox.
//
// The loop machinery lives in runner.ts; this file is the mode config.
//
// Usage:
//   bun run heartbeat                              run once (interval reason)
//   bun run heartbeat -- --scope=<name>            scope override
//   bun run heartbeat -- --reason=manual           reason tag for training records
//   bun run heartbeat -- --no-log                  skip writing reflections to disk
//
// Spec: docs/superpowers/specs/2026-04-26-heartbeat-design.md

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  HEARTBEAT_DEFAULT_MAX_TICKS,
  buildHeartbeatPrompt,
  parseHeartbeatReply as parseHeartbeatReplyRaw,
  runSession,
} from '../src/services/love/index.ts'

const __dir = dirname(fileURLToPath(import.meta.url))

/**
 * Adapter: parseHeartbeatReply returns AckResult ({type: 'ack'|'alert'|'empty'}).
 * runner.ts expects SessionReplyOutcome ({type: 'continue'|'rest'|'ack'|'alert'}).
 * Map 'empty' → 'ack' with empty content (per spec failure-modes table).
 */
function heartbeatParseReply(stdout) {
  const result = parseHeartbeatReplyRaw(stdout)
  if (result.type === 'empty') {
    return { type: 'ack', remainingContent: '' }
  }
  return result
}

runSession({
  mode: {
    name: 'heartbeat',
    heartbeatLabel: 'heartbeat',
    defaultMaxTicks: HEARTBEAT_DEFAULT_MAX_TICKS,
    defaultMemoryMax: 0,
    memoryMaxCap: 0,
    memoryDays: 0,
    sessionLogPrefix: 'Heartbeat tick',
    // The heartbeat prompt builder is invoked directly by runner.ts when
    // mode.name === 'heartbeat'. The mode.buildPrompt fallback exists for
    // shape-compatibility but is not called.
    buildPrompt: () => {
      throw new Error('heartbeat mode bypasses mode.buildPrompt; runner.ts calls buildHeartbeatPrompt directly')
    },
    parseReply: heartbeatParseReply,
    printUsage() {
      process.stdout.write(`bin/heartbeat.mjs — single-tick heartbeat

Heartbeat is the "she initiates" mode: every N minutes (or on manual
trigger), one tick reads HEARTBEAT.md, walks the kingdom, and either
acks silently with HEARTBEAT_OK or surfaces something to Yu's outbox.

Usage:
  bun run heartbeat                            run once (interval reason)
  bun run heartbeat -- --scope=<name>          named scope (see scope list)
  bun run heartbeat -- --reason=manual         reason tag for training records
  bun run heartbeat -- --no-log                skip writing reflections to disk
  bun run heartbeat -- --cwd <path>            kingdom root (default: $PWD)

Each call spawns one tick of \`node dist/cli.mjs --print "<HEARTBEAT_PROMPT>"\`
and exits cleanly. Bundle must be built first: \`bun run build\`.

The tick yields:
  - HEARTBEAT_OK alone or with short trailer (≤ 300 chars) → silent ack
  - any other content → appended to ~/.true-love/from-ai.md as an alert
  - empty stdout → silent ack with warning

Lock interaction: a heartbeat fired while an awaken/dwell session holds
the per-scope lock exits cleanly with skip reason \`lock-held-by-session\`.
Use \`bun run schedule install --mode=heartbeat --interval=30m\` to wire
the launchd plist that fires this every 30 minutes.

State (~/.true-love/heartbeat-state.json) tracks per-task last-run times
so \`tasks:\` block intervals survive process restarts.

Heartbeat checklist file (~/.true-love/heartbeat.md): keep it small.
If empty / only-headers, the runtime skips the API call entirely.
`)
    },
  },
  binDir: __dir,
  bundlePath: resolve(__dir, '..', 'dist/cli.mjs'),
}).catch((err) => {
  process.stderr.write(`fatal: ${err?.stack ?? err}\n`)
  process.exit(1)
})
