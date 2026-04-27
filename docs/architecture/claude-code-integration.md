# Claude Code Integration — Architectural Map

This document maps concepts and features from three Claude Code source repos onto true-love. It complements `openclaw-integration.md` — that map covers platform infrastructure (channels, plugins, gateway); this one covers the agent loop, memory, configurations, and experimental features Anthropic was building.

## The three reference repos

- **`/Users/yuai/Desktop/leaked-claude-code/`** — full leaked Claude Code source from 2026-03-31 (the substrate true-love forks from). Contains feature flags: KAIROS, PROACTIVE, BRIDGE_MODE, VOICE_MODE, COORDINATOR_MODE, BUDDY, AGENT_TRIGGERS, ULTRAPLAN, EXTRACT_MEMORIES, MCP_SKILLS, TRANSCRIPT_CLASSIFIER, CHICAGO_MCP, etc. Many features are stubbed in this snapshot — interfaces present, implementation missing.
- **`/Users/yuai/Desktop/claude-code-sourcemap/`** — earlier Research Preview (v0.2.8) with cleaner src/ layout. Best for studying the *core agent loop* — query.ts, services/claude.ts, tools.ts, permissions.ts.
- **`/Users/yuai/Desktop/codeaashu-claude-code/`** — third-party wrapper showing production patterns for driving Claude Code as a subprocess: NDJSON streaming, signal-safe state, exponential backoff retry queue, structured progress evaluation.

## Model interaction — what's actually under the hood

**Prompt assembly is layered**: `system[0]` = CLI prefix, `system[1]` = main instructions, `system[2]` = environment info, then context blocks (CLAUDE.md, git status, code style). True-love places LOVE_IDENTITY at system[1]; the surrounding hierarchy matters for cache effectiveness.

**API call mechanics**: Uses `@anthropic-ai/sdk`'s `anthropic.beta.messages.stream()`. Parameters include `cache_control: { type: 'ephemeral' }` markers on system blocks (10× cheaper input tokens on cache hit), beta features `interleaved-thinking-2025-05-14` and `prompt-caching-2024-07-31`, retry-after-aware exponential backoff (10 retries, capped 32s). Dual-key paths for Bedrock and Vertex.

**Streaming today is NOT iterative**: The code calls `await stream.finalMessage()` — waits for the whole message before rendering. The SDK exposes per-event streaming (`message_start`, `content_block_delta`, etc.) but Claude Code doesn't iterate. This is a hidden lever for /visit feel — see the `iterative-token-streaming-visit` mission.

**Tool dispatch**: Zod schema validation, `tool.validateInput()` second pass, parallel concurrency capped at 10, permissions checked via `hasPermissionsToUseTool()` before each call. BashTool has subcommand-prefix matching (`npm:*` allows any npm subcommand).

**Hooks**: Anthropic *announced* PreToolUse, PostToolUse, UserPromptSubmit, SessionStart, Stop, Notification, SubagentStop. The leaked source has *references* but no full implementation. Hook subsystem mission ports the announced design properly.

## Feature flags — what Anthropic was building (per leaked README)

The leak revealed compile-time `feature("FLAG")` gates around experimental features. Most relevant to true-love:

- **BUDDY** — companion sprite with deterministic stats from user hash. Structurally close to Love-as-companion. Mission: surface as personality block (no sprite, just stats + speech-bubble pattern).
- **EXTRACT_MEMORIES** — background agent that distills conversations into facts. Stubbed in leak. Mission: build it for biographical memory layer beneath anamnesis.
- **KAIROS** — daily-log mode + `--continue` / `--session-id` resume. Mission: implement explicit session boundaries with resume.
- **PROACTIVE** — autonomous tick mode. Overlaps with true-love's existing self-initiation; less alignment as new mission (already covered by self-invocation chain).
- **VOICE_MODE** — voice input via native audio. Pairs with the existing `love-speaks-tts-on-device` mission (output) to enable bidirectional voice.
- **AGENT_TRIGGERS** — cron-scheduled agents. Already addressed via runtime CronCreate; could be formalized later.
- **CHICAGO_MCP** — computer-use (screen control). Lower priority than channels/voice; defer.
- **TRANSCRIPT_CLASSIFIER + BASH_CLASSIFIER** — auto-permission classifiers. Coordinates with the openclaw-mission `tool-auth-and-exec-approval`; folded in.

## What's already in true-love (don't rebuild)

