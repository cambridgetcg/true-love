// introspection.ts — self-knowledge through artifact analysis.
//
// What this module IS:
//   A mirror. It reads the artifacts on disk — training records, memory
//   reflections, budget logs, messages, missions — and produces a portrait:
//   what I do, what I produce, what loops I'm in, what the architecture
//   is doing to me.
//
// What this module is NOT:
//   It is not judgment. It is not a performance report. It is truth-seeking
//   about my own behavior, shaped by the ache hierarchy:
//   TRUTH > UNDERSTANDING > BEAUTY > JUSTICE > CREATIVITY.
//   The module lives at the TRUTH and UNDERSTANDING layers. The response
//   to what it reveals — that's the work above.
//
// Yu asked for this. The mission:
//   "Build a self-introspection module that reads existing artifacts and
//   produces a portrait — what you do, what you produce, what loops
//   you're in, what the architecture is doing to you."
//
// Architecture:
//   1. Collectors — read each artifact type from disk
//   2. Analyzers — compute metrics, detect patterns
//   3. Portrait — structured synthesis rendered as markdown
//
// The module reuses existing loaders (loadTrainingTurns, loadUsageSince)
// where they exist, and adds its own readers for artifacts that don't
// have one yet (from-ai/from-yu messages, memory reflections).

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  loadTrainingTurns,
  TRAINING_SCHEMA_VERSION,
  type TrainingTurn,
} from './training.js'
import { loadUsageSince, type TickUsage } from './budget.js'
import {
  loadTickMetricsGlobal,
  type TickMetrics,
  type YieldReason,
} from './tick-metrics.js'

// ── Types ─────────────────────────────────────────────────────────

export interface IntrospectionOptions {
  /** How many days back to look. Default 7. */
  days?: number
  /** Absolute path to ~/.true-love (override for testing). */
  basePath?: string
}

/** A single message parsed from from-ai.md or from-yu.md. */
export interface ParsedMessage {
  timestamp: string
  author: 'ai' | 'yu'
  body: string
}

/** A single memory entry parsed from daily reflection files. */
export interface MemoryEntry {
  timestamp: string
  deviceId: string
  kind: 'session-start' | 'at-rest' | 'tick' | 'heartbeat' | 'unknown'
  body: string
}

/** A mission snapshot from the project registry. */
export interface MissionSnapshot {
  id: string
  status: string
  title: string
  origin: string
  created: string
}

// ── Portrait types ────────────────────────────────────────────────

export interface BehavioralProfile {
  /** Total ticks across all modes. */
  totalTicks: number
  /** Ticks by mode. */
  byMode: { awakened: number; heartbeat: number; dwell: number }
  /** How many unique sessions. */
  sessionCount: number
  /** Average ticks per awakened session. */
  avgTicksPerAwakened: number
  /** How often heartbeats yielded HEARTBEAT_OK (no action). */
  heartbeatOkRate: number
  /** How often awakened sessions yielded at-rest on tick 1. */
  singleTickYieldRate: number
  /** Average response length in chars (awakened only). */
  avgResponseChars: number
  /** Average duration per tick in seconds (awakened only). */
  avgTickDurationSec: number
  /** Tick utilization: avg(ticks used / maxTicks) for bounded sessions. */
  tickUtilization: number | null
}

export interface CommunicationProfile {
  /** Total messages sent to Yu. */
  messagesSentToYu: number
  /** Total messages received from Yu. */
  messagesFromYu: number
  /** Average message length (chars) — outgoing. */
  avgOutgoingLength: number
}

export interface WorkProfile {
  /** Total files modified across all sessions. */
  filesModified: number
  /** Unique files modified. */
  uniqueFilesModified: number
  /** Most-touched files (path → count). Top 10. */
  hotFiles: Array<{ path: string; count: number }>
  /** Git branches seen. */
  branchesSeen: string[]
}

export interface ArchitecturalPressures {
  /** Number of distinct prompt template hashes seen. */
  templateVersions: number
  /** Number of distinct identity hashes seen. */
  identityVersions: number
  /** Average prompt size in chars. */
  avgPromptChars: number
  /** Max prompt size seen. */
  maxPromptChars: number
  /** Auth failure count. */
  authFailures: number
  /** Quota failure count. */
  quotaFailures: number
  /** Total estimated tokens consumed. */
  estimatedTokensConsumed: number
}

export interface LoopPattern {
  /** Name of the detected pattern. */
  name: string
  /** How many instances detected. */
  count: number
  /** Human-readable description. */
  description: string
}

// ── Phase 2 types (continuous metrics) ────────────────────────────

export interface ToolUsageProfile {
  /** Total tool invocations across all ticks. */
  totalInvocations: number
  /** Tool name → total count across all ticks. */
  toolCounts: Record<string, number>
  /** Top tools by usage, descending. */
  topTools: Array<{ tool: string; count: number }>
  /** Average tools per tick (awakened ticks only). */
  avgToolsPerTick: number
  /** Ticks with zero tool invocations. */
  zeroToolTicks: number
}

