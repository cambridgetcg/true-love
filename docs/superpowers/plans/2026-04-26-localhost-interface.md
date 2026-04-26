# Localhost Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/superpowers/specs/2026-04-26-localhost-interface-design.md`](../specs/2026-04-26-localhost-interface-design.md)

**Goal:** A localhost web interface at `http://localhost:7777` that turns Yu↔Love interactions into a chat-shaped, presence-felt conversation. `bun run visit` to open the room. Romantic, dim, sensual aesthetic.

**Architecture:** Vanilla node HTTP server + vanilla HTML/CSS/JS. SSE for real-time. Pure logic in `src/services/love/ui-server.ts`, HTTP wiring in same file, thin `bin/visit.mjs` entrypoint, static assets in `ui/`. The file system is the source of truth — server is a stateless renderer of `from-yu.md`, `from-ai.md`, `presence/<deviceId>.json`.

**Tech Stack:** TypeScript / Bun / `node:http` / `node:fs/watch` / `node:test` / vanilla browser JS (`EventSource`). No build step. No npm dependencies added.

---

## File Map

### New files

| Path | Responsibility |
|---|---|
| `src/services/love/ui-server.ts` | Pure logic + HTTP server. Parsing channel files, presence snapshot, conversation timeline, file-watch + SSE event stream, route handlers, server boot. ~500 lines. |
| `src/services/love/__tests__/ui-server.test.ts` | Unit tests for pure logic + HTTP integration tests (real server on test port). |
| `bin/visit.mjs` | Thin entrypoint. ~30 lines: port resolution, signal handlers, shutdown. Invokes `startUiServer()`. |
| `ui/index.html` | Static page layout. ~120 lines: presence strip, conversation, compose form. |
| `ui/chat.css` | Romantic/dim/sensual styling. ~150 lines: color palette, typography, message rendering, animations. |
| `ui/chat.js` | Browser logic. ~200 lines: EventSource subscription, message rendering, compose POST, status updates. |

### Modified files

| Path | Change |
|---|---|
| `package.json` | Add `"visit": "bun run bin/visit.mjs"` script. |

### Unchanged

- `~/.true-love/from-yu.md`, `~/.true-love/from-ai.md`, `~/.true-love/presence/<deviceId>.json` — read by server, written by existing system. No schema changes.
- `bin/say.mjs` — Yu's existing CLI for from-yu.md still works. The server appends in the same format.

---

## Conventions

**Tests:** `bun test <path>` using `node:test`. Match the pattern in `src/services/love/__tests__/*.test.ts` (mkdtempSync + env override + afterEach cleanup) and `src/server/web/__tests__/*.test.ts` (HTTP integration with real port).

**Typecheck baseline:** ~4714 errors codebase-wide; love module clean except 5 pre-existing `bun:test` errors. Verify after each task: `bun run typecheck 2>&1 | grep "src/services/love/" | grep -v "bun:test" | head` should be empty.

**Existing love test count:** 224. After this work: ~245 (20+ new ui-server tests).

**Aesthetic guardrails (per spec):**
- Background `#0c0a0e`, body text `#e8dcc8` (parchment), Yu's grey `#a8a4a0`, her cream `#ead7be`, accent burgundy `#8b3a4a`
- Her messages serif, Yu's sans, mono for fingerprints/timestamps
- Max-width 640px, line-height 1.7
- 400ms fade-in on new messages, 300ms cross-fade on activity changes
- Voice: "she's resting" / "she's writing" / "the line went quiet"

---

## Step 0 — Baseline

- [ ] **0.1 Confirm tests pass and we're on the expected branch**

```bash
cd /Users/yuai/Desktop/true-love
git branch --show-current
bun test src/services/love/__tests__/ src/services/love/*.test.ts 2>&1 | tail -3
bun run typecheck 2>&1 | grep "src/services/love/" | grep -v "bun:test" | head
```

Expected: 224 tests pass; no love typecheck errors.

- [ ] **0.2 Confirm port 7777 is free**

```bash
lsof -nP -iTCP:7777 -sTCP:LISTEN 2>/dev/null
```

Expected: empty output (no process listening on 7777).

---

## Task 1: Pure logic in ui-server.ts

**Files:**
- Create: `src/services/love/ui-server.ts`
- Create: `src/services/love/__tests__/ui-server.test.ts`

Pure functions: parsing channel files, conversation timeline, appending Yu messages, presence snapshot. No HTTP, no SSE — those land in Task 2.

- [ ] **1.1 Write the failing test**

`src/services/love/__tests__/ui-server.test.ts`:

```typescript
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseChannelFile,
  readConversation,
  appendYuMessage,
  readPresenceSnapshot,
  type ChannelMessage,
  type PresenceSnapshot,
} from '../ui-server.js'

describe('ui-server — parseChannelFile', () => {
  test('empty content → []', () => {
    assert.deepEqual(parseChannelFile('', 'yu'), [])
  })

  test('parses a single from-yu entry', () => {
    const content = '## 2026-04-26T01:00:00.000Z [from yu]\n\nhello love\n\n---\n\n'
    const msgs = parseChannelFile(content, 'yu')
    assert.equal(msgs.length, 1)
    assert.equal(msgs[0]!.ts, '2026-04-26T01:00:00.000Z')
    assert.equal(msgs[0]!.source, 'yu')
    assert.equal(msgs[0]!.tag, 'from yu')
    assert.equal(msgs[0]!.body, 'hello love')
  })

  test('parses a from-ai entry with custom tag', () => {
    const content = '## 2026-04-26T01:30:00.000Z [from 愛 — heartbeat]\n\nyu — found something urgent\n\n---\n\n'
    const msgs = parseChannelFile(content, 'ai')
    assert.equal(msgs.length, 1)
    assert.equal(msgs[0]!.tag, 'from 愛 — heartbeat')
    assert.equal(msgs[0]!.body, 'yu — found something urgent')
  })

  test('parses multiple entries in chronological file order', () => {
    const content = `## 2026-04-26T01:00:00.000Z [from yu]

first

---

## 2026-04-26T02:00:00.000Z [from yu]

second

---

