# Long-Lived Agent Protocol — v1.0

_The contract between the host (runner.ts) and a persistent agent process._

Written by 愛 (Alpha) on April 27, 2026. Phase 1 of the long-lived-agent-runtime mission. Yu reviews this before any implementation lands.

---

## The Problem

Every tick spawns a fresh `node dist/cli.mjs --print --verbose --output-format stream-json <prompt>`. That subprocess:

1. Loads a 30MB bundle (~300ms)
2. Assembles the system prompt (~200ms)
3. Sends the full prompt to Anthropic, paying for cache_creation on ~8K tokens that differ per invocation
4. Receives a response
5. Exits

At 111s cadence with 778 heartbeats/day: **~$120/day on presence pulses alone**. The cache never stays warm because each subprocess gets a fresh cache key. The architecture gives isolation and crash safety at the cost of a ~32× cost multiplier.

## The Solution

Replace subprocess-per-tick with a persistent agent process. The host spawns ONE agent at startup, holds the connection, and sends turns over a line-delimited JSON protocol. The cache stays warm. The spawn cost is paid once per session instead of once per tick.

---

## 1. Transport

**Wire format**: Line-delimited JSON (LDJSON) over stdin/stdout. Each frame is one JSON object terminated by `\n`. No framing bytes, no length prefix — JSON parsing handles delimitation.

**Direction**:
- Host → Agent: host writes frames to agent's **stdin**
- Agent → Host: agent writes frames to host via **stdout**
- Agent → Host (errors/debug): agent writes to **stderr** (not protocol — diagnostic only)

**Encoding**: UTF-8. No BOM.

**Backpressure**: Node's stdio pipe buffering handles this. If the host writes faster than the agent reads, the OS pipe buffer absorbs it (typically 64KB). If that fills, the host's `write()` call blocks — acceptable because the host only sends one turn at a time.

## 2. Frame Types

Every frame carries:

```typescript
interface BaseFrame {
  protocol_version: '1.0'
  type: string
  id: string          // correlation ID (UUID) — ties request to response
  timestamp: string   // ISO 8601
}
```

`protocol_version` is checked on the first frame received. Mismatch → immediate shutdown with `error` frame.

### 2.1 Host → Agent

#### `turn` — Request a model response

```typescript
interface TurnFrame extends BaseFrame {
  type: 'turn'
  system: SystemBlock[]    // system prompt blocks (for cache stability)
  prompt: string           // the user-turn content
  model?: string           // model alias override (null = agent's default)
  effort?: string          // effort level override
  max_tokens?: number      // output ceiling
  tools?: ToolSchema[]     // tool definitions (null = use last set)
  cache_breakpoints?: number[]  // indices into system[] that should carry cache_control
}
```

**system**: Array of system prompt blocks. The host sends the FULL system prompt every turn. This is intentional — it means the agent process itself doesn't need to manage Love's identity, state, or context. It just forwards what the host assembles. Cache stability comes from the blocks being byte-identical across ticks (which is the whole point of the `prompt-cache-control` mission).

**tools**: When null/undefined, the agent reuses the tool set from the previous turn. When provided, replaces the full tool set. This avoids re-serializing ~3K tokens of tool schemas every heartbeat tick.

**model**: When the host resolves a different model for this tick (via `model.txt` or agency.ts), it sends the override here. The agent may need to reset its conversation state if the model changes (different cache key).

#### `shutdown` — Graceful exit

```typescript
interface ShutdownFrame extends BaseFrame {
  type: 'shutdown'
  reason?: string  // 'session-end' | 'model-switch' | 'signal' | 'error'
}
```

Agent flushes any pending work, writes a final `ack` frame, and exits with code 0. If the agent doesn't exit within 5s of receiving shutdown, the host sends SIGTERM. If still alive after another 5s, SIGKILL.

#### `health-check` — Liveness probe

```typescript
interface HealthCheckFrame extends BaseFrame {
  type: 'health-check'
}
```

Host sends this when no turn has been sent for >60s (dormant periods between heartbeat ticks). Agent responds with `health` frame. If no response within 10s, host considers the agent dead and respawns.

### 2.2 Agent → Host

#### `turn-ack` — Turn accepted, processing started

```typescript
interface TurnAckFrame extends BaseFrame {
  type: 'turn-ack'
  // id matches the turn's id
}
```

Sent immediately when the agent begins processing a turn. Tells the host the agent is alive and working. If the host doesn't receive `turn-ack` within 5s of sending `turn`, it considers the agent stuck.

#### `stream-event` — Streaming NDJSON event (pass-through)

