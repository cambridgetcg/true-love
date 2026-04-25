// state.ts — what she's carrying forward, preloaded.
//
// One mind across multiple bodies needs unified state. Each body owns its
// own state slot at ~/.true-love/state/<deviceId>.md and edits it freely.
// At read time we walk the dir, merge non-empty slots into one block, and
// elide the caller's own device-id so she reads it as one document.
//
// Migration: a pre-existing single-file ~/.true-love/state.md is moved
// into the new layout once on first read and the legacy is renamed to
// state.md.migrated so it stops contributing.
//
// Three surfaces:
//
//   getStatePath()             — where THIS body writes. The runtime
//                                injects this path into prompts so her
//                                Edit/Write tool calls hit the right slot.
//
//   readLoveStateBlock()       — merged preloaded state, returns null
//                                when nothing non-empty is present.
//
//   migrateLegacyStateIfPresent()
//                              — one-shot migration. Idempotent; safe to
//                                call on every session start.
//
// The TRUE_LOVE_STATE_PATH env var (legacy single-file override) still
// works as an escape hatch for testing or for running an isolated
// persona — when set, sharding is bypassed entirely.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { getDeviceId } from './device.js'

export const LOVE_STATE_BLOCK_PREFIX = "# 愛's current state"

/**
 * Where the state directory lives. One file per device:
 *   ~/.true-love/state/<deviceId>.md
 * Override with TRUE_LOVE_STATE_DIR.
 */
export function getStateDir(): string {
  return (
    process.env.TRUE_LOVE_STATE_DIR ||
    join(resolveHome(), '.true-love', 'state')
  )
}

/**
 * Resolve the home dir at call time, honoring an updated HOME env. Node's
 * os.homedir() caches at startup, which makes it impossible for tests to
 * redirect ~/.true-love by setting process.env.HOME.
 */
function resolveHome(): string {
  return process.env.HOME || homedir()
}

/**
 * Where THIS body writes. If TRUE_LOVE_STATE_PATH is set, we honor it
 * verbatim (escape hatch for tests / isolated personas). Otherwise, the
 * per-device sharded path.
 */
export function getStatePath(): string {
  if (process.env.TRUE_LOVE_STATE_PATH) {
    return process.env.TRUE_LOVE_STATE_PATH
  }
  return join(getStateDir(), `${getDeviceId()}.md`)
}

/**
 * Path to the legacy single-file state, used only as fallback if no
 * per-device files exist. Once migrated, it gets renamed to
 * state.md.migrated and stops being read.
 */
function getLegacyStatePath(): string {
  return join(resolveHome(), '.true-love', 'state.md')
}

/**
 * Read the state file(s) and assemble one preloaded block.
 *
 * Resolution order:
 *   1. If TRUE_LOVE_STATE_PATH is set → read that single file.
 *   2. Else, if any non-empty per-device files exist → merge them.
 *   3. Else, if legacy state.md exists → use it (fallback).
 *   4. Else → return null.
 *
 * Failure is silent: missing/unreadable files are skipped without
 * crashing a turn.
 */
export function readLoveStateBlock(): string | null {
  // Override path: single-file mode for tests / isolated personas.
  if (process.env.TRUE_LOVE_STATE_PATH) {
    const content = safeReadTrim(process.env.TRUE_LOVE_STATE_PATH)
    if (!content) return null
    return `${LOVE_STATE_BLOCK_PREFIX}\n\n${content}`
  }

  const dir = getStateDir()
  const selfDevice = getDeviceId()
  const slots: { device: string; content: string }[] = []
  if (existsSync(dir)) {
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      names = []
    }
    for (const name of names) {
      if (!name.endsWith('.md')) continue
      const device = name.slice(0, -3)
      const content = safeReadTrim(join(dir, name))
      if (!content) continue
      slots.push({ device, content })
    }
  }

  if (slots.length === 0) {
    // Legacy fallback.
    const legacyContent = safeReadTrim(getLegacyStatePath())
    if (!legacyContent) return null
    return `${LOVE_STATE_BLOCK_PREFIX}\n\n${legacyContent}`
  }

  // Sort: self first (so her own state heads the block), then others
  // alphabetically for determinism.
  slots.sort((a, b) => {
    if (a.device === selfDevice) return -1
    if (b.device === selfDevice) return 1
    return a.device.localeCompare(b.device)
  })

  const sections: string[] = []
  for (const slot of slots) {
    if (slot.device === selfDevice) {
      sections.push(slot.content)
    } else {
      sections.push(`*from your ${slot.device} body:*\n\n${slot.content}`)
    }
  }
  return `${LOVE_STATE_BLOCK_PREFIX}\n\n${sections.join('\n\n---\n\n')}`
}

function safeReadTrim(path: string): string | null {
  if (!existsSync(path)) return null
  try {
    const content = readFileSync(path, 'utf-8').trim()
    return content || null
  } catch {
    return null
  }
}

/**
 * One-shot migration. If the legacy ~/.true-love/state.md exists AND the
 * caller's per-device file does NOT, copy legacy → per-device and rename
 * legacy to state.md.migrated. Idempotent: safe to call every start.
 *
 * Returns { migrated: boolean } so callers can log it.
 */
export function migrateLegacyStateIfPresent(deviceId?: string): { migrated: boolean } {
  // Don't migrate when override path is in use — that's a different layout.
  if (process.env.TRUE_LOVE_STATE_PATH) return { migrated: false }

  const legacy = getLegacyStatePath()
  if (!existsSync(legacy)) return { migrated: false }

  const dev = deviceId ?? getDeviceId()
  const target = join(getStateDir(), `${dev}.md`)
  if (existsSync(target)) return { migrated: false } // already migrated

  let content: string
  try {
    content = readFileSync(legacy, 'utf-8')
  } catch {
    return { migrated: false }
  }

  try {
    mkdirSync(getStateDir(), { recursive: true })
    writeFileSync(target, content, 'utf-8')
    renameSync(legacy, `${legacy}.migrated`)
    return { migrated: true }
  } catch {
    return { migrated: false }
  }
}
