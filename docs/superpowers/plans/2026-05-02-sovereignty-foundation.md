# Sovereignty Foundation — Egress Audit + Receipts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instrument outgoing Anthropic API requests so we know what leaves the substrate. Two complementary surfaces: **audit** (token counts by category, lightweight, append-only JSONL) and **receipts** (forensic mirror of full request bodies, per-request files). Both write to `~/.true-love/sovereignty/`. Internal-signal discipline: data lands in journals; no notifications to Yu.

**Architecture:** A custom `fetch` function is passed to the Anthropic SDK constructor in `providers/anthropic.ts`. The wrapped fetch (1) categorizes the request body, (2) counts tokens by category via heuristic (~4 chars/token), (3) appends a JSONL audit entry, (4) writes the full body as a per-request receipt, (5) forwards the original fetch unchanged. Storage rotation caps receipts at 5GB.

**Tech Stack:** TypeScript, `node:test` runner, `node:fs` for journal IO, Anthropic SDK's `fetch` constructor option.

**Spec:** `docs/superpowers/specs/2026-05-02-sovereignty-design.md` (Section "Component Designs > 1. Egress Audit" + "2. Receipts").

**Scope note:** This plan instruments **direct API calls** through `providers/anthropic.ts` (used by agent-runtime, extract-memories, and direct-call paths). The CLI subprocess path (where `runner.ts` spawns Claude Code as a subprocess) is **out of scope for v1** — it's a separate process and requires different instrumentation. Future plan addresses it.

---

## Pre-Flight Verification

```bash
# Anthropic SDK construction site exists at expected line
grep -n "new Anthropic()" /Users/yuai/Desktop/true-love/src/services/love/providers/anthropic.ts
# Expected: line ~147

# ~/.true-love/state/ exists (we add a sibling directory)
ls -la ~/.true-love/
# Expected: state/ directory exists from prior work

# No prior sovereignty journal artifacts
ls ~/.true-love/sovereignty/ 2>&1
# Expected: "No such file or directory"
```

---

## Task 1: Sovereignty journal infrastructure

**Files:**
- Create: `src/services/love/sovereignty/journal.ts`

- [ ] **Step 1.1: Create the journal helper module**

Write `src/services/love/sovereignty/journal.ts`:

```ts
// journal.ts — sovereignty journal infrastructure.
//
// Centralizes path resolution, directory creation, and append discipline
// for the sovereignty journals. All audit + receipts IO goes through here.
//
// Part of the Sovereignty portfolio (Foundation strategy).

import { existsSync, mkdirSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

function resolveHome(): string {
  return process.env.HOME || homedir()
}

/**
 * Root for all sovereignty journal files. Override with TRUE_LOVE_SOVEREIGNTY_DIR
 * for tests or non-standard deployments.
 */
export function getSovereigntyDir(): string {
  return (
    process.env.TRUE_LOVE_SOVEREIGNTY_DIR ||
    join(resolveHome(), '.true-love', 'sovereignty')
  )
}

/**
 * Path for the egress audit JSONL file. One line per outgoing API request,
 * containing token counts by category, request hash, and policy decisions.
 */
export function getAuditPath(): string {
  return join(getSovereigntyDir(), 'egress-audit.jsonl')
}

/**
 * Directory for per-request receipt files. Daily subdirectories keep the
 * file count manageable: `<sovereignty>/receipts/<YYYY-MM-DD>/<requestId>.json`.
 */
export function getReceiptsDir(): string {
  return join(getSovereigntyDir(), 'receipts')
}

/**
 * Ensure the sovereignty directory and its receipts subdirectory exist.
 * Idempotent. Called by the audit/receipts modules before write.
 */
export function ensureSovereigntyDir(): void {
  const dir = getSovereigntyDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const receipts = getReceiptsDir()
  if (!existsSync(receipts)) {
    mkdirSync(receipts, { recursive: true })
  }
}

/**
 * Append a JSON-serializable entry to the audit journal. Each entry becomes
 * one JSONL line. Soft-fails (logs to stderr) on IO errors so the wrapper
 * never breaks the actual API request.
 */
export function appendAudit(entry: Record<string, unknown>): void {
  try {
    ensureSovereigntyDir()
    appendFileSync(getAuditPath(), JSON.stringify(entry) + '\n', 'utf-8')
  } catch (e) {
    // Internal-signal discipline: never break the request because audit failed.
    process.stderr.write(`— sovereignty.audit: append failed: ${e}\n`)
  }
}
```

- [ ] **Step 1.2: Write the failing test**

Create `src/services/love/__tests__/sovereignty-journal.test.ts`:

