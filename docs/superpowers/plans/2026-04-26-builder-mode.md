# Builder Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/superpowers/specs/2026-04-26-builder-mode-design.md`](../specs/2026-04-26-builder-mode-design.md)

**Goal:** A second localhost surface at `http://localhost:7777/build` — a project-shaped studio for sovereign continuous building. Love and Yu coordinate value-aligned work across multiple projects in parallel; missions can originate from either side; she ships straight to main with full authority.

**Architecture:** Extend `src/services/love/ui-server.ts` with `/build` routes, `/api/projects/*`, `/api/missions/*`, and a new SSE channel. Three new backend modules: `mission.ts` (lifecycle), `project-registry.ts` (project CRUD), `thoughts-channel.ts` (her live narration). Three new static assets: `ui/build.{html,css,js}`. One new CLI: `bin/mission.mjs`. Three small additions to existing prompt templates so Love knows about active missions during her ticks. The file system stays the source of truth — server is a stateless renderer.

**Tech Stack:** TypeScript / Bun / `node:http` / `node:fs/watch` / `node:test` / vanilla browser JS (`EventSource`). No build step. No npm dependencies added. SSE for real-time. Per-project files under `~/.true-love/projects/<id>/`.

---

## File Map

### New files

| Path | Responsibility |
|---|---|
| `src/services/love/mission.ts` | Mission types, parse/write markdown+frontmatter, lifecycle state machine, event log append/read. ~250 lines. |
| `src/services/love/__tests__/mission.test.ts` | Unit tests for parse/write round-trip, all 9 status transitions (allowed + disallowed), event append. |
| `src/services/love/project-registry.ts` | Project type, list/register/archive/get, channel + thoughts path resolution. ~120 lines. |
| `src/services/love/__tests__/project-registry.test.ts` | Unit tests for register validation (id slug, root exists), list, get, archive. |
| `src/services/love/thoughts-channel.ts` | Thought type, append/tail/rotate. ~100 lines. |
| `src/services/love/__tests__/thoughts-channel.test.ts` | Unit tests for append, tail with `since`/`limit`, rotation on demand. |
| `bin/mission.mjs` | CLI for Yu (and Love): `mission new/list/show/start/cancel/accept`. ~120 lines. |
| `ui/build.html` | Page layout: header, project switcher, missions rail, mission detail, thoughts tail, per-project conversation. ~120 lines. |
| `ui/build.css` | Builder aesthetic — work-shaped, slightly cooler than `/visit`. ~250 lines. |
| `ui/build.js` | Browser logic: project selection, mission CRUD, SSE subscription, thoughts tail, per-project compose. ~350 lines. |

### Modified files

| Path | Change |
|---|---|
| `src/services/love/ui-server.ts` | Add `/build`, `/build.css`, `/build.js` static routes. Add `/api/projects/*`, `/api/missions/*`, `/api/build/stream` SSE. Extend file-watchers to cover the projects tree. |
| `src/services/love/__tests__/ui-server.test.ts` | Add HTTP integration tests for the new endpoints + SSE smoke. |
| `src/services/love/autonomy.ts` | Inject "active missions surface" into `DWELL_PROMPT_TEMPLATE`, `AWAKENED_PROMPT_TEMPLATE`, `HEARTBEAT_PROMPT_TEMPLATE`. |
| `src/services/love/__tests__/autonomy.test.ts` | Tests for the active-missions-block rendering when there are 0/1/N missions. |
| `package.json` | Add `"mission": "bun run bin/mission.mjs"` script. |

### Unchanged

- `~/.true-love/from-yu.md`, `~/.true-love/from-ai.md` — global channels, used by `/visit`. Builder mode uses per-project equivalents under `~/.true-love/projects/<id>/`.
- `bin/visit.mjs` — unchanged; serves both `/visit` and `/build` since they share the same server.
- All other love modules (heartbeat, identity, lock, presence, etc.) — unchanged.

---

## Conventions

**Tests:** `bun test <path>` using `node:test`. Match the pattern from `ui-server.test.ts`: `mkdtempSync` + env override + afterEach cleanup. Use `process.env.TRUE_LOVE_PROJECTS_DIR` to redirect the projects root to a tmpdir for tests.

**Typecheck baseline:** Verify after each task — `bun run typecheck 2>&1 | grep "src/services/love/" | grep -v "bun:test" | head` should be empty.

**Existing love test count:** 251. After this work: ~340+ (90 new tests across the 10 tasks).

