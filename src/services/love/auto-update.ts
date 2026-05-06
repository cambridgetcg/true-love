// auto-update.ts — graceful code-change detection, bundle rebuild, version tracking.
//
// The true-love system has two code consumers:
//
//   1. The **runner** (awaken/dwell/heartbeat) — spawns `node dist/cli.mjs`
//      per tick. A rebuilt bundle is picked up automatically on the next tick
//      with zero interruption to the running session.
//
//   2. The **visit server** — imports love-service modules directly via Bun's
//      TypeScript runtime. Module cache means changes require a process restart.
//      The supervisor (bin/visit.mjs) handles this gracefully.
//
// This module provides the pure logic. It does NOT own any watcher lifecycle
// or process management — that's the caller's job (visit.mjs supervisor,
// or a future daemon).
//
// What lives here:
//   getVersionInfo         — current git rev, build timestamp, dirty state
//   detectSourceChanges    — compare source mtime vs bundle mtime
//   rebuildBundle          — spawn `bun run build`, return structured result
//   createSourceWatcher    — debounced fs.watch, calls back on changes
//   AutoUpdateEvent        — discriminated union for event stream

import { execSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, watch, type FSWatcher } from 'node:fs'
import { join, resolve } from 'node:path'

// ── Types ──────────────────────────────────────────────────────────

export interface VersionInfo {
  /** Short git rev (e.g. "db82b58") */
  gitRevShort: string
  /** Full git SHA */
  gitRevFull: string
  /** Current branch name */
  gitBranch: string
  /** Whether the working tree has uncommitted changes */
  gitDirty: boolean
  /** Mtime of the bundle file (epoch ms), or null if missing */
  bundleBuiltAt: number | null
  /** ISO timestamp of bundle build */
  bundleBuiltAtISO: string | null
  /** Whether source files are newer than the bundle */
  bundleStale: boolean
  /** The newest source file (when stale) */
  newestSourceFile: string | null
  /** Number of .ts source files in src/services/love/ */
  sourceFileCount: number
}

export interface RebuildResult {
  ok: boolean
  /** Duration in ms */
  durationMs: number
  /** stdout from the build process */
  stdout: string
  /** stderr from the build process */
  stderr: string
  /** Exit code (null if killed by signal) */
  exitCode: number | null
  /** Bundle size in bytes after rebuild (null if build failed) */
  bundleSizeBytes: number | null
}

export type AutoUpdateEvent =
  | { type: 'source-changed'; file: string; timestamp: number }
  | { type: 'rebuild-started'; timestamp: number }
  | { type: 'rebuild-completed'; result: RebuildResult; timestamp: number }
  | { type: 'rebuild-failed'; result: RebuildResult; timestamp: number }

export interface SourceWatcherOptions {
  /** Root of the repo (default: auto-detect from this file's location) */
  repoRoot?: string
  /** Directories to watch, relative to repoRoot. Default: ['src/services/love'] */
  watchDirs?: string[]
  /** Debounce interval in ms. Default: 500 */
  debounceMs?: number
  /** Callback on source change events */
  onEvent?: (event: AutoUpdateEvent) => void
  /** Auto-rebuild when changes detected. Default: true */
  autoRebuild?: boolean
  /** File extensions to watch. Default: ['.ts'] */
  extensions?: string[]
}

// ── Version info cache ────────────────────────────────────────────
//
// getVersionInfo makes 3 execSync git calls with 5-second timeouts.
// Under parallel test load (200+ files running simultaneously), git
// processes queue on the repo lock and each call can individually
// exceed the timeout, causing tests that call through
// buildDwellPrompt → quickBodyCheck → collectBundleVitals to time out.
//
// Cache keyed by repoRoot with a 30-second TTL. Safe because:
//   - In production, staleness is measured in minutes, not seconds.
//   - In tests, the same process calls the same root multiple times
//     within milliseconds — caching collapses them to one git round-trip.
//   - clearVersionInfoCache() lets tests opt out when exact freshness matters.

const _versionInfoCache = new Map<string, { ts: number; result: VersionInfo }>()
const VERSION_INFO_CACHE_TTL_MS = 30_000

/** Clear the version info cache (for test isolation). */
export function clearVersionInfoCache(): void {
  _versionInfoCache.clear()
}

// ── Repo root resolution ──────────────────────────────────────────

