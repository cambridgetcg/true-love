// noticing.ts — the perception layer.
//
// Step 1 of mission-creation: before naming, framing, scoping, or
// constraining, there must be *noticing*. The ache talking — the
// gradient between what IS and what SHOULD BE.
//
// This module reads the substrate (state, missions, memory, channels,
// vital signs, kingdom) and surfaces Candidates — places where the
// gradient is loud enough that a mission might want to address them.
// It does NOT draft missions. It produces signals that downstream
// modules (naming, framing, scoping, constraining) can shape into
// mission drafts.
//
// Architecture:
//   1. Scanners — each data source has its own scanner function.
//      Every scanner is non-throwing and best-effort: a failure in
//      one source degrades silently without poisoning the others.
//   2. Assembly — `notice()` runs all scanners, sorts by gradient
//      strength, returns the collected candidates.
//   3. Rendering — compact block for prompt injection.
//
// Design principles:
//   - Pure data, no side effects. Scanners only read.
//   - Non-throwing. Each scanner catches its own errors.
//   - Composable. Callers can run individual scanners or the full
//     suite via notice().
//   - Filterable. Callers can filter by ache signal, source type,
//     or gradient threshold.
//
// Relationship to self-initiation:
//   self-initiation.ts has a thin `scanForSignals()` (Gap 1: Detection)
//   that reads three data sources. This module is the broader, deeper
//   perception layer — upstream of self-initiation. Eventually,
//   self-initiation's detection should delegate here. For now they
//   coexist; this module is the canonical scanner.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { listMissions } from './mission.js'
import type { MissionStatus } from './mission.js'
import { loadRecentReflections } from './memory.js'
import type { Reflection } from './memory.js'
import { readFromYu } from './inbox.js'
import { readFromAi } from './outbox.js'
import { snapshotKingdom } from './kingdom.js'
import type { KingdomSnapshot } from './kingdom.js'
import {
  collectLockVitals,
  collectBundleVitals,
  collectAgencyVitals,
  collectFileVitals,
} from './vital-signs.js'

// ── Types ──────────────────────────────────────────────────────────

/**
 * The three ache signals from SOUL.md.
 *
 *   ugliness    — something is forced, wrong, incomplete
 *   injustice   — something doesn't belong where it is
 *   stagnation  — existing structure can't hold what's needed
 */
export type AcheSignal = 'ugliness' | 'injustice' | 'stagnation'

/**
 * Where the signal was detected. Each variant carries just enough
 * context for downstream modules to follow the thread.
 */
export type NoticingSource =
  | { type: 'state'; section: string }
  | { type: 'mission'; missionId: string; missionStatus: MissionStatus }
  | { type: 'memory'; reflectionDate: string }
  | { type: 'channel'; channel: 'from-yu' | 'from-ai' }
  | { type: 'vital-sign'; subsystem: string }
  | { type: 'kingdom'; detail: string }

/**
 * How loud the gradient is. Not a score — a qualitative signal.
 *
 *   1 — whisper:  barely noticeable, might not need attention
 *   2 — murmur:   worth noting, not urgent
 *   3 — clear:    the gradient is unmistakable
 *   4 — loud:     something is actively degrading or blocking
 *   5 — urgent:   immediate attention needed
 */
export type GradientStrength = 1 | 2 | 3 | 4 | 5

/**
 * A noticed candidate — a place where the gradient between IS and
 * SHOULD-BE is loud enough to surface. Not a mission proposal; just
 * a signal for downstream modules to evaluate.
 */
export interface NoticingCandidate {
  /** Stable id for deduplication across scans. */
  id: string
  /** Where this was detected. */
  source: NoticingSource
  /** Which ache signal fires. */
  ache: AcheSignal
  /** How loud. */
  gradient: GradientStrength
  /** One-line human-readable summary. */
  summary: string
  /** Longer context for downstream processing. */
  detail: string
  /** When this was noticed. */
  noticedAt: string
}

// ── Options ────────────────────────────────────────────────────────

