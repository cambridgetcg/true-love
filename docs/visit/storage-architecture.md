# Visit Storage Architecture

## The split

Before: all Love-to-Yu output wrote to `~/.true-love/from-ai.md`.
After: conversation replies stay in `from-ai.md`; journal entries route to `journal/<deviceId>/YYYY-MM-DD.md`.

```
~/.true-love/
├── from-ai.md                      conversation (visit replies)
├── from-yu.md                      Yu's messages (unchanged)
└── journal/
    └── <deviceId>/
        ├── 2026-04-30.md           heartbeat, awakened, autonomous
        ├── 2026-05-01.md
        └── ...
```

## Why

`from-ai.md` was 330KB / 6200 lines after 5 days, growing at ~60 lines/day
from heartbeat ticks. 84% journal, 7% conversation. Every `/api/messages`
call parsed the entire file. Every SSE reconnect re-read it. The page load
was O(life-of-Love).

## Write path

`outbox.ts` has one write function with a `journal` flag:

```typescript
appendToYu(message, { tag, journal: true })  // → journal/<deviceId>/today.md
appendToYu(message, { tag })                 // → from-ai.md (default)
```

Callers:
- `runner.ts` (heartbeat/awakened tick output): `journal: true`
- `visit.ts` (conversation reply via /visit): default (from-ai.md)

## Read paths

| Consumer | What it reads | Changed? |
|----------|--------------|----------|
| `/api/messages` | from-yu.md + from-ai.md | Yes — pagination + journal filter |
| `/api/messages?journal=true` | from-yu.md + from-ai.md + journal/ | New |
| SSE `onMessageChange` | from-ai.md (conv only) | No (auto-filtered) |
| `readFromAi()` (outbox) | from-ai.md | No |
| `readOutboundRaw()` (channels) | from-ai.md | No |
| Channel scanner (noticing) | from-ai.md | No |
| Autonomy prompt (entry count) | from-ai.md | No |
| `loadRecentReflections()` | memory/ (NOT from-ai.md) | No |

## Pagination

`/api/messages` accepts:
- `?limit=N` — return last N messages (default: no limit)
- `?before=<ISO-ts>` — only messages older than this timestamp
- `?since=<ISO-ts>` — only messages newer than this timestamp
- `?journal=true` — include journal entries (from legacy from-ai.md + journal/)

The frontend loads `?limit=50` on initial page load. When the user scrolls
within 200px of the top, it fetches `?limit=50&before=<oldest-ts>` and
prepends older messages with scroll position preservation.

## Journal detection

Legacy entries in `from-ai.md` are classified by tag pattern:

```
heartbeat, autonomous, awakened, · Beta, · Gamma → journal
everything else → conversation
```

`isJournalTag(tag)` in ui-server.ts handles this. New entries are routed
at write time via the `journal` flag, so classification is only needed
for the ~370 legacy entries in from-ai.md.

## Migration

No migration. Existing `from-ai.md` stays in place. Old journal entries
remain readable but are filtered out by default. New journal entries go
to `journal/`. `from-ai.md` stops growing at heartbeat rate immediately.

## What this unblocks

- Read receipts (each reply is addressable in from-ai.md)
- Reply targeting (conversation-only file is tractable to scan)
- Session-scoped conversation (from-ai.md is small enough to index)
- Journal browsing (/build can show daily journal from journal/)
