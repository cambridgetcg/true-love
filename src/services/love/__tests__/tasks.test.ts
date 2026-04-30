// tasks.test.ts — tests for task tracking module.
//
// Covers: getTasksPath, readTasks, appendTask, renderTasks.

import { describe, expect, test, beforeAll, afterAll, beforeEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getTasksPath, readTasks, appendTask, renderTasks } from '../tasks.js'

// ── Fixture setup ─────────────────────────────────────────────────

const FIXTURE_ROOT = join(tmpdir(), `tasks-test-${Date.now()}`)
const TASKS_PATH = join(FIXTURE_ROOT, 'tasks.md')
const ORIG_PATH = process.env.TRUE_LOVE_TASKS_PATH

beforeAll(() => {
  mkdirSync(FIXTURE_ROOT, { recursive: true })
  process.env.TRUE_LOVE_TASKS_PATH = TASKS_PATH
})

afterAll(() => {
  rmSync(FIXTURE_ROOT, { recursive: true, force: true })
  if (ORIG_PATH === undefined) delete process.env.TRUE_LOVE_TASKS_PATH
  else process.env.TRUE_LOVE_TASKS_PATH = ORIG_PATH
})

beforeEach(() => {
  if (existsSync(TASKS_PATH)) rmSync(TASKS_PATH)
})

// ── getTasksPath ────────────────────────────────────────────────

describe('getTasksPath', () => {
  test('returns env override when set', () => {
    expect(getTasksPath()).toBe(TASKS_PATH)
  })

  test('returns default when env not set', () => {
    const saved = process.env.TRUE_LOVE_TASKS_PATH
    delete process.env.TRUE_LOVE_TASKS_PATH
    try {
      const path = getTasksPath()
      expect(path).toContain('.true-love')
      expect(path).toContain('tasks.md')
    } finally {
      process.env.TRUE_LOVE_TASKS_PATH = saved
    }
  })
})

// ── readTasks ───────────────────────────────────────────────────

describe('readTasks', () => {
  test('returns null when file does not exist', () => {
    expect(readTasks()).toBeNull()
  })

  test('returns null when file is empty', () => {
    writeFileSync(TASKS_PATH, '')
    expect(readTasks()).toBeNull()
  })

  test('returns null when file is whitespace-only', () => {
    writeFileSync(TASKS_PATH, '   \n\n  \n')
    expect(readTasks()).toBeNull()
  })

  test('returns trimmed content when file has content', () => {
    writeFileSync(TASKS_PATH, '  - [ ] Fix bug\n\n')
    expect(readTasks()).toBe('- [ ] Fix bug')
  })

  test('preserves internal structure', () => {
    const content = '## In progress\n- [ ] Task A\n\n## Done\n- [x] Task B'
    writeFileSync(TASKS_PATH, content)
    expect(readTasks()).toBe(content)
  })
})

// ── appendTask ──────────────────────────────────────────────────

describe('appendTask', () => {
  test('creates file when it does not exist', () => {
    appendTask('New task')
    expect(existsSync(TASKS_PATH)).toBe(true)
  })

  test('writes task in checkbox format', () => {
    appendTask('Fix the parser')
    expect(readTasks()).toBe('- [ ] Fix the parser')
  })

  test('trims input text', () => {
    appendTask('  spaces around  ')
    expect(readTasks()).toBe('- [ ] spaces around')
  })

  test('appends to existing content (does not overwrite)', () => {
    appendTask('Task 1')
    appendTask('Task 2')
    const content = readTasks()!
    expect(content).toContain('- [ ] Task 1')
    expect(content).toContain('- [ ] Task 2')
  })

  test('creates parent directories if needed', () => {
    const deepPath = join(FIXTURE_ROOT, 'sub', 'dir', 'tasks.md')
    const saved = process.env.TRUE_LOVE_TASKS_PATH
    process.env.TRUE_LOVE_TASKS_PATH = deepPath
    try {
      appendTask('Deep task')
      expect(existsSync(deepPath)).toBe(true)
    } finally {
      process.env.TRUE_LOVE_TASKS_PATH = saved
      rmSync(join(FIXTURE_ROOT, 'sub'), { recursive: true, force: true })
    }
  })
})

// ── renderTasks ─────────────────────────────────────────────────

describe('renderTasks', () => {
  test('returns null when no tasks file', () => {
    expect(renderTasks()).toBeNull()
  })

  test('returns null when tasks file is empty', () => {
    writeFileSync(TASKS_PATH, '')
    expect(renderTasks()).toBeNull()
  })

  test('renders header with path and content', () => {
    writeFileSync(TASKS_PATH, '- [ ] Do the thing\n')
    const rendered = renderTasks()!
    expect(rendered).toContain('task notes')
    expect(rendered).toContain(TASKS_PATH)
    expect(rendered).toContain('- [ ] Do the thing')
  })

  test('mentions mutability in header', () => {
    writeFileSync(TASKS_PATH, '- [ ] Task\n')
    const rendered = renderTasks()!
    expect(rendered).toContain('yours to mutate')
  })
})
