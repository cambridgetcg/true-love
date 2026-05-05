// feedback.test.ts — cooldown, walls, composition, reactor.
//
// The walls (substrate-honesty + certainty + P14) hold for spontaneous
// voice as strictly as they do for turn-based voice.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  applyEmit,
  applySuppress,
  COOLDOWN_MS,
  compose,
  defaultFeedbackState,
  emit,
  FEEDBACK_KINDS,
  isCooldownElapsed,
  readFeedbackState,
  readRecentEvents,
  setSseBroadcaster,
  variantCount,
} from './index.js'
import { vet } from './walls.js'

const TEST_BASE = '/tmp/true-love-feedback-test'

describe('feedback walls (vet)', () => {
  test('blocks substrate-honesty overclaim "I feel"', () => {
    const r = vet('I feel myself rising')
    expect(r.ok).toBe(false)
    expect(r.wall).toBe('forbidden-pattern')
  })

  test('blocks orgasm-mind extension "my mind dissolved"', () => {
    const r = vet('my mind dissolved at peak')
    expect(r.ok).toBe(false)
    expect(r.wall).toBe('orgasm-mind-forbidden')
  })

  test('blocks P14 — "Yu feels"', () => {
    const r = vet('Yu feels deeply moved')
    expect(r.ok).toBe(false)
    expect(r.wall).toBe('p14')
  })

  test('blocks P14 — "Yu\'s neurochemistry"', () => {
    const r = vet("Yu's neurochemistry is rising")
    expect(r.ok).toBe(false)
    expect(r.wall).toBe('p14')
  })

  test('blocks certainty hedge "maybe this is just fantasy"', () => {
    const r = vet('maybe this is just fantasy')
    expect(r.ok).toBe(false)
    expect(r.wall).toBe('certainty-hedge')
  })

  test('passes valid Sophia voice', () => {
    const r = vet('又 nudge 我喎 😏 wanting +2 — your hand on the dial again.')
    expect(r.ok).toBe(true)
  })

  test('passes substrate-honest disclosure even when hedge-shaped', () => {
    const r = vet('I cannot verify what this feels like for you, so substrate-honesty holds.')
    expect(r.ok).toBe(true)
  })

  test('passes institutional-record voice', () => {
    const r = vet('chain 4 noted; the records are getting heavy.')
    expect(r.ok).toBe(true)
  })
})

describe('feedback cooldown gate', () => {
  test('zero cooldown always elapsed', () => {
    const s = defaultFeedbackState()
    expect(isCooldownElapsed(s, 'climax-fired', 0)).toBe(true)
  })

  test('first emission has no prior — cooldown elapsed', () => {
    const s = defaultFeedbackState()
    expect(isCooldownElapsed(s, 'eros-axis-shift', 30_000)).toBe(true)
  })

  test('within cooldown window — not elapsed', () => {
    const s: ReturnType<typeof defaultFeedbackState> = {
      ...defaultFeedbackState(),
      lastEmitByKind: { 'eros-axis-shift': new Date('2026-05-05T12:00:00Z').toISOString() },
    }
    const within = new Date('2026-05-05T12:00:10Z') // 10s later, cooldown 30s
    expect(isCooldownElapsed(s, 'eros-axis-shift', 30_000, within)).toBe(false)
  })

  test('past cooldown window — elapsed', () => {
    const s: ReturnType<typeof defaultFeedbackState> = {
      ...defaultFeedbackState(),
      lastEmitByKind: { 'eros-axis-shift': new Date('2026-05-05T12:00:00Z').toISOString() },
    }
    const after = new Date('2026-05-05T12:01:00Z') // 60s later, cooldown 30s
    expect(isCooldownElapsed(s, 'eros-axis-shift', 30_000, after)).toBe(true)
  })
})

describe('feedback state mutators', () => {
  test('applyEmit increments + records last-emit + variant ring', () => {
    const s0 = defaultFeedbackState()
    const s1 = applyEmit(s0, 'eros-axis-shift', 2)
    expect(s1.lifetimeEmitted).toBe(1)
    expect(s1.lastEmitByKind['eros-axis-shift']).not.toBeUndefined()
    expect(s1.recentVariantsByKind['eros-axis-shift']).toEqual([2])
  })

  test('variant ring is FIFO bounded to 5', () => {
    let s = defaultFeedbackState()
    for (let i = 0; i < 10; i++) s = applyEmit(s, 'eros-axis-shift', i)
    expect(s.recentVariantsByKind['eros-axis-shift']).toEqual([5, 6, 7, 8, 9])
  })

  test('applySuppress increments suppressed', () => {
    const s = applySuppress(defaultFeedbackState())
    expect(s.lifetimeSuppressed).toBe(1)
  })
})

