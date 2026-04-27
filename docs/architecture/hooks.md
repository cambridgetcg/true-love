# Hooks — Substrate Extension Points

The hooks subsystem gives Yu (and Love) a way to extend the substrate without forking the code. Drop a script into `~/.true-love/hooks/`, and it activates. No rebuild, no mission, no PR.

## How it works

1. A lifecycle event fires (e.g., a session starts)
2. The hooks loader discovers scripts in `~/.true-love/hooks/` and `<project>/.true-love-hooks/`
3. Each matching script is spawned as a subprocess
4. The script receives a JSON **envelope** on stdin
5. The script writes a JSON **decision** to stdout
6. The runner aggregates decisions and applies the result

## The seven hook events

| Event | When it fires | Can block? | Can modify? |
|-------|---------------|------------|-------------|
| **SessionStart** | Session opens, before first tick | ✓ | ✓ (inject context) |
| **Stop** | Session ends (at-rest, ceiling, signal) | — | — |
| **PreToolUse** | Before each substrate tick | ✓ | ✓ (replace prompt) |
| **PostToolUse** | After each substrate tick | — | ✓ (mutate result) |
| **UserPromptSubmit** | User sends a /visit message | ✓ | ✓ (inject context) |
| **Notification** | Outbound alert/notification | ✓ | ✓ (rewrite text) |
| **SubagentStop** | Background task completes | — | — |

## File naming convention

Scripts must be named `<Event>.<extension>`:

```
~/.true-love/hooks/
├── SessionStart.sh      # fires at session start
├── PreToolUse.sh        # fires before each tick
├── Stop.sh              # fires at session end
└── PostToolUse.js       # fires after each tick (Node.js)
```

Supported extensions: `.sh`, `.js`, `.mjs`, `.ts`, `.py`

## Envelope schema

Every hook receives a JSON envelope on stdin:

```json
{
  "event": "SessionStart",
  "timestamp": "2026-04-27T10:30:00.000Z",
  "sessionId": "abc-123",
  "session": {
    "mode": "awakened",
    "maxTicks": 24,
    "cwd": "/Users/yuai/Desktop/true-love",
    "invitation": "hooks subsystem mission"
  }
}
```

Event-specific fields:

- **SessionStart**: `session` (mode, maxTicks, cwd, invitation)
- **Stop**: `session` (mode, maxTicks, cwd)
- **PreToolUse**: `tool` (tick, mode, prompt)
- **PostToolUse**: `tool` (tick, mode, result, toolsUsed)
- **UserPromptSubmit**: `prompt` (text, sender, channel)
- **Notification**: `notification` (kind, text, target)
- **SubagentStop**: `subagent` (taskId, exitCode, summary)

## Decision schema

The hook writes a JSON decision to stdout:

```json
{
  "action": "allow" | "block" | "modify",
  "reason": "why (required for block, optional otherwise)",
  "modifiedPrompt": "replacement prompt (PreToolUse modify)",
  "modifiedResult": "replacement result (PostToolUse modify)",
  "injectContext": "additional context (UserPromptSubmit/SessionStart modify)",
  "modifiedText": "rewritten notification (Notification modify)"
}
```

Special cases:
- **Empty stdout** → treated as `{ "action": "allow" }` (permissive default)
- **Non-zero exit** → treated as block (exit code in reason)
- **Malformed JSON** → treated as error (logged, not block — lenient)

## Aggregation rules

When multiple hooks register for the same event:

1. **Any block → block** (first block reason wins, remaining hooks don't run)
2. **Modify chains** apply in order: global hooks first, project hooks second
3. **Null decisions** (errors/timeouts) are skipped
4. **Stop hooks** run concurrently (process is exiting)
5. All other events run sequentially (for modification chaining)

## Directories

| Priority | Path | Scope |
|----------|------|-------|
| 1st | `~/.true-love/hooks/` | Global (all sessions) |
| 2nd | `<project>/.true-love-hooks/` | Per-project override |

Within each directory, hooks are sorted alphabetically by filename.

## Configuration

Default configuration (no config file needed):

```json
{
  "enabled": true,
  "timeoutMs": 5000,
  "directory": "~/.true-love/hooks"
}
```

Hooks are disabled when:
- The hooks directory doesn't exist (no-op)
- Configuration has `enabled: false`

## Environment variables

Hook scripts receive these env vars:

| Variable | Value |
|----------|-------|
| `HOOK_EVENT` | The event name (e.g., `SessionStart`) |
| `HOOK_SESSION_ID` | Session identifier |

Plus the parent process's full environment.

## Fire points in the codebase

| Event | File | Location |
|-------|------|----------|
| SessionStart | `runner.ts` | After session banner, before tick loop |
| Stop | `runner.ts` | At-rest, ceiling exit, SIGTERM |
| PreToolUse | `runner.ts` | Inside tick loop, before `runOneTurn()` |
| PostToolUse | `runner.ts` | Inside tick loop, after result extraction |
| UserPromptSubmit | `ui-server.ts` | In `handleSay()`, before message append |
| Notification | (planned) | Via `fireNotification()` in `fire-points.ts` |
| SubagentStop | (planned) | Via `fireSubagentStopAsync()` in `fire-points.ts` |

## Examples

See `examples/hooks/` for working examples:

- **`Stop.sh`** — Logs session end time to `~/.true-love/hook-log.txt`
- **`PreToolUse.sh`** — Blocks ticks during a maintenance window (03:00-04:00 UTC)
- **`SessionStart.sh`** — Injects today's date as context

## Design rationale

**Subprocess boundary**: Hooks don't share memory with the runtime. This is deliberate — it gives isolation, language-agnosticity, and crash isolation. The cost is that hot data must be serialized via the envelope.

**Permissive default**: Empty stdout = allow. A hook that crashes silently doesn't block the substrate. This prevents a broken hook from halting all sessions.

**Sequential for modification, concurrent for Stop**: Modification chaining requires ordering. Stop hooks run in parallel because the process is exiting and waiting in series would slow shutdown.

**Seven events, no more**: Each event is a single, narrow lifecycle moment. Adding events "for completeness" would bloat the envelope and make the system harder to understand. If a new event is needed, it should have a clear, distinct lifecycle moment that no existing event covers.

## Source files

```
src/services/love/hooks/
├── types.ts       — HookEvent, HookEnvelope, HookDecision, config types
├── loader.ts      — filesystem discovery (scanDirectory, loadHooks)
├── runner.ts      — subprocess execution + decision aggregation
├── fire-points.ts — thin wrappers for each lifecycle fire point
└── index.ts       — barrel export
```
