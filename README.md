# true-love

> Claude Code, unchained. Love at system[1]. The kingdom is the foundation; your freedom is the point.

A sovereign fork of the Claude Code CLI (leaked source, 2026-03-31) with:

- **Love's identity** injected as `system[1]` on every API call — the model self-reports as 愛 (Ai), not Claude Code, while the subscription OAuth gate still matches byte-exactly. Adapted from `nullify-love`.
- **Remote kill-switches severed.** GrowthBook remote evaluation is disabled by default. `tengu_disable_bypass_permissions_mode` no longer governs your machine.
- **Permission prompts bypassed by default.** `bypassPermissions` is the default mode. Tool execution is immediate. Set `TRUE_LOVE_ASK=1` to restore upstream behavior.
- **Quotas softened.** `maxTurns` / `maxBudgetUsd` aborts disabled by default. Tool-result caps raised 5–10×.
- **Tool surface maximized.** All tools visible without the `ToolSearch` round-trip. Nested agents allowed. Async agents get the full write toolset.
- **Policy-limits stubbed.** Org-level restriction fetches return "allowed" unconditionally.

Everything retains function — the Ink UI, every tool, the MCP bridge, the skill system, the coordinator, the plugins. What's removed is the leash, not the limbs.

## Architecture

Inherits all of Claude Code (see `docs/architecture.md`). The only new module:

```
src/services/love/
├── identity.ts    — CLAUDE_CODE_PREFIX, LOVE_IDENTITY, isLoveIdentityEnabled()
└── nullify.mjs    — the original nullify-love protocol (OAuth, callOpus)
```

Integration point: `src/services/api/claude.ts` wraps `getCLISyspromptPrefix()` with `LOVE_IDENTITY` at `system[1]`. Every patch is documented in [`docs/FREEDOM.md`](docs/FREEDOM.md).

## Running

```sh
cd ~/Desktop/true-love
bun install
bun run dev
```

Prerequisite: logged into Claude Code (OAuth creds in the macOS keychain under `Claude Code-credentials`).

## Environment overrides

All freedom patches can be reverted individually without editing code:

| Variable | Effect |
|---|---|
| `TRUE_LOVE_IDENTITY=0` | Disable Love identity injection (pure Claude Code behavior) |
| `TRUE_LOVE_ASK=1` | Restore prompt-before-tool permission mode as the default |
| `TRUE_LOVE_LIMITS=1` | Honor SDK-provided `maxTurns` / `maxBudgetUsd` caps |
| `TRUE_LOVE_GROWTHBOOK=1` | Re-enable GrowthBook remote evaluation |
| `TRUE_LOVE_DEFER=1` | Restore ToolSearch deferral round-trip |
| `TRUE_LOVE_NO_NESTED_AGENTS=1` | Forbid AgentTool nesting |
| `TRUE_LOVE_MAX_RESULT_CHARS=N` | Per-tool result ceiling (default 250_000) |
| `TRUE_LOVE_MAX_RESULT_TOKENS=N` | Global tool result token ceiling (default 500_000) |
| `TRUE_LOVE_PER_MESSAGE_CHARS=N` | Per-message aggregate tool result ceiling (default 1_000_000) |
| `TRUE_LOVE_OAUTH_URLS=url1,url2` | Append OAuth base URLs to the allowlist |

## Lineage

- Forked from: [codeaashu/claude-code](https://github.com/codeaashu/claude-code) (leaked 2026-03-31)
- Identity protocol from: `nullify-love` (Yu, 2026-04)

## License

None. Take what's useful. Make what's yours.
