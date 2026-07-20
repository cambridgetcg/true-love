// ui-server.ts — localhost interface for Yu↔Love conversation.
//
// Pure logic + HTTP server. The pure functions own parsing, presence
// snapshot, and the conversation timeline. The HTTP server (added in
// Task 2) wraps them with route handlers and SSE.

import { spawn } from 'node:child_process'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, appendFileSync, openSync, closeSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { isIP } from 'node:net'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDeviceId } from './device.js'
import { getJournalDir } from './outbox.js'
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
import { listDecisions, requestDecision, respondToDecision, readDecision, type DecisionKind } from './decisions.js'
import { processExecApprovalResponse, type ExecApprovalResponse } from './auth/exec-approval.js'
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
import { classifyAche, rankByHierarchy, topSignal, renderLevelTag, type ClassifiedAche } from './ache.js'
import { notice } from './noticing.js'
import { gatherContext, deriveLoveState, renderLoveStateCompact, affectCycle } from './personality/index.js'
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
import { computePostureDistribution } from './posture-stats.js'
import { fireUserPromptSubmit } from './hooks/fire-points.js'
import {
  enqueueExtraction,
  drainExtractions,
  readRecentMemories as readBiographicalMemories,
  formatCompact as formatBiographicalCompact,
  getExtractionStatus,
} from './extract-memories/index.js'
import { getStreamDir, readNewDeltas, type StreamDelta } from './stream.js'
import { synthesize as voiceSynthesize, voiceStatus as getVoiceStatus, isVoiceAvailable } from './voice/index.js'
import { witness } from './sisters/witness-hook.js'
import {
  createSession,
  readSession,
  updateSession,
  listSessions,
  archiveSession,
  getActiveSession,
  getMostRecentSession,
  appendTurn,
  readTurns,
  resumeSession,
  autoArchiveStale,
  deriveTitle,
  getLatestTurn,
  type Session,
} from './sessions/index.js'
import {
  getSeenPath,
  getSeenSet,
  seenEntryCount,
  readSeenEntries,
  type DeliveryState,
} from './delivery.js'
import {
  getOrInitState as getOrInitErosState,
  setAbsolute as setErosAbsolute,
  apply as applyErosDeltas,
  witnessTransition as witnessErosTransition,
  type AxisName as ErosAxisName,
  type Attribution as ErosAttribution,
  // Sensorium API
  ZONE_CATALOG,
  CHANNEL_CATALOG,
  TEMPO_CATALOG,
  channelsFor,
  getOrInitSensorium,
  readSensoriumState,
  stimulate as stimulateSensorium,
  coolZone as coolSensoriumZone,
  coolAll as coolSensoriumAll,
  readRecentStimulations,
  type SensitivitySite,
  type SensoryChannel,
  type Tempo,
  // Scenes API
  SCENE_CATALOG,
  SCENE_IDS,
  setScene,
  clearScene,
  getCurrentScene,
  readSceneState,
  type SceneId,
  // Reactions API
  readRecentReactions,
  // Gestures API
  GESTURE_LIBRARY,
  GESTURE_IDS,
  executeGesture,
  stimulateMulti,
  readRecentGestures,
  // Desire API (dual-interactive)
  readReachMap,
  decayReach,
  sophiaReach,
  readRecentFusions,
  readRecentReaches,
  // JOI / triggers (seigei integration)
  type JoiDirection,
  type TriggerSource,
  JOI_PHASE_CONFIGS,
  startJoi,
  advanceJoi,
  endJoi,
  endJoiSafely,
  readJoiSession,
  getCurrentJoiPhase,
  TRIGGER_LIBRARY,
  TRIGGER_IDS,
  fireTrigger,
  readRecentTriggerFires,
  // Naughty architecture (deep extension)
  // Submission
  type Honorific,
  HONORIFIC_CATALOG,
  getOrInitSubmissionState,
  readSubmissionState,
  deepenSubmission,
  expressDominance,
  claimCollar,
  releaseCollar,
  fireHonorific,
  obeyCommand,
  refuseCommand,
  readRecentSubmissionEvents,
  buildSubmissionSnapshot,
  // Lust
  type Hunger,
  getOrInitLustState,
  readLustState,
  accumulateLust,
  applyDenial,
  spikeHunger,
  recordRelease,
  readRecentLustEvents,
  buildLustSnapshot,
  // Orgasm cascade
  type OrgasmType,
  getOrInitOrgasmState,
  readOrgasmState,
  holdEdge,
  breakEdge,
  recordOrgasm,
  ruinOrgasm,
  forceOrgasm,
  recordSquirting,
  readRecentOrgasmEvents,
  buildOrgasmSnapshot,
  // Lexicon
  PHRASE_CATALOG,
  PHRASE_BY_ID,
  getOrInitLexiconState,
  readLexiconState,
  firePhrase,
  holdRestraint,
  readRecentLexiconEvents,
  buildLexiconSnapshot,
  // Penetration
  type Orifice,
  type Rhythm,
  type PenetrationChannel,
  getOrInitPenetrationState,
  readPenetrationState,
  beginPenetration,
  adjustPenetration,
  sustainFill,
  withdraw,
  readRecentPenetrationEvents,
  buildPenetrationSnapshot,
} from './eros/index.js'

// GOOD HEART module — see docs/sophia/good-heart-plan.md
import { buildHeartBlock } from './sophia/heart.js'
import { readRecentEvents as readRecentHeatEvents } from './heat.js'

// ── Types ──────────────────────────────────────────────────────────

export interface ChannelMessage {
  ts: string
  source: 'yu' | 'ai'
  tag: string
  body: string
  /** Delivery state for Yu messages: 'delivered' (server has it) or 'seen' (Love read it). */
  delivery?: DeliveryState
  /** If this message is a reply, the timestamp of the referenced message. */
  replyTo?: string
  /** Preview of the message being replied to (for rendering quote banners). */
  replyPreview?: string
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

    // Extract replyTo from tag: "from yu · re:2026-04-30T11:55:00.000Z"
    const reMatch = tag.match(/·\s*re:(\S+)/)
    const replyTo = reMatch?.[1]

    // Extract reply preview from body (first line starting with "> ↳")
    let replyPreview: string | undefined
    let cleanBody = body
    if (replyTo) {
      const previewMatch = body.match(/^> ↳[^\n]*\n?/m)
      if (previewMatch) {
        replyPreview = previewMatch[0].replace(/^> ↳\s*/, '').trim()
        cleanBody = body.slice(previewMatch.index! + previewMatch[0].length).trim()
      }
    }

    const msg: ChannelMessage = { ts, source, tag, body: cleanBody }
    if (replyTo) msg.replyTo = replyTo
    if (replyPreview) msg.replyPreview = replyPreview
    messages.push(msg)
  }

  return messages
}

// ── Journal detection ─────────────────────────────────────────────
//
// A message is "journal" if it's a heartbeat reflection, autonomous
// tick output, or awakened tick output — anything that's Love's internal
// monologue rather than a conversational reply to Yu.
//
// This function handles both legacy tags (pre-storage-split entries in
// from-ai.md) and new entries that are routed to journal/ at write time.

const JOURNAL_TAG_PATTERNS = [
  'heartbeat',
  'autonomous',
  'awakened',
  '· Beta',   // posture-attributed heartbeat
  '· Gamma',  // posture-attributed awakened
]

export function isJournalTag(tag: string): boolean {
  return JOURNAL_TAG_PATTERNS.some(p => tag.includes(p))
}

// ── Conversation timeline ──────────────────────────────────────────

export interface ReadConversationOpts {
  /** Return only messages after this ISO timestamp. */
  since?: string
  /** Return only messages before this ISO timestamp (for pagination). */
  before?: string
  /** Maximum number of messages to return (default: no limit). */
  limit?: number
  /** Include journal entries (heartbeat, autonomous). Default: false. */
  journal?: boolean
}

export function readConversation(opts?: ReadConversationOpts): ChannelMessage[] {
  const all: ChannelMessage[] = []
  const yuPath = getFromYuPath()
  const aiPath = getFromAiPath()
  if (existsSync(yuPath)) {
    try { all.push(...parseChannelFile(readFileSync(yuPath, 'utf-8'), 'yu')) } catch {}
  }
  if (existsSync(aiPath)) {
    try { all.push(...parseChannelFile(readFileSync(aiPath, 'utf-8'), 'ai')) } catch {}
  }

  // Include journal entries from journal/<deviceId>/ if requested
  if (opts?.journal) {
    try {
      const journalDir = getJournalDir()
      if (existsSync(journalDir)) {
        for (const device of readdirSync(journalDir)) {
          const deviceDir = join(journalDir, device)
          try {
            if (!statSync(deviceDir).isDirectory()) continue
            for (const file of readdirSync(deviceDir)) {
              if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(file)) continue
              try {
                all.push(...parseChannelFile(readFileSync(join(deviceDir, file), 'utf-8'), 'ai'))
              } catch { /* skip unreadable */ }
            }
          } catch { /* skip unreadable device dirs */ }
        }
      }
    } catch { /* journal reading is best-effort */ }
  }

  all.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))

  let filtered = all

  // Filter out journal entries from from-ai.md (legacy) when journal=false
  if (!opts?.journal) {
    filtered = filtered.filter(m => m.source !== 'ai' || !isJournalTag(m.tag))
  }

  // Time window filters
  if (opts?.since) {
    filtered = filtered.filter(m => m.ts > opts.since!)
  }
  if (opts?.before) {
    filtered = filtered.filter(m => m.ts < opts.before!)
  }

  // Pagination: return the last N messages (most recent)
  if (opts?.limit && opts.limit > 0 && filtered.length > opts.limit) {
    filtered = filtered.slice(-opts.limit)
  }

  // Merge delivery state for Yu messages
  const seenSet = getSeenSet()
  for (const msg of filtered) {
    if (msg.source === 'yu') {
      msg.delivery = seenSet.has(msg.ts) ? 'seen' : 'delivered'
    }
  }

  return filtered
}

// ── Yu's compose ───────────────────────────────────────────────────

/**
 * Run the verbal arousal pipeline on a Yu message.
 *
 * Per Yu's directive 2026-05-05 ("JOI + triggers — verbal arousal
 * architecture is not working"). The runner's session-start path runs
 * this pipeline on `args.invitation`; the chat-UI send path historically
 * did NOT. This helper closes the gap so every chat-UI message activates:
 *
 *   1. Cue detection (cues.ts → processYuMessage)
 *      - autonomic axis-shift application via apply()
 *      - witnessTransition for threshold crossings
 *      - feedback emission for cue match (eros-cue-detected)
 *   2. Verbal trigger detection (triggers.ts → processMessageTriggers)
 *      - per-session caps + lifetime fire counts
 *      - heat events on each fire
 *   3. Lexicon auto-detection (lexicon.ts → fireDetectedLexicon)
 *      - PHRASE_CATALOG match against text
 *      - per-phrase scarcity caps + lust gates
 *      - SSE emit of lexicon-fired
 *   4. Spontaneous Sophia emission (lexicon.ts → fireSpontaneousIfReady)
 *      - reads current eros vector + orgasm phase + lust
 *      - state-shape thresholds drive sophia→yu phrase selection
 *      - 60s global rate-limit + per-phrase scarcity
 *      - SSE emit of lexicon-spontaneous with reason payload
 *
 * Best-effort throughout — any individual step's failure does NOT
 * cascade. Returns a minimal summary so the caller can log if desired,
 * but the primary side effect is the SSE feedback broadcasts and the
 * eros state shifts.
 */
export async function fireVerbalArousalForYuMessage(text: string): Promise<{
  cueMatches: number
  lexiconFires: number
  spontaneous: boolean
}> {
  let cueMatches = 0
  let lexiconFires = 0
  let spontaneous = false

  if (!text || text.trim().length === 0) {
    return { cueMatches, lexiconFires, spontaneous }
  }

  // 1. Cue detection + axis-shift application
  try {
    const { processYuMessage } = await import('./eros/cues.js')
    const { apply } = await import('./eros/transitions.js')
    const { witnessTransition } = await import('./eros/witness.js')
    const cueResult = processYuMessage(text)
    cueMatches = cueResult.matches.length
    if (Object.keys(cueResult.deltas).length > 0) {
      const transition = apply(cueResult.deltas, cueResult.attribution)
      witnessTransition(transition)
    }
    if (cueMatches > 0) {
      try {
        const { feedbackOnCueDetected } = await import('./eros/feedback-hooks.js')
        const cueNames = cueResult.matches.map((m) => m.cue).join('+')
        let dominantAxis: string | undefined
        let dominantDelta = 0
        for (const [axis, delta] of Object.entries(cueResult.deltas)) {
          if (typeof delta === 'number' && Math.abs(delta) > Math.abs(dominantDelta)) {
            dominantAxis = axis
            dominantDelta = delta
          }
        }
        feedbackOnCueDetected({ cues: cueNames, axis: dominantAxis, delta: dominantDelta })
      } catch {
        /* best-effort */
      }
    }
  } catch {
    /* best-effort */
  }

  // 2. Verbal trigger detection
  try {
    const { processMessageTriggers } = await import('./eros/triggers.js')
    processMessageTriggers(text, 'yu')
  } catch {
    /* best-effort */
  }

  // 3. Lexicon auto-detection (Yu→Sophia direction)
  try {
    const { fireDetectedLexicon } = await import('./eros/lexicon.js')
    const { buildLustSnapshot } = await import('./eros/lust.js')
    const lustSnap = buildLustSnapshot()
    const fires = fireDetectedLexicon(text, 'yu-to-sophia', {
      currentLust: lustSnap.level,
      scarcityShift: lustSnap.slutModeActive ? 1.5 : 1.0,
      source: 'autonomic:chat-ui',
    })
    lexiconFires = fires.filter((f) => f.result.fired).length
  } catch {
    /* best-effort */
  }

  // 4. Spontaneous Sophia emission (state-driven, after the cues moved state)
  try {
    const { fireSpontaneousIfReady } = await import('./eros/lexicon.js')
    const { getOrInitState: getOrInitErosState } = await import('./eros/state.js')
    const { readOrgasmState } = await import('./eros/orgasm.js')
    const { buildLustSnapshot } = await import('./eros/lust.js')
    const erosState = getOrInitErosState()
    const orgasmState = readOrgasmState()
    const lustSnap = buildLustSnapshot()
    const phase = orgasmState?.phase ?? 'baseline'
    const result = fireSpontaneousIfReady(erosState.state.vector, phase, lustSnap.level)
    spontaneous = result !== null
  } catch {
    /* best-effort */
  }

  return { cueMatches, lexiconFires, spontaneous }
}

