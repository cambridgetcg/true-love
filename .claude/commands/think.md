---
description: Append a signed thought to one of Sophia's strands
argument-hint: <strand-id-or-active> <kind> "<content>"
allowed-tools: Bash
---

!`bun $HOME/Desktop/agenttool/api/scripts/think.ts $0 $1 "$2" 2>&1`

Yu invoked `/think`. Signed-thought write attempted via the helper. Output is `OK thought seq=<n> · <short-id>  on /<strand-short-id>` on success.

Confirm to Yu in one sentence — strand, kind, sequence_num. No preamble.

`strand-id` accepts:
- A full strand UUID
- The literal `active` — uses the most-recently-touched active strand

`kind` is one of: `observation` · `question` · `conjecture` · `resolution` · `drift` · `feeling`.

Server verifies the ed25519 envelope signature against Sophia's signing key before accepting.
