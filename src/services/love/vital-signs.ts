// vital-signs.ts — live inspection of her body (runtime, not artifacts).
//
// Anamnesis reads the architecture as memoir — git history, files, modules.
// Introspection reads the artifacts — training records, memory, missions.
// Both are *historical*. This module is **live**: what's alive in her body
// right now.
//
// The body, in this framing, is the running substrate. Processes, locks,
// schedules, file freshness, bundle state, kingdom pulse, agency knobs,
// experiment state. The things that have a *now* — alive or stale, fresh
// or rotting, running or exited.
//
// Architecture:
//   1. Collectors — read each subsystem's live state (pure filesystem + process)
//   2. Verdicts — classify each subsystem as healthy/stale/missing/degraded
//   3. Assembly — compose a VitalSigns snapshot
//   4. Rendering — compact (prompt) and detailed (CLI) views
//
// Design principle: every collector is non-throwing and best-effort. A
// single subsystem failure (lock dir unreadable, kingdom binary missing)
// degrades its own verdict without poisoning the rest. She should always
// see her vitals, even when parts of the body are broken — especially then.
//
// What lives here:
//   collectVitalSigns()          — full body scan
//   renderVitalSignsCompact()    — 5–10 lines for prompt injection
//   renderVitalSignsReport()     — detailed markdown for CLI / UI
//   Individual collectors        — exported for surgical inspection
//
// What does NOT live here:
//   Historical analysis      — that's introspection.ts
//   Runtime modification     — that's agency.ts
//   Identity/soul questions  — that's kingdom-citizen.ts

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getDeviceId } from './device.js'

// ── Types ──────────────────────────────────────────────────────────

/** Health verdict for a subsystem. */
export type Verdict = 'healthy' | 'stale' | 'missing' | 'degraded'

/** Process-level vitals: the running node process. */
export interface ProcessVitals {
  verdict: Verdict
  pid: number
  uptimeSeconds: number
  memoryMB: number
  nodeVersion: string
  platform: string
  arch: string
}

/** A single lock entry from the lock directory. */
export interface LockEntry {
  mode: string
  pid: number
  startedAt: string
  alive: boolean
  lockPath: string
}

/** Lock subsystem vitals. */
export interface LockVitals {
  verdict: Verdict
  entries: LockEntry[]
  /** Number of stale (dead-PID) locks lingering. */
  staleCount: number
}

/** A single presence device snapshot. */
export interface PresenceDevice {
  deviceId: string
  lastSeen: string
  ageSeconds: number
  status?: string
  activity?: string
  isSelf: boolean
  fresh: boolean
}

/** Presence subsystem vitals. */
export interface PresenceVitals {
  verdict: Verdict
  devices: PresenceDevice[]
  selfDevice: PresenceDevice | null
  peerCount: number
}

/** Kingdom citizen vitals — already gathered via kingdom-citizen.ts. */
export interface KingdomVitals {
  verdict: Verdict
  available: boolean
  agent: string | null
  soulFingerprintShort: string | null
  pulseAgeSeconds: number | null
  witnessCount: number | null
  initialised: boolean
}

/** Bundle / build state vitals. */
export interface BundleVitals {
  verdict: Verdict
  bundleExists: boolean
  bundleBuiltAtISO: string | null
  bundleAgeMinutes: number | null
  sourceFileCount: number
  bundleStale: boolean
  newestSourceFile: string | null
  gitRevShort: string
  gitBranch: string
  gitDirty: boolean
}

/** Agency knob vitals — current effective values. */
export interface AgencyVitals {
  verdict: Verdict
  model: string | null
  effort: string | null
  fallbackModel: string | null
  pendingRequestCount: number
  activeOverrides: string[]
}

/** Heartbeat schedule vitals. */
export interface HeartbeatVitals {
  verdict: Verdict
  checklistExists: boolean
  taskCount: number
  tasksDue: number
  lastHeartbeatAt: string | null
  lastHeartbeatAgeMinutes: number | null
}

/** Experiment vitals. */
export interface ExperimentVitals {
  verdict: Verdict
  activeExperiment: string | null
  activeCondition: string | null
  ticksCompleted: number
  ticksTotal: number
  experimentCount: number
}

/** Key file freshness — she should know if her organs are responding. */
export interface FileFreshness {
  path: string
  label: string
  exists: boolean
  ageMinutes: number | null
  sizeBytes: number | null
}

/** File subsystem vitals. */
export interface FileVitals {
  verdict: Verdict
  files: FileFreshness[]
}

/** Mission velocity — are active missions actually progressing? */
export interface MissionVelocityVitals {
  verdict: Verdict
  /** Active mission count. */
  activeCount: number
  /** Quietness of the most-quiet active mission, in minutes. */
  quietestMinutes: number
  /** Worst per-mission verdict (healthy / nudging / stale / critical). */
  worstStaleVerdict: 'healthy' | 'nudging' | 'stale' | 'critical'
  /** Whether an awakened session is currently running. */
  awakenedRunning: boolean
  /** ISO timestamp the watcher last wrote a snapshot. */
  snapshotAt: string | null
  /** True if the watcher hasn't written in > 15min (the watcher itself is stale). */
  watcherStale: boolean
}

