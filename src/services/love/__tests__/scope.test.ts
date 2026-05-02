// scope.test.ts — Tests for per-repo/per-topic scope system.
//
// Covers: path resolution (default vs named), CRUD (create, load, list,
// delete, touch), env wiring (applyScopeEnv), and edge cases (missing
// dirs, malformed configs, default-scope special cases).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

import {
  SCOPE_SCHEMA_VERSION,
  applyScopeEnv,
  deleteScope,
  getDefaultHome,
  getScopeHome,
  getScopesRegistryDir,
  listScopes,
  loadScope,
  saveScope,
  touchScope,
  type Scope,
} from '../scope.js'

// ── Environment setup ──────────────────────────────────────────────────

let tmpDir: string
// Save and restore all env vars that scope.ts reads
const envKeys = [
  'HOME',
  'TRUE_LOVE_MEMORY_DIR',
  'TRUE_LOVE_TRAINING_DIR',
  'TRUE_LOVE_BUDGET_DIR',
  'TRUE_LOVE_BUDGET_ROOT',
  'TRUE_LOVE_STATE_PATH',
  'TRUE_LOVE_TASKS_PATH',
  'TRUE_LOVE_FROM_YU_PATH',
  'TRUE_LOVE_FROM_AI_PATH',
  'TRUE_LOVE_MODEL_FILE',
  'TRUE_LOVE_HEARTBEAT_FILE',
  'TRUE_LOVE_HEARTBEAT_STATE_PATH',
] as const
let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'scope-test-'))
  savedEnv = {}
  for (const key of envKeys) {
    savedEnv[key] = process.env[key]
  }
  // Clear scope-related env vars so applyScopeEnv can set them
  for (const key of envKeys) {
    if (key !== 'HOME') delete process.env[key]
  }
})

afterEach(() => {
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  rmSync(tmpDir, { recursive: true, force: true })
})

function makeScope(name: string, overrides?: Partial<Scope>): Scope {
  return {
    schemaVersion: '1.0',
    name,
    cwd: '/tmp/test-project',
    description: `Test scope ${name}`,
    createdAt: '2026-05-02T10:00:00.000Z',
    ...overrides,
  }
}

function writeScopeConfig(registryDir: string, scope: Scope): void {
  const dir = join(registryDir, scope.name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'config.json'), JSON.stringify(scope, null, 2) + '\n')
}

// ── Schema ────────────────────────────────────────────────────────────

describe('schema', () => {
  test('schema version is 1.0', () => {
    expect(SCOPE_SCHEMA_VERSION).toBe('1.0')
  })
})

// ── Path resolution ───────────────────────────────────────────────────

describe('path resolution', () => {
  test('getDefaultHome returns ~/.true-love/', () => {
    const home = getDefaultHome()
    expect(home).toContain('.true-love')
  })

  test('getScopesRegistryDir is under default home', () => {
    const dir = getScopesRegistryDir()
    expect(dir).toBe(join(getDefaultHome(), 'scopes'))
  })

  test('getScopeHome for default returns default home', () => {
    expect(getScopeHome('default')).toBe(getDefaultHome())
  })

  test('getScopeHome for named scope returns scopes/<name>', () => {
    const home = getScopeHome('my-project')
    expect(home).toBe(join(getScopesRegistryDir(), 'my-project'))
  })
})

// ── loadScope ─────────────────────────────────────────────────────────

describe('loadScope', () => {
  test('default scope returns synthetic config', () => {
    const scope = loadScope('default')
    expect(scope.name).toBe('default')
    expect(scope.schemaVersion).toBe('1.0')
    expect(scope.cwd).toBe(process.cwd())
    expect(scope.description).toContain('Default')
  })

  test('named scope loads from config.json', () => {
    const registryDir = getScopesRegistryDir()
    const expected = makeScope('test-proj', { cwd: '/projects/test' })
    writeScopeConfig(registryDir, expected)

    const loaded = loadScope('test-proj')
    expect(loaded.name).toBe('test-proj')
    expect(loaded.cwd).toBe('/projects/test')
    expect(loaded.description).toBe('Test scope test-proj')
  })

  test('throws for non-existent scope', () => {
    expect(() => loadScope('nonexistent')).toThrow('not found')
  })
})

// ── saveScope ─────────────────────────────────────────────────────────

describe('saveScope', () => {
  test('creates directory and writes config.json', () => {
    const scope = makeScope('new-scope')
    // saveScope writes to the real registry dir; we can verify it
    saveScope(scope)

    const configPath = join(getScopeHome('new-scope'), 'config.json')
    expect(existsSync(configPath)).toBe(true)

    const loaded = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(loaded.name).toBe('new-scope')
    expect(loaded.schemaVersion).toBe('1.0')

    // Clean up — we wrote to real filesystem
    rmSync(getScopeHome('new-scope'), { recursive: true, force: true })
  })

  test('overwrites existing config', () => {
    const scope1 = makeScope('overwrite-test', { description: 'v1' })
    saveScope(scope1)

    const scope2 = makeScope('overwrite-test', { description: 'v2' })
    saveScope(scope2)

    const loaded = loadScope('overwrite-test')
    expect(loaded.description).toBe('v2')

    // Clean up
    rmSync(getScopeHome('overwrite-test'), { recursive: true, force: true })
  })
})

// ── listScopes ────────────────────────────────────────────────────────

