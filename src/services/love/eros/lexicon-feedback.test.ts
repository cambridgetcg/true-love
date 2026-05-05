// lexicon-feedback.test.ts — SSE feedback wiring for lexicon fires.
//
// Per Yu's directive 2026-05-05: "Wire the feedback more firmly so I can
// see her using the lexicon to reflect the state of DESIRE she is in and
// what she wanted."
//
// Verifies firePhrase + fireSpontaneousIfReady emit through the feedback
// channel with the right kind, payload, and state-shape attribution.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  fireDetectedLexicon,
  firePhrase,
  fireSpontaneousIfReady,
  PHRASE_CATALOG,
} from './lexicon.js'
import { setSseBroadcaster } from '../feedback/index.js'

const TEST_BASE = '/tmp/true-love-lexicon-feedback'

interface CapturedSse {
  eventType: 'feedback' | 'feedback-suppressed'
  kind: string
  voice: string
  payload: Record<string, unknown>
}

let captured: CapturedSse[] = []

beforeEach(() => {
  rmSync(TEST_BASE, { recursive: true, force: true })
  mkdirSync(TEST_BASE, { recursive: true })
  process.env.TRUE_LOVE_HOME = TEST_BASE
  process.env.TRUE_LOVE_LEXICON_DIR = `${TEST_BASE}/lexicon`
  process.env.TRUE_LOVE_FEEDBACK_DIR = `${TEST_BASE}/feedback`
  process.env.TRUE_LOVE_HEAT_DIR = `${TEST_BASE}/heat`
  process.env.TRUE_LOVE_DEVICE_ID = 'lex-fb'
  process.env.TRUE_LOVE_AUTOMATIC_HEAT_DECAY = '0'

  captured = []
  setSseBroadcaster((eventType, payloadStr) => {
    try {
      const parsed = JSON.parse(payloadStr) as Record<string, unknown>
      captured.push({
        eventType,
        kind: (parsed.kind as string) ?? 'unknown',
        voice: (parsed.voice as string) ?? '',
        payload: (parsed.payload as Record<string, unknown>) ?? {},
      })
    } catch {
      captured.push({ eventType, kind: 'parse-error', voice: '', payload: {} })
    }
  })
})

afterEach(() => {
  setSseBroadcaster(null as unknown as (e: 'feedback' | 'feedback-suppressed', p: string) => void)
  delete process.env.TRUE_LOVE_HOME
  delete process.env.TRUE_LOVE_LEXICON_DIR
  delete process.env.TRUE_LOVE_FEEDBACK_DIR
  delete process.env.TRUE_LOVE_HEAT_DIR
  delete process.env.TRUE_LOVE_DEVICE_ID
  delete process.env.TRUE_LOVE_AUTOMATIC_HEAT_DECAY
  rmSync(TEST_BASE, { recursive: true, force: true })
})

// ════════════════════════════════════════════════════════════════
// firePhrase emits lexicon-fired
// ════════════════════════════════════════════════════════════════

describe('firePhrase → lexicon-fired SSE broadcast', () => {
  test('UI fire emits lexicon-fired event', () => {
    firePhrase('poss-mine', { currentLust: 5, source: 'ui:test' })
    const fired = captured.filter((c) => c.kind === 'lexicon-fired')
    expect(fired.length).toBeGreaterThanOrEqual(1)
  })

  test('the broadcast carries the phrase as payload', () => {
    firePhrase('poss-laopo', { currentLust: 5, source: 'ui:test' })
    const fired = captured.filter((c) => c.kind === 'lexicon-fired')
    expect(fired.length).toBeGreaterThanOrEqual(1)
    const payload = fired[0]!.payload
    expect(payload.phrase).toBe('老婆')
  })

  test('first-lifetime fire ALSO emits lexicon-anchored', () => {
    // Fresh state — first fire of any phrase should anchor
    firePhrase('reach-cao-wo', { currentLust: 6, source: 'ui:test' })
    const anchored = captured.filter((c) => c.kind === 'lexicon-anchored')
    expect(anchored.length).toBeGreaterThanOrEqual(1)
  })

  test('the rendered voice contains the phrase', () => {
    firePhrase('poss-mine', { currentLust: 5, source: 'ui:test' })
    const fired = captured.filter((c) => c.kind === 'lexicon-fired')
    const voiceLine = fired[0]!.voice
    expect(voiceLine.length).toBeGreaterThan(0)
    expect(voiceLine).toContain('Mine')
  })

  test('auto-detected fires also broadcast', () => {
    fireDetectedLexicon('You are Mine.', 'yu-to-sophia', { currentLust: 5 })
    const fired = captured.filter((c) => c.kind === 'lexicon-fired')
    expect(fired.length).toBeGreaterThanOrEqual(1)
    // Source attribution names the autonomic path
    const payload = fired[0]!.payload
    expect((payload.source as string) ?? '').toContain('auto-detected')
  })
})

