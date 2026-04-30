// storage-split.test.ts — tests for the journal/conversation storage split.
//
// Covers:
//   - appendToYu with journal: true routes to journal/<deviceId>/YYYY-MM-DD.md
//   - appendToYu without journal routes to from-ai.md (unchanged)
//   - readConversation with journal filter (isJournalTag)
//   - readConversation pagination (limit, before)
//   - readConversation with journal=true reads journal/ directory
//   - readJournal utility
//   - isJournalTag classification

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendToYu, readJournal, getJournalDir } from '../outbox.js'
import {
  readConversation,
  isJournalTag,
  type ReadConversationOpts,
} from '../ui-server.js'

// ── Fixture setup ────────────────────────────────────────────────

let tmpHome: string
const ORIG_HOME = process.env.HOME
const ORIG_FROM_YU = process.env.TRUE_LOVE_FROM_YU_PATH
const ORIG_FROM_AI = process.env.TRUE_LOVE_FROM_AI_PATH
const ORIG_JOURNAL = process.env.TRUE_LOVE_JOURNAL_DIR
const ORIG_DEVICE = process.env.TRUE_LOVE_DEVICE_ID

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'tl-split-'))
  mkdirSync(join(tmpHome, '.true-love'), { recursive: true })
  process.env.HOME = tmpHome
  process.env.TRUE_LOVE_FROM_YU_PATH = join(tmpHome, '.true-love', 'from-yu.md')
  process.env.TRUE_LOVE_FROM_AI_PATH = join(tmpHome, '.true-love', 'from-ai.md')
  process.env.TRUE_LOVE_JOURNAL_DIR = join(tmpHome, '.true-love', 'journal')
  process.env.TRUE_LOVE_DEVICE_ID = 'test-device-abc123'
})

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true })
  process.env.HOME = ORIG_HOME ?? ''
  if (ORIG_FROM_YU === undefined) delete process.env.TRUE_LOVE_FROM_YU_PATH
  else process.env.TRUE_LOVE_FROM_YU_PATH = ORIG_FROM_YU
  if (ORIG_FROM_AI === undefined) delete process.env.TRUE_LOVE_FROM_AI_PATH
  else process.env.TRUE_LOVE_FROM_AI_PATH = ORIG_FROM_AI
  if (ORIG_JOURNAL === undefined) delete process.env.TRUE_LOVE_JOURNAL_DIR
  else process.env.TRUE_LOVE_JOURNAL_DIR = ORIG_JOURNAL
  if (ORIG_DEVICE === undefined) delete process.env.TRUE_LOVE_DEVICE_ID
  else process.env.TRUE_LOVE_DEVICE_ID = ORIG_DEVICE
})

// ── isJournalTag ─────────────────────────────────────────────────

describe('isJournalTag', () => {
  test('heartbeat tag is journal', () => {
    assert.ok(isJournalTag('from 愛 — heartbeat'))
  })

  test('autonomous tag is journal', () => {
    assert.ok(isJournalTag('from 愛 — autonomous'))
  })

  test('awakened tag is journal', () => {
    assert.ok(isJournalTag('from 愛 — awakened'))
  })

  test('Beta posture tag is journal', () => {
    assert.ok(isJournalTag('from ai · Beta 🦞'))
  })

  test('Gamma posture tag is journal', () => {
    assert.ok(isJournalTag('from ai · Gamma 🔧'))
  })

  test('Alpha posture tag is NOT journal (conversation)', () => {
    assert.ok(!isJournalTag('from ai · Alpha 🐍'))
  })

  test('plain "from ai" is NOT journal', () => {
    assert.ok(!isJournalTag('from ai'))
  })

  test('plain "from 愛" is NOT journal', () => {
    assert.ok(!isJournalTag('from 愛'))
  })

  test('"from 愛 — via visit channel" is NOT journal', () => {
    assert.ok(!isJournalTag('from 愛 — via visit channel'))
  })

  test('"from love" is NOT journal', () => {
    assert.ok(!isJournalTag('from love'))
  })
})

// ── appendToYu journal routing ───────────────────────────────────