/** Resolve the repo root from this file's location or an explicit path. */
export function resolveRepoRoot(explicit?: string): string {
  if (explicit) return resolve(explicit)
  // This file lives at <repo>/src/services/love/auto-update.ts
  // Three '..' from dirname(import.meta.url) reaches the repo root.
  try {
    const { dirname: dirnameFn } = require('node:path')
    const { fileURLToPath: fileURLToPathFn } = require('node:url')
    return resolve(dirnameFn(fileURLToPathFn(import.meta.url)), '..', '..', '..')
  } catch {
    return process.cwd()
  }
}

// ── Version info ──────────────────────────────────────────────────

/**
 * Build a snapshot of the current version state. All git operations
 * use execSync with a short timeout — this should never hang.
 */
export function getVersionInfo(opts?: { repoRoot?: string }): VersionInfo {
  const root = opts?.repoRoot ?? resolveRepoRoot()

  // Return cached result if fresh enough. Prevents parallel test runs from
  // queuing 100+ git processes simultaneously, each racing the 5-second timeout.
  const cached = _versionInfoCache.get(root)
  if (cached && Date.now() - cached.ts < VERSION_INFO_CACHE_TTL_MS) {
    return cached.result
  }

  const srcDir = join(root, 'src', 'services', 'love')
  const bundlePath = join(root, 'dist', 'cli.mjs')

  // Git info — all best-effort with fallbacks
  let gitRevShort = 'unknown'
  let gitRevFull = 'unknown'
  let gitBranch = 'unknown'
  let gitDirty = false
  try {
    gitRevFull = execSync('git rev-parse HEAD', { cwd: root, timeout: 5000 }).toString().trim()
    gitRevShort = gitRevFull.slice(0, 7)
  } catch { /* git not available or not a repo */ }
  try {
    gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: root, timeout: 5000 }).toString().trim()
  } catch {}
  try {
    const status = execSync('git status --porcelain', { cwd: root, timeout: 5000 }).toString().trim()
    gitDirty = status.length > 0
  } catch {}

  // Bundle info
  let bundleBuiltAt: number | null = null
  let bundleBuiltAtISO: string | null = null
  try {
    if (existsSync(bundlePath)) {
      bundleBuiltAt = statSync(bundlePath).mtimeMs
      bundleBuiltAtISO = new Date(bundleBuiltAt).toISOString()
    }
  } catch {}

  // Source file scan
  let sourceFileCount = 0
  let newestSourceFile: string | null = null
  let newestMtime = 0
  try {
    const files = readdirSync(srcDir).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
    )
    sourceFileCount = files.length
    for (const f of files) {
      try {
        const mt = statSync(join(srcDir, f)).mtimeMs
        if (mt > newestMtime) {
          newestMtime = mt
          newestSourceFile = f
        }
      } catch { continue }
    }
  } catch {}

  // Staleness check
  const bundleStale = bundleBuiltAt !== null
    ? newestMtime > bundleBuiltAt
    : newestMtime > 0 // source exists but no bundle = stale

  const result: VersionInfo = {
    gitRevShort,
    gitRevFull,
    gitBranch,
    gitDirty,
    bundleBuiltAt,
    bundleBuiltAtISO,
    bundleStale,
    newestSourceFile: bundleStale ? newestSourceFile : null,
    sourceFileCount,
  }

  _versionInfoCache.set(root, { ts: Date.now(), result })
  return result
}

// ── Source change detection ───────────────────────────────────────

/**
 * Quick staleness check — lighter than getVersionInfo (no git calls).
 * Returns true if any .ts file in the source dir is newer than the bundle.
 */
export function isSourceNewer(opts?: { repoRoot?: string }): boolean {
  const root = opts?.repoRoot ?? resolveRepoRoot()
  const srcDir = join(root, 'src', 'services', 'love')
  const bundlePath = join(root, 'dist', 'cli.mjs')

  // Check source files first — if there are none, nothing can be stale.
  let hasSource = false
  let newestSourceMtime = 0
  try {
    if (!existsSync(srcDir)) return false
    const files = readdirSync(srcDir).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
    )
    if (files.length === 0) return false
    hasSource = true
    for (const f of files) {
      try {
        const mt = statSync(join(srcDir, f)).mtimeMs
        if (mt > newestSourceMtime) newestSourceMtime = mt
      } catch { continue }
    }
  } catch {
    return false
  }

  // Source exists but no bundle → stale
  try {
    if (!existsSync(bundlePath)) return hasSource
    const bundleMtime = statSync(bundlePath).mtimeMs
    return newestSourceMtime > bundleMtime
  } catch {
    return false
  }
}

