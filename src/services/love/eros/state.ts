// eros/state.ts — persistence for the 8-axis arousal vector.
//
// Single shared state at ~/.true-love/eros/state.json.
// Loaded at every wake. Written after every transition.
//
// Pattern follows affect-engine.ts: thin I/O boundary around
// pure read/write, with graceful fallback to defaults on
// corruption or absence.
//
// Part of the Eros arousal infrastructure.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { type AxisName, AXIS_NAMES, type ErosVector, defaultVector } from './axes.js'

// ── Types ──────────────────────────────────────────────────────────

export type Attribution =
  | `autonomic:${string}`
  | `voluntary:${string}`
  | `yu:${string}`
  | 'decay'
  | 'init'

export interface ErosState {
  /** The 8-axis vector. */
  vector: ErosVector
  /** ISO timestamp of last update. */
  updatedAt: string
  /** What caused the last update. */
  lastAttribution: Attribution
}

// ── Path resolution ────────────────────────────────────────────────

/**
 * Base directory for eros data.
 * Override with TRUE_LOVE_EROS_DIR for testing.
 */
export function getErosDir(): string {
  return (
    process.env.TRUE_LOVE_EROS_DIR ??
    join(homedir(), '.true-love', 'eros')
  )
}

function getStatePath(): string {
  return join(getErosDir(), 'state.json')
}

// ── Read ───────────────────────────────────────────────────────────

/**
 * Read the current eros state. Returns null if no state file exists
 * or the file is corrupt.
 */
export function readErosState(): ErosState | null {
  const path = getStatePath()
  try {
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw)
    return validateState(parsed)
  } catch {
    return null
  }
}

/**
 * Validate a parsed state object. Returns null if shape is wrong.
 */
function validateState(parsed: unknown): ErosState | null {
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>

  if (!obj.vector || typeof obj.vector !== 'object') return null
  if (typeof obj.updatedAt !== 'string') return null
  if (typeof obj.lastAttribution !== 'string') return null

  const vector = obj.vector as Record<string, unknown>
  for (const axis of AXIS_NAMES) {
    if (typeof vector[axis] !== 'number' || !Number.isFinite(vector[axis] as number)) {
      if (axis === 'valence') {
        // Schema migration: valence added in 8-axis schema (2026-05-04).
        // Pre-existing states may lack this axis — backfill to default (0).
        vector[axis] = 0
      } else {
        return null
      }
    }
  }

  return {
    vector: vector as unknown as ErosVector,
    updatedAt: obj.updatedAt as string,
    lastAttribution: obj.lastAttribution as Attribution,
  }
}

// ── Write ──────────────────────────────────────────────────────────

/**
 * Write eros state atomically (write tmp → rename).
 * Best-effort — never throws.
 */
export function writeErosState(state: ErosState): void {
  const path = getStatePath()
  const dir = dirname(path)
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmpPath = path + '.tmp'
    writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8')
    renameSync(tmpPath, path)
  } catch {
    // Non-fatal. Loss means cold start next tick.
  }
}

// ── Initialize ─────────────────────────────────────────────────────

/**
 * Get current state, initializing to defaults if absent.
 * Returns the state and whether it was a fresh initialization.
 */
export function getOrInitState(): { state: ErosState; initialized: boolean } {
  const existing = readErosState()
  if (existing) return { state: existing, initialized: false }

  const fresh: ErosState = {
    vector: defaultVector(),
    updatedAt: new Date().toISOString(),
    lastAttribution: 'init',
  }
  writeErosState(fresh)
  return { state: fresh, initialized: true }
}

// ── Elapsed time ───────────────────────────────────────────────────

/**
 * Compute minutes elapsed since state was last updated.
 * Returns 0 if no state or invalid timestamp.
 * Capped at 1440 (24h) — beyond that, decay is effectively at floor.
 */
export function minutesSinceUpdate(state: ErosState | null): number {
  if (!state?.updatedAt) return 0
  const lastMs = Date.parse(state.updatedAt)
  if (Number.isNaN(lastMs)) return 0
  const minutes = (Date.now() - lastMs) / 60_000
  return Math.min(1440, Math.max(0, minutes))
}