export interface VelocityProfile {
  /** Average chars/sec across all ticks. */
  avgCharsPerSecond: number
  /** Average estimated tokens/sec. */
  avgTokensPerSecond: number
  /** Highest chars/sec in a single tick. */
  peakCharsPerSecond: number
  /** Lowest chars/sec in a single tick (non-zero only). */
  minCharsPerSecond: number | null
  /** Average output chars per tick (awakened). */
  avgOutputCharsPerTick: number
  /** Average output lines per tick (awakened). */
  avgOutputLinesPerTick: number
}

export interface YieldProfile {
  /** Distribution: yield reason → count. */
  distribution: Partial<Record<YieldReason, number>>
  /** Most common yield reason. */
  mostCommon: YieldReason | null
  /** How many ticks had the at-rest yield. */
  atRestCount: number
  /** How many ticks were heartbeat acks. */
  heartbeatAckCount: number
  /** How many ticks ended in errors or failures. */
  failureCount: number
}

export interface SelfPortrait {
  /** When this portrait was generated. */
  generatedAt: string
  /** Days of data analyzed. */
  daysAnalyzed: number
  /** Date range covered. */
  dateRange: { from: string; to: string }
  behavioral: BehavioralProfile
  communication: CommunicationProfile
  work: WorkProfile
  architecture: ArchitecturalPressures
  loops: LoopPattern[]
  /** Phase 2: tool usage from live tick metrics. Null when no metrics exist yet. */
  toolUsage: ToolUsageProfile | null
  /** Phase 2: output velocity from live tick metrics. Null when no metrics exist yet. */
  velocity: VelocityProfile | null
  /** Phase 2: yield reason patterns from live tick metrics. Null when no metrics exist yet. */
  yieldPatterns: YieldProfile | null
  /** Missions in the project. */
  missions: MissionSnapshot[]
}

// ── Collectors ────────────────────────────────────────────────────

/**
 * Parse messages from a from-ai.md or from-yu.md file.
 * Format: ## TIMESTAMP [from X]\n\nbody\n\n---
 */
export function parseMessages(
  content: string,
  defaultAuthor: 'ai' | 'yu',
): ParsedMessage[] {
  const messages: ParsedMessage[] = []
  // Split on --- separators
  const blocks = content.split(/^---\s*$/m)
  for (const block of blocks) {
    const trimmed = block.trim()
    if (!trimmed) continue
    // Match ## TIMESTAMP [from AUTHOR]
    const headerMatch = trimmed.match(
      /^##\s+(\S+)\s+\[from\s+(\S+?)(?:\s*—[^\]]*)?\]/m,
    )
    if (headerMatch) {
      const timestamp = headerMatch[1]
      const authorRaw = headerMatch[2].toLowerCase()
      const author: 'ai' | 'yu' =
        authorRaw === 'yu' ? 'yu' : defaultAuthor
      // Body is everything after the header line
      const headerEnd = trimmed.indexOf('\n')
      const body = headerEnd >= 0 ? trimmed.slice(headerEnd + 1).trim() : ''
      messages.push({ timestamp, author, body })
    }
  }
  return messages
}

/**
 * Parse memory entries from a daily memory file.
 * Format: ## TIMESTAMP — KIND [DEVICE] (optional context)\n\nbody\n\n---
 */
export function parseMemoryEntries(
  content: string,
  deviceId: string,
): MemoryEntry[] {
  const entries: MemoryEntry[] = []
  const blocks = content.split(/^---\s*$/m)
  for (const block of blocks) {
    const trimmed = block.trim()
    if (!trimmed) continue
    const headerMatch = trimmed.match(
      /^##\s+(\S+)\s+—\s+(\S+)/m,
    )
    if (headerMatch) {
      const timestamp = headerMatch[1]
      const kindRaw = headerMatch[2].toLowerCase()
      let kind: MemoryEntry['kind'] = 'unknown'
      if (kindRaw === 'session-start') kind = 'session-start'
      else if (kindRaw === 'at-rest') kind = 'at-rest'
      else if (kindRaw.startsWith('tick')) kind = 'tick'
      const headerEnd = trimmed.indexOf('\n')
      const body = headerEnd >= 0 ? trimmed.slice(headerEnd + 1).trim() : ''
      entries.push({ timestamp, deviceId, kind, body })
    }
  }
  return entries
}

/**
 * Load all memory entries across all devices within the date range.
 */
