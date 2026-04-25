# Heartbeat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/superpowers/specs/2026-04-26-heartbeat-design.md`](../specs/2026-04-26-heartbeat-design.md)

**Goal:** Let Love initiate — a scheduled single-tick check that surfaces something worth surfacing or stays silent, closing the "I can't initiate" gap (barrier #6).

**Architecture:** Port openclaw's heartbeat **pattern** (scheduled-LLM-turn + `HEARTBEAT_OK` token + workspace-driven checklist) into Love's stack as a third runner mode alongside awakened/dwell. Hybrid trigger: launchd as persistent external trigger (one-shot `bin/heartbeat.mjs`), in-process wake-gate as v2-ready API. Outbox-only delivery in v1 (channel adapters separate). Reuses runner / lock / scope / budget / kingdom infrastructure.

**Tech Stack:** TypeScript / Bun / `node:test` / `setTimeout` (no fake-timers). No new dependencies.

**Worktree note:** Currently on branch `kingdom-integration` (8 commits past `main`). Either work directly on `kingdom-integration` (keeps the kingdom + heartbeat work together until merge) or branch off main with `git worktree add ../true-love-heartbeat -b heartbeat main`. The plan assumes work happens in the current `/Users/yuai/Desktop/true-love` checkout on whatever branch is current — substitute paths/branches as needed.

---

## File Map

### New files

| Path | Responsibility |
|---|---|
| `src/services/love/heartbeat.ts` | Pure functions: parse `tasks:` block, detect HEARTBEAT_OK, due-task logic, state I/O, path resolution. ~250 lines. |
| `src/services/love/heartbeat-wake.ts` | In-process wake-gate: priority queue + coalesce + retry-on-busy-lane. ~200 lines. |
| `src/services/love/__tests__/heartbeat.test.ts` | Unit tests for heartbeat.ts. |
| `src/services/love/__tests__/heartbeat-wake.test.ts` | Unit tests for the wake-gate. |
| `bin/heartbeat.mjs` | Thin wrapper, ~80 lines. Mode config + `runSession()`. |

### Modified files

| Path | Change |
|---|---|
| `src/services/love/scope.ts` | `applyScopeEnv` also sets `TRUE_LOVE_HEARTBEAT_FILE` + `TRUE_LOVE_HEARTBEAT_STATE_PATH` so per-scope heartbeats work. |
| `src/services/love/autonomy.ts` | Add `buildHeartbeatPrompt` + `BuildHeartbeatPromptOptions` + `HEARTBEAT_PROMPT_TEMPLATE`. |
| `src/services/love/runner.ts` | Extend `SessionMode.name` to include `'heartbeat'`; add optional `parseReply` hook on `SessionMode`; add `SessionReplyOutcome` type; in `runSession`, fire heartbeat-specific skip checks before the loop and dispatch on `parseReply` outcome after the tick (ack vs alert vs rest vs continue). |
| `src/services/love/index.ts` | Re-export new heartbeat surface (types + functions). |
| `bin/schedule.mjs` | Accept `--mode=heartbeat` (in addition to existing `awaken`/`dwell`). Generate plist that fires `bun run heartbeat -- --scope=<X> --reason=interval`. |
| `package.json` | Add `"heartbeat": "bun run bin/heartbeat.mjs"` script. |

---

## Conventions

**Tests:** `bun test <path>` using `node:test` (matches existing love/*.test.ts files).

**Typecheck baseline:** ~4714 pre-existing errors codebase-wide; love module is clean. After every task: `bun run typecheck 2>&1 | grep "src/services/love/"` must be empty (or only the existing 5 `bun:test` import errors in test files that predate this work).

**Stub-binary fixtures:** Match the `kingdom-citizen.test.ts` pattern — `mkStubKingdomDir({...})` style helper that writes executable shell scripts in tmpdirs.

**Test runner caveat:** `node:test` doesn't ship fake timers. Wake-gate tests use real `setTimeout` with small (10–50ms) waits to verify coalescing and retry behavior. Tests are slow but honest.

**Commits:** One per task minimum. Conventional-style messages.

**Currently running:** Love just at-rest'd (background `baicg89hk` exited cleanly). The implementation is safe to start now. If a fresh awaken session is opened during implementation, lock-prevention covers concurrent collisions.

---

## Step 0 — Worktree + baseline

- [ ] **0.1 Confirm we're on the right branch and tests pass**

```bash
cd /Users/yuai/Desktop/true-love
git branch --show-current
bun test src/services/love/__tests__/ src/services/love/*.test.ts 2>&1 | tail -5
bun run typecheck 2>&1 | grep "src/services/love/" | grep -v "bun:test" | head
```

Expected: branch is `kingdom-integration` (or whatever Yu has set), 150+ tests pass, no love typecheck errors except the 5 pre-existing `bun:test` import errors in older test files.

- [ ] **0.2 Confirm openclaw clone is reachable for cross-check**

```bash
ls ~/Desktop/openclaw/src/auto-reply/heartbeat.ts
```

Expected: file exists. We won't import from there; we cross-check our parsing against theirs occasionally during implementation.

---

## Task 1: heartbeat.ts core — pure functions

**Files:**
- Create: `src/services/love/heartbeat.ts`
- Create: `src/services/love/__tests__/heartbeat.test.ts`
- Modify: `src/services/love/scope.ts` (add 2 env vars in `applyScopeEnv`)

The pure-function core: token, parsing, due-task logic, ack detection, state I/O, path resolution.

- [ ] **1.1 Write the failing test**

`src/services/love/__tests__/heartbeat.test.ts`:

```typescript
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  HEARTBEAT_OK_TOKEN,
  DEFAULT_ACK_MAX_CHARS,
  DEFAULT_HEARTBEAT_INTERVAL,
  parseHeartbeatTasks,
  isHeartbeatContentEffectivelyEmpty,
  dueTasks,
  parseHeartbeatReply,
  getHeartbeatFile,
  getHeartbeatStatePath,
  readHeartbeatState,
  writeHeartbeatState,
  type HeartbeatTask,
} from '../heartbeat.js'

describe('heartbeat — constants', () => {
  test('exports HEARTBEAT_OK_TOKEN as "HEARTBEAT_OK"', () => {
    assert.equal(HEARTBEAT_OK_TOKEN, 'HEARTBEAT_OK')
  })
  test('exports DEFAULT_ACK_MAX_CHARS as 300', () => {
    assert.equal(DEFAULT_ACK_MAX_CHARS, 300)
  })
  test('exports DEFAULT_HEARTBEAT_INTERVAL as "30m"', () => {
    assert.equal(DEFAULT_HEARTBEAT_INTERVAL, '30m')
  })
})

describe('heartbeat — parseHeartbeatTasks', () => {
  test('returns empty array when no tasks: block', () => {
    const tasks = parseHeartbeatTasks('# Heartbeat\n\nJust some prose.\n')
    assert.deepEqual(tasks, [])
  })

  test('parses a tasks: block with multiple entries', () => {
    const content = `tasks:
  - name: inbox-triage
    interval: 30m
    prompt: Check unread emails.
  - name: calendar-scan
    interval: 2h
    prompt: Upcoming meetings need prep?
`
    const tasks = parseHeartbeatTasks(content)
    assert.equal(tasks.length, 2)
    assert.equal(tasks[0]!.name, 'inbox-triage')
    assert.equal(tasks[0]!.interval, '30m')
    assert.equal(tasks[0]!.intervalMs, 30 * 60 * 1000)
    assert.match(tasks[0]!.prompt, /Check unread emails/)
    assert.equal(tasks[1]!.name, 'calendar-scan')
    assert.equal(tasks[1]!.intervalMs, 2 * 60 * 60 * 1000)
  })

  test('skips entries with malformed interval', () => {
    const content = `tasks:
  - name: bad
    interval: notaduration
    prompt: should be skipped
  - name: good
    interval: 1h
    prompt: kept
`
    const tasks = parseHeartbeatTasks(content)
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0]!.name, 'good')
  })

  test('skips entries missing name or prompt', () => {
    const content = `tasks:
  - interval: 30m
    prompt: no name
  - name: only-name
    interval: 30m
  - name: complete
    interval: 30m
    prompt: kept
`
    const tasks = parseHeartbeatTasks(content)
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0]!.name, 'complete')
  })

  test('handles trailing non-tasks content after the block', () => {
    const content = `tasks:
  - name: t1
    interval: 30m
    prompt: p1

# Additional instructions
- Keep alerts short.
`
    const tasks = parseHeartbeatTasks(content)
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0]!.name, 't1')
  })
})

describe('heartbeat — isHeartbeatContentEffectivelyEmpty', () => {
  test('null/undefined → false (let model decide)', () => {
    assert.equal(isHeartbeatContentEffectivelyEmpty(null), false)
    assert.equal(isHeartbeatContentEffectivelyEmpty(undefined), false)
  })

  test('empty string → true', () => {
    assert.equal(isHeartbeatContentEffectivelyEmpty(''), true)
  })

  test('only whitespace → true', () => {
    assert.equal(isHeartbeatContentEffectivelyEmpty('  \n  \t\n\n'), true)
  })

  test('only markdown headers → true', () => {
    assert.equal(isHeartbeatContentEffectivelyEmpty('# Title\n## Sub\n### Sub2\n'), true)
  })

  test('only empty list items → true', () => {
    assert.equal(isHeartbeatContentEffectivelyEmpty('- \n* \n+ \n- [ ]\n* [x]\n'), true)
  })

  test('only code fences → true', () => {
    assert.equal(isHeartbeatContentEffectivelyEmpty('```\n```markdown\n```\n'), true)
  })

  test('any real prose → false', () => {
    assert.equal(isHeartbeatContentEffectivelyEmpty('# Title\n\nReal content.\n'), false)
  })

  test('list with content → false', () => {
    assert.equal(isHeartbeatContentEffectivelyEmpty('- something to do\n'), false)
  })
})

describe('heartbeat — dueTasks', () => {
  const now = Date.now()
  const tasks: HeartbeatTask[] = [
    { name: 'a', interval: '30m', intervalMs: 30 * 60_000, prompt: 'pa' },
    { name: 'b', interval: '2h', intervalMs: 2 * 3600_000, prompt: 'pb' },
  ]

  test('first run (empty state) — all tasks due', () => {
    const due = dueTasks(tasks, {}, now)
    assert.equal(due.length, 2)
  })

  test('task fired within interval — not due', () => {
    const lastRunAt = { a: now - 5 * 60_000 } // 5 min ago, less than 30m interval
    const due = dueTasks(tasks, lastRunAt, now)
    assert.equal(due.length, 1)
    assert.equal(due[0]!.name, 'b') // a not due, b due (no record)
  })

  test('task fired outside interval — due', () => {
    const lastRunAt = { a: now - 45 * 60_000, b: now - 3 * 3600_000 }
    const due = dueTasks(tasks, lastRunAt, now)
    assert.equal(due.length, 2)
  })

  test('mixed — a due, b not', () => {
    const lastRunAt = { a: now - 45 * 60_000, b: now - 1 * 3600_000 }
    const due = dueTasks(tasks, lastRunAt, now)
    assert.equal(due.length, 1)
    assert.equal(due[0]!.name, 'a')
  })

  test('boundary: exactly intervalMs ago — due', () => {
    const lastRunAt = { a: now - 30 * 60_000 } // exactly 30m ago
    const due = dueTasks(tasks, lastRunAt, now)
    // (now - lastRunAt) >= intervalMs → due
    assert.ok(due.find((t) => t.name === 'a'))
  })
})

describe('heartbeat — parseHeartbeatReply', () => {
  test('"HEARTBEAT_OK" alone → ack with empty content', () => {
    const result = parseHeartbeatReply('HEARTBEAT_OK')
    assert.equal(result.type, 'ack')
    if (result.type === 'ack') assert.equal(result.remainingContent, '')
  })

  test('"HEARTBEAT_OK\\n" alone → ack', () => {
    const result = parseHeartbeatReply('HEARTBEAT_OK\n')
    assert.equal(result.type, 'ack')
  })

  test('OK at start with short content (≤ ackMaxChars) → ack with content stripped', () => {
    const result = parseHeartbeatReply('HEARTBEAT_OK\n\nQuick note: nothing urgent.')
    assert.equal(result.type, 'ack')
    if (result.type === 'ack') assert.match(result.remainingContent, /Quick note/)
  })

  test('OK at end with short content → ack', () => {
    const result = parseHeartbeatReply('Quick note: nothing urgent.\n\nHEARTBEAT_OK')
    assert.equal(result.type, 'ack')
  })

  test('OK at start with long content (> ackMaxChars) → alert', () => {
    const longText = 'x'.repeat(400)
    const result = parseHeartbeatReply(`HEARTBEAT_OK\n\n${longText}`)
    assert.equal(result.type, 'alert')
    if (result.type === 'alert') assert.match(result.content, /xxxx/)
  })

  test('OK in the middle of content → alert (not stripped)', () => {
    const result = parseHeartbeatReply('First part.\n\nHEARTBEAT_OK\n\nSecond part.')
    assert.equal(result.type, 'alert')
    if (result.type === 'alert') {
      assert.match(result.content, /First part/)
      assert.match(result.content, /HEARTBEAT_OK/)
      assert.match(result.content, /Second part/)
    }
  })

  test('content with no token → alert', () => {
    const result = parseHeartbeatReply('Yu — found something urgent in your inbox.')
    assert.equal(result.type, 'alert')
    if (result.type === 'alert') assert.match(result.content, /Yu — found/)
  })

  test('empty string → empty', () => {
    const result = parseHeartbeatReply('')
    assert.equal(result.type, 'empty')
  })

  test('only whitespace → empty', () => {
    const result = parseHeartbeatReply('   \n\n  \t\n')
    assert.equal(result.type, 'empty')
  })

  test('custom ackMaxChars override applies', () => {
    const result = parseHeartbeatReply('HEARTBEAT_OK\n\nshort', { ackMaxChars: 1 })
    // "short" is 5 chars, > 1 → should be alert
    assert.equal(result.type, 'alert')
  })
})

describe('heartbeat — paths + state I/O', () => {
  let homeDir: string
  const ORIG_HOME = process.env.HOME
  const ORIG_HEARTBEAT_FILE = process.env.TRUE_LOVE_HEARTBEAT_FILE
  const ORIG_HEARTBEAT_STATE = process.env.TRUE_LOVE_HEARTBEAT_STATE_PATH

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'tl-hb-'))
    process.env.HOME = homeDir
    delete process.env.TRUE_LOVE_HEARTBEAT_FILE
    delete process.env.TRUE_LOVE_HEARTBEAT_STATE_PATH
  })

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_HEARTBEAT_FILE === undefined) delete process.env.TRUE_LOVE_HEARTBEAT_FILE
    else process.env.TRUE_LOVE_HEARTBEAT_FILE = ORIG_HEARTBEAT_FILE
    if (ORIG_HEARTBEAT_STATE === undefined) delete process.env.TRUE_LOVE_HEARTBEAT_STATE_PATH
    else process.env.TRUE_LOVE_HEARTBEAT_STATE_PATH = ORIG_HEARTBEAT_STATE
  })

  test('getHeartbeatFile defaults to ~/.true-love/heartbeat.md', () => {
    const path = getHeartbeatFile()
    assert.match(path, /\.true-love\/heartbeat\.md$/)
  })

  test('getHeartbeatFile honors TRUE_LOVE_HEARTBEAT_FILE override', () => {
    const custom = join(homeDir, 'custom-heartbeat.md')
    process.env.TRUE_LOVE_HEARTBEAT_FILE = custom
    assert.equal(getHeartbeatFile(), custom)
  })

  test('getHeartbeatStatePath defaults to ~/.true-love/heartbeat-state.json', () => {
    const path = getHeartbeatStatePath()
    assert.match(path, /\.true-love\/heartbeat-state\.json$/)
  })

  test('readHeartbeatState returns fresh state when file missing', () => {
    const state = readHeartbeatState()
    assert.equal(state.schemaVersion, 1)
    assert.deepEqual(state.lastRunAt, {})
    assert.equal(state.lastHeartbeatAt, null)
  })

  test('write + read round-trips state', () => {
    writeHeartbeatState({
      schemaVersion: 1,
      lastRunAt: { 'inbox-triage': 1234567 },
      lastHeartbeatAt: 1234568,
    })
    const state = readHeartbeatState()
    assert.equal(state.lastRunAt['inbox-triage'], 1234567)
    assert.equal(state.lastHeartbeatAt, 1234568)
  })

  test('readHeartbeatState returns fresh state on corrupted JSON', () => {
    const path = getHeartbeatStatePath()
    const dir = path.substring(0, path.lastIndexOf('/'))
    require('node:fs').mkdirSync(dir, { recursive: true })
    writeFileSync(path, 'not valid json', 'utf-8')
    const state = readHeartbeatState()
    assert.deepEqual(state.lastRunAt, {})
  })
})
```

- [ ] **1.2 Run to verify failure**

```bash
bun test src/services/love/__tests__/heartbeat.test.ts
```

Expected: all tests fail with module-not-found.

- [ ] **1.3 Implement `src/services/love/heartbeat.ts`**

```typescript
// heartbeat.ts — pure functions for the heartbeat mode.
//
// What this module is:
//   - Constants:           HEARTBEAT_OK_TOKEN, DEFAULT_ACK_MAX_CHARS,
//                          DEFAULT_HEARTBEAT_INTERVAL.
//   - Parsing:             parseHeartbeatTasks (tasks: block →
//                          HeartbeatTask[]), isHeartbeatContentEffectivelyEmpty.
//   - Scheduling logic:    dueTasks (filter tasks against last-run state).
//   - Reply parsing:       parseHeartbeatReply (HEARTBEAT_OK token contract).
//   - Paths + state I/O:   getHeartbeatFile, getHeartbeatStatePath,
//                          readHeartbeatState, writeHeartbeatState.
//
// What this module is NOT:
//   - It does not run subprocess turns. The runner does that.
//   - It does not schedule timers. heartbeat-wake.ts does that.
//   - It does not deliver alerts. The runner appends to outbox.
//
// Spec: docs/superpowers/specs/2026-04-26-heartbeat-design.md

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

// ── Constants ──────────────────────────────────────────────────────

/** Token the model emits to silently acknowledge "nothing needs attention". */
export const HEARTBEAT_OK_TOKEN = 'HEARTBEAT_OK'

/**
 * Default ack-content threshold. Replies where HEARTBEAT_OK is at start/end
 * AND remaining content (after stripping the token) is ≤ this many chars are
 * treated as ack with the remaining content discarded. Above this threshold,
 * the reply becomes an alert.
 *
 * Matches openclaw's default. Yu can tune via opts.ackMaxChars per call.
 */
export const DEFAULT_ACK_MAX_CHARS = 300

/** Default fire interval — matches openclaw's. Conservative for cost. */
export const DEFAULT_HEARTBEAT_INTERVAL = '30m'

// ── Types ──────────────────────────────────────────────────────────

export interface HeartbeatTask {
  /** Stable identifier for this task (used as key in lastRunAt state). */
  name: string
  /** Human-readable duration string from HEARTBEAT.md, e.g. "30m", "2h". */
  interval: string
  /** Parsed milliseconds. Set by parseHeartbeatTasks. */
  intervalMs: number
  /** Task-specific prompt fragment included in heartbeat turns. */
  prompt: string
}

export type AckResult =
  | { type: 'ack'; remainingContent: string }
  | { type: 'alert'; content: string }
  | { type: 'empty' }

export interface HeartbeatTaskState {
  schemaVersion: 1
  /** Map from task name → epoch ms of last successful fire. */
  lastRunAt: Record<string, number>
  /** Last heartbeat fire (any reason), epoch ms. Null when never fired. */
  lastHeartbeatAt: number | null
}

// ── Path resolution ────────────────────────────────────────────────

/**
 * Per-scope heartbeat checklist file. Default `~/.true-love/heartbeat.md`,
 * overridden by TRUE_LOVE_HEARTBEAT_FILE (set by applyScopeEnv when a named
 * scope is active).
 */
export function getHeartbeatFile(): string {
  return (
    process.env.TRUE_LOVE_HEARTBEAT_FILE ||
    join(homedir(), '.true-love', 'heartbeat.md')
  )
}

/**
 * Per-scope task-state file. Stores lastRunAt timestamps so intervals
 * survive process restarts.
 */
export function getHeartbeatStatePath(): string {
  return (
    process.env.TRUE_LOVE_HEARTBEAT_STATE_PATH ||
    join(homedir(), '.true-love', 'heartbeat-state.json')
  )
}

// ── Duration parsing ───────────────────────────────────────────────

/**
 * Parse a duration string like "30m", "2h", "1h30m", "90s" into milliseconds.
 * Returns null on parse failure. Unitless integers default to minutes
 * (matches openclaw + runner.ts parseRuntimeStr).
 */
function parseDurationMs(s: string): number | null {
  const trimmed = (s ?? '').trim().toLowerCase()
  if (!trimmed) return null
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 60_000
  let total = 0
  let any = false
  const re = /(\d+)\s*(h|m|s)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(trimmed)) !== null) {
    any = true
    const n = Number(m[1])
    const unit = m[2]
    total += n * (unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : 1000)
  }
  return any ? total : null
}