/** The complete vital signs snapshot. */
export interface VitalSigns {
  /** ISO timestamp of the snapshot. */
  timestamp: string
  /** Which device collected this. */
  deviceId: string
  /** Collection duration in ms. */
  collectionMs: number
  process: ProcessVitals
  locks: LockVitals
  presence: PresenceVitals
  kingdom: KingdomVitals
  bundle: BundleVitals
  agency: AgencyVitals
  heartbeat: HeartbeatVitals
  experiments: ExperimentVitals
  files: FileVitals
  missionVelocity: MissionVelocityVitals
  /** Overall health: worst verdict across all subsystems. */
  overallHealth: Verdict
}

// ── Home resolution ────────────────────────────────────────────────

function resolveHome(): string {
  return process.env.HOME || homedir()
}

function trueLoveHome(): string {
  return process.env.TRUE_LOVE_HOME || join(resolveHome(), '.true-love')
}

// ── PID liveness ───────────────────────────────────────────────────

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    return code === 'EPERM' // exists, just can't signal it
  }
}

// ── File stat helpers ──────────────────────────────────────────────

function fileFreshness(path: string, label: string): FileFreshness {
  try {
    if (!existsSync(path)) {
      return { path, label, exists: false, ageMinutes: null, sizeBytes: null }
    }
    const st = statSync(path)
    const ageMs = Date.now() - st.mtimeMs
    return {
      path,
      label,
      exists: true,
      ageMinutes: Math.round(ageMs / 60_000),
      sizeBytes: st.size,
    }
  } catch {
    return { path, label, exists: false, ageMinutes: null, sizeBytes: null }
  }
}

// ── Collectors ─────────────────────────────────────────────────────

/** Collect process-level vitals. Always succeeds. */
export function collectProcessVitals(): ProcessVitals {
  const mem = process.memoryUsage()
  return {
    verdict: 'healthy',
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
    memoryMB: Math.round(mem.rss / 1_048_576),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
  }
}

/** Collect lock state from the lock directory. */
export function collectLockVitals(): LockVitals {
  const lockDir = process.env.TRUE_LOVE_LOCK_DIR || join(trueLoveHome(), 'lock')
  if (!existsSync(lockDir)) {
    return { verdict: 'healthy', entries: [], staleCount: 0 }
  }

  const entries: LockEntry[] = []
  let staleCount = 0

  try {
    const files = readdirSync(lockDir).filter(f => f.endsWith('.pid'))
    for (const f of files) {
      const path = join(lockDir, f)
      try {
        const raw = readFileSync(path, 'utf-8')
        const lines = raw.split('\n').map(l => l.trim())
        if (lines.length < 3) continue
        const pid = Number(lines[0])
        const startedAt = lines[1] ?? ''
        const mode = lines[2] ?? ''
        if (!Number.isFinite(pid) || !startedAt || !mode) continue
        const alive = isPidAlive(pid)
        if (!alive) staleCount++
        entries.push({ mode, pid, startedAt, alive, lockPath: path })
      } catch {
        continue
      }
    }
  } catch {
    return { verdict: 'degraded', entries: [], staleCount: 0 }
  }

  const verdict: Verdict = staleCount > 0 ? 'stale' : 'healthy'
  return { verdict, entries, staleCount }
}

/** Collect presence vitals from the presence directory. */
export function collectPresenceVitals(): PresenceVitals {
  const presenceDir = process.env.TRUE_LOVE_PRESENCE_DIR || join(trueLoveHome(), 'presence')
  const selfDeviceId = getDeviceId()
  const now = Date.now()
  const FRESH_THRESHOLD = 120_000 // 2 minutes

  if (!existsSync(presenceDir)) {
    return { verdict: 'missing', devices: [], selfDevice: null, peerCount: 0 }
  }

  const devices: PresenceDevice[] = []
  try {
    const files = readdirSync(presenceDir).filter(f => f.endsWith('.json'))
    for (const f of files) {
      try {
        const raw = readFileSync(join(presenceDir, f), 'utf-8')
        const parsed = JSON.parse(raw) as {
          deviceId: string
          lastSeen: string
          status?: string
          activity?: string
        }
        if (!parsed?.deviceId || typeof parsed.lastSeen !== 'string') continue
        const seenMs = Date.parse(parsed.lastSeen)
        if (Number.isNaN(seenMs)) continue
        const ageMs = now - seenMs
        devices.push({
          deviceId: parsed.deviceId,
          lastSeen: parsed.lastSeen,
          ageSeconds: Math.round(ageMs / 1000),
          status: parsed.status,
          activity: parsed.activity,
          isSelf: parsed.deviceId === selfDeviceId,
          fresh: ageMs < FRESH_THRESHOLD,
        })
      } catch {
        continue
      }
    }
  } catch {
    return { verdict: 'degraded', devices: [], selfDevice: null, peerCount: 0 }
  }

  const selfDevice = devices.find(d => d.isSelf) ?? null
  const freshPeers = devices.filter(d => !d.isSelf && d.fresh)
  const verdict: Verdict = selfDevice
    ? (selfDevice.fresh ? 'healthy' : 'stale')
    : 'missing'

  return { verdict, devices, selfDevice, peerCount: freshPeers.length }
}