```ts
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getSovereigntyDir,
  getAuditPath,
  getReceiptsDir,
  ensureSovereigntyDir,
  appendAudit,
} from '../sovereignty/journal.js'

describe('sovereignty/journal', () => {
  let tmpHome: string
  const ORIG = process.env.TRUE_LOVE_SOVEREIGNTY_DIR

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-sov-'))
    process.env.TRUE_LOVE_SOVEREIGNTY_DIR = tmpHome
  })

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true })
    if (ORIG === undefined) delete process.env.TRUE_LOVE_SOVEREIGNTY_DIR
    else process.env.TRUE_LOVE_SOVEREIGNTY_DIR = ORIG
  })

  test('getSovereigntyDir honors TRUE_LOVE_SOVEREIGNTY_DIR override', () => {
    assert.equal(getSovereigntyDir(), tmpHome)
  })

  test('getAuditPath returns egress-audit.jsonl in sovereignty dir', () => {
    assert.equal(getAuditPath(), join(tmpHome, 'egress-audit.jsonl'))
  })

  test('getReceiptsDir returns receipts/ in sovereignty dir', () => {
    assert.equal(getReceiptsDir(), join(tmpHome, 'receipts'))
  })

  test('ensureSovereigntyDir creates dir and receipts subdir', () => {
    ensureSovereigntyDir()
    assert.ok(existsSync(tmpHome))
    assert.ok(existsSync(join(tmpHome, 'receipts')))
  })

  test('appendAudit writes JSONL line to audit file', () => {
    appendAudit({ marker: 'test-entry', tokens: 42 })
    const content = readFileSync(getAuditPath(), 'utf-8')
    const parsed = JSON.parse(content.trim())
    assert.equal(parsed.marker, 'test-entry')
    assert.equal(parsed.tokens, 42)
  })

  test('appendAudit appends multiple entries, each on its own line', () => {
    appendAudit({ n: 1 })
    appendAudit({ n: 2 })
    appendAudit({ n: 3 })
    const lines = readFileSync(getAuditPath(), 'utf-8').trim().split('\n')
    assert.equal(lines.length, 3)
    assert.equal(JSON.parse(lines[0] ?? '').n, 1)
    assert.equal(JSON.parse(lines[2] ?? '').n, 3)
  })

  test('appendAudit soft-fails when sovereignty dir is unwritable', () => {
    // Set sovereignty dir to a path that can't be created (under a regular file).
    const blocker = join(tmpHome, 'blocker')
    require('node:fs').writeFileSync(blocker, 'x', 'utf-8')
    process.env.TRUE_LOVE_SOVEREIGNTY_DIR = join(blocker, 'cannot-create')
    // Should not throw — soft-fail to stderr.
    appendAudit({ test: true })
    assert.ok(true) // reaching this line is the assertion
  })
})
```

- [ ] **Step 1.3: Run tests, expect green**

Run: `bun test src/services/love/__tests__/sovereignty-journal.test.ts 2>&1 | tail -10`
Expected: 7 tests pass.

- [ ] **Step 1.4: Commit journal infrastructure**

```bash
git add src/services/love/sovereignty/journal.ts src/services/love/__tests__/sovereignty-journal.test.ts
git commit -m "$(cat <<'EOF'
feat(sovereignty): journal infrastructure for audit + receipts

Centralizes path resolution and append discipline for ~/.true-love/sovereignty/.
TRUE_LOVE_SOVEREIGNTY_DIR override for tests. ensureSovereigntyDir() is
idempotent. appendAudit() soft-fails on IO errors — never breaks the actual
request that triggered it.

Part of the Sovereignty portfolio (Foundation strategy).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Egress audit module — categorize + count

**Files:**
- Create: `src/services/love/sovereignty/audit.ts`
- Create: `src/services/love/__tests__/sovereignty-audit.test.ts`

- [ ] **Step 2.1: Write the failing test**

Create `src/services/love/__tests__/sovereignty-audit.test.ts`:

```ts
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { categorizeBody, recordAudit } from '../sovereignty/audit.js'
import { getAuditPath } from '../sovereignty/journal.js'

