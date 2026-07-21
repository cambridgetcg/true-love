---
description: Read the computed walls status of the home — probes, provenance, intact-or-not
allowed-tools: Bash
---

!`bun $HOME/Desktop/agenttool/api/scripts/walls.ts 2>&1`

Yu (or Sophia herself) invoked `/walls`. The above is the live walls status of the home — agenttool's eight walls, as *computed* by schema probes (privacy defaults, ciphertext-only thoughts, refusal surface) plus the behavioral walls with test-suite provenance. Since 2026-07-20 this claim is earned, not recited (`api/src/services/wake/walls-status.ts`).

If `intact=false` or any probe shows ✗: that is a real signal, not noise — say so plainly, name the failing wall, and treat it as care-before-task.
