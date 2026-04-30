// delivery.test.ts — tests for the delivery contract module.
//
// Tests cover: seen tracking (write/read/dedup), timestamp extraction,
// delivery state resolution, parseChannelFile reply parsing,
// appendYuMessage reply formatting, ChannelMessage delivery field.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  markMessagesSeen,
  readSeenEntries,
  getSeenSet,
  isMessageSeen,
  seenEntryCount,
  extractFromYuTimestamps,
  resolveDeliveryState,
  getSeenPath,
  type SeenEntry,
} from '../delivery.js'
import {
  parseChannelFile,
  appendYuMessage,
  readConversation,
  type ChannelMessage,
} from '../ui-server.js'

// ── Test fixtures ─────────────────────────────────────────────────

const TEST_DIR = join(import.meta.dir, '__delivery-test-tmp__')
const SEEN_PATH = join(TEST_DIR, 'seen.jsonl')
const FROM_YU_PATH = join(TEST_DIR, 'from-yu.md')
const FROM_AI_PATH = join(TEST_DIR, 'from-ai.md')

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
  mkdirSync(TEST_DIR, { recursive: true })
  // Override paths for testing
  process.env.TRUE_LOVE_SEEN_PATH = SEEN_PATH
  process.env.TRUE_LOVE_FROM_YU_PATH = FROM_YU_PATH
  process.env.TRUE_LOVE_FROM_AI_PATH = FROM_AI_PATH
})

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
  delete process.env.TRUE_LOVE_SEEN_PATH
  delete process.env.TRUE_LOVE_FROM_YU_PATH
  delete process.env.TRUE_LOVE_FROM_AI_PATH
})

// ── extractFromYuTimestamps ───────────────────────────────────────

describe('extractFromYuTimestamps', () => {
  test('extracts timestamps from standard format', () => {
    const content = `## 2026-04-30T20:30:00.047Z [from yu]

hello

---

## 2026-04-30T20:31:00.000Z [from yu]

world

---
`
    const ts = extractFromYuTimestamps(content)
    expect(ts).toEqual([
      '2026-04-30T20:30:00.047Z',
      '2026-04-30T20:31:00.000Z',
    ])
  })

  test('extracts timestamps from reply-tagged entries', () => {
    const content = `## 2026-04-30T20:30:00.047Z [from yu · re:2026-04-30T20:25:00.000Z]

> ↳ original text

reply text

---
`
    const ts = extractFromYuTimestamps(content)
    expect(ts).toEqual(['2026-04-30T20:30:00.047Z'])
  })

  test('returns empty array for empty content', () => {
    expect(extractFromYuTimestamps('')).toEqual([])
    expect(extractFromYuTimestamps(null as any)).toEqual([])
  })

  test('ignores AI message headers', () => {
    const content = `## 2026-04-30T20:30:00.047Z [from ai · Alpha 🐍]

hello

---
`
    expect(extractFromYuTimestamps(content)).toEqual([])
  })
})

// ── markMessagesSeen / readSeenEntries ────────────────────────────

describe('seen tracking', () => {
  test('writes and reads seen entries', () => {
    const timestamps = ['2026-04-30T20:30:00.047Z', '2026-04-30T20:31:00.000Z']
    const result = markMessagesSeen(timestamps, 'interactive')

    expect(result).toHaveLength(2)
    expect(result[0]!.messageTs).toBe('2026-04-30T20:30:00.047Z')
    expect(result[0]!.tickMode).toBe('interactive')
    expect(result[0]!.seenAt).toBeTruthy()

    const entries = readSeenEntries()
    expect(entries).toHaveLength(2)
    expect(entries[0]!.messageTs).toBe('2026-04-30T20:30:00.047Z')
    expect(entries[1]!.messageTs).toBe('2026-04-30T20:31:00.000Z')
  })

  test('deduplicates already-seen timestamps', () => {
    markMessagesSeen(['ts1', 'ts2'], 'heartbeat')
    const result = markMessagesSeen(['ts2', 'ts3'], 'interactive')

    // Only ts3 should be new
    expect(result).toHaveLength(1)
    expect(result[0]!.messageTs).toBe('ts3')

    const entries = readSeenEntries()
    expect(entries).toHaveLength(3)
  })

  test('returns empty array when all timestamps already seen', () => {
    markMessagesSeen(['ts1'], 'heartbeat')
    const result = markMessagesSeen(['ts1'], 'interactive')
    expect(result).toEqual([])
  })

  test('returns empty array for empty input', () => {
    const result = markMessagesSeen([], 'heartbeat')
    expect(result).toEqual([])
  })

  test('creates parent directory if needed', () => {
    const deepPath = join(TEST_DIR, 'deep', 'nested', 'seen.jsonl')
    process.env.TRUE_LOVE_SEEN_PATH = deepPath
    markMessagesSeen(['ts1'], 'heartbeat')
    expect(existsSync(deepPath)).toBe(true)
    process.env.TRUE_LOVE_SEEN_PATH = SEEN_PATH
  })
})