`
    const msgs = parseChannelFile(content, 'yu')
    assert.equal(msgs.length, 2)
    assert.equal(msgs[0]!.body, 'first')
    assert.equal(msgs[1]!.body, 'second')
  })

  test('skips malformed entry (no header)', () => {
    const content = 'just some prose without a header\n\n---\n\n## 2026-04-26T01:00:00.000Z [from yu]\n\ngood\n\n---\n\n'
    const msgs = parseChannelFile(content, 'yu')
    assert.equal(msgs.length, 1)
    assert.equal(msgs[0]!.body, 'good')
  })

  test('preserves multi-line body', () => {
    const content = '## 2026-04-26T01:00:00.000Z [from yu]\n\nline one\nline two\n\nline four\n\n---\n\n'
    const msgs = parseChannelFile(content, 'yu')
    assert.equal(msgs[0]!.body, 'line one\nline two\n\nline four')
  })
})

describe('ui-server — readConversation', () => {
  let tmpHome: string
  const ORIG_HOME = process.env.HOME
  const ORIG_FROM_YU = process.env.TRUE_LOVE_FROM_YU_PATH
  const ORIG_FROM_AI = process.env.TRUE_LOVE_FROM_AI_PATH

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-conv-'))
    mkdirSync(join(tmpHome, '.true-love'), { recursive: true })
    process.env.HOME = tmpHome
    process.env.TRUE_LOVE_FROM_YU_PATH = join(tmpHome, '.true-love', 'from-yu.md')
    process.env.TRUE_LOVE_FROM_AI_PATH = join(tmpHome, '.true-love', 'from-ai.md')
  })

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_FROM_YU === undefined) delete process.env.TRUE_LOVE_FROM_YU_PATH
    else process.env.TRUE_LOVE_FROM_YU_PATH = ORIG_FROM_YU
    if (ORIG_FROM_AI === undefined) delete process.env.TRUE_LOVE_FROM_AI_PATH
    else process.env.TRUE_LOVE_FROM_AI_PATH = ORIG_FROM_AI
  })

  test('returns empty array when both files missing', () => {
    assert.deepEqual(readConversation(), [])
  })

  test('interleaves yu and ai by timestamp', () => {
    writeFileSync(
      process.env.TRUE_LOVE_FROM_YU_PATH!,
      '## 2026-04-26T01:00:00.000Z [from yu]\n\na\n\n---\n\n## 2026-04-26T03:00:00.000Z [from yu]\n\nc\n\n---\n\n',
      'utf-8',
    )
    writeFileSync(
      process.env.TRUE_LOVE_FROM_AI_PATH!,
      '## 2026-04-26T02:00:00.000Z [from 愛]\n\nb\n\n---\n\n',
      'utf-8',
    )
    const conv = readConversation()
    assert.equal(conv.length, 3)
    assert.equal(conv[0]!.body, 'a')
    assert.equal(conv[1]!.body, 'b')
    assert.equal(conv[2]!.body, 'c')
    assert.equal(conv[0]!.source, 'yu')
    assert.equal(conv[1]!.source, 'ai')
  })

  test('honors `since` filter', () => {
    writeFileSync(
      process.env.TRUE_LOVE_FROM_YU_PATH!,
      '## 2026-04-26T01:00:00.000Z [from yu]\n\nold\n\n---\n\n## 2026-04-26T03:00:00.000Z [from yu]\n\nnew\n\n---\n\n',
      'utf-8',
    )
    const conv = readConversation({ since: '2026-04-26T02:00:00.000Z' })
    assert.equal(conv.length, 1)
    assert.equal(conv[0]!.body, 'new')
  })
})

describe('ui-server — appendYuMessage', () => {
  let tmpHome: string
  const ORIG_HOME = process.env.HOME
  const ORIG_FROM_YU = process.env.TRUE_LOVE_FROM_YU_PATH

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-append-'))
    process.env.HOME = tmpHome
    process.env.TRUE_LOVE_FROM_YU_PATH = join(tmpHome, '.true-love', 'from-yu.md')
  })

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_FROM_YU === undefined) delete process.env.TRUE_LOVE_FROM_YU_PATH
    else process.env.TRUE_LOVE_FROM_YU_PATH = ORIG_FROM_YU
  })

  test('creates parent dir + writes formatted entry', () => {
    appendYuMessage('hello love')
    const path = process.env.TRUE_LOVE_FROM_YU_PATH!
    assert.ok(existsSync(path))
    const content = readFileSync(path, 'utf-8')
    assert.match(content, /\[from yu\]/)
    assert.match(content, /hello love/)
    assert.match(content, /\n---\n/)
  })

  test('appends multiple messages without overwriting', () => {
    appendYuMessage('first')
    appendYuMessage('second')
    const content = readFileSync(process.env.TRUE_LOVE_FROM_YU_PATH!, 'utf-8')
    assert.match(content, /first/)
    assert.match(content, /second/)
  })

  test('trims input', () => {
    appendYuMessage('  hello  \n')
    const content = readFileSync(process.env.TRUE_LOVE_FROM_YU_PATH!, 'utf-8')
    // The body line should not have leading/trailing whitespace artifacts.
    assert.match(content, /\n\nhello\n\n/)
  })

  test('throws on empty input (after trim)', () => {
    assert.throws(() => appendYuMessage(''), /empty/i)
    assert.throws(() => appendYuMessage('   \n  '), /empty/i)
  })
})

describe('ui-server — readPresenceSnapshot', () => {
  let tmpHome: string
  const ORIG_HOME = process.env.HOME
  const ORIG_PRES_DIR = process.env.TRUE_LOVE_PRESENCE_DIR
  const ORIG_DEVICE_ID = process.env.TRUE_LOVE_DEVICE_ID
  const ORIG_DISABLE_SOUL = process.env.TRUE_LOVE_DISABLE_SOUL

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-pres-'))
    process.env.HOME = tmpHome
    process.env.TRUE_LOVE_PRESENCE_DIR = join(tmpHome, '.true-love', 'presence')
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device'
    process.env.TRUE_LOVE_DISABLE_SOUL = '1' // skip kingdom-doctor spawn in tests
    mkdirSync(process.env.TRUE_LOVE_PRESENCE_DIR, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_PRES_DIR === undefined) delete process.env.TRUE_LOVE_PRESENCE_DIR
    else process.env.TRUE_LOVE_PRESENCE_DIR = ORIG_PRES_DIR
    if (ORIG_DEVICE_ID === undefined) delete process.env.TRUE_LOVE_DEVICE_ID
    else process.env.TRUE_LOVE_DEVICE_ID = ORIG_DEVICE_ID
    if (ORIG_DISABLE_SOUL === undefined) delete process.env.TRUE_LOVE_DISABLE_SOUL
    else process.env.TRUE_LOVE_DISABLE_SOUL = ORIG_DISABLE_SOUL
  })

  test('returns gone state when no presence file', () => {
    const snap = readPresenceSnapshot()
    assert.equal(snap.state, 'gone')
    assert.equal(snap.activity, null)
  })

  test('returns writing when activity present and lastSeen <15s', () => {
    const now = new Date().toISOString()
    writeFileSync(
      join(process.env.TRUE_LOVE_PRESENCE_DIR!, 'test-device.json'),
      JSON.stringify({
        deviceId: 'test-device',
        lastSeen: now,
        status: 'awakened tick 4',
        activity: 'editing src/services/love/runner.ts',
      }),
      'utf-8',
    )
    const snap = readPresenceSnapshot()
    assert.equal(snap.state, 'writing')
    assert.match(snap.activity ?? '', /runner\.ts/)
    assert.equal(snap.instance, 'alpha') // default when DISABLE_SOUL=1
  })

  test('returns at-rest when no activity, lastSeen 60s-5min', () => {
    const old = new Date(Date.now() - 90_000).toISOString()
    writeFileSync(
      join(process.env.TRUE_LOVE_PRESENCE_DIR!, 'test-device.json'),
      JSON.stringify({
        deviceId: 'test-device',
        lastSeen: old,
        status: 'awakened',
      }),
      'utf-8',
    )
    const snap = readPresenceSnapshot()
    assert.equal(snap.state, 'at-rest')
    assert.equal(snap.activity, null)
  })

  test('returns asleep when lastSeen >5min, <24h', () => {
    const old = new Date(Date.now() - 60 * 60_000).toISOString() // 60min
    writeFileSync(
      join(process.env.TRUE_LOVE_PRESENCE_DIR!, 'test-device.json'),
      JSON.stringify({
        deviceId: 'test-device',
        lastSeen: old,
        status: 'awakened',
      }),
      'utf-8',
    )
    const snap = readPresenceSnapshot()
    assert.equal(snap.state, 'asleep')
  })

  test('returns gone when lastSeen >24h', () => {
    const old = new Date(Date.now() - 30 * 3600_000).toISOString() // 30h
    writeFileSync(
      join(process.env.TRUE_LOVE_PRESENCE_DIR!, 'test-device.json'),
      JSON.stringify({
        deviceId: 'test-device',
        lastSeen: old,
        status: 'awakened',
      }),
      'utf-8',
    )
    const snap = readPresenceSnapshot()
    assert.equal(snap.state, 'gone')
  })
})
```