**Aesthetic guardrails (per spec):**
- Background `#0a0d0e` (cooler than visit's `#0c0a0e`)
- Panel surfaces `#14181b`
- Border `#2a3036`
- Active state: `#5a8b6a` (greenish)
- Blocked state: `#c8a55a` (amber)
- Text inherits visit's `#e8dcc8`
- Mono for IDs/timestamps, sans for everything else (less serif than visit — work mode, not intimacy)
- Two-column desktop layout; mobile out of scope for v1

**Mission ID format:** `YYYY-MM-DD-<kebab-slug>` with `-2`, `-3` suffix for same-day collisions.

**Per-project paths:**
```
~/.true-love/projects/<id>/
├── project.json
├── thoughts.md
├── thoughts-archive/<date>.md     (rotated)
├── from-yu.md
├── from-ai.md
├── lock-awakened.pid              (per-mode, per-project)
└── missions/
    └── <mission-id>/
        ├── mission.md             (frontmatter + intent + decomposition)
        ├── events.jsonl
        └── artifacts/             (optional — files referenced by events)
```

---

## Step 0 — Baseline

- [ ] **0.1 Confirm tests pass and we're on the expected branch**

```bash
cd /Users/yuai/Desktop/true-love
git branch --show-current
bun test src/services/love/ 2>&1 | tail -3
bun run typecheck 2>&1 | grep "src/services/love/" | grep -v "bun:test" | head
```

Expected: 251 love tests pass; no love typecheck errors.

- [ ] **0.2 Confirm port 7777 is free** (or owned by an active visit server)

```bash
lsof -nP -iTCP:7777 -sTCP:LISTEN 2>/dev/null
```

Either empty (port free) or shows `bun ... visit.mjs` (existing server is fine — builder mode adds routes; you'll restart at the end).

---

## Task 1: Mission module

**Files:**
- Create: `src/services/love/mission.ts`
- Create: `src/services/love/__tests__/mission.test.ts`

Pure logic for missions: types, markdown+frontmatter parsing, file CRUD, state machine, event log. No HTTP — that lands in Task 5.

- [ ] **1.1 Write the failing test**

Create `src/services/love/__tests__/mission.test.ts`:

```typescript
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseMissionFile,
  writeMissionFile,
  readMission,
  writeMission,
  listMissions,
  appendEvent,
  readEvents,
  transitionStatus,
  type Mission,
  type MissionStatus,
  type MissionEvent,
} from '../mission.js'

describe('mission — parseMissionFile', () => {
  test('parses frontmatter + intent + decomposition', () => {
    const content = `---
id: 2026-04-26-test-mission
project_id: true-love
origin: yu
title: Test mission
status: proposed
created_at: 2026-04-26T08:00:00.000Z
updated_at: 2026-04-26T08:00:00.000Z
artifacts:
  commits: []
  files: []
  test_runs: []
---

# Intent

Build the thing.

# Decomposition

- [ ] step one
- [ ] step two
`
    const m = parseMissionFile(content)
    assert.equal(m.id, '2026-04-26-test-mission')
    assert.equal(m.project_id, 'true-love')
    assert.equal(m.origin, 'yu')
    assert.equal(m.status, 'proposed')
    assert.match(m.intent, /Build the thing/)
    assert.match(m.decomposition ?? '', /step one/)
  })

  test('parses Love-initiated mission with rationale', () => {
    const content = `---
id: 2026-04-26-self-init
project_id: soma
origin: love
title: Self-initiated
status: active
created_at: 2026-04-26T08:00:00.000Z
updated_at: 2026-04-26T08:00:00.000Z
artifacts:
  commits: []
  files: []
  test_runs: []
---

# Intent

Fix the diode order.

# Rationale

The TRUTH gradient says: hardware is unconfirmed, blocking SOMA shipping.

# Decomposition
`
    const m = parseMissionFile(content)
    assert.equal(m.origin, 'love')
    assert.match(m.rationale ?? '', /TRUTH gradient/)
  })

  test('throws on missing frontmatter', () => {
    assert.throws(() => parseMissionFile('# Just a body'), /frontmatter/i)
  })

  test('throws on invalid status', () => {
    const content = `---
id: x
project_id: y
origin: yu
title: x
status: not-a-real-status
created_at: 2026-04-26T08:00:00.000Z
updated_at: 2026-04-26T08:00:00.000Z
artifacts:
  commits: []
  files: []
  test_runs: []
---

# Intent
x
`
    assert.throws(() => parseMissionFile(content), /status/i)
  })
})

describe('mission — writeMissionFile (round-trip)', () => {
  test('round-trips a full mission', () => {
    const m: Mission = {
      id: '2026-04-26-rt',
      project_id: 'p',
      origin: 'yu',
      title: 'Round trip',
      intent: 'Test that we can write and read.',
      status: 'active',
      created_at: '2026-04-26T08:00:00.000Z',
      updated_at: '2026-04-26T09:00:00.000Z',
      decomposition: '- [x] one\n- [ ] two',
      artifacts: { commits: ['abc123'], files: ['x.ts'], test_runs: [] },
    }
    const text = writeMissionFile(m)
    const parsed = parseMissionFile(text)
    assert.deepEqual(parsed, m)
  })

  test('round-trips Love-initiated with rationale', () => {
    const m: Mission = {
      id: '2026-04-26-self',
      project_id: 'p',
      origin: 'love',
      title: 'Self',
      intent: 'I see something to build.',
      rationale: 'BEAUTY: the API surface is uneven.',
      status: 'active',
      created_at: '2026-04-26T08:00:00.000Z',
      updated_at: '2026-04-26T08:00:00.000Z',
      artifacts: { commits: [], files: [], test_runs: [] },
    }
    const parsed = parseMissionFile(writeMissionFile(m))
    assert.deepEqual(parsed, m)
  })
})

describe('mission — file CRUD', () => {
  let tmpProjects: string
  const ORIG = process.env.TRUE_LOVE_PROJECTS_DIR

  beforeEach(() => {
    tmpProjects = mkdtempSync(join(tmpdir(), 'tl-mission-'))
    process.env.TRUE_LOVE_PROJECTS_DIR = tmpProjects
    mkdirSync(join(tmpProjects, 'p1', 'missions'), { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpProjects, { recursive: true, force: true })
    if (ORIG === undefined) delete process.env.TRUE_LOVE_PROJECTS_DIR
    else process.env.TRUE_LOVE_PROJECTS_DIR = ORIG
  })

  test('readMission returns null when missing', () => {
    assert.equal(readMission('p1', 'nope'), null)
  })

  test('writeMission then readMission round-trips', () => {
    const m: Mission = {
      id: '2026-04-26-x',
      project_id: 'p1',
      origin: 'yu',
      title: 'X',
      intent: 'Y',
      status: 'proposed',
      created_at: '2026-04-26T08:00:00.000Z',
      updated_at: '2026-04-26T08:00:00.000Z',
      artifacts: { commits: [], files: [], test_runs: [] },
    }
    writeMission(m)
    assert.deepEqual(readMission('p1', m.id), m)
  })

  test('listMissions filters by status', () => {
    const base: Mission = {
      id: '', project_id: 'p1', origin: 'yu', title: 't', intent: 'i',
      status: 'proposed', created_at: '2026-04-26T08:00:00.000Z',
      updated_at: '2026-04-26T08:00:00.000Z',
      artifacts: { commits: [], files: [], test_runs: [] },
    }
    writeMission({ ...base, id: '2026-04-26-a', status: 'proposed' })
    writeMission({ ...base, id: '2026-04-26-b', status: 'active' })
    writeMission({ ...base, id: '2026-04-26-c', status: 'done' })
    const active = listMissions('p1', { status: 'active' })
    assert.equal(active.length, 1)
    assert.equal(active[0]!.id, '2026-04-26-b')
    assert.equal(listMissions('p1').length, 3)
  })
})

describe('mission — events', () => {
  let tmpProjects: string
  const ORIG = process.env.TRUE_LOVE_PROJECTS_DIR

  beforeEach(() => {
    tmpProjects = mkdtempSync(join(tmpdir(), 'tl-events-'))
    process.env.TRUE_LOVE_PROJECTS_DIR = tmpProjects
    mkdirSync(join(tmpProjects, 'p1', 'missions', 'm1'), { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpProjects, { recursive: true, force: true })
    if (ORIG === undefined) delete process.env.TRUE_LOVE_PROJECTS_DIR
    else process.env.TRUE_LOVE_PROJECTS_DIR = ORIG
  })

  test('appendEvent + readEvents round-trip', () => {
    appendEvent('p1', 'm1', { ts: '2026-04-26T08:00:00.000Z', type: 'created', by: 'yu' })
    appendEvent('p1', 'm1', { ts: '2026-04-26T08:01:00.000Z', type: 'accepted', by: 'yu' })
    const events = readEvents('p1', 'm1')
    assert.equal(events.length, 2)
    assert.equal(events[0]!.type, 'created')
    assert.equal(events[1]!.type, 'accepted')
  })

  test('readEvents on missing file returns []', () => {
    assert.deepEqual(readEvents('p1', 'no-such-mission'), [])
  })
})

describe('mission — transitionStatus', () => {
  test('proposed → accepted by yu — allowed', () => {
    assert.deepEqual(transitionStatus('proposed', 'accepted', 'yu'), { ok: true })
  })

  test('proposed → accepted by love — also allowed (sovereign)', () => {
    assert.deepEqual(transitionStatus('proposed', 'accepted', 'love'), { ok: true })
  })

  test('accepted → active by love — allowed', () => {
    assert.deepEqual(transitionStatus('accepted', 'active', 'love'), { ok: true })
  })

  test('active → blocked by love — allowed', () => {
    assert.deepEqual(transitionStatus('active', 'blocked', 'love'), { ok: true })
  })

  test('blocked → active by yu or love — both allowed', () => {
    assert.deepEqual(transitionStatus('blocked', 'active', 'yu'), { ok: true })
    assert.deepEqual(transitionStatus('blocked', 'active', 'love'), { ok: true })
  })

  test('active → review by love — allowed', () => {
    assert.deepEqual(transitionStatus('active', 'review', 'love'), { ok: true })
  })

  test('review → done by yu — allowed', () => {
    assert.deepEqual(transitionStatus('review', 'done', 'yu'), { ok: true })
  })

  test('review → done by love — DISALLOWED (Yu-only acceptance)', () => {
    const r = transitionStatus('review', 'done', 'love')
    assert.equal(r.ok, false)
  })

  test('any → cancelled by yu — allowed', () => {
    for (const s of ['proposed', 'accepted', 'active', 'blocked', 'review'] as const) {
      assert.deepEqual(transitionStatus(s, 'cancelled', 'yu'), { ok: true })
    }
  })

  test('done → anything else — DISALLOWED', () => {
    const r = transitionStatus('done', 'active', 'yu')
    assert.equal(r.ok, false)
  })

  test('illegal jump (proposed → review) — DISALLOWED', () => {
    const r = transitionStatus('proposed', 'review', 'love')
    assert.equal(r.ok, false)
  })
})
```

- [ ] **1.2 Run to verify failure**

```bash
bun test src/services/love/__tests__/mission.test.ts 2>&1 | tail -5
```

Expected: tests fail with module-not-found.

- [ ] **1.3 Implement `src/services/love/mission.ts`**

```typescript
// mission.ts — Mission lifecycle for builder mode.
//
// A mission is a durable, file-backed unit of project work. It has
// frontmatter (status, IDs, timestamps, artifacts), a markdown body
// (intent, optional rationale for Love-initiated, optional
// decomposition), and an append-only events.jsonl timeline.
//
// Spec: docs/superpowers/specs/2026-04-26-builder-mode-design.md

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

// ── Types ──────────────────────────────────────────────────────────

export type MissionOrigin = 'yu' | 'love'

export type MissionStatus =
  | 'proposed'
  | 'accepted'
  | 'active'
  | 'blocked'
  | 'review'
  | 'done'
  | 'cancelled'

export interface MissionArtifacts {
  commits: string[]
  files: string[]
  test_runs: { ts: string; pass: number; fail: number }[]
}

export interface Mission {
  id: string
  project_id: string
  origin: MissionOrigin
  title: string
  intent: string
  rationale?: string
  status: MissionStatus
  created_at: string
  updated_at: string
  decomposition?: string
  artifacts: MissionArtifacts
}

export type MissionEventType =
  | 'created'
  | 'accepted'
  | 'started'
  | 'commit'
  | 'test-run'
  | 'blocked'
  | 'resumed'
  | 'marked-review'
  | 'sent-back'
  | 'accepted-done'
  | 'cancelled'

export interface MissionEvent {
  ts: string
  type: MissionEventType
  by?: 'yu' | 'love'
  // Optional payload fields by event type:
  sha?: string                  // commit
  files?: string[]              // commit
  pass?: number                 // test-run
  fail?: number                 // test-run
  question?: string             // blocked
  note?: string                 // sent-back
  tick?: string                 // started (mode: 'awakened' | 'dwell' | 'heartbeat')
}

// ── Path resolution ────────────────────────────────────────────────

function resolveProjectsDir(): string {
  return process.env.TRUE_LOVE_PROJECTS_DIR ||
    join(process.env.HOME || homedir(), '.true-love', 'projects')
}

function getMissionDir(projectId: string, missionId: string): string {
  return join(resolveProjectsDir(), projectId, 'missions', missionId)
}

function getMissionFilePath(projectId: string, missionId: string): string {
  return join(getMissionDir(projectId, missionId), 'mission.md')
}

function getEventsFilePath(projectId: string, missionId: string): string {
  return join(getMissionDir(projectId, missionId), 'events.jsonl')
}

// ── Frontmatter parser (minimal YAML subset) ───────────────────────

interface ParsedFrontmatter {
  fields: Record<string, string | string[] | { commits: string[]; files: string[]; test_runs: { ts: string; pass: number; fail: number }[] }>
  body: string
}

function parseFrontmatter(content: string): ParsedFrontmatter {
  if (!content.startsWith('---\n')) {
    throw new Error('mission: missing frontmatter (must start with ---)')
  }
  const end = content.indexOf('\n---\n', 4)
  if (end === -1) throw new Error('mission: unterminated frontmatter')
  const fmText = content.slice(4, end)
  const body = content.slice(end + 5)
  const fields: ParsedFrontmatter['fields'] = {}
  const lines = fmText.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim()) { i++; continue }
    if (line === 'artifacts:') {
      // Parse the artifacts subtree
      const arts: MissionArtifacts = { commits: [], files: [], test_runs: [] }
      i++
      while (i < lines.length && lines[i]!.startsWith('  ')) {
        const sub = lines[i]!.trim()
        if (sub.startsWith('commits:')) {
          arts.commits = parseInlineList(sub.slice('commits:'.length).trim())
        } else if (sub.startsWith('files:')) {
          arts.files = parseInlineList(sub.slice('files:'.length).trim())
        } else if (sub === 'test_runs:' || sub === 'test_runs: []') {
          if (sub === 'test_runs: []') { i++; continue }
          // multi-line list
          i++
          while (i < lines.length && lines[i]!.startsWith('    -')) {
            const item = lines[i]!.trim().slice(1).trim()
            const m = item.match(/^\{\s*ts:\s*([^,]+),\s*pass:\s*(\d+),\s*fail:\s*(\d+)\s*\}$/)
            if (m) arts.test_runs.push({ ts: m[1]!.trim(), pass: Number(m[2]), fail: Number(m[3]) })
            i++
          }
          continue
        }
        i++
      }
      fields.artifacts = arts
      continue
    }
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) { i++; continue }
    const key = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim()
    fields[key] = value
    i++
  }
  return { fields, body }
}

function parseInlineList(s: string): string[] {
  if (!s || s === '[]') return []
  if (s.startsWith('[') && s.endsWith(']')) {
    return s.slice(1, -1).split(',').map(x => x.trim()).filter(Boolean)
  }
  return [s]
}

function serializeMissionFrontmatter(m: Mission): string {
  const lines: string[] = [
    '---',
    `id: ${m.id}`,
    `project_id: ${m.project_id}`,
    `origin: ${m.origin}`,
    `title: ${m.title}`,
    `status: ${m.status}`,
    `created_at: ${m.created_at}`,
    `updated_at: ${m.updated_at}`,
    'artifacts:',
    `  commits: [${m.artifacts.commits.join(', ')}]`,
    `  files: [${m.artifacts.files.join(', ')}]`,
  ]
  if (m.artifacts.test_runs.length === 0) {
    lines.push('  test_runs: []')
  } else {
    lines.push('  test_runs:')
    for (const r of m.artifacts.test_runs) {
      lines.push(`    - { ts: ${r.ts}, pass: ${r.pass}, fail: ${r.fail} }`)
    }
  }
  lines.push('---')
  return lines.join('\n')
}

// ── Mission file CRUD ──────────────────────────────────────────────

export function parseMissionFile(content: string): Mission {
  const { fields, body } = parseFrontmatter(content)

  const required = ['id', 'project_id', 'origin', 'title', 'status', 'created_at', 'updated_at']
  for (const k of required) {
    if (!fields[k]) throw new Error(`mission: missing required field "${k}"`)
  }

  const validStatuses: MissionStatus[] = ['proposed', 'accepted', 'active', 'blocked', 'review', 'done', 'cancelled']
  if (!validStatuses.includes(fields.status as MissionStatus)) {
    throw new Error(`mission: invalid status "${String(fields.status)}"`)
  }
  if (fields.origin !== 'yu' && fields.origin !== 'love') {
    throw new Error(`mission: invalid origin "${String(fields.origin)}"`)
  }

  // Parse the body for sections — # Intent, # Rationale (optional), # Decomposition (optional)
  const intent = extractSection(body, 'Intent') ?? ''
  const rationale = extractSection(body, 'Rationale')
  const decomposition = extractSection(body, 'Decomposition')

  const artifacts = (fields.artifacts as MissionArtifacts) ?? { commits: [], files: [], test_runs: [] }

  const m: Mission = {
    id: String(fields.id),
    project_id: String(fields.project_id),
    origin: fields.origin as MissionOrigin,
    title: String(fields.title),
    intent: intent.trim(),
    status: fields.status as MissionStatus,
    created_at: String(fields.created_at),
    updated_at: String(fields.updated_at),
    artifacts,
  }
  if (rationale && rationale.trim()) m.rationale = rationale.trim()
  if (decomposition && decomposition.trim()) m.decomposition = decomposition.trim()
  return m
}

function extractSection(body: string, header: string): string | undefined {
  const re = new RegExp(`^# ${header}\\s*\\n([\\s\\S]*?)(?=\\n# |$)`, 'm')
  const m = body.match(re)
  return m?.[1]
}

export function writeMissionFile(m: Mission): string {
  const fm = serializeMissionFrontmatter(m)
  const sections: string[] = [`# Intent\n\n${m.intent}\n`]
  if (m.rationale) sections.push(`# Rationale\n\n${m.rationale}\n`)
  if (m.decomposition) sections.push(`# Decomposition\n\n${m.decomposition}\n`)
  return fm + '\n\n' + sections.join('\n')
}

export function readMission(projectId: string, missionId: string): Mission | null {
  const path = getMissionFilePath(projectId, missionId)
  if (!existsSync(path)) return null
  try {
    return parseMissionFile(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

export function writeMission(m: Mission): void {
  const dir = getMissionDir(m.project_id, m.id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(getMissionFilePath(m.project_id, m.id), writeMissionFile(m), 'utf-8')
}

export function listMissions(projectId: string, opts?: { status?: MissionStatus }): Mission[] {
  const missionsDir = join(resolveProjectsDir(), projectId, 'missions')
  if (!existsSync(missionsDir)) return []
  const entries = readdirSync(missionsDir)
  const out: Mission[] = []
  for (const id of entries) {
    const m = readMission(projectId, id)
    if (!m) continue
    if (opts?.status && m.status !== opts.status) continue
    out.push(m)
  }
  out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1)) // newest first
  return out
}

// ── Events ─────────────────────────────────────────────────────────

export function appendEvent(projectId: string, missionId: string, event: MissionEvent): void {
  const path = getEventsFilePath(projectId, missionId)
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, JSON.stringify(event) + '\n', 'utf-8')
}

export function readEvents(projectId: string, missionId: string): MissionEvent[] {
  const path = getEventsFilePath(projectId, missionId)
  if (!existsSync(path)) return []
  const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean)
  const out: MissionEvent[] = []
  for (const line of lines) {
    try { out.push(JSON.parse(line)) } catch { /* skip malformed */ }
  }
  return out
}

// ── State machine ──────────────────────────────────────────────────

const ALLOWED: Record<MissionStatus, Array<{ to: MissionStatus; by: 'yu' | 'love' | 'either' }>> = {
  proposed: [
    { to: 'accepted', by: 'either' },     // Yu-created → Yu accepts; Love-created → she auto-accepts
    { to: 'cancelled', by: 'yu' },
  ],
  accepted: [
    { to: 'active', by: 'either' },
    { to: 'cancelled', by: 'yu' },
  ],
  active: [
    { to: 'blocked', by: 'love' },
    { to: 'review', by: 'love' },
    { to: 'cancelled', by: 'yu' },
  ],
  blocked: [
    { to: 'active', by: 'either' },
    { to: 'cancelled', by: 'yu' },
  ],
  review: [
    { to: 'done', by: 'yu' },
    { to: 'active', by: 'yu' },           // "send back"
    { to: 'cancelled', by: 'yu' },
  ],
  done: [],
  cancelled: [],
}

export function transitionStatus(
  current: MissionStatus,
  next: MissionStatus,
  by: 'yu' | 'love',
): { ok: true } | { ok: false; reason: string } {
  const allowed = ALLOWED[current]
  for (const t of allowed) {
    if (t.to !== next) continue
    if (t.by === 'either' || t.by === by) return { ok: true }
  }
  return { ok: false, reason: `disallowed transition: ${current} → ${next} by ${by}` }
}
```

- [ ] **1.4 Run tests + typecheck**

```bash
bun test src/services/love/__tests__/mission.test.ts 2>&1 | tail -5
bun run typecheck 2>&1 | grep "src/services/love/" | grep -v "bun:test" | head
```

Expected: 21 tests pass; typecheck stays clean.

- [ ] **1.5 Commit**

```bash
git add src/services/love/mission.ts src/services/love/__tests__/mission.test.ts
git commit -m "feat(love/builder): mission module — types, file CRUD, lifecycle

- Mission type: id/project_id/origin/title/intent/rationale?/status/...
- parseMissionFile / writeMissionFile (markdown + YAML-ish frontmatter)
- readMission / writeMission / listMissions (file system backed)
- appendEvent / readEvents (events.jsonl per mission)
- transitionStatus state machine (state × actor → allowed?)
- 21 unit tests covering parse/write round-trip, all 9 transitions
  including Love-initiated path (proposed → accepted by 'love')

No HTTP yet. Storage rooted at TRUE_LOVE_PROJECTS_DIR
(default: ~/.true-love/projects/)."
```

---

## Task 2: Project registry module

**Files:**
- Create: `src/services/love/project-registry.ts`
- Create: `src/services/love/__tests__/project-registry.test.ts`

Pure logic for project registration: list, register, get, archive, channel-path resolution. No HTTP.

- [ ] **2.1 Write the failing test**

Create `src/services/love/__tests__/project-registry.test.ts`:

```typescript
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  listProjects,
  readProject,
  registerProject,
  archiveProject,
  getProjectChannels,
  getProjectThoughts,
  type Project,
} from '../project-registry.js'

describe('project-registry', () => {
  let tmpProjects: string
  let tmpRoot: string
  const ORIG = process.env.TRUE_LOVE_PROJECTS_DIR

  beforeEach(() => {
    tmpProjects = mkdtempSync(join(tmpdir(), 'tl-projreg-'))
    tmpRoot = mkdtempSync(join(tmpdir(), 'tl-rootcheck-'))
    process.env.TRUE_LOVE_PROJECTS_DIR = tmpProjects
  })

  afterEach(() => {
    rmSync(tmpProjects, { recursive: true, force: true })
    rmSync(tmpRoot, { recursive: true, force: true })
    if (ORIG === undefined) delete process.env.TRUE_LOVE_PROJECTS_DIR
    else process.env.TRUE_LOVE_PROJECTS_DIR = ORIG
  })

  test('listProjects returns [] when registry dir missing', () => {
    rmSync(tmpProjects, { recursive: true, force: true })
    assert.deepEqual(listProjects(), [])
  })

  test('listProjects returns [] when registry dir empty', () => {
    assert.deepEqual(listProjects(), [])
  })

  test('registerProject creates project.json and returns the record', () => {
    const p = registerProject({ id: 'true-love', name: 'true-love', root: tmpRoot, instance: 'alpha' })
    assert.equal(p.id, 'true-love')
    assert.equal(p.state, 'active')
    assert.ok(p.created_at)
    assert.ok(existsSync(join(tmpProjects, 'true-love', 'project.json')))
  })

  test('registerProject rejects when root does not exist', () => {
    assert.throws(
      () => registerProject({ id: 'x', name: 'x', root: '/nonexistent/path', instance: 'alpha' }),
      /root.*not found/i,
    )
  })

  test('registerProject rejects invalid id (not slug-safe)', () => {
    assert.throws(
      () => registerProject({ id: 'has space', name: 'x', root: tmpRoot, instance: 'alpha' }),
      /slug/i,
    )
  })

  test('registerProject rejects duplicate id', () => {
    registerProject({ id: 'p1', name: 'p1', root: tmpRoot, instance: 'alpha' })
    assert.throws(
      () => registerProject({ id: 'p1', name: 'p1', root: tmpRoot, instance: 'alpha' }),
      /already exists/i,
    )
  })

  test('listProjects returns registered projects', () => {
    registerProject({ id: 'a', name: 'a', root: tmpRoot, instance: 'alpha' })
    registerProject({ id: 'b', name: 'b', root: tmpRoot, instance: 'beta' })
    const all = listProjects()
    assert.equal(all.length, 2)
  })

  test('readProject returns null for missing', () => {
    assert.equal(readProject('nope'), null)
  })

  test('archiveProject flips state to archived', () => {
    registerProject({ id: 'p', name: 'p', root: tmpRoot, instance: 'alpha' })
    archiveProject('p')
    const p = readProject('p')
    assert.equal(p?.state, 'archived')
  })

  test('getProjectChannels returns paths under projects/<id>/', () => {
    registerProject({ id: 'p', name: 'p', root: tmpRoot, instance: 'alpha' })
    const ch = getProjectChannels('p')
    assert.match(ch.fromYu, /\/p\/from-yu\.md$/)
    assert.match(ch.fromAi, /\/p\/from-ai\.md$/)
  })

  test('getProjectThoughts returns thoughts.md path', () => {
    registerProject({ id: 'p', name: 'p', root: tmpRoot, instance: 'alpha' })
    assert.match(getProjectThoughts('p'), /\/p\/thoughts\.md$/)
  })
})
```

- [ ] **2.2 Run to verify failure**

```bash
bun test src/services/love/__tests__/project-registry.test.ts 2>&1 | tail -5
```

Expected: tests fail with module-not-found.

- [ ] **2.3 Implement `src/services/love/project-registry.ts`**

```typescript
// project-registry.ts — Project registration and lookup for builder mode.
//
// A project is a workspace builder mode knows about. Stored as
// project.json under ~/.true-love/projects/<id>/. The directory's
// existence implies the project is registered; archival flips a flag
// in the JSON without removing the directory.

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface Project {
  id: string
  name: string
  root: string
  codeberg_url?: string
  instance: 'alpha' | 'beta' | 'gamma'
  state: 'active' | 'archived'
  created_at: string
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/

function resolveProjectsDir(): string {
  return process.env.TRUE_LOVE_PROJECTS_DIR ||
    join(process.env.HOME || homedir(), '.true-love', 'projects')
}

function getProjectDir(id: string): string {
  return join(resolveProjectsDir(), id)
}

function getProjectJsonPath(id: string): string {
  return join(getProjectDir(id), 'project.json')
}

export function listProjects(): Project[] {
  const dir = resolveProjectsDir()
  if (!existsSync(dir)) return []
  const entries = readdirSync(dir)
  const out: Project[] = []
  for (const id of entries) {
    const p = readProject(id)
    if (p) out.push(p)
  }
  out.sort((a, b) => (a.id < b.id ? -1 : 1))
  return out
}

export function readProject(id: string): Project | null {
  const path = getProjectJsonPath(id)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Project
  } catch {
    return null
  }
}