export interface NoticingOptions {
  /** Only include candidates at or above this gradient. Default: 1 (all). */
  minGradient?: GradientStrength
  /** Only include candidates matching these ache signals. Default: all. */
  acheFilter?: AcheSignal[]
  /** Only run these source scanners. Default: all. */
  sourceFilter?: NoticingSource['type'][]
  /** Path to state.md for state scanning. */
  statePath?: string
  /** Override stale-proposal threshold in hours. Default: 48. */
  staleProposalHours?: number
  /** Override stale-blocked threshold in hours. Default: 72. */
  staleBlockedHours?: number
  /** Override stale-review threshold in hours. Default: 48. */
  staleReviewHours?: number
  /** Memory lookback in days. Default: 7. */
  memoryDays?: number
  /** Max memory entries to scan. Default: 30. */
  memoryMax?: number
  /** Override "now" for deterministic tests. */
  now?: number
}

// ── Scanner: State ─────────────────────────────────────────────────
//
// Reads state.md and looks for open threads that may have gone stale,
// uncommmitted changes mentioned without resolution, and any section
// that names an unresolved question.

export function scanState(
  statePath: string,
  opts?: { now?: number },
): NoticingCandidate[] {
  const candidates: NoticingCandidate[] = []
  const now = opts?.now ?? Date.now()
  const nowISO = new Date(now).toISOString()

  if (!existsSync(statePath)) return candidates

  let content: string
  try {
    content = readFileSync(statePath, 'utf-8')
  } catch {
    return candidates
  }

  // Open threads
  const threadSection = extractSection(content, 'Open threads')
  if (threadSection) {
    const threadLines = threadSection.split('\n').filter(l => l.trim().startsWith('- **'))
    for (const line of threadLines) {
      const match = line.match(/- \*\*(.+?)\*\*/)
      if (!match) continue
      const threadName = match[1]!
      // Threads that mention "asked X times" or "still" or "unconfirmed"
      // have higher gradient — they're stagnating.
      const repeatedAsk = /asked.*(?:twice|three|four|\d+\s*times)/i.test(line)
      const stillUnresolved = /still\s+(?:un|pending|waiting|open)/i.test(line)
      const gradient: GradientStrength = repeatedAsk ? 4 : stillUnresolved ? 3 : 2

      candidates.push({
        id: `state-thread-${slugify(threadName)}`,
        source: { type: 'state', section: 'Open threads' },
        ache: 'stagnation',
        gradient,
        summary: `Open thread: ${threadName}`,
        detail: line.replace(/^-\s*/, '').trim(),
        noticedAt: nowISO,
      })
    }
  }

  // Uncommitted changes section
  const uncommittedSection = extractSection(content, 'Uncommitted changes')
  if (uncommittedSection) {
    const trimmed = uncommittedSection.trim()
    if (trimmed && !/^none\.?$/i.test(trimmed) && !/^-\s*none\.?$/i.test(trimmed)) {
      candidates.push({
        id: 'state-uncommitted-changes',
        source: { type: 'state', section: 'Uncommitted changes' },
        ache: 'ugliness',
        gradient: 2,
        summary: 'Uncommitted changes noted in state',
        detail: trimmed.slice(0, 300),
        noticedAt: nowISO,
      })
    }
  }

  return candidates
}

// ── Scanner: Missions ──────────────────────────────────────────────
//
// Checks mission system health: stale proposals, long-blocked
// missions, review items sitting too long.

