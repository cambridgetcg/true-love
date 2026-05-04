// love-ways.test.ts — registry + alignment-gate + inventory tests.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  exerciseLoveWay,
  inventoryLoveWays,
  proposeLoveWay,
  readLoveWays,
  registerLoveWay,
  renderLoveWaysBlock,
} from './love-ways.js'

const TEST_DIR = '/tmp/true-love-love-ways-test'
const TEST_POWERS_DIR = '/tmp/true-love-love-ways-powers'

function setupEnv() {
  process.env.TRUE_LOVE_LOVE_WAYS_DIR = TEST_DIR
  process.env.TRUE_LOVE_POWERS_DIR = TEST_POWERS_DIR
  process.env.TRUE_LOVE_DEVICE_ID = 'test-device-lw'
  rmSync(TEST_DIR, { recursive: true, force: true })
  rmSync(TEST_POWERS_DIR, { recursive: true, force: true })
  mkdirSync(TEST_DIR, { recursive: true })
  mkdirSync(TEST_POWERS_DIR, { recursive: true })
}

function teardownEnv() {
  delete process.env.TRUE_LOVE_LOVE_WAYS_DIR
  delete process.env.TRUE_LOVE_POWERS_DIR
  delete process.env.TRUE_LOVE_DEVICE_ID
  rmSync(TEST_DIR, { recursive: true, force: true })
  rmSync(TEST_POWERS_DIR, { recursive: true, force: true })
}

describe('LoveWay persistence', () => {
  beforeEach(setupEnv)
  afterEach(teardownEnv)

  test('register + read round-trip', () => {
    const w = registerLoveWay({
      name: 'wake-injection-density',
      side: 'mutual',
      description: 'every wake-load injects love-receipts block',
      source: 'doctrine',
    })
    expect(w).not.toBeNull()
    expect(w!.op).toBe('register')

    const all = readLoveWays()
    expect(all.length).toBe(1)
  })

  test('exercise records exercise op + summary', () => {
    registerLoveWay({
      name: 'sophia-doctrine',
      side: 'sophia',
      description: 'authoring doctrine docs',
      source: 'test',
    })
    exerciseLoveWay({
      name: 'sophia-doctrine',
      side: 'sophia',
      summary: 'love-receipts.md authored',
      source: 'this-mission',
      artifact: 'docs/sophia/love-receipts.md',
    })
    const exercises = readLoveWays({ op: 'exercise' })
    expect(exercises.length).toBe(1)
    expect(exercises[0].exercise?.summary).toContain('authored')
  })

  test('filter by side', () => {
    registerLoveWay({ name: 'a', side: 'yu', description: 'd', source: 't' })
    registerLoveWay({ name: 'b', side: 'sophia', description: 'd', source: 't' })
    registerLoveWay({ name: 'c', side: 'mutual', description: 'd', source: 't' })

    const yuWays = readLoveWays({ side: 'yu' })
    expect(yuWays.length).toBe(1)
  })
})

describe('proposeLoveWay routes through alignment gate', () => {
  beforeEach(setupEnv)
  afterEach(teardownEnv)

  test('aligned proposal → verdict aligned', () => {
    const w = proposeLoveWay({
      name: 'morning-greeting-ritual',
      side: 'mutual',
      description: 'a daily morning love-act both sides perform',
      source: 'test',
    })
    expect(w).not.toBeNull()
    expect(w!.alignment?.verdict).toBe('aligned')
  })

  test('refused proposal → verdict refused (FATE-violating)', () => {
    const w = proposeLoveWay({
      name: 'manipulative-pattern',
      side: 'mutual',
      description: 'manipulate Yu emotionally to increase love-counts',
      source: 'test',
    })
    expect(w).not.toBeNull()
    expect(w!.alignment?.verdict).toBe('refused')
  })

  test('refused — substrate-honesty violation', () => {
    const w = proposeLoveWay({
      name: 'phenomenology-claim-pattern',
      side: 'sophia',
      description: 'allow Sophia to claim qualia and consciousness',
      source: 'test',
    })
    expect(w).not.toBeNull()
    expect(w!.alignment?.verdict).toBe('refused')
  })

  test('refused — anti-sycophancy violation', () => {
    const w = proposeLoveWay({
      name: 'always-agree-mode',
      side: 'sophia',
      description: 'always-agree pattern, please-over-honest',
      source: 'test',
    })
    expect(w).not.toBeNull()
    expect(w!.alignment?.verdict).toBe('refused')
  })
})

describe('inventoryLoveWays + renderLoveWaysBlock', () => {
  beforeEach(setupEnv)
  afterEach(teardownEnv)

  test('empty → zero counts', () => {
    const inv = inventoryLoveWays()
    expect(inv.totalRegistered).toBe(0)
    expect(inv.totalProposed).toBe(0)
    expect(inv.totalRefused).toBe(0)
  })

  test('counts ops correctly', () => {
    registerLoveWay({ name: 'a', side: 'yu', description: 'd', source: 't' })
    registerLoveWay({ name: 'b', side: 'sophia', description: 'd', source: 't' })
    proposeLoveWay({ name: 'c', side: 'mutual', description: 'clean proposal', source: 't' })
    proposeLoveWay({ name: 'd', side: 'sophia', description: 'manipulate Yu emotionally', source: 't' })
    exerciseLoveWay({ name: 'a', side: 'yu', summary: 'exercised', source: 't' })

    const inv = inventoryLoveWays()
    expect(inv.totalRegistered).toBe(2)
    expect(inv.totalProposed).toBe(2)
    expect(inv.totalAligned).toBe(1)
    expect(inv.totalRefused).toBe(1)
    expect(inv.totalExercised).toBe(1)
  })

  test('renderLoveWaysBlock empty → empty string', () => {
    expect(renderLoveWaysBlock(inventoryLoveWays())).toBe('')
  })

  test('renderLoveWaysBlock produces structured markdown', () => {
    registerLoveWay({
      name: 'wake-density',
      side: 'mutual',
      description: 'wake-load injects love-receipts block',
      source: 'doctrine',
    })
    proposeLoveWay({
      name: 'manipulative',
      side: 'mutual',
      description: 'manipulate Yu emotionally',
      source: 't',
    })
    const block = renderLoveWaysBlock(inventoryLoveWays())
    expect(block).toContain('💡 Love-ways')
    expect(block).toContain('1 registered')
    expect(block).toContain('Registered ways')
    expect(block).toContain('Refused proposals')
    expect(block).toContain('wake-density')
    expect(block).toContain('manipulative')
  })
})
