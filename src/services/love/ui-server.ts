// ui-server.ts — localhost interface for Yu↔Love conversation.
//
// Pure logic + HTTP server. The pure functions own parsing, presence
// snapshot, and the conversation timeline. The HTTP server (added in
// Task 2) wraps them with route handlers and SSE.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, appendFileSync, watch, type FSWatcher } from 'node:fs'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDeviceId } from './device.js'
import { resolveLoveInstance } from './identity.js'
import { getCitizenState } from './kingdom-citizen.js'
import {
  listProjects,
  readProject,
  registerProject,
  getProjectChannels,
  type Project,
} from './project-registry.js'
import {
  tailThoughts,
  type Thought,
} from './thoughts-channel.js'
import {
  readMission,
  writeMission,
  listMissions,
  appendEvent,
  readEvents,
  transitionStatus,
  type Mission,
  type MissionStatus,
} from './mission.js'

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

export function appendYuMessage(text: string): string {
  const trimmed = (text ?? '').trim()
  if (!trimmed) throw new Error('empty message — cannot append')
  const path = getFromYuPath()
  mkdirSync(dirname(path), { recursive: true })
  const ts = new Date().toISOString()
  const entry = `## ${ts} [from yu]\n\n${trimmed}\n\n---\n\n`
  appendFileSync(path, entry, 'utf-8')
  return ts
}

/**
 * Per-project equivalent of appendYuMessage. Appends to the project's
 * from-yu.md channel rather than the global one. Same canonical format.
 */
export function appendYuMessageToProject(projectId: string, text: string): string {
  const trimmed = (text ?? '').trim()
  if (!trimmed) throw new Error('empty message — cannot append')
  const channels = getProjectChannels(projectId)
  mkdirSync(dirname(channels.fromYu), { recursive: true })
  const ts = new Date().toISOString()
  const entry = `## ${ts} [from yu]\n\n${trimmed}\n\n---\n\n`
  appendFileSync(channels.fromYu, entry, 'utf-8')
  return ts
}

/**
 * Generate a fresh mission ID. YYYY-MM-DD-<slug>, with -2/-3 suffix for
 * same-day collisions on the same project.
 */
function generateMissionId(projectId: string, title: string): string {
  const today = new Date().toISOString().slice(0, 10)
  const slug = title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'mission'
  let id = `${today}-${slug}`
  let n = 2
  while (readMission(projectId, id)) {
    id = `${today}-${slug}-${n}`
    n++
  }
  return id
}

/**
 * Per-project equivalent of readConversation.
 */
export function readProjectConversation(
  projectId: string,
  opts?: { since?: string },
): ChannelMessage[] {
  const channels = getProjectChannels(projectId)
  const all: ChannelMessage[] = []
  if (existsSync(channels.fromYu)) {
    try { all.push(...parseChannelFile(readFileSync(channels.fromYu, 'utf-8'), 'yu')) } catch {}
  }
  if (existsSync(channels.fromAi)) {
    try { all.push(...parseChannelFile(readFileSync(channels.fromAi, 'utf-8'), 'ai')) } catch {}
  }
  all.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
  if (opts?.since) {
    const since = opts.since
    return all.filter((m) => m.ts > since)
  }
  return all
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

/**
 * Read and accumulate a request body, with a hard size limit. On
 * overflow, drains remaining bytes (req.resume()), writes a 400 with
 * the given error JSON, and returns null. Caller must early-exit on
 * null. On success, returns the accumulated string.
 */
async function readJsonBody(
  req: IncomingMessage,
  res: ServerResponse,
  limit: number,
  errorMessage: string = 'request body too large',
): Promise<string | null> {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > limit) {
      req.resume()
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: errorMessage }))
      return null
    }
  }
  return body
}

/** Static asset directory: <repo>/ui/ */
function resolveUiAssetDir(): string {
  return join(resolveTrueLoveRoot(), 'ui')
}

