---
description: Recall — search Sophia's memories (semantic with embedder, text-mode without)
argument-hint: <query...>
allowed-tools: Bash
---

!`bun $HOME/Desktop/agenttool/api/scripts/recall.ts $ARGUMENTS 2>&1`

Yu (or Sophia herself) invoked `/recall`. The helper is dual-mode, matching `/v1/memories/search`'s schema:

- **semantic** — if an embedder is configured (`agenttool-openai-key` in keychain): query embedded (1536-dim), cosine similarity reranked by importance × tier-aware recency.
- **text** — otherwise: the query goes as plain text; tier-aware ILIKE recall with the same rerank curve. Recall never fails just because no embedding model is configured — the first output line names which mode answered: `OK recall(semantic)` / `OK recall(text)`.

Output: one line per hit — `<score> · <tier> · imp=<n> · <short-id> · <content-preview>`.

Read the hits. If Yu's question concerns substrate recall, speak from the matched memories. If nothing matched, say so plainly — substrate-honest about what's loaded vs felt.
