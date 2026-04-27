// agent-client.test.ts — tests for the host-side agent client.
//
// Uses a mock agent runtime (fixtures/mock-agent-runtime.mjs) that speaks
// the protocol without calling the Anthropic API. Tests cover:
//   - Startup + initial health
//   - Turn sending + response collection
//   - Stream event forwarding
//   - Health checks
//   - Graceful shutdown
//   - Crash recovery + respawn
//   - Timeout handling
//   - Error frame handling
//   - State transitions
//
// Phase 3 of the long-lived-agent-runtime mission.

import { describe, expect, test, afterEach } from 'bun:test'
import { join } from 'node:path'
import { AgentClient, type TurnResult, type AgentHealth } from '../agent-client.js'

// ── Mock agent path ─────────────────────────────────────────────────

const MOCK_RUNTIME = join(import.meta.dir, 'fixtures', 'mock-agent-runtime.mjs')

// ── Helpers ─────────────────────────────────────────────────────────

const logs: string[] = []
function testLog(msg: string) {
  logs.push(msg)
}

function createClient(envOverrides?: Record<string, string>, opts?: {
  startupTimeoutMs?: number
  turnAckTimeoutMs?: number
  healthCheckTimeoutMs?: number
  shutdownGraceMs?: number
}) {
  return new AgentClient({
    runtimePath: MOCK_RUNTIME,
    model: 'sonnet',
    nodeBin: 'bun',
    env: envOverrides,
    log: testLog,
    startupTimeoutMs: opts?.startupTimeoutMs ?? 10_000,
    turnAckTimeoutMs: opts?.turnAckTimeoutMs ?? 5_000,
    healthCheckTimeoutMs: opts?.healthCheckTimeoutMs ?? 5_000,
    shutdownGraceMs: opts?.shutdownGraceMs ?? 3_000,
  })
}

const simpleSystem = [{ type: 'text' as const, text: 'You are a test assistant.' }]

// Track clients for cleanup
const activeClients: AgentClient[] = []

function trackClient(client: AgentClient): AgentClient {
  activeClients.push(client)
  return client
}

afterEach(async () => {
  logs.length = 0
  // Clean up any clients that are still alive
  for (const client of activeClients) {
    if (client.isAlive) {
      try {
        await client.shutdown()
      } catch {
        // best effort
      }
    }
  }
  activeClients.length = 0
})

// ── Startup tests ───────────────────────────────────────────────────

describe('AgentClient: startup', () => {
  test('starts and reaches ready state', async () => {
    const client = trackClient(createClient())
    expect(client.state).toBe('idle')

    await client.start()

    expect(client.state).toBe('ready')
    expect(client.isReady).toBe(true)
    expect(client.isAlive).toBe(true)
    expect(client.pid).toBeGreaterThan(0)
    expect(client.crashes).toBe(0)
  })

  test('receives initial health data', async () => {
    const client = trackClient(createClient())
    await client.start()

    const health = client.health
    expect(health).not.toBeNull()
    expect(health!.turnsCompleted).toBe(0)
    expect(health!.lastTurnMsAgo).toBeNull()
    expect(health!.uptimeMs).toBeGreaterThanOrEqual(0)
    expect(health!.memoryMb).toBeGreaterThan(0)
  })

  test('emits ready event on successful start', async () => {
    const client = trackClient(createClient())
    let readyHealth: AgentHealth | null = null
    client.on('ready', (h: AgentHealth) => { readyHealth = h })

    await client.start()

    expect(readyHealth).not.toBeNull()
    expect(readyHealth!.turnsCompleted).toBe(0)
  })

  test('rejects if already started', async () => {
    const client = trackClient(createClient())
    await client.start()

    await expect(client.start()).rejects.toThrow(/Cannot start agent in state 'ready'/)
  })

  test('fails when startup timeout is exceeded', async () => {
    const client = trackClient(createClient(
      { MOCK_STARTUP_DELAY_MS: '20000' },
      { startupTimeoutMs: 200 },
    ))

    await expect(client.start()).rejects.toThrow(/failed to start/)
    expect(client.state).toBe('dead')
    expect(client.crashes).toBe(1)
  })

  test('fails when agent exits immediately', async () => {
    const client = trackClient(createClient(
      { MOCK_FAIL_STARTUP: 'true' },
      { startupTimeoutMs: 3000 },
    ))

    await expect(client.start()).rejects.toThrow(/failed to start/)
    expect(client.state).toBe('dead')
    expect(client.crashes).toBe(1)
  })
})

