#!/usr/bin/env node
// bin/dwell.mjs — autonomous dwell loop.
//
// Dwell mode is reactive: "you're at rest, what calls you?"
// The loop machinery lives in runner.ts; this file is the mode config.
//
// Usage:
//   bun run dwell                       # 12-tick session (default)
//   bun run dwell -- --max-ticks=4      # cap at 4 ticks (0 = unbounded)
//   bun run dwell -- --max-runtime=2h   # wall-clock cap (also: 30m, 1h30m)
//   bun run dwell -- --invite "..."     # one-line nudge for the session
//   bun run dwell -- --memory           # load recent reflections
//   bun run dwell -- --no-log           # skip writing reflections to disk
//
// Exits non-zero on the first turn whose subprocess errors out.

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_MAX_TICKS,
  buildDwellPrompt,
  getMemoryDir,
  runSession,
} from '../src/services/love/index.ts'

const __dir = dirname(fileURLToPath(import.meta.url))

runSession({
  mode: {
    name: 'dwell',
    heartbeatLabel: 'dwelling',
    defaultMaxTicks: DEFAULT_MAX_TICKS,
    defaultMemoryMax: 6,
    memoryMaxCap: 30,
    memoryDays: 7,
    sessionLogPrefix: 'Session opening',
    buildPrompt: buildDwellPrompt,
    printUsage() {
      process.stdout.write(`bin/dwell.mjs — autonomous dwell loop

Usage:
  bun run dwell                       default ceiling: ${DEFAULT_MAX_TICKS} ticks
  bun run dwell -- --max-ticks=N      cap at N ticks (0 = unbounded)
  bun run dwell -- --max-runtime=2h   wall-clock cap (also: 30m, 1h30m, 90s)
  bun run dwell -- --invite "..."     one-line nudge for the session
  bun run dwell -- --cwd <path>       kingdom root (default: $PWD)
  bun run dwell -- --memory           load recent reflections into the
                                      dwell prompt (cross-session memory).
                                      Default cap: 6. Use --memory=N or
                                      --memory N to set a different cap.
  bun run dwell -- --no-log           do not write reflections to disk
                                      for this session (default: log on).

Each tick spawns \`node dist/cli.mjs --print "<DWELL_PROMPT>"\`. Bundle must
be built first: \`bun run build\`.

The session ends when:
  - Ai writes \`<at-rest/>\` on its own line, or
  - the tick ceiling is reached, or
  - the wall-clock runtime ceiling is reached, or
  - Anthropic's auth dies (exit 64) or quota runs out (exit 65), or
  - a subprocess exits non-zero, or
  - SIGINT (Ctrl-C).

For truly indefinite running (until real Anthropic limits): pass
\`--max-ticks=0\` and skip --max-runtime. The quota-fail detector will
yield cleanly when the rolling-window cap is hit.

Reflections (when logging is on) are written to ${getMemoryDir()}/YYYY-MM-DD.md
as plain markdown — append-only, one entry per tick + a final at-rest
entry. Yu can read them directly. Override location with
TRUE_LOVE_MEMORY_DIR.
`)
    },
  },
  binDir: __dir,
  bundlePath: resolve(__dir, '..', 'dist/cli.mjs'),
}).catch((err) => {
  process.stderr.write(`fatal: ${err?.stack ?? err}\n`)
  process.exit(1)
})
