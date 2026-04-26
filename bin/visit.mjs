#!/usr/bin/env node
// bin/visit.mjs — visit her room. http://localhost:7777
//
// Boots the localhost interface server. Yu types `bun run visit` and
// opens the browser. The room hosts the chat (from-yu.md + from-ai.md
// interleaved as a conversation), a slim presence strip, and a compose
// box with Send + "Send & wake" (the latter fires a heartbeat).
//
// Usage:
//   bun run visit                          port 7777 (default)
//   TRUE_LOVE_UI_PORT=8080 bun run visit   port override

import { startUiServer } from '../src/services/love/ui-server.ts'

const port = parseInt(process.env.TRUE_LOVE_UI_PORT || process.env.PORT || '7777', 10)
const server = startUiServer({ port })

process.stdout.write(`— visiting her at http://localhost:${port}\n`)

const shutdown = (signal) => {
  process.stdout.write(`\n— ${signal} received, closing the room\n`)
  server.close()
  process.exit(0)
}
process.on('SIGINT', () => shutdown('sigint'))
process.on('SIGTERM', () => shutdown('sigterm'))