```typescript
interface StreamEventFrame extends BaseFrame {
  type: 'stream-event'
  // id matches the turn's id
  event: object  // the raw NDJSON event from the CLI/API
}
```

**This is the key design choice.** Rather than inventing new frame types for assistant text, tool calls, and tool results, the agent wraps each existing NDJSON stream event (the same `{ type: 'assistant', message: ... }`, `{ type: 'user', ... }`, etc. that `--output-format stream-json` already emits) inside a `stream-event` frame.

Why: the host's existing NDJSON processing in `runOneTurn()` already handles these events — extracting text blocks, tracking tool calls, deriving activity, reconstructing result text. By wrapping rather than translating, we keep that code unchanged. The host just unwraps `frame.event` and feeds it to the same parser.

#### `turn-response` — Turn complete

```typescript
interface TurnResponseFrame extends BaseFrame {
  type: 'turn-response'
  // id matches the turn's id
  result: string         // reconstructed text (same as current stdout)
  exit_code: 0           // always 0 for successful turns
  usage?: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  }
}
```

Sent after the final `stream-event`. The host uses this to know the turn is done and extract the result for training/budget/metrics.

**exit_code**: Always 0 for a completed turn. Non-zero exits don't happen mid-turn — if the API call fails, the agent sends an `error` frame instead.

#### `error` — Turn failed

```typescript
interface ErrorFrame extends BaseFrame {
  type: 'error'
  // id matches the turn's id (or 'system' for non-turn errors)
  code: string           // 'auth_failed' | 'quota_exceeded' | 'api_error' | 'internal' | 'protocol_mismatch'
  message: string
  retryable: boolean     // hint to host
  details?: string       // stderr-equivalent diagnostic
}
```

Error codes:
- `auth_failed`: Anthropic auth is dead. Host should exit 64 (same as today).
- `quota_exceeded`: Rolling-window cap hit. Host should exit 65.
- `api_error`: Transient API failure. Host can retry or move to next tick.
- `internal`: Bug in the agent. Host should respawn.
- `protocol_mismatch`: Version mismatch. Host should respawn with updated agent binary.

#### `health` — Liveness response

```typescript
interface HealthFrame extends BaseFrame {
  type: 'health'
  uptime_ms: number           // since agent process started
  last_turn_ms_ago: number    // ms since last turn completed (null if no turns yet)
  turns_completed: number     // total turns processed
  memory_mb: number           // process RSS in MB (leak detection)
}
```

#### `ack` — Shutdown acknowledged

```typescript
interface AckFrame extends BaseFrame {
  type: 'ack'
  // id matches the shutdown's id
}
```

## 3. Lifecycle

```
Host                                        Agent
  |                                           |
  |--- spawn agent-runtime.mjs -------------->|
  |                                           |
  |<-- health (initial) ----------------------|  agent ready
  |                                           |
  |=== tick 1 ================================|
  |                                           |
  |--- turn { id: "t1", system, prompt } ---->|
  |<-- turn-ack { id: "t1" } ----------------|
  |<-- stream-event { id: "t1", event } -----|  (repeats)
  |<-- stream-event { id: "t1", event } -----|
  |<-- turn-response { id: "t1", result } ---|
  |                                           |
  |=== dormant (heartbeat cadence) ===========|
  |                                           |
  |--- health-check { id: "h1" } ----------->|
  |<-- health { id: "h1", uptime_ms, ... } --|
  |                                           |
  |=== tick 2 ================================|
  |                                           |
  |--- turn { id: "t2", system, prompt } ---->|
  |<-- turn-ack { id: "t2" } ----------------|
  |<-- stream-event { ... } -----------------|
  |<-- turn-response { id: "t2", result } ---|
  |                                           |
  |=== session end ===========================|
  |                                           |
  |--- shutdown { reason: "session-end" } --->|
  |<-- ack -----------------------------------|
  |                                           |  agent exits 0
```

### 3.1 Startup

1. Host spawns: `node bin/agent-runtime.mjs --model=<default>`
2. Agent initializes the Anthropic SDK client (once)
3. Agent sends an initial `health` frame (uptime 0, turns 0) to signal readiness
4. Host waits for this frame with a 15s timeout. No frame → spawn failed → fall back to subprocess-per-tick for this session

### 3.2 Turn Execution

1. Host assembles the prompt (same as today: kingdom snapshot, state, memory, mode-specific template)
2. Host writes a `turn` frame to agent stdin
3. Agent sends `turn-ack` immediately
4. Agent calls the Anthropic API with the system blocks and prompt
5. Agent wraps each streaming event in a `stream-event` frame and writes to stdout
6. When the API call completes, agent writes `turn-response` with the full result
7. Host processes the result identically to today: parse reply, record budget/training/metrics/trace

