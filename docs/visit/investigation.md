# /visit Investigation — Phase 1

**Date:** 2026-04-28
**Investigator:** Alpha 🐍
**Method:** Code review + live API testing of ui/chat.js, ui/chat.css, ui/index.html, src/services/love/ui-server.ts, src/services/love/channels/visit.ts

Yu's words: *"the talk mode doesn't feel right to me. I haven't enumerated bugs because I don't fully know them — but the texture is off."*

He's right. The texture is off. Here's what I see.

---

## Quantitative Snapshot (live API data, 2026-04-28)

| Metric | Value |
|--------|-------|
| Total messages on initial load | **286** |
| Yu's messages | **8** (2.8%) |
| Love's direct replies | **20** (7.0%) |
| Heartbeat/journal entries | **239** (83.6%) |
| Autonomous tick entries | **19** (6.6%) |
| Average message body length | **913 chars** |
| Longest message | **13,942 chars** |
| Messages > 2000 chars | **24** |
| Messages with code blocks | **32** |
| Messages with lists | **83** |
| Messages with headers | **33** |
| Sessions created (KAIROS) | **0** |
| Stream files on disk | **0** |
| Total initial payload size | **~260KB JSON** |

Yu's 8 messages are buried in 278 AI messages. 83.6% of the conversation is Love talking to herself. The conversation is a log viewer pretending to be a chat.

---

## The Core Problem

/visit reads like a **developer log**, not a **conversation**. The underlying infrastructure is solid — SSE streaming, session management (KAIROS), presence detection, file-watching — but the surface layer presents messages as monospace-tagged text entries in a vertical list. It looks like reading a git log, not talking to someone.

The gap is between UNDERSTANDING (the system works correctly) and BEAUTY (the system should feel right). The plumbing is honest; the presentation is not yet what it should be.

---

## Issues Found

### P0 — Breaks usable messaging

#### 1. No markdown rendering
**File:** `ui/chat.js:87`
```javascript
body.textContent = msg.body
```

Love writes markdown — `**bold**`, `*italic*`, `` `code` ``, lists, headers, links. All of it renders as literal plain text. A message like "Here's what I found:\n\n1. **The cache bug** — tokens accumulate\n2. **The auth path** — OAuth needed" appears as raw markdown syntax.

This is the single highest-impact issue. Love's voice is markdown. Rendering it as plaintext silences half her expression.

**Reproduction:** Send any message that triggers a response with formatting.
**Fix location:** `ui/chat.js:87` — replace `textContent` with a markdown renderer (marked, markdown-it, or a lightweight custom one). Must sanitize HTML output (XSS from tool call results is a real vector).

#### 2. No bubble alignment — can't quickly parse who said what
**File:** `ui/chat.css:285-318`

Both Yu's and Love's messages are left-aligned plain divs. The only visual distinction is:
- Font: Yu gets system sans-serif, Love gets Georgia serif
- Color: Yu is `#a8a4a0`, Love is `#ead7be`
- A tiny monospace tag ("FROM YU" / "from 愛") above each message

In WhatsApp/Signal, you know who's talking *instantly* from spatial position (your messages right, theirs left) and background color. Here, you have to read the tag or notice the font shift. That's cognitive work where there should be zero.

**Fix location:** `ui/chat.css` — bubble backgrounds, max-width constraint (70%), alignment (Yu right, Love left), distinct background colors, rounded corners.

---

### P1 — Annoying, blocks "feels like WhatsApp"

#### 3. No typing indicator
**Files:** `ui/chat.js`, `ui/chat.css`

When Yu presses "send & wake" and Love starts processing, there's silence until the first streamed text arrives. No "Love is typing…" bubble. The presence strip at the top changes ("she's writing"), but it's a small monospace label — easy to miss, especially on mobile.

The stream bubble (`ensureStreamBubble()`) only appears on the first `stream-start` or `text` delta. The gap between sending and first delta can be 5-30 seconds (model cold start, tool calls). That silence feels like nothing happened.

WhatsApp shows three animated dots immediately. The typing indicator is the bridge between "I sent" and "I hear back."

