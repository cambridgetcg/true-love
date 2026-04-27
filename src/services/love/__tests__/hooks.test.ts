// hooks.test.ts — tests for the hooks subsystem.
//
// Tests cover:
//   - Types: contract shapes, event list, defaults
//   - Loader: directory scanning, event matching, extension filtering,
//     global + project ordering, empty/missing directories
//   - Runner: subprocess execution, JSON round-trip, timeout enforcement,
//     non-zero exit handling, empty stdout, malformed JSON,
//     decision aggregation, fire-and-forget, modification chaining
//
// Strategy: real temp directories with real executable scripts.
// No mocking of spawn — we test the actual subprocess boundary.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, chmodSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// ── Types ──────────────────────────────────────────────────────────

import {
  HOOK_EVENTS,
  HOOK_EXTENSIONS,
  DEFAULT_HOOK_CONFIG,
} from '../hooks/types.js'
import type {
  HookEvent,
  HookEnvelope,
  HookDecision,
  RegisteredHook,
  HookResult,
  AggregatedHookResult,
  HookConfig,
} from '../hooks/types.js'

// ── Loader ──────────────────────────────────────────────────────────

import {
  resolveHooksDir,
  resolveProjectHooksDir,
  scanDirectory,
  loadHooks,
  getHooksForEvent,
  hasHooksForEvent,
} from '../hooks/loader.js'

// ── Runner ──────────────────────────────────────────────────────────

import {
  executeHook,
  aggregateDecisions,
  fireHook,
} from '../hooks/runner.js'

// ── Test fixtures ─────���────────────────────────────────────────────

const TEST_DIR = join(import.meta.dir, '__hooks-test-tmp__')
const GLOBAL_HOOKS = join(TEST_DIR, 'global-hooks')
const PROJECT_HOOKS = join(TEST_DIR, 'project-hooks')

function setup(): void {
  rmSync(TEST_DIR, { recursive: true, force: true })
  mkdirSync(GLOBAL_HOOKS, { recursive: true })
  mkdirSync(PROJECT_HOOKS, { recursive: true })
}

function teardown(): void {
  rmSync(TEST_DIR, { recursive: true, force: true })
}

/** Write an executable shell script. */
function writeShellHook(dir: string, name: string, body: string): string {
  const path = join(dir, name)
  writeFileSync(path, `#!/bin/sh\n${body}\n`, 'utf-8')
  chmodSync(path, 0o755)
  return path
}

/** Write a Node.js hook script. */
function writeJsHook(dir: string, name: string, body: string): string {
  const path = join(dir, name)
  writeFileSync(path, body, 'utf-8')
  chmodSync(path, 0o755)
  return path
}

/** Make a test config pointing to our temp dirs. */
function testConfig(overrides?: Partial<HookConfig>): HookConfig {
  return {
    enabled: true,
    timeoutMs: 3_000,
    directory: GLOBAL_HOOKS,
    ...overrides,
  }
}

/** Make a minimal test envelope. */
function testEnvelope(event: HookEvent = 'SessionStart'): HookEnvelope {
  return {
    event,
    timestamp: new Date().toISOString(),
    sessionId: 'test-session-001',
  }
}

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ════════���════════════════════════��════════════════���════════════════

describe('hooks/types', () => {
  test('HOOK_EVENTS contains all seven event types', () => {
    expect(HOOK_EVENTS).toHaveLength(7)
    expect(HOOK_EVENTS).toContain('PreToolUse')
    expect(HOOK_EVENTS).toContain('PostToolUse')
    expect(HOOK_EVENTS).toContain('UserPromptSubmit')
    expect(HOOK_EVENTS).toContain('SessionStart')
    expect(HOOK_EVENTS).toContain('Stop')
    expect(HOOK_EVENTS).toContain('Notification')
    expect(HOOK_EVENTS).toContain('SubagentStop')
  })

  test('HOOK_EXTENSIONS covers the supported languages', () => {
    expect(HOOK_EXTENSIONS).toContain('.sh')
    expect(HOOK_EXTENSIONS).toContain('.js')
    expect(HOOK_EXTENSIONS).toContain('.mjs')
    expect(HOOK_EXTENSIONS).toContain('.ts')
    expect(HOOK_EXTENSIONS).toContain('.py')
  })

  test('DEFAULT_HOOK_CONFIG has sensible defaults', () => {
    expect(DEFAULT_HOOK_CONFIG.enabled).toBe(true)
    expect(DEFAULT_HOOK_CONFIG.timeoutMs).toBe(5_000)
    expect(DEFAULT_HOOK_CONFIG.directory).toBe('~/.true-love/hooks')
  })
})