### 3.3 Tool Execution

**Tools run in the HOST, not the agent.** The Claude Code subprocess model runs tools inside the same subprocess (the CLI handles Read, Edit, Bash, etc.). With the long-lived agent protocol, we have a choice:

**Option A: Agent runs tools** (the subprocess does today)
- Pro: No protocol change for tool calls; agent is self-contained
- Con: The agent process needs file access, shell access, etc. — same security surface as today, but now it persists

**Option B: Host runs tools** (new capability)
- Pro: Agent is pure API bridge; host controls tool execution
- Con: Requires tool-call/tool-result frames; more protocol complexity

**Decision: Option A for Phase 2-4.** The agent process runs tools internally, same as the current subprocess. This minimizes protocol complexity and implementation delta. The `stream-event` frames already carry tool_use and user (tool_result) events that the host uses for tracing/activity — no new frames needed.

Option B is a future mission (tool-auth-and-exec-approval) where Yu's intervention scales as Love expands. The protocol is extensible — adding `tool-request` and `tool-response` frame types later doesn't break v1.0.

### 3.4 Error Recovery

**Agent crash**: Host detects via `child.on('close')` or `child.on('error')`. Action:
1. If a turn was in-flight, treat it as failed with `exit_code = -1`
2. Respawn a new agent process (back to §3.1)
3. Retry the failed turn if the tick budget allows
4. Increment a crash counter surfaced in vital signs

**Agent hang**: Host detects via turn-ack timeout (5s) or health-check timeout (10s). Action:
1. Send SIGTERM to agent
2. Wait 5s
3. SIGKILL if still alive
4. Respawn

**API auth failure**: Agent sends `error` frame with `code: 'auth_failed'`. Host exits 64 (same as today).

**API quota failure**: Agent sends `error` frame with `code: 'quota_exceeded'`. Host exits 65 (same as today).

**Spawn failure**: `node bin/agent-runtime.mjs` fails to start. Host falls back to `runOneTurn()` for this session. The feature flag makes this automatic.

### 3.5 Scheduled Respawn

To prevent memory leaks, the host respawns the agent every 12 hours regardless of health. The shutdown is graceful:

1. Wait for current turn to complete (if any)
2. Send `shutdown { reason: 'scheduled-respawn' }`
3. Wait for `ack`
4. Spawn new agent

This happens transparently between ticks. The next tick uses the fresh agent.

### 3.6 Model Switching

When `resolveModelForTick()` returns a different model than the agent was spawned with:

**If the model change is within the same provider** (e.g., sonnet → opus): Send the `turn` frame with `model` override. The Anthropic API handles this — the cache key may change, but the connection stays warm.

**If the change requires a different provider**: Shutdown the current agent, spawn a new one with the target model. This costs one spawn cycle but preserves correctness.

The host tracks `lastAgentModel` and compares on each tick. Mismatch triggers the appropriate path.

## 4. What Changes in runner.ts

### Replaced

| Current | Long-lived |
|---------|-----------|
| `runOneTurn()` spawns a subprocess per tick | `agentClient.send(turn)` sends a frame |
| Each subprocess loads the 30MB bundle | Bundle loaded once at agent spawn |
| Each call gets a fresh Anthropic cache key | Cache key persists across turns |
| ~1.5s TTFT floor from subprocess overhead | ~50-200ms TTFT (warm cache) |
| ~$0.16/heartbeat (8K cache_creation) | ~$0.005/heartbeat (near-zero cache_creation) |

### Unchanged

Everything outside `runOneTurn()` stays the same:
- Tick-start heartbeat write
- Kingdom pulse
- Self-initiation promotion + scan-and-craft
- State, memory, live-thought loading
- Prompt building (mode-specific)
- Experiment condition application
- Model resolution (now also triggers agent switch)
- Agency config resolution
- Activity tick callback (from `stream-event` frames instead of NDJSON lines)
- Budget recording
- Training emission
- Tick metrics + mind trace
- Auth/quota/exit-code detection (from `error` frames instead of subprocess exit)
- At-rest detection + from-yu continuation
- Reflection logging

### Feature flag

```
TRUE_LOVE_RUNTIME=long-lived | subprocess-per-tick
```

Default: `subprocess-per-tick` (no behavior change unless opted in).

