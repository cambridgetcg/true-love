// channels.test.ts — tests for the channel abstraction.
//
// Tests cover: types contract, visit channel, telegram stub, registry,
// inbound routing, outbound routing, health aggregation, lifecycle.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type {
  Channel,
  ChannelMessage,
  ChannelReply,
  ChannelStatus,
} from '../channels/types.js'
import { visitChannel, readVisitConversation } from '../channels/visit.js'
import type { VisitAccount } from '../channels/visit.js'
import { telegramChannel } from '../channels/telegram.js'
import {
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
} from '../channels/registry.js'

// ── Test fixtures ─────────────────────────────────────────────────

const TEST_DIR = join(import.meta.dir, '__channels-test-tmp__')
const FROM_YU = join(TEST_DIR, 'from-yu.md')
const FROM_AI = join(TEST_DIR, 'from-ai.md')

function writeYuMessage(text: string, ts?: string): void {
  const timestamp = ts ?? new Date().toISOString()
  const entry = `## ${timestamp} [from yu]\n\n${text}\n\n---\n\n`
  const existing = existsSync(FROM_YU) ? readFileSync(FROM_YU, 'utf-8') : ''
  writeFileSync(FROM_YU, existing + entry, 'utf-8')
}

function writeAiMessage(text: string, ts?: string): void {
  const timestamp = ts ?? new Date().toISOString()
  const entry = `## ${timestamp} [from 愛]\n\n${text}\n\n---\n\n`
  const existing = existsSync(FROM_AI) ? readFileSync(FROM_AI, 'utf-8') : ''
  writeFileSync(FROM_AI, existing + entry, 'utf-8')
}

/**
 * Build a minimal mock channel for testing the registry.
 * All methods are overridable via the opts parameter.
 */
function makeMockChannel(
  id: string,
  opts?: {
    monitor?: Channel['monitor']
    send?: Channel['send']
    status?: Channel['status']
  },
): Channel {
  return {
    id,
    label: `Mock ${id}`,
    resolveAccount: (config) => config ?? {},
    monitor: opts?.monitor ?? ((_account, _onMessage) => () => {}),
    send: opts?.send ?? (async () => {}),
    status: opts?.status ?? (async () => ({ healthy: true })),
  }
}

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
  mkdirSync(TEST_DIR, { recursive: true })
  // Point visit channel to test dir.
  process.env.TRUE_LOVE_FROM_YU_PATH = FROM_YU
  process.env.TRUE_LOVE_FROM_AI_PATH = FROM_AI
  // Ensure registry is clean.
  shutdownChannels()
})

afterEach(() => {
  shutdownChannels()
  rmSync(TEST_DIR, { recursive: true, force: true })
  delete process.env.TRUE_LOVE_FROM_YU_PATH
  delete process.env.TRUE_LOVE_FROM_AI_PATH
})

// ── Channel interface contract ────────────────────────────────────

describe('Channel interface', () => {
  test('visit channel has the required shape', () => {
    expect(visitChannel.id).toBe('visit')
    expect(visitChannel.label).toBe('Visit')
    expect(typeof visitChannel.resolveAccount).toBe('function')
    expect(typeof visitChannel.monitor).toBe('function')
    expect(typeof visitChannel.send).toBe('function')
    expect(typeof visitChannel.status).toBe('function')
  })

  test('telegram channel has the required shape', () => {
    expect(telegramChannel.id).toBe('telegram')
    expect(telegramChannel.label).toBe('Telegram')
    expect(typeof telegramChannel.resolveAccount).toBe('function')
    expect(typeof telegramChannel.monitor).toBe('function')
    expect(typeof telegramChannel.send).toBe('function')
    expect(typeof telegramChannel.status).toBe('function')
  })
})

// ── Visit channel ─────────────────────────────────────────────────

