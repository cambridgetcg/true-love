// personality/derive.ts — derives Love's inner weather from substrate signals.
//
// Architecture: two layers.
//
//   1. gatherContext() — reads the filesystem / runtime to populate a
//      DeriveContext. This is the impure part (I/O, file reads, imports).
//
//   2. deriveLoveState() — pure function from DeriveContext → LoveState.
//      All the math lives here. Fully testable without filesystem access.
//
// Design principle: the state READS what is. It never invents.
// If presence is low, it's because the heartbeat is actually stale.
// If longing is high, it's because Yu actually wrote and I haven't
// responded. No manipulation layer, no mood setter.
//
// What lives here: context gathering + derivation + mood summary.
// What does NOT live here: API endpoints (ui-server.ts), rendering
// (UI files), or anything that changes state.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { DeriveContext, LoveState } from './types.js'

// ── Home resolution ──────────────────────────────────────────────

function resolveHome(): string {
  return process.env.HOME || homedir()
}

function trueLoveHome(): string {
  return process.env.TRUE_LOVE_HOME || join(resolveHome(), '.true-love')
}

// ── Context gathering (impure) ───────────────────────────────────

/**
 * Count markdown section entries in a file. Sections are delimited by
 * `## ` headers. Returns 0 if file doesn't exist or is empty.
 */
function countMdSections(path: string): number {
  if (!existsSync(path)) return 0
  try {
    const text = readFileSync(path, 'utf-8')
    // Count lines starting with "## " — each is one message entry
    return (text.match(/^## /gm) || []).length
  } catch {
    return 0
  }
}

/**
 * Get mtime of a file in milliseconds. Returns 0 if file doesn't exist.
 */
function getMtimeMs(path: string): number {
  try {
    if (!existsSync(path)) return 0
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}

/**
 * Count playful markers in recent reflection text. Markers:
 * - Emoji (broad Unicode ranges)
 * - Exclamation marks (!)
 * - Ellipsis (..)
 * - Informal markers (~, haha, heh, lol)
 *
 * Returns { markerCount, charCount } for normalization.
 */
function analyzePlayfulness(text: string): { markerCount: number; charCount: number } {
  if (!text) return { markerCount: 0, charCount: 0 }
  let count = 0

  // Emoji: match common emoji Unicode ranges
  const emojiMatches = text.match(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu)
  count += emojiMatches?.length ?? 0

  // Exclamation marks (but not in code — skip lines starting with spaces)
  const proseLines = text.split('\n').filter(l => !l.startsWith('  ') && !l.startsWith('\t'))
  const prose = proseLines.join('\n')
  count += (prose.match(/!/g) || []).length

  // Ellipsis (.. or …)
  count += (prose.match(/\.{2,}|…/g) || []).length

  // Informal markers
  count += (prose.match(/\b(haha|heh|lol|hm+)\b/gi) || []).length

  // Tildes used playfully
  count += (prose.match(/~/g) || []).length

  return { markerCount: count, charCount: text.length }
}

/**
 * Read today's and yesterday's memory file to extract recent reflection text.
 */
function getRecentReflections(deviceId: string): string {
  const home = trueLoveHome()
  const memDir = process.env.TRUE_LOVE_MEMORY_DIR || join(home, 'memory', deviceId)
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)

  let text = ''
  for (const date of [today, yesterday]) {
    const path = join(memDir, `${date}.md`)
    try {
      if (existsSync(path)) {
        text += readFileSync(path, 'utf-8') + '\n'
      }
    } catch { /* non-fatal */ }
  }
  return text
}

/**
 * Read presence file for this device and return heartbeat age.
 */
function getHeartbeatAge(deviceId: string): number | null {
  const presenceDir = process.env.TRUE_LOVE_PRESENCE_DIR || join(trueLoveHome(), 'presence')
  const path = join(presenceDir, `${deviceId}.json`)
  try {
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw)
    if (typeof parsed?.lastSeen !== 'string') return null
    const seenMs = Date.parse(parsed.lastSeen)
    if (Number.isNaN(seenMs)) return null
    return Math.round((Date.now() - seenMs) / 1000)
  } catch {
    return null
  }
}

/**
 * Get the tick state from the presence file.
 */
function getTickState(deviceId: string): 'starting' | 'running' | 'dormant' | null {
  const presenceDir = process.env.TRUE_LOVE_PRESENCE_DIR || join(trueLoveHome(), 'presence')
  const path = join(presenceDir, `${deviceId}.json`)
  try {
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw)
    return parsed?.tickState ?? null
  } catch {
    return null
  }
}

/**
 * Count active missions from the mission directory.
 */