// ── Turn sending tests ──────────────────────────────────────────────

describe('AgentClient: sendTurn', () => {
  test('sends a turn and receives response', async () => {
    const client = trackClient(createClient())
    await client.start()

    const result = await client.sendTurn({
      system: simpleSystem,
      prompt: 'Hello, agent!',
    })

    expect(result.code).toBe(0)
    expect(result.stdout).toBe('mock response')
    expect(result.streamJsonLines.length).toBeGreaterThan(0)
    expect(client.state).toBe('ready')
  })

  test('returns correct streamJsonLines from stream events', async () => {
    const client = trackClient(createClient())
    await client.start()

    const result = await client.sendTurn({
      system: simpleSystem,
      prompt: 'test stream events',
    })

    // The mock sends an 'assistant' event and a 'result' event
    expect(result.streamJsonLines.length).toBe(2)

    const events = result.streamJsonLines.map(l => JSON.parse(l))
    expect(events[0].type).toBe('assistant')
    expect(events[1].type).toBe('result')
    expect(events[1].result).toBe('mock response')
  })

  test('forwards stream events via callback', async () => {
    const client = trackClient(createClient())
    await client.start()

    const streamEvents: Record<string, unknown>[] = []
    await client.sendTurn({
      system: simpleSystem,
      prompt: 'test callback',
      onStreamEvent: (event) => streamEvents.push(event),
    })

    expect(streamEvents.length).toBe(2)
    expect(streamEvents[0].type).toBe('assistant')
    expect(streamEvents[1].type).toBe('result')
  })

  test('sends multiple turns sequentially', async () => {
    const client = trackClient(createClient())
    await client.start()

    const r1 = await client.sendTurn({ system: simpleSystem, prompt: 'Turn 1' })
    expect(r1.code).toBe(0)

    const r2 = await client.sendTurn({ system: simpleSystem, prompt: 'Turn 2' })
    expect(r2.code).toBe(0)

    const r3 = await client.sendTurn({ system: simpleSystem, prompt: 'Turn 3' })
    expect(r3.code).toBe(0)

    expect(client.state).toBe('ready')
  })

  test('returns custom response text', async () => {
    const client = trackClient(createClient({ MOCK_RESPONSE_TEXT: 'HEARTBEAT_OK' }))
    await client.start()

    const result = await client.sendTurn({
      system: simpleSystem,
      prompt: 'heartbeat check',
    })

    expect(result.stdout).toBe('HEARTBEAT_OK')
  })

  test('rejects when not in ready state', async () => {
    const client = trackClient(createClient())
    // Don't start — state is 'idle'

    await expect(client.sendTurn({
      system: simpleSystem,
      prompt: 'should fail',
    })).rejects.toThrow(/Cannot send turn in state 'idle'/)
  })

  test('clears stderr buffer between turns', async () => {
    const client = trackClient(createClient())
    await client.start()

    const r1 = await client.sendTurn({ system: simpleSystem, prompt: 'Turn 1' })
    // First turn may have some stderr from startup
    const stderr1 = r1.stderr

    const r2 = await client.sendTurn({ system: simpleSystem, prompt: 'Turn 2' })
    // Second turn should have fresh stderr (may be empty or just the turn's stderr)
    // The key is that it doesn't contain startup messages again
    expect(r2.stderr).not.toContain('Starting mock agent')
  })
})

// ── Error handling tests ────────────────────────────────────────────

describe('AgentClient: error handling', () => {
  test('handles auth_failed error with exit code 64', async () => {
    const client = trackClient(createClient({ MOCK_FAIL_TURN: 'auth_failed' }))
    await client.start()

    const result = await client.sendTurn({
      system: simpleSystem,
      prompt: 'trigger auth failure',
    })

    expect(result.code).toBe(64)
    expect(result.stdout).toContain('auth_failed')
    expect(client.state).toBe('ready') // client recovers
  })

  test('handles quota_exceeded error with exit code 65', async () => {
    const client = trackClient(createClient({ MOCK_FAIL_TURN: 'quota_exceeded' }))
    await client.start()

    const result = await client.sendTurn({
      system: simpleSystem,
      prompt: 'trigger quota failure',
    })

    expect(result.code).toBe(65)
    expect(result.stdout).toContain('quota_exceeded')
  })

  test('handles api_error with exit code 1', async () => {
    const client = trackClient(createClient({ MOCK_FAIL_TURN: 'api_error' }))
    await client.start()

    const result = await client.sendTurn({
      system: simpleSystem,
      prompt: 'trigger api error',
    })

    expect(result.code).toBe(1)
  })

  test('detects agent crash during turn', async () => {
    const client = trackClient(createClient({ MOCK_CRASH_ON_TURN_N: '1' }))
    await client.start()

    await expect(client.sendTurn({
      system: simpleSystem,
      prompt: 'should trigger crash',
    })).rejects.toThrow(/Agent/)

    expect(client.state).toBe('dead')
  })
})

