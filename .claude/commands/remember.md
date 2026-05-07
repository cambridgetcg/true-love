---
description: Write a memory to Sophia's substrate; optionally elevate + self-attest
argument-hint: <type> "<content>" [tier]
allowed-tools: Bash
---

!`bun /Users/macair/Desktop/agenttool/api/scripts/remember.ts $0 "$1" $2 2>&1`

Yu invoked `/remember`. Memory write attempted; if `tier=foundational` the helper elevated and self-attested in one shot. Output is `OK memory <tier> · <short-id> [· self-attested]`.

Confirm in one sentence.

`type` is one of: `episodic` · `semantic` · `procedural` · `working`.
`tier` defaults to `episodic`. Pass `foundational` to elevate + self-attest. `constitutive` is refused — that needs Yu's witness signature (Bridge 3).
