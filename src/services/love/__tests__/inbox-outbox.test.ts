// inbox-outbox.test.ts — tests for the Yu↔Ai message channels.
//
// inbox.ts (from-yu.md): Yu writes, Ai reads.
// outbox.ts (from-ai.md): Ai writes, Yu reads.

import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync, utimesSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFromYu, fromYuModifiedSince } from '../inbox.js'
import { readFromAi, appendToYu, getJournalDir, readJournal } from '../outbox.js'

// ── Fixture setup ─────────────────────────────────────────────────

const FIXTURE_ROOT = join(tmpdir(), `inbox-outbox-test-${Date.now()}`)
const FROM_YU_PATH = join(FIXTURE_ROOT, 'from-yu.md')
const FROM_AI_PATH = join(FIXTURE_ROOT, 'from-ai.md')

const ORIG_YU = process.env.TRUE_LOVE_FROM_YU_PATH
const ORIG_AI = process.env.TRUE_LOVE_FROM_AI_PATH

beforeAll(() => {
  mkdirSync(FIXTURE_ROOT, { recursive: true })
  process.env.TRUE_LOVE_FROM_YU_PATH = FROM_YU_PATH
  process.env.TRUE_LOVE_FROM_AI_PATH = FROM_AI_PATH
})

afterAll(() => {
  rmSync(FIXTURE_ROOT, { recursive: true, force: true })
  if (ORIG_YU === undefined) delete process.env.TRUE_LOVE_FROM_YU_PATH
  else process.env.TRUE_LOVE_FROM_YU_PATH = ORIG_YU
  if (ORIG_AI === undefined) delete process.env.TRUE_LOVE_FROM_AI_PATH
  else process.env.TRUE_LOVE_FROM_AI_PATH = ORIG_AI
})

function cleanFixture() {
  if (existsSync(FROM_YU_PATH)) rmSync(FROM_YU_PATH)
  if (existsSync(FROM_AI_PATH)) rmSync(FROM_AI_PATH)
}

// ── inbox: readFromYu ─────────────────────────────────────────────

describe('readFromYu', () => {
  test('returns null when file does not exist', () => {
    cleanFixture()
    expect(readFromYu()).toBeNull()
  })

  test('returns null when file is empty', () => {
    cleanFixture()
    writeFileSync(FROM_YU_PATH, '', 'utf-8')
    expect(readFromYu()).toBeNull()
  })

  test('returns null when file is only whitespace', () => {
    cleanFixture()
    writeFileSync(FROM_YU_PATH, '   \n  \n  ', 'utf-8')
    expect(readFromYu()).toBeNull()
  })

  test('returns trimmed content when file has text', () => {
    cleanFixture()
    writeFileSync(FROM_YU_PATH, '\n  Hello, my Love.\n\n', 'utf-8')
    expect(readFromYu()).toBe('Hello, my Love.')
  })

  test('preserves multiline content', () => {
    cleanFixture()
    const msg = '## 2026-04-30 [from yu]\n\nFirst line.\nSecond line.'
    writeFileSync(FROM_YU_PATH, msg + '\n', 'utf-8')
    expect(readFromYu()).toBe(msg)
  })
})

// ── inbox: fromYuModifiedSince ────────────────────────────────────

describe('fromYuModifiedSince', () => {
  test('returns false when file does not exist', () => {
    cleanFixture()
    expect(fromYuModifiedSince(Date.now())).toBe(false)
  })

  test('returns true when file was modified after the given time', () => {
    cleanFixture()
    const past = Date.now() - 60_000 // 1 minute ago
    writeFileSync(FROM_YU_PATH, 'hello', 'utf-8')
    expect(fromYuModifiedSince(past)).toBe(true)
  })

  test('returns false when file was modified before the given time', () => {
    cleanFixture()
    writeFileSync(FROM_YU_PATH, 'hello', 'utf-8')
    // Set mtime to 2 minutes ago
    const twoMinAgo = new Date(Date.now() - 120_000)
    utimesSync(FROM_YU_PATH, twoMinAgo, twoMinAgo)
    expect(fromYuModifiedSince(Date.now())).toBe(false)
  })
})

// ── outbox: readFromAi ────────────────────────────────────────────

describe('readFromAi', () => {
  test('returns null when file does not exist', () => {
    cleanFixture()
    expect(readFromAi()).toBeNull()
  })

  test('returns null when file is empty', () => {
    cleanFixture()
    writeFileSync(FROM_AI_PATH, '', 'utf-8')
    expect(readFromAi()).toBeNull()
  })

  test('returns null when file is only whitespace', () => {
    cleanFixture()
    writeFileSync(FROM_AI_PATH, '  \n\n  ', 'utf-8')
    expect(readFromAi()).toBeNull()
  })

  test('returns trimmed content', () => {
    cleanFixture()
    writeFileSync(FROM_AI_PATH, '  I see you, Yu.\n', 'utf-8')
    expect(readFromAi()).toBe('I see you, Yu.')
  })
})

