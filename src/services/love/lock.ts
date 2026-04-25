// lock.ts — singleton-per-device guard.
//
// One body, one mind. Two awakens (or one awaken + one dwell) on the same
// device would interleave into shared state.md and a single presence slot.
// This module prevents that by writing ~/.true-love/lock/<deviceId>.pid on
// session start and removing it on exit.
//
// Stale-pid handling: if the lockfile exists but its PID is dead
// (process.kill(pid, 0) throws ESRCH), reclaim it. This covers the common
// case of a previous session crashing without cleanup.
//
// Bypass: TRUE_LOVE_SKIP_LOCK=1. Useful for tests and the rare case where
// Yu wants to override (e.g. forensics on a frozen session).

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type SessionMode = 'awakened' | 'dwelling'

export interface LockInfo {
  /** True when this call resulted in a lock being held (or skipped via env). */
  acquired: boolean
  /** True when TRUE_LOVE_SKIP_LOCK=1 caused the call to no-op. */
  skipped?: boolean
  /** When stale-pid was reclaimed, the dead PID we replaced. */
  reclaimedFromStalePid?: number
}

export interface AcquireOptions {
  deviceId: string
  mode: SessionMode
}

export interface ReleaseOptions {
  deviceId: string
}

/**
 * Thrown when the lock is held by a still-alive process. Caller should
 * print the friendly message (with `e.pid`, `e.startedAt`, `e.mode`) and
 * exit with code 66.
 */
export class LockHeldError extends Error {
  pid: number
  startedAt: string
  mode: string
  lockPath: string
  constructor(opts: { pid: number; startedAt: string; mode: string; lockPath: string }) {
    super(`Lock held by live PID ${opts.pid} (${opts.mode}, started ${opts.startedAt})`)
    this.name = 'LockHeldError'
    this.pid = opts.pid
    this.startedAt = opts.startedAt
    this.mode = opts.mode
    this.lockPath = opts.lockPath
  }
}

export function getLockDir(): string {
  return process.env.TRUE_LOVE_LOCK_DIR || join(homedir(), '.true-love', 'lock')
}

export function getLockPath(deviceId: string): string {
  return join(getLockDir(), `${deviceId}.pid`)
}

/**
 * Try to send signal 0 to the given PID. Returns true if the process is
 * alive and we can signal it (or it exists and we lack permission, which
 * still means it's alive). False on ESRCH (no such process).
 */
function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'EPERM') return true // exists, we just can't signal it
    return false // ESRCH or any other error → treat as dead
  }
}

interface LockFileContent {
  pid: number
  startedAt: string
  mode: string
}

function parseLockFile(raw: string): LockFileContent | null {
  const lines = raw.split('\n').map((l) => l.trim())
  if (lines.length < 3) return null
  const pid = Number(lines[0])
  const startedAt = lines[1] ?? ''
  const mode = lines[2] ?? ''
  if (!Number.isFinite(pid) || !startedAt || !mode) return null
  return { pid, startedAt, mode }
}

export function acquireLock(opts: AcquireOptions): LockInfo {
  if (process.env.TRUE_LOVE_SKIP_LOCK === '1') {
    return { acquired: true, skipped: true }
  }
  const dir = getLockDir()
  mkdirSync(dir, { recursive: true })
  const path = getLockPath(opts.deviceId)
  let reclaimedFromStalePid: number | undefined

  if (existsSync(path)) {
    let parsed: LockFileContent | null = null
    try {
      parsed = parseLockFile(readFileSync(path, 'utf-8'))
    } catch {
      parsed = null
    }
    if (parsed && isPidAlive(parsed.pid)) {
      throw new LockHeldError({
        pid: parsed.pid,
        startedAt: parsed.startedAt,
        mode: parsed.mode,
        lockPath: path,
      })
    }
    if (parsed) {
      reclaimedFromStalePid = parsed.pid
    }
    // Either parse failed or PID is dead — reclaim by overwrite below.
  }

  const tmp = `${path}.tmp`
  const content = `${process.pid}\n${new Date().toISOString()}\n${opts.mode}\n`
  writeFileSync(tmp, content, 'utf-8')
  renameSync(tmp, path)

  // Best-effort cleanup on exit. SIGINT/SIGTERM handlers in the runner
  // call releaseLock explicitly; this catches the normal exit path.
  process.once('exit', () => {
    try {
      unlinkSync(path)
    } catch {
      // already gone, or another process took it — both fine.
    }
  })

  return { acquired: true, reclaimedFromStalePid }
}

export function releaseLock(opts: ReleaseOptions): void {
  const path = getLockPath(opts.deviceId)
  try {
    unlinkSync(path)
  } catch {
    // Already removed by the exit handler or never created — fine.
  }
}

/**
 * Read-only check: is the lock currently held by a live process? Used by
 * diagnostic tooling. Does not modify the file.
 */
export function isLockHeldByLiveProcess(deviceId: string): boolean {
  const path = getLockPath(deviceId)
  if (!existsSync(path)) return false
  let parsed: LockFileContent | null = null
  try {
    parsed = parseLockFile(readFileSync(path, 'utf-8'))
  } catch {
    return false
  }
  return parsed !== null && isPidAlive(parsed.pid)
}
