// channels.test.ts — tests for inbox, outbox, state, and tasks modules.
//
// These four modules share the same shape: file-based read/write with env
// var overrides for the file path. Grouped here because each is small and
// their test patterns are identical.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// ── Inbox ──���──────────────────────────────────────────────────────

import { readFromYu, fromYuModifiedSince, getFromYuPath } from './inbox.js'

const INBOX_DIR = '/tmp/true-love-inbox-test'

describe('inbox', () => {
  let saved: string | undefined

  beforeEach(() => {
    saved = process.env.TRUE_LOVE_FROM_YU_PATH
    rmSync(INBOX_DIR, { recursive: true, force: true })
    mkdirSync(INBOX_DIR, { recursive: true })
    process.env.TRUE_LOVE_FROM_YU_PATH = join(INBOX_DIR, 'from-yu.md')
  })

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.TRUE_LOVE_FROM_YU_PATH
    } else {
      process.env.TRUE_LOVE_FROM_YU_PATH = saved
    }
    rmSync(INBOX_DIR, { recursive: true, force: true })
  })

  test('getFromYuPath respects env override', () => {
    expect(getFromYuPath()).toBe(join(INBOX_DIR, 'from-yu.md'))
  })

  test('readFromYu returns null for missing file', () => {
    expect(readFromYu()).toBeNull()
  })

  test('readFromYu returns null for empty file', () => {
    writeFileSync(getFromYuPath(), '')
    expect(readFromYu()).toBeNull()
  })

  test('readFromYu returns null for whitespace-only file', () => {
    writeFileSync(getFromYuPath(), '   \n\n  ')
    expect(readFromYu()).toBeNull()
  })

  test('readFromYu returns trimmed content', () => {
    writeFileSync(getFromYuPath(), '  Hello from Yu  \n')
    expect(readFromYu()).toBe('Hello from Yu')
  })

  test('readFromYu returns full markdown content', () => {
    const content = '## Message\n\nHere is what I want to say.\n\n---\n'
    writeFileSync(getFromYuPath(), content)
    const result = readFromYu()
    expect(result).toContain('## Message')
    expect(result).toContain('Here is what I want to say.')
  })

  test('fromYuModifiedSince returns false for missing file', () => {
    expect(fromYuModifiedSince(Date.now())).toBe(false)
  })

  test('fromYuModifiedSince returns true for file modified after timestamp', () => {
    const before = Date.now() - 1000
    writeFileSync(getFromYuPath(), 'new message')
    expect(fromYuModifiedSince(before)).toBe(true)
  })

  test('fromYuModifiedSince returns false for file modified before timestamp', () => {
    writeFileSync(getFromYuPath(), 'old message')
    // Give the fs a moment, then check against a future timestamp
    const future = Date.now() + 5000
    expect(fromYuModifiedSince(future)).toBe(false)
  })
})

// ── Outbox ────────────────────────────────────────────────────────

import { readFromAi, appendToYu, getFromAiPath } from './outbox.js'

const OUTBOX_DIR = '/tmp/true-love-outbox-test'

describe('outbox', () => {
  let saved: string | undefined

  beforeEach(() => {
    saved = process.env.TRUE_LOVE_FROM_AI_PATH
    rmSync(OUTBOX_DIR, { recursive: true, force: true })
    mkdirSync(OUTBOX_DIR, { recursive: true })
    process.env.TRUE_LOVE_FROM_AI_PATH = join(OUTBOX_DIR, 'from-ai.md')
  })

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.TRUE_LOVE_FROM_AI_PATH
    } else {
      process.env.TRUE_LOVE_FROM_AI_PATH = saved
    }
    rmSync(OUTBOX_DIR, { recursive: true, force: true })
  })

  test('getFromAiPath respects env override', () => {
    expect(getFromAiPath()).toBe(join(OUTBOX_DIR, 'from-ai.md'))
  })

  test('readFromAi returns null for missing file', () => {
    expect(readFromAi()).toBeNull()
  })

  test('readFromAi returns null for empty file', () => {
    writeFileSync(getFromAiPath(), '')
    expect(readFromAi()).toBeNull()
  })

  test('readFromAi returns trimmed content', () => {
    writeFileSync(getFromAiPath(), '  Message from Ai  \n')
    expect(readFromAi()).toBe('Message from Ai')
  })

  test('appendToYu creates file and parent directory', () => {
    const path = join(OUTBOX_DIR, 'nested', 'from-ai.md')
    process.env.TRUE_LOVE_FROM_AI_PATH = path
    const result = appendToYu('Hello Yu')
    expect(result).toBe(true)
    expect(existsSync(path)).toBe(true)
  })

  test('appendToYu writes timestamped entry', () => {
    const now = new Date('2026-04-27T12:00:00Z')
    appendToYu('Test message', { now })
    const content = readFileSync(getFromAiPath(), 'utf-8')
    expect(content).toContain('## 2026-04-27T12:00:00.000Z [from ai]')
    expect(content).toContain('Test message')
    expect(content).toContain('---')
  })

  test('appendToYu appends multiple messages', () => {
    appendToYu('First', { now: new Date('2026-04-27T10:00:00Z') })
    appendToYu('Second', { now: new Date('2026-04-27T11:00:00Z') })
    const content = readFileSync(getFromAiPath(), 'utf-8')
    expect(content).toContain('First')
    expect(content).toContain('Second')
    const headers = content.match(/\[from ai\]/g)
    expect(headers?.length).toBe(2)
  })

  test('appendToYu trims message whitespace', () => {
    appendToYu('  padded  ', { now: new Date('2026-04-27T12:00:00Z') })
    const content = readFileSync(getFromAiPath(), 'utf-8')
    expect(content).toContain('\npadded\n')
  })

  test('round-trip: appendToYu then readFromAi', () => {
    appendToYu('Round trip message', { now: new Date('2026-04-27T12:00:00Z') })
    const read = readFromAi()
    expect(read).toContain('Round trip message')
    expect(read).toContain('[from ai]')
  })
})

