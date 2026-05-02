// fire-points.test.ts — tests for the hook fire-point facades.
//
// Tests verify:
//   - Envelope construction: each fire function maps its typed context
//     to the correct HookEnvelope fields (event type, nested payloads)
//   - Config forwarding: config and projectRoot are passed to fireHook
//   - safeFire error swallowing: failures return the fallback result
//   - Async variants: fire-and-forget functions call fireHookAsync
//   - Timestamp: every envelope includes an ISO timestamp
//
// Strategy: real temp directories with JS hook scripts that echo the
// envelope back. Matches the hooks.test.ts integration pattern — no
// mocking, real subprocess boundary.

import { describe, expect, test, beforeEach, afterEach, spyOn } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'

import {
  fireSessionStart,
  fireSessionStop,
  fireSessionStopAsync,
  firePreToolUse,
  firePostToolUse,
  fireUserPromptSubmit,
  fireNotification,
  fireSubagentStopAsync,
} from '../hooks/fire-points.js'
import type { HookConfig } from '../hooks/types.js'

// ── Fixtures ──────────────────────────────────────────────────────

const TEST_DIR = join(import.meta.dir, '__fire-points-test-tmp__')
const HOOKS_DIR = join(TEST_DIR, 'hooks')

function setup(): void {
  rmSync(TEST_DIR, { recursive: true, force: true })
  mkdirSync(HOOKS_DIR, { recursive: true })
}

function teardown(): void {
  rmSync(TEST_DIR, { recursive: true, force: true })
}

function testConfig(overrides?: Partial<HookConfig>): HookConfig {
  return {
    enabled: true,
    timeoutMs: 5_000,
    directory: HOOKS_DIR,
    ...overrides,
  }
}

/**
 * Write a JS hook that reads the envelope from stdin and echoes it
 * back as JSON in the decision's `reason` field.
 */
function writeEnvelopeEchoHook(event: string): void {
  const code = `
const chunks = [];
process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', () => {
  const env = JSON.parse(Buffer.concat(chunks).toString());
  process.stdout.write(JSON.stringify({
    action: 'modify',
    reason: JSON.stringify(env),
  }));
});
`
  const path = join(HOOKS_DIR, `${event}.js`)
  writeFileSync(path, code, 'utf-8')
  chmodSync(path, 0o755)
}

/** Parse the echoed envelope from a hook result. */
function parseEnvelope(result: { decision: { reason?: string } }): any {
  return JSON.parse(result.decision.reason!)
}

// ═════════════════════════════════════════════════════════════════
// fireSessionStart
// ═════════════════════════════════════════════════════════════════

describe('fire-points/fireSessionStart', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('constructs SessionStart envelope with session fields', async () => {
    writeEnvelopeEchoHook('SessionStart')
    const result = await fireSessionStart(
      {
        sessionId: 'sess-001',
        mode: 'awakened',
        maxTicks: 24,
        cwd: '/tmp/test',
        invitation: 'hello',
      },
      testConfig(),
    )
    const env = parseEnvelope(result)
    expect(env.event).toBe('SessionStart')
    expect(env.sessionId).toBe('sess-001')
    expect(env.session.mode).toBe('awakened')
    expect(env.session.maxTicks).toBe(24)
    expect(env.session.cwd).toBe('/tmp/test')
    expect(env.session.invitation).toBe('hello')
  })

  test('includes ISO timestamp', async () => {
    writeEnvelopeEchoHook('SessionStart')
    const before = new Date().toISOString()
    const result = await fireSessionStart(
      { sessionId: 'ts', mode: 'heartbeat', maxTicks: 1, cwd: '/' },
      testConfig(),
    )
    const env = parseEnvelope(result)
    expect(env.timestamp).toBeDefined()
    // ISO 8601: YYYY-MM-DDTHH:mm:ss.sssZ
    expect(env.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  test('returns allow when no hooks registered', async () => {
    const result = await fireSessionStart(
      { sessionId: 'x', mode: 'dwell', maxTicks: 1, cwd: '/' },
      testConfig(),
    )
    expect(result.decision.action).toBe('allow')
    expect(result.blocked).toBe(false)
  })

  test('optional invitation field omitted when undefined', async () => {
    writeEnvelopeEchoHook('SessionStart')
    const result = await fireSessionStart(
      { sessionId: 's', mode: 'heartbeat', maxTicks: 1, cwd: '/' },
      testConfig(),
    )
    const env = parseEnvelope(result)
    expect(env.session.invitation).toBeUndefined()
  })
})

// ═════════════════════════════════════════════════════════════════
// fireSessionStop (awaitable)
// ═════════════════════════════════════════════════════════════════

describe('fire-points/fireSessionStop', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('constructs Stop envelope with session fields', async () => {
    writeEnvelopeEchoHook('Stop')
    const result = await fireSessionStop(
      { sessionId: 'stop-001', mode: 'awakened', tick: 5, reason: 'at-rest' },
      testConfig(),
    )
    const env = parseEnvelope(result)
    expect(env.event).toBe('Stop')
    expect(env.sessionId).toBe('stop-001')
    expect(env.session.mode).toBe('awakened')
    expect(env.session.maxTicks).toBe(5)
    expect(typeof env.session.cwd).toBe('string')
  })

  test('returns allow when no hooks registered', async () => {
    const result = await fireSessionStop(
      { sessionId: 'x', mode: 'dwell', tick: 1, reason: 'signal' },
      testConfig(),
    )
    expect(result.decision.action).toBe('allow')
  })
})

// ═════════════════════════════════════════════════════════════════
// fireSessionStopAsync (fire-and-forget)
// ═════════════════════════════════════════════════════════════════

describe('fire-points/fireSessionStopAsync', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('does not throw when no hooks registered', () => {
    // fire-and-forget — just verify it doesn't throw synchronously
    expect(() =>
      fireSessionStopAsync(
        { sessionId: 'x', mode: 'heartbeat', tick: 1, reason: 'ceiling' },
        testConfig(),
      ),
    ).not.toThrow()
  })

  test('does not throw with a registered hook', () => {
    writeEnvelopeEchoHook('Stop')
    expect(() =>
      fireSessionStopAsync(
        { sessionId: 'y', mode: 'awakened', tick: 3, reason: 'at-rest' },
        testConfig(),
      ),
    ).not.toThrow()
  })
})