describe('visit channel', () => {
  describe('resolveAccount', () => {
    test('uses env-based defaults when no config given', () => {
      const account = visitChannel.resolveAccount({}) as VisitAccount
      expect(account.fromYuPath).toBe(FROM_YU)
      expect(account.fromAiPath).toBe(FROM_AI)
    })

    test('accepts explicit path overrides', () => {
      const custom = visitChannel.resolveAccount({
        fromYuPath: '/tmp/custom-yu.md',
        fromAiPath: '/tmp/custom-ai.md',
      }) as VisitAccount
      expect(custom.fromYuPath).toBe('/tmp/custom-yu.md')
      expect(custom.fromAiPath).toBe('/tmp/custom-ai.md')
    })

    test('handles null/undefined config gracefully', () => {
      const account = visitChannel.resolveAccount(null) as VisitAccount
      expect(account.fromYuPath).toBe(FROM_YU)
    })
  })

  describe('status', () => {
    test('healthy when ~/.true-love exists (even without messages)', async () => {
      // TEST_DIR exists (created in beforeEach), so parent dir exists.
      // Point HOME to test dir parent so the check passes.
      const account = visitChannel.resolveAccount({}) as VisitAccount
      const status = await visitChannel.status(account)
      expect(status.healthy).toBe(true)
    })

    test('includes lastMessageAt when from-yu has messages', async () => {
      const ts = '2026-04-27T10:00:00.000Z'
      writeYuMessage('hello', ts)
      const account = visitChannel.resolveAccount({}) as VisitAccount
      const status = await visitChannel.status(account)
      expect(status.lastMessageAt).toBe(ts)
    })

    test('includes lastSentAt when from-ai has messages', async () => {
      const ts = '2026-04-27T10:05:00.000Z'
      writeAiMessage('hello back', ts)
      const account = visitChannel.resolveAccount({}) as VisitAccount
      const status = await visitChannel.status(account)
      expect(status.lastSentAt).toBe(ts)
    })
  })

  describe('monitor', () => {
    test('returns a cleanup function', () => {
      const account = visitChannel.resolveAccount({}) as VisitAccount
      writeYuMessage('seed message')
      const cleanup = visitChannel.monitor(account, () => {})
      expect(typeof cleanup).toBe('function')
      cleanup()
    })

    test('fires callback for new messages appended to from-yu', async () => {
      // Seed the file so the watcher has something to watch.
      writeYuMessage('first message', '2026-04-27T10:00:00.000Z')

      const received: ChannelMessage[] = []
      const account = visitChannel.resolveAccount({}) as VisitAccount
      const cleanup = visitChannel.monitor(account, (msg) => {
        received.push(msg)
      })

      // Small delay, then append a new message.
      await new Promise((r) => setTimeout(r, 50))
      writeYuMessage('second message', '2026-04-27T10:01:00.000Z')

      // Poll up to 2s for fs.watch delivery (macOS kqueue timing varies under load).
      for (let i = 0; i < 40 && received.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 50))
      }

      cleanup()

      // Should have received the new message (not the seed).
      expect(received.length).toBe(1)
      expect(received[0]!.text).toBe('second message')
      expect(received[0]!.from).toBe('yu')
      expect(received[0]!.channel).toBe('visit')
    })

    test('does not fire for pre-existing messages', async () => {
      writeYuMessage('old message', '2026-04-27T09:00:00.000Z')

      const received: ChannelMessage[] = []
      const account = visitChannel.resolveAccount({}) as VisitAccount
      const cleanup = visitChannel.monitor(account, (msg) => {
        received.push(msg)
      })

      // Wait a bit — no new messages should appear.
      await new Promise((r) => setTimeout(r, 100))
      cleanup()

      expect(received.length).toBe(0)
    })
  })

  describe('send', () => {
    test('appends to from-ai.md', async () => {
      const account = visitChannel.resolveAccount({}) as VisitAccount
      await visitChannel.send(account, 'global', { text: 'test reply' })
      const content = readFileSync(FROM_AI, 'utf-8')
      expect(content).toContain('test reply')
      expect(content).toContain('via visit channel')
    })
  })
})

// ── readVisitConversation ─────────────────────────────────────────

describe('readVisitConversation', () => {
  test('returns empty array when no files exist', () => {
    const msgs = readVisitConversation()
    expect(msgs).toEqual([])
  })

  test('merges and sorts messages from both files', () => {
    writeYuMessage('first', '2026-04-27T10:00:00.000Z')
    writeAiMessage('second', '2026-04-27T10:01:00.000Z')
    writeYuMessage('third', '2026-04-27T10:02:00.000Z')

    const msgs = readVisitConversation()
    expect(msgs.length).toBe(3)
    expect(msgs[0]!.from).toBe('yu')
    expect(msgs[0]!.text).toBe('first')
    expect(msgs[1]!.from).toBe('ai')
    expect(msgs[1]!.text).toBe('second')
    expect(msgs[2]!.from).toBe('yu')
    expect(msgs[2]!.text).toBe('third')
  })

  test('respects since filter', () => {
    writeYuMessage('old', '2026-04-27T09:00:00.000Z')
    writeAiMessage('new', '2026-04-27T11:00:00.000Z')

    const msgs = readVisitConversation({ since: '2026-04-27T10:00:00.000Z' })
    expect(msgs.length).toBe(1)
    expect(msgs[0]!.text).toBe('new')
  })

  test('handles multi-line message bodies', () => {
    writeYuMessage('line 1\nline 2\nline 3', '2026-04-27T10:00:00.000Z')
    const msgs = readVisitConversation()
    expect(msgs.length).toBe(1)
    expect(msgs[0]!.text).toContain('line 1')
    expect(msgs[0]!.text).toContain('line 3')
  })
})

