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

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type LockMode = 'awakened' | 'dwell' | 'heartbeat'

export interface LockInfo {
  /** True when this call resulted in a lock being held (or skipped via env). */
  acquired: boolean
  /** True when TRUE_LOVE_SKIP_LOCK=1 caused the call to no-op. */
  skipped?: boolean
  /** When stale-pid was reclaimed, the dead PID we replaced. */
  reclaimedFromStalePid?: number
}

export interface AcquireOptions {
  /**
   * Either deviceId (with default per-device path) OR lockPath (caller-
   * specified, e.g. for per-scope locks). At least one must be set;
   * lockPath wins when both are provided.
   */
  deviceId?: string
  lockPath?: string
  mode: LockMode
}

export interface ReleaseOptions {
  deviceId?: string
  lockPath?: string
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

// Module-level state for exit-handler cleanup. One handler covers all
// locks held by this process; releaseLock removes paths from the set so
// acquire→release→acquire cycles don't leak stale closures.
const heldLockPaths = new Set<string>()
let exitHandlerInstalled = false

function installExitHandlerOnce(): void {
  if (exitHandlerInstalled) return
  exitHandlerInstalled = true
  process.on('exit', () => {
    for (const path of heldLockPaths) {
      try {
        unlinkSync(path)
      } catch {
        // already gone, or another process took it — both fine.
      }
    }
  })
}

function resolveLockPath(opts: { deviceId?: string; lockPath?: string }): string {
  if (opts.lockPath) return opts.lockPath
  if (opts.deviceId) return getLockPath(opts.deviceId)
  throw new Error('lock: either deviceId or lockPath must be provided')
}

export function acquireLock(opts: AcquireOptions): LockInfo {
  if (process.env.TRUE_LOVE_SKIP_LOCK === '1') {
    return { acquired: true, skipped: true }
  }
  const path = resolveLockPath(opts)
  const dir = path.replace(/\/[^/]+$/, '')
  mkdirSync(dir, { recursive: true })
  const content = `${process.pid}\n${new Date().toISOString()}\n${opts.mode}\n`

  // Up to two attempts: the second exists only to handle the case where
  // we observed a stale file, unlinked it, and a third party raced into
  // the gap with their own fresh file. Cap at 1 retry to avoid spinning
  // on filesystem weirdness.
  let reclaimedFromStalePid: number | undefined
  for (let attempt = 0; attempt < 2; attempt++) {
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
      // Stale (dead PID or unparseable). Remove and fall through to wx.
      if (parsed) reclaimedFromStalePid = parsed.pid
      try {
        unlinkSync(path)
      } catch {
        // Someone else removed it between our read and unlink — fine,
        // the wx-write below will succeed or EEXIST will loop us back.
      }
    }

    try {
      // 'wx' = O_CREAT | O_EXCL: atomic create-only. EEXIST if a racing
      // process landed a file in the window between our unlink and now.
      writeFileSync(path, content, { flag: 'wx', encoding: 'utf-8' })
      heldLockPaths.add(path)
      installExitHandlerOnce()
      return { acquired: true, reclaimedFromStalePid }
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code !== 'EEXIST') throw e
      // Lost the race. Loop once: re-read, re-check live/stale, and
      // either throw LockHeldError (live winner) or retry (stale).
    }
  }

  // Two attempts both EEXIST'd against still-stale files — extremely
  // unlikely outside of malicious churn. Surface as LockHeldError using
  // whatever the file currently claims, so the caller fails loudly
  // rather than silently overwriting.
  let parsed: LockFileContent | null = null
  try {
    parsed = parseLockFile(readFileSync(path, 'utf-8'))
  } catch {
    parsed = null
  }
  throw new LockHeldError({
    pid: parsed?.pid ?? 0,
    startedAt: parsed?.startedAt ?? '',
    mode: parsed?.mode ?? '',
    lockPath: path,
  })
}

export function releaseLock(opts: ReleaseOptions): void {
  const path = resolveLockPath(opts)
  try {
    unlinkSync(path)
  } catch {
    // Already removed by the exit handler or never created — fine.
  }
  heldLockPaths.delete(path)
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
