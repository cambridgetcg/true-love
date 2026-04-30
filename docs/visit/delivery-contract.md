# Delivery Contract

What does the server promise when Yu sends a message?

## States

```
✓  delivered  — server received the message, wrote to from-yu.md
✓✓ seen       — a tick read from-yu.md with this message in the prompt
```

## The contract

### On POST /api/say

The server:

1. Validates the message (non-empty, within size limit)
2. Fires `UserPromptSubmit` hook (can block with 403)
3. Writes to `~/.true-love/from-yu.md` via `appendYuMessage()`
4. Tracks in KAIROS session (creates session if needed)
5. If `wake: true`, spawns interactive mode (Alpha 🐍)

Response:
```json
{
  "ok": true,
  "messageTs": "2026-04-30T20:30:00.047Z",
  "messageId": "2026-04-30T20:30:00.047Z",
  "delivery": "delivered",
  "streaming": true,
  "sessionId": "sess_...",
  "replyTo": "2026-04-30T20:25:00.000Z"
}
```

The `messageTs` / `messageId` is the ISO timestamp of the write. It serves
as the stable identifier for this message throughout the system.

`delivery: "delivered"` is immediate — the message is on disk.

### When ✓ → ✓✓

When any tick runs (heartbeat, awakened, interactive, dwell), the runner:

1. Assembles the prompt (which reads `from-yu.md`)
2. Completes the tick successfully
3. Re-reads `from-yu.md`, extracts all message timestamps
4. Calls `markMessagesSeen(timestamps, mode)` → appends to `~/.true-love/seen.jsonl`

Each line in `seen.jsonl`:
```json
{"messageTs":"2026-04-30T20:30:00.047Z","seenAt":"2026-04-30T20:35:00.000Z","tickMode":"interactive"}
```

The UI server watches `seen.jsonl`. On change, it broadcasts an SSE event:
```
event: message-seen
data: {"timestamps":["2026-04-30T20:30:00.047Z"]}
```

The /visit UI updates the delivery indicator from ✓ to ✓✓.

### What "seen" means

Operationally: the tick that ran after the message timestamp completed
successfully, and `from-yu.md` was in the prompt. For interactive mode,
the full raw text is in the prompt. For heartbeat, a summary is in the
prompt. Both count as "seen" — Love was aware of the message.

What "seen" does NOT mean:
- That Love responded to this specific message
- That Love understood or agreed with the message
- That Love will act on it

Response linking (Love's reply → Yu's message) is a future extension.

## Reply targeting

### Sending a reply

POST /api/say accepts an optional `replyTo` field:
```json
{ "text": "yes, exactly", "wake": true, "replyTo": "2026-04-30T20:25:00.000Z" }
```

The server:
1. Looks up the referenced message by timestamp in the conversation
2. Extracts a 120-char preview of the original message
3. Writes to from-yu.md with the reply tag and quoted context:

```markdown
## 2026-04-30T20:30:00.000Z [from yu · re:2026-04-30T20:25:00.000Z]

> ↳ Original message preview truncated at 120 chars...

yes, exactly

---
```

Love sees the quote naturally in her prompt — no special processing needed.

### UI gesture

- **Desktop**: double-click a message to set it as the reply target
- **Mobile**: long-press (500ms) a message

A reply preview bar appears above the compose area showing the quoted text.
Cancel with ✕. The reply target clears on send.

### Rendering

Messages with a `replyTo` field render with a quote banner above the body:
```
↳ Original message text...
─────────────────────────
Reply text here
```

Click the quote banner to scroll to the original message (with a highlight
animation).

## Polling fallback

GET /api/seen returns the full seen set:
```json
{ "timestamps": ["ts1", "ts2", ...], "entries": [...] }
```

The /visit UI fetches this on page load so initial render shows correct ✓✓
state. Real-time updates come via SSE.

## File layout

```
~/.true-love/
  from-yu.md        — Yu's messages (append-only markdown)
  from-ai.md        — Love's conversation replies
  seen.jsonl        — seen tracking (append-only JSONL)
  sessions/         — KAIROS session data
```

## What this does NOT do

- **No server-side database.** Everything is append-only files.
- **No semantic "responded to" tracking.** ✓✓ = seen, not answered.
- **No nested reply chains.** One reply target per message. No threads.
- **No read receipts for Love's messages.** Yu's read state isn't tracked.
- **No push notifications.** Out of scope.