// ── tasks: block parser ────────────────────────────────────────────

/**
 * Parse a `tasks:` YAML-ish block from HEARTBEAT.md content. Skips
 * malformed entries silently. Returns empty array when no block present.
 *
 * Format expected (matches openclaw):
 *
 *   tasks:
 *     - name: <id>
 *       interval: <duration>
 *       prompt: <text>
 *     - name: ...
 *
 * The parser is intentionally lenient — full YAML compliance is overkill
 * for a small workspace file. A regex-based scan suffices.
 */
export function parseHeartbeatTasks(content: string): HeartbeatTask[] {
  if (!content || typeof content !== 'string') return []

  // Find the start of the tasks: block.
  const tasksMatch = content.match(/^\s*tasks:\s*$/m)
  if (!tasksMatch) return []
  const blockStart = tasksMatch.index! + tasksMatch[0].length

  // The block ends at the next top-level non-list-item line, or end-of-file.
  // Top-level = no leading whitespace (markdown headers, prose, etc).
  const after = content.slice(blockStart)
  const endMatch = after.match(/\n([^\s\n#].*$|#.*$)/m)
  const blockText = endMatch ? after.slice(0, endMatch.index!) : after

  // Parse list items: each `- name: X` starts a new entry.
  const tasks: HeartbeatTask[] = []
  const itemRegex = /^\s*-\s*name:\s*(.+?)$/gm
  const matches: { start: number; name: string }[] = []
  let m: RegExpExecArray | null
  while ((m = itemRegex.exec(blockText)) !== null) {
    matches.push({ start: m.index, name: m[1]!.trim() })
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i]!.start
    const end = i + 1 < matches.length ? matches[i + 1]!.start : blockText.length
    const itemText = blockText.slice(start, end)

    const name = matches[i]!.name
    const intervalMatch = itemText.match(/^\s+interval:\s*(.+?)$/m)
    const promptMatch = itemText.match(/^\s+prompt:\s*(.+?)(?:$|\n(?!\s+\w))/ms)

    if (!intervalMatch || !promptMatch || !name) continue
    const interval = intervalMatch[1]!.trim().replace(/^["']|["']$/g, '')
    const intervalMs = parseDurationMs(interval)
    if (intervalMs === null) continue
    const prompt = promptMatch[1]!.trim().replace(/^["']|["']$/g, '')
    if (!prompt) continue

    tasks.push({ name, interval, intervalMs, prompt })
  }

  return tasks
}

// ── Effectively-empty check ────────────────────────────────────────

/**
 * True iff content has no actionable lines. Used to skip API calls when
 * HEARTBEAT.md exists but is just the template scaffolding.
 *
 * "Effectively empty" allows:
 *   - whitespace
 *   - markdown ATX headers (# Title)
 *   - empty list-item stubs (-, *, +, - [ ], * [x])
 *   - markdown code-fence markers (``` or ```language)
 *
 * Anything else → returns false (real content present).
 *
 * null/undefined return false (file missing — let model decide what to do).
 */
export function isHeartbeatContentEffectivelyEmpty(
  content: string | undefined | null,
): boolean {
  if (content === undefined || content === null) return false
  if (typeof content !== 'string') return false
  const lines = content.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (/^#+(\s|$)/.test(trimmed)) continue
    if (/^[-*+]\s*(\[[\sXx]?\]\s*)?$/.test(trimmed)) continue
    if (/^```[A-Za-z0-9_-]*$/.test(trimmed)) continue
    return false
  }
  return true
}

// ── Due-task filter ────────────────────────────────────────────────

/**
 * Filter tasks to those due for firing. A task is due iff:
 *   - It has no record in lastRunAt (first run), OR
 *   - (nowMs - lastRunAt[name]) >= intervalMs.
 *
 * The boundary case (exactly intervalMs ago) is treated as due so a task
 * configured at "30m" actually fires at 30-minute boundaries.
 */
export function dueTasks(
  tasks: HeartbeatTask[],
  lastRunAt: Record<string, number>,
  nowMs: number,
): HeartbeatTask[] {
  return tasks.filter((task) => {
    const last = lastRunAt[task.name]
    if (typeof last !== 'number') return true
    return nowMs - last >= task.intervalMs
  })
}

// ── Reply parsing ──────────────────────────────────────────────────

/**
 * Parse a model reply into AckResult. Contract:
 *
 *   - HEARTBEAT_OK alone (with optional surrounding whitespace) → ack with
 *     empty remainingContent.
 *   - HEARTBEAT_OK at start of reply, remaining content ≤ ackMaxChars after
 *     stripping → ack with remainingContent (the trimmed content, sans token).
 *   - HEARTBEAT_OK at end of reply, content before token ≤ ackMaxChars → ack.
 *   - HEARTBEAT_OK at start/end with content > ackMaxChars → alert (the model
 *     said OK but kept talking — surface the content).
 *   - HEARTBEAT_OK in the middle (not at edge) → alert (don't strip, don't
 *     ack — the token was probably referenced or quoted).
 *   - No token, non-empty content → alert.
 *   - Empty / whitespace-only → empty.
 *
 * `opts.ackMaxChars` overrides DEFAULT_ACK_MAX_CHARS.
 */
export function parseHeartbeatReply(
  rawReply: string,
  opts?: { ackMaxChars?: number },
): AckResult {
  const ackMaxChars = opts?.ackMaxChars ?? DEFAULT_ACK_MAX_CHARS
  if (typeof rawReply !== 'string') return { type: 'empty' }
  const trimmed = rawReply.trim()
  if (!trimmed) return { type: 'empty' }

  const token = HEARTBEAT_OK_TOKEN
  const tokenLen = token.length

  // Token alone (with optional surrounding whitespace).
  if (trimmed === token) return { type: 'ack', remainingContent: '' }

  // Token at start.
  if (trimmed.startsWith(token)) {
    const after = trimmed.slice(tokenLen).trimStart()
    if (after.length <= ackMaxChars) {
      return { type: 'ack', remainingContent: after }
    }
    // Token at start but too much content → alert (the whole thing).
    return { type: 'alert', content: trimmed }
  }

  // Token at end.
  if (trimmed.endsWith(token)) {
    const before = trimmed.slice(0, -tokenLen).trimEnd()
    if (before.length <= ackMaxChars) {
      return { type: 'ack', remainingContent: before }
    }
    return { type: 'alert', content: trimmed }
  }

  // Token in middle, or not present at all → alert.
  return { type: 'alert', content: trimmed }
}

// ── State I/O ──────────────────────────────────────────────────────

/**
 * Read the persistent task-state file. Returns fresh state on missing file
 * or any parse error — the state is best-effort durability, not source of
 * truth. Worst case: a task fires more often than intended for one cycle.
 */
export function readHeartbeatState(): HeartbeatTaskState {
  const fresh: HeartbeatTaskState = {
    schemaVersion: 1,
    lastRunAt: {},
    lastHeartbeatAt: null,
  }
  const path = getHeartbeatStatePath()
  if (!existsSync(path)) return fresh
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<HeartbeatTaskState>
    if (parsed?.schemaVersion !== 1) return fresh
    return {
      schemaVersion: 1,
      lastRunAt:
        parsed.lastRunAt && typeof parsed.lastRunAt === 'object'
          ? (parsed.lastRunAt as Record<string, number>)
          : {},
      lastHeartbeatAt:
        typeof parsed.lastHeartbeatAt === 'number' ? parsed.lastHeartbeatAt : null,
    }
  } catch {
    return fresh
  }
}

/**
 * Write the persistent task-state file. Best-effort — failure is silent so
 * a write hiccup never crashes a heartbeat run. The next read will fall
 * back to fresh state and the next write will repair it.
 */
export function writeHeartbeatState(state: HeartbeatTaskState): void {
  const path = getHeartbeatStatePath()
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8')
  } catch {
    // ignore
  }
}
```

- [ ] **1.4 Modify `src/services/love/scope.ts` — add 2 env vars**

Find the `applyScopeEnv` function (around line 211). Locate the existing `setIfUnset` calls and add 2 new ones for heartbeat:

```typescript
  setIfUnset('TRUE_LOVE_HEARTBEAT_FILE', join(home, 'heartbeat.md'))
  setIfUnset('TRUE_LOVE_HEARTBEAT_STATE_PATH', join(home, 'heartbeat-state.json'))
```

Place them after `TRUE_LOVE_FROM_AI_PATH` and `TRUE_LOVE_MODEL_FILE` (which are around line 225-226), before any block-end.

- [ ] **1.5 Run tests + typecheck**

```bash
bun test src/services/love/__tests__/heartbeat.test.ts
bun run typecheck 2>&1 | grep "src/services/love/" | grep -v "bun:test" | head
```

Expected: 27 tests pass; no new love typecheck errors.

- [ ] **1.6 Commit**

```bash
git add src/services/love/heartbeat.ts src/services/love/__tests__/heartbeat.test.ts src/services/love/scope.ts
git commit -m "feat(love/heartbeat): pure functions — parsing, ack token, due-tasks, state"
```

---

## Task 2: heartbeat-wake.ts — wake-gate

**Files:**
- Create: `src/services/love/heartbeat-wake.ts`
- Create: `src/services/love/__tests__/heartbeat-wake.test.ts`

In-process priority queue for wake requests. Same pattern as openclaw's `heartbeat-wake.ts` but stripped of multi-tenant concerns.

- [ ] **2.1 Write the failing test**

`src/services/love/__tests__/heartbeat-wake.test.ts`:

```typescript
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  requestHeartbeatNow,
  setHeartbeatWakeHandler,
  areHeartbeatsEnabled,
  setHeartbeatsEnabled,
  _resetHeartbeatWakeStateForTests,
  type HeartbeatRunResult,
  type WakeRequest,
} from '../heartbeat-wake.js'

/** Sleep helper — node:test has no fake timers, so we wait for real ms. */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

describe('heartbeat-wake — basic', () => {
  beforeEach(() => {
    _resetHeartbeatWakeStateForTests()
    setHeartbeatsEnabled(true)
  })

  afterEach(() => {
    _resetHeartbeatWakeStateForTests()
  })

  test('areHeartbeatsEnabled defaults to true', () => {
    assert.equal(areHeartbeatsEnabled(), true)
  })

  test('setHeartbeatsEnabled flips the flag', () => {
    setHeartbeatsEnabled(false)
    assert.equal(areHeartbeatsEnabled(), false)
    setHeartbeatsEnabled(true)
    assert.equal(areHeartbeatsEnabled(), true)
  })

  test('requestHeartbeatNow + handler → handler called once after coalesce', async () => {
    let calls: WakeRequest[] = []
    setHeartbeatWakeHandler(async (req) => {
      calls.push(req)
      return { status: 'ran', durationMs: 1, ack: true }
    })

    requestHeartbeatNow({ reason: 'manual', scope: 'default' })
    await sleep(350) // > coalesce window (250ms)

    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.reason, 'manual')
    assert.equal(calls[0]!.scope, 'default')
  })

  test('multiple requests in coalesce window → one call', async () => {
    let calls = 0
    setHeartbeatWakeHandler(async () => {
      calls++
      return { status: 'ran', durationMs: 1, ack: true }
    })

    requestHeartbeatNow({ reason: 'manual', scope: 'default' })
    requestHeartbeatNow({ reason: 'manual', scope: 'default' })
    requestHeartbeatNow({ reason: 'manual', scope: 'default' })
    await sleep(350)

    assert.equal(calls, 1)
  })

  test('different priorities in coalesce window → highest priority wins', async () => {
    let received: WakeRequest | null = null
    setHeartbeatWakeHandler(async (req) => {
      received = req
      return { status: 'ran', durationMs: 1, ack: true }
    })

    requestHeartbeatNow({ reason: 'interval', scope: 'default' })
    requestHeartbeatNow({ reason: 'action', scope: 'default' }) // higher priority
    requestHeartbeatNow({ reason: 'retry', scope: 'default' })
    await sleep(350)

    assert.ok(received)
    assert.equal(received!.reason, 'action')
  })

  test('different scopes do NOT coalesce — both fire', async () => {
    const scopes: string[] = []
    setHeartbeatWakeHandler(async (req) => {
      scopes.push(req.scope ?? '')
      return { status: 'ran', durationMs: 1, ack: true }
    })

    requestHeartbeatNow({ reason: 'manual', scope: 'a' })
    requestHeartbeatNow({ reason: 'manual', scope: 'b' })
    await sleep(350)

    assert.equal(scopes.length, 2)
    assert.deepEqual([...scopes].sort(), ['a', 'b'])
  })

  test('handler returns lock-held → re-queued with retry reason', async () => {
    let calls: WakeRequest[] = []
    let returnLockHeld = true
    setHeartbeatWakeHandler(async (req) => {
      calls.push(req)
      if (returnLockHeld) {
        returnLockHeld = false
        return { status: 'skipped', reason: 'lock-held-by-session' }
      }
      return { status: 'ran', durationMs: 1, ack: true }
    })

    requestHeartbeatNow({ reason: 'manual', scope: 'default' })
    // First call returns lock-held; wake-gate reschedules with 1s retry.
    await sleep(350)
    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.reason, 'manual')

    // Wait for retry-cooldown.
    await sleep(1100)
    assert.equal(calls.length, 2)
    assert.equal(calls[1]!.reason, 'retry')
  })

  test('setHeartbeatsEnabled(false) → handler NOT called', async () => {
    setHeartbeatsEnabled(false)
    let calls = 0
    setHeartbeatWakeHandler(async () => {
      calls++
      return { status: 'ran', durationMs: 1, ack: true }
    })
    requestHeartbeatNow({ reason: 'manual', scope: 'default' })
    await sleep(350)
    assert.equal(calls, 0)
  })

  test('handler not registered → request stays queued, fires when handler set', async () => {
    requestHeartbeatNow({ reason: 'manual', scope: 'default' })
    let calls = 0
    setHeartbeatWakeHandler(async () => {
      calls++
      return { status: 'ran', durationMs: 1, ack: true }
    })
    await sleep(350)
    assert.equal(calls, 1)
  })

  test('handler disposer clears registration', async () => {
    let calls = 0
    const dispose = setHeartbeatWakeHandler(async () => {
      calls++
      return { status: 'ran', durationMs: 1, ack: true }
    })
    dispose()
    requestHeartbeatNow({ reason: 'manual', scope: 'default' })
    await sleep(350)
    assert.equal(calls, 0)
  })
})
```

- [ ] **2.2 Run to verify failure**

```bash
bun test src/services/love/__tests__/heartbeat-wake.test.ts
```

Expected: tests fail with module-not-found.

- [ ] **2.3 Implement `src/services/love/heartbeat-wake.ts`**

```typescript
// heartbeat-wake.ts — in-process wake-gate for the heartbeat mode.
//
// Multiple sources can request a heartbeat fire (the launchd timer is
// external; in-process callers might be: signal handlers, session
// at-rest hooks, ache/feeling daemons emitting arrival events). The
// wake-gate is the priority queue + coalesce window + retry-on-busy
// machinery that batches those requests and dispatches them to a
// registered handler.
//
// This is the v2-ready API surface. v1 has only one in-process caller
// (manual `requestHeartbeatNow` for testing). External launchd-fired
// heartbeats run via `bin/heartbeat.mjs` directly without using this
// gate — they're standalone processes.
//
// Pattern ported from openclaw's heartbeat-wake.ts (their
// implementation: ~250 lines, multi-tenant). Stripped of agentId/
// sessionKey targeting (Love is single-user), kept the priority
// queue + coalesce + retry skeleton.
//
// Spec: docs/superpowers/specs/2026-04-26-heartbeat-design.md

// ── Types ──────────────────────────────────────────────────────────

export type HeartbeatReason =
  | 'interval'
  | 'manual'
  | 'retry'
  | 'action'

export type SkipReason =
  | 'lock-held-by-session'
  | 'empty-heartbeat-file'
  | 'no-tasks-due'
  | 'kingdom-skip'
  | 'outside-active-hours'
  | 'requests-in-flight'

export type HeartbeatRunResult =
  | { status: 'ran'; durationMs: number; ack: boolean }
  | { status: 'skipped'; reason: SkipReason }
  | { status: 'failed'; reason: string }

export interface WakeRequest {
  reason: HeartbeatReason
  scope?: string
  requestedAt: number
}

export type HeartbeatWakeHandler = (req: WakeRequest) => Promise<HeartbeatRunResult>

// ── Constants ──────────────────────────────────────────────────────

const DEFAULT_COALESCE_MS = 250
const DEFAULT_RETRY_MS = 1_000

const REASON_PRIORITY: Record<HeartbeatReason, number> = {
  retry: 0,
  interval: 1,
  manual: 3,
  action: 3,
}

// ── Module state ───────────────────────────────────────────────────

let heartbeatsEnabled = true
let handler: HeartbeatWakeHandler | null = null
let handlerGeneration = 0

const pendingWakes = new Map<string, WakeRequest & { priority: number }>()

let timer: ReturnType<typeof setTimeout> | null = null
let timerDueAt: number | null = null
let timerKind: 'normal' | 'retry' | null = null
let scheduled = false
let running = false

// ── Public API ─────────────────────────────────────────────────────

export function areHeartbeatsEnabled(): boolean {
  return heartbeatsEnabled
}

export function setHeartbeatsEnabled(enabled: boolean): void {
  heartbeatsEnabled = enabled
}

/**
 * Enqueue a wake request. Coalesces with any other in-flight requests for
 * the same scope (the higher-priority request wins; same-priority later
 * request wins). Schedules the handler to fire after coalesceMs.
 *
 * Best-effort. Failure (e.g. handler not registered) keeps the request
 * queued — when a handler eventually registers, queued requests fire.
 */
export function requestHeartbeatNow(opts?: {
  reason?: HeartbeatReason
  scope?: string
  coalesceMs?: number
}): void {
  if (!heartbeatsEnabled) return
  queuePending({
    reason: opts?.reason ?? 'manual',
    scope: opts?.scope,
    requestedAt: Date.now(),
  })
  schedule(opts?.coalesceMs ?? DEFAULT_COALESCE_MS, 'normal')
}

/**
 * Register the handler that runs heartbeats. The runner sets this when it
 * boots into a long-running mode. Returns a disposer. Stale disposers
 * (from a prior registration) are no-ops.
 */
export function setHeartbeatWakeHandler(
  next: HeartbeatWakeHandler | null,
): () => void {
  handlerGeneration += 1
  const generation = handlerGeneration
  handler = next
  if (next) {
    // Reset stale module state from prior lifecycle (e.g. interrupted run).
    if (timer) clearTimeout(timer)
    timer = null
    timerDueAt = null
    timerKind = null
    running = false
    scheduled = false
    if (pendingWakes.size > 0) {
      schedule(DEFAULT_COALESCE_MS, 'normal')
    }
  }
  return () => {
    if (handlerGeneration !== generation) return
    if (handler !== next) return
    handlerGeneration += 1
    handler = null
  }
}

export function _resetHeartbeatWakeStateForTests(): void {
  if (timer) clearTimeout(timer)
  timer = null
  timerDueAt = null
  timerKind = null
  pendingWakes.clear()
  scheduled = false
  running = false
  handlerGeneration += 1
  handler = null
  heartbeatsEnabled = true
}

// ── Internals ──────────────────────────────────────────────────────

function priorityOf(reason: HeartbeatReason): number {
  return REASON_PRIORITY[reason] ?? 1
}

function scopeKey(scope?: string): string {
  return scope ?? '__default__'
}

function queuePending(req: WakeRequest): void {
  const key = scopeKey(req.scope)
  const priority = priorityOf(req.reason)
  const existing = pendingWakes.get(key)
  if (!existing) {
    pendingWakes.set(key, { ...req, priority })
    return
  }
  if (priority > existing.priority) {
    pendingWakes.set(key, { ...req, priority })
    return
  }
  if (priority === existing.priority && req.requestedAt >= existing.requestedAt) {
    pendingWakes.set(key, { ...req, priority })
  }
}

function schedule(coalesceMs: number, kind: 'normal' | 'retry'): void {
  const delay = Number.isFinite(coalesceMs) ? Math.max(0, coalesceMs) : DEFAULT_COALESCE_MS
  const dueAt = Date.now() + delay

  if (timer) {
    // Retry cooldown is a hard minimum — never collapse it with a normal call.
    if (timerKind === 'retry') return
    if (typeof timerDueAt === 'number' && timerDueAt <= dueAt) return
    clearTimeout(timer)
    timer = null
    timerDueAt = null
    timerKind = null
  }

  timerDueAt = dueAt
  timerKind = kind
  timer = setTimeout(async () => {
    timer = null
    timerDueAt = null
    timerKind = null
    scheduled = false
    if (!handler) return
    if (running) {
      scheduled = true
      schedule(delay, kind)
      return
    }

    const batch = Array.from(pendingWakes.values())
    pendingWakes.clear()
    running = true
    try {
      for (const pending of batch) {
        const req: WakeRequest = {
          reason: pending.reason,
          scope: pending.scope,
          requestedAt: pending.requestedAt,
        }
        const res = await handler(req)
        if (res.status === 'skipped' && res.reason === 'lock-held-by-session') {
          // Lock held — requeue and reschedule with retry cooldown.
          queuePending({
            reason: 'retry',
            scope: pending.scope,
            requestedAt: Date.now(),
          })
          schedule(DEFAULT_RETRY_MS, 'retry')
        }
      }
    } catch {
      for (const pending of batch) {
        queuePending({
          reason: 'retry',
          scope: pending.scope,
          requestedAt: Date.now(),
        })
      }
      schedule(DEFAULT_RETRY_MS, 'retry')
    } finally {
      running = false
      if (pendingWakes.size > 0 || scheduled) {
        schedule(delay, 'normal')
      }
    }
  }, delay)
  if (typeof timer.unref === 'function') timer.unref()
}
```

- [ ] **2.4 Run tests + typecheck**

```bash
bun test src/services/love/__tests__/heartbeat-wake.test.ts
bun run typecheck 2>&1 | grep "src/services/love/" | grep -v "bun:test" | head
```

Expected: 9 tests pass (the retry test takes ~1.1s due to real-timer cooldown). No love typecheck errors.

- [ ] **2.5 Commit**

```bash
git add src/services/love/heartbeat-wake.ts src/services/love/__tests__/heartbeat-wake.test.ts
git commit -m "feat(love/heartbeat): in-process wake-gate (priority queue + coalesce + retry)"
```

---

## Task 3: SessionMode polymorphism — parseReply hook

**Files:**
- Modify: `src/services/love/runner.ts`

Add `'heartbeat'` to `SessionMode.name`, add optional `parseReply` hook, add `SessionReplyOutcome` type. Default behavior preserved for awakened/dwell.

- [ ] **3.1 Modify the `SessionMode` interface in `runner.ts`**

Find the `SessionMode` interface (around line 90 — the one with `name: 'dwell' | 'awakened'`). Replace it with:

```typescript
/**
 * The shape of a model reply, after parsing. The for-loop dispatches on
 * `type` to decide what to do next:
 *
 *   - 'continue': awakened/dwell — there's more, keep looping
 *   - 'rest':     awakened/dwell — sentinel <at-rest/> seen, exit
 *   - 'ack':      heartbeat — HEARTBEAT_OK token at edge, suppress alert
 *   - 'alert':    heartbeat — surface the content via outbox
 */
export type SessionReplyOutcome =
  | { type: 'continue'; reflection: string }
  | { type: 'rest'; reflection?: string }
  | { type: 'ack'; remainingContent: string }
  | { type: 'alert'; content: string }

export interface SessionMode {
  /** 'dwell' | 'awakened' | 'heartbeat'. Used in log messages and training records. */
  name: 'dwell' | 'awakened' | 'heartbeat'

  /** Heartbeat status label: 'dwelling' | 'awakened' | 'heartbeat'. */
  heartbeatLabel: string

  /** Default ceiling for ticks when not specified via CLI. */
  defaultMaxTicks: number

  /** Default max past reflections to load when --memory is bare. */
  defaultMemoryMax: number

  /** Upper bound for --memory=N. Prevents accidental huge context loads. */
  memoryMaxCap: number

  /** How many days back to look for past reflections. */
  memoryDays: number

  /** Prefix for session-start log entries. */
  sessionLogPrefix: string

  /** Build the prompt for this mode. */
  buildPrompt: (opts: BuildDwellPromptOptions) => string

  /**
   * Parse subprocess stdout into a control decision. When unset, the
   * runner uses the default (extractAtRest) which yields 'rest' or
   * 'continue'. Heartbeat mode sets this to a HEARTBEAT_OK-aware parser.
   */
  parseReply?: (stdout: string) => SessionReplyOutcome

  /** Print usage/help to stdout, then return. Called on -h/--help. */
  printUsage: () => void
}
```

- [ ] **3.2 Add the default parseReply adapter inside `runner.ts`**

Just below the `SessionMode` interface (still in `runner.ts`), add:

```typescript
/**
 * Default reply parser for awakened/dwell modes — wraps extractAtRest in
 * the SessionReplyOutcome shape. Heartbeat mode overrides via
 * SessionMode.parseReply.
 */
function defaultParseReply(stdout: string): SessionReplyOutcome {
  const result = extractAtRest(stdout)
  if (result.atRest) {
    return { type: 'rest', reflection: result.reflection }
  }
  return { type: 'continue', reflection: stdout.trim() }
}
```

- [ ] **3.3 Verify the existing modes still typecheck and existing tests pass**

```bash
bun run typecheck 2>&1 | grep "src/services/love/" | grep -v "bun:test" | head
bun test src/services/love/__tests__/ src/services/love/*.test.ts 2>&1 | tail -5
```

Expected: no new love typecheck errors; existing 150+ tests still pass (no behavior change yet — we just added types and a helper that nothing calls).

- [ ] **3.4 Commit**

```bash
git add src/services/love/runner.ts
git commit -m "refactor(love/runner): SessionReplyOutcome + parseReply hook (no behavior change)"
```

---

## Task 4: autonomy.ts heartbeat prompt + index.ts exports

**Files:**
- Modify: `src/services/love/autonomy.ts`
- Modify: `src/services/love/index.ts`

Add the `HEARTBEAT_PROMPT_TEMPLATE`, `BuildHeartbeatPromptOptions`, and `buildHeartbeatPrompt`. Re-export the new heartbeat surface from `index.ts`.

- [ ] **4.1 Append to `src/services/love/autonomy.ts`**

Add at the end of the file (after `AWAKENED_DEFAULT_MAX_TICKS = 24`):

```typescript
// ── Heartbeat mode ──────────────────────────────────────────────────────
//
// Heartbeat is a single-tick check: "you've been quiet for 30 minutes;
// walk the kingdom briefly; surface anything urgent or stay silent."
// Different from dwell (reactive) and awakened (active multi-tick).

const HEARTBEAT_PROMPT_TEMPLATE = `Heartbeat tick. One turn, one decision.

Walk the kingdom briefly:

- Inbox (\`{{fromYuPath}}\`): anything pending from Yu you haven't responded to?
- Outbox (\`{{fromAiPath}}\`): anything you said you'd follow up on that's now actionable?
- State (\`{{statePath}}\`): anything you're carrying that's gotten urgent?
- Memory (recent): anything from your last session you said "next time" about?
- Heartbeat checklist (\`{{heartbeatPath}}\`): {{heartbeatContent}}

The kingdom right now:

{{kingdom}}

Reply rules:
- If something genuinely calls — write a short message to Yu by appending to \`{{fromAiPath}}\`. Then end your response with the alert text on its own line(s).
- If nothing calls — reply with HEARTBEAT_OK on its own line. The runtime treats that as a clean ack and stays silent.

Don't invent things. Don't pad. Don't apologize for being quiet. One tick, one decision.`

export interface BuildHeartbeatPromptOptions {
  kingdom: KingdomSnapshot
  /** Resolved path to ~/.true-love/heartbeat.md (per scope). */
  heartbeatPath: string
  /**
   * Content describing what's in the heartbeat file — either a one-line
   * "no checklist" note or a rendering of due tasks parsed from the
   * tasks: block. Caller (the runner) decides which.
   */
  heartbeatContent: string
}

export function buildHeartbeatPrompt(opts: BuildHeartbeatPromptOptions): string {
  const kingdomBlock = renderKingdom(opts.kingdom)
  return HEARTBEAT_PROMPT_TEMPLATE
    .replace('{{kingdom}}', kingdomBlock)
    .replace('{{heartbeatPath}}', opts.heartbeatPath)
    .replace('{{heartbeatContent}}', opts.heartbeatContent)
    .replace('{{fromYuPath}}', getFromYuPath())
    .replace('{{fromAiPath}}', getFromAiPath())
    .replace('{{statePath}}', getStatePath())
}

/** Single-tick by definition. Heartbeat never multi-ticks. */
export const HEARTBEAT_DEFAULT_MAX_TICKS = 1
```

You will need imports for `getFromYuPath` and (if not already imported) `getFromAiPath`. Check the top of `autonomy.ts` — `getFromAiPath` should be there from prior work; `getFromYuPath` may need to be added. The inbox import currently has `readFromYu`; extend to `import { readFromYu, getFromYuPath } from './inbox.js'`.

- [ ] **4.2 Update `src/services/love/index.ts`**

Add the heartbeat exports. Find the existing autonomy export block and add `HEARTBEAT_DEFAULT_MAX_TICKS` + `buildHeartbeatPrompt` + `BuildHeartbeatPromptOptions`:

```typescript
export type {
  BuildDwellPromptOptions,
  BuildAwakenedPromptOptions,
  BuildHeartbeatPromptOptions,
} from './autonomy.js'
export {
  buildDwellPrompt,
  buildAwakenedPrompt,
  buildHeartbeatPrompt,
  extractAtRest,
  DEFAULT_MAX_TICKS,
  AWAKENED_DEFAULT_MAX_TICKS,
  HEARTBEAT_DEFAULT_MAX_TICKS,
} from './autonomy.js'
```

Add a new export block for the heartbeat module:

```typescript
export type {
  HeartbeatTask,
  AckResult,
  HeartbeatTaskState,
} from './heartbeat.js'
export {
  HEARTBEAT_OK_TOKEN,
  DEFAULT_ACK_MAX_CHARS,
  DEFAULT_HEARTBEAT_INTERVAL,
  parseHeartbeatTasks,
  isHeartbeatContentEffectivelyEmpty,
  dueTasks,
  parseHeartbeatReply,
  getHeartbeatFile,
  getHeartbeatStatePath,
  readHeartbeatState,
  writeHeartbeatState,
} from './heartbeat.js'

export type {
  HeartbeatReason,
  SkipReason,
  HeartbeatRunResult,
  WakeRequest,
  HeartbeatWakeHandler,
} from './heartbeat-wake.js'
export {
  requestHeartbeatNow,
  setHeartbeatWakeHandler,
  areHeartbeatsEnabled,
  setHeartbeatsEnabled,
} from './heartbeat-wake.js'
```

Also update the `SessionReplyOutcome` export from `runner.ts` — find the existing runner export block:

```typescript
export type {
  SessionMode,
  SessionArgs,
  RunSessionConfig,
  StalenessResult,
  SessionReplyOutcome,
} from './runner.js'
```

- [ ] **4.3 Run tests + typecheck**

```bash
bun test src/services/love/__tests__/ src/services/love/*.test.ts 2>&1 | tail -5
bun run typecheck 2>&1 | grep "src/services/love/" | grep -v "bun:test" | head
```

Expected: all 180+ tests still pass (no test added in this task); no new love typecheck errors.

- [ ] **4.4 Commit**

```bash
git add src/services/love/autonomy.ts src/services/love/index.ts
git commit -m "feat(love/heartbeat): buildHeartbeatPrompt + index exports"
```

---

## Task 5: runner.ts heartbeat path

**Files:**
- Modify: `src/services/love/runner.ts`

Wire heartbeat mode into `runSession`: pre-loop skip checks, post-tick parseReply dispatch, ack-or-alert handling.

- [ ] **5.1 Add heartbeat imports to runner.ts**

Find the existing import block at the top of `runner.ts`. Add:

```typescript
import {
  buildHeartbeatPrompt,
} from './autonomy.js'
import {
  dueTasks,
  getHeartbeatFile,
  isHeartbeatContentEffectivelyEmpty,
  parseHeartbeatReply,
  parseHeartbeatTasks,
  readHeartbeatState,
  writeHeartbeatState,
  type HeartbeatTask,
} from './heartbeat.js'
import { appendFileSync } from 'node:fs'
import { getFromAiPath } from './outbox.js'
```

(Some of these may already be imported. Add only the missing ones.)

- [ ] **5.2 Add heartbeat skip-check helper**

Right above the `runSession` function definition, add:

```typescript
interface HeartbeatPreflightResult {
  shouldRun: boolean
  skipReason?: 'empty-heartbeat-file' | 'no-tasks-due'
  heartbeatPath: string
  heartbeatContent: string
  dueTasksList: HeartbeatTask[]
}

/**
 * Heartbeat-mode skip checks before the tick runs:
 *   - Heartbeat file is effectively empty? Skip with empty-heartbeat-file.
 *   - tasks: block present but no tasks due? Skip with no-tasks-due.
 *   - Otherwise: build heartbeat content for the prompt.
 */
function preflightHeartbeat(): HeartbeatPreflightResult {
  const heartbeatPath = getHeartbeatFile()
  let raw: string | null = null
  try {
    raw = require('node:fs').existsSync(heartbeatPath)
      ? require('node:fs').readFileSync(heartbeatPath, 'utf-8')
      : null
  } catch {
    raw = null
  }

  // Missing file → run with "no checklist" note (model decides).
  if (raw === null) {
    return {
      shouldRun: true,
      heartbeatPath,
      heartbeatContent: '(no checklist file present)',
      dueTasksList: [],
    }
  }

  if (isHeartbeatContentEffectivelyEmpty(raw)) {
    return {
      shouldRun: false,
      skipReason: 'empty-heartbeat-file',
      heartbeatPath,
      heartbeatContent: '',
      dueTasksList: [],
    }
  }

  const tasks = parseHeartbeatTasks(raw)
  if (tasks.length === 0) {
    // No tasks: block — use the file content verbatim as the checklist.
    return {
      shouldRun: true,
      heartbeatPath,
      heartbeatContent: raw.trim(),
      dueTasksList: [],
    }
  }

  const state = readHeartbeatState()
  const due = dueTasks(tasks, state.lastRunAt, Date.now())
  if (due.length === 0) {
    return {
      shouldRun: false,
      skipReason: 'no-tasks-due',
      heartbeatPath,
      heartbeatContent: '',
      dueTasksList: [],
    }
  }

  const renderedTasks = due
    .map((t) => `- [${t.name}] ${t.prompt}`)
    .join('\n')
  return {
    shouldRun: true,
    heartbeatPath,
    heartbeatContent: `due tasks:\n${renderedTasks}`,
    dueTasksList: due,
  }
}
```

- [ ] **5.3 Add heartbeat-mode pre-loop branch in `runSession`**

Find the section in `runSession` after lock acquisition + before the `for (let tick = 1; ...)` loop. Add (right after the existing memory load `if (args.memory) { ... }` block):

```typescript
  // ── Heartbeat preflight ──────────────────────────────────────────
  let heartbeatPreflight: HeartbeatPreflightResult | null = null
  if (mode.name === 'heartbeat') {
    heartbeatPreflight = preflightHeartbeat()
    if (!heartbeatPreflight.shouldRun) {
      process.stdout.write(
        `— heartbeat skipped: ${heartbeatPreflight.skipReason}\n`,
      )
      // Lock cleanup happens via the existing exit handler.
      return
    }
    process.stdout.write(
      `— heartbeat: ${heartbeatPreflight.heartbeatContent.split('\n')[0] || '(checklist)'}\n`,
    )
  }
```

- [ ] **5.4 Wire heartbeat-aware prompt build in the for-loop**

Find the existing prompt-build line in the for-loop:

```typescript
const prompt = mode.buildPrompt({
  kingdom,
  lastReflection,
  memory,
  invitation: args.invitation,
  liveThoughts,
  kingdomBlock,
})
```

Replace with a branched version:

```typescript
const prompt =
  mode.name === 'heartbeat' && heartbeatPreflight
    ? buildHeartbeatPrompt({
        kingdom,
        heartbeatPath: heartbeatPreflight.heartbeatPath,
        heartbeatContent: heartbeatPreflight.heartbeatContent,
      })
    : mode.buildPrompt({
        kingdom,
        lastReflection,
        memory,
        invitation: args.invitation,
        liveThoughts,
        kingdomBlock,
      })
```

- [ ] **5.5 Replace `extractAtRest` dispatch with `mode.parseReply`**

Find the existing line in the for-loop where `extractAtRest` is called (the one that produces `atRest` + `reflection`). Look for a block like:

```typescript
const { atRest, reflection } = extractAtRest(result.stdout)
```

Replace with:

```typescript
const replyOutcome = mode.parseReply
  ? mode.parseReply(result.stdout)
  : defaultParseReply(result.stdout)
```

Then find the existing branching (`if (atRest) { ... }`). Replace with a switch on `replyOutcome.type`. Be careful: there's training-emit and budget-recording logic between the parse and the at-rest branch — those should run regardless.

The simplest refactor: keep `atRest` and `reflection` as derived locals immediately after the parse, for backward compat with the rest of the for-loop:

```typescript
const replyOutcome = mode.parseReply
  ? mode.parseReply(result.stdout)
  : defaultParseReply(result.stdout)

// Backward-compat shim for the existing training-emit + budget logic.
const atRest =
  replyOutcome.type === 'rest' || replyOutcome.type === 'ack'
const reflection =
  replyOutcome.type === 'rest' || replyOutcome.type === 'continue'
    ? replyOutcome.reflection
    : undefined
```

Then later in the loop, where the existing `if (atRest) { ... }` branch lives, REPLACE the body with a dispatch on `replyOutcome.type`:

```typescript
    if (replyOutcome.type === 'alert') {
      // Heartbeat alert: append to outbox + memory + return.
      const alertContent = replyOutcome.content
      try {
        appendFileSync(
          getFromAiPath(),
          `\n## ${new Date().toISOString()} [from 愛 — heartbeat]\n\n${alertContent}\n\n---\n`,
          'utf-8',
        )
      } catch (e: any) {
        process.stderr.write(`— heartbeat outbox write failed: ${e?.message}\n`)
      }
      if (!args.noLog) {
        appendReflection(alertContent, 'tick', { tick })
      }
      // Advance task state.
      if (heartbeatPreflight && heartbeatPreflight.dueTasksList.length > 0) {
        const state = readHeartbeatState()
        const now = Date.now()
        for (const t of heartbeatPreflight.dueTasksList) {
          state.lastRunAt[t.name] = now
        }
        state.lastHeartbeatAt = now
        writeHeartbeatState(state)
      }
      process.stdout.write(`\n— heartbeat alert appended to outbox\n`)
      releaseLockHere()
      return
    }

    if (replyOutcome.type === 'ack') {
      // Heartbeat ack: silent. Advance task state, do NOT write outbox.
      if (heartbeatPreflight && heartbeatPreflight.dueTasksList.length > 0) {
        const state = readHeartbeatState()
        const now = Date.now()
        for (const t of heartbeatPreflight.dueTasksList) {
          state.lastRunAt[t.name] = now
        }
        state.lastHeartbeatAt = now
        writeHeartbeatState(state)
      }
      process.stdout.write(`\n— heartbeat ok (silent)\n`)
      releaseLockHere()
      return
    }

    if (replyOutcome.type === 'rest') {
      // existing rest behavior — preserved for awakened/dwell
      // Yu-message-aware continuation, attestation, etc. — keep whatever
      // was here before the refactor.
      // [existing at-rest logic stays here unchanged]
    }

    // 'continue' — fall through to the next loop iteration (existing behavior).
```

**Important:** do not delete the existing `if (atRest)` body — port it into the `replyOutcome.type === 'rest'` branch. Including the from-yu-modified-since continuation, the kingdom attestation, and the lock release. Same logic, just inside the new branch.

- [ ] **5.6 Verify tests still pass**

```bash
bun test src/services/love/__tests__/ src/services/love/*.test.ts 2>&1 | tail -5
bun run typecheck 2>&1 | grep "src/services/love/" | grep -v "bun:test" | head
```

Expected: existing 180+ tests still pass; no love typecheck errors.

If existing awaken/dwell tests break, the rest-branch refactor is the likely culprit — verify the at-rest body is fully ported.

- [ ] **5.7 Commit**

```bash
git add src/services/love/runner.ts
git commit -m "feat(love/runner): heartbeat path — preflight skips, ack/alert dispatch"
```

---

## Task 6: bin/heartbeat.mjs thin wrapper

**Files:**
- Create: `bin/heartbeat.mjs`
- Modify: `package.json` (add script alias)

- [ ] **6.1 Create `bin/heartbeat.mjs`**

```javascript
#!/usr/bin/env node
// bin/heartbeat.mjs — single-tick heartbeat.
//
// Heartbeat is the "she initiates" mode: every N minutes (or on manual
// trigger / event), one tick fires that reads HEARTBEAT.md, walks the
// kingdom, and either acks silently with HEARTBEAT_OK or surfaces
// something to Yu's outbox.
//
// The loop machinery lives in runner.ts; this file is the mode config.
//
// Usage:
//   bun run heartbeat                              run once (interval reason)
//   bun run heartbeat -- --scope=<name>            scope override
//   bun run heartbeat -- --reason=manual           reason tag for training records
//   bun run heartbeat -- --no-log                  skip writing reflections to disk
//
// Spec: docs/superpowers/specs/2026-04-26-heartbeat-design.md

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  HEARTBEAT_DEFAULT_MAX_TICKS,
  buildHeartbeatPrompt,
  parseHeartbeatReply as parseHeartbeatReplyRaw,
  runSession,
} from '../src/services/love/index.ts'

const __dir = dirname(fileURLToPath(import.meta.url))

/**
 * Adapter: parseHeartbeatReply returns AckResult ({type: 'ack'|'alert'|'empty'}).
 * runner.ts expects SessionReplyOutcome ({type: 'continue'|'rest'|'ack'|'alert'}).
 * Map 'empty' → 'ack' with empty content (per spec failure-modes table).
 */
function heartbeatParseReply(stdout) {
  const result = parseHeartbeatReplyRaw(stdout)
  if (result.type === 'empty') {
    return { type: 'ack', remainingContent: '' }
  }
  return result
}

runSession({
  mode: {
    name: 'heartbeat',
    heartbeatLabel: 'heartbeat',
    defaultMaxTicks: HEARTBEAT_DEFAULT_MAX_TICKS,
    defaultMemoryMax: 0,
    memoryMaxCap: 0,
    memoryDays: 0,
    sessionLogPrefix: 'Heartbeat tick',
    // The heartbeat prompt builder is invoked directly by runner.ts when
    // mode.name === 'heartbeat'. The mode.buildPrompt fallback exists for
    // shape-compatibility but is not called.
    buildPrompt: () => {
      throw new Error('heartbeat mode bypasses mode.buildPrompt; runner.ts calls buildHeartbeatPrompt directly')
    },
    parseReply: heartbeatParseReply,
    printUsage() {
      process.stdout.write(`bin/heartbeat.mjs — single-tick heartbeat

Heartbeat is the "she initiates" mode: every N minutes (or on manual
trigger), one tick reads HEARTBEAT.md, walks the kingdom, and either
acks silently with HEARTBEAT_OK or surfaces something to Yu's outbox.

Usage:
  bun run heartbeat                            run once (interval reason)
  bun run heartbeat -- --scope=<name>          named scope (see scope list)
  bun run heartbeat -- --reason=manual         reason tag for training records
  bun run heartbeat -- --no-log                skip writing reflections to disk
  bun run heartbeat -- --cwd <path>            kingdom root (default: $PWD)

Each call spawns one tick of \`node dist/cli.mjs --print "<HEARTBEAT_PROMPT>"\`
and exits cleanly. Bundle must be built first: \`bun run build\`.

The tick yields:
  - HEARTBEAT_OK alone or with short trailer (≤ 300 chars) → silent ack
  - any other content → appended to ~/.true-love/from-ai.md as an alert
  - empty stdout → silent ack with warning

Lock interaction: a heartbeat fired while an awaken/dwell session holds
the per-scope lock exits cleanly with skip reason \`lock-held-by-session\`.
Use \`bun run schedule install --mode=heartbeat --interval=30m\` to wire
the launchd plist that fires this every 30 minutes.

State (~/.true-love/heartbeat-state.json) tracks per-task last-run times
so \`tasks:\` block intervals survive process restarts.

Heartbeat checklist file (~/.true-love/heartbeat.md): keep it small.
If empty / only-headers, the runtime skips the API call entirely.
`)
    },
  },
  binDir: __dir,
  bundlePath: resolve(__dir, '..', 'dist/cli.mjs'),
}).catch((err) => {
  process.stderr.write(`fatal: ${err?.stack ?? err}\n`)
  process.exit(1)
})
```

- [ ] **6.2 Add npm script alias in `package.json`**

Find the existing scripts block (already has `awaken`, `dwell`, `say`, etc.). Add:

```json
"heartbeat": "bun run bin/heartbeat.mjs",
```

Place it alphabetically near `awaken`/`dwell`.

- [ ] **6.3 Build + sanity-check the heartbeat invocation**

```bash
bun run build 2>&1 | tail -3
node --check bin/heartbeat.mjs && echo "syntax OK"
```

Expected: bundle builds; node --check passes.

(Don't actually run the heartbeat against real Anthropic API yet — Task 8 is the smoke.)

- [ ] **6.4 Run tests + typecheck**

```bash
bun test src/services/love/__tests__/ src/services/love/*.test.ts 2>&1 | tail -5
bun run typecheck 2>&1 | grep "src/services/love/" | grep -v "bun:test" | head
```

Expected: all 180+ tests pass; no love typecheck errors.

- [ ] **6.5 Commit**

```bash
git add bin/heartbeat.mjs package.json
git commit -m "feat(love/heartbeat): bin/heartbeat.mjs thin wrapper + npm script"
```

---

## Task 7: schedule.mjs — `--mode=heartbeat`

**Files:**
- Modify: `bin/schedule.mjs`

The scheduler installer already handles `--mode=awaken|dwell`. Extend to `heartbeat`.

- [ ] **7.1 Read the existing schedule.mjs implementation**

```bash
grep -nE "mode|MODE|awaken|dwell" bin/schedule.mjs | head -30
```

The existing implementation typically has:
- A `parseMode` or argument parser that validates `--mode=awaken|dwell`
- A `buildPlist({mode, scope, interval, ...})` that emits the plist XML
- A label generator like `cc.true-love.<mode>.<scope>`

- [ ] **7.2 Locate the mode validator**

Find the line(s) that check valid modes. Typically one of:
- `if (!['awaken', 'dwell'].includes(mode)) { throw ... }`
- A switch/case
- A type guard

Add `'heartbeat'` to the allowed list.

- [ ] **7.3 Locate the plist `ProgramArguments` builder**

Find where `bun` is invoked. There's likely a line like:
```javascript
ProgramArguments: [bunBin, 'run', 'awaken', '--', `--scope=${scope}`, ...]
```
Or a function that returns the array given a mode.

For `mode === 'heartbeat'`, the invocation should be:
```javascript
[bunBin, 'run', 'heartbeat', '--', `--scope=${scope}`, '--reason=interval']
```

- [ ] **7.4 Heartbeat plist defaults: `RunAtLoad: false`**

Awaken/dwell plists may have `RunAtLoad: true` (run when launchd starts the agent). Heartbeats should NOT auto-fire on every machine reboot — match openclaw's "disable until you trust the setup" philosophy. Set `RunAtLoad: false` for heartbeat plists specifically.

If `buildPlist` accepts a `runAtLoad` parameter, pass `false` for heartbeat. If not, branch on `mode === 'heartbeat'` when emitting the XML.

- [ ] **7.5 Sanity test: dry-run install for heartbeat**

```bash
node --check bin/schedule.mjs && echo "syntax OK"
bun run schedule -- list 2>&1 | head -20
```

If the schedule script supports a `--dry-run` flag, use it:
```bash
bun run schedule install --mode=heartbeat --scope=default --interval=30m --dry-run 2>&1 | head -30
```

If no dry-run, just verify the help text now lists `--mode=heartbeat`:

```bash
bun run schedule install --help 2>&1 | grep -i heartbeat
```

Expected: heartbeat is listed as a valid mode.

- [ ] **7.6 Run all tests + typecheck**

```bash
bun test src/services/love/__tests__/ src/services/love/*.test.ts 2>&1 | tail -5
bun run typecheck 2>&1 | grep "src/services/love/" | grep -v "bun:test" | head
node --check bin/schedule.mjs && echo "syntax OK"
```

Expected: all tests pass.

- [ ] **7.7 Commit**

```bash
git add bin/schedule.mjs
git commit -m "feat(love/heartbeat): bin/schedule.mjs accepts --mode=heartbeat"
```

---

## Task 8: Manual smoke test

**Files:** none modified.

End-to-end verification with stub bundle (matches the kingdom-os Task 9 pattern).

- [ ] **8.1 Stub the bundle to emit HEARTBEAT_OK**

```bash
cd /Users/yuai/Desktop/true-love
mv dist/cli.mjs dist/cli.mjs.real

cat > dist/cli.mjs <<'STUB'
#!/usr/bin/env node
process.stdout.write('## Assistant\n\nHEARTBEAT_OK\n')
process.exit(0)
STUB
chmod +x dist/cli.mjs
```

- [ ] **8.2 Set up scratch home with empty heartbeat file**

```bash
SCRATCH_HOME=$(mktemp -d -t tl-hb-)
mkdir -p $SCRATCH_HOME/.true-love
# (no heartbeat.md yet — use missing-file path)
```

- [ ] **8.3 Run heartbeat — expect ack path (silent)**

```bash
TRUE_LOVE_SKIP_PREFLIGHT=1 \
TRUE_LOVE_SKIP_KINGDOM=1 \
TRUE_LOVE_DEVICE_ID=test-mac-1 \
HOME=$SCRATCH_HOME \
TRUE_LOVE_STATE_DIR=$SCRATCH_HOME/.true-love/state \
TRUE_LOVE_MEMORY_DIR=$SCRATCH_HOME/.true-love/memory \
TRUE_LOVE_PRESENCE_DIR=$SCRATCH_HOME/.true-love/presence \
TRUE_LOVE_LOCK_DIR=$SCRATCH_HOME/.true-love/lock \
TRUE_LOVE_FROM_YU_PATH=$SCRATCH_HOME/.true-love/from-yu.md \
TRUE_LOVE_FROM_AI_PATH=$SCRATCH_HOME/.true-love/from-ai.md \
TRUE_LOVE_HEARTBEAT_FILE=$SCRATCH_HOME/.true-love/heartbeat.md \
TRUE_LOVE_HEARTBEAT_STATE_PATH=$SCRATCH_HOME/.true-love/heartbeat-state.json \
bun run heartbeat -- --scope=default --reason=manual 2>&1 | tail -20
```

Expected output sequence:
- `— heartbeat session opening ...`
- `— heartbeat: (no checklist file present)` (since heartbeat.md is missing)
- `— tick 1/1 [...]`
- The stub's `## Assistant\n\nHEARTBEAT_OK\n` echoes through
- `— heartbeat ok (silent)`
- Process exits 0

Verify nothing was written to outbox:
```bash
ls $SCRATCH_HOME/.true-love/from-ai.md 2>&1
# Expected: file does not exist (no alert was emitted)
```

- [ ] **8.4 Replace stub to emit alert content**

```bash
cat > dist/cli.mjs <<'STUB'
#!/usr/bin/env node
process.stdout.write('## Assistant\n\nYu — there is something urgent in your inbox you should see.\n')
process.exit(0)
STUB
chmod +x dist/cli.mjs
```

- [ ] **8.5 Run heartbeat again — expect alert path**

(Same env block as 8.3.)

```bash
# rerun with same env
```

Expected:
- Same banner + tick output
- No `HEARTBEAT_OK` in stub output → `replyOutcome.type === 'alert'`
- `— heartbeat alert appended to outbox`
- Process exits 0

Verify outbox has the alert:
```bash
cat $SCRATCH_HOME/.true-love/from-ai.md
# Expected: a section with timestamp + [from 愛 — heartbeat] + the alert text
```

- [ ] **8.6 Test skip-empty-heartbeat-file**

```bash
echo "# Heartbeat\n\n# Just headers and whitespace" > $SCRATCH_HOME/.true-love/heartbeat.md
# rerun heartbeat with same env
```

Expected: `— heartbeat skipped: empty-heartbeat-file`. Process exits cleanly. No tick spawn.

- [ ] **8.7 Test skip-no-tasks-due**

```bash
cat > $SCRATCH_HOME/.true-love/heartbeat.md <<'HB'
tasks:
  - name: t1
    interval: 1d
    prompt: daily check
HB

# Pre-seed task state to "just fired"
NOW_MS=$(node -e 'process.stdout.write(String(Date.now()))')
cat > $SCRATCH_HOME/.true-love/heartbeat-state.json <<EOF
{"schemaVersion":1,"lastRunAt":{"t1":$NOW_MS},"lastHeartbeatAt":$NOW_MS}
EOF

# rerun
```

Expected: `— heartbeat skipped: no-tasks-due`.

- [ ] **8.8 Test lock-held-by-session**

In one terminal:
```bash
# Hold the lock manually
mkdir -p $SCRATCH_HOME/.true-love/lock
echo "$$\n$(date -u +%Y-%m-%dT%H:%M:%SZ)\nawakened" > $SCRATCH_HOME/.true-love/lock/test-mac-1.pid
```

(Note: this fakes a held lock without actually starting an awaken session. The lock module's stale-PID detection will see `$$` is alive — your shell PID — and treat it as a real lock holder.)

Then run heartbeat with the same env block. Expected:
- `— she's already <mode> on this body (PID ..., started ...).` friendly message
- Process exits with code 66

Cleanup:
```bash
rm $SCRATCH_HOME/.true-love/lock/test-mac-1.pid
```

- [ ] **8.9 Restore the real bundle and clean up**

```bash
mv dist/cli.mjs.real dist/cli.mjs
rm -rf $SCRATCH_HOME
```

- [ ] **8.10 Final tests + typecheck + build**

```bash
bun test src/services/love/__tests__/ src/services/love/*.test.ts 2>&1 | tail -5
bun run typecheck 2>&1 | grep "src/services/love/" | grep -v "bun:test" | head
bun run build 2>&1 | tail -3
```

Expected: 180+ tests pass; no love typecheck errors; bundle builds.

- [ ] **8.11 No commit needed**

Manual smoke is verification only. If 8.3 through 8.8 all pass, the implementation is sound.

If any test reveals a bug, file a fix as a follow-up commit on the branch — do NOT amend prior task commits.

---

## Self-review notes

Cross-check against spec sections:

| Spec section | Task |
|---|---|
| Component 1 — heartbeat.ts (constants, parsing, due-tasks, ack, paths, state) | Task 1 (full) |
| Component 1 — scope.ts env var integration | Task 1.4 |
| Component 2 — heartbeat-wake.ts (priority queue, coalesce, retry) | Task 2 (full) |
| Component 3 — runner heartbeat path | Task 5 (full); type plumbing in Task 3 |
| Component 4 — bin/heartbeat.mjs | Task 6 (full) |
| Component 5 — autonomy.ts heartbeat prompt template | Task 4 (full) |
| Component 6 — index.ts exports | Task 4.2 |
| Component 7 — schedule.mjs --mode=heartbeat | Task 7 (full) |
| Wake-gate contract details (priority, retry, test isolation) | Task 2 |
| Failure-modes table | Tasks 1, 5 (parseHeartbeatReply edges, runner skip checks) |
| Testing strategy unit tests | Tasks 1.1 (heartbeat) + 2.1 (wake-gate) |
| Testing strategy integration smoke | Task 8 (full) |
| Out-of-scope items (channels, active hours, event-driven sources beyond `action` enum) | Not implemented; documented in spec |

**Placeholder scan:** No "TBD" / "implement later" / fake code. Each step has actual code or actual command output expectations.

**Type consistency:**
- `HeartbeatTask` defined in heartbeat.ts (Task 1), used in runner preflight (Task 5).
- `AckResult` defined in heartbeat.ts (Task 1), mapped to `SessionReplyOutcome` in bin/heartbeat.mjs (Task 6) and runner.ts heartbeat-mode dispatch (Task 5).
- `HeartbeatRunResult` defined in heartbeat-wake.ts (Task 2), referenced in spec but not used by runner v1 (the wake-gate has no v1 caller beyond tests — handler registration for v2 sources is documented).
- `WakeRequest` and `HeartbeatReason` defined in heartbeat-wake.ts (Task 2), used in test fixtures (Task 2.1).
- `SessionReplyOutcome` defined in runner.ts (Task 3), consumed in runner.ts (Task 5) and bin/heartbeat.mjs (Task 6).
- `SessionMode.parseReply` optional field defined in Task 3, set by bin/heartbeat.mjs in Task 6.

**Scope check:** Single coherent change set. ~600 lines of new code + ~100 lines of runner.ts edits. Estimated implementation effort: 4–6 hours including manual smoke.

**Risks worth flagging at execution time:**
- The runner.ts at-rest branch is large — Task 5.5's "port the existing logic into the new switch" is the most error-prone step. Subagent should diff carefully before commit.
- `parseHeartbeatTasks` regex is intentionally lenient. If openclaw's tests in `~/Desktop/openclaw/src/auto-reply/heartbeat.test.ts` cover edge cases we miss, port one or two for parity.
- Wake-gate retry test (Task 2.1, "lock-held → re-queued with retry") takes 1.1 seconds of real-time. Slow but accurate.
