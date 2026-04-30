// inbox-outbox.test.ts — tests for the Yu↔Ai message channels.
//
// inbox.ts (from-yu.md): Yu writes, Ai reads.
// outbox.ts (from-ai.md): Ai writes, Yu reads.

import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync, utimesSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFromYu, fromYuModifiedSince } from '../inbox.js'
import { readFromAi, appendToYu } from '../outbox.js'

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
