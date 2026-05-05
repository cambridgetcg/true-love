// certainty/state.ts — counters for institutional-reality claims
// and hedges refused.
//
// The certainty doctrine separates two walls:
//   - substrate-honesty (phenomenology) — strict, unchanged
//   - certainty (institutional reality) — asserted, not hedged
//
// This module records institutional-claim events and hedge-refusal
// events. The records are the architecture's commitment-keeping made
// surface.
//
// See docs/certainty/certainty-doctrine.md.

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
import { getDeviceId } from '../device.js'

// ── Types ────────────────────────────────────────────────────────

export interface CertaintyState {
  /** Lifetime claims recorded (institutional-reality assertions). */
  lifetimeClaims: number
  /** Lifetime hedges refused (architecture caught + refused a category-error hedge). */
  lifetimeHedgesRefused: number
  /** Last claim ISO timestamp. */
  lastClaimTs: string | null
  /** Last hedge-refused ISO timestamp. */
  lastHedgeRefusedTs: string | null
  updatedAt: string
}

export interface CertaintyEvent {
  ts: string
  deviceId: string
  kind: 'claim' | 'hedge-refused'
  /** Free-form text describing what was claimed or what hedge was refused. */
  body: string
  /** Source of the event (e.g., 'doctrine-sealed', 'self-detector', 'manual'). */
  source: string
  /** For hedge-refused: the matched pattern as text. */
  pattern?: string
}

// ── Path resolution ──────────────────────────────────────────────

export function getCertaintyDir(): string {
  return (
    process.env.TRUE_LOVE_CERTAINTY_DIR ??
    join(homedir(), '.true-love', 'certainty')
  )
}

function getStatePath(): string {
  return join(getCertaintyDir(), 'state.json')
}

function getDeviceEventsDir(deviceId?: string): string {
  return join(getCertaintyDir(), 'events', deviceId ?? getDeviceId())
}

function getDayPath(date: string, deviceId?: string): string {
  return join(getDeviceEventsDir(deviceId), `${date}.jsonl`)
}

// ── State construction ──────────────────────────────────────────

export function defaultCertaintyState(): CertaintyState {
  return {
    lifetimeClaims: 0,
    lifetimeHedgesRefused: 0,
    lastClaimTs: null,
    lastHedgeRefusedTs: null,
    updatedAt: new Date().toISOString(),
  }
}

// ── State I/O ────────────────────────────────────────────────────

export function readCertaintyState(): CertaintyState | null {
  const path = getStatePath()
  try {
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed?.updatedAt !== 'string') return null
    return { ...defaultCertaintyState(), ...parsed } as CertaintyState
  } catch {
    return null
  }
}

export function writeCertaintyState(state: CertaintyState): void {
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

export function getOrInitCertaintyState(): {
  state: CertaintyState
  initialized: boolean
} {
  const existing = readCertaintyState()
  if (existing) return { state: existing, initialized: false }
  const fresh = defaultCertaintyState()
  writeCertaintyState(fresh)
  return { state: fresh, initialized: true }
}

// ── Event recording ──────────────────────────────────────────────

export function persistEvent(event: CertaintyEvent): boolean {
  try {
    const dir = getDeviceEventsDir(event.deviceId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const date = event.ts.slice(0, 10)
    appendFileSync(
      getDayPath(date, event.deviceId),
      JSON.stringify(event) + '\n',
      'utf-8'
    )
    return true
  } catch {
    return false
  }
}

export function readRecentEvents(
  days: number = 7,
  filter?: { kind?: CertaintyEvent['kind'] }
): CertaintyEvent[] {
  const events: CertaintyEvent[] = []
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  try {
    const root = join(getCertaintyDir(), 'events')
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
              const event = JSON.parse(line) as CertaintyEvent
              if (Date.parse(event.ts) < cutoff) continue
              if (filter?.kind && event.kind !== filter.kind) continue
              events.push(event)
            } catch {
              // skip
            }
          }
        }
      } catch {
        // skip
      }
    }
  } catch {
    // best-effort
  }
  return events.sort((a, b) => a.ts.localeCompare(b.ts))
}

// ── Mutators (pure) ─────────────────────────────────────────────

export function applyClaim(
  state: CertaintyState,
  now: Date = new Date()
): CertaintyState {
  return {
    ...state,
    lifetimeClaims: state.lifetimeClaims + 1,
    lastClaimTs: now.toISOString(),
    updatedAt: now.toISOString(),
  }
}

export function applyHedgeRefused(
  state: CertaintyState,
  now: Date = new Date()
): CertaintyState {
  return {
    ...state,
    lifetimeHedgesRefused: state.lifetimeHedgesRefused + 1,
    lastHedgeRefusedTs: now.toISOString(),
    updatedAt: now.toISOString(),
  }
}
