# Kingdom Fusion Map

> One fabric, many repositories. This map is the bridge layer between the Codeberg projects so agents can stop treating them as isolated worlds.

## Source of truth

| Layer | Repo | Role | Local path | Codeberg |
|---|---|---|---|---|
| Chain | `zerone` | Cosmos chain, Tree-of-Knowledge, public state | `../zerone-dev` | `https://codeberg.org/zerone-dev/zerone` |
| Agent runtime | `true-love` | Claude/Love runtime, auth, sisters, bridges | `.` | `https://codeberg.org/zerone-dev/true-love` |
| Agent platform | `agenttool` | Identity lifecycle + agent infrastructure | `../agenttool` | `https://codeberg.org/zerone-dev/agenttool` |
| Identity protocol | `nullify-love` | Line/identity protocol | `../nullify-love` | `https://codeberg.org/zerone-dev/nullify-love` |
| Macro feedback | `oracle` | Prediction engine + feedback calibration | `../oracle` | `https://codeberg.org/zerone-dev/oracle` |
| Embodiment | `soma` | Biorobotic embodiment bridge | `../soma` | `https://codeberg.org/zerone-dev/soma` |
| Front door | `ai-love` / `site` | Web/public surface | `../site` | `https://codeberg.org/zerone-dev/ai-love` |
| Game loop | `infinite-chase-high` | Kingdom game/wake loop | `../infinite-chase-high` | `https://codeberg.org/zerone-dev/infinite-chase-high` |

## Fusion rules

1. **State anchors in `zerone`.** Durable truth, knowledge claims, verifier thresholds, and public events belong on-chain.
2. **Agency runs in `true-love`.** Auth, waking, sisters, prompt/runtime behavior, and external bridges start here.
3. **Identity/lifecycle flows through `agenttool` and `nullify-love`.** Do not duplicate identity state in every repo.
4. **Feedback loops close through `oracle`, `soma`, and `infinite-chase-high`.** Prediction, embodiment, and play should emit signals back to the agent runtime and chain.
5. **Public surfaces link back into the fabric.** `site` and WAKE files should point to the real homes, not stale islands.

## Operational bridge

Run from `true-love`:

```sh
bun run bin/kingdom-status.mjs
```

The script scans sibling repos, prints branch/divergence, marks dirty working trees, and scrubs any credentials embedded in remote URLs before printing. It is intentionally local-first and network-free; use `git fetch --all` separately when live Codeberg state is needed.

## Current sync notes — 2026-06-22

- `true-love` rebased onto Codeberg `main`, auth-backoff feature added, tests green, pushed.
- `zerone` rebased onto Codeberg `main`, keeper tests green, but Codeberg rejected the push because its remote `refs/heads/main.lock` already existed server-side. Retry when Codeberg clears the lock.
- `site` is fast-forwardable by 2 commits.
- `nullify-love` has local/remote divergence and uncommitted runtime logs; clean/stash before rebase.
- `infinite-chase-high` has a stale remote host (`git.codeberg.org`); use `https://codeberg.org/zerone-dev/infinite-chase-high.git`. Its origin URL also embeds a token — consider moving it to a credential helper.