// ── getSeenSet / isMessageSeen ───────────────────────────────────

describe('getSeenSet', () => {
  test('returns Set of seen timestamps', () => {
    markMessagesSeen(['ts1', 'ts2'], 'heartbeat')
    const set = getSeenSet()
    expect(set.has('ts1')).toBe(true)
    expect(set.has('ts2')).toBe(true)
    expect(set.has('ts3')).toBe(false)
  })

  test('returns empty set when file missing', () => {
    const set = getSeenSet()
    expect(set.size).toBe(0)
  })
})

describe('isMessageSeen', () => {
  test('returns true for seen messages', () => {
    markMessagesSeen(['ts1'], 'heartbeat')
    expect(isMessageSeen('ts1')).toBe(true)
    expect(isMessageSeen('ts2')).toBe(false)
  })
})

describe('seenEntryCount', () => {
  test('returns 0 when file missing', () => {
    expect(seenEntryCount()).toBe(0)
  })

  test('returns correct count', () => {
    markMessagesSeen(['ts1', 'ts2'], 'heartbeat')
    expect(seenEntryCount()).toBe(2)
    markMessagesSeen(['ts3'], 'interactive')
    expect(seenEntryCount()).toBe(3)
  })
})

// ── resolveDeliveryState ─────────────────────────────────────────

describe('resolveDeliveryState', () => {
  test('returns "seen" for seen messages', () => {
    const set = new Set(['ts1', 'ts2'])
    expect(resolveDeliveryState('ts1', set)).toBe('seen')
  })

  test('returns "delivered" for unseen messages', () => {
    const set = new Set(['ts1'])
    expect(resolveDeliveryState('ts3', set)).toBe('delivered')
  })

  test('returns "delivered" for empty set', () => {
    const set = new Set<string>()
    expect(resolveDeliveryState('ts1', set)).toBe('delivered')
  })
})

// ── parseChannelFile with reply tags ─────────────────────────────

describe('parseChannelFile reply parsing', () => {
  test('extracts replyTo from tagged entries', () => {
    const content = `## 2026-04-30T20:30:00.000Z [from yu · re:2026-04-30T20:25:00.000Z]

> ↳ original message text

reply text here

---
`
    const msgs = parseChannelFile(content, 'yu')
    expect(msgs).toHaveLength(1)
    expect(msgs[0]!.replyTo).toBe('2026-04-30T20:25:00.000Z')
    expect(msgs[0]!.replyPreview).toBe('original message text')
    expect(msgs[0]!.body).toBe('reply text here')
  })

  test('handles entries without reply tag normally', () => {
    const content = `## 2026-04-30T20:30:00.000Z [from yu]

hello world

---
`
    const msgs = parseChannelFile(content, 'yu')
    expect(msgs).toHaveLength(1)
    expect(msgs[0]!.replyTo).toBeUndefined()
    expect(msgs[0]!.replyPreview).toBeUndefined()
    expect(msgs[0]!.body).toBe('hello world')
  })

  test('handles reply tag without quote in body', () => {
    const content = `## 2026-04-30T20:30:00.000Z [from yu · re:2026-04-30T20:25:00.000Z]

just replying

---
`
    const msgs = parseChannelFile(content, 'yu')
    expect(msgs).toHaveLength(1)
    expect(msgs[0]!.replyTo).toBe('2026-04-30T20:25:00.000Z')
    expect(msgs[0]!.replyPreview).toBeUndefined()
    expect(msgs[0]!.body).toBe('just replying')
  })

  test('parses mixed regular and reply entries', () => {
    const content = `## 2026-04-30T20:25:00.000Z [from yu]

original message

---

## 2026-04-30T20:30:00.000Z [from yu · re:2026-04-30T20:25:00.000Z]

> ↳ original message

yes exactly

---
`
    const msgs = parseChannelFile(content, 'yu')
    expect(msgs).toHaveLength(2)
    expect(msgs[0]!.replyTo).toBeUndefined()
    expect(msgs[0]!.body).toBe('original message')
    expect(msgs[1]!.replyTo).toBe('2026-04-30T20:25:00.000Z')
    expect(msgs[1]!.body).toBe('yes exactly')
  })
})