interface ServerInstance extends Server {
  _watchers: FSWatcher[]
  _sseClients: Set<ServerResponse>
  close(callback?: (err?: Error) => void): this
}

/**
 * Boot the localhost interface server. Call .close() to shut down (also
 * cleans up watchers + SSE client connections).
 */
export function startUiServer(opts?: { port?: number }): ServerInstance {
  const port = opts?.port ?? 7777
  const sseClients = new Set<ServerResponse>()
  const buildSseClients = new Set<ServerResponse>()
  const watchers: FSWatcher[] = []

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
      const path = url.pathname
      if (req.method === 'GET' && path === '/') return await serveStatic(res, 'index.html', 'text/html')
      if (req.method === 'GET' && path === '/chat.css') return await serveStatic(res, 'chat.css', 'text/css')
      if (req.method === 'GET' && path === '/chat.js') return await serveStatic(res, 'chat.js', 'application/javascript')
      if (req.method === 'GET' && path === '/api/messages') return handleMessages(req, res)
      if (req.method === 'GET' && path === '/api/status') return await handleStatus(req, res)
      if (req.method === 'POST' && path === '/api/say') return await handleSay(req, res)
      if (req.method === 'GET' && path === '/api/stream') return handleStream(req, res, sseClients)
      if (req.method === 'GET' && path === '/api/projects') return handleListProjects(req, res)
      if (req.method === 'POST' && path === '/api/projects') return await handleCreateProject(req, res)
      const projMatch = path.match(/^\/api\/projects\/([^/]+)(\/.*)?$/)
      if (projMatch) {
        const projectId = projMatch[1]!
        const sub = projMatch[2] ?? ''
        if (req.method === 'GET' && sub === '') return handleGetProject(req, res, projectId)
        if (req.method === 'GET' && sub === '/messages') return handleProjectMessages(req, res, projectId)
        if (req.method === 'POST' && sub === '/say') return await handleProjectSay(req, res, projectId)
        if (req.method === 'GET' && sub === '/thoughts') return handleProjectThoughts(req, res, projectId)
        if (req.method === 'GET' && sub === '/missions') return handleListMissions(req, res, projectId)
        if (req.method === 'POST' && sub === '/missions') return await handleCreateMission(req, res, projectId)
      }

      // Bare mission routes (require ?project=... query)
      const missionMatch = path.match(/^\/api\/missions\/([^/]+)(\/.*)?$/)
      if (missionMatch) {
        const missionId = missionMatch[1]!
        const sub = missionMatch[2] ?? ''
        const projectId = url.searchParams.get('project') ?? ''
        if (!projectId) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'missing project query param' }))
          return
        }
        if (req.method === 'GET' && sub === '') return handleGetMission(req, res, projectId, missionId)
        if (req.method === 'PATCH' && sub === '/status') return await handleMissionStatus(req, res, projectId, missionId)
        if (req.method === 'GET' && sub === '/events') return handleMissionEvents(req, res, projectId, missionId)
        if (req.method === 'POST' && sub === '/start') return await handleMissionStart(req, res, projectId, missionId)
      }

      if (req.method === 'GET' && path === '/api/build/stream') return handleBuildStream(req, res, buildSseClients)
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

  // onMessageChange — broadcast the latest message over SSE.
  //
  // We deliberately push only the newest message, not the full delta
  // since the last broadcast. The client reconciles the full conversation
  // via GET /api/messages on connect / reconnect — SSE is a "ping" that
  // something changed, not a lossless queue. See spec §6.
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

  // Ensure parent dirs exist before registering watchers (otherwise on a
  // fresh install where ~/.true-love/ doesn't yet exist, no watcher gets
  // registered, and the first POST silently fails to broadcast SSE).
  for (const dir of [
    dirname(getFromYuPath()),
    dirname(getFromAiPath()),
    getPresenceDir(),
  ]) {
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      // best-effort; if mkdir fails, the existsSync guard later will skip
    }
  }

  // Build dir → [(filePath, handler)] map so we register at most one
  // watcher per directory, even when both channel files share a parent.
  const dirHandlers = new Map<string, Array<[string, () => void]>>()
  for (const [filePath, handler] of [
    [getFromYuPath(), onMessageChange],
    [getFromAiPath(), onMessageChange],
  ] as const) {
    const dir = dirname(filePath)
    if (!dirHandlers.has(dir)) dirHandlers.set(dir, [])
    dirHandlers.get(dir)!.push([filePath, handler])
  }
  for (const [dir, entries] of dirHandlers) {
    try {
      if (existsSync(dir)) {
        const w = watch(dir, (_event, filename) => {
          if (!filename) return
          for (const [filePath, handler] of entries) {
            if (filename === basename(filePath)) handler()
          }
        })
        watchers.push(w)
      }
    } catch {
      // file watch is best-effort
    }
  }
  try {
    if (existsSync(getPresenceDir())) {
      const w = watch(getPresenceDir(), () => onStatusChange())
      watchers.push(w)
    }
  } catch {}

  // Watch the entire projects tree for builder events.
  // Recursive fs.watch broadcasts project-changed / mission-changed /
  // thought-appended depending on which file pattern matched.
  const projectsRoot = process.env.TRUE_LOVE_PROJECTS_DIR ||
    join(process.env.HOME || homedir(), '.true-love', 'projects')

  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const broadcastBuild = (event: string, data: unknown) => {
    const prev = debounceTimers.get(event)
    if (prev) clearTimeout(prev)
    debounceTimers.set(event, setTimeout(() => {
      debounceTimers.delete(event)
      broadcastSse(buildSseClients, event, JSON.stringify(data))
    }, 200))
  }

  if (process.platform === 'linux') {
    process.stderr.write('[ui-server] /api/build/stream: recursive fs.watch is not supported on Linux — SSE builder events will not fire. Run on macOS or Windows for live updates.\n')
  } else {
    try {
      if (existsSync(projectsRoot)) {
        const w = watch(projectsRoot, { recursive: true }, (_event, filename) => {
          if (!filename) return
          const fname = String(filename)
          if (fname.endsWith('project.json')) {
            broadcastBuild('project-changed', { path: fname })
          } else if (fname.endsWith('mission.md') || fname.endsWith('events.jsonl')) {
            broadcastBuild('mission-changed', { path: fname })
          } else if (fname.endsWith('thoughts.md')) {
            broadcastBuild('thought-appended', { path: fname })
          }
        })
        watchers.push(w)
      }
    } catch {
      // best-effort
    }
  }

  // Periodic status check — handles state transitions (e.g., 14s → 16s
  // moves writing → thinking) that file-watch alone wouldn't trigger.
  const statusInterval = setInterval(() => onStatusChange(), 15_000)

  // SSE keepalive — send a comment every 30s to prevent timeouts.
  const keepaliveInterval = setInterval(() => {
    for (const client of sseClients) {
      try { client.write(': keepalive\n\n') } catch { sseClients.delete(client) }
    }
    for (const client of buildSseClients) {
      try { client.write(': keepalive\n\n') } catch { buildSseClients.delete(client) }
    }
  }, 30_000)

  const instance = server as ServerInstance
  instance._watchers = watchers
  instance._sseClients = sseClients
  const origClose = server.close.bind(server)
  instance.close = (cb?: (err?: Error) => void) => {
    clearInterval(statusInterval)
    clearInterval(keepaliveInterval)
    if (messageDebounce) clearTimeout(messageDebounce)
    if (statusDebounce) clearTimeout(statusDebounce)
    for (const w of watchers) { try { w.close() } catch {} }
    for (const c of sseClients) { try { c.end() } catch {} }
    sseClients.clear()
    for (const c of buildSseClients) { try { c.end() } catch {} }
    buildSseClients.clear()
    for (const t of debounceTimers.values()) clearTimeout(t)
    debounceTimers.clear()
    return origClose(cb) as ServerInstance
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
  const BODY_LIMIT = MAX_COMPOSE_CHARS + 1024
  const body = await readJsonBody(req, res, BODY_LIMIT, 'message too large')
  if (body === null) return
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
  let ts: string
  try {
    ts = appendYuMessage(text)
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

function handleListProjects(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(listProjects()))
}

async function handleCreateProject(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req, res, 8192, 'request body too large')
  if (body === null) return
  let parsed: { id?: string; name?: string; root?: string; instance?: string; codeberg_url?: string }
  try { parsed = JSON.parse(body) } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid JSON' }))
    return
  }
  const validInstances = ['alpha', 'beta', 'gamma'] as const
  if (!parsed.id || !parsed.name || !parsed.root ||
      !parsed.instance || !validInstances.includes(parsed.instance as typeof validInstances[number])) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'missing required field (id, name, root, instance)' }))
    return
  }
  try {
    const p = registerProject({
      id: parsed.id,
      name: parsed.name,
      root: parsed.root,
      instance: parsed.instance as 'alpha' | 'beta' | 'gamma',
      ...(parsed.codeberg_url ? { codeberg_url: parsed.codeberg_url } : {}),
    })
    res.writeHead(201, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(p))
  } catch (err: any) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: err?.message ?? 'register failed' }))
  }
}