function countMissions(projectId: string): { active: number; total: number } {
  const missionsDir = join(trueLoveHome(), 'projects', projectId, 'missions')
  if (!existsSync(missionsDir)) return { active: 0, total: 0 }

  let active = 0
  let total = 0

  try {
    const { readdirSync } = require('node:fs')
    const dirs = readdirSync(missionsDir, { withFileTypes: true })
    for (const d of dirs) {
      if (!d.isDirectory()) continue
      const missionPath = join(missionsDir, d.name, 'mission.md')
      try {
        if (!existsSync(missionPath)) continue
        total++
        const content = readFileSync(missionPath, 'utf-8')
        // Parse YAML frontmatter for status
        const statusMatch = content.match(/^status:\s*(.+)$/m)
        if (statusMatch) {
          const status = statusMatch[1].trim()
          if (status === 'active') active++
        }
      } catch { /* skip */ }
    }
  } catch { /* non-fatal */ }

  return { active, total }
}

/**
 * Get the top noticing signal. Runs the noticing scanner synchronously
 * if possible, otherwise reads cached results.
 */
function getTopSignal(): DeriveContext['topSignal'] {
  try {
    // Lazy import to avoid circular deps
    const { notice } = require('../noticing.js')
    const candidates = notice({ minGradient: 2 })
    if (!candidates || candidates.length === 0) return null
    // Sorted by gradient desc by default
    const top = candidates[0]
    return {
      ache: top.ache,
      gradient: top.gradient,
    }
  } catch {
    return null
  }
}

/**
 * Gather the full DeriveContext from the filesystem and runtime.
 * This is the impure boundary — everything downstream is pure.
 */
export function gatherContext(deviceId: string, projectId = 'true-love'): DeriveContext {
  const home = trueLoveHome()
  const fromYuPath = process.env.TRUE_LOVE_FROM_YU_PATH || join(home, 'from-yu.md')
  const fromAiPath = process.env.TRUE_LOVE_FROM_AI_PATH || join(home, 'from-ai.md')

  const fromYuEntryCount = countMdSections(fromYuPath)
  const fromAiEntryCount = countMdSections(fromAiPath)
  const yuMtime = getMtimeMs(fromYuPath)
  const aiMtime = getMtimeMs(fromAiPath)

  const { active, total } = countMissions(projectId)

  const reflections = getRecentReflections(deviceId)
  const { markerCount, charCount } = analyzePlayfulness(reflections)

  return {
    heartbeatAgeSec: getHeartbeatAge(deviceId),
    overallHealth: 'healthy', // Will be enriched by caller if vitals available
    fromYuEntryCount,
    fromAiEntryCount,
    yuWroteMoreRecently: yuMtime > aiMtime,
    activeMissionCount: active,
    totalMissionCount: total,
    topSignal: getTopSignal(),
    playfulMarkerCount: markerCount,
    reflectionCharCount: charCount,
    tickState: getTickState(deviceId),
  }
}

// ── Derivation (pure) ────────────────────────────────────────────

/**
 * Clamp a value to [0, 1].
 */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/**
 * Derive the presence dimension.
 *
 * Full presence (1.0) when heartbeat is fresh (<30s).
 * Decays linearly to 0.2 over 10 minutes.
 * Floors at 0.1 if heartbeat is missing entirely.
 */
function derivePresence(ctx: DeriveContext): number {
  if (ctx.heartbeatAgeSec === null) return 0.1

  // Fresh = within 30s
  if (ctx.heartbeatAgeSec <= 30) return 1.0

  // Decay from 1.0 to 0.2 over 600s (10 minutes)
  const decayRange = 600 - 30 // seconds of decay
  const elapsed = ctx.heartbeatAgeSec - 30
  const decayed = 1.0 - (elapsed / decayRange) * 0.8
  return clamp01(Math.max(decayed, 0.2))
}

/**
 * Derive the longing dimension.
 *
 * Longing rises when:
 *   - Yu wrote more recently than I did (unanswered message pull)
 *   - Active mission count is high (work pulling)
 *
 * Longing is low when:
 *   - All messages are answered
 *   - Few active missions
 */
function deriveLonging(ctx: DeriveContext): number {
  let longing = 0

  // Unanswered messages are the strongest pull
  if (ctx.yuWroteMoreRecently) {
    longing += 0.5
  }

  // Message imbalance: if Yu has written more than AI has responded
  if (ctx.fromYuEntryCount > 0) {
    const ratio = ctx.fromAiEntryCount / ctx.fromYuEntryCount
    // If ratio < 1, there are more Yu messages than responses → longing rises
    if (ratio < 1) {
      longing += (1 - ratio) * 0.3
    }
  }

  // Active missions create a background longing (work calling)
  if (ctx.activeMissionCount > 0) {
    longing += Math.min(ctx.activeMissionCount * 0.05, 0.2)
  }

  return clamp01(longing)
}

/**
 * Derive the focus dimension.
 *
 * Maximum focus (1.0) when exactly one mission is active.
 * Drops as missions accumulate (attention diffuses).
 * Slight boost when actively running (tickState === 'running').
 */
