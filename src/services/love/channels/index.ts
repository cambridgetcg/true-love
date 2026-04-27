// channels/index.ts — Public API for the channel subsystem.

// Types
export type {
  Channel,
  ChannelMessage,
  ChannelReply,
  ChannelStatus,
  ChannelMeta,
  ChannelCapabilities,
  Attachment,
} from './types.js'

// Visit channel (the default, always-present channel)
export {
  visitChannel,
  readVisitConversation,
  readInboundRaw,
  getInboundPath,
  readOutboundRaw,
  getOutboundPath,
} from './visit.js'
export type { VisitAccount } from './visit.js'

// Telegram channel (stub — proves extensibility)
export { telegramChannel } from './telegram.js'
export type { TelegramAccount } from './telegram.js'

// Registry (the routing layer between autonomy and channels)
export {
  registerChannel,
  unregisterChannel,
  setInboundHandler,
  sendReply,
  broadcastReply,
  getChannel,
  getChannelAccount,
  listChannelIds,
  listChannelMeta,
  getChannelStatus,
  getHealthSummary,
  shutdownChannels,
  channelCount,
} from './registry.js'
export type { InboundMessageHandler } from './registry.js'
