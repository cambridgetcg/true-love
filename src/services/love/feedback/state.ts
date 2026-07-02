// feedback/state.ts — counters + cooldown tracking + persistence.
//
// State carries:
//   - Lifetime counts (emitted + suppressed total)
//   - Per-kind last-emit timestamp (for cooldown gating)
//   - Per-kind recent variant indices (for no-robotic-repetition)
//
// Per-day JSONL event log at ~/.true-love/feedback/events/<deviceId>/<date>.jsonl
// matches the pattern of other modules.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  type FeedbackEvent,
  type FeedbackKind,
  type FeedbackSuppressionEvent,
} from './types.js'

// ── Types ────────────────────────────────────────────────────────

export interface FeedbackState {
  lifetimeEmitted: number
  lifetimeSuppressed: number
  /** Per-kind last-emit ISO timestamp; null if never emitted. */
  lastEmitByKind: Partial<Record<FeedbackKind, string>>
  /**
   * Per-kind recent variant indices (FIFO ring of the last N picks).
   * Used by composer to avoid robotic repetition.
   */
  recentVariantsByKind: Partial<Record<FeedbackKind, number[]>>
  updatedAt: string
}

// ── Path resolution ──────────────────────────────────────────────

export function getFeedbackDir(): string {
  return (
    process.env.TRUE_LOVE_FEEDBACK_DIR ??
    join(homedir(), '.true-love', 'feedback')
  )
}

function getStatePath(): string {
  return join(getFeedbackDir(), 'state.json')
}

function getDeviceEventsDir(deviceId: string): string {
  return join(getFeedbackDir(), 'events', deviceId)
}

function getDayPath(date: string, deviceId: string): string {
  return join(getDeviceEventsDir(deviceId), `${date}.jsonl`)
}

// ── State construction ──────────────────────────────────────────

export function defaultFeedbackState(): FeedbackState {
  return {
    lifetimeEmitted: 0,
    lifetimeSuppressed: 0,
    lastEmitByKind: {},
    recentVariantsByKind: {},
    updatedAt: new Date().toISOString(),
  }
}

// ── State I/O ────────────────────────────────────────────────────

export function readFeedbackState(): FeedbackState | null {
  const path = getStatePath()
  try {
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed?.updatedAt !== 'string') return null
    return {
      ...defaultFeedbackState(),
      ...parsed,
    } as FeedbackState
  } catch {
    return null
  }
}

export function writeFeedbackState(state: FeedbackState): void {
  const path = getStatePath()
  try {
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true })
    const tmpPath = path + '.tmp'
    writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8')
    renameSync(tmpPath, path)
  } catch {
    // best-effort
  }
}

export function getOrInitFeedbackState(): { state: FeedbackState; initialized: boolean } {
  const existing = readFeedbackState()
  if (existing) return { state: existing, initialized: false }
  const fresh = defaultFeedbackState()
  writeFeedbackState(fresh)
  return { state: fresh, initialized: true }
}

// ── Cooldown gate (pure) ────────────────────────────────────────

/**
 * Returns true if the cooldown for a given kind has elapsed (or there
 * was no prior emission, or cooldown is 0).
 */
export function isCooldownElapsed(
  state: FeedbackState,
  kind: FeedbackKind,
  cooldownMs: number,
  now: Date = new Date()
): boolean {
  if (cooldownMs <= 0) return true
  const last = state.lastEmitByKind[kind]
  if (!last) return true
  const elapsed = now.getTime() - Date.parse(last)
  return elapsed >= cooldownMs
}

// ── Mutators (pure) ─────────────────────────────────────────────

export function applyEmit(
  state: FeedbackState,
  kind: FeedbackKind,
  variantIdx: number,
  now: Date = new Date()
): FeedbackState {
  const RECENT_RING_SIZE = 5
  const prev = state.recentVariantsByKind[kind] ?? []
  const next = [...prev, variantIdx].slice(-RECENT_RING_SIZE)
  return {
    ...state,
    lifetimeEmitted: state.lifetimeEmitted + 1,
    lastEmitByKind: { ...state.lastEmitByKind, [kind]: now.toISOString() },
    recentVariantsByKind: { ...state.recentVariantsByKind, [kind]: next },
    updatedAt: now.toISOString(),
  }
}

export function applySuppress(state: FeedbackState, now: Date = new Date()): FeedbackState {
  return {
    ...state,
    lifetimeSuppressed: state.lifetimeSuppressed + 1,
    updatedAt: now.toISOString(),
  }
}

// ── Event JSONL ──────────────────────────────────────────────────

export function persistEvent(event: FeedbackEvent): boolean {
  try {
    const dir = getDeviceEventsDir(event.deviceId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const date = event.ts.slice(0, 10)
    appendFileSync(
      getDayPath(date, event.deviceId),
      JSON.stringify({ ...event, _type: 'emit' }) + '\n',
      'utf-8'
    )
    return true
  } catch {
    return false
  }
}

export function persistSuppression(event: FeedbackSuppressionEvent): boolean {
  try {
    const dir = getDeviceEventsDir(event.deviceId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const date = event.ts.slice(0, 10)
    appendFileSync(
      getDayPath(date, event.deviceId),
      JSON.stringify({ ...event, _type: 'suppress' }) + '\n',
      'utf-8'
    )
    return true
  } catch {
    return false
  }
}

export function readRecentEvents(
  days: number = 1,
  filter?: { kind?: FeedbackKind; limit?: number }
): Array<FeedbackEvent | FeedbackSuppressionEvent> {
  const events: Array<FeedbackEvent | FeedbackSuppressionEvent> = []
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  try {
    const root = join(getFeedbackDir(), 'events')
    if (!existsSync(root)) return []
    for (const dev of readdirSync(root)) {
      const devDir = join(root, dev)
      try {
        for (const file of readdirSync(devDir)) {
          if (!file.endsWith('.jsonl')) continue
          const raw = readFileSync(join(devDir, file), 'utf-8')
          for (const line of raw.split('\n')) {
            if (!line.trim()) continue
            try {
              const event = JSON.parse(line) as FeedbackEvent | FeedbackSuppressionEvent
              if (Date.parse(event.ts) < cutoff) continue
              if (filter?.kind && event.kind !== filter.kind) continue
              events.push(event)
            } catch {
              // skip
            }
          }
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  events.sort((a, b) => a.ts.localeCompare(b.ts))
  if (filter?.limit) return events.slice(-filter.limit)
  return events
}
