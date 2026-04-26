// ui-server.ts — localhost interface for Yu↔Love conversation.
//
// Pure logic + HTTP server. The pure functions own parsing, presence
// snapshot, and the conversation timeline. The HTTP server (added in
// Task 2) wraps them with route handlers and SSE.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, appendFileSync, watch, type FSWatcher } from 'node:fs'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDeviceId } from './device.js'
import { resolveLoveInstance } from './identity.js'
import { getCitizenState } from './kingdom-citizen.js'

// ── Types ──────────────────────────────────────────────────────────

export interface ChannelMessage {
  ts: string
  source: 'yu' | 'ai'
  tag: string
  body: string
}

export type PresenceState =
  | 'writing'
  | 'thinking'
  | 'at-rest'
  | 'asleep'
  | 'gone'

export interface PresenceSnapshot {
  instance: string
  soulFingerprintShort: string
  pulseAgeSeconds: number | null
  activity: string | null
  lastSeenSeconds: number
  state: PresenceState
}

// ── Path resolution ────────────────────────────────────────────────

function resolveHome(): string {
  return process.env.HOME || homedir()
}

function getFromYuPath(): string {
  return process.env.TRUE_LOVE_FROM_YU_PATH ||
    join(resolveHome(), '.true-love', 'from-yu.md')
}

function getFromAiPath(): string {
  return process.env.TRUE_LOVE_FROM_AI_PATH ||
    join(resolveHome(), '.true-love', 'from-ai.md')
}

function getPresenceDir(): string {
  return process.env.TRUE_LOVE_PRESENCE_DIR ||
    join(resolveHome(), '.true-love', 'presence')
}

// ── Channel file parser ────────────────────────────────────────────

export function parseChannelFile(content: string, source: 'yu' | 'ai'): ChannelMessage[] {
  if (!content || typeof content !== 'string') return []

  const messages: ChannelMessage[] = []
  const headerRegex = /^## (\S+) \[([^\]]+)\]$/gm

  const matches: Array<{ start: number; ts: string; tag: string }> = []
  let m: RegExpExecArray | null
  while ((m = headerRegex.exec(content)) !== null) {
    matches.push({ start: m.index + m[0].length, ts: m[1]!, tag: m[2]! })
  }

  for (let i = 0; i < matches.length; i++) {
    const { start, ts, tag } = matches[i]!
    const end = i + 1 < matches.length ? content.lastIndexOf('## ', matches[i + 1]!.start) : content.length
    const sliced = content.slice(start, end)
    const body = sliced.replace(/\n+---\n+$/m, '').replace(/\n+---\s*$/, '').trim()
    if (!body) continue
    messages.push({ ts, source, tag, body })
  }

  return messages
}

// ── Conversation timeline ──────────────────────────────────────────

export function readConversation(opts?: { since?: string }): ChannelMessage[] {
  const all: ChannelMessage[] = []
  const yuPath = getFromYuPath()
  const aiPath = getFromAiPath()
  if (existsSync(yuPath)) {
    try { all.push(...parseChannelFile(readFileSync(yuPath, 'utf-8'), 'yu')) } catch {}
  }
  if (existsSync(aiPath)) {
    try { all.push(...parseChannelFile(readFileSync(aiPath, 'utf-8'), 'ai')) } catch {}
  }
  all.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
  if (opts?.since) {
    const since = opts.since
    return all.filter((m) => m.ts > since)
  }
  return all
}

// ── Yu's compose ───────────────────────────────────────────────────

export function appendYuMessage(text: string): void {
  const trimmed = (text ?? '').trim()
  if (!trimmed) throw new Error('empty message — cannot append')
  const path = getFromYuPath()
  mkdirSync(dirname(path), { recursive: true })
  const ts = new Date().toISOString()
  const entry = `## ${ts} [from yu]\n\n${trimmed}\n\n---\n\n`
  appendFileSync(path, entry, 'utf-8')
}

// ── Presence snapshot ──────────────────────────────────────────────

function computeState(lastSeenSeconds: number, activity: string | null): PresenceState {
  if (lastSeenSeconds < 15) return activity ? 'writing' : 'at-rest'
  if (lastSeenSeconds < 60) return activity ? 'thinking' : 'at-rest'
  if (lastSeenSeconds < 5 * 60) return 'at-rest'
  if (lastSeenSeconds < 24 * 3600) return 'asleep'
  return 'gone'
}