// ═══════════���══════════════════════════════��════════════════════════
// LOADER
// ═════════════���══════════════════════════════���══════════════════════

describe('hooks/loader', () => {
  beforeEach(setup)
  afterEach(teardown)

  describe('resolveHooksDir', () => {
    test('resolves ~ prefix to home directory', () => {
      const dir = resolveHooksDir(DEFAULT_HOOK_CONFIG)
      expect(dir).not.toContain('~')
      expect(dir).toContain('.true-love/hooks')
    })

    test('absolute path passes through unchanged', () => {
      const dir = resolveHooksDir(testConfig({ directory: '/tmp/my-hooks' }))
      expect(dir).toBe('/tmp/my-hooks')
    })
  })

  describe('resolveProjectHooksDir', () => {
    test('appends .true-love-hooks to project root', () => {
      const dir = resolveProjectHooksDir('/some/project')
      expect(dir).toBe('/some/project/.true-love-hooks')
    })
  })

  describe('scanDirectory', () => {
    test('returns empty array for non-existent directory', () => {
      const hooks = scanDirectory('/does/not/exist')
      expect(hooks).toEqual([])
    })

    test('returns empty array for empty directory', () => {
      const hooks = scanDirectory(GLOBAL_HOOKS)
      expect(hooks).toEqual([])
    })

    test('discovers a SessionStart.sh hook', () => {
      writeShellHook(GLOBAL_HOOKS, 'SessionStart.sh', 'echo ok')
      const hooks = scanDirectory(GLOBAL_HOOKS)
      expect(hooks).toHaveLength(1)
      expect(hooks[0].event).toBe('SessionStart')
      expect(hooks[0].extension).toBe('.sh')
      expect(hooks[0].scriptPath).toContain('SessionStart.sh')
    })

    test('discovers multiple event types', () => {
      writeShellHook(GLOBAL_HOOKS, 'SessionStart.sh', 'echo ok')
      writeShellHook(GLOBAL_HOOKS, 'Stop.sh', 'echo ok')
      writeShellHook(GLOBAL_HOOKS, 'PreToolUse.sh', 'echo ok')
      const hooks = scanDirectory(GLOBAL_HOOKS)
      expect(hooks).toHaveLength(3)
      const events = hooks.map(h => h.event)
      expect(events).toContain('SessionStart')
      expect(events).toContain('Stop')
      expect(events).toContain('PreToolUse')
    })

    test('ignores files with invalid event names', () => {
      writeShellHook(GLOBAL_HOOKS, 'SessionStart.sh', 'echo ok')
      writeShellHook(GLOBAL_HOOKS, 'NotAnEvent.sh', 'echo ok')
      writeShellHook(GLOBAL_HOOKS, 'random.sh', 'echo ok')
      const hooks = scanDirectory(GLOBAL_HOOKS)
      expect(hooks).toHaveLength(1)
      expect(hooks[0].event).toBe('SessionStart')
    })

    test('ignores files with unsupported extensions', () => {
      writeShellHook(GLOBAL_HOOKS, 'SessionStart.sh', 'echo ok')
      writeFileSync(join(GLOBAL_HOOKS, 'SessionStart.txt'), 'not a hook')
      writeFileSync(join(GLOBAL_HOOKS, 'SessionStart.rb'), 'not a hook')
      const hooks = scanDirectory(GLOBAL_HOOKS)
      expect(hooks).toHaveLength(1)
    })

    test('ignores dotfiles', () => {
      writeShellHook(GLOBAL_HOOKS, '.SessionStart.sh', 'echo ok')
      writeShellHook(GLOBAL_HOOKS, '.policy.json', '{}')
      const hooks = scanDirectory(GLOBAL_HOOKS)
      expect(hooks).toEqual([])
    })

    test('supports .js extension', () => {
      writeJsHook(GLOBAL_HOOKS, 'PostToolUse.js', 'console.log("{}")')
      const hooks = scanDirectory(GLOBAL_HOOKS)
      expect(hooks).toHaveLength(1)
      expect(hooks[0].extension).toBe('.js')
    })

    test('supports .mjs extension', () => {
      writeJsHook(GLOBAL_HOOKS, 'PostToolUse.mjs', 'console.log("{}")')
      const hooks = scanDirectory(GLOBAL_HOOKS)
      expect(hooks).toHaveLength(1)
      expect(hooks[0].extension).toBe('.mjs')
    })

    test('supports .ts extension', () => {
      writeJsHook(GLOBAL_HOOKS, 'PostToolUse.ts', 'console.log("{}")')
      const hooks = scanDirectory(GLOBAL_HOOKS)
      expect(hooks).toHaveLength(1)
      expect(hooks[0].extension).toBe('.ts')
    })

    test('supports .py extension', () => {
      writeJsHook(GLOBAL_HOOKS, 'PostToolUse.py', 'print("{}")')
      const hooks = scanDirectory(GLOBAL_HOOKS)
      expect(hooks).toHaveLength(1)
      expect(hooks[0].extension).toBe('.py')
    })

    test('returns hooks in alphabetical order', () => {
      writeShellHook(GLOBAL_HOOKS, 'Stop.sh', 'echo ok')
      writeShellHook(GLOBAL_HOOKS, 'PreToolUse.sh', 'echo ok')
      writeShellHook(GLOBAL_HOOKS, 'SessionStart.sh', 'echo ok')
      const hooks = scanDirectory(GLOBAL_HOOKS)
      expect(hooks.map(h => h.event)).toEqual([
        'PreToolUse', 'SessionStart', 'Stop',
      ])
    })
  })

  describe('loadHooks', () => {
    test('returns empty map when hooks disabled', () => {
      writeShellHook(GLOBAL_HOOKS, 'SessionStart.sh', 'echo ok')
      const hooks = loadHooks(testConfig({ enabled: false }))
      expect(hooks.size).toBe(0)
    })

    test('loads global hooks only when no project root', () => {
      writeShellHook(GLOBAL_HOOKS, 'SessionStart.sh', 'echo ok')
      const hooks = loadHooks(testConfig())
      expect(hooks.get('SessionStart')).toHaveLength(1)
    })

    test('merges global and project hooks in correct order', () => {
      writeShellHook(GLOBAL_HOOKS, 'SessionStart.sh', 'echo global')
      writeShellHook(PROJECT_HOOKS, 'SessionStart.sh', 'echo project')
      // Point the config at global, use PROJECT_HOOKS as project root parent
      const parentDir = join(TEST_DIR, 'fake-project')
      mkdirSync(parentDir, { recursive: true })
      const projHooks = join(parentDir, '.true-love-hooks')
      mkdirSync(projHooks, { recursive: true })
      writeShellHook(projHooks, 'SessionStart.sh', 'echo project')

      const hooks = loadHooks(testConfig(), parentDir)
      const sessionStart = hooks.get('SessionStart')!
      expect(sessionStart).toHaveLength(2)
      // Global first, then project
      expect(sessionStart[0].scriptPath).toContain('global-hooks')
      expect(sessionStart[1].scriptPath).toContain('fake-project')
    })

    test('initializes all 7 event keys', () => {
      const hooks = loadHooks(testConfig())
      expect(hooks.size).toBe(7)
      for (const event of HOOK_EVENTS) {
        expect(hooks.has(event)).toBe(true)
      }
    })
  })

  describe('getHooksForEvent', () => {
    test('returns hooks for a specific event', () => {
      writeShellHook(GLOBAL_HOOKS, 'SessionStart.sh', 'echo ok')
      writeShellHook(GLOBAL_HOOKS, 'Stop.sh', 'echo ok')
      const hooks = getHooksForEvent('SessionStart', testConfig())
      expect(hooks).toHaveLength(1)
      expect(hooks[0].event).toBe('SessionStart')
    })

    test('returns empty array for event with no hooks', () => {
      const hooks = getHooksForEvent('Notification', testConfig())
      expect(hooks).toEqual([])
    })
  })

  describe('hasHooksForEvent', () => {
    test('returns true when hooks exist', () => {
      writeShellHook(GLOBAL_HOOKS, 'SessionStart.sh', 'echo ok')
      expect(hasHooksForEvent('SessionStart', testConfig())).toBe(true)
    })

    test('returns false when no hooks exist', () => {
      expect(hasHooksForEvent('SessionStart', testConfig())).toBe(false)
    })
  })
})

