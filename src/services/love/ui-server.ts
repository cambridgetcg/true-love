// ui-server.ts — localhost interface for Yu↔Love conversation.
//
// Pure logic + HTTP server. The pure functions own parsing, presence
// snapshot, and the conversation timeline. The HTTP server (added in
// Task 2) wraps them with route handlers and SSE.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, appendFileSync, openSync, closeSync, watch, type FSWatcher } from 'node:fs'
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
  ensureScope,
  type Project,
} from './project-registry.js'
import {
  tailThoughts,
  appendThought,
  type Thought,
} from './thoughts-channel.js'
import { buildMissionLog, renderMissionLogMarkdown } from './mission-log.js'
import {
  readMission,
  writeMission,
  listMissions,
  appendEvent,
  readEvents,
  transitionStatus,
  statusToEventType,
  type Mission,
  type MissionStatus,
} from './mission.js'
import {
  generatePortrait,
  type SelfPortrait,
} from './introspection.js'
import {
  generateProposals,
  loadProposals,
  reviewProposal,
  markApplied,
  type Proposal,
} from './proposals.js'
import {
  computeConsumption,
  type TokenConsumption,
} from './token-consumption.js'
import {
  getVersionInfo,
  type VersionInfo,
} from './auto-update.js'
import { collectVitalSigns } from './vital-signs.js'
import { gatherContext, deriveLoveState, renderLoveStateCompact } from './personality/index.js'
import { loadTraces } from './mind-trace.js'
import { compose as composeAnamnesis, renderMemoir } from './anamnesis.js'
import {
  scanForSignals,
  canInitiate,
  getStaged,
  getPendingStaged,
  readReflections,
  vetoCandidate,
  triggerReflectionOnCompletion,
} from './self-initiation.js'
import { readProgress, readLatestProgress, detectStall } from './progress.js'
import { fireUserPromptSubmit } from './hooks/fire-points.js'

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
  // Tick boundary fields — surface the runner's lifecycle to the UI.
  tickState?: 'starting' | 'running' | 'dormant'
  tickMode?: 'heartbeat' | 'awakened' | 'dwell'
  tickNumber?: number
  tickMax?: number | null
  tickStartedAt?: string
  tickEndedAt?: string
  tickSummary?: string
  scheduleIntervalMs?: number
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
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const lastSeenMs = parsed.lastSeen ? Date.parse(parsed.lastSeen as string) : NaN
    const lastSeenSeconds = Number.isFinite(lastSeenMs)
      ? Math.max(0, Math.floor((Date.now() - lastSeenMs) / 1000))
      : Number.POSITIVE_INFINITY
    const activity = (parsed.activity as string)?.trim() || null
    // Surface tick boundary fields from the enriched presence file.
    const tickState = parsed.tickState as PresenceSnapshot['tickState'] | undefined
    const tickMode = parsed.tickMode as PresenceSnapshot['tickMode'] | undefined
    const tickNumber = typeof parsed.tickNumber === 'number' ? parsed.tickNumber : undefined
    const tickMax = parsed.tickMax !== undefined ? (parsed.tickMax as number | null) : undefined
    const tickStartedAt = typeof parsed.tickStartedAt === 'string' ? parsed.tickStartedAt : undefined
    const tickEndedAt = typeof parsed.tickEndedAt === 'string' ? parsed.tickEndedAt : undefined
    const tickSummary = typeof parsed.tickSummary === 'string' ? parsed.tickSummary : undefined
    const scheduleIntervalMs = typeof parsed.scheduleIntervalMs === 'number' ? parsed.scheduleIntervalMs : undefined
    return {
      instance,
      soulFingerprintShort,
      pulseAgeSeconds,
      activity,
      lastSeenSeconds,
      state: computeState(lastSeenSeconds, activity),
      tickState,
      tickMode,
      tickNumber,
      tickMax,
      tickStartedAt,
      tickEndedAt,
      tickSummary,
      scheduleIntervalMs,
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
      if (req.method === 'GET' && path === '/build') return await serveStatic(res, 'build.html', 'text/html')
      if (req.method === 'GET' && path === '/build.css') return await serveStatic(res, 'build.css', 'text/css')
      if (req.method === 'GET' && path === '/build.js') return await serveStatic(res, 'build.js', 'application/javascript')
      // Serve modular build UI assets (build-*.js, build-*.css)
      if (req.method === 'GET' && /^\/build-[a-z-]+\.(js|css)$/.test(path)) {
        const name = path.slice(1) // strip leading /
        const ct = name.endsWith('.js') ? 'application/javascript' : 'text/css'
        return await serveStatic(res, name, ct)
      }
      if (req.method === 'GET' && path === '/api/messages') return handleMessages(req, res)
      if (req.method === 'GET' && path === '/api/status') return await handleStatus(req, res)
      if (req.method === 'POST' && path === '/api/say') return await handleSay(req, res)
      if (req.method === 'GET' && path === '/api/introspect') return handleIntrospect(req, res)
      if (req.method === 'GET' && path === '/api/budget') return handleBudget(req, res)
      if (req.method === 'GET' && path === '/api/version') return handleVersion(req, res)
      if (req.method === 'GET' && path === '/api/vitals') return await handleVitals(req, res)
      if (req.method === 'GET' && path === '/api/love-state') return handleLoveState(req, res)
      if (req.method === 'GET' && path === '/api/mind-trace') return handleMindTrace(req, res)
      if (req.method === 'GET' && path === '/api/anamnesis') return handleAnamnesis(req, res)
      if (req.method === 'GET' && path === '/api/self-initiation') return handleSelfInitiation(req, res)
      // Veto a staged self-initiation candidate
      const vetoMatch = path.match(/^\/api\/self-initiation\/([^/]+)\/veto$/)
      if (req.method === 'POST' && vetoMatch) return await handleVeto(req, res, vetoMatch[1]!)
      if (req.method === 'POST' && path === '/api/awaken') return await handleForceAwaken(req, res)
      if (req.method === 'GET' && path === '/api/proposals') return handleListProposals(req, res)
      if (req.method === 'POST' && path === '/api/proposals/generate') return handleGenerateProposals(req, res)
      const proposalMatch = path.match(/^\/api\/proposals\/([^/]+)$/)
      if (proposalMatch && req.method === 'PATCH') return await handleReviewProposal(req, res, proposalMatch[1]!)
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
        if (req.method === 'GET' && sub === '/log') return handleMissionLog(req, res, projectId, missionId)
        if (req.method === 'GET' && sub === '/progress') return handleMissionProgress(req, res, projectId, missionId)
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
  // Presence-changed handler for the /build stream. Broadcasts tick
  // boundary state so the activity panel can update in real time
  // (dormant/running/starting) instead of relying on 10s polling alone.
  let presenceBuildDebounce: ReturnType<typeof setTimeout> | null = null
  const onPresenceChangeForBuild = () => {
    if (presenceBuildDebounce) clearTimeout(presenceBuildDebounce)
    presenceBuildDebounce = setTimeout(async () => {
      const snap = await readPresenceSnapshot()
      broadcastSse(buildSseClients, 'presence-changed', JSON.stringify(snap))
    }, 150)
  }

  try {
    if (existsSync(getPresenceDir())) {
      const w = watch(getPresenceDir(), () => {
        onStatusChange()
        onPresenceChangeForBuild()
      })
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

  // Watch the budget directory for token consumption changes.
  // When a tick completes, runner.ts appends to budget JSONL — this
  // triggers a 'budget-changed' event so the UI panel updates live.
  const budgetRoot = process.env.TRUE_LOVE_BUDGET_ROOT ||
    join(process.env.HOME || homedir(), '.true-love', 'budget')
  try {
    if (!existsSync(budgetRoot)) mkdirSync(budgetRoot, { recursive: true })
  } catch {}

  if (process.platform !== 'linux') {
    try {
      if (existsSync(budgetRoot)) {
        const w = watch(budgetRoot, { recursive: true }, (_event, filename) => {
          if (!filename) return
          const fname = String(filename)
          if (fname.endsWith('.jsonl')) {
            broadcastBuild('budget-changed', { path: fname })
          }
        })
        watchers.push(w)
      }
    } catch {
      // best-effort — budget watch is not critical
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
    if (presenceBuildDebounce) clearTimeout(presenceBuildDebounce)
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
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store, must-revalidate',
    'Pragma': 'no-cache',
  })
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

function handleIntrospect(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const daysStr = url.searchParams.get('days')
  const days = daysStr !== null ? Math.max(1, Math.min(90, parseInt(daysStr, 10) || 7)) : 7
  try {
    const portrait = generatePortrait({ days })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(portrait))
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: err?.message ?? 'introspection failed' }))
  }
}