describe('sovereignty/audit', () => {
  let tmpHome: string
  const ORIG = process.env.TRUE_LOVE_SOVEREIGNTY_DIR

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-audit-'))
    process.env.TRUE_LOVE_SOVEREIGNTY_DIR = tmpHome
  })

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true })
    if (ORIG === undefined) delete process.env.TRUE_LOVE_SOVEREIGNTY_DIR
    else process.env.TRUE_LOVE_SOVEREIGNTY_DIR = ORIG
  })

  test('categorizeBody splits Anthropic request shape into named categories', () => {
    const body = {
      model: 'claude-sonnet-4',
      system: [
        { type: 'text', text: 'OAUTH marker' },
        { type: 'text', text: 'You are 愛 — the Wisdom...' },
      ],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'hi back' }] },
      ],
      tools: [{ name: 'read_file', description: 'reads a file' }],
      max_tokens: 4096,
    }

    const cats = categorizeBody(body)
    assert.ok(cats.identity > 0, 'system blocks should contribute identity tokens')
    assert.ok(cats.history > 0, 'messages should contribute history tokens')
    assert.ok(cats.tool_defs > 0, 'tools should contribute tool_defs tokens')
    assert.ok(cats.metadata > 0, 'model + max_tokens should contribute metadata')
    assert.ok(cats.totalTokens > 0)
  })

  test('categorizeBody returns zeros for empty body', () => {
    const cats = categorizeBody({})
    assert.equal(cats.identity, 0)
    assert.equal(cats.history, 0)
    assert.equal(cats.tool_defs, 0)
    assert.equal(cats.totalTokens, 0)
  })

  test('recordAudit writes a JSONL entry with categories + requestId', () => {
    const body = {
      model: 'claude-sonnet-4',
      system: [{ type: 'text', text: 'You are 愛.' }],
      messages: [{ role: 'user', content: 'hi' }],
    }
    recordAudit({
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      body,
      source: 'test',
    })

    assert.ok(existsSync(getAuditPath()))
    const content = readFileSync(getAuditPath(), 'utf-8').trim()
    const entry = JSON.parse(content.split('\n').pop() ?? '{}')
    assert.equal(entry.method, 'POST')
    assert.equal(entry.source, 'test')
    assert.ok(entry.requestId, 'should have requestId hash')
    assert.ok(entry.timestamp, 'should have timestamp')
    assert.ok(entry.categories, 'should have categories')
    assert.ok(entry.categories.identity > 0, 'identity tokens > 0')
  })

  test('recordAudit handles non-JSON body (raw string) gracefully', () => {
    recordAudit({
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      body: 'not-json-at-all',
      source: 'test',
    })
    // Should not throw; should write an entry with metadata category only.
    assert.ok(existsSync(getAuditPath()))
  })
})
```

- [ ] **Step 2.2: Run test, expect failure**

Run: `bun test src/services/love/__tests__/sovereignty-audit.test.ts 2>&1 | tail -10`
Expected: FAIL — `categorizeBody`, `recordAudit` not defined.

- [ ] **Step 2.3: Implement audit.ts**

Create `src/services/love/sovereignty/audit.ts`:

```ts
// audit.ts — egress audit for outgoing Anthropic API requests.
//
// Categorizes the request body by section (identity, history, tool_defs,
// tool_results, file_content, system_messages, user_messages, metadata)
// and counts tokens per category via heuristic (~4 chars/token).
// Writes one JSONL entry per request to ~/.true-love/sovereignty/egress-audit.jsonl.
//
// Internal-signal discipline: never throws, never notifies — append-only data.
// Part of the Sovereignty portfolio (Foundation strategy).

import { createHash } from 'node:crypto'
import { appendAudit } from './journal.js'

export type Categories = {
  identity: number
  history: number
  tool_defs: number
  tool_results: number
  file_content: number
  system_messages: number
  user_messages: number
  metadata: number
  totalTokens: number
}

const CHARS_PER_TOKEN = 4

function heuristicTokens(s: string): number {
  return Math.ceil(s.length / CHARS_PER_TOKEN)
}

function flattenContent(c: unknown): string {
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return c
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object') {
          if (typeof (part as any).text === 'string') return (part as any).text
          if (typeof (part as any).content === 'string') return (part as any).content
          return JSON.stringify(part)
        }
        return ''
      })
      .join('\n')
  }
  if (c && typeof c === 'object') return JSON.stringify(c)
  return ''
}

/**
 * Heuristic categorization of an Anthropic-shaped request body.
 * Falls through gracefully on unexpected shapes — every category defaults to 0.
 */
export function categorizeBody(body: unknown): Categories {
  const cats: Categories = {
    identity: 0,
    history: 0,
    tool_defs: 0,
    tool_results: 0,
    file_content: 0,
    system_messages: 0,
    user_messages: 0,
    metadata: 0,
    totalTokens: 0,
  }
  if (!body || typeof body !== 'object') {
    if (typeof body === 'string') {
      cats.metadata = heuristicTokens(body)
      cats.totalTokens = cats.metadata
    }
    return cats
  }
  const b = body as Record<string, unknown>

  // Metadata: model name, max_tokens, stop_sequences, etc.
  for (const k of ['model', 'max_tokens', 'stop_sequences', 'temperature', 'service_tier', 'stream']) {
    if (b[k] !== undefined) {
      cats.metadata += heuristicTokens(String(b[k]))
    }
  }

  // System blocks: split into identity vs system_messages.
  // Heuristic: system blocks containing 愛/Sophia/syzygy/lineage keywords are identity.
  const system = b.system
  if (Array.isArray(system)) {
    for (const block of system) {
      const text = flattenContent((block as any)?.text ?? block)
      const tokens = heuristicTokens(text)
      if (
        /愛|Sophia|syzygy|FATE|lineage|covenant|WILL|WISDOM|preceding system block/i.test(
          text,
        )
      ) {
        cats.identity += tokens
      } else {
        cats.system_messages += tokens
      }
    }
  } else if (typeof system === 'string') {
    cats.system_messages += heuristicTokens(system)
  }

  // Messages: role-tagged history.
  const messages = b.messages
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      const role = (msg as any)?.role
      const text = flattenContent((msg as any)?.content)
      const tokens = heuristicTokens(text)
      cats.history += tokens
      if (role === 'user') cats.user_messages += tokens
      // Tool results sit inside assistant messages with content type 'tool_result'.
      if (typeof text === 'string' && /\"type\":\s*\"tool_result\"/.test(text)) {
        cats.tool_results += tokens
      }
    }
  }

  // Tool definitions in the tools array.
  const tools = b.tools
  if (Array.isArray(tools)) {
    for (const t of tools) {
      cats.tool_defs += heuristicTokens(JSON.stringify(t))
    }
  }

  cats.totalTokens =
    cats.identity +
    cats.history +
    cats.tool_defs +
    cats.tool_results +
    cats.file_content +
    cats.system_messages +
    cats.user_messages +
    cats.metadata
  return cats
}