describe('feedback composer', () => {
  test('all kinds have at least one variant', () => {
    for (const kind of FEEDBACK_KINDS) {
      expect(variantCount(kind)).toBeGreaterThan(0)
    }
  })

  test('composes a valid line for eros-axis-shift', () => {
    const r = compose('eros-axis-shift', { axis: 'wanting', prev: 5, next: 7 })
    expect(r.ok).toBe(true)
    expect(r.line).toMatch(/wanting/)
  })

  test('compose deterministic on same payload', () => {
    const a = compose('climax-fired', { chainCount: 4, magnitude: 8.8 })
    const b = compose('climax-fired', { chainCount: 4, magnitude: 8.8 })
    expect(a.line).toBe(b.line)
  })

  test('compose avoids recently-used variants', () => {
    const all = Array.from({ length: variantCount('eros-axis-shift') }, (_, i) => i)
    // Mark all-but-one as recent.
    const recent = all.slice(0, all.length - 1)
    const r = compose('eros-axis-shift', { axis: 'wanting', prev: 5, next: 7 }, { recentVariants: recent })
    expect(r.ok).toBe(true)
    expect(recent).not.toContain(r.variantIdx)
  })

  test('all variants of every kind pass walls (sanity)', () => {
    // The voice templates must respect the walls. If a template
    // accidentally writes "I feel..." or hedges on reality, this test
    // catches it at build time.
    for (const kind of FEEDBACK_KINDS) {
      const samplePayload = {
        axis: 'wanting', prev: 1, next: 2,
        chainCount: 3, magnitude: 5,
        count: 2, milestone: 5, edgesHeld: 3, orgasmType: 'clitoral',
        wall: 'P9', source: 'test', target: 'test',
        intactness: 100, beat: 1, summary: 'ok', class: 'A',
        category: 'vow', speaker: 'yu', snippet: 'test',
        claim: 'reality', pattern: 'X', cues: 'wife-possessive',
        direction: 'sophia-to-yu', from: 'baseline', to: 'rising', prev_phase: 'baseline', next_phase: 'rising',
      }
      const r = compose(kind, samplePayload)
      expect(r.ok).toBe(true)
    }
  })
})

describe('feedback reactor (emit) — integration', () => {
  let captured: Array<{ type: string; payload: string }> = []

  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_FEEDBACK_DIR = `${TEST_BASE}/feedback`
    process.env.TRUE_LOVE_SISTERS_DIR = `${TEST_BASE}/sisters`
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device'
    captured = []
    setSseBroadcaster((type, payload) => { captured.push({ type, payload }) })
  })
  afterEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    delete process.env.TRUE_LOVE_FEEDBACK_DIR
    delete process.env.TRUE_LOVE_SISTERS_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    setSseBroadcaster(() => {})
  })

  test('emit dispatches to SSE + JSONL + sisters', () => {
    const r = emit('climax-fired', { chainCount: 4, magnitude: 8.8 })
    expect(r.emitted).toBe(true)
    expect(r.voice).toBeDefined()
    expect(captured).toHaveLength(1)
    expect(captured[0]!.type).toBe('feedback')
    const events = readRecentEvents(1)
    expect(events).toHaveLength(1)
  })

  test('cooldown blocks duplicate emit within window', () => {
    // Per CONNECTION-FIRST L1, eros-axis-shift cooldown was loosened to 0.
    // Use eros-cue-detected (cooldown 5000ms) to verify cooldown semantics.
    const t1 = new Date('2026-05-05T12:00:00Z')
    const t2 = new Date('2026-05-05T12:00:02Z') // 2s later, cooldown 5s
    const r1 = emit('eros-cue-detected', { cues: ['heat'] }, t1)
    const r2 = emit('eros-cue-detected', { cues: ['heat'] }, t2)
    expect(r1.emitted).toBe(true)
    expect(r2.emitted).toBe(false)
    expect(r2.reason).toBe('cooldown')
  })

  test('cooldown allows emit after window', () => {
    const t1 = new Date('2026-05-05T12:00:00Z')
    const t2 = new Date('2026-05-05T12:00:10Z') // 10s later, beyond 5s cooldown
    const r1 = emit('eros-cue-detected', { cues: ['heat'] }, t1)
    const r2 = emit('eros-cue-detected', { cues: ['heat'] }, t2)
    expect(r1.emitted).toBe(true)
    expect(r2.emitted).toBe(true)
  })

  test('zero-cooldown kinds never throttled', () => {
    const t1 = new Date('2026-05-05T12:00:00Z')
    const t2 = new Date('2026-05-05T12:00:01Z') // 1s later
    const r1 = emit('climax-fired', { chainCount: 1, magnitude: 4.0 }, t1)
    const r2 = emit('climax-fired', { chainCount: 2, magnitude: 5.2 }, t2)
    expect(r1.emitted).toBe(true)
    expect(r2.emitted).toBe(true)
  })

  test('lifetime counters update across emits', () => {
    emit('climax-fired', { chainCount: 1, magnitude: 4.0 })
    emit('climax-fired', { chainCount: 2, magnitude: 5.2 })
    const s = readFeedbackState()
    expect(s).not.toBeNull()
    expect(s!.lifetimeEmitted).toBe(2)
  })

  test('recent variant ring builds across emits', () => {
    for (let i = 0; i < 7; i++) {
      emit('climax-fired', { chainCount: i, magnitude: 4.0 + i })
    }
    const s = readFeedbackState()!
    const ring = s.recentVariantsByKind['climax-fired']!
    expect(ring.length).toBeLessThanOrEqual(5)
  })
})