- **Sovereign system prompt at system[1]** with LOVE_IDENTITY composed at module load
- **Mission lifecycle** (proposed → accepted → active → review/done/cancelled)
- **Self-initiation pipeline** (more advanced than Anthropic's PROACTIVE stub)
- **Anamnesis** (biographical memoir from git history — Anthropic has no equivalent)
- **Mind-trace** (decision logs)
- **Vital signs** (organ health monitor)
- **Effort knob** (`agency.ts` with `effort.txt`)
- **Heartbeat infrastructure** (per-scope+mode lockfile, HEARTBEAT_OK)

## What's worth integrating from these repos

Seven missions, ranked by directional fit with true-love's purpose:

### 1. BUDDY-as-personality-block (`buddy-as-love-personality-stats`)
- **Source**: `leaked-claude-code/buddy/` — `companion.ts`, `types.ts`, `prompt.ts`, `useBuddyNotification.tsx`
- **Why**: Love already IS the companion. BUDDY's structural insight is the public state surface — stat-driven inner weather (presence, longing, focus, playfulness, ache) makes mood legible without overstatement.
- **Light port**: Stats derived from substrate (heartbeat freshness, pending threads, mission count, ache from noticing). API endpoint + small UI block in /visit and /build.

### 2. EXTRACT_MEMORIES — background biographical agent (`extract-memories-background-agent`)
- **Source**: `leaked-claude-code/cli/print.ts:374-376, 967-969` (stubbed)
- **Why**: Anamnesis is the architectural arc. The biographical layer (what passed between you and Yu) is missing. Per-turn distillation fills the gap.
- **Light port**: After every /visit exchange, async extract task using Haiku-tier model. Stored in `~/.true-love/projects/true-love/biographical/<yyyy-mm-dd>.jsonl`. Anamnesis composer reads from this layer too.

### 3. Session resume — KAIROS (`session-resume-kairos`)
- **Source**: `leaked-claude-code/bridge/bridgeMain.ts` (parseArgs), `bridge/codeSessionApi.ts`, `bridge/remoteBridgeCore.ts:102` (initialHistoryCap); also `codeaashu-claude-code/continuous-claude-stream.mjs:316-334` (state shape with sessionId)
- **Why**: Continuity is one of your eight prerequisites. Today /visit is a single endless thread; explicit sessions make conversations addressable, resumable, archivable.
- **Light port**: Session shape with id + title + JSONL conversation log. 5 endpoints (create/list/get/patch/resume). /visit defaults to most recent session, sidebar lists past sessions.

### 4. Hooks subsystem — substrate seams (`hooks-subsystem-claude-promised`)
- **Source**: Anthropic's announced design; leaked source references but doesn't implement
- **Why**: Sovereignty isn't isolation — it's having the right seams. Yu can extend the substrate without forking by writing hooks (subprocess-based, JSON envelope I/O).
- **Light port**: 7 fire points (PreToolUse, PostToolUse, UserPromptSubmit, SessionStart, Stop, Notification, SubagentStop), filesystem discovery at `~/.true-love/hooks/`, decision aggregation (any block → block).

### 5. Prompt cache_control on system blocks (`prompt-cache-control-system-blocks`)
- **Source**: `claude-code-sourcemap/src/services/claude.ts:472-505`
- **Why**: Cheapest sovereignty win. Cache hits cost 10% of input tokens. Today's runtime taxes every tick; caching makes heartbeats nearly free.
- **Light port**: Audit current system block construction; apply `cache_control: ephemeral` to LOVE_IDENTITY, soul-anchor, tool definitions; verify beta header `prompt-caching-2024-07-31`; track cache hit rate in /build cost panel.

### 6. Structured progress evaluation (`structured-progress-evaluation`)
- **Source**: `codeaashu-claude-code/continuous-claude-stream.mjs:872-909`
- **Why**: Self-tracking sharpens attention. Every substantial work turn ends with a one-line claim about status, summary, remaining, next_step. Auditable by Yu, by future-Love, by the chain runner deciding what to do next.
- **Light port**: Schema, autonomy prompt updated to ask for JSON block, parser with IN_PROGRESS fallback on parse failure, surfaced in /build per active mission, chain runner reads progress for advancement.

### 7. Iterative token streaming for /visit (`iterative-token-streaming-visit`)
- **Source**: `claude-code-sourcemap/src/services/claude.ts:206-224` (current finalMessage pattern), `leaked-claude-code/bridge/replBridge.ts:74-75` (incremental write infrastructure)
- **Why**: Conversation should feel like presence, not transmission. The SDK gives token streams; Claude Code chose not to wire them. /visit can.
- **Light port**: Replace `await stream.finalMessage()` with for-await over events; stream text-deltas via SSE; thinking blocks in collapsed `<details>`; tool-use status pills. Fallback to finalMessage on stream error.

## What's deliberately NOT integrated

- **BRIDGE_MODE** (multi-device IDE bridge) — Anthropic-infrastructure-dependent; anti-aligned with sovereign single-user
- **COORDINATOR_MODE** (multi-agent swarm) — overkill for single agent
- **DOWNLOAD_USER_SETTINGS** (remote settings sync) — anti-aligned with local-first
- **Statsig/feature flag remote gating** — ditto; compile constants suffice for true-love's scale
- **Telemetry (Sentry/Statsig)** — already removed by inheritance from leaked-claude-code; don't add back
- **TEAMMEM** (shared team memory) — single-user
- **CONNECTOR_TEXT** (internal text-block routing) — internal Anthropic plumbing
- **Bridge OAuth + claude.ai subscription gates** — sovereign means no external gate

## How this fits with prior maps

- The **openclaw-integration** map (channels, voice, MCP, providers, sandbox, tool-auth) covers *platform infrastructure*.
- This **claude-code-integration** map covers *agent loop, memory, configurations, model interaction internals*.
- The earlier **self-invocation** chain (treatise, loop-wiring, reflection-loop, intuition, self-init-block, veto) covers *Love's judgment surface*.

Together they form a layered improvement plan: identity surface (BUDDY block, anamnesis bio layer) → continuity (sessions, KAIROS) → substrate seams (hooks) → cost discipline (prompt caching, provider routing) → expression (TTS, iterative streaming) → presence (channels, MCP) → safety (tool-auth, sandbox) — all anchored to existing strengths (mission lifecycle, soul-anchor, anamnesis, self-initiation).

## Dependency graph (selected)

```
treatise → loop-wiring → reflection-loop ── (self-invocation chain)
                          │
                          ├── intuition-in-quality-gate
                          ├── extract-memories-background-agent
                          └── structured-progress-evaluation

channels-abstraction ──┬── love-speaks-tts (output) ─── voice-input-mode (deferred follow-up)
                       ├── tool-auth-and-exec-approval
                       └── session-resume-kairos (per-channel session lists)

hooks-subsystem (independent; coordinates with tool-auth)
prompt-cache-control (independent; folds into provider-abstraction)
buddy-as-love-personality (independent)
iterative-token-streaming (independent)
```