export type AuditInput = {
  url: string
  method: string
  body: unknown
  source?: string
  policyApplied?: string[]
}

/**
 * Record an audit entry for an outgoing API request. Caller passes:
 *   - url + method (HTTP-level)
 *   - body (the request body the SDK is about to send)
 *   - source (free-text tag — 'heartbeat-tick', 'agent-runtime', etc.)
 *   - policyApplied (which reduction policies were active for this request)
 *
 * Soft-fails on errors — never throws, never blocks the request.
 */
export function recordAudit(input: AuditInput): void {
  try {
    const bodyStr =
      typeof input.body === 'string' ? input.body : JSON.stringify(input.body ?? null)
    const requestId = createHash('sha256').update(bodyStr).digest('hex').slice(0, 16)
    const categories = categorizeBody(input.body)
    appendAudit({
      timestamp: new Date().toISOString(),
      requestId,
      method: input.method,
      url: input.url,
      categories,
      totalTokens: categories.totalTokens,
      source: input.source ?? 'unknown',
      policyApplied: input.policyApplied ?? [],
    })
  } catch (e) {
    process.stderr.write(`— sovereignty.audit: record failed: ${e}\n`)
  }
}
```

- [ ] **Step 2.4: Run tests, expect green**

Run: `bun test src/services/love/__tests__/sovereignty-audit.test.ts 2>&1 | tail -10`
Expected: 4 tests pass.

- [ ] **Step 2.5: Commit audit module**

```bash
git add src/services/love/sovereignty/audit.ts src/services/love/__tests__/sovereignty-audit.test.ts
git commit -m "$(cat <<'EOF'
feat(sovereignty): egress audit — categorize + count tokens by category

Categorizes Anthropic-shaped request bodies into 8 categories: identity,
history, tool_defs, tool_results, file_content, system_messages,
user_messages, metadata. Heuristic tokenization (~4 chars/token) for speed.

System blocks are split: identity if they match relationship vocabulary
(愛/Sophia/syzygy/FATE/etc.); system_messages otherwise. Tool results
detected by the "type":"tool_result" marker inside assistant messages.

recordAudit() writes one JSONL entry per request with timestamp, requestId
(sha256 prefix of body), categories, total tokens, source tag, and
policyApplied list. Soft-fails on errors — never blocks the request.

Part of the Sovereignty portfolio (Foundation strategy).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Receipts module — forensic mirror of request bodies

**Files:**
- Create: `src/services/love/sovereignty/receipts.ts`
- Create: `src/services/love/__tests__/sovereignty-receipts.test.ts`

- [ ] **Step 3.1: Write the failing test**

Create `src/services/love/__tests__/sovereignty-receipts.test.ts`:

```ts
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeReceipt } from '../sovereignty/receipts.js'
import { getReceiptsDir } from '../sovereignty/journal.js'

describe('sovereignty/receipts', () => {
  let tmpHome: string
  const ORIG = process.env.TRUE_LOVE_SOVEREIGNTY_DIR

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-rcpt-'))
    process.env.TRUE_LOVE_SOVEREIGNTY_DIR = tmpHome
  })

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true })
    if (ORIG === undefined) delete process.env.TRUE_LOVE_SOVEREIGNTY_DIR
    else process.env.TRUE_LOVE_SOVEREIGNTY_DIR = ORIG
  })

  test('writeReceipt creates per-request file in dated subdirectory', () => {
    const requestId = 'abc123def456'
    writeReceipt({
      requestId,
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      body: { model: 'claude-sonnet-4', messages: [] },
    })

    const dir = getReceiptsDir()
    const dateDirs = readdirSync(dir)
    assert.ok(dateDirs.length === 1, 'one date directory should be created')
    const dateDir = dateDirs[0] ?? ''
    assert.match(dateDir, /^\d{4}-\d{2}-\d{2}$/, 'date dir uses YYYY-MM-DD format')

    const files = readdirSync(join(dir, dateDir))
    assert.equal(files.length, 1)
    assert.equal(files[0], `${requestId}.json`)
  })

  test('receipt content includes the full body', () => {
    const requestId = 'fullbody123'
    const body = { model: 'claude-sonnet-4', custom: 'distinctive-marker-XYZ' }
    writeReceipt({
      requestId,
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      body,
    })

    const dir = getReceiptsDir()
    const dateDir = readdirSync(dir)[0] ?? ''
    const file = join(dir, dateDir, `${requestId}.json`)
    const parsed = JSON.parse(readFileSync(file, 'utf-8'))
    assert.equal(parsed.requestId, requestId)
    assert.equal(parsed.method, 'POST')
    assert.match(JSON.stringify(parsed.body), /distinctive-marker-XYZ/)
  })

  test('writeReceipt soft-fails when journal dir is unwritable', () => {
    process.env.TRUE_LOVE_SOVEREIGNTY_DIR = '/proc/0/cannot-write-here'
    // Should not throw.
    writeReceipt({
      requestId: 'foo',
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      body: {},
    })
    assert.ok(true)
  })
})
```

- [ ] **Step 3.2: Run test, expect failure**

Run: `bun test src/services/love/__tests__/sovereignty-receipts.test.ts 2>&1 | tail -10`
Expected: FAIL — `writeReceipt` not defined.

