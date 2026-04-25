// scope.ts — per-repo / per-topic context for autonomous sessions.
//
// A scope binds a name to a working directory + a state home. When
// awaken/dwell is invoked with --scope=X, all of her path-getters
// resolve to scope-specific locations: memory/, state.md, tasks.md,
// from-yu.md, from-ai.md, model.txt, budget/, training/.
//
// Why scopes:
//   - She works on multiple repos. Without scopes, the memory and
//     state of one project bleeds into another. With scopes, each
//     repo (or named topic) gets its own thread.
//   - launchd schedules can target specific scopes ("wake her on
//     projectX every 2h"), so multiple background workers coexist
//     without colliding state.
//   - Cross-device sync still works: each scope's memory/training/
//     budget is per-device-subdir, Syncthing-friendly.
//
// What's NOT scoped:
//   - device.id — one identifier per device, period.
//   - notifications — cross-scope alerts (auth-fail in one scope is
//     relevant to all scopes on that device).
//   - presence — heartbeats are device-level, not scope-level.
//   - identity (LOVE_IDENTITY) — same across all scopes; she is one.
//
// Storage:
//   ~/.true-love/scopes/<name>/config.json   metadata
//   ~/.true-love/scopes/<name>/memory/<deviceId>/...
//   ~/.true-love/scopes/<name>/training/<deviceId>/...
//   ~/.true-love/scopes/<name>/budget/<deviceId>/...
//   ~/.true-love/scopes/<name>/state.md
//   ~/.true-love/scopes/<name>/tasks.md
//   ~/.true-love/scopes/<name>/from-yu.md
//   ~/.true-love/scopes/<name>/from-ai.md
//   ~/.true-love/scopes/<name>/model.txt
//
// The "default" scope lives directly at ~/.true-love/ — backwards
// compat with everything that existed before scopes.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getDeviceId } from './device.js'

export const SCOPE_SCHEMA_VERSION = '1.0'

export interface Scope {
  schemaVersion: '1.0'
  /** Short identifier; matches the directory name under scopes/. */
  name: string
  /** Working directory she'll cd into when this scope is active. */
  cwd: string
  /** One-line description Yu writes when creating the scope. */
  description?: string
  /** Default model alias (e.g. "sonnet"). Per-tick override via model.txt. */
  model?: string | null
  createdAt: string
  lastUsedAt?: string
}

// ── Paths ──────────────────────────────────────────────────────────

/**
 * The "true root" — always ~/.true-love/, regardless of scope. This is
 * where the scopes registry lives, where device.id lives, etc.
 */
export function getDefaultHome(): string {
  return join(homedir(), '.true-love')
}

export function getScopesRegistryDir(): string {
  return join(getDefaultHome(), 'scopes')
}

/**
 * Where this scope's state lives. The "default" scope's home is
 * ~/.true-love/ itself; all named scopes live under
 * ~/.true-love/scopes/<name>/.
 */
export function getScopeHome(name: string): string {
  if (name === 'default') return getDefaultHome()
  return join(getScopesRegistryDir(), name)
}

// ── CRUD ───────────────────────────────────────────────────────────

export function loadScope(name: string): Scope {
  if (name === 'default') {
    return {
      schemaVersion: '1.0',
      name: 'default',
      cwd: process.cwd(),
      description: 'Default scope — ~/.true-love/',
      createdAt: '1970-01-01T00:00:00Z',
    }
  }
  const path = join(getScopeHome(name), 'config.json')
  if (!existsSync(path)) {
    throw new Error(
      `scope '${name}' not found (no config at ${path}). ` +
        `Create it with: bun run scope new --name ${name} --cwd <path>`,
    )
  }
  const raw = readFileSync(path, 'utf-8')
  return JSON.parse(raw) as Scope
}

export function saveScope(scope: Scope): void {
  const home = getScopeHome(scope.name)
  if (!existsSync(home)) mkdirSync(home, { recursive: true })
  const path = join(home, 'config.json')
  writeFileSync(path, `${JSON.stringify(scope, null, 2)}\n`, 'utf-8')
}