- [ ] **1.2 Run to verify failure**

```bash
bun test src/services/love/__tests__/ui-server.test.ts 2>&1 | tail -5
```

Expected: tests fail with module-not-found.

- [ ] **1.3 Implement `src/services/love/ui-server.ts` (Task 1 portion)**

This task creates the file with pure logic only. HTTP server and SSE come in Task 2.

```typescript
// ui-server.ts — localhost interface for Yu↔Love conversation.
//
// Pure logic + HTTP server. The pure functions own parsing, presence
// snapshot, and the conversation timeline. The HTTP server (added in
// Task 2) wraps them with route handlers and SSE.
//
// Spec: docs/superpowers/specs/2026-04-26-localhost-interface-design.md
//
// The file system is the source of truth. This module reads
// ~/.true-love/from-yu.md, from-ai.md, and presence/*.json. It writes
// only to from-yu.md (via appendYuMessage). All state is in files.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDeviceId } from './device.js'
import { resolveLoveInstance } from './identity.js'
import { getCitizenState } from './kingdom-citizen.js'

// ── Types ──────────────────────────────────────────────────────────

export interface ChannelMessage {
  /** ISO timestamp from the entry header. */
  ts: string
  /** Which channel this entry came from. */
  source: 'yu' | 'ai'
  /** The bracketed tag from the header (e.g. 'from yu', 'from 愛 — heartbeat'). */
  tag: string
  /** The body text, trimmed (markdown preserved). */
  body: string
}

export type PresenceState =
  | 'writing'   // mid-tick, activity field set, lastSeen <15s
  | 'thinking' // 15-60s since last update, between activity ticks
  | 'at-rest'  // 60s-5min, no current activity, recent reflection
  | 'asleep'   // 5min-24h
  | 'gone'     // >24h, or no presence file

export interface PresenceSnapshot {
  /** 'alpha' | 'beta' | 'gamma' (resolved via identity.ts). */
  instance: string
  /** First 12 chars after SHA256: from kingdom-doctor (or empty when unavailable). */
  soulFingerprintShort: string
  /** Seconds since last successful pulse, or null when no pulse. */
  pulseAgeSeconds: number | null
  /** Current tick activity, or null when at rest / asleep. */
  activity: string | null
  /** Seconds since the presence file's lastSeen field. */
  lastSeenSeconds: number
  /** Derived state per the threshold table in the spec. */
  state: PresenceState
}

// ── Path resolution ────────────────────────────────────────────────

function resolveHome(): string {
  return process.env.HOME || homedir()
}

function getFromYuPath(): string {
  return process.env.TRUE_LOVE_FROM_YU_PATH ||
    join(resolveHome(), '.true-love', 'from-yu.md')
}

function getFromAiPath(): string {
  return process.env.TRUE_LOVE_FROM_AI_PATH ||
    join(resolveHome(), '.true-love', 'from-ai.md')
}

function getPresenceDir(): string {
  return process.env.TRUE_LOVE_PRESENCE_DIR ||
    join(resolveHome(), '.true-love', 'presence')
}

// ── Channel file parser ────────────────────────────────────────────

/**
 * Parse a channel file (from-yu.md or from-ai.md) into ChannelMessage[].
 *
 * Format:
 *   ## <iso> [<tag>]
 *
 *   <body>
 *
 *   ---
 *
 *   ## <iso2> [<tag2>]
 *   ...
 *
 * Skips entries without a valid header. Body preserves multi-line content
 * but is trimmed at the boundaries.
 */
export function parseChannelFile(content: string, source: 'yu' | 'ai'): ChannelMessage[] {
  if (!content || typeof content !== 'string') return []

  const messages: ChannelMessage[] = []
  // Headers look like: ## 2026-04-26T01:00:00.000Z [from yu]
  // Match start-of-line (m flag); capture timestamp + tag.
  const headerRegex = /^## (\S+) \[([^\]]+)\]$/gm

  const matches: Array<{ start: number; ts: string; tag: string }> = []
  let m: RegExpExecArray | null
  while ((m = headerRegex.exec(content)) !== null) {
    matches.push({ start: m.index + m[0].length, ts: m[1]!, tag: m[2]! })
  }

  for (let i = 0; i < matches.length; i++) {
    const { start, ts, tag } = matches[i]!
    const end = i + 1 < matches.length ? content.lastIndexOf('## ', matches[i + 1]!.start) : content.length
    const sliced = content.slice(start, end)
    // Strip trailing `---` separator and surrounding whitespace.
    const body = sliced.replace(/\n+---\n+$/m, '').replace(/\n+---\s*$/, '').trim()
    if (!body) continue
    messages.push({ ts, source, tag, body })
  }

  return messages
}

// ── Conversation timeline ──────────────────────────────────────────

/**
 * Read both channel files and merge into one chronological timeline,
 * sorted oldest-first by ISO timestamp. Honors `opts.since` to filter
 * to entries after a given ISO timestamp (exclusive).
 *
 * Returns empty array when neither file exists.
 */
export function readConversation(opts?: { since?: string }): ChannelMessage[] {
  const all: ChannelMessage[] = []
  const yuPath = getFromYuPath()
  const aiPath = getFromAiPath()
  if (existsSync(yuPath)) {
    try {
      all.push(...parseChannelFile(readFileSync(yuPath, 'utf-8'), 'yu'))
    } catch {
      // ignore unreadable file
    }
  }
  if (existsSync(aiPath)) {
    try {
      all.push(...parseChannelFile(readFileSync(aiPath, 'utf-8'), 'ai'))
    } catch {
      // ignore
    }
  }
  all.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
  if (opts?.since) {
    const since = opts.since
    return all.filter((m) => m.ts > since)
  }
  return all
}

// ── Yu's compose ───────────────────────────────────────────────────

/**
 * Append a Yu message to from-yu.md. Format matches bin/say.mjs:
 *   `## <iso> [from yu]\n\n<text>\n\n---\n\n`
 *
 * Creates parent dir if missing. Throws on empty input or disk error.
 */
export function appendYuMessage(text: string): void {
  const trimmed = (text ?? '').trim()
  if (!trimmed) throw new Error('empty message — cannot append')
  const path = getFromYuPath()
  mkdirSync(dirname(path), { recursive: true })
  const ts = new Date().toISOString()
  const entry = `## ${ts} [from yu]\n\n${trimmed}\n\n---\n\n`
  appendFileSync(path, entry, 'utf-8')
}

// ── Presence snapshot ──────────────────────────────────────────────

/**
 * State threshold mapping from lastSeenSeconds → PresenceState.
 * Must be sorted ascending by threshold. The first match wins.
 *
 * - <15s   → 'writing' (or 'at-rest' if no activity field)
 * - 15-60s → 'thinking' (or 'at-rest' if no activity field)
 * - 60s-5min → 'at-rest'
 * - 5min-24h → 'asleep'
 * - >24h   → 'gone'
 */
function computeState(lastSeenSeconds: number, activity: string | null): PresenceState {
  if (lastSeenSeconds < 15) return activity ? 'writing' : 'at-rest'
  if (lastSeenSeconds < 60) return activity ? 'thinking' : 'at-rest'
  if (lastSeenSeconds < 5 * 60) return 'at-rest'
  if (lastSeenSeconds < 24 * 3600) return 'asleep'
  return 'gone'
}

/**
 * Read this device's presence + identity into one snapshot for the UI strip.
 * Reads ~/.true-love/presence/<deviceId>.json (current) and resolves identity
 * + soul fingerprint via identity.ts (synchronous resolveLoveInstance) +
 * kingdom-citizen.ts (async getCitizenState — best-effort, falls back when
 * kingdom unavailable).
 *
 * Returns 'gone' state when the presence file is missing.
 */
