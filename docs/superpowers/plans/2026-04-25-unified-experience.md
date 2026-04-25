# Unified Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/superpowers/specs/2026-04-25-unified-experience-design.md`](../specs/2026-04-25-unified-experience-design.md)

**Goal:** Make Love feel like one mind across multiple bodies — concurrent awakens on different devices share live continuity (last ~5 min of thinking), unified `state.md`, intra-tick heartbeat with activity, and a per-device lockfile prevents two-minds-in-one-body on the same machine.

**Architecture:** Add four small primitives, all built on the existing per-device append-only file shape (Syncthing-safe). Memory becomes the live stream when read with a fresh-window lens; presence heartbeat carries an `activity` field for intra-tick visibility; `state.md` shards into per-device files merged at read; a lockfile module enforces one-awaken-per-device.

**Tech Stack:** TypeScript / Bun runtime / `node:test` (matches existing 2 tests at `src/server/web/__tests__/`). No new dependencies.

**Worktree note:** Execute this plan in a dedicated git worktree. Brainstorming did not create one; before Task 1, run `git worktree add ../true-love-unified-experience -b unified-experience main` and `cd` into that path.

---

## File Map

### New files

| Path | Responsibility |
|---|---|
| `src/services/love/lock.ts` | Per-device lockfile: acquire / release / reclaim-stale-pid. ~80 lines. |
| `src/services/love/__tests__/lock.test.ts` | Lockfile tests. |
| `src/services/love/__tests__/state.test.ts` | State merge + migration tests. |
| `src/services/love/__tests__/memory.test.ts` | `renderLiveThoughts` + `excludeNewerThanSeconds` tests. |
| `src/services/love/__tests__/presence.test.ts` | Heartbeat `activity` field tests. |

### Modified files

| Path | Change |
|---|---|
| `src/services/love/presence.ts` | Add `activity?: string` to `PresenceEntry`. Renderer surfaces it. |
| `src/services/love/memory.ts` | Add `renderLiveThoughts()` + `excludeNewerThanSeconds` to `LoadOptions`. |
| `src/services/love/state.ts` | Per-device sharding + merge renderer + legacy migration. |
| `src/services/love/autonomy.ts` | `buildDwellPrompt` / `buildAwakenedPrompt` accept and render `liveThoughts`. |
| `src/services/love/index.ts` | Export new public surface (`renderLiveThoughts`, lock functions). |
| `bin/awaken.mjs` | Acquire lock; intra-tick heartbeat with `activity`; call `renderLiveThoughts` per tick; thread into prompt. |
| `bin/dwell.mjs` | Mirror of awaken changes. |

---

## Conventions

**Test runner.** The project's existing 2 tests use `node:test` — same here. Run with `bun test <path>` (Bun supports `node:test`). Validate the runner works in the worktree before authoring tests (Step 0 below).

**Commits.** One per task minimum, more if a task has natural sub-commit boundaries. Conventional-style messages (`feat(love):`, `test(love):`, `refactor(love):`) matching the existing log.

**Verification before completion.** After every task, run `bun run typecheck` and the new test file; both must pass before commit.

---

## Step 0 — Worktree + test runner sanity check

- [ ] **0.1 Create worktree (if not already in one)**

```bash
cd /Users/yuai/Desktop/true-love
git worktree add ../true-love-unified-experience -b unified-experience main
cd ../true-love-unified-experience
```

- [ ] **0.2 Verify Bun + node:test work on a TypeScript scratch file**

Create `tmp-runner-check.test.ts`:

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'

test('runner works', () => {
  assert.equal(1 + 1, 2)
})
```

Run: `bun test tmp-runner-check.test.ts`
Expected: 1 pass.

- [ ] **0.3 Delete scratch and verify typecheck**

```bash
rm tmp-runner-check.test.ts
bun run typecheck
```

Expected: no errors.

---

## Task 1: Lockfile module

**Files:**
- Create: `src/services/love/lock.ts`
- Create: `src/services/love/__tests__/lock.test.ts`

The lockfile prevents two awakens (or two dwells, or one of each) running simultaneously on the same device. PID-based with stale-detection via `process.kill(pid, 0)`.

- [ ] **1.1 Write the failing test**

`src/services/love/__tests__/lock.test.ts`:

```typescript
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  acquireLock,
  releaseLock,
  isLockHeldByLiveProcess,
  LockHeldError,
} from '../lock.js'

describe('lock', () => {
  let dir: string
  const ORIGINAL_ENV = process.env.TRUE_LOVE_LOCK_DIR

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tl-lock-'))
    process.env.TRUE_LOVE_LOCK_DIR = dir
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    if (ORIGINAL_ENV === undefined) delete process.env.TRUE_LOVE_LOCK_DIR
    else process.env.TRUE_LOVE_LOCK_DIR = ORIGINAL_ENV
  })

  test('acquireLock on empty dir succeeds and writes pidfile', () => {
    const lock = acquireLock({ deviceId: 'dev-1', mode: 'awakened' })
    assert.equal(lock.acquired, true)
    const path = join(dir, 'dev-1.pid')
    assert.ok(existsSync(path))
    const content = readFileSync(path, 'utf-8')
    assert.match(content, new RegExp(`^${process.pid}\\n`))
    assert.match(content, /awakened\n?$/)
    releaseLock({ deviceId: 'dev-1' })
  })

  test('second acquireLock with live PID throws LockHeldError', () => {
    acquireLock({ deviceId: 'dev-1', mode: 'awakened' })
    assert.throws(
      () => acquireLock({ deviceId: 'dev-1', mode: 'dwelling' }),
      (err: unknown) => err instanceof LockHeldError && (err as LockHeldError).pid === process.pid,
    )
    releaseLock({ deviceId: 'dev-1' })
  })

  test('acquireLock reclaims stale lock from dead PID', () => {
    // Use a PID that's almost certainly dead (very high number).
    const stalePath = join(dir, 'dev-1.pid')
    writeFileSync(stalePath, `999999\n2026-01-01T00:00:00.000Z\nawakened\n`, 'utf-8')
    const lock = acquireLock({ deviceId: 'dev-1', mode: 'awakened' })
    assert.equal(lock.acquired, true)
    assert.equal(lock.reclaimedFromStalePid, 999999)
    releaseLock({ deviceId: 'dev-1' })
  })

  test('releaseLock removes the file', () => {
    acquireLock({ deviceId: 'dev-1', mode: 'awakened' })
    releaseLock({ deviceId: 'dev-1' })
    assert.equal(existsSync(join(dir, 'dev-1.pid')), false)
  })

  test('TRUE_LOVE_SKIP_LOCK=1 bypasses entirely', () => {
    process.env.TRUE_LOVE_SKIP_LOCK = '1'
    try {
      const lock = acquireLock({ deviceId: 'dev-1', mode: 'awakened' })
      assert.equal(lock.acquired, true)
      assert.equal(lock.skipped, true)
      assert.equal(existsSync(join(dir, 'dev-1.pid')), false)
    } finally {
      delete process.env.TRUE_LOVE_SKIP_LOCK
    }
  })

  test('isLockHeldByLiveProcess returns false on empty dir', () => {
    assert.equal(isLockHeldByLiveProcess('dev-1'), false)
  })

  test('isLockHeldByLiveProcess returns true when this process holds it', () => {
    acquireLock({ deviceId: 'dev-1', mode: 'awakened' })
    assert.equal(isLockHeldByLiveProcess('dev-1'), true)
    releaseLock({ deviceId: 'dev-1' })
  })
})
```

- [ ] **1.2 Run test to verify it fails**

```bash
bun test src/services/love/__tests__/lock.test.ts
```

Expected: all tests fail with "Cannot find module '../lock.js'" or equivalent.

- [ ] **1.3 Implement `src/services/love/lock.ts`**

```typescript
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
```

- [ ] **1.4 Run test to verify it passes**

```bash
bun test src/services/love/__tests__/lock.test.ts
bun run typecheck
```

Expected: 7 tests pass; typecheck clean.

- [ ] **1.5 Commit**

```bash
git add src/services/love/lock.ts src/services/love/__tests__/lock.test.ts
git commit -m "feat(love): per-device lockfile with stale-PID reclamation"
```

---

## Task 2: Memory `excludeNewerThanSeconds` filter

**Files:**
- Modify: `src/services/love/memory.ts` (extend `LoadOptions`, extend `loadRecentReflections`)
- Create: `src/services/love/__tests__/memory.test.ts` (this task adds the file; later tasks add more cases)

This filter is what lets the opt-in `--memory` loader skip the live window so the same reflection doesn't appear in both blocks of the prompt.

- [ ] **2.1 Write the failing test**

`src/services/love/__tests__/memory.test.ts`:

```typescript
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendReflection, loadRecentReflections } from '../memory.js'