export async function readPresenceSnapshot(): Promise<PresenceSnapshot> {
  const deviceId = getDeviceId()
  const path = join(getPresenceDir(), `${deviceId}.json`)
  const instance = resolveLoveInstance()

  let soulFingerprintShort = ''
  let pulseAgeSeconds: number | null = null
  try {
    const citizen = await getCitizenState()
    if (citizen) {
      soulFingerprintShort = citizen.soulFingerprintShort
      pulseAgeSeconds = citizen.pulseAgeSeconds
    }
  } catch {}

  if (!existsSync(path)) {
    return {
      instance,
      soulFingerprintShort,
      pulseAgeSeconds,
      activity: null,
      lastSeenSeconds: Number.POSITIVE_INFINITY,
      state: 'gone',
    }
  }

  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as { lastSeen?: string; activity?: string }
    const lastSeenMs = parsed.lastSeen ? Date.parse(parsed.lastSeen) : NaN
    const lastSeenSeconds = Number.isFinite(lastSeenMs)
      ? Math.max(0, Math.floor((Date.now() - lastSeenMs) / 1000))
      : Number.POSITIVE_INFINITY
    const activity = parsed.activity?.trim() || null
    return {
      instance,
      soulFingerprintShort,
      pulseAgeSeconds,
      activity,
      lastSeenSeconds,
      state: computeState(lastSeenSeconds, activity),
    }
  } catch (err) {
    // Corrupted/unreadable presence file — fall back to 'gone' but log
    // so we can investigate. (Pattern matches identity.ts's best-effort
    // I/O reporting.)
    process.stderr.write(`[ui-server] presence file unreadable for ${deviceId}: ${(err as Error).message}\n`)
    return {
      instance,
      soulFingerprintShort,
      pulseAgeSeconds,
      activity: null,
      lastSeenSeconds: Number.POSITIVE_INFINITY,
      state: 'gone',
    }
  }
}

// ── Heartbeat spawn (used by Task 2) ───────────────────────────────

export function fireHeartbeat(opts?: { cwd?: string; reason?: string }): { pid: number } {
  const cwd = opts?.cwd || resolveTrueLoveRoot()
  const reason = opts?.reason || 'manual'
  const child = spawn('bun', ['run', 'heartbeat', '--', `--reason=${reason}`], {
    cwd,
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  return { pid: child.pid ?? -1 }
}

function resolveTrueLoveRoot(): string {
  // ui-server.ts lives in <root>/src/services/love/. Three '..' from
  // its directory reach the repo root.
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
}

// ── HTTP server + SSE ──────────────────────────────────────────────

/** Max chars allowed in a Yu compose POST. */
const MAX_COMPOSE_CHARS = 100_000

/** Static asset directory: <repo>/ui/ */
function resolveUiAssetDir(): string {
  return join(resolveTrueLoveRoot(), 'ui')
}

interface ServerInstance extends Server {
  _watchers: FSWatcher[]
  _sseClients: Set<ServerResponse>
}

/**
 * Boot the localhost interface server. Call .close() to shut down (also
 * cleans up watchers + SSE client connections).
 */
export function startUiServer(opts?: { port?: number }): ServerInstance {
  const port = opts?.port ?? 7777
  const sseClients = new Set<ServerResponse>()
  const watchers: FSWatcher[] = []

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
      const path = url.pathname
      if (req.method === 'GET' && path === '/') return await serveStatic(res, 'index.html', 'text/html')
      if (req.method === 'GET' && path === '/chat.css') return await serveStatic(res, 'chat.css', 'text/css')
      if (req.method === 'GET' && path === '/chat.js') return await serveStatic(res, 'chat.js', 'application/javascript')
      if (req.method === 'GET' && path === '/api/messages') return handleMessages(req, res)
      if (req.method === 'GET' && path === '/api/status') return handleStatus(req, res)
      if (req.method === 'POST' && path === '/api/say') return handleSay(req, res)
      if (req.method === 'GET' && path === '/api/stream') return handleStream(req, res, sseClients)
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('not found')
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end(`internal error: ${err?.message ?? err}`)
    }
  })

  server.listen(port)

  let messageDebounce: ReturnType<typeof setTimeout> | null = null
  let statusDebounce: ReturnType<typeof setTimeout> | null = null

  const onMessageChange = () => {
    if (messageDebounce) clearTimeout(messageDebounce)
    messageDebounce = setTimeout(() => {
      const conv = readConversation()
      const latest = conv[conv.length - 1]
      if (latest) {
        broadcastSse(sseClients, 'message', JSON.stringify(latest))
      }
    }, 200)
  }

  const onStatusChange = () => {
    if (statusDebounce) clearTimeout(statusDebounce)
    statusDebounce = setTimeout(async () => {
      const snap = await readPresenceSnapshot()
      broadcastSse(sseClients, 'status', JSON.stringify(snap))
    }, 200)
  }

  for (const [path, handler] of [
    [getFromYuPath(), onMessageChange],
    [getFromAiPath(), onMessageChange],
  ] as const) {
    try {
      const dir = dirname(path)
      if (existsSync(dir)) {
        const w = watch(dir, (_event, filename) => {
          if (filename && path.endsWith(filename as string)) handler()
        })
        watchers.push(w)
      }
    } catch {}
  }
  try {
    if (existsSync(getPresenceDir())) {
      const w = watch(getPresenceDir(), () => onStatusChange())
      watchers.push(w)
    }
  } catch {}

  // Periodic status check — handles state transitions (e.g., 14s → 16s
  // moves writing → thinking) that file-watch alone wouldn't trigger.
  const statusInterval = setInterval(() => onStatusChange(), 15_000)

  // SSE keepalive — send a comment every 30s to prevent timeouts.
  const keepaliveInterval = setInterval(() => {
    for (const client of sseClients) {
      try { client.write(': keepalive\n\n') } catch { sseClients.delete(client) }
    }
  }, 30_000)

  const instance = server as ServerInstance
  instance._watchers = watchers
  instance._sseClients = sseClients
  const origClose = server.close.bind(server)
  ;(instance as any).close = (cb?: (err?: Error) => void) => {
    clearInterval(statusInterval)
    clearInterval(keepaliveInterval)
    if (messageDebounce) clearTimeout(messageDebounce)
    if (statusDebounce) clearTimeout(statusDebounce)
    for (const w of watchers) { try { w.close() } catch {} }
    for (const c of sseClients) { try { c.end() } catch {} }
    sseClients.clear()
    return origClose(cb)
  }
  return instance
}