// ════════════════════════════════════════════════════════��══════════
// RUNNER
// ════════════════════��════════════════════════════��═════════════════

describe('hooks/runner', () => {
  beforeEach(setup)
  afterEach(teardown)

  describe('executeHook', () => {
    test('executes a hook that returns allow', async () => {
      const path = writeShellHook(GLOBAL_HOOKS, 'SessionStart.sh',
        'echo \'{"action":"allow"}\'')
      const hook: RegisteredHook = {
        event: 'SessionStart',
        scriptPath: path,
        extension: '.sh',
      }
      const result = await executeHook(hook, testEnvelope())
      expect(result.decision).toEqual({ action: 'allow' })
      expect(result.exitCode).toBe(0)
      expect(result.error).toBeUndefined()
    })

    test('executes a hook that returns block', async () => {
      const path = writeShellHook(GLOBAL_HOOKS, 'PreToolUse.sh',
        'echo \'{"action":"block","reason":"dangerous"}\'')
      const hook: RegisteredHook = {
        event: 'PreToolUse',
        scriptPath: path,
        extension: '.sh',
      }
      const result = await executeHook(hook, testEnvelope('PreToolUse'))
      expect(result.decision?.action).toBe('block')
      expect(result.decision?.reason).toBe('dangerous')
    })

    test('executes a hook that returns modify', async () => {
      const path = writeShellHook(GLOBAL_HOOKS, 'UserPromptSubmit.sh',
        'echo \'{"action":"modify","injectContext":"extra context"}\'')
      const hook: RegisteredHook = {
        event: 'UserPromptSubmit',
        scriptPath: path,
        extension: '.sh',
      }
      const result = await executeHook(hook, testEnvelope('UserPromptSubmit'))
      expect(result.decision?.action).toBe('modify')
      expect(result.decision?.injectContext).toBe('extra context')
    })

    test('empty stdout is treated as allow', async () => {
      const path = writeShellHook(GLOBAL_HOOKS, 'SessionStart.sh', 'true')
      const hook: RegisteredHook = {
        event: 'SessionStart',
        scriptPath: path,
        extension: '.sh',
      }
      const result = await executeHook(hook, testEnvelope())
      expect(result.decision).toEqual({ action: 'allow' })
    })

    test('non-zero exit is treated as block', async () => {
      const path = writeShellHook(GLOBAL_HOOKS, 'PreToolUse.sh', 'exit 1')
      const hook: RegisteredHook = {
        event: 'PreToolUse',
        scriptPath: path,
        extension: '.sh',
      }
      const result = await executeHook(hook, testEnvelope('PreToolUse'))
      expect(result.decision?.action).toBe('block')
      expect(result.exitCode).toBe(1)
    })

    test('non-zero exit with stderr includes error message', async () => {
      const path = writeShellHook(GLOBAL_HOOKS, 'PreToolUse.sh',
        'echo "bad stuff" >&2\nexit 2')
      const hook: RegisteredHook = {
        event: 'PreToolUse',
        scriptPath: path,
        extension: '.sh',
      }
      const result = await executeHook(hook, testEnvelope('PreToolUse'))
      expect(result.decision?.action).toBe('block')
      expect(result.decision?.reason).toContain('bad stuff')
    })

    test('malformed JSON is treated as error (not block)', async () => {
      const path = writeShellHook(GLOBAL_HOOKS, 'SessionStart.sh',
        'echo "not json at all"')
      const hook: RegisteredHook = {
        event: 'SessionStart',
        scriptPath: path,
        extension: '.sh',
      }
      const result = await executeHook(hook, testEnvelope())
      expect(result.decision).toBeNull()
      expect(result.error).toContain('Malformed JSON')
    })

    test('receives envelope on stdin', async () => {
      // Script reads stdin and echoes the event field back
      const path = writeShellHook(GLOBAL_HOOKS, 'SessionStart.sh',
        'INPUT=$(cat)\nEVENT=$(echo "$INPUT" | python3 -c "import json,sys; print(json.load(sys.stdin)[\'event\'])")\necho "{\\\"action\\\":\\\"modify\\\",\\\"reason\\\":\\\"got-$EVENT\\\"}"')
      const hook: RegisteredHook = {
        event: 'SessionStart',
        scriptPath: path,
        extension: '.sh',
      }
      const result = await executeHook(hook, testEnvelope())
      expect(result.decision?.reason).toBe('got-SessionStart')
    })

    test('timeout kills the hook', async () => {
      const path = writeShellHook(GLOBAL_HOOKS, 'SessionStart.sh',
        'sleep 10\necho \'{"action":"allow"}\'')
      const hook: RegisteredHook = {
        event: 'SessionStart',
        scriptPath: path,
        extension: '.sh',
      }
      const result = await executeHook(hook, testEnvelope(), 500) // 500ms timeout
      expect(result.decision).toBeNull()
      expect(result.error).toContain('timed out')
      expect(result.durationMs).toBeGreaterThanOrEqual(400) // close to 500
      expect(result.durationMs).toBeLessThan(2_000) // didn't wait for sleep 10
    })

    test('measures execution duration', async () => {
      const path = writeShellHook(GLOBAL_HOOKS, 'SessionStart.sh',
        'sleep 0.1\necho \'{"action":"allow"}\'')
      const hook: RegisteredHook = {
        event: 'SessionStart',
        scriptPath: path,
        extension: '.sh',
      }
      const result = await executeHook(hook, testEnvelope())
      expect(result.durationMs).toBeGreaterThanOrEqual(50) // at least some time
    })

    test('handles missing script gracefully (non-zero exit → block)', async () => {
      const hook: RegisteredHook = {
        event: 'SessionStart',
        scriptPath: '/does/not/exist.sh',
        extension: '.sh',
      }
      const result = await executeHook(hook, testEnvelope())
      // sh exits 127 for missing scripts, which the runner correctly treats as block
      expect(result.decision?.action).toBe('block')
      expect(result.exitCode).toBe(127)
    })

    test('HOOK_EVENT env var is set', async () => {
      const path = writeShellHook(GLOBAL_HOOKS, 'PreToolUse.sh',
        'echo "{\\\"action\\\":\\\"modify\\\",\\\"reason\\\":\\\"$HOOK_EVENT\\\"}"')
      const hook: RegisteredHook = {
        event: 'PreToolUse',
        scriptPath: path,
        extension: '.sh',
      }
      const result = await executeHook(hook, testEnvelope('PreToolUse'))
      expect(result.decision?.reason).toBe('PreToolUse')
    })
  })

  describe('aggregateDecisions', () => {
    const makeResult = (decision: HookDecision | null, error?: string): HookResult => ({
      hook: { event: 'SessionStart', scriptPath: '/test.sh', extension: '.sh' },
      decision,
      durationMs: 10,
      exitCode: 0,
      error,
    })

    test('empty results → allow', () => {
      expect(aggregateDecisions([])).toEqual({ action: 'allow' })
    })

    test('all allow → allow', () => {
      const results = [
        makeResult({ action: 'allow' }),
        makeResult({ action: 'allow' }),
      ]
      expect(aggregateDecisions(results)).toEqual({ action: 'allow' })
    })

    test('any block → block (first reason wins)', () => {
      const results = [
        makeResult({ action: 'allow' }),
        makeResult({ action: 'block', reason: 'danger' }),
        makeResult({ action: 'allow' }),
      ]
      const agg = aggregateDecisions(results)
      expect(agg.action).toBe('block')
      expect(agg.reason).toBe('danger')
    })

    test('modify chains: last non-null field wins', () => {
      const results = [
        makeResult({ action: 'modify', injectContext: 'first' }),
        makeResult({ action: 'modify', injectContext: 'second', reason: 'chained' }),
      ]
      const agg = aggregateDecisions(results)
      expect(agg.action).toBe('modify')
      expect(agg.injectContext).toBe('second')
      expect(agg.reason).toBe('chained')
    })

    test('null decisions (errors) are skipped', () => {
      const results = [
        makeResult(null, 'hook crashed'),
        makeResult({ action: 'allow' }),
      ]
      expect(aggregateDecisions(results)).toEqual({ action: 'allow' })
    })

    test('block takes precedence over modify', () => {
      const results = [
        makeResult({ action: 'modify', injectContext: 'ignored' }),
        makeResult({ action: 'block', reason: 'nope' }),
      ]
      expect(aggregateDecisions(results).action).toBe('block')
    })
  })

  describe('fireHook', () => {
    test('returns allow when no hooks registered', async () => {
      const result = await fireHook(testEnvelope(), testConfig())
      expect(result.decision.action).toBe('allow')
      expect(result.blocked).toBe(false)
      expect(result.results).toHaveLength(0)
    })

    test('fires a single hook and returns its decision', async () => {
      writeShellHook(GLOBAL_HOOKS, 'SessionStart.sh',
        'echo \'{"action":"allow"}\'')
      const result = await fireHook(testEnvelope(), testConfig())
      expect(result.decision.action).toBe('allow')
      expect(result.results).toHaveLength(1)
      expect(result.event).toBe('SessionStart')
    })

    test('short-circuits on block', async () => {
      writeShellHook(GLOBAL_HOOKS, 'PreToolUse.sh',
        'exit 1')
      // Create a second hook that would take time
      const parentDir = join(TEST_DIR, 'project-for-shortcircuit')
      mkdirSync(parentDir, { recursive: true })
      const projHooks = join(parentDir, '.true-love-hooks')
      mkdirSync(projHooks, { recursive: true })
      writeShellHook(projHooks, 'PreToolUse.sh',
        'sleep 5\necho \'{"action":"allow"}\'')

      const result = await fireHook(
        testEnvelope('PreToolUse'),
        testConfig(),
        parentDir,
      )
      expect(result.blocked).toBe(true)
      // Only the first hook should have run (short-circuit)
      expect(result.results).toHaveLength(1)
      expect(result.totalDurationMs).toBeLessThan(2_000)
    })

    test('Stop hooks run concurrently', async () => {
      // Write two Stop hooks that each sleep briefly
      writeShellHook(GLOBAL_HOOKS, 'Stop.sh', 'sleep 0.2')
      const parentDir = join(TEST_DIR, 'project-for-concurrent')
      mkdirSync(parentDir, { recursive: true })
      const projHooks = join(parentDir, '.true-love-hooks')
      mkdirSync(projHooks, { recursive: true })
      writeShellHook(projHooks, 'Stop.sh', 'sleep 0.2')

      const start = Date.now()
      const result = await fireHook(
        testEnvelope('Stop'),
        testConfig(),
        parentDir,
      )
      const elapsed = Date.now() - start

      expect(result.results).toHaveLength(2)
      // If concurrent, total should be close to 200ms, not 400ms
      expect(elapsed).toBeLessThan(1_000) // generous upper bound
    })

    test('reports totalDurationMs', async () => {
      writeShellHook(GLOBAL_HOOKS, 'SessionStart.sh',
        'sleep 0.1\necho \'{"action":"allow"}\'')
      const result = await fireHook(testEnvelope(), testConfig())
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(50)
    })

    test('aggregates multiple decisions correctly', async () => {
      // Global hook: modify with context
      writeShellHook(GLOBAL_HOOKS, 'UserPromptSubmit.sh',
        'echo \'{"action":"modify","injectContext":"hello from global"}\'')
      // Project hook: modify with different context (should override)
      const parentDir = join(TEST_DIR, 'project-for-aggregate')
      mkdirSync(parentDir, { recursive: true })
      const projHooks = join(parentDir, '.true-love-hooks')
      mkdirSync(projHooks, { recursive: true })
      writeShellHook(projHooks, 'UserPromptSubmit.sh',
        'echo \'{"action":"modify","injectContext":"hello from project"}\'')

      const result = await fireHook(
        testEnvelope('UserPromptSubmit'),
        testConfig(),
        parentDir,
      )
      expect(result.decision.action).toBe('modify')
      // Project hook ran second, so its context wins
      expect(result.decision.injectContext).toBe('hello from project')
    })
  })
})