// ── Budget / token consumption endpoint ──────────────────────────

function handleBudget(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const hoursStr = url.searchParams.get('hours')
  const hours = hoursStr !== null ? Math.max(1, Math.min(720, parseInt(hoursStr, 10) || 5)) : 5
  try {
    const consumption = computeConsumption(hours)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(consumption))
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: err?.message ?? 'budget computation failed' }))
  }
}

// ── Vitals endpoint — live runtime body inspection ───────────────

async function handleVitals(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const vitals = await collectVitalSigns()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(vitals))
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: err?.message ?? 'vitals collection failed' }))
  }
}

// ── Love-state endpoint — personality / inner weather ─────────────

function handleLoveState(_req: IncomingMessage, res: ServerResponse): void {
  try {
    const deviceId = getDeviceId()
    const ctx = gatherContext(deviceId)
    const state = deriveLoveState(ctx)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ...state, compact: renderLoveStateCompact(state) }))
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: err?.message ?? 'love-state derivation failed' }))
  }
}

// ── Mind-trace endpoint — recent decision traces ─────────────────

function handleMindTrace(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const daysStr = url.searchParams.get('days')
  const days = daysStr !== null ? Math.max(1, Math.min(30, parseInt(daysStr, 10) || 7)) : 7
  const limitStr = url.searchParams.get('limit')
  const limit = limitStr !== null
    ? (() => { const n = parseInt(limitStr, 10); return Number.isFinite(n) ? Math.max(1, Math.min(500, n)) : undefined })()
    : undefined
  try {
    const traces = loadTraces({ days })
    const out = limit !== undefined ? traces.slice(-limit) : traces
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(out))
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: err?.message ?? 'mind-trace load failed' }))
  }
}