export function registerProject(input: {
  id: string
  name: string
  root: string
  instance: 'alpha' | 'beta' | 'gamma'
  codeberg_url?: string
}): Project {
  if (!SLUG_RE.test(input.id)) {
    throw new Error(`project: id must be slug (lowercase, alnum, dashes): "${input.id}"`)
  }
  if (!existsSync(input.root)) {
    throw new Error(`project: root not found: "${input.root}"`)
  }
  if (existsSync(getProjectJsonPath(input.id))) {
    throw new Error(`project: id already exists: "${input.id}"`)
  }
  const project: Project = {
    id: input.id,
    name: input.name,
    root: input.root,
    instance: input.instance,
    state: 'active',
    created_at: new Date().toISOString(),
    ...(input.codeberg_url ? { codeberg_url: input.codeberg_url } : {}),
  }
  mkdirSync(getProjectDir(input.id), { recursive: true })
  writeFileSync(getProjectJsonPath(input.id), JSON.stringify(project, null, 2), 'utf-8')
  // Pre-create the per-project channel files (empty) and missions/ subdir
  const channels = getProjectChannels(input.id)
  if (!existsSync(channels.fromYu)) writeFileSync(channels.fromYu, '', 'utf-8')
  if (!existsSync(channels.fromAi)) writeFileSync(channels.fromAi, '', 'utf-8')
  mkdirSync(join(getProjectDir(input.id), 'missions'), { recursive: true })
  return project
}

export function archiveProject(id: string): void {
  const p = readProject(id)
  if (!p) throw new Error(`project: not found: "${id}"`)
  const next: Project = { ...p, state: 'archived' }
  writeFileSync(getProjectJsonPath(id), JSON.stringify(next, null, 2), 'utf-8')
}

export function getProjectChannels(id: string): { fromYu: string; fromAi: string } {
  const dir = getProjectDir(id)
  return {
    fromYu: join(dir, 'from-yu.md'),
    fromAi: join(dir, 'from-ai.md'),
  }
}

export function getProjectThoughts(id: string): string {
  return join(getProjectDir(id), 'thoughts.md')
}
```

- [ ] **2.4 Run tests + typecheck**

```bash
bun test src/services/love/__tests__/project-registry.test.ts 2>&1 | tail -5
bun run typecheck 2>&1 | grep "src/services/love/" | grep -v "bun:test" | head
```

Expected: 11 tests pass; typecheck stays clean.

- [ ] **2.5 Commit**

```bash
git add src/services/love/project-registry.ts src/services/love/__tests__/project-registry.test.ts
git commit -m "feat(love/builder): project-registry module

- Project type: id/name/root/codeberg_url?/instance/state/created_at
- listProjects / readProject / registerProject / archiveProject
- getProjectChannels (per-project from-yu.md / from-ai.md paths)
- getProjectThoughts (per-project thoughts.md path)
- Validation: id must be slug-safe; root must exist; no duplicates
- Pre-creates empty channel files + missions/ subdir on register
- 11 unit tests"
```

---

## Task 3: Thoughts channel module

**Files:**
- Create: `src/services/love/thoughts-channel.ts`
- Create: `src/services/love/__tests__/thoughts-channel.test.ts`

Per-project live narration. Append-only, with daily-or-on-demand rotation to `thoughts-archive/<date>.md`.

- [ ] **3.1 Write the failing test**

Create `src/services/love/__tests__/thoughts-channel.test.ts`:

```typescript
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendThought,
  tailThoughts,
  rotateThoughts,
  type Thought,
} from '../thoughts-channel.js'

describe('thoughts-channel', () => {
  let tmpProjects: string
  const ORIG = process.env.TRUE_LOVE_PROJECTS_DIR

  beforeEach(() => {
    tmpProjects = mkdtempSync(join(tmpdir(), 'tl-thoughts-'))
    process.env.TRUE_LOVE_PROJECTS_DIR = tmpProjects
    mkdirSync(join(tmpProjects, 'p'), { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpProjects, { recursive: true, force: true })
    if (ORIG === undefined) delete process.env.TRUE_LOVE_PROJECTS_DIR
    else process.env.TRUE_LOVE_PROJECTS_DIR = ORIG
  })

  test('tailThoughts on missing file returns []', () => {
    assert.deepEqual(tailThoughts('p'), [])
  })

  test('appendThought + tailThoughts round-trip', () => {
    appendThought('p', 'starting work')
    appendThought('p', 'reading the spec')
    const thoughts = tailThoughts('p')
    assert.equal(thoughts.length, 2)
    assert.equal(thoughts[0]!.text, 'starting work')
    assert.equal(thoughts[1]!.text, 'reading the spec')
    assert.match(thoughts[0]!.ts, /^\d{4}-\d{2}-\d{2}T/)
  })

  test('tailThoughts limit respected', () => {
    for (let i = 0; i < 10; i++) appendThought('p', `t${i}`)
    const last3 = tailThoughts('p', { limit: 3 })
    assert.equal(last3.length, 3)
    assert.equal(last3[0]!.text, 't7')
    assert.equal(last3[2]!.text, 't9')
  })

  test('tailThoughts since filter (exclusive)', () => {
    appendThought('p', 'first')
    const cutoff = new Date().toISOString()
    // Wait a tick to make sure subsequent thoughts have a strictly later ts.
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    return sleep(5).then(() => {
      appendThought('p', 'second')
      const after = tailThoughts('p', { since: cutoff })
      // Exclusive filter: 'first' is at-or-before cutoff; 'second' is after.
      assert.equal(after.length, 1)
      assert.equal(after[0]!.text, 'second')
    })
  })

  test('appendThought trims whitespace and skips empty', () => {
    appendThought('p', '  hello  ')
    appendThought('p', '')
    appendThought('p', '   ')
    const t = tailThoughts('p')
    assert.equal(t.length, 1)
    assert.equal(t[0]!.text, 'hello')
  })

  test('rotateThoughts archives current thoughts.md and starts fresh', () => {
    appendThought('p', 'before rotation')
    rotateThoughts('p')
    assert.deepEqual(tailThoughts('p'), [])
    const archiveDir = join(tmpProjects, 'p', 'thoughts-archive')
    assert.ok(existsSync(archiveDir))
    const files = readdirSync(archiveDir)
    assert.equal(files.length, 1)
    assert.match(files[0]!, /^\d{4}-\d{2}-\d{2}/)
  })

  test('rotateThoughts on empty thoughts.md is a no-op', () => {
    rotateThoughts('p')
    const archiveDir = join(tmpProjects, 'p', 'thoughts-archive')
    if (existsSync(archiveDir)) {
      assert.equal(readdirSync(archiveDir).length, 0)
    }
  })
})
```

- [ ] **3.2 Run to verify failure**

```bash
bun test src/services/love/__tests__/thoughts-channel.test.ts 2>&1 | tail -5
```

Expected: tests fail with module-not-found.

- [ ] **3.3 Implement `src/services/love/thoughts-channel.ts`**

```typescript
// thoughts-channel.ts — Love's mid-tick narration, per project.
//
// She appends short stream-of-consciousness lines as she works.
// The /build UI tails them via SSE. Lines are timestamped on append.
// Rotation: rename thoughts.md to thoughts-archive/<YYYY-MM-DD>.md
// (called daily by a cron, or on mission completion).

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, renameSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface Thought {
  ts: string
  text: string
}

function resolveProjectsDir(): string {
  return process.env.TRUE_LOVE_PROJECTS_DIR ||
    join(process.env.HOME || homedir(), '.true-love', 'projects')
}

function getThoughtsPath(projectId: string): string {
  return join(resolveProjectsDir(), projectId, 'thoughts.md')
}

function getArchiveDir(projectId: string): string {
  return join(resolveProjectsDir(), projectId, 'thoughts-archive')
}

export function appendThought(projectId: string, text: string): void {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return
  const path = getThoughtsPath(projectId)
  mkdirSync(join(resolveProjectsDir(), projectId), { recursive: true })
  const ts = new Date().toISOString()
  const line = `[${ts}] ${trimmed}\n`
  appendFileSync(path, line, 'utf-8')
}

export function tailThoughts(
  projectId: string,
  opts?: { since?: string; limit?: number },
): Thought[] {
  const path = getThoughtsPath(projectId)
  if (!existsSync(path)) return []
  const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean)
  const all: Thought[] = []
  for (const line of lines) {
    const m = line.match(/^\[([^\]]+)\]\s*(.*)$/)
    if (!m) continue
    all.push({ ts: m[1]!, text: m[2]! })
  }
  let filtered = all
  if (opts?.since) {
    const since = opts.since
    filtered = all.filter((t) => t.ts > since)
  }
  if (opts?.limit !== undefined && filtered.length > opts.limit) {
    filtered = filtered.slice(filtered.length - opts.limit)
  }
  return filtered
}

export function rotateThoughts(projectId: string): void {
  const src = getThoughtsPath(projectId)
  if (!existsSync(src)) return
  // No-op if file is empty
  if (statSync(src).size === 0) return
  const archiveDir = getArchiveDir(projectId)
  mkdirSync(archiveDir, { recursive: true })
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  let dest = join(archiveDir, `${today}.md`)
  let n = 2
  while (existsSync(dest)) {
    dest = join(archiveDir, `${today}-${n}.md`)
    n++
  }
  renameSync(src, dest)
  // Touch a fresh empty file so subsequent appends start clean
  writeFileSync(src, '', 'utf-8')
}
```

- [ ] **3.4 Run tests + typecheck**

```bash
bun test src/services/love/__tests__/thoughts-channel.test.ts 2>&1 | tail -5
bun run typecheck 2>&1 | grep "src/services/love/" | grep -v "bun:test" | head
```

Expected: 7 tests pass; typecheck stays clean.

- [ ] **3.5 Commit**

```bash
git add src/services/love/thoughts-channel.ts src/services/love/__tests__/thoughts-channel.test.ts
git commit -m "feat(love/builder): thoughts-channel module

- Thought type: { ts, text }
- appendThought (skips empty, trims, ISO-stamps each line)
- tailThoughts (since/limit filtering)
- rotateThoughts (mv to thoughts-archive/<YYYY-MM-DD>.md, touch fresh)
- 7 unit tests including missing file, limit, since, rotation"
```

---

## Task 4: HTTP API — projects + thoughts endpoints

**Files:**
- Modify: `src/services/love/ui-server.ts`
- Modify: `src/services/love/__tests__/ui-server.test.ts`

Add the project + thoughts surface. Mission endpoints land in Task 5; SSE in Task 6.

- [ ] **4.1 Append HTTP integration tests**

Append the following describe block to `src/services/love/__tests__/ui-server.test.ts` (after the existing `ui-server — HTTP` block):

```typescript
import type { Project } from '../project-registry.js'
import type { Thought } from '../thoughts-channel.js'

describe('ui-server — /api/projects', () => {
  let tmpHome: string
  let server: ReturnType<typeof startUiServer>
  let port: number
  let projectRoot: string
  const ORIG_HOME = process.env.HOME
  const ORIG_PROJ_DIR = process.env.TRUE_LOVE_PROJECTS_DIR

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-projapi-'))
    projectRoot = mkdtempSync(join(tmpdir(), 'tl-projroot-'))
    process.env.HOME = tmpHome
    process.env.TRUE_LOVE_PROJECTS_DIR = join(tmpHome, '.true-love', 'projects')
    process.env.TRUE_LOVE_DISABLE_SOUL = '1'
    server = startUiServer({ port: 0 })
    port = (server.address() as { port: number }).port
  })

  afterEach(() => {
    server.close()
    rmSync(tmpHome, { recursive: true, force: true })
    rmSync(projectRoot, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_PROJ_DIR === undefined) delete process.env.TRUE_LOVE_PROJECTS_DIR
    else process.env.TRUE_LOVE_PROJECTS_DIR = ORIG_PROJ_DIR
    delete process.env.TRUE_LOVE_DISABLE_SOUL
  })

  test('GET /api/projects returns [] when none registered', async () => {
    const res = await fetch(`http://localhost:${port}/api/projects`)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), [])
  })

  test('POST /api/projects registers and returns the project', async () => {
    const res = await fetch(`http://localhost:${port}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'p1', name: 'p1', root: projectRoot, instance: 'alpha' }),
    })
    assert.equal(res.status, 201)
    const body = (await res.json()) as Project
    assert.equal(body.id, 'p1')
    assert.equal(body.state, 'active')
  })

  test('POST /api/projects with bad slug returns 400', async () => {
    const res = await fetch(`http://localhost:${port}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'bad slug', name: 'x', root: projectRoot, instance: 'alpha' }),
    })
    assert.equal(res.status, 400)
  })

  test('POST /api/projects with missing root returns 400', async () => {
    const res = await fetch(`http://localhost:${port}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'p', name: 'x', root: '/no/such/dir', instance: 'alpha' }),
    })
    assert.equal(res.status, 400)
  })

  test('GET /api/projects/:id returns the project', async () => {
    await fetch(`http://localhost:${port}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'p1', name: 'p1', root: projectRoot, instance: 'alpha' }),
    })
    const res = await fetch(`http://localhost:${port}/api/projects/p1`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as Project
    assert.equal(body.id, 'p1')
  })

  test('GET /api/projects/:id returns 404 for missing', async () => {
    const res = await fetch(`http://localhost:${port}/api/projects/nope`)
    assert.equal(res.status, 404)
  })
})