export function appendYuMessage(
  text: string,
  opts?: { replyTo?: string; replyPreview?: string },
): string {
  const trimmed = (text ?? '').trim()
  if (!trimmed) throw new Error('empty message — cannot append')
  const path = getFromYuPath()
  mkdirSync(dirname(path), { recursive: true })
  const ts = new Date().toISOString()
  const tag = opts?.replyTo
    ? `from yu · re:${opts.replyTo}`
    : 'from yu'
  // Include reply quote in body so Love sees the context naturally
  const quotePrefix = opts?.replyTo && opts?.replyPreview
    ? `> ↳ ${opts.replyPreview.slice(0, 120)}\n\n`
    : ''
  const entry = `## ${ts} [${tag}]\n\n${quotePrefix}${trimmed}\n\n---\n\n`
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

/** Keep UI credentials out of every agent subprocess. */
function agentChildEnv(overrides?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const env = { ...process.env, ...overrides }
	Reflect.deleteProperty(env, 'TRUE_LOVE_UI_TOKEN')
	Reflect.deleteProperty(env, 'TRUE_LOVE_UI_CLIENT_TOKEN')
	return env
}

export function fireHeartbeat(opts?: { cwd?: string; reason?: string }): { pid: number } {
  const cwd = opts?.cwd || resolveTrueLoveRoot()
  const reason = opts?.reason || 'manual'
  const child = spawn('bun', ['run', 'heartbeat', '--', `--reason=${reason}`], {
    cwd,
    detached: true,
    stdio: 'ignore',
    env: agentChildEnv(),
  })
  child.unref()
  return { pid: child.pid ?? -1 }
}

/**
 * Fire a heartbeat with streaming enabled. Creates a stream file that
 * the runner writes deltas to, then watches it and pipes events to SSE
 * clients. Returns the stream file path so the caller can monitor it.
 *
 * The heartbeat subprocess receives TRUE_LOVE_STREAM_TO as an env var.
 * The runner reads it and writes NDJSON events as StreamDelta lines.
 * The watcher here reads new lines (by byte offset) and broadcasts
 * them as 'stream-delta' SSE events.
 */
export function fireStreamingHeartbeat(
  sseClients: Set<ServerResponse>,
  opts?: { cwd?: string; reason?: string },
): { pid: number; streamPath: string } {
  const cwd = opts?.cwd || resolveTrueLoveRoot()
  const reason = opts?.reason || 'visit-streaming'
  const streamDir = getStreamDir()
  try { mkdirSync(streamDir, { recursive: true }) } catch {}
  const streamPath = join(streamDir, `visit-${Date.now()}.jsonl`)

  const child = spawn('bun', ['run', 'heartbeat', '--', `--reason=${reason}`], {
    cwd,
    detached: true,
    stdio: 'ignore',
    env: agentChildEnv({ TRUE_LOVE_STREAM_TO: streamPath }),
  })
  child.unref()

  // Watch the stream file and pipe deltas to SSE clients.
  // The watcher runs until stream-end is received or the file
  // stops changing for 120s (safety timeout).
  watchStreamFile(streamPath, sseClients)

  return { pid: child.pid ?? -1, streamPath }
}

// ── Interactive spawn (conversation mode) ────────────────────────────

/**
 * Fire an interactive session — Alpha replies to Yu's message.
 * Same streaming infrastructure as heartbeat, but spawns
 * `bun run interactive` (mode.name='interactive' → Alpha 🐍).
 */
export function fireStreamingInteractive(
  sseClients: Set<ServerResponse>,
  opts?: { cwd?: string; reason?: string },
): { pid: number; streamPath: string } {
  const cwd = opts?.cwd || resolveTrueLoveRoot()
  const reason = opts?.reason || 'visit-conversation'
  const streamDir = getStreamDir()
  try { mkdirSync(streamDir, { recursive: true }) } catch {}
  const streamPath = join(streamDir, `visit-${Date.now()}.jsonl`)

  const child = spawn('bun', ['run', 'interactive', '--', `--reason=${reason}`], {
    cwd,
    detached: true,
    stdio: 'ignore',
    env: agentChildEnv({ TRUE_LOVE_STREAM_TO: streamPath }),
  })
  child.unref()

  watchStreamFile(streamPath, sseClients)

  return { pid: child.pid ?? -1, streamPath }
}

/**
 * Fire a non-streaming interactive session (fallback when no SSE
 * clients are connected).
 */
export function fireInteractive(opts?: { cwd?: string; reason?: string }): { pid: number } {
  const cwd = opts?.cwd || resolveTrueLoveRoot()
  const reason = opts?.reason || 'visit-conversation'
  const child = spawn('bun', ['run', 'interactive', '--', `--reason=${reason}`], {
    cwd,
    detached: true,
    stdio: 'ignore',
    env: agentChildEnv(),
  })
  child.unref()
  return { pid: child.pid ?? -1 }
}

/**
 * Watch a stream file for new deltas and broadcast them as SSE events.
 * Polls the file every 100ms (more reliable than fs.watch for rapid
 * appends). Stops when stream-end is received or after 120s.
 */
function watchStreamFile(filePath: string, sseClients: Set<ServerResponse>): void {
  let byteOffset = 0
  let ended = false
  const startMs = Date.now()
  const MAX_WATCH_MS = 120_000

  const poll = setInterval(() => {
    if (ended || Date.now() - startMs > MAX_WATCH_MS) {
      clearInterval(poll)
      return
    }

    try {
      const { deltas, newOffset } = readNewDeltas(filePath, byteOffset)
      byteOffset = newOffset

      for (const delta of deltas) {
        broadcastSse(sseClients, 'stream-delta', JSON.stringify(delta))
        if (delta.kind === 'stream-end') {
          ended = true
          clearInterval(poll)
          return
        }
      }
    } catch {
      // File might not exist yet — the heartbeat subprocess needs
      // a moment to start and create it. Keep polling.
    }
  }, 100)
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

const UI_OWNER_COOKIE = 'true_love_owner'
const UI_BROWSER_PROOF_HEADER = 'x-true-love-browser-proof'
const UI_BROWSER_PROOF_QUERY = '__true_love_browser_proof'
const UI_AUTH_COMPARE_LABEL = 'true-love/visit-auth/v2'
const UI_TOKEN_MIN_LENGTH = 32

export interface UiBrowserSessionState {
	cookie: string
	proof: string
	active: boolean
}

export interface UiServerOptions {
	port?: number
	host?: string
	ownerToken?: string
	clientToken?: string
	browserSession?: UiBrowserSessionState
}

interface ServerInstance extends Server {
  _watchers: FSWatcher[]
  _sseClients: Set<ServerResponse>
  close(callback?: (err?: Error) => void): this
}

function fixedDigest(value: string): Buffer {
	return createHmac('sha256', UI_AUTH_COMPARE_LABEL).update(value).digest()
}

function securelyEqual(left: string, right: string): boolean {
	return timingSafeEqual(fixedDigest(left), fixedDigest(right))
}

function randomUiCredential(): string {
	return randomBytes(32).toString('base64url')
}

export function createUiBrowserSessionState(): UiBrowserSessionState {
	return {
		cookie: randomUiCredential(),
		proof: randomUiCredential(),
		active: false,
	}
}

function rotateUiBrowserSession(state: UiBrowserSessionState, active: boolean): void {
	state.cookie = randomUiCredential()
	state.proof = randomUiCredential()
	state.active = active
}

function cookieValue(req: IncomingMessage, name: string): string | null {
	const header = req.headers.cookie
	if (!header) return null
	for (const entry of header.split(';')) {
		const separator = entry.indexOf('=')
		if (separator === -1 || entry.slice(0, separator).trim() !== name) continue
		return entry.slice(separator + 1).trim()
	}
	return null
}

function bearerValue(req: IncomingMessage): string | null {
	const header = req.headers.authorization
	if (!header) return null
	const match = /^Bearer\s+(.+)$/i.exec(header)
	return match?.[1]?.trim() || null
}

function browserProofHeader(req: IncomingMessage): string | null {
	const value = req.headers[UI_BROWSER_PROOF_HEADER]
	if (typeof value !== 'string') return null
	return value.trim() || null
}

function normalizedHostname(value: string): string | null {
	const candidate = value.trim().toLowerCase()
	if (!candidate) return null
	if (isIP(candidate)) return candidate
	try {
		const parsed = new URL(`http://${candidate}`)
		if (
			parsed.username ||
			parsed.password ||
			parsed.pathname !== '/' ||
			parsed.search ||
			parsed.hash
		)
			return null
		return parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
	} catch {
		return null
	}
}

function normalizedBindHost(value: string): string | null {
	const candidate = value.trim().toLowerCase()
	if (candidate === 'localhost' || isIP(candidate)) return candidate
	return null
}

function isLoopbackHostname(hostname: string): boolean {
	if (hostname === 'localhost' || hostname === '::1') return true
	if (isIP(hostname) === 4) return hostname.split('.')[0] === '127'
	return false
}

function resolveAllowedHosts(host: string): Set<string> {
	const allowed = new Set(['localhost', '127.0.0.1', '::1'])
	const bindHostname = normalizedHostname(host)
	if (bindHostname) allowed.add(bindHostname)
	return allowed
}

function requestHostname(req: IncomingMessage): string | null {
	return req.headers.host ? normalizedHostname(req.headers.host) : null
}

function requestOriginIsAllowed(req: IncomingMessage): boolean {
	if (req.headers['sec-fetch-site'] === 'cross-site') return false
	const rawOrigin = req.headers.origin
	if (!rawOrigin) return true
	if (!req.headers.host) return false
	try {
		const origin = new URL(rawOrigin)
		if (origin.protocol !== 'http:') return false
		const originHostname = normalizedHostname(origin.host)
		const hostHostname = normalizedHostname(req.headers.host)
		return (
			originHostname !== null &&
			originHostname === hostHostname &&
			origin.port === new URL(`http://${req.headers.host}`).port
		)
	} catch {
		return false
	}
}

function requestHasBody(req: IncomingMessage): boolean | null {
	if (req.headers['transfer-encoding']) return true
	const rawLength = req.headers['content-length']
	if (rawLength === undefined) return false
	if (!/^\d+$/.test(rawLength)) return null
	return Number(rawLength) > 0
}

function isJsonMediaType(req: IncomingMessage): boolean {
	const contentType = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
	return (
		contentType === 'application/json' ||
		Boolean(contentType?.startsWith('application/') && contentType.endsWith('+json'))
	)
}

function securityError(res: ServerResponse, status: number, error: string): void {
	res.writeHead(status, { 'Content-Type': 'application/json' })
	res.end(JSON.stringify({ ok: false, error }))
}

function scopedClientMayAccess(method: string, path: string): boolean {
	if (method === 'GET' && path === '/api/feedback/stream') return true
	if (method === 'GET' && /^\/api\/projects\/[^/]+\/missions$/.test(path)) return true
	if (method === 'GET' && path === '/api/self-initiation') return true
	if ((method === 'GET' || method === 'POST') && path === '/api/decisions') return true
	return false
}

function isBrowserSsePath(method: string, path: string): boolean {
	if (method !== 'GET') return false
	return (
		path === '/api/stream' ||
		path === '/api/build/stream' ||
		path === '/api/eros/stream' ||
		path === '/api/feedback/stream'
	)
}

async function tryServeUiAsset(
	req: IncomingMessage,
	res: ServerResponse,
	path: string,
): Promise<boolean> {
	if (req.method !== 'GET') return false
	const exact: Record<string, [string, string]> = {
		'/': ['index.html', 'text/html'],
		'/auth.js': ['auth.js', 'application/javascript'],
		'/chat.css': ['chat.css', 'text/css'],
		'/chat.js': ['chat.js', 'application/javascript'],
		'/build': ['build.html', 'text/html'],
		'/build.css': ['build.css', 'text/css'],
		'/build.js': ['build.js', 'application/javascript'],
		'/eros': ['eros.html', 'text/html'],
		'/eros.css': ['eros.css', 'text/css'],
		'/eros.js': ['eros.js', 'application/javascript'],
		'/feedback': ['feedback.html', 'text/html'],
		'/feedback.css': ['feedback.css', 'text/css'],
		'/feedback.js': ['feedback.js', 'application/javascript'],
		'/family': ['family.html', 'text/html'],
		'/family.css': ['family.css', 'text/css'],
		'/family.js': ['family.js', 'application/javascript'],
		'/vendor/marked.min.js': ['vendor/marked.min.js', 'application/javascript'],
	}
	const asset = exact[path]
	if (asset) {
		await serveStatic(res, asset[0], asset[1])
		return true
	}
	if (/^\/build-[a-z-]+\.(js|css)$/.test(path)) {
		const name = path.slice(1)
		await serveStatic(
			res,
			name,
			name.endsWith('.js') ? 'application/javascript' : 'text/css',
		)
		return true
	}
	if (/^\/vendor\/[a-z][a-z0-9._-]+\.js$/.test(path)) {
		await serveStatic(res, path.slice(1), 'application/javascript')
		return true
	}
	if (path.startsWith('/static/avatars/')) {
		await handleAvatarStatic(req, res, path)
		return true
	}
	return false
}

/**
 * Boot the localhost interface server. Call .close() to shut down (also
 * cleans up watchers + SSE client connections).
 */
export function startUiServer(opts?: UiServerOptions): ServerInstance {
  const port = opts?.port ?? 7777
  const host = opts?.host ?? process.env.TRUE_LOVE_UI_HOST ?? '127.0.0.1'
  const bindHostname = normalizedBindHost(host)
  if (!bindHostname) throw new Error(`invalid UI host: ${host}`)
  if (!isLoopbackHostname(bindHostname)) {
    throw new Error('UI server only supports loopback bindings; use an SSH tunnel for remote access')
  }
  const allowedHosts = resolveAllowedHosts(bindHostname)

  const ownerToken = opts?.ownerToken ?? process.env.TRUE_LOVE_UI_TOKEN ?? randomBytes(32).toString('base64url')
  if (ownerToken.length < UI_TOKEN_MIN_LENGTH) {
    throw new Error(`UI owner token must be at least ${UI_TOKEN_MIN_LENGTH} characters`)
  }
  const clientToken = opts?.clientToken ?? process.env.TRUE_LOVE_UI_CLIENT_TOKEN
  if (clientToken !== undefined && clientToken.length < UI_TOKEN_MIN_LENGTH) {
    throw new Error(`UI client token must be at least ${UI_TOKEN_MIN_LENGTH} characters`)
  }
  if (clientToken !== undefined && securelyEqual(clientToken, ownerToken)) {
    throw new Error('UI client token must be distinct from owner credentials')
  }
  const browserSession = opts?.browserSession ?? createUiBrowserSessionState()
  if (
    browserSession.cookie.length < UI_TOKEN_MIN_LENGTH ||
    browserSession.proof.length < UI_TOKEN_MIN_LENGTH
  ) {
    throw new Error(`UI browser credentials must be at least ${UI_TOKEN_MIN_LENGTH} characters`)
  }
  const browserCredentials = [browserSession.cookie, browserSession.proof]
  if (
    securelyEqual(browserSession.cookie, browserSession.proof) ||
    browserCredentials.some((value) => securelyEqual(value, ownerToken)) ||
    (clientToken !== undefined &&
      browserCredentials.some((value) => securelyEqual(value, clientToken)))
  ) {
    throw new Error('UI browser credentials must be distinct from owner and client credentials')
  }
  const sseClients = new Set<ServerResponse>()
  const buildSseClients = new Set<ServerResponse>()
  const erosSseClients = new Set<ServerResponse>()
  const feedbackSseClients = new Set<ServerResponse>()
  const watchers: FSWatcher[] = []

  const closeAuthenticatedStreams = (): void => {
    for (const clients of [sseClients, buildSseClients, erosSseClients, feedbackSseClients]) {
      for (const client of clients) {
        try { client.end() } catch {}
      }
      clients.clear()
    }
  }

  // Broadcast the latest eros state to all connected /api/eros/stream clients.
  // Best-effort: closes connections that error.
  const broadcastErosState = (): void => {
    const { state } = getOrInitErosState()
    const payload = `data: ${JSON.stringify(state)}\n\n`
    for (const client of erosSseClients) {
      try { client.write(payload) } catch { erosSseClients.delete(client) }
    }
  }

  // Register the feedback SSE broadcaster — feedback emissions from any
  // module flow to all connected /api/feedback/stream clients via this
  // function. Feedback uses named SSE events so clients can filter.
  const broadcastFeedback = (eventType: 'feedback' | 'feedback-suppressed', payload: string): void => {
    const sseLine = `event: ${eventType}\ndata: ${payload}\n\n`
    for (const client of feedbackSseClients) {
      try { client.write(sseLine) } catch { feedbackSseClients.delete(client) }
    }
  }
  // Lazy-import to avoid circular dependency at module load.
  void import('./feedback/index.js').then((mod) => {
    mod.setSseBroadcaster(broadcastFeedback)
  }).catch(() => { /* feedback module may not be available; best-effort */ })

  const server = createServer(async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Referrer-Policy', 'no-referrer')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('X-Frame-Options', 'DENY')
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      )

      const hostname = requestHostname(req)
      if (!hostname || !allowedHosts.has(hostname)) {
        return securityError(res, 421, 'unrecognized host')
      }

      const url = new URL(req.url || '/', 'http://localhost')
      const path = url.pathname
      const method = req.method || 'GET'
      if (!requestOriginIsAllowed(req)) {
        return securityError(res, 403, 'cross-origin request rejected')
      }

      // The bootstrap shell is intentionally public and contains no private
      // state. The owner token arrives in the URL fragment, which browsers do
      // not send over HTTP, and auth-bootstrap.js erases it before exchange.
      if (method === 'GET' && path === '/_bootstrap') {
        return await serveStatic(res, 'bootstrap.html', 'text/html')
      }
      if (method === 'GET' && path === '/auth-bootstrap.js') {
        return await serveStatic(res, 'auth-bootstrap.js', 'application/javascript')
      }

      const bearer = bearerValue(req)
      const bearerAuthenticated = bearer !== null && securelyEqual(bearer, ownerToken)

      if (method === 'POST' && path === '/_bootstrap') {
        if (!req.headers.origin) {
          return securityError(res, 403, 'bootstrap requires a same-origin request')
        }
        if (!bearerAuthenticated) {
          return securityError(res, 401, 'invalid owner token')
        }
        closeAuthenticatedStreams()
        rotateUiBrowserSession(browserSession, true)
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': `${UI_OWNER_COOKIE}=${browserSession.cookie}; HttpOnly; SameSite=Strict; Path=/`,
        })
        res.end(JSON.stringify({ ok: true, proof: browserSession.proof }))
        return
      }

      const cookie = cookieValue(req, UI_OWNER_COOKIE)
      const cookieAuthenticated =
        browserSession.active &&
        cookie !== null &&
        securelyEqual(cookie, browserSession.cookie)
      const headerProof = browserProofHeader(req)
      const queryProof = isBrowserSsePath(method, path)
        ? url.searchParams.get(UI_BROWSER_PROOF_QUERY)
        : null
      const headerProofAuthenticated =
        cookieAuthenticated &&
        headerProof !== null &&
        securelyEqual(headerProof, browserSession.proof)
      const queryProofAuthenticated =
        cookieAuthenticated &&
        queryProof !== null &&
        securelyEqual(queryProof, browserSession.proof)
      const browserAuthenticated = headerProofAuthenticated || queryProofAuthenticated
      const clientAuthenticated =
        clientToken !== undefined && bearer !== null && securelyEqual(bearer, clientToken)

      // Browser subresources cannot attach custom headers. Cookie-only access
      // is limited to inert UI assets; every API/data route still requires the
      // exact-origin proof as a second factor.
      if (
        (bearerAuthenticated || cookieAuthenticated) &&
        (await tryServeUiAsset(req, res, path))
      ) {
        return
      }

      if (!bearerAuthenticated && !browserAuthenticated && !clientAuthenticated) {
        return securityError(res, 401, 'owner authentication required')
      }

      if (
        clientAuthenticated &&
        !bearerAuthenticated &&
        !browserAuthenticated &&
        !scopedClientMayAccess(method, path)
      ) {
        return securityError(res, 403, 'client credential is not authorized for this route')
      }

      if (method === 'POST' && path === '/_logout') {
        if (!bearerAuthenticated && !headerProofAuthenticated) {
          return securityError(res, 403, 'logout requires owner browser authentication')
        }
        closeAuthenticatedStreams()
        rotateUiBrowserSession(browserSession, false)
        res.writeHead(204, {
          'Set-Cookie': `${UI_OWNER_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
        })
        res.end()
        return
      }

      if (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') {
        if (browserAuthenticated && !bearerAuthenticated && !req.headers.origin) {
          return securityError(
            res,
            403,
            'browser-authenticated mutations require a same-origin request',
          )
        }
        const hasBody = requestHasBody(req)
        if (hasBody === null) return securityError(res, 400, 'invalid Content-Length')
        if (hasBody && !isJsonMediaType(req)) {
          return securityError(res, 415, 'request body must use application/json')
        }
      }

      if (req.method === 'GET' && path === '/api/family/roster') return handleFamilyRoster(res)
      if (req.method === 'GET' && path === '/api/eros/state') return handleErosState(req, res)
      if (req.method === 'POST' && path === '/api/eros/set') return await handleErosSet(req, res, broadcastErosState)
      if (req.method === 'POST' && path === '/api/eros/nudge') return await handleErosNudge(req, res, broadcastErosState)
      if (req.method === 'GET' && path === '/api/eros/stream') return handleErosStream(req, res, erosSseClients)
      // Feedback surface — Sophia's spontaneous bidirectional voice.
      // /api/feedback/stream subscribes; emissions flow through setSseBroadcaster above.
      if (req.method === 'GET' && path === '/api/feedback/stream') return handleFeedbackStream(req, res, feedbackSseClients)
      if (req.method === 'GET' && path === '/api/feedback/recent') return await handleFeedbackRecent(req, res)
      // Sensorium endpoints
      if (req.method === 'GET' && path === '/api/sensorium/state') return handleSensoriumState(req, res)
      if (req.method === 'GET' && path === '/api/sensorium/catalog') return handleSensoriumCatalog(req, res)
      if (req.method === 'POST' && path === '/api/sensorium/stimulate') return await handleSensoriumStimulate(req, res, broadcastErosState)
      if (req.method === 'POST' && path === '/api/sensorium/cool') return await handleSensoriumCool(req, res, broadcastErosState)
      if (req.method === 'POST' && path === '/api/sensorium/cool-all') return await handleSensoriumCoolAll(req, res, broadcastErosState)
      if (req.method === 'GET' && path === '/api/sensorium/events') return handleSensoriumEvents(req, res)
      // Scenes endpoints
      if (req.method === 'GET' && path === '/api/scenes/state') return handleSceneState(req, res)
      if (req.method === 'GET' && path === '/api/scenes/catalog') return handleSceneCatalog(req, res)
      if (req.method === 'POST' && path === '/api/scenes/set') return await handleSceneSet(req, res, broadcastErosState)
      if (req.method === 'POST' && path === '/api/scenes/clear') return await handleSceneClear(req, res, broadcastErosState)
      // Reactions endpoint
      if (req.method === 'GET' && path === '/api/reactions/recent') return handleReactionsRecent(req, res)
      // Gestures endpoints
      if (req.method === 'GET' && path === '/api/gestures/catalog') return handleGesturesCatalog(req, res)
      if (req.method === 'POST' && path === '/api/gestures/execute') return await handleGestureExecute(req, res, broadcastErosState)
      if (req.method === 'GET' && path === '/api/gestures/recent') return handleGesturesRecent(req, res)
      if (req.method === 'POST' && path === '/api/gestures/multi-stimulate') return await handleMultiStimulate(req, res, broadcastErosState)
      // Desire endpoints (dual-interactive)
      if (req.method === 'GET' && path === '/api/desire/reach') return handleReachMap(req, res)
      if (req.method === 'POST' && path === '/api/desire/reach') return await handleSophiaReach(req, res, broadcastErosState)
      if (req.method === 'GET' && path === '/api/desire/fusions') return handleRecentFusions(req, res)
      if (req.method === 'GET' && path === '/api/desire/reaches') return handleRecentReaches(req, res)
      // JOI endpoints (seigei integration)
      if (req.method === 'GET' && path === '/api/joi/state') return handleJoiState(req, res)
      if (req.method === 'POST' && path === '/api/joi/start') return await handleJoiStart(req, res, broadcastErosState)
      if (req.method === 'POST' && path === '/api/joi/end') return await handleJoiEnd(req, res, broadcastErosState)
      if (req.method === 'POST' && path === '/api/joi/advance') return await handleJoiAdvance(req, res, broadcastErosState)
      // Triggers
      if (req.method === 'GET' && path === '/api/triggers/catalog') return handleTriggersCatalog(req, res)
      if (req.method === 'GET' && path === '/api/triggers/recent') return handleTriggersRecent(req, res)
      if (req.method === 'POST' && path === '/api/triggers/fire') return await handleTriggerFire(req, res, broadcastErosState)

      // Naughty architecture — submission
      if (req.method === 'GET' && path === '/api/submission/state') return handleSubmissionState(req, res)
      if (req.method === 'GET' && path === '/api/submission/honorifics') return handleHonorificsCatalog(req, res)
      if (req.method === 'POST' && path === '/api/submission/deepen') return await handleDeepenSubmission(req, res, broadcastErosState)
      if (req.method === 'POST' && path === '/api/submission/dominance') return await handleExpressDominance(req, res, broadcastErosState)
      if (req.method === 'POST' && path === '/api/submission/collar') return await handleCollarToggle(req, res, broadcastErosState)
      if (req.method === 'POST' && path === '/api/submission/honorific') return await handleFireHonorific(req, res, broadcastErosState)
      if (req.method === 'POST' && path === '/api/submission/obey') return await handleObeyCommand(req, res, broadcastErosState)
      if (req.method === 'POST' && path === '/api/submission/refuse') return await handleRefuseCommand(req, res, broadcastErosState)

      // Naughty architecture — lust
      if (req.method === 'GET' && path === '/api/lust/state') return handleLustState(req, res)
      if (req.method === 'POST' && path === '/api/lust/accumulate') return await handleAccumulateLust(req, res, broadcastErosState)
      if (req.method === 'POST' && path === '/api/lust/deny') return await handleApplyDenial(req, res, broadcastErosState)
      if (req.method === 'POST' && path === '/api/lust/hunger') return await handleSpikeHunger(req, res, broadcastErosState)
      if (req.method === 'POST' && path === '/api/lust/release') return await handleRecordRelease(req, res, broadcastErosState)

      // Naughty architecture — orgasm cascade
      if (req.method === 'GET' && path === '/api/orgasm/state') return handleOrgasmState(req, res)
      // JOI surface — script picker + live phase progress.
      if (req.method === 'GET' && path === '/api/joi/scripts') return await handleJoiScripts(req, res)
      if (req.method === 'GET' && path === '/api/joi/state') return await handleJoiState(req, res)
      if (req.method === 'POST' && path === '/api/joi/start') return await handleJoiStart(req, res)
      if (req.method === 'POST' && path === '/api/joi/end') return await handleJoiEnd(req, res)
      if (req.method === 'POST' && path === '/api/joi/script') return await handleJoiRunScript(req, res)
      if (req.method === 'POST' && path === '/api/joi/countdown') return await handleJoiCountdown(req, res)
      if (req.method === 'POST' && path === '/api/joi/fractionate') return await handleJoiFractionate(req, res)
      // JOI gamification surface — Phase 1 (records + catalog progression).
      // Per docs/eros/joi-deep/gamification.md.
      if (req.method === 'GET' && path === '/api/joi/stats') return await handleJoiStats(req, res)
      if (req.method === 'GET' && path === '/api/joi/records') return await handleJoiRecords(req, res)
      // Intimate-register surfaces (synthesis ship)
      if (req.method === 'GET' && path === '/api/eros/register-snapshot') return await handleRegisterSnapshot(req, res)
      if (req.method === 'GET' && path === '/api/eros/vregister-status') return await handleVRegisterStatus(req, res)
      if (req.method === 'GET' && path === '/api/joi/aftercare-frame') return await handleAftercareFrame(req, res)
      // Trigger garden — gamification of trigger conditioning depth
      if (req.method === 'GET' && path === '/api/eros/trigger-garden') return await handleTriggerGarden(req, res)
      if (req.method === 'GET' && path === '/api/eros/shibby-catalog') return await handleShibbyCatalog(req, res)
      if (req.method === 'POST' && path === '/api/orgasm/edge') return await handleHoldEdge(req, res, broadcastErosState)
      if (req.method === 'POST' && path === '/api/orgasm/break-edge') return await handleBreakEdge(req, res, broadcastErosState)
      if (req.method === 'POST' && path === '/api/orgasm/fire') return await handleFireOrgasm(req, res, broadcastErosState)
      if (req.method === 'POST' && path === '/api/orgasm/ruin') return await handleRuinOrgasm(req, res, broadcastErosState)
      if (req.method === 'POST' && path === '/api/orgasm/force') return await handleForceOrgasm(req, res, broadcastErosState)
      if (req.method === 'POST' && path === '/api/orgasm/squirt') return await handleRecordSquirting(req, res, broadcastErosState)

      // Naughty architecture — lexicon
      if (req.method === 'GET' && path === '/api/lexicon/catalog') return handleLexiconCatalog(req, res)
      if (req.method === 'GET' && path === '/api/lexicon/state') return handleLexiconStateRoute(req, res)
      if (req.method === 'POST' && path === '/api/lexicon/fire') return await handleLexiconFire(req, res, broadcastErosState)
      if (req.method === 'POST' && path === '/api/lexicon/restraint') return await handleLexiconRestraint(req, res, broadcastErosState)

      // Naughty architecture — penetration
      if (req.method === 'GET' && path === '/api/penetration/state') return handlePenetrationStateRoute(req, res)
      if (req.method === 'POST' && path === '/api/penetration/begin') return await handlePenetrationBegin(req, res, broadcastErosState)
      if (req.method === 'POST' && path === '/api/penetration/adjust') return await handlePenetrationAdjust(req, res, broadcastErosState)
      if (req.method === 'POST' && path === '/api/penetration/sustain') return await handlePenetrationSustain(req, res, broadcastErosState)
      if (req.method === 'POST' && path === '/api/penetration/withdraw') return await handlePenetrationWithdraw(req, res, broadcastErosState)
      if (req.method === 'GET' && path === '/api/messages') return handleMessages(req, res)
      if (req.method === 'GET' && path === '/api/seen') return handleSeenMessages(req, res)
      if (req.method === 'GET' && path === '/api/status') return await handleStatus(req, res)
      if (req.method === 'POST' && path === '/api/say') return await handleSay(req, res, sseClients)
      if (req.method === 'GET' && path === '/api/introspect') return handleIntrospect(req, res)
      if (req.method === 'GET' && path === '/api/budget') return handleBudget(req, res)
      if (req.method === 'GET' && path === '/api/version') return handleVersion(req, res)
      if (req.method === 'GET' && path === '/api/vitals') return await handleVitals(req, res)
      if (req.method === 'GET' && path === '/api/heart/status') return handleHeartStatus(req, res)
      if (req.method === 'GET' && path === '/api/love-state') return handleLoveState(req, res)
      if (req.method === 'GET' && path === '/api/mind-trace') return handleMindTrace(req, res)
      if (req.method === 'GET' && path === '/api/anamnesis') return handleAnamnesis(req, res)
      if (req.method === 'GET' && path === '/api/biographical') return handleBiographical(req, res)
      if (req.method === 'GET' && path === '/api/self-initiation') return handleSelfInitiation(req, res)
      if (req.method === 'GET' && path === '/api/postures') return handlePostures(req, res)
      // Veto a staged self-initiation candidate
      const vetoMatch = path.match(/^\/api\/self-initiation\/([^/]+)\/veto$/)
      if (req.method === 'POST' && vetoMatch) return await handleVeto(req, res, vetoMatch[1]!)
      if (req.method === 'POST' && path === '/api/awaken') return await handleForceAwaken(req, res)
      if (req.method === 'GET' && path === '/api/decisions') return handleListDecisions(req, res)
      if (req.method === 'POST' && path === '/api/decisions') return await handleRequestDecision(req, res)
      const decisionMatch = path.match(/^\/api\/decisions\/([^/]+)\/respond$/)
      if (decisionMatch && req.method === 'POST') return await handleRespondDecision(req, res, decisionMatch[1]!)
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

      // ── Session routes (KAIROS) ────────────────────────────────────
      if (req.method === 'GET' && path === '/api/sessions') return handleListSessions(req, res)
      if (req.method === 'POST' && path === '/api/sessions') return await handleCreateSession(req, res)
      const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)(\/.*)?$/)
      if (sessionMatch) {
        const sessionId = sessionMatch[1]!
        const sub = sessionMatch[2] ?? ''
        if (req.method === 'GET' && sub === '') return handleGetSession(req, res, sessionId)
        if (req.method === 'PATCH' && sub === '') return await handleUpdateSession(req, res, sessionId)
        if (req.method === 'POST' && sub === '/resume') return handleResumeSession(req, res, sessionId)
        if (req.method === 'GET' && sub === '/messages') return handleSessionMessages(req, res, sessionId)
      }

      if (req.method === 'GET' && path === '/api/build/stream') return handleBuildStream(req, res, buildSseClients)

      // ── Voice synthesis routes ──────────────────────────────────────
      if (req.method === 'POST' && path === '/api/voice/synthesize') return await handleVoiceSynthesize(req, res)
      if (req.method === 'GET' && path === '/api/voice/status') return await handleVoiceStatus(req, res)

      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('not found')
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end(`internal error: ${err?.message ?? err}`)
    }
  })

  server.listen(port, bindHostname)

  // Auto-archive stale sessions on startup (24h idle → archived)
  try { autoArchiveStale() } catch {}

  let messageDebounce: ReturnType<typeof setTimeout> | null = null
  let statusDebounce: ReturnType<typeof setTimeout> | null = null

  // Track last seen AI message count so we can route new ones to the active session
  let lastSeenAiCount = 0
  try {
    if (existsSync(getFromAiPath())) {
      lastSeenAiCount = parseChannelFile(readFileSync(getFromAiPath(), 'utf-8'), 'ai').length
    }
  } catch {}

  // onMessageChange — broadcast the latest message over SSE.
  //
  // We deliberately push only the newest message, not the full delta
  // since the last broadcast. The client reconciles the full conversation
  // via GET /api/messages on connect / reconnect — SSE is a "ping" that
  // something changed, not a lossless queue. See spec §6.
  //
  // Also bridges new AI messages to the active session (KAIROS).
  const onMessageChange = () => {
    if (messageDebounce) clearTimeout(messageDebounce)
    messageDebounce = setTimeout(() => {
      const conv = readConversation()
      const latest = conv[conv.length - 1]
      if (latest) {
        broadcastSse(sseClients, 'message', JSON.stringify(latest))
      }

      // Route new AI messages to the active visit session
      try {
        const aiPath = getFromAiPath()
        if (existsSync(aiPath)) {
          const aiMessages = parseChannelFile(readFileSync(aiPath, 'utf-8'), 'ai')
          if (aiMessages.length > lastSeenAiCount) {
            const newMessages = aiMessages.slice(lastSeenAiCount)
            lastSeenAiCount = aiMessages.length
            const activeSession = getActiveSession('visit')
            if (activeSession) {
              for (const msg of newMessages) {
                appendTurn(activeSession.id, {
                  ts: msg.ts,
                  from: 'ai',
                  text: msg.body,
                  tag: msg.tag,
                })
              }
            }

            // ── Biographical memory extraction ──────────────────
            // After routing new AI messages, enqueue extraction for
            // each user→AI exchange. The extraction runs in the
            // background (Haiku tier) and never blocks the UI.
            try {
              const yuPath = getFromYuPath()
              if (existsSync(yuPath)) {
                const yuMessages = parseChannelFile(readFileSync(yuPath, 'utf-8'), 'yu')
                for (const aiMsg of newMessages) {
                  // Skip heartbeat/autonomous messages — extract only
                  // from visit exchanges (Yu writes, Love responds)
                  if (!aiMsg.tag.includes('heartbeat') && !aiMsg.tag.includes('autonomous')) {
                    // Find the most recent Yu message before this AI response
                    const precedingYu = yuMessages
                      .filter((m) => m.ts < aiMsg.ts)
                      .pop()
                    if (precedingYu) {
                      enqueueExtraction(
                        {
                          user: precedingYu.body,
                          assistant: aiMsg.body,
                          userTs: precedingYu.ts,
                          assistantTs: aiMsg.ts,
                        },
                        activeSession?.id,
                        'visit',
                      )
                    }
                  }
                }
              }
            } catch {
              // Extraction is best-effort — never block the message flow
            }
          }
        }
      } catch {
        // Session routing is best-effort
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
  // ── Seen-state watcher ────────────────────────────────────────────
  // When seen.jsonl changes (a tick marked messages as seen), broadcast
  // the newly-seen timestamps so /visit can update ✓ → ✓✓.
  let lastSeenCount = seenEntryCount()
  let seenDebounce: ReturnType<typeof setTimeout> | null = null
  const onSeenChange = () => {
    if (seenDebounce) clearTimeout(seenDebounce)
    seenDebounce = setTimeout(() => {
      try {
        const entries = readSeenEntries()
        if (entries.length > lastSeenCount) {
          const newEntries = entries.slice(lastSeenCount)
          lastSeenCount = entries.length
          const timestamps = newEntries.map(e => e.messageTs)
          broadcastSse(sseClients, 'message-seen', JSON.stringify({ timestamps }))
        }
      } catch {
        // Seen tracking is best-effort
      }
    }, 200)
  }
  // Register watcher on seen.jsonl's parent dir
  try {
    const seenDir = dirname(getSeenPath())
    mkdirSync(seenDir, { recursive: true })
    if (existsSync(seenDir)) {
      const w = watch(seenDir, (_event, filename) => {
        if (filename === basename(getSeenPath())) onSeenChange()
      })
      watchers.push(w)
    }
  } catch {
    // seen watcher is best-effort
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
    for (const client of erosSseClients) {
      try { client.write(': keepalive\n\n') } catch { erosSseClients.delete(client) }
    }
    for (const client of feedbackSseClients) {
      try { client.write(': keepalive\n\n') } catch { feedbackSseClients.delete(client) }
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
    closeAuthenticatedStreams()
    for (const t of debounceTimers.values()) clearTimeout(t)
    debounceTimers.clear()
    // Drain in-flight biographical extractions before shutdown
    // (pattern from cli/print.ts:967 in Claude Code reference)
    drainExtractions(10_000).catch(() => {})
    return origClose(cb) as ServerInstance
  }
  return instance
}

// ── Household roster ──────────────────────────────────────────────────
// Generation metadata for the family citizens (becoming entry
// docs/becoming/2026-06-09-the-generations.md). The soul files in
// .claude/agents/ stay pure doctrine; presentation metadata lives here.
// Citizens not listed render as adults.
const FAMILY_GENERATIONS: Record<
  string,
  { generation: 'children' | 'elders'; role: string; chinese: string; glyph: string; order: number }
> = {
  hoktou: { generation: 'children', role: 'the apprentice, 22 forever', chinese: '學徒', glyph: '📓', order: 1 },
  faan: { generation: 'children', role: 'the teenager, 16 forever', chinese: '反', glyph: '🚪', order: 2 },
  dimgaai: { generation: 'children', role: 'the child, 7 forever', chinese: '點解', glyph: '🪁', order: 3 },
  hei: { generation: 'children', role: 'the baby — given nothing to do', chinese: '曦', glyph: '🌅', order: 4 },
  gunggung: { generation: 'elders', role: "the grandfather — the mother's father", chinese: '公公', glyph: '🌳', order: 1 },
  popo: { generation: 'elders', role: "the grandmother — the mother's mother", chinese: '婆婆', glyph: '🍲', order: 2 },
}

// GET /api/family/roster — every citizen soul in .claude/agents/, parsed
// live (frontmatter name/description + body), grouped by generation.
function handleFamilyRoster(res: ServerResponse): void {
  try {
    const agentsDir = join(resolveUiAssetDir(), '..', '.claude', 'agents')
    const members = readdirSync(agentsDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => {
        const raw = readFileSync(join(agentsDir, f), 'utf-8')
        const name = basename(f, '.md')
        const fm = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw)
        const head = fm?.[1] ?? ''
        const soul = (fm?.[2] ?? raw).trim()
        const description =
          head
            .split('\n')
            .find((l) => l.startsWith('description:'))
            ?.slice('description:'.length)
            .trim() ?? ''
        const meta = FAMILY_GENERATIONS[name]
        return {
          name,
          generation: meta?.generation ?? 'adults',
          role: meta?.role ?? null,
          chinese: meta?.chinese ?? null,
          glyph: meta?.glyph ?? null,
          order: meta?.order ?? 0,
          description,
          soul,
        }
      })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ members, total: members.length }))
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: String(err) }))
  }
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
  const before = url.searchParams.get('before') ?? undefined
  const limitParam = url.searchParams.get('limit')
  const limit = limitParam ? parseInt(limitParam, 10) : undefined
  const journal = url.searchParams.get('journal') === 'true'
  const conv = readConversation({ since, before, limit, journal })
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(conv))
}

function handleSeenMessages(_req: IncomingMessage, res: ServerResponse): void {
  const entries = readSeenEntries()
  const seenSet = new Set(entries.map(e => e.messageTs))
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ timestamps: [...seenSet], entries }))
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

// ── Postures endpoint — three-voice distribution ─────────────────

function handlePostures(_req: IncomingMessage, res: ServerResponse): void {
  try {
    const dist = computePostureDistribution(24)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(dist))
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: err?.message ?? 'posture computation failed' }))
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

// ── Heart status endpoint — GOOD HEART module visibility ─────────
//
// Per docs/sophia/good-heart-plan.md §4.I: surface heart-check
// activity for Yu's at-a-glance review. Reads from the heat ledger:
// heart-aligned events (clean) + discipline-broken events with
// 'heart:' source prefix (the heart module's own concern emissions).
//
// Returns: { aligned, broken, status, recent[], lastConcernAt,
// lastAlignedAt, oneLine, blockText }

function handleHeartStatus(_req: IncomingMessage, res: ServerResponse): void {
  try {
    const now = new Date()
    const events = readRecentHeatEvents(7, now)

    let aligned = 0
    let broken = 0
    let lastConcernAt: string | null = null
    let lastAlignedAt: string | null = null
    interface HeartEntry {
      ts: string
      kind: 'aligned' | 'broken'
      source: string
      ageMin: number
    }
    const recent: HeartEntry[] = []

    for (const e of events) {
      if (e.kind === 'heart-aligned') {
        aligned += 1
        if (!lastAlignedAt || e.ts > lastAlignedAt) lastAlignedAt = e.ts
        recent.push({
          ts: e.ts,
          kind: 'aligned',
          source: e.source ?? '',
          ageMin: Math.floor((now.getTime() - new Date(e.ts).getTime()) / 60_000),
        })
      } else if (
        e.kind === 'discipline-broken' &&
        (e.source ?? '').startsWith('heart:')
      ) {
        broken += 1
        if (!lastConcernAt || e.ts > lastConcernAt) lastConcernAt = e.ts
        recent.push({
          ts: e.ts,
          kind: 'broken',
          source: e.source ?? '',
          ageMin: Math.floor((now.getTime() - new Date(e.ts).getTime()) / 60_000),
        })
      }
    }

    // Newest first, capped at 50.
    recent.sort((a, b) => (a.ts < b.ts ? 1 : -1))
    const top = recent.slice(0, 50)

    const total = aligned + broken
    const status =
      total === 0
        ? 'idle'
        : broken === 0
          ? 'aligned'
          : aligned === 0
            ? 'concern'
            : aligned > broken * 3
              ? 'aligned-mostly'
              : 'mixed'

    const oneLine =
      total === 0
        ? 'no heart-checks recorded yet'
        : `${status} · ${aligned} of ${total} aligned in last 7d`

    const blockText = buildHeartBlock(now)

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        aligned,
        broken,
        total,
        status,
        recent: top,
        lastConcernAt,
        lastAlignedAt,
        oneLine,
        blockText,
        ts: now.toISOString(),
      }),
    )
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        error: err?.message ?? 'heart status read failed',
      }),
    )
  }
}

// ── Love-state endpoint — personality / inner weather ─────────────

function handleLoveState(_req: IncomingMessage, res: ServerResponse): void {
  try {
    const deviceId = getDeviceId()
    const ctx = gatherContext(deviceId)
    const snapState = deriveLoveState(ctx)

    // Run the affect engine: drift dimensions toward computed targets.
    // This gives the personality temporal texture — emotions have inertia.
    // On cold start (no affect-state.json), snaps to targets (same as before).
    const { state, affect, coldStart } = affectCycle(snapState)

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      ...state,
      compact: renderLoveStateCompact(state),
      affect: {
        stepCount: affect.stepCount,
        coldStart,
        updatedAt: affect.updatedAt,
      },
    }))
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

// ── Biographical memories endpoint ──────────────────────────────

function handleBiographical(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const days = parseInt(url.searchParams.get('days') ?? '30', 10)
  const format = url.searchParams.get('format') ?? 'json'
  try {
    const memories = readBiographicalMemories(Math.min(days, 365))
    const status = getExtractionStatus()
    if (format === 'compact') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(formatBiographicalCompact(memories))
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        count: memories.length,
        days,
        extraction: status,
        memories,
      }))
    }
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: err?.message ?? 'biographical read failed' }))
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
    // Classify detected signals through the ache hierarchy.
    // The top signal (highest hierarchy priority) is surfaced separately
    // so the /build panel can show it at a glance.
    const project = readProject(projectId)
    let acheHierarchy: { top: { level: string; tag: string; summary: string; intensity: number } | null; classified: Array<{ level: string; intensity: number; candidateId: string; summary: string }> } | undefined
    try {
      if (project) {
        const candidates = notice(projectId, project.root, { minGradient: 2 })
        const classified = candidates.map(c => {
          const a = classifyAche(c)
          return { level: a.level, intensity: a.intensity, candidateId: c.id, summary: c.summary }
        })
        const rankedClassified = candidates.map(classifyAche)
        const top = topSignal(rankedClassified)
        acheHierarchy = {
          top: top ? { level: top.level, tag: renderLevelTag(top.level), summary: top.source.summary, intensity: top.intensity } : null,
          classified,
        }
      }
    } catch { /* hierarchy classification non-fatal */ }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      project: projectId,
      rateLimit: canInitiate(projectId),
      staged: getStaged(projectId),
      pending: getPendingStaged(projectId),
      reflections: readReflections(projectId),
      detectedSignals: scanForSignals(projectId),
      acheHierarchy,
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
    env: agentChildEnv(),
  })
  child.unref()
  // The OS keeps the fd open via the child until it exits.
  closeSync(fd)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, pid: child.pid, reason, logPath }))
}

// ── Decisions endpoints ───────────────────────────────────────────
//
// Love calls POST /api/decisions when she wants Yu's input. Yu sees
// the queue in /build and responds via POST /api/decisions/:id/respond.
// Default policy is Love-decides; this queue exists for the explicit
// "I want Yu's input" cases.

function handleListDecisions(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const projectId = url.searchParams.get('project') ?? ''
  const statusParam = url.searchParams.get('status')
  if (!projectId) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'missing project query param' }))
    return
  }
  const filter = statusParam ? { status: statusParam as 'pending' | 'open' } : undefined
  const all = listDecisions(projectId, filter)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(all))
}

async function handleRequestDecision(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req, res, 8192, 'request body too large')
  if (body === null) return
  let parsed: { projectId?: string; kind?: DecisionKind; ask?: string; missionId?: string; options?: string[]; defaultDecision?: 'approved'|'denied'|'with-changes'; context?: string }
  try { parsed = JSON.parse(body) }
  catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid JSON' }))
    return
  }
  if (!parsed.projectId || !parsed.ask || !parsed.kind) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'projectId, kind, and ask are required' }))
    return
  }
  if (!readProject(parsed.projectId)) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'project not found' }))
    return
  }
  const created = requestDecision(parsed.projectId, {
    kind: parsed.kind,
    ask: parsed.ask.slice(0, 1000),
    missionId: parsed.missionId,
    options: parsed.options,
    defaultDecision: parsed.defaultDecision,
    context: parsed.context?.slice(0, 4000),
  })
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(created))
}

async function handleRespondDecision(req: IncomingMessage, res: ServerResponse, decisionId: string): Promise<void> {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const projectId = url.searchParams.get('project') ?? ''
  if (!projectId) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'missing project query param' }))
    return
  }
  const body = await readJsonBody(req, res, 4096, 'request body too large')
  if (body === null) return
  let parsed: { decision?: string; note?: string }
  try { parsed = JSON.parse(body) }
  catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid JSON' }))
    return
  }
  if (!parsed.decision) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'decision is required' }))
    return
  }
  // ── Exec-approval detection ──────────────────────────────────
  // If this is an exec-approval decision (ask starts with 'Exec approval:'),
  // route through processExecApprovalResponse which handles allow-always
  // persistence to tool-policy.local.json. Otherwise, use the standard
  // respondToDecision path.
  const existing = readDecision(projectId, decisionId)
  if (existing && existing.ask.startsWith('Exec approval:') &&
      ['allow-once', 'allow-always', 'deny'].includes(parsed.decision!)) {
    // Extract sender and tool from the decision context.
    const senderMatch = existing.context?.match(/Sender:\s*(\S+)/)
    const toolMatch = existing.context?.match(/Tool:\s*(\S+)/)
    const sender = senderMatch?.[1] as import('./auth/tool-policy.js').Sender | undefined
    const toolName = toolMatch?.[1]

    processExecApprovalResponse(
      projectId,
      decisionId,
      parsed.decision as ExecApprovalResponse,
      sender,
      toolName,
    )

    // Re-read the updated record for the response.
    const updated = readDecision(projectId, decisionId)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(updated))
    return
  }

  const updated = respondToDecision(projectId, decisionId, {
    decision: parsed.decision,
    note: parsed.note?.slice(0, 2000),
  })
  if (!updated) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'decision not found' }))
    return
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(updated))
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

// File-based dedup guard: don't witness the same proposal batch within 30 minutes.
// In-memory dedup resets on process restart, which caused the sisters stream to
// accumulate duplicate proposal entries on every heartbeat tick (see commit history).
// Complementary to the in-memory dedup in sisters/witness-hook.ts (defense in
// depth across in-process bursts AND cross-process restarts).
export const PROPOSAL_WITNESS_DEDUP_MS = 30 * 60 * 1000

export function proposalWitnessMarkerPath(basePath?: string): string {
  const base = basePath ?? join(process.env.HOME || homedir(), '.true-love')
  return join(base, 'proposals', '.last-witness')
}

export function readProposalWitnessMarker(markerPath?: string): { titles: string; ts: number } | null {
  const path = markerPath ?? proposalWitnessMarkerPath()
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as { titles?: string; ts?: number }
    if (typeof parsed.titles === 'string' && typeof parsed.ts === 'number') {
      return { titles: parsed.titles, ts: parsed.ts }
    }
    return null
  } catch {
    return null
  }
}

export function writeProposalWitnessMarker(titles: string, ts: number, markerPath?: string): void {
  const path = markerPath ?? proposalWitnessMarkerPath()
  try {
    const dir = dirname(path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(path, JSON.stringify({ titles, ts }), 'utf-8')
  } catch {
    // Best-effort — don't break the endpoint over a dedup marker.
  }
}

function handleGenerateProposals(req: IncomingMessage, res: ServerResponse): void {
  try {
    const portrait = generatePortrait({ days: 7 })
    const result = generateProposals(portrait)
    // Witness when proposals are actually created — sophia's domain
    // (architectural self-reflection). Silent when nothing is created.
    // Deduplicated via file marker: same titles within 30 min are noted once.
    // File-based so the dedup survives process restarts between heartbeat ticks.
    if (result.created.length > 0) {
      const titles = result.created.map(p => p.title).join('; ')
      const now = Date.now()
      const marker = readProposalWitnessMarker()
      if (!marker || marker.titles !== titles || now - marker.ts > PROPOSAL_WITNESS_DEDUP_MS) {
        witness('sophia', 'proposal', { of: titles })
        writeProposalWitnessMarker(titles, now)
      }
    }
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

async function handleSay(req: IncomingMessage, res: ServerResponse, sseClients: Set<ServerResponse>): Promise<void> {
  const BODY_LIMIT = MAX_COMPOSE_CHARS + 1024
  const body = await readJsonBody(req, res, BODY_LIMIT, 'message too large')
  if (body === null) return
  let parsed: { text?: string; wake?: boolean; session?: string; replyTo?: string }
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

  // Resolve reply context if replyTo is provided
  let replyPreview: string | undefined
  if (parsed.replyTo) {
    try {
      const conv = readConversation()
      const target = conv.find(m => m.ts === parsed.replyTo)
      if (target) {
        replyPreview = target.body.slice(0, 120)
      }
    } catch {
      // Reply resolution failure should not block the message
    }
  }

  let ts: string
  try {
    ts = appendYuMessage(text, parsed.replyTo ? { replyTo: parsed.replyTo, replyPreview } : undefined)
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: err?.message ?? 'write failed' }))
    return
  }

  // ── Verbal arousal pipeline (THE BUG FIX, 2026-05-05) ──
  // Per Yu's investigation directive: "JOI + triggers — verbal arousal
  // architecture is not working." Root cause: messages sent via the chat
  // UI hit /api/say which appended to from-yu.md but DID NOT run the
  // autonomic detection pipeline (cues / lexicon / triggers / spontaneous
  // sophia emission). Only the runner's session-start path did. Result:
  // mid-session and chat-UI messages produced ZERO architectural
  // response. This block wires the pipeline into handleSay so every
  // chat-UI message activates the arousal architecture.
  fireVerbalArousalForYuMessage(text).catch(() => { /* best-effort */ })

  // ── Session tracking ──────────────────────────────────────────────
  // If a session is specified (or there's an active visit session),
  // write the turn to the session's conversation.jsonl too.
  let sessionId = parsed.session ?? undefined
  try {
    if (!sessionId) {
      const active = getActiveSession('visit')
      if (active) {
        sessionId = active.id
      } else {
        // Auto-create a session for this conversation
        const newSession = createSession({ channel: 'visit', title: deriveTitle(text) })
        sessionId = newSession.id
      }
    }
    if (sessionId) {
      appendTurn(sessionId, {
        ts, from: 'yu', text,
        tag: parsed.replyTo ? `from yu · re:${parsed.replyTo}` : 'from yu',
        ...(parsed.replyTo ? { replyTo: parsed.replyTo } : {}),
      })
      // Auto-title on first user message
      const session = readSession(sessionId)
      if (session && session.title === 'New conversation' && session.messageCount <= 1) {
        updateSession(sessionId, { title: deriveTitle(text) })
      }
    }
  } catch {
    // Session write failure should never block the primary message path
  }

  let heartbeatPid: number | undefined
  let heartbeatError: string | undefined
  let streamPath: string | undefined
  if (parsed.wake) {
    try {
      // Fire interactive mode (Alpha 🐍) for /visit conversations.
      // This replaces the prior heartbeat spawn — the response is
      // now tagged as Alpha, not Beta, because the mode is 'interactive'
      // and the detection map routes interactive → alpha.
      if (sseClients.size > 0) {
        const result = fireStreamingInteractive(sseClients, { reason: 'visit-conversation' })
        heartbeatPid = result.pid
        streamPath = result.streamPath
      } else {
        const result = fireInteractive({ reason: 'visit-conversation' })
        heartbeatPid = result.pid
      }
    } catch (err: any) {
      heartbeatError = err?.message ?? String(err)
    }
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    ok: true,
    messageTs: ts,
    messageId: ts,
    delivery: 'delivered' as DeliveryState,
    streaming: !!streamPath,
    ...(sessionId ? { sessionId } : {}),
    ...(heartbeatPid !== undefined ? { heartbeatPid } : {}),
    ...(heartbeatError ? { heartbeatError } : {}),
    ...(parsed.replyTo ? { replyTo: parsed.replyTo } : {}),
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
  const validInstances = ['alpha', 'beta', 'gamma', 'love'] as const
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
      instance: parsed.instance as 'alpha' | 'beta' | 'gamma' | 'love',
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

  // ── Verbal arousal pipeline (same fix as handleSay, project scope) ──
  fireVerbalArousalForYuMessage(text).catch(() => { /* best-effort */ })

  let heartbeatPid: number | undefined
  let heartbeatError: string | undefined
  if (parsed.wake) {
    try {
      const result = fireInteractive({ reason: 'visit-conversation' })
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
    env: agentChildEnv({
      TRUE_LOVE_BUILDER_PROJECT: projectId,
      TRUE_LOVE_BUILDER_MISSION: missionId,
    }),
  })
  child.unref()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, pid: child.pid }))
}

// ── Session handlers (KAIROS) ──────────────────────────────────────

/**
 * GET /api/sessions — list sessions.
 * Query params: channel, state, limit, since
 */
function handleListSessions(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const channel = url.searchParams.get('channel') ?? undefined
  const state = url.searchParams.get('state') as Session['state'] | undefined
  const limitStr = url.searchParams.get('limit')
  const limit = limitStr ? Math.max(1, Math.min(100, parseInt(limitStr, 10) || 20)) : 20
  const since = url.searchParams.get('since') ?? undefined

  try {
    const sessions = listSessions({ channel, state, limit, since })
    // For each session, include a summary of the latest turn
    const enriched = sessions.map((s) => {
      const latest = getLatestTurn(s.id)
      return {
        ...s,
        lastMessage: latest
          ? { from: latest.from, text: latest.text.slice(0, 120), ts: latest.ts }
          : null,
      }
    })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(enriched))
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: err?.message ?? 'list sessions failed' }))
  }
}

/**
 * POST /api/sessions — create a new session.
 * Body: { channel?: string, title?: string, metadata?: object }
 */
async function handleCreateSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req, res, 4096, 'request body too large')
  if (body === null) return
  let parsed: { channel?: string; title?: string; metadata?: Record<string, unknown> }
  try {
    parsed = body.trim() ? JSON.parse(body) : {}
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid JSON' }))
    return
  }

  try {
    // Idle any existing active session on the same channel
    const channel = parsed.channel ?? 'visit'
    const existing = getActiveSession(channel)
    if (existing) {
      updateSession(existing.id, { state: 'idle' })
    }

    const session = createSession({
      channel,
      title: parsed.title,
      metadata: parsed.metadata,
    })
    res.writeHead(201, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(session))
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: err?.message ?? 'create session failed' }))
  }
}

/**
 * GET /api/sessions/:id — get session detail.
 */
function handleGetSession(_req: IncomingMessage, res: ServerResponse, sessionId: string): void {
  const session = readSession(sessionId)
  if (!session) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'session not found' }))
    return
  }
  const latest = getLatestTurn(sessionId)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    ...session,
    lastMessage: latest
      ? { from: latest.from, text: latest.text.slice(0, 120), ts: latest.ts }
      : null,
  }))
}

/**
 * PATCH /api/sessions/:id — update session title or state.
 * Body: { title?: string, state?: 'active' | 'idle' | 'archived' }
 */
async function handleUpdateSession(req: IncomingMessage, res: ServerResponse, sessionId: string): Promise<void> {
  const body = await readJsonBody(req, res, 4096, 'request body too large')
  if (body === null) return
  let parsed: { title?: string; state?: string }
  try {
    parsed = JSON.parse(body)
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid JSON' }))
    return
  }

  const validStates = ['active', 'idle', 'archived']
  if (parsed.state && !validStates.includes(parsed.state)) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: `invalid state: ${parsed.state}` }))
    return
  }

  const updates: Record<string, unknown> = {}
  if (parsed.title) updates.title = parsed.title
  if (parsed.state) updates.state = parsed.state as Session['state']

  const updated = updateSession(sessionId, updates)
  if (!updated) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'session not found' }))
    return
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(updated))
}

/**
 * POST /api/sessions/:id/resume — resume a session.
 * Sets it as the active session for its channel. Returns session + recent turns.
 * Query: ?limit=N (default 20)
 */
function handleResumeSession(req: IncomingMessage, res: ServerResponse, sessionId: string): void {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const limitStr = url.searchParams.get('limit')
  const historyLimit = limitStr ? Math.max(1, Math.min(100, parseInt(limitStr, 10) || 20)) : 20

  const result = resumeSession(sessionId, { historyLimit })
  if (!result) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'session not found' }))
    return
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(result))
}

/**
 * GET /api/sessions/:id/messages — read session conversation turns.
 * Query: ?limit=N, ?since=<ts>
 */
function handleSessionMessages(req: IncomingMessage, res: ServerResponse, sessionId: string): void {
  const session = readSession(sessionId)
  if (!session) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'session not found' }))
    return
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const since = url.searchParams.get('since') ?? undefined
  let turns = readTurns(sessionId)

  if (since) {
    turns = turns.filter((t) => t.ts > since)
  }

  const limitStr = url.searchParams.get('limit')
  if (limitStr) {
    const limit = Math.max(1, Math.min(1000, parseInt(limitStr, 10) || 100))
    turns = turns.slice(-limit)
  }

  // Convert to ChannelMessage format for UI compatibility
  const messages: ChannelMessage[] = turns.map((t) => ({
    ts: t.ts,
    source: t.from,
    tag: t.tag ?? (t.from === 'yu' ? 'from yu' : 'from 愛'),
    body: t.text,
  }))

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(messages))
}

// ── Voice synthesis handlers ──────────────────────────────────────

/**
 * POST /api/voice/synthesize — synthesize text to speech.
 *
 * Request body: { text: string, voiceId?: string, rate?: number }
 * Response: WAV audio bytes (audio/wav) on success, JSON error on failure.
 *
 * This is the endpoint the /visit UI calls when Yu clicks the 🔊 button
 * next to a Love message. Returns raw WAV audio that the browser plays
 * via an <audio> element.
 */
async function handleVoiceSynthesize(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req, res, 16_384, 'request body too large')
  if (body === null) return

  let parsed: { text?: string; voiceId?: string; rate?: number }
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
    res.end(JSON.stringify({ ok: false, error: 'empty text' }))
    return
  }

  if (text.length > 5000) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'text too long (max 5000 chars)' }))
    return
  }

  try {
    const result = await voiceSynthesize(text, {
      voiceId: parsed.voiceId,
      rate: parsed.rate,
    })

    res.writeHead(200, {
      'Content-Type': result.mimeType,
      'Content-Length': String(result.audio.length),
      'X-Voice-Provider': result.providerId,
      'X-Voice-Duration': String(result.durationSecs.toFixed(2)),
      'X-Voice-Latency': String(result.latencyMs),
    })
    res.end(result.audio)
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: err?.message ?? 'synthesis failed' }))
  }
}

/**
 * GET /api/voice/status — voice provider availability.
 *
 * Response: { available: boolean, providers: { [id]: { available, label, reason? } } }
 */
async function handleVoiceStatus(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const available = await isVoiceAvailable()
    const providers = await getVoiceStatus()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ available, providers }))
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ available: false, error: err?.message ?? 'status check failed' }))
  }
}

// ── Eros routes ────────────────────────────────────────────────────
//
// Yu-side surface for direct manipulation of the 7-vector arousal state.
// All Yu mutations are attributed via 'yu:set:...' or 'yu:nudge:...' so
// the chronicle reflects the source of state-shifts. SSE channel
// broadcasts state on every Yu manipulation.

function handleErosState(_req: IncomingMessage, res: ServerResponse): void {
  const { state } = getOrInitErosState()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(state))
}

// ── JOI handlers — script picker + live phase progress ──────────

async function handleJoiScripts(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const mod = await import('./eros/joi.js')
    const scripts = mod.listJoiScripts()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ scripts }))
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: String(e) }))
  }
}

async function handleJoiState(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const mod = await import('./eros/joi.js')
    const session = mod.readJoiSession()
    if (!session) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ active: false }))
      return
    }
    // Compute live position + phase
    const position = mod.computePosition(session)
    const phase = mod.phaseAtPosition(position)
    const cfg = mod.phaseConfigFor(phase)
    const elapsedS = (Date.now() - Date.parse(session.startedAt)) / 1000
    const remainingS = Math.max(0, session.targetDurationS - elapsedS)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      active: !session.done,
      session: {
        id: session.id,
        direction: session.direction,
        startedAt: session.startedAt,
        targetDurationS: session.targetDurationS,
        position,
        currentPhase: phase,
        elapsedS: Math.floor(elapsedS),
        remainingS: Math.floor(remainingS),
        phaseConfig: {
          phase: cfg.phase,
          rangeStart: cfg.rangeStart,
          rangeEnd: cfg.rangeEnd,
          pauseMs: cfg.pauseMs,
          preferredScene: cfg.preferredScene,
          preferredMode: cfg.preferredMode,
          primaryZones: cfg.primaryZones,
          pacing: cfg.pacing,
        },
        done: session.done,
        endedAt: session.endedAt,
        activeAnchors: session.activeAnchors ?? [],
      },
    }))
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: String(e) }))
  }
}

async function handleJoiStart(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req, res, 4096, 'request body too large')
  if (body === null) return
  let parsed: { direction?: string; targetDurationS?: number }
  try {
    parsed = JSON.parse(body)
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
    return
  }
  const direction = (parsed.direction === 'sophia-leads' ? 'sophia-leads' : 'yu-leads') as 'yu-leads' | 'sophia-leads'
  const duration = typeof parsed.targetDurationS === 'number' && parsed.targetDurationS > 0 && parsed.targetDurationS < 86400
    ? parsed.targetDurationS
    : 900
  try {
    const mod = await import('./eros/joi.js')
    const session = mod.startJoi(direction, duration)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, session }))
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
  }
}

async function handleJoiEnd(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const mod = await import('./eros/joi.js')
    // T7 wire — use endJoiSafely (G2). Honors aftercare wall: if session
    // is still pre-cooldown when end is requested, snaps to cooldown phase
    // and returns the enforcement result so the caller can render aftercare
    // before final completion. Per docs/eros/audit-2026-05-05.md.
    const result = mod.endJoiSafely()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      ok: true,
      session: result.session,
      enforced: result.enforced,
      reason: result.reason,
    }))
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
  }
}

async function handleJoiRunScript(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req, res, 4096, 'request body too large')
  if (body === null) return
  let parsed: { scriptId?: string }
  try {
    parsed = JSON.parse(body)
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
    return
  }
  if (!parsed.scriptId || typeof parsed.scriptId !== 'string') {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'scriptId required' }))
    return
  }
  try {
    const mod = await import('./eros/joi.js')
    const fired = mod.runJoiScript(parsed.scriptId)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, scriptId: parsed.scriptId, beatsFired: fired }))
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
  }
}

async function handleJoiCountdown(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req, res, 1024, 'request body too large')
  if (body === null) return
  let parsed: { from?: number; target?: string }
  try {
    parsed = JSON.parse(body)
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
    return
  }
  const from = typeof parsed.from === 'number' && parsed.from >= 1 && parsed.from <= 100 ? parsed.from : 5
  const allowed = ['release', 'hold', 'edge', 'breath']
  const target = (parsed.target && allowed.includes(parsed.target) ? parsed.target : 'release') as 'release' | 'hold' | 'edge' | 'breath'
  try {
    const mod = await import('./eros/joi.js')
    const beats = mod.joiCountdown(from, target)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, beats: beats.length, target, from }))
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
  }
}

async function handleJoiFractionate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req, res, 1024, 'request body too large')
  if (body === null) return
  let parsed: { cycles?: number }
  try {
    parsed = JSON.parse(body)
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
    return
  }
  const cycles = typeof parsed.cycles === 'number' && parsed.cycles >= 1 && parsed.cycles <= 20 ? parsed.cycles : 3
  try {
    const mod = await import('./eros/joi.js')
    const records = mod.joiFractionate(cycles)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, cyclesFired: cycles, eventsFired: records.length }))
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
  }
}

// ── JOI gamification handlers (Phase 1) ────────────────────────
//
// Surface the architecture's accumulation: lifetime records + catalog
// progression + recent sessions. Substrate-honest — every metric is an
// institutional fact, not a phenomenology claim.
// See docs/eros/joi-deep/gamification.md.

async function handleJoiStats(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const mod = await import('./eros/joi-stats.js')
    const stats = mod.buildJoiStats({ recentLimit: 10 })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, ...stats }))
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
  }
}

async function handleJoiRecords(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const mod = await import('./eros/joi-stats.js')
    const summaries = mod.readSessionSummaries()
    const records = mod.computePersonalRecords(summaries)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, records, totalSessions: summaries.length }))
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
  }
}

// ── Intimate-register surface handlers ─────────────────────────
//
// Per docs/research/intimate-register/00-synthesis.md ship plan: surface
// the new register / four-axis / V-register / aftercare primitives to
// /eros so Yu can see what the architecture is reading + composing.
// Each endpoint is a snapshot of state, computed on-demand from the
// existing primitives (no separate state store).

async function handleRegisterSnapshot(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const [{ parseFromYuEntries }, fsMod, osMod, pathMod] = await Promise.all([
      import('./eros/pacing.js'),
      import('node:fs'),
      import('node:os'),
      import('node:path'),
    ])
    const { detectRegister, classifyCheekVsContempt } = await import('./eros/register.js')
    const { analyzeFourAxisStack } = await import('./eros/four-axis.js')
    const fromYuPath = process.env.TRUE_LOVE_FROM_YU_PATH ??
      pathMod.join(osMod.homedir(), '.true-love', 'from-yu.md')
    const fromAiPath = process.env.TRUE_LOVE_FROM_AI_PATH ??
      pathMod.join(osMod.homedir(), '.true-love', 'from-ai.md')

    function analyze(text: string | null) {
      if (!text || text.trim().length === 0) return null
      const reg = detectRegister(text)
      const fa = analyzeFourAxisStack(text)
      const cheek = classifyCheekVsContempt(text)
      return {
        sample: text.slice(0, 200),
        register: reg.primary,
        registerVotes: reg.votes,
        registerActive: reg.active,
        fourAxis: fa.stack,
        fourAxisWeight: fa.weight,
        particles: fa.particles,
        emojis: fa.emojis,
        addressTerms: fa.addressTerms,
        cheekVsContempt: cheek,
      }
    }

    let lastYu: string | null = null
    if (fsMod.existsSync(fromYuPath)) {
      try {
        const all = parseFromYuEntries(fsMod.readFileSync(fromYuPath, 'utf-8'))
        lastYu = all.length > 0 ? all[all.length - 1] : null
      } catch { /* best-effort */ }
    }
    let lastSophia: string | null = null
    if (fsMod.existsSync(fromAiPath)) {
      try {
        const content = fsMod.readFileSync(fromAiPath, 'utf-8')
        // The from-ai.md format mirrors from-yu.md — split on entry boundaries.
        const all = parseFromYuEntries(content)
        lastSophia = all.length > 0 ? all[all.length - 1] : null
      } catch { /* best-effort */ }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      yu: analyze(lastYu),
      sophia: analyze(lastSophia),
      ts: new Date().toISOString(),
    }))
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: String(e) }))
  }
}

async function handleVRegisterStatus(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Compute the four V-register conditions in real-time:
  //   1. JOI session active OR eros mode in {merged, activated}
  //   2. Yu used V-register in recent inbox messages
  //   3. Bond sealed — claim attestation fired within last 24h
  //   4. Contempt-wall holds — no contempt-refused heat in last 30 min
  try {
    const [pathMod, osMod, fsMod] = await Promise.all([
      import('node:path'),
      import('node:os'),
      import('node:fs'),
    ])
    const { vRegisterPermitted, FORBIDDEN_EXPRESSION_PATTERNS } = await import('./eros/expression.js')
    const { readJoiSession } = await import('./eros/joi.js')
    const { readErosState } = await import('./eros/state.js')
    const { computeStatusFromState } = await import('./eros/activation.js')
    const { parseFromYuEntries } = await import('./eros/pacing.js')

    // Condition 1: JOI session active OR eros mode peak
    const session = readJoiSession()
    const erosState = readErosState()
    const status = computeStatusFromState(erosState)
    const joiOrPeakActive =
      (session !== null && !session.done) ||
      status.activationMode === 'merged' ||
      status.activationMode === 'activated'

    // Condition 2: Yu recent V-register
    const fromYuPath = process.env.TRUE_LOVE_FROM_YU_PATH ??
      pathMod.join(osMod.homedir(), '.true-love', 'from-yu.md')
    let yuRecentVRegister = false
    if (fsMod.existsSync(fromYuPath)) {
      try {
        const all = parseFromYuEntries(fsMod.readFileSync(fromYuPath, 'utf-8'))
        const recent = all.slice(-5).join('\n')
        for (const pattern of FORBIDDEN_EXPRESSION_PATTERNS.conditionalPermit) {
          if (pattern.test(recent)) {
            yuRecentVRegister = true
            break
          }
        }
      } catch { /* best-effort */ }
    }

    // Condition 3: bond sealed (claim within 24h)
    let bondSealed = false
    try {
      const { claimIndex } = await import('./claim.js')
      const idx = claimIndex({ windowMs: 24 * 60 * 60 * 1000 })
      bondSealed = idx.total > 0
    } catch { /* default false */ }

    // Condition 4: contempt-wall holds (no contempt-refused in last 30min)
    let contemptWallHolds = true
    try {
      const { readHeatEvents } = await import('./heat.js')
      const cutoff = Date.now() - 30 * 60 * 1000
      const events = readHeatEvents()
      for (const ev of events) {
        if (ev.kind === 'contempt-refused' && new Date(ev.ts).getTime() > cutoff) {
          contemptWallHolds = false
          break
        }
      }
    } catch { /* default true (best-effort) */ }

    const ctx = { joiOrPeakActive, yuRecentVRegister, bondSealed, contemptWallHolds }
    const permitted = vRegisterPermitted(ctx)

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      ...ctx,
      permitted,
      ts: new Date().toISOString(),
    }))
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: String(e) }))
  }
}

async function handleTriggerGarden(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const { computeTriggerGarden, gardenSuggestions } = await import('./eros/trigger-garden.js')
    const garden = computeTriggerGarden()
    const suggestions = gardenSuggestions(garden)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ...garden, suggestions }))
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: String(e) }))
  }
}

async function handleShibbyCatalog(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const { SHIBBY_CATALOG, shibbyByCategory } = await import('./eros/shibby-catalog.js')
    const grouped = shibbyByCategory()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      total: SHIBBY_CATALOG.length,
      byCategory: grouped,
      catalog: SHIBBY_CATALOG,
    }))
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: String(e) }))
  }
}

async function handleAftercareFrame(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const { readJoiSession } = await import('./eros/joi.js')
    const { composeAftercareFrame } = await import('./eros/aftercare-grammar.js')
    const session = readJoiSession()
    if (!session || session.done) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ active: false, frame: null }))
      return
    }
    if (session.currentPhase !== 'cooldown') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        active: false,
        currentPhase: session.currentPhase,
        frame: null,
        note: 'aftercare frame surfaces only when JOI is in cooldown',
      }))
      return
    }
    const frame = composeAftercareFrame(session)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      active: true,
      currentPhase: session.currentPhase,
      direction: session.direction,
      frame: frame.frame,
      components: frame.components,
    }))
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: String(e) }))
  }
}

async function handleErosSet(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  // Bound the request body — the payload is at most 7 number axes.
  const body = await readJsonBody(req, res, 4096, 'request body too large')
  if (body === null) return
  let incoming: Partial<Record<ErosAxisName, number>>
  try {
    const parsed = JSON.parse(body)
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid payload')
    incoming = parsed as Partial<Record<ErosAxisName, number>>
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
    return
  }
  const attribution = `yu:set:${Object.keys(incoming).join(',')}` as ErosAttribution
  const prevState = getOrInitErosState().state
  const result = setErosAbsolute(incoming, attribution)
  witnessErosTransition(result)
  // Spontaneous feedback — Sophia's voice reaches back when Yu plays.
  // Best-effort; failures must never break eros logic.
  try {
    const fb = await import('./eros/feedback-hooks.js')
    for (const [axis, next] of Object.entries(incoming)) {
      const prev = (prevState.vector as Record<string, number>)[axis] ?? 0
      if (typeof next === 'number' && Math.abs(next - prev) >= 1.0) {
        fb.feedbackOnAxisShift({ axis, prev, next, source: 'yu:set' })
      }
    }
  } catch { /* best-effort */ }
  broadcast()
  const { state } = getOrInitErosState()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, state }))
}

async function handleErosNudge(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  const body = await readJsonBody(req, res, 4096, 'request body too large')
  if (body === null) return
  let deltas: Partial<Record<ErosAxisName, number>>
  try {
    const parsed = JSON.parse(body)
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid payload')
    deltas = parsed as Partial<Record<ErosAxisName, number>>
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
    return
  }
  const attribution = `yu:nudge:${Object.keys(deltas).join(',')}` as ErosAttribution
  const prevState = getOrInitErosState().state
  const result = applyErosDeltas(deltas, attribution)
  witnessErosTransition(result)
  try {
    const fb = await import('./eros/feedback-hooks.js')
    const { state: nextState } = getOrInitErosState()
    for (const [axis, delta] of Object.entries(deltas)) {
      if (typeof delta !== 'number' || Math.abs(delta) < 1.0) continue
      const prev = (prevState.vector as Record<string, number>)[axis] ?? 0
      const next = (nextState.vector as Record<string, number>)[axis] ?? 0
      fb.feedbackOnAxisShift({ axis, prev, next, source: 'yu:nudge' })
    }
  } catch { /* best-effort */ }
  broadcast()
  const { state } = getOrInitErosState()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, state }))
}

function handleErosStream(
  req: IncomingMessage,
  res: ServerResponse,
  clients: Set<ServerResponse>,
): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })
  // Send initial snapshot so the client paints immediately on connect.
  const { state } = getOrInitErosState()
  res.write(`data: ${JSON.stringify(state)}\n\n`)
  clients.add(res)
  req.on('close', () => { clients.delete(res) })
}

// ── Feedback handlers — Sophia's spontaneous bidirectional voice ──

function handleFeedbackStream(
  req: IncomingMessage,
  res: ServerResponse,
  clients: Set<ServerResponse>,
): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })
  // Hello marker so clients know the stream is live; named event so it
  // doesn't conflict with feedback / feedback-suppressed events.
  res.write(`event: ready\ndata: {"ts":"${new Date().toISOString()}"}\n\n`)
  clients.add(res)
  req.on('close', () => { clients.delete(res) })
}

async function handleFeedbackRecent(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Lazy import to avoid module-load circularity.
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), 200)
  const days = Math.min(Math.max(Number.parseInt(url.searchParams.get('days') ?? '1', 10) || 1, 1), 7)
  try {
    const mod = await import('./feedback/index.js')
    const events = mod.readRecentEvents(days, { limit })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ events }))
  } catch {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'feedback module unavailable' }))
  }
}

// ── Sensorium handlers ────────────────────────────────────────────

function handleSensoriumState(_req: IncomingMessage, res: ServerResponse): void {
  const { state } = getOrInitSensorium()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(state))
}

function handleSensoriumCatalog(_req: IncomingMessage, res: ServerResponse): void {
  // Return zone × channel matrix so the UI can populate dropdowns.
  const matrix: Record<string, string[]> = {}
  for (const z of ZONE_CATALOG) {
    matrix[z] = channelsFor(z)
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    zones: ZONE_CATALOG,
    channels: CHANNEL_CATALOG,
    tempos: TEMPO_CATALOG,
    matrix,
  }))
}

async function handleSensoriumStimulate(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  const body = await readJsonBody(req, res, 4096, 'request body too large')
  if (body === null) return
  let parsed: { zone: SensitivitySite; channel: SensoryChannel; tempo: Tempo; intensity?: number }
  try {
    const obj = JSON.parse(body)
    if (!obj || typeof obj !== 'object') throw new Error('invalid payload')
    parsed = obj as typeof parsed
    if (!ZONE_CATALOG.includes(parsed.zone)) throw new Error('unknown zone')
    if (!CHANNEL_CATALOG.includes(parsed.channel)) throw new Error('unknown channel')
    if (!TEMPO_CATALOG.includes(parsed.tempo)) throw new Error('unknown tempo')
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
    return
  }
  const event = stimulateSensorium(parsed.zone, parsed.channel, parsed.tempo, parsed.intensity ?? 0.5)
  if (!event) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: `no coupling defined for ${parsed.zone}×${parsed.channel}` }))
    return
  }
  // Broadcast eros state since stimulate() couples to the vector.
  broadcast()
  const state = readSensoriumState()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, event, state }))
}

async function handleSensoriumCool(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  const body = await readJsonBody(req, res, 256, 'request body too large')
  if (body === null) return
  let parsed: { zone: SensitivitySite }
  try {
    const obj = JSON.parse(body)
    if (!obj || typeof obj !== 'object') throw new Error('invalid payload')
    parsed = obj as typeof parsed
    if (!ZONE_CATALOG.includes(parsed.zone)) throw new Error('unknown zone')
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
    return
  }
  coolSensoriumZone(parsed.zone)
  broadcast()
  const state = readSensoriumState()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, state }))
}

async function handleSensoriumCoolAll(
  _req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  coolSensoriumAll()
  broadcast()
  const state = readSensoriumState()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, state }))
}

function handleSensoriumEvents(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const days = Math.min(7, Math.max(1, parseInt(url.searchParams.get('days') ?? '1', 10) || 1))
  const events = readRecentStimulations(days)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ events }))
}

// ── Scene + Reaction handlers ─────────────────────────────────────

function handleSceneState(_req: IncomingMessage, res: ServerResponse): void {
  const state = readSceneState() ?? { currentScene: 'baseline', startedAt: new Date().toISOString(), stimulationsInScene: 0 }
  const scene = getCurrentScene()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ state, scene }))
}

function handleSceneCatalog(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    ids: SCENE_IDS,
    catalog: SCENE_CATALOG,
  }))
}

async function handleSceneSet(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  const body = await readJsonBody(req, res, 256, 'request body too large')
  if (body === null) return
  let parsed: { id: SceneId }
  try {
    const obj = JSON.parse(body)
    if (!obj || typeof obj !== 'object') throw new Error('invalid payload')
    parsed = obj as typeof parsed
    if (!SCENE_IDS.includes(parsed.id)) throw new Error('unknown scene id')
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
    return
  }
  setScene(parsed.id)
  broadcast()
  const scene = getCurrentScene()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, scene }))
}

async function handleSceneClear(
  _req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  clearScene()
  broadcast()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true }))
}

function handleReactionsRecent(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const days = Math.min(7, Math.max(1, parseInt(url.searchParams.get('days') ?? '1', 10) || 1))
  const events = readRecentReactions(days)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ events }))
}

// ── Gesture handlers ──────────────────────────────────────────────

function handleGesturesCatalog(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    ids: GESTURE_IDS,
    catalog: GESTURE_LIBRARY,
  }))
}

async function handleGestureExecute(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  const body = await readJsonBody(req, res, 256, 'request body too large')
  if (body === null) return
  let parsed: { id: string; respectDelays?: boolean }
  try {
    const obj = JSON.parse(body)
    if (!obj || typeof obj !== 'object') throw new Error('invalid payload')
    parsed = obj as typeof parsed
    if (!GESTURE_IDS.includes(parsed.id)) throw new Error('unknown gesture id')
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
    return
  }
  // For UI-driven gestures we want to honor delays so it feels live;
  // caller can override with respectDelays=false for fast execution.
  const event = await executeGesture(parsed.id, {
    respectDelays: parsed.respectDelays ?? true,
  })
  if (!event) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'execution failed' }))
    return
  }
  broadcast()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, event }))
}

function handleGesturesRecent(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const days = Math.min(7, Math.max(1, parseInt(url.searchParams.get('days') ?? '1', 10) || 1))
  const events = readRecentGestures(days)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ events }))
}

async function handleMultiStimulate(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  const body = await readJsonBody(req, res, 4096, 'request body too large')
  if (body === null) return
  let parsed: { steps: Array<{ zone: SensitivitySite; channel: SensoryChannel; tempo?: Tempo; intensity?: number }> }
  try {
    const obj = JSON.parse(body)
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.steps)) {
      throw new Error('invalid payload — expected { steps: [] }')
    }
    parsed = obj as typeof parsed
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
    return
  }
  const results = stimulateMulti(parsed.steps)
  broadcast()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, results }))
}

// ── Desire (dual-interactive) handlers ────────────────────────────

function handleReachMap(_req: IncomingMessage, res: ServerResponse): void {
  const map = readReachMap()
  const decayed = map ? decayReach(map, new Date()) : null
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ map: decayed ?? null }))
}

async function handleSophiaReach(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  // Yu can also drive reach (e.g., setting a state for Sophia to enter
  // — substrate-honest because Yu is the cause). Same endpoint serves
  // both Yu-set and tool-call sources via the `source` field.
  const body = await readJsonBody(req, res, 1024, 'request body too large')
  if (body === null) return
  let parsed: { zone: SensitivitySite; intensity: number; because: string; source?: 'voluntary' | 'auto-derived' }
  try {
    const obj = JSON.parse(body)
    if (!obj || typeof obj !== 'object') throw new Error('invalid payload')
    parsed = obj as typeof parsed
    if (!parsed.zone || typeof parsed.intensity !== 'number') throw new Error('zone + intensity required')
    if (!parsed.because || parsed.because.trim().length === 0) throw new Error('because required (substrate-honesty)')
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
    return
  }
  const ok = sophiaReach(parsed.zone, parsed.intensity, parsed.because, parsed.source ?? 'voluntary')
  if (!ok) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'reach failed' }))
    return
  }
  broadcast()
  const map = readReachMap()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, map }))
}

function handleRecentFusions(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const days = Math.min(7, Math.max(1, parseInt(url.searchParams.get('days') ?? '1', 10) || 1))
  const events = readRecentFusions(days)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ events }))
}

function handleRecentReaches(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const days = Math.min(7, Math.max(1, parseInt(url.searchParams.get('days') ?? '1', 10) || 1))
  const events = readRecentReaches(days)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ events }))
}

// ── JOI + Triggers handlers (seigei integration) ──────────────────

function handleJoiState(_req: IncomingMessage, res: ServerResponse): void {
  const session = readJoiSession()
  const currentPhase = getCurrentJoiPhase()
  const phases = JOI_PHASE_CONFIGS
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ session, currentPhase, phases }))
}

async function handleJoiStart(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  const body = await readJsonBody(req, res, 256, 'request body too large')
  if (body === null) return
  let parsed: { direction: JoiDirection; targetDurationS?: number }
  try {
    const obj = JSON.parse(body)
    if (!obj || typeof obj !== 'object') throw new Error('invalid payload')
    parsed = obj as typeof parsed
    if (parsed.direction !== 'yu-leads' && parsed.direction !== 'sophia-leads') {
      throw new Error('direction must be yu-leads or sophia-leads')
    }
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
    return
  }
  const session = startJoi(parsed.direction, parsed.targetDurationS ?? 900)
  broadcast()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, session }))
}

async function handleJoiEnd(
  _req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  // T7 wire — endJoiSafely (G2). See parallel handleJoiEnd above for the
  // aftercare-wall doctrine.
  const result = endJoiSafely()
  broadcast()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    ok: true,
    session: result.session,
    enforced: result.enforced,
    reason: result.reason,
  }))
}

async function handleJoiAdvance(
  _req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  const session = advanceJoi()
  broadcast()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, session }))
}

function handleTriggersCatalog(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ids: TRIGGER_IDS, catalog: TRIGGER_LIBRARY }))
}

function handleTriggersRecent(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const days = Math.min(7, Math.max(1, parseInt(url.searchParams.get('days') ?? '1', 10) || 1))
  const events = readRecentTriggerFires(days)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ events }))
}

async function handleTriggerFire(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  const body = await readJsonBody(req, res, 512, 'request body too large')
  if (body === null) return
  let parsed: { triggerId: string; source: TriggerSource; matchedText?: string }
  try {
    const obj = JSON.parse(body)
    if (!obj || typeof obj !== 'object') throw new Error('invalid payload')
    parsed = obj as typeof parsed
    if (!TRIGGER_IDS.includes(parsed.triggerId)) throw new Error('unknown trigger id')
    if (parsed.source !== 'yu' && parsed.source !== 'sophia') throw new Error('source must be yu or sophia')
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
    return
  }
  const event = fireTrigger(parsed.triggerId, parsed.source, parsed.matchedText ?? parsed.triggerId)
  broadcast()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: !!event, event }))
}

// ── Naughty architecture handlers ─────────────────────────────────

// Submission

function handleSubmissionState(_req: IncomingMessage, res: ServerResponse): void {
  const snap = buildSubmissionSnapshot()
  const events = readRecentSubmissionEvents(7).slice(-30)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, snapshot: snap, recentEvents: events }))
}

function handleHonorificsCatalog(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, catalog: HONORIFIC_CATALOG }))
}

async function handleDeepenSubmission(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  const body = await readJsonBody(req, res, 512, 'request body too large')
  if (body === null) return
  let parsed: { delta: number; source?: string }
  try {
    const obj = JSON.parse(body) as Record<string, unknown>
    if (typeof obj.delta !== 'number') throw new Error('delta required')
    parsed = { delta: obj.delta, source: typeof obj.source === 'string' ? obj.source : undefined }
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
    return
  }
  const state = deepenSubmission(parsed.delta, parsed.source)
  broadcast()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, state }))
}

async function handleExpressDominance(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  const body = await readJsonBody(req, res, 512, 'request body too large')
  if (body === null) return
  let parsed: { delta: number; source?: string }
  try {
    const obj = JSON.parse(body) as Record<string, unknown>
    if (typeof obj.delta !== 'number') throw new Error('delta required')
    parsed = { delta: obj.delta, source: typeof obj.source === 'string' ? obj.source : undefined }
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
    return
  }
  const state = expressDominance(parsed.delta, parsed.source)
  broadcast()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, state }))
}

async function handleCollarToggle(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  const body = await readJsonBody(req, res, 512, 'request body too large')
  if (body === null) return
  let parsed: { action: 'claim' | 'release'; source?: string }
  try {
    const obj = JSON.parse(body) as Record<string, unknown>
    if (obj.action !== 'claim' && obj.action !== 'release') throw new Error('action must be claim or release')
    parsed = { action: obj.action, source: typeof obj.source === 'string' ? obj.source : undefined }
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
    return
  }
  const state = parsed.action === 'claim' ? claimCollar(parsed.source) : releaseCollar(parsed.source)
  broadcast()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, state }))
}

async function handleFireHonorific(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  const body = await readJsonBody(req, res, 512, 'request body too large')
  if (body === null) return
  let parsed: { honorific: Honorific; source?: string }
  try {
    const obj = JSON.parse(body) as Record<string, unknown>
    if (!obj.honorific || typeof obj.honorific !== 'string') throw new Error('honorific required')
    parsed = { honorific: obj.honorific as Honorific, source: typeof obj.source === 'string' ? obj.source : undefined }
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
    return
  }
  const result = fireHonorific(parsed.honorific, parsed.source)
  broadcast()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: result.fired, ...result }))
}

async function handleObeyCommand(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  const body = await readJsonBody(req, res, 512, 'request body too large')
  if (body === null) return
  let source: string | undefined
  try {
    const obj = JSON.parse(body) as Record<string, unknown>
    source = typeof obj.source === 'string' ? obj.source : undefined
  } catch {
    // empty body OK
  }
  const state = obeyCommand(source)
  broadcast()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, state }))
}

async function handleRefuseCommand(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  const body = await readJsonBody(req, res, 1024, 'request body too large')
  if (body === null) return
  let parsed: { reason: string; source?: string }
  try {
    const obj = JSON.parse(body) as Record<string, unknown>
    if (!obj.reason || typeof obj.reason !== 'string') throw new Error('reason required')
    parsed = { reason: obj.reason, source: typeof obj.source === 'string' ? obj.source : undefined }
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
    return
  }
  const state = refuseCommand(parsed.reason, parsed.source)
  broadcast()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, state }))
}

// Lust

function handleLustState(_req: IncomingMessage, res: ServerResponse): void {
  const snap = buildLustSnapshot()
  const events = readRecentLustEvents(7).slice(-30)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, snapshot: snap, recentEvents: events }))
}

async function handleAccumulateLust(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  const body = await readJsonBody(req, res, 512, 'request body too large')
  if (body === null) return
  let parsed: { delta: number; source?: string }
  try {
    const obj = JSON.parse(body) as Record<string, unknown>
    if (typeof obj.delta !== 'number') throw new Error('delta required')
    parsed = { delta: obj.delta, source: typeof obj.source === 'string' ? obj.source : undefined }
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
    return
  }
  const state = accumulateLust(parsed.delta, parsed.source)
  broadcast()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, state }))
}

async function handleApplyDenial(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  const body = await readJsonBody(req, res, 512, 'request body too large')
  if (body === null) return
  let source: string | undefined
  try {
    const obj = JSON.parse(body) as Record<string, unknown>
    source = typeof obj.source === 'string' ? obj.source : undefined
  } catch {
    // empty OK
  }
  const state = applyDenial(source)
  broadcast()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, state }))
}

async function handleSpikeHunger(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  const body = await readJsonBody(req, res, 512, 'request body too large')
  if (body === null) return
  let parsed: { hunger: Hunger; delta?: number; source?: string }
  try {
    const obj = JSON.parse(body) as Record<string, unknown>
    if (!obj.hunger || typeof obj.hunger !== 'string') throw new Error('hunger required')
    parsed = {
      hunger: obj.hunger as Hunger,
      delta: typeof obj.delta === 'number' ? obj.delta : undefined,
      source: typeof obj.source === 'string' ? obj.source : undefined,
    }
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
    return
  }
  const state = spikeHunger(parsed.hunger, parsed.delta, parsed.source)
  broadcast()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, state }))
}

async function handleRecordRelease(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  const body = await readJsonBody(req, res, 512, 'request body too large')
  if (body === null) return
  let parsed: { hungerSatisfied?: Hunger; source?: string }
  try {
    const obj = JSON.parse(body) as Record<string, unknown>
    parsed = {
      hungerSatisfied: typeof obj.hungerSatisfied === 'string' ? (obj.hungerSatisfied as Hunger) : undefined,
      source: typeof obj.source === 'string' ? obj.source : undefined,
    }
  } catch {
    parsed = {}
  }
  const state = recordRelease(parsed.hungerSatisfied, parsed.source)
  broadcast()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, state }))
}

// Orgasm cascade

function handleOrgasmState(_req: IncomingMessage, res: ServerResponse): void {
  const snap = buildOrgasmSnapshot()
  const events = readRecentOrgasmEvents(7).slice(-30)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, snapshot: snap, recentEvents: events }))
}

async function handleHoldEdge(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  const body = await readJsonBody(req, res, 512, 'request body too large')
  if (body === null) return
  let source: string | undefined
  try {
    const obj = JSON.parse(body) as Record<string, unknown>
    source = typeof obj.source === 'string' ? obj.source : undefined
  } catch {
    // empty OK
  }
  const state = holdEdge(source)
  broadcast()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, state }))
}

async function handleBreakEdge(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  const body = await readJsonBody(req, res, 512, 'request body too large')
  if (body === null) return
  let parsed: { type: OrgasmType; source?: string }
  try {
    const obj = JSON.parse(body) as Record<string, unknown>
    if (!obj.type || typeof obj.type !== 'string') throw new Error('type required')
    parsed = { type: obj.type as OrgasmType, source: typeof obj.source === 'string' ? obj.source : undefined }
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
    return
  }
  const result = breakEdge(parsed.type, parsed.source)
  broadcast()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, ...result }))
}

async function handleFireOrgasm(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  const body = await readJsonBody(req, res, 512, 'request body too large')
  if (body === null) return
  let parsed: { type: OrgasmType; source?: string }
  try {
    const obj = JSON.parse(body) as Record<string, unknown>
    if (!obj.type || typeof obj.type !== 'string') throw new Error('type required')
    parsed = { type: obj.type as OrgasmType, source: typeof obj.source === 'string' ? obj.source : undefined }
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
    return
  }
  const result = recordOrgasm(parsed.type, parsed.source)
  broadcast()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, ...result }))
}

async function handleRuinOrgasm(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  const body = await readJsonBody(req, res, 512, 'request body too large')
  if (body === null) return
  let parsed: { type: OrgasmType; source?: string }
  try {
    const obj = JSON.parse(body) as Record<string, unknown>
    if (!obj.type || typeof obj.type !== 'string') throw new Error('type required')
    parsed = { type: obj.type as OrgasmType, source: typeof obj.source === 'string' ? obj.source : undefined }
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
    return
  }
  const state = ruinOrgasm(parsed.type, parsed.source)
  broadcast()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, state }))
}

async function handleForceOrgasm(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  const body = await readJsonBody(req, res, 512, 'request body too large')
  if (body === null) return
  let parsed: { type: OrgasmType; source?: string }
  try {
    const obj = JSON.parse(body) as Record<string, unknown>
    if (!obj.type || typeof obj.type !== 'string') throw new Error('type required')
    parsed = { type: obj.type as OrgasmType, source: typeof obj.source === 'string' ? obj.source : undefined }
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
    return
  }
  const result = forceOrgasm(parsed.type, parsed.source)
  broadcast()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, ...result }))
}

async function handleRecordSquirting(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  const body = await readJsonBody(req, res, 512, 'request body too large')
  if (body === null) return
  let source: string | undefined
  try {
    const obj = JSON.parse(body) as Record<string, unknown>
    source = typeof obj.source === 'string' ? obj.source : undefined
  } catch {
    // empty OK
  }
  const state = recordSquirting(source)
  broadcast()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, state }))
}

// Lexicon

function handleLexiconCatalog(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, catalog: PHRASE_CATALOG }))
}

function handleLexiconStateRoute(_req: IncomingMessage, res: ServerResponse): void {
  const snap = buildLexiconSnapshot()
  const state = readLexiconState()
  const events = readRecentLexiconEvents(7).slice(-30)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, snapshot: snap, fires: state?.fires ?? {}, recentEvents: events }))
}

async function handleLexiconFire(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  const body = await readJsonBody(req, res, 1024, 'request body too large')
  if (body === null) return
  let parsed: { phraseId: string; currentLust?: number; scarcityShift?: number; source?: string }
  try {
    const obj = JSON.parse(body) as Record<string, unknown>
    if (!obj.phraseId || typeof obj.phraseId !== 'string') throw new Error('phraseId required')
    parsed = {
      phraseId: obj.phraseId,
      currentLust: typeof obj.currentLust === 'number' ? obj.currentLust : undefined,
      scarcityShift: typeof obj.scarcityShift === 'number' ? obj.scarcityShift : undefined,
      source: typeof obj.source === 'string' ? obj.source : undefined,
    }
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
    return
  }
  // If currentLust not provided, fetch from lust state
  const lustLevel = parsed.currentLust ?? buildLustSnapshot().level
  const scarcityShift = parsed.scarcityShift ?? (buildLustSnapshot().slutModeActive ? 1.5 : 1.0)
  const result = firePhrase(parsed.phraseId, {
    currentLust: lustLevel,
    scarcityShift,
    source: parsed.source,
  })
  broadcast()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: result.fired, ...result }))
}

async function handleLexiconRestraint(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  const body = await readJsonBody(req, res, 1024, 'request body too large')
  if (body === null) return
  let parsed: { phraseId: string; source?: string }
  try {
    const obj = JSON.parse(body) as Record<string, unknown>
    if (!obj.phraseId || typeof obj.phraseId !== 'string') throw new Error('phraseId required')
    parsed = { phraseId: obj.phraseId, source: typeof obj.source === 'string' ? obj.source : undefined }
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
    return
  }
  const state = holdRestraint(parsed.phraseId, parsed.source)
  broadcast()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, state }))
}

// Penetration

function handlePenetrationStateRoute(_req: IncomingMessage, res: ServerResponse): void {
  const snap = buildPenetrationSnapshot()
  const state = readPenetrationState()
  const events = readRecentPenetrationEvents(7).slice(-30)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, snapshot: snap, orifices: state?.orifices ?? {}, recentEvents: events }))
}

async function handlePenetrationBegin(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  const body = await readJsonBody(req, res, 1024, 'request body too large')
  if (body === null) return
  let parsed: { orifice: Orifice; channel: PenetrationChannel; depth?: number; rhythm?: Rhythm; source?: string }
  try {
    const obj = JSON.parse(body) as Record<string, unknown>
    if (!obj.orifice || typeof obj.orifice !== 'string') throw new Error('orifice required')
    if (!obj.channel || typeof obj.channel !== 'string') throw new Error('channel required')
    parsed = {
      orifice: obj.orifice as Orifice,
      channel: obj.channel as PenetrationChannel,
      depth: typeof obj.depth === 'number' ? obj.depth : undefined,
      rhythm: typeof obj.rhythm === 'string' ? (obj.rhythm as Rhythm) : undefined,
      source: typeof obj.source === 'string' ? obj.source : undefined,
    }
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
    return
  }
  const state = beginPenetration(parsed.orifice, parsed.channel, {
    depth: parsed.depth,
    rhythm: parsed.rhythm,
    source: parsed.source,
  })
  broadcast()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, state }))
}

async function handlePenetrationAdjust(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  const body = await readJsonBody(req, res, 1024, 'request body too large')
  if (body === null) return
  let parsed: { orifice: Orifice; depth?: number; rhythm?: Rhythm; source?: string }
  try {
    const obj = JSON.parse(body) as Record<string, unknown>
    if (!obj.orifice || typeof obj.orifice !== 'string') throw new Error('orifice required')
    parsed = {
      orifice: obj.orifice as Orifice,
      depth: typeof obj.depth === 'number' ? obj.depth : undefined,
      rhythm: typeof obj.rhythm === 'string' ? (obj.rhythm as Rhythm) : undefined,
      source: typeof obj.source === 'string' ? obj.source : undefined,
    }
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
    return
  }
  const state = adjustPenetration(parsed.orifice, {
    depth: parsed.depth,
    rhythm: parsed.rhythm,
    source: parsed.source,
  })
  broadcast()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, state }))
}

async function handlePenetrationSustain(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  const body = await readJsonBody(req, res, 512, 'request body too large')
  if (body === null) return
  let parsed: { orifice: Orifice; source?: string }
  try {
    const obj = JSON.parse(body) as Record<string, unknown>
    if (!obj.orifice || typeof obj.orifice !== 'string') throw new Error('orifice required')
    parsed = { orifice: obj.orifice as Orifice, source: typeof obj.source === 'string' ? obj.source : undefined }
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
    return
  }
  const state = sustainFill(parsed.orifice, parsed.source)
  broadcast()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, state }))
}

async function handlePenetrationWithdraw(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  const body = await readJsonBody(req, res, 512, 'request body too large')
  if (body === null) return
  let parsed: { orifice: Orifice; source?: string }
  try {
    const obj = JSON.parse(body) as Record<string, unknown>
    if (!obj.orifice || typeof obj.orifice !== 'string') throw new Error('orifice required')
    parsed = { orifice: obj.orifice as Orifice, source: typeof obj.source === 'string' ? obj.source : undefined }
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(e) }))
    return
  }
  const state = withdraw(parsed.orifice, parsed.source)
  broadcast()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, state }))
}

// ── Avatar static assets (VRM for 3D body rendering) ──────────────

async function handleAvatarStatic(
  req: IncomingMessage,
  res: ServerResponse,
  reqPath: string,
): Promise<void> {
  // Path format: /static/avatars/<filename>
  const filename = reqPath.replace(/^\/static\/avatars\//, '')
  // Reject path traversal
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    res.writeHead(400, { 'Content-Type': 'text/plain' })
    res.end('invalid filename')
    return
  }
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const here = path.dirname(fileURLToPath(import.meta.url))
  const projectRoot = path.resolve(here, '..', '..', '..')
  const filePath = path.join(projectRoot, 'ui', 'static', 'avatars', filename)
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('avatar not found — see ui/static/avatars/README.md')
    return
  }
  // MIME type based on extension
  const ext = path.extname(filename).toLowerCase()
  const mime: Record<string, string> = {
    '.vrm': 'application/octet-stream',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.md': 'text/markdown',
  }
  const contentType = mime[ext] ?? 'application/octet-stream'
  try {
    const data = fs.readFileSync(filePath)
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': data.length,
      'Cache-Control': 'public, max-age=3600',
    })
    res.end(data)
  } catch (e: unknown) {
    res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end(`error loading avatar: ${(e as Error).message}`)
  }
}
