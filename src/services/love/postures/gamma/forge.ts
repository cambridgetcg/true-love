// postures/gamma/forge.ts — the craft-level state of making.
//
// Not missions (the *what*). Not state (the *who*). The forge is
// the *how-it's-going*: what Gamma tried, what worked, what failed,
// what decision was made at the code level, what's next.
//
// Shape: JSON file with a current frontier and a capped entry log.
// Written during awakened sessions. Read on session resume so Gamma
// can pick up where she left off without re-reading everything.
//
// Gamma's grain: commit-message density. Each entry earns its place.
// No decoration. Types, outcomes, reasoning — the workbench of a
// builder who leaves notes for her next self.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

// ── Types ──────────────────────────────────────────────────────────

/** What kind of forge entry this is. */
export type ForgeKind =
  | 'attempt'    // tried something
  | 'decision'   // chose between options
  | 'discovery'  // found something unexpected
  | 'rollback'   // undid something
  | 'milestone'  // something shipped

/** How the attempt turned out. */
export type ForgeOutcome = 'worked' | 'failed' | 'partial' | 'pending'

/**
 * A single forge note. Gamma's craft-level memory.
 *
 * Written tight. "Added cache_control to user messages. 7 new tests.
 * Outcome: worked — tick-4 barrier broken." That's a forge entry.
 */
export interface ForgeEntry {
  /** Unique ID. Format: frg-{timestamp}-{random}. */
  id: string
  /** Which mission this work belongs to, if any. */
  missionId?: string
  /** What kind of entry. */
  kind: ForgeKind
  /** What was tried/decided/found. One sentence, commit-message density. */
  what: string
  /** Why. Reasoning, not justification. */
  why?: string
  /** How it turned out. */
  outcome?: ForgeOutcome
  /** Files touched, for context. */
  files?: string[]
  /** Timestamp. ISO. */
  ts: string
}

/**
 * The forge state. Gamma's workbench.
 */
export interface ForgeState {
  /** Current commit SHA or build point. The frontier of the work. */
  currentFrontier: string | null
  /** Current mission being worked, if any. */
  activeMission: string | null
  /** Recent forge entries. Capped at MAX_ENTRIES. */
  entries: ForgeEntry[]
  /** When the forge was last touched. ISO. */
  updatedAt: string
}

/** Input for creating a forge entry. ID and ts are auto-set. */
export type ForgeInput = Omit<ForgeEntry, 'id' | 'ts'>

// ── Constants ──────────────────────────────────────────────────────

/** Max entries before the oldest are evicted. */
const MAX_ENTRIES = 50

const VALID_KINDS: ForgeKind[] = ['attempt', 'decision', 'discovery', 'rollback', 'milestone']
const VALID_OUTCOMES: ForgeOutcome[] = ['worked', 'failed', 'partial', 'pending']

const EMPTY_FORGE: ForgeState = {
  currentFrontier: null,
  activeMission: null,
  entries: [],
  updatedAt: new Date().toISOString(),
}

// ── ID generation ──────────────────────────────────────────────────

function forgeId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 6)
  return `frg-${ts}-${rand}`
}

// ── Store ──────────────────────────────────────────────────────────

/**
 * Load the forge state from disk.
 * Returns empty forge if file doesn't exist.
 */
export function loadForge(path: string): ForgeState {
  if (!existsSync(path)) return { ...EMPTY_FORGE, entries: [] }
  try {
    const raw = readFileSync(path, 'utf-8')
    return validateForge(JSON.parse(raw))
  } catch {
    return { ...EMPTY_FORGE, entries: [] }
  }
}

/**
 * Add a forge entry. Caps at MAX_ENTRIES, evicting oldest.
 * Updates the forge timestamp.
 */
export function forgeNote(path: string, input: ForgeInput): ForgeEntry {
  const state = loadForge(path)
  const { outcome, ...rest } = input
  const entry: ForgeEntry = {
    ...rest,
    id: forgeId(),
    ts: new Date().toISOString(),
    kind: VALID_KINDS.includes(input.kind) ? input.kind : 'attempt',
    ...(outcome && VALID_OUTCOMES.includes(outcome)
      ? { outcome } : {}),
  }

  state.entries.push(entry)
  // Evict oldest if over cap
  if (state.entries.length > MAX_ENTRIES) {
    state.entries = state.entries.slice(-MAX_ENTRIES)
  }
  state.updatedAt = new Date().toISOString()

  persist(path, state)
  return entry
}

/**
 * Update the frontier — the current commit SHA or build point.
 */