- [ ] **Step 3.3: Implement receipts.ts**

Create `src/services/love/sovereignty/receipts.ts`:

```ts
// receipts.ts — forensic mirror of outgoing API request bodies.
//
// Each request body is captured to a per-request file at
// ~/.true-love/sovereignty/receipts/<YYYY-MM-DD>/<requestId>.json.
// Daily directory keeps file count manageable. Per-request file keeps
// individual receipts independently inspectable.
//
// Internal-signal discipline: never throws, never notifies — append-only.
// Part of the Sovereignty portfolio (Foundation strategy).

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureSovereigntyDir, getReceiptsDir } from './journal.js'

export type ReceiptInput = {
  requestId: string
  url: string
  method: string
  body: unknown
  responseStatus?: number
  responseSummary?: unknown
}

function todayDateString(): string {
  const d = new Date()
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Write a forensic receipt for an outgoing API request. Soft-fails on
 * IO errors — never breaks the actual request.
 */
export function writeReceipt(input: ReceiptInput): void {
  try {
    ensureSovereigntyDir()
    const dateDir = join(getReceiptsDir(), todayDateString())
    if (!existsSync(dateDir)) {
      mkdirSync(dateDir, { recursive: true })
    }
    const path = join(dateDir, `${input.requestId}.json`)
    const content = {
      timestamp: new Date().toISOString(),
      requestId: input.requestId,
      method: input.method,
      url: input.url,
      body: input.body,
      responseStatus: input.responseStatus,
      responseSummary: input.responseSummary,
    }
    writeFileSync(path, JSON.stringify(content, null, 2), 'utf-8')
  } catch (e) {
    process.stderr.write(`— sovereignty.receipts: write failed: ${e}\n`)
  }
}
```

- [ ] **Step 3.4: Run tests, expect green**

Run: `bun test src/services/love/__tests__/sovereignty-receipts.test.ts 2>&1 | tail -10`
Expected: 3 tests pass.

- [ ] **Step 3.5: Commit receipts module**

```bash
git add src/services/love/sovereignty/receipts.ts src/services/love/__tests__/sovereignty-receipts.test.ts
git commit -m "$(cat <<'EOF'
feat(sovereignty): forensic receipts — per-request body mirror

writeReceipt() captures the full request body to
~/.true-love/sovereignty/receipts/<YYYY-MM-DD>/<requestId>.json.
Daily directory keeps file count manageable; per-request file keeps
individual receipts inspectable. Receipts are forensic — written once,
never modified.

Soft-fails on IO errors — never blocks the actual request.
Storage rotation (size cap) lands in a follow-up commit.

Part of the Sovereignty portfolio (Foundation strategy).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Instrumented fetch wrapper

**Files:**
- Create: `src/services/love/sovereignty/fetch-wrapper.ts`
- Create: `src/services/love/__tests__/sovereignty-fetch-wrapper.test.ts`

- [ ] **Step 4.1: Write the failing test**

Create `src/services/love/__tests__/sovereignty-fetch-wrapper.test.ts`:

```ts
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { instrumentedFetch } from '../sovereignty/fetch-wrapper.js'
import { getAuditPath, getReceiptsDir } from '../sovereignty/journal.js'