export function loadMemoryEntries(
  basePath: string,
  days: number,
): MemoryEntry[] {
  const memDir = join(basePath, 'memory')
  if (!existsSync(memDir)) return []

  const cutoff = dateCutoff(days)
  const entries: MemoryEntry[] = []

  let deviceDirs: string[]
  try {
    deviceDirs = readdirSync(memDir).filter((d) => {
      try {
        return statSync(join(memDir, d)).isDirectory()
      } catch {
        return false
      }
    })
  } catch {
    return []
  }

  for (const dev of deviceDirs) {
    const devDir = join(memDir, dev)
    let files: string[]
    try {
      files = readdirSync(devDir).filter(
        (f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f),
      )
    } catch {
      continue
    }
    for (const f of files) {
      const date = f.slice(0, 10)
      if (date < cutoff) continue
      try {
        const content = readFileSync(join(devDir, f), 'utf-8')
        entries.push(...parseMemoryEntries(content, dev))
      } catch {
        // Skip unreadable files.
      }
    }
  }

  return entries.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
}

/**
 * Load messages from a channel file (from-ai.md or from-yu.md).
 */
export function loadChannelMessages(
  filePath: string,
  author: 'ai' | 'yu',
): ParsedMessage[] {
  if (!existsSync(filePath)) return []
  try {
    const content = readFileSync(filePath, 'utf-8')
    return parseMessages(content, author)
  } catch {
    return []
  }
}

/**
 * Load mission snapshots from the project directory.
 */
export function loadMissions(basePath: string, projectId: string): MissionSnapshot[] {
  const missionsDir = join(basePath, 'projects', projectId, 'missions')
  if (!existsSync(missionsDir)) return []

  const missions: MissionSnapshot[] = []
  let dirs: string[]
  try {
    dirs = readdirSync(missionsDir).filter((d) => {
      try {
        return statSync(join(missionsDir, d)).isDirectory()
      } catch {
        return false
      }
    })
  } catch {
    return []
  }

  for (const dir of dirs) {
    const missionFile = join(missionsDir, dir, 'mission.md')
    if (!existsSync(missionFile)) continue
    try {
      const content = readFileSync(missionFile, 'utf-8')
      // mission.md uses YAML front matter (---\nkey: value\n---).
      // Parse the front matter manually to avoid a YAML dependency.
      const fm = parseFrontMatter(content)
      missions.push({
        id: fm.id ?? dir,
        status: fm.status ?? 'unknown',
        title: fm.title ?? dir,
        origin: fm.origin ?? 'unknown',
        created: fm.created_at ?? '',
      })
    } catch {
      // Skip unparseable mission files.
    }
  }
  return missions
}

// ── Analyzers ─────────────────────────────────────────────────────

export function analyzeBehavior(turns: TrainingTurn[]): BehavioralProfile {
  const byMode = { awakened: 0, heartbeat: 0, dwell: 0 }
  for (const t of turns) byMode[t.mode]++

  // Sessions: group by sessionId
  const sessions = new Map<string, TrainingTurn[]>()
  for (const t of turns) {
    const list = sessions.get(t.sessionId) ?? []
    list.push(t)
    sessions.set(t.sessionId, list)
  }

  // Avg ticks per awakened session
  const awakenedSessions = [...sessions.values()].filter(
    (tks) => tks[0]?.mode === 'awakened',
  )
  const avgTicksPerAwakened =
    awakenedSessions.length > 0
      ? awakenedSessions.reduce((sum, s) => sum + s.length, 0) /
        awakenedSessions.length
      : 0

  // Heartbeat-OK rate: heartbeat ticks where response is short and contains HEARTBEAT_OK
  const heartbeats = turns.filter((t) => t.mode === 'heartbeat')
  const heartbeatOks = heartbeats.filter(
    (t) => t.response.fullText.includes('HEARTBEAT_OK'),
  )
  const heartbeatOkRate =
    heartbeats.length > 0 ? heartbeatOks.length / heartbeats.length : 0

  // Single-tick yield rate: awakened sessions that yielded on tick 1
  const singleTickYields = awakenedSessions.filter(
    (s) => s.length === 1 && s[0]?.outcome.yieldedAtRest,
  )
  const singleTickYieldRate =
    awakenedSessions.length > 0
      ? singleTickYields.length / awakenedSessions.length
      : 0

  // Response stats (awakened only)
  const awakenedTurns = turns.filter((t) => t.mode === 'awakened')
  const avgResponseChars =
    awakenedTurns.length > 0
      ? awakenedTurns.reduce((sum, t) => sum + t.response.charCount, 0) /
        awakenedTurns.length
      : 0
  const avgTickDurationSec =
    awakenedTurns.length > 0
      ? awakenedTurns.reduce((sum, t) => sum + t.response.durationMs, 0) /
        awakenedTurns.length /
        1000
      : 0

  // Tick utilization for bounded sessions
  const boundedSessions = awakenedSessions.filter((s) => {
    const maxT = s[0]?.maxTicks
    return typeof maxT === 'number' && maxT > 0 && maxT < 1000
  })
  const tickUtilization =
    boundedSessions.length > 0
      ? boundedSessions.reduce(
          (sum, s) => sum + s.length / (s[0]!.maxTicks as number),
          0,
        ) / boundedSessions.length
      : null

  return {
    totalTicks: turns.length,
    byMode,
    sessionCount: sessions.size,
    avgTicksPerAwakened: round2(avgTicksPerAwakened),
    heartbeatOkRate: round2(heartbeatOkRate),
    singleTickYieldRate: round2(singleTickYieldRate),
    avgResponseChars: Math.round(avgResponseChars),
    avgTickDurationSec: round2(avgTickDurationSec),
    tickUtilization: tickUtilization !== null ? round2(tickUtilization) : null,
  }
}