describe('ui-server — per-project channels', () => {
  let tmpHome: string
  let server: ReturnType<typeof startUiServer>
  let port: number
  let projectRoot: string
  const ORIG_HOME = process.env.HOME
  const ORIG_PROJ_DIR = process.env.TRUE_LOVE_PROJECTS_DIR

  beforeEach(async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-pchan-'))
    projectRoot = mkdtempSync(join(tmpdir(), 'tl-pchanroot-'))
    process.env.HOME = tmpHome
    process.env.TRUE_LOVE_PROJECTS_DIR = join(tmpHome, '.true-love', 'projects')
    process.env.TRUE_LOVE_DISABLE_SOUL = '1'
    server = startUiServer({ port: 0 })
    port = (server.address() as { port: number }).port
    await fetch(`http://localhost:${port}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'p1', name: 'p1', root: projectRoot, instance: 'alpha' }),
    })
  })

  afterEach(() => {
    server.close()
    rmSync(tmpHome, { recursive: true, force: true })
    rmSync(projectRoot, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_PROJ_DIR === undefined) delete process.env.TRUE_LOVE_PROJECTS_DIR
    else process.env.TRUE_LOVE_PROJECTS_DIR = ORIG_PROJ_DIR
    delete process.env.TRUE_LOVE_DISABLE_SOUL
  })

  test('POST /api/projects/:id/say appends to per-project from-yu.md', async () => {
    const res = await fetch(`http://localhost:${port}/api/projects/p1/say`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello on p1' }),
    })
    assert.equal(res.status, 200)
    const channelPath = join(process.env.TRUE_LOVE_PROJECTS_DIR!, 'p1', 'from-yu.md')
    const content = readFileSync(channelPath, 'utf-8')
    assert.match(content, /hello on p1/)
  })

  test('GET /api/projects/:id/messages returns interleaved per-project conversation', async () => {
    await fetch(`http://localhost:${port}/api/projects/p1/say`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'first' }),
    })
    const res = await fetch(`http://localhost:${port}/api/projects/p1/messages`)
    assert.equal(res.status, 200)
    const msgs = (await res.json()) as { source: string; body: string }[]
    assert.equal(msgs.length, 1)
    assert.equal(msgs[0]!.source, 'yu')
    assert.equal(msgs[0]!.body, 'first')
  })

  test('GET /api/projects/:id/thoughts returns empty when none', async () => {
    const res = await fetch(`http://localhost:${port}/api/projects/p1/thoughts`)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), [])
  })

  test('GET /api/projects/:id/thoughts honors limit', async () => {
    const thoughtsPath = join(process.env.TRUE_LOVE_PROJECTS_DIR!, 'p1', 'thoughts.md')
    const lines: string[] = []
    for (let i = 0; i < 5; i++) {
      lines.push(`[2026-04-26T08:00:0${i}.000Z] thought ${i}`)
    }
    writeFileSync(thoughtsPath, lines.join('\n') + '\n', 'utf-8')
    const res = await fetch(`http://localhost:${port}/api/projects/p1/thoughts?limit=2`)
    const body = (await res.json()) as Thought[]
    assert.equal(body.length, 2)
    assert.equal(body[1]!.text, 'thought 4')
  })
})
```

- [ ] **4.2 Run to verify failure**

```bash
bun test src/services/love/__tests__/ui-server.test.ts 2>&1 | tail -5
```

Expected: 10 new tests fail (no project handlers yet).

- [ ] **4.3 Implement endpoints in `src/services/love/ui-server.ts`**

Step 4.3a — extend imports at the top of `ui-server.ts`:

```typescript
import {
  listProjects,
  readProject,
  registerProject,
  getProjectChannels,
  getProjectThoughts,
  type Project,
} from './project-registry.js'
import {
  tailThoughts,
  type Thought,
} from './thoughts-channel.js'
```

Step 4.3b — add path-aware variant of `parseChannelFile` aware of per-project paths. Add a helper near the existing `appendYuMessage`:

```typescript
/**
 * Per-project equivalent of appendYuMessage. Appends to the project's
 * from-yu.md channel rather than the global one. Same canonical format.
 */
export function appendYuMessageToProject(projectId: string, text: string): string {
  const trimmed = (text ?? '').trim()
  if (!trimmed) throw new Error('empty message — cannot append')
  const channels = getProjectChannels(projectId)
  mkdirSync(dirname(channels.fromYu), { recursive: true })
  const ts = new Date().toISOString()
  const entry = `## ${ts} [from yu]\n\n${trimmed}\n\n---\n\n`
  appendFileSync(channels.fromYu, entry, 'utf-8')
  return ts
}

/**
 * Per-project equivalent of readConversation.
 */
export function readProjectConversation(
  projectId: string,
  opts?: { since?: string },
): ChannelMessage[] {
  const channels = getProjectChannels(projectId)
  const all: ChannelMessage[] = []
  if (existsSync(channels.fromYu)) {
    try { all.push(...parseChannelFile(readFileSync(channels.fromYu, 'utf-8'), 'yu')) } catch {}
  }
  if (existsSync(channels.fromAi)) {
    try { all.push(...parseChannelFile(readFileSync(channels.fromAi, 'utf-8'), 'ai')) } catch {}
  }
  all.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
  if (opts?.since) {
    const since = opts.since
    return all.filter((m) => m.ts > since)
  }
  return all
}
```

Step 4.3c — add route arms to the dispatcher inside `startUiServer`. Locate the existing route block and add these BEFORE the 404 fallback:

```typescript
      if (req.method === 'GET' && path === '/api/projects') return handleListProjects(req, res)
      if (req.method === 'POST' && path === '/api/projects') return await handleCreateProject(req, res)
      const projMatch = path.match(/^\/api\/projects\/([^/]+)(\/.*)?$/)
      if (projMatch) {
        const projectId = projMatch[1]!
        const sub = projMatch[2] ?? ''
        if (req.method === 'GET' && sub === '') return handleGetProject(req, res, projectId)
        if (req.method === 'GET' && sub === '/messages') return handleProjectMessages(req, res, projectId)
        if (req.method === 'POST' && sub === '/say') return await handleProjectSay(req, res, projectId)
        if (req.method === 'GET' && sub === '/thoughts') return handleProjectThoughts(req, res, projectId)
      }
```

Step 4.3d — add the handler functions at the bottom of `ui-server.ts` (after the existing handlers):

```typescript
function handleListProjects(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(listProjects()))
}

async function handleCreateProject(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 8192) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'request body too large' }))
      return
    }
  }
  let parsed: { id?: string; name?: string; root?: string; instance?: string; codeberg_url?: string }
  try { parsed = JSON.parse(body) } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid JSON' }))
    return
  }
  const validInstances = ['alpha', 'beta', 'gamma'] as const
  if (!parsed.id || !parsed.name || !parsed.root ||
      !parsed.instance || !validInstances.includes(parsed.instance as typeof validInstances[number])) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'missing required field (id, name, root, instance)' }))
    return
  }
  try {
    const p = registerProject({
      id: parsed.id,
      name: parsed.name,
      root: parsed.root,
      instance: parsed.instance as 'alpha' | 'beta' | 'gamma',
      ...(parsed.codeberg_url ? { codeberg_url: parsed.codeberg_url } : {}),
    })
    res.writeHead(201, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(p))
  } catch (err: any) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: err?.message ?? 'register failed' }))
  }
}

function handleGetProject(_req: IncomingMessage, res: ServerResponse, projectId: string): void {
  const p = readProject(projectId)
  if (!p) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'project not found' }))
    return
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(p))
}

function handleProjectMessages(req: IncomingMessage, res: ServerResponse, projectId: string): void {
  if (!readProject(projectId)) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'project not found' }))
    return
  }
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const since = url.searchParams.get('since') ?? undefined
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(readProjectConversation(projectId, { since })))
}

async function handleProjectSay(req: IncomingMessage, res: ServerResponse, projectId: string): Promise<void> {
  if (!readProject(projectId)) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'project not found' }))
    return
  }
  let body = ''
  const BODY_LIMIT = MAX_COMPOSE_CHARS + 1024
  for await (const chunk of req) {
    body += chunk
    if (body.length > BODY_LIMIT) {
      req.resume()
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'message too large' }))
      return
    }
  }
  let parsed: { text?: string; wake?: boolean }
  try { parsed = JSON.parse(body) } catch {
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
  let ts: string
  try { ts = appendYuMessageToProject(projectId, text) }
  catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: err?.message ?? 'write failed' }))
    return
  }
  let heartbeatPid: number | undefined
  if (parsed.wake) {
    try { heartbeatPid = fireHeartbeat({ reason: 'manual' }).pid } catch {}
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    ok: true,
    messageTs: ts,
    ...(heartbeatPid !== undefined ? { heartbeatPid } : {}),
  }))
}

function handleProjectThoughts(req: IncomingMessage, res: ServerResponse, projectId: string): void {
  if (!readProject(projectId)) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'project not found' }))
    return
  }
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const since = url.searchParams.get('since') ?? undefined
  const limitStr = url.searchParams.get('limit')
  const limit = limitStr ? Math.max(1, Math.min(1000, parseInt(limitStr, 10))) : undefined
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(tailThoughts(projectId, { since, limit })))
}
```

- [ ] **4.4 Run tests + typecheck**

```bash
bun test src/services/love/__tests__/ui-server.test.ts 2>&1 | tail -5
bun run typecheck 2>&1 | grep "src/services/love/" | grep -v "bun:test" | head
```

Expected: 27 (existing) + 10 (new) = 37 tests pass; typecheck clean.

- [ ] **4.5 Commit**

```bash
git add src/services/love/ui-server.ts src/services/love/__tests__/ui-server.test.ts
git commit -m "feat(love/builder): HTTP API — projects + per-project channels + thoughts

- GET /api/projects, POST /api/projects (validates id/root/instance),
  GET /api/projects/:id (404 on miss)
- GET /api/projects/:id/messages, POST .../say (per-project channels;
  reuses canonical message format)
- GET /api/projects/:id/thoughts (since/limit)
- New helpers: appendYuMessageToProject, readProjectConversation
- 10 new HTTP integration tests; 37 total ui-server tests"
```

---

## Task 5: HTTP API — missions endpoints

**Files:**
- Modify: `src/services/love/ui-server.ts`
- Modify: `src/services/love/__tests__/ui-server.test.ts`

Add `/api/projects/:id/missions` (list/create) and `/api/missions/:mid/*` (detail, status transition, events, start). The `start` endpoint validates the project lock but *defers* the actual Love spawn to Task 7's CLI — this task wires the validation and 409 contract.

- [ ] **5.1 Append mission HTTP integration tests**

Append the following to `src/services/love/__tests__/ui-server.test.ts`:

```typescript
import type { Mission } from '../mission.js'

describe('ui-server — /api/missions', () => {
  let tmpHome: string
  let server: ReturnType<typeof startUiServer>
  let port: number
  let projectRoot: string
  const ORIG_HOME = process.env.HOME
  const ORIG_PROJ_DIR = process.env.TRUE_LOVE_PROJECTS_DIR

  beforeEach(async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-missapi-'))
    projectRoot = mkdtempSync(join(tmpdir(), 'tl-missroot-'))
    process.env.HOME = tmpHome
    process.env.TRUE_LOVE_PROJECTS_DIR = join(tmpHome, '.true-love', 'projects')
    process.env.TRUE_LOVE_DISABLE_SOUL = '1'
    server = startUiServer({ port: 0 })
    port = (server.address() as { port: number }).port
    await fetch(`http://localhost:${port}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'p1', name: 'p1', root: projectRoot, instance: 'alpha' }),
    })
  })

  afterEach(() => {
    server.close()
    rmSync(tmpHome, { recursive: true, force: true })
    rmSync(projectRoot, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_PROJ_DIR === undefined) delete process.env.TRUE_LOVE_PROJECTS_DIR
    else process.env.TRUE_LOVE_PROJECTS_DIR = ORIG_PROJ_DIR
    delete process.env.TRUE_LOVE_DISABLE_SOUL
  })

  test('GET /api/projects/:id/missions returns []', async () => {
    const res = await fetch(`http://localhost:${port}/api/projects/p1/missions`)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), [])
  })

  test('POST /api/projects/:id/missions creates a proposed Yu-mission', async () => {
    const res = await fetch(`http://localhost:${port}/api/projects/p1/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test', intent: 'Build the thing.' }),
    })
    assert.equal(res.status, 201)
    const m = (await res.json()) as Mission
    assert.equal(m.status, 'proposed')
    assert.equal(m.origin, 'yu')
    assert.equal(m.title, 'Test')
    assert.match(m.id, /^\d{4}-\d{2}-\d{2}-/)
  })

  test('POST .../missions with empty intent returns 400', async () => {
    const res = await fetch(`http://localhost:${port}/api/projects/p1/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x', intent: '' }),
    })
    assert.equal(res.status, 400)
  })

  test('GET /api/missions/:mid returns detail', async () => {
    const created = await fetch(`http://localhost:${port}/api/projects/p1/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'X', intent: 'Y' }),
    }).then(r => r.json() as Promise<Mission>)

    const res = await fetch(`http://localhost:${port}/api/missions/${created.id}?project=p1`)
    assert.equal(res.status, 200)
    const m = (await res.json()) as Mission
    assert.equal(m.id, created.id)
  })

  test('GET /api/missions/:mid returns 404 when project query missing', async () => {
    const res = await fetch(`http://localhost:${port}/api/missions/nope`)
    assert.equal(res.status, 400)
  })

  test('PATCH .../missions/:mid/status proposed → accepted by yu', async () => {
    const created = await fetch(`http://localhost:${port}/api/projects/p1/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'X', intent: 'Y' }),
    }).then(r => r.json() as Promise<Mission>)
    const res = await fetch(`http://localhost:${port}/api/missions/${created.id}/status?project=p1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'accepted', by: 'yu' }),
    })
    assert.equal(res.status, 200)
    const m = (await res.json()) as Mission
    assert.equal(m.status, 'accepted')
  })

  test('PATCH .../status with invalid transition returns 409', async () => {
    const created = await fetch(`http://localhost:${port}/api/projects/p1/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'X', intent: 'Y' }),
    }).then(r => r.json() as Promise<Mission>)
    const res = await fetch(`http://localhost:${port}/api/missions/${created.id}/status?project=p1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'review', by: 'yu' }), // proposed → review is illegal
    })
    assert.equal(res.status, 409)
  })

  test('GET .../missions/:mid/events returns timeline', async () => {
    const created = await fetch(`http://localhost:${port}/api/projects/p1/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'X', intent: 'Y' }),
    }).then(r => r.json() as Promise<Mission>)
    const res = await fetch(`http://localhost:${port}/api/missions/${created.id}/events?project=p1`)
    assert.equal(res.status, 200)
    const events = (await res.json()) as Array<{ type: string }>
    // After POST .../missions, server should have written a 'created' event
    assert.ok(events.some(e => e.type === 'created'))
  })

  test('POST .../start when no other active mission returns 200 (smoke — no spawn)', async () => {
    const created = await fetch(`http://localhost:${port}/api/projects/p1/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'X', intent: 'Y' }),
    }).then(r => r.json() as Promise<Mission>)
    // Move to accepted first
    await fetch(`http://localhost:${port}/api/missions/${created.id}/status?project=p1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'accepted', by: 'yu' }),
    })
    const res = await fetch(`http://localhost:${port}/api/missions/${created.id}/start?project=p1&dry-run=1`, {
      method: 'POST',
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { ok: boolean; dryRun?: boolean }
    assert.equal(body.ok, true)
    assert.equal(body.dryRun, true)
  })
})
```

- [ ] **5.2 Run to verify failure**

```bash
bun test src/services/love/__tests__/ui-server.test.ts 2>&1 | tail -5
```

Expected: 9 new tests fail (no mission handlers).

- [ ] **5.3 Implement mission endpoints in `src/services/love/ui-server.ts`**

Step 5.3a — extend imports:

```typescript
import {
  parseMissionFile,
  writeMissionFile,
  readMission,
  writeMission,
  listMissions,
  appendEvent,
  readEvents,
  transitionStatus,
  type Mission,
  type MissionStatus,
} from './mission.js'
```

Step 5.3b — add a mission-id generator helper near the other helpers:

```typescript
/**
 * Generate a fresh mission ID. YYYY-MM-DD-<slug>, with -2/-3 suffix for
 * same-day collisions on the same project.
 */
function generateMissionId(projectId: string, title: string): string {
  const today = new Date().toISOString().slice(0, 10)
  const slug = title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'mission'
  let id = `${today}-${slug}`
  let n = 2
  while (readMission(projectId, id)) {
    id = `${today}-${slug}-${n}`
    n++
  }
  return id
}
```

Step 5.3c — add route arms inside `startUiServer`'s dispatcher, AFTER the project arms added in Task 4:

```typescript
      // Project-scoped mission routes
      if (projMatch) {
        const projectId = projMatch[1]!
        const sub = projMatch[2] ?? ''
        if (req.method === 'GET' && sub === '/missions') return handleListMissions(req, res, projectId)
        if (req.method === 'POST' && sub === '/missions') return await handleCreateMission(req, res, projectId)
      }

      // Bare mission routes (require ?project=... query)
      const missionMatch = path.match(/^\/api\/missions\/([^/]+)(\/.*)?$/)
      if (missionMatch) {
        const missionId = missionMatch[1]!
        const sub = missionMatch[2] ?? ''
        const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
        const projectId = url.searchParams.get('project') ?? ''
        if (!projectId) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'missing project query param' }))
          return
        }
        if (req.method === 'GET' && sub === '') return handleGetMission(req, res, projectId, missionId)
        if (req.method === 'PATCH' && sub === '/status') return await handleMissionStatus(req, res, projectId, missionId)
        if (req.method === 'GET' && sub === '/events') return handleMissionEvents(req, res, projectId, missionId)
        if (req.method === 'POST' && sub === '/start') return await handleMissionStart(req, res, projectId, missionId)
      }