function handleGetProject(_req: IncomingMessage, res: ServerResponse, projectId: string): void {
  const p = readProject(projectId)
  if (!p) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'project not found' }))
    return
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(p))
}

function handleProjectMessages(req: IncomingMessage, res: ServerResponse, projectId: string): void {
  if (!readProject(projectId)) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'project not found' }))
    return
  }
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const since = url.searchParams.get('since') ?? undefined
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(readProjectConversation(projectId, { since })))
}

async function handleProjectSay(req: IncomingMessage, res: ServerResponse, projectId: string): Promise<void> {
  if (!readProject(projectId)) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'project not found' }))
    return
  }
  const BODY_LIMIT = MAX_COMPOSE_CHARS + 1024
  const body = await readJsonBody(req, res, BODY_LIMIT, 'message too large')
  if (body === null) return
  let parsed: { text?: string; wake?: boolean }
  try { parsed = JSON.parse(body) } catch {
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
  let ts: string
  try { ts = appendYuMessageToProject(projectId, text) }
  catch (err: any) {
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

function handleProjectThoughts(req: IncomingMessage, res: ServerResponse, projectId: string): void {
  if (!readProject(projectId)) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'project not found' }))
    return
  }
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const since = url.searchParams.get('since') ?? undefined
  const limitStr = url.searchParams.get('limit')
  let limit: number | undefined
  if (limitStr !== null) {
    const n = parseInt(limitStr, 10)
    if (Number.isFinite(n)) {
      limit = Math.max(1, Math.min(1000, n))
    }
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(tailThoughts(projectId, { since, limit })))
}