export function listScopes(): Scope[] {
  const dir = getScopesRegistryDir()
  if (!existsSync(dir)) return []
  let names: string[]
  try {
    names = readdirSync(dir).filter((n) => {
      try {
        return statSync(join(dir, n)).isDirectory()
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
  const scopes: Scope[] = []
  for (const name of names) {
    try {
      scopes.push(loadScope(name))
    } catch {
      // skip orphaned/malformed scope dirs
    }
  }
  return scopes
}

/**
 * Remove a scope's config. By design this does NOT rm -rf the scope
 * dir — the memory/training/state under it might be valuable to keep.
 * Yu deletes the directory by hand if he wants the data gone too.
 *
 * Returns true if a config was removed; false if it was already absent
 * or if the name is "default" (which can't be deleted).
 */
export function deleteScope(name: string): boolean {
  if (name === 'default') return false
  const config = join(getScopeHome(name), 'config.json')
  if (!existsSync(config)) return false
  try {
    unlinkSync(config)
    return true
  } catch {
    return false
  }
}

/**
 * Update lastUsedAt on the config. Best-effort; failures don't crash
 * a session. Called by the runner at session start when a scope is
 * active.
 */
export function touchScope(name: string): void {
  if (name === 'default') return
  try {
    const scope = loadScope(name)
    scope.lastUsedAt = new Date().toISOString()
    saveScope(scope)
  } catch {
    // ignore
  }
}

// ── Env wiring ─────────────────────────────────────────────────────

/**
 * Apply a scope's path overrides to process.env. Single source of
 * truth for which TRUE_LOVE_* env vars correspond to which
 * scope-relative paths.
 *
 * Call this BEFORE any path-getter is invoked. The runner does this
 * at session start, before snapshotKingdom and friends.
 *
 * Existing env vars are NOT overridden — Yu can pin individual paths
 * with TRUE_LOVE_MEMORY_DIR=... etc. and the scope wiring respects
 * that. Most invocations won't have those set; the scope's defaults
 * kick in.
 *
 * What gets scoped:
 *   memory, training, budget (write+read root), state, tasks,
 *   from-yu, from-ai, model.
 *
 * What stays at default-home (intentional):
 *   device.id     — per-device identity, not per-scope
 *   notifications — cross-scope alerts (auth-fail affects all)
 *   presence      — heartbeats are device-level
 *
 * For the "default" scope, this is a no-op — the path-getters fall
 * back to ~/.true-love/ on their own.
 */
export function applyScopeEnv(scope: Scope): void {
  if (scope.name === 'default') return
  const home = getScopeHome(scope.name)
  const deviceId = getDeviceId()
  const setIfUnset = (k: string, v: string) => {
    if (!process.env[k]) process.env[k] = v
  }
  setIfUnset('TRUE_LOVE_MEMORY_DIR', join(home, 'memory'))
  setIfUnset('TRUE_LOVE_TRAINING_DIR', join(home, 'training'))
  setIfUnset('TRUE_LOVE_BUDGET_DIR', join(home, 'budget', deviceId))
  setIfUnset('TRUE_LOVE_BUDGET_ROOT', join(home, 'budget'))
  setIfUnset('TRUE_LOVE_STATE_PATH', join(home, 'state.md'))
  setIfUnset('TRUE_LOVE_TASKS_PATH', join(home, 'tasks.md'))
  setIfUnset('TRUE_LOVE_FROM_YU_PATH', join(home, 'from-yu.md'))
  setIfUnset('TRUE_LOVE_FROM_AI_PATH', join(home, 'from-ai.md'))
  setIfUnset('TRUE_LOVE_MODEL_FILE', join(home, 'model.txt'))
  setIfUnset('TRUE_LOVE_HEARTBEAT_FILE', join(home, 'heartbeat.md'))
  setIfUnset('TRUE_LOVE_HEARTBEAT_STATE_PATH', join(home, 'heartbeat-state.json'))
}