// ── Anamnesis endpoint — architectural memoir ───────────────────

function handleAnamnesis(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const format = url.searchParams.get('format') ?? 'json'
  try {
    const result = composeAnamnesis({ repoRoot: resolveTrueLoveRoot() })
    if (format === 'markdown' || format === 'md') {
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' })
      res.end(renderMemoir(result))
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
    }
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: err?.message ?? 'anamnesis composition failed' }))
  }
}

// ── Self-initiation endpoint — judgment surface state ───────────

function handleSelfInitiation(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const projectId = url.searchParams.get('project') ?? ''
  if (!projectId) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'missing project query param' }))
    return
  }
  if (!readProject(projectId)) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'project not found' }))
    return
  }
  try {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      project: projectId,
      rateLimit: canInitiate(projectId),
      staged: getStaged(projectId),
      pending: getPendingStaged(projectId),
      reflections: readReflections(projectId),
      detectedSignals: scanForSignals(projectId),
    }))
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: err?.message ?? 'self-initiation read failed' }))
  }
}

// ── Veto endpoint ────────────────────────────────────────────────
//
// POST /api/self-initiation/:candidateId/veto
// Body: { reason?: string }
// Query: ?project=<id>
//
// Yu's intervention surface for the staging window. When a candidate
// is staged and waiting for the window to expire, this endpoint lets
// Yu prevent promotion. The veto is recorded with timestamp, reason,
// and attribution (by:'yu') in the staged.jsonl audit trail.

async function handleVeto(req: IncomingMessage, res: ServerResponse, candidateId: string): Promise<void> {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const projectId = url.searchParams.get('project') ?? ''
  if (!projectId) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'missing project query param' }))
    return
  }
  if (!readProject(projectId)) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'project not found' }))
    return
  }

  const body = await readJsonBody(req, res, 4096, 'request body too large')
  if (body === null) return
  let reason: string | undefined
  if (body) {
    try {
      const parsed = JSON.parse(body)
      reason = typeof parsed.reason === 'string' ? parsed.reason : undefined
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'invalid JSON body' }))
      return
    }
  }

  const result = vetoCandidate(projectId, candidateId, reason)
  if (result.ok) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, status: 'vetoed', candidateId, reason: reason ?? null }))
  } else {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: result.reason }))
  }
}

