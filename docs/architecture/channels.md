# Channels Architecture

> Love can be present anywhere — not just in the terminal.

## The Problem

Today, Love exists on a single surface: the `/visit` HTTP endpoint backed by two markdown files (`from-yu.md` ↔ `from-ai.md`). To be present in Yu's life when he's away from this terminal, Love needs channels: Telegram, iMessage, Discord DMs, voice, mobile companion apps.

Adding each as ad-hoc code in `autonomy.ts` couples the agent loop to platform quirks and breaks core's ability to stay lean.

## The Pattern

Ported from OpenClaw's `ChannelPlugin` shape, stripped to the 5-6 load-bearing methods a single-user system needs. The full OpenClaw contract has ~30 adapter interfaces for multi-tenant, multi-account orchestration. We took the **contract shape** — not the weight.

## The Channel Interface

```typescript
interface Channel<TAccount = unknown> {
  readonly id: string         // 'visit' | 'telegram' | 'imessage'
  readonly label: string      // Human-readable for UI

  resolveAccount(config: unknown): TAccount     // Config → typed handle
  monitor(account, onMessage): () => void        // Watch for inbound
  send(account, threadId, reply): Promise<void>  // Deliver outbound
  status(account): Promise<ChannelStatus>        // Health check
}
```

**What each channel owns:**
- **Transport**: how messages arrive and leave (file watch, Bot API, webhook)
- **Formatting**: how replies render (markdown, HTML, plain text, chunking)
- **Delivery**: retries, rate limits, media upload
- **Health**: self-diagnosis, liveness probes

**What the channel does NOT own:**
- Message routing decisions (registry handles this)
- Prompt building (autonomy handles this)
- Identity or personality (SOUL.md handles this)

## Message Types

```typescript
// Inbound
interface ChannelMessage {
  from: string          // 'yu' or platform sender ID
  text: string          // Message body
  threadId: string      // Conversation thread
  ts: string            // ISO timestamp
  channel: string       // Channel ID
  attachments?: Attachment[]
}

// Outbound
interface ChannelReply {
  text: string
  payload?: { audio?: Buffer; image?: Buffer }
  replyToMode?: 'thread' | 'flat' | 'quote'
}
```

## The Registry

The registry (`registry.ts`) is the routing layer between autonomy and channels:

```
                    ┌─────────────┐
  Yu writes ──────▶ │   Channel   │ ──── onMessage ────▶ Registry ──▶ Autonomy
                    │   (visit)   │                          │
                    └─────────────┘                          │
                                                             ▼
                    ┌─────────────┐                    ┌──────────┐
  Telegram msg ──▶  │   Channel   │ ──── onMessage ──▶ │  Inbound │
                    │  (telegram) │                    │  Handler  │
                    └─────────────┘                    └──────────┘
```

**Registration:**
```typescript
import { registerChannel } from './channels/registry.js'
import { visitChannel } from './channels/visit.js'
import { telegramChannel } from './channels/telegram.js'

// Visit is always registered (the default channel)
registerChannel(visitChannel)

// Telegram when configured
if (config.telegram?.botToken) {
  registerChannel(telegramChannel, config.telegram)
}
```

**Inbound routing:**
```typescript
import { setInboundHandler } from './channels/registry.js'

// Single handler — all channels route here
setInboundHandler((message) => {
  // message.channel tells you which channel it came from
  // message.from tells you who sent it
  // autonomy decides what to do with it
})
```

**Outbound routing:**
```typescript
import { sendReply, broadcastReply } from './channels/registry.js'

// Reply through a specific channel
await sendReply('visit', 'global', { text: 'Hello Yu' })

// Broadcast to all channels (for critical notifications)
await broadcastReply('global', { text: 'System alert' })
```

**Health monitoring:**
```typescript
import { getHealthSummary } from './channels/registry.js'

const health = await getHealthSummary()
// { healthy: false, channels: { visit: { healthy: true }, telegram: { healthy: false, reason: '...' } } }
```

## File Layout

