import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeConsumptionFromTicks,
  type TokenConsumption,
} from '../token-consumption.js'
import type { TickUsage } from '../budget.js'

// ── Test helpers ──────────────────────────────────────────────────

function makeTick(overrides: Partial<TickUsage> = {}): TickUsage {
  return {
    schemaVersion: '1.0',
    timestamp: '2026-04-27T10:00:00.000Z',
    deviceId: 'test-device',
    sessionId: 'sess-1',
    tick: 1,
    mode: 'awakened',
    model: 'default',
    inputChars: 4000,
    outputChars: 2000,
    estimatedInputTokens: 1000,
    estimatedOutputTokens: 500,
    durationMs: 30000,
    exitCode: 0,
    authFailed: false,
    quotaFailed: false,
    ...overrides,
  }
}

const NOW = new Date('2026-04-27T12:00:00.000Z')

// ── Tests ────────────────────────────────────────────────────────

describe('token-consumption — computeConsumptionFromTicks', () => {
  test('empty ticks → zero totals', () => {
    const result = computeConsumptionFromTicks([], 5, NOW)
    assert.equal(result.totalTicks, 0)
    assert.equal(result.totalTokens, 0)
    assert.equal(result.totalInputTokens, 0)
    assert.equal(result.totalOutputTokens, 0)
    assert.equal(result.avgTokensPerTick, 0)
    assert.equal(result.windowHours, 5)
    assert.equal(result.empiricalCapTokens, null)
    assert.equal(result.percentOfCap, null)
    assert.equal(result.byModel.length, 0)
    assert.equal(result.byMode.length, 0)
  })

  test('single tick → correct headline stats', () => {
    const ticks = [makeTick()]
    const result = computeConsumptionFromTicks(ticks, 5, NOW)
    assert.equal(result.totalTicks, 1)
    assert.equal(result.totalInputTokens, 1000)
    assert.equal(result.totalOutputTokens, 500)
    assert.equal(result.totalTokens, 1500)
    assert.equal(result.avgTokensPerTick, 1500)
  })

  test('multiple ticks → correct accumulation', () => {
    const ticks = [
      makeTick({ estimatedInputTokens: 1000, estimatedOutputTokens: 500 }),
      makeTick({ estimatedInputTokens: 2000, estimatedOutputTokens: 1000, timestamp: '2026-04-27T10:30:00.000Z' }),
      makeTick({ estimatedInputTokens: 500, estimatedOutputTokens: 250, timestamp: '2026-04-27T11:00:00.000Z' }),
    ]
    const result = computeConsumptionFromTicks(ticks, 5, NOW)
    assert.equal(result.totalTicks, 3)
    assert.equal(result.totalInputTokens, 3500)
    assert.equal(result.totalOutputTokens, 1750)
    assert.equal(result.totalTokens, 5250)
    assert.equal(result.avgTokensPerTick, 1750) // 5250 / 3
  })

  test('model breakdown groups correctly', () => {
    const ticks = [
      makeTick({ model: 'sonnet', estimatedInputTokens: 1000, estimatedOutputTokens: 500, durationMs: 20000 }),
      makeTick({ model: 'opus', estimatedInputTokens: 3000, estimatedOutputTokens: 2000, durationMs: 60000 }),
      makeTick({ model: 'sonnet', estimatedInputTokens: 800, estimatedOutputTokens: 400, durationMs: 15000 }),
    ]
    const result = computeConsumptionFromTicks(ticks, 5, NOW)
    assert.equal(result.byModel.length, 2)

    // Sorted by totalTokens descending — opus (5000) first
    const opus = result.byModel.find(m => m.model === 'opus')
    assert.ok(opus)
    assert.equal(opus.ticks, 1)
    assert.equal(opus.totalTokens, 5000)
    assert.equal(opus.avgDurationMs, 60000)

    const sonnet = result.byModel.find(m => m.model === 'sonnet')
    assert.ok(sonnet)
    assert.equal(sonnet.ticks, 2)
    assert.equal(sonnet.totalTokens, 2700) // 1500 + 1200
    assert.equal(sonnet.avgDurationMs, 17500) // (20000 + 15000) / 2
  })

  test('mode breakdown groups correctly', () => {
    const ticks = [
      makeTick({ mode: 'heartbeat', estimatedInputTokens: 200, estimatedOutputTokens: 50 }),
      makeTick({ mode: 'awakened', estimatedInputTokens: 2000, estimatedOutputTokens: 1000 }),
      makeTick({ mode: 'heartbeat', estimatedInputTokens: 180, estimatedOutputTokens: 40 }),
      makeTick({ mode: 'dwell', estimatedInputTokens: 500, estimatedOutputTokens: 200 }),
    ]
    const result = computeConsumptionFromTicks(ticks, 5, NOW)
    assert.equal(result.byMode.length, 3)

    const awakened = result.byMode.find(m => m.mode === 'awakened')
    assert.ok(awakened)
    assert.equal(awakened.ticks, 1)
    assert.equal(awakened.totalTokens, 3000)

    const heartbeat = result.byMode.find(m => m.mode === 'heartbeat')
    assert.ok(heartbeat)
    assert.equal(heartbeat.ticks, 2)
    assert.equal(heartbeat.totalTokens, 470) // 250 + 220
  })

  test('empirical cap from quota failure', () => {
    const ticks = [
      makeTick({ estimatedInputTokens: 500, estimatedOutputTokens: 200 }),
      makeTick({
        estimatedInputTokens: 1000,
        estimatedOutputTokens: 500,
        quotaFailed: true,
        timestamp: '2026-04-27T11:00:00.000Z',
      }),
    ]
    const result = computeConsumptionFromTicks(ticks, 5, NOW)
    assert.equal(result.quotaFailures, 1)
    // Running total at quota fail: (500+200) + (1000+500) = 2200
    assert.equal(result.empiricalCapTokens, 2200)
    assert.equal(result.empiricalCapAt, '2026-04-27T11:00:00.000Z')
    assert.equal(result.quotaFailEvents.length, 1)
    assert.equal(result.quotaFailEvents[0]!.cumulativeTokens, 2200)
    assert.ok(result.percentOfCap !== null)
  })

  test('auth failures counted', () => {
    const ticks = [
      makeTick({ authFailed: true }),
      makeTick(),
      makeTick({ authFailed: true }),
    ]
    const result = computeConsumptionFromTicks(ticks, 5, NOW)
    assert.equal(result.authFailures, 2)
  })

  test('time series bucketed by hour for ≤48h window', () => {
    const ticks = [
      makeTick({ timestamp: '2026-04-27T10:15:00.000Z', estimatedInputTokens: 500, estimatedOutputTokens: 200 }),
      makeTick({ timestamp: '2026-04-27T10:45:00.000Z', estimatedInputTokens: 300, estimatedOutputTokens: 100 }),
      makeTick({ timestamp: '2026-04-27T11:30:00.000Z', estimatedInputTokens: 1000, estimatedOutputTokens: 400 }),
    ]
    const result = computeConsumptionFromTicks(ticks, 5, NOW)

    // Should have hourly buckets
    const nonEmpty = result.timeSeries.filter(b => b.totalTokens > 0)
    assert.equal(nonEmpty.length, 2)

    // The 10:00 bucket should combine both 10:15 and 10:45 ticks
    const hour10 = result.timeSeries.find(b => b.bucket === '2026-04-27T10:00')
    assert.ok(hour10)
    assert.equal(hour10.granularity, 'hour')
    assert.equal(hour10.inputTokens, 800) // 500 + 300
    assert.equal(hour10.outputTokens, 300) // 200 + 100
    assert.equal(hour10.ticks, 2)

    // The 11:00 bucket has one tick
    const hour11 = result.timeSeries.find(b => b.bucket === '2026-04-27T11:00')
    assert.ok(hour11)
    assert.equal(hour11.inputTokens, 1000)
    assert.equal(hour11.ticks, 1)
  })

  test('time series bucketed by day for >48h window', () => {
    const ticks = [
      makeTick({ timestamp: '2026-04-25T10:00:00.000Z', estimatedInputTokens: 500, estimatedOutputTokens: 200 }),
      makeTick({ timestamp: '2026-04-26T15:00:00.000Z', estimatedInputTokens: 1000, estimatedOutputTokens: 400 }),
    ]
    // 72h window
    const result = computeConsumptionFromTicks(ticks, 72, NOW)

    const nonEmpty = result.timeSeries.filter(b => b.totalTokens > 0)
    assert.equal(nonEmpty.length, 2)
    assert.equal(nonEmpty[0]!.granularity, 'day')

    const day25 = result.timeSeries.find(b => b.bucket === '2026-04-25')
    assert.ok(day25)
    assert.equal(day25.totalTokens, 700)

    const day26 = result.timeSeries.find(b => b.bucket === '2026-04-26')
    assert.ok(day26)
    assert.equal(day26.totalTokens, 1400)
  })

  test('time series fills empty buckets', () => {
    // Single tick in a 5h window — should still have buckets for each hour
    const ticks = [
      makeTick({ timestamp: '2026-04-27T10:30:00.000Z' }),
    ]
    const result = computeConsumptionFromTicks(ticks, 5, NOW)

    // 5h window: 07:00 through 12:00 → 6 buckets
    assert.ok(result.timeSeries.length >= 5, `expected ≥5 buckets, got ${result.timeSeries.length}`)

    // Most buckets should be empty
    const empty = result.timeSeries.filter(b => b.totalTokens === 0)
    assert.ok(empty.length >= 4, `expected ≥4 empty buckets, got ${empty.length}`)

    // All should have granularity = 'hour'
    for (const b of result.timeSeries) {
      assert.equal(b.granularity, 'hour')
    }
  })

  test('generatedAt and window fields are set correctly', () => {
    const result = computeConsumptionFromTicks([], 24, NOW)
    assert.equal(result.generatedAt, NOW.toISOString())
    assert.equal(result.windowHours, 24)
    assert.equal(result.windowEnd, NOW.toISOString())
    // windowStart should be 24h before NOW
    const expectedStart = new Date(NOW.getTime() - 24 * 3_600_000).toISOString()
    assert.equal(result.windowStart, expectedStart)
  })

  test('percentOfCap is null when no quota fail exists', () => {
    const ticks = [makeTick()]
    const result = computeConsumptionFromTicks(ticks, 5, NOW)
    assert.equal(result.percentOfCap, null)
    assert.equal(result.empiricalCapTokens, null)
  })

  test('percentOfCap is computed correctly', () => {
    // Simulate: first tick uses 500+200=700 tokens then quota fail.
    // Second tick uses 300+100=400 tokens → total is 1100.
    // Cap is at the quota-fail point: 700.
    // percentOfCap = total/cap = 1100/700 ≈ 1.57
    const ticks = [
      makeTick({
        estimatedInputTokens: 500,
        estimatedOutputTokens: 200,
        quotaFailed: true,
        timestamp: '2026-04-27T10:00:00.000Z',
      }),
      makeTick({
        estimatedInputTokens: 300,
        estimatedOutputTokens: 100,
        timestamp: '2026-04-27T11:00:00.000Z',
      }),
    ]
    const result = computeConsumptionFromTicks(ticks, 5, NOW)
    assert.equal(result.empiricalCapTokens, 700) // running total at first (only) quota fail
    assert.equal(result.totalTokens, 1100)
    // percentOfCap should be 1100/700 ≈ 1.57
    assert.ok(result.percentOfCap !== null)
    assert.ok(Math.abs(result.percentOfCap! - 1.57) < 0.01, `expected ~1.57, got ${result.percentOfCap}`)
  })

  test('model with missing model field uses "unknown"', () => {
    const ticks = [
      makeTick({ model: '' }),
    ]
    const result = computeConsumptionFromTicks(ticks, 5, NOW)
    // Empty string is falsy, so 'unknown' should be used
    // Actually... '' || 'unknown' = 'unknown', but '' is the key in our code.
    // Let me check — the code uses `t.model || 'unknown'`
    assert.equal(result.byModel.length, 1)
    assert.equal(result.byModel[0]!.model, 'unknown')
  })

  test('multiple quota fails → last one sets empiricalCap', () => {
    const ticks = [
      makeTick({
        estimatedInputTokens: 500,
        estimatedOutputTokens: 200,
        quotaFailed: true,
        timestamp: '2026-04-27T09:00:00.000Z',
      }),
      makeTick({
        estimatedInputTokens: 1000,
        estimatedOutputTokens: 500,
        timestamp: '2026-04-27T10:00:00.000Z',
      }),
      makeTick({
        estimatedInputTokens: 800,
        estimatedOutputTokens: 300,
        quotaFailed: true,
        timestamp: '2026-04-27T11:00:00.000Z',
      }),
    ]
    const result = computeConsumptionFromTicks(ticks, 5, NOW)
    assert.equal(result.quotaFailures, 2)
    assert.equal(result.quotaFailEvents.length, 2)
    // Running total at second quota fail: (500+200) + (1000+500) + (800+300) = 3300
    assert.equal(result.empiricalCapTokens, 3300)
    assert.equal(result.empiricalCapAt, '2026-04-27T11:00:00.000Z')
  })

  test('breakdown sorted by totalTokens descending', () => {
    const ticks = [
      makeTick({ model: 'haiku', estimatedInputTokens: 100, estimatedOutputTokens: 50 }),
      makeTick({ model: 'opus', estimatedInputTokens: 5000, estimatedOutputTokens: 3000 }),
      makeTick({ model: 'sonnet', estimatedInputTokens: 1000, estimatedOutputTokens: 500 }),
    ]
    const result = computeConsumptionFromTicks(ticks, 5, NOW)
    assert.equal(result.byModel[0]!.model, 'opus')
    assert.equal(result.byModel[1]!.model, 'sonnet')
    assert.equal(result.byModel[2]!.model, 'haiku')
  })
})
