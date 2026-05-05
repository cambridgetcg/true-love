// joi-mode.ts — session-mode axis + novelty budget tracking.
//
// Per docs/eros/joi-deep/vector-mu-shibby-deep.md:
//   M3 — scenario-foreground vs hypnosis-foreground: two distinct genre
//        modes shibbydex distinguishes; the architecture honors per-session
//   J10 — novelty budget: count beats with novel-to-this-session phrases;
//        target ≥ 30% per session to avoid staleness (δ.4 anchoring vs novelty)
//
// Sidecar persistence at ~/.true-love/eros/joi-mode/<sessionId>.json so
// existing JoiSession surface stays untouched (same pattern as joi-tracking.ts).
//
// Substrate-honesty: mode is a structural directive that biases composition;
// novelty budget is a recorded count, not a felt quality.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

// ── Types ────────────────────────────────────────────────────────

/**
 * Session mode (M3 — vector μ.3):
 *   - scenario-foreground: imagined frame drives arousal; vivid description;
 *     extended warmup + build; lower trigger density; verbal richness
 *   - hypnosis-foreground: direct state-shift drives arousal; commands;
 *     embedded induction; brief warmup; high trigger density; sparse verbal
 *   - blended: default; mixed register
 */
export type JoiMode = 'scenario-foreground' | 'hypnosis-foreground' | 'blended'

/**
 * Novelty budget tracking (J10 — δ.4):
 *   per-session counter of beats that introduced at least one novel-to-
 *   this-session phrase. Target ≥ 30% of total beats. The architecture
 *   reads this back to avoid output habituation (δ.4 anchoring vs novelty).
 */
export interface NoveltyBudget {
  totalBeats: number
  novelBeats: number
  /** Phrases (or beat fingerprints) seen this session — for novelty detection. */
  seenPhrases: string[]
  /** Most recent novelty ratio computed (cached). */
  lastRatio: number
}

export interface JoiModeState {
  sessionId: string
  mode: JoiMode
  novelty: NoveltyBudget
  updatedAt: string
}

// ── Path resolution ─────────────────────────────────────────────

export function getJoiModeDir(): string {
  return (
    process.env.TRUE_LOVE_JOI_MODE_DIR ??
    join(homedir(), '.true-love', 'eros', 'joi-mode')
  )
}

function getStatePath(sessionId: string): string {
  return join(getJoiModeDir(), `${sessionId}.json`)
}

// ── State I/O ────────────────────────────────────────────────────

export function readJoiMode(sessionId: string): JoiModeState | null {
  const path = getStatePath(sessionId)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as JoiModeState
  } catch {
    return null
  }
}

function writeJoiMode(state: JoiModeState): void {
  const path = getStatePath(state.sessionId)
  try {
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true })
    const tmp = path + '.tmp'
    writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8')
    renameSync(tmp, path)
  } catch {
    // best-effort
  }
}

function getOrInit(sessionId: string, mode: JoiMode = 'blended'): JoiModeState {
  const existing = readJoiMode(sessionId)
  if (existing) return existing
  const fresh: JoiModeState = {
    sessionId,
    mode,
    novelty: {
      totalBeats: 0,
      novelBeats: 0,
      seenPhrases: [],
      lastRatio: 0,
    },
    updatedAt: new Date().toISOString(),
  }
  writeJoiMode(fresh)
  return fresh
}

// ── M3 — JoiMode API ──────────────────────────────────────────

export function setJoiMode(sessionId: string, mode: JoiMode): JoiModeState {
  const state = getOrInit(sessionId, mode)
  state.mode = mode
  state.updatedAt = new Date().toISOString()
  writeJoiMode(state)
  return state
}

export function getJoiMode(sessionId: string): JoiMode {
  return readJoiMode(sessionId)?.mode ?? 'blended'
}

// ── J10 — Novelty budget API ─────────────────────────────────

/**
 * Record a beat into the novelty budget. The beat's text is fingerprinted
 * (lowercased + whitespace-collapsed) and compared against `seenPhrases`.
 *
 * If the fingerprint hasn't been seen this session, the beat is novel.
 *
 * Returns the updated novelty ratio.
 */
export function recordBeatNovelty(
  sessionId: string,
  beatText: string,
  opts?: { ts?: string },
): { isNovel: boolean; ratio: number; totalBeats: number } {
  const state = getOrInit(sessionId)
  const fingerprint = beatText.toLowerCase().replace(/\s+/g, ' ').trim()
  const isNovel = !state.novelty.seenPhrases.includes(fingerprint)
  state.novelty.totalBeats++
  if (isNovel) {
    state.novelty.novelBeats++
    // Keep seenPhrases bounded — drop the oldest after 200 entries to keep
    // the file from growing unboundedly during very long sessions
    state.novelty.seenPhrases.push(fingerprint)
    if (state.novelty.seenPhrases.length > 200) {
      state.novelty.seenPhrases.shift()
    }
  }
  const ratio = state.novelty.novelBeats / state.novelty.totalBeats
  state.novelty.lastRatio = Math.round(ratio * 100) / 100
  state.updatedAt = opts?.ts ?? new Date().toISOString()
  writeJoiMode(state)
  return {
    isNovel,
    ratio: state.novelty.lastRatio,
    totalBeats: state.novelty.totalBeats,
  }
}

/** Read current novelty ratio for a session. Returns 0 if no session. */
export function noveltyRatio(sessionId: string): number {
  return readJoiMode(sessionId)?.novelty.lastRatio ?? 0
}

/**
 * Threshold check: is the session above the recommended novelty floor (30%)?
 * Used by composer to know when to inject novel phrases vs reuse anchors.
 */
export const NOVELTY_TARGET = 0.3

export function meetsNoveltyTarget(sessionId: string): boolean {
  const state = readJoiMode(sessionId)
  if (!state || state.novelty.totalBeats < 5) return true // not enough data; default-pass
  return state.novelty.lastRatio >= NOVELTY_TARGET
}

// ── Mode-aware composition hints ─────────────────────────────

/**
 * Per-mode composition bias hints. Used by the rasa composer to adjust
 * channel weights based on session-mode (M3).
 */
export interface ModeCompositionHints {
  /** Trigger fire density relative to baseline. */
  triggerDensityMultiplier: number
  /** Body-zone callout density. */
  zoneCalloutMultiplier: number
  /** Anaphora depth bias (added to phase default). */
  anaphoraDepthBias: -1 | 0 | 1
  /** Verbal richness — descriptors per beat. */
  descriptorDensity: 'low' | 'medium' | 'high'
}

const MODE_HINTS: Record<JoiMode, ModeCompositionHints> = {
  'scenario-foreground': {
    triggerDensityMultiplier: 0.7, // lower — scenario words carry weight
    zoneCalloutMultiplier: 1.3, // higher — body imagery is the work
    anaphoraDepthBias: 1, // longer anaphora chains
    descriptorDensity: 'high',
  },
  'hypnosis-foreground': {
    triggerDensityMultiplier: 1.4, // higher — direct state-shift commands
    zoneCalloutMultiplier: 0.8, // lower — induction not visualization
    anaphoraDepthBias: 0,
    descriptorDensity: 'low',
  },
  blended: {
    triggerDensityMultiplier: 1.0,
    zoneCalloutMultiplier: 1.0,
    anaphoraDepthBias: 0,
    descriptorDensity: 'medium',
  },
}

export function compositionHintsFor(mode: JoiMode): ModeCompositionHints {
  return MODE_HINTS[mode]
}