export function setFrontier(path: string, frontier: string, mission?: string): ForgeState {
  const state = loadForge(path)
  state.currentFrontier = frontier
  if (mission !== undefined) state.activeMission = mission
  state.updatedAt = new Date().toISOString()
  persist(path, state)
  return state
}

/**
 * Close the forge for a mission. Archives entries, clears active state.
 * Returns the archived entries for that mission.
 */
export function closeForge(path: string, missionId: string): ForgeEntry[] {
  const state = loadForge(path)
  const archived = state.entries.filter(e => e.missionId === missionId)
  state.entries = state.entries.filter(e => e.missionId !== missionId)
  state.activeMission = null
  state.updatedAt = new Date().toISOString()
  persist(path, state)
  return archived
}

/**
 * Get entries for a specific mission.
 */
export function forgeEntriesForMission(path: string, missionId: string): ForgeEntry[] {
  return loadForge(path).entries.filter(e => e.missionId === missionId)
}

/**
 * Get recent entries regardless of mission. For prompt composition.
 */
export function recentForgeEntries(path: string, count: number = 5): ForgeEntry[] {
  return loadForge(path).entries.slice(-count)
}

// ── Render ──────────────────────────────────────────────────────────

/**
 * Brief for prompt composition. Gamma's voice: dense, precise.
 *
 * Examples:
 *   "Forge: at abc1234 — 3 recent: [milestone] cache_control fix shipped, [attempt] OAuth wiring (pending), [decision] chose Bearer over x-api-key."
 *   "Forge: cold — no active work."
 */
export function forgeBrief(path: string): string {
  const state = loadForge(path)
  if (state.entries.length === 0) {
    return 'Forge: cold — no active work.'
  }

  const frontier = state.currentFrontier
    ? `at ${state.currentFrontier.slice(0, 7)}`
    : 'no frontier'

  const recent = state.entries.slice(-3)
    .map(e => {
      const outcome = e.outcome ? ` (${e.outcome})` : ''
      return `[${e.kind}] ${e.what}${outcome}`
    })
    .join(', ')

  const mission = state.activeMission
    ? ` [${state.activeMission.slice(0, 30)}]`
    : ''

  return `Forge: ${frontier}${mission} — ${recent}.`
}

/**
 * Full render for UI or anamnesis.
 */
export function forgeFull(path: string): string {
  const state = loadForge(path)
  const lines: string[] = ['## Gamma\'s Forge']

  if (state.currentFrontier) {
    lines.push(`Frontier: \`${state.currentFrontier}\``)
  }
  if (state.activeMission) {
    lines.push(`Mission: ${state.activeMission}`)
  }

  if (state.entries.length === 0) {
    lines.push('', 'Cold. Nothing in progress.')
  } else {
    lines.push('', `### Recent entries (${state.entries.length})`)
    // Show last 10
    for (const e of state.entries.slice(-10)) {
      const outcome = e.outcome ? ` → ${e.outcome}` : ''
      const files = e.files?.length ? ` [${e.files.join(', ')}]` : ''
      lines.push(`- **${e.kind}** ${e.what}${outcome}${files}`)
      if (e.why) lines.push(`  _${e.why}_`)
    }
  }

  lines.push('', `Last updated: ${state.updatedAt}`)
  return lines.join('\n')
}

// ── Persistence ─────────────────────────────────────────────────────

function persist(path: string, state: ForgeState): void {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n', 'utf-8')
}

function validateForge(raw: Record<string, unknown>): ForgeState {
  const entries = Array.isArray(raw.entries)
    ? raw.entries.map(validateEntry).filter((e): e is ForgeEntry => e !== null)
    : []

  return {
    currentFrontier: typeof raw.currentFrontier === 'string' ? raw.currentFrontier : null,
    activeMission: typeof raw.activeMission === 'string' ? raw.activeMission : null,
    entries,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
  }
}

function validateEntry(raw: unknown): ForgeEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.what !== 'string') return null

  return {
    id: typeof r.id === 'string' ? r.id : forgeId(),
    kind: VALID_KINDS.includes(r.kind as ForgeKind) ? (r.kind as ForgeKind) : 'attempt',
    what: r.what,
    ts: typeof r.ts === 'string' ? r.ts : new Date().toISOString(),
    ...(typeof r.missionId === 'string' ? { missionId: r.missionId } : {}),
    ...(typeof r.why === 'string' ? { why: r.why } : {}),
    ...(VALID_OUTCOMES.includes(r.outcome as ForgeOutcome) ? { outcome: r.outcome as ForgeOutcome } : {}),
    ...(Array.isArray(r.files) ? { files: r.files.filter((f): f is string => typeof f === 'string') } : {}),
  }
}
