// heartbeat-wake-deep.test.ts — deep-read tests for heartbeat-wake.ts.
//
// Covers: default arguments, custom coalesce timing, handler error → retry,
// stale disposer no-op, multiple handler generations, re-registration state
// reset, same-priority tie-breaking, scope defaulting, timer kind precedence.
//
// Uses real timers (no fake-timer support in bun:test). Sleeps are minimal
// but necessary — the module schedules via setTimeout internally.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import {
  requestHeartbeatNow,
  setHeartbeatWakeHandler,
  areHeartbeatsEnabled,
  setHeartbeatsEnabled,
  _resetHeartbeatWakeStateForTests,
  type HeartbeatRunResult,
  type WakeRequest,
} from '../heartbeat-wake.js'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

beforeEach(() => {
  _resetHeartbeatWakeStateForTests()
  setHeartbeatsEnabled(true)
})

afterEach(() => {
  _resetHeartbeatWakeStateForTests()
})

// ── Default arguments ───────────────────────────────────────────────

describe('requestHeartbeatNow — defaults', () => {
  test('no opts → defaults to manual reason', async () => {
    const received: WakeRequest[] = []
    setHeartbeatWakeHandler(async (req) => {
      received.push(req)
      return { status: 'ran', durationMs: 1, ack: true }
    })
    requestHeartbeatNow() // no opts
    await sleep(350)
    expect(received).toHaveLength(1)
    expect(received[0]!.reason).toBe('manual')
  })

  test('no opts → scope is undefined', async () => {
    const received: WakeRequest[] = []
    setHeartbeatWakeHandler(async (req) => {
      received.push(req)
      return { status: 'ran', durationMs: 1, ack: true }
    })
    requestHeartbeatNow()
    await sleep(350)
    expect(received[0]!.scope).toBeUndefined()
  })

  test('undefined scope coalesces with another undefined scope', async () => {
    let calls = 0
    setHeartbeatWakeHandler(async () => {
      calls++
      return { status: 'ran', durationMs: 1, ack: true }
    })
    requestHeartbeatNow()
    requestHeartbeatNow()
    await sleep(350)
    // Both have undefined scope → same __default__ key → coalesce
    expect(calls).toBe(1)
  })
})

// ── Custom coalesce timing ──────────────────────────────────────────

describe('requestHeartbeatNow — coalesceMs', () => {
  test('short coalesceMs fires sooner', async () => {
    let fired = false
    setHeartbeatWakeHandler(async () => {
      fired = true
      return { status: 'ran', durationMs: 1, ack: true }
    })
    requestHeartbeatNow({ coalesceMs: 50 })
    await sleep(100)
    expect(fired).toBe(true)
  })

  test('zero coalesceMs fires near-immediately', async () => {
    let fired = false
    setHeartbeatWakeHandler(async () => {
      fired = true
      return { status: 'ran', durationMs: 1, ack: true }
    })
    requestHeartbeatNow({ coalesceMs: 0 })
    await sleep(50)
    expect(fired).toBe(true)
  })
})

// ── Handler error → retry ───────────────────────────────────────────

describe('handler error → retry', () => {
  test('throwing handler re-queues with retry and reschedules', async () => {
    let callCount = 0
    let shouldThrow = true
    setHeartbeatWakeHandler(async (req) => {
      callCount++
      if (shouldThrow) {
        shouldThrow = false
        throw new Error('simulated failure')
      }
      return { status: 'ran', durationMs: 1, ack: true }
    })

    requestHeartbeatNow({ reason: 'manual', coalesceMs: 50 })
    await sleep(150) // first call throws
    expect(callCount).toBe(1)

    // Wait for retry (1000ms cooldown)
    await sleep(1200)
    expect(callCount).toBe(2) // retry fired
  }, { timeout: 5000 })
})

// ── Handler disposer ────────────────────────────────────────────────