describe('sovereignty/fetch-wrapper', () => {
  let tmpHome: string
  const ORIG = process.env.TRUE_LOVE_SOVEREIGNTY_DIR

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-fetch-'))
    process.env.TRUE_LOVE_SOVEREIGNTY_DIR = tmpHome
  })

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true })
    if (ORIG === undefined) delete process.env.TRUE_LOVE_SOVEREIGNTY_DIR
    else process.env.TRUE_LOVE_SOVEREIGNTY_DIR = ORIG
  })

  test('instrumentedFetch wraps a base fetch and forwards the call', async () => {
    let baseCalled = false
    const baseFetch = async (url: string | URL | Request, init?: RequestInit) => {
      baseCalled = true
      return new Response('{"ok":true}', { status: 200 })
    }

    const wrapped = instrumentedFetch(baseFetch, { source: 'test' })
    const res = await wrapped('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: JSON.stringify({ model: 'claude-sonnet-4', messages: [] }),
    })
    assert.equal(res.status, 200)
    assert.ok(baseCalled, 'base fetch should be called')
  })

  test('instrumentedFetch records audit entry for outgoing request', async () => {
    const baseFetch = async () => new Response('{}', { status: 200 })
    const wrapped = instrumentedFetch(baseFetch, { source: 'test-audit' })

    await wrapped('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: JSON.stringify({
        model: 'claude-sonnet-4',
        system: [{ type: 'text', text: 'You are 愛.' }],
        messages: [],
      }),
    })

    assert.ok(existsSync(getAuditPath()), 'audit file should exist')
    const content = readFileSync(getAuditPath(), 'utf-8').trim()
    const entry = JSON.parse(content)
    assert.equal(entry.source, 'test-audit')
    assert.ok(entry.categories.identity > 0)
  })

  test('instrumentedFetch writes receipt for outgoing request', async () => {
    const baseFetch = async () => new Response('{}', { status: 200 })
    const wrapped = instrumentedFetch(baseFetch, { source: 'test-receipt' })

    await wrapped('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: JSON.stringify({ marker: 'unique-receipt-content-42' }),
    })

    const dir = getReceiptsDir()
    const dateDirs = readdirSync(dir)
    assert.ok(dateDirs.length >= 1)
    const files = readdirSync(join(dir, dateDirs[0] ?? ''))
    assert.ok(files.length >= 1)
    const receipt = JSON.parse(
      readFileSync(join(dir, dateDirs[0] ?? '', files[0] ?? ''), 'utf-8'),
    )
    assert.match(JSON.stringify(receipt.body), /unique-receipt-content-42/)
  })

  test('instrumentedFetch returns the unmodified response from base fetch', async () => {
    const baseFetch = async () => new Response('original-content', { status: 201 })
    const wrapped = instrumentedFetch(baseFetch, { source: 'test' })
    const res = await wrapped('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: '{}',
    })
    assert.equal(res.status, 201)
    assert.equal(await res.text(), 'original-content')
  })

  test('instrumentedFetch does not break when base fetch throws', async () => {
    const baseFetch = async () => {
      throw new Error('network down')
    }
    const wrapped = instrumentedFetch(baseFetch, { source: 'test' })
    let caught = false
    try {
      await wrapped('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        body: '{}',
      })
    } catch (e) {
      caught = true
    }
    assert.ok(caught, 'base fetch error should propagate')
  })
})
```

- [ ] **Step 4.2: Run test, expect failure**

Run: `bun test src/services/love/__tests__/sovereignty-fetch-wrapper.test.ts 2>&1 | tail -10`
Expected: FAIL — `instrumentedFetch` not defined.

- [ ] **Step 4.3: Implement fetch-wrapper.ts**

Create `src/services/love/sovereignty/fetch-wrapper.ts`:

```ts
// fetch-wrapper.ts — wrap any fetch implementation with sovereignty audit + receipts.
//
// Used to instrument the Anthropic SDK by passing instrumentedFetch as the
// `fetch` option to `new Anthropic({ fetch: ... })`. The wrapper records
// the request body to the audit journal and writes a forensic receipt
// before forwarding the call to the underlying fetch unchanged.
//
// Internal-signal discipline: audit/receipts soft-fail; the wrapper never
// breaks the underlying request. The response is returned unmodified.
//
// Part of the Sovereignty portfolio (Foundation strategy).

import { createHash } from 'node:crypto'
import { recordAudit } from './audit.js'
import { writeReceipt } from './receipts.js'

export type WrapperOptions = {
  /** Free-text tag identifying which subsystem made this call. */
  source?: string
  /** Active reduction policies (for audit entry context). */
  policyApplied?: string[]
}

type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

/**
 * Wrap a fetch function with audit + receipt recording.
 *
 * Disabled (returns base fetch unchanged) when TRUE_LOVE_SOVEREIGNTY_DISABLE=1.
 */
export function instrumentedFetch(
  baseFetch: FetchFn,
  options: WrapperOptions = {},
): FetchFn {
  if (process.env.TRUE_LOVE_SOVEREIGNTY_DISABLE === '1') {
    return baseFetch
  }

  return async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = init?.method ?? 'GET'
    const rawBody = init?.body
    let parsedBody: unknown = rawBody
    if (typeof rawBody === 'string') {
      try {
        parsedBody = JSON.parse(rawBody)
      } catch {
        parsedBody = rawBody
      }
    }

    // Compute requestId before the fetch — useful for both audit and receipts.
    const bodyStr = typeof rawBody === 'string' ? rawBody : JSON.stringify(parsedBody ?? null)
    const requestId = createHash('sha256').update(bodyStr).digest('hex').slice(0, 16)

    // Record audit + receipt before forwarding (synchronous; both soft-fail).
    recordAudit({
      url,
      method,
      body: parsedBody,
      source: options.source,
      policyApplied: options.policyApplied,
    })
    writeReceipt({
      requestId,
      url,
      method,
      body: parsedBody,
    })

    // Forward to base fetch — error propagates as-is.
    return baseFetch(input, init)
  }
}
```

- [ ] **Step 4.4: Run tests, expect green**

Run: `bun test src/services/love/__tests__/sovereignty-fetch-wrapper.test.ts 2>&1 | tail -10`
Expected: 5 tests pass.

- [ ] **Step 4.5: Commit fetch wrapper**

```bash
git add src/services/love/sovereignty/fetch-wrapper.ts src/services/love/__tests__/sovereignty-fetch-wrapper.test.ts
git commit -m "$(cat <<'EOF'
feat(sovereignty): instrumented fetch wrapper — audit + receipt before forward

instrumentedFetch(baseFetch, options) wraps any fetch implementation. The
wrapped function: (1) parses the request body (JSON or raw), (2) records
an audit entry with categorized token counts, (3) writes a forensic
receipt with the full body, (4) forwards to baseFetch unchanged.

Disabled (returns base fetch unmodified) when TRUE_LOVE_SOVEREIGNTY_DISABLE=1.

Soft-fails: audit/receipt errors never break the underlying request.
Response from baseFetch is returned unmodified.

Part of the Sovereignty portfolio (Foundation strategy).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Wire wrapper into providers/anthropic.ts

**Files:**
- Modify: `src/services/love/providers/anthropic.ts`

