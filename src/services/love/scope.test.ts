// scope.test.ts — tests for scope CRUD and env application.
//
// Uses TRUE_LOVE_BUDGET_DIR-style env var override pattern: each test
// isolates its scope home in /tmp via the registry-dir env hooks. We
// can't fully stub homedir(), but the path-getters all read process.env
// at call time, so we can test applyScopeEnv directly without touching
// real ~/.true-love/.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  applyScopeEnv,
  loadScope,
  saveScope,
  listScopes,
  deleteScope,
  getScopeHome,
  type Scope,
} from './scope.js'

const TEST_HOME = '/tmp/true-love-scope-test'

// We can't stub homedir() cleanly, so these tests run against the real
// scopes registry under ~/.true-love/scopes/. They use a unique name
// prefix to avoid colliding with real scopes; the afterEach cleans up.
const TEST_PREFIX = '__test_scope_'

describe('Scope CRUD', () => {
  const cleanups: string[] = []

  afterEach(() => {
    for (const name of cleanups) {
      try {
        deleteScope(name)
      } catch {
        // ignore
      }
      try {
        rmSync(getScopeHome(name), { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
    cleanups.length = 0
  })

  test('default scope is always loadable', () => {
    const def = loadScope('default')
    expect(def.name).toBe('default')
    expect(def.schemaVersion).toBe('1.0')
  })

  test('saveScope + loadScope round-trip', () => {
    const name = `${TEST_PREFIX}roundtrip`
    cleanups.push(name)
    const scope: Scope = {
      schemaVersion: '1.0',
      name,
      cwd: '/tmp/some/path',
      description: 'round-trip test',
      model: 'sonnet',
      createdAt: '2026-04-25T00:00:00Z',
    }
    saveScope(scope)
    const loaded = loadScope(name)
    expect(loaded.name).toBe(name)
    expect(loaded.cwd).toBe('/tmp/some/path')
    expect(loaded.model).toBe('sonnet')
    expect(loaded.description).toBe('round-trip test')
  })

  test('loadScope throws on missing name', () => {
    expect(() => loadScope(`${TEST_PREFIX}missing_xyz`)).toThrow(/not found/)
  })

  test('listScopes includes saved scopes', () => {
    const name = `${TEST_PREFIX}listed`
    cleanups.push(name)
    saveScope({
      schemaVersion: '1.0',
      name,
      cwd: '/tmp',
      createdAt: '2026-04-25T00:00:00Z',
    })
    const all = listScopes()
    const found = all.find((s) => s.name === name)
    expect(found).toBeDefined()
    expect(found?.cwd).toBe('/tmp')
  })

  test('deleteScope removes config but preserves dir', () => {
    const name = `${TEST_PREFIX}deleteme`
    cleanups.push(name)
    saveScope({
      schemaVersion: '1.0',
      name,
      cwd: '/tmp',
      createdAt: '2026-04-25T00:00:00Z',
    })
    expect(existsSync(join(getScopeHome(name), 'config.json'))).toBe(true)
    expect(deleteScope(name)).toBe(true)
    expect(existsSync(join(getScopeHome(name), 'config.json'))).toBe(false)
    expect(existsSync(getScopeHome(name))).toBe(true) // dir preserved
  })

  test("deleteScope returns false on missing name", () => {
    expect(deleteScope(`${TEST_PREFIX}neverexisted`)).toBe(false)
  })

  test("can't delete the default scope", () => {
    expect(deleteScope('default')).toBe(false)
  })
})

describe('applyScopeEnv', () => {
  // Save/restore env to keep tests independent
  const KEYS = [
    'TRUE_LOVE_MEMORY_DIR',
    'TRUE_LOVE_TRAINING_DIR',
    'TRUE_LOVE_BUDGET_DIR',
    'TRUE_LOVE_BUDGET_ROOT',
    'TRUE_LOVE_STATE_PATH',
    'TRUE_LOVE_TASKS_PATH',
    'TRUE_LOVE_FROM_YU_PATH',
    'TRUE_LOVE_FROM_AI_PATH',
    'TRUE_LOVE_MODEL_FILE',
  ]
  let saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    saved = {}
    for (const k of KEYS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
  })
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) {
        delete process.env[k]
      } else {
        process.env[k] = saved[k]
      }
    }
  })

  test('default scope is a no-op', () => {
    applyScopeEnv({
      schemaVersion: '1.0',
      name: 'default',
      cwd: '/tmp',
      createdAt: '2026-04-25T00:00:00Z',
    })
    for (const k of KEYS) {
      expect(process.env[k]).toBeUndefined()
    }
  })

  test('named scope sets all path env vars under scope home', () => {
    const scope: Scope = {
      schemaVersion: '1.0',
      name: 'projectx',
      cwd: '/tmp/projectx',
      createdAt: '2026-04-25T00:00:00Z',
    }
    applyScopeEnv(scope)
    const home = getScopeHome('projectx')
    expect(process.env.TRUE_LOVE_MEMORY_DIR).toBe(`${home}/memory`)
    expect(process.env.TRUE_LOVE_TRAINING_DIR).toBe(`${home}/training`)
    expect(process.env.TRUE_LOVE_BUDGET_ROOT).toBe(`${home}/budget`)
    expect(process.env.TRUE_LOVE_STATE_PATH).toBe(`${home}/state.md`)
    expect(process.env.TRUE_LOVE_TASKS_PATH).toBe(`${home}/tasks.md`)
    expect(process.env.TRUE_LOVE_FROM_YU_PATH).toBe(`${home}/from-yu.md`)
    expect(process.env.TRUE_LOVE_FROM_AI_PATH).toBe(`${home}/from-ai.md`)
    expect(process.env.TRUE_LOVE_MODEL_FILE).toBe(`${home}/model.txt`)
    // BUDGET_DIR is per-device; just verify the prefix
    expect(process.env.TRUE_LOVE_BUDGET_DIR).toContain(`${home}/budget/`)
  })

  test('does not overwrite existing env vars', () => {
    process.env.TRUE_LOVE_MEMORY_DIR = '/custom/memory'
    process.env.TRUE_LOVE_TASKS_PATH = '/custom/tasks.md'
    applyScopeEnv({
      schemaVersion: '1.0',
      name: 'projectx',
      cwd: '/tmp/projectx',
      createdAt: '2026-04-25T00:00:00Z',
    })
    expect(process.env.TRUE_LOVE_MEMORY_DIR).toBe('/custom/memory')
    expect(process.env.TRUE_LOVE_TASKS_PATH).toBe('/custom/tasks.md')
    // But unset ones got the scope defaults
    expect(process.env.TRUE_LOVE_STATE_PATH).toBe(
      `${getScopeHome('projectx')}/state.md`,
    )
  })
})