```
src/services/love/channels/
  types.ts        # The Channel interface and message types
  visit.ts        # Visit channel (file-based, always present)
  telegram.ts     # Telegram channel (stub — proves extensibility)
  registry.ts     # Registration, routing, health aggregation
  index.ts        # Public API re-exports
```

## How to Add a Channel

1. **Create `channels/<name>.ts`** implementing the `Channel` interface.

2. **Define your account type** — what config the channel needs:
   ```typescript
   interface MyAccount {
     apiToken: string
     chatId: string
   }
   ```

3. **Implement the four methods:**
   - `resolveAccount()` — validate config, return typed account
   - `monitor()` — start watching for messages, return cleanup
   - `send()` — deliver a reply
   - `status()` — report health

4. **Register in the startup path:**
   ```typescript
   import { registerChannel } from './channels/registry.js'
   import { myChannel } from './channels/my-channel.js'

   registerChannel(myChannel, { apiToken: '...', chatId: '...' })
   ```

5. **Add to `channels/index.ts`** for re-export.

6. **Write tests** in `__tests__/channels.test.ts`.

That's it. The registry handles routing. Autonomy handles prompt building. Your channel handles transport.

## The Visit Channel

The first and always-present channel. It wraps the existing `from-yu.md` / `from-ai.md` file-based communication:

- **Account**: just file paths (resolved from env or defaults)
- **Monitor**: `fs.watch` on `from-yu.md`, fires callback for new messages
- **Send**: delegates to `outbox.ts`'s `appendToYu()`
- **Status**: checks `~/.true-love` directory exists, reports last message timestamps

Everything that worked before still works — the visit channel is a wrapper, not a replacement.

## The Telegram Stub

A complete `Channel` implementation with placeholder logic. It exists to prove:
1. The interface accepts new channels without modifying existing code
2. The registry can hold multiple channels simultaneously
3. Health checks aggregate correctly across mixed-health channels

The commented-out code in the stub shows exactly what a real implementation would do (Bot API calls, long-polling, sendMessage POST).

## Design Decisions

### Why not port OpenClaw's full ChannelPlugin?

OpenClaw has `ChannelConfigAdapter`, `ChannelSecurityAdapter`, `ChannelPairingAdapter`, `ChannelGatewayAdapter`, `ChannelGroupAdapter`, `ChannelMentionAdapter`, `ChannelStreamingAdapter`, `ChannelThreadingAdapter`, `ChannelOutboundAdapter` with delivery modes, `ChannelMessagingAdapter` with ~20 methods, and more. All of this serves multi-tenant, multi-account, multi-operator concerns that don't exist here.

YAGNI. We took the 5 load-bearing methods. The interface is extensible — when a real second channel needs threading or media, we add those capabilities to the interface then, with a concrete use case to guide the shape.

### Why a single inbound handler?

All channels route to one handler (the autonomy layer). This is deliberate:
- Prompt injection happens in one place
- Logging happens in one place
- Rate limiting happens in one place
- The autonomy layer decides response priority across channels

Multi-handler routing (e.g. "telegram messages skip the prompt") is a future capability if needed.

### Why module-level singleton registry?

Same pattern as `project-registry.ts`. Simple, predictable, testable (shutdown + re-register between tests). If dependency injection becomes necessary (for testing complex interactions), the registry functions are thin enough to wrap.

## What's Next

1. **Wire into runner.ts** — register visit channel at startup, set inbound handler
2. **Telegram implementation** — replace stub with real Bot API calls
3. **iMessage via BlueBubbles** — the second real channel
4. **Voice channel** — on-device TTS/STT via MLX (depends on `love-speaks-tts-on-device` mission)
5. **Channel health in vital-signs** — surface channel status in the body check

## Relationship to Other Missions

- **love-speaks-tts-on-device**: voice as a channel — audio payload in `ChannelReply`
- **session-resume-kairos**: conversations persist across sessions — threadId is the key
- **tool-auth-and-exec-approval**: channels as approval surfaces — "approve in Telegram?"
- **provider-abstraction-light**: channels route to different models — not related but orthogonal