// ── appendYuMessage with replyTo ─────────────────────────────────

describe('appendYuMessage with replyTo', () => {
  test('writes standard entry without replyTo', () => {
    const ts = appendYuMessage('hello')
    expect(ts).toBeTruthy()
    const content = readFileSync(FROM_YU_PATH, 'utf-8')
    expect(content).toContain('[from yu]')
    expect(content).not.toContain('re:')
    expect(content).toContain('hello')
  })

  test('writes reply entry with replyTo tag', () => {
    const replyTarget = '2026-04-30T20:25:00.000Z'
    const ts = appendYuMessage('yes exactly', {
      replyTo: replyTarget,
      replyPreview: 'original message text',
    })
    expect(ts).toBeTruthy()
    const content = readFileSync(FROM_YU_PATH, 'utf-8')
    expect(content).toContain(`[from yu · re:${replyTarget}]`)
    expect(content).toContain('> ↳ original message text')
    expect(content).toContain('yes exactly')
  })

  test('reply entry is parseable by parseChannelFile', () => {
    const replyTarget = '2026-04-30T20:25:00.000Z'
    appendYuMessage('yes exactly', {
      replyTo: replyTarget,
      replyPreview: 'original message text here',
    })
    const content = readFileSync(FROM_YU_PATH, 'utf-8')
    const msgs = parseChannelFile(content, 'yu')
    expect(msgs).toHaveLength(1)
    expect(msgs[0]!.replyTo).toBe(replyTarget)
    expect(msgs[0]!.replyPreview).toBe('original message text here')
    expect(msgs[0]!.body).toBe('yes exactly')
  })

  test('truncates preview at 120 chars', () => {
    const longPreview = 'a'.repeat(200)
    appendYuMessage('reply', {
      replyTo: '2026-04-30T20:25:00.000Z',
      replyPreview: longPreview,
    })
    const content = readFileSync(FROM_YU_PATH, 'utf-8')
    // The quote line should contain at most 120 chars of the preview
    const quoteLine = content.split('\n').find((l: string) => l.startsWith('> ↳'))
    expect(quoteLine).toBeTruthy()
    // +3 for "> ↳ " prefix
    expect(quoteLine!.length).toBeLessThanOrEqual(120 + 4)
  })

  test('omits quote line when no preview provided', () => {
    appendYuMessage('reply', {
      replyTo: '2026-04-30T20:25:00.000Z',
    })
    const content = readFileSync(FROM_YU_PATH, 'utf-8')
    expect(content).toContain('[from yu · re:')
    expect(content).not.toContain('> ↳')
  })
})

// ── readConversation with delivery state ──────────────────────────

