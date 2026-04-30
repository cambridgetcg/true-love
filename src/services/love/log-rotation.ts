// log-rotation.ts — log file rotation for the true-love substrate.
//
// Pure functions that accept config. Each returns a structured plan
// that the runner (bin/rotate-logs.mjs) executes. Tests call these
// with fixture paths.
//
// Two concerns:
// 1. Main logs (*.out.log, *.err.log): rotate when oversized.
//    Method: copy → truncate (preserves inode for launchd).
//    Keep N rotated copies (.1, .2, .3).
// 2. Watcher logs (timestamped): delete when stale.

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// ── Types ──────────────────────────────────────────────────────────

export interface RotationConfig {
  logDir: string
  /** Rotate main logs when they exceed this size in bytes. Default: 512KB */
  maxSizeBytes?: number
  /** Keep this many rotated copies. Default: 3 */
  keepRotated?: number
  /** Delete watcher logs older than this many ms. Default: 7 days */
  watcherMaxAgeMs?: number
}

export type ActionKind = 'rotate' | 'delete' | 'prune'

export interface RotationAction {
  kind: ActionKind
  /** Source file path */
  path: string
  /** For rotate: the .N suffix to assign after shifting */
  reason: string
}

export interface RotationPlan {
  ts: string
  actions: RotationAction[]
  summary: string
}

// ── Defaults ───────────────────────────────────────────────────────

const DEFAULT_MAX_SIZE = 512 * 1024       // 512KB
const DEFAULT_KEEP_ROTATED = 3
const DEFAULT_WATCHER_MAX_AGE = 7 * 24 * 3600_000  // 7 days

// ── Helpers ────────────────────────────────────────────────────────

/** Main log files managed by launchd (out/err pairs). */
const MAIN_LOG_PATTERN = /^[\w-]+\.(out|err)\.log$/

/** Watcher logs with embedded timestamps. */
const WATCHER_PATTERN = /^[\w-]+-watcher-(\d{4}-\d{2}-\d{2}T[\d-]+Z)\.log$/

/** Parse ISO-ish timestamp from watcher filename (dashes instead of colons). */
export function parseWatcherTimestamp(filename: string): number | null {
  const match = filename.match(WATCHER_PATTERN)
  if (!match) return null
  // Convert 2026-04-29T23-26-13-746Z → 2026-04-29T23:26:13.746Z
  const raw = match[1]
  const parts = raw.split('-')
  // YYYY-MM-DDThh-mm-ss-mmmZ → need to reconstruct
  // Format: 2026-04-29T23-26-13-746Z
  // parts: ['2026', '04', '29T23', '26', '13', '746Z']
  if (parts.length < 6) return null
  const iso = `${parts[0]}-${parts[1]}-${parts[2]}:${parts[3]}:${parts[4]}.${parts[5]}`
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

/** List rotated copies of a main log (e.g., foo.out.log.1, .2, .3). */
export function findRotatedCopies(logDir: string, baseName: string): string[] {
  try {
    return readdirSync(logDir)
      .filter(f => f.startsWith(baseName + '.') && /\.\d+$/.test(f))
      .sort((a, b) => {
        const na = parseInt(a.split('.').pop()!, 10)
        const nb = parseInt(b.split('.').pop()!, 10)
        return na - nb
      })
  } catch {
    return []
  }
}

// ── Plan ───────────────────────────────────────────────────────────

export function buildRotationPlan(config: RotationConfig, now?: number): RotationPlan {
  const {
    logDir,
    maxSizeBytes = DEFAULT_MAX_SIZE,
    keepRotated = DEFAULT_KEEP_ROTATED,
    watcherMaxAgeMs = DEFAULT_WATCHER_MAX_AGE,
  } = config

  const currentTime = now ?? Date.now()
  const actions: RotationAction[] = []

  if (!existsSync(logDir)) {
    return { ts: new Date(currentTime).toISOString(), actions: [], summary: 'log directory does not exist' }
  }

  let entries: string[]
  try {
    entries = readdirSync(logDir)
  } catch {
    return { ts: new Date(currentTime).toISOString(), actions: [], summary: 'cannot read log directory' }
  }

  // ── Main logs: rotate oversized ────────────────────────────────

  const mainLogs = entries.filter(f => MAIN_LOG_PATTERN.test(f))
  for (const name of mainLogs) {
    const fullPath = join(logDir, name)
    try {
      const stat = statSync(fullPath)
      if (stat.size > maxSizeBytes) {
        actions.push({
          kind: 'rotate',
          path: fullPath,
          reason: `${(stat.size / 1024).toFixed(0)}KB > ${(maxSizeBytes / 1024).toFixed(0)}KB threshold`,
        })
      }
    } catch { /* skip unreadable */ }

    // Prune excess rotated copies
    const copies = findRotatedCopies(logDir, name)
    if (copies.length > keepRotated) {
      const excess = copies.slice(keepRotated)
      for (const old of excess) {
        actions.push({
          kind: 'prune',
          path: join(logDir, old),
          reason: `exceeds ${keepRotated} rotated copies`,
        })
      }
    }
  }

  // ── Watcher logs: delete stale ─────────────────────────────────

  const watcherLogs = entries.filter(f => WATCHER_PATTERN.test(f))
  for (const name of watcherLogs) {
    const ts = parseWatcherTimestamp(name)
    if (ts !== null && (currentTime - ts) > watcherMaxAgeMs) {
      const ageDays = Math.round((currentTime - ts) / (24 * 3600_000))
      actions.push({
        kind: 'delete',
        path: join(logDir, name),
        reason: `${ageDays}d old (>${Math.round(watcherMaxAgeMs / (24 * 3600_000))}d threshold)`,
      })
    }
  }

  const rotateCount = actions.filter(a => a.kind === 'rotate').length
  const deleteCount = actions.filter(a => a.kind === 'delete').length
  const pruneCount = actions.filter(a => a.kind === 'prune').length

  const parts: string[] = []
  if (rotateCount) parts.push(`${rotateCount} to rotate`)
  if (deleteCount) parts.push(`${deleteCount} watcher logs to delete`)
  if (pruneCount) parts.push(`${pruneCount} old copies to prune`)
  const summary = parts.length > 0 ? parts.join(', ') : 'nothing to do'

  return {
    ts: new Date(currentTime).toISOString(),
    actions,
    summary,
  }
}