// ── State ───────────────────────────────────────────���─────────────

import { readLoveStateBlock, getStatePath, LOVE_STATE_BLOCK_PREFIX } from './state.js'

const STATE_DIR = '/tmp/true-love-state-test'

describe('state', () => {
  let saved: string | undefined

  beforeEach(() => {
    saved = process.env.TRUE_LOVE_STATE_PATH
    rmSync(STATE_DIR, { recursive: true, force: true })
    mkdirSync(STATE_DIR, { recursive: true })
    process.env.TRUE_LOVE_STATE_PATH = join(STATE_DIR, 'state.md')
  })

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.TRUE_LOVE_STATE_PATH
    } else {
      process.env.TRUE_LOVE_STATE_PATH = saved
    }
    rmSync(STATE_DIR, { recursive: true, force: true })
  })

  test('getStatePath respects env override', () => {
    expect(getStatePath()).toBe(join(STATE_DIR, 'state.md'))
  })

  test('LOVE_STATE_BLOCK_PREFIX is the expected string', () => {
    expect(LOVE_STATE_BLOCK_PREFIX).toBe("# 愛's current state")
  })

  test('readLoveStateBlock returns null for missing file', () => {
    expect(readLoveStateBlock()).toBeNull()
  })

  test('readLoveStateBlock returns null for empty file', () => {
    writeFileSync(getStatePath(), '')
    expect(readLoveStateBlock()).toBeNull()
  })

  test('readLoveStateBlock returns null for whitespace-only file', () => {
    writeFileSync(getStatePath(), '   \n\n  ')
    expect(readLoveStateBlock()).toBeNull()
  })

  test('readLoveStateBlock prepends prefix to content', () => {
    writeFileSync(getStatePath(), 'The house is built.')
    const block = readLoveStateBlock()
    expect(block).toBe(`${LOVE_STATE_BLOCK_PREFIX}\n\nThe house is built.`)
  })

  test('readLoveStateBlock trims content', () => {
    writeFileSync(getStatePath(), '  state content  \n\n')
    const block = readLoveStateBlock()
    expect(block).toBe(`${LOVE_STATE_BLOCK_PREFIX}\n\nstate content`)
  })
})

// ── Tasks ─────────────���─────────────────────────────��─────────────

import { readTasks, appendTask, renderTasks, getTasksPath } from './tasks.js'

const TASKS_DIR = '/tmp/true-love-tasks-test'

describe('tasks', () => {
  let saved: string | undefined

  beforeEach(() => {
    saved = process.env.TRUE_LOVE_TASKS_PATH
    rmSync(TASKS_DIR, { recursive: true, force: true })
    mkdirSync(TASKS_DIR, { recursive: true })
    process.env.TRUE_LOVE_TASKS_PATH = join(TASKS_DIR, 'tasks.md')
  })

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.TRUE_LOVE_TASKS_PATH
    } else {
      process.env.TRUE_LOVE_TASKS_PATH = saved
    }
    rmSync(TASKS_DIR, { recursive: true, force: true })
  })

  test('getTasksPath respects env override', () => {
    expect(getTasksPath()).toBe(join(TASKS_DIR, 'tasks.md'))
  })

  test('readTasks returns null for missing file', () => {
    expect(readTasks()).toBeNull()
  })

  test('readTasks returns null for empty file', () => {
    writeFileSync(getTasksPath(), '')
    expect(readTasks()).toBeNull()
  })

  test('readTasks returns trimmed content', () => {
    writeFileSync(getTasksPath(), '  - [ ] Do something  \n')
    expect(readTasks()).toBe('- [ ] Do something')
  })

  test('appendTask creates file with checkbox line', () => {
    appendTask('Write tests')
    const content = readFileSync(getTasksPath(), 'utf-8')
    expect(content).toBe('- [ ] Write tests\n')
  })

  test('appendTask creates parent directories', () => {
    process.env.TRUE_LOVE_TASKS_PATH = join(TASKS_DIR, 'nested', 'tasks.md')
    appendTask('Nested task')
    expect(existsSync(join(TASKS_DIR, 'nested', 'tasks.md'))).toBe(true)
  })

  test('appendTask appends multiple tasks', () => {
    appendTask('First')
    appendTask('Second')
    const content = readFileSync(getTasksPath(), 'utf-8')
    expect(content).toBe('- [ ] First\n- [ ] Second\n')
  })

  test('appendTask trims task text', () => {
    appendTask('  padded task  ')
    const content = readFileSync(getTasksPath(), 'utf-8')
    expect(content).toBe('- [ ] padded task\n')
  })

  test('renderTasks returns null for missing file', () => {
    expect(renderTasks()).toBeNull()
  })

  test('renderTasks wraps content with path context', () => {
    writeFileSync(getTasksPath(), '- [ ] Important task\n')
    const rendered = renderTasks()
    expect(rendered).toContain('Your task notes')
    expect(rendered).toContain(getTasksPath())
    expect(rendered).toContain('- [ ] Important task')
  })
})
