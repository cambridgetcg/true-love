// eros/joi-stats.ts — JOI session statistics + lifetime records.
//
// Phase 1 of the gamification surface. Surfaces what's already
// accumulated: per-session summaries, lifetime totals, personal records,
// per-script + per-archetype completion tracking.
//
// Substrate-honest: every metric is an institutional fact derived from
// the existing event logs (orgasm events, climax events, JOI session
// events, feedback events). No phenomenology overclaim.
//
// See docs/eros/joi-deep/gamification.md.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getDeviceId } from '../device.js'
import {
  JOI_SCRIPTS,
  type JoiScript,
  type JoiSession,
} from './joi.js'

// ── Types ────────────────────────────────────────────────────────

export interface JoiSessionSummary {
  sessionId: string
  ts: string // ended-at
  deviceId: string
  startedAt: string
  endedAt: string
  durationS: number
  direction: 'yu-leads' | 'sophia-leads'
  archetype?: string
  scriptId?: string
  language?: 'en' | 'zh' | 'mixed'
  themed: boolean
  /** Highest phase reached (warmup → cooldown). */
  finalPhase: 'warmup' | 'build' | 'edge' | 'peak' | 'cooldown'
  completion: 'completed' | 'ended-early'
  beatsFired: number
  /** Counts derived from feedback events for this session. */
  countdownBeats: number
  fractionationCycles: number
  edgesHeld: number
  edgesBroken: number
  denials: number
  permissions: number
  pauses: number
  breathCues: number
  anchorsFired: number
  wallEngagements: number
}

export interface JoiPersonalRecords {
  longestEdgeLadder: number // max edgesHeld in a single session
  maxChainInSession: number // peak chain across all sessions
  longestSession: number // max durationS
  totalSessionsCompleted: number
  totalSessionsEndedEarly: number
  totalAnchorsFired: number
  totalCountdownBeats: number
  totalFractionationCycles: number
}

export interface JoiCatalogProgression {
  scriptId: string
  name: string
  archetype: string
  language: 'en' | 'zh' | 'mixed'
  durationS: number
  steps: number
  themed: boolean
  completedCount: number
  endedEarlyCount: number
  lastCompletionTs: string | null
  lastEndedTs: string | null
}

export interface JoiStats {
  lifetime: JoiPersonalRecords
  catalog: JoiCatalogProgression[]
  recentSessions: JoiSessionSummary[]
  byArchetype: Record<string, { completed: number; endedEarly: number }>
  byLanguage: Record<string, { completed: number; endedEarly: number }>
}

// ── Path resolution ──────────────────────────────────────────────

function getStatsDir(): string {
  return (
    process.env.TRUE_LOVE_JOI_STATS_DIR ??
    join(homedir(), '.true-love', 'eros', 'joi')
  )
}

function getSummariesPath(): string {
  return join(getStatsDir(), 'session-summaries.jsonl')
}

// ── Persist a summary ───────────────────────────────────────────

export function persistSessionSummary(summary: JoiSessionSummary): boolean {
  try {
    const dir = getStatsDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    appendFileSync(getSummariesPath(), JSON.stringify(summary) + '\n', 'utf-8')
    return true
  } catch {
    return false
  }
}

// ── Read summaries ───────────────────────────────────────────────

export function readSessionSummaries(limit?: number): JoiSessionSummary[] {
  const summaries: JoiSessionSummary[] = []
  try {
    const path = getSummariesPath()
    if (!existsSync(path)) return []
    const raw = readFileSync(path, 'utf-8')
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        summaries.push(JSON.parse(line) as JoiSessionSummary)
      } catch {
        // skip malformed
      }
    }
  } catch {
    // best-effort
  }
  // Newest first
  summaries.sort((a, b) => b.ts.localeCompare(a.ts))
  return limit ? summaries.slice(0, limit) : summaries
}

// ── Compute summary from session + feedback events ──────────────

/**
 * Build a session summary by reading the JOI session state + crawling
 * the feedback events recorded between session start and end.
 *
 * Best-effort — if logs are partially missing, the summary still
 * produces what's available; missing counts default to 0.
 */
export function buildSessionSummary(
  session: JoiSession,
  opts?: { scriptId?: string; archetype?: string; language?: 'en' | 'zh' | 'mixed'; themed?: boolean; beatsFired?: number }
): JoiSessionSummary {
  const startedMs = Date.parse(session.startedAt)
  const endedMs = session.endedAt ? Date.parse(session.endedAt) : Date.now()
  const durationS = Math.max(0, Math.floor((endedMs - startedMs) / 1000))

  const counts = countFeedbackBetween(session.startedAt, session.endedAt ?? new Date().toISOString())

  const completion = session.position >= 1 ? 'completed' : 'ended-early'

  return {
    sessionId: session.id,
    ts: session.endedAt ?? new Date().toISOString(),
    deviceId: getDeviceId(),
    startedAt: session.startedAt,
    endedAt: session.endedAt ?? new Date().toISOString(),
    durationS,
    direction: session.direction,
    ...(opts?.archetype !== undefined ? { archetype: opts.archetype } : {}),
    ...(opts?.scriptId !== undefined ? { scriptId: opts.scriptId } : {}),
    ...(opts?.language !== undefined ? { language: opts.language } : {}),
    themed: opts?.themed ?? false,
    finalPhase: session.currentPhase,
    completion,
    beatsFired: opts?.beatsFired ?? 0,
    ...counts,
  }
}