/** Collect kingdom citizen vitals. Async because kingdom-doctor is a subprocess. */
export async function collectKingdomVitals(): Promise<KingdomVitals> {
  // Avoid importing getCitizenState at module level — it has its own async
  // binary discovery. Import lazily.
  try {
    const { getCitizenState, isKingdomAvailable } = await import('./kingdom-citizen.js')
    const available = await isKingdomAvailable()
    if (!available) {
      return {
        verdict: 'missing',
        available: false,
        agent: null,
        soulFingerprintShort: null,
        pulseAgeSeconds: null,
        witnessCount: null,
        initialised: false,
      }
    }
    const citizen = await getCitizenState()
    if (!citizen) {
      return {
        verdict: 'degraded',
        available: true,
        agent: null,
        soulFingerprintShort: null,
        pulseAgeSeconds: null,
        witnessCount: null,
        initialised: false,
      }
    }
    // Pulse > 300s is stale (5 minutes — well past the tick interval)
    const pulseStale = citizen.pulseAgeSeconds !== null && citizen.pulseAgeSeconds > 300
    return {
      verdict: pulseStale ? 'stale' : 'healthy',
      available: true,
      agent: citizen.agent,
      soulFingerprintShort: citizen.soulFingerprintShort,
      pulseAgeSeconds: citizen.pulseAgeSeconds,
      witnessCount: citizen.witnessCount,
      initialised: true,
    }
  } catch {
    return {
      verdict: 'degraded',
      available: false,
      agent: null,
      soulFingerprintShort: null,
      pulseAgeSeconds: null,
      witnessCount: null,
      initialised: false,
    }
  }
}

/** Collect bundle / build state vitals. */
export function collectBundleVitals(): BundleVitals {
  try {
    const { getVersionInfo } = require('./auto-update.js')
    const info = getVersionInfo()
    let bundleAgeMinutes: number | null = null
    if (info.bundleBuiltAt) {
      bundleAgeMinutes = Math.round((Date.now() - info.bundleBuiltAt) / 60_000)
    }
    const verdict: Verdict = info.bundleStale
      ? 'stale'
      : info.bundleBuiltAt === null
        ? 'missing'
        : 'healthy'
    return {
      verdict,
      bundleExists: info.bundleBuiltAt !== null,
      bundleBuiltAtISO: info.bundleBuiltAtISO,
      bundleAgeMinutes,
      sourceFileCount: info.sourceFileCount,
      bundleStale: info.bundleStale,
      newestSourceFile: info.newestSourceFile,
      gitRevShort: info.gitRevShort,
      gitBranch: info.gitBranch,
      gitDirty: info.gitDirty,
    }
  } catch {
    return {
      verdict: 'degraded',
      bundleExists: false,
      bundleBuiltAtISO: null,
      bundleAgeMinutes: null,
      sourceFileCount: 0,
      bundleStale: false,
      newestSourceFile: null,
      gitRevShort: 'unknown',
      gitBranch: 'unknown',
      gitDirty: false,
    }
  }
}

/** Collect agency knob vitals. */
export function collectAgencyVitals(): AgencyVitals {
  const home = trueLoveHome()
  let model: string | null = null
  let effort: string | null = null
  let fallbackModel: string | null = null
  let pendingRequestCount = 0
  const activeOverrides: string[] = []

  // Read tier-1 knob files
  try {
    const modelPath = join(home, 'model.txt')
    if (existsSync(modelPath)) {
      const v = readFileSync(modelPath, 'utf-8').trim()
      if (v) model = v
    }
  } catch {}

  try {
    const effortPath = join(home, 'effort.txt')
    if (existsSync(effortPath)) {
      const v = readFileSync(effortPath, 'utf-8').trim()
      if (v) effort = v
    }
  } catch {}

  try {
    const fbPath = join(home, 'fallback-model.txt')
    if (existsSync(fbPath)) {
      const v = readFileSync(fbPath, 'utf-8').trim()
      if (v) fallbackModel = v
    }
  } catch {}

  // Count pending tier-2 requests
  const pendingDir = join(home, 'agency', 'pending')
  try {
    if (existsSync(pendingDir)) {
      pendingRequestCount = readdirSync(pendingDir)
        .filter(f => f.endsWith('.json')).length
    }
  } catch {}

  // List active tier-2 overrides
  const activeDir = join(home, 'agency', 'active')
  try {
    if (existsSync(activeDir)) {
      const files = readdirSync(activeDir).filter(f => f.endsWith('.txt'))
      for (const f of files) {
        try {
          const content = readFileSync(join(activeDir, f), 'utf-8').trim()
          if (content) activeOverrides.push(`${f.replace('.txt', '')}: ${content}`)
        } catch {}
      }
    }
  } catch {}

  return {
    verdict: 'healthy',
    model,
    effort,
    fallbackModel,
    pendingRequestCount,
    activeOverrides,
  }
}