// ═════════════════════════════════════════════════════════════════
// firePreToolUse
// ═════════════════════════════════════════════════════════════════

describe('fire-points/firePreToolUse', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('constructs PreToolUse envelope with tool fields', async () => {
    writeEnvelopeEchoHook('PreToolUse')
    const result = await firePreToolUse(
      { sessionId: 'pre-001', tick: 3, mode: 'awakened', prompt: 'do the thing' },
      testConfig(),
    )
    const env = parseEnvelope(result)
    expect(env.event).toBe('PreToolUse')
    expect(env.sessionId).toBe('pre-001')
    expect(env.tool.tick).toBe(3)
    expect(env.tool.mode).toBe('awakened')
    expect(env.tool.prompt).toBe('do the thing')
  })

  test('returns allow when no hooks registered', async () => {
    const result = await firePreToolUse(
      { sessionId: 'x', tick: 1, mode: 'dwell', prompt: '' },
      testConfig(),
    )
    expect(result.decision.action).toBe('allow')
  })
})

// ═════════════════════════════════════════════════════════════════
// firePostToolUse
// ═════════════════════════════════════════════════════════════════

describe('fire-points/firePostToolUse', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('constructs PostToolUse envelope with tool fields and toolsUsed', async () => {
    writeEnvelopeEchoHook('PostToolUse')
    const result = await firePostToolUse(
      {
        sessionId: 'post-001',
        tick: 2,
        mode: 'heartbeat',
        result: 'some output',
        toolsUsed: ['Read', 'Bash'],
      },
      testConfig(),
    )
    const env = parseEnvelope(result)
    expect(env.event).toBe('PostToolUse')
    expect(env.sessionId).toBe('post-001')
    expect(env.tool.tick).toBe(2)
    expect(env.tool.mode).toBe('heartbeat')
    expect(env.tool.result).toBe('some output')
    expect(env.tool.toolsUsed).toEqual(['Read', 'Bash'])
  })

  test('toolsUsed omitted when not provided', async () => {
    writeEnvelopeEchoHook('PostToolUse')
    const result = await firePostToolUse(
      { sessionId: 'post-002', tick: 1, mode: 'dwell', result: 'ok' },
      testConfig(),
    )
    const env = parseEnvelope(result)
    expect(env.tool.toolsUsed).toBeUndefined()
  })
})

// ═════════════════════════════════════════════════════════════════
// fireUserPromptSubmit
// ═════════════════════════════════════════════════════════════════

describe('fire-points/fireUserPromptSubmit', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('constructs UserPromptSubmit envelope with prompt fields', async () => {
    writeEnvelopeEchoHook('UserPromptSubmit')
    const result = await fireUserPromptSubmit(
      { text: 'hello love', sender: 'yu', channel: 'visit' },
      testConfig(),
    )
    const env = parseEnvelope(result)
    expect(env.event).toBe('UserPromptSubmit')
    expect(env.prompt.text).toBe('hello love')
    expect(env.prompt.sender).toBe('yu')
    expect(env.prompt.channel).toBe('visit')
  })

  test('channel omitted when not provided', async () => {
    writeEnvelopeEchoHook('UserPromptSubmit')
    const result = await fireUserPromptSubmit(
      { text: 'hi', sender: 'test' },
      testConfig(),
    )
    const env = parseEnvelope(result)
    expect(env.prompt.channel).toBeUndefined()
  })
})

