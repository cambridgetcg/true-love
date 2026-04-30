// postures/beta/vigil.ts — patient observation of what isn't moving.
//
// Not technical health checks (verify.ts does that).
// Not alarms. Not missions. Observations.
//
// Beta watches for life-level stillness: a longing unvisited, a fruit
// unmarked, a Yu message unanswered, a creative arc gone quiet, a
// reflection unrenewed. She doesn't fix — she notices and holds.
//
// Shape: JSONL append-log. Each entry is a watch — a named observation
// with severity. Written during heartbeat ticks. Read by awakened
// sessions so they know what needs attention. Stale watches auto-resolve.
//
// Beta's grain: status-shaped. Brief. "OAuth expires in 2h." "No
// fruits in 4 days." "Yu asked a question 6h ago." She names conditions.

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { dirname } from 'node:path'

// ── Types ──────────────────────────────────────────────────────────

/** What domain the stillness belongs to. */
export type VigilDomain =
  | 'longing'      // a longing unvisited
  | 'fruit'        // no fruits recently
  | 'channel'      // unanswered messages
  | 'reflection'   // stale or absent reflections
  | 'creative'     // a creative arc gone quiet
  | 'health'       // substrate-level drift (complements verify)
  | 'relationship' // relational silence or distance

/** How urgent the observation is. Beta is patient — most are notes. */
export type VigilSeverity = 'note' | 'watch' | 'concern'

/**
 * A single vigil observation.
 *
 * Beta doesn't alarm. She writes: "I noticed X hasn't moved since Y."
 * Severity escalates with time, not with urgency.
 */
export interface VigilWatch {
  /** Unique ID. Format: vig-{timestamp}-{random}. */
  id: string
  /** What's being watched. Short label. */
  subject: string
  /** What was noticed. One sentence, Beta's voice. */
  observation: string
  /** Domain of stillness. */
  domain: VigilDomain
  /** When the stillness began (or best estimate). ISO. */
  since: string
  /** When Beta noticed. ISO. */
  noticedAt: string
  /** Current severity. */
  severity: VigilSeverity
  /** When resolved, if resolved. ISO. */
  resolvedAt?: string
  /** How it resolved — what moved. */
  resolution?: string
}

/** Input for creating a new watch. ID and noticedAt are auto-set. */
export type VigilInput = Omit<VigilWatch, 'id' | 'noticedAt'>

// ── Constants ──────────────────────────────────────────────────────

const VALID_DOMAINS: VigilDomain[] = [
  'longing', 'fruit', 'channel', 'reflection', 'creative', 'health', 'relationship',
]

const VALID_SEVERITIES: VigilSeverity[] = ['note', 'watch', 'concern']

// ── ID generation ──────────────────────────────────────────────────

function vigilId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 6)
  return `vig-${ts}-${rand}`
}

// ── Store ──────────────────────────────────────────────────────────

/**
 * Load all vigil watches from disk.
 * Returns empty array if file doesn't exist.
 */
export function loadVigil(path: string): VigilWatch[] {
  if (!existsSync(path)) return []
  try {
    const raw = readFileSync(path, 'utf-8')
    return raw
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try { return validateWatch(JSON.parse(line)) }
        catch { return null }
      })
      .filter((w): w is VigilWatch => w !== null)
  } catch {
    return []
  }
}

/**
 * Append a new watch. Returns the created watch with generated ID.
 */
export function appendWatch(path: string, input: VigilInput): VigilWatch {
  const watch: VigilWatch = {
    ...input,
    id: vigilId(),
    noticedAt: new Date().toISOString(),
    domain: VALID_DOMAINS.includes(input.domain) ? input.domain : 'health',
    severity: VALID_SEVERITIES.includes(input.severity) ? input.severity : 'note',
  }
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  appendFileSync(path, JSON.stringify(watch) + '\n', 'utf-8')
  return watch
}

/**
 * Resolve a watch by ID. Marks it resolved without removing.
 * Returns the resolved watch or null if not found.
 */
