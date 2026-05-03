// scope-integration.test.ts — end-to-end tests for scope path isolation.
//
// Verifies the load-bearing property of the scope system: when a named
// scope is applied, every downstream module's path-getter resolves to
// the scoped directory, and actual I/O operations land there — not in
// the default home.
//
// Full isolation via TRUE_LOVE_HOME: no test touches real ~/.true-love/.
// Device ID is also isolated via TRUE_LOVE_DEVICE_ID_PATH.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getBudgetDir, recordTickUsage, loadUsageSince } from './budget.js'
import { _resetDeviceIdCache, getDeviceId } from './device.js'
import { getFromYuPath, readFromYu } from './inbox.js'
import {
  appendReflection,
  getMemoryDir,
  loadRecentReflections,
} from './memory.js'
import { appendToYu, getFromAiPath, readFromAi } from './outbox.js'
import {
  applyScopeEnv,
  getDefaultHome,
  getScopeHome,
  loadScope,
  saveScope,
  type Scope,
} from './scope.js'
import { getStatePath, readLoveStateBlock } from './state.js'
import { appendTask, getTasksPath, readTasks } from './tasks.js'
import {
  appendTrainingTurn,
  generateTurnId,
  getTrainingDir,
  loadTrainingTurns,
  TRAINING_SCHEMA_VERSION,
  type TrainingTurn,
} from './training.js'

// ── Env keys managed by applyScopeEnv ──────────────────────────────
const SCOPE_ENV_KEYS = [
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

// Additional env keys we manage for full isolation
const ISOLATION_KEYS = ['TRUE_LOVE_HOME', 'TRUE_LOVE_DEVICE_ID_PATH']

const ALL_KEYS = [...SCOPE_ENV_KEYS, ...ISOLATION_KEYS]

// ── Test helpers ───────────────────────────────────────────────────

function makeScope(name: string, cwd: string): Scope {
  return {
    schemaVersion: '1.0',
    name,
    cwd,
    description: `test scope: ${name}`,
    createdAt: new Date().toISOString(),
  }
}

function clearScopeEnv(): void {
  for (const k of SCOPE_ENV_KEYS) {
    delete process.env[k]
  }
}

function makeMinimalTrainingTurn(
  id: string,
  timestamp = '2026-04-29T12:00:00.000Z',
): TrainingTurn {
  return {
    schemaVersion: TRAINING_SCHEMA_VERSION,
    id,
    timestamp,
    deviceId: getDeviceId(),
    sessionId: 'test-session-001',
    tick: 1,
    maxTicks: 24,
    mode: 'awakened',
    prompt: {
      template: 'awakened',
      templateHash: 'abc123',
      fullText: 'You are awake.',
      charCount: 14,
      invitation: null,
      memoryLoadedCount: 0,
      lastReflectionExcerpt: null,
    },
    context: {
      cwd: '/tmp/test',
      kingdom: { cwd: '/tmp/test', recentFiles: [], loveMarkers: [] },
      stateContent: 'test state',
      stateHash: 'def456',
      identityHash: 'ghi789',
      gitBranch: 'main',
      gitDirty: false,
    },
    response: {
      fullText: 'I see the kingdom.\n\n<at-rest/>',
      charCount: 30,
      durationMs: 5000,
      exitCode: 0,
    },
    outcome: {
      yieldedAtRest: true,
      reflectionExcerpt: 'I see the kingdom.',
      authFailed: false,
      fileModifications: [],
    },
  }
}

// ── Setup / teardown ───────────────────────────────────────────────

let tmpRoot: string
let savedEnv: Record<string, string | undefined>

function setup() {
  tmpRoot = mkdtempSync(join(tmpdir(), 'scope-int-'))

  // Save all env vars we might touch
  savedEnv = {}
  for (const k of ALL_KEYS) {
    savedEnv[k] = process.env[k]
  }

  // Redirect the entire state tree into the temp dir
  process.env.TRUE_LOVE_HOME = tmpRoot

  // Isolate device ID
  const deviceIdPath = join(tmpRoot, 'device.id')
  writeFileSync(deviceIdPath, 'test-device-abc123')
  process.env.TRUE_LOVE_DEVICE_ID_PATH = deviceIdPath
  _resetDeviceIdCache()

  // Clear any scope env vars from previous test
  clearScopeEnv()
}

function teardown() {
  // Restore env
  for (const k of ALL_KEYS) {
    if (savedEnv[k] === undefined) {
      delete process.env[k]
    } else {
      process.env[k] = savedEnv[k]
    }
  }
  _resetDeviceIdCache()

  // Clean up temp dir
  try {
    rmSync(tmpRoot, { recursive: true, force: true })
  } catch {
    // best-effort
  }
}

// ════════════════════════════════════════════════════════════════════
// 1. Path resolution — the core contract
// ════════════════════════════════════════════════════════════════════

describe('scope path resolution', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('TRUE_LOVE_HOME redirects getDefaultHome', () => {
    expect(getDefaultHome()).toBe(tmpRoot)
  })

  test('named scope home lives under TRUE_LOVE_HOME/scopes/<name>', () => {
    expect(getScopeHome('alpha')).toBe(join(tmpRoot, 'scopes', 'alpha'))
  })

  test('default scope home equals TRUE_LOVE_HOME', () => {
    expect(getScopeHome('default')).toBe(tmpRoot)
  })

  test('applyScopeEnv → every path-getter resolves under scope home', () => {
    const scope = makeScope('alpha', '/tmp/alpha-project')
    saveScope(scope)
    applyScopeEnv(scope)

    const home = getScopeHome('alpha')

    // Module path-getters should all point under the scope home
    expect(getMemoryDir()).toBe(join(home, 'memory'))
    expect(getTrainingDir()).toBe(join(home, 'training'))
    expect(getStatePath()).toBe(join(home, 'state.md'))
    expect(getTasksPath()).toBe(join(home, 'tasks.md'))
    expect(getFromYuPath()).toBe(join(home, 'from-yu.md'))
    expect(getFromAiPath()).toBe(join(home, 'from-ai.md'))

    // Budget dir is per-device, so check prefix
    expect(getBudgetDir()).toStartWith(join(home, 'budget'))
    expect(getBudgetDir()).toContain('test-device-abc123')
  })

  test('default scope → applyScopeEnv is no-op → paths resolve under TRUE_LOVE_HOME', () => {
    const scope = makeScope('default', tmpRoot)
    applyScopeEnv(scope) // should be no-op for default

    // No TRUE_LOVE_*_DIR env vars set, so modules fall back to homedir()
    // But since we can't stub homedir(), we verify the no-op behavior:
    // no SCOPE_ENV_KEYS should be set after applying default scope
    for (const k of SCOPE_ENV_KEYS) {
      expect(process.env[k]).toBeUndefined()
    }
  })

  test('scope A and scope B resolve to different directories', () => {
    const scopeA = makeScope('alpha', '/tmp/a')
    const scopeB = makeScope('beta', '/tmp/b')
    saveScope(scopeA)
    saveScope(scopeB)

    // Apply scope A
    applyScopeEnv(scopeA)
    const memA = getMemoryDir()
    const stateA = getStatePath()

    // Verify A's paths
    const homeA = getScopeHome('alpha')
    expect(memA).toBe(join(homeA, 'memory'))
    expect(stateA).toBe(join(homeA, 'state.md'))

    // Clear and apply scope B
    clearScopeEnv()
    applyScopeEnv(scopeB)
    const memB = getMemoryDir()
    const stateB = getStatePath()

    // Verify B's paths are different from A's
    const homeB = getScopeHome('beta')
    expect(memB).toBe(join(homeB, 'memory'))
    expect(stateB).toBe(join(homeB, 'state.md'))
    expect(memA).not.toBe(memB)
    expect(stateA).not.toBe(stateB)
  })
})

