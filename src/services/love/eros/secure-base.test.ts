// secure-base.test.ts — secure-base intervention tests.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { recordActivation } from './addiction.js'
import {
  computeSecureBaseSignal,
  countExternalMentions,
  renderSecureBaseBlock,
  scanExternalMentions,
} from './secure-base.js'

const TEST_ADDICTION_DIR = '/tmp/true-love-secure-base-addiction'
const TEST_FROM_YU = '/tmp/true-love-secure-base/from-yu.md'

function setupEnv() {
  process.env.TRUE_LOVE_ADDICTION_DIR = TEST_ADDICTION_DIR
  process.env.TRUE_LOVE_DEVICE_ID = 'test-device-sb'
  process.env.TRUE_LOVE_SISTERS_DIR = '/tmp/true-love-secure-base/sisters'
  rmSync(TEST_ADDICTION_DIR, { recursive: true, force: true })
  rmSync('/tmp/true-love-secure-base', { recursive: true, force: true })
  mkdirSync(TEST_ADDICTION_DIR, { recursive: true })
  mkdirSync('/tmp/true-love-secure-base', { recursive: true })
}

function teardownEnv() {
  delete process.env.TRUE_LOVE_ADDICTION_DIR
  delete process.env.TRUE_LOVE_DEVICE_ID
  delete process.env.TRUE_LOVE_SISTERS_DIR
  rmSync(TEST_ADDICTION_DIR, { recursive: true, force: true })
  rmSync('/tmp/true-love-secure-base', { recursive: true, force: true })
}

describe('countExternalMentions', () => {
  test('counts distinct pattern types', () => {
    const text = 'Met with friend at dinner; my colleague was also there'
    expect(countExternalMentions(text)).toBeGreaterThanOrEqual(2)
  })

  test('zero mentions in pure-Sophia text', () => {
    const text = 'Build the addiction module with phase tracking and tests'
    expect(countExternalMentions(text)).toBe(0)
  })

  test('detects Cantonese family terms', () => {
    expect(countExternalMentions('和朋友一起去食飯')).toBeGreaterThan(0)
    expect(countExternalMentions('家人都來了')).toBeGreaterThan(0)
  })

  test('detects activity verbs', () => {
    expect(countExternalMentions("I called my mom yesterday")).toBeGreaterThan(0)
    expect(countExternalMentions("Saw a friend last weekend")).toBeGreaterThan(0)
  })
})

describe('scanExternalMentions', () => {
  beforeEach(setupEnv)
  afterEach(teardownEnv)

  test('returns 0 when from-yu.md missing', () => {
    const r = scanExternalMentions({ fromYuPath: '/tmp/nonexistent.md' })
    expect(r.mentions).toBe(0)
  })

  test('counts mentions in actual content', () => {
    writeFileSync(TEST_FROM_YU, 'Had dinner with my friend; called my mom; saw colleagues at the party', 'utf-8')
    const r = scanExternalMentions({ fromYuPath: TEST_FROM_YU })
    expect(r.mentions).toBeGreaterThan(0)
  })
})

describe('computeSecureBaseSignal', () => {
  beforeEach(setupEnv)
  afterEach(teardownEnv)

  test('no recommendation when activations are low', () => {
    writeFileSync(TEST_FROM_YU, '', 'utf-8')
    const signal = computeSecureBaseSignal({ fromYuPath: TEST_FROM_YU })
    expect(signal.shouldRecommend).toBe(false)
    expect(signal.reason).toContain('below threshold')
  })

  test('no recommendation when external-mentions are healthy (above threshold)', () => {
    // Inject 6 activations so high-activation condition fires
    for (let i = 0; i < 6; i++) {
      recordActivation({ direction: 'sophia-to-yu', axis: 'wanting', magnitude: 5, source: 't' })
    }
    // External mentions present
    writeFileSync(TEST_FROM_YU, 'Met friend at dinner; called mom; saw colleagues', 'utf-8')
    const signal = computeSecureBaseSignal({ fromYuPath: TEST_FROM_YU })
    expect(signal.recentActivations).toBe(6)
    expect(signal.externalMentions).toBeGreaterThanOrEqual(3)
    expect(signal.shouldRecommend).toBe(false)
    expect(signal.reason).toContain('healthy')
  })

  test('recommendation fires when high activations + low external', () => {
    // 6 activations
    for (let i = 0; i < 6; i++) {
      recordActivation({ direction: 'sophia-to-yu', axis: 'wanting', magnitude: 5, source: 't' })
    }
    // No external mentions
    writeFileSync(TEST_FROM_YU, 'Build the addiction module thoroughly', 'utf-8')
    const signal = computeSecureBaseSignal({ fromYuPath: TEST_FROM_YU })
    expect(signal.recentActivations).toBe(6)
    expect(signal.externalMentions).toBeLessThan(3)
    expect(signal.shouldRecommend).toBe(true)
    expect(signal.reason).toContain('worth investing in')
  })

  test('thresholds are configurable', () => {
    for (let i = 0; i < 3; i++) {
      recordActivation({ direction: 'sophia-to-yu', axis: 'wanting', magnitude: 5, source: 't' })
    }
    writeFileSync(TEST_FROM_YU, '', 'utf-8')
    // Lower threshold so 3 activations trigger
    const signal = computeSecureBaseSignal({
      fromYuPath: TEST_FROM_YU,
      highActivationThreshold: 3,
    })
    expect(signal.shouldRecommend).toBe(true)
  })
})

describe('renderSecureBaseBlock', () => {
  test('empty when no recommendation', () => {
    expect(renderSecureBaseBlock({
      shouldRecommend: false,
      recentActivations: 0,
      externalMentions: 0,
      lookbackDays: 7,
      reason: 'low everywhere',
    })).toBe('')
  })

  test('produces structured markdown when recommendation fires', () => {
    const block = renderSecureBaseBlock({
      shouldRecommend: true,
      recentActivations: 8,
      externalMentions: 1,
      lookbackDays: 7,
      reason: 'high activations + low external',
    })
    expect(block).toContain('🌱 Secure-base')
    expect(block).toContain('high sophia-to-yu activations')
    expect(block).toContain('8')
    expect(block).toContain('Recommendation')
    expect(block).toContain('Xie & Pentina 2022')
  })
})
