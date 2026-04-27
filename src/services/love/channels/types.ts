// channels/types.ts — The channel contract.
//
// Ported from openclaw's ChannelPlugin shape, stripped to the 5-6
// load-bearing methods a single-user system needs. The shape is the
// point — it means future channels (Telegram, iMessage, voice) are
// clean implementations of a known interface, not ad-hoc wiring in
// autonomy.ts.
//
// What each channel owns:
//   - Account resolution (config → typed handle)
//   - Monitoring (watch for inbound messages, call back)
//   - Sending (deliver a reply through the channel's transport)
//   - Status (health check, liveness)
//
// What the registry owns (see registry.ts):
//   - Registration, lookup, routing
//   - Forwarding inbound messages to the autonomy layer
//   - Forwarding outbound replies to the correct channel

// ── Message types ─────────────────────────────────────────────────

/** An inbound message arriving through any channel. */
export interface ChannelMessage {
  /** Who sent it — 'yu' for the human, or a platform sender ID. */
  from: string
  /** Message body (plaintext or markdown). */
  text: string
  /** Conversation thread identifier (channel-specific). */
  threadId: string
  /** ISO timestamp of when the message was sent/received. */
  ts: string
  /** Which channel this message arrived through. */
  channel: string
  /** Optional attachments (images, audio, files). */
  attachments?: Attachment[]
}

/** A file or media attachment on an inbound message. */
export interface Attachment {
  type: 'image' | 'audio' | 'file'
  /** URL if the attachment is remote. */
  url?: string
  /** Raw data if the attachment is local/inline. */
  data?: Buffer
  /** MIME type (e.g. 'image/png', 'audio/mp3'). */
  mimeType?: string
  /** Original filename if available. */
  filename?: string
}

/** An outbound reply to be delivered through a channel. */
export interface ChannelReply {
  /** Reply text (plaintext or markdown — channel decides rendering). */
  text: string
  /** Optional rich payload (audio for TTS, image for generated content). */
  payload?: {
    audio?: Buffer
    image?: Buffer
  }
  /** How this reply relates to the thread (channel interprets this). */
  replyToMode?: 'thread' | 'flat' | 'quote'
}

/** Health snapshot for a channel. */
export interface ChannelStatus {
  /** Whether the channel is functional and ready. */
  healthy: boolean
  /** Human-readable reason when unhealthy. */
  reason?: string
  /** ISO timestamp of last inbound message (if known). */
  lastMessageAt?: string
  /** ISO timestamp of last outbound send (if known). */
  lastSentAt?: string
}

// ── The Channel interface ─────────────────────────────────────────

/**
 * The channel contract. Each channel (visit, telegram, imessage, voice)
 * implements this interface. The generic TAccount carries channel-specific
 * configuration — e.g. for telegram it holds the bot token and chat ID;
 * for visit it holds the file paths.
 *
 * Design principles (from openclaw, adapted):
 *   - Channels own their transport. The core never touches platform APIs.
 *   - Channels are stateless between calls. Account holds the config.
 *   - monitor() returns a cleanup function — channels manage their own lifecycle.
 *   - send() is async — channels own delivery, retries, chunking.
 *   - status() is a lightweight probe — not a deep audit.
 */
export interface Channel<TAccount = unknown> {
  /** Unique channel identifier: 'visit' | 'telegram' | 'imessage' | ... */
  readonly id: string

  /** Human-readable label for UI surfaces. */
  readonly label: string

  /**
   * Resolve raw configuration into a typed account handle.
   * The account carries everything the channel needs to operate
   * (paths, tokens, chat IDs) without the core knowing the shape.
   */
  resolveAccount(config: unknown): TAccount

  /**
   * Start monitoring for inbound messages.
   *
   * Returns a cleanup function that stops monitoring when called.
   * The onMessage callback fires for each new inbound message.
   * Channels decide their own polling/watching strategy.
   *
   * For visit: watches from-yu.md for changes.
   * For telegram: long-polls the Bot API.
   * For imessage: watches the BlueBubbles webhook.
   */
  monitor(
    account: TAccount,
    onMessage: (message: ChannelMessage) => void,
  ): () => void

  /**
   * Send a reply through this channel.
   *
   * The channel owns delivery: formatting, chunking for length limits,
   * retry on transient failure, media upload if payload includes it.
   * Throws on permanent failure (auth invalid, chat not found).
   */
  send(
    account: TAccount,
    threadId: string,
    reply: ChannelReply,
  ): Promise<void>

  /**
   * Lightweight health check.
   *
   * Returns current status without side effects. Used by vital-signs
   * and the /build UI to show channel health.
   */
  status(account: TAccount): Promise<ChannelStatus>
}

// ── Channel metadata ──────────────────────────────────────────────

/** Static metadata about a channel, used for UI and documentation. */
export interface ChannelMeta {
  id: string
  label: string
  /** Short description for pickers and docs. */
  description: string
  /** Whether the channel is currently configured and active. */
  configured: boolean
  /** Capabilities this channel supports. */
  capabilities: ChannelCapabilities
}

/** What a channel can do (static flags, not runtime state). */
export interface ChannelCapabilities {
  /** Can receive inbound messages. */
  receive: boolean
  /** Can send outbound messages. */
  send: boolean
  /** Supports rich media (images, audio). */
  media: boolean
  /** Supports threaded conversations. */
  threads: boolean
  /** Supports real-time streaming of responses. */
  streaming: boolean
}