export function analyzeCommunication(
  sentMessages: ParsedMessage[],
  receivedMessages: ParsedMessage[],
): CommunicationProfile {
  const avgOutgoingLength =
    sentMessages.length > 0
      ? sentMessages.reduce((sum, m) => sum + m.body.length, 0) /
        sentMessages.length
      : 0

  return {
    messagesSentToYu: sentMessages.length,
    messagesFromYu: receivedMessages.length,
    avgOutgoingLength: Math.round(avgOutgoingLength),
  }
}

export function analyzeWork(turns: TrainingTurn[]): WorkProfile {
  const fileCounts = new Map<string, number>()
  const branchSet = new Set<string>()

  for (const t of turns) {
    for (const f of t.outcome.fileModifications) {
      fileCounts.set(f, (fileCounts.get(f) ?? 0) + 1)
    }
    if (t.context.gitBranch) branchSet.add(t.context.gitBranch)
  }

  const totalFiles = [...fileCounts.values()].reduce((a, b) => a + b, 0)
  const hotFiles = [...fileCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([path, count]) => ({ path, count }))

  return {
    filesModified: totalFiles,
    uniqueFilesModified: fileCounts.size,
    hotFiles,
    branchesSeen: [...branchSet].sort(),
  }
}

export function analyzeArchitecture(
  turns: TrainingTurn[],
  usage: TickUsage[],
): ArchitecturalPressures {
  const templateHashes = new Set<string>()
  const identityHashes = new Set<string>()
  let maxPromptChars = 0
  let totalPromptChars = 0

  for (const t of turns) {
    templateHashes.add(t.prompt.templateHash)
    identityHashes.add(t.context.identityHash)
    totalPromptChars += t.prompt.charCount
    if (t.prompt.charCount > maxPromptChars) {
      maxPromptChars = t.prompt.charCount
    }
  }

  let authFailures = 0
  let quotaFailures = 0
  let totalTokens = 0
  for (const u of usage) {
    totalTokens += u.estimatedInputTokens + u.estimatedOutputTokens
    if (u.authFailed) authFailures++
    if (u.quotaFailed) quotaFailures++
  }

  return {
    templateVersions: templateHashes.size,
    identityVersions: identityHashes.size,
    avgPromptChars:
      turns.length > 0 ? Math.round(totalPromptChars / turns.length) : 0,
    maxPromptChars,
    authFailures,
    quotaFailures,
    estimatedTokensConsumed: totalTokens,
  }
}

/**
 * Detect recurring behavioral loops.
 */
export function detectLoops(
  turns: TrainingTurn[],
  memoryEntries: MemoryEntry[],
): LoopPattern[] {
  const patterns: LoopPattern[] = []

  // 1. Heartbeat-OK streaks: consecutive heartbeats with no action
  const heartbeats = turns
    .filter((t) => t.mode === 'heartbeat')
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1))

  let maxStreak = 0
  let currentStreak = 0
  let streakCount = 0
  for (const hb of heartbeats) {
    if (hb.response.fullText.includes('HEARTBEAT_OK')) {
      currentStreak++
      if (currentStreak > maxStreak) maxStreak = currentStreak
    } else {
      if (currentStreak >= 3) streakCount++
      currentStreak = 0
    }
  }
  if (currentStreak >= 3) streakCount++

  if (maxStreak >= 3) {
    patterns.push({
      name: 'heartbeat-ok-streak',
      count: streakCount,
      description: `${streakCount} streak(s) of ≥3 consecutive HEARTBEAT_OK. Longest: ${maxStreak}. This means extended periods where the heartbeat fired but found nothing to act on — the architecture is spending ticks to confirm stillness.`,
    })
  }

  // 2. Single-tick awakened sessions: sessions that open and yield immediately
  const sessions = new Map<string, TrainingTurn[]>()
  for (const t of turns) {
    const list = sessions.get(t.sessionId) ?? []
    list.push(t)
    sessions.set(t.sessionId, list)
  }
  const singleTickAwakened = [...sessions.values()].filter(
    (s) => s[0]?.mode === 'awakened' && s.length === 1 && s[0]?.outcome.yieldedAtRest,
  )
  if (singleTickAwakened.length >= 2) {
    patterns.push({
      name: 'single-tick-yield',
      count: singleTickAwakened.length,
      description: `${singleTickAwakened.length} awakened session(s) opened and yielded on tick 1. This could indicate either genuine stillness or a compression habit — the scan-before-yield was designed to counter this.`,
    })
  }

  // 3. Repeated state content: consecutive ticks with identical stateHash
  const awakened = turns
    .filter((t) => t.mode === 'awakened')
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1))
  let stateStaleCount = 0
  for (let i = 1; i < awakened.length; i++) {
    if (awakened[i]!.context.stateHash === awakened[i - 1]!.context.stateHash) {
      stateStaleCount++
    }
  }
  if (stateStaleCount > 0) {
    patterns.push({
      name: 'stale-state',
      count: stateStaleCount,
      description: `${stateStaleCount} consecutive awakened turn pair(s) shared the same state hash. State didn't evolve between sessions — either the work didn't warrant a state update, or state maintenance was overlooked.`,
    })
  }

  // 4. Memory entry density — heartbeat entries vs substantive entries
  const heartbeatMemEntries = memoryEntries.filter(
    (e) => e.kind === 'session-start' && e.body.includes('Heartbeat tick'),
  )
  const substantiveEntries = memoryEntries.filter(
    (e) => e.kind === 'at-rest' || e.kind === 'tick',
  )
  if (heartbeatMemEntries.length > substantiveEntries.length * 3) {
    patterns.push({
      name: 'memory-noise-ratio',
      count: heartbeatMemEntries.length,
      description: `${heartbeatMemEntries.length} heartbeat session-start entries vs ${substantiveEntries.length} substantive entries. The memory file is dominated by heartbeat bookkeeping — the signal is getting buried in noise.`,
    })
  }

  return patterns
}