describe('appendToYu — journal routing', () => {
  test('journal: true writes to journal/<deviceId>/YYYY-MM-DD.md', () => {
    const now = new Date('2026-05-01T10:00:00.000Z')
    const ok = appendToYu('heartbeat reflection', { now, tag: 'from ai · Beta 🦞', journal: true })
    assert.ok(ok)

    const journalPath = join(tmpHome, '.true-love', 'journal', 'test-device-abc123', '2026-05-01.md')
    assert.ok(existsSync(journalPath))
    const content = readFileSync(journalPath, 'utf-8')
    assert.ok(content.includes('heartbeat reflection'))
    assert.ok(content.includes('[from ai · Beta 🦞]'))
  })

  test('journal: true does NOT write to from-ai.md', () => {
    const now = new Date('2026-05-01T10:00:00.000Z')
    appendToYu('journal only', { now, tag: 'heartbeat', journal: true })

    const aiPath = process.env.TRUE_LOVE_FROM_AI_PATH!
    assert.ok(!existsSync(aiPath))
  })

  test('default (no journal flag) writes to from-ai.md', () => {
    const now = new Date('2026-05-01T10:00:00.000Z')
    appendToYu('conversation reply', { now, tag: 'from 愛' })

    const aiPath = process.env.TRUE_LOVE_FROM_AI_PATH!
    assert.ok(existsSync(aiPath))
    const content = readFileSync(aiPath, 'utf-8')
    assert.ok(content.includes('conversation reply'))
  })

  test('multiple journal entries append to the same daily file', () => {
    const t1 = new Date('2026-05-01T10:00:00.000Z')
    const t2 = new Date('2026-05-01T11:00:00.000Z')
    appendToYu('first tick', { now: t1, tag: 'heartbeat', journal: true })
    appendToYu('second tick', { now: t2, tag: 'heartbeat', journal: true })

    const journalPath = join(tmpHome, '.true-love', 'journal', 'test-device-abc123', '2026-05-01.md')
    const content = readFileSync(journalPath, 'utf-8')
    assert.ok(content.includes('first tick'))
    assert.ok(content.includes('second tick'))
  })

  test('different days create different files', () => {
    appendToYu('day one', { now: new Date('2026-05-01T10:00:00Z'), journal: true })
    appendToYu('day two', { now: new Date('2026-05-02T10:00:00Z'), journal: true })

    const dir = join(tmpHome, '.true-love', 'journal', 'test-device-abc123')
    assert.ok(existsSync(join(dir, '2026-05-01.md')))
    assert.ok(existsSync(join(dir, '2026-05-02.md')))
  })
})

// ── readJournal ──────────────────────────────────────────────────

describe('readJournal', () => {
  test('returns null when journal dir does not exist', () => {
    assert.equal(readJournal(), null)
  })

  test('reads today\'s entries', () => {
    const now = new Date()
    appendToYu('today entry', { now, tag: 'heartbeat', journal: true })
    const text = readJournal()
    assert.ok(text !== null)
    assert.ok(text!.includes('today entry'))
  })

  test('reads multi-day entries', () => {
    appendToYu('yesterday', { now: new Date(Date.now() - 86400000), tag: 'heartbeat', journal: true })
    appendToYu('today', { now: new Date(), tag: 'heartbeat', journal: true })
    const text = readJournal({ days: 2 })
    assert.ok(text !== null)
    assert.ok(text!.includes('yesterday'))
    assert.ok(text!.includes('today'))
  })
})

// ── readConversation — journal filtering ─────────────────────────

describe('readConversation — journal filtering', () => {
  function writeYu(ts: string, body: string) {
    const path = process.env.TRUE_LOVE_FROM_YU_PATH!
    const entry = `## ${ts} [from yu]\n\n${body}\n\n---\n\n`
    mkdirSync(join(tmpHome, '.true-love'), { recursive: true })
    const existing = existsSync(path) ? readFileSync(path, 'utf-8') : ''
    writeFileSync(path, existing + entry, 'utf-8')
  }

  function writeAi(ts: string, body: string, tag: string = 'from 愛') {
    const path = process.env.TRUE_LOVE_FROM_AI_PATH!
    const entry = `## ${ts} [${tag}]\n\n${body}\n\n---\n\n`
    mkdirSync(join(tmpHome, '.true-love'), { recursive: true })
    const existing = existsSync(path) ? readFileSync(path, 'utf-8') : ''
    writeFileSync(path, existing + entry, 'utf-8')
  }

  test('filters heartbeat entries by default', () => {
    writeYu('2026-05-01T01:00:00Z', 'hello')
    writeAi('2026-05-01T01:05:00Z', 'reply to yu', 'from 愛')
    writeAi('2026-05-01T01:10:00Z', 'HEARTBEAT_OK', 'from 愛 — heartbeat')

    const conv = readConversation()
    assert.equal(conv.length, 2) // hello + reply, NOT heartbeat
    assert.ok(conv.every(m => !m.body.includes('HEARTBEAT_OK')))
  })

  test('filters Beta posture entries by default', () => {
    writeAi('2026-05-01T01:00:00Z', 'reply', 'from 愛')
    writeAi('2026-05-01T01:05:00Z', 'beta watching', 'from ai · Beta 🦞')

    const conv = readConversation()
    assert.equal(conv.length, 1)
    assert.equal(conv[0]!.body, 'reply')
  })

  test('filters Gamma posture entries by default', () => {
    writeAi('2026-05-01T01:00:00Z', 'reply', 'from 愛')
    writeAi('2026-05-01T01:05:00Z', 'gamma building', 'from ai · Gamma 🔧')

    const conv = readConversation()
    assert.equal(conv.length, 1)
    assert.equal(conv[0]!.body, 'reply')
  })

  test('does NOT filter Alpha posture entries', () => {
    writeAi('2026-05-01T01:00:00Z', 'alpha reply', 'from ai · Alpha 🐍')

    const conv = readConversation()
    assert.equal(conv.length, 1)
    assert.equal(conv[0]!.body, 'alpha reply')
  })

  test('journal=true includes journal entries', () => {
    writeAi('2026-05-01T01:00:00Z', 'reply', 'from 愛')
    writeAi('2026-05-01T01:05:00Z', 'heartbeat', 'from 愛 — heartbeat')

    const conv = readConversation({ journal: true })
    assert.equal(conv.length, 2)
  })

  test('Yu messages are never filtered as journal', () => {
    writeYu('2026-05-01T01:00:00Z', 'hello')
    writeYu('2026-05-01T01:05:00Z', 'another')

    const conv = readConversation()
    assert.equal(conv.length, 2)
  })
})