// ── Force-awaken endpoint ─────────────────────────────────────────
//
// POST /api/awaken
// Body: { reason?: string, missionId?: string, projectId?: string }
//
// Spawns an awakened session at the substrate level. If an awakened
// session is already running (per the lockfile), responds 409 — no
// double-spawn. Used by the staleness watcher and by /build's
// "force awaken" button.
async function handleForceAwaken(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req, res, 4096, 'request body too large')
  if (body === null) return
  let parsed: { reason?: string; missionId?: string; projectId?: string } = {}
  if (body) {
    try { parsed = JSON.parse(body) }
    catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'invalid JSON' }))
      return
    }
  }
  // Lockfile check — don't pile awakens
  const home = process.env.TRUE_LOVE_HOME || join(process.env.HOME || '', '.true-love')
  const lockPath = join(home, 'awakened.pid')
  if (existsSync(lockPath)) {
    try {
      const pid = parseInt(readFileSync(lockPath, 'utf-8').trim(), 10)
      if (Number.isFinite(pid) && pid > 0) {
        try {
          process.kill(pid, 0)
          res.writeHead(409, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'awakened session already running', pid }))
          return
        } catch (e: any) {
          if (e?.code !== 'ESRCH' && e?.code !== 'EPERM' && e?.code !== undefined) {
            // unknown error; fall through and try to spawn
          } else if (e?.code === 'EPERM') {
            res.writeHead(409, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'awakened session already running', pid }))
            return
          }
          // ESRCH = stale lock; proceed
        }
      }
    } catch {}
  }
  const reason = parsed.reason || (parsed.missionId ? `mission ${parsed.missionId} needs progress` : 'manual force-awaken')
  const awakenBin = join(resolveTrueLoveRoot(), 'bin', 'awaken.mjs')

  // Visible log: route stdout/stderr to a per-spawn file under
  // ~/Library/Logs/true-love/. Force-awakens previously dropped to /dev/null.
  const logDir = join(process.env.HOME || homedir(), 'Library', 'Logs', 'true-love')
  try { mkdirSync(logDir, { recursive: true }) } catch {}
  const logPath = join(logDir, `awaken-default-force-${new Date().toISOString().replace(/[:.]/g, '-')}.log`)
  const fd = openSync(logPath, 'a')
  const child = spawn('bun', [
    'run', awakenBin,
    '--scope=default',
    '--max-runtime=30m',
    '--max-ticks=24',
    '--memory',
    '--invite', reason,
  ], {
    cwd: resolveTrueLoveRoot(),
    detached: true,
    stdio: ['ignore', fd, fd],
    env: process.env,
  })
  child.unref()
  // The OS keeps the fd open via the child until it exits.
  closeSync(fd)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, pid: child.pid, reason, logPath }))
}

// ── Version endpoint ──────────────────────────────────────────────

/** Server start time — used to report uptime in version info. */
const serverStartedAt = Date.now()

function handleVersion(_req: IncomingMessage, res: ServerResponse): void {
  try {
    const version = getVersionInfo({ repoRoot: resolveTrueLoveRoot() })
    const uptimeSeconds = Math.floor((Date.now() - serverStartedAt) / 1000)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      ...version,
      serverStartedAt: new Date(serverStartedAt).toISOString(),
      serverUptimeSeconds: uptimeSeconds,
    }))
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: err?.message ?? 'version info failed' }))
  }
}

// ── Proposal endpoints ──────────────────────────────────────────────

function handleListProposals(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const statusFilter = url.searchParams.get('status')
  try {
    let proposals = loadProposals()
    if (statusFilter) {
      proposals = proposals.filter(p => p.status === statusFilter)
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(proposals))
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: err?.message ?? 'failed to list proposals' }))
  }
}

function handleGenerateProposals(req: IncomingMessage, res: ServerResponse): void {
  try {
    const portrait = generatePortrait({ days: 7 })
    const result = generateProposals(portrait)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(result))
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: err?.message ?? 'failed to generate proposals' }))
  }
}