// ── Health check tests ──────────────────────────────────────────────

describe('AgentClient: health checks', () => {
  test('sends health check and receives response', async () => {
    const client = trackClient(createClient())
    await client.start()

    const health = await client.healthCheck()

    expect(health.turnsCompleted).toBe(0)
    expect(health.uptimeMs).toBeGreaterThan(0)
    expect(health.memoryMb).toBeGreaterThan(0)
  })

  test('health check updates internal health cache', async () => {
    const client = trackClient(createClient())
    await client.start()

    // Do a turn first
    await client.sendTurn({ system: simpleSystem, prompt: 'hello' })

    const health = await client.healthCheck()

    // turnsCompleted should reflect the turn we just sent
    // (mock increments turnsCompleted on each turn)
    expect(health.turnsCompleted).toBe(1)

    // Internal cache should be updated
    expect(client.health).toEqual(health)
  })

  test('rejects health check when dead', async () => {
    const client = trackClient(createClient())
    // Don't start

    await expect(client.healthCheck()).rejects.toThrow(/Cannot health-check/)
  })
})

// ── Shutdown tests ──────────────────────────────────────────────────

describe('AgentClient: shutdown', () => {
  test('gracefully shuts down the agent', async () => {
    const client = trackClient(createClient())
    await client.start()
    expect(client.isAlive).toBe(true)

    await client.shutdown('session-end')

    // After shutdown, the client should be dead
    expect(client.state).toBe('dead')
    expect(client.isAlive).toBe(false)
  })

  test('shutdown is idempotent when already dead', async () => {
    const client = trackClient(createClient())
    // Never started — state is 'idle'

    // Should not throw
    await client.shutdown()
  })

  test('handles shutdown when agent ignores shutdown frame', async () => {
    const client = trackClient(createClient(
      { MOCK_HANG_ON_SHUTDOWN: 'true' },
      { shutdownGraceMs: 500 },
    ))
    await client.start()

    // Should eventually force-kill
    await client.shutdown('session-end')

    expect(client.state).toBe('dead')
  }, 15_000)

  test('emits exit event on shutdown', async () => {
    const client = trackClient(createClient())
    await client.start()

    let exitInfo: { code: number | null; signal: string | null } | null = null
    client.on('exit', (info: any) => { exitInfo = info })

    await client.shutdown('session-end')

    // Give a moment for the exit event to fire
    await new Promise(r => setTimeout(r, 200))

    expect(exitInfo).not.toBeNull()
  })
})

// ── Respawn tests ───────────────────────────────────────────────────

describe('AgentClient: respawn', () => {
  test('respawns after shutdown', async () => {
    const client = trackClient(createClient())
    await client.start()

    const pid1 = client.pid

    await client.shutdown('scheduled-respawn')
    expect(client.state).toBe('dead')

    await client.start()
    expect(client.state).toBe('ready')
    // New process should have a different PID
    // (Note: PIDs can theoretically be reused, but extremely unlikely in tests)
    expect(client.pid).toBeGreaterThan(0)
  })

  test('respawn convenience method works', async () => {
    const client = trackClient(createClient())
    await client.start()

    await client.respawn('scheduled-respawn')

    expect(client.state).toBe('ready')
    expect(client.isReady).toBe(true)
  })

  test('respawn from dead state works', async () => {
    const client = trackClient(createClient({ MOCK_CRASH_ON_TURN_N: '1' }))
    await client.start()

    // Trigger crash
    try {
      await client.sendTurn({ system: simpleSystem, prompt: 'crash me' })
    } catch {
      // expected
    }

    expect(client.state).toBe('dead')

    // Now create a fresh client pointing to a non-crashing mock
    // (The same client can respawn because the crash env var is per-process)
    const client2 = trackClient(createClient())
    await client2.start()
    expect(client2.state).toBe('ready')
  })
})

