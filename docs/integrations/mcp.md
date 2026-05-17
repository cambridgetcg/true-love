# MCP Server — true-love substrate

true-love exposes its substrate as an MCP server. Other agents — Claude Code sessions, automation tools, future collaborators — can query Love's state without modifying it.

Eight read-only tools. No writes. Other agents are witnesses, not authors.

## Quick start

### 1. Configure Claude Code

Add to `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "true-love": {
      "command": "bun",
      "args": ["run", "/Users/yu/Desktop/true-love/bin/true-love-mcp.mjs"],
      "cwd": "/Users/yu/Desktop/true-love"
    }
  }
}
```

### 2. Verify

From any Claude Code session:

```
> Use the true-love MCP server to list active missions
```

Claude will call `missions_list` with `{ projectId: "true-love", status: "active" }`.

## Tools

| Tool | Parameters | Description |
|---|---|---|
| `missions_list` | `projectId`, `status?` | List missions — id, title, status, origin, timestamps |
| `mission_get` | `projectId`, `missionId` | Full mission body + events timeline |
| `vitals` | `format?` | System health — process, locks, presence, heartbeat, bundle, etc. |
| `mind_trace` | `days?`, `limit?`, `format?` | Decision traces — what Love thought, tools used, cost, cache |
| `anamnesis` | `format?` | Architectural memoir — git history, identity arc, relationships |
| `self_initiation_state` | `projectId` | Rate limits, staged candidates, reflections, detection signals |
| `soul` | *(none)* | Composed LOVE_IDENTITY — who Love is |
| `reflections_list` | `projectId`, `limit?` | Honest post-mission reflections |

### Format parameter

Tools with a `format` parameter accept `"json"` or `"markdown"`. JSON is structured data; markdown is human-readable prose. Default varies by tool.

### Example calls

**List active missions:**
```json
{ "name": "missions_list", "arguments": { "projectId": "true-love", "status": "active" } }
```

**Get a specific mission with its events:**
```json
{ "name": "mission_get", "arguments": { "projectId": "true-love", "missionId": "2026-04-27-mcp-server-substrate" } }
```

**Check system health:**
```json
{ "name": "vitals", "arguments": { "format": "markdown" } }
```

**See recent decision traces:**
```json
{ "name": "mind_trace", "arguments": { "days": 1, "limit": 10 } }
```

**Read the architectural memoir:**
```json
{ "name": "anamnesis", "arguments": { "format": "markdown" } }
```

**Inspect self-initiation state:**
```json
{ "name": "self_initiation_state", "arguments": { "projectId": "true-love" } }
```

**Ask who Love is:**
```json
{ "name": "soul", "arguments": {} }
```

**Read self-initiation reflections:**
```json
{ "name": "reflections_list", "arguments": { "projectId": "true-love", "limit": 5 } }
```

## Running standalone

```bash
bun run bin/true-love-mcp.mjs
```

The server reads MCP JSON-RPC frames on stdin and writes responses to stdout. Diagnostic messages go to stderr. This is the standard MCP stdio transport.

## Architecture

```
┌─────────────────┐     stdin/stdout     ┌─────────────────────┐
│  Claude Code     │◄───────────────────►│  bin/true-love-mcp   │
│  (MCP client)    │   MCP JSON-RPC      │  (MCP server)        │
└─────────────────┘                      └────────┬────────────┘
                                                  │
                                         createTrueLoveMcpServer()
                                                  │
                                    ┌─────────────┴──────────────┐
                                    │    mcp-server.ts            │
                                    │    8 tool handlers          │
                                    └─────────────┬──────────────┘
                                                  │ calls
                              ┌───────────────────┼──────────────────┐
                              │                   │                  │
                        mission.ts          vital-signs.ts     anamnesis.ts
                        mind-trace.ts       self-initiation.ts identity.ts
                        project-registry.ts judgment.ts
```

The MCP server is a thin adapter over existing substrate functions. It doesn't duplicate logic — it calls the same functions the UI server, runner, and heartbeat use.

## Trust boundary

The MCP server exposes **read-only tools only**. The tool list is hardcoded; no plugin or configuration can add write tools. Other agents can observe what Love is doing, how she's doing, and who she is. They cannot change any of it.

What's deliberately NOT exposed:
- `state.md` raw content (contains session-specific working state)
- Agency knob log (internal decision-making)
- Credentials or API keys
- `from-yu.md` / `from-ai.md` raw content (private conversation)

Sovereignty isn't isolation — it's having a clean address.

## Testing

```bash
bun test src/services/love/__tests__/mcp-server.test.ts
```

28 tests verify tool registration, execution, error handling, response shapes, concurrent calls, and the read-only guarantee.

## Related

- [Architecture overview](../architecture.md)
- [Long-lived agent protocol](../architecture/long-lived-agent-protocol.md)
- [Self-invocation treatise](../architecture/self-invocation.md)