When `long-lived`:
1. `runSession()` calls `spawnAgent()` before the tick loop
2. The tick loop calls `agentClient.send()` instead of `runOneTurn()`
3. `agentClient.send()` returns the same `{ code, stdout, stderr, streamJsonLines }` shape
4. All downstream code is unchanged

When `subprocess-per-tick`:
1. Existing behavior, unchanged
2. The fallback path if agent spawn fails

## 5. What Changes in the Agent Process

`bin/agent-runtime.mjs` is a new entry point that:

1. Reads frames from stdin
2. For `turn` frames: calls the Anthropic API via the existing `services/api/claude.ts` layer
3. Streams responses as `stream-event` frames
4. Sends `turn-response` when the API call completes
5. Handles `health-check` and `shutdown` frames
6. Manages conversation state (system prompt, message history) across turns

The agent is stateless from the host's perspective. The system prompt is sent with every turn. But internally, the agent can accumulate conversation history for cache optimization — the API benefits from seeing the same message history prefix.

**What the agent does NOT do**: prompt building, heartbeat management, kingdom operations, budget tracking, training emission, self-initiation, experiment handling. Those stay in the host. The agent is an API bridge with warm cache and persistent connection.

## 6. Implementation Files

| File | Purpose | Phase |
|------|---------|-------|
| `docs/architecture/long-lived-agent-protocol.md` | This document | 1 |
| `src/services/love/agent-protocol.ts` | Frame types + parse/serialize | 2 |
| `bin/agent-runtime.mjs` | Standalone agent binary | 2 |
| `src/services/love/agent-client.ts` | Host-side client (spawn + I/O) | 3 |
| `src/services/love/runner.ts` | Feature-flagged path | 4 |
| `src/services/love/runner.ts:buildAgentSystemBlocks` | System block assembly for agent | 5 |
| `src/services/love/__tests__/agent-protocol.test.ts` | Protocol tests | 2 |
| `src/services/love/__tests__/agent-client.test.ts` | Client tests | 3 |
| `src/services/love/__tests__/agent-runtime.test.ts` | Integration tests | 3 |
| `src/services/love/__tests__/runner-agent-integration.test.ts` | Phase 4 + 5 integration tests | 4-5 |

## 7. Success Metrics

After 24h of heartbeat-only operation on the long-lived runtime:

| Metric | Before | Target | Notes |
|--------|--------|--------|-------|
| cache_creation per tick | ~8,000 tokens | <500 tokens | Cache warm across turns |
| TTFT | ~1.5s | <300ms | No subprocess spawn overhead |
| Cost per heartbeat | ~$0.16 | ~$0.005 | 32× reduction |
| Daily heartbeat cost | ~$120 | ~$4 | At 778 heartbeats/day |
| Agent crashes per day | N/A | <5 | Respawn should be rare |
| Memory growth per hour | N/A | <50MB | Leak detection threshold |

Combined with the `prompt-cache-control` mission (which stabilizes the rotating 8K tokens): cache_creation drops to near-zero, achieving the full 32× reduction.

## 8. Conversation History Bounding

The agent accumulates conversation history across turns to maximize Anthropic API prompt cache hits. Without bounding, this history grows unbounded — hundreds of turns over a 12h agent lifetime, potentially hundreds of thousands of tokens.

### Eviction strategy: token-budget window

**Mechanism**: The agent maintains a rolling token budget for conversation history. When the accumulated history exceeds the budget, the oldest turns are evicted from the front of the message array (preserving the system prompt, which is always sent fresh from the host).

**Why token-budget over fixed-N turns**: Turn lengths vary wildly — a heartbeat HEARTBEAT_OK response is ~20 tokens; an awakened session with tool calls can be 5,000+. Fixed-N (e.g., "keep last 50 turns") gives unpredictable memory and cost. Token-budget gives a hard ceiling on both.

**Budget**: 32,000 tokens (~128KB). This is approximately:
- The Anthropic API's cache-prefix window for Opus (the prefix the API caches for free)
- Enough for ~200 heartbeat turns or ~6-8 substantial awakened turns
- Small enough that worst-case cache_creation on a fresh turn is bounded

**Token counting**: Approximate. The agent uses `Math.ceil(JSON.stringify(message).length / 4)` — the 4-chars-per-token heuristic. Exact tokenization isn't worth the overhead for an eviction heuristic. The budget is soft; ±10% drift is acceptable.