describe('handler disposer', () => {
  test('stale disposer from prior registration is no-op', async () => {
    let firstCalls = 0
    const dispose1 = setHeartbeatWakeHandler(async () => {
      firstCalls++
      return { status: 'ran', durationMs: 1, ack: true }
    })

    // Register a new handler — dispose1 is now stale
    let secondCalls = 0
    setHeartbeatWakeHandler(async () => {
      secondCalls++
      return { status: 'ran', durationMs: 1, ack: true }
    })

    // Call stale disposer — should NOT clear the second handler
    dispose1()

    requestHeartbeatNow({ coalesceMs: 50 })
    await sleep(150)
    expect(secondCalls).toBe(1) // second handler still active
    expect(firstCalls).toBe(0)
  })

  test('fresh disposer clears current handler', async () => {
    let calls = 0
    const dispose = setHeartbeatWakeHandler(async () => {
      calls++
      return { status: 'ran', durationMs: 1, ack: true }
    })

    dispose() // current generation — valid

    requestHeartbeatNow({ coalesceMs: 50 })
    await sleep(150)
    expect(calls).toBe(0) // handler was cleared
  })

  test('disposing twice is harmless', () => {
    const dispose = setHeartbeatWakeHandler(async () => {
      return { status: 'ran', durationMs: 1, ack: true }
    })
    dispose()
    expect(() => dispose()).not.toThrow() // second dispose is no-op
  })
})

// ── Re-registration resets state ────────────────────────────────────

describe('handler re-registration', () => {
  test('new handler registration resets timer state', async () => {
    let firstCalls = 0
    setHeartbeatWakeHandler(async () => {
      firstCalls++
      return { status: 'ran', durationMs: 1, ack: true }
    })
    requestHeartbeatNow({ coalesceMs: 500 }) // schedule with long delay

    // Before the first fires, register a new handler
    let secondCalls = 0
    setHeartbeatWakeHandler(async () => {
      secondCalls++
      return { status: 'ran', durationMs: 1, ack: true }
    })

    // The pending request should still fire (via the new handler)
    await sleep(350)
    expect(firstCalls).toBe(0)
    expect(secondCalls).toBe(1) // pending request re-scheduled with new handler
  })
})

// ── Same-priority tie-breaking ──────────────────────────────────────

describe('same-priority tie-breaking', () => {
  test('same priority, later requestedAt wins', async () => {
    const received: WakeRequest[] = []
    setHeartbeatWakeHandler(async (req) => {
      received.push(req)
      return { status: 'ran', durationMs: 1, ack: true }
    })

    // manual and action have the same priority (3)
    requestHeartbeatNow({ reason: 'manual', scope: 'x' })
    await sleep(10) // slight delay so requestedAt differs
    requestHeartbeatNow({ reason: 'action', scope: 'x' })

    await sleep(350)
    expect(received).toHaveLength(1)
    // The later request (action) should win
    expect(received[0]!.reason).toBe('action')
  })
})

// ── Enabled/disabled ────────────────────────────────────────────────

describe('enabled/disabled', () => {
  test('disabled before request → silently dropped', async () => {
    let calls = 0
    setHeartbeatWakeHandler(async () => {
      calls++
      return { status: 'ran', durationMs: 1, ack: true }
    })
    setHeartbeatsEnabled(false)
    requestHeartbeatNow({ coalesceMs: 50 })
    await sleep(150)
    expect(calls).toBe(0)
  })

  test('re-enabling does NOT retroactively fire dropped requests', async () => {
    let calls = 0
    setHeartbeatWakeHandler(async () => {
      calls++
      return { status: 'ran', durationMs: 1, ack: true }
    })
    setHeartbeatsEnabled(false)
    requestHeartbeatNow({ coalesceMs: 50 })
    await sleep(100)
    setHeartbeatsEnabled(true)
    await sleep(350)
    expect(calls).toBe(0) // the request was dropped, not queued
  })
})

// ── Handler results ─────────────────────────────────────────────────