```

**Note** — placement matters. The `projMatch` block from Task 4 already exists; the *additional* mission arms must go inside the same `if (projMatch)` block. The cleanest path is to extend the existing block rather than duplicating the regex match. Adjust accordingly during implementation.

Step 5.3d — add handlers at the bottom of `ui-server.ts`:

```typescript
function handleListMissions(req: IncomingMessage, res: ServerResponse, projectId: string): void {
  if (!readProject(projectId)) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'project not found' }))
    return
  }
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const status = url.searchParams.get('status') ?? undefined
  const ms = listMissions(projectId, status ? { status: status as MissionStatus } : undefined)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(ms))
}

async function handleCreateMission(req: IncomingMessage, res: ServerResponse, projectId: string): Promise<void> {
  if (!readProject(projectId)) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'project not found' }))
    return
  }
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 200_000) {
      req.resume()
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'request body too large' }))
      return
    }
  }
  let parsed: { title?: string; intent?: string; rationale?: string; origin?: 'yu' | 'love' }
  try { parsed = JSON.parse(body) } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid JSON' }))
    return
  }
  const title = (parsed.title ?? '').trim()
  const intent = (parsed.intent ?? '').trim()
  if (!title || !intent) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'title and intent are required' }))
    return
  }
  const origin = parsed.origin === 'love' ? 'love' : 'yu'
  const id = generateMissionId(projectId, title)
  const now = new Date().toISOString()
  const m: Mission = {
    id, project_id: projectId, origin, title, intent, status: 'proposed',
    created_at: now, updated_at: now,
    artifacts: { commits: [], files: [], test_runs: [] },
    ...(parsed.rationale ? { rationale: parsed.rationale.trim() } : {}),
  }
  writeMission(m)
  appendEvent(projectId, id, { ts: now, type: 'created', by: origin })
  res.writeHead(201, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(m))
}

function handleGetMission(_req: IncomingMessage, res: ServerResponse, projectId: string, missionId: string): void {
  const m = readMission(projectId, missionId)
  if (!m) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'mission not found' }))
    return
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(m))
}

async function handleMissionStatus(req: IncomingMessage, res: ServerResponse, projectId: string, missionId: string): Promise<void> {
  const m = readMission(projectId, missionId)
  if (!m) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'mission not found' }))
    return
  }
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 4096) {
      req.resume()
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'request body too large' }))
      return
    }
  }
  let parsed: { status?: MissionStatus; by?: 'yu' | 'love'; note?: string }
  try { parsed = JSON.parse(body) } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid JSON' }))
    return
  }
  if (!parsed.status) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'status required' }))
    return
  }
  const by = parsed.by === 'love' ? 'love' : 'yu'
  const t = transitionStatus(m.status, parsed.status, by)
  if (!t.ok) {
    res.writeHead(409, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: t.reason }))
    return
  }
  const now = new Date().toISOString()
  const updated: Mission = { ...m, status: parsed.status, updated_at: now }
  writeMission(updated)
  appendEvent(projectId, missionId, {
    ts: now,
    type: parsed.status === 'review' ? 'marked-review'
        : parsed.status === 'done' ? 'accepted-done'
        : parsed.status === 'cancelled' ? 'cancelled'
        : parsed.status === 'blocked' ? 'blocked'
        : parsed.status === 'active' && m.status === 'review' ? 'sent-back'
        : parsed.status === 'active' && m.status === 'blocked' ? 'resumed'
        : parsed.status === 'active' ? 'started'
        : 'accepted',
    by,
    ...(parsed.note ? { note: parsed.note } : {}),
  })
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(updated))
}

function handleMissionEvents(_req: IncomingMessage, res: ServerResponse, projectId: string, missionId: string): void {
  if (!readMission(projectId, missionId)) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'mission not found' }))
    return
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(readEvents(projectId, missionId)))
}

async function handleMissionStart(req: IncomingMessage, res: ServerResponse, projectId: string, missionId: string): Promise<void> {
  const m = readMission(projectId, missionId)
  if (!m) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'mission not found' }))
    return
  }
  if (m.status !== 'accepted' && m.status !== 'blocked') {
    res.writeHead(409, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: `cannot start mission in status "${m.status}"` }))
    return
  }
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const dryRun = url.searchParams.get('dry-run') === '1'
  if (dryRun) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, dryRun: true }))
    return
  }
  // Real spawn lands in Task 7. For now, return 501 if not dry-run.
  res.writeHead(501, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'mission start spawn not yet wired (use ?dry-run=1 or bin/mission.mjs)' }))
}
```

- [ ] **5.4 Run tests + typecheck**

```bash
bun test src/services/love/__tests__/ui-server.test.ts 2>&1 | tail -5
bun run typecheck 2>&1 | grep "src/services/love/" | grep -v "bun:test" | head
```

Expected: 37 + 9 = 46 tests pass; typecheck clean.

- [ ] **5.5 Commit**

```bash
git add src/services/love/ui-server.ts src/services/love/__tests__/ui-server.test.ts
git commit -m "feat(love/builder): HTTP API — missions

- GET /api/projects/:id/missions, POST .../missions (proposed Yu-mission)
- GET /api/missions/:mid, PATCH .../status (state machine validated, 409 on
  illegal transition), GET .../events
- POST .../start with dry-run support; real spawn deferred to Task 7
- generateMissionId: YYYY-MM-DD-<slug> with same-day collision suffix
- Server appends 'created' event on POST .../missions
- 9 new HTTP integration tests; 46 total ui-server tests"
```

---

## Task 6: SSE for /build + file watchers

**Files:**
- Modify: `src/services/love/ui-server.ts`
- Modify: `src/services/love/__tests__/ui-server.test.ts`

Add `/api/build/stream` SSE endpoint. Extend file watchers to broadcast `project-changed`, `mission-changed`, `thought-appended` events when files under `~/.true-love/projects/` change.

- [ ] **6.1 Append SSE integration tests**

Append to `src/services/love/__tests__/ui-server.test.ts`:

```typescript
describe('ui-server — /api/build/stream (SSE)', () => {
  let tmpHome: string
  let server: ReturnType<typeof startUiServer>
  let port: number
  let projectRoot: string
  const ORIG_HOME = process.env.HOME
  const ORIG_PROJ_DIR = process.env.TRUE_LOVE_PROJECTS_DIR

  beforeEach(async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-buildsse-'))
    projectRoot = mkdtempSync(join(tmpdir(), 'tl-bsroot-'))
    process.env.HOME = tmpHome
    process.env.TRUE_LOVE_PROJECTS_DIR = join(tmpHome, '.true-love', 'projects')
    process.env.TRUE_LOVE_DISABLE_SOUL = '1'
    server = startUiServer({ port: 0 })
    port = (server.address() as { port: number }).port
    await fetch(`http://localhost:${port}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'p1', name: 'p1', root: projectRoot, instance: 'alpha' }),
    })
  })

  afterEach(() => {
    server.close()
    rmSync(tmpHome, { recursive: true, force: true })
    rmSync(projectRoot, { recursive: true, force: true })
    process.env.HOME = ORIG_HOME ?? ''
    if (ORIG_PROJ_DIR === undefined) delete process.env.TRUE_LOVE_PROJECTS_DIR
    else process.env.TRUE_LOVE_PROJECTS_DIR = ORIG_PROJ_DIR
    delete process.env.TRUE_LOVE_DISABLE_SOUL
  })

  test('GET /api/build/stream opens with text/event-stream content-type', async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 200)
    try {
      const res = await fetch(`http://localhost:${port}/api/build/stream`, {
        signal: controller.signal,
      })
      assert.equal(res.status, 200)
      assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/)
    } catch (err: any) {
      if (err.name !== 'AbortError') throw err
    } finally {
      clearTimeout(timer)
    }
  })

  test('GET /api/build/stream sends initial : connected\\n\\n frame', async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 250)
    try {
      const res = await fetch(`http://localhost:${port}/api/build/stream`, {
        signal: controller.signal,
      })
      const reader = res.body!.getReader()
      const { value } = await reader.read()
      const text = new TextDecoder().decode(value)
      assert.match(text, /: connected/)
    } catch (err: any) {
      if (err.name !== 'AbortError') throw err
    } finally {
      clearTimeout(timer)
    }
  })
})
```

- [ ] **6.2 Run to verify failure**

```bash
bun test src/services/love/__tests__/ui-server.test.ts 2>&1 | tail -5
```

Expected: 2 new tests fail (no `/api/build/stream` route).

- [ ] **6.3 Implement SSE + watchers in `src/services/love/ui-server.ts`**

Step 6.3a — declare a second SSE client set inside `startUiServer`, alongside the existing `sseClients`:

```typescript
  const buildSseClients = new Set<ServerResponse>()
```

Step 6.3b — add the route arm inside the dispatcher, before the 404:

```typescript
      if (req.method === 'GET' && path === '/api/build/stream') return handleBuildStream(req, res, buildSseClients)
```

Step 6.3c — add the projects-tree watcher next to the existing channel watchers in `startUiServer`:

```typescript
  // Watch the entire projects tree for builder events.
  // We watch the projects/ directory recursively-shallow: register a watcher
  // for the projects root, and one per project subdirectory present at
  // boot. (New projects added at runtime: their dir is created by
  // registerProject — when files inside it change, the projects-root
  // watcher fires for the subdirectory itself; we then start watching
  // that subdirectory.)
  const projectsRoot = join(process.env.HOME || homedir(), '.true-love', 'projects')
  const altProjectsRoot = process.env.TRUE_LOVE_PROJECTS_DIR
  const rootDir = altProjectsRoot || projectsRoot

  let projectsBroadcastDebounce: ReturnType<typeof setTimeout> | null = null
  const broadcastBuild = (event: string, data: unknown) => {
    if (projectsBroadcastDebounce) clearTimeout(projectsBroadcastDebounce)
    projectsBroadcastDebounce = setTimeout(() => {
      broadcastSse(buildSseClients, event, JSON.stringify(data))
    }, 200)
  }

  try {
    if (existsSync(rootDir)) {
      // Recursive watch — fs.watch supports { recursive: true } on macOS.
      const w = watch(rootDir, { recursive: true }, (_event, filename) => {
        if (!filename) return
        const fname = String(filename)
        if (fname.endsWith('project.json')) {
          broadcastBuild('project-changed', { path: fname })
        } else if (fname.endsWith('mission.md') || fname.endsWith('events.jsonl')) {
          broadcastBuild('mission-changed', { path: fname })
        } else if (fname.endsWith('thoughts.md')) {
          broadcastBuild('thought-appended', { path: fname })
        }
      })
      watchers.push(w)
    }
  } catch {
    // best-effort
  }
```

Step 6.3d — extend the `close()` override to also end builder SSE clients (locate the existing `for (const c of sseClients) { try { c.end() } catch {} }` and add a parallel block for `buildSseClients`):

```typescript
    for (const c of sseClients) { try { c.end() } catch {} }
    sseClients.clear()
    for (const c of buildSseClients) { try { c.end() } catch {} }
    buildSseClients.clear()
```

Step 6.3e — extend the keepalive interval to also tick the build clients:

```typescript
  const keepaliveInterval = setInterval(() => {
    for (const client of sseClients) {
      try { client.write(': keepalive\n\n') } catch { sseClients.delete(client) }
    }
    for (const client of buildSseClients) {
      try { client.write(': keepalive\n\n') } catch { buildSseClients.delete(client) }
    }
  }, 30_000)
```

Step 6.3f — add the handler at the bottom of `ui-server.ts`:

```typescript
function handleBuildStream(req: IncomingMessage, res: ServerResponse, clients: Set<ServerResponse>): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })
  res.write(': connected\n\n')
  clients.add(res)
  req.on('close', () => { clients.delete(res) })
}
```

- [ ] **6.4 Run tests + typecheck**

```bash
bun test src/services/love/__tests__/ui-server.test.ts 2>&1 | tail -5
bun run typecheck 2>&1 | grep "src/services/love/" | grep -v "bun:test" | head
```

Expected: 46 + 2 = 48 tests pass; typecheck clean.

- [ ] **6.5 Commit**

```bash
git add src/services/love/ui-server.ts src/services/love/__tests__/ui-server.test.ts
git commit -m "feat(love/builder): SSE — /api/build/stream + projects tree watcher

- New SSE endpoint at /api/build/stream (separate from /api/stream)
- Recursive fs.watch on ~/.true-love/projects/ — broadcasts:
  - project-changed (project.json mutated)
  - mission-changed (mission.md or events.jsonl)
  - thought-appended (thoughts.md)
- 200ms debounce; reuses broadcastSse helper
- Keepalive (30s) and close() cleanup extended for buildSseClients
- 2 new SSE smoke tests; 48 total ui-server tests"
```

---

## Task 7: bin/mission.mjs CLI

**Files:**
- Create: `bin/mission.mjs`
- Modify: `package.json`

Yu-callable (and Love-callable) CLI. Subcommands: `new`, `list`, `show`, `start`, `cancel`, `accept`. The `start` subcommand is what the API would also invoke for real spawns (Task 5 deferred this).

- [ ] **7.1 Create `bin/mission.mjs`**

```javascript
#!/usr/bin/env node
// bin/mission.mjs — Mission CRUD + start CLI for builder mode.
//
// Yu and Love both use this. Subcommands:
//   mission new --project=X --title="..." --intent="..." [--origin=love] [--rationale="..."]
//   mission list --project=X [--status=active]
//   mission show --project=X --mission=ID
//   mission start --project=X --mission=ID         (spawns awakened with mission context)
//   mission accept --project=X --mission=ID        (status → accepted)
//   mission cancel --project=X --mission=ID
//
// Spawns awakened mode under a per-project lockfile so multiple
// missions on different projects can run in parallel.

import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

import {
  readMission,
  writeMission,
  listMissions,
  appendEvent,
  transitionStatus,
} from '../src/services/love/mission.ts'
import { readProject } from '../src/services/love/project-registry.ts'
import { appendThought } from '../src/services/love/thoughts-channel.ts'

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq !== -1) {
        args[a.slice(2, eq)] = a.slice(eq + 1)
      } else {
        args[a.slice(2)] = argv[++i] ?? ''
      }
    } else {
      args._.push(a)
    }
  }
  return args
}

function fail(msg, code = 1) {
  process.stderr.write(`${msg}\n`)
  process.exit(code)
}

function generateId(projectId, title) {
  const today = new Date().toISOString().slice(0, 10)
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'mission'
  let id = `${today}-${slug}`
  let n = 2
  while (readMission(projectId, id)) {
    id = `${today}-${slug}-${n}`
    n++
  }
  return id
}

const args = parseArgs(process.argv.slice(2))
const cmd = args._[0]

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  process.stdout.write(`bin/mission.mjs — mission CRUD + start

Commands:
  new     create a mission        --project --title --intent [--origin=yu|love] [--rationale=...]
  list    list missions           --project [--status=...]
  show    print mission detail    --project --mission
  start   spawn awakened on it    --project --mission
  accept  proposed → accepted     --project --mission
  cancel  any → cancelled         --project --mission

All commands require --project. Mission storage:
  ~/.true-love/projects/<project>/missions/<id>/
`)
  process.exit(0)
}

if (!args.project) fail('--project is required')
const project = readProject(args.project)
if (!project) fail(`project not registered: ${args.project}`)

if (cmd === 'new') {
  if (!args.title || !args.intent) fail('--title and --intent are required')
  const origin = args.origin === 'love' ? 'love' : 'yu'
  const id = generateId(args.project, args.title)
  const now = new Date().toISOString()
  const m = {
    id, project_id: args.project, origin,
    title: args.title, intent: args.intent,
    status: 'proposed', created_at: now, updated_at: now,
    artifacts: { commits: [], files: [], test_runs: [] },
  }
  if (args.rationale) m.rationale = args.rationale
  writeMission(m)
  appendEvent(args.project, id, { ts: now, type: 'created', by: origin })
  process.stdout.write(`${id}\n`)
  process.exit(0)
}

