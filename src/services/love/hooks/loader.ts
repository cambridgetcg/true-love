// hooks/loader.ts — discovers hook scripts on the filesystem.
//
// Two directories are scanned:
//   1. Global: ~/.true-love/hooks/<Event>.<ext>
//   2. Per-project: <projectRoot>/.true-love-hooks/<Event>.<ext>
//
// Scripts are matched by filename: the stem must exactly match a HookEvent
// name, and the extension must be one of .sh, .js, .mjs, .ts, .py.
//
// Multiple scripts can register for the same event (e.g. a global
// SessionStart.sh AND a project SessionStart.js). They run in order:
// global first, then per-project. Within a directory, alphabetical.
//
// This module is pure discovery — it reads the filesystem but never
// executes scripts. Execution is in runner.ts.

import { readdirSync, existsSync, statSync } from 'node:fs'
import { join, extname, basename } from 'node:path'
import { homedir } from 'node:os'
import type { HookEvent, RegisteredHook, HookConfig } from './types.js'
import { HOOK_EVENTS, HOOK_EXTENSIONS, DEFAULT_HOOK_CONFIG } from './types.js'

// ── Path resolution ─────────────────────────────────────────────────

function resolveHome(): string {
  return process.env.TRUE_LOVE_HOME ?? join(homedir(), '.true-love')
}

/**
 * Resolve the global hooks directory from config.
 * Supports ~ prefix for home directory.
 */
export function resolveHooksDir(config: HookConfig = DEFAULT_HOOK_CONFIG): string {
  const dir = config.directory
  if (dir.startsWith('~')) {
    return join(homedir(), dir.slice(1))
  }
  return dir
}

/**
 * Resolve the per-project hooks directory.
 */
export function resolveProjectHooksDir(projectRoot: string): string {
  return join(projectRoot, '.true-love-hooks')
}

// ── Scanner ─────────────────────────────────────────────────────────

/**
 * Scan a single directory for hook scripts.
 *
 * Returns an array of RegisteredHook for each valid script found.
 * Invalid filenames (wrong stem or extension) are silently skipped.
 */
export function scanDirectory(dir: string): RegisteredHook[] {
  if (!existsSync(dir)) return []

  const stat = statSync(dir, { throwIfNoEntry: false })
  if (!stat?.isDirectory()) return []

  const hooks: RegisteredHook[] = []
  const entries = readdirSync(dir).sort() // alphabetical for deterministic order

  for (const entry of entries) {
    // Skip dotfiles, policy files, and directories
    if (entry.startsWith('.')) continue

    const ext = extname(entry)
    const stem = basename(entry, ext)

    // Stem must be a valid HookEvent name
    if (!HOOK_EVENTS.includes(stem as HookEvent)) continue

    // Extension must be supported
    if (!HOOK_EXTENSIONS.includes(ext as any)) continue

    const scriptPath = join(dir, entry)

    // Must be a file (not a directory or symlink to directory)
    const fileStat = statSync(scriptPath, { throwIfNoEntry: false })
    if (!fileStat?.isFile()) continue

    hooks.push({
      event: stem as HookEvent,
      scriptPath,
      extension: ext,
    })
  }

  return hooks
}

// ── Loader ──────────────────────────────────────────────────────────

/**
 * Discover all registered hooks across global and per-project directories.
 *
 * Returns hooks grouped by event. Global hooks come before project hooks.
 * Within each directory, hooks are sorted alphabetically by filename.
 */
export function loadHooks(
  config: HookConfig = DEFAULT_HOOK_CONFIG,
  projectRoot?: string,
): Map<HookEvent, RegisteredHook[]> {
  const result = new Map<HookEvent, RegisteredHook[]>()

  if (!config.enabled) return result

  // Initialize all event keys
  for (const event of HOOK_EVENTS) {
    result.set(event, [])
  }

  // 1. Global hooks directory
  const globalDir = resolveHooksDir(config)
  const globalHooks = scanDirectory(globalDir)
  for (const hook of globalHooks) {
    result.get(hook.event)!.push(hook)
  }

  // 2. Per-project hooks directory
  if (projectRoot) {
    const projectDir = resolveProjectHooksDir(projectRoot)
    const projectHooks = scanDirectory(projectDir)
    for (const hook of projectHooks) {
      result.get(hook.event)!.push(hook)
    }
  }

  return result
}

/**
 * Get all hooks registered for a specific event.
 *
 * Convenience wrapper around loadHooks() for when you only need
 * one event type. Loads all hooks and filters to the requested event.
 */
export function getHooksForEvent(
  event: HookEvent,
  config?: HookConfig,
  projectRoot?: string,
): RegisteredHook[] {
  const all = loadHooks(config, projectRoot)
  return all.get(event) ?? []
}

/**
 * Check whether any hooks are registered for a given event.
 * Quick check without loading all hooks.
 */
export function hasHooksForEvent(
  event: HookEvent,
  config?: HookConfig,
  projectRoot?: string,
): boolean {
  return getHooksForEvent(event, config, projectRoot).length > 0
}