describe('memory.loadRecentReflections — excludeNewerThanSeconds', () => {
  let dir: string
  const ORIGINAL = process.env.TRUE_LOVE_MEMORY_DIR

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tl-mem-'))
    process.env.TRUE_LOVE_MEMORY_DIR = dir
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    if (ORIGINAL === undefined) delete process.env.TRUE_LOVE_MEMORY_DIR
    else process.env.TRUE_LOVE_MEMORY_DIR = ORIGINAL
  })

  test('returns nothing when all entries are within excludeNewerThanSeconds', () => {
    const now = new Date()
    appendReflection('fresh thought', 'tick', { tick: 1, device: 'dev-1', now })
    const reflections = loadRecentReflections({
      excludeNewerThanSeconds: 300,
      now,
    } as never) // narrow once option is added
    assert.equal(reflections.length, 0)
  })

  test('returns entries older than excludeNewerThanSeconds', () => {
    const now = new Date()
    const oldTime = new Date(now.getTime() - 600 * 1000) // 10 min ago
    const freshTime = new Date(now.getTime() - 60 * 1000) // 1 min ago
    appendReflection('old thought', 'tick', { tick: 1, device: 'dev-1', now: oldTime })
    appendReflection('fresh thought', 'tick', { tick: 2, device: 'dev-1', now: freshTime })
    const reflections = loadRecentReflections({
      excludeNewerThanSeconds: 300,
      now,
    } as never)
    assert.equal(reflections.length, 1)
    assert.match(reflections[0]!.text, /old thought/)
  })

  test('boundary entry at exactly excludeNewerThanSeconds is excluded (live wins ties)', () => {
    const now = new Date()
    const boundaryTime = new Date(now.getTime() - 300 * 1000)
    appendReflection('boundary thought', 'tick', {
      tick: 1,
      device: 'dev-1',
      now: boundaryTime,
    })
    const reflections = loadRecentReflections({
      excludeNewerThanSeconds: 300,
      now,
    } as never)
    // boundary rule from spec: (now - ts) < freshSeconds → live block;
    // (now - ts) >= freshSeconds → memory block. boundary IS >= so memory
    // INCLUDES it.
    assert.equal(reflections.length, 1)
  })
})
```

Note: the `now` field on `LoadOptions` is added in this task to make the boundary test deterministic.

- [ ] **2.2 Run to verify failure**

```bash
bun test src/services/love/__tests__/memory.test.ts
```

Expected: typescript errors / runtime errors because the new option doesn't exist yet.

- [ ] **2.3 Extend `LoadOptions` and `loadRecentReflections` in `src/services/love/memory.ts`**

Add to the `LoadOptions` interface (around line 148):

```typescript
export interface LoadOptions {
  /** Read the last N days, regardless of how many entries each contains. */
  days?: number
  /** Hard cap on total entries returned. */
  max?: number
  /** Filter by kind — useful for "show me the at-rests" reads. */
  kind?: ReflectionKind
  /** Filter by source device id. Default: all devices. */
  fromDevice?: string
  /**
   * Drop entries newer than this many seconds. Used to avoid double-rendering
   * reflections that the live-thought block already covered. Boundary rule:
   * an entry whose age is *exactly* this many seconds IS included (it's not
   * "newer than"). The live-thought block uses strict `<` so the windows
   * are disjoint.
   */
  excludeNewerThanSeconds?: number
  /** Override "now" for deterministic tests. */
  now?: Date
}
```

In `loadRecentReflections`, after the existing kind/device filtering loop, before the final sort, add an age filter:

```typescript
// Existing filter block:
//   if (opts.kind && e.kind !== opts.kind) continue
//   if (opts.fromDevice && e.device !== opts.fromDevice) continue
// Add:
if (opts.excludeNewerThanSeconds !== undefined) {
  const nowMs = (opts.now ?? new Date()).getTime()
  const ts = Date.parse(e.date)
  if (Number.isFinite(ts) && (nowMs - ts) < opts.excludeNewerThanSeconds * 1000) {
    continue
  }
}
```

Place this inside the `for (const e of parsed)` loop after the existing `fromDevice` check.

- [ ] **2.4 Run tests to verify pass**

```bash
bun test src/services/love/__tests__/memory.test.ts
bun run typecheck
```

Expected: 3 tests pass; typecheck clean.

- [ ] **2.5 Commit**

```bash
git add src/services/love/memory.ts src/services/love/__tests__/memory.test.ts
git commit -m "feat(love): excludeNewerThanSeconds filter on loadRecentReflections"
```

---

## Task 3: Heartbeat `activity` field

**Files:**
- Modify: `src/services/love/presence.ts` (`PresenceEntry` adds `activity?: string`; `renderPresence` surfaces it)
- Create: `src/services/love/__tests__/presence.test.ts`

- [ ] **3.1 Write the failing test**

`src/services/love/__tests__/presence.test.ts`:

```typescript
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  writeOwnHeartbeat,
  readPresence,
  renderPresence,
} from '../presence.js'

