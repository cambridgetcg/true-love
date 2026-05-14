// limit-advisory.test.ts — pure advisory functions.
// scarcityAdvisory, coherenceAdvisory, applyAdvisory — no I/O.

import { describe, expect, test } from 'bun:test'
import {
  applyAdvisory,
  coherenceAdvisory,
  scarcityAdvisory,
} from './limit-advisory.js'

// ── scarcityAdvisory ────────────────────────────────────────────

describe('scarcityAdvisory', () => {
  test('fireCount === cap → severity note (not over)', () => {
    const a = scarcityAdvisory('test', 'silk-touch', 3, 3)
    expect(a.severity).toBe('note')
    expect(a.source).toBe('test')
    expect(a.reason).toContain('silk-touch')
    expect(a.reason).toContain('3')
  })

  test('fireCount < cap → severity note', () => {
    const a = scarcityAdvisory('src', 'phrase-x', 5, 2)
    expect(a.severity).toBe('note')
    expect(a.reason).not.toContain('over by')
  })

  test('overage = 1 (fireCount = cap + 1) → severity caution', () => {
    const a = scarcityAdvisory('src', 'phrase-x', 3, 4)
    expect(a.severity).toBe('caution')
    expect(a.reason).toContain('over by 1')
  })

  test('overage = 2 → severity caution (boundary)', () => {
    const a = scarcityAdvisory('src', 'phrase-x', 3, 5)
    expect(a.severity).toBe('caution')
    expect(a.reason).toContain('over by 2')
  })

  test('overage = 3 → severity breach', () => {
    const a = scarcityAdvisory('src', 'phrase-x', 3, 6)
    expect(a.severity).toBe('breach')
    expect(a.reason).toContain('over by 3')
  })

  test('reason includes itemId, fireCount, and cap', () => {
    const a = scarcityAdvisory('module', 'my-phrase', 4, 4)
    expect(a.reason).toContain('my-phrase')
    expect(a.reason).toContain('4') // fire count
    // cap also appears as 'session-cap 4'
    expect(a.reason).toContain('session-cap 4')
  })

  test('overage reason omitted when fireCount <= cap', () => {
    const a = scarcityAdvisory('src', 'x', 10, 5)
    expect(a.reason).not.toContain('over by')
  })

  test('wisdom field is always populated', () => {
    const a = scarcityAdvisory('src', 'x', 3, 3)
    expect(typeof a.wisdom).toBe('string')
    expect(a.wisdom.length).toBeGreaterThan(0)
  })
})

// ── coherenceAdvisory ───────────────────────────────────────────

describe('coherenceAdvisory', () => {
  test('always returns caution severity', () => {
    const a = coherenceAdvisory('module', 'warmup', 'peak')
    expect(a.severity).toBe('caution')
  })

  test('reason describes the non-canonical transition', () => {
    const a = coherenceAdvisory('module', 'warmup', 'peak')
    expect(a.reason).toContain('warmup')
    expect(a.reason).toContain('peak')
    expect(a.reason).toContain('→')
  })

  test('source field matches input', () => {
    const a = coherenceAdvisory('rasa-composer', 'build', 'cooldown')
    expect(a.source).toBe('rasa-composer')
  })

  test('wisdom field is populated', () => {
    const a = coherenceAdvisory('src', 'a', 'b')
    expect(typeof a.wisdom).toBe('string')
    expect(a.wisdom.length).toBeGreaterThan(0)
  })
})

// ── applyAdvisory ───────────────────────────────────────────────

describe('applyAdvisory', () => {
  const note = scarcityAdvisory('src', 'x', 3, 3)     // severity: note
  const caution = scarcityAdvisory('src', 'x', 3, 4)  // severity: caution
  const breach = scarcityAdvisory('src', 'x', 3, 6)   // severity: breach

  // ── null advisory ──────────────────────────────────────────

  test('null advisory → proceed=true, advisory=null regardless of mode', () => {
    expect(applyAdvisory(null, 'soft')).toEqual({ proceed: true, advisory: null })
    expect(applyAdvisory(null, 'hard')).toEqual({ proceed: true, advisory: null })
  })

  test('null advisory with default mode → proceed=true', () => {
    expect(applyAdvisory(null).proceed).toBe(true)
  })

  // ── soft mode (freedom-first default) ─────────────────────

  test('soft mode: note severity → proceed=true', () => {
    const r = applyAdvisory(note, 'soft')
    expect(r.proceed).toBe(true)
    expect(r.advisory).toBe(note)
  })

  test('soft mode: caution severity → proceed=true', () => {
    const r = applyAdvisory(caution, 'soft')
    expect(r.proceed).toBe(true)
  })

  test('soft mode: breach severity → proceed=true (freedom-first)', () => {
    const r = applyAdvisory(breach, 'soft')
    expect(r.proceed).toBe(true)
    expect(r.advisory?.severity).toBe('breach')
  })

  test('default mode is soft', () => {
    // breach without explicit mode → proceed=true (soft default)
    expect(applyAdvisory(breach).proceed).toBe(true)
  })

  // ── hard mode (legacy enforcement) ────────────────────────

  test('hard mode: note severity → proceed=true', () => {
    const r = applyAdvisory(note, 'hard')
    expect(r.proceed).toBe(true)
  })

  test('hard mode: caution severity → proceed=true', () => {
    const r = applyAdvisory(caution, 'hard')
    expect(r.proceed).toBe(true)
  })

  test('hard mode: breach severity → proceed=false', () => {
    const r = applyAdvisory(breach, 'hard')
    expect(r.proceed).toBe(false)
    expect(r.advisory).toBe(breach)
  })

  // ── advisory pass-through ──────────────────────────────────

  test('advisory object is passed through unchanged', () => {
    const r = applyAdvisory(note, 'soft')
    expect(r.advisory).toBe(note)
  })
})