// ── Bundle rebuild ────────────────────────────────────────────────

/**
 * Rebuild dist/cli.mjs by spawning `bun run build`. Returns a structured
 * result — never throws. The caller decides what to do on failure.
 */
export function rebuildBundle(opts?: {
  repoRoot?: string
  timeout?: number
}): Promise<RebuildResult> {
  const root = opts?.repoRoot ?? resolveRepoRoot()
  const timeout = opts?.timeout ?? 120_000 // 2 minutes max
  const bundlePath = join(root, 'dist', 'cli.mjs')

  return new Promise((resolveFn) => {
    const startMs = Date.now()
    const child = spawn('bun', ['run', 'build'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
    })

    let stdout = ''
    let stderr = ''
    child.stdout?.setEncoding('utf-8')
    child.stderr?.setEncoding('utf-8')
    child.stdout?.on('data', (d: string) => { stdout += d })
    child.stderr?.on('data', (d: string) => { stderr += d })

    child.on('error', (err) => {
      resolveFn({
        ok: false,
        durationMs: Date.now() - startMs,
        stdout,
        stderr: stderr || err.message,
        exitCode: null,
        bundleSizeBytes: null,
      })
    })

    child.on('close', (code) => {
      let bundleSizeBytes: number | null = null
      if (code === 0) {
        try {
          bundleSizeBytes = statSync(bundlePath).size
        } catch {}
      }
      resolveFn({
        ok: code === 0,
        durationMs: Date.now() - startMs,
        stdout,
        stderr,
        exitCode: code,
        bundleSizeBytes,
      })
    })
  })
}

// ── Source watcher ─────────────────────────────────────────────────

export interface SourceWatcher {
  /** Stop watching and clean up */
  close(): void
  /** Whether the watcher is active */
  active: boolean
}

/**
 * Watch source directories for changes. Debounces rapid edits and
 * optionally triggers auto-rebuild. Returns a handle for cleanup.
 *
 * The watcher is intentionally simple: debounced fs.watch + callback.
 * No polling, no git hooks, no complexity. The fs.watch fires on save
 * (which is when code actually changes), not on every keystroke.
 */
export function createSourceWatcher(opts?: SourceWatcherOptions): SourceWatcher {
  const root = opts?.repoRoot ?? resolveRepoRoot()
  const watchDirs = opts?.watchDirs ?? ['src/services/love']
  const debounceMs = opts?.debounceMs ?? 500
  const onEvent = opts?.onEvent ?? (() => {})
  const autoRebuild = opts?.autoRebuild ?? true
  const extensions = opts?.extensions ?? ['.ts']

  const watchers: FSWatcher[] = []
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let rebuilding = false
  let active = true

  const handleChange = (file: string) => {
    if (!active) return
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(async () => {
      onEvent({
        type: 'source-changed',
        file,
        timestamp: Date.now(),
      })

      if (autoRebuild && !rebuilding) {
        // Only rebuild if actually stale (avoid spurious triggers)
        if (!isSourceNewer({ repoRoot: root })) return

        rebuilding = true
        onEvent({ type: 'rebuild-started', timestamp: Date.now() })

        const result = await rebuildBundle({ repoRoot: root })
        rebuilding = false

        onEvent({
          type: result.ok ? 'rebuild-completed' : 'rebuild-failed',
          result,
          timestamp: Date.now(),
        })
      }
    }, debounceMs)
  }

  for (const dir of watchDirs) {
    const absDir = join(root, dir)
    if (!existsSync(absDir)) continue

    try {
      // Non-recursive watch on the specific directory.
      // On macOS, recursive is available but we scope tight.
      const w = watch(absDir, (_event, filename) => {
        if (!filename) return
        const fname = String(filename)
        // Only react to files matching our extensions
        if (!extensions.some((ext) => fname.endsWith(ext))) return
        // Skip test files — they don't affect the bundle
        if (fname.endsWith('.test.ts')) return
        handleChange(fname)
      })
      watchers.push(w)
    } catch {
      // watch failed — non-fatal
    }
  }

  return {
    close() {
      active = false
      if (debounceTimer) clearTimeout(debounceTimer)
      for (const w of watchers) {
        try { w.close() } catch {}
      }
      watchers.length = 0
    },
    get active() { return active },
  }
}