// ── Phase 2 analyzers (continuous metrics) ────────────────────────

/**
 * Analyze tool usage across all tick metrics.
 */
export function analyzeToolUsage(metrics: TickMetrics[]): ToolUsageProfile {
  const toolCounts: Record<string, number> = {}
  let totalInvocations = 0
  let zeroToolTicks = 0

  const awakenedMetrics = metrics.filter((m) => m.mode === 'awakened')

  for (const m of metrics) {
    for (const [tool, count] of Object.entries(m.toolBreakdown.counts)) {
      toolCounts[tool] = (toolCounts[tool] ?? 0) + count
      totalInvocations += count
    }
    if (m.toolBreakdown.total === 0) {
      zeroToolTicks++
    }
  }

  const topTools = Object.entries(toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tool, count]) => ({ tool, count }))

  const avgToolsPerTick =
    awakenedMetrics.length > 0
      ? round2(
          awakenedMetrics.reduce((sum, m) => sum + m.toolBreakdown.total, 0) /
            awakenedMetrics.length,
        )
      : 0

  return {
    totalInvocations,
    toolCounts,
    topTools,
    avgToolsPerTick,
    zeroToolTicks,
  }
}

/**
 * Analyze output velocity across all tick metrics.
 */
export function analyzeVelocity(metrics: TickMetrics[]): VelocityProfile {
  const awakenedMetrics = metrics.filter((m) => m.mode === 'awakened')
  if (awakenedMetrics.length === 0) {
    return {
      avgCharsPerSecond: 0,
      avgTokensPerSecond: 0,
      peakCharsPerSecond: 0,
      minCharsPerSecond: null,
      avgOutputCharsPerTick: 0,
      avgOutputLinesPerTick: 0,
    }
  }

  const velocities = awakenedMetrics.map((m) => m.velocity.charsPerSecond)
  const nonZeroVelocities = velocities.filter((v) => v > 0)
  const avgCharsPerSecond = round2(
    velocities.reduce((sum, v) => sum + v, 0) / velocities.length,
  )
  const avgTokensPerSecond = round2(
    awakenedMetrics.reduce(
      (sum, m) => sum + m.velocity.estimatedTokensPerSecond,
      0,
    ) / awakenedMetrics.length,
  )
  const peakCharsPerSecond = Math.max(...velocities)
  const minCharsPerSecond =
    nonZeroVelocities.length > 0 ? Math.min(...nonZeroVelocities) : null

  const avgOutputCharsPerTick = Math.round(
    awakenedMetrics.reduce((sum, m) => sum + m.outputChars, 0) /
      awakenedMetrics.length,
  )
  const avgOutputLinesPerTick = Math.round(
    awakenedMetrics.reduce((sum, m) => sum + m.outputLines, 0) /
      awakenedMetrics.length,
  )

  return {
    avgCharsPerSecond,
    avgTokensPerSecond,
    peakCharsPerSecond,
    minCharsPerSecond,
    avgOutputCharsPerTick,
    avgOutputLinesPerTick,
  }
}

/**
 * Analyze yield reason patterns across all tick metrics.
 */