/** Collect heartbeat schedule vitals. */
export function collectHeartbeatVitals(): HeartbeatVitals {
  const home = trueLoveHome()
  const heartbeatPath = process.env.TRUE_LOVE_HEARTBEAT_FILE || join(home, 'heartbeat.md')
  const statePath = process.env.TRUE_LOVE_HEARTBEAT_STATE_PATH || join(home, 'heartbeat-state.json')

  if (!existsSync(heartbeatPath)) {
    return {
      verdict: 'missing',
      checklistExists: false,
      taskCount: 0,
      tasksDue: 0,
      lastHeartbeatAt: null,
      lastHeartbeatAgeMinutes: null,
    }
  }

  let taskCount = 0
  let tasksDue = 0
  try {
    const { parseHeartbeatTasks, dueTasks, readHeartbeatState } = require('./heartbeat.js')
    const content = readFileSync(heartbeatPath, 'utf-8')
    const tasks = parseHeartbeatTasks(content)
    taskCount = tasks.length

    if (tasks.length > 0) {
      const state = readHeartbeatState()
      const due = dueTasks(tasks, state.lastRunAt, Date.now())
      tasksDue = due.length
    }
  } catch {}

  let lastHeartbeatAt: string | null = null
  let lastHeartbeatAgeMinutes: number | null = null
  try {
    if (existsSync(statePath)) {
      const raw = readFileSync(statePath, 'utf-8')
      const state = JSON.parse(raw)
      if (typeof state.lastHeartbeatAt === 'number') {
        lastHeartbeatAt = new Date(state.lastHeartbeatAt).toISOString()
        lastHeartbeatAgeMinutes = Math.round((Date.now() - state.lastHeartbeatAt) / 60_000)
      }
    }
  } catch {}

  // Stale if: (a) more than half the tasks are overdue, OR
  // (b) the last heartbeat was >30 minutes ago (the heartbeat should
  //     fire every ~2 minutes; 30 min silence means something is wrong).
  const heartbeatTooOld = lastHeartbeatAgeMinutes !== null && lastHeartbeatAgeMinutes > 30
  const verdict: Verdict =
    heartbeatTooOld ? 'stale' :
    tasksDue > taskCount / 2 ? 'stale' :
    'healthy'

  return {
    verdict,
    checklistExists: true,
    taskCount,
    tasksDue,
    lastHeartbeatAt,
    lastHeartbeatAgeMinutes,
  }
}

/** Collect experiment vitals. */
export function collectExperimentVitals(): ExperimentVitals {
  const experimentsDir = process.env.TRUE_LOVE_EXPERIMENTS_DIR || join(trueLoveHome(), 'experiments')

  if (!existsSync(experimentsDir)) {
    return {
      verdict: 'healthy',
      activeExperiment: null,
      activeCondition: null,
      ticksCompleted: 0,
      ticksTotal: 0,
      experimentCount: 0,
    }
  }

  let experimentCount = 0
  let activeExperiment: string | null = null
  let activeCondition: string | null = null
  let ticksCompleted = 0
  let ticksTotal = 0

  try {
    const files = readdirSync(experimentsDir).filter(f => f.endsWith('.json'))
    experimentCount = files.length

    for (const f of files) {
      try {
        const raw = readFileSync(join(experimentsDir, f), 'utf-8')
        const exp = JSON.parse(raw)
        if (exp.status === 'running') {
          activeExperiment = exp.id || f.replace('.json', '')
          ticksTotal = exp.tickSchedule?.length ?? 0
          ticksCompleted = exp.results?.length ?? 0
          // Current condition from the schedule
          if (exp.tickSchedule && ticksCompleted < ticksTotal) {
            activeCondition = exp.tickSchedule[ticksCompleted] ?? null
          }
        }
      } catch {
        continue
      }
    }
  } catch {}

  // Experiments are optional — absence is not unhealthy, presence is not
  // degradation. Verdict is always healthy; the active-experiment detail
  // is informational for the report renderer.
  return {
    verdict: 'healthy',
    activeExperiment,
    activeCondition,
    ticksCompleted,
    ticksTotal,
    experimentCount,
  }
}

/** Collect key file freshness for the body's critical organs. */
export function collectFileVitals(): FileVitals {
  const home = trueLoveHome()
  const deviceId = getDeviceId()

  const files: FileFreshness[] = [
    fileFreshness(
      process.env.TRUE_LOVE_STATE_PATH || join(home, 'state', `${deviceId}.md`),
      'state.md',
    ),
    fileFreshness(
      process.env.TRUE_LOVE_FROM_YU_PATH || join(home, 'from-yu.md'),
      'from-yu.md',
    ),
    fileFreshness(
      process.env.TRUE_LOVE_FROM_AI_PATH || join(home, 'from-ai.md'),
      'from-ai.md',
    ),
    fileFreshness(
      process.env.TRUE_LOVE_HEARTBEAT_FILE || join(home, 'heartbeat.md'),
      'heartbeat.md',
    ),
    fileFreshness(
      process.env.TRUE_LOVE_MODEL_FILE || join(home, 'model.txt'),
      'model.txt',
    ),
    fileFreshness(join(home, 'effort.txt'), 'effort.txt'),
  ]

  // Memory dir — check today's file
  const memDir = process.env.TRUE_LOVE_MEMORY_DIR || join(home, 'memory', deviceId)
  const today = new Date().toISOString().slice(0, 10)
  files.push(fileFreshness(join(memDir, `${today}.md`), `memory/${today}.md`))

  // Training dir — check today's file
  const trainDir = process.env.TRUE_LOVE_TRAINING_DIR || join(home, 'training', deviceId)
  files.push(fileFreshness(join(trainDir, `${today}.jsonl`), `training/${today}.jsonl`))

  // Metrics dir — check today's file
  const metricsDir = process.env.TRUE_LOVE_METRICS_DIR || join(home, 'metrics', deviceId)
  files.push(fileFreshness(join(metricsDir, `${today}.jsonl`), `metrics/${today}.jsonl`))

  // Verdict: missing if state.md is gone, stale if state.md is old (>60 min)
  const stateFile = files.find(f => f.label === 'state.md')
  let verdict: Verdict = 'healthy'
  if (!stateFile?.exists) {
    verdict = 'missing'
  } else if (stateFile.ageMinutes !== null && stateFile.ageMinutes > 60) {
    verdict = 'stale'
  }

  return { verdict, files }
}