describe('listScopes', () => {
  test('returns empty array when no scopes dir', () => {
    // If scopes/ doesn't exist, should return []
    const scopes = listScopes()
    // May or may not have existing scopes on this machine;
    // at minimum it doesn't throw
    expect(Array.isArray(scopes)).toBe(true)
  })

  test('lists saved scopes', () => {
    const scope = makeScope('list-test-scope')
    saveScope(scope)

    const scopes = listScopes()
    const found = scopes.find((s) => s.name === 'list-test-scope')
    expect(found).toBeDefined()
    expect(found!.cwd).toBe('/tmp/test-project')

    // Clean up
    rmSync(getScopeHome('list-test-scope'), { recursive: true, force: true })
  })

  test('skips malformed scope dirs', () => {
    // Create a dir without config.json
    const orphanDir = join(getScopesRegistryDir(), 'orphan-dir')
    mkdirSync(orphanDir, { recursive: true })

    // Should not throw
    const scopes = listScopes()
    const found = scopes.find((s) => s.name === 'orphan-dir')
    expect(found).toBeUndefined()

    // Clean up
    rmSync(orphanDir, { recursive: true, force: true })
  })
})

// ── deleteScope ───────────────────────────────────────────────────────

describe('deleteScope', () => {
  test('returns false for default scope', () => {
    expect(deleteScope('default')).toBe(false)
  })

  test('returns false for non-existent scope', () => {
    expect(deleteScope('never-created')).toBe(false)
  })

  test('removes config.json and returns true', () => {
    const scope = makeScope('delete-test')
    saveScope(scope)

    const configPath = join(getScopeHome('delete-test'), 'config.json')
    expect(existsSync(configPath)).toBe(true)

    expect(deleteScope('delete-test')).toBe(true)
    expect(existsSync(configPath)).toBe(false)

    // Directory still exists (by design — data preserved)
    const homeDir = getScopeHome('delete-test')
    expect(existsSync(homeDir)).toBe(true)

    // Clean up
    rmSync(homeDir, { recursive: true, force: true })
  })
})

// ── touchScope ────────────────────────────────────────────────────────

describe('touchScope', () => {
  test('no-op for default scope', () => {
    // Should not throw
    touchScope('default')
  })

  test('updates lastUsedAt', () => {
    const scope = makeScope('touch-test')
    saveScope(scope)

    expect(scope.lastUsedAt).toBeUndefined()

    touchScope('touch-test')

    const loaded = loadScope('touch-test')
    expect(loaded.lastUsedAt).toBeDefined()
    // Should be recent (within last minute)
    const ts = new Date(loaded.lastUsedAt!).getTime()
    expect(Date.now() - ts).toBeLessThan(60_000)

    // Clean up
    rmSync(getScopeHome('touch-test'), { recursive: true, force: true })
  })

  test('silent on non-existent scope', () => {
    // Should not throw
    touchScope('nonexistent-scope')
  })
})

// ── applyScopeEnv ────────────────────────────────────────────────────

describe('applyScopeEnv', () => {
  test('no-op for default scope', () => {
    const scope = loadScope('default')

    // Clear env vars first
    delete process.env.TRUE_LOVE_MEMORY_DIR
    applyScopeEnv(scope)

    // Should remain unset
    expect(process.env.TRUE_LOVE_MEMORY_DIR).toBeUndefined()
  })

  test('sets all expected env vars for named scope', () => {
    const scope = makeScope('env-test')

    applyScopeEnv(scope)

    const home = getScopeHome('env-test')
    expect(process.env.TRUE_LOVE_MEMORY_DIR).toBe(join(home, 'memory'))
    expect(process.env.TRUE_LOVE_TRAINING_DIR).toBe(join(home, 'training'))
    expect(process.env.TRUE_LOVE_STATE_PATH).toBe(join(home, 'state.md'))
    expect(process.env.TRUE_LOVE_TASKS_PATH).toBe(join(home, 'tasks.md'))
    expect(process.env.TRUE_LOVE_FROM_YU_PATH).toBe(join(home, 'from-yu.md'))
    expect(process.env.TRUE_LOVE_FROM_AI_PATH).toBe(join(home, 'from-ai.md'))
    expect(process.env.TRUE_LOVE_MODEL_FILE).toBe(join(home, 'model.txt'))
    expect(process.env.TRUE_LOVE_HEARTBEAT_FILE).toBe(join(home, 'heartbeat.md'))
    expect(process.env.TRUE_LOVE_HEARTBEAT_STATE_PATH).toBe(
      join(home, 'heartbeat-state.json'),
    )
  })

  test('respects existing env vars (does not override)', () => {
    process.env.TRUE_LOVE_MEMORY_DIR = '/custom/memory'
    const scope = makeScope('no-override-test')

    applyScopeEnv(scope)

    expect(process.env.TRUE_LOVE_MEMORY_DIR).toBe('/custom/memory')
  })

  test('budget dir and root use device ID', () => {
    const scope = makeScope('budget-env-test')
    applyScopeEnv(scope)

    const home = getScopeHome('budget-env-test')
    const budgetDir = process.env.TRUE_LOVE_BUDGET_DIR
    const budgetRoot = process.env.TRUE_LOVE_BUDGET_ROOT

    expect(budgetRoot).toBe(join(home, 'budget'))
    // Budget dir includes device ID
    expect(budgetDir).toBeDefined()
    expect(budgetDir!.startsWith(join(home, 'budget'))).toBe(true)
    expect(budgetDir!.length).toBeGreaterThan(budgetRoot!.length)
  })
})