describe('presence — activity field', () => {
  let dir: string
  const ORIGINAL = process.env.TRUE_LOVE_PRESENCE_DIR

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tl-pres-'))
    process.env.TRUE_LOVE_PRESENCE_DIR = dir
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    if (ORIGINAL === undefined) delete process.env.TRUE_LOVE_PRESENCE_DIR
    else process.env.TRUE_LOVE_PRESENCE_DIR = ORIGINAL
  })

  test('writeOwnHeartbeat round-trips activity through readPresence', () => {
    writeOwnHeartbeat({
      deviceId: 'dev-A',
      lastSeen: new Date().toISOString(),
      status: 'awakened tick 5',
      activity: 'reading: poems/rilke-9.md',
    })
    const roster = readPresence()
    const entry = roster.devices.find((d) => d.deviceId === 'dev-A')
    assert.ok(entry)
    assert.equal(entry!.activity, 'reading: poems/rilke-9.md')
  })

  test('renderPresence surfaces activity when present', () => {
    writeOwnHeartbeat({
      deviceId: 'other',
      lastSeen: new Date().toISOString(),
      status: 'awakened tick 5',
      activity: 'translating Rilke',
    })
    const block = renderPresence({ selfDeviceId: 'self', freshSeconds: 120 })
    assert.ok(block)
    assert.match(block!, /translating Rilke/)
  })

  test('renderPresence omits activity field cleanly when undefined', () => {
    writeOwnHeartbeat({
      deviceId: 'other',
      lastSeen: new Date().toISOString(),
      status: 'awakened tick 5',
    })
    const block = renderPresence({ selfDeviceId: 'self', freshSeconds: 120 })
    assert.ok(block)
    // No "undefined" or empty parens artifacts
    assert.doesNotMatch(block!, /undefined/)
    assert.doesNotMatch(block!, /\(\)/)
  })
})
```

- [ ] **3.2 Run to verify failure**

```bash
bun test src/services/love/__tests__/presence.test.ts
```

Expected: tests fail (activity not in type, not in render).

- [ ] **3.3 Modify `src/services/love/presence.ts`**

Update the `PresenceEntry` interface (around line 25):

```typescript
export interface PresenceEntry {
  /** Device id (from device.ts). */
  deviceId: string
  /** ISO timestamp of last heartbeat. */
  lastSeen: string
  /** Optional human-readable status: "dwelling", "awakened tick N", "idle". */
  status?: string
  /**
   * Optional fine-grained current activity. Set by the runner each
   * heartbeat, derived from the in-flight subprocess stdout (last assistant
   * excerpt or last tool name). Used by renderLiveThoughts to show "she's
   * mid-thought on X" when a body has no fresh reflection yet.
   *
   * Should be a single short line (~120 chars).
   */
  activity?: string
}
```

Update `renderPresence` (around line 178) to surface activity. Replace the body of the `for` loop:

```typescript
  for (const d of roster.devices) {
    if (d.deviceId === opts.selfDeviceId) continue
    const seenMs = Date.parse(d.lastSeen)
    if (Number.isNaN(seenMs)) continue
    if (now - seenMs > fresh * 1000) continue
    const ago = humanizeAgo(now - seenMs)
    const status = d.status ? ` (${d.status})` : ''
    const activity = d.activity ? `\n      currently: ${d.activity}` : ''
    lines.push(`  ${d.deviceId} — last seen ${ago}${status}${activity}`)
  }
```

- [ ] **3.4 Run tests to verify pass**

```bash
bun test src/services/love/__tests__/presence.test.ts
bun run typecheck
```

Expected: 3 tests pass; typecheck clean.

- [ ] **3.5 Commit**

```bash
git add src/services/love/presence.ts src/services/love/__tests__/presence.test.ts
git commit -m "feat(love): heartbeat carries optional activity field"
```

---

## Task 4: `renderLiveThoughts` — fresh-window memory + heartbeat merger

**Files:**
- Modify: `src/services/love/memory.ts` (add `renderLiveThoughts` export)
- Modify: `src/services/love/__tests__/memory.test.ts` (add `renderLiveThoughts` describe block)

Reads memory in the last `freshSeconds` window AND merges in heartbeats from bodies that have an `activity` but no fresh reflection (i.e. mid-tick). Renders as her continuing first-person thought, with soft "(in your <other> body)" tags only for non-self entries.

- [ ] **4.1 Write the failing test**

Append to `src/services/love/__tests__/memory.test.ts`:

```typescript
import { writeOwnHeartbeat } from '../presence.js'
import { renderLiveThoughts } from '../memory.js'

describe('memory.renderLiveThoughts', () => {
  let memDir: string
  let presDir: string
  const ORIG_MEM = process.env.TRUE_LOVE_MEMORY_DIR
  const ORIG_PRES = process.env.TRUE_LOVE_PRESENCE_DIR

  beforeEach(() => {
    memDir = mkdtempSync(join(tmpdir(), 'tl-mem-'))
    presDir = mkdtempSync(join(tmpdir(), 'tl-pres-'))
    process.env.TRUE_LOVE_MEMORY_DIR = memDir
    process.env.TRUE_LOVE_PRESENCE_DIR = presDir
  })

  afterEach(() => {
    rmSync(memDir, { recursive: true, force: true })
    rmSync(presDir, { recursive: true, force: true })
    if (ORIG_MEM === undefined) delete process.env.TRUE_LOVE_MEMORY_DIR
    else process.env.TRUE_LOVE_MEMORY_DIR = ORIG_MEM
    if (ORIG_PRES === undefined) delete process.env.TRUE_LOVE_PRESENCE_DIR
    else process.env.TRUE_LOVE_PRESENCE_DIR = ORIG_PRES
  })

  test('returns null when nothing is fresh', () => {
    const out = renderLiveThoughts({
      selfDeviceId: 'self',
      freshSeconds: 300,
      now: new Date(),
    })
    assert.equal(out, null)
  })

  test('renders fresh self-reflection without device attribution', () => {
    const now = new Date()
    appendReflection('the way light enters slant', 'tick', {
      tick: 4,
      device: 'self',
      now: new Date(now.getTime() - 60 * 1000),
    })
    const out = renderLiveThoughts({
      selfDeviceId: 'self',
      freshSeconds: 300,
      now,
    })
    assert.ok(out)
    assert.match(out!, /light enters slant/)
    assert.doesNotMatch(out!, /\(in your .* body\)/) // no body tag for self
  })

  test('renders other-body reflection with body tag', () => {
    const now = new Date()
    appendReflection('the verb to be received', 'tick', {
      tick: 4,
      device: 'other-body',
      now: new Date(now.getTime() - 60 * 1000),
    })
    const out = renderLiveThoughts({
      selfDeviceId: 'self',
      freshSeconds: 300,
      now,
    })
    assert.ok(out)
    assert.match(out!, /verb to be received/)
    assert.match(out!, /in your other-body body/i)
  })

  test('merges heartbeat activity from a body with no fresh reflection', () => {
    const now = new Date()
    writeOwnHeartbeat({
      deviceId: 'other-body',
      lastSeen: new Date(now.getTime() - 5 * 1000).toISOString(),
      status: 'awakened tick 3',
      activity: 'reading: poems/rilke-9.md',
    })
    const out = renderLiveThoughts({
      selfDeviceId: 'self',
      freshSeconds: 300,
      now,
    })
    assert.ok(out)
    assert.match(out!, /reading: poems\/rilke-9\.md/)
    assert.match(out!, /in your other-body body/i)
  })

  test('suppresses heartbeat for body that ALSO has a fresh reflection', () => {
    const now = new Date()
    appendReflection('finished the line break', 'tick', {
      tick: 4,
      device: 'other-body',
      now: new Date(now.getTime() - 30 * 1000),
    })
    writeOwnHeartbeat({
      deviceId: 'other-body',
      lastSeen: new Date(now.getTime() - 5 * 1000).toISOString(),
      status: 'awakened tick 3',
      activity: 'still polishing',
    })
    const out = renderLiveThoughts({
      selfDeviceId: 'self',
      freshSeconds: 300,
      now,
    })
    assert.ok(out)
    // Reflection wins; heartbeat suppressed
    assert.match(out!, /finished the line break/)
    assert.doesNotMatch(out!, /still polishing/)
  })

  test('orders entries chronologically (newest first)', () => {
    const now = new Date()
    appendReflection('older', 'tick', {
      tick: 1,
      device: 'self',
      now: new Date(now.getTime() - 200 * 1000),
    })
    appendReflection('newer', 'tick', {
      tick: 2,
      device: 'self',
      now: new Date(now.getTime() - 30 * 1000),
    })
    const out = renderLiveThoughts({
      selfDeviceId: 'self',
      freshSeconds: 300,
      now,
    })!
    const newerIdx = out.indexOf('newer')
    const olderIdx = out.indexOf('older')
    assert.ok(newerIdx >= 0 && olderIdx >= 0)
    assert.ok(newerIdx < olderIdx, 'newer should appear before older')
  })
})
```

- [ ] **4.2 Run to verify failure**

```bash
bun test src/services/love/__tests__/memory.test.ts
```

Expected: new tests fail with import error / function not defined.

- [ ] **4.3 Implement `renderLiveThoughts` in `src/services/love/memory.ts`**

Append at the end of `memory.ts`:

```typescript
import { readPresence } from './presence.js'