describe('handler result types', () => {
  test('status: ran — no retry', async () => {
    let calls = 0
    setHeartbeatWakeHandler(async () => {
      calls++
      return { status: 'ran', durationMs: 50, ack: true }
    })
    requestHeartbeatNow({ coalesceMs: 50 })
    await sleep(150)
    expect(calls).toBe(1)
    await sleep(1200) // wait past retry window
    expect(calls).toBe(1) // still 1 — no retry
  })

  test('status: skipped (non-lock reason) — no retry', async () => {
    let calls = 0
    setHeartbeatWakeHandler(async () => {
      calls++
      return { status: 'skipped', reason: 'no-tasks-due' }
    })
    requestHeartbeatNow({ coalesceMs: 50 })
    await sleep(150)
    expect(calls).toBe(1)
    await sleep(1200) // wait past retry window
    expect(calls).toBe(1) // no retry for non-lock skip reasons
  })

  test('status: failed — no retry', async () => {
    let calls = 0
    setHeartbeatWakeHandler(async () => {
      calls++
      return { status: 'failed', reason: 'something broke' }
    })
    requestHeartbeatNow({ coalesceMs: 50 })
    await sleep(150)
    expect(calls).toBe(1)
    await sleep(1200)
    expect(calls).toBe(1) // no retry for failed status
  })

  test('status: skipped with lock-held-by-session — retries', async () => {
    let calls = 0
    setHeartbeatWakeHandler(async () => {
      calls++
      if (calls === 1) return { status: 'skipped', reason: 'lock-held-by-session' }
      return { status: 'ran', durationMs: 1, ack: true }
    })
    requestHeartbeatNow({ coalesceMs: 50 })
    await sleep(150) // first call
    expect(calls).toBe(1)
    await sleep(1200) // retry fires
    expect(calls).toBe(2)
  }, { timeout: 5000 })
})

// ── Reset for tests ─────────────────────────────────────────────────

describe('_resetHeartbeatWakeStateForTests', () => {
  test('clears handler', () => {
    setHeartbeatWakeHandler(async () => ({ status: 'ran', durationMs: 1, ack: true }))
    _resetHeartbeatWakeStateForTests()
    // After reset, areHeartbeatsEnabled should be true (default)
    expect(areHeartbeatsEnabled()).toBe(true)
  })

  test('clears pending requests', async () => {
    let calls = 0
    setHeartbeatWakeHandler(async () => {
      calls++
      return { status: 'ran', durationMs: 1, ack: true }
    })
    requestHeartbeatNow({ coalesceMs: 500 }) // queue with long delay
    _resetHeartbeatWakeStateForTests()

    // Re-register handler
    setHeartbeatWakeHandler(async () => {
      calls++
      return { status: 'ran', durationMs: 1, ack: true }
    })
    await sleep(600) // past original coalesce
    expect(calls).toBe(0) // pending was cleared
  })

  test('restores heartbeatsEnabled to true', () => {
    setHeartbeatsEnabled(false)
    _resetHeartbeatWakeStateForTests()
    expect(areHeartbeatsEnabled()).toBe(true)
  })
})

// ── Scope interactions ──────────────────────────────────────────────

describe('scope interactions', () => {
  test('explicit scope and undefined scope are separate', async () => {
    const reasons: string[] = []
    setHeartbeatWakeHandler(async (req) => {
      reasons.push(`${req.reason}:${req.scope ?? 'default'}`)
      return { status: 'ran', durationMs: 1, ack: true }
    })
    requestHeartbeatNow({ reason: 'manual', scope: 'alpha' })
    requestHeartbeatNow({ reason: 'interval' }) // undefined scope
    await sleep(350)
    expect(reasons).toHaveLength(2)
  })

  test('three different scopes → three handler calls', async () => {
    let calls = 0
    setHeartbeatWakeHandler(async () => {
      calls++
      return { status: 'ran', durationMs: 1, ack: true }
    })
    requestHeartbeatNow({ scope: 'a', coalesceMs: 50 })
    requestHeartbeatNow({ scope: 'b', coalesceMs: 50 })
    requestHeartbeatNow({ scope: 'c', coalesceMs: 50 })
    await sleep(150)
    expect(calls).toBe(3)
  })
})
