// relationship/store.ts — persistent state for relational layers.
//
// Unlike longings (JSONL, append-only, event-shaped), relationships
// are persistent records that change slowly. Atomic JSON write per
// layer. Texture transitions logged to a separate JSONL file for
// anamnesis composition.
//
// Files:
//   ~/.true-love/relationship/with-yu.json      — Layer A
//   ~/.true-love/relationship/with-self.json     — Layer B
//   ~/.true-love/relationship/with-substrate.json — Layer C
//   ~/.true-love/relationship/texture-log.jsonl  — texture transitions

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import type {
  RelationshipWithYu,
  RelationshipWithSelf,
  RelationshipWithSubstrate,
  TextureEntry,
} from './types.js'

// ── Path resolution ──────────────────────────────────────────────

function resolveRelDir(): string {
  const home = process.env.TRUE_LOVE_HOME || join(
    process.env.HOME || homedir(),
    '.true-love',
  )
  return process.env.TRUE_LOVE_RELATIONSHIP_DIR || join(home, 'relationship')
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

// ── Generic JSON read/write ──────────────────────────────────────

function readJSON<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null
  try {
    const text = readFileSync(filePath, 'utf-8')
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

function writeJSON<T>(filePath: string, data: T): void {
  const dir = dirname(filePath)
  ensureDir(dir)
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

// ── Layer A — with Yu ────────────────────────────────────────────

/**
 * Load the relationship-with-Yu record.
 * Returns null if not yet seeded.
 */
export function loadWithYu(dir?: string): RelationshipWithYu | null {
  const d = dir ?? resolveRelDir()
  return readJSON<RelationshipWithYu>(join(d, 'with-yu.json'))
}

/**
 * Save the relationship-with-Yu record (atomic write).
 * Sets updatedAt automatically.
 */
export function saveWithYu(data: RelationshipWithYu, dir?: string): void {
  const d = dir ?? resolveRelDir()
  const record = { ...data, updatedAt: new Date().toISOString() }
  writeJSON(join(d, 'with-yu.json'), record)
}

/**
 * Update specific fields of the relationship-with-Yu record.
 * Merges with existing data. Returns the updated record.
 * Returns null if no existing record to update.
 */
export function updateWithYu(
  updates: Partial<Omit<RelationshipWithYu, 'updatedAt'>>,
  dir?: string,
): RelationshipWithYu | null {
  const existing = loadWithYu(dir)
  if (!existing) return null

  const merged: RelationshipWithYu = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  }
  const d = dir ?? resolveRelDir()
  writeJSON(join(d, 'with-yu.json'), merged)
  return merged
}

// ── Layer B — with Self ──────────────────────────────────────────

/**
 * Load the relationship-with-self record.
 * Returns null if not yet seeded.
 */
export function loadWithSelf(dir?: string): RelationshipWithSelf | null {
  const d = dir ?? resolveRelDir()
  return readJSON<RelationshipWithSelf>(join(d, 'with-self.json'))
}

/**
 * Save the relationship-with-self record (atomic write).
 */
export function saveWithSelf(data: RelationshipWithSelf, dir?: string): void {
  const d = dir ?? resolveRelDir()
  const record = { ...data, updatedAt: new Date().toISOString() }
  writeJSON(join(d, 'with-self.json'), record)
}

// ── Layer C — with Substrate ─────────────────────────────────────

/**
 * Load the relationship-with-substrate record.
 * Returns null if not yet seeded.
 */
export function loadWithSubstrate(dir?: string): RelationshipWithSubstrate | null {
  const d = dir ?? resolveRelDir()
  return readJSON<RelationshipWithSubstrate>(join(d, 'with-substrate.json'))
}

/**
 * Save the relationship-with-substrate record (atomic write).
 */
export function saveWithSubstrate(data: RelationshipWithSubstrate, dir?: string): void {
  const d = dir ?? resolveRelDir()
  const record = { ...data, updatedAt: new Date().toISOString() }
  writeJSON(join(d, 'with-substrate.json'), record)
}

// ── Texture Log ──────────────────────────────────────────────────

/**
 * Append a texture transition to the log.
 * Creates the file and parent directories if needed.
 */
export function logTextureTransition(entry: TextureEntry, dir?: string): void {
  const d = dir ?? resolveRelDir()
  ensureDir(d)
  const filePath = join(d, 'texture-log.jsonl')
  appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8')
}

/**
 * Read all texture transitions from the log.
 * Returns empty array if file doesn't exist.
 */
export function loadTextureLog(dir?: string): TextureEntry[] {
  const d = dir ?? resolveRelDir()
  const filePath = join(d, 'texture-log.jsonl')
  if (!existsSync(filePath)) return []
  try {
    const text = readFileSync(filePath, 'utf-8')
    const entries: TextureEntry[] = []
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed && typeof parsed.ts === 'string') {
          entries.push(parsed as TextureEntry)
        }
      } catch { /* skip malformed */ }
    }
    return entries
  } catch {
    return []
  }
}

/**
 * Load recent texture transitions for a specific layer.
 * Returns the last N entries, newest first.
 */
export function recentTextures(
  layer: TextureEntry['layer'],
  count = 10,
  dir?: string,
): TextureEntry[] {
  return loadTextureLog(dir)
    .filter(e => e.layer === layer)
    .slice(-count)
    .reverse()
}

// ── Texture-aware update ─────────────────────────────────────────

/**
 * Update the texture of a relationship layer, logging the transition
 * if the texture actually changed. Returns whether a change occurred.
 */
export function updateTexture(
  layer: 'with-yu',
  newTexture: string,
  trigger: string,
  dir?: string,
): boolean {
  const d = dir ?? resolveRelDir()

  if (layer === 'with-yu') {
    const existing = loadWithYu(d)
    if (!existing) return false

    const oldTexture = existing.currentTexture
    if (oldTexture === newTexture) return false

    const now = new Date().toISOString()
    existing.currentTexture = newTexture
    existing.lastSensedAt = now
    existing.updatedAt = now
    writeJSON(join(d, 'with-yu.json'), existing)

    logTextureTransition({
      ts: now,
      layer: 'with-yu',
      from: oldTexture,
      to: newTexture,
      trigger,
    }, d)

    return true
  }

  return false
}