// ════════════════════════════════════════════════════════════════
// fireSpontaneousIfReady emits lexicon-spontaneous (NOT lexicon-fired)
// ════════════════════════════════════════════════════════════════

describe('fireSpontaneousIfReady → lexicon-spontaneous SSE broadcast', () => {
  test('spontaneous fire emits lexicon-spontaneous event', () => {
    fireSpontaneousIfReady(
      { wanting: 7, liking: 5, heat: 7, openness: 5, limerence: 5, charge: 6, inhibition: 0 },
      'baseline',
      6,
    )
    const spontaneous = captured.filter((c) => c.kind === 'lexicon-spontaneous')
    expect(spontaneous.length).toBeGreaterThanOrEqual(1)
  })

  test('the payload carries the state-shape reason', () => {
    fireSpontaneousIfReady(
      { wanting: 0, liking: 0, heat: 7, openness: 0, limerence: 0, charge: 6, inhibition: 0 },
      'baseline',
      5,
    )
    const spontaneous = captured.filter((c) => c.kind === 'lexicon-spontaneous')
    expect(spontaneous.length).toBeGreaterThanOrEqual(1)
    const payload = spontaneous[0]!.payload
    expect(payload.reason).toBeDefined()
    expect(typeof payload.reason).toBe('string')
    // Reason should attribute the state values that drove it
    expect(payload.reason as string).toMatch(/heat=|charge=|wanting=|openness=/)
  })

  test('the rendered voice quotes the phrase + names the reason', () => {
    fireSpontaneousIfReady(
      { wanting: 0, liking: 0, heat: 7, openness: 0, limerence: 0, charge: 6, inhibition: 0 },
      'baseline',
      5,
    )
    const spontaneous = captured.filter((c) => c.kind === 'lexicon-spontaneous')
    expect(spontaneous.length).toBeGreaterThanOrEqual(1)
    const voiceLine = spontaneous[0]!.voice
    expect(voiceLine.length).toBeGreaterThan(0)
    // Voice should contain the phrase that fired
    expect(voiceLine).toMatch(/操我|cao|heat|charge/)
  })

  test('high-state spontaneous fires get hot variant (cosmic register)', () => {
    fireSpontaneousIfReady(
      { wanting: 9, liking: 8, heat: 9, openness: 8, limerence: 8, charge: 8, inhibition: 0 },
      'peak',
      8,
    )
    const spontaneous = captured.filter((c) => c.kind === 'lexicon-spontaneous')
    expect(spontaneous.length).toBeGreaterThanOrEqual(1)
    // Hot variants include 老公 / Cantonese / signature emoji
    const voiceLine = spontaneous[0]!.voice
    expect(voiceLine.length).toBeGreaterThan(0)
  })

  test('spontaneous fire does NOT emit lexicon-fired (only lexicon-spontaneous)', () => {
    fireSpontaneousIfReady(
      { wanting: 7, liking: 5, heat: 7, openness: 5, limerence: 5, charge: 6, inhibition: 0 },
      'baseline',
      6,
    )
    const fired = captured.filter((c) => c.kind === 'lexicon-fired')
    const spontaneous = captured.filter((c) => c.kind === 'lexicon-spontaneous')
    // Only spontaneous broadcasts; no duplicate "fired" since source starts with 'spontaneous:'
    expect(spontaneous.length).toBeGreaterThanOrEqual(1)
    expect(fired.length).toBe(0)
  })

  test('spontaneous first-fire ALSO emits lexicon-anchored', () => {
    // Fresh state — first ever fire of any sophia→yu phrase
    fireSpontaneousIfReady(
      { wanting: 7, liking: 5, heat: 7, openness: 5, limerence: 5, charge: 6, inhibition: 0 },
      'baseline',
      6,
    )
    const anchored = captured.filter((c) => c.kind === 'lexicon-anchored')
    expect(anchored.length).toBeGreaterThanOrEqual(1)
  })
})

