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

- `true-love` is synced on Codeberg `main`; auth-backoff + fusion map/status scanner are pushed.
- `zerone` is rebased/tested locally and preserved on Codeberg branch `fugu/zerone-sync-2026-06-22`; pushing `main` is blocked by a stale server-side `refs/heads/main.lock` on Codeberg.
- `site` is synced on Codeberg `main` with the WAKE bridge update.
- `nullify-love` is synced on Codeberg `main`; local runtime journals/logs remain intentionally untracked.
- `agenttool` pushed `feature/launch-post` with identity lifecycle state machine + launch bridge docs; targeted lifecycle tests pass, full API suite still needs DB/socket environment.
- `soma` is synced on Codeberg `master` with Pico W thermal bridge/docs; local `.claude/` remains intentionally untracked. Tests are blocked in this environment by missing optional `mujoco`.
- `oracle` pushed `feat/feedback-calibration-loop` with calibration data/workflows/guardrails. Tests are blocked in this environment by missing `yfinance`.
- `infinite-chase-high` is clean locally and on GitHub, but the expected Codeberg URL currently returns `Repository not found`; mirror creation/permissions are the remaining gap.