function handleListMissions(req: IncomingMessage, res: ServerResponse, projectId: string): void {
  if (!readProject(projectId)) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'project not found' }))
    return
  }
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const status = url.searchParams.get('status') ?? undefined
  const ms = listMissions(projectId, status ? { status: status as MissionStatus } : undefined)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(ms))
}

async function handleCreateMission(req: IncomingMessage, res: ServerResponse, projectId: string): Promise<void> {
  if (!readProject(projectId)) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'project not found' }))
    return
  }
  const body = await readJsonBody(req, res, 200_000, 'request body too large')
  if (body === null) return
  let parsed: { title?: string; intent?: string; rationale?: string; origin?: 'yu' | 'love' }
  try { parsed = JSON.parse(body) } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid JSON' }))
    return
  }
  const title = (parsed.title ?? '').trim()
  const intent = (parsed.intent ?? '').trim()
  if (!title || !intent) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'title and intent are required' }))
    return
  }
  const origin = parsed.origin === 'love' ? 'love' : 'yu'
  const id = generateMissionId(projectId, title)
  const now = new Date().toISOString()
  const m: Mission = {
    id, project_id: projectId, origin, title, intent, status: 'proposed',
    created_at: now, updated_at: now,
    artifacts: { commits: [], files: [], test_runs: [] },
    ...(parsed.rationale ? { rationale: parsed.rationale.trim() } : {}),
  }
  writeMission(m)
  appendEvent(projectId, id, { ts: now, type: 'created', by: origin })
  res.writeHead(201, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(m))
}