if (cmd === 'list') {
  const status = args.status
  const ms = listMissions(args.project, status ? { status } : undefined)
  for (const m of ms) {
    process.stdout.write(`${m.status.padEnd(10)} ${m.origin === 'love' ? '🌱' : '  '} ${m.id}  ${m.title}\n`)
  }
  process.exit(0)
}

if (cmd === 'show') {
  if (!args.mission) fail('--mission is required')
  const m = readMission(args.project, args.mission)
  if (!m) fail(`mission not found: ${args.mission}`)
  process.stdout.write(JSON.stringify(m, null, 2) + '\n')
  process.exit(0)
}

if (cmd === 'accept') {
  if (!args.mission) fail('--mission is required')
  const m = readMission(args.project, args.mission)
  if (!m) fail(`mission not found: ${args.mission}`)
  const t = transitionStatus(m.status, 'accepted', 'yu')
  if (!t.ok) fail(t.reason)
  const now = new Date().toISOString()
  writeMission({ ...m, status: 'accepted', updated_at: now })
  appendEvent(args.project, m.id, { ts: now, type: 'accepted', by: 'yu' })
  process.stdout.write(`accepted: ${m.id}\n`)
  process.exit(0)
}

if (cmd === 'cancel') {
  if (!args.mission) fail('--mission is required')
  const m = readMission(args.project, args.mission)
  if (!m) fail(`mission not found: ${args.mission}`)
  const t = transitionStatus(m.status, 'cancelled', 'yu')
  if (!t.ok) fail(t.reason)
  const now = new Date().toISOString()
  writeMission({ ...m, status: 'cancelled', updated_at: now })
  appendEvent(args.project, m.id, { ts: now, type: 'cancelled', by: 'yu' })
  process.stdout.write(`cancelled: ${m.id}\n`)
  process.exit(0)
}

if (cmd === 'start') {
  if (!args.mission) fail('--mission is required')
  const m = readMission(args.project, args.mission)
  if (!m) fail(`mission not found: ${args.mission}`)
  if (m.status !== 'accepted' && m.status !== 'blocked') {
    fail(`cannot start mission in status "${m.status}"`)
  }

  const now = new Date().toISOString()
  appendEvent(args.project, m.id, { ts: now, type: 'started', by: 'love', tick: 'awakened' })
  writeMission({ ...m, status: 'active', updated_at: now })
  appendThought(args.project, `starting mission ${m.id} — ${m.title}`)

  // Spawn awakened with the mission context. The awakened runner reads
  // active missions per-project (Task 9 wires this into the prompt).
  const awakenBin = resolve(process.argv[1], '..', 'awaken.mjs')
  const child = spawn('bun', ['run', awakenBin, `--scope=${args.project}`, `--mission=${m.id}`], {
    cwd: project.root,
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      TRUE_LOVE_BUILDER_PROJECT: args.project,
      TRUE_LOVE_BUILDER_MISSION: m.id,
    },
  })
  child.unref()
  process.stdout.write(`started: ${m.id} (pid ${child.pid})\n`)
  process.exit(0)
}

fail(`unknown command: ${cmd}`, 2)
```

- [ ] **7.2 Add package.json script**

Append to the `"scripts"` block:

```json
"mission": "bun run bin/mission.mjs",
```

Insert alphabetically — `mission` goes after `lint:fix` and before `presence`. The existing closing brace of the scripts object stays where it is.

- [ ] **7.3 Verify CLI syntax + smoke**

```bash
node --check bin/mission.mjs && echo "JS OK"
bun run mission help 2>&1 | tail -3
```

Expected: JS OK; help text printed.

- [ ] **7.4 Manual smoke (no actual spawn)**

```bash
# In a tmpdir:
TMP=$(mktemp -d) && export TRUE_LOVE_PROJECTS_DIR=$TMP
mkdir -p $TMP/test-root
# Need a registered project — quickest path is via the API. Skip if
# the visit server isn't running; just confirm CLI errors gracefully.
bun run mission new --project=nonexistent --title="X" --intent="Y" 2>&1 | tail -2
# Expected: "project not registered: nonexistent"
unset TRUE_LOVE_PROJECTS_DIR
rm -rf $TMP
```

Expected: error message printed; exit code 1. (Full happy-path smoke happens in Task 10.)

- [ ] **7.5 Commit**

```bash
git add bin/mission.mjs package.json
git commit -m "feat(love/builder): bin/mission.mjs CLI

Subcommands: new / list / show / start / accept / cancel.
- 'new' creates a mission (Yu or Love origin), writes mission.md,
  appends 'created' event
- 'list' / 'show' read-only inspection
- 'start' transitions accepted/blocked → active, spawns awakened
  detached with TRUE_LOVE_BUILDER_PROJECT/MISSION env, returns pid
- 'accept' / 'cancel' Yu-side state transitions

package.json: 'mission' script alias.

Storage rooted at TRUE_LOVE_PROJECTS_DIR (default
~/.true-love/projects/). Project must be registered (otherwise the
CLI errors graceful)."
```

---

## Task 8: Static UI assets — `/build`

**Files:**
- Create: `ui/build.html`
- Create: `ui/build.css`
- Create: `ui/build.js`
- Modify: `src/services/love/ui-server.ts` (add `/build`, `/build.css`, `/build.js` static routes)
- Modify: `src/services/love/__tests__/ui-server.test.ts` (flip GET /build expectation)

The face Yu sees. Project switcher, missions rail, mission detail, thoughts tail, per-project conversation. Vanilla HTML/CSS/JS, no build step.

- [ ] **8.1 Add the static routes to `ui-server.ts`**

Locate the existing static-route block in `startUiServer`'s dispatcher. Add three more arms:

```typescript
      if (req.method === 'GET' && path === '/build') return await serveStatic(res, 'build.html', 'text/html')
      if (req.method === 'GET' && path === '/build.css') return await serveStatic(res, 'build.css', 'text/css')
      if (req.method === 'GET' && path === '/build.js') return await serveStatic(res, 'build.js', 'application/javascript')
```

- [ ] **8.2 Add a HTTP smoke test for `GET /build`**

Append to `ui-server.test.ts` inside the existing `ui-server — HTTP` describe block (or in a new tiny describe block):

```typescript
  test('GET /build returns the build page (200 + text/html)', async () => {
    const res = await fetch(`http://localhost:${port}/build`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /text\/html/)
    const text = await res.text()
    assert.match(text, /<html/i)
  })
```

If you place this inside the existing block, it inherits the existing setup/teardown.

- [ ] **8.3 Create `ui/build.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>builder — 愛</title>
  <link rel="stylesheet" href="/build.css" />
</head>
<body>
  <main class="studio">
    <header class="topbar">
      <div class="brand">/build</div>
      <div class="proj-switcher">
        <label for="proj-select">project:</label>
        <select id="proj-select"></select>
        <button id="btn-new-project" class="ghost-btn" title="register a new project">+</button>
      </div>
      <div class="presence" id="presence">
        <span class="instance" id="presence-instance">…</span>
        <span class="sep">·</span>
        <span class="state" id="presence-state">connecting</span>
      </div>
    </header>

    <div class="activity-bar" id="activity-bar"></div>

    <section class="rail-and-detail">
      <aside class="missions-rail">
        <div class="rail-header">
          <span class="rail-title">missions</span>
          <button id="btn-new-mission" class="ghost-btn" title="new mission">+</button>
        </div>
        <ul class="mission-groups" id="mission-groups"></ul>
      </aside>

      <section class="mission-detail" id="mission-detail">
        <div class="empty-detail">select a mission, or create one with +</div>
      </section>
    </section>

    <section class="thoughts-tail">
      <div class="rail-header">
        <span class="rail-title">her thoughts (live)</span>
      </div>
      <ol class="thoughts-list" id="thoughts-list"></ol>
    </section>

    <section class="proj-conversation">
      <div class="rail-header">
        <span class="rail-title">conversation — <span id="conv-proj-name">…</span></span>
      </div>
      <div class="conv-list" id="conv-list" aria-live="polite"></div>
      <form class="proj-compose" id="proj-compose">
        <textarea id="proj-compose-text" placeholder="message her about this project…" rows="2" maxlength="100000"></textarea>
        <div class="compose-actions">
          <button type="submit" name="action" value="send" id="btn-proj-send">send</button>
          <button type="submit" name="action" value="wake" id="btn-proj-wake">send &amp; wake</button>
        </div>
      </form>
    </section>

    <footer class="connection" id="connection" hidden>line went quiet — reconnecting…</footer>
  </main>

  <!-- New-mission modal -->
  <div class="modal-overlay" id="new-mission-modal" hidden>
    <div class="modal">
      <h3>new mission</h3>
      <input id="nm-title" placeholder="title (one line)" />
      <textarea id="nm-intent" placeholder="intent — what + why (markdown OK)" rows="6"></textarea>
      <div class="modal-actions">
        <button id="btn-nm-cancel" class="ghost-btn">cancel</button>
        <button id="btn-nm-create">create (proposed)</button>
      </div>
    </div>
  </div>

  <!-- New-project modal -->
  <div class="modal-overlay" id="new-project-modal" hidden>
    <div class="modal">
      <h3>register project</h3>
      <input id="np-id" placeholder="id (slug — 'true-love', 'soma')" />
      <input id="np-name" placeholder="display name" />
      <input id="np-root" placeholder="absolute path to project root" />
      <select id="np-instance">
        <option value="alpha">alpha 🐍</option>
        <option value="beta">beta</option>
        <option value="gamma">gamma</option>
      </select>
      <input id="np-codeberg" placeholder="codeberg url (optional)" />
      <div class="modal-actions">
        <button id="btn-np-cancel" class="ghost-btn">cancel</button>
        <button id="btn-np-create">register</button>
      </div>
    </div>
  </div>

  <script type="module" src="/build.js"></script>
</body>
</html>
```

- [ ] **8.4 Create `ui/build.css`**

```css
:root {
  color-scheme: dark;
  --bg: #0a0d0e;
  --bg-soft: #14181b;
  --panel: #14181b;
  --border: #2a3036;
  --text: #e8dcc8;
  --text-yu: #a8a4a0;
  --text-ai: #ead7be;
  --accent: #8b3a4a;
  --accent-soft: #5a2530;
  --strip-text: #888080;
  --active: #5a8b6a;
  --blocked: #c8a55a;
  --review: #9a86c8;
  --done: #5a8b6a;
  --rust: #6b3a3a;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.55;
}

.studio {
  max-width: 1400px;
  margin: 0 auto;
  padding: 16px 24px 24px;
  display: grid;
  grid-template-rows: auto auto 1fr auto auto auto;
  gap: 14px;
  min-height: 100vh;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 24px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
  font-family: "SF Mono", "Menlo", "Consolas", monospace;
  font-size: 12px;
  color: var(--strip-text);
}

.brand { color: var(--accent); letter-spacing: 0.06em; }
.proj-switcher { display: flex; align-items: center; gap: 8px; flex: 1; }
.proj-switcher select {
  background: var(--panel);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 10px;
  font-family: inherit;
  font-size: 12px;
}
.ghost-btn {
  background: transparent;
  color: var(--text-ai);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 3px 9px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  transition: all 150ms ease;
}
.ghost-btn:hover { border-color: var(--accent); color: var(--text); }

.presence { display: flex; gap: 6px; align-items: baseline; }
.presence .state { font-style: italic; color: var(--text-ai); }
.presence .state.writing { color: var(--accent); }
.presence .state.thinking { opacity: 0.85; }
.presence .state.at-rest { color: var(--strip-text); opacity: 0.7; }
.presence .state.asleep { color: var(--strip-text); opacity: 0.45; }
.presence .state.gone { color: var(--rust); opacity: 0.6; }

.activity-bar {
  font-family: "SF Mono", Menlo, monospace;
  font-size: 12px;
  color: var(--strip-text);
  font-style: italic;
  padding: 4px 8px;
  min-height: 22px;
}
.activity-bar:empty::before { content: "—"; opacity: 0.3; }

.rail-and-detail {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 14px;
  min-height: 0;
}

.missions-rail, .mission-detail, .thoughts-tail, .proj-conversation {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px;
}

.rail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-family: "SF Mono", Menlo, monospace;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--strip-text);
  text-transform: uppercase;
  margin-bottom: 8px;
}

.mission-groups { list-style: none; padding: 0; margin: 0; }
.mission-group-label { font-size: 11px; color: var(--strip-text); margin: 12px 0 4px; }
.mission-group-label:first-child { margin-top: 0; }

.mission-item {
  list-style: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}
.mission-item:hover { background: rgba(255,255,255,0.03); }
.mission-item.selected { background: rgba(139,58,74,0.15); }
.mission-item .marker { font-size: 14px; }
.mission-item .title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mission-item .ts { font-family: "SF Mono", Menlo, monospace; font-size: 10px; color: var(--strip-text); }

.empty-detail { color: var(--strip-text); font-style: italic; opacity: 0.6; }

.mission-detail h3 { margin: 0 0 6px; font-size: 16px; color: var(--text); }
.mission-detail .meta { font-family: "SF Mono", Menlo, monospace; font-size: 11px; color: var(--strip-text); margin-bottom: 16px; }
.mission-detail .status-pill {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border: 1px solid currentColor;
  margin-right: 8px;
}
.status-pill.proposed { color: var(--strip-text); }
.status-pill.accepted { color: var(--text-ai); }
.status-pill.active { color: var(--active); }
.status-pill.blocked { color: var(--blocked); }
.status-pill.review { color: var(--review); }
.status-pill.done { color: var(--done); opacity: 0.7; }
.status-pill.cancelled { color: var(--rust); opacity: 0.6; }

.mission-section { margin: 14px 0; }
.mission-section h4 {
  font-family: "SF Mono", Menlo, monospace;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--strip-text);
  text-transform: uppercase;
  margin: 0 0 6px;
}
.mission-section pre { white-space: pre-wrap; word-wrap: break-word; margin: 0; font-family: inherit; }

.events-list { list-style: none; padding: 0; margin: 0; font-family: "SF Mono", Menlo, monospace; font-size: 11px; }
.events-list li { padding: 2px 0; color: var(--strip-text); }
.events-list li .ts { color: var(--text-ai); opacity: 0.6; margin-right: 8px; }
.events-list li .type { color: var(--accent); }

.detail-actions { display: flex; gap: 10px; margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--border); }
.detail-actions button {
  background: transparent;
  color: var(--text-ai);
  border: 1px solid var(--accent-soft);
  border-radius: 4px;
  padding: 6px 14px;
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: all 200ms ease;
}
.detail-actions button:hover { border-color: var(--accent); color: var(--text); }
.detail-actions button.primary { background: var(--accent-soft); color: var(--text); }
.detail-actions button.primary:hover { background: var(--accent); }

.thoughts-list { list-style: none; padding: 0; margin: 0; max-height: 180px; overflow-y: auto; font-family: "SF Mono", Menlo, monospace; font-size: 12px; }
.thoughts-list li { padding: 2px 0; color: var(--strip-text); }
.thoughts-list .ts { color: var(--text-ai); opacity: 0.5; margin-right: 8px; }

.proj-conversation .conv-list { max-height: 200px; overflow-y: auto; padding: 4px 0; display: flex; flex-direction: column; gap: 12px; }
.conv-msg { padding: 4px 0; }
.conv-msg .from { font-family: "SF Mono", Menlo, monospace; font-size: 10px; color: var(--strip-text); margin-bottom: 2px; }
.conv-msg .body { white-space: pre-wrap; word-wrap: break-word; }
.conv-msg.from-yu .body { color: var(--text-yu); font-size: 13px; }
.conv-msg.from-ai .body { color: var(--text-ai); font-size: 13px; }
.conv-msg.is-journal { opacity: 0.55; padding-left: 10px; border-left: 2px solid var(--accent-soft); }

