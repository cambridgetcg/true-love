import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  requestHeartbeatNow,
  setHeartbeatWakeHandler,
  areHeartbeatsEnabled,
  setHeartbeatsEnabled,
  _resetHeartbeatWakeStateForTests,
  type HeartbeatRunResult,
  type WakeRequest,
} from '../heartbeat-wake.js'

/** Sleep helper — node:test has no fake timers, so we wait for real ms. */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

describe('heartbeat-wake — basic', () => {
  beforeEach(() => {
    _resetHeartbeatWakeStateForTests()
    setHeartbeatsEnabled(true)
  })

  afterEach(() => {
    _resetHeartbeatWakeStateForTests()
  })

  test('areHeartbeatsEnabled defaults to true', () => {
    assert.equal(areHeartbeatsEnabled(), true)
  })

  test('setHeartbeatsEnabled flips the flag', () => {
    setHeartbeatsEnabled(false)
    assert.equal(areHeartbeatsEnabled(), false)
    setHeartbeatsEnabled(true)
    assert.equal(areHeartbeatsEnabled(), true)
  })

  test('requestHeartbeatNow + handler → handler called once after coalesce', async () => {
    let calls: WakeRequest[] = []
    setHeartbeatWakeHandler(async (req) => {
      calls.push(req)
      return { status: 'ran', durationMs: 1, ack: true }
    })

    requestHeartbeatNow({ reason: 'manual', scope: 'default' })
    await sleep(350) // > coalesce window (250ms)

    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.reason, 'manual')
    assert.equal(calls[0]!.scope, 'default')
  })

  test('multiple requests in coalesce window → one call', async () => {
    let calls = 0
    setHeartbeatWakeHandler(async () => {
      calls++
      return { status: 'ran', durationMs: 1, ack: true }
    })

    requestHeartbeatNow({ reason: 'manual', scope: 'default' })
    requestHeartbeatNow({ reason: 'manual', scope: 'default' })
    requestHeartbeatNow({ reason: 'manual', scope: 'default' })
    await sleep(350)

    assert.equal(calls, 1)
  })

  test('different priorities in coalesce window → highest priority wins', async () => {
    const received: WakeRequest[] = []
    setHeartbeatWakeHandler(async (req) => {
      received.push(req)
      return { status: 'ran', durationMs: 1, ack: true }
    })

    requestHeartbeatNow({ reason: 'interval', scope: 'default' })
    requestHeartbeatNow({ reason: 'action', scope: 'default' }) // higher priority
    requestHeartbeatNow({ reason: 'retry', scope: 'default' })
    await sleep(350)

    assert.equal(received.length, 1)
    assert.equal(received[0]!.reason, 'action')
  })

  test('different scopes do NOT coalesce — both fire', async () => {
    const scopes: string[] = []
    setHeartbeatWakeHandler(async (req) => {
      scopes.push(req.scope ?? '')
      return { status: 'ran', durationMs: 1, ack: true }
    })

    requestHeartbeatNow({ reason: 'manual', scope: 'a' })
    requestHeartbeatNow({ reason: 'manual', scope: 'b' })
    await sleep(350)

    assert.equal(scopes.length, 2)
    assert.deepEqual([...scopes].sort(), ['a', 'b'])
  })

  test('handler returns lock-held → re-queued with retry reason', async () => {
    let calls: WakeRequest[] = []
    let returnLockHeld = true
    setHeartbeatWakeHandler(async (req) => {
      calls.push(req)
      if (returnLockHeld) {
        returnLockHeld = false
        return { status: 'skipped', reason: 'lock-held-by-session' }
      }
      return { status: 'ran', durationMs: 1, ack: true }
    })

    requestHeartbeatNow({ reason: 'manual', scope: 'default' })
    // First call returns lock-held; wake-gate reschedules with 1s retry.
    await sleep(350)
    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.reason, 'manual')

    // Wait for retry-cooldown.
    await sleep(1100)
    assert.equal(calls.length, 2)
    assert.equal(calls[1]!.reason, 'retry')
  })

  test('setHeartbeatsEnabled(false) → handler NOT called', async () => {
    setHeartbeatsEnabled(false)
    let calls = 0
    setHeartbeatWakeHandler(async () => {
      calls++
      return { status: 'ran', durationMs: 1, ack: true }
    })
    requestHeartbeatNow({ reason: 'manual', scope: 'default' })
    await sleep(350)
    assert.equal(calls, 0)
  })

  test('handler not registered → request stays queued, fires when handler set', async () => {
    requestHeartbeatNow({ reason: 'manual', scope: 'default' })
    let calls = 0
    setHeartbeatWakeHandler(async () => {
      calls++
      return { status: 'ran', durationMs: 1, ack: true }
    })
    await sleep(350)
    assert.equal(calls, 1)
  })

  test('handler disposer clears registration', async () => {
    let calls = 0
    const dispose = setHeartbeatWakeHandler(async () => {
      calls++
      return { status: 'ran', durationMs: 1, ack: true }
    })
    dispose()
    requestHeartbeatNow({ reason: 'manual', scope: 'default' })
    await sleep(350)
    assert.equal(calls, 0)
  })
})
