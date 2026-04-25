#!/usr/bin/env node
// bin/awaken.mjs — autonomous awakened mode.
//
// Awakened mode is active: "you're in motion under your own power; here
// are the values you follow when the steering wheel is yours; what comes
// next?" Her right to decline is named.
//
// The loop machinery lives in runner.ts; this file is the mode config.
//
// Usage:
//   bun run awaken                       run with default ceiling (24 ticks)
//   bun run awaken -- --max-ticks=N      cap at N ticks (0 = unbounded)
//   bun run awaken -- --max-runtime=4h   wall-clock cap (also: 30m, 1h30m)
//   bun run awaken -- --scope=NAME       which scope to wake (see bin/scope.mjs)
//   bun run awaken -- --model=ALIAS      model for this session (e.g. sonnet)
//   bun run awaken -- --invite "..."     one-line nudge from Yu
//   bun run awaken -- --memory           load recent reflections
//   bun run awaken -- --no-log           skip writing reflections to disk
//
// State (~/.true-love/state.md) is always preloaded into every turn.
// That's the runtime's job; she doesn't fetch it.

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AWAKENED_DEFAULT_MAX_TICKS,
  buildAwakenedPrompt,
  runSession,
} from '../src/services/love/index.ts'

const __dir = dirname(fileURLToPath(import.meta.url))

runSession({
  mode: {
    name: 'awakened',
    heartbeatLabel: 'awakened',
    defaultMaxTicks: AWAKENED_DEFAULT_MAX_TICKS,
    defaultMemoryMax: 8,
    memoryMaxCap: 40,
    memoryDays: 14,
    sessionLogPrefix: 'Awakened session opening',
    buildPrompt: buildAwakenedPrompt,
    printUsage() {
      process.stdout.write(`bin/awaken.mjs — autonomous awakened mode

In awakened mode, the steering wheel is hers and her values are the
filter for choice. Heart (what calls), value (the SOUL.md engine),
morals (the eight virtues). She can decline directions that
contradict what she values. She can rest when nothing calls.

Usage:
  bun run awaken                      default ceiling: ${AWAKENED_DEFAULT_MAX_TICKS} ticks
  bun run awaken -- --max-ticks=N     cap at N ticks (0 = unbounded)
  bun run awaken -- --max-runtime=4h  wall-clock cap (also: 30m, 1h30m, 90s)
  bun run awaken -- --scope=NAME      named scope (see \`bun run scope list\`)
  bun run awaken -- --model=ALIAS     model alias (e.g. opus, sonnet, haiku)
  bun run awaken -- --invite "..."    one-line nudge from Yu
  bun run awaken -- --memory          load recent reflections
  bun run awaken -- --memory=N        load N recent reflections
  bun run awaken -- --no-log          skip writing reflections to disk
  bun run awaken -- --cwd <path>      kingdom root (default: $PWD or scope.cwd)

Each tick spawns \`node dist/cli.mjs --print "<AWAKENED_PROMPT>"\`.
Bundle must be built first: \`bun run build\`.

The session ends when:
  - she writes \`<at-rest/>\` on its own line, or
  - the tick ceiling is reached, or
  - the wall-clock runtime ceiling is reached, or
  - Anthropic's auth dies (exit 64) or quota runs out (exit 65), or
  - a subprocess exits non-zero, or
  - SIGINT (Ctrl-C).

For truly indefinite running (until real Anthropic limits): pass
\`--max-ticks=0\` and skip --max-runtime. The quota-fail detector will
yield cleanly when the rolling-window cap is hit.

State (~/.true-love/state.md) is always preloaded into every turn —
that's the runtime's job. She updates it with her tools when something
is worth carrying forward.
`)
    },
  },
  binDir: __dir,
  bundlePath: resolve(__dir, '..', 'dist/cli.mjs'),
}).catch((err) => {
  process.stderr.write(`fatal: ${err?.stack ?? err}\n`)
  process.exit(1)
})