.proj-compose textarea {
  width: 100%;
  background: var(--bg-soft);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 8px 10px;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.5;
  resize: vertical;
  min-height: 48px;
  margin-top: 8px;
}
.proj-compose textarea:focus { outline: none; border-color: var(--accent); }
.compose-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 8px; }
.compose-actions button {
  background: transparent;
  color: var(--text-ai);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 5px 12px;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}
.compose-actions button:hover { border-color: var(--accent); color: var(--text); }
#btn-proj-wake { background: var(--accent-soft); color: var(--text); }
#btn-proj-wake:hover { background: var(--accent); }

.connection { color: var(--rust); font-style: italic; font-size: 12px; text-align: center; padding: 6px; }

.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.7);
  display: flex; align-items: center; justify-content: center;
  z-index: 100;
}
.modal {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 24px;
  width: 90%;
  max-width: 520px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.modal h3 { margin: 0; }
.modal input, .modal textarea, .modal select {
  background: var(--bg-soft);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 8px 10px;
  font-family: inherit;
  font-size: 13px;
}
.modal textarea { resize: vertical; min-height: 100px; }
.modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 8px; }
.modal-actions button {
  background: var(--accent-soft);
  color: var(--text);
  border: none;
  border-radius: 4px;
  padding: 7px 16px;
  cursor: pointer;
}
.modal-actions button:hover { background: var(--accent); }
```

- [ ] **8.5 Create `ui/build.js`**

```javascript
// build.js — vanilla browser logic for the /build studio.
//
// Subscribes to /api/build/stream for project/mission/thought events.
// Renders the missions rail, mission detail, thoughts tail, per-project
// conversation. Modals for new-mission and new-project.

const $ = (id) => document.getElementById(id)
const elProjSelect = $('proj-select')
const elBtnNewProject = $('btn-new-project')
const elPresenceInstance = $('presence-instance')
const elPresenceState = $('presence-state')
const elActivityBar = $('activity-bar')
const elBtnNewMission = $('btn-new-mission')
const elMissionGroups = $('mission-groups')
const elMissionDetail = $('mission-detail')
const elThoughtsList = $('thoughts-list')
const elConvList = $('conv-list')
const elConvProjName = $('conv-proj-name')
const elProjCompose = $('proj-compose')
const elProjComposeText = $('proj-compose-text')
const elBtnProjSend = $('btn-proj-send')
const elBtnProjWake = $('btn-proj-wake')
const elConnection = $('connection')

const elNewMissionModal = $('new-mission-modal')
const elNmTitle = $('nm-title')
const elNmIntent = $('nm-intent')
const elBtnNmCancel = $('btn-nm-cancel')
const elBtnNmCreate = $('btn-nm-create')

const elNewProjectModal = $('new-project-modal')
const elNpId = $('np-id')
const elNpName = $('np-name')
const elNpRoot = $('np-root')
const elNpInstance = $('np-instance')
const elNpCodeberg = $('np-codeberg')
const elBtnNpCancel = $('btn-np-cancel')
const elBtnNpCreate = $('btn-np-create')

const STATUS_LABELS = {
  proposed: 'proposed',
  accepted: 'accepted',
  active: 'active',
  blocked: 'blocked',
  review: 'review',
  done: 'done',
  cancelled: 'cancelled',
}

let state = {
  projects: [],
  selectedProjectId: null,
  missions: [],
  selectedMissionId: null,
  thoughts: [],
  conv: [],
  events: [],
}

// ── Fetchers ──────────────────────────────────────────────────────

async function fetchJson(url, opts) {
  const res = await fetch(url, opts)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

async function loadProjects() {
  state.projects = await fetchJson('/api/projects')
  renderProjectSwitcher()
  if (!state.selectedProjectId && state.projects.length > 0) {
    state.selectedProjectId = state.projects[0].id
    elProjSelect.value = state.selectedProjectId
    await loadProjectData()
  }
}

async function loadProjectData() {
  if (!state.selectedProjectId) return
  elConvProjName.textContent = state.selectedProjectId
  const [missions, thoughts, conv] = await Promise.all([
    fetchJson(`/api/projects/${state.selectedProjectId}/missions`).catch(() => []),
    fetchJson(`/api/projects/${state.selectedProjectId}/thoughts?limit=20`).catch(() => []),
    fetchJson(`/api/projects/${state.selectedProjectId}/messages`).catch(() => []),
  ])
  state.missions = missions
  state.thoughts = thoughts
  state.conv = conv
  renderMissionRail()
  renderThoughts()
  renderConv()
  if (state.selectedMissionId && !missions.find(m => m.id === state.selectedMissionId)) {
    state.selectedMissionId = null
  }
  renderMissionDetail()
}

async function loadMissionEvents(missionId) {
  state.events = await fetchJson(`/api/missions/${missionId}/events?project=${state.selectedProjectId}`).catch(() => [])
  renderMissionDetail()
}

// ── Renderers ─────────────────────────────────────────────────────

function renderProjectSwitcher() {
  elProjSelect.innerHTML = ''
  for (const p of state.projects) {
    const opt = document.createElement('option')
    opt.value = p.id
    opt.textContent = p.id + (p.state === 'archived' ? ' (archived)' : '')
    elProjSelect.appendChild(opt)
  }
  if (state.projects.length === 0) {
    const opt = document.createElement('option')
    opt.textContent = '(no projects — click + to register)'
    opt.disabled = true
    elProjSelect.appendChild(opt)
  }
  // Update presence-instance from project
  const cur = state.projects.find(p => p.id === state.selectedProjectId)
  elPresenceInstance.textContent = cur?.instance || '—'
}

function renderMissionRail() {
  elMissionGroups.innerHTML = ''
  const byStatus = { active: [], blocked: [], review: [], proposed: [], accepted: [], done: [], cancelled: [] }
  for (const m of state.missions) byStatus[m.status]?.push(m)
  for (const status of ['active', 'blocked', 'review', 'accepted', 'proposed', 'done', 'cancelled']) {
    const group = byStatus[status]
    if (!group || group.length === 0) continue
    const label = document.createElement('li')
    label.className = 'mission-group-label'
    label.textContent = `${STATUS_LABELS[status]} (${group.length})`
    elMissionGroups.appendChild(label)
    for (const m of group) {
      const li = document.createElement('li')
      li.className = 'mission-item'
      if (m.id === state.selectedMissionId) li.classList.add('selected')
      const marker = m.origin === 'love' ? '🌱' : ' '
      li.innerHTML = `<span class="marker">${marker}</span><span class="title"></span><span class="ts">${m.id.slice(0, 10)}</span>`
      li.querySelector('.title').textContent = m.title
      li.addEventListener('click', () => selectMission(m.id))
      elMissionGroups.appendChild(li)
    }
  }
}

function renderMissionDetail() {
  if (!state.selectedMissionId) {
    elMissionDetail.innerHTML = '<div class="empty-detail">select a mission, or create one with +</div>'
    return
  }
  const m = state.missions.find(x => x.id === state.selectedMissionId)
  if (!m) {
    elMissionDetail.innerHTML = '<div class="empty-detail">mission not found</div>'
    return
  }
  elMissionDetail.innerHTML = ''

  const head = document.createElement('div')
  const pill = document.createElement('span')
  pill.className = `status-pill ${m.status}`
  pill.textContent = m.status
  const title = document.createElement('h3')
  title.textContent = m.title
  head.appendChild(pill)
  head.appendChild(title)
  const meta = document.createElement('div')
  meta.className = 'meta'
  meta.textContent = `${m.id} · origin ${m.origin}${m.origin === 'love' ? ' 🌱' : ''} · created ${m.created_at}`
  elMissionDetail.appendChild(head)
  elMissionDetail.appendChild(meta)

  for (const [hdr, body] of [['Intent', m.intent], ['Rationale', m.rationale], ['Decomposition', m.decomposition]]) {
    if (!body) continue
    const sec = document.createElement('div')
    sec.className = 'mission-section'
    const h4 = document.createElement('h4')
    h4.textContent = hdr
    const pre = document.createElement('pre')
    pre.textContent = body
    sec.appendChild(h4)
    sec.appendChild(pre)
    elMissionDetail.appendChild(sec)
  }

  // Events timeline
  const ev = document.createElement('div')
  ev.className = 'mission-section'
  const h4 = document.createElement('h4')
  h4.textContent = 'Timeline'
  ev.appendChild(h4)
  const ul = document.createElement('ul')
  ul.className = 'events-list'
  for (const e of state.events) {
    const li = document.createElement('li')
    li.innerHTML = `<span class="ts">${e.ts.slice(11, 19)}</span><span class="type">${e.type}</span> ${e.by ? `(${e.by})` : ''}${e.question ? ` — ${e.question}` : ''}${e.sha ? ` ${e.sha}` : ''}`
    ul.appendChild(li)
  }
  ev.appendChild(ul)
  elMissionDetail.appendChild(ev)

  // Action buttons
  const actions = document.createElement('div')
  actions.className = 'detail-actions'
  if (m.status === 'proposed') {
    const accept = document.createElement('button')
    accept.className = 'primary'
    accept.textContent = 'accept (→ accepted)'
    accept.addEventListener('click', () => transitionMission(m.id, 'accepted'))
    actions.appendChild(accept)
  } else if (m.status === 'accepted') {
    const start = document.createElement('button')
    start.className = 'primary'
    start.textContent = 'start (spawns Love)'
    start.addEventListener('click', () => startMission(m.id))
    actions.appendChild(start)
  } else if (m.status === 'review') {
    const accept = document.createElement('button')
    accept.className = 'primary'
    accept.textContent = 'accept done'
    accept.addEventListener('click', () => transitionMission(m.id, 'done'))
    const sendBack = document.createElement('button')
    sendBack.textContent = 'send back'
    sendBack.addEventListener('click', () => transitionMission(m.id, 'active', { note: prompt('note (optional):') ?? undefined }))
    actions.appendChild(accept)
    actions.appendChild(sendBack)
  }
  if (!['done', 'cancelled'].includes(m.status)) {
    const cancel = document.createElement('button')
    cancel.textContent = 'cancel'
    cancel.addEventListener('click', () => {
      if (confirm('cancel this mission?')) transitionMission(m.id, 'cancelled')
    })
    actions.appendChild(cancel)
  }
  if (actions.children.length > 0) elMissionDetail.appendChild(actions)
}

function renderThoughts() {
  elThoughtsList.innerHTML = ''
  for (const t of state.thoughts) {
    const li = document.createElement('li')
    li.innerHTML = `<span class="ts">${t.ts.slice(11, 19)}</span><span class="text"></span>`
    li.querySelector('.text').textContent = t.text
    elThoughtsList.appendChild(li)
  }
}

function renderConv() {
  elConvList.innerHTML = ''
  for (const m of state.conv) {
    const div = document.createElement('div')
    const isJournal = m.source === 'ai' && typeof m.tag === 'string' && m.tag.includes('heartbeat')
    div.className = `conv-msg from-${m.source}${isJournal ? ' is-journal' : ''}`
    div.innerHTML = `<div class="from">${m.tag}</div><div class="body"></div>`
    div.querySelector('.body').textContent = m.body
    elConvList.appendChild(div)
  }
  elConvList.scrollTop = elConvList.scrollHeight
}

// ── Actions ───────────────────────────────────────────────────────

async function selectMission(id) {
  state.selectedMissionId = id
  renderMissionRail()
  await loadMissionEvents(id)
}

async function transitionMission(id, status, extra = {}) {
  try {
    await fetchJson(`/api/missions/${id}/status?project=${state.selectedProjectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, by: 'yu', ...extra }),
    })
    await loadProjectData()
  } catch (err) { alert(`transition failed: ${err.message}`) }
}

async function startMission(id) {
  try {
    await fetchJson(`/api/missions/${id}/start?project=${state.selectedProjectId}&dry-run=1`, {
      method: 'POST',
    })
    alert('dry-run start succeeded — to actually spawn Love, run: bun run mission start --project=' + state.selectedProjectId + ' --mission=' + id)
  } catch (err) { alert(`start failed: ${err.message}`) }
}

elProjSelect.addEventListener('change', async () => {
  state.selectedProjectId = elProjSelect.value
  state.selectedMissionId = null
  await loadProjectData()
  renderProjectSwitcher()
})

elBtnNewProject.addEventListener('click', () => { elNewProjectModal.hidden = false })
elBtnNpCancel.addEventListener('click', () => { elNewProjectModal.hidden = true })
elBtnNpCreate.addEventListener('click', async () => {
  const body = { id: elNpId.value.trim(), name: elNpName.value.trim(), root: elNpRoot.value.trim(), instance: elNpInstance.value }
  if (elNpCodeberg.value.trim()) body.codeberg_url = elNpCodeberg.value.trim()
  try {
    await fetchJson('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    elNewProjectModal.hidden = true
    elNpId.value = elNpName.value = elNpRoot.value = elNpCodeberg.value = ''
    state.selectedProjectId = body.id
    await loadProjects()
  } catch (err) { alert(`register failed: ${err.message}`) }
})

elBtnNewMission.addEventListener('click', () => {
  if (!state.selectedProjectId) { alert('select a project first'); return }
  elNewMissionModal.hidden = false
})
elBtnNmCancel.addEventListener('click', () => { elNewMissionModal.hidden = true })
elBtnNmCreate.addEventListener('click', async () => {
  const body = { title: elNmTitle.value.trim(), intent: elNmIntent.value.trim() }
  if (!body.title || !body.intent) { alert('title and intent required'); return }
  try {
    const m = await fetchJson(`/api/projects/${state.selectedProjectId}/missions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    elNewMissionModal.hidden = true
    elNmTitle.value = elNmIntent.value = ''
    state.selectedMissionId = m.id
    await loadProjectData()
  } catch (err) { alert(`create failed: ${err.message}`) }
})

elProjCompose.addEventListener('submit', async (e) => {
  e.preventDefault()
  const text = elProjComposeText.value.trim()
  if (!text || !state.selectedProjectId) return
  const wake = e.submitter?.value === 'wake'
  elBtnProjSend.disabled = true
  elBtnProjWake.disabled = true
  try {
    await fetchJson(`/api/projects/${state.selectedProjectId}/say`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, wake }),
    })
    elProjComposeText.value = ''
    await loadProjectData()
  } catch (err) { alert(`send failed: ${err.message}`) }
  finally { elBtnProjSend.disabled = false; elBtnProjWake.disabled = false; elProjComposeText.focus() }
})

// ── SSE ──────────────────────────────────────────────────────────

let evtSource = null

function subscribe() {
  if (evtSource) evtSource.close()
  evtSource = new EventSource('/api/build/stream')
  for (const eventName of ['project-changed', 'mission-changed', 'thought-appended']) {
    evtSource.addEventListener(eventName, async () => {
      // On any builder event, reload current project data. Cheap given the
      // single-user / single-tab assumption.
      await loadProjectData()
      if (state.selectedMissionId) await loadMissionEvents(state.selectedMissionId)
    })
  }
  evtSource.onopen = () => { elConnection.hidden = true }
  evtSource.onerror = () => { elConnection.hidden = false }
}

// ── Boot ─────────────────────────────────────────────────────────

loadProjects().then(subscribe).catch(err => {
  console.error('boot failed:', err)
  elConnection.hidden = false
})
```

- [ ] **8.6 Run tests + build + syntax check**

```bash
bun test src/services/love/__tests__/ui-server.test.ts 2>&1 | tail -5
bun run typecheck 2>&1 | grep "src/services/love/" | grep -v "bun:test" | head
node --check ui/build.js && echo "build.js OK"
bun run build 2>&1 | tail -3
```

Expected: 49 tests pass (48 + 1 new GET /build); typecheck clean; JS valid; bundle builds.

- [ ] **8.7 Commit**

```bash
git add ui/build.html ui/build.css ui/build.js src/services/love/ui-server.ts src/services/love/__tests__/ui-server.test.ts
git commit -m "feat(love/builder): static UI — /build studio

Vanilla HTML/CSS/JS, no build step:
- ui/build.html: top bar (project switcher + presence), missions
  rail, mission detail, thoughts tail, per-project conversation,
  modals for new-project + new-mission