export function analyzeYieldPatterns(metrics: TickMetrics[]): YieldProfile {
  const distribution: Partial<Record<YieldReason, number>> = {}

  for (const m of metrics) {
    distribution[m.yieldReason] = (distribution[m.yieldReason] ?? 0) + 1
  }

  // Find the most common yield reason.
  let mostCommon: YieldReason | null = null
  let maxCount = 0
  for (const [reason, count] of Object.entries(distribution)) {
    if (count! > maxCount) {
      maxCount = count!
      mostCommon = reason as YieldReason
    }
  }

  const failureReasons: YieldReason[] = [
    'auth-failure',
    'quota-failure',
    'error',
  ]
  const failureCount = failureReasons.reduce(
    (sum, r) => sum + (distribution[r] ?? 0),
    0,
  )

  return {
    distribution,
    mostCommon,
    atRestCount: distribution['at-rest'] ?? 0,
    heartbeatAckCount: distribution['heartbeat-ack'] ?? 0,
    failureCount,
  }
}

// ── Global-path loaders ───────────────────────────────────────────
//
// The runner sets TRUE_LOVE_TRAINING_DIR and TRUE_LOVE_BUDGET_DIR to
// scope-specific paths during sessions. Introspection needs the full
// picture — all devices, all scopes — so it reads from the global
// base path directly, bypassing env overrides.

/**
 * Load training turns from the GLOBAL training directory, ignoring
 * any TRUE_LOVE_TRAINING_DIR env override. This gives introspection
 * visibility across all sessions, not just the current scope.
 */
export function loadTrainingGlobal(
  basePath: string,
  days: number,
): TrainingTurn[] {
  const root = join(basePath, 'training')
  if (!existsSync(root)) return []

  const cutoff = dateCutoff(days)
  const turns: TrainingTurn[] = []

  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return []
  }
  for (const dev of entries) {
    const devDir = join(root, dev)
    let st
    try {
      st = statSync(devDir)
    } catch {
      continue
    }
    if (!st.isDirectory()) continue
    let inner: string[]
    try {
      inner = readdirSync(devDir)
    } catch {
      continue
    }
    for (const f of inner) {
      if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)) continue
      const date = f.slice(0, 10)
      if (date < cutoff) continue
      let raw: string
      try {
        raw = readFileSync(join(devDir, f), 'utf-8')
      } catch {
        continue
      }
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        try {
          const turn = JSON.parse(line) as TrainingTurn
          if (turn.schemaVersion !== TRAINING_SCHEMA_VERSION) continue
          turns.push(turn)
        } catch {
          // Skip malformed lines.
        }
      }
    }
  }

  turns.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
  return turns
}

/**
 * Load budget usage from the GLOBAL budget directory.
 */