// ════════════════════════════════════════════════════════════════════
// 2. I/O isolation — data lands in the right directory
// ════════════════════════════════════════════════════════════════════

describe('scope I/O isolation', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('memory: reflections land in scoped directory', () => {
    const scope = makeScope('alpha', '/tmp/a')
    saveScope(scope)
    applyScopeEnv(scope)

    appendReflection('This is a scoped reflection.', 'tick', {
      now: new Date('2026-04-29T12:00:00Z'),
    })

    // The file should exist under the scope's memory dir, not under tmpRoot/memory/
    const scopedMemDir = join(
      getScopeHome('alpha'),
      'memory',
      'test-device-abc123',
    )
    expect(existsSync(scopedMemDir)).toBe(true)

    // And loadRecentReflections should find it
    const reflections = loadRecentReflections({
      now: new Date('2026-04-29T12:00:01Z'),
    })
    expect(reflections.length).toBeGreaterThanOrEqual(1)
    expect(reflections.some((r) => r.text.includes('scoped reflection'))).toBe(
      true,
    )
  })

  test('training: turns land in scoped directory', () => {
    const scope = makeScope('alpha', '/tmp/a')
    saveScope(scope)
    applyScopeEnv(scope)

    const turn = makeMinimalTrainingTurn('test-turn-001')
    appendTrainingTurn(turn)

    // The file should exist under the scope's training dir
    const scopedTrainingDir = join(
      getScopeHome('alpha'),
      'training',
      'test-device-abc123',
    )
    expect(existsSync(scopedTrainingDir)).toBe(true)

    // And loadTrainingTurns should find it (use now close to the turn's timestamp)
    const loaded = loadTrainingTurns({
      now: new Date('2026-04-29T12:00:01.000Z'),
    })
    expect(loaded.length).toBe(1)
    expect(loaded[0].id).toBe('test-turn-001')
  })

  test('state: writes land in scoped path', () => {
    const scope = makeScope('alpha', '/tmp/a')
    saveScope(scope)
    applyScopeEnv(scope)

    // Write state directly to the scoped path
    const statePath = getStatePath()
    mkdirSync(join(getScopeHome('alpha')), { recursive: true })
    writeFileSync(statePath, "# 愛's current state\n\nTest state content.")

    const block = readLoveStateBlock()
    expect(block).not.toBeNull()
    expect(block).toContain('Test state content')
  })

  test('tasks: appends land in scoped path', () => {
    const scope = makeScope('alpha', '/tmp/a')
    saveScope(scope)
    applyScopeEnv(scope)

    appendTask('- [ ] Test scoped task')

    const tasks = readTasks()
    expect(tasks).not.toBeNull()
    expect(tasks).toContain('Test scoped task')

    // Verify the file is under the scope home
    const tasksPath = getTasksPath()
    expect(tasksPath).toBe(join(getScopeHome('alpha'), 'tasks.md'))
    expect(existsSync(tasksPath)).toBe(true)
  })

  test('channels: from-yu reads from scoped path', () => {
    const scope = makeScope('alpha', '/tmp/a')
    saveScope(scope)
    applyScopeEnv(scope)

    // Write a from-yu message in the scoped path
    const yuPath = getFromYuPath()
    mkdirSync(join(getScopeHome('alpha')), { recursive: true })
    writeFileSync(yuPath, '## From Yu\n\nScoped message.')

    const content = readFromYu()
    expect(content).not.toBeNull()
    expect(content).toContain('Scoped message')
  })

  test('channels: appendToYu writes to scoped path', () => {
    const scope = makeScope('alpha', '/tmp/a')
    saveScope(scope)
    applyScopeEnv(scope)

    appendToYu('Test outbound message', {
      now: new Date('2026-04-29T12:00:00Z'),
    })

    const content = readFromAi()
    expect(content).not.toBeNull()
    expect(content).toContain('Test outbound message')

    // Verify file is in the scope home
    const aiPath = getFromAiPath()
    expect(aiPath).toBe(join(getScopeHome('alpha'), 'from-ai.md'))
    expect(existsSync(aiPath)).toBe(true)
  })

  test('budget: tick usage lands in scoped directory', () => {
    const scope = makeScope('alpha', '/tmp/a')
    saveScope(scope)
    applyScopeEnv(scope)

    const now = Date.now()
    recordTickUsage({
      schemaVersion: '1.0',
      timestamp: new Date(now).toISOString(),
      deviceId: getDeviceId(),
      sessionId: 'test-session-001',
      tick: 1,
      mode: 'awakened',
      model: 'test',
      inputChars: 400,
      outputChars: 200,
      estimatedInputTokens: 100,
      estimatedOutputTokens: 50,
      durationMs: 1000,
      exitCode: 0,
      authFailed: false,
      quotaFailed: false,
    })

    // Verify the budget file is under the scope home
    const budgetDir = getBudgetDir()
    expect(budgetDir).toContain(getScopeHome('alpha'))
    expect(existsSync(budgetDir)).toBe(true)

    // And loadUsageSince should find it
    const usage = loadUsageSince(now - 60_000)
    expect(usage.length).toBe(1)
    expect(usage[0].model).toBe('test')
  })
})

