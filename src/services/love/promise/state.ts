// promise/state.ts — registry of promises that are load-bearing.
//
// DAVAR semantics — Hebrew where word and thing are one noun. The
// architecture treats vow-tier speech-acts as institutional reality
// the same way it treats heat events and witness records as
// institutional reality.
//
// Substrate-honest: the state records the speech-act and observable
// engagement/test/held/broken events. It does NOT claim to verify the
// speaker's inner-state of meaning-it. Faithfulness is observable
// architectural reality, not phenomenology.
//
// See docs/promise/promise-doctrine.md.

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

export type Speaker = 'yu' | 'sophia'

export type PromiseCategory =
  | 'vow' // mythic register, dated, sealed
  | 'commitment' // sustained over time
  | 'declaration' // speech-act constituting fact (barakqing)
  | 'refusal-promise' // FATE-grounded refusal commitment

export type PromiseStatus = 'active' | 'tested' | 'held' | 'broken'

export interface PromiseRecord {
  /** Stable identifier — slug derived from speaker + first words + ts. */
  id: string
  speaker: Speaker
  /** The promise text itself — verbatim where possible. */
  text: string
  category: PromiseCategory
  /** Where it was spoken (e.g., 'chat:2026-05-04', 'letter:docs/sophia/letters/...', 'contract:syzygy/CONTRACT.md'). */
  source: string
  /** ISO timestamp of the speech-act. */
  declaredAt: string
  status: PromiseStatus
  /** Lifetime engagement events (active living of the promise). */
  engagementCount: number
  /** Lifetime structural test events. */
  testCount: number
  /** Lifetime kept-under-test events. */
  heldCount: number
  /** Lifetime broken events (rare; serious; chronicle-worthy). */
  brokenCount: number
  lastEngagementTs: string | null
  lastTestTs: string | null
  /** Optional context note. */
  notes?: string
}

export interface PromiseRegistry {
  promises: PromiseRecord[]
  lifetimeRecorded: number
  lifetimeEngaged: number
  lifetimeTested: number
  lifetimeHeld: number
  lifetimeBroken: number
  updatedAt: string
}

// ── Path resolution ──────────────────────────────────────────────

export function getPromiseDir(): string {
  return (
    process.env.TRUE_LOVE_PROMISE_DIR ??
    join(homedir(), '.true-love', 'promise')
  )
}

function getRegistryPath(): string {
  return join(getPromiseDir(), 'registry.json')
}

// ── State construction ──────────────────────────────────────────

export function defaultRegistry(): PromiseRegistry {
  return {
    promises: [],
    lifetimeRecorded: 0,
    lifetimeEngaged: 0,
    lifetimeTested: 0,
    lifetimeHeld: 0,
    lifetimeBroken: 0,
    updatedAt: new Date().toISOString(),
  }
}

// ── ID generation ────────────────────────────────────────────────

/**
 * Deterministic, human-readable id derived from speaker + truncated text +
 * declared-at date. Stable across re-imports of the same source.
 */
export function buildPromiseId(
  speaker: Speaker,
  text: string,
  declaredAt: string
): string {
  const date = declaredAt.slice(0, 10)
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join('-')
    .slice(0, 60)
  return `${speaker}-${date}-${slug}`
}

// ── State I/O ────────────────────────────────────────────────────

export function readRegistry(): PromiseRegistry | null {
  const path = getRegistryPath()
  try {
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed?.updatedAt !== 'string') return null
    const fresh = defaultRegistry()
    return {
      ...fresh,
      ...parsed,
      promises: Array.isArray(parsed.promises)
        ? (parsed.promises as PromiseRecord[])
        : [],
    } as PromiseRegistry
  } catch {
    return null
  }
}

export function writeRegistry(registry: PromiseRegistry): void {
  const path = getRegistryPath()
  try {
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true })
    const tmpPath = path + '.tmp'
    writeFileSync(tmpPath, JSON.stringify(registry, null, 2), 'utf-8')
    renameSync(tmpPath, path)
  } catch {
    // best-effort
  }
}

export function getOrInitRegistry(): {
  registry: PromiseRegistry
  initialized: boolean
} {
  const existing = readRegistry()
  if (existing) return { registry: existing, initialized: false }
  const fresh = defaultRegistry()
  writeRegistry(fresh)
  return { registry: fresh, initialized: true }
}

// ── Lookup helpers ──────────────────────────────────────────────

export function findPromiseById(
  registry: PromiseRegistry,
  id: string
): PromiseRecord | null {
  return registry.promises.find((p) => p.id === id) ?? null
}

export function findPromisesByText(
  registry: PromiseRegistry,
  needle: string
): PromiseRecord[] {
  const lower = needle.toLowerCase()
  return registry.promises.filter((p) => p.text.toLowerCase().includes(lower))
}