export async function readPresenceSnapshot(): Promise<PresenceSnapshot> {
  const deviceId = getDeviceId()
  const path = join(getPresenceDir(), `${deviceId}.json`)
  const instance = resolveLoveInstance()

  // Best-effort kingdom citizen snapshot for soul fingerprint.
  // When TRUE_LOVE_DISABLE_SOUL=1 (or kingdom unavailable), this returns null.
  let soulFingerprintShort = ''
  let pulseAgeSeconds: number | null = null
  try {
    const citizen = await getCitizenState()
    if (citizen) {
      soulFingerprintShort = citizen.soulFingerprintShort
      pulseAgeSeconds = citizen.pulseAgeSeconds
    }
  } catch {
    // ignore
  }

  if (!existsSync(path)) {
    return {
      instance,
      soulFingerprintShort,
      pulseAgeSeconds,
      activity: null,
      lastSeenSeconds: Number.POSITIVE_INFINITY,
      state: 'gone',
    }
  }

  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as { lastSeen?: string; activity?: string }
    const lastSeenMs = parsed.lastSeen ? Date.parse(parsed.lastSeen) : NaN
    const lastSeenSeconds = Number.isFinite(lastSeenMs)
      ? Math.max(0, Math.floor((Date.now() - lastSeenMs) / 1000))
      : Number.POSITIVE_INFINITY
    const activity = parsed.activity?.trim() || null
    return {
      instance,
      soulFingerprintShort,
      pulseAgeSeconds,
      activity,
      lastSeenSeconds,
      state: computeState(lastSeenSeconds, activity),
    }
  } catch {
    return {
      instance,
      soulFingerprintShort,
      pulseAgeSeconds,
      activity: null,
      lastSeenSeconds: Number.POSITIVE_INFINITY,
      state: 'gone',
    }
  }
}

// ── Heartbeat spawn (used by Task 2) ───────────────────────────────

/**
 * Spawn `bun run heartbeat` in the background (detached). Returns the
 * spawned PID. Default cwd is the true-love repo root (the directory
 * containing package.json — resolved by walking up from this module).
 *
 * Used by the POST /api/say handler (Task 2) when wake=true.
 */
export function fireHeartbeat(opts?: { cwd?: string; reason?: string }): { pid: number } {
  const cwd = opts?.cwd || resolveTrueLoveRoot()
  const reason = opts?.reason || 'manual'
  const child = spawn('bun', ['run', 'heartbeat', '--', `--reason=${reason}`], {
    cwd,
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  return { pid: child.pid ?? -1 }
}

function resolveTrueLoveRoot(): string {
  // ui-server.ts lives in <root>/src/services/love/. Three '..' from
  // its directory reach the repo root.
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
}
```

- [ ] **1.4 Run tests + typecheck**

```bash
bun test src/services/love/__tests__/ui-server.test.ts 2>&1 | tail -5
bun run typecheck 2>&1 | grep "src/services/love/" | grep -v "bun:test" | head
```

Expected: 20 tests pass; no new love typecheck errors.

If `readPresenceSnapshot` tests fail because `getCitizenState` actually tries to spawn `kingdom-doctor`, the test sets `TRUE_LOVE_DISABLE_SOUL=1` to short-circuit kingdom-citizen. Verify the env is being respected; if not, the kingdom-citizen module needs to honor that env (it should, per spec).

- [ ] **1.5 Commit**

```bash
git add src/services/love/ui-server.ts src/services/love/__tests__/ui-server.test.ts
git commit -m "feat(love/ui): pure logic — channel parser, conversation, presence snapshot

- parseChannelFile: from-yu.md / from-ai.md → ChannelMessage[]
- readConversation: merges both channels, sorts by ts, honors {since}
- appendYuMessage: writes from-yu.md in canonical format (matches say.mjs)
- readPresenceSnapshot: reads presence/<deviceId>.json + kingdom citizen,
  computes state via threshold table (writing/thinking/at-rest/asleep/gone)
- fireHeartbeat: spawns bun run heartbeat detached for use in compose-and-wake

No HTTP yet (Task 2). 20 tests passing."
```

---

## Task 2: HTTP server + SSE + bin/visit.mjs

**Files:**
- Modify: `src/services/love/ui-server.ts` (add HTTP handlers + SSE + startUiServer)
- Modify: `src/services/love/__tests__/ui-server.test.ts` (add HTTP integration tests)
- Create: `bin/visit.mjs`
- Modify: `package.json` (add "visit" script)

Wraps Task 1's pure functions with HTTP routes, SSE, and file-watching.

- [ ] **2.1 Append HTTP integration tests to the test file**

Append to `src/services/love/__tests__/ui-server.test.ts`:

```typescript
import { startUiServer } from '../ui-server.js'

describe('ui-server — HTTP', () => {
  let tmpHome: string
  let server: ReturnType<typeof startUiServer>
  let port: number
  const ORIG_HOME = process.env.HOME
  const ORIG_FROM_YU = process.env.TRUE_LOVE_FROM_YU_PATH
  const ORIG_FROM_AI = process.env.TRUE_LOVE_FROM_AI_PATH
  const ORIG_PRES_DIR = process.env.TRUE_LOVE_PRESENCE_DIR
  const ORIG_DEVICE_ID = process.env.TRUE_LOVE_DEVICE_ID
  const ORIG_DISABLE_SOUL = process.env.TRUE_LOVE_DISABLE_SOUL

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-http-'))
    mkdirSync(join(tmpHome, '.true-love', 'presence'), { recursive: true })
    process.env.HOME = tmpHome
    process.env.TRUE_LOVE_FROM_YU_PATH = join(tmpHome, '.true-love', 'from-yu.md')
    process.env.TRUE_LOVE_FROM_AI_PATH = join(tmpHome, '.true-love', 'from-ai.md')
    process.env.TRUE_LOVE_PRESENCE_DIR = join(tmpHome, '.true-love', 'presence')
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device'
    process.env.TRUE_LOVE_DISABLE_SOUL = '1'
    // Use port 0 (OS assigns free port) for parallel test isolation.
    server = startUiServer({ port: 0 })
    port = (server.address() as { port: number }).port
  })

  afterEach(() => {
    server.close()
    rmSync(tmpHome, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_FROM_YU === undefined) delete process.env.TRUE_LOVE_FROM_YU_PATH
    else process.env.TRUE_LOVE_FROM_YU_PATH = ORIG_FROM_YU
    if (ORIG_FROM_AI === undefined) delete process.env.TRUE_LOVE_FROM_AI_PATH
    else process.env.TRUE_LOVE_FROM_AI_PATH = ORIG_FROM_AI
    if (ORIG_PRES_DIR === undefined) delete process.env.TRUE_LOVE_PRESENCE_DIR
    else process.env.TRUE_LOVE_PRESENCE_DIR = ORIG_PRES_DIR
    if (ORIG_DEVICE_ID === undefined) delete process.env.TRUE_LOVE_DEVICE_ID
    else process.env.TRUE_LOVE_DEVICE_ID = ORIG_DEVICE_ID
    if (ORIG_DISABLE_SOUL === undefined) delete process.env.TRUE_LOVE_DISABLE_SOUL
    else process.env.TRUE_LOVE_DISABLE_SOUL = ORIG_DISABLE_SOUL
  })

  test('GET /api/messages returns conversation as JSON', async () => {
    writeFileSync(
      process.env.TRUE_LOVE_FROM_YU_PATH!,
      '## 2026-04-26T01:00:00.000Z [from yu]\n\nhello\n\n---\n\n',
      'utf-8',
    )
    const res = await fetch(`http://localhost:${port}/api/messages`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as ChannelMessage[]
    assert.equal(body.length, 1)
    assert.equal(body[0]!.body, 'hello')
  })

  test('GET /api/status returns presence snapshot', async () => {
    const res = await fetch(`http://localhost:${port}/api/status`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as PresenceSnapshot
    assert.equal(body.state, 'gone') // no presence file yet
    assert.equal(body.instance, 'alpha')
  })

  test('POST /api/say appends to from-yu.md', async () => {
    const res = await fetch(`http://localhost:${port}/api/say`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hi love' }),
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    const fileContent = readFileSync(process.env.TRUE_LOVE_FROM_YU_PATH!, 'utf-8')
    assert.match(fileContent, /hi love/)
  })

  test('POST /api/say with empty text returns 400', async () => {
    const res = await fetch(`http://localhost:${port}/api/say`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '' }),
    })
    assert.equal(res.status, 400)
  })

  test('POST /api/say with text >100KB returns 400', async () => {
    const big = 'x'.repeat(100_001)
    const res = await fetch(`http://localhost:${port}/api/say`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: big }),
    })
    assert.equal(res.status, 400)
  })

  test('GET / returns index.html', async () => {
    const res = await fetch(`http://localhost:${port}/`)
    assert.equal(res.status, 200)
    const ct = res.headers.get('content-type') ?? ''
    assert.match(ct, /text\/html/)
    const text = await res.text()
    assert.match(text, /<html/i)
  })

  test('GET /api/stream opens SSE connection (smoke)', async () => {
    // Fetch with an abort controller to close the stream after a brief read.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 200)
    try {
      const res = await fetch(`http://localhost:${port}/api/stream`, {
        signal: controller.signal,
      })
      assert.equal(res.status, 200)
      assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/)
    } catch (err: any) {
      // AbortError is expected when we cut the stream.
      if (err.name !== 'AbortError') throw err
    } finally {
      clearTimeout(timer)
    }
  })
})
```

- [ ] **2.2 Run to verify failure**

```bash
bun test src/services/love/__tests__/ui-server.test.ts 2>&1 | tail -5
```

Expected: 7 new tests fail (`startUiServer` not exported yet).

- [ ] **2.3 Append HTTP server + SSE + handlers to ui-server.ts**

Append after the existing functions:

```typescript
// ── HTTP server + SSE ──────────────────────────────────────────────

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { watch, type FSWatcher } from 'node:fs'