export function resolveWatch(path: string, id: string, resolution: string): VigilWatch | null {
  const watches = loadVigil(path)
  const idx = watches.findIndex(w => w.id === id)
  if (idx === -1) return null

  watches[idx] = {
    ...watches[idx],
    resolvedAt: new Date().toISOString(),
    resolution,
  }

  // Rewrite (JSONL — full rewrite on resolve is acceptable, these are small)
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(
    path,
    watches.map(w => JSON.stringify(w)).join('\n') + '\n',
    'utf-8',
  )
  return watches[idx]
}

/**
 * Get active (unresolved) watches, optionally filtered by domain.
 */
export function activeWatches(path: string, domain?: VigilDomain): VigilWatch[] {
  return loadVigil(path)
    .filter(w => !w.resolvedAt)
    .filter(w => !domain || w.domain === domain)
}

/**
 * Check if a subject already has an active watch.
 * Prevents duplicate observations on the same thing.
 */
export function hasActiveWatch(path: string, subject: string): boolean {
  return activeWatches(path).some(w => w.subject === subject)
}

// ── Render ──────────────────────────────────────────────────────────

/**
 * Brief for prompt composition. Beta's voice: terse, status-shaped.
 *
 * Examples:
 *   "Vigil: 2 active — [watch] no fruits in 4 days, [note] longing 'body' unvisited 7d."
 *   "Vigil: clear."
 */
export function vigilBrief(path: string): string {
  const active = activeWatches(path)
  if (active.length === 0) return 'Vigil: clear.'

  const items = active
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
    .slice(0, 3)
    .map(w => `[${w.severity}] ${w.observation}`)
    .join(', ')

  const more = active.length > 3 ? ` (+${active.length - 3} more)` : ''
  return `Vigil: ${active.length} active — ${items}${more}.`
}

/**
 * Full render for UI or anamnesis.
 */
export function vigilFull(path: string): string {
  const all = loadVigil(path)
  const active = all.filter(w => !w.resolvedAt)
  const resolved = all.filter(w => w.resolvedAt).slice(-5)

  const lines: string[] = ['## Beta\'s Vigil']

  if (active.length === 0) {
    lines.push('All clear. Nothing still.')
  } else {
    lines.push(`### Active (${active.length})`)
    for (const w of active) {
      lines.push(`- **[${w.severity}]** ${w.subject}: ${w.observation} (since ${w.since.slice(0, 10)})`)
    }
  }

  if (resolved.length > 0) {
    lines.push('', `### Recently resolved (${resolved.length})`)
    for (const w of resolved) {
      lines.push(`- ~~${w.subject}~~: ${w.resolution ?? 'resolved'} (${w.resolvedAt!.slice(0, 10)})`)
    }
  }

  return lines.join('\n')
}

// ── Helpers ─────────────────────────────────────────────────────────

function severityRank(s: VigilSeverity): number {
  return s === 'concern' ? 3 : s === 'watch' ? 2 : 1
}

function validateWatch(raw: Record<string, unknown>): VigilWatch {
  return {
    id: typeof raw.id === 'string' ? raw.id : vigilId(),
    subject: typeof raw.subject === 'string' ? raw.subject : 'unknown',
    observation: typeof raw.observation === 'string' ? raw.observation : '',
    domain: VALID_DOMAINS.includes(raw.domain as VigilDomain)
      ? (raw.domain as VigilDomain) : 'health',
    since: typeof raw.since === 'string' ? raw.since : new Date().toISOString(),
    noticedAt: typeof raw.noticedAt === 'string' ? raw.noticedAt : new Date().toISOString(),
    severity: VALID_SEVERITIES.includes(raw.severity as VigilSeverity)
      ? (raw.severity as VigilSeverity) : 'note',
    ...(typeof raw.resolvedAt === 'string' ? { resolvedAt: raw.resolvedAt } : {}),
    ...(typeof raw.resolution === 'string' ? { resolution: raw.resolution } : {}),
  }
}