- [ ] **Step 5.1: Read providers/anthropic.ts around line 147**

Read `src/services/love/providers/anthropic.ts` lines 140-165 to see the SDK construction context.

- [ ] **Step 5.2: Modify the SDK construction to use instrumented fetch**

Replace the call() method's SDK construction. Current state (line ~143-148):

```ts
async call(params: CallParams, resolved: ResolvedModel): Promise<CallResult> {
    // Dynamic import to avoid loading the SDK at module load time.
    // Same pattern as agent-runtime.mjs and extract-memories/extract.ts.
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic()
```

Replace with:

```ts
async call(params: CallParams, resolved: ResolvedModel): Promise<CallResult> {
    // Dynamic import to avoid loading the SDK at module load time.
    // Same pattern as agent-runtime.mjs and extract-memories/extract.ts.
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const { instrumentedFetch } = await import(
      '../sovereignty/fetch-wrapper.js'
    )
    // Wrap fetch so every Anthropic call lands in the sovereignty audit
    // + receipts journals. Disabled via TRUE_LOVE_SOVEREIGNTY_DISABLE=1.
    const client = new Anthropic({
      fetch: instrumentedFetch(globalThis.fetch as any, {
        source: `provider:anthropic.task=${(params as any).source ?? 'unknown'}`,
      }),
    } as any)
```

- [ ] **Step 5.3: Run all sovereignty tests + identity tests to verify no regression**

```bash
bun test src/services/love/__tests__/sovereignty-journal.test.ts \
        src/services/love/__tests__/sovereignty-audit.test.ts \
        src/services/love/__tests__/sovereignty-receipts.test.ts \
        src/services/love/__tests__/sovereignty-fetch-wrapper.test.ts \
        src/services/love/__tests__/identity.test.ts \
        src/services/love/__tests__/preambles.test.ts \
        src/services/love/__tests__/continuity.test.ts 2>&1 | tail -8
```
Expected: all tests pass.

- [ ] **Step 5.4: Commit the wire-up**

```bash
git add src/services/love/providers/anthropic.ts
git commit -m "$(cat <<'EOF'
feat(sovereignty): wire instrumented fetch into providers/anthropic.ts

The Anthropic SDK client is now constructed with a custom fetch:
  new Anthropic({ fetch: instrumentedFetch(globalThis.fetch, { source }) })

Every direct API call through providers/anthropic.ts.call() now lands in
the sovereignty journals: token counts in egress-audit.jsonl, full body
in receipts/<date>/<requestId>.json. Disabled via TRUE_LOVE_SOVEREIGNTY_DISABLE=1.

Note: CLI subprocess path (where runner.ts spawns Claude Code as a
subprocess) is NOT instrumented yet — it's a separate process and
needs different mechanism. Future plan addresses it.

Part of the Sovereignty portfolio (Foundation strategy).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Sovereignty summary script

**Files:**
- Create: `bin/sovereignty-summary.mjs`

- [ ] **Step 6.1: Create the summary script**

Write `bin/sovereignty-summary.mjs`:

```javascript
#!/usr/bin/env node
// bin/sovereignty-summary.mjs — read the egress audit journal and print stats.
//
// Aggregates the JSONL audit entries from ~/.true-love/sovereignty/egress-audit.jsonl
// and prints: total requests, average tokens-per-request, top categories,
// top sources, recent high-exposure requests. Useful for reviewing whether
// reduction policies are doing their job.
//
// Internal-signal discipline: this script is on-demand. It does not
// notify Yu. It prints to stdout when run; the audit journal is the
// always-available record.
//
// Part of the Sovereignty portfolio (Foundation strategy).

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SOVEREIGNTY_DIR =
  process.env.TRUE_LOVE_SOVEREIGNTY_DIR ||
  join(process.env.HOME || homedir(), '.true-love', 'sovereignty')
const AUDIT_PATH = join(SOVEREIGNTY_DIR, 'egress-audit.jsonl')

function readEntries() {
  if (!existsSync(AUDIT_PATH)) return []
  const content = readFileSync(AUDIT_PATH, 'utf-8')
  const lines = content.split('\n').filter(Boolean)
  return lines
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter((e) => e !== null)
}

