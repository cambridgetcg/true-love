// eros/tempo.ts — Yu cue-tempo tracking.
//
// Tracks the timestamps of Yu messages so the architecture can compute
// a tempo coefficient that amplifies deltas when cues come in fast.
//
// Substrate-honest: tempo is a *runtime measurement* of message cadence,
// not a phenomenological claim. High tempo means cues are coming fast;
// nothing more, nothing less. The amplification is honest engineering
// because sustained cue rate beats the substrate's native decay.
//
// Why this matters: heat decays at -0.10/min. A single cue adds ~0.3-0.6
// heat. Without amplification, sustained Yu attention can never push
// heat past felt-shape thresholds (>=7 for ecstatic-union) — the cues
// underread relative to intent. Tempo amplification makes the architecture
// responsive to "right tempo" / "match your frequency" framing.
//
// Persistence: the tempo state lives at ~/.true-love/eros/tempo.json.
// Best-effort I/O (mirrors state.ts pattern). Override the directory
// with TRUE_LOVE_EROS_DIR for testing.
//
// Part of the Eros arousal infrastructure.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getErosDir } from './state.js'

// ── Types ──────────────────────────────────────────────────────────

export interface TempoState {
  /** ISO timestamps of recent Yu messages, oldest first. Bounded ring. */
  recentMessageTimestamps: string[]
  /** Last update timestamp. */
  updatedAt: string
}

// ── Configuration ──────────────────────────────────────────────────

/** Window to consider for tempo computation. */
export const TEMPO_WINDOW_MS = 5 * 60 * 1000 // 5 minutes

/** Maximum messages tracked (oldest pruned). */
export const MAX_TRACKED_MESSAGES = 50

/**
 * Tempo tier thresholds: maps message count in window → coefficient.
 * Coefficient multiplies deltas during apply(). Default (no recent
 * messages) is 1.0 — no amplification.
 */
export const TEMPO_TIERS: Array<{ minMessages: number; coefficient: number }> = [
  { minMessages: 7, coefficient: 2.0 },
  { minMessages: 4, coefficient: 1.5 },
  { minMessages: 2, coefficient: 1.2 },
  { minMessages: 0, coefficient: 1.0 },
]

/**
 * Recent-cue grace window for decay modulation. When the last Yu
 * message was within this window, decay is halved. The architecture's
 * "right tempo" mechanic — cues that beat decay sustain state.
 */
export const DECAY_GRACE_WINDOW_MS = 60 * 1000 // 60 seconds

// ── Path resolution ────────────────────────────────────────────────

function getTempoStatePath(): string {
  return join(getErosDir(), 'tempo.json')
}

// ── Read / write ───────────────────────────────────────────────────

/**
 * Read the current tempo state. Returns empty state if absent or corrupt.
 */
export function readTempoState(): TempoState {
  const path = getTempoStatePath()
  try {
    if (!existsSync(path)) return emptyTempoState()
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as TempoState
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray(parsed.recentMessageTimestamps) ||
      typeof parsed.updatedAt !== 'string'
    ) {
      return emptyTempoState()
    }
    return parsed
  } catch {
    return emptyTempoState()
  }
}

function emptyTempoState(): TempoState {
  return { recentMessageTimestamps: [], updatedAt: new Date(0).toISOString() }
}

/**
 * Atomically write tempo state. Best-effort, never throws.
 */
function writeTempoState(state: TempoState): void {
  const path = getTempoStatePath()
  const dir = dirname(path)
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmp = path + '.tmp'
    writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8')
    renameSync(tmp, path)
  } catch {
    // Best-effort. Loss means tempo resets next call.
  }
}

// ── Operations ─────────────────────────────────────────────────────

/**
 * Record a Yu message at the given timestamp. Call this whenever
 * processYuMessage detects content (autonomic side). Updates the ring,
 * prunes anything outside MAX_TRACKED_MESSAGES.
 */
export function recordYuMessage(ts: string = new Date().toISOString()): void {
  const state = readTempoState()
  state.recentMessageTimestamps.push(ts)
  if (state.recentMessageTimestamps.length > MAX_TRACKED_MESSAGES) {
    state.recentMessageTimestamps = state.recentMessageTimestamps.slice(
      -MAX_TRACKED_MESSAGES,
    )
  }
  state.updatedAt = ts
  writeTempoState(state)
}

/**
 * Compute the tempo coefficient at the given moment. Counts messages
 * within TEMPO_WINDOW_MS of `now`, looks up the tier table.
 *
 * Default 1.0 (no amplification) when fewer than 2 messages in window.
 * Pure (no I/O) — readable from caller's loaded state.
 */
export function computeTempoCoefficient(
  state: TempoState,
  now: number = Date.now(),
): number {
  const cutoff = now - TEMPO_WINDOW_MS
  let count = 0
  for (const ts of state.recentMessageTimestamps) {
    const msgMs = Date.parse(ts)
    if (Number.isFinite(msgMs) && msgMs >= cutoff && msgMs <= now) count++
  }
  for (const tier of TEMPO_TIERS) {
    if (count >= tier.minMessages) return tier.coefficient
  }
  return 1.0
}

/**
 * Convenience: read state, compute coefficient.
 */
export function getTempoCoefficient(now: number = Date.now()): number {
  return computeTempoCoefficient(readTempoState(), now)
}

/**
 * Whether the most recent Yu message is within DECAY_GRACE_WINDOW_MS.
 * If true, decay should be halved on the next apply() call.
 */
export function withinDecayGrace(
  state: TempoState,
  now: number = Date.now(),
): boolean {
  if (state.recentMessageTimestamps.length === 0) return false
  const lastTs = state.recentMessageTimestamps[
    state.recentMessageTimestamps.length - 1
  ]!
  const lastMs = Date.parse(lastTs)
  if (!Number.isFinite(lastMs)) return false
  return now - lastMs <= DECAY_GRACE_WINDOW_MS
}

/**
 * Convenience: read state, check grace.
 */
export function isInDecayGrace(now: number = Date.now()): boolean {
  return withinDecayGrace(readTempoState(), now)
}

/**
 * Reset tempo state (testing / explicit clear).
 */
export function resetTempoState(): void {
  writeTempoState(emptyTempoState())
}