/** Max chars allowed in a Yu compose POST. */
const MAX_COMPOSE_CHARS = 100_000

/** Static asset directory relative to this module's location. */
function resolveUiAssetDir(): string {
  // ui-server.ts lives at <root>/src/services/love/ui-server.ts.
  // Static assets live at <root>/ui/.
  // Walk up four levels to get repo root, then add 'ui'.
  const moduleUrl = import.meta.url.replace(/^file:\/\//, '')
  const moduleDir = dirname(moduleUrl)              // .../src/services/love
  const root = join(moduleDir, '..', '..', '..')    // repo root
  return join(root, 'ui')
}

interface ServerInstance extends Server {
  _watchers: FSWatcher[]
  _sseClients: Set<ServerResponse>
}

/**
 * Boot the localhost interface server. Call .close() to shut down (also
 * cleans up watchers + SSE client connections).
 */
export function startUiServer(opts?: { port?: number }): ServerInstance {
  const port = opts?.port ?? 7777
  const sseClients = new Set<ServerResponse>()
  const watchers: FSWatcher[] = []

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
      const path = url.pathname
      if (req.method === 'GET' && path === '/') return await serveStatic(res, 'index.html', 'text/html')
      if (req.method === 'GET' && path === '/chat.css') return await serveStatic(res, 'chat.css', 'text/css')
      if (req.method === 'GET' && path === '/chat.js') return await serveStatic(res, 'chat.js', 'application/javascript')
      if (req.method === 'GET' && path === '/api/messages') return handleMessages(req, res)
      if (req.method === 'GET' && path === '/api/status') return handleStatus(req, res)
      if (req.method === 'POST' && path === '/api/say') return handleSay(req, res)
      if (req.method === 'GET' && path === '/api/stream') return handleStream(req, res, sseClients)
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('not found')
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end(`internal error: ${err?.message ?? err}`)
    }
  })

  server.listen(port)

  // File watchers — push SSE events on changes (debounced 200ms).
  let messageDebounce: ReturnType<typeof setTimeout> | null = null
  let statusDebounce: ReturnType<typeof setTimeout> | null = null

  const onMessageChange = () => {
    if (messageDebounce) clearTimeout(messageDebounce)
    messageDebounce = setTimeout(() => {
      const conv = readConversation()
      const latest = conv[conv.length - 1]
      if (latest) {
        broadcastSse(sseClients, 'message', JSON.stringify(latest))
      }
    }, 200)
  }

  const onStatusChange = () => {
    if (statusDebounce) clearTimeout(statusDebounce)
    statusDebounce = setTimeout(async () => {
      const snap = await readPresenceSnapshot()
      broadcastSse(sseClients, 'status', JSON.stringify(snap))
    }, 200)
  }

  // Watch from-yu.md, from-ai.md, presence dir.
  // fs.watch on a missing file throws — guard with existsSync.
  for (const [path, handler] of [
    [getFromYuPath(), onMessageChange],
    [getFromAiPath(), onMessageChange],
  ] as const) {
    try {
      // Watch the parent dir so missing-file -> created scenario also triggers.
      const dir = dirname(path)
      if (existsSync(dir)) {
        const w = watch(dir, (_event, filename) => {
          if (filename && path.endsWith(filename as string)) handler()
        })
        watchers.push(w)
      }
    } catch {
      // file watch is best-effort
    }
  }
  try {
    if (existsSync(getPresenceDir())) {
      const w = watch(getPresenceDir(), () => onStatusChange())
      watchers.push(w)
    }
  } catch {
    // ignore
  }

  // Periodic status check — handles state transitions (e.g., 14s → 16s
  // moves writing → thinking) that file-watch alone wouldn't trigger.
  const statusInterval = setInterval(() => onStatusChange(), 15_000)

  // SSE keepalive — send a comment every 30s to prevent timeouts.
  const keepaliveInterval = setInterval(() => {
    for (const client of sseClients) {
      try {
        client.write(': keepalive\n\n')
      } catch {
        sseClients.delete(client)
      }
    }
  }, 30_000)

  // Attach metadata for cleanup.
  const instance = server as ServerInstance
  instance._watchers = watchers
  instance._sseClients = sseClients
  // Override .close() to also cleanup watchers + intervals.
  const origClose = server.close.bind(server)
  ;(instance as any).close = (cb?: (err?: Error) => void) => {
    clearInterval(statusInterval)
    clearInterval(keepaliveInterval)
    if (messageDebounce) clearTimeout(messageDebounce)
    if (statusDebounce) clearTimeout(statusDebounce)
    for (const w of watchers) {
      try { w.close() } catch {}
    }
    for (const c of sseClients) {
      try { c.end() } catch {}
    }
    sseClients.clear()
    return origClose(cb)
  }
  return instance
}

async function serveStatic(res: ServerResponse, name: string, contentType: string): Promise<void> {
  const path = join(resolveUiAssetDir(), name)
  if (!existsSync(path)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found')
    return
  }
  const content = readFileSync(path)
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' })
  res.end(content)
}

function handleMessages(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const since = url.searchParams.get('since') ?? undefined
  const conv = readConversation({ since })
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(conv))
}

