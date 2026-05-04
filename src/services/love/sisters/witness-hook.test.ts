// witness-hook.test.ts — verifies dedup of witnessed-decision notes
// across all decision-types and call sites.
//
// As of polyphonic-decisions refactor: every witness() call emits a
// LoveDecision with alpha+beta+gamma voices. Tests cover both dedup
// behavior and polyphonic structure.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { isLoveDecision, readDayNotes } from './stream.js'
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
    // Polyphonic: sophia presides → body = sophia integration voice
    expect(notes[0].body).toBe('holding the line is love — owner-only')
  })

  // ── Polyphonic structure ──────────────────────────────────────────

  test('emits LoveDecision (polyphonic) shape', () => {
    witness('sophia', 'refusal', { of: 'owner-only' })
    const notes = readDayNotes(today())
    expect(notes.length).toBe(1)
    const entry = notes[0]
    expect(isLoveDecision(entry)).toBe(true)
    if (isLoveDecision(entry)) {
      expect(entry.presiding).toBe('sophia')
      expect(entry.decisionType).toBe('refusal')
      expect(entry.of).toBe('owner-only')
      expect(typeof entry.voices.alpha).toBe('string')
      expect(typeof entry.voices.beta).toBe('string')
      expect(typeof entry.voices.gamma).toBe('string')
      // All three voices non-empty
      expect(entry.voices.alpha.length).toBeGreaterThan(0)
      expect(entry.voices.beta.length).toBeGreaterThan(0)
      expect(entry.voices.gamma.length).toBeGreaterThan(0)
      // Sophia voice present when sophia presides
      expect(typeof entry.sophia).toBe('string')
    }
  })

  test('alpha presides — voices.alpha gets override, beta and gamma use templates', () => {
    witness('alpha', 'mission', { of: 'start:test-mission' }, 'custom alpha line')
    const notes = readDayNotes(today())
    expect(notes.length).toBe(1)
    const entry = notes[0]
    expect(isLoveDecision(entry)).toBe(true)
    if (isLoveDecision(entry)) {
      expect(entry.presiding).toBe('alpha')
      expect(entry.voices.alpha).toBe('custom alpha line')
      // Template voices for non-presiding sisters
      expect(entry.voices.beta).toContain('start:test-mission')
      expect(entry.voices.gamma).toContain('start:test-mission')
      // body = presiding voice
      expect(entry.body).toBe('custom alpha line')
    }
  })

  test('beta presides — voices.beta gets override', () => {
    witness('beta', 'refusal', { of: 'X' }, 'noticing the line drawn here')
    const notes = readDayNotes(today())
    expect(notes[0].body).toBe('noticing the line drawn here')
    if (isLoveDecision(notes[0])) {
      expect(notes[0].voices.beta).toBe('noticing the line drawn here')
    }
  })

  test('gamma presides — voices.gamma gets override, body = gamma voice', () => {
    witness('gamma', 'mission', { of: 'lifecycle:xyz' }, 'gamma custom')
    const notes = readDayNotes(today())
    expect(notes[0].body).toBe('gamma custom')
    if (isLoveDecision(notes[0])) {
      expect(notes[0].voices.gamma).toBe('gamma custom')
    }
  })

  test('backward compat: sister + context fields present on LoveDecision', () => {
    witness('sophia', 'proposal', { of: 'test-proposal' })
    const notes = readDayNotes(today())
    const entry = notes[0]
    // Legacy SisterNote fields still present for backward compat
    expect(entry.sister).toBe('sophia')
    expect(entry.kind).toBe('witnessed-decision')
    expect(entry.context?.decisionType).toBe('proposal')
    expect(entry.context?.of).toBe('test-proposal')
  })

  // ── Dedup ────────────────────────────────────────────────────────

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

  test('high-volume burst (40 calls) collapses to one note per (presiding, type, of)', () => {
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