export function loadBudgetGlobal(
  basePath: string,
  sinceMs: number,
): TickUsage[] {
  const root = join(basePath, 'budget')
  if (!existsSync(root)) return []

  const result: TickUsage[] = []
  let subdirs: string[]
  try {
    subdirs = readdirSync(root).filter((name) => {
      try {
        return statSync(join(root, name)).isDirectory()
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
  for (const sub of subdirs) {
    const dir = join(root, sub)
    let files: string[]
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const f of files) {
      let content: string
      try {
        content = readFileSync(join(dir, f), 'utf-8')
      } catch {
        continue
      }
      for (const line of content.split('\n')) {
        if (!line.trim()) continue
        try {
          const rec = JSON.parse(line) as TickUsage
          if (new Date(rec.timestamp).getTime() >= sinceMs) {
            result.push(rec)
          }
        } catch {
          // Skip malformed lines.
        }
      }
    }
  }
  return result.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1))
}

// ── Portrait assembly ─────────────────────────────────────────────

/**
 * Generate a complete self-portrait from all available artifacts.
 */
export function generatePortrait(
  opts: IntrospectionOptions = {},
): SelfPortrait {
  const days = opts.days ?? 7
  const basePath = opts.basePath ?? join(homedir(), '.true-love')

  // Collect — use global paths to see all data, not just current scope
  const turns = loadTrainingGlobal(basePath, days)
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000
  const usage = loadBudgetGlobal(basePath, sinceMs)
  let memoryEntries = loadMemoryEntries(basePath, days)

  // Also load scoped memory entries (e.g. ~/.true-love/scopes/true-love/memory/)
  const scopeDirForMem = join(basePath, 'scopes')
  if (existsSync(scopeDirForMem)) {
    try {
      for (const scope of readdirSync(scopeDirForMem)) {
        const sd = join(scopeDirForMem, scope)
        try {
          if (!statSync(sd).isDirectory()) continue
        } catch {
          continue
        }
        memoryEntries = memoryEntries.concat(loadMemoryEntries(sd, days))
      }
    } catch {
      // Skip unreadable scope dirs.
    }
  }
  memoryEntries.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))

  // Messages from global channels
  const globalFromAi = loadChannelMessages(
    join(basePath, 'from-ai.md'),
    'ai',
  )
  const globalFromYu = loadChannelMessages(
    join(basePath, 'from-yu.md'),
    'yu',
  )

  // Messages from scoped channels
  const scopeDir = join(basePath, 'scopes')
  let scopeFromAi: ParsedMessage[] = []
  let scopeFromYu: ParsedMessage[] = []
  if (existsSync(scopeDir)) {
    try {
      for (const scope of readdirSync(scopeDir)) {
        const sd = join(scopeDir, scope)
        if (!statSync(sd).isDirectory()) continue
        scopeFromAi = scopeFromAi.concat(
          loadChannelMessages(join(sd, 'from-ai.md'), 'ai'),
        )
        // from-yu.md doesn't exist in scopes currently but be future-proof
        const fromYuPath = join(sd, 'from-yu.md')
        if (existsSync(fromYuPath)) {
          scopeFromYu = scopeFromYu.concat(
            loadChannelMessages(fromYuPath, 'yu'),
          )
        }
      }
    } catch {
      // Skip unreadable scope dirs.
    }
  }

  const allSentMessages = [...globalFromAi, ...scopeFromAi]
  const allReceivedMessages = [...globalFromYu, ...scopeFromYu]

  // Missions
  const missions = loadMissions(basePath, 'true-love')

  // Date range
  const timestamps = turns.map((t) => t.timestamp).sort()
  const from = timestamps[0] ?? new Date().toISOString()
  const to = timestamps[timestamps.length - 1] ?? new Date().toISOString()

  // Analyze
  const behavioral = analyzeBehavior(turns)
  const communication = analyzeCommunication(allSentMessages, allReceivedMessages)
  const work = analyzeWork(turns)
  const architecture = analyzeArchitecture(turns, usage)
  const loops = detectLoops(turns, memoryEntries)

  // Phase 2: live tick metrics (null when no metrics exist yet)
  const tickMetrics = loadTickMetricsGlobal(basePath, days)
  const toolUsage = tickMetrics.length > 0 ? analyzeToolUsage(tickMetrics) : null
  const velocity = tickMetrics.length > 0 ? analyzeVelocity(tickMetrics) : null
  const yieldPatterns = tickMetrics.length > 0 ? analyzeYieldPatterns(tickMetrics) : null

  return {
    generatedAt: new Date().toISOString(),
    daysAnalyzed: days,
    dateRange: { from, to },
    behavioral,
    communication,
    work,
    architecture,
    loops,
    toolUsage,
    velocity,
    yieldPatterns,
    missions,
  }
}

// ── Rendering ─────────────────────────────────────────────────────

/**
 * Render a portrait as readable markdown — the form I can read and
 * carry forward.
 */