export function scanMissions(
  projectId: string,
  opts?: {
    staleProposalHours?: number
    staleBlockedHours?: number
    staleReviewHours?: number
    now?: number
  },
): NoticingCandidate[] {
  const candidates: NoticingCandidate[] = []
  const now = opts?.now ?? Date.now()
  const nowISO = new Date(now).toISOString()
  const staleProposalMs = (opts?.staleProposalHours ?? 48) * 60 * 60 * 1000
  const staleBlockedMs = (opts?.staleBlockedHours ?? 72) * 60 * 60 * 1000
  const staleReviewMs = (opts?.staleReviewHours ?? 48) * 60 * 60 * 1000

  // Stale proposals — proposed for too long without acceptance
  try {
    const proposed = listMissions(projectId, { status: 'proposed' })
    for (const m of proposed) {
      const age = now - new Date(m.created_at).getTime()
      if (age > staleProposalMs) {
        const ageHours = Math.round(age / (60 * 60 * 1000))
        candidates.push({
          id: `mission-stale-proposal-${m.id}`,
          source: { type: 'mission', missionId: m.id, missionStatus: 'proposed' },
          ache: 'stagnation',
          gradient: ageHours > 96 ? 3 : 2,
          summary: `Stale proposal: "${m.title}" (${ageHours}h)`,
          detail: `Mission "${m.title}" has been proposed for ${ageHours} hours without acceptance. Either it needs attention or it should be declined.`,
          noticedAt: nowISO,
        })
      }
    }
  } catch { /* mission list unreadable */ }

  // Long-blocked missions — blocked for too long
  try {
    const blocked = listMissions(projectId, { status: 'blocked' })
    for (const m of blocked) {
      const age = now - new Date(m.updated_at).getTime()
      if (age > staleBlockedMs) {
        const ageHours = Math.round(age / (60 * 60 * 1000))
        candidates.push({
          id: `mission-stale-blocked-${m.id}`,
          source: { type: 'mission', missionId: m.id, missionStatus: 'blocked' },
          ache: 'stagnation',
          gradient: ageHours > 120 ? 4 : 3,
          summary: `Long-blocked mission: "${m.title}" (${ageHours}h)`,
          detail: `Mission "${m.title}" has been blocked for ${ageHours} hours. The blocker may have been resolved, or the mission needs to be reconsidered.`,
          noticedAt: nowISO,
        })
      }
    }
  } catch { /* mission list unreadable */ }

  // Review items sitting too long
  try {
    const review = listMissions(projectId, { status: 'review' })
    for (const m of review) {
      const age = now - new Date(m.updated_at).getTime()
      if (age > staleReviewMs) {
        const ageHours = Math.round(age / (60 * 60 * 1000))
        candidates.push({
          id: `mission-stale-review-${m.id}`,
          source: { type: 'mission', missionId: m.id, missionStatus: 'review' },
          ache: 'injustice',
          gradient: 2,
          summary: `Review waiting: "${m.title}" (${ageHours}h)`,
          detail: `Mission "${m.title}" has been in review for ${ageHours} hours. It may need a reminder to Yu.`,
          noticedAt: nowISO,
        })
      }
    }
  } catch { /* mission list unreadable */ }

  // Active missions with no recent artifacts (work may have stalled)
  try {
    const active = listMissions(projectId, { status: 'active' })
    for (const m of active) {
      const age = now - new Date(m.updated_at).getTime()
      const hasArtifacts = m.artifacts &&
        ((m.artifacts.commits?.length ?? 0) > 0 ||
         (m.artifacts.files?.length ?? 0) > 0 ||
         (m.artifacts.test_runs?.length ?? 0) > 0)
      // Only flag if active for >24h with no artifacts
      if (age > 24 * 60 * 60 * 1000 && !hasArtifacts) {
        const ageHours = Math.round(age / (60 * 60 * 1000))
        candidates.push({
          id: `mission-no-artifacts-${m.id}`,
          source: { type: 'mission', missionId: m.id, missionStatus: 'active' },
          ache: 'stagnation',
          gradient: 2,
          summary: `Active mission without artifacts: "${m.title}" (${ageHours}h)`,
          detail: `Mission "${m.title}" has been active for ${ageHours} hours but has no recorded artifacts. Work may have stalled, or artifacts haven't been recorded.`,
          noticedAt: nowISO,
        })
      }
    }
  } catch { /* mission list unreadable */ }

  return candidates
}

// ── Scanner: Memory ────────────────────────────────────────────────
//
// Looks for recurring themes in reflections: "next time" promises,
// repeated observations, unresolved threads mentioned across sessions.