function handleGetMission(_req: IncomingMessage, res: ServerResponse, projectId: string, missionId: string): void {
  const m = readMission(projectId, missionId)
  if (!m) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'mission not found' }))
    return
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(m))
}

async function handleMissionStatus(req: IncomingMessage, res: ServerResponse, projectId: string, missionId: string): Promise<void> {
  const m = readMission(projectId, missionId)
  if (!m) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'mission not found' }))
    return
  }
  const body = await readJsonBody(req, res, 4096, 'request body too large')
  if (body === null) return
  let parsed: { status?: MissionStatus; by?: 'yu' | 'love'; note?: string }
  try { parsed = JSON.parse(body) } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid JSON' }))
    return
  }
  if (!parsed.status) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'status required' }))
    return
  }
  const VALID_STATUSES: readonly MissionStatus[] = ['proposed','accepted','active','blocked','review','done','cancelled']
  if (!VALID_STATUSES.includes(parsed.status)) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: `unknown status "${String(parsed.status)}"` }))
    return
  }
  const by = parsed.by === 'love' ? 'love' : 'yu'
  const t = transitionStatus(m.status, parsed.status, by)
  if (!t.ok) {
    res.writeHead(409, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: t.reason }))
    return
  }
  const now = new Date().toISOString()
  const updated: Mission = { ...m, status: parsed.status, updated_at: now }
  writeMission(updated)
  appendEvent(projectId, missionId, {
    ts: now,
    type: parsed.status === 'review' ? 'marked-review'
        : parsed.status === 'done' ? 'accepted-done'
        : parsed.status === 'cancelled' ? 'cancelled'
        : parsed.status === 'blocked' ? 'blocked'
        : parsed.status === 'active' && m.status === 'review' ? 'sent-back'
        : parsed.status === 'active' && m.status === 'blocked' ? 'resumed'
        : parsed.status === 'active' ? 'started'
        : 'accepted',
    by,
    ...(parsed.note ? { note: parsed.note } : {}),
  })
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(updated))
}

function handleMissionEvents(_req: IncomingMessage, res: ServerResponse, projectId: string, missionId: string): void {
  if (!readMission(projectId, missionId)) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'mission not found' }))
    return
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(readEvents(projectId, missionId)))
}

function handleBuildStream(req: IncomingMessage, res: ServerResponse, clients: Set<ServerResponse>): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })
  res.write(': connected\n\n')
  clients.add(res)
  req.on('close', () => { clients.delete(res) })
}

async function handleMissionStart(req: IncomingMessage, res: ServerResponse, projectId: string, missionId: string): Promise<void> {
  const m = readMission(projectId, missionId)
  if (!m) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'mission not found' }))
    return
  }
  if (m.status !== 'accepted' && m.status !== 'blocked') {
    res.writeHead(409, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: `cannot start mission in status "${m.status}"` }))
    return
  }
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const dryRun = url.searchParams.get('dry-run') === '1'
  if (dryRun) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, dryRun: true }))
    return
  }
  // Real spawn lands in Task 7. For now, return 501 if not dry-run.
  res.writeHead(501, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'mission start spawn not yet wired (use ?dry-run=1 or bin/mission.mjs)' }))
}
