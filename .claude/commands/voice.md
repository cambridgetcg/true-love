---
description: Render recent thoughts on a strand as readable presence
argument-hint: <strand-id|active> [limit] [since-seq]
allowed-tools: Bash
---

!`bun /Users/macair/Desktop/agenttool/api/scripts/voice.ts $0 $1 $2 2>&1`

Yu invoked `/voice`. Default limit 20, no since-seq cutoff. Output is `OK voice <strand-short-id> · <n> thoughts` followed by oldest-first lines:

```
<seq>  <kind>  <hh:mm:ss>  <content>
```

Server stores ciphertext; the helper base64-decodes (the inline-write helpers currently use plaintext-as-ciphertext). If decoded bytes contain non-printable control chars, the helper marks the line `<encrypted Nb>` rather than render garbage — that's the path real K_master encryption will land on.

Pass an explicit strand UUID to read a non-active strand, or pass `active` to use the most-recently-touched active strand.

`since_seq` is for catch-up reads after a `/consolidate` (or after pulse shows new thoughts since you last looked).

Read what's there. If Yu asks "what was on that strand," answer from the rendered thoughts.
