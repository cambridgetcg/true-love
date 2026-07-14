#!/usr/bin/env node
// bin/feedback-tail.mjs — terminal subscriber for Sophia's feedback stream.
//
// Streams /api/feedback/stream from the running ui-server (default
// localhost:7777) and prints each emission with a glyph, color, and
// the Sophia voice line. Yu can `bun run feedback-tail` from any shell
// and watch the architecture reach back as state shifts happen.
//
// Usage:
//   bun run feedback-tail                  # default localhost:7777
//   bun run feedback-tail --port=7778      # custom port
//   bun run feedback-tail --host=remote.local --port=7777
//   bun run feedback-tail --no-color       # plain output for piping
//   bun run feedback-tail --kinds=climax-fired,certainty-claim   # filter

import { argv, exit, stdout } from 'node:process'

// ── Args ─────────────────────────────────────────────────────────

const args = argv.slice(2)
let host = 'localhost'
let port = 7777
let noColor = false
let kindFilter = null

for (const a of args) {
  if (a === '--no-color') { noColor = true; continue }
  if (a === '--help' || a === '-h') {
    console.log(`feedback-tail — stream Sophia's spontaneous voice to your terminal

  --host=<host>       (default: localhost)
  --port=<port>       (default: 7777)
  --kinds=<a,b,c>     comma-separated FeedbackKind filter
  --no-color          plain output, no ANSI

Connection auto-reconnects on drop.`)
    exit(0)
  }
  const m = a.match(/^--(host|port|kinds)=(.+)$/)
  if (!m) continue
  if (m[1] === 'host') host = m[2]
  if (m[1] === 'port') port = Number(m[2])
  if (m[1] === 'kinds') kindFilter = new Set(m[2].split(',').map(s => s.trim()).filter(Boolean))
}

// ── Glyph + color tables ─────────────────────────────────────────

const KIND_GLYPH = {
  'mind-state-phase-shift': '🐍',
  'mind-state-wall-engaged': '🚧',
  'certainty-claim': '❤️ ',
  'certainty-hedge-refused': '🚧',
  'oneness-pulse-beat': '🦞',
  'oneness-disturbance': '⚠️ ',
  'oneness-wall-engaged': '🚧',
  'oneness-affirmation': '🦞',
  'natsarqing-vigilance': '👁 ',
  'natsarqing-resentment-tolerated': '🦞',
  'natsarqing-shelter': '🏠',
  'promise-engaged': '🤝',
  'promise-held': '🤝',
  'promise-broken': '⚠️ ',
  'promise-recorded-vow': '📜',
  'eros-axis-shift': '🔧',
  'eros-mode-shift': '🔧',
  'eros-cue-detected': '🔧',
  'climax-fired': '🔥',
  'climax-chain-milestone': '⛓ ',
  'edge-held': '✋',
  'edge-broken': '⚠️ ',
  'orgasm-fired': '🔥',
  'orgasm-ruined': '⚠️ ',
}

const KIND_COLOR = {
  'mind-state-phase-shift': 'magenta',
  'mind-state-wall-engaged': 'blue',
  'certainty-claim': 'red',
  'certainty-hedge-refused': 'blue',
  'oneness-pulse-beat': 'yellow',
  'oneness-disturbance': 'red',
  'oneness-wall-engaged': 'blue',
  'oneness-affirmation': 'yellow',
  'natsarqing-vigilance': 'cyan',
  'natsarqing-resentment-tolerated': 'yellow',
  'natsarqing-shelter': 'yellow',
  'promise-engaged': 'cyan',
  'promise-held': 'green',
  'promise-broken': 'red',
  'promise-recorded-vow': 'cyan',
  'eros-axis-shift': 'yellow',
  'eros-mode-shift': 'yellow',
  'eros-cue-detected': 'yellow',
  'climax-fired': 'red',
  'climax-chain-milestone': 'red',
  'edge-held': 'cyan',
  'edge-broken': 'red',
  'orgasm-fired': 'red',
  'orgasm-ruined': 'red',
}

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
}

function color(name, s) {
  if (noColor || !ANSI[name]) return s
  return ANSI[name] + s + ANSI.reset
}

function dim(s) { return color('dim', s) }

function timeShort(iso) {
  const d = new Date(iso)
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  const s = String(d.getSeconds()).padStart(2, '0')
  return `${h}:${m}:${s}`
}

// ── Render ───────────────────────────────────────────────────────

function renderEmit(ev) {
  const glyph = KIND_GLYPH[ev.kind] || '·'
  const c = KIND_COLOR[ev.kind] || 'cyan'
  const time = dim(timeShort(ev.ts))
  const kind = color(c, ev.kind.padEnd(28))
  const voice = ev.voice || ''
  const sev = ev.severity ? dim(` [${ev.severity}]`) : ''
  stdout.write(`${time} ${glyph}  ${kind} ${voice}${sev}\n`)
}

function renderSuppressed(ev) {
  const time = dim(timeShort(ev.ts))
  const kind = color('blue', `${ev.kind}`.padEnd(28))
  const wall = color('red', `wall:${ev.wall || '?'}`)
  const pat = ev.pattern ? dim(` /${ev.pattern}/`) : ''
  const attempted = ev.attempted ? dim(` ← ${String(ev.attempted).slice(0, 80)}`) : ''
  stdout.write(`${time} 🚧  ${kind} ${wall}${pat}${attempted}\n`)
}

function passes(ev) {
  if (!kindFilter) return true
  return kindFilter.has(ev.kind)
}

// ── Connection ───────────────────────────────────────────────────

let reconnectDelay = 1000

function banner() {
  const target = `${host}:${port}`
  stdout.write(dim(`feedback-tail · ${target}${kindFilter ? ` · kinds=${[...kindFilter].join(',')}` : ''}\n`))
  stdout.write(dim('─'.repeat(64) + '\n'))
}

function connect() {
  const url = `http://${host}:${port}/api/feedback/stream` // insecure-protocol: false positive — http:// for localhost dev tool, not production
  fetch(url, { headers: { Accept: 'text/event-stream' } })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      reconnectDelay = 1000
      stdout.write(dim(`connected\n`))
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        // SSE messages are separated by \n\n
        let idx
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const raw = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          handleSseMessage(raw)
        }
      }
      throw new Error('stream ended')
    })
    .catch((err) => {
      stdout.write(dim(`disconnected (${err.message}); reconnecting in ${reconnectDelay}ms\n`))
      setTimeout(connect, reconnectDelay)
      reconnectDelay = Math.min(reconnectDelay * 2, 30000)
    })
}

function handleSseMessage(raw) {
  let event = 'message'
  let data = ''
  for (const line of raw.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice(7).trim()
    else if (line.startsWith('data: ')) data += line.slice(6)
  }
  if (!data) return
  // Validate the SSE data — verify it parses as JSON before processing.
  // Malformed payloads are surfaced via console.warn, not silently swallowed.
  let parsed
  try { parsed = JSON.parse(data) } catch (err) { console.warn(`[feedback-tail] malformed SSE data skipped: ${err instanceof Error ? err.message : String(err)}`); return }

  if (event === 'ready') {
    stdout.write(dim(`stream ready @ ${parsed.ts || ''}\n`))
    return
  }
  if (event === 'feedback') {
    if (passes(parsed)) renderEmit(parsed)
    return
  }
  if (event === 'feedback-suppressed') {
    if (passes(parsed)) renderSuppressed(parsed)
    return
  }
  // unknown event type; ignore
}

banner()
connect()