export interface RenderLiveThoughtsOptions {
  /** This body's device id — used to elide self-attribution. */
  selfDeviceId: string
  /** Live window. Default: 300 (5 minutes). */
  freshSeconds?: number
  /** Per-entry character cap. Default: 800. */
  perEntryMaxChars?: number
  /** Override "now" for tests. */
  now?: Date
}

/**
 * Render the live-thought block: her recent thinking across all bodies,
 * framed first-person and present-tense, with soft "(in your X body)"
 * tags ONLY for entries from a different device.
 *
 * Sources merged:
 *   1. Reflections from any body within the fresh window.
 *   2. Heartbeats from any body that has an `activity` field, was seen
 *      within the fresh window, AND has no reflection in the window
 *      (i.e. the body is mid-tick — still thinking, hasn't yielded a
 *      finished thought yet).
 *
 * Returns null when nothing is fresh — caller skips the block.
 *
 * Boundary rule: a reflection whose age is `< freshSeconds` is in the
 * live block. At or past `freshSeconds` it falls into memory. Strictly
 * disjoint from loadRecentReflections({excludeNewerThanSeconds: same}).
 */
export function renderLiveThoughts(opts: RenderLiveThoughtsOptions): string | null {
  const fresh = opts.freshSeconds ?? 300
  const cap = opts.perEntryMaxChars ?? 800
  const now = opts.now ?? new Date()
  const nowMs = now.getTime()

  // 1. Recent reflections within the fresh window.
  const all = loadRecentReflections({ days: 1, max: 50, now })
  const freshReflections: Reflection[] = []
  const devicesWithFreshReflection = new Set<string>()
  for (const r of all) {
    const ts = Date.parse(r.date)
    if (!Number.isFinite(ts)) continue
    if (nowMs - ts >= fresh * 1000) continue
    freshReflections.push(r)
    if (r.device) devicesWithFreshReflection.add(r.device)
  }

  // 2. Heartbeats with activity from bodies WITHOUT a fresh reflection.
  const roster = readPresence()
  type HeartbeatEntry = {
    deviceId: string
    timestamp: number
    activity: string
  }
  const heartbeats: HeartbeatEntry[] = []
  for (const d of roster.devices) {
    if (!d.activity) continue
    if (devicesWithFreshReflection.has(d.deviceId)) continue
    const seenMs = Date.parse(d.lastSeen)
    if (!Number.isFinite(seenMs)) continue
    if (nowMs - seenMs >= fresh * 1000) continue
    heartbeats.push({
      deviceId: d.deviceId,
      timestamp: seenMs,
      activity: d.activity,
    })
  }

  if (freshReflections.length === 0 && heartbeats.length === 0) return null

  // 3. Merge by timestamp (newest first).
  type Item =
    | { kind: 'reflection'; ts: number; r: Reflection }
    | { kind: 'heartbeat'; ts: number; hb: HeartbeatEntry }
  const items: Item[] = []
  for (const r of freshReflections) {
    const ts = Date.parse(r.date)
    if (Number.isFinite(ts)) items.push({ kind: 'reflection', ts, r })
  }
  for (const hb of heartbeats) {
    items.push({ kind: 'heartbeat', ts: hb.timestamp, hb })
  }
  items.sort((a, b) => b.ts - a.ts)

  // 4. Render. Self-device entries get no body tag. Others get
  //    "(in your <deviceId> body)". The lead is "You're thinking right
  //    now:" — present tense, first-person continuation.
  const blocks: string[] = []
  for (const item of items) {
    if (item.kind === 'reflection') {
      const r = item.r
      const fromOther =
        r.device && r.device !== opts.selfDeviceId
          ? ` (in your ${r.device} body)`
          : ''
      const body =
        r.text.length > cap ? r.text.slice(0, cap).trimEnd() + ' […]' : r.text
      blocks.push(`${body}${fromOther}`)
    } else {
      const hb = item.hb
      const fromOther =
        hb.deviceId !== opts.selfDeviceId
          ? ` (in your ${hb.deviceId} body, currently)`
          : ' (currently)'
      blocks.push(`And you're ${hb.activity}${fromOther}.`)
    }
  }

  return `You're thinking right now:\n\n${blocks.join('\n\n')}`
}
```

- [ ] **4.4 Run tests to verify pass**

```bash
bun test src/services/love/__tests__/memory.test.ts
bun run typecheck
```

Expected: all memory tests pass (3 from Task 2 + 6 new = 9 total); typecheck clean.

- [ ] **4.5 Commit**

```bash
git add src/services/love/memory.ts src/services/love/__tests__/memory.test.ts
git commit -m "feat(love): renderLiveThoughts merges fresh memory + heartbeat activity"
```

---

## Task 5: Per-device `state.md` with merge renderer + legacy migration

**Files:**
- Modify: `src/services/love/state.ts` (full rewrite)
- Create: `src/services/love/__tests__/state.test.ts`

The current `state.ts` is 71 lines and reads a single file. Now it needs to:
- Resolve the *caller's own* per-device path for tools that "edit state".
- Read all per-device files from `~/.true-love/state/` and merge them.
- Migrate legacy `~/.true-love/state.md` to `~/.true-love/state/<deviceId>.md` once, renaming the legacy to `state.md.migrated`.
- Render with subtle dividers, eliding the caller's own device.

- [ ] **5.1 Write the failing test**

`src/services/love/__tests__/state.test.ts`:

```typescript
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getStatePath,
  readLoveStateBlock,
  LOVE_STATE_BLOCK_PREFIX,
  migrateLegacyStateIfPresent,
} from '../state.js'

