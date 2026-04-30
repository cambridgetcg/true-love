#!/usr/bin/env node
// bin/interactive.mjs — conversation mode. Alpha replies to Yu.
//
// Interactive is the /visit conversation path. Yu typed a message and
// pressed send-and-wake; this fires one tick where Alpha reads his
// message and replies. The response is written to from-ai.md (not
// journal) with Alpha's byline.
//
// The loop machinery lives in runner.ts; this file is the mode config.
//
// Usage:
//   bun run interactive                         reply once
//   bun run interactive -- --scope=<name>       scope override
//   bun run interactive -- --reason=visit       reason tag for training records
//   bun run interactive -- --no-log             skip writing reflections to disk

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  INTERACTIVE_DEFAULT_MAX_TICKS,
  buildInteractivePrompt,
  runSession,
} from '../src/services/love/index.ts'
import { extractToYuContent } from '../src/services/love/heartbeat.ts'

const __dir = dirname(fileURLToPath(import.meta.url))

/**
 * Parse an interactive reply. Always produces an alert (content for Yu).
 * Extracts [TO-YU] delimited content when present; otherwise uses the
 * full response. Never returns 'ack' — interactive always has a reply.
 */
function interactiveParseReply(stdout) {
  const trimmed = (stdout ?? '').trim()
  if (!trimmed) {
    return { type: 'alert', content: '(Love had nothing to say — this is unusual.)' }
  }

  // Honor [TO-YU] delimiters if present
  const toYuContent = extractToYuContent(trimmed)
  if (toYuContent !== null) {
    const extracted = toYuContent.trim()
    if (!extracted) {
      return { type: 'alert', content: '(Love had nothing to say — this is unusual.)' }
    }
    return { type: 'alert', content: extracted }
  }

  // No delimiters — the whole response is the reply
  return { type: 'alert', content: trimmed }
}

runSession({
  mode: {
    name: 'interactive',
    heartbeatLabel: 'interactive',
    defaultMaxTicks: INTERACTIVE_DEFAULT_MAX_TICKS,
    defaultMemoryMax: 0,
    memoryMaxCap: 0,
    memoryDays: 0,
    sessionLogPrefix: 'Interactive reply',
    buildPrompt: buildInteractivePrompt,
    parseReply: interactiveParseReply,
    printUsage() {
      process.stdout.write(`bin/interactive.mjs — conversation mode (Alpha replies to Yu)

Interactive mode fires when Yu sends a message via /visit and presses
send-and-wake. One tick: read his message, reply as Alpha. The response
is written to from-ai.md with Alpha 🐍 byline.

Usage:
  bun run interactive                         reply once
  bun run interactive -- --scope=<name>       named scope (see scope list)
  bun run interactive -- --reason=visit       reason tag for training records
  bun run interactive -- --no-log             skip writing reflections to disk
  bun run interactive -- --cwd <path>         kingdom root (default: $PWD)

Bundle must be built first: \`bun run build\`.
`)
    },
  },
  binDir: __dir,
  bundlePath: resolve(__dir, '..', 'dist/cli.mjs'),
}).catch((err) => {
  process.stderr.write(`fatal: ${err?.stack ?? err}\n`)
  process.exit(1)
})