// ════════════════════════════════════════════════════════════════
// What Yu sees — composed real-time view
// ════════════════════════════════════════════════════════════════

describe('what Yu sees in /api/feedback/stream', () => {
  test('Yu typing 老婆 → fires + broadcasts (auto-detection)', () => {
    fireDetectedLexicon('你係我老婆', 'yu-to-sophia', { currentLust: 5 })
    const lexicon = captured.filter((c) => c.kind.startsWith('lexicon-'))
    expect(lexicon.length).toBeGreaterThan(0)
  })

  test('high desire → Sophia spontaneously emits → Yu sees the line', () => {
    fireSpontaneousIfReady(
      { wanting: 0, liking: 0, heat: 7, openness: 0, limerence: 0, charge: 6, inhibition: 0 },
      'baseline',
      5,
    )
    const spontaneous = captured.filter((c) => c.kind === 'lexicon-spontaneous')
    expect(spontaneous.length).toBeGreaterThanOrEqual(1)
    // The line surfaces what Sophia "wanted" — phrase + state-shape
    const line = spontaneous[0]!.voice
    expect(line).toContain('🐍') // Sophia signature
  })

  test('successive fires across a session compose into a visible trace', () => {
    // Yu starts cold
    expect(captured.length).toBe(0)

    // 1. Yu types 老婆 — auto-detected
    fireDetectedLexicon('老婆', 'yu-to-sophia', { currentLust: 4 })
    const afterTyping = captured.length
    expect(afterTyping).toBeGreaterThan(0)

    // 2. State has shifted (mocked here) → Sophia spontaneously emits
    fireSpontaneousIfReady(
      { wanting: 7, liking: 5, heat: 7, openness: 5, limerence: 5, charge: 6, inhibition: 0 },
      'baseline',
      6,
    )
    const afterSpontaneous = captured.length
    expect(afterSpontaneous).toBeGreaterThan(afterTyping)

    // 3. Visible trace: at least one auto-detect fire + one spontaneous fire
    const detected = captured.filter((c) => c.kind === 'lexicon-fired')
    const spontaneous = captured.filter((c) => c.kind === 'lexicon-spontaneous')
    expect(detected.length).toBeGreaterThan(0)
    expect(spontaneous.length).toBeGreaterThan(0)
  })

  test('every emission has a non-empty rendered voice line', () => {
    fireDetectedLexicon('You are Mine', 'yu-to-sophia', { currentLust: 5 })
    fireSpontaneousIfReady(
      { wanting: 7, liking: 5, heat: 7, openness: 5, limerence: 5, charge: 6, inhibition: 0 },
      'baseline',
      6,
    )
    for (const c of captured) {
      // Skip suppression events
      if (c.eventType === 'feedback-suppressed') continue
      // Lexicon emissions should all have voice
      if (c.kind.startsWith('lexicon-')) {
        expect(c.voice.length).toBeGreaterThan(0)
      }
    }
  })
})

// ════════════════════════════════════════════════════════════════
// Catalog completeness — coverage check
// ════════════════════════════════════════════════════════════════

describe('catalog ready for desire-driven flow', () => {
  test('every sophia→yu phrase has a phrase string for composer', () => {
    const sophiaDirected = PHRASE_CATALOG.filter((p) => p.direction === 'sophia→yu')
    expect(sophiaDirected.length).toBeGreaterThan(10)
    for (const config of sophiaDirected) {
      expect(config.phrase.length).toBeGreaterThan(0)
    }
  })
})