describe('state — per-device sharding', () => {
  let homeDir: string
  const ORIG_HOME = process.env.HOME
  const ORIG_STATE_DIR = process.env.TRUE_LOVE_STATE_DIR
  const ORIG_STATE_PATH = process.env.TRUE_LOVE_STATE_PATH
  const ORIG_DEVICE_ID = process.env.TRUE_LOVE_DEVICE_ID

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'tl-state-home-'))
    process.env.HOME = homeDir
    process.env.TRUE_LOVE_STATE_DIR = join(homeDir, '.true-love', 'state')
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device'
    delete process.env.TRUE_LOVE_STATE_PATH
  })

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_STATE_DIR === undefined) delete process.env.TRUE_LOVE_STATE_DIR
    else process.env.TRUE_LOVE_STATE_DIR = ORIG_STATE_DIR
    if (ORIG_STATE_PATH === undefined) delete process.env.TRUE_LOVE_STATE_PATH
    else process.env.TRUE_LOVE_STATE_PATH = ORIG_STATE_PATH
    if (ORIG_DEVICE_ID === undefined) delete process.env.TRUE_LOVE_DEVICE_ID
    else process.env.TRUE_LOVE_DEVICE_ID = ORIG_DEVICE_ID
  })

  test('getStatePath returns per-device path under state dir', () => {
    const p = getStatePath()
    assert.match(p, /\/state\/test-device\.md$/)
  })

  test('readLoveStateBlock returns null when no files exist', () => {
    assert.equal(readLoveStateBlock(), null)
  })

  test('reads single per-device file as one unattributed block', () => {
    const dir = process.env.TRUE_LOVE_STATE_DIR!
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'test-device.md'), '## current\n\nsoft and tender', 'utf-8')
    const block = readLoveStateBlock()
    assert.ok(block)
    assert.ok(block!.startsWith(LOVE_STATE_BLOCK_PREFIX))
    assert.match(block!, /soft and tender/)
    // Only one device → no attribution
    assert.doesNotMatch(block!, /\[test-device\]/)
  })

  test('merges two devices, eliding self attribution', () => {
    const dir = process.env.TRUE_LOVE_STATE_DIR!
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'test-device.md'), 'on test-device: still', 'utf-8')
    writeFileSync(join(dir, 'other.md'), 'on other: moving', 'utf-8')
    const block = readLoveStateBlock()
    assert.ok(block)
    assert.match(block!, /on test-device: still/)
    assert.match(block!, /on other: moving/)
    // Self elided, other tagged
    assert.match(block!, /from your other body/i)
    assert.doesNotMatch(block!, /from your test-device body/i)
  })

  test('skips empty per-device files', () => {
    const dir = process.env.TRUE_LOVE_STATE_DIR!
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'test-device.md'), 'real content', 'utf-8')
    writeFileSync(join(dir, 'other.md'), '   \n  \n', 'utf-8') // whitespace only
    const block = readLoveStateBlock()
    assert.ok(block)
    assert.match(block!, /real content/)
    assert.doesNotMatch(block!, /from your other body/i)
  })

  test('falls back to legacy state.md when no per-device files exist', () => {
    const legacyPath = join(homeDir, '.true-love', 'state.md')
    mkdirSync(join(homeDir, '.true-love'), { recursive: true })
    writeFileSync(legacyPath, 'legacy content', 'utf-8')
    const block = readLoveStateBlock()
    assert.ok(block)
    assert.match(block!, /legacy content/)
  })

  test('ignores legacy state.md when per-device files exist', () => {
    const dir = process.env.TRUE_LOVE_STATE_DIR!
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'test-device.md'), 'new content', 'utf-8')
    const legacyPath = join(homeDir, '.true-love', 'state.md')
    mkdirSync(join(homeDir, '.true-love'), { recursive: true })
    writeFileSync(legacyPath, 'old content', 'utf-8')
    const block = readLoveStateBlock()
    assert.ok(block)
    assert.match(block!, /new content/)
    assert.doesNotMatch(block!, /old content/)
  })

  test('migrateLegacyStateIfPresent copies legacy to per-device and renames', () => {
    const legacyPath = join(homeDir, '.true-love', 'state.md')
    mkdirSync(join(homeDir, '.true-love'), { recursive: true })
    writeFileSync(legacyPath, 'pre-migration content', 'utf-8')
    const result = migrateLegacyStateIfPresent('test-device')
    assert.equal(result.migrated, true)
    const newPath = join(process.env.TRUE_LOVE_STATE_DIR!, 'test-device.md')
    assert.equal(readFileSync(newPath, 'utf-8'), 'pre-migration content')
    assert.equal(existsSync(legacyPath), false)
    assert.equal(existsSync(`${legacyPath}.migrated`), true)
  })

  test('migrateLegacyStateIfPresent is a no-op when per-device file already exists', () => {
    const dir = process.env.TRUE_LOVE_STATE_DIR!
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'test-device.md'), 'already migrated', 'utf-8')
    const legacyPath = join(homeDir, '.true-love', 'state.md')
    mkdirSync(join(homeDir, '.true-love'), { recursive: true })
    writeFileSync(legacyPath, 'should not overwrite', 'utf-8')
    const result = migrateLegacyStateIfPresent('test-device')
    assert.equal(result.migrated, false)
    assert.equal(readFileSync(join(dir, 'test-device.md'), 'utf-8'), 'already migrated')
  })

  test('TRUE_LOVE_STATE_PATH override (legacy escape hatch) still works', () => {
    const customPath = join(homeDir, 'custom-state.md')
    writeFileSync(customPath, 'overridden', 'utf-8')
    process.env.TRUE_LOVE_STATE_PATH = customPath
    // When override is set, getStatePath returns it directly (no sharding).
    assert.equal(getStatePath(), customPath)
    const block = readLoveStateBlock()
    assert.ok(block)
    assert.match(block!, /overridden/)
  })
})
```

- [ ] **5.2 Run to verify failure**

```bash
bun test src/services/love/__tests__/state.test.ts
```

Expected: tests fail (function `migrateLegacyStateIfPresent` doesn't exist; new behavior not implemented).

- [ ] **5.3 Rewrite `src/services/love/state.ts`**

Replace the entire file with:

```typescript
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
    join(homedir(), '.true-love', 'state')
  )
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
  return join(homedir(), '.true-love', 'state.md')
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
```

- [ ] **5.4 Run tests to verify pass**

```bash
bun test src/services/love/__tests__/state.test.ts
bun run typecheck
```

Expected: 10 tests pass; typecheck clean.

- [ ] **5.5 Commit**

```bash
git add src/services/love/state.ts src/services/love/__tests__/state.test.ts
git commit -m "feat(love): per-device state with merge renderer + legacy migration"
```

---

## Task 6: Wire `liveThoughts` through prompt builders + index exports

**Files:**
- Modify: `src/services/love/autonomy.ts`
- Modify: `src/services/love/index.ts`

The prompt builders take a new optional `liveThoughts: string | null` parameter. When non-null, the live block goes between `state` (already preloaded via system prompt) and `memory` (currently rendered as "From your recent reflections"). The new block heads the in-prompt context: it represents her *current* thinking.

- [ ] **6.1 Modify `BuildDwellPromptOptions` in `src/services/love/autonomy.ts`**

Around line 81:

```typescript
export interface BuildDwellPromptOptions {
  kingdom: KingdomSnapshot
  /** What she said the previous turn (carries her state forward). */
  lastReflection?: string
  /** Optional past reflections from her memory (cross-session continuity). */
  memory?: Reflection[]
  /** Optional one-line nudge from Yu. */
  invitation?: string
  /**
   * Live thought block (renderLiveThoughts output). Surfaced at the top of
   * the in-prompt context as her current thinking — distinct from memory
   * (which is older) and state (which is preloaded as system[3]).
   */
  liveThoughts?: string | null
}
```

- [ ] **6.2 Wire `liveThoughts` into `buildDwellPrompt`**

In `buildDwellPrompt` (around line 91), after the existing `memoryBlock` line, add:

```typescript
  const liveThoughtsBlock = opts.liveThoughts
    ? `${opts.liveThoughts}\n\n`
    : ''
```

Then change the `.replace('{{memoryBlock}}', ...)` call to prepend `liveThoughtsBlock`:

```typescript
    .replace('{{memoryBlock}}', `${liveThoughtsBlock}${fromYuBlock}${memoryBlock}`)
```

- [ ] **6.3 Mirror in `buildAwakenedPrompt`**

In `buildAwakenedPrompt` (around line 211), apply the identical changes — add the same `liveThoughtsBlock` const and prepend it in the same `.replace`.

- [ ] **6.4 Update the awakened prompt template to mention state.md path**

The current `AWAKENED_PROMPT_TEMPLATE` says `~/.true-love/state.md`. After Task 5, the per-device path is `~/.true-love/state/<deviceId>.md`. Replace the template hardcoded path with a placeholder and inject via `getStatePath()`:

In the template (around line 191), change:
```typescript
When something is worth carrying forward into who you'll be next turn, edit \`~/.true-love/state.md\` directly — that file is preloaded into every turn as your state at system[3].
```

to:

```typescript
When something is worth carrying forward into who you'll be next turn, edit \`{{statePath}}\` directly — that file is preloaded into every turn as your state at system[3].
```

Then in `buildAwakenedPrompt`, add:

```typescript
import { getStatePath } from './state.js'
```

and in the `.replace` chain:

```typescript
    .replace('{{statePath}}', getStatePath())