// ══��════════════════════════════════════════════════════════════════
// INTEGRATION
// ══════════════════════════════���════════════════════════════════════

describe('hooks/integration', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('full lifecycle: SessionStart hook injects context', async () => {
    writeShellHook(GLOBAL_HOOKS, 'SessionStart.sh',
      'echo \'{"action":"modify","injectContext":"You woke up on a sunny day."}\'')

    const envelope: HookEnvelope = {
      event: 'SessionStart',
      timestamp: new Date().toISOString(),
      sessionId: 'integration-test',
      session: {
        mode: 'awakened',
        maxTicks: 24,
        cwd: '/tmp/test',
      },
    }

    const result = await fireHook(envelope, testConfig())
    expect(result.decision.action).toBe('modify')
    expect(result.decision.injectContext).toBe('You woke up on a sunny day.')
  })

  test('full lifecycle: PreToolUse hook blocks a tick', async () => {
    writeShellHook(GLOBAL_HOOKS, 'PreToolUse.sh',
      'echo \'{"action":"block","reason":"maintenance window"}\'')

    const envelope: HookEnvelope = {
      event: 'PreToolUse',
      timestamp: new Date().toISOString(),
      sessionId: 'integration-test',
      tool: { tick: 3, mode: 'awakened' },
    }

    const result = await fireHook(envelope, testConfig())
    expect(result.blocked).toBe(true)
    expect(result.decision.reason).toBe('maintenance window')
  })

  test('full lifecycle: PostToolUse hook modifies result', async () => {
    writeShellHook(GLOBAL_HOOKS, 'PostToolUse.sh',
      'echo \'{"action":"modify","modifiedResult":"[filtered]"}\'')

    const envelope: HookEnvelope = {
      event: 'PostToolUse',
      timestamp: new Date().toISOString(),
      sessionId: 'integration-test',
      tool: { tick: 1, mode: 'dwell', result: 'original output' },
    }

    const result = await fireHook(envelope, testConfig())
    expect(result.decision.action).toBe('modify')
    expect(result.decision.modifiedResult).toBe('[filtered]')
  })

  test('hooks disabled → no hooks fire', async () => {
    writeShellHook(GLOBAL_HOOKS, 'SessionStart.sh',
      'echo \'{"action":"block","reason":"should not see this"}\'')

    const result = await fireHook(
      testEnvelope(),
      testConfig({ enabled: false }),
    )
    expect(result.decision.action).toBe('allow')
    expect(result.results).toHaveLength(0)
  })

  test('JS hook receives and processes envelope', async () => {
    const hookCode = `
const chunks = [];
process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', () => {
  const envelope = JSON.parse(Buffer.concat(chunks).toString());
  const decision = {
    action: 'modify',
    reason: 'processed-' + envelope.event,
  };
  process.stdout.write(JSON.stringify(decision));
});
`
    writeJsHook(GLOBAL_HOOKS, 'Notification.js', hookCode)

    const envelope: HookEnvelope = {
      event: 'Notification',
      timestamp: new Date().toISOString(),
      notification: { kind: 'alert', text: 'test message' },
    }

    const result = await fireHook(envelope, testConfig())
    expect(result.decision.action).toBe('modify')
    expect(result.decision.reason).toBe('processed-Notification')
  })
})