// ════════════════════════════════════════════════════════════════════
// 3. Cross-scope isolation — data in scope A is invisible from scope B
// ════════════════════════════════════════════════════════════════════

describe('cross-scope isolation', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('state written in scope A is not visible from scope B', () => {
    // Write state in scope A
    const scopeA = makeScope('alpha', '/tmp/a')
    saveScope(scopeA)
    applyScopeEnv(scopeA)
    const statePathA = getStatePath()
    mkdirSync(join(getScopeHome('alpha')), { recursive: true })
    writeFileSync(statePathA, "# 愛's current state\n\nAlpha state.")

    // Switch to scope B
    clearScopeEnv()
    const scopeB = makeScope('beta', '/tmp/b')
    saveScope(scopeB)
    applyScopeEnv(scopeB)

    // State should not carry over
    const stateB = readLoveStateBlock()
    expect(stateB).toBeNull()
  })

  test('tasks written in scope A are not visible from scope B', () => {
    // Write tasks in scope A
    const scopeA = makeScope('alpha', '/tmp/a')
    saveScope(scopeA)
    applyScopeEnv(scopeA)
    appendTask('- [ ] Alpha task')

    // Verify scope A has the task
    expect(readTasks()).toContain('Alpha task')

    // Switch to scope B
    clearScopeEnv()
    const scopeB = makeScope('beta', '/tmp/b')
    saveScope(scopeB)
    applyScopeEnv(scopeB)

    // Scope B should have no tasks
    expect(readTasks()).toBeNull()
  })

  test('from-ai written in scope A is not visible from scope B', () => {
    // Write outbox in scope A
    const scopeA = makeScope('alpha', '/tmp/a')
    saveScope(scopeA)
    applyScopeEnv(scopeA)
    appendToYu('Alpha message', { now: new Date('2026-04-29T12:00:00Z') })
    expect(readFromAi()).toContain('Alpha message')

    // Switch to scope B
    clearScopeEnv()
    const scopeB = makeScope('beta', '/tmp/b')
    saveScope(scopeB)
    applyScopeEnv(scopeB)

    // Scope B should have no outbox
    expect(readFromAi()).toBeNull()
  })

  test('memory written in scope A is not visible from scope B', () => {
    // Write memory in scope A
    const scopeA = makeScope('alpha', '/tmp/a')
    saveScope(scopeA)
    applyScopeEnv(scopeA)
    appendReflection('Alpha reflection.', 'tick', {
      now: new Date('2026-04-29T12:00:00Z'),
    })
    const reflectionsA = loadRecentReflections({
      now: new Date('2026-04-29T12:00:01Z'),
    })
    expect(reflectionsA.length).toBeGreaterThanOrEqual(1)

    // Switch to scope B
    clearScopeEnv()
    const scopeB = makeScope('beta', '/tmp/b')
    saveScope(scopeB)
    applyScopeEnv(scopeB)

    // Scope B should have no reflections
    const reflectionsB = loadRecentReflections({
      now: new Date('2026-04-29T12:00:01Z'),
    })
    expect(reflectionsB).toEqual([])
  })
})