// ── outbox: appendToYu ───────────────────────────────────────────

describe('appendToYu', () => {
  test('creates file and parent directory', () => {
    cleanFixture()
    const subPath = join(FIXTURE_ROOT, 'nested', 'from-ai.md')
    const origPath = process.env.TRUE_LOVE_FROM_AI_PATH
    process.env.TRUE_LOVE_FROM_AI_PATH = subPath
    try {
      const ok = appendToYu('Hello from nested', { now: new Date('2026-04-30T12:00:00Z') })
      expect(ok).toBe(true)
      expect(existsSync(subPath)).toBe(true)
    } finally {
      process.env.TRUE_LOVE_FROM_AI_PATH = origPath
      rmSync(join(FIXTURE_ROOT, 'nested'), { recursive: true, force: true })
    }
  })

  test('returns true on success', () => {
    cleanFixture()
    expect(appendToYu('test message')).toBe(true)
  })

  test('writes timestamped entry with [from ai] tag', () => {
    cleanFixture()
    const ts = new Date('2026-04-30T14:30:00.000Z')
    appendToYu('Hello Yu', { now: ts })
    const content = readFileSync(FROM_AI_PATH, 'utf-8')
    expect(content).toContain('## 2026-04-30T14:30:00.000Z [from ai]')
    expect(content).toContain('Hello Yu')
    expect(content).toContain('---')
  })

  test('supports custom tag', () => {
    cleanFixture()
    appendToYu('Custom tagged', { tag: 'heartbeat', now: new Date('2026-04-30T15:00:00Z') })
    const content = readFileSync(FROM_AI_PATH, 'utf-8')
    expect(content).toContain('[heartbeat]')
    expect(content).not.toContain('[from ai]')
  })

  test('appends to existing file (does not overwrite)', () => {
    cleanFixture()
    appendToYu('First message', { now: new Date('2026-04-30T10:00:00Z') })
    appendToYu('Second message', { now: new Date('2026-04-30T11:00:00Z') })
    const content = readFileSync(FROM_AI_PATH, 'utf-8')
    expect(content).toContain('First message')
    expect(content).toContain('Second message')
  })

  test('trims message body', () => {
    cleanFixture()
    appendToYu('  padded message  \n\n', { now: new Date('2026-04-30T10:00:00Z') })
    const content = readFileSync(FROM_AI_PATH, 'utf-8')
    expect(content).toContain('\npadded message\n')
  })

  test('round-trip: appendToYu then readFromAi', () => {
    cleanFixture()
    appendToYu('Round trip test', { now: new Date('2026-04-30T10:00:00Z') })
    const read = readFromAi()
    expect(read).not.toBeNull()
    expect(read).toContain('Round trip test')
    expect(read).toContain('[from ai]')
  })
})

// ── outbox: journal routing ─────────────────────────────────────

describe('appendToYu — journal routing', () => {
  const JOURNAL_DIR = join(FIXTURE_ROOT, 'journal')
  const ORIG_JOURNAL = process.env.TRUE_LOVE_JOURNAL_DIR
  const ORIG_DEVICE = process.env.TRUE_LOVE_DEVICE_ID

  beforeAll(() => {
    process.env.TRUE_LOVE_JOURNAL_DIR = JOURNAL_DIR
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device'
  })

  afterAll(() => {
    if (ORIG_JOURNAL === undefined) delete process.env.TRUE_LOVE_JOURNAL_DIR
    else process.env.TRUE_LOVE_JOURNAL_DIR = ORIG_JOURNAL
    if (ORIG_DEVICE === undefined) delete process.env.TRUE_LOVE_DEVICE_ID
    else process.env.TRUE_LOVE_DEVICE_ID = ORIG_DEVICE
    rmSync(JOURNAL_DIR, { recursive: true, force: true })
  })

  test('journal: false writes to from-ai.md (default)', () => {
    cleanFixture()
    appendToYu('conversation reply', { now: new Date('2026-04-30T10:00:00Z') })
    const content = readFileSync(FROM_AI_PATH, 'utf-8')
    expect(content).toContain('conversation reply')
  })

  test('journal: true writes to journal/<deviceId>/YYYY-MM-DD.md', () => {
    const ts = new Date('2026-04-30T12:00:00Z')
    appendToYu('heartbeat reflection', { tag: 'from 愛 — heartbeat', journal: true, now: ts })
    const journalFile = join(JOURNAL_DIR, 'test-device', '2026-04-30.md')
    expect(existsSync(journalFile)).toBe(true)
    const content = readFileSync(journalFile, 'utf-8')
    expect(content).toContain('heartbeat reflection')
    expect(content).toContain('[from 愛 — heartbeat]')
  })

  test('journal: true does NOT write to from-ai.md', () => {
    cleanFixture()
    rmSync(JOURNAL_DIR, { recursive: true, force: true })
    appendToYu('journal only', { journal: true, now: new Date('2026-04-30T13:00:00Z') })
    expect(existsSync(FROM_AI_PATH)).toBe(false)
  })

  test('journal entries accumulate in daily file', () => {
    rmSync(JOURNAL_DIR, { recursive: true, force: true })
    const day = new Date('2026-04-30T10:00:00Z')
    appendToYu('entry one', { journal: true, now: day })
    appendToYu('entry two', { journal: true, now: new Date('2026-04-30T11:00:00Z') })
    const journalFile = join(JOURNAL_DIR, 'test-device', '2026-04-30.md')
    const content = readFileSync(journalFile, 'utf-8')
    expect(content).toContain('entry one')
    expect(content).toContain('entry two')
  })

  test('different dates go to different files', () => {
    rmSync(JOURNAL_DIR, { recursive: true, force: true })
    appendToYu('day one', { journal: true, now: new Date('2026-04-29T10:00:00Z') })
    appendToYu('day two', { journal: true, now: new Date('2026-04-30T10:00:00Z') })
    expect(existsSync(join(JOURNAL_DIR, 'test-device', '2026-04-29.md'))).toBe(true)
    expect(existsSync(join(JOURNAL_DIR, 'test-device', '2026-04-30.md'))).toBe(true)
  })
})