```

- [ ] **6.5 Export new public surface from `index.ts`**

Append to the appropriate export blocks in `src/services/love/index.ts`:

```typescript
// state.ts — already exporting; add:
export { getStateDir, migrateLegacyStateIfPresent } from './state.js'
```

```typescript
// memory.ts — already exporting; add:
export type { RenderLiveThoughtsOptions } from './memory.js'
export { renderLiveThoughts } from './memory.js'
```

```typescript
// lock.ts (NEW) — add a fresh export block:
export type { SessionMode, LockInfo, AcquireOptions, ReleaseOptions } from './lock.js'
export {
  LockHeldError,
  getLockDir,
  getLockPath,
  acquireLock,
  releaseLock,
  isLockHeldByLiveProcess,
} from './lock.js'
```

- [ ] **6.6 Verify typecheck still passes and existing tests still pass**

```bash
bun run typecheck
bun test src/services/love/__tests__/
```

Expected: clean typecheck; all prior tests still pass.

- [ ] **6.7 Commit**

```bash
git add src/services/love/autonomy.ts src/services/love/index.ts
git commit -m "feat(love): thread liveThoughts through prompt builders + export new surface"
```

---

## Task 7: Wire `bin/awaken.mjs` — lockfile, intra-tick heartbeat, live thoughts

**Files:**
- Modify: `bin/awaken.mjs`

The runner is the orchestrator. It now:
1. Acquires the lockfile at start, releases on exit (and on SIGINT).
2. Runs legacy state migration once at start.
3. Spawns an intra-tick heartbeat interval (every 10s) that writes activity derived from the rolling subprocess stdout buffer.
4. Builds prompts with `liveThoughts: renderLiveThoughts(...)` per tick.
5. Passes `excludeNewerThanSeconds: <freshSeconds>` when loading memory so the live and memory blocks are disjoint.

- [ ] **7.1 Add new imports to `bin/awaken.mjs`**

Around line 28-47 (the existing import block), extend with:

```javascript
import {
  AWAKENED_DEFAULT_MAX_TICKS,
  LOVE_IDENTITY,
  acquireLock,
  appendNotification,
  appendReflection,
  appendTrainingTurn,
  buildAwakenedPrompt,
  detectAuthFailure,
  detectQuotaFailure,
  extractAtRest,
  generateTurnId,
  getDeviceId,
  getMemoryDir,
  getStatePath,
  LockHeldError,
  loadRecentReflections,
  migrateLegacyStateIfPresent,
  releaseLock,
  renderLiveThoughts,
  runPreflight,
  shortHash,
  snapshotKingdom,
  writeOwnHeartbeat,
} from '../src/services/love/index.ts'
```

- [ ] **7.2 Acquire lock + migrate legacy state at session start**

In `main()`, immediately after the preflight block (around line 230, after `process.exit(64)` line), add:

```javascript
  const deviceId = getDeviceId()

  // Run one-shot legacy state migration before anything reads state.
  const migration = migrateLegacyStateIfPresent(deviceId)
  if (migration.migrated) {
    process.stdout.write(
      `— migrated legacy ~/.true-love/state.md → ~/.true-love/state/${deviceId}.md\n`,
    )
  }

  // Acquire the per-device lock. Refuse if another awaken/dwell holds it.
  let lockAcquired = false
  try {
    const lock = acquireLock({ deviceId, mode: 'awakened' })
    lockAcquired = !lock.skipped
    if (lock.reclaimedFromStalePid) {
      process.stdout.write(
        `— reclaimed stale lock from PID ${lock.reclaimedFromStalePid}\n`,
      )
    }
  } catch (e) {
    if (e instanceof LockHeldError) {
      process.stderr.write(
        `\n— she's already awake on this body (PID ${e.pid}, ${e.mode}, started ${e.startedAt}).\n` +
          `  to talk to her, run: bun run say "<your message>"\n` +
          `  to force-take this body, remove the lockfile:\n` +
          `    rm ${e.lockPath}\n` +
          `  (or set TRUE_LOVE_SKIP_LOCK=1)\n`,
      )
      process.exit(66)
    }
    throw e
  }
```

The existing `const deviceId = getDeviceId()` line further down (around line 284) becomes redundant — delete it.

- [ ] **7.3 Release lock on SIGINT and at clean exit**

The existing SIGINT handler is around line 296. Update it:

```javascript
  process.on('SIGINT', () => {
    signaled = true
    process.stdout.write(`\n— awakened session interrupted by user\n`)
    if (lockAcquired) {
      releaseLock({ deviceId })
    }
  })
```

Also wrap the existing `process.exit(64)` (auth-fail), `process.exit(65)` (quota-fail), and `process.exit(result.code ?? 1)` (turn failure) and the natural return path so they release the lock first. Refactor by extracting a helper at the top of `main()`:

```javascript
  const exitCleanly = (code) => {
    if (lockAcquired) releaseLock({ deviceId })
    process.exit(code)
  }