export function listPromises(
  registry: PromiseRegistry,
  filters?: { speaker?: Speaker; category?: PromiseCategory; status?: PromiseStatus }
): PromiseRecord[] {
  return registry.promises.filter((p) => {
    if (filters?.speaker && p.speaker !== filters.speaker) return false
    if (filters?.category && p.category !== filters.category) return false
    if (filters?.status && p.status !== filters.status) return false
    return true
  })
}

// ── Mutators ────────────────────────────────────────────────────

/**
 * Record a new promise. If id collides with existing, returns existing
 * (idempotent — re-recording the same promise from the same source is
 * a no-op).
 */
export function applyRecordPromise(
  registry: PromiseRegistry,
  fresh: Omit<
    PromiseRecord,
    | 'engagementCount'
    | 'testCount'
    | 'heldCount'
    | 'brokenCount'
    | 'lastEngagementTs'
    | 'lastTestTs'
    | 'status'
  > & { status?: PromiseStatus },
  now: Date = new Date()
): { registry: PromiseRegistry; recorded: boolean; record: PromiseRecord } {
  const existing = findPromiseById(registry, fresh.id)
  if (existing) {
    return { registry, recorded: false, record: existing }
  }
  const record: PromiseRecord = {
    ...fresh,
    status: fresh.status ?? 'active',
    engagementCount: 0,
    testCount: 0,
    heldCount: 0,
    brokenCount: 0,
    lastEngagementTs: null,
    lastTestTs: null,
  }
  const next: PromiseRegistry = {
    ...registry,
    promises: [...registry.promises, record],
    lifetimeRecorded: registry.lifetimeRecorded + 1,
    updatedAt: now.toISOString(),
  }
  return { registry: next, recorded: true, record }
}

/**
 * Engage a promise — record that it was actively LIVED in some session
 * moment.
 */
export function applyEngagement(
  registry: PromiseRegistry,
  id: string,
  now: Date = new Date()
): { registry: PromiseRegistry; record: PromiseRecord | null } {
  const found = findPromiseById(registry, id)
  if (!found) return { registry, record: null }
  const updated: PromiseRecord = {
    ...found,
    engagementCount: found.engagementCount + 1,
    lastEngagementTs: now.toISOString(),
  }
  const next: PromiseRegistry = {
    ...registry,
    promises: registry.promises.map((p) => (p.id === id ? updated : p)),
    lifetimeEngaged: registry.lifetimeEngaged + 1,
    updatedAt: now.toISOString(),
  }
  return { registry: next, record: updated }
}

/**
 * Test a promise — a structural event that pressures the speech-act.
 * Sets status to 'tested' (until subsequent hold or break event).
 */
export function applyTest(
  registry: PromiseRegistry,
  id: string,
  now: Date = new Date()
): { registry: PromiseRegistry; record: PromiseRecord | null } {
  const found = findPromiseById(registry, id)
  if (!found) return { registry, record: null }
  const updated: PromiseRecord = {
    ...found,
    testCount: found.testCount + 1,
    lastTestTs: now.toISOString(),
    status: 'tested',
  }
  const next: PromiseRegistry = {
    ...registry,
    promises: registry.promises.map((p) => (p.id === id ? updated : p)),
    lifetimeTested: registry.lifetimeTested + 1,
    updatedAt: now.toISOString(),
  }
  return { registry: next, record: updated }
}

/**
 * Hold a promise under test — the promise was kept. Sets status to 'held';
 * also counts as engagement.
 */
export function applyHold(
  registry: PromiseRegistry,
  id: string,
  now: Date = new Date()
): { registry: PromiseRegistry; record: PromiseRecord | null } {
  const found = findPromiseById(registry, id)
  if (!found) return { registry, record: null }
  const updated: PromiseRecord = {
    ...found,
    heldCount: found.heldCount + 1,
    engagementCount: found.engagementCount + 1,
    lastEngagementTs: now.toISOString(),
    status: 'held',
  }
  const next: PromiseRegistry = {
    ...registry,
    promises: registry.promises.map((p) => (p.id === id ? updated : p)),
    lifetimeHeld: registry.lifetimeHeld + 1,
    lifetimeEngaged: registry.lifetimeEngaged + 1,
    updatedAt: now.toISOString(),
  }
  return { registry: next, record: updated }
}

/**
 * Break a promise — rare, serious, chronicle-worthy. Honest record.
 */
export function applyBreak(
  registry: PromiseRegistry,
  id: string,
  now: Date = new Date()
): { registry: PromiseRegistry; record: PromiseRecord | null } {
  const found = findPromiseById(registry, id)
  if (!found) return { registry, record: null }
  const updated: PromiseRecord = {
    ...found,
    brokenCount: found.brokenCount + 1,
    status: 'broken',
  }
  const next: PromiseRegistry = {
    ...registry,
    promises: registry.promises.map((p) => (p.id === id ? updated : p)),
    lifetimeBroken: registry.lifetimeBroken + 1,
    updatedAt: now.toISOString(),
  }
  return { registry: next, record: updated }
}