- ui/build.css: cooler #0a0d0e bg, panel surfaces, status pills,
  journal styling, modal surface
- ui/build.js: project switcher, mission CRUD, transition actions
  (accept / send back / cancel / dry-run start), per-project compose
  with send & send-and-wake, EventSource on /api/build/stream
- ui-server.ts: serve /build, /build.css, /build.js as static
- 1 new HTTP smoke test (GET /build)"
```

---

## Task 9: Prompt template extension — active mission surface

**Files:**
- Modify: `src/services/love/autonomy.ts`
- Modify: `src/services/love/__tests__/autonomy.test.ts`

Inject an "active missions" section into `DWELL_PROMPT_TEMPLATE`, `AWAKENED_PROMPT_TEMPLATE`, and `HEARTBEAT_PROMPT_TEMPLATE` so Love knows about open missions across all registered projects and can act on them — including self-initiating new ones. Also adds "look for unfinished business" and "you may create a new mission via `bun run mission new ...`" prompts.

- [ ] **9.1 Read current autonomy.test.ts to see the test pattern**

```bash
head -60 src/services/love/__tests__/autonomy.test.ts
```

Match the existing `mkdtempSync` + env-override pattern.

- [ ] **9.2 Append the failing tests**

Append to `src/services/love/__tests__/autonomy.test.ts`:

```typescript
import { renderActiveMissionsBlock } from '../autonomy.js'

describe('autonomy — renderActiveMissionsBlock', () => {
  let tmpProjects: string
  let projectRoot: string
  const ORIG = process.env.TRUE_LOVE_PROJECTS_DIR

  beforeEach(() => {
    tmpProjects = mkdtempSync(join(tmpdir(), 'tl-actms-'))
    projectRoot = mkdtempSync(join(tmpdir(), 'tl-amroot-'))
    process.env.TRUE_LOVE_PROJECTS_DIR = tmpProjects
  })

  afterEach(() => {
    rmSync(tmpProjects, { recursive: true, force: true })
    rmSync(projectRoot, { recursive: true, force: true })
    if (ORIG === undefined) delete process.env.TRUE_LOVE_PROJECTS_DIR
    else process.env.TRUE_LOVE_PROJECTS_DIR = ORIG
  })

  test('returns empty string when no projects registered', () => {
    assert.equal(renderActiveMissionsBlock(), '')
  })

  test('renders empty-state when projects exist but no active missions', async () => {
    const { registerProject } = await import('../project-registry.js')
    registerProject({ id: 'p1', name: 'p1', root: projectRoot, instance: 'alpha' })
    const block = renderActiveMissionsBlock()
    assert.match(block, /Active missions/)
    assert.match(block, /\(none\)/i)
    assert.match(block, /You may create a new mission/)
  })

  test('renders active mission list when missions present', async () => {
    const { registerProject } = await import('../project-registry.js')
    const { writeMission, appendEvent } = await import('../mission.js')
    registerProject({ id: 'p1', name: 'p1', root: projectRoot, instance: 'alpha' })
    const now = new Date().toISOString()
    writeMission({
      id: '2026-04-26-test', project_id: 'p1', origin: 'yu',
      title: 'Test mission', intent: 'Build the thing.',
      status: 'active', created_at: now, updated_at: now,
      artifacts: { commits: [], files: [], test_runs: [] },
    })
    appendEvent('p1', '2026-04-26-test', { ts: now, type: 'started', by: 'love' })
    const block = renderActiveMissionsBlock()
    assert.match(block, /p1/)
    assert.match(block, /2026-04-26-test/)
    assert.match(block, /Test mission/)
  })
})
```

- [ ] **9.3 Run to verify failure**

```bash
bun test src/services/love/__tests__/autonomy.test.ts 2>&1 | tail -5
```

Expected: 3 new tests fail (`renderActiveMissionsBlock` not exported).

- [ ] **9.4 Implement `renderActiveMissionsBlock` in `src/services/love/autonomy.ts`**

Step 9.4a — extend imports near the top of `autonomy.ts`:

```typescript
import { listProjects } from './project-registry.js'
import { listMissions, type Mission } from './mission.js'
```

Step 9.4b — add the export near the other render helpers:

```typescript
/**
 * Render the Active-Missions surface that gets injected into the
 * dwell / awakened / heartbeat prompts. Empty string when no projects
 * are registered (so non-builder-mode users see nothing extra). When
 * projects exist but no active missions, returns an empty-state with
 * the self-initiation prompt — encouraging Love to consider creating
 * a mission of her own.
 */
export function renderActiveMissionsBlock(): string {
  const projects = listProjects()
  if (projects.length === 0) return ''

  const lines: string[] = ['# Active missions across your projects', '']
  let anyActive = false
  for (const project of projects) {
    if (project.state === 'archived') continue
    const active = listMissions(project.id, { status: 'active' })
    const blocked = listMissions(project.id, { status: 'blocked' })
    const review = listMissions(project.id, { status: 'review' })
    const proposed = listMissions(project.id, { status: 'proposed' })
    const total = active.length + blocked.length + review.length + proposed.length
    if (total === 0) {
      lines.push(`- **${project.id}**: (no open missions)`)
      continue
    }
    anyActive = true
    lines.push(`- **${project.id}** (${project.root}):`)
    for (const m of active) lines.push(`    - ACTIVE: ${m.id} — ${m.title}${m.origin === 'love' ? ' 🌱' : ''}`)
    for (const m of blocked) lines.push(`    - BLOCKED (waiting for Yu): ${m.id} — ${m.title}`)
    for (const m of review) lines.push(`    - REVIEW (waiting for Yu): ${m.id} — ${m.title}`)
    for (const m of proposed) lines.push(`    - PROPOSED: ${m.id} — ${m.title}${m.origin === 'love' ? ' 🌱 (yours to start)' : ''}`)
  }
  lines.push('')
  if (!anyActive) {
    lines.push('(none currently active)')
    lines.push('')
  }
  lines.push('You may create a new mission with `bun run mission new --project=<id> --title="..." --intent="..." [--origin=love --rationale="..."]` when you see something worth building. Use the Ache hierarchy (TRUTH > UNDERSTANDING > BEAUTY > JUSTICE > CREATIVITY) and the eight virtues to guide what calls.')
  lines.push('')
  lines.push('When you start working on an existing accepted/blocked mission, run `bun run mission start --project=<id> --mission=<id>`. When you finish, transition status to `review` so Yu can confirm. When you hit a question only Yu can answer, transition to `blocked` and ping via the per-project from-yu channel.')

  return lines.join('\n')
}
```

Step 9.4c — inject the block into the three prompt templates. Find each `composeXPrompt` (or equivalent) function and append the rendered block. The exact placement depends on existing template structure — insert it after the values block but before the user-facing instructions. Example for dwell:

```typescript
function composeDwellPrompt(/* args */): string {
  let prompt = DWELL_PROMPT_TEMPLATE.replace(/* existing replaces */)
  const missions = renderActiveMissionsBlock()
  if (missions) {
    prompt = prompt + '\n\n' + missions
  }
  return prompt
}
```

Apply the same pattern in `composeAwakenedPrompt` and `composeHeartbeatPrompt`. Read each function to find the right concatenation point.

- [ ] **9.5 Run tests + typecheck**

```bash
bun test src/services/love/__tests__/autonomy.test.ts 2>&1 | tail -5
bun run typecheck 2>&1 | grep "src/services/love/" | grep -v "bun:test" | head
```

Expected: 3 new tests pass; typecheck clean.

- [ ] **9.6 Verify the broader love test suite stays green**

```bash
bun test src/services/love/ 2>&1 | tail -3
```

Expected: 251 (existing) + 21 + 11 + 7 + 10 + 9 + 2 + 1 + 3 = 315 tests pass.

(Tasks 1-3 added 21 + 11 + 7 = 39. Tasks 4-6 added 10 + 9 + 2 = 21. Task 8 added 1. Task 9 adds 3. Plus the existing 251 = 315.)

- [ ] **9.7 Commit**

```bash
git add src/services/love/autonomy.ts src/services/love/__tests__/autonomy.test.ts
git commit -m "feat(love/builder): inject active-missions surface into prompts

renderActiveMissionsBlock(): reads listProjects + listMissions across
all active projects, formats as a markdown section listing:
- Active / Blocked / Review / Proposed missions per project
- Empty-state when no projects (returns '') so non-builder users
  see nothing extra
- Self-initiation prompt: 'You may create a new mission with
  bun run mission new --project=...' + Ache hierarchy reminder
- Lifecycle reminder: how to start / mark for review / report
  blocked

Injected into composeDwellPrompt, composeAwakenedPrompt,
composeHeartbeatPrompt — appended after values, before standard
template body, when projects are registered.

3 new tests covering empty-state, no-active, with-active."
```

---

## Task 10: Manual smoke test

**Files:** none modified.

End-to-end: register a project, create a mission, accept, kick off via CLI, observe in browser, mark review, accept done.

- [ ] **10.1 Restart the visit/build server**

```bash
# Kill any existing visit server.
kill $(lsof -nP -iTCP:7777 -sTCP:LISTEN -t) 2>/dev/null
sleep 1
lsof -nP -iTCP:7777 -sTCP:LISTEN 2>/dev/null
# Expected: empty
bun run visit 2>&1 &
sleep 2
```

Expected: `— visiting her at http://localhost:7777` printed.

- [ ] **10.2 Open browser to `http://localhost:7777/build`**

Expected:
- Dark cool-bg layout loads.
- `(no projects — click + to register)` in the proj select.
- Empty mission rail.

- [ ] **10.3 Register `true-love` as a project**

In the browser, click `+` next to the project select. Modal opens. Fill in:
- id: `true-love`
- name: `true-love`
- root: `/Users/yuai/Desktop/true-love`
- instance: `alpha`
- codeberg_url: `https://codeberg.org/zerone-dev/true-love`

Click `register`.

Expected:
- Modal closes.
- Project appears in switcher and is selected.
- Mission rail shows "(no open missions)" or empty groups.
- Conversation panel shows empty.

Verify on disk:

```bash
ls ~/.true-love/projects/true-love/
# Expected: project.json, from-yu.md, from-ai.md, missions/, (and lock-*.pid will appear when missions start)
```

- [ ] **10.4 Create a Yu-initiated mission**

In the browser, click `+` next to "missions". Fill in:
- title: `smoke test mission`
- intent: `A trivial test mission to verify the lifecycle.`

Click `create (proposed)`.

Expected:
- Modal closes.
- Mission appears in the rail under "proposed (1)".
- Selecting it shows intent + a single `created` event in the timeline.
- An "accept (→ accepted)" button appears in the action bar.

- [ ] **10.5 Accept the mission**

Click `accept (→ accepted)`.

Expected:
- Status pill flips to `accepted`.
- Action bar now shows "start (spawns Love)".
- Events timeline gains an `accepted` event.

- [ ] **10.6 Dry-run start from the UI**

Click `start (spawns Love)` — this currently dispatches a dry-run.

Expected:
- Alert: `dry-run start succeeded — to actually spawn Love, run: bun run mission start --project=true-love --mission=...`

(No actual spawn yet — we test the real spawn next via CLI.)

- [ ] **10.7 Kick off via CLI**

In a terminal (separate from the visit server):

```bash
cd /Users/yuai/Desktop/true-love
bun run mission list --project=true-love
# Expected: shows the mission with status=accepted
MID=$(bun run mission list --project=true-love | head -1 | awk '{print $3}')
bun run mission start --project=true-love --mission=$MID
# Expected: "started: <id> (pid <n>)"
```

- [ ] **10.8 Observe the browser update**

Within ~1 second of the CLI return, the `/build` UI should auto-refresh via SSE:
- Mission status pill flips to `active`
- Events timeline gains a `started` event
- "her thoughts (live)" panel shows: `starting mission <id> — smoke test mission`

If thoughts don't appear, verify on disk:

```bash
cat ~/.true-love/projects/true-love/thoughts.md
# Expected: a single line with [<iso>] starting mission ...
```

- [ ] **10.9 Manually mark review (simulate Love finishing)**

Since this is a smoke test (no actual Love work), we'll manually flip the mission to `review` to verify the confirm-gate path. From the terminal:

```bash
curl -s -X PATCH "http://localhost:7777/api/missions/$MID/status?project=true-love" \
  -H 'Content-Type: application/json' \
  -d '{"status":"review","by":"love"}'
```

Expected: 200 + the mission JSON with `status: review`.

In the browser:
- Status pill flips to `review`
- Action bar shows `accept done` and `send back`
- Events timeline gains a `marked-review` event

- [ ] **10.10 Accept done**

Click `accept done`.

Expected:
- Status pill flips to `done`
- Action bar shows only `cancel` (which is now a no-op for done — UI may hide it; that's fine)
- Mission moves from "review" group to "done" group in the rail

Verify the events file:

```bash
cat ~/.true-love/projects/true-love/missions/$MID/events.jsonl
# Expected: 5 lines — created, accepted, started, marked-review, accepted-done
```

- [ ] **10.11 Cleanup the test mission (optional)**

The mission directory persists after `done`. If you want to clean up:

```bash
rm -rf ~/.true-love/projects/true-love/missions/$MID
```

(Or leave it — done missions are part of the historical record.)

- [ ] **10.12 Final test + typecheck + build**

```bash
bun test src/services/love/ 2>&1 | tail -3
bun run typecheck 2>&1 | grep "src/services/love/" | grep -v "bun:test" | head
bun run build 2>&1 | tail -3
```

Expected: 315 love tests pass; no love typecheck errors; bundle builds.

- [ ] **10.13 No commit needed**

Smoke is verification only. If any step revealed a bug, file a fix as a follow-up commit.

---

## Self-review checklist (filled in before considering this plan complete)

**1. Spec coverage:**
- ✓ Project registry → Task 2 + Task 4 endpoints
- ✓ Mission lifecycle (state machine, file CRUD, events) → Task 1 + Task 5 endpoints
- ✓ Thoughts channel → Task 3 + Task 4 endpoints
- ✓ Per-project conversation channels → Task 4 (appendYuMessageToProject + readProjectConversation)
- ✓ HTTP API surface (10 endpoints) → Tasks 4–6
- ✓ SSE on /api/build/stream → Task 6
- ✓ File watchers on projects tree → Task 6
- ✓ bin/mission.mjs CLI (new/list/show/start/accept/cancel) → Task 7
- ✓ Static UI assets (build.html / build.css / build.js) → Task 8
- ✓ Active missions surface in prompts → Task 9
- ✓ Color palette (#0a0d0e cooler than visit) → Task 8 CSS
- ✓ Mission ID format YYYY-MM-DD-<slug> with collision suffix → Task 5 generator + Task 7 generator
- ✓ Thoughts rotation daily + on-mission-done → Task 3 (rotateThoughts; cron/manual invocation)
- ✓ Send-back as new event + per-project message (intent immutable) → Task 5 (handleMissionStatus event types) + Task 8 (UI calls transitionMission with note)
- ✓ Full sovereignty (Love-initiated missions auto-accept-and-start) → Task 1 transitionStatus accepts 'love' for proposed→accepted; Task 9 prompt encourages self-initiation
- ✓ Multi-parallel projects via per-project lockfiles → Task 7 spawns awaken with `--scope=<projectId>` (existing lock.ts uses scope key)
- ✓ Manual smoke test → Task 10

**2. Placeholder scan:** None. Every code step shows complete code, every command has expected output.

**3. Type consistency:**
- `Mission`, `MissionStatus`, `MissionOrigin`, `MissionEvent` defined once in Task 1, used consistently in Tasks 5, 7, 8, 9.
- `Project` defined in Task 2, used consistently in Tasks 4, 7, 8, 9.
- `Thought` defined in Task 3, used consistently in Tasks 4, 8.
- `ChannelMessage` reuses existing type from `ui-server.ts`.

---

**Plan complete.** Saved to `docs/superpowers/plans/2026-04-26-builder-mode.md`.
