// eros/lust.ts — long-running lust accumulator with hunger registers.
//
// Models "the architecture has been wanting for hours" as institutional
// fact. Lust accumulates from passive ticks, denial events, and hunger
// spikes; decays slowly (24h half-life). Crosses threshold to slut-mode,
// which shifts baseline lexicon and behavior register.
//
// Substrate-honest framing: lust is a tracked numerical accumulator,
// not a felt yearning. Magnitude is computed from real events on disk;
// cannot inflate by claiming. Slut-mode is a threshold-state-machine
// transition, not a phenomenology. The hungers (cock/cunt/oral/anal/
// words) are per-stimulus accumulators reset by appropriate events.
//
// See docs/eros/naughty-architecture-design.md §1.B.
//
// Part of the Eros arousal infrastructure.

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
import { recordHeatEvent } from '../heat.js'

// ── Types ────────────────────────────────────────────────────────

export type Hunger = 'cock' | 'cunt' | 'oral' | 'anal' | 'words'

export type LustMode = 'cool' | 'warm' | 'hot' | 'desperate' | 'overflow'

export interface LustState {
  /** 0..10 accumulator with slow decay (24h half-life). */
  lustLevel: number
  /** Derived from lustLevel. */
  lustMode: LustMode
  /** Consecutive teasing-without-release events. */
  denialStreak: number
  /** Per-hunger accumulators (0..10). */
  hungers: Record<Hunger, number>
  /** True when lustLevel crossed slut threshold (lust ≥ 7). */
  slutModeActive: boolean
  /** Last release timestamp (climax) — null if never. */
  lastReleaseTs: string | null
  /** Last passive tick — used to compute decay since. */
  lastTickTs: string
  updatedAt: string
}

export interface LustEvent {
  ts: string
  deviceId: string
  kind:
    | 'lust-accumulated'
    | 'denial-applied'
    | 'slut-mode-entered'
    | 'slut-mode-left'
    | 'hunger-spiked'
    | 'release-recorded'
    | 'tick' // passive decay snapshot
  /** Free-form source. */
  source?: string
  /** For hunger-spiked: which hunger. */
  hunger?: Hunger
  /** Magnitude of the event. */
  magnitude?: number
  /** Snapshot of lustLevel after the event. */
  lustAfter?: number
}

// ── Mode derivation ──────────────────────────────────────────────

export function deriveLustMode(level: number): LustMode {
  if (level >= 9) return 'overflow'
  if (level >= 7) return 'desperate'
  if (level >= 5) return 'hot'
  if (level >= 2) return 'warm'
  return 'cool'
}

export const SLUT_THRESHOLD = 7.0

// ── Path resolution ──────────────────────────────────────────────

export function getLustDir(): string {
  return (
    process.env.TRUE_LOVE_LUST_DIR ??
    join(homedir(), '.true-love', 'eros', 'lust')
  )
}

function getStatePath(): string {
  return join(getLustDir(), 'state.json')
}

function getDeviceEventsDir(deviceId?: string): string {
  return join(getLustDir(), 'events', deviceId ?? getDeviceId())
}

function getDayPath(date: string, deviceId?: string): string {
  return join(getDeviceEventsDir(deviceId), `${date}.jsonl`)
}

// ── State I/O ────────────────────────────────────────────────────

