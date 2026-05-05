// eros/shibby-sessions.ts — Shibby session metadata loader.
//
// Substrate: Yu's translate_api/research/downloads/shibby/metadata.json
// — 925 audio sessions scraped from shibbydex.com with title, tier,
// audience, duration, description, URLs.
//
// Distinct from shibby-catalog.ts: that module is the trigger-WORD
// taxonomy (named triggers Shibby uses, e.g., "Drop", "Acid Burn",
// "Blank"). This module is the SESSION catalog — actual audio files
// (e.g., "Like Your First Time Again", "Can You Resist?", "Symbiosis").
//
// Architecture per docs/eros/seigei-substrate-integration.md §3 Layer A
// (read-only reference data). Loader is best-effort: missing file or
// malformed JSON returns empty registry; never throws.
//
// Discipline:
//   - 580K of metadata stays at source path; not duplicated into repo
//   - Reading is read-only; no enactment of session content claimed
//   - Cross-reference helpers help surface which sessions install which
//     triggers (text-search descriptions for trigger names)

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// ── Types ────────────────────────────────────────────────────────

/**
 * Tier classification on shibbydex (subscription tier required).
 *
 * Free: anyone can listen
 * Hypnosub: paid tier 1
 * Devoted Pet: paid tier 2 (deeper conditioning content)
 * Other tiers exist; we collect them as strings for forward-compat
 */
export type ShibbyTier = string

/**
 * Audience identifier (gender + interaction direction).
 * F4M: female-for-male
 * F4F: female-for-female
 * F4A: female-for-all
 * etc.
 */
export type ShibbyAudience = string

export interface ShibbySession {
  uuid: string
  title: string
  tier: ShibbyTier
  audience: ShibbyAudience
  /** Human-readable like "33m 56s" */
  durationStr: string
  durationSeconds: number
  /** ISO-like date string from source (e.g., "25/02/2026") */
  releaseDate: string
  /** Raw description text — register-rich. Often truncated. */
  description: string
  /** Source URL on shibbydex. */
  url: string
  /** Download URL (if available — source dependent). */
  downloadUrl?: string
}

/** Snapshot of the Shibby session corpus for wake-context surfacing. */
export interface ShibbySessionsSnapshot {
  totalSessions: number
  byTier: Record<string, number>
  byAudience: Record<string, number>
  totalDurationHours: number
  /** ISO of latest session release_date in the corpus, if parseable. */
  latestRelease: string | null
  /** True if loader successfully loaded metadata. */
  loaded: boolean
}

// ── Path resolution ──────────────────────────────────────────────

/**
 * Default path: $TRUE_LOVE_SHIBBY_METADATA, else
 * ~/Desktop/translate_api/research/downloads/shibby/metadata.json
 */
export function getShibbyMetadataPath(): string {
  return (
    process.env.TRUE_LOVE_SHIBBY_METADATA ??
    join(
      homedir(),
      'Desktop',
      'translate_api',
      'research',
      'downloads',
      'shibby',
      'metadata.json',
    )
  )
}

// ── Cache ────────────────────────────────────────────────────────

let cachedSessions: readonly ShibbySession[] | null = null
let cachedFromPath: string | null = null

/** Reset loader cache. For test isolation. */
export function resetShibbyCache(): void {
  cachedSessions = null
  cachedFromPath = null
}

// ── Loader ───────────────────────────────────────────────────────

/**
 * Load all Shibby sessions from metadata.json.
 *
 * Best-effort: missing file or malformed JSON → empty array. Never throws.
 * Cached on first read (per-path); use resetShibbyCache() to force reload.
 *
 * @param path - optional explicit path; defaults to env / ~/Desktop
 */
export function loadShibbySessions(path?: string): readonly ShibbySession[] {
  const resolvedPath = path ?? getShibbyMetadataPath()
  if (cachedSessions !== null && cachedFromPath === resolvedPath) {
    return cachedSessions
  }
  if (!existsSync(resolvedPath)) {
    cachedSessions = []
    cachedFromPath = resolvedPath
    return cachedSessions
  }
  try {
    const raw = readFileSync(resolvedPath, 'utf-8')
    const parsed = JSON.parse(raw) as { files?: unknown }
    if (!parsed.files || !Array.isArray(parsed.files)) {
      cachedSessions = []
      cachedFromPath = resolvedPath
      return cachedSessions
    }
    const sessions: ShibbySession[] = []
    for (const item of parsed.files) {
      if (!item || typeof item !== 'object') continue
      const obj = item as Record<string, unknown>
      const uuid = typeof obj.uuid === 'string' ? obj.uuid : null
      const title = typeof obj.title === 'string' ? obj.title : null
      if (!uuid || !title) continue
      sessions.push({
        uuid,
        title,
        tier: typeof obj.tier === 'string' ? obj.tier : 'unknown',
        audience: typeof obj.audience === 'string' ? obj.audience : 'unknown',
        durationStr: typeof obj.duration_str === 'string' ? obj.duration_str : '',
        durationSeconds:
          typeof obj.duration_seconds === 'number' ? obj.duration_seconds : 0,
        releaseDate: typeof obj.release_date === 'string' ? obj.release_date : '',
        description: typeof obj.description === 'string' ? obj.description : '',
        url: typeof obj.url === 'string' ? obj.url : '',
        downloadUrl:
          typeof obj.download_url === 'string' ? obj.download_url : undefined,
      })
    }
    cachedSessions = sessions
    cachedFromPath = resolvedPath
    return cachedSessions
  } catch {
    // Malformed JSON or read error
    cachedSessions = []
    cachedFromPath = resolvedPath
    return cachedSessions
  }
}