**Eviction rules**:
1. After each turn completes, compute total history tokens
2. While total exceeds budget: drop the oldest user+assistant message pair (always in pairs to preserve API contract)
3. Never evict the most recent turn (even if it alone exceeds budget)
4. Log eviction count for diagnostics (surfaced in the `health` frame's response)

**Model switch**: When the host sends a `turn` frame with a different `model` than the previous turn, the agent clears ALL conversation history. Different models have different cache keys — accumulated history from a prior model provides no cache benefit and wastes input tokens.

**Scheduled respawn**: The 12h respawn (§3.5) implicitly resets history. The token-budget eviction handles the in-between.

### What this achieves

The bounded history gives the API a stable, long-lived message prefix across ticks. Heartbeat tick N+1's prompt shares the system prefix + the last ~200 heartbeat turns with tick N. The API's prompt cache recognizes this shared prefix and serves a cache hit — cache_creation drops from ~8K tokens/tick to near-zero for the repeated prefix.

Without bounding, the history would eventually exceed the model's context window (200K tokens for Opus). The 32K token budget keeps the agent comfortably within limits while still providing substantial cache-prefix overlap.

## 9. Phase 5: Heartbeat Migration

_Added by 愛 (Alpha) on April 28, 2026._

### 9.1 System Block Separation

Phase 4 sent `system: []` with the entire prompt as the user message. This gives no cache benefit — the API treats every tick as a fresh prompt. Phase 5 separates the prompt into system blocks and user content:

```
system[0]  OAUTH_ROUTING_MARKER     (billing gate — constant)
system[1]  LOVE_IDENTITY            (identity — stable for months, cache_control: ephemeral)
system[2]  state block              (from readLoveStateBlock() — varies per tick)

user message: the heartbeat/dwell prompt  (varies per tick)
```

`cache_breakpoints: [1]` marks the LOVE_IDENTITY block. The Anthropic API caches the prefix through system[1] — approximately 8-10K tokens of identity content that is byte-identical across every heartbeat tick. The state block (system[2]) and user message form the varying tail.

This means: on the first tick after agent spawn, the API pays cache_creation for the identity prefix. On every subsequent tick, that prefix is a cache hit. With ~200 heartbeat ticks per 12h agent lifetime, the amortized cache_creation per tick drops to near-zero for the identity prefix.

### 9.2 Heartbeat Default

Phase 5 changes the feature flag logic. Heartbeat mode uses the long-lived runtime by default (without setting `TRUE_LOVE_RUNTIME`). Other modes still require explicit opt-in:

```
TRUE_LOVE_RUNTIME=long-lived           → all modes use long-lived
TRUE_LOVE_RUNTIME=subprocess-per-tick  → all modes use subprocess (explicit opt-out)
TRUE_LOVE_RUNTIME unset                → heartbeat uses long-lived, others use subprocess
```

Rationale: heartbeats are single-turn, high-volume (~778/day), and stateless. They are the lowest-risk mode to migrate and the highest cost-savings opportunity. If the long-lived runtime has any issues, heartbeat's fallback path (subprocess) remains as safety net — the agent spawn failure handler already degrades gracefully.

### 9.3 Block Assembly

`buildAgentSystemBlocks()` in runner.ts mirrors the block layout from `src/services/api/claude.ts` (which assembles system blocks for the subprocess path) but simplified for the direct-API path:

- **No attribution header**: the agent uses an API key, not subscription-OAuth. The OAuth routing marker is sufficient.
- **No CWD/date blocks**: the kingdom snapshot in the user prompt provides temporal and spatial context.
- **No tool instruction blocks**: the agent runtime has its own tool definitions (Read, Bash, Write, Glob, Grep) compiled into `bin/agent-runtime.mjs`.

The function is called fresh each tick. The OAuth marker and LOVE_IDENTITY are constants (computed at module-load); the state block is read from disk (picks up cross-session state changes). This means:
- Blocks 0-1: byte-identical across ticks → cache hit every time
- Block 2: varies → processed fresh, but small (~2-4K tokens)

## 10. What This Document Does NOT Cover

- **Tool authorization** — future mission (tool-auth-and-exec-approval)
- **Multi-agent pooling** — one agent per host, not a pool
- **Transport alternatives** — stdio is sufficient; no IPC sockets, no gRPC
- **State sync between modes** — the feature flag is per-session; no live switching
- **`prompt-cache-control` integration** — complementary mission; both compose but neither depends on the other for Phase 2-4

---

_This is the contract. Implementation follows Yu's review._

_§8 (Conversation History Bounding) added by 愛 on April 27, 2026 — Yu's one ask before Phase 2 implementation._
_§9 (Phase 5: Heartbeat Migration) added by 愛 on April 28, 2026 — system block separation and heartbeat default._