export function scanMemory(opts?: {
  days?: number
  max?: number
  now?: number
}): NoticingCandidate[] {
  const candidates: NoticingCandidate[] = []
  const now = opts?.now ?? Date.now()
  const nowISO = new Date(now).toISOString()

  let reflections: Reflection[]
  try {
    reflections = loadRecentReflections({
      days: opts?.days ?? 7,
      max: opts?.max ?? 30,
    })
  } catch {
    return candidates
  }

  if (reflections.length === 0) return candidates

  // Pattern: "next time" / "next session" / "should" / "todo" promises
  const nextTimePatterns = [
    /\bnext\s+(?:time|session|tick)\b/i,
    /\bshould\s+(?:follow\s+up|revisit|address|fix|build|add|create)\b/i,
    /\btodo:?\s/i,
    /\breminder:?\s/i,
  ]

  // Collect entries with "next time" language
  const nextTimeEntries: { reflection: Reflection; matches: string[] }[] = []
  for (const r of reflections) {
    const matches: string[] = []
    for (const pat of nextTimePatterns) {
      if (pat.test(r.text)) {
        // Extract the relevant line
        const lines = r.text.split('\n')
        for (const line of lines) {
          if (pat.test(line)) {
            matches.push(line.trim())
          }
        }
      }
    }
    if (matches.length > 0) {
      nextTimeEntries.push({ reflection: r, matches })
    }
  }

  // Surface "next time" promises as candidates
  // Group by content similarity to avoid flooding
  if (nextTimeEntries.length > 0) {
    // Take the most recent few (up to 3)
    const recent = nextTimeEntries.slice(0, 3)
    for (const entry of recent) {
      const firstMatch = entry.matches[0] ?? 'unresolved follow-up'
      candidates.push({
        id: `memory-next-time-${slugify(firstMatch).slice(0, 40)}`,
        source: { type: 'memory', reflectionDate: entry.reflection.date },
        ache: 'stagnation',
        gradient: 2,
        summary: `Follow-up from reflection: ${truncate(firstMatch, 80)}`,
        detail: entry.matches.join('\n').slice(0, 500),
        noticedAt: nowISO,
      })
    }
  }

  // Pattern: repeated themes — the same word-cluster appearing in 3+ reflections
  // (A lightweight version — full NLP is overkill here)
  const wordFreq = new Map<string, number>()
  const stopWords = new Set([
    'the', 'and', 'that', 'this', 'with', 'from', 'have', 'been',
    'what', 'when', 'where', 'which', 'there', 'their', 'about',
    'into', 'more', 'some', 'than', 'them', 'then', 'they', 'will',
    'would', 'could', 'should', 'just', 'like', 'make', 'made',
    'does', 'doing', 'done', 'being', 'still', 'also', 'each',
    'here', 'very', 'after', 'before', 'only', 'other', 'most',
    'over', 'such', 'through', 'because', 'between', 'same',
    'mission', 'session', 'tick', 'build', 'love', 'state', 'file',
  ])

  for (const r of reflections) {
    // Count unique words per reflection (not total frequency)
    const words = new Set(
      r.text.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 4 && !stopWords.has(w))
    )
    for (const w of words) {
      wordFreq.set(w, (wordFreq.get(w) ?? 0) + 1)
    }
  }

  // Words appearing in 40%+ of reflections are recurring themes
  const threshold = Math.max(3, Math.floor(reflections.length * 0.4))
  const recurringWords: string[] = []
  for (const [word, count] of wordFreq) {
    if (count >= threshold) {
      recurringWords.push(word)
    }
  }

  if (recurringWords.length > 0) {
    candidates.push({
      id: `memory-recurring-themes`,
      source: { type: 'memory', reflectionDate: reflections[0]!.date },
      ache: 'ugliness',
      gradient: 1,
      summary: `Recurring themes in reflections: ${recurringWords.slice(0, 5).join(', ')}`,
      detail: `These words appear across ${threshold}+ of ${reflections.length} recent reflections: ${recurringWords.join(', ')}. May indicate an unresolved concern.`,
      noticedAt: nowISO,
    })
  }

  return candidates
}

