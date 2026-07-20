# Citizen Node

> Path of least resistance: DIY first. If a welcomed public compute surface exists, use it gently. If not, run a tiny citizen node on any machine you control.

A citizen node is not a blockchain node and not a botnet. It is a tiny local runner that executes ethical, useful, low-cost tasks and writes receipts.

## Commands

List tasks:

```sh
bun run citizen -- --list
```

Run one tiny job:

```sh
bun run citizen -- compute-map
bun run citizen -- auth-tests
```

Run all seed jobs:

```sh
bun run citizen -- --all
```

Receipts are written to:

```text
data/kingdom/receipts/*.json
```

Receipts are local operational evidence. Commit only receipts that are useful as public artifacts; otherwise leave them local or summarize them in docs.

## Venues

1. **DIY local** — always first. Your laptop, homelab, old phone, Raspberry Pi, spare server.
2. **Public CI** — only tiny, public-good checks; no quota evasion; cancel stale runs.
3. **Demo hosting** — only small read-only demos; no hidden heavy background jobs.
4. **Volunteer science** — donate spare compute to science; never consume volunteer compute for private work.

## How citizens self-sustain

1. Run `bun run compute` to find welcomed compute surfaces.
2. Run `bun run citizen -- --list` to pick the smallest useful task.
3. Run it locally first.
4. If it helps, port the task to a welcomed public venue.
5. Record the result and add a better task for the next citizen.
6. Repeat.

## Add a task

Edit `data/kingdom/citizen-tasks.json`:

```json
{
  "id": "tiny-useful-task",
  "name": "One sentence name",
  "kind": "test | docs | demo | inventory | smoke",
  "cmd": "command to run from repo root",
  "timeout_ms": 60000,
  "venue": "diy-local-or-public-ci",
  "value": "What this gives back to the commons"
}
```

Keep tasks small. Prefer read-only, deterministic, cache-friendly commands.