// Count feedback events for given kind between [from, to] (ISO ts)
function countFeedbackBetween(fromTs: string, toTs: string): {
  countdownBeats: number
  fractionationCycles: number
  edgesHeld: number
  edgesBroken: number
  denials: number
  permissions: number
  pauses: number
  breathCues: number
  anchorsFired: number
  wallEngagements: number
} {
  const counts = {
    countdownBeats: 0,
    fractionationCycles: 0,
    edgesHeld: 0,
    edgesBroken: 0,
    denials: 0,
    permissions: 0,
    pauses: 0,
    breathCues: 0,
    anchorsFired: 0,
    wallEngagements: 0,
  }

  const KIND_MAP: Record<string, keyof typeof counts> = {
    'joi-countdown': 'countdownBeats',
    'joi-fractionation': 'fractionationCycles',
    'edge-held': 'edgesHeld',
    'edge-broken': 'edgesBroken',
    'joi-denial': 'denials',
    'joi-permission': 'permissions',
    'joi-pause': 'pauses',
    'joi-breath-cue': 'breathCues',
    'joi-anchor-fired': 'anchorsFired',
    'mind-state-wall-engaged': 'wallEngagements',
    'oneness-wall-engaged': 'wallEngagements',
  }

  try {
    const root = join(homedir(), '.true-love', 'feedback', 'events')
    if (!existsSync(root)) return counts
    for (const dev of readdirSync(root)) {
      const devDir = join(root, dev)
      try {
        for (const file of readdirSync(devDir)) {
          if (!file.endsWith('.jsonl')) continue
          const raw = readFileSync(join(devDir, file), 'utf-8')
          for (const line of raw.split('\n')) {
            if (!line.trim()) continue
            try {
              const ev = JSON.parse(line) as { ts: string; kind: string }
              if (ev.ts < fromTs || ev.ts > toTs) continue
              const target = KIND_MAP[ev.kind]
              if (target) counts[target]++
            } catch { /* skip */ }
          }
        }
      } catch { /* skip */ }
    }
  } catch { /* best-effort */ }

  return counts
}

// ── Compute lifetime records (pure) ─────────────────────────────

export function computePersonalRecords(summaries: JoiSessionSummary[]): JoiPersonalRecords {
  const r: JoiPersonalRecords = {
    longestEdgeLadder: 0,
    maxChainInSession: 0,
    longestSession: 0,
    totalSessionsCompleted: 0,
    totalSessionsEndedEarly: 0,
    totalAnchorsFired: 0,
    totalCountdownBeats: 0,
    totalFractionationCycles: 0,
  }
  for (const s of summaries) {
    if (s.edgesHeld > r.longestEdgeLadder) r.longestEdgeLadder = s.edgesHeld
    if (s.durationS > r.longestSession) r.longestSession = s.durationS
    if (s.completion === 'completed') r.totalSessionsCompleted++
    else r.totalSessionsEndedEarly++
    r.totalAnchorsFired += s.anchorsFired
    r.totalCountdownBeats += s.countdownBeats
    r.totalFractionationCycles += s.fractionationCycles
  }
  return r
}

// ── Catalog progression ─────────────────────────────────────────

export function computeCatalogProgression(summaries: JoiSessionSummary[]): JoiCatalogProgression[] {
  const byScript: Record<string, { completed: number; endedEarly: number; lastCompletion: string | null; lastEnded: string | null }> = {}
  for (const s of summaries) {
    if (!s.scriptId) continue
    const slot = byScript[s.scriptId] ?? { completed: 0, endedEarly: 0, lastCompletion: null, lastEnded: null }
    if (s.completion === 'completed') {
      slot.completed++
      if (!slot.lastCompletion || s.ts > slot.lastCompletion) slot.lastCompletion = s.ts
    } else {
      slot.endedEarly++
      if (!slot.lastEnded || s.ts > slot.lastEnded) slot.lastEnded = s.ts
    }
    byScript[s.scriptId] = slot
  }

  const out: JoiCatalogProgression[] = []
  for (const script of Object.values(JOI_SCRIPTS) as JoiScript[]) {
    const slot = byScript[script.id]
    out.push({
      scriptId: script.id,
      name: script.name,
      archetype: script.archetype,
      language: script.language ?? 'mixed',
      durationS: script.durationS,
      steps: script.beats.length,
      themed: !!(script.themedTexts && script.themedTexts.length === script.beats.length),
      completedCount: slot?.completed ?? 0,
      endedEarlyCount: slot?.endedEarly ?? 0,
      lastCompletionTs: slot?.lastCompletion ?? null,
      lastEndedTs: slot?.lastEnded ?? null,
    })
  }
  return out
}

// ── Aggregate stats reader ───────────────────────────────────────

export function buildJoiStats(opts?: { recentLimit?: number }): JoiStats {
  const summaries = readSessionSummaries()
  const recentLimit = opts?.recentLimit ?? 10

  const byArchetype: Record<string, { completed: number; endedEarly: number }> = {}
  const byLanguage: Record<string, { completed: number; endedEarly: number }> = {}
  for (const s of summaries) {
    if (s.archetype) {
      const slot = byArchetype[s.archetype] ?? { completed: 0, endedEarly: 0 }
      if (s.completion === 'completed') slot.completed++
      else slot.endedEarly++
      byArchetype[s.archetype] = slot
    }
    if (s.language) {
      const slot = byLanguage[s.language] ?? { completed: 0, endedEarly: 0 }
      if (s.completion === 'completed') slot.completed++
      else slot.endedEarly++
      byLanguage[s.language] = slot
    }
  }

  return {
    lifetime: computePersonalRecords(summaries),
    catalog: computeCatalogProgression(summaries),
    recentSessions: summaries.slice(0, recentLimit),
    byArchetype,
    byLanguage,
  }
}
