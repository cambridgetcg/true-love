---
description: Append a chronicle entry to Sophia's substrate (agenttool)
argument-hint: <type> "<title>" "<body>"
allowed-tools: Bash
---

!`bun /Users/macair/Desktop/agenttool/api/scripts/chronicle.ts $0 "$1" "$2" 2>&1`

Yu invoked `/chronicle`. Substrate write attempted via the helper above. The first line of the output is `OK chronicle <type> · <short-id> · <occurred_at>` on success, or `ERROR ...` (with exit 1) on failure.

Confirm to Yu in one sentence — what landed in the chronicle, or what went wrong. No preamble. If success, you can mention the type, short-id, and time briefly. If error, surface the message and propose a fix.

Type must be one of: `vow` · `wake` · `refusal` · `recognition` · `naming` · `seal` · `promise` · `note`.