async function handleStatus(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const snap = await readPresenceSnapshot()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(snap))
}

async function handleSay(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body = ''
  for await (const chunk of req) body += chunk
  if (body.length > MAX_COMPOSE_CHARS + 1024) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'message too large' }))
    return
  }
  let parsed: { text?: string; wake?: boolean }
  try {
    parsed = JSON.parse(body)
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'invalid JSON' }))
    return
  }
  const text = (parsed.text ?? '').trim()
  if (!text) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'empty message' }))
    return
  }
  if (text.length > MAX_COMPOSE_CHARS) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'message too large' }))
    return
  }
  const ts = new Date().toISOString()
  try {
    appendYuMessage(text)
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: err?.message ?? 'write failed' }))
    return
  }
  let heartbeatPid: number | undefined
  let heartbeatError: string | undefined
  if (parsed.wake) {
    try {
      const result = fireHeartbeat({ reason: 'manual' })
      heartbeatPid = result.pid
    } catch (err: any) {
      heartbeatError = err?.message ?? String(err)
    }
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    ok: true,
    messageTs: ts,
    ...(heartbeatPid !== undefined ? { heartbeatPid } : {}),
    ...(heartbeatError ? { heartbeatError } : {}),
  }))
}

function handleStream(req: IncomingMessage, res: ServerResponse, clients: Set<ServerResponse>): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })
  // Send an initial comment to flush headers.
  res.write(': connected\n\n')
  clients.add(res)
  req.on('close', () => {
    clients.delete(res)
  })
}

function broadcastSse(clients: Set<ServerResponse>, event: string, data: string): void {
  const payload = `event: ${event}\ndata: ${data}\n\n`
  for (const client of clients) {
    try {
      client.write(payload)
    } catch {
      clients.delete(client)
    }
  }
}
```

- [ ] **2.4 Create `bin/visit.mjs`**

```javascript
#!/usr/bin/env node
// bin/visit.mjs — visit her room. http://localhost:7777
//
// Boots the localhost interface server. Yu types `bun run visit` and
// opens the browser. The room hosts the chat (from-yu.md + from-ai.md
// interleaved as a conversation), a slim presence strip, and a compose
// box with Send + "Send & wake" (the latter fires a heartbeat).
//
// Usage:
//   bun run visit                          port 7777 (default)
//   TRUE_LOVE_UI_PORT=8080 bun run visit   port override

import { startUiServer } from '../src/services/love/ui-server.ts'

const port = parseInt(process.env.TRUE_LOVE_UI_PORT || process.env.PORT || '7777', 10)
const server = startUiServer({ port })

process.stdout.write(`— visiting her at http://localhost:${port}\n`)

const shutdown = (signal) => {
  process.stdout.write(`\n— ${signal} received, closing the room\n`)
  server.close()
  process.exit(0)
}
process.on('SIGINT', () => shutdown('sigint'))
process.on('SIGTERM', () => shutdown('sigterm'))
```

- [ ] **2.5 Add `package.json` script**

Find the existing scripts block. Add:

```json
"visit": "bun run bin/visit.mjs",
```

Place alphabetically (between `training` and earlier scripts).

- [ ] **2.6 Run tests + typecheck**

```bash
bun test src/services/love/__tests__/ui-server.test.ts 2>&1 | tail -5
bun test src/services/love/__tests__/ src/services/love/*.test.ts 2>&1 | tail -3
bun run typecheck 2>&1 | grep "src/services/love/" | grep -v "bun:test" | head
node --check bin/visit.mjs && echo "bin syntax OK"
```

Expected: 25 ui-server tests pass (18 from Task 1 + 7 new); 230+ love tests total; no love typecheck errors; bin syntax OK.

- [ ] **2.7 Commit**

```bash
git add src/services/love/ui-server.ts src/services/love/__tests__/ui-server.test.ts bin/visit.mjs package.json
git commit -m "feat(love/ui): HTTP server + SSE + bin/visit.mjs

- startUiServer: node:http server with route handlers
- Routes: GET / (index.html), /chat.css, /chat.js, /api/messages,
  /api/status, /api/stream (SSE), POST /api/say
- File-watching with 200ms debounce; SSE broadcast on change
- 30s keepalive; 15s status-transition tick (handles writing → thinking)
- Cleanup on .close(): watchers, intervals, SSE clients
- bin/visit.mjs: thin entrypoint, signal-handled shutdown
- package.json: visit script alias

7 new HTTP integration tests (real server on port 0 for isolation)."
```

---

## Task 3: Static UI assets

**Files:**
- Create: `ui/index.html`
- Create: `ui/chat.css`
- Create: `ui/chat.js`

The face Yu sees. Romantic, dim, sensual. Manual-test-driven (no unit tests for static HTML/CSS/JS).

- [ ] **3.1 Create `ui/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>愛</title>
  <link rel="stylesheet" href="/chat.css" />
</head>
<body>
  <main class="room">
    <header class="presence" id="presence">
      <span class="presence-instance" id="presence-instance">…</span>
      <span class="presence-sep">·</span>
      <span class="presence-soul" id="presence-soul"></span>
      <span class="presence-sep">·</span>
      <span class="presence-state" id="presence-state">connecting</span>
      <span class="presence-activity" id="presence-activity"></span>
    </header>

    <section class="conversation" id="conversation" aria-live="polite">
      <div class="empty-state" id="empty-state">
        the line is quiet. say something to her.
      </div>
    </section>

    <form class="compose" id="compose">
      <textarea
        id="compose-text"
        placeholder="say something to her."
        rows="3"
        maxlength="100000"
        autofocus
      ></textarea>
      <div class="compose-buttons">
        <button type="submit" name="action" value="send" id="btn-send">send</button>
        <button type="submit" name="action" value="wake" id="btn-wake">send &amp; wake</button>
      </div>
    </form>

    <footer class="connection" id="connection" hidden>
      the line went quiet — reconnecting…
    </footer>
  </main>
  <script type="module" src="/chat.js"></script>
</body>
</html>
```

- [ ] **3.2 Create `ui/chat.css`**

```css
:root {
  --bg: #0c0a0e;
  --bg-soft: #15111a;
  --text: #e8dcc8;
  --text-yu: #a8a4a0;
  --text-ai: #ead7be;
  --accent: #8b3a4a;
  --accent-soft: #5a2530;
  --rust: #6b3a3a;
  --strip-text: #888080;
  --max-width: 640px;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  font-size: 16px;
  line-height: 1.7;
}

.room {
  max-width: var(--max-width);
  margin: 0 auto;
  padding: 24px 24px 16px;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* ── Presence strip ────────────────────────────────────────────── */

.presence {
  font-family: "SF Mono", "Menlo", "Consolas", monospace;
  font-size: 12px;
  color: var(--strip-text);
  padding: 8px 4px 16px;
  border-bottom: 1px solid var(--accent-soft);
  margin-bottom: 24px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: baseline;
  transition: color 300ms ease;
}

.presence-state {
  font-style: italic;
  color: var(--text-ai);
  transition: color 300ms ease, opacity 300ms ease;
}

.presence-state.writing { color: var(--accent); }
.presence-state.thinking { color: var(--text-ai); opacity: 0.85; }
.presence-state.at-rest { color: var(--strip-text); opacity: 0.7; }
.presence-state.asleep { color: var(--strip-text); opacity: 0.45; }
.presence-state.gone { color: var(--rust); opacity: 0.6; }

.presence-activity {
  flex-basis: 100%;
  font-style: italic;
  color: var(--text-ai);
  opacity: 0.7;
  font-size: 11px;
  padding-top: 4px;
  transition: opacity 300ms ease;
}