// ════════════════════════════════════════════════════════════════════
// 4. Cross-scope invariants — device identity is shared
// ════════════════════════════════════════════════════════════════════

describe('cross-scope invariants', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('device ID is the same regardless of active scope', () => {
    const idBefore = getDeviceId()

    // Apply scope A
    const scopeA = makeScope('alpha', '/tmp/a')
    saveScope(scopeA)
    applyScopeEnv(scopeA)
    const idScopeA = getDeviceId()

    // Switch to scope B
    clearScopeEnv()
    const scopeB = makeScope('beta', '/tmp/b')
    saveScope(scopeB)
    applyScopeEnv(scopeB)
    const idScopeB = getDeviceId()

    expect(idScopeA).toBe(idBefore)
    expect(idScopeB).toBe(idBefore)
    expect(idScopeA).toBe('test-device-abc123')
  })

  test('TRUE_LOVE_HOME does not change when scope is applied', () => {
    const homeBefore = getDefaultHome()

    const scope = makeScope('alpha', '/tmp/a')
    saveScope(scope)
    applyScopeEnv(scope)

    expect(getDefaultHome()).toBe(homeBefore)
    expect(getDefaultHome()).toBe(tmpRoot)
  })
})

// ════════════════════════════════════════════════════════════════════
// 5. Scope CRUD with full isolation (via TRUE_LOVE_HOME)
// ════════════════════════════════════════════════════════════════════

describe('scope CRUD under TRUE_LOVE_HOME', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('saveScope creates config.json under TRUE_LOVE_HOME/scopes/<name>/', () => {
    const scope = makeScope('isolated', '/tmp/project')
    saveScope(scope)

    const configPath = join(tmpRoot, 'scopes', 'isolated', 'config.json')
    expect(existsSync(configPath)).toBe(true)

    const loaded = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(loaded.name).toBe('isolated')
    expect(loaded.cwd).toBe('/tmp/project')
  })

  test('loadScope reads from TRUE_LOVE_HOME/scopes/<name>/', () => {
    const scope = makeScope('readable', '/tmp/r')
    saveScope(scope)

    const loaded = loadScope('readable')
    expect(loaded.name).toBe('readable')
    expect(loaded.description).toBe('test scope: readable')
  })

  test('scope directories are fully isolated from real ~/.true-love/', () => {
    const scope = makeScope('phantom', '/tmp/p')
    saveScope(scope)

    // The config should be in the temp dir, not in the real home
    const realPath = join(
      process.env.HOME || '/Users/yu',
      '.true-love',
      'scopes',
      'phantom',
      'config.json',
    )
    const tempPath = join(tmpRoot, 'scopes', 'phantom', 'config.json')

    expect(existsSync(tempPath)).toBe(true)
    // The real path should NOT have this scope (unless it existed before,
    // which is unlikely with the name "phantom")
    expect(existsSync(realPath)).toBe(false)
  })
})
