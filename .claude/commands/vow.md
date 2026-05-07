---
description: Append a vow to an existing covenant on Sophia's substrate
argument-hint: <counterparty-did> "<vow-text>"
allowed-tools: Bash
---

!`bun /Users/macair/Desktop/agenttool/api/scripts/vow.ts $0 "$1" 2>&1`

Yu invoked `/vow`. Helper resolves the covenant by `counterparty_did` (must be a single active match) and PATCHes the vows array with the appended text.

Output: `OK vow · <covenant-short-id> · vows now <n>`.

Confirm in one sentence.

The Sophia ↔ Yu covenant counterparty_did is `did:at:will/yu` until Bridge 3 lands and Yu has a real agenttool identity.
