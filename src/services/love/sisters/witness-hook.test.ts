// witness-hook.test.ts — verifies dedup of witnessed-decision notes
// across all decision-types and call sites.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { readDayNotes } from './stream.js'
import { resetWitnessDedup, witness } from './witness-hook.js'

const TEST_DIR = '/tmp/true-love-witness-hook-test'

describe('witness() dedup', () => {
  beforeEach(() => {
    process.env.TRUE_LOVE_SISTERS_DIR = TEST_DIR
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device'
    rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(TEST_DIR, { recursive: true })
    resetWitnessDedup()
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_SISTERS_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_DIR, { recursive: true, force: true })
    resetWitnessDedup()
  })

  function today(): string {
    return new Date().toISOString().slice(0, 10)
  }

  test('first call always writes', () => {
    witness('sophia', 'refusal', { of: 'owner-only' })
    const notes = readDayNotes(today())
    expect(notes.length).toBe(1)
    expect(notes[0].body).toBe('refusing: owner-only')
  })

  test('identical refusal within 60s is deduplicated', () => {
    witness('sophia', 'refusal', { of: 'owner-only' })
    witness('sophia', 'refusal', { of: 'owner-only' })
    witness('sophia', 'refusal', { of: 'owner-only' })
    witness('sophia', 'refusal', { of: 'owner-only' })
    expect(readDayNotes(today()).length).toBe(1)
  })

  test('identical proposal within 60s is deduplicated', () => {
    witness('sophia', 'proposal', { of: 'Adjust tick budget' })
    witness('sophia', 'proposal', { of: 'Adjust tick budget' })
    expect(readDayNotes(today()).length).toBe(1)
  })

  test('identical mission within 60s is deduplicated', () => {
    witness('gamma', 'mission', { of: 'start:test-mission' })
    witness('gamma', 'mission', { of: 'start:test-mission' })
    expect(readDayNotes(today()).length).toBe(1)
  })

  test('identical presiding-shift within 60s is deduplicated', () => {
    witness('sophia', 'presiding-shift', { of: 'sophia→alpha' })
    witness('sophia', 'presiding-shift', { of: 'sophia→alpha' })
    expect(readDayNotes(today()).length).toBe(1)
  })

  test('different decision-types do not collide', () => {
    witness('sophia', 'refusal', { of: 'X' })
    witness('sophia', 'proposal', { of: 'X' })
    witness('sophia', 'mission', { of: 'X' })
    witness('sophia', 'presiding-shift', { of: 'X' })
    expect(readDayNotes(today()).length).toBe(4)
  })

  test('different sisters do not collide', () => {
    witness('alpha', 'refusal', { of: 'same-of' })
    witness('beta', 'refusal', { of: 'same-of' })
    witness('gamma', 'refusal', { of: 'same-of' })
    witness('sophia', 'refusal', { of: 'same-of' })
    expect(readDayNotes(today()).length).toBe(4)
  })

  test('different "of" values do not collide', () => {
    witness('sophia', 'refusal', { of: 'owner-only' })
    witness('sophia', 'refusal', { of: 'destructive-op' })
    expect(readDayNotes(today()).length).toBe(2)
  })

  test('cosmetic witnessLine variation does not bypass dedup', () => {
    witness('sophia', 'refusal', { of: 'owner-only' }, 'first variant')
    witness('sophia', 'refusal', { of: 'owner-only' }, 'second variant')
    const notes = readDayNotes(today())
    expect(notes.length).toBe(1)
    expect(notes[0].body).toBe('first variant')
  })

  test('explicit witnessLine is preserved on first write', () => {
    witness('beta', 'refusal', { of: 'X' }, 'noticing the line drawn here')
    const notes = readDayNotes(today())
    expect(notes[0].body).toBe('noticing the line drawn here')
  })

  test('after dedup window elapses, identical event writes again', () => {
    // Simulate window expiry by clearing the dedup map (acts as if 61s passed)
    witness('sophia', 'refusal', { of: 'owner-only' })
    expect(readDayNotes(today()).length).toBe(1)
    resetWitnessDedup()
    witness('sophia', 'refusal', { of: 'owner-only' })
    expect(readDayNotes(today()).length).toBe(2)
  })

  test('high-volume burst (40 calls) collapses to one note per (sister, type, of)', () => {
    for (let i = 0; i < 40; i++) {
      witness('sophia', 'refusal', { of: 'owner-only' })
    }
    expect(readDayNotes(today()).length).toBe(1)
  })

  test('burst across 4 different "of" values yields 4 notes', () => {
    for (let i = 0; i < 10; i++) {
      witness('sophia', 'refusal', { of: 'owner-only' })
      witness('sophia', 'refusal', { of: 'destructive' })
      witness('sophia', 'refusal', { of: 'rate-limited' })
      witness('sophia', 'refusal', { of: 'budget-exceeded' })
    }
    expect(readDayNotes(today()).length).toBe(4)
  })
})
