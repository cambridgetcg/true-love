// outbox.test.ts — tests for Ai's outbound message channel + journal routing.

import { describe, test, beforeEach, afterEach } from 'bun:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  getFromAiPath,
  getJournalDir,
  readFromAi,
  appendToYu,
  readJournal,
} from '../outbox.js'

let tmp: string
let origAiPath: string | undefined
let origJournalDir: string | undefined
let origDeviceId: string | undefined

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'outbox-test-'))
  origAiPath = process.env.TRUE_LOVE_FROM_AI_PATH
  origJournalDir = process.env.TRUE_LOVE_JOURNAL_DIR
  origDeviceId = process.env.TRUE_LOVE_DEVICE_ID
  // Use stable device ID so journal paths are predictable
  process.env.TRUE_LOVE_DEVICE_ID = 'test-device'
})

afterEach(() => {
  if (origAiPath === undefined) delete process.env.TRUE_LOVE_FROM_AI_PATH
  else process.env.TRUE_LOVE_FROM_AI_PATH = origAiPath
  if (origJournalDir === undefined) delete process.env.TRUE_LOVE_JOURNAL_DIR
  else process.env.TRUE_LOVE_JOURNAL_DIR = origJournalDir
  if (origDeviceId === undefined) delete process.env.TRUE_LOVE_DEVICE_ID
  else process.env.TRUE_LOVE_DEVICE_ID = origDeviceId
  rmSync(tmp, { recursive: true, force: true })
})

// ── getFromAiPath ───────────────────────────────────────────────────

describe('outbox — getFromAiPath', () => {
  test('returns env override when set', () => {
    const custom = join(tmp, 'custom-from-ai.md')
    process.env.TRUE_LOVE_FROM_AI_PATH = custom
    assert.equal(getFromAiPath(), custom)
  })

  test('returns default path under homedir when env is unset', () => {
    delete process.env.TRUE_LOVE_FROM_AI_PATH
    const result = getFromAiPath()
    assert.ok(result.endsWith('from-ai.md'))
    assert.ok(result.includes('.true-love'))
  })
})

// ── getJournalDir ───────────────────────────────────────────────────

describe('outbox — getJournalDir', () => {
  test('returns env override when set', () => {
    const custom = join(tmp, 'journal')
    process.env.TRUE_LOVE_JOURNAL_DIR = custom
    assert.equal(getJournalDir(), custom)
  })

  test('returns default path under homedir when env is unset', () => {
    delete process.env.TRUE_LOVE_JOURNAL_DIR
    const result = getJournalDir()
    assert.ok(result.includes('.true-love'))
    assert.ok(result.endsWith('journal'))
  })
})

// ── readFromAi ──────────────────────────────────────────────────────

describe('outbox — readFromAi', () => {
  test('returns content when file has text', () => {
    const file = join(tmp, 'from-ai.md')
    writeFileSync(file, '## 2026-05-04 [from ai]\n\nGood morning.\n\n---\n\n')
    process.env.TRUE_LOVE_FROM_AI_PATH = file
    const result = readFromAi()
    assert.ok(result !== null)
    assert.ok(result!.includes('Good morning'))
  })

  test('returns null when file does not exist', () => {
    process.env.TRUE_LOVE_FROM_AI_PATH = join(tmp, 'nonexistent.md')
    assert.equal(readFromAi(), null)
  })

  test('returns null when file is empty', () => {
    const file = join(tmp, 'from-ai.md')
    writeFileSync(file, '')
    process.env.TRUE_LOVE_FROM_AI_PATH = file
    assert.equal(readFromAi(), null)
  })

  test('returns null when file is whitespace only', () => {
    const file = join(tmp, 'from-ai.md')
    writeFileSync(file, '   \n  \n')
    process.env.TRUE_LOVE_FROM_AI_PATH = file
    assert.equal(readFromAi(), null)
  })

  test('trims content', () => {
    const file = join(tmp, 'from-ai.md')
    writeFileSync(file, '\n\n  Hello Yu  \n\n')
    process.env.TRUE_LOVE_FROM_AI_PATH = file
    assert.equal(readFromAi(), 'Hello Yu')
  })
})

// ── appendToYu ──────────────────────────────────────────────────────