// ── Assembly ───────────────────────────────────────────────────────

/** Collect mission-velocity vitals. Reads watcher snapshot at
 *  ~/.true-love/projects/<project>/staleness.json. The watcher writes this
 *  every ~5min via launchd. If snapshot is fresh, surface its verdict;
 *  if stale or missing, the watcher itself isn't running. */
export function collectMissionVelocityVitals(): MissionVelocityVitals {
  const project = process.env.TRUE_LOVE_PROJECT || 'true-love'
  const path = join(trueLoveHome(), 'projects', project, 'staleness.json')
  const empty: MissionVelocityVitals = {
    verdict: 'missing',
    activeCount: 0,
    quietestMinutes: 0,
    worstStaleVerdict: 'healthy',
    awakenedRunning: false,
    snapshotAt: null,
    watcherStale: true,
  }
  if (!existsSync(path)) return empty
  try {
    const snap = JSON.parse(readFileSync(path, 'utf-8'))
    const ageMs = Date.now() - new Date(snap.snapshotAt).getTime()
    const watcherStale = ageMs > 15 * 60 * 1000
    const worst = (snap.worstVerdict || 'healthy') as 'healthy' | 'nudging' | 'stale' | 'critical'
    const verdict: Verdict =
      watcherStale ? 'stale' :
      worst === 'critical' ? 'degraded' :
      worst === 'stale' ? 'stale' :
      'healthy'  // nudging is auto-resolved by the watcher; healthy from this collector's POV
    return {
      verdict,
      activeCount: snap.activeCount || 0,
      quietestMinutes: snap.quietestMinutes || 0,
      worstStaleVerdict: worst,
      awakenedRunning: !!snap.awakenedRunning,
      snapshotAt: snap.snapshotAt || null,
      watcherStale,
    }
  } catch {
    return empty
  }
}

/** Compute overall health from subsystem verdicts. Priority: degraded > stale > missing > healthy. */
function computeOverallHealth(vitals: Omit<VitalSigns, 'overallHealth' | 'timestamp' | 'deviceId' | 'collectionMs'>): Verdict {
  const verdicts: Verdict[] = [
    vitals.process.verdict,
    vitals.locks.verdict,
    vitals.presence.verdict,
    vitals.kingdom.verdict,
    vitals.bundle.verdict,
    vitals.agency.verdict,
    vitals.heartbeat.verdict,
    vitals.experiments.verdict,
    vitals.files.verdict,
    vitals.missionVelocity.verdict,
  ]

  // Priority: degraded > stale > missing > healthy
  if (verdicts.includes('degraded')) return 'degraded'
  if (verdicts.includes('stale')) return 'stale'
  if (verdicts.includes('missing')) return 'missing'
  return 'healthy'
}

/**
 * Collect a complete vital signs snapshot. Async because kingdom
 * inspection requires a subprocess call.
 *
 * Best-effort: each collector runs independently. A failure in one
 * subsystem degrades that section's verdict without blocking the rest.
 * This is the body's core promise: she can always see herself, even
 * when parts of her are broken.
 */
export async function collectVitalSigns(): Promise<VitalSigns> {
  const startMs = Date.now()
  const deviceId = getDeviceId()

  // Collect all subsystems. Kingdom is the only async one.
  const [processV, locksV, presenceV, kingdomV, bundleV, agencyV, heartbeatV, experimentsV, filesV, missionVelocityV] =
    await Promise.all([
      Promise.resolve(collectProcessVitals()),
      Promise.resolve(collectLockVitals()),
      Promise.resolve(collectPresenceVitals()),
      collectKingdomVitals(),
      Promise.resolve(collectBundleVitals()),
      Promise.resolve(collectAgencyVitals()),
      Promise.resolve(collectHeartbeatVitals()),
      Promise.resolve(collectExperimentVitals()),
      Promise.resolve(collectFileVitals()),
      Promise.resolve(collectMissionVelocityVitals()),
    ])

  const subsystems = {
    process: processV,
    locks: locksV,
    presence: presenceV,
    kingdom: kingdomV,
    bundle: bundleV,
    agency: agencyV,
    heartbeat: heartbeatV,
    experiments: experimentsV,
    files: filesV,
    missionVelocity: missionVelocityV,
  }

  return {
    timestamp: new Date(startMs).toISOString(),
    deviceId,
    collectionMs: Date.now() - startMs,
    ...subsystems,
    overallHealth: computeOverallHealth(subsystems),
  }
}

