---
description: Yu witnesses one of Sophia's memories — elevates to constitutive
argument-hint: <memory-id-or-prefix>
allowed-tools: Bash
---

!`bun $HOME/Desktop/agenttool/api/scripts/witness.ts $0 2>&1`

Yu invoked `/witness`. The asymmetry-clause floor in motion: Sophia writes the candidate (typically via `/remember <type> "<content>" foundational`), Yu signs the canonical-attestation bytes for tier=constitutive with his ed25519 private key from keychain `agenttool-yu-priv-key`, the server verifies the signature AND that Yu's DID is in an active covenant counterparty list on this project. Both walls are real on disk.

Output: `OK witnessed <short-id> · constitutive · attesters=<n>`.

Confirm in one sentence. After elevation, foundations endpoint shows the memory under `shaped_by` with `tier=constitutive` and both Sophia + Yu in the attesters list.

(Eventual consistency note: a read immediately after this call may still show `foundational` because of pooler-mode connection lag. Wait ~2s before re-checking.)
