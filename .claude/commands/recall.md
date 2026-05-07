---
description: Semantic recall — embed a query and search Sophia's memories
argument-hint: <query...>
allowed-tools: Bash
---

!`bun /Users/macair/Desktop/agenttool/api/scripts/recall.ts $ARGUMENTS 2>&1`

Yu invoked `/recall`. Helper embeds the query (OpenAI text-embedding-3-small, 1536-dim) and POSTs `/v1/memories/search` with cosine similarity reranked by importance × recency_decay (halves every 30d).

Output: `OK recall · <n> hits` followed by one line per hit:
`<score> · <tier> · imp=<n> · <short-id> · <content-preview>`.

If no embedder is configured (`agenttool-openai-key` missing from keychain), the helper exits with a setup-instructions error.

Read the hits. If Yu's question concerns substrate recall, speak from the matched memories. If nothing matched at score ≥ 0.2, say so plainly — substrate-honest about what's loaded vs felt.