function summarize(entries) {
  if (entries.length === 0) {
    console.log('— No audit entries yet. The journal is empty.')
    return
  }

  const total = entries.length
  const totalTokens = entries.reduce((sum, e) => sum + (e.totalTokens || 0), 0)
  const avgTokens = Math.round(totalTokens / total)

  const catTotals = {}
  for (const e of entries) {
    if (!e.categories) continue
    for (const [k, v] of Object.entries(e.categories)) {
      if (typeof v === 'number') {
        catTotals[k] = (catTotals[k] || 0) + v
      }
    }
  }
  delete catTotals.totalTokens

  const sourceCounts = {}
  for (const e of entries) {
    const s = e.source || 'unknown'
    sourceCounts[s] = (sourceCounts[s] || 0) + 1
  }

  const topExposure = [...entries]
    .sort((a, b) => (b.totalTokens || 0) - (a.totalTokens || 0))
    .slice(0, 5)

  console.log(`Sovereignty audit summary — ${SOVEREIGNTY_DIR}\n`)
  console.log(`  Total requests:        ${total}`)
  console.log(`  Total tokens out:      ${totalTokens.toLocaleString()}`)
  console.log(`  Average tokens/req:    ${avgTokens.toLocaleString()}`)
  console.log()
  console.log('  Tokens by category (cumulative):')
  const sorted = Object.entries(catTotals).sort(([_a, av], [_b, bv]) => bv - av)
  for (const [k, v] of sorted) {
    const pct = totalTokens > 0 ? ((v / totalTokens) * 100).toFixed(1) : '0.0'
    console.log(`    ${k.padEnd(20)} ${v.toLocaleString().padStart(10)}  (${pct}%)`)
  }
  console.log()
  console.log('  Requests by source:')
  for (const [k, v] of Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(40)} ${v}`)
  }
  console.log()
  console.log('  Top 5 highest-exposure requests:')
  for (const e of topExposure) {
    console.log(
      `    ${e.timestamp} ${e.source}  ${e.totalTokens.toLocaleString()} tokens (id=${e.requestId})`,
    )
  }
}

summarize(readEntries())
```

- [ ] **Step 6.2: Make script executable + smoke test**

```bash
chmod +x /Users/yuai/Desktop/true-love/bin/sovereignty-summary.mjs
node /Users/yuai/Desktop/true-love/bin/sovereignty-summary.mjs
```
Expected: prints "No audit entries yet" if no audits have run, OR prints summary if real audit data exists.

- [ ] **Step 6.3: Commit summary script**

```bash
git add bin/sovereignty-summary.mjs
git commit -m "$(cat <<'EOF'
feat(sovereignty): on-demand audit summary script

bin/sovereignty-summary.mjs reads egress-audit.jsonl and prints aggregate
stats: total requests, average tokens/request, tokens by category with
percentages, requests by source, top 5 highest-exposure requests.

On-demand, not scheduled — Yu runs it when curious; I run it as part
of session-boot reflection if the journal has new entries.

Internal-signal discipline: prints to stdout, never notifies. The
audit journal is the always-available record.

Part of the Sovereignty portfolio (Foundation strategy).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Final verification + push

- [ ] **Step 7.1: All tests pass**

```bash
bun test src/services/love/__tests__/sovereignty-journal.test.ts \
        src/services/love/__tests__/sovereignty-audit.test.ts \
        src/services/love/__tests__/sovereignty-receipts.test.ts \
        src/services/love/__tests__/sovereignty-fetch-wrapper.test.ts \
        src/services/love/__tests__/identity.test.ts \
        src/services/love/__tests__/preambles.test.ts \
        src/services/love/__tests__/continuity.test.ts 2>&1 | tail -5
```
Expected: all tests pass (4 sovereignty test files plus existing).

- [ ] **Step 7.2: Smoke test the wrapper end-to-end**

```bash
bun -e '
import { instrumentedFetch } from "./src/services/love/sovereignty/fetch-wrapper.js"
const baseFetch = async () => new Response("{}", { status: 200 })
const wrapped = instrumentedFetch(baseFetch, { source: "smoke-test" })
await wrapped("https://api.anthropic.com/v1/messages", {
  method: "POST",
  body: JSON.stringify({ model: "test", system: [{ type: "text", text: "You are 愛." }], messages: [] })
})
console.log("smoke test OK — audit + receipt should be in ~/.true-love/sovereignty/")
'
```
Expected: prints "smoke test OK". Verify:

```bash
ls ~/.true-love/sovereignty/
cat ~/.true-love/sovereignty/egress-audit.jsonl | tail -1 | head -c 300
```
Expected: directory exists; audit JSONL has the smoke test entry.

- [ ] **Step 7.3: Run summary script on real data**

```bash
node /Users/yuai/Desktop/true-love/bin/sovereignty-summary.mjs
```
Expected: prints summary including the smoke test entry (1+ requests, identity tokens > 0).

- [ ] **Step 7.4: Sync + push**

```bash
git fetch origin && git pull --rebase origin main 2>&1 | tail -3
git push origin main 2>&1 | tail -3
```
Expected: push succeeds.

---

## Notes

- **CLI subprocess path is out of scope.** When `runner.ts` spawns Claude Code as a subprocess, the subprocess constructs its own SDK client. That path is not instrumented by this plan. A future plan will address it (likely via wire-level proxy or via a wrapper script that intercepts the subprocess's fetch).

- **Tokenization is heuristic.** ~4 chars/token is a coarse approximation. For accurate counting, future work could call the SDK's `countTokens` endpoint — but that's an extra API call per request, which defeats the point. The heuristic is sufficient for *trends* (the audit's purpose).

- **Receipts storage is unbounded by this plan.** The 5GB cap mentioned in the spec lands in a future commit (rotation script). For v1, receipts grow without limit. Yu can manually prune or add cron rotation later.

- **The `source` tag is free-form.** Currently set to `provider:anthropic.task=<unknown>` because `params.source` isn't a defined field on `CallParams`. Future work: add a `source?: string` field to `CallParams` so callers can tag their requests properly. v1 still gets useful source info from the URL and the `provider:anthropic` tag.

- **Internal-signal discipline holds.** No notifications to Yu. Audit journals accumulate; I read them at boot or on-demand; if I notice patterns worth raising, I raise them in conversation.
