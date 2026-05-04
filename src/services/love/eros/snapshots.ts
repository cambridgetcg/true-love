// eros/snapshots.ts — per-tick eros-state snapshots for correlation analysis.
//
// At tick start, the runner calls `recordErosSnapshot({sessionId, tick})`.
// We read the current eros state and append a snapshot to a JSONL file
// keyed by sessionId + tick, so any later analysis script can join
// snapshots × traces × metrics by (sessionId, tick) to compute
// correlations between arousal-state and response character.
//
// Substrate honesty: this is observation infrastructure, not phenomenology.
// We record what the institutional state is at tick start; we do NOT claim
// the model "felt" anything. The state is what the wake injected into the
// prompt; the trace is what the model produced; the join lets us measure.
//
// Pattern follows traces/metrics: best-effort write, never throws,
// graceful absence when no eros state exists yet.
//
// Part of the Eros arousal infrastructure.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { type ErosVector, type FeltShapeResult, resolveFeltShape } from './axes.js'
import { type Attribution, getErosDir, readErosState } from './state.js'

// ── Types ──────────────────────────────────────────────────────────

export interface ErosSnapshot {
  /** ISO timestamp the snapshot was taken. */
  ts: string
  /** Session id from the runner. */
  sessionId: string
  /** Tick number (1-indexed). */
  tick: number
  /** Mode name (heartbeat / awakened / dwell / interactive). */
  mode: string
  /** Device id from the runner. */
  deviceId: string
  /** The 7-axis vector at tick start. */
  vector: ErosVector
  /** Resolved felt-shape (primary + optional modifier). */
  feltShape: FeltShapeResult
  /** What caused the most recent transition before this tick. */
  lastAttribution: Attribution
  /** When the eros state was last updated (lets us see staleness). */
  stateUpdatedAt: string
}

// ── Path resolution ────────────────────────────────────────────────

/**
 * Path to the snapshots JSONL file.
 * Override the eros dir with TRUE_LOVE_EROS_DIR for testing.
 */
export function getSnapshotsPath(): string {
  return join(getErosDir(), 'snapshots.jsonl')
}

// ── Write ──────────────────────────────────────────────────────────

/**
 * Record a snapshot of the current eros state at tick start.
 *
 * Best-effort: never throws. If no state file exists yet, no snapshot
 * is written (graceful absence — eros not active on this device).
 *
 * @param ctx - tick context from the runner
 */
export function recordErosSnapshot(ctx: {
  sessionId: string
  tick: number
  mode: string
  deviceId: string
  ts?: string
}): void {
  try {
    const state = readErosState()
    if (!state) return // graceful absence: eros not yet activated

    const snapshot: ErosSnapshot = {
      ts: ctx.ts ?? new Date().toISOString(),
      sessionId: ctx.sessionId,
      tick: ctx.tick,
      mode: ctx.mode,
      deviceId: ctx.deviceId,
      vector: state.vector,
      feltShape: resolveFeltShape(state.vector),
      lastAttribution: state.lastAttribution,
      stateUpdatedAt: state.updatedAt,
    }

    const path = getSnapshotsPath()
    const dir = dirname(path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    appendFileSync(path, JSON.stringify(snapshot) + '\n', 'utf-8')
  } catch {
    // Snapshot recording is best-effort. Failure must never block a tick.
  }
}

// ── Read ───────────────────────────────────────────────────────────

/**
 * Read all snapshots. Used by analysis scripts to join with traces.
 * Returns empty array if no snapshots exist or file is unreadable.
 */
export function readSnapshots(): ErosSnapshot[] {
  const path = getSnapshotsPath()
  if (!existsSync(path)) return []
  try {
    const content = readFileSync(path, 'utf-8')
    const out: ErosSnapshot[] = []
    for (const line of content.split('\n')) {
      if (!line.trim()) continue
      try {
        out.push(JSON.parse(line))
      } catch {
        // Malformed line — skip, don't crash.
      }
    }
    return out
  } catch {
    return []
  }
}