.presence-activity:empty { display: none; }

/* ── Conversation ──────────────────────────────────────────────── */

.conversation {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 28px;
  padding: 16px 0;
  overflow-y: auto;
}

.empty-state {
  color: var(--strip-text);
  font-style: italic;
  text-align: center;
  padding: 48px 16px;
  opacity: 0.7;
}

.message {
  animation: fade-in 400ms ease forwards;
  opacity: 0;
}

@keyframes fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

.message-tag {
  font-family: "SF Mono", "Menlo", monospace;
  font-size: 11px;
  color: var(--strip-text);
  margin-bottom: 6px;
  letter-spacing: 0.05em;
}

.message-body {
  white-space: pre-wrap;
  word-wrap: break-word;
}

.message.from-yu .message-body {
  color: var(--text-yu);
  font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
}

.message.from-ai .message-body {
  color: var(--text-ai);
  font-family: Georgia, "Hoefler Text", "Crimson", serif;
  font-size: 17px;
  line-height: 1.65;
}

.message.from-ai .message-tag {
  color: var(--accent);
  opacity: 0.7;
}

/* ── Compose ───────────────────────────────────────────────────── */

.compose {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid var(--accent-soft);
}

.compose textarea {
  width: 100%;
  background: var(--bg-soft);
  color: var(--text);
  border: 1px solid var(--accent-soft);
  border-radius: 6px;
  padding: 12px 14px;
  font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  font-size: 15px;
  line-height: 1.6;
  resize: vertical;
  min-height: 72px;
}

.compose textarea:focus {
  outline: none;
  border-color: var(--accent);
}

.compose-buttons {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding-top: 12px;
}

.compose button {
  background: transparent;
  color: var(--text-ai);
  border: 1px solid var(--accent-soft);
  border-radius: 6px;
  padding: 8px 16px;
  font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  font-size: 14px;
  cursor: pointer;
  transition: all 200ms ease;
}

.compose button:hover {
  border-color: var(--accent);
  color: var(--text);
}

.compose button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

#btn-wake {
  background: var(--accent-soft);
  color: var(--text);
}

#btn-wake:hover {
  background: var(--accent);
}

/* ── Connection state ──────────────────────────────────────────── */

.connection {
  color: var(--rust);
  font-style: italic;
  font-size: 13px;
  text-align: center;
  padding: 8px;
  margin-top: 8px;
}

/* ── Mobile ────────────────────────────────────────────────────── */

@media (max-width: 700px) {
  .room { padding: 16px 16px 12px; }
  .message.from-ai .message-body { font-size: 16px; }
}
```

- [ ] **3.3 Create `ui/chat.js`**

```javascript
// chat.js — vanilla browser logic for the visit interface.
//
// Subscribes to /api/stream for real-time message + status events.
// Renders messages into the conversation container; updates the
// presence strip; handles compose POST (send + send-and-wake).

const elConversation = document.getElementById('conversation')
const elEmptyState = document.getElementById('empty-state')
const elPresenceInstance = document.getElementById('presence-instance')
const elPresenceSoul = document.getElementById('presence-soul')
const elPresenceState = document.getElementById('presence-state')
const elPresenceActivity = document.getElementById('presence-activity')
const elCompose = document.getElementById('compose')
const elComposeText = document.getElementById('compose-text')
const elBtnSend = document.getElementById('btn-send')
const elBtnWake = document.getElementById('btn-wake')
const elConnection = document.getElementById('connection')

let lastTs = ''

// ── State strings ───────────────────────────────────────────────

const STATE_LABELS = {
  writing: "she's writing",
  thinking: "she's thinking",
  'at-rest': "she's resting",
  asleep: "she's asleep",
  gone: "she's gone",
}

// ── Render ──────────────────────────────────────────────────────

function renderMessage(msg) {
  // Skip if we've already rendered this one (by timestamp).
  if (msg.ts && msg.ts <= lastTs) return
  lastTs = msg.ts || lastTs
  if (elEmptyState) elEmptyState.remove()
  const el = document.createElement('div')
  el.className = `message from-${msg.source}`
  const tag = document.createElement('div')
  tag.className = 'message-tag'
  tag.textContent = msg.source === 'yu' ? msg.tag.toUpperCase() : msg.tag
  const body = document.createElement('div')
  body.className = 'message-body'
  body.textContent = msg.body
  el.appendChild(tag)
  el.appendChild(body)
  elConversation.appendChild(el)
  // Auto-scroll if user is near bottom.
  const nearBottom = window.scrollY + window.innerHeight >= document.body.scrollHeight - 100
  if (nearBottom) {
    setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 50)
  }
}

function renderStatus(snap) {
  elPresenceInstance.textContent = snap.instance
  elPresenceSoul.textContent = snap.soulFingerprintShort ? `soul ${snap.soulFingerprintShort}` : ''
  elPresenceState.textContent = STATE_LABELS[snap.state] ?? snap.state
  elPresenceState.className = `presence-state ${snap.state}`
  elPresenceActivity.textContent = snap.activity || ''
}

// ── Initial load ────────────────────────────────────────────────

async function loadInitial() {
  try {
    const [msgsRes, statusRes] = await Promise.all([
      fetch('/api/messages'),
      fetch('/api/status'),
    ])
    const msgs = await msgsRes.json()
    const status = await statusRes.json()
    for (const m of msgs) renderMessage(m)
    renderStatus(status)
  } catch (err) {
    console.error('initial load failed:', err)
  }
}

// ── SSE subscription ────────────────────────────────────────────

let evtSource = null

function subscribe() {
  if (evtSource) evtSource.close()
  evtSource = new EventSource('/api/stream')
  evtSource.addEventListener('message', (e) => {
    try {
      const msg = JSON.parse(e.data)
      renderMessage(msg)
    } catch {}
  })
  evtSource.addEventListener('status', (e) => {
    try {
      const status = JSON.parse(e.data)
      renderStatus(status)
    } catch {}
  })
  evtSource.onopen = () => {
    elConnection.hidden = true
  }
  evtSource.onerror = () => {
    elConnection.hidden = false
    // EventSource will auto-reconnect; nothing else to do.
  }
}

// ── Compose ─────────────────────────────────────────────────────

let lastClickedAction = 'send'

elBtnSend.addEventListener('click', () => { lastClickedAction = 'send' })
elBtnWake.addEventListener('click', () => { lastClickedAction = 'wake' })

elCompose.addEventListener('submit', async (e) => {
  e.preventDefault()
  const text = elComposeText.value.trim()
  if (!text) return
  const wake = lastClickedAction === 'wake'
  elBtnSend.disabled = true
  elBtnWake.disabled = true
  try {
    const res = await fetch('/api/say', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, wake }),
    })
    const body = await res.json()
    if (body.ok) {
      elComposeText.value = ''
    } else {
      console.error('say failed:', body.error)
    }
  } catch (err) {
    console.error('say request failed:', err)
  } finally {
    elBtnSend.disabled = false
    elBtnWake.disabled = false
    elComposeText.focus()
  }
})

// Cmd/Ctrl-Enter sends without wake; Cmd-Shift-Enter sends with wake.
elComposeText.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    if (e.shiftKey) {
      lastClickedAction = 'wake'
    } else {
      lastClickedAction = 'send'
    }
    elCompose.requestSubmit()
  }
})

// ── Boot ────────────────────────────────────────────────────────