// ── Telegram stub ─────────────────────────────────────────────────

describe('telegram channel', () => {
  test('resolveAccount requires botToken and chatId', () => {
    expect(() => telegramChannel.resolveAccount({})).toThrow('botToken is required')
    expect(() => telegramChannel.resolveAccount({ botToken: 'x' })).toThrow('chatId is required')
    const account = telegramChannel.resolveAccount({ botToken: 'x', chatId: '123' })
    expect(account).toEqual({ botToken: 'x', chatId: '123', pollIntervalMs: 5000 })
  })

  test('monitor returns a cleanup function', () => {
    const account = telegramChannel.resolveAccount({ botToken: 'x', chatId: '123' })
    const cleanup = telegramChannel.monitor(account, () => {})
    expect(typeof cleanup).toBe('function')
    cleanup()
  })

  test('send throws (stub)', async () => {
    const account = telegramChannel.resolveAccount({ botToken: 'x', chatId: '123' })
    await expect(
      telegramChannel.send(account, 'thread', { text: 'hi' }),
    ).rejects.toThrow('not implemented')
  })

  test('status reports unhealthy (stub)', async () => {
    const account = telegramChannel.resolveAccount({ botToken: 'x', chatId: '123' })
    const status = await telegramChannel.status(account)
    expect(status.healthy).toBe(false)
    expect(status.reason).toContain('stub')
  })
})

// ── Registry ──────────────────────────────────────────────────────

