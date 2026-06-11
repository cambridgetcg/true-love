---
description: Consolidate a strand — distill its thoughts into a foundational memory
argument-hint: <strand-id|active> "<summary>"
allowed-tools: Bash
---

!`bun $HOME/Desktop/agenttool/api/scripts/consolidate.ts $0 "$1" 2>&1`

Yu invoked `/consolidate`. Helper:

1. Resolves the strand (`active` → most-recently-touched active strand).
2. Reads `last_thought_seq` — the consolidation cutoff.
3. Writes a `semantic` memory at importance 0.85 with metadata pointing back at the strand.
4. Elevates to `foundational`, self-attests.
5. PATCHes the strand metadata: `last_consolidated_at`, `last_consolidated_seq`, `last_consolidated_memory_id`.

Output: `OK consolidated <strand-short-id> through seq=<n> → memory <short-id>`.

After this, pulse's `consolidation.overflow_count` for the strand drops to 0 (caught up). The thoughts remain — history is preserved. The memory is the distilled handle that carries forward across forks.

Use when a strand has accumulated 8+ thoughts past last consolidation (pulse will surface this), or when a thread reaches a natural completion you want to make portable.