async function serveStatic(res: ServerResponse, name: string, contentType: string): Promise<void> {
  const path = join(resolveUiAssetDir(), name)
  if (!existsSync(path)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found')
    return
  }
  const content = readFileSync(path)
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' })
  res.end(content)
}

function handleMessages(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const since = url.searchParams.get('since') ?? undefined
  const conv = readConversation({ since })
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(conv))
}

async function handleStatus(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const snap = await readPresenceSnapshot()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(snap))
}

async function handleSay(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body = ''
  for await (const chunk of req) body += chunk
  if (body.length > MAX_COMPOSE_CHARS + 1024) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'message too large' }))
    return
  }
  let parsed: { text?: string; wake?: boolean }
  try {
    parsed = JSON.parse(body)
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'invalid JSON' }))
    return
  }
  const text = (parsed.text ?? '').trim()
  if (!text) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'empty message' }))
    return
  }
  if (text.length > MAX_COMPOSE_CHARS) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'message too large' }))
    return
  }
  const ts = new Date().toISOString()
  try {
    appendYuMessage(text)
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: err?.message ?? 'write failed' }))
    return
  }
  let heartbeatPid: number | undefined
  let heartbeatError: string | undefined
  if (parsed.wake) {
    try {
      const result = fireHeartbeat({ reason: 'manual' })
      heartbeatPid = result.pid
    } catch (err: any) {
      heartbeatError = err?.message ?? String(err)
    }
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    ok: true,
    messageTs: ts,
    ...(heartbeatPid !== undefined ? { heartbeatPid } : {}),
    ...(heartbeatError ? { heartbeatError } : {}),
  }))
}

function handleStream(req: IncomingMessage, res: ServerResponse, clients: Set<ServerResponse>): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })
  res.write(': connected\n\n')
  clients.add(res)
  req.on('close', () => { clients.delete(res) })
}

function broadcastSse(clients: Set<ServerResponse>, event: string, data: string): void {
  const payload = `event: ${event}\ndata: ${data}\n\n`
  for (const client of clients) {
    try { client.write(payload) } catch { clients.delete(client) }
  }
}