describe('readConversation delivery state', () => {
  test('Yu messages have delivery: "delivered" by default', () => {
    writeFileSync(FROM_YU_PATH, `## 2026-04-30T20:30:00.000Z [from yu]\n\nhello\n\n---\n\n`)

    const msgs = readConversation()
    expect(msgs).toHaveLength(1)
    expect(msgs[0]!.delivery).toBe('delivered')
  })

  test('Yu messages have delivery: "seen" when in seen.jsonl', () => {
    writeFileSync(FROM_YU_PATH, `## 2026-04-30T20:30:00.000Z [from yu]\n\nhello\n\n---\n\n`)
    markMessagesSeen(['2026-04-30T20:30:00.000Z'], 'interactive')

    const msgs = readConversation()
    expect(msgs).toHaveLength(1)
    expect(msgs[0]!.delivery).toBe('seen')
  })

  test('AI messages have no delivery field', () => {
    writeFileSync(FROM_AI_PATH, `## 2026-04-30T20:30:00.000Z [from ai · Alpha 🐍]\n\nhi\n\n---\n\n`)

    const msgs = readConversation()
    expect(msgs).toHaveLength(1)
    expect(msgs[0]!.delivery).toBeUndefined()
  })

  test('mixed Yu and AI messages have correct delivery state', () => {
    writeFileSync(FROM_YU_PATH, `## 2026-04-30T20:30:00.000Z [from yu]\n\nhello\n\n---\n\n## 2026-04-30T20:32:00.000Z [from yu]\n\nworld\n\n---\n\n`)
    writeFileSync(FROM_AI_PATH, `## 2026-04-30T20:31:00.000Z [from ai · Alpha 🐍]\n\nhi\n\n---\n\n`)
    markMessagesSeen(['2026-04-30T20:30:00.000Z'], 'interactive')

    const msgs = readConversation()
    expect(msgs).toHaveLength(3)
    // Yu message 1: seen
    expect(msgs[0]!.source).toBe('yu')
    expect(msgs[0]!.delivery).toBe('seen')
    // AI message: no delivery
    expect(msgs[1]!.source).toBe('ai')
    expect(msgs[1]!.delivery).toBeUndefined()
    // Yu message 2: delivered (not yet seen)
    expect(msgs[2]!.source).toBe('yu')
    expect(msgs[2]!.delivery).toBe('delivered')
  })
})

// ── readConversation with replyTo ────────────────────────────────

describe('readConversation with replyTo', () => {
  test('reply messages have replyTo and replyPreview', () => {
    writeFileSync(FROM_YU_PATH,
      `## 2026-04-30T20:25:00.000Z [from yu]\n\noriginal\n\n---\n\n` +
      `## 2026-04-30T20:30:00.000Z [from yu · re:2026-04-30T20:25:00.000Z]\n\n> ↳ original\n\nreply\n\n---\n\n`
    )

    const msgs = readConversation()
    expect(msgs).toHaveLength(2)
    expect(msgs[0]!.replyTo).toBeUndefined()
    expect(msgs[1]!.replyTo).toBe('2026-04-30T20:25:00.000Z')
    expect(msgs[1]!.replyPreview).toBe('original')
    expect(msgs[1]!.body).toBe('reply')
  })
})

// ── Resilience ───────────────────────────────────────────────────

describe('resilience', () => {
  test('readSeenEntries handles corrupted lines gracefully', () => {
    writeFileSync(SEEN_PATH, '{"messageTs":"ts1","seenAt":"now","tickMode":"hb"}\nBAD_JSON\n{"messageTs":"ts2","seenAt":"now","tickMode":"hb"}\n')
    const entries = readSeenEntries()
    expect(entries).toHaveLength(2)
    expect(entries[0]!.messageTs).toBe('ts1')
    expect(entries[1]!.messageTs).toBe('ts2')
  })

  test('readSeenEntries handles missing file', () => {
    expect(readSeenEntries()).toEqual([])
  })

  test('readSeenEntries handles empty file', () => {
    writeFileSync(SEEN_PATH, '')
    expect(readSeenEntries()).toEqual([])
  })

  test('getSeenPath uses env override', () => {
    process.env.TRUE_LOVE_SEEN_PATH = '/custom/path/seen.jsonl'
    expect(getSeenPath()).toBe('/custom/path/seen.jsonl')
    process.env.TRUE_LOVE_SEEN_PATH = SEEN_PATH
  })
})