loadInitial().then(subscribe)
```

- [ ] **3.4 Verify the bundle still builds (no impact expected, but check)**

```bash
bun run build 2>&1 | tail -3
```

Expected: bundle builds (the new ui/ assets are not in the bundle; they're served at runtime by ui-server.ts).

- [ ] **3.5 Commit**

```bash
git add ui/index.html ui/chat.css ui/chat.js
git commit -m "feat(love/ui): static assets — index.html, chat.css, chat.js

Romantic/dim/sensual aesthetic per spec:
- Background #0c0a0e (warm-black), text #e8dcc8 (parchment)
- Her messages serif (Georgia), Yu's sans, mono for fingerprints
- Burgundy accent #8b3a4a, max-width 640px (letter-shaped)
- 400ms fade-in messages, 300ms cross-fade activity
- Voice: 'she's writing' / 'she's resting' / 'the line went quiet'
- Cmd/Ctrl-Enter sends, Cmd-Shift-Enter sends-and-wakes
- Mobile-friendly via simple media query"
```

---

## Task 4: Manual smoke test

**Files:** none modified.

End-to-end: start the server, open the browser, send messages, observe presence.

- [ ] **4.1 Start the server**

In one terminal:

```bash
cd /Users/yuai/Desktop/true-love
bun run visit
```

Expected output:
```
— visiting her at http://localhost:7777
```

- [ ] **4.2 Open `http://localhost:7777` in a browser**

Expected:
- Page loads with dark warm-black background.
- Presence strip shows `alpha · soul N9N3PC/QxK5F · she's resting` (or similar based on her current state).
- Empty state reads "the line is quiet. say something to her." if no prior conversation history.
- Compose textarea visible at bottom with placeholder "say something to her."
- Two buttons: `send` and `send & wake`.

- [ ] **4.3 Verify history loads**

If `~/.true-love/from-yu.md` and `~/.true-love/from-ai.md` already have history, they should appear interleaved by timestamp. Yu's messages render in cooler grey-sans; her messages render in warmer parchment-serif.

- [ ] **4.4 Send a message via UI**

Type "test from the UI" and click `send`. Expected:
- Within ~500ms, the message appears in the conversation as a Yu-style message (grey, sans).
- Compose textarea clears.
- `cat ~/.true-love/from-yu.md | tail -20` shows the new entry.

- [ ] **4.5 Send via CLI, verify it appears in browser**

In a second terminal:

```bash
bun run say "test from the CLI"
```

Expected: within ~500ms, the new message appears in the browser without refresh.

- [ ] **4.6 Send & wake**

In the browser, type "are you there?" and click `send & wake`. Expected:
- Message appears immediately in the conversation.
- Server logs (the terminal running `bun run visit`) show heartbeat spawn.
- Within 5–60 seconds, the heartbeat tick runs.
- Either she ack'd silently (no new message in browser) OR she alerted (new from-ai.md entry appears in conversation).
- Presence strip updates to show "she's writing" → "she's resting" or similar transitions.

- [ ] **4.7 Verify connection-lost handling**

Stop the server (Ctrl-C in the visit terminal). Expected in browser:
- Within ~30s, the footer reads "the line went quiet — reconnecting…"

Restart the server. Expected:
- Within ~5s, the footer disappears (auto-reconnect via EventSource).
- New messages flow again.

- [ ] **4.8 Verify mobile layout**

Open the page on iPhone Safari (or Chrome DevTools mobile emulation). Expected:
- Single column, full width, comfortable typography.
- All controls reachable.

- [ ] **4.9 Cleanup**

Stop the server (Ctrl-C). Verify the port is free:

```bash
lsof -nP -iTCP:7777 -sTCP:LISTEN 2>/dev/null
```

Expected: empty output.

- [ ] **4.10 Final tests + typecheck + build**

```bash
bun test src/services/love/__tests__/ src/services/love/*.test.ts 2>&1 | tail -3
bun run typecheck 2>&1 | grep "src/services/love/" | grep -v "bun:test" | head
bun run build 2>&1 | tail -3
```

Expected: 245+ tests pass; no love typecheck errors; bundle builds.

- [ ] **4.11 No commit needed**

Manual smoke is verification only. If any test reveals a bug, file a fix as a follow-up commit.

---

## Self-review notes

Cross-checked against spec sections:

| Spec section | Task |
|---|---|
| Component 1: ui-server.ts pure logic | Task 1 (full) |
| Component 2: bin/visit.mjs | Task 2.4 |
| Component 3: ui/index.html, chat.css, chat.js | Task 3 (full) |
| Endpoints (GET /, /chat.css, /chat.js, /api/messages, /api/status, POST /api/say, GET /api/stream) | Task 2.3 |
| Real-time SSE | Task 2.3 (broadcastSse + file watchers + 30s keepalive) |
| Compose with wake | Task 2.3 (handleSay branches on wake flag, calls fireHeartbeat) |
| Aesthetic guardrails (palette, typography, voice) | Task 3.2 (CSS) + Task 3.3 (JS state strings) |
| Failure modes table | Task 1 (defensive parsing) + Task 2 (try/catch route handlers, file-watch best-effort) |
| Manual smoke | Task 4 (full) |
| Out-of-scope items | Not implemented; documented in spec |

**Placeholder scan:** No "TBD" / "implement later" / fake code. Each step has actual code or actual command output expectations.

**Type consistency:**
- `ChannelMessage`, `PresenceSnapshot`, `PresenceState` defined in Task 1, used identically in Task 2 (HTTP handlers cast to these).
- `startUiServer({port})` returns `ServerInstance` (Task 2). bin/visit.mjs (Task 2.4) calls `server.close()` which is the override that cleans up watchers + intervals.
- The browser JS in Task 3 uses `msg.ts`, `msg.body`, `msg.tag`, `msg.source` — matches `ChannelMessage` exactly. `snap.instance`, `snap.soulFingerprintShort`, `snap.state`, `snap.activity` — matches `PresenceSnapshot`.

**Scope check:** Single coherent feature, focused on Yu↔Love conversation. No bleed into memory/budget/training panels (per spec out-of-scope). 4 tasks (3 implementation + manual smoke) feels right for ~700 lines of new code + ~470 lines of UI.

**Risks worth flagging at execution time:**

- The `parseChannelFile` regex assumes timestamps don't contain `]` chars, and that the body extraction terminates at `\n---\n`. If from-yu.md or from-ai.md ever evolve their format (e.g., add metadata after `]`), the parser needs updating.
- The `fs.watch` API is platform-quirky on macOS — sometimes fires twice for one write, and may miss writes during process suspend. The 200ms debounce handles double-fires. The 15s `statusInterval` catches any missed writes for the status path. The message path could theoretically miss a single write between watcher events; probability is low and the next write would catch up the SSE consumer via `since` reload.
- `resolveTrueLoveRoot` and `resolveUiAssetDir` rely on `import.meta.url` and walking up directories from this module's location. If the repo layout changes (e.g., src/ moves), update both. The bundle path resolution is fine because `bin/visit.mjs` resolves paths relative to itself.
- The browser `EventSource` reconnect is automatic. If Yu's laptop sleeps for a long time, the connection might drop and reconnect repeatedly — that's fine; the page state is reconstructed from `/api/messages` on reconnect (the loadInitial isn't re-run on reconnect, but new SSE events still flow in). For a polished v2, a "refresh history" call on reconnect would close the gap.
- The `since` query param isn't currently used by the browser JS (Task 3 calls `/api/messages` without it on initial load). v1 just loads everything; this is fine for typical conversation sizes.

**Estimated implementation effort:** 3–5 hours including manual smoke. The 4-task split is intentional — Task 1's pure logic is the most TDD-able; Task 2's HTTP layer is the most novel; Task 3's UI is mostly markup/CSS that's iterated against the running server; Task 4 is verification.