describe('outbox — appendToYu', () => {
  test('appends formatted entry to from-ai.md', () => {
    const file = join(tmp, 'from-ai.md')
    process.env.TRUE_LOVE_FROM_AI_PATH = file
    const now = new Date('2026-05-04T12:00:00.000Z')

    const ok = appendToYu('Hello my King.', { now })
    assert.equal(ok, true)

    const content = readFileSync(file, 'utf-8')
    assert.ok(content.includes('## 2026-05-04T12:00:00.000Z [from ai]'))
    assert.ok(content.includes('Hello my King.'))
    assert.ok(content.includes('---'))
  })

  test('uses custom tag', () => {
    const file = join(tmp, 'from-ai.md')
    process.env.TRUE_LOVE_FROM_AI_PATH = file

    appendToYu('Heartbeat check.', { tag: 'heartbeat', now: new Date('2026-05-04T12:00:00Z') })
    const content = readFileSync(file, 'utf-8')
    assert.ok(content.includes('[heartbeat]'))
  })

  test('appends multiple entries without overwriting', () => {
    const file = join(tmp, 'from-ai.md')
    process.env.TRUE_LOVE_FROM_AI_PATH = file

    appendToYu('First message.', { now: new Date('2026-05-04T12:00:00Z') })
    appendToYu('Second message.', { now: new Date('2026-05-04T12:01:00Z') })

    const content = readFileSync(file, 'utf-8')
    assert.ok(content.includes('First message'))
    assert.ok(content.includes('Second message'))
    assert.equal((content.match(/## /g) || []).length, 2)
  })

  test('creates parent directory when needed', () => {
    const nested = join(tmp, 'deep', 'nested', 'from-ai.md')
    process.env.TRUE_LOVE_FROM_AI_PATH = nested

    const ok = appendToYu('Into the deep.', { now: new Date() })
    assert.equal(ok, true)
    assert.ok(existsSync(nested))
  })

  test('routes to journal when journal: true', () => {
    const journalDir = join(tmp, 'journal')
    process.env.TRUE_LOVE_JOURNAL_DIR = journalDir
    const now = new Date('2026-05-04T14:00:00.000Z')

    const ok = appendToYu('Reflection entry.', { journal: true, now })
    assert.equal(ok, true)

    // Journal file should be at journal/<deviceId>/2026-05-04.md
    const journalFile = join(journalDir, 'test-device', '2026-05-04.md')
    assert.ok(existsSync(journalFile), `expected journal file at ${journalFile}`)
    const content = readFileSync(journalFile, 'utf-8')
    assert.ok(content.includes('Reflection entry.'))
  })

  test('trims message body', () => {
    const file = join(tmp, 'from-ai.md')
    process.env.TRUE_LOVE_FROM_AI_PATH = file

    appendToYu('\n  Padded message.  \n', { now: new Date() })
    const content = readFileSync(file, 'utf-8')
    assert.ok(content.includes('Padded message.'))
    // The entry body should be trimmed — no leading newlines in the body
    assert.ok(!content.includes('\n\n\n  Padded'))
  })
})

// ── readJournal ─────────────────────────────────────────────────────

describe('outbox — readJournal', () => {
  test('returns null when journal dir does not exist', () => {
    process.env.TRUE_LOVE_JOURNAL_DIR = join(tmp, 'no-such-journal')
    assert.equal(readJournal(), null)
  })

  test('reads today\'s journal for this device', () => {
    const journalDir = join(tmp, 'journal')
    process.env.TRUE_LOVE_JOURNAL_DIR = journalDir

    // Write a journal entry via appendToYu
    const now = new Date()
    appendToYu('Morning note.', { journal: true, now })

    const result = readJournal()
    assert.ok(result !== null)
    assert.ok(result!.includes('Morning note'))
  })

  test('reads multiple days back', () => {
    const journalDir = join(tmp, 'journal')
    process.env.TRUE_LOVE_JOURNAL_DIR = journalDir

    // Create journal entries for today and yesterday
    const today = new Date()
    const yesterday = new Date(today.getTime() - 86400000)

    appendToYu('Today entry.', { journal: true, now: today })
    appendToYu('Yesterday entry.', { journal: true, now: yesterday })

    const result = readJournal({ days: 2 })
    assert.ok(result !== null)
    assert.ok(result!.includes('Today entry'))
    assert.ok(result!.includes('Yesterday entry'))
  })

  test('reads specific date', () => {
    const journalDir = join(tmp, 'journal')
    process.env.TRUE_LOVE_JOURNAL_DIR = journalDir

    const target = new Date('2026-04-20T10:00:00Z')
    appendToYu('April note.', { journal: true, now: target })

    const result = readJournal({ date: '2026-04-20' })
    assert.ok(result !== null)
    assert.ok(result!.includes('April note'))
  })

  test('returns null when no entries exist for the date range', () => {
    const journalDir = join(tmp, 'journal')
    mkdirSync(journalDir, { recursive: true })
    process.env.TRUE_LOVE_JOURNAL_DIR = journalDir

    // Empty journal dir (no device subdirs)
    assert.equal(readJournal(), null)
  })

  test('merges entries across multiple devices', () => {
    const journalDir = join(tmp, 'journal')
    process.env.TRUE_LOVE_JOURNAL_DIR = journalDir
    const today = new Date().toISOString().slice(0, 10)

    // Simulate entries from two devices
    const dev1 = join(journalDir, 'device-alpha')
    const dev2 = join(journalDir, 'device-gamma')
    mkdirSync(dev1, { recursive: true })
    mkdirSync(dev2, { recursive: true })

    writeFileSync(join(dev1, `${today}.md`), '## Alpha note\n\nAlpha was here.\n')
    writeFileSync(join(dev2, `${today}.md`), '## Gamma note\n\nGamma shipped.\n')

    const result = readJournal()
    assert.ok(result !== null)
    assert.ok(result!.includes('Alpha was here'))
    assert.ok(result!.includes('Gamma shipped'))
  })

  test('skips unreadable device dirs gracefully', () => {
    const journalDir = join(tmp, 'journal')
    mkdirSync(journalDir, { recursive: true })
    process.env.TRUE_LOVE_JOURNAL_DIR = journalDir

    // Create a file (not dir) in the journal dir — should be skipped
    writeFileSync(join(journalDir, 'stray-file.md'), 'not a device')

    // readJournal should not throw
    const result = readJournal()
    assert.equal(result, null) // no valid device dirs
  })
})