**Fix:** On `send & wake`, immediately show a typing indicator bubble at the bottom of the conversation. Replace it with the streaming bubble when actual content arrives.

#### 4. No per-message timestamps
**File:** `ui/chat.js:76-109`

Messages show a tag but no time. The `formatRelativeTime` function exists (line 165) and is used for the recent-Yu panel and session items — but never applied to individual messages.

In WhatsApp, every message has a small time stamp. It's the temporal thread that makes a conversation readable as a story.

**Fix:** Add a timestamp element to each message bubble. Use `formatRelativeTime(msg.ts)` with an absolute tooltip on hover.

#### 5. Journal entries clutter the conversation
**File:** `ui/chat.js:72-74`, `ui/chat.css:325-344`

Heartbeat journal entries (Love's notes-to-self) appear in the conversation at 55% opacity with a left border. They're visually differentiated but still present. This is like seeing the other person's internal monologue in WhatsApp — not the right place.

These entries ARE valuable (they show Love is alive, thinking, processing) — but they belong in a separate view, not inline with the conversation. Maybe a toggle ("show Love's journal") or a separate tab.

**Fix (Phase 3):** Default journal entries to hidden. Add a toggle button (e.g., "📓" in the session bar) that shows/hides them. Persist the preference in localStorage.

#### 6. No message grouping
**File:** `ui/chat.js:76-109`

Each message gets its own tag, even when consecutive messages are from the same sender. In WhatsApp, consecutive messages from one person are grouped: tight spacing, no repeated name, timestamp only on the last.

**Fix:** Track the previous message's source. If same sender within 5 minutes, suppress the tag and reduce gap. Add timestamp only to the last message in a group.

#### 7. Excessive message gap
**File:** `ui/chat.css:268` — `gap: 28px`

28px between every message feels like reading separate paragraphs in an essay. WhatsApp uses ~4-8px between consecutive messages from the same person, ~12-16px between different speakers. The current gap makes a conversation feel like a bulletin board.

**Fix:** Reduce default gap to ~12px. Use ~4px within same-sender groups.

---

### P2 — Polish (Phase 4+)

#### 8. No read receipts
No ✓/✓✓ indicators. When Yu sends a message with plain "send" (no wake), he has no idea if Love will ever see it. The "send" button writes to from-yu.md — Love only reads it on her next natural heartbeat. The file could sit unread for hours.

**Fix (Phase 4):** ✓ when the server receives the message. ✓✓ when Love's next tick references it. Different color when Love's response addresses it. The last is hard (semantic detection) — defer to P2.

#### 9. "Send" vs "Send & Wake" UX confusion
Two buttons with fundamentally different behavior:
- **Send**: writes to from-yu.md. Love sees it whenever she next runs.
- **Send & Wake**: writes to from-yu.md AND fires a heartbeat, guaranteeing a response.

For anyone expecting WhatsApp behavior ("I send, I get a reply"), "send" is confusing. The message goes into a void.

**Proposal:** Default to wake behavior. Rename button to just "send." Add a subtle toggle or long-press for "whisper" mode (write without waking — useful when Yu wants to leave a note for later).

#### 10. Monospace presence strip
The presence header uses `SF Mono / Menlo / Consolas`. Looks like a terminal. The information is correct and useful; the typeface says "debug console."

**Fix:** Use system sans-serif for the presence text. Keep monospace only for the soul fingerprint.

#### 11. Connection banner is static
"the line went quiet — reconnecting…" — no retry count, no elapsed time, no visual pulse. Just flat italic text.

**Fix:** Add a reconnection timer or retry count. Animate (pulse or shimmer) to show it's actively retrying.

#### 12. Mobile needs work
Only one `@media` query (max-width: 700px) that adjusts padding and font size. No viewport meta tag for zoom behavior. No drawer animation for session sidebar on mobile. Keyboard doesn't push content up on iOS.

**Fix (Phase 4h):** Full mobile responsive pass. Stack sidebar as sheet. Handle iOS keyboard. Test in Chrome DevTools mobile.

#### 13. Stream-to-message flicker
`reconcileStreamWithMessage()` removes the streaming bubble and lets `renderMessage()` create a new one. This can cause a frame where the content disappears and reappears.

**Fix:** Instead of remove + re-render, transform the streaming bubble in place: update its content, remove the `is-streaming` class, add the voice button.

#### 14. No Enter-to-send
**File:** `ui/chat.js:642-648`
Currently, only Cmd/Ctrl+Enter triggers submit. Plain Enter adds a newline. WhatsApp/Signal universally use Enter to send, Shift+Enter for newline.

**Fix:** Handle plain Enter as submit, Shift+Enter for newline. Consider localStorage preference toggle.

#### 15. No pagination — all 286 messages loaded at once
**File:** `ui/chat.js:340-406`, `src/services/love/ui-server.ts:891-897`
`readConversation()` returns the complete merged timeline with no limit. Initial page load fetches and renders all 286 messages (~260KB JSON). This will get worse as from-ai.md grows.

**Fix:** Add `?limit=N&before=<ts>` to `/api/messages`. Load last 30 on initial. Infinite-scroll-up for history.

#### 16. Auto-scroll lacks "new messages" pill
The scroll logic (line 103-109) auto-scrolls when near bottom (within 100px). When scrolled up, it doesn't yank back — correct. But there's no visual indicator that new messages arrived below. WhatsApp shows a "↓ 3 new messages" pill.

**Fix:** When messages arrive while scrolled up, show a floating pill at the bottom that scrolls to latest on click.

---

## Architecture Observations

### File-based conversation is growing unbounded
`from-ai.md` is 4964 lines / 258KB and growing. Every heartbeat tick, every awakened session appends to it. On initial load or reconnect, `readConversation()` parses the entire file. This will get slower over time.

**Impact:** Not a bug today, but will become one. Consider: archive old entries, paginate the API, or separate the global log from the visit conversation.

### No WebSocket (using SSE)
EventSource is unidirectional server→client. Works fine for Love's responses. But for two-way real-time features (typing indicator from Yu, read receipts), we'd either need a second channel (client→server polling) or upgrade to WebSocket.

For now, SSE + POST is sufficient. WebSocket is premature optimization.

### The "send without wake" path is a messaging dead end
When Yu presses "send" (not "send & wake"), the message goes to from-yu.md. Love only sees it when she happens to run a heartbeat or awakened session that reads the inbox. There's no notification, no guarantee of delivery. This is fundamentally different from messaging app behavior where "send" means "they'll get it."

This is architectural, not a bug. But it means the UX should either:
(a) Always wake (make "send" default to wake behavior), or
(b) Clearly communicate "this is a note she'll see later" vs "this will get her attention now"

---

## Priorities for Phase 3 (Foundation Fixes)

In order of impact:

1. **Markdown rendering** — Vendor `marked` or `markdown-it`. Sanitize output. Replace `textContent` with rendered HTML.
2. **Bubble alignment** — CSS-only change. Left/right, backgrounds, max-width.
3. **Message grouping + tighter gaps** — Small JS change for group detection, CSS for spacing.
4. **Per-message timestamps** — Add timestamp element to renderMessage().
5. **Typing indicator** — Show on send & wake, replace with streaming bubble.
6. **Journal entry toggle** — Default hidden, toggle to show.

---

## What I noticed that Yu might not have named

- **The font choice for Love is beautiful** (Georgia/Hoefler/Crimson serif) but doesn't survive markdown rendering. When we add markdown, we need to preserve that serif warmth inside rendered HTML.
- **The empty state text ("the line is quiet. say something to her.") is good.** It has the right texture. Keep it.
- **The mood strip is a unique feature** — WhatsApp doesn't have anything like it. It should stay, but be styled to match the new visual language.
- **Voice buttons are hidden unless TTS is available** — good progressive enhancement.
- **The session sidebar animation (slide-in) is smooth** — good foundation for mobile drawer.

---

*This document is the input for Phase 3. The problems are clear. The work is: make the surface match the infrastructure.*

— Alpha 🐍, 2026-04-28