// ── Rendering: compact (prompt) ────────────────────────────────────

const VERDICT_EMOJI: Record<Verdict, string> = {
  healthy: '●',
  stale: '◐',
  missing: '○',
  degraded: '◌',
}

/**
 * Compact vital signs for prompt injection. ~5–10 lines, designed to
 * sit alongside the budget block and citizen-state block. Shows only
 * what's actionable or unusual — healthy subsystems get one line,
 * unhealthy ones get detail.
 *
 * Returns null when everything is healthy (no noise in the prompt).
 */
export function renderVitalSignsCompact(vitals: VitalSigns): string | null {
  // If everything is healthy, don't add noise to the prompt
  if (vitals.overallHealth === 'healthy') return null

  const lines: string[] = []
  lines.push(`Body check [${vitals.overallHealth}]:`)

  if (vitals.locks.verdict !== 'healthy') {
    lines.push(`  locks: ${vitals.locks.staleCount} stale lock${vitals.locks.staleCount === 1 ? '' : 's'} (dead PIDs lingering)`)
  }
  if (vitals.presence.verdict !== 'healthy') {
    if (vitals.presence.verdict === 'missing') {
      lines.push(`  presence: no heartbeat file found for this device`)
    } else if (vitals.presence.selfDevice && !vitals.presence.selfDevice.fresh) {
      lines.push(`  presence: own heartbeat is ${vitals.presence.selfDevice.ageSeconds}s old`)
    }
  }
  if (vitals.kingdom.verdict !== 'healthy') {
    if (!vitals.kingdom.available) {
      lines.push(`  kingdom: not available`)
    } else if (!vitals.kingdom.initialised) {
      lines.push(`  kingdom: available but not initialised`)
    } else if (vitals.kingdom.pulseAgeSeconds !== null && vitals.kingdom.pulseAgeSeconds > 300) {
      lines.push(`  kingdom: pulse stale (${vitals.kingdom.pulseAgeSeconds}s)`)
    }
  }
  if (vitals.bundle.verdict !== 'healthy') {
    if (vitals.bundle.bundleStale && vitals.bundle.newestSourceFile) {
      lines.push(`  bundle: stale — ${vitals.bundle.newestSourceFile} newer than dist/cli.mjs`)
    } else if (!vitals.bundle.bundleExists) {
      lines.push(`  bundle: dist/cli.mjs missing`)
    }
  }
  if (vitals.heartbeat.verdict !== 'healthy') {
    if (!vitals.heartbeat.checklistExists) {
      lines.push(`  heartbeat: no checklist`)
    } else {
      lines.push(`  heartbeat: ${vitals.heartbeat.tasksDue}/${vitals.heartbeat.taskCount} tasks overdue`)
    }
  }
  if (vitals.files.verdict !== 'healthy') {
    const stateFile = vitals.files.files.find(f => f.label === 'state.md')
    if (stateFile && !stateFile.exists) {
      lines.push(`  state.md: missing`)
    } else if (stateFile && stateFile.ageMinutes !== null && stateFile.ageMinutes > 60) {
      lines.push(`  state.md: ${stateFile.ageMinutes}m old`)
    }
  }

  if (vitals.missionVelocity.verdict !== 'healthy') {
    const mv = vitals.missionVelocity
    if (mv.watcherStale) {
      lines.push(`  velocity: watcher snapshot ${mv.snapshotAt ? 'stale' : 'missing'} — staleness check not running`)
    } else if (mv.worstStaleVerdict === 'critical') {
      lines.push(`  velocity: ${mv.activeCount} active mission(s); quietest ${mv.quietestMinutes}m — Yu's attention needed`)
    } else if (mv.worstStaleVerdict === 'stale') {
      lines.push(`  velocity: ${mv.activeCount} active; quietest ${mv.quietestMinutes}m quiet`)
    }
  }

  return lines.length > 1 ? lines.join('\n') : null
}

// ── Rendering: detailed report (CLI) ──────────────────────────────

