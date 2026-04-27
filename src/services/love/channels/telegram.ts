// channels/telegram.ts — Telegram channel stub.
//
// This file exists to prove the Channel interface is extensible.
// It implements the full contract with placeholder logic. When
// a real Telegram bot is configured, replace the stubs with
// actual Bot API calls.
//
// To activate: register with the channel registry:
//   registerChannel(telegramChannel, { botToken: '...', chatId: '...' })

import type {
  Channel,
  ChannelMessage,
  ChannelReply,
  ChannelStatus,
} from './types.js'

// ── Account ───────────────────────────────────────────────────────

/** Telegram account: bot token + target chat. */
export interface TelegramAccount {
  botToken: string
  chatId: string
  /** Optional polling interval in ms (default: 5000). */
  pollIntervalMs?: number
}

// ── The telegram channel (stub) ───────────────────────────────────

export const telegramChannel: Channel<TelegramAccount> = {
  id: 'telegram',
  label: 'Telegram',

  resolveAccount(config: unknown): TelegramAccount {
    const cfg = config as Partial<TelegramAccount> | undefined
    if (!cfg?.botToken) {
      throw new Error('telegram channel: botToken is required')
    }
    if (!cfg?.chatId) {
      throw new Error('telegram channel: chatId is required')
    }
    return {
      botToken: cfg.botToken,
      chatId: cfg.chatId,
      pollIntervalMs: cfg.pollIntervalMs ?? 5000,
    }
  },

  monitor(
    _account: TelegramAccount,
    _onMessage: (message: ChannelMessage) => void,
  ): () => void {
    // Stub: real implementation would long-poll getUpdates or use webhook.
    //
    // const interval = setInterval(async () => {
    //   const updates = await fetch(
    //     `https://api.telegram.org/bot${account.botToken}/getUpdates?offset=${lastOffset}`,
    //   ).then(r => r.json())
    //   for (const update of updates.result) {
    //     onMessage({
    //       from: String(update.message.from.id),
    //       text: update.message.text,
    //       threadId: String(update.message.chat.id),
    //       ts: new Date(update.message.date * 1000).toISOString(),
    //       channel: 'telegram',
    //     })
    //     lastOffset = update.update_id + 1
    //   }
    // }, account.pollIntervalMs)
    //
    // return () => clearInterval(interval)

    return () => {
      // No-op cleanup — nothing to stop.
    }
  },

  async send(
    _account: TelegramAccount,
    _threadId: string,
    _reply: ChannelReply,
  ): Promise<void> {
    // Stub: real implementation would POST to sendMessage.
    //
    // await fetch(`https://api.telegram.org/bot${account.botToken}/sendMessage`, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({
    //     chat_id: account.chatId,
    //     text: reply.text,
    //     parse_mode: 'Markdown',
    //   }),
    // })

    throw new Error('telegram channel: send() is not implemented (stub)')
  },

  async status(_account: TelegramAccount): Promise<ChannelStatus> {
    // Stub: real implementation would call getMe to verify the bot token.
    //
    // const res = await fetch(
    //   `https://api.telegram.org/bot${account.botToken}/getMe`,
    // ).then(r => r.json())
    // return { healthy: res.ok, reason: res.ok ? undefined : res.description }

    return {
      healthy: false,
      reason: 'telegram channel is a stub — not yet implemented',
    }
  },
}