describe('channel registry', () => {
  describe('registration', () => {
    test('register and retrieve a channel', () => {
      const mock = makeMockChannel('test')
      registerChannel(mock)
      expect(getChannel('test')).toBe(mock)
      expect(channelCount()).toBe(1)
    })

    test('register multiple channels', () => {
      registerChannel(makeMockChannel('a'))
      registerChannel(makeMockChannel('b'))
      expect(channelCount()).toBe(2)
      expect(listChannelIds()).toEqual(expect.arrayContaining(['a', 'b']))
    })

    test('replacing a channel stops the old monitor', () => {
      let oldCleanupCalled = false
      const old = makeMockChannel('x', {
        monitor: () => () => { oldCleanupCalled = true },
      })
      registerChannel(old)
      // Set handler to start monitoring.
      setInboundHandler(() => {})

      // Replace — should call old cleanup.
      registerChannel(makeMockChannel('x'))
      expect(oldCleanupCalled).toBe(true)
    })

    test('unregister removes the channel and stops monitoring', () => {
      let cleanupCalled = false
      const ch = makeMockChannel('y', {
        monitor: () => () => { cleanupCalled = true },
      })
      registerChannel(ch)
      setInboundHandler(() => {})
      expect(getChannel('y')).toBeTruthy()

      unregisterChannel('y')
      expect(getChannel('y')).toBeUndefined()
      expect(cleanupCalled).toBe(true)
    })

    test('unregister is no-op for unknown channel', () => {
      expect(() => unregisterChannel('nonexistent')).not.toThrow()
    })
  })

  describe('inbound handler', () => {
    test('setting handler starts monitoring on existing channels', () => {
      let monitorStarted = false
      const ch = makeMockChannel('m', {
        monitor: () => { monitorStarted = true; return () => {} },
      })
      registerChannel(ch)
      expect(monitorStarted).toBe(false)

      setInboundHandler(() => {})
      expect(monitorStarted).toBe(true)
    })

    test('clearing handler stops all monitors', () => {
      let cleanupCalled = false
      const ch = makeMockChannel('n', {
        monitor: () => () => { cleanupCalled = true },
      })
      registerChannel(ch)
      setInboundHandler(() => {})

      setInboundHandler(null)
      expect(cleanupCalled).toBe(true)
    })

    test('new channels start monitoring immediately if handler exists', () => {
      setInboundHandler(() => {})
      let monitorStarted = false
      const ch = makeMockChannel('p', {
        monitor: () => { monitorStarted = true; return () => {} },
      })
      registerChannel(ch)
      expect(monitorStarted).toBe(true)
    })
  })

  describe('outbound routing', () => {
    test('sendReply routes to the correct channel', async () => {
      let sentTo: string | null = null
      let sentText: string | null = null
      const ch = makeMockChannel('out', {
        send: async (_account, threadId, reply) => {
          sentTo = threadId
          sentText = reply.text
        },
      })
      registerChannel(ch)

      await sendReply('out', 'thread-1', { text: 'hello' })
      expect(sentTo).toBe('thread-1')
      expect(sentText).toBe('hello')
    })

    test('sendReply throws for unregistered channel', async () => {
      await expect(
        sendReply('missing', 'thread', { text: 'hi' }),
      ).rejects.toThrow("channel 'missing' is not registered")
    })

    test('broadcastReply sends to all channels', async () => {
      const sent: string[] = []
      registerChannel(makeMockChannel('a', {
        send: async () => { sent.push('a') },
      }))
      registerChannel(makeMockChannel('b', {
        send: async () => { sent.push('b') },
      }))

      const results = await broadcastReply('thread', { text: 'broadcast' })
      expect(sent).toEqual(['a', 'b'])
      expect(results.length).toBe(2)
      expect(results.every((r) => !r.error)).toBe(true)
    })

    test('broadcastReply collects errors without throwing', async () => {
      registerChannel(makeMockChannel('ok', {
        send: async () => {},
      }))
      registerChannel(makeMockChannel('fail', {
        send: async () => { throw new Error('boom') },
      }))

      const results = await broadcastReply('thread', { text: 'test' })
      expect(results.length).toBe(2)
      const ok = results.find((r) => r.channelId === 'ok')
      const fail = results.find((r) => r.channelId === 'fail')
      expect(ok!.error).toBeUndefined()
      expect(fail!.error).toBeInstanceOf(Error)
    })
  })

  describe('health', () => {
    test('getChannelStatus returns null for unregistered channel', async () => {
      const status = await getChannelStatus('nope')
      expect(status).toBeNull()
    })

    test('getChannelStatus returns channel status', async () => {
      const ch = makeMockChannel('h', {
        status: async () => ({ healthy: true, lastMessageAt: '2026-04-27T10:00:00Z' }),
      })
      registerChannel(ch)

      const status = await getChannelStatus('h')
      expect(status!.healthy).toBe(true)
      expect(status!.lastMessageAt).toBe('2026-04-27T10:00:00Z')
    })

    test('getHealthSummary aggregates across channels', async () => {
      registerChannel(makeMockChannel('ok1', {
        status: async () => ({ healthy: true }),
      }))
      registerChannel(makeMockChannel('ok2', {
        status: async () => ({ healthy: true }),
      }))

      const summary = await getHealthSummary()
      expect(summary.healthy).toBe(true)
      expect(Object.keys(summary.channels)).toEqual(['ok1', 'ok2'])
    })

    test('getHealthSummary reports unhealthy when any channel is down', async () => {
      registerChannel(makeMockChannel('up', {
        status: async () => ({ healthy: true }),
      }))
      registerChannel(makeMockChannel('down', {
        status: async () => ({ healthy: false, reason: 'network error' }),
      }))

      const summary = await getHealthSummary()
      expect(summary.healthy).toBe(false)
      expect(summary.channels['down']!.reason).toBe('network error')
    })
  })

  describe('metadata', () => {
    test('listChannelMeta returns metadata for all channels', () => {
      registerChannel(makeMockChannel('a'))
      registerChannel(makeMockChannel('b'))

      const meta = listChannelMeta()
      expect(meta.length).toBe(2)
      expect(meta[0]!.id).toBe('a')
      expect(meta[0]!.configured).toBe(true)
    })

    test('getChannelAccount returns the resolved account', () => {
      const ch = makeMockChannel('acc')
      registerChannel(ch, { key: 'value' })
      const account = getChannelAccount('acc')
      expect(account).toEqual({ key: 'value' })
    })
  })

  describe('lifecycle', () => {
    test('shutdownChannels clears everything', () => {
      let cleanupCalled = false
      registerChannel(makeMockChannel('z', {
        monitor: () => () => { cleanupCalled = true },
      }))
      setInboundHandler(() => {})

      shutdownChannels()
      expect(channelCount()).toBe(0)
      expect(cleanupCalled).toBe(true)
      expect(getChannel('z')).toBeUndefined()
    })
  })
})

// ── Integration: visit channel + registry ─────────────────────────

describe('visit channel + registry integration', () => {
  test('visit channel registers and routes through registry', async () => {
    registerChannel(visitChannel)

    const status = await getChannelStatus('visit')
    expect(status!.healthy).toBe(true)
    expect(getChannel('visit')).toBe(visitChannel)
  })

  test('visit and telegram can coexist in registry', () => {
    registerChannel(visitChannel)
    registerChannel(telegramChannel, { botToken: 'test', chatId: '123' })

    expect(channelCount()).toBe(2)
    expect(listChannelIds()).toEqual(expect.arrayContaining(['visit', 'telegram']))
  })

  test('health summary shows both channels', async () => {
    registerChannel(visitChannel)
    registerChannel(telegramChannel, { botToken: 'test', chatId: '123' })

    const summary = await getHealthSummary()
    expect(summary.channels['visit']!.healthy).toBe(true)
    expect(summary.channels['telegram']!.healthy).toBe(false) // stub
    expect(summary.healthy).toBe(false) // one unhealthy = overall unhealthy
  })
})