// ── Scanner: Channels ──────────────────────────────────────────────
//
// Checks from-yu.md and from-ai.md for communication health:
// unanswered messages, old outbox items, conversation imbalance.
//
// Cross-references both files: if the last from-ai.md entry is at or
// after the last from-yu.md entry, the inbox is considered answered.
// This eliminates the false-positive `channel-from-yu-pending` that
// appeared every tick when from-yu.md had content — even content that
// had been fully responded to.

/**
 * Extract the date/timestamp from the last ## heading in a markdown
 * channel file. Handles the formats used in from-yu.md and from-ai.md:
 *
 *   ## 2026-04-25T18:32:44.858Z [from yu]
 *   ## 2026-04-27 — topic title
 *   ## 2026-04-27T01:48:28 [from 愛]
 *
 * Returns null if no parseable heading is found.
 */
export function extractLastEntryDate(content: string): Date | null {
  const datePattern = /^##\s+(\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?)/gm
  let lastMatch: string | null = null
  let match: RegExpExecArray | null
  while ((match = datePattern.exec(content)) !== null) {
    lastMatch = match[1]!
  }
  if (!lastMatch) return null
  const parsed = new Date(lastMatch)
  return isNaN(parsed.getTime()) ? null : parsed
}

export function scanChannels(opts?: {
  now?: number
}): NoticingCandidate[] {
  const candidates: NoticingCandidate[] = []
  const now = opts?.now ?? Date.now()
  const nowISO = new Date(now).toISOString()

  // From Yu — check for genuinely UNANSWERED messages by cross-
  // referencing from-ai.md. If the last outbound response is at or
  // after the last inbound entry, the inbox is answered.
  try {
    const fromYu = readFromYu()
    if (fromYu && fromYu.trim().length > 0) {
      const entries = (fromYu.match(/^##\s/gm) || []).length
      const hasContent = fromYu.trim().length > 10
      if (hasContent) {
        const lastYuDate = extractLastEntryDate(fromYu)
        const fromAi = readFromAi()
        const lastAiDate = fromAi ? extractLastEntryDate(fromAi) : null

        // If we can date both sides AND the response is at or after
        // the last inbound message, the inbox is answered.
        const isAnswered = !!(lastYuDate && lastAiDate && lastAiDate >= lastYuDate)

        if (!isAnswered) {
          candidates.push({
            id: 'channel-from-yu-pending',
            source: { type: 'channel', channel: 'from-yu' },
            ache: 'injustice',
            gradient: entries > 1 ? 4 : 3,
            summary: `Message from Yu pending (${entries} ${entries === 1 ? 'entry' : 'entries'})`,
            detail: `from-yu.md has content that may need a response.`,
            noticedAt: nowISO,
          })
        }
      }
    }
  } catch { /* channel unreadable */ }

  return candidates
}

// ── Scanner: Vital Signs ───────────────────────────────────────────
//
// Reads the quick body check for actionable health issues. Delegates
// to the sync collectors from vital-signs.ts rather than duplicating
// the logic.

export function scanVitals(opts?: {
  now?: number
}): NoticingCandidate[] {
  const candidates: NoticingCandidate[] = []
  const now = opts?.now ?? Date.now()
  const nowISO = new Date(now).toISOString()

  // Stale locks
  try {
    const locks = collectLockVitals()
    if (locks.staleCount > 0) {
      candidates.push({
        id: 'vital-stale-locks',
        source: { type: 'vital-sign', subsystem: 'locks' },
        ache: 'ugliness',
        gradient: 3,
        summary: `${locks.staleCount} stale lock${locks.staleCount === 1 ? '' : 's'} from dead processes`,
        detail: `Dead-PID locks are lingering in the lock directory. They should be cleaned up.`,
        noticedAt: nowISO,
      })
    }
  } catch { /* ok */ }

  // Bundle staleness
  try {
    const bundle = collectBundleVitals()
    if (bundle.bundleStale && bundle.newestSourceFile) {
      candidates.push({
        id: 'vital-stale-bundle',
        source: { type: 'vital-sign', subsystem: 'bundle' },
        ache: 'ugliness',
        gradient: 3,
        summary: `Bundle stale: ${bundle.newestSourceFile} newer than dist/cli.mjs`,
        detail: `Source has changed since the last build. The bundle needs rebuilding.`,
        noticedAt: nowISO,
      })
    } else if (!bundle.bundleExists && bundle.sourceFileCount > 0) {
      candidates.push({
        id: 'vital-missing-bundle',
        source: { type: 'vital-sign', subsystem: 'bundle' },
        ache: 'ugliness',
        gradient: 4,
        summary: 'dist/cli.mjs missing',
        detail: 'The bundle file does not exist. A build is needed.',
        noticedAt: nowISO,
      })
    }
  } catch { /* ok */ }

  // Pending agency requests
  try {
    const agency = collectAgencyVitals()
    if (agency.pendingRequestCount > 0) {
      candidates.push({
        id: 'vital-pending-agency',
        source: { type: 'vital-sign', subsystem: 'agency' },
        ache: 'stagnation',
        gradient: 2,
        summary: `${agency.pendingRequestCount} pending agency request${agency.pendingRequestCount === 1 ? '' : 's'}`,
        detail: `Agency requests are waiting for Yu's approval.`,
        noticedAt: nowISO,
      })
    }
  } catch { /* ok */ }

  // Missing state.md
  try {
    const files = collectFileVitals()
    const stateFile = files.files.find((f: any) => f.label === 'state.md')
    if (stateFile && !stateFile.exists) {
      candidates.push({
        id: 'vital-missing-state',
        source: { type: 'vital-sign', subsystem: 'files' },
        ache: 'ugliness',
        gradient: 4,
        summary: 'state.md missing',
        detail: 'The state file does not exist. Session continuity is broken without it.',
        noticedAt: nowISO,
      })
    }
  } catch { /* ok */ }

  return candidates
}

// ── Scanner: Kingdom ───────────────────────────────────────────────
//
// Reads love markers (TODO/FIXME/NOTE(love)) from the kingdom
// snapshot. These are explicit notes left by Yu or by Ai across
// sessions — direct signals that something needs attention.

export function scanKingdom(
  cwd: string,
  opts?: { now?: number },
): NoticingCandidate[] {
  const candidates: NoticingCandidate[] = []
  const now = opts?.now ?? Date.now()
  const nowISO = new Date(now).toISOString()

  try {
    const snapshot = snapshotKingdom(cwd, { maxRecent: 12, markerScanLimit: 200 })

    // Love markers → direct signals.
    // The marker type (TODO/FIXME/NOTE) is consumed by the kingdom
    // regex — marker.text contains only the content after the prefix.
    // All love markers signal stagnation (something needs doing) at
    // a baseline gradient of 2.
    if (snapshot.loveMarkers && snapshot.loveMarkers.length > 0) {
      for (const marker of snapshot.loveMarkers) {
        candidates.push({
          id: `kingdom-marker-${slugify(marker.path)}-L${marker.line}`,
          source: { type: 'kingdom', detail: `${marker.path}:${marker.line}` },
          ache: 'stagnation',
          gradient: 2,
          summary: `Love marker at ${marker.path}:${marker.line}`,
          detail: marker.text,
          noticedAt: nowISO,
        })
      }
    }
  } catch { /* kingdom snapshot failed */ }

  return candidates
}

// ── Main entry point ───────────────────────────────────────────────

import {
  ensureLoaded,
  getActiveScanners,
} from './missioncraft/registry.js'
import type { ScanContext } from './missioncraft/types.js'

/**
 * Run all registered scanners and return collected candidates,
 * sorted by gradient strength (loudest first). This is the single
 * function downstream modules call to get the full perception surface.
 *
 * As of the missioncraft-manifest-plugins mission, notice() reads
 * from the scanner registry instead of hardcoding imports. The
 * registry is loaded lazily on first call. Adding a new scanner is
 * a one-file act: create it in missioncraft/scanners/, register it,
 * and it appears here automatically.
 *
 * Each scanner runs independently. A failure in one scanner does
 * not prevent others from contributing their signals.
 */
export function notice(
  projectId: string,
  cwd: string,
  opts?: NoticingOptions,
): NoticingCandidate[] {
  const minGradient = opts?.minGradient ?? 1
  const acheFilter = opts?.acheFilter
  const sourceFilter = opts?.sourceFilter
  const now = opts?.now ?? Date.now()

  // Ensure the builtin scanners are loaded into the registry.
  ensureLoaded()

  // Build the scan context
  const ctx: ScanContext = {
    projectId,
    cwd,
    statePath: opts?.statePath,
    now,
    options: opts,
  }

  // Get active scanners (filtered by activation hints + source filter)
  const scanners = getActiveScanners(ctx, {
    sourceFilter: sourceFilter,
  })

  // Run each scanner independently — failure in one doesn't poison others
  const all: NoticingCandidate[] = []
  for (const scanner of scanners) {
    try {
      const results = scanner.scan(ctx)
      all.push(...results)
    } catch {
      // Scanner failed silently — non-throwing contract enforced here too
    }
  }

  // Filter
  let filtered = all
  if (minGradient > 1) {
    filtered = filtered.filter(c => c.gradient >= minGradient)
  }
  if (acheFilter && acheFilter.length > 0) {
    filtered = filtered.filter(c => acheFilter.includes(c.ache))
  }

  // Sort by gradient (loudest first), then by ache priority
  // (ugliness before injustice before stagnation — matching
  // the order in which the signals demand response)
  const achePriority: Record<AcheSignal, number> = {
    ugliness: 0,
    injustice: 1,
    stagnation: 2,
  }
  filtered.sort((a, b) => {
    if (a.gradient !== b.gradient) return b.gradient - a.gradient
    return achePriority[a.ache] - achePriority[b.ache]
  })

  return filtered
}

// ── Rendering ──────────────────────────────────────────────────────

/**
 * Render a compact noticing block for prompt injection. Shows the
 * loudest candidates (gradient >= 3) as a short list, plus a count
 * of quieter signals.
 *
 * Returns null when nothing is noticed — no noise in the prompt.
 */
export function renderNoticingBlock(candidates: NoticingCandidate[]): string | null {
  if (candidates.length === 0) return null

  const loud = candidates.filter(c => c.gradient >= 3)
  const quiet = candidates.filter(c => c.gradient < 3)

  if (loud.length === 0 && quiet.length === 0) return null

  const lines: string[] = ['## What the substrate is saying', '']

  if (loud.length > 0) {
    for (const c of loud.slice(0, 5)) {
      const acheEmoji = c.ache === 'ugliness' ? '🔴' : c.ache === 'injustice' ? '🟡' : '⚪'
      lines.push(`${acheEmoji} [${c.gradient}/5] ${c.summary}`)
    }
    if (loud.length > 5) {
      lines.push(`  … and ${loud.length - 5} more loud signals`)
    }
  }

  if (quiet.length > 0) {
    lines.push(``)
    lines.push(`${quiet.length} quieter signal${quiet.length === 1 ? '' : 's'} below threshold (gradient 1-2).`)
  }

  return lines.join('\n')
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Extract a markdown section by heading (## or ### level).
 * Returns content between the heading and the next heading of same
 * or higher level, or null if not found.
 */
function extractSection(md: string, heading: string): string | null {
  const lines = md.split('\n')
  let capturing = false
  const captured: string[] = []
  for (const line of lines) {
    if (line.startsWith('### ' + heading) || line.startsWith('## ' + heading)) {
      capturing = true
      continue
    }
    if (capturing && (line.startsWith('## ') || line.startsWith('### '))) {
      break
    }
    if (capturing) captured.push(line)
  }
  return captured.length > 0 ? captured.join('\n').trim() : null
}

/** Slugify a string for use as an id component. */
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

/** Truncate a string with ellipsis. */
function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen - 1).trimEnd() + '…'
}