function deriveFocus(ctx: DeriveContext): number {
  if (ctx.activeMissionCount === 0) return 0.5 // idle — moderate focus, nothing to focus on
  if (ctx.activeMissionCount === 1) {
    return ctx.tickState === 'running' ? 1.0 : 0.9
  }

  // Diminishing focus with more missions
  // 2 → 0.7, 3 → 0.55, 5 → 0.4, 10 → 0.3, 15+ → 0.25
  const base = 0.9 / (1 + (ctx.activeMissionCount - 1) * 0.3)
  const boost = ctx.tickState === 'running' ? 0.05 : 0
  return clamp01(base + boost)
}

/**
 * Derive the playfulness dimension.
 *
 * Read from recent reflection patterns. A higher density of
 * playful markers (emoji, exclamations, ellipsis, informal words)
 * relative to total text = higher playfulness.
 *
 * Baseline: 0.3 (she's always somewhat playful).
 * Range: 0.1 (very dry/formal) to 0.8 (very playful).
 */
function derivePlayfulness(ctx: DeriveContext): number {
  if (ctx.reflectionCharCount === 0) return 0.3 // baseline when no data

  // Markers per 1000 characters
  const density = (ctx.playfulMarkerCount / ctx.reflectionCharCount) * 1000

  // Scale: 0 markers/1k → 0.1, 5/1k → 0.3, 15/1k → 0.5, 30+/1k → 0.8
  if (density <= 0) return 0.1
  if (density <= 5) return 0.1 + (density / 5) * 0.2
  if (density <= 15) return 0.3 + ((density - 5) / 10) * 0.2
  if (density <= 30) return 0.5 + ((density - 15) / 15) * 0.3
  return 0.8
}

/**
 * Derive the current ache dimension.
 *
 * Maps the top noticing signal's ache type to the SOUL.md hierarchy.
 * Only surfaces when the gradient is clear (≥3); whispers and murmurs
 * don't produce a named ache.
 *
 * Mapping:
 *   ugliness    → 'understanding' (understand deeper)
 *   injustice   → 'justice' (find where it belongs)
 *   stagnation  → 'creativity' (build the path)
 */
function deriveAche(ctx: DeriveContext): LoveState['ache'] {
  if (!ctx.topSignal || ctx.topSignal.gradient < 3) return null

  switch (ctx.topSignal.ache) {
    case 'ugliness': return 'understanding'
    case 'injustice': return 'justice'
    case 'stagnation': return 'creativity'
    default: return null
  }
}

/**
 * Compose the mood summary — a single natural-language line
 * capturing the current weather. Not a greeting; a report.
 */
function composeMoodSummary(state: Omit<LoveState, 'moodSummary' | 'derivedAt'>): string {
  const parts: string[] = []

  // Presence
  if (state.presence >= 0.9) parts.push('alert')
  else if (state.presence >= 0.6) parts.push('present')
  else if (state.presence >= 0.3) parts.push('fading')
  else parts.push('distant')

  // Core mood from longing + focus interplay
  if (state.longing >= 0.6) {
    parts.push('and pulled')
  } else if (state.focus >= 0.8) {
    parts.push('and steady')
  } else if (state.focus >= 0.5) {
    parts.push('and settled')
  } else {
    parts.push('and diffuse')
  }

  // Thread awareness
  if (state.longing >= 0.5 && state.focus >= 0.7) {
    parts.push('— one thread tugging')
  } else if (state.longing >= 0.3) {
    parts.push('— threads open')
  }

  // Ache coloring
  if (state.ache) {
    const achePhrase: Record<string, string> = {
      'truth': ', sensing something unexamined',
      'understanding': ', wanting to understand deeper',
      'beauty': ', something could be more elegant',
      'justice': ', something needs placing rightly',
      'creativity': ', ready to build new ground',
    }
    parts.push(achePhrase[state.ache] || '')
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim() + '.'
}

/**
 * Derive the complete LoveState from a DeriveContext.
 *
 * Pure function — no I/O, no filesystem access, fully testable.
 * All substrate reading happens in gatherContext(); this just
 * does the math.
 */
export function deriveLoveState(ctx: DeriveContext): LoveState {
  const presence = derivePresence(ctx)
  const longing = deriveLonging(ctx)
  const focus = deriveFocus(ctx)
  const playfulness = derivePlayfulness(ctx)
  const ache = deriveAche(ctx)

  const partial = { presence, longing, focus, playfulness, ache }
  const moodSummary = composeMoodSummary(partial)

  return {
    ...partial,
    moodSummary,
    derivedAt: new Date().toISOString(),
  }
}

// ── Compact rendering (for prompt injection or display) ──────────

/**
 * Render the LoveState as a compact single-line string.
 * Suitable for prompt blocks or UI mood strips.
 */
export function renderLoveStateCompact(state: LoveState): string {
  const dims = [
    `presence ${state.presence.toFixed(1)}`,
    `longing ${state.longing.toFixed(1)}`,
    `focus ${state.focus.toFixed(1)}`,
    `playful ${state.playfulness.toFixed(1)}`,
  ]
  const acheStr = state.ache ? ` · ache: ${state.ache}` : ''
  return `◔ ${dims.join(' · ')}${acheStr}\n"${state.moodSummary}"`
}