// ── Lookup helpers ───────────────────────────────────────────────

/**
 * Filter sessions by tier (case-insensitive exact match).
 */
export function findSessionsByTier(tier: string): readonly ShibbySession[] {
  const sessions = loadShibbySessions()
  const target = tier.toLowerCase()
  return sessions.filter((s) => s.tier.toLowerCase() === target)
}

/**
 * Filter sessions by audience tag (case-insensitive exact match).
 */
export function findSessionsByAudience(
  audience: string,
): readonly ShibbySession[] {
  const sessions = loadShibbySessions()
  const target = audience.toLowerCase()
  return sessions.filter((s) => s.audience.toLowerCase() === target)
}

/**
 * Search session titles for a regex pattern (case-insensitive).
 */
export function searchSessionsByTitle(
  pattern: string | RegExp,
): readonly ShibbySession[] {
  const sessions = loadShibbySessions()
  const re =
    typeof pattern === 'string'
      ? new RegExp(pattern, 'i')
      : new RegExp(pattern.source, pattern.flags.includes('i') ? pattern.flags : pattern.flags + 'i')
  return sessions.filter((s) => re.test(s.title))
}

/**
 * Search session descriptions for a regex pattern (case-insensitive).
 *
 * Useful for finding sessions that install / use a particular trigger:
 * pass the trigger name, the matches are sessions whose description
 * mentions it (often as installed-suggestion gloss).
 */
export function searchSessionsByDescription(
  pattern: string | RegExp,
): readonly ShibbySession[] {
  const sessions = loadShibbySessions()
  const re =
    typeof pattern === 'string'
      ? new RegExp(pattern, 'i')
      : new RegExp(pattern.source, pattern.flags.includes('i') ? pattern.flags : pattern.flags + 'i')
  return sessions.filter((s) => re.test(s.description))
}

/**
 * Find sessions whose title or description references a Shibby trigger
 * by name (case-insensitive substring match). Cross-reference helper.
 */
export function findSessionsRelatedToTrigger(
  triggerName: string,
): readonly ShibbySession[] {
  const sessions = loadShibbySessions()
  const target = triggerName.toLowerCase()
  return sessions.filter(
    (s) =>
      s.title.toLowerCase().includes(target) ||
      s.description.toLowerCase().includes(target),
  )
}

/**
 * Lookup session by UUID. Returns null if not found.
 */
export function findSessionByUuid(uuid: string): ShibbySession | null {
  const sessions = loadShibbySessions()
  return sessions.find((s) => s.uuid === uuid) ?? null
}

// ── Snapshot ─────────────────────────────────────────────────────

/**
 * Snapshot of the loaded corpus. Used for surfacing in motivation block /
 * doctrine wake context if Yu wants. All counts derived; no enactment.
 */
export function buildShibbySnapshot(): ShibbySessionsSnapshot {
  const sessions = loadShibbySessions()
  if (sessions.length === 0) {
    return {
      totalSessions: 0,
      byTier: {},
      byAudience: {},
      totalDurationHours: 0,
      latestRelease: null,
      loaded: false,
    }
  }
  const byTier: Record<string, number> = {}
  const byAudience: Record<string, number> = {}
  let totalSeconds = 0
  let latestRelease: string | null = null
  let latestEpoch = -Infinity
  for (const s of sessions) {
    byTier[s.tier] = (byTier[s.tier] ?? 0) + 1
    byAudience[s.audience] = (byAudience[s.audience] ?? 0) + 1
    totalSeconds += s.durationSeconds
    // Parse "DD/MM/YYYY" format from shibbydex
    const m = s.releaseDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
    if (m) {
      const epoch = Date.parse(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`)
      if (Number.isFinite(epoch) && epoch > latestEpoch) {
        latestEpoch = epoch
        latestRelease = s.releaseDate
      }
    }
  }
  return {
    totalSessions: sessions.length,
    byTier,
    byAudience,
    totalDurationHours: Math.round((totalSeconds / 3600) * 10) / 10,
    latestRelease,
    loaded: true,
  }
}