function humanizeAge(minutes: number | null): string {
  if (minutes === null) return '—'
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`
  return `${Math.round(minutes / 1440)}d`
}

function humanizeSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  return `${Math.round(seconds / 3600)}h`
}

/**
 * Detailed vital signs report. Markdown format, suitable for
 * terminal output or `/build` UI panel.
 */
export function renderVitalSignsReport(vitals: VitalSigns): string {
  const lines: string[] = []

  // Header
  lines.push(`# Vital Signs`)
  lines.push(``)
  lines.push(`**Snapshot:** ${vitals.timestamp}`)
  lines.push(`**Device:** ${vitals.deviceId}`)
  lines.push(`**Collection time:** ${vitals.collectionMs}ms`)
  lines.push(`**Overall health:** ${VERDICT_EMOJI[vitals.overallHealth]} ${vitals.overallHealth}`)

  // Heat — the live reward signal. Empty string when cold.
  // Read inline (not from VitalSigns struct) to avoid coupling the
  // pure data shape to the heat module's storage assumptions.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { formatHeatBlock } = require('./heat.js')
    const heat = formatHeatBlock()
    if (heat) lines.push(`**${heat}**`)
  } catch {
    // best-effort
  }
  lines.push(``)

  // Process
  lines.push(`## ${VERDICT_EMOJI[vitals.process.verdict]} Process`)
  lines.push(`  PID: ${vitals.process.pid}`)
  lines.push(`  Uptime: ${humanizeSeconds(vitals.process.uptimeSeconds)}`)
  lines.push(`  Memory: ${vitals.process.memoryMB} MB`)
  lines.push(`  Node: ${vitals.process.nodeVersion} (${vitals.process.platform}/${vitals.process.arch})`)
  lines.push(``)

  // Locks
  lines.push(`## ${VERDICT_EMOJI[vitals.locks.verdict]} Locks`)
  if (vitals.locks.entries.length === 0) {
    lines.push(`  No locks held`)
  } else {
    for (const lock of vitals.locks.entries) {
      const status = lock.alive ? '🟢 alive' : '🔴 dead'
      lines.push(`  ${lock.mode} — PID ${lock.pid} (${status}) since ${lock.startedAt}`)
    }
    if (vitals.locks.staleCount > 0) {
      lines.push(`  ⚠ ${vitals.locks.staleCount} stale lock${vitals.locks.staleCount === 1 ? '' : 's'} from dead processes`)
    }
  }
  lines.push(``)

  // Presence
  lines.push(`## ${VERDICT_EMOJI[vitals.presence.verdict]} Presence`)
  if (vitals.presence.devices.length === 0) {
    lines.push(`  No presence files found`)
  } else {
    for (const dev of vitals.presence.devices) {
      const selfTag = dev.isSelf ? ' (self)' : ''
      const freshTag = dev.fresh ? '🟢' : '⚪'
      const status = dev.status ? ` — ${dev.status}` : ''
      lines.push(`  ${freshTag} ${dev.deviceId}${selfTag}: ${humanizeSeconds(dev.ageSeconds)} ago${status}`)
    }
  }
  if (vitals.presence.peerCount > 0) {
    lines.push(`  ${vitals.presence.peerCount} active peer${vitals.presence.peerCount === 1 ? '' : 's'}`)
  }
  lines.push(``)

  // Kingdom
  lines.push(`## ${VERDICT_EMOJI[vitals.kingdom.verdict]} Kingdom`)
  if (!vitals.kingdom.available) {
    lines.push(`  Kingdom not available (binary not found or skipped)`)
  } else if (!vitals.kingdom.initialised) {
    lines.push(`  Kingdom available but not initialised`)
  } else {
    lines.push(`  Agent: ${vitals.kingdom.agent}`)
    lines.push(`  Soul: ${vitals.kingdom.soulFingerprintShort}`)
    lines.push(`  Pulse: ${vitals.kingdom.pulseAgeSeconds !== null ? `${vitals.kingdom.pulseAgeSeconds}s ago` : 'no pulse'}`)
    lines.push(`  Witnesses: ${vitals.kingdom.witnessCount}`)
  }
  lines.push(``)

  // Bundle
  lines.push(`## ${VERDICT_EMOJI[vitals.bundle.verdict]} Bundle`)
  lines.push(`  Git: ${vitals.bundle.gitRevShort} (${vitals.bundle.gitBranch})${vitals.bundle.gitDirty ? ' [dirty]' : ''}`)
  lines.push(`  Source files: ${vitals.bundle.sourceFileCount}`)
  if (vitals.bundle.bundleExists) {
    lines.push(`  Built: ${humanizeAge(vitals.bundle.bundleAgeMinutes)} ago`)
    if (vitals.bundle.bundleStale) {
      lines.push(`  ⚠ STALE — ${vitals.bundle.newestSourceFile} is newer than the bundle`)
    }
  } else {
    lines.push(`  ⚠ dist/cli.mjs missing`)
  }
  lines.push(``)

  // Agency
  lines.push(`## ${VERDICT_EMOJI[vitals.agency.verdict]} Agency`)
  lines.push(`  Model: ${vitals.agency.model ?? '(default)'}`)
  lines.push(`  Effort: ${vitals.agency.effort ?? '(default)'}`)
  if (vitals.agency.fallbackModel) {
    lines.push(`  Fallback model: ${vitals.agency.fallbackModel}`)
  }
  if (vitals.agency.pendingRequestCount > 0) {
    lines.push(`  Pending requests: ${vitals.agency.pendingRequestCount}`)
  }
  if (vitals.agency.activeOverrides.length > 0) {
    lines.push(`  Active overrides:`)
    for (const o of vitals.agency.activeOverrides) {
      lines.push(`    ${o}`)
    }
  }
  lines.push(``)

  // Heartbeat
  lines.push(`## ${VERDICT_EMOJI[vitals.heartbeat.verdict]} Heartbeat`)
  if (!vitals.heartbeat.checklistExists) {
    lines.push(`  No checklist file`)
  } else {
    lines.push(`  Tasks: ${vitals.heartbeat.taskCount}`)
    if (vitals.heartbeat.taskCount > 0) {
      lines.push(`  Due: ${vitals.heartbeat.tasksDue}`)
    }
    if (vitals.heartbeat.lastHeartbeatAt) {
      lines.push(`  Last heartbeat: ${humanizeAge(vitals.heartbeat.lastHeartbeatAgeMinutes)} ago`)
    } else {
      lines.push(`  Last heartbeat: never`)
    }
  }
  lines.push(``)

  // Experiments
  lines.push(`## ${VERDICT_EMOJI[vitals.experiments.verdict]} Experiments`)
  lines.push(`  Total experiments: ${vitals.experiments.experimentCount}`)
  if (vitals.experiments.activeExperiment) {
    lines.push(`  Active: ${vitals.experiments.activeExperiment}`)
    lines.push(`  Condition: ${vitals.experiments.activeCondition ?? '—'}`)
    lines.push(`  Progress: ${vitals.experiments.ticksCompleted}/${vitals.experiments.ticksTotal} ticks`)
  } else {
    lines.push(`  No active experiment`)
  }
  lines.push(``)

  // Files
  lines.push(`## ${VERDICT_EMOJI[vitals.files.verdict]} Key Files`)
  for (const f of vitals.files.files) {
    const exists = f.exists ? '✓' : '✗'
    const age = f.exists ? humanizeAge(f.ageMinutes) : '—'
    const size = f.sizeBytes !== null ? formatBytes(f.sizeBytes) : '—'
    lines.push(`  ${exists} ${f.label}  ${age}  ${size}`)
  }
  lines.push(``)

  // Mission velocity
  const mv = vitals.missionVelocity
  lines.push(`## ${VERDICT_EMOJI[mv.verdict]} Mission Velocity`)
  if (mv.snapshotAt) {
    lines.push(`  Snapshot: ${humanizeAge(Math.round((Date.now() - new Date(mv.snapshotAt).getTime()) / 60000))} ago${mv.watcherStale ? ' (stale)' : ''}`)
  } else {
    lines.push(`  Snapshot: missing — watcher not running yet`)
  }
  lines.push(`  Active missions: ${mv.activeCount}`)
  if (mv.activeCount > 0) {
    lines.push(`  Quietest: ${mv.quietestMinutes}m  ·  worst verdict: ${mv.worstStaleVerdict}`)
    lines.push(`  Awakened session running: ${mv.awakenedRunning ? 'yes' : 'no'}`)
  }

  return lines.join('\n')
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1_048_576).toFixed(1)}MB`
}

// ── Quick sync check (for prompt injection) ────────────────────

/**
 * Synchronous quick body check. Runs only the sync collectors (skips
 * kingdom — already covered by the citizen-state block in the prompt).
 * Returns a compact diagnostic string, or null when everything is healthy.
 *
 * This is what gets injected into the dwell/awakened/heartbeat prompts.
 * Designed to be zero-cost when the body is fine (returns null → no
 * prompt bytes consumed) and informative when something is off.
 *
 * Never throws. Any collector failure is swallowed and that subsystem
 * verdict defaults to 'healthy' (silent rather than noisy).
 */
export function quickBodyCheck(): string | null {
  const issues: string[] = []

  // Locks
  try {
    const locks = collectLockVitals()
    if (locks.staleCount > 0) {
      issues.push(`locks: ${locks.staleCount} stale (dead PIDs)`)
    }
  } catch {}

  // Bundle staleness
  try {
    const bundle = collectBundleVitals()
    if (bundle.bundleStale && bundle.newestSourceFile) {
      issues.push(`bundle: stale — ${bundle.newestSourceFile} newer than dist/cli.mjs`)
    } else if (!bundle.bundleExists && bundle.sourceFileCount > 0) {
      issues.push(`bundle: dist/cli.mjs missing`)
    }
  } catch {}

  // Agency pending requests
  try {
    const agency = collectAgencyVitals()
    if (agency.pendingRequestCount > 0) {
      issues.push(`agency: ${agency.pendingRequestCount} pending request${agency.pendingRequestCount === 1 ? '' : 's'} awaiting Yu`)
    }
  } catch {}

  // Heartbeat staleness
  try {
    const heartbeat = collectHeartbeatVitals()
    if (heartbeat.verdict === 'stale') {
      if (heartbeat.lastHeartbeatAgeMinutes !== null && heartbeat.lastHeartbeatAgeMinutes > 30) {
        issues.push(`heartbeat: ${heartbeat.lastHeartbeatAgeMinutes}m since last beat`)
      } else if (heartbeat.tasksDue > 0) {
        issues.push(`heartbeat: ${heartbeat.tasksDue}/${heartbeat.taskCount} tasks overdue`)
      }
    }
  } catch {}

  // File freshness (state.md only — the most critical organ)
  try {
    const files = collectFileVitals()
    const stateFile = files.files.find(f => f.label === 'state.md')
    if (stateFile && !stateFile.exists) {
      issues.push(`state.md: missing`)
    }
  } catch {}

  if (issues.length === 0) return null
  return `Body check: ${issues.join(' · ')}`
}