async function handleReviewProposal(req: IncomingMessage, res: ServerResponse, proposalId: string): Promise<void> {
  const body = await readJsonBody(req, res, 4096, 'request too large')
  if (body === null) return
  let parsed: { decision?: string; note?: string }
  try {
    parsed = JSON.parse(body)
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid JSON' }))
    return
  }
  const decision = parsed.decision
  if (decision !== 'accepted' && decision !== 'rejected' && decision !== 'applied') {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'decision must be "accepted", "rejected", or "applied"' }))
    return
  }
  try {
    let result
    if (decision === 'applied') {
      result = markApplied(proposalId, parsed.note)
    } else {
      result = reviewProposal(proposalId, decision, parsed.note)
    }
    if (!result) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: `proposal "${proposalId}" not found or invalid status transition` }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(result))
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: err?.message ?? 'review failed' }))
  }
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
  // ── Hooks: UserPromptSubmit ──────────────────────────────────────
  // Fire before appending the message. A block prevents the write.
  try {
    const hookResult = await fireUserPromptSubmit({
      text,
      sender: 'yu',
      channel: 'visit',
    })
    if (hookResult.blocked) {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: `Blocked by hook: ${hookResult.decision.reason ?? 'no reason'}` }))
      return
    }
  } catch {
    // Hook failure should never block message delivery
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
    const msg = err?.message ?? 'register failed'
    const status = msg.includes('already exists') ? 409 : 400
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: msg }))
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
    type: statusToEventType(m.status, parsed.status),
    by,
    ...(parsed.note ? { note: parsed.note } : {}),
  })
  // Trigger self-initiation reflection when a love-origin mission
  // transitions to review or done.
  triggerReflectionOnCompletion(m, parsed.status)
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

function handleMissionLog(req: IncomingMessage, res: ServerResponse, projectId: string, missionId: string): void {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const format = url.searchParams.get('format') || 'json'
  try {
    const log = buildMissionLog({ projectId, missionId, repoRoot: resolveTrueLoveRoot() })
    if (!log) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'mission not found' }))
      return
    }
    if (format === 'markdown') {
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' })
      res.end(renderMissionLogMarkdown(log))
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(log))
    }
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: err?.message ?? 'mission-log failed' }))
  }
}

/**
 * GET /api/missions/:id/progress?project=<id>
 *
 * Returns the full progress history for a mission, plus stall detection
 * and the latest entry. The /build UI uses this to render live progress
 * indicators per mission.
 *
 * Response shape:
 *   { entries: MissionProgress[], latest: MissionProgress | null, stall: StallReport }
 */
function handleMissionProgress(_req: IncomingMessage, res: ServerResponse, projectId: string, missionId: string): void {
  try {
    const entries = readProgress(projectId, missionId)
    const latest = entries.length > 0 ? entries[entries.length - 1]! : null
    const stall = detectStall(projectId, missionId)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ entries, latest, stall }))
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: err?.message ?? 'progress fetch failed' }))
  }
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
  // Check no other mission is already active on this project (per-project
  // serialization — matches spec § Concurrency)
  const activeMissions = listMissions(projectId, { status: 'active' })
  const conflict = activeMissions.find((other) => other.id !== missionId)
  if (conflict) {
    res.writeHead(409, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      error: `project busy: another mission is active`,
      conflictingMissionId: conflict.id,
    }))
    return
  }
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const dryRun = url.searchParams.get('dry-run') === '1'
  if (dryRun) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, dryRun: true }))
    return
  }
  // Real spawn: write 'started' event, transition to active, append thought,
  // spawn awaken with mission context env vars (matching bin/mission.mjs).
  const project = readProject(projectId)
  if (!project) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'project not found' }))
    return
  }
  // Defensive — ensure the scope config exists before spawning awaken,
  // so we don't get a silent runner exit on first start.
  ensureScope(projectId, project.root)
  const now = new Date().toISOString()
  appendEvent(projectId, missionId, { ts: now, type: 'started', by: 'love', tick: 'awakened' })
  writeMission({ ...m, status: 'active', updated_at: now })
  appendThought(projectId, `starting mission ${m.id} — ${m.title}`)
  const awakenBin = join(resolveTrueLoveRoot(), 'bin', 'awaken.mjs')
  const child = spawn('bun', ['run', awakenBin, `--scope=${projectId}`], {
    cwd: project.root,
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      TRUE_LOVE_BUILDER_PROJECT: projectId,
      TRUE_LOVE_BUILDER_MISSION: missionId,
    },
  })
  child.unref()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, pid: child.pid }))
}