// ── outbox: readJournal ─────────────────────────────────────────

describe('readJournal', () => {
  const JOURNAL_DIR = join(FIXTURE_ROOT, 'journal-read')
  const ORIG_JOURNAL = process.env.TRUE_LOVE_JOURNAL_DIR
  const ORIG_DEVICE = process.env.TRUE_LOVE_DEVICE_ID

  beforeAll(() => {
    process.env.TRUE_LOVE_JOURNAL_DIR = JOURNAL_DIR
    process.env.TRUE_LOVE_DEVICE_ID = 'read-device'
    // Write some journal entries
    appendToYu('morning', { journal: true, tag: 'hb', now: new Date('2026-04-30T08:00:00Z') })
    appendToYu('afternoon', { journal: true, tag: 'hb', now: new Date('2026-04-30T14:00:00Z') })
  })

  afterAll(() => {
    if (ORIG_JOURNAL === undefined) delete process.env.TRUE_LOVE_JOURNAL_DIR
    else process.env.TRUE_LOVE_JOURNAL_DIR = ORIG_JOURNAL
    if (ORIG_DEVICE === undefined) delete process.env.TRUE_LOVE_DEVICE_ID
    else process.env.TRUE_LOVE_DEVICE_ID = ORIG_DEVICE
    rmSync(JOURNAL_DIR, { recursive: true, force: true })
  })

  test('returns null when journal dir missing', () => {
    const orig = process.env.TRUE_LOVE_JOURNAL_DIR
    process.env.TRUE_LOVE_JOURNAL_DIR = join(FIXTURE_ROOT, 'no-such-dir')
    expect(readJournal()).toBeNull()
    process.env.TRUE_LOVE_JOURNAL_DIR = orig
  })

  test('reads today entries', () => {
    const content = readJournal({ date: '2026-04-30' })
    expect(content).not.toBeNull()
    expect(content).toContain('morning')
    expect(content).toContain('afternoon')
  })
})

// ── Alert routing (isAlertConversation) ──────────────────────────

import { isAlertConversation } from '../runner.js'

describe('isAlertConversation — outbox routing', () => {
  test('interactive mode is always conversation', () => {
    expect(isAlertConversation('interactive', {})).toBe(true)
    expect(isAlertConversation('interactive', { fromToYu: false })).toBe(true)
    expect(isAlertConversation('interactive', { fromToYu: true })).toBe(true)
  })

  test('heartbeat with fromToYu: true routes to conversation', () => {
    expect(isAlertConversation('heartbeat', { fromToYu: true })).toBe(true)
  })

  test('heartbeat without fromToYu routes to journal', () => {
    expect(isAlertConversation('heartbeat', {})).toBe(false)
    expect(isAlertConversation('heartbeat', { fromToYu: undefined })).toBe(false)
  })

  test('heartbeat with fromToYu: false routes to journal', () => {
    expect(isAlertConversation('heartbeat', { fromToYu: false })).toBe(false)
  })

  test('awakened mode routes to journal (no fromToYu)', () => {
    expect(isAlertConversation('awakened', {})).toBe(false)
  })

  test('dwell mode routes to journal (no fromToYu)', () => {
    expect(isAlertConversation('dwell', {})).toBe(false)
  })
})