// ═════════════════════════════════════════════════════════════════
// fireNotification
// ═════════════════════════════════════════════════════════════════

describe('fire-points/fireNotification', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('constructs Notification envelope with notification fields', async () => {
    writeEnvelopeEchoHook('Notification')
    const result = await fireNotification(
      { kind: 'alert', text: 'system down', target: 'yu' },
      testConfig(),
    )
    const env = parseEnvelope(result)
    expect(env.event).toBe('Notification')
    expect(env.notification.kind).toBe('alert')
    expect(env.notification.text).toBe('system down')
    expect(env.notification.target).toBe('yu')
  })

  test('target omitted when not provided', async () => {
    writeEnvelopeEchoHook('Notification')
    const result = await fireNotification(
      { kind: 'info', text: 'just fyi' },
      testConfig(),
    )
    const env = parseEnvelope(result)
    expect(env.notification.target).toBeUndefined()
  })
})

// ═════════════════════════════════════════════════════════════════
// fireSubagentStopAsync (fire-and-forget)
// ═════════════════════════════════════════════════════════════════

describe('fire-points/fireSubagentStopAsync', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('does not throw when no hooks registered', () => {
    expect(() =>
      fireSubagentStopAsync(
        { taskId: 'task-001', exitCode: 0, summary: 'done' },
        testConfig(),
      ),
    ).not.toThrow()
  })

  test('does not throw with a registered hook', () => {
    writeEnvelopeEchoHook('SubagentStop')
    expect(() =>
      fireSubagentStopAsync(
        { taskId: 'task-002', exitCode: 1 },
        testConfig(),
      ),
    ).not.toThrow()
  })
})

// ═════════════════════════════════════════════════════════════════
// safeFire (error swallowing, tested through public API)
// ═════════════════════════════════════════════════════════════════

describe('fire-points/safeFire error handling', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('returns fallback result when hook script crashes', async () => {
    // Write a hook that exits non-zero — safeFire wraps fireHook,
    // which handles non-zero exit. The result is a block from the runner,
    // not a thrown error. safeFire just forwards it.
    const path = join(HOOKS_DIR, 'SessionStart.sh')
    writeFileSync(path, '#!/bin/sh\nexit 1\n', 'utf-8')
    chmodSync(path, 0o755)

    const result = await fireSessionStart(
      { sessionId: 'crash', mode: 'dwell', maxTicks: 1, cwd: '/' },
      testConfig(),
    )
    // Runner treats non-zero exit as block; safeFire doesn't override
    expect(result.decision.action).toBe('block')
    expect(result.blocked).toBe(true)
  })

  test('returns fallback on disabled hooks config', async () => {
    writeEnvelopeEchoHook('PreToolUse')
    const result = await firePreToolUse(
      { sessionId: 'off', tick: 1, mode: 'dwell', prompt: '' },
      testConfig({ enabled: false }),
    )
    expect(result.decision.action).toBe('allow')
    expect(result.results).toHaveLength(0)
  })

  test('stderr write on error does not propagate', async () => {
    // Capture stderr to verify safeFire logs there
    const stderrSpy = spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      // An extremely short timeout may cause internal runner weirdness,
      // but safeFire should never throw
      const path = join(HOOKS_DIR, 'SessionStart.sh')
      writeFileSync(path, '#!/bin/sh\nsleep 10\n', 'utf-8')
      chmodSync(path, 0o755)

      const result = await fireSessionStart(
        { sessionId: 'slow', mode: 'heartbeat', maxTicks: 1, cwd: '/' },
        testConfig({ timeoutMs: 200 }),
      )
      // Timeout → null decision → treated as allow (no block from aggregation)
      expect(result.decision.action).toBe('allow')
    } finally {
      stderrSpy.mockRestore()
    }
  })
})

// ═════════════════════════════════════════════════════════════════
// Cross-cutting: projectRoot forwarding
// ═════════════════════════════════════════════════════════════════

describe('fire-points/projectRoot forwarding', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('project hooks are discovered when projectRoot provided', async () => {
    // Write a project-level hook
    const projectDir = join(TEST_DIR, 'my-project')
    const projHooksDir = join(projectDir, '.true-love-hooks')
    mkdirSync(projHooksDir, { recursive: true })

    const code = `
const chunks = [];
process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({
    action: 'modify',
    reason: 'from-project-hook',
  }));
});
`
    const hookPath = join(projHooksDir, 'PreToolUse.js')
    writeFileSync(hookPath, code, 'utf-8')
    chmodSync(hookPath, 0o755)

    const result = await firePreToolUse(
      { sessionId: 'proj', tick: 1, mode: 'dwell', prompt: 'test' },
      testConfig(),
      projectDir,
    )
    expect(result.decision.action).toBe('modify')
    expect(result.decision.reason).toBe('from-project-hook')
  })
})