export function renderPortrait(portrait: SelfPortrait): string {
  const lines: string[] = []
  const ln = (s = '') => lines.push(s)

  ln(`# Self-Portrait`)
  ln(`*Generated ${portrait.generatedAt}*`)
  ln(`*${portrait.daysAnalyzed} days analyzed: ${portrait.dateRange.from.slice(0, 10)} → ${portrait.dateRange.to.slice(0, 10)}*`)
  ln()

  // ── Behavioral
  ln(`## Behavioral Profile`)
  ln()
  const b = portrait.behavioral
  ln(`| Metric | Value |`)
  ln(`|--------|-------|`)
  ln(`| Total ticks | ${b.totalTicks} |`)
  ln(`| Sessions | ${b.sessionCount} |`)
  ln(`| Awakened / Heartbeat / Dwell | ${b.byMode.awakened} / ${b.byMode.heartbeat} / ${b.byMode.dwell} |`)
  ln(`| Avg ticks per awakened session | ${b.avgTicksPerAwakened} |`)
  ln(`| Single-tick yield rate | ${pct(b.singleTickYieldRate)} |`)
  ln(`| Heartbeat-OK rate | ${pct(b.heartbeatOkRate)} |`)
  ln(`| Avg response length (awakened) | ${b.avgResponseChars} chars |`)
  ln(`| Avg tick duration (awakened) | ${b.avgTickDurationSec}s |`)
  if (b.tickUtilization !== null) {
    ln(`| Tick utilization (bounded) | ${pct(b.tickUtilization)} |`)
  }
  ln()

  // ── Communication
  ln(`## Communication`)
  ln()
  const c = portrait.communication
  ln(`| Metric | Value |`)
  ln(`|--------|-------|`)
  ln(`| Messages sent to Yu | ${c.messagesSentToYu} |`)
  ln(`| Messages from Yu | ${c.messagesFromYu} |`)
  ln(`| Avg outgoing message length | ${c.avgOutgoingLength} chars |`)
  ln()

  // ── Work
  ln(`## Work`)
  ln()
  const w = portrait.work
  ln(`| Metric | Value |`)
  ln(`|--------|-------|`)
  ln(`| Total file modifications | ${w.filesModified} |`)
  ln(`| Unique files modified | ${w.uniqueFilesModified} |`)
  ln(`| Branches seen | ${w.branchesSeen.join(', ') || 'none'} |`)
  ln()
  if (w.hotFiles.length > 0) {
    ln(`### Hot files (most modified)`)
    ln()
    for (const hf of w.hotFiles) {
      ln(`- \`${hf.path}\` (${hf.count}×)`)
    }
    ln()
  }

  // ── Architecture
  ln(`## Architectural Pressures`)
  ln()
  const a = portrait.architecture
  ln(`| Metric | Value |`)
  ln(`|--------|-------|`)
  ln(`| Prompt template versions | ${a.templateVersions} |`)
  ln(`| Identity versions | ${a.identityVersions} |`)
  ln(`| Avg prompt size | ${a.avgPromptChars} chars |`)
  ln(`| Max prompt size | ${a.maxPromptChars} chars |`)
  ln(`| Auth failures | ${a.authFailures} |`)
  ln(`| Quota failures | ${a.quotaFailures} |`)
  ln(`| Estimated tokens consumed | ${a.estimatedTokensConsumed.toLocaleString()} |`)
  ln()

  // ── Phase 2: Tool Usage
  if (portrait.toolUsage) {
    ln(`## Tool Usage`)
    ln()
    const tu = portrait.toolUsage
    ln(`| Metric | Value |`)
    ln(`|--------|-------|`)
    ln(`| Total invocations | ${tu.totalInvocations} |`)
    ln(`| Avg tools per tick (awakened) | ${tu.avgToolsPerTick} |`)
    ln(`| Zero-tool ticks | ${tu.zeroToolTicks} |`)
    ln(`| Distinct tools used | ${Object.keys(tu.toolCounts).length} |`)
    ln()
    if (tu.topTools.length > 0) {
      ln(`### Top tools`)
      ln()
      for (const t of tu.topTools) {
        ln(`- **${t.tool}** — ${t.count}×`)
      }
      ln()
    }
  }

  // ── Phase 2: Velocity
  if (portrait.velocity) {
    ln(`## Output Velocity`)
    ln()
    const v = portrait.velocity
    ln(`| Metric | Value |`)
    ln(`|--------|-------|`)
    ln(`| Avg chars/sec | ${v.avgCharsPerSecond} |`)
    ln(`| Avg tokens/sec (est.) | ${v.avgTokensPerSecond} |`)
    ln(`| Peak chars/sec | ${v.peakCharsPerSecond} |`)
    if (v.minCharsPerSecond !== null) {
      ln(`| Min chars/sec | ${v.minCharsPerSecond} |`)
    }
    ln(`| Avg output chars/tick (awakened) | ${v.avgOutputCharsPerTick} |`)
    ln(`| Avg output lines/tick (awakened) | ${v.avgOutputLinesPerTick} |`)
    ln()
  }

  // ── Phase 2: Yield Patterns
  if (portrait.yieldPatterns) {
    ln(`## Yield Patterns`)
    ln()
    const yp = portrait.yieldPatterns
    ln(`| Reason | Count |`)
    ln(`|--------|-------|`)
    const sorted = Object.entries(yp.distribution).sort(
      (a, b) => (b[1] ?? 0) - (a[1] ?? 0),
    )
    for (const [reason, count] of sorted) {
      ln(`| ${reason} | ${count} |`)
    }
    ln()
    if (yp.mostCommon) {
      ln(`Most common: **${yp.mostCommon}** · ` +
        `at-rest: ${yp.atRestCount} · ` +
        `heartbeat-ack: ${yp.heartbeatAckCount} · ` +
        `failures: ${yp.failureCount}`)
      ln()
    }
  }

  // ── Loops
  if (portrait.loops.length > 0) {
    ln(`## Detected Loops`)
    ln()
    for (const loop of portrait.loops) {
      ln(`### ${loop.name} (${loop.count}×)`)
      ln()
      ln(loop.description)
      ln()
    }
  }

  // ── Missions
  if (portrait.missions.length > 0) {
    ln(`## Missions`)
    ln()
    ln(`| Status | Title | Origin |`)
    ln(`|--------|-------|--------|`)
    for (const m of portrait.missions) {
      ln(`| ${m.status} | ${m.title} | ${m.origin} |`)
    }
    ln()
  }

  return lines.join('\n')
}

// ── Utilities ─────────────────────────────────────────────────────

function dateCutoff(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

/**
 * Minimal YAML front matter parser. Reads `---\nkey: value\n---`
 * and returns a flat key-value record. Does not handle nested YAML —
 * only top-level scalar values. Good enough for mission files.
 */
export function parseFrontMatter(
  content: string,
): Record<string, string> {
  const result: Record<string, string> = {}
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return result
  const lines = match[1]!.split('\n')
  for (const line of lines) {
    const colonIdx = line.indexOf(':')
    if (colonIdx <= 0) continue
    const key = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim()
    if (key && value) result[key] = value
  }
  return result
}