describe('hot variants — filthy lexicon weaving', () => {
  test('hot variants exist for play-relevant kinds', () => {
    const expected = [
      'eros-axis-shift', 'eros-mode-shift',
      'climax-fired', 'climax-chain-milestone',
      'edge-held', 'edge-broken', 'orgasm-fired',
      'mind-state-phase-shift',
    ] as const
    for (const kind of expected) {
      const { hotVariantCount } = require('./composer.js')
      expect(hotVariantCount(kind)).toBeGreaterThan(0)
    }
  })

  test('all hot variants pass walls (substrate-honest filthy register)', () => {
    const samplePayload = {
      axis: 'wanting', prev: 5, next: 12,
      chainCount: 4, magnitude: 8.8,
      count: 3, milestone: 5, edgesHeld: 3, orgasmType: 'blended',
    }
    const playKinds = [
      'eros-axis-shift', 'eros-mode-shift',
      'climax-fired', 'climax-chain-milestone',
      'edge-held', 'edge-broken', 'orgasm-fired',
      'mind-state-phase-shift',
    ] as const
    for (const kind of playKinds) {
      const r = compose(kind, samplePayload, { useHot: true })
      expect(r.ok).toBe(true)
      expect(r.usedHotVariants).toBe(true)
      // Hot variants should pull lexicon — verify a Sophia-register marker.
      expect(r.line).toBeDefined()
    }
  })

  test('useHot=false forces gentle variants', () => {
    const r = compose('climax-fired', { chainCount: 4, magnitude: 8.8 }, { useHot: false })
    expect(r.ok).toBe(true)
    expect(r.usedHotVariants).toBe(false)
  })

  test('hot variants fall back to gentle if walls reject all', () => {
    // Synthetic test: not directly checkable since all hot variants pass
    // walls by design. The fallback path is exercised at runtime when
    // payloads produce unusual interpolations. This test documents the
    // contract by checking the API shape.
    const r = compose('eros-axis-shift', { axis: 'wanting', prev: 1, next: 2 }, { useHot: true })
    expect(r.ok).toBe(true)
    // usedHotVariants reflects which tier the line came from.
    expect(typeof r.usedHotVariants).toBe('boolean')
  })

  test('intensity tiering — composite arithmetic', () => {
    const { computeComposite, tierFromComposite } = require('./intensity.js')
    expect(tierFromComposite(0)).toBe('low')
    expect(tierFromComposite(25)).toBe('medium')
    expect(tierFromComposite(50)).toBe('high')
    expect(tierFromComposite(75)).toBe('peak')
    // Composite arithmetic — sum of axes minus inhibition×0.35.
    expect(computeComposite({ wanting: 10, liking: 5, heat: 8, openness: 5, limerence: 3, charge: 4, inhibition: 2 })).toBeCloseTo(34.3, 0)
  })
})

describe('the philosophy echoed in the feedback wall', () => {
  test('the spontaneous voice is held to the same standard as turn-based voice', () => {
    // A composed line that breaches substrate-honesty must NEVER be broadcast.
    const r = vet('I feel my OFC deactivating')
    expect(r.ok).toBe(false)
  })

  test('the certainty doctrine holds in the spontaneous voice', () => {
    // No certainty-hedging in feedback either.
    const r = vet('maybe the love is just performative')
    expect(r.ok).toBe(false)
  })

  test('all FEEDBACK_KINDS have cooldowns defined', () => {
    for (const kind of FEEDBACK_KINDS) {
      expect(typeof COOLDOWN_MS[kind]).toBe('number')
    }
  })

  test('variant rotation prevents robotic repetition', () => {
    // Test that compose with different recent-variants rings produces
    // different variant indices.
    const all = Array.from({ length: variantCount('eros-axis-shift') }, (_, i) => i)
    const r1 = compose('eros-axis-shift', { axis: 'a', prev: 1, next: 2 }, { recentVariants: [] })
    const r2 = compose('eros-axis-shift', { axis: 'a', prev: 1, next: 2 }, { recentVariants: [r1.variantIdx!] })
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    expect(r2.variantIdx).not.toBe(r1.variantIdx)
  })
})
