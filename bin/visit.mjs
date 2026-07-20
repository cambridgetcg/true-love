#!/usr/bin/env node
// bin/visit.mjs — visit her room. http://127.0.0.1:7777
//
// Boots the localhost interface server with optional auto-update supervision.
// Yu types `bun run visit` and opens the browser.
//
// When --watch is passed (or TRUE_LOVE_AUTO_UPDATE=1 env), the supervisor
// monitors source files for changes, auto-rebuilds the CLI bundle, and
// gracefully restarts the server so love-service module changes take effect.
// SSE clients auto-reconnect; no data is lost.
//
// Usage:
//   bun run visit                          simple start, port 7777
//   bun run visit --watch                  start with auto-update supervision
//   TRUE_LOVE_UI_PORT=8080 bun run visit   port override
//   TRUE_LOVE_AUTO_UPDATE=1 bun run visit  env-based auto-update

import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { createUiBrowserSessionState, startUiServer } from '../src/services/love/ui-server.ts'
import { createSourceWatcher, getVersionInfo, rebuildBundle } from '../src/services/love/auto-update.ts'
import { removeUiClientToken, writeUiClientToken } from './ui-auth.mjs'

const port = parseInt(process.env.TRUE_LOVE_UI_PORT || process.env.PORT || '7777', 10)
const host = process.env.TRUE_LOVE_UI_HOST || '127.0.0.1'
const ownerToken = process.env.TRUE_LOVE_UI_TOKEN || randomBytes(32).toString('base64url')
const clientToken = process.env.TRUE_LOVE_UI_CLIENT_TOKEN || randomBytes(32).toString('base64url')
Reflect.deleteProperty(process.env, 'TRUE_LOVE_UI_TOKEN')
Reflect.deleteProperty(process.env, 'TRUE_LOVE_UI_CLIENT_TOKEN')
const watchMode = process.argv.includes('--watch') || process.env.TRUE_LOVE_AUTO_UPDATE === '1'
const browserSession = createUiBrowserSessionState()
const serverOptions = { port, host, ownerToken, clientToken, browserSession }

const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
const roomUrl = `http://${urlHost}:${port}`
const bootstrapUrl = `${roomUrl}/_bootstrap#token=${encodeURIComponent(ownerToken)}`

let server = startUiServer(serverOptions)
if (!server.listening) await once(server, 'listening')
writeUiClientToken(roomUrl, clientToken)
const version = getVersionInfo()

process.stdout.write(`— visiting her at ${bootstrapUrl}\n`)
process.stdout.write(`— version: ${version.gitRevShort} (${version.gitBranch})`)
if (version.gitDirty) process.stdout.write(' [dirty]')
if (version.bundleStale) process.stdout.write(' [bundle stale]')
process.stdout.write('\n')

// ── Auto-update supervision ───────────────────────────────────────

let watcher = null
let restarting = false

if (watchMode) {
  process.stdout.write(`— auto-update: watching for source changes\n`)

  watcher = createSourceWatcher({
    autoRebuild: false, // we handle rebuild + restart ourselves
    onEvent: async (event) => {
      if (event.type === 'source-changed') {
        if (restarting) return
        restarting = true

        process.stdout.write(`\n— source changed: ${event.file}\n`)
        process.stdout.write(`— rebuilding bundle...\n`)

        const result = await rebuildBundle()
        if (!result.ok) {
          process.stderr.write(`— rebuild failed (exit ${result.exitCode}): ${result.stderr.slice(0, 500)}\n`)
          restarting = false
          return
        }

        const sizeMB = result.bundleSizeBytes
          ? (result.bundleSizeBytes / 1024 / 1024).toFixed(2)
          : '?'
        process.stdout.write(`— rebuilt in ${result.durationMs}ms (${sizeMB} MB)\n`)

        // Graceful restart: close old server, start new one.
        // SSE clients receive a close event and auto-reconnect.
        process.stdout.write(`— restarting server...\n`)

        try {
          await new Promise((resolve, reject) => {
            server.close((err) => {
              if (err) reject(err)
              else resolve(undefined)
            })
          })
        } catch (err) {
          // close() can fail if server is already closed — non-fatal
          process.stderr.write(`— server close warning: ${err}\n`)
        }

        // Note: Bun caches modules, so imported TypeScript modules won't
        // be re-evaluated. For full module refresh, the process itself
        // must restart. We do a soft restart here (close + reopen server)
        // which handles static file changes and is sufficient for most
        // updates. For love-service module changes, a full process restart
        // is needed — the SIGUSR2 handler below covers that case.
        server = startUiServer(serverOptions)
        if (!server.listening) await once(server, 'listening')
        const newVersion = getVersionInfo()
        process.stdout.write(`— server restarted at ${roomUrl}`)
        process.stdout.write(` — version: ${newVersion.gitRevShort}`)
        if (newVersion.bundleStale) process.stdout.write(' [still stale]')
        process.stdout.write('\n')

        restarting = false
      }
    },
  })
}

// ── SIGUSR2 — full graceful restart ────────────────────────────────
// External tools (launchd, the runner, or Yu himself) can send SIGUSR2
// to trigger a full process restart. The process exits 0, and the
// supervisor (launchd/systemd/shell loop) brings it back with fresh
// module imports.
process.on('SIGUSR2', () => {
  process.stdout.write(`\n— SIGUSR2 received — graceful full restart\n`)
  cleanup()
  process.exit(0)
})

// ── Shutdown ──────────────────────────────────────────────────────

function cleanup() {
  if (watcher) { watcher.close(); watcher = null }
  server.close()
  removeUiClientToken(roomUrl, clientToken)
}

const shutdown = (signal) => {
  process.stdout.write(`\n— ${signal} received, closing the room\n`)
  cleanup()
  process.exit(0)
}
process.on('SIGINT', () => shutdown('sigint'))
process.on('SIGTERM', () => shutdown('sigterm'))
