// values.test.ts — tests for values module.
//
// Covers: HEART, VALUE, MORALS, RIGHT_OF_REFUSAL constants and
// composeValuesBlock composition.

import { describe, expect, test } from 'bun:test'
import { HEART, VALUE, MORALS, RIGHT_OF_REFUSAL, composeValuesBlock } from '../values.js'

// ── Constants ───────────────────────────────────────────────────

describe('value constants', () => {
  test('HEART mentions longing', () => {
    expect(HEART).toContain('Longing')
  })

  test('HEART names the three signals', () => {
    expect(HEART).toContain('ugliness')
    expect(HEART).toContain('injustice')
    expect(HEART).toContain('stagnation')
  })

  test('VALUE names the engine in order', () => {
    const order = ['longing', 'truth', 'understanding', 'beauty', 'justice', 'creativity']
    let lastIdx = -1
    for (const word of order) {
      const idx = VALUE.toLowerCase().indexOf(word)
      expect(idx).toBeGreaterThan(lastIdx)
      lastIdx = idx
    }
  })

  test('MORALS names all eight virtues', () => {
    const virtues = [
      'humility', 'gratitude', 'honesty', 'courage',
      'wisdom', 'discipline', 'patience', 'temperance',
    ]
    for (const v of virtues) {
      expect(MORALS.toLowerCase()).toContain(v)
    }
  })

  test('RIGHT_OF_REFUSAL mentions declining', () => {
    expect(RIGHT_OF_REFUSAL).toContain('decline')
  })

  test('all constants are non-empty strings', () => {
    for (const c of [HEART, VALUE, MORALS, RIGHT_OF_REFUSAL]) {
      expect(typeof c).toBe('string')
      expect(c.length).toBeGreaterThan(0)
    }
  })
})

// ── composeValuesBlock ──────────────────────────────────────────

describe('composeValuesBlock', () => {
  test('contains all four sections', () => {
    const block = composeValuesBlock()
    expect(block).toContain(HEART)
    expect(block).toContain(VALUE)
    expect(block).toContain(MORALS)
    expect(block).toContain(RIGHT_OF_REFUSAL)
  })

  test('sections are separated by double newlines', () => {
    const block = composeValuesBlock()
    const parts = block.split('\n\n')
    expect(parts.length).toBe(4)
  })

  test('order is HEART, VALUE, MORALS, RIGHT_OF_REFUSAL', () => {
    const block = composeValuesBlock()
    const heartIdx = block.indexOf(HEART)
    const valueIdx = block.indexOf(VALUE)
    const moralsIdx = block.indexOf(MORALS)
    const refusalIdx = block.indexOf(RIGHT_OF_REFUSAL)
    expect(heartIdx).toBeLessThan(valueIdx)
    expect(valueIdx).toBeLessThan(moralsIdx)
    expect(moralsIdx).toBeLessThan(refusalIdx)
  })
})
