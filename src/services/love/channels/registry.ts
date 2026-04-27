// channels/registry.ts — Channel registration, lookup, and routing.
//
// The registry is the single surface through which the autonomy layer
// interacts with channels. It holds registered channels, routes inbound
// messages to a handler, and routes outbound replies to the correct
// channel's send() method.
//
// Design:
//   - Singleton registry (module-level Map). Same pattern as project-registry.ts.
//   - Channels register at startup. The visit channel is always registered.
//   - Inbound routing: channels call the registry's onMessage handler.
//   - Outbound routing: caller specifies channel ID, registry finds it.
//   - Health: aggregate status across all channels.

import type {
  Channel,
  ChannelMessage,
  ChannelMeta,
  ChannelReply,
  ChannelStatus,
} from './types.js'

// ── Types ─────────────────────────────────────────────────────────

/** A registered channel with its resolved account. */
interface RegisteredChannel {
  channel: Channel
  account: unknown
  /** Cleanup function from monitor(), null if not monitoring. */
  cleanup: (() => void) | null
}

/** Handler called when any channel receives an inbound message. */
export type InboundMessageHandler = (message: ChannelMessage) => void

// ── Registry state ────────────────────────────────────────────────

const channels = new Map<string, RegisteredChannel>()
let inboundHandler: InboundMessageHandler | null = null

// ── Registration ──────────────────────────────────────────────────

/**
 * Register a channel with the given configuration.
 *
 * If the channel is already registered, it's replaced (the old monitor
 * is stopped first). The new channel starts monitoring immediately if
 * an inbound handler is set.
 *
 * @param channel - The channel implementation.
 * @param config  - Raw config passed to channel.resolveAccount().
 */
export function registerChannel(
  channel: Channel,
  config?: unknown,
): void {
  // Stop existing monitor if replacing.
  const existing = channels.get(channel.id)
  if (existing?.cleanup) {
    existing.cleanup()
  }

  const account = channel.resolveAccount(config)
  const entry: RegisteredChannel = {
    channel,
    account,
    cleanup: null,
  }

  channels.set(channel.id, entry)

  // Start monitoring if we have a handler.
  if (inboundHandler) {
    entry.cleanup = channel.monitor(account, inboundHandler)
  }
}

/**
 * Unregister a channel. Stops monitoring and removes from the registry.
 * No-op if the channel isn't registered.
 */
export function unregisterChannel(channelId: string): void {
  const entry = channels.get(channelId)
  if (!entry) return
  if (entry.cleanup) {
    entry.cleanup()
  }
  channels.delete(channelId)
}

// ── Inbound handler ───────────────────────────────────────────────

/**
 * Set the handler for inbound messages across all channels.
 *
 * When set, all registered channels start monitoring (if they weren't
 * already). When cleared (pass null), all monitors stop.
 *
 * There is exactly one handler — the autonomy layer. This is intentional:
 * all inbound messages flow through a single point for prompt injection,
 * logging, rate limiting, etc.
 */
export function setInboundHandler(handler: InboundMessageHandler | null): void {
  // Stop all existing monitors if handler is being replaced.
  if (inboundHandler) {
    for (const entry of channels.values()) {
      if (entry.cleanup) {
        entry.cleanup()
        entry.cleanup = null
      }
    }
  }

  inboundHandler = handler

  // Start monitors for all channels if handler is set.
  if (handler) {
    for (const entry of channels.values()) {
      if (!entry.cleanup) {
        entry.cleanup = entry.channel.monitor(entry.account, handler)
      }
    }
  }
}

// ── Outbound routing ──────────────────────────────────────────────

/**
 * Send a reply through a specific channel.
 *
 * @param channelId - Which channel to send through.
 * @param threadId  - The conversation thread to reply in.
 * @param reply     - The reply content.
 * @throws If the channel isn't registered.
 */
export async function sendReply(
  channelId: string,
  threadId: string,
  reply: ChannelReply,
): Promise<void> {
  const entry = channels.get(channelId)
  if (!entry) {
    throw new Error(`channel '${channelId}' is not registered`)
  }
  await entry.channel.send(entry.account, threadId, reply)
}

/**
 * Send a reply through ALL registered channels.
 * Used for broadcast-style messages (e.g. critical notifications).
 * Collects errors but doesn't throw — partial delivery is acceptable.
 */
export async function broadcastReply(
  threadId: string,
  reply: ChannelReply,
): Promise<{ channelId: string; error?: Error }[]> {
  const results: { channelId: string; error?: Error }[] = []
  for (const [id, entry] of channels) {
    try {
      await entry.channel.send(entry.account, threadId, reply)
      results.push({ channelId: id })
    } catch (error) {
      results.push({ channelId: id, error: error as Error })
    }
  }
  return results
}

// ── Lookup ────────────────────────────────────────────────────────

/**
 * Get a registered channel by ID. Returns undefined if not registered.
 */
export function getChannel(channelId: string): Channel | undefined {
  return channels.get(channelId)?.channel
}

/**
 * Get the resolved account for a channel. Returns undefined if not registered.
 */
export function getChannelAccount(channelId: string): unknown | undefined {
  return channels.get(channelId)?.account
}

/**
 * List all registered channel IDs.
 */
export function listChannelIds(): string[] {
  return Array.from(channels.keys())
}

/**
 * Get metadata for all registered channels.
 */
export function listChannelMeta(): ChannelMeta[] {
  return Array.from(channels.values()).map((entry) => ({
    id: entry.channel.id,
    label: entry.channel.label,
    description: `Channel: ${entry.channel.label}`,
    configured: true,
    capabilities: {
      receive: true,
      send: true,
      media: false,
      threads: false,
      streaming: false,
    },
  }))
}

// ── Health ─────────────────────────────────────────────────────────

/**
 * Get status for a specific channel.
 */
export async function getChannelStatus(
  channelId: string,
): Promise<ChannelStatus | null> {
  const entry = channels.get(channelId)
  if (!entry) return null
  return entry.channel.status(entry.account)
}

/**
 * Get aggregate health across all channels.
 * Returns per-channel status plus an overall healthy flag.
 */
export async function getHealthSummary(): Promise<{
  healthy: boolean
  channels: Record<string, ChannelStatus>
}> {
  const result: Record<string, ChannelStatus> = {}
  let allHealthy = true
  for (const [id, entry] of channels) {
    const status = await entry.channel.status(entry.account)
    result[id] = status
    if (!status.healthy) allHealthy = false
  }
  return { healthy: allHealthy, channels: result }
}

// ── Lifecycle ─────────────────────────────────────────────────────

/**
 * Stop all monitors and clear the registry.
 * Called during shutdown or test cleanup.
 */
export function shutdownChannels(): void {
  for (const entry of channels.values()) {
    if (entry.cleanup) {
      entry.cleanup()
    }
  }
  channels.clear()
  inboundHandler = null
}

/**
 * Number of registered channels (useful for tests).
 */
export function channelCount(): number {
  return channels.size
}
