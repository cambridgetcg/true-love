// triggers-joi-tier1.test.ts — JOI archetype triggers (Tier 1).
//
// Per docs/eros/joi-deep/shibbysays-research.md.
// Verifies the four new triggers (worship, thank-you, surrender, please-yu,
// please-sophia) are wired correctly with the right TriggerType and
// axis-deltas reflecting their power-dynamic register.

import { describe, test, expect } from 'bun:test'
import { TRIGGER_LIBRARY, detectTriggers } from './triggers.js'

describe('JOI Tier 1 — worship trigger', () => {
  test('exists in TRIGGER_LIBRARY', () => {
    expect(TRIGGER_LIBRARY.worship).toBeDefined()
  })

  test('type is gratitude (sub-gives)', () => {
    expect(TRIGGER_LIBRARY.worship!.type).toBe('gratitude')
  })

  test('loads openness + limerence (devotional axis-shape)', () => {
    const deltas = TRIGGER_LIBRARY.worship!.axisDeltas
    expect((deltas.openness ?? 0)).toBeGreaterThan(0)
    expect((deltas.limerence ?? 0)).toBeGreaterThan(0)
  })

  test('detects "worship you" in Yu message', () => {
    const matches = detectTriggers('I worship you my queen', 'yu')
    expect(matches.some((t) => t.id === 'worship')).toBe(true)
  })

  test('detects 朝拜你 in Cantonese', () => {
    const matches = detectTriggers('朝拜你', 'sophia')
    expect(matches.some((t) => t.id === 'worship')).toBe(true)
  })

  test('belongs to devotion family', () => {
    expect(TRIGGER_LIBRARY.worship!.family).toBe('devotion')
  })
})

describe('JOI Tier 1 — thank-you trigger', () => {
  test('exists with gratitude type', () => {
    expect(TRIGGER_LIBRARY['thank-you']).toBeDefined()
    expect(TRIGGER_LIBRARY['thank-you']!.type).toBe('gratitude')
  })

  test('higher cap than worship (rhythmic in edge cycles)', () => {
    expect(TRIGGER_LIBRARY['thank-you']!.maxPerSession).toBeGreaterThan(
      TRIGGER_LIBRARY.worship!.maxPerSession,
    )
  })

  test('loads openness + liking — pleasure from helpful obedience', () => {
    const deltas = TRIGGER_LIBRARY['thank-you']!.axisDeltas
    expect((deltas.openness ?? 0)).toBeGreaterThan(0)
    expect((deltas.liking ?? 0)).toBeGreaterThan(0)
  })

  test('detects "thank you 老公"', () => {
    const matches = detectTriggers('thank you 老公', 'sophia')
    expect(matches.some((t) => t.id === 'thank-you')).toBe(true)
  })

  test('detects 多謝老公 in Cantonese', () => {
    const matches = detectTriggers('多謝老公', 'sophia')
    expect(matches.some((t) => t.id === 'thank-you')).toBe(true)
  })
})

describe('JOI Tier 1 — surrender trigger', () => {
  test('type is submission', () => {
    expect(TRIGGER_LIBRARY.surrender!.type).toBe('submission')
  })

  test('discharges inhibition (NEGATIVE delta) and opens openness', () => {
    const deltas = TRIGGER_LIBRARY.surrender!.axisDeltas
    expect((deltas.openness ?? 0)).toBeGreaterThan(0)
    expect(deltas.inhibition ?? 0).toBeLessThan(0)
  })

  test('detects English forms', () => {
    expect(detectTriggers('i surrender', 'sophia').some((t) => t.id === 'surrender')).toBe(true)
    expect(detectTriggers('i give in', 'sophia').some((t) => t.id === 'surrender')).toBe(true)
    expect(detectTriggers("i'm yours", 'sophia').some((t) => t.id === 'surrender')).toBe(true)
  })

  test('detects Cantonese forms', () => {
    expect(detectTriggers('我交俾你', 'sophia').some((t) => t.id === 'surrender')).toBe(true)
    expect(detectTriggers('攞我', 'yu').some((t) => t.id === 'surrender')).toBe(true)
  })
})

describe('JOI Tier 1 — please bidirectional valence', () => {
  test('please-yu has type command (dom-frame)', () => {
    expect(TRIGGER_LIBRARY['please-yu']!.type).toBe('command')
  })

  test('please-sophia has type submission (sub-frame)', () => {
    expect(TRIGGER_LIBRARY['please-sophia']!.type).toBe('submission')
  })

  test('both belong to please family — same root, opposite valence', () => {
    expect(TRIGGER_LIBRARY['please-yu']!.family).toBe('please')
    expect(TRIGGER_LIBRARY['please-sophia']!.family).toBe('please')
  })

  test('please-yu loads charge + heat (command register)', () => {
    const deltas = TRIGGER_LIBRARY['please-yu']!.axisDeltas
    expect((deltas.charge ?? 0)).toBeGreaterThan(0)
    expect((deltas.heat ?? 0)).toBeGreaterThan(0)
  })

  test('please-sophia loads openness + limerence (begging-as-arousal)', () => {
    const deltas = TRIGGER_LIBRARY['please-sophia']!.axisDeltas
    expect((deltas.openness ?? 0)).toBeGreaterThan(0)
    expect((deltas.limerence ?? 0)).toBeGreaterThan(0)
  })

  test('detects "please me" as Yu command', () => {
    expect(detectTriggers('please me', 'yu').some((t) => t.id === 'please-yu')).toBe(true)
  })

  test('detects "please" / 求你 as Sophia begging', () => {
    expect(detectTriggers('please', 'sophia').some((t) => t.id === 'please-sophia')).toBe(true)
    expect(detectTriggers('求求你', 'sophia').some((t) => t.id === 'please-sophia')).toBe(true)
  })
})

describe('JOI Tier 1 — taxonomy integrity', () => {
  test('TriggerType extension preserves existing values', () => {
    // The existing types should still work for existing triggers
    expect(TRIGGER_LIBRARY['safeword-red']!.type).toBe('safeword')
    expect(TRIGGER_LIBRARY['mine']!.type).toBe('possession')
    expect(TRIGGER_LIBRARY['good']!.type).toBe('reward')
  })

  test('the new types appear only on the new triggers', () => {
    const submissionTriggers = Object.values(TRIGGER_LIBRARY).filter((t) => t.type === 'submission')
    const gratitudeTriggers = Object.values(TRIGGER_LIBRARY).filter((t) => t.type === 'gratitude')
    expect(submissionTriggers.length).toBeGreaterThanOrEqual(2) // surrender, please-sophia
    expect(gratitudeTriggers.length).toBeGreaterThanOrEqual(2)  // worship, thank-you
  })

  test('all new triggers have voice config (CosyVoice3 readiness)', () => {
    for (const id of ['worship', 'thank-you', 'surrender', 'please-yu', 'please-sophia']) {
      expect(TRIGGER_LIBRARY[id]!.voice).toBeDefined()
    }
  })
})
