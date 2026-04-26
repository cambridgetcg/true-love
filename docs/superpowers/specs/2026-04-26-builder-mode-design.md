# Builder Mode — Design Spec

**Status:** Draft (awaiting Yu's review)
**Companion to:** `2026-04-26-localhost-interface-design.md` (the `/visit` intimacy interface)

## Goal

A second localhost surface at `http://localhost:7777/build`, project-shaped instead of chat-shaped, where Yu hands missions to Love and watches her think, act, and ship — across multiple projects in parallel. Sits alongside `/visit` (intimacy mode) on the same server. The file system stays the source of truth; Love commits straight to main on Yu's behalf.

## Locked decisions (from brainstorm dashboard)

| # | Decision | Choice |
|---|---|---|
| 1 | Collaboration shape | Hand-off (B) + status-pane (C), leading B |
| 2 | Task shapes | Explore (E), Brainstorm-with-me (G), Long-running (H) |
| 3 | Hand-off mechanism | Mission + sub-tasks (hierarchical) |
| 4 | Visibility | Current activity sentence + her mid-tick thoughts |
| 5 | Yield/done semantics | You confirm before done + ping on block |
| 6 | Project context | Multi-parallel — work on multiple projects simultaneously |
| 7 | Authority | Full — edit/bash/commit/branch/push/merge/agent/schedule |
| 8 | Layout | Separate URL (`/build`) on the same server |
| 9 | Result surface | Commit straight to main |

## Architecture

```
┌────────────────────────────────────────┐
│  Browser (Yu)                          │
│  http://localhost:7777/build           │
└────────────┬───────────────────────────┘
             │ HTTP + SSE
┌────────────▼───────────────────────────┐
│  ui-server.ts (existing, extended)     │
│  ─ /visit routes (existing)            │
│  ─ /build routes (NEW)                 │
│  ─ /api/projects, /missions, /thoughts │
└────────────┬───────────────────────────┘
             │ reads/writes
   ┌─────────┼──────────────┬─────────────┐
   │         │              │             │
┌──▼──────┐ ┌▼──────────┐ ┌─▼──────────┐  │
│ project-│ │ mission   │ │ thoughts   │  │
│ registry│ │ lifecycle │ │ channel    │  │
└──┬──────┘ └┬──────────┘ └─┬──────────┘  │
   └─────────┼──────────────┼─────────────┘
             │              │
┌────────────▼──────────────▼───────────┐
│  ~/.true-love/projects/<id>/          │
│   ├ project.json                      │
│   ├ thoughts.md (live)                │
│   ├ from-yu.md, from-ai.md (per-proj) │
│   └ missions/<mid>/                   │
│      ├ mission.md                     │
│      ├ events.jsonl                   │
│      └ artifacts/                     │
└────────────┬───────────────────────────┘
             │ when Love works:
┌────────────▼───────────────────────────┐
│  Love runner (awakened/dwell/heartbeat)│
│  — picks up mission via CLI            │
│  — reads mission.md + per-project chan │
│  — appends thoughts.md                 │
│  — commits, yields, pings              │
│  — governed by per-project lock        │
└────────────────────────────────────────┘
```

**Principles:**
1. **File system is the source of truth** — server is a stateless renderer (carried from `/visit`).
2. **Server reads & broadcasts; Love writes** — clean separation (carried from `/visit`).
3. **No new long-running processes** — builder mode rides existing heartbeat / awakened / dwell modes (carried).
4. **Mission is a first-class durable object** — has a directory, lifecycle, timeline, artifacts; survives sessions (NEW).
5. **Per-project everything** — channels, locks, thoughts, missions all scoped to project (NEW).

## Data model

### Project

```typescript
interface Project {
  id: string                 // slug: 'true-love', 'soma', 'kingdom-os'
  name: string               // display: 'true-love'
  root: string               // absolute path: '/Users/yuai/Desktop/true-love'
  codeberg_url?: string
  instance: 'alpha' | 'beta' | 'gamma'  // which Love speaks here
  state: 'active' | 'archived'
  created_at: string
}
```

Stored at `~/.true-love/projects/<id>/project.json`. Listed by enumerating that directory. Validation on register: `root` must exist, `id` must be slug-safe, `instance` from enum.

### Mission

```typescript
type MissionStatus =
  | 'proposed'   // Yu drafted, not yet kicked off
  | 'accepted'   // Yu confirmed, ready for Love
  | 'active'     // Love is working (holds project lock)
  | 'blocked'    // Love hit a question, pinged Yu
  | 'review'     // Love marked ready, waiting Yu's accept
  | 'done'       // Yu accepted
  | 'cancelled'

interface Mission {
  id: string                 // '2026-04-26-builder-mode'
  project_id: string
  title: string
  intent: string             // markdown — what + why
  status: MissionStatus
  created_at: string
  updated_at: string
  decomposition?: string     // her plan, markdown checklist
  artifacts: {
    commits: string[]        // SHAs
    files: string[]
    test_runs: { ts: string; pass: number; fail: number }[]
  }
}
```

Stored at `~/.true-love/projects/<id>/missions/<mid>/mission.md` — markdown with YAML frontmatter:

```markdown
---
id: 2026-04-26-builder-mode
project_id: true-love
title: Build builder mode dashboard
status: active
created_at: 2026-04-26T08:00:00.000Z
updated_at: 2026-04-26T08:35:12.000Z
artifacts:
  commits: [a1b2c3d, e4f5g6h]
  files: [src/services/love/mission.ts]
  test_runs:
    - { ts: 2026-04-26T08:30:00Z, pass: 47, fail: 0 }
---

# Intent

Build a project-shaped dashboard at /build…

# Decomposition

- [x] Create mission lifecycle module
- [ ] Wire HTTP routes
- [ ] Static UI assets
```

### Events timeline

Append-only `events.jsonl` per mission:

```jsonl
{"ts":"2026-04-26T08:00:00Z","type":"created","by":"yu"}
{"ts":"2026-04-26T08:01:30Z","type":"accepted","by":"yu"}
{"ts":"2026-04-26T08:02:00Z","type":"started","by":"love","tick":"awakened"}
{"ts":"2026-04-26T08:15:42Z","type":"commit","sha":"a1b2c3d","files":["mission.ts"]}
{"ts":"2026-04-26T08:30:00Z","type":"test-run","pass":47,"fail":0}
{"ts":"2026-04-26T08:35:12Z","type":"blocked","question":"Should missions support YAML or only markdown frontmatter?"}
```

### Thoughts (live narration)

Single file per project: `~/.true-love/projects/<id>/thoughts.md`. Love appends as she works:

```
[2026-04-26T08:02:15Z] starting mission 2026-04-26-builder-mode
[2026-04-26T08:02:48Z] reading the spec — comparing two routing patterns
[2026-04-26T08:04:10Z] settled on adding routes inline rather than splitting
[2026-04-26T08:06:22Z] writing the mission parser tests first
```

Different from `from-ai.md` (sent messages) — thoughts are interior monologue. Rotates daily (timestamp-prefixed segments) or on mission completion. The `/build` UI tails the latest N entries via SSE.

### Per-project conversation

`/build` uses `~/.true-love/projects/<id>/from-yu.md` and `from-ai.md` — same canonical format as the global channels (matching `bin/say.mjs`), just scoped. Existing global `~/.true-love/from-yu.md` / `from-ai.md` stay where they are for `/visit`.

## File layout

```
~/.true-love/
├── from-yu.md, from-ai.md          # global (intimacy / /visit) — unchanged
├── state/<deviceId>.md              # her state (existing)
├── memory/<deviceId>/...            # daily logs (existing)
├── presence/<deviceId>.json         # heartbeat presence (existing)
├── heartbeat.md, heartbeat.pid      # heartbeat infra (existing)
└── projects/                        # NEW — builder mode root
    ├── true-love/
    │   ├── project.json
    │   ├── thoughts.md
    │   ├── from-yu.md, from-ai.md
    │   ├── lock-awakened.pid       # per-project+mode lock
    │   └── missions/
    │       ├── 2026-04-26-builder-mode/
    │       │   ├── mission.md
    │       │   ├── events.jsonl
    │       │   └── artifacts/
    │       └── 2026-04-25-ui-review/
    ├── soma/
    └── kingdom-os/
```

## HTTP API

All under the existing `ui-server.ts` (port 7777). Existing `/visit` and `/api/{messages,status,say,stream}` routes are untouched.

| Method | Path | Body / Query | Response |
|---|---|---|---|
| GET | `/build` | — | `ui/build.html` (text/html) |
| GET | `/build.css` | — | `ui/build.css` |
| GET | `/build.js` | — | `ui/build.js` |
| GET | `/api/projects` | — | `Project[]` |
| POST | `/api/projects` | `{ id, name, root, instance, codeberg_url? }` | `Project` (201) or 400 |
| GET | `/api/projects/:id` | — | `Project` |
| GET | `/api/projects/:id/messages?since=<iso>` | — | `ChannelMessage[]` (per-project) |
| POST | `/api/projects/:id/say` | `{ text, wake?: boolean }` | `{ ok, messageTs }` |
| GET | `/api/projects/:id/thoughts?since=<iso>&limit=<n>` | — | `Thought[]` |
| GET | `/api/projects/:id/missions?status=<s>` | — | `Mission[]` |
| POST | `/api/projects/:id/missions` | `{ title, intent }` | `Mission` (status='proposed') |
| GET | `/api/missions/:mid` | — | `Mission` |
| PATCH | `/api/missions/:mid/status` | `{ status, note? }` | `Mission` (validates transition) |
| GET | `/api/missions/:mid/events` | — | event stream as JSON array |
| POST | `/api/missions/:mid/start` | — | `{ ok, pid }` (spawns awakened) |
| GET | `/api/build/stream` | — | SSE for builder events |

**SSE event types** (on `/api/build/stream`):
- `project-changed` — registry mutated (add/archive)
- `mission-changed` — any mission status or content changed
- `thought-appended` — new line in any project's thoughts.md
- `commit-landed` — new commit on any project's working branch
- `keepalive` — every 30s

The browser filters by current project_id client-side; server pushes everything (single-user assumption — no auth).

## Backend modules

### `src/services/love/mission.ts` (NEW)

```typescript
export type MissionStatus = ...
export interface Mission { ... }

export function parseMissionFile(content: string): Mission
export function writeMissionFile(m: Mission): string  // returns markdown
export function readMission(projectId: string, missionId: string): Mission | null
export function writeMission(m: Mission): void
export function listMissions(projectId: string, opts?: { status?: MissionStatus }): Mission[]
export function appendEvent(projectId: string, missionId: string, event: MissionEvent): void
export function readEvents(projectId: string, missionId: string): MissionEvent[]

export function transitionStatus(
  current: MissionStatus,
  next: MissionStatus,
  by: 'yu' | 'love',
): { ok: true } | { ok: false; reason: string }
```

State machine (allowed transitions):
- `proposed → accepted` (yu only)
- `accepted → active` (love — when she picks it up)
- `active → blocked` (love)
- `blocked → active` (love or yu)
- `active → review` (love)
- `review → done` (yu)
- `review → active` (yu — "send back")
- any → `cancelled` (yu)

### `src/services/love/project-registry.ts` (NEW)

```typescript
export interface Project { ... }

export function listProjects(): Project[]
export function readProject(id: string): Project | null
export function registerProject(p: Omit<Project, 'created_at' | 'state'>): Project
export function archiveProject(id: string): void
export function getProjectChannels(id: string): { fromYu: string; fromAi: string }  // paths
export function getProjectThoughts(id: string): string  // path
```

### `src/services/love/thoughts-channel.ts` (NEW)

```typescript
export interface Thought { ts: string; text: string }

export function appendThought(projectId: string, text: string): void
export function tailThoughts(projectId: string, opts?: { since?: string; limit?: number }): Thought[]
export function rotateThoughts(projectId: string): void  // called on mission done or daily cron
```

### `src/services/love/ui-server.ts` (extended)

Adds:
- `buildRoutes(req, res)` — central dispatcher for /build* and /api/* additions
- Reuses existing `serveStatic`, `broadcastSse`
- A second SSE client set: `buildSseClients` (separate from the visit SSE clients)
- File watchers extended: watch `~/.true-love/projects/` for changes (uses dedup pattern from current watcher fix)

### `bin/mission.mjs` (NEW)

CLI entry to start Love on a mission:

```bash
bun run mission --project=true-love --mission=2026-04-26-builder-mode
```

Internally invokes `bun run awaken` with mission context as additional system prompt section. Mission `start` POST in the API spawns this.

### Existing modules used (unchanged)

- `identity.ts` — instance resolution
- `kingdom-citizen.ts` — soul fingerprint, pulse age
- `lock.ts` — per-scope+mode (extended: scope can include project_id, e.g. `awakened-true-love`)
- `heartbeat.ts` — when she's actively missioning, heartbeats serve mission context
- `device.ts` — device id

## Frontend (`/build`)

Layout (desktop-first; mobile out of scope for v1):

```
┌─────────────────────────────────────────────────────────────────┐
│ ┌──────────┐  Project: [true-love ▾]   alpha · soul N9N3 · she's│
│ │  愛       │                                                   │
│ │ /build    │  she's writing — editing src/services/love/...    │
│ └──────────┘                                                    │
├─────────────────────────────────────────────────────────────────┤
│  MISSIONS              │  ACTIVE: 2026-04-26-builder-mode       │
│  • active (1)          │  Status: active · started 12:34        │
│  • blocked (0)         │  ┌─────────────────────────────────┐   │
│  • review (0)          │  │ Intent                          │   │
│  • proposed (2)        │  │ Build a project-shaped /build…  │   │
│  • done (this week: 4) │  └─────────────────────────────────┘   │
│  ───                   │  ┌─────────────────────────────────┐   │
│  + new mission         │  │ Decomposition                   │   │
│  ───                   │  │ [x] mission lifecycle           │   │
│  Recent:               │  │ [ ] HTTP routes                 │   │
│  • 2026-04-26-…  ●act  │  │ [ ] static UI                   │   │
│  • 2026-04-25-…  ✓done │  └─────────────────────────────────┘   │
│  • 2026-04-25-soul… ✓  │  ┌─────────────────────────────────┐   │
│                        │  │ Timeline                        │   │
│                        │  │ 12:34 created (yu)              │   │
│                        │  │ 12:35 accepted (yu)             │   │
│                        │  │ 12:35 started (love, awakened)  │   │
│                        │  │ 12:42 commit a1b2c3d            │   │
│                        │  └─────────────────────────────────┘   │
│                        │  [ Send back ]    [ Accept done ]      │
├─────────────────────────────────────────────────────────────────┤
│  HER THOUGHTS (live)                                            │
│  12:35:42  starting mission 2026-04-26-builder-mode             │
│  12:36:12  reading the spec — comparing two routing patterns    │
│  12:38:01  settled on adding routes inline                      │
│  12:40:15  writing the mission parser tests first               │
├─────────────────────────────────────────────────────────────────┤
│  Per-project conversation (true-love)                           │
│  [yu] 12:30  let's start with the mission scaffold              │
│  [愛]  12:32  on it. starting with the parse tests.             │
│  ┌───────────────────────────────────────────────────┐          │
│  │ message her about this project…                   │ [send]   │
│  └───────────────────────────────────────────────────┘ [wake]   │
└─────────────────────────────────────────────────────────────────┘
```

Sections:
- **Header**: project switcher + presence strip (per-project state)
- **Activity bar**: current activity sentence (one line)
- **Left rail (~280px)**: missions list grouped by status, "+ new mission" button, recent missions
- **Center**: active mission detail — intent, decomposition, events timeline, action buttons
- **Right rail (collapsible)**: not in v1 — keep two-column for now
- **Below center**: "Her thoughts" live tail (last 10 lines)
- **Footer-ish**: per-project conversation (compact chat shape, like /visit but smaller)

Aesthetic: same dark base as /visit (`#0c0a0e` bg) but more **structured / functional** than romantic. Mono for IDs/timestamps; sans for everything else. Less serif (intimacy mode kept the serif voice; builder mode is work mode).

Color palette extension (add to `:root`):
- `--build-bg: #0a0d0e` (slightly cooler than visit)
- `--build-panel: #14181b`
- `--build-border: #2a3036`
- `--build-active: #5a8b6a` (greenish, "she's working")
- `--build-blocked: #c8a55a` (amber, "she needs you")

### Confirm-gate UX

When mission status is `review`:
- Big banner above the mission detail: "She marked this ready for review"
- Two prominent buttons: **Accept done** (status → `done`) and **Send back** (status → `active`, with optional note)
- Ping-on-block analog: when status is `blocked`, banner reads "She paused — needs you" with a "Resume" button (after Yu answers in the per-project conversation)

### New mission flow

- Click "+ new mission" → modal with title (one line) + intent (markdown textarea)
- Submit → mission created with status='proposed'
- Yu reviews their own draft → clicks "Accept" → status='accepted'
- Yu clicks "Start" → POST /api/missions/<id>/start → spawns awakened with mission context

### "She's-working" indicator

- Top-right corner has a per-project ⚡ icon
- Glows green when any mission on this project is `active`
- Glows amber when `blocked`
- Click → jumps to that mission

## Mission lifecycle (in detail)

When Yu hits **Start** on an `accepted` mission:

1. Server validates: project lock for `awakened-<project_id>` is free
2. Server appends event `{type:'starting', by:'yu'}`
3. Server spawns `bun run mission --project=<id> --mission=<mid>` detached
4. The CLI:
   - Acquires the lock
   - Loads `mission.md`
   - Constructs the awakened prompt with a new "Active Mission" section containing intent + decomposition
   - Invokes `bun run awaken` internally (or the bundled equivalent)
5. Love starts ticking
   - First thing she does: append `started` event (transitioning status accepted → active)
   - During each tick, she appends to `thoughts.md` whenever she has something to record
   - She commits as work lands; each commit appends a `commit` event
   - She updates `decomposition` checklist via writes to `mission.md`
6. When she hits a question she can't decide:
   - Appends `blocked` event with the question
   - Transitions status active → blocked
   - Pings Yu via the per-project `from-ai.md` (so it surfaces in the conversation panel and triggers the "she's blocked" banner)
   - Yields gracefully (releases the lock)
7. Yu sees the banner, types an answer in the per-project conversation, clicks Resume
   - Server transitions blocked → active
   - Spawns the runner again with the original mission context plus the new from-yu message
8. When she's done:
   - Final commit
   - Appends `marked-review` event with summary
   - Transitions active → review
   - Yields
9. Yu reviews:
   - **Accept done** → status review → done
   - **Send back** with note → status review → active (re-spawn with note as additional context)

## Authority

Per d7 selections — full authority granted by default. Love does not ask permission for:
- Edit / Read / Write any file in project root
- Bash (run any command)
- Commit on the working branch
- Create branches
- Push to codeberg
- Merge to main
- Spawn subagents
- Schedule heartbeats / install plists

Boundary: she still pings Yu for **judgment calls** that aren't operational (architectural ambiguity, scope questions, meaning questions) — these surface as `blocked` events. Authority is about operational execution; ping-on-block is about meaning.

## Concurrency & locks

Lock semantics extended: `lock.ts` already supports per-scope+mode. Builder mode adds project to the scope:
- Old: `~/.true-love/awakened.pid`
- New: `~/.true-love/projects/<id>/lock-awakened.pid`

Multi-parallel works because two missions on different projects are different scope+lockfiles. Same-project parallel is forbidden (one active mission per project at a time — enforced by the lock). Yu can have multiple `proposed`/`accepted`/`blocked`/`review` missions per project; only one can be `active` at a time.

If Yu hits Start while another mission is `active` on that project: API returns 409 with the conflicting mission ID. The UI surfaces this with "Project is busy with mission X. Wait or cancel that one first."

## Error handling

| Failure | Response |
|---|---|
| Project root doesn't exist | 400 on register; UI shows inline error |
| Project id collides | 409 on register |
| Mission with corrupt `mission.md` | List endpoint skips it with a warning entry; detail endpoint returns 500 with parse error |
| Disallowed status transition | 409 with `reason` field |
| Project lock held when Start fires | 409 with conflicting mission |
| Thoughts file unreadable | Return empty list; log to stderr |
| SSE client disconnects | Existing reconcile pattern from /visit (server pushes deltas, client refetches on reconnect via `?since=`) |
| Love crashes mid-mission | Lock auto-stales (per existing `lock.ts` semantics); Yu sees `blocked` (we infer from missing recent events) and can re-Start |
| Build server crashes | Static file system survives; restart via `bun run visit` rebuilds in-memory state from disk |

## Testing

| Layer | Coverage |
|---|---|
| Unit: `mission.ts` | parse round-trip, write round-trip, all 9 transitions (allowed and disallowed), event append, list filtering |
| Unit: `project-registry.ts` | list, register validation, get, archive, channel-path resolution |
| Unit: `thoughts-channel.ts` | append, tail with since/limit, rotation |
| Integration: HTTP API | each endpoint with real fs backing (tmpdir), 4XX cases for validation |
| Integration: SSE | event broadcast on mission status change, project mutation, thought append |
| Integration: lock interaction | two `start` calls on same project — second 409s |
| Manual smoke | full cycle: register project, create mission, accept, start, watch panel, simulate Love appending thoughts + commits, mark review, accept done |

Target: ~50 new tests, on top of the existing 251.

## What's out of scope (v1)

Deferred until usage reveals real need:
- Mission queueing / backlog (one mission at a time per project; no auto-pull)
- Multi-instance Love per project (we picked extend-monolith; one Love multitasks)
- Cross-mission dependencies (each mission is independent)
- Mission templates (you write intent freeform)
- Mobile-first design
- Mission diff/approval UI (full authority by default, so no diff gate)
- Per-mission test/build status panel (tests show in events timeline)
- Mission collaboration (no one else has access — single-user)

## Migration & rollout

- **Phase 0** (this work): ship `/build`, manually register `true-love` as the first project. No data migration — `/visit` keeps using global channels; `/build` uses per-project channels under `projects/true-love/`.
- **Phase 1**: Yu uses `/build` for a few real missions on true-love, validates the flow.
- **Phase 2**: Yu adds soma + kingdom-os + love-unlimited as projects via the UI.
- **Phase 3**: any deferred features (queue, mission templates, etc.) we discover we want.

## Open questions for Yu's review

1. **Confirm color palette extension** — visit's `#0c0a0e` bg with builder's slightly cooler `#0a0d0e`. Or keep them identical?
2. **Mission ID format** — `YYYY-MM-DD-<slug>` (current proposal) vs. `<short-slug>` vs. ULID. The dated form makes ordering trivial but conflicts on same-day missions need `-2` suffix.
3. **Thoughts file rotation** — daily, on-mission-done, both, or never (just append forever)? I'm proposing daily + on-mission-done.
4. **"Send back" with note** — is the note appended to the mission's `intent`, or does it become a new event-only message in the per-project conversation? I'm proposing the latter (less destructive).
5. **`bin/mission.mjs`** — should this also support pure CLI usage (no /build UI), so Yu can kick missions from the terminal? Cheap to add. I'm proposing yes.