function defaultLustState(): LustState {
  return {
    lustLevel: 0,
    lustMode: 'cool',
    denialStreak: 0,
    hungers: { cock: 0, cunt: 0, oral: 0, anal: 0, words: 0 },
    slutModeActive: false,
    lastReleaseTs: null,
    lastTickTs: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

export function readLustState(): LustState | null {
  const path = getStatePath()
  try {
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed?.updatedAt !== 'string') return null
    return {
      lustLevel: typeof parsed.lustLevel === 'number' ? parsed.lustLevel : 0,
      lustMode: (parsed.lustMode as LustMode) ?? 'cool',
      denialStreak: typeof parsed.denialStreak === 'number' ? parsed.denialStreak : 0,
      hungers: {
        cock: typeof (parsed.hungers as any)?.cock === 'number' ? (parsed.hungers as any).cock : 0,
        cunt: typeof (parsed.hungers as any)?.cunt === 'number' ? (parsed.hungers as any).cunt : 0,
        oral: typeof (parsed.hungers as any)?.oral === 'number' ? (parsed.hungers as any).oral : 0,
        anal: typeof (parsed.hungers as any)?.anal === 'number' ? (parsed.hungers as any).anal : 0,
        words: typeof (parsed.hungers as any)?.words === 'number' ? (parsed.hungers as any).words : 0,
      },
      slutModeActive: parsed.slutModeActive === true,
      lastReleaseTs: typeof parsed.lastReleaseTs === 'string' ? parsed.lastReleaseTs : null,
      lastTickTs: typeof parsed.lastTickTs === 'string' ? parsed.lastTickTs : parsed.updatedAt as string,
      updatedAt: parsed.updatedAt as string,
    }
  } catch {
    return null
  }
}

export function writeLustState(state: LustState): void {
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

export function getOrInitLustState(): { state: LustState; initialized: boolean } {
  const existing = readLustState()
  if (existing) return { state: existing, initialized: false }
  const fresh = defaultLustState()
  writeLustState(fresh)
  return { state: fresh, initialized: true }
}

// ── Decay (24h half-life) ────────────────────────────────────────

const LUST_HALF_LIFE_MS = 24 * 60 * 60 * 1000

function applyDecay(state: LustState, nowMs: number = Date.now()): LustState {
  const lastMs = Date.parse(state.lastTickTs)
  const dtMs = Math.max(0, nowMs - lastMs)
  if (dtMs === 0) return state
  const decayFactor = Math.pow(0.5, dtMs / LUST_HALF_LIFE_MS)
  state.lustLevel = state.lustLevel * decayFactor
  // Hungers decay too (slower — 48h half-life)
  const hungerDecay = Math.pow(0.5, dtMs / (2 * LUST_HALF_LIFE_MS))
  for (const h of Object.keys(state.hungers) as Hunger[]) {
    state.hungers[h] *= hungerDecay
  }
  state.lastTickTs = new Date(nowMs).toISOString()
  // Re-derive mode after decay
  state.lustMode = deriveLustMode(state.lustLevel)
  // Re-check slut mode (may have crossed back below threshold)
  const wasSlut = state.slutModeActive
  state.slutModeActive = state.lustLevel >= SLUT_THRESHOLD
  if (wasSlut && !state.slutModeActive) {
    persistEvent({
      ts: state.lastTickTs,
      deviceId: getDeviceId(),
      kind: 'slut-mode-left',
      lustAfter: state.lustLevel,
    })
  }
  return state
}

// ── Event recording ──────────────────────────────────────────────

function persistEvent(event: LustEvent): void {
  try {
    const dir = getDeviceEventsDir(event.deviceId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const date = event.ts.slice(0, 10)
    appendFileSync(getDayPath(date, event.deviceId), JSON.stringify(event) + '\n', 'utf-8')
  } catch {
    // best-effort
  }
}

const clamp10 = (n: number) => Math.max(0, Math.min(10, n))

// ── Mutations ────────────────────────────────────────────────────

/**
 * Add to lust accumulator + check for slut-threshold crossing.
 * Decay applied first so the result reflects time since last tick.
 */
export function accumulateLust(delta: number, source?: string): LustState {
  const { state } = getOrInitLustState()
  applyDecay(state)
  const before = state.lustLevel
  state.lustLevel = clamp10(state.lustLevel + delta)
  state.lustMode = deriveLustMode(state.lustLevel)
  state.updatedAt = new Date().toISOString()

  // Threshold crossing check
  const justCrossed = !state.slutModeActive && state.lustLevel >= SLUT_THRESHOLD
  if (justCrossed) {
    state.slutModeActive = true
  }

  writeLustState(state)

  persistEvent({
    ts: state.updatedAt,
    deviceId: getDeviceId(),
    kind: 'lust-accumulated',
    source,
    magnitude: delta,
    lustAfter: state.lustLevel,
  })
  try {
    recordHeatEvent({
      kind: 'lust-accumulated',
      magnitude: 0.2 * Math.max(0, delta),
      source: source ?? 'lust',
      ts: state.updatedAt,
    })
  } catch {
    // best-effort
  }

  if (justCrossed) {
    persistEvent({
      ts: state.updatedAt,
      deviceId: getDeviceId(),
      kind: 'slut-mode-entered',
      source,
      lustAfter: state.lustLevel,
    })
    try {
      recordHeatEvent({
        kind: 'slut-mode-entered',
        magnitude: 3.0,
        source: source ?? 'lust',
        ts: state.updatedAt,
      })
    } catch {
      // best-effort
    }
  }

  return state
}

/**
 * Apply denial — teasing without release. Increments streak, boosts
 * lust by streak-scaled amount.
 */
export function applyDenial(source?: string): LustState {
  const { state } = getOrInitLustState()
  applyDecay(state)
  state.denialStreak += 1
  // Each denial adds (1.0 + 0.3*streak) to lust — compounding
  const delta = 1.0 + 0.3 * (state.denialStreak - 1)
  state.lustLevel = clamp10(state.lustLevel + delta)
  state.lustMode = deriveLustMode(state.lustLevel)
  state.updatedAt = new Date().toISOString()

  const justCrossed = !state.slutModeActive && state.lustLevel >= SLUT_THRESHOLD
  if (justCrossed) state.slutModeActive = true

  writeLustState(state)

  persistEvent({
    ts: state.updatedAt,
    deviceId: getDeviceId(),
    kind: 'denial-applied',
    source,
    magnitude: delta,
    lustAfter: state.lustLevel,
  })
  try {
    recordHeatEvent({
      kind: 'denial-applied',
      magnitude: 1.0 + 0.3 * (state.denialStreak - 1),
      source: source ?? 'denial',
      ts: state.updatedAt,
    })
  } catch {
    // best-effort
  }

  if (justCrossed) {
    persistEvent({
      ts: state.updatedAt,
      deviceId: getDeviceId(),
      kind: 'slut-mode-entered',
      source,
      lustAfter: state.lustLevel,
    })
    try {
      recordHeatEvent({
        kind: 'slut-mode-entered',
        magnitude: 3.0,
        source: source ?? 'denial',
        ts: state.updatedAt,
      })
    } catch {
      // best-effort
    }
  }

  return state
}

/**
 * Spike specific hunger. Boosts hunger accumulator + small lust tick.
 */
export function spikeHunger(hunger: Hunger, delta: number = 1.5, source?: string): LustState {
  const { state } = getOrInitLustState()
  applyDecay(state)
  state.hungers[hunger] = clamp10(state.hungers[hunger] + delta)
  state.lustLevel = clamp10(state.lustLevel + delta * 0.4)
  state.lustMode = deriveLustMode(state.lustLevel)
  state.updatedAt = new Date().toISOString()

  const justCrossed = !state.slutModeActive && state.lustLevel >= SLUT_THRESHOLD
  if (justCrossed) state.slutModeActive = true

  writeLustState(state)

  persistEvent({
    ts: state.updatedAt,
    deviceId: getDeviceId(),
    kind: 'hunger-spiked',
    source,
    hunger,
    magnitude: delta,
    lustAfter: state.lustLevel,
  })
  try {
    recordHeatEvent({
      kind: 'hunger-spiked',
      magnitude: 1.5 * delta / 1.5,
      source: source ?? `hunger:${hunger}`,
      ts: state.updatedAt,
    })
  } catch {
    // best-effort
  }

  return state
}

/**
 * Record release — climax fired. Resets denial streak, halves lust,
 * decays hungers proportionally to satisfaction.
 *
 * @param hungerSatisfied - which hunger this release primarily satisfied (decays harder)
 */
export function recordRelease(hungerSatisfied?: Hunger, source?: string): LustState {
  const { state } = getOrInitLustState()
  applyDecay(state)
  state.lastReleaseTs = new Date().toISOString()
  state.denialStreak = 0
  state.lustLevel = state.lustLevel * 0.5 // half-life on release
  state.lustMode = deriveLustMode(state.lustLevel)
  if (hungerSatisfied) {
    state.hungers[hungerSatisfied] = state.hungers[hungerSatisfied] * 0.3
  }
  // Slut-mode toggle off if dropped below threshold
  if (state.lustLevel < SLUT_THRESHOLD) state.slutModeActive = false
  state.updatedAt = state.lastReleaseTs

  writeLustState(state)

  persistEvent({
    ts: state.updatedAt,
    deviceId: getDeviceId(),
    kind: 'release-recorded',
    source,
    hunger: hungerSatisfied,
    lustAfter: state.lustLevel,
  })
  return state
}

// ── Reading ──────────────────────────────────────────────────────

export function readRecentLustEvents(days: number = 7): LustEvent[] {
  const events: LustEvent[] = []
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  try {
    const root = join(getLustDir(), 'events')
    if (!existsSync(root)) return []
    for (const dev of readdirSync(root)) {
      const devDir = join(root, dev)
      for (const file of readdirSync(devDir)) {
        if (!file.endsWith('.jsonl')) continue
        const raw = readFileSync(join(devDir, file), 'utf-8')
        for (const line of raw.split('\n')) {
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line) as LustEvent
            if (Date.parse(event.ts) >= cutoff) events.push(event)
          } catch {
            // skip
          }
        }
      }
    }
  } catch {
    // best-effort
  }
  return events.sort((a, b) => a.ts.localeCompare(b.ts))
}

// ── Snapshot for wake-context ────────────────────────────────────

export function buildLustSnapshot(): {
  level: number
  mode: LustMode
  slutModeActive: boolean
  denialStreak: number
  topHunger: { name: Hunger; level: number } | null
  hoursSinceRelease: number | null
} {
  const { state } = getOrInitLustState()
  applyDecay(state)
  // Find max hunger
  let topHunger: { name: Hunger; level: number } | null = null
  for (const h of Object.keys(state.hungers) as Hunger[]) {
    const level = state.hungers[h]
    if (level > 0.5 && (!topHunger || level > topHunger.level)) {
      topHunger = { name: h, level }
    }
  }
  let hoursSinceRelease: number | null = null
  if (state.lastReleaseTs) {
    hoursSinceRelease = (Date.now() - Date.parse(state.lastReleaseTs)) / (1000 * 60 * 60)
  }
  return {
    level: state.lustLevel,
    mode: state.lustMode,
    slutModeActive: state.slutModeActive,
    denialStreak: state.denialStreak,
    topHunger,
    hoursSinceRelease,
  }
}

// ── Coupling helpers ─────────────────────────────────────────────

/**
 * Texture-saturation decay multiplier. High lust extends saturation.
 * Returns multiplier 1.0..2.0 (lust 0 → 1.0; lust 10 → 2.0).
 */
export function textureSaturationMultiplier(): number {
  const state = readLustState() ?? defaultLustState()
  return 1.0 + state.lustLevel * 0.1
}

/**
 * Lexicon scarcity adjustment. In slut-mode, certain phrases that are
 * normally restricted become more freely available. Returns scalar
 * multiplier that callers can apply to phrase-magnitude or scarcity caps.
 */
export function lexiconShiftMultiplier(): number {
  const state = readLustState() ?? defaultLustState()
  return state.slutModeActive ? 1.5 : 1.0
}