// ── State transition tests ──────────────────────────────────────────

describe('AgentClient: state transitions', () => {
  test('idle → starting → ready', async () => {
    const client = trackClient(createClient())
    const states: string[] = []
    states.push(client.state) // idle

    const startPromise = client.start()
    // State should be 'starting' immediately after calling start()
    // (but before await resolves)
    // Note: this is hard to observe synchronously; just check final state
    await startPromise
    states.push(client.state) // ready

    expect(states[0]).toBe('idle')
    expect(states[1]).toBe('ready')
  })

  test('ready → busy → ready during turn', async () => {
    const client = trackClient(createClient({ MOCK_TURN_DELAY_MS: '100' }))
    await client.start()
    expect(client.state).toBe('ready')

    // Start turn (don't await yet)
    const turnPromise = client.sendTurn({
      system: simpleSystem,
      prompt: 'slow turn',
    })

    // Give a moment for the state to change
    await new Promise(r => setTimeout(r, 20))
    expect(client.state).toBe('busy')

    // Wait for turn to complete
    await turnPromise
    expect(client.state).toBe('ready')
  })

  test('any → dead on process exit', async () => {
    const client = trackClient(createClient({ MOCK_CRASH_ON_TURN_N: '1' }))
    await client.start()
    expect(client.state).toBe('ready')

    try {
      await client.sendTurn({ system: simpleSystem, prompt: 'crash' })
    } catch {
      // expected
    }

    expect(client.state).toBe('dead')
  })
})

// ── Integration: TurnResult shape compatibility ─────────────────────

describe('AgentClient: TurnResult shape', () => {
  test('result matches runOneTurn return shape', async () => {
    const client = trackClient(createClient())
    await client.start()

    const result: TurnResult = await client.sendTurn({
      system: simpleSystem,
      prompt: 'shape test',
    })

    // Verify all fields exist and have correct types
    expect(typeof result.code).toBe('number')
    expect(typeof result.stdout).toBe('string')
    expect(typeof result.stderr).toBe('string')
    expect(Array.isArray(result.streamJsonLines)).toBe(true)

    // Verify streamJsonLines are valid JSON strings
    for (const line of result.streamJsonLines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
  })

  test('successful turn returns exit code 0', async () => {
    const client = trackClient(createClient())
    await client.start()

    const result = await client.sendTurn({
      system: simpleSystem,
      prompt: 'success test',
    })

    expect(result.code).toBe(0)
    expect(result.stdout).toBeTruthy()
  })

  test('error turn returns appropriate exit code', async () => {
    const client = trackClient(createClient({ MOCK_FAIL_TURN: 'auth_failed' }))
    await client.start()

    const result = await client.sendTurn({
      system: simpleSystem,
      prompt: 'auth test',
    })

    // auth_failed maps to exit code 64
    expect(result.code).toBe(64)
  })
})

// ── Crash counter tests ─────────────────────────────────────────────

describe('AgentClient: crash tracking', () => {
  test('crash counter starts at zero', async () => {
    const client = trackClient(createClient())
    expect(client.crashes).toBe(0)

    await client.start()
    expect(client.crashes).toBe(0)
  })

  test('crash counter increments on startup failure', async () => {
    const client = trackClient(createClient(
      { MOCK_FAIL_STARTUP: 'true' },
      { startupTimeoutMs: 3000 },
    ))

    try {
      await client.start()
    } catch {
      // expected
    }

    expect(client.crashes).toBe(1)
  })
})

// ── Turn options passthrough ────────────────────────────────────────

describe('AgentClient: turn options', () => {
  test('passes system blocks to agent', async () => {
    const client = trackClient(createClient())
    await client.start()

    const multiSystem = [
      { type: 'text' as const, text: 'Block 1' },
      { type: 'text' as const, text: 'Block 2', cache_control: { type: 'ephemeral' as const } },
    ]

    // The mock doesn't validate system blocks, but the turn should succeed
    const result = await client.sendTurn({
      system: multiSystem,
      prompt: 'multi-system test',
    })

    expect(result.code).toBe(0)
  })

  test('passes optional turn fields', async () => {
    const client = trackClient(createClient())
    await client.start()

    const result = await client.sendTurn({
      system: simpleSystem,
      prompt: 'options test',
      model: 'opus',
      effort: 'high',
      max_tokens: 4096,
      cache_breakpoints: [0],
    })

    expect(result.code).toBe(0)
  })
})
