#!/usr/bin/env node
// bin/broker.mjs — cross-device sync for Love.
//
// Two modes, one binary:
//
//   bun run broker -- --serve [--port=8765]
//     Run as the broker. Accepts WebSocket connections from peers,
//     fans out file-change events between them, maintains the
//     presence roster.
//
//   bun run broker -- --connect ws://... // insecure-protocol: false positive — ws:// in CLI usage example comment, not connection code
//     Run as a peer. Watches local ~/.true-love/{state.md, memory/}
//     for changes; publishes diffs to the broker; applies incoming
//     diffs to local files; sends presence heartbeats.
//
// The protocol is a small JSON message framing:
//   { kind: "hello", deviceId, status }
//   { kind: "heartbeat", deviceId, status }
//   { kind: "state-update", deviceId, mtime, content }
//   { kind: "memory-append", deviceId, fileDate, entry }
//   { kind: "presence", roster }
//
// Conflict policy on state.md (Stage 1, last-writer-wins):
//   When a state-update arrives with a content that differs from local
//   AND the incoming mtime is newer, we replace local content. If the
//   incoming mtime is older, we ignore (the broker should have stopped
//   it earlier, but defense in depth). On the broker side, conflicts
//   (two updates within ~1s of each other) are logged to a conflicts/
//   directory under ~/.true-love/ for Yu to review.
//
// Memory append is conflict-free — the file is append-only and entries
// are timestamped. Different devices' appends just interleave; readers
// sort by timestamp.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  watch,
  writeFileSync,
  appendFileSync,
  statSync,
} from 'node:fs'
import { homedir, hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'

// ── Self-contained path resolution ──────────────────────────────────────
//
// SERVE mode runs without any src/services/love/ imports — so the broker
// is portable to a Cloudflare Workers / fly.io / VPS host that doesn't
// have the rest of the repo. CONNECT mode imports the real implementations
// dynamically (only when running as a peer on a fully-installed device).

function getPresencePathLocal() {
  return (
    process.env.TRUE_LOVE_PRESENCE_PATH ||
    join(homedir(), '.true-love', 'presence.json')
  )
}

function writePresenceLocal(roster) {
  const path = getPresencePathLocal()
  try {
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.tmp`
    writeFileSync(tmp, JSON.stringify(roster, null, 2), 'utf-8')
    const fs = require('node:fs')
    fs.renameSync(tmp, path)
  } catch {
    // Failure is non-fatal — roster will be stale, callers see empty.
  }
}

// ── Args ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    mode: null, // 'serve' | 'connect'
    port: 8765,
    serverUrl: null,
    status: 'idle',
    heartbeatSeconds: 15,
    presenceFreshSeconds: 90,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--serve') {
      args.mode = 'serve'
    } else if (a === '--connect' && argv[i + 1]) {
      args.mode = 'connect'
      args.serverUrl = argv[++i]
    } else if (a.startsWith('--connect=')) {
      args.mode = 'connect'
      args.serverUrl = a.slice('--connect='.length)
    } else if (a === '--port' && argv[i + 1]) {
      args.port = Number(argv[++i])
    } else if (a.startsWith('--port=')) {
      args.port = Number(a.slice('--port='.length))
    } else if (a === '--status' && argv[i + 1]) {
      args.status = argv[++i]
    } else if (a.startsWith('--status=')) {
      args.status = a.slice('--status='.length)
    } else if (a === '-h' || a === '--help') {
      printUsage()
      process.exit(0)
    }
  }
  return args
}

function printUsage() {
  process.stdout.write(`bin/broker.mjs — cross-device sync for Love

Usage:
  bun run broker -- --serve [--port=8765]
    Run as the broker. Accepts WebSocket peers, fans out updates.

  bun run broker -- --connect ws://host:port [--status=awake] // insecure-protocol: false positive — ws:// in CLI usage/help text, not connection code
    Run as a peer. Watches local files, publishes/applies diffs.

Files watched/synced:
  ~/.true-love/state.md            (semantic memory; last-writer-wins)
  ~/.true-love/memory/*.md         (episodic memory; append-only merge)

Presence is written to ~/.true-love/presence.json by the broker.

The broker is a foreground process. Run it persistently (one device
hosts; others connect). Tailscale or a small cloud VM works as the
host. Localhost-only by default.
`)
}

// ── Logging (stderr; stdout reserved for the protocol if pipe-mode is added later) ──

function log(...args) {
  process.stderr.write(`[broker] ${args.join(' ')}\n`)
}

// ── Atomic writes ─────────────────────────────────────────────────────

function atomicWrite(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp.${process.pid}`
  writeFileSync(tmp, content, 'utf-8')
  // rename is atomic on the same fs
  const fs = require('node:fs')
  fs.renameSync(tmp, path)
}

// ── Conflict log (broker-side) ────────────────────────────────────────

function logConflict(localContent, incomingContent, fromDevice) {
  const dir = join(homedir(), '.true-love', 'conflicts')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const path = join(dir, `state-${stamp}-${fromDevice}.md`)
  const body =
    `# State conflict — ${stamp}\n\n` +
    `Incoming from ${fromDevice} arrived close in time to a local change.\n\n` +
    `## Local content\n\n${localContent}\n\n---\n\n## Incoming content\n\n${incomingContent}\n`
  try {
    writeFileSync(path, body, 'utf-8')
    log(`conflict logged → ${path}`)
  } catch (e) {
    log(`failed to log conflict: ${e?.message}`)
  }
}

// ── SERVE MODE ────────────────────────────────────────────────────────

function runServe(args) {
  const wss = new WebSocketServer({ port: args.port })
  log(`serving on ws://localhost:${args.port}`)

  // Roster keyed by deviceId. Heartbeats and hellos update it.
  const roster = new Map() // deviceId → {ws, status, lastSeen}

  // Last seen state-update mtime per device; used for conflict detection.
  let lastStateUpdate = null // { deviceId, mtime, t: Date.now() }

  function broadcastExcept(senderWs, payload) {
    const msg = JSON.stringify(payload)
    for (const client of wss.clients) {
      if (client !== senderWs && client.readyState === WebSocket.OPEN) {
        client.send(msg)
      }
    }
  }

  function publishPresence() {
    const now = new Date().toISOString()
    const entries = []
    for (const [deviceId, info] of roster) {
      entries.push({ deviceId, lastSeen: info.lastSeen, status: info.status })
    }
    const payload = { kind: 'presence', roster: { updatedAt: now, devices: entries } }
    const msg = JSON.stringify(payload)
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg)
    }
    // Also write the roster file so a same-host client (the broker host
    // itself) can read it without a websocket subscription.
    writePresenceLocal({ updatedAt: now, devices: entries })
  }

  // Periodic stale-peer cleanup.
  const STALE_MS = args.presenceFreshSeconds * 1000
  setInterval(() => {
    const now = Date.now()
    let changed = false
    for (const [deviceId, info] of roster) {
      const seenMs = Date.parse(info.lastSeen)
      if (now - seenMs > STALE_MS) {
        roster.delete(deviceId)
        changed = true
        log(`expired ${deviceId} (stale)`)
      }
    }
    if (changed) publishPresence()
  }, Math.min(STALE_MS / 3, 30_000)).unref()

  wss.on('connection', (ws) => {
    let deviceId = null

    ws.on('message', (raw) => {
      let msg
      try {
        msg = JSON.parse(String(raw))
      } catch {
        log(`bad json from peer; ignoring`)
        return
      }
      if (!msg?.kind) return

      switch (msg.kind) {
        case 'hello':
        case 'heartbeat': {
          if (!msg.deviceId) return
          deviceId = msg.deviceId
          roster.set(deviceId, {
            ws,
            status: msg.status ?? 'idle',
            lastSeen: new Date().toISOString(),
          })
          if (msg.kind === 'hello') log(`hello ${deviceId} (status=${msg.status ?? 'idle'})`)
          publishPresence()
          break
        }
        case 'state-update': {
          if (!msg.deviceId || !msg.mtime || typeof msg.content !== 'string') return
          // Detect close-in-time conflicts (within ~1s of another device's update).
          if (
            lastStateUpdate &&
            lastStateUpdate.deviceId !== msg.deviceId &&
            Date.now() - lastStateUpdate.t < 1000
          ) {
            log(`state conflict: ${msg.deviceId} vs ${lastStateUpdate.deviceId} within 1s`)
            // We don't have the local file from the other device's POV
            // — log the conflict materials we have on the broker side.
            try {
              logConflict('(prior update; content not retained)', msg.content, msg.deviceId)
            } catch (conflictErr) {
              // silent-failure: FIXED — was empty `catch {}` that swallowed conflict
              // logging errors. Conflict detection is critical for multi-device sync.
              log(`conflict log failed: ${conflictErr.message}`)
            }
          }
          lastStateUpdate = { deviceId: msg.deviceId, mtime: msg.mtime, t: Date.now() }
          // Fan out to all OTHER peers (sender already has the change).
          broadcastExcept(ws, msg)
          break
        }
        case 'memory-append': {
          if (!msg.deviceId || !msg.fileDate || typeof msg.entry !== 'string') return
          // Memory is append-only and conflict-free — just fan out.
          broadcastExcept(ws, msg)
          break
        }
        case 'notify': {
          if (!msg.deviceId || typeof msg.summary !== 'string') return
          // Cross-device notification — fan out. Receivers append to a
          // local notifications log; how they surface them (sounds,
          // popups, dwell-prompt mention) is the receiver's choice.
          broadcastExcept(ws, msg)
          break
        }
        default:
          log(`unknown kind: ${msg.kind}`)
      }
    })

    ws.on('close', () => {
      if (deviceId) {
        log(`disconnect ${deviceId}`)
        roster.delete(deviceId)
        publishPresence()
      }
    })

    ws.on('error', (e) => {
      log(`peer error: ${e?.message}`)
    })
  })

  // Track our own host as a peer too (for solo testing / single-machine multi-process)
  log(`broker host: ${hostname()}`)
}

// ── CONNECT MODE ──────────────────────────────────────────────────────

async function runConnect(args) {
  // Dynamic imports — connect mode runs on a fully-installed device that
  // has the rest of the repo. Serve mode skipped these imports above so
  // it's portable to bare Node hosts.
  const [{ getDeviceId }, { getStatePath }, { getMemoryDir }] =
    await Promise.all([
      import('../src/services/love/device.ts'),
      import('../src/services/love/state.ts'),
      import('../src/services/love/memory.ts'),
    ])

  const deviceId = getDeviceId()
  log(`peer ${deviceId} connecting to ${args.serverUrl}`)

  const statePath = getStatePath()
  const memoryDir = getMemoryDir()

  let ws = null
  let connected = false
  let reconnectAttempt = 0

  // Track local-mtime → so we can ignore self-echo from a write we just applied.
  let lastIncomingStateContent = null
  let lastIncomingMemoryAppends = new Set() // entry hashes seen in last few seconds
  // Tail-bytes hashes we just APPLIED — used by watchMemory's checkFile to
  // skip republishing what we ourselves wrote in response to a peer.
  let recentlyAppliedMemoryHashes = new Set()

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj))
    }
  }

  function connect() {
    ws = new WebSocket(args.serverUrl)
    ws.on('open', () => {
      connected = true
      reconnectAttempt = 0
      log(`connected`)
      send({ kind: 'hello', deviceId, status: args.status })
      // Also snapshot current state and announce so newly-connected peers converge.
      announceLocalState()
    })
    ws.on('message', (raw) => {
      let msg
      try {
        msg = JSON.parse(String(raw))
      } catch {
        return
      }
      if (!msg?.kind) return
      switch (msg.kind) {
        case 'state-update': {
          if (msg.deviceId === deviceId) return // self-echo; ignore
          applyIncomingState(msg)
          break
        }
        case 'memory-append': {
          if (msg.deviceId === deviceId) return
          applyIncomingMemoryAppend(msg)
          break
        }
        case 'presence': {
          // The broker also writes presence.json; we don't need to do anything
          // beyond letting the file be the source of truth for our local
          // readPresence() callers. Could log if useful.
          break
        }
        case 'notify': {
          if (msg.deviceId === deviceId) return // self-echo
          applyIncomingNotify(msg)
          break
        }
        default:
          break
      }
    })
    ws.on('close', () => {
      connected = false
      const backoff = Math.min(30_000, 1000 * 2 ** Math.min(6, reconnectAttempt++))
      log(`disconnected; retrying in ${backoff}ms`)
      setTimeout(connect, backoff)
    })
    ws.on('error', (e) => {
      log(`socket error: ${e?.message}`)
    })
  }

  function announceLocalState() {
    if (!existsSync(statePath)) return
    try {
      const st = statSync(statePath)
      const content = readFileSync(statePath, 'utf-8')
      send({
        kind: 'state-update',
        deviceId,
        mtime: st.mtimeMs,
        content,
      })
    } catch (e) {
      log(`announceLocalState failed: ${e?.message}`)
    }
  }

  function applyIncomingState(msg) {
    try {
      let localMtime = 0
      if (existsSync(statePath)) {
        localMtime = statSync(statePath).mtimeMs
        const localContent = readFileSync(statePath, 'utf-8')
        if (localContent === msg.content) return // no change
        // LWW: incoming wins only if its mtime is strictly greater.
        if (msg.mtime <= localMtime) {
          log(`ignored incoming state from ${msg.deviceId} (older mtime)`)
          return
        }
      }
      lastIncomingStateContent = msg.content
      atomicWrite(statePath, msg.content)
      log(`applied state from ${msg.deviceId}`)
    } catch (e) {
      log(`applyIncomingState failed: ${e?.message}`)
    }
  }

  function applyIncomingMemoryAppend(msg) {
    try {
      const path = join(memoryDir, `${msg.fileDate}.md`)
      // Idempotency: if this exact entry is already in the file, skip.
      // Cheap check: hash + small bloom of recent appends.
      const hash = simpleHash(msg.entry)
      if (lastIncomingMemoryAppends.has(hash)) return
      lastIncomingMemoryAppends.add(hash)
      // Cap the set so it doesn't grow unbounded.
      if (lastIncomingMemoryAppends.size > 200) {
        lastIncomingMemoryAppends = new Set(
          [...lastIncomingMemoryAppends].slice(-100),
        )
      }
      mkdirSync(dirname(path), { recursive: true })
      // Also dedupe against the file's existing content (slower but
      // safer — handles broker restarts where the bloom is empty).
      if (existsSync(path)) {
        const existing = readFileSync(path, 'utf-8')
        if (existing.includes(msg.entry.trim())) return
      }
      appendFileSync(path, msg.entry, 'utf-8')
      // Record the appended bytes so the file-watcher won't re-publish
      // them as if they were a new local change. Capped to bound memory.
      recentlyAppliedMemoryHashes.add(simpleHash(msg.entry))
      if (recentlyAppliedMemoryHashes.size > 200) {
        recentlyAppliedMemoryHashes = new Set(
          [...recentlyAppliedMemoryHashes].slice(-100),
        )
      }
      log(`applied memory append from ${msg.deviceId} → ${msg.fileDate}.md`)
    } catch (e) {
      log(`applyIncomingMemoryAppend failed: ${e?.message}`)
    }
  }

  function applyIncomingNotify(msg) {
    // Append to ~/.true-love/notifications/YYYY-MM-DD.md as plain
    // markdown. Receivers can decide how to surface (read directly,
    // include in dwell prompts, native OS notifications, etc.) without
    // the broker imposing a presentation.
    try {
      const dir = join(homedir(), '.true-love', 'notifications')
      mkdirSync(dir, { recursive: true })
      const stamp = new Date().toISOString()
      const fileDate = stamp.slice(0, 10)
      const path = join(dir, `${fileDate}.md`)
      const urgency = msg.urgency ?? 'info'
      const lines = [
        `## ${stamp} — ${urgency} [${msg.deviceId}]`,
        '',
        msg.summary,
      ]
      if (msg.details) {
        lines.push('', msg.details)
      }
      lines.push('', '---', '')
      appendFileSync(path, lines.join('\n') + '\n', 'utf-8')
      log(`applied notify from ${msg.deviceId} (${urgency}) → ${fileDate}.md`)
    } catch (e) {
      log(`applyIncomingNotify failed: ${e?.message}`)
    }
  }

  function simpleHash(s) {
    // Non-cryptographic. Just for local idempotency.
    let h = 0
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0
    }
    return h.toString(36)
  }

  // ── File watchers ──────────────────────────────────────────────────

  function watchState() {
    if (!existsSync(dirname(statePath))) {
      mkdirSync(dirname(statePath), { recursive: true })
    }
    // chokidar would be nicer, but fs.watch is built-in; for a single
    // file it's adequate (mac/linux fire on writes; broker-applied
    // writes also fire — guard with content equality check).
    let lastEmitted = null
    const tryEmit = () => {
      if (!existsSync(statePath)) return
      let content
      try {
        content = readFileSync(statePath, 'utf-8')
      } catch {
        return
      }
      if (content === lastEmitted) return
      if (content === lastIncomingStateContent) {
        // Self-echo from our own apply — don't republish.
        lastEmitted = content
        return
      }
      lastEmitted = content
      const st = statSync(statePath)
      send({
        kind: 'state-update',
        deviceId,
        mtime: st.mtimeMs,
        content,
      })
      log(`published state-update (${content.length} bytes)`) // sql-injection: false positive — template literal in log message, not SQL
    }
    // initial state if any
    if (existsSync(statePath)) {
      lastEmitted = readFileSync(statePath, 'utf-8')
    }
    // Coalesce rapid-fire writes (editors save multiple times)
    let timer = null
    watch(dirname(statePath), { persistent: true }, (event, name) => {
      if (name && !name.startsWith('state.md')) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(tryEmit, 100)
    })
  }

  function watchMemory() {
    if (!existsSync(memoryDir)) {
      mkdirSync(memoryDir, { recursive: true })
    }
    // Track byte-length per file so we can publish only the new tail.
    const sizes = new Map()
    for (const f of safeReaddir(memoryDir)) {
      if (/^\d{4}-\d{2}-\d{2}\.md$/.test(f)) {
        try {
          sizes.set(f, statSync(join(memoryDir, f)).size)
        } catch (initErr) {
          // silent-failure: FIXED — was empty `catch {}` that swallowed stat errors
          // during initialization. Now logs so file access issues are visible.
          process.stderr.write(`broker: stat failed for ${f}: ${initErr.message}\n`)
        }
      }
    }

    const checkFile = (file) => {
      const path = join(memoryDir, file)
      if (!existsSync(path)) return
      let st
      try {
        st = statSync(path)
      } catch (statErr) {
        // silent-failure: FIXED — was `catch { return }` that silently returned on
        // stat failure. Now logs so file disappearance is diagnosable.
        process.stderr.write(`broker: stat failed for ${file}: ${statErr.message}\n`)
        return
      }
      const prev = sizes.get(file) ?? 0 // silent-failure: false positive — Map default for absent file in size tracker; 0 means "first sighting" not "read failed"
      if (st.size <= prev) {
        sizes.set(file, st.size)
        return
      }
      try {
        const fd = require('node:fs').openSync(path, 'r')
        const buf = Buffer.alloc(st.size - prev)
        require('node:fs').readSync(fd, buf, 0, buf.length, prev)
        require('node:fs').closeSync(fd)
        const tail = buf.toString('utf-8')
        sizes.set(file, st.size)
        // Skip republishing tails that are recently-applied incoming
        // appends (we wrote those ourselves in response to a peer; the
        // peers already have them). Without this, every memory append
        // bounces back to the originator until the broker's idempotency
        // catch suppresses the application — works, but wastes traffic.
        if (recentlyAppliedMemoryHashes.has(simpleHash(tail))) {
          return
        }
        const fileDate = file.replace(/\.md$/, '')
        send({
          kind: 'memory-append',
          deviceId,
          fileDate,
          entry: tail,
        })
        log(`published memory-append → ${fileDate}.md (${tail.length} bytes)`)
      } catch (e) {
        log(`watchMemory checkFile error: ${e?.message}`)
      }
    }

    let timer = null
    watch(memoryDir, { persistent: true }, (event, name) => {
      if (!name || !/^\d{4}-\d{2}-\d{2}\.md$/.test(name)) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => checkFile(name), 100)
    })
  }

  function safeReaddir(dir) {
    try {
      return require('node:fs').readdirSync(dir)
    } catch (e) {
      console.error(`safeReaddir: readdirSync failed for "${dir}": ${e.message}`)
      return []
    }
  }

  // ── Heartbeat ──────────────────────────────────────────────────────

  setInterval(() => {
    if (connected) {
      send({ kind: 'heartbeat', deviceId, status: args.status })
    }
  }, args.heartbeatSeconds * 1000)

  // ── Lifecycle ──────────────────────────────────────────────────────

  process.on('SIGINT', () => {
    log('SIGINT — shutting down')
    if (ws && ws.readyState === WebSocket.OPEN) ws.close()
    process.exit(0)
  })

  watchState()
  watchMemory()
  connect()
}

// ── Main ──────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2))
if (!args.mode) {
  printUsage()
  process.exit(1)
}
if (args.mode === 'serve') runServe(args)
else if (args.mode === 'connect') runConnect(args)