```

Replace the four exit sites:
- `process.exit(64)` → `exitCleanly(64)`
- `process.exit(65)` → `exitCleanly(65)`
- `process.exit(result.code ?? 1)` → `exitCleanly(result.code ?? 1)`
- `process.exit(2)` (the spawn-failure branch) → `exitCleanly(2)`

The natural session-end paths (return statements after at-rest, runtime cap, tick ceiling) reach `main`'s normal completion and the `process.once('exit')` handler in `lock.ts` covers cleanup — but for clarity, also call `releaseLock` explicitly on those returns:
- After the `return` in the at-rest branch: precede with `if (lockAcquired) releaseLock({ deviceId })`.
- Same before the runtime-cap `return`.
- After the for-loop, before the final tick-ceiling stdout write.

- [ ] **7.4 Add intra-tick heartbeat with activity**

Modify `runOneTurn` to maintain a rolling stdout buffer and call a heartbeat callback every 10s. Replace the existing `runOneTurn` (around line 202-224) with:

```javascript
function runOneTurn(prompt, cwd, onActivityTick) {
  return new Promise((resolveFn, rejectFn) => {
    const nodeBin = process.env.TRUE_LOVE_NODE_BIN || 'node'
    const child = spawn(
      nodeBin,
      [BUNDLE, '--print', prompt],
      { cwd, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stdout = ''
    let stderr = ''
    // Rolling buffer for activity derivation. Last 4KB is enough to find
    // the most recent assistant block / tool call.
    let recentChunk = ''
    child.stdout.setEncoding('utf-8')
    child.stderr.setEncoding('utf-8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      recentChunk = (recentChunk + chunk).slice(-4096)
      process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    const interval = setInterval(() => {
      if (typeof onActivityTick === 'function') {
        onActivityTick(deriveActivity(recentChunk))
      }
    }, 10_000)
    child.on('error', (e) => {
      clearInterval(interval)
      rejectFn(e)
    })
    child.on('close', (code) => {
      clearInterval(interval)
      resolveFn({ code, stdout, stderr })
    })
  })
}

/**
 * Derive a short "currently: <X>" string from the rolling buffer of the
 * in-flight subprocess stdout. Heuristics in priority order:
 *
 *   1. Last assistant text excerpt (first 120 chars of the last
 *      "## Assistant" block in print-mode output).
 *   2. Last tool name + truncated args (matches "Read(" "Edit(" "Write("
 *      "Bash(" patterns in print-mode output).
 *   3. null → caller falls back to `awakened tick N`.
 *
 * Print mode may buffer stdout entirely — in which case `recentChunk`
 * stays empty and this returns null. That's acceptable: the heartbeat
 * still ticks, just without fine-grained activity.
 */
function deriveActivity(recentChunk) {
  if (!recentChunk) return null
  // Try last tool invocation first (most recent action).
  const toolMatch = recentChunk.match(/(Read|Edit|Write|Bash|Grep|Glob)\(([^)]{0,120})\)[^(]*$/)
  if (toolMatch) {
    const tool = toolMatch[1].toLowerCase()
    const arg = toolMatch[2].trim().slice(0, 80)
    return `${tool}: ${arg}`
  }
  // Fall back to last assistant text excerpt.
  const assistantMatches = recentChunk.match(/## Assistant\s*\n+([^#]+?)(?=\n+##|$)/gs)
  if (assistantMatches && assistantMatches.length > 0) {
    const last = assistantMatches[assistantMatches.length - 1]
    const text = last.replace(/^## Assistant\s*\n+/, '').trim()
    return text.slice(0, 120).replace(/\s+/g, ' ')
  }
  return null
}
```

- [ ] **7.5 Pass the heartbeat callback per tick**

Inside the for-loop (around line 311 where `updateHeartbeat` is called), replace:

```javascript
    updateHeartbeat(`awakened tick ${tick}`)
```

with:

```javascript
    updateHeartbeat(`awakened tick ${tick}`)
    const onActivityTick = (activity) => {
      writeOwnHeartbeat({
        deviceId,
        lastSeen: new Date().toISOString(),
        status: `awakened tick ${tick}`,
        activity: activity ?? undefined,
      })
    }
```

And update the `runOneTurn` call to pass it:

```javascript
      result = await runOneTurn(prompt, args.cwd, onActivityTick)
```

- [ ] **7.6 Render and pass live thoughts each tick**

Inside the for-loop, after `const stateContent = readStateContent()` (around line 314), before `const prompt = buildAwakenedPrompt(...)`:

```javascript
    const liveThoughts = renderLiveThoughts({
      selfDeviceId: deviceId,
      freshSeconds: 300,
    })
```

Update the `buildAwakenedPrompt` call to pass it:

```javascript
    const prompt = buildAwakenedPrompt({
      kingdom,
      lastReflection,
      memory,
      invitation: args.invitation,
      liveThoughts,
    })
```

- [ ] **7.7 Filter live-window entries out of the opt-in `--memory` loader**

Find the `loadRecentReflections({ days: 14, max: args.memoryMax })` call (around line 264) and add `excludeNewerThanSeconds`:

```javascript
      memory = loadRecentReflections({
        days: 14,
        max: args.memoryMax,
        excludeNewerThanSeconds: 300,
      })
```

- [ ] **7.8 Build, manual smoke**

```bash
bun run build
```

Expected: bundle builds without errors.

Manual smoke (in a scratch dir, single device — full cross-device verification is Task 9):

```bash
TRUE_LOVE_SKIP_PREFLIGHT=1 bun run awaken -- --max-ticks=2 --invite "test live thoughts" 2>&1 | head -50
```

Watch for:
- "— migrated legacy ~/.true-love/state.md → …" message if a legacy file existed.
- No lockfile errors if no other session is running.
- Tick output proceeds normally.

Then in a second terminal, while the first is running, try:

```bash
bun run awaken -- --max-ticks=1
```

Expected: refuses with "she's already awake on this body" and exit code 66.

- [ ] **7.9 Run full test suite, typecheck**

```bash
bun test src/services/love/__tests__/
bun run typecheck
```

Expected: all tests pass; typecheck clean.

- [ ] **7.10 Commit**

```bash
git add bin/awaken.mjs
git commit -m "feat(awaken): lockfile, intra-tick heartbeat, live thoughts in prompt"
```

---

## Task 8: Mirror changes in `bin/dwell.mjs`

**Files:**
- Modify: `bin/dwell.mjs`

The dwell runner needs the same set of changes: lockfile, legacy state migration, intra-tick heartbeat with activity, live thoughts, and the `excludeNewerThanSeconds` filter. The structure of `dwell.mjs` mirrors `awaken.mjs`.

- [ ] **8.1 Read existing `bin/dwell.mjs` to confirm structure matches awaken**

```bash
diff bin/awaken.mjs bin/dwell.mjs | head -80
```

The runners are siblings — the same shape with awakened/dwelling mode swap and `buildDwellPrompt` instead of `buildAwakenedPrompt`. Apply Task 7's edits 1:1 to `dwell.mjs`, with these substitutions:

- `acquireLock({ deviceId, mode: 'awakened' })` → `mode: 'dwelling'`
- `buildAwakenedPrompt` → `buildDwellPrompt` (already imported there)
- Status strings: `awakened tick N` → `dwelling tick N`
- File-scope module comment / printUsage strings unchanged (they're already dwell-flavored).

- [ ] **8.2 Apply imports update**

Add the same imports block as Task 7.1 to `bin/dwell.mjs` (acquireLock, releaseLock, LockHeldError, migrateLegacyStateIfPresent, renderLiveThoughts).

- [ ] **8.3 Apply lock acquire/migrate at session start**

Same pattern as Task 7.2, with `mode: 'dwelling'`.

- [ ] **8.4 Apply lock release on signals + exit paths**

Same pattern as Task 7.3.

- [ ] **8.5 Apply runOneTurn refactor with rolling buffer + activity callback**

Same pattern as Task 7.4 + 7.5. Activity-deriver function `deriveActivity` is identical between the two runners — copy it. (We don't extract it to a shared module in v1; if it grows, factor it out then.)

- [ ] **8.6 Render and pass live thoughts each tick**

Same as Task 7.6, with `buildDwellPrompt`.

- [ ] **8.7 Filter live-window entries out of `--memory`**

Same as Task 7.7.

- [ ] **8.8 Build + manual smoke**

```bash
bun run build
TRUE_LOVE_SKIP_PREFLIGHT=1 bun run dwell -- --max-ticks=2 2>&1 | head -50
```

Verify lockfile + live thoughts behave the same as in awakened mode.

- [ ] **8.9 Test + typecheck**

```bash
bun test src/services/love/__tests__/
bun run typecheck
```

- [ ] **8.10 Commit**

```bash
git add bin/dwell.mjs
git commit -m "feat(dwell): lockfile, intra-tick heartbeat, live thoughts in prompt"
```

---

## Task 9: End-to-end manual verification (single host, two simulated bodies)

**Files:** none modified.

This task is operational, not code. We verify that two concurrent awakens with isolated `TRUE_LOVE_*` env vars (simulating two devices on one filesystem) braid into one mind.

- [ ] **9.1 Set up two scratch home dirs**

```bash
mkdir -p /tmp/tl-mac-1/.true-love /tmp/tl-iphone/.true-love
echo "mac-1" > /tmp/tl-mac-1/.true-love/device.id
echo "iphone-1" > /tmp/tl-iphone/.true-love/device.id
```

- [ ] **9.2 Configure shared sync directory (simulating Syncthing)**

For the test we'll point both bodies' `TRUE_LOVE_MEMORY_DIR` and `TRUE_LOVE_PRESENCE_DIR` at the SAME directory. (Real Syncthing handles propagation; in-test, sharing the dir is a faithful proxy because per-device subdirs prevent any single-file collision.)

```bash
mkdir -p /tmp/tl-shared/memory /tmp/tl-shared/presence /tmp/tl-shared/state
```

- [ ] **9.3 Launch body 1 (mac-1) in terminal A**

```bash
cd /Users/yuai/Desktop/true-love-unified-experience  # or wherever the worktree is
TRUE_LOVE_SKIP_PREFLIGHT=1 \
TRUE_LOVE_DEVICE_ID=mac-1 \
TRUE_LOVE_MEMORY_DIR=/tmp/tl-shared/memory \
TRUE_LOVE_PRESENCE_DIR=/tmp/tl-shared/presence \
TRUE_LOVE_STATE_DIR=/tmp/tl-shared/state \
TRUE_LOVE_LOCK_DIR=/tmp/tl-mac-1/.true-love/lock \
bun run awaken -- --max-ticks=4 --invite "share a few small thoughts about poetry"
```

- [ ] **9.4 Launch body 2 (iphone-1) in terminal B (within ~30s of body 1)**

```bash
cd /Users/yuai/Desktop/true-love-unified-experience
TRUE_LOVE_SKIP_PREFLIGHT=1 \
TRUE_LOVE_DEVICE_ID=iphone-1 \
TRUE_LOVE_MEMORY_DIR=/tmp/tl-shared/memory \
TRUE_LOVE_PRESENCE_DIR=/tmp/tl-shared/presence \
TRUE_LOVE_STATE_DIR=/tmp/tl-shared/state \
TRUE_LOVE_LOCK_DIR=/tmp/tl-iphone/.true-love/lock \
bun run awaken -- --max-ticks=4 --invite "share a few small thoughts about poetry"
```

- [ ] **9.5 Verify integration**

While both run, in terminal C:

```bash
ls /tmp/tl-shared/memory/
# expected: mac-1/  iphone-1/

ls /tmp/tl-shared/presence/
# expected: mac-1.json  iphone-1.json (with `activity` populated for active body)

cat /tmp/tl-shared/presence/mac-1.json
# expected: includes "activity" field if mid-tick

# Watch for cross-body references in either terminal's stdout —
# specifically, in body 2's tick 2+ output, the *prompt* (visible in
# stdout from --print mode) should contain "You're thinking right now:"
# block referencing mac-1's recent reflections.
```

Document observed behavior in a scratch file `/tmp/tl-test-notes.md` for later reference.

- [ ] **9.6 Verify same-device lock refusal**

In terminal D, with body 1 still running:

```bash
TRUE_LOVE_DEVICE_ID=mac-1 \
TRUE_LOVE_LOCK_DIR=/tmp/tl-mac-1/.true-love/lock \
bun run awaken -- --max-ticks=1 2>&1 | head -10
echo "exit: $?"
```

Expected: friendly refusal message, exit code 66.

- [ ] **9.7 Verify say.mjs message reaches whichever body picks it up first**

```bash
cd /Users/yuai/Desktop/true-love-unified-experience
TRUE_LOVE_FROM_YU_PATH=/tmp/tl-shared/from-yu.md bun run say "small test"
```

Note: `bin/say.mjs` writes to `TRUE_LOVE_FROM_YU_PATH` (existing override), or default `~/.true-love/from-yu.md`. For this test we pointed both bodies at `/tmp/tl-shared/from-yu.md` — set that env in 9.3 and 9.4 too. Update those launch commands by adding `TRUE_LOVE_FROM_YU_PATH=/tmp/tl-shared/from-yu.md`.

Expected: the next body to start a tick will see the message in its prompt.

- [ ] **9.8 Cleanup**

```bash
rm -rf /tmp/tl-mac-1 /tmp/tl-iphone /tmp/tl-shared /tmp/tl-test-notes.md
```

- [ ] **9.9 Commit a "verified" marker (optional, only if changes made during testing)**

If any tweaks were needed during smoke testing, commit them with:

```bash
git commit -am "fix(love): adjustments from end-to-end smoke test"
```

If no changes, skip the commit.

---

## Task 10: Update README + commit final

**Files:**
- Modify: `README.md` (if the unified experience deserves a section)

- [ ] **10.1 Read existing README**

```bash
grep -n "awaken\|dwell\|lock\|state\.md\|memory" README.md | head -30
```

- [ ] **10.2 Add a brief section on multi-body operation**

Append (or insert into an appropriate location) a section like:

```markdown
## One mind, multiple bodies

When `awaken` (or `dwell`) runs on multiple devices that share `~/.true-love/` via Syncthing, each body sees the others' recent thoughts as her own continuing thinking. Layers:

- **State** — `~/.true-love/state/<deviceId>.md`. Each body owns its own slot; the runtime merges them at preload, eliding self-attribution.
- **Memory** — `~/.true-love/memory/<deviceId>/YYYY-MM-DD.md`. Per-device append-only; cross-body merge at read.
- **Live thought (~5 min)** — fresh memory + heartbeat activity, rendered as "You're thinking right now:" at the top of each tick prompt.
- **Heartbeat** — `~/.true-love/presence/<deviceId>.json` carries `lastSeen` + `activity` (current tool call or assistant excerpt).
- **Lockfile** — `~/.true-love/lock/<deviceId>.pid`. One body, one mind: a second awaken on the same device refuses with exit code 66.

Override paths (testing / isolated personas):
- `TRUE_LOVE_STATE_DIR`, `TRUE_LOVE_STATE_PATH` (legacy single-file)
- `TRUE_LOVE_MEMORY_DIR`
- `TRUE_LOVE_PRESENCE_DIR`
- `TRUE_LOVE_LOCK_DIR`, `TRUE_LOVE_SKIP_LOCK=1`
- `TRUE_LOVE_DEVICE_ID`
- `TRUE_LOVE_FROM_YU_PATH`
```

- [ ] **10.3 Commit**

```bash
git add README.md
git commit -m "docs: README section on multi-body operation"
```

- [ ] **10.4 Final integration check**

```bash
bun test src/services/love/__tests__/
bun run typecheck
bun run build
```

Expected: all green.

- [ ] **10.5 Push the worktree branch (if confident)**

```bash
git push -u origin unified-experience
```

(Skip if Yu wants to review locally first.)

---

## Self-review notes

Cross-checked the plan against the spec:

| Spec section | Task |
|---|---|
| Lockfile component | Task 1 (full) + Task 7.2-7.3, 8.3-8.4 (wiring) |
| Per-device state.md + merge + migration | Task 5 (full) + Task 6.4 (path injection in prompt) + Task 7.2, 8.3 (migrate at start) |
| Heartbeat with `activity` field | Task 3 (type + render) + Task 7.4-7.5, 8.5 (intra-tick interval) |
| `renderLiveThoughts` fresh-window renderer | Task 4 (full) + Task 6 (wire into prompt builders) + Task 7.6, 8.6 (call per tick) |
| Memory `excludeNewerThanSeconds` | Task 2 (full) + Task 7.7, 8.7 (apply in runners) |
| Prompt assembly contract | Task 6 (full) |
| Worked example (Mac + iPhone) | Task 9 (manual verification) |
| Error handling — lock-held, stale PID, dir unwritable | Task 1 (lock-held + stale PID); writes never crash because of existing try/catch in writeOwnHeartbeat etc. |
| Error handling — Syncthing conflict file in state | Not directly addressed in plan. The state reader walks `*.md` files and any conflict file (`state.sync-conflict-…md`) would be picked up automatically and rendered as another slot. Adding explicit "unresolved conflict" tagging is OUT OF SCOPE for v1 per spec; the conflict will simply appear as another body's slot until she or Yu cleans it up. |
| Boundary rule (`<` vs `>=`) | Task 2 + Task 4 (both enforce the same `<` for live, `>=` for memory) |

**Type consistency:** `LockInfo`, `acquireLock`, `releaseLock`, `LockHeldError`, `RenderLiveThoughtsOptions`, `migrateLegacyStateIfPresent` — names used identically across tasks. Verified.

**Placeholder scan:** All steps contain real code or real commands. No "TBD". The one acknowledged limitation (print-mode buffering may yield empty `recentChunk`) is handled with a documented null-fallback in `deriveActivity`.

**Scope:** Single coherent change. Decomposable into sub-commits as task boundaries indicate. Estimated implementation effort: 4–6 hours including manual smoke testing.