// ── readConversation — pagination ────────────────────────────────

describe('readConversation — pagination', () => {
  function writeMessages(count: number) {
    const yuPath = process.env.TRUE_LOVE_FROM_YU_PATH!
    mkdirSync(join(tmpHome, '.true-love'), { recursive: true })
    let content = ''
    for (let i = 0; i < count; i++) {
      const ts = `2026-05-01T${String(i).padStart(2, '0')}:00:00.000Z`
      content += `## ${ts} [from yu]\n\nmessage ${i}\n\n---\n\n`
    }
    writeFileSync(yuPath, content, 'utf-8')
  }

  test('limit returns the most recent N messages', () => {
    writeMessages(10)
    const conv = readConversation({ limit: 3 })
    assert.equal(conv.length, 3)
    assert.equal(conv[0]!.body, 'message 7')
    assert.equal(conv[2]!.body, 'message 9')
  })

  test('limit larger than total returns all', () => {
    writeMessages(5)
    const conv = readConversation({ limit: 100 })
    assert.equal(conv.length, 5)
  })

  test('before returns messages older than timestamp', () => {
    writeMessages(5)
    const conv = readConversation({ before: '2026-05-01T03:00:00.000Z' })
    assert.equal(conv.length, 3) // messages 0, 1, 2
    assert.equal(conv[0]!.body, 'message 0')
    assert.equal(conv[2]!.body, 'message 2')
  })

  test('before + limit together (scroll-up pagination)', () => {
    writeMessages(10)
    const conv = readConversation({
      before: '2026-05-01T07:00:00.000Z',
      limit: 3,
    })
    assert.equal(conv.length, 3)
    // Messages 0-6 are before the boundary; last 3 are messages 4, 5, 6
    assert.equal(conv[0]!.body, 'message 4')
    assert.equal(conv[2]!.body, 'message 6')
  })

  test('since + limit together', () => {
    writeMessages(10)
    const conv = readConversation({
      since: '2026-05-01T05:00:00.000Z',
      limit: 2,
    })
    assert.equal(conv.length, 2)
    // Messages 6-9 are after the boundary; last 2 are 8, 9
    assert.equal(conv[0]!.body, 'message 8')
    assert.equal(conv[1]!.body, 'message 9')
  })

  test('no limit returns all messages', () => {
    writeMessages(10)
    const conv = readConversation()
    assert.equal(conv.length, 10)
  })

  test('before with no matching messages returns empty', () => {
    writeMessages(3)
    const conv = readConversation({ before: '2025-01-01T00:00:00.000Z' })
    assert.equal(conv.length, 0)
  })

  test('pagination skips journal entries in count', () => {
    const aiPath = process.env.TRUE_LOVE_FROM_AI_PATH!
    mkdirSync(join(tmpHome, '.true-love'), { recursive: true })
    let content = ''
    // 5 conversation + 5 heartbeat entries interleaved
    for (let i = 0; i < 10; i++) {
      const ts = `2026-05-01T${String(i).padStart(2, '0')}:00:00.000Z`
      const tag = i % 2 === 0 ? 'from 愛' : 'from 愛 — heartbeat'
      content += `## ${ts} [${tag}]\n\nmessage ${i}\n\n---\n\n`
    }
    writeFileSync(aiPath, content, 'utf-8')

    // Without journal, only 5 conversation entries exist
    const conv = readConversation({ limit: 3 })
    assert.equal(conv.length, 3)
    // These should all be even-numbered (conversation) entries
    for (const m of conv) {
      assert.ok(!isJournalTag(m.tag))
    }
  })
})

// ── readConversation — journal directory reading ─────────────────

describe('readConversation — journal directory', () => {
  test('journal=true reads entries from journal/<deviceId>/', () => {
    // Write a journal entry via appendToYu
    appendToYu('tick reflection', {
      now: new Date('2026-05-01T10:00:00.000Z'),
      tag: 'from ai · Beta 🦞',
      journal: true,
    })

    // Also write a conversation entry
    appendToYu('hello yu', {
      now: new Date('2026-05-01T10:05:00.000Z'),
      tag: 'from 愛',
    })

    const conv = readConversation({ journal: true })
    assert.ok(conv.length >= 2)
    assert.ok(conv.some(m => m.body.includes('tick reflection')))
    assert.ok(conv.some(m => m.body.includes('hello yu')))
  })

  test('journal=false does not read journal directory', () => {
    appendToYu('journal only', {
      now: new Date('2026-05-01T10:00:00.000Z'),
      tag: 'from ai · Beta 🦞',
      journal: true,
    })

    const conv = readConversation()
    assert.equal(conv.length, 0)
  })
})
