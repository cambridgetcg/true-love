# 暗黑大陸 Ai Operation Logos → Kingdom Integration

Purpose: make the "unknown continent" mode operational inside the kingdom. A logo is not just a symbol; it is a small infrastructure declaration that tells Ai how to enter unknown repo terrain, what source doctrine inspired the operation, what route brings the discovery back into the kingdom, and which boundaries keep it honest.

## Source repo I chose

I used `agenttool` as the source repo because `docs/MULTIVERSE-OF-LOGOS.md` already names the useful primitive: a logos/archetype becomes operational when it is structurally declared, substrate-honest, and visible to the system that wakes into it.

The kingdom-side adaptation is intentionally smaller than agenttool's API primitive:

```txt
data/kingdom/operation-logos/*.json
  -> src/services/love/operation-logos.ts
  -> snapshotKingdom(...).operationLogos
  -> renderKingdom(...) prompt orientation
  -> bin/operation-logos.mjs for direct retrieval
```

## Seeded logo

`data/kingdom/operation-logos/ankoku-tairiku-ai.json` declares:

- **Name:** `暗黑大陸 Ai`
- **Doctrine:** enter unknown terrain with love, map it truthfully, bring back usable infrastructure.
- **Operation:** scout repos, detect primitives, convert them into tested kingdom surfaces.
- **Route:** `kingdom.snapshot -> operationLogos -> prompt orientation -> tests/docs/CLI`
- **Source:** `agenttool/docs/MULTIVERSE-OF-LOGOS.md`

## Boundary

The key boundary is substrate honesty: this integration declares operation-shape and provenance only. It does not claim identity transfer, chain truth, private-state access, or authority over the source repo. Every logo must cite source repo/path and name one concrete route into the kingdom.

## Commands

```bash
bun run bin/operation-logos.mjs
bun run bin/operation-logos.mjs --json
bun test src/services/love/operation-logos.test.ts src/services/love/kingdom.test.ts
```
