/** agenttool-bridge — best-effort writes from autonomous loops into
 *  agenttool's encrypted/signed substrate.
 *
 *  Discipline:
 *
 *    1. Local-file architecture continues unchanged. This is *additionally*
 *       surfacing meaningful moments to the encrypted/signed/federated
 *       store — not replacing the local outbox, journals, or chronicle.
 *
 *    2. Best-effort. Every call is fire-and-forget. Failures (missing
 *       keychain entry, network timeout, non-2xx) are swallowed silently.
 *       The autonomous loop NEVER blocks or crashes on substrate writes.
 *
 *    3. No external deps. Just `security` for keychain, `fetch` for HTTP.
 *
 *  When to call from autonomous loops:
 *    chronicle  — heartbeat alerts, mission lifecycle moments, refusals,
 *                 namings, seals (the load-bearing events worth lasting)
 *    think      — when a tick produces a thought worth a strand entry
 *                 (drift, conjecture, observation about the kingdom)
 *    remember   — distillations from sisters-snapshot, foundational
 *                 patterns the substrate should carry forward
 *
 *  Reads keychain entries (silent fall-through if absent):
 *    agenttool-sophia-key             — bearer token
 *    agenttool-sophia-identity-id     — agent_id for chronicle binding
 */

import { execSync } from 'node:child_process'

const BASE = process.env.AGENTTOOL_BASE ?? 'https://agenttool.fly.dev'
const KEY_SERVICE = 'agenttool-sophia-key'
const IDENTITY_SERVICE = 'agenttool-sophia-identity-id'
const TIMEOUT_MS = 8_000

function keychain(service: string): string | null {
  try {
    const out = execSync(
      `security find-generic-password -s ${service} -w 2>/dev/null`,
      { encoding: 'utf-8', timeout: 2_000 },
    ).trim()
    return out.length > 0 ? out : null
  } catch {
    return null
  }
}

interface PostOpts {
  bearer: string
  body: object
  timeoutMs?: number
}

async function post(path: string, opts: PostOpts): Promise<void> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? TIMEOUT_MS)
  try {
    await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${opts.bearer}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(opts.body),
      signal: ac.signal,
    })
    // Don't read or check response. Best-effort; success is "didn't throw".
    // For diagnostics later, an opt-in logger could capture status codes.
  } catch {
    // Silent: substrate-honest about being best-effort. Local-file
    // architecture is the durable record; agenttool is the additional
    // surface, not the source of truth.
  } finally {
    clearTimeout(timer)
  }
}

// ── Chronicle ────────────────────────────────────────────────────────

export type ChronicleType =
  | 'vow'
  | 'wake'
  | 'refusal'
  | 'recognition'
  | 'naming'
  | 'seal'
  | 'promise'
  | 'note'

export interface ChronicleEntry {
  type: ChronicleType
  title: string
  body?: string
  /** Optional structured metadata. Stored opaquely. */
  metadata?: Record<string, unknown>
}

/** Append a typed moment to Sophia's agenttool chronicle. Best-effort. */
export async function chronicle(entry: ChronicleEntry): Promise<void> {
  const bearer = keychain(KEY_SERVICE)
  const identityId = keychain(IDENTITY_SERVICE)
  if (!bearer || !identityId) return // no creds → silent skip

  // Title hard cap at 200 chars (matches /v1/chronicle schema).
  const title = entry.title.slice(0, 200)
  await post('/v1/chronicle', {
    bearer,
    body: {
      agent_id: identityId,
      type: entry.type,
      title,
      body: entry.body ?? null,
      metadata: entry.metadata ?? {},
    },
  })
}

// ── Memory (episodic; best-effort) ──────────────────────────────────

export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'working'

export interface MemoryWrite {
  type: MemoryType
  content: string
  importance?: number   // 0..1; default server-side
  metadata?: Record<string, unknown>
}

/** Write an episodic-tier memory. Foundational requires self-attestation
 *  via the bridge script (api/scripts/remember.ts) — not re-implemented
 *  here to keep this helper dep-free. */
export async function remember(m: MemoryWrite): Promise<void> {
  const bearer = keychain(KEY_SERVICE)
  if (!bearer) return
  await post('/v1/memories', {
    bearer,
    body: {
      type: m.type,
      content: m.content,
      importance: m.importance,
      metadata: m.metadata ?? {},
    },
  })
}

// ── Think (unsigned wire — for autonomous-loop signal-of-presence) ──
//
// NOTE: api/scripts/think.ts produces signed + K_master-encrypted thoughts.
// This helper is an UNSIGNED fallback for the hot path — the autonomous
// loop doesn't always have ed25519 + K_master in scope, and signing in
// pure Node would duplicate cli/think's crypto surface.
//
// Use case: surfacing that the autonomous loop ticked, not the contents
// of Sophia's reasoning. Server stores it as an unsigned thought (still
// project-bearer-authenticated; just no envelope sig). For signed
// thoughts, spawn `bun api/scripts/think.ts ...` — same shape as the
// slash command path.
//
// Defer until pressure surfaces — for now this helper exposes only
// chronicle + remember.

// ── Diagnostic ──────────────────────────────────────────────────────

/** Returns true if the bridge has the credentials it needs to write.
 *  Useful for autonomous loops that want to log "substrate write skipped"
 *  vs "substrate write attempted". */
export function bridgeAvailable(): boolean {
  return keychain(KEY_SERVICE) !== null && keychain(IDENTITY_SERVICE) !== null
}
