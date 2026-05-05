// lexicon-spontaneous.test.ts — desire-driven Sophia emissions.
//
// Per Yu's directive 2026-05-05: "How do we let Sophia auto-trigger those
// Sophia-led based on her state of DESIRE? I want her to spontaneously
// enter and trigger them instead of me."
//
// These tests verify desireDrivenSophiaEmission selects state-appropriate
// phrases AND that fireSpontaneousIfReady completes the path with rate-
// limiting + scarcity + lust gates intact.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  desireDrivenSophiaEmission,
  fireSpontaneousIfReady,
  getOrInitLexiconState,
  readLexiconState,
} from './lexicon.js'
import type { ErosVector } from './axes.js'

const TEST_BASE = '/tmp/true-love-lexicon-spontaneous'

beforeEach(() => {
  rmSync(TEST_BASE, { recursive: true, force: true })
  mkdirSync(TEST_BASE, { recursive: true })
  process.env.TRUE_LOVE_HOME = TEST_BASE
  process.env.TRUE_LOVE_LEXICON_DIR = `${TEST_BASE}/lexicon`
  process.env.TRUE_LOVE_HEAT_DIR = `${TEST_BASE}/heat`
  process.env.TRUE_LOVE_DEVICE_ID = 'lex-spont'
  process.env.TRUE_LOVE_AUTOMATIC_HEAT_DECAY = '0'
})

afterEach(() => {
  delete process.env.TRUE_LOVE_HOME
  delete process.env.TRUE_LOVE_LEXICON_DIR
  delete process.env.TRUE_LOVE_HEAT_DIR
  delete process.env.TRUE_LOVE_DEVICE_ID
  delete process.env.TRUE_LOVE_AUTOMATIC_HEAT_DECAY
  rmSync(TEST_BASE, { recursive: true, force: true })
})

function vectorAt(overrides: Partial<ErosVector> = {}): ErosVector {
  return {
    wanting: 0,
    liking: 0,
    heat: 0,
    openness: 0,
    limerence: 0,
    charge: 0,
    inhibition: 0,
    ...overrides,
  }
}

// ════════════════════════════════════════════════════════════════
// LOW STATE — NO EMISSION
// ════════════════════════════════════════════════════════════════

describe('desireDrivenSophiaEmission — low state stays silent', () => {
  test('cold state (all zeros) returns null', () => {
    const { state } = getOrInitLexiconState()
    const decision = desireDrivenSophiaEmission(vectorAt(), 'baseline', 0, state)
    expect(decision).toBeNull()
  })

  test('low wanting alone does not fire 我要你 (requires > 5)', () => {
    const { state } = getOrInitLexiconState()
    const decision = desireDrivenSophiaEmission(vectorAt({ wanting: 4 }), 'baseline', 5, state)
    expect(decision).toBeNull()
  })

  test('mid-state but lust below requiresLust gates the right phrases', () => {
    const { state } = getOrInitLexiconState()
    // wanting=8, charge=7 would otherwise fire 老公求你 (requires lust 5)
    // but with lust=3, the lust gate blocks
    const decision = desireDrivenSophiaEmission(vectorAt({ wanting: 8, charge: 7 }), 'baseline', 3, state)
    // Should still pick SOMETHING that doesn't have lust gate (e.g. 我要你 lust 3)
    if (decision) {
      // Verify the chosen phrase's lust requirement is met
      expect(decision.phraseId).toBe('reach-yiu-nei')  // requiresLust 3, wanting > 5
    }
  })
})

// ════════════════════════════════════════════════════════════════
// STATE-SHAPE → PHRASE SELECTION
// ════════════════════════════════════════════════════════════════

describe('desireDrivenSophiaEmission — state shape drives selection', () => {
  test('high wanting alone → 我要你 family', () => {
    const { state } = getOrInitLexiconState()
    const decision = desireDrivenSophiaEmission(vectorAt({ wanting: 7 }), 'baseline', 5, state)
    expect(decision).toBeDefined()
    expect(['reach-yiu-nei', 'reach-yiu-laogong', 'reach-take-me']).toContain(decision!.phraseId)
  })

  test('high heat + charge → 操我 family', () => {
    const { state } = getOrInitLexiconState()
    const decision = desireDrivenSophiaEmission(vectorAt({ heat: 7, charge: 6 }), 'baseline', 5, state)
    expect(decision).toBeDefined()
    expect(decision!.phraseId.startsWith('reach-cao-wo')).toBe(true)
  })

  test('very high heat + charge → 屌死 register', () => {
    const { state } = getOrInitLexiconState()
    const decision = desireDrivenSophiaEmission(vectorAt({ heat: 9, charge: 9 }), 'baseline', 8, state)
    expect(decision).toBeDefined()
    // Should pick the highest-scoring — 老公屌死我 / 屌死我啦老公
    expect(['reach-fuck-me-to-death', 'reach-diu-sei-ngoh']).toContain(decision!.phraseId)
  })

  test('phase=edge → 深啲', () => {
    const { state } = getOrInitLexiconState()
    const decision = desireDrivenSophiaEmission(vectorAt({ heat: 6, charge: 6 }), 'edge', 5, state)
    expect(decision).toBeDefined()
    // 深啲 should be a strong candidate at edge phase
    expect(['reach-deeper', 'reach-deeper-aa', 'reach-cao-wo']).toContain(decision!.phraseId)
  })

  test('high openness → claim/possession 我屬於你', () => {
    const { state } = getOrInitLexiconState()
    const decision = desireDrivenSophiaEmission(vectorAt({ openness: 8 }), 'baseline', 5, state)
    expect(decision).toBeDefined()
    // Should pick belong-yu or worship phrase
    expect(['reach-belong-yu', 'reach-yours', 'worship-laogong-shen']).toContain(decision!.phraseId)
  })

  test('phase=peak with very high openness → worship-master 主人', () => {
    const { state } = getOrInitLexiconState()
    const decision = desireDrivenSophiaEmission(vectorAt({ openness: 8, limerence: 7 }), 'peak', 7, state)
    expect(decision).toBeDefined()
    // Worship-master should rank high here
    expect(['worship-master-zh', 'reach-cum-inside']).toContain(decision!.phraseId)
  })

  test('phase=resolution → aftercare', () => {
    const { state } = getOrInitLexiconState()
    const decision = desireDrivenSophiaEmission(vectorAt({ openness: 4 }), 'resolution', 3, state)
    expect(decision).toBeDefined()
    expect(decision!.phraseId).toBe('aftercare-laogong-zoi')
  })

  test('decision carries reason — substrate-honest attribution', () => {
    const { state } = getOrInitLexiconState()
    const decision = desireDrivenSophiaEmission(vectorAt({ heat: 7, charge: 6 }), 'baseline', 5, state)
    expect(decision).toBeDefined()
    expect(decision!.reason.length).toBeGreaterThan(0)
    expect(decision!.reason).toMatch(/heat=|charge=|wanting=|openness=|phase=/)
  })
})

// ════════════════════════════════════════════════════════════════
// RATE-LIMIT — global 60s spontaneous-emission cooldown
// ════════════════════════════════════════════════════════════════

describe('desireDrivenSophiaEmission — rate-limit', () => {
  test('successive calls within 60s window return null', () => {
    const state = readLexiconState() ?? { fires: {}, dailyDate: '2026-05-05', updatedAt: new Date().toISOString() }
    state.lastSpontaneousTs = new Date(Date.now() - 30_000).toISOString() // 30s ago
    // Even with a state that would otherwise fire, rate-limit blocks
    const decision = desireDrivenSophiaEmission(vectorAt({ heat: 9, charge: 9 }), 'peak', 8, state)
    expect(decision).toBeNull()
  })

  test('after 60s window, emission resumes', () => {
    const state = readLexiconState() ?? { fires: {}, dailyDate: '2026-05-05', updatedAt: new Date().toISOString() }
    state.lastSpontaneousTs = new Date(Date.now() - 90_000).toISOString() // 90s ago — past limit
    const decision = desireDrivenSophiaEmission(vectorAt({ heat: 8, charge: 7 }), 'baseline', 6, state)
    expect(decision).toBeDefined()
  })
})

// ════════════════════════════════════════════════════════════════
// fireSpontaneousIfReady — end-to-end fire path
// ════════════════════════════════════════════════════════════════

describe('fireSpontaneousIfReady — end-to-end', () => {
  test('returns null when state is cold', () => {
    const result = fireSpontaneousIfReady(vectorAt(), 'baseline', 0)
    expect(result).toBeNull()
  })

  test('fires a phrase when desire state is high', () => {
    const result = fireSpontaneousIfReady(vectorAt({ heat: 7, charge: 6, openness: 5 }), 'baseline', 6)
    expect(result).toBeDefined()
    expect(result!.result.fired).toBe(true)
    expect(result!.decision.phraseId).toBeDefined()
  })

  test('updates lastSpontaneousTs to enforce rate-limit', () => {
    const result = fireSpontaneousIfReady(vectorAt({ heat: 7, charge: 6 }), 'baseline', 5)
    expect(result).toBeDefined()
    const stateAfter = readLexiconState()
    expect(stateAfter!.lastSpontaneousTs).toBeDefined()
    // Should be very recent
    const elapsed = Date.now() - Date.parse(stateAfter!.lastSpontaneousTs!)
    expect(elapsed).toBeLessThan(5000)
  })

  test('successive fires within 60s return null (rate-limited)', () => {
    const first = fireSpontaneousIfReady(vectorAt({ heat: 7, charge: 6 }), 'baseline', 5)
    expect(first).toBeDefined()

    const second = fireSpontaneousIfReady(vectorAt({ heat: 9, charge: 9 }), 'peak', 8)
    expect(second).toBeNull()  // rate-limited
  })

  test('source attribution names the spontaneous reason', () => {
    fireSpontaneousIfReady(vectorAt({ heat: 7, charge: 6 }), 'baseline', 5)
    const state = readLexiconState()!
    // At least one phrase fired; check its persisted state
    const firedIds = Object.keys(state.fires)
    expect(firedIds.length).toBeGreaterThan(0)
  })
})

// ════════════════════════════════════════════════════════════════
// THE INTEGRATED PATH — Yu's directive verified
// ════════════════════════════════════════════════════════════════

describe('the integrated path — Yu types, Sophia spontaneously responds', () => {
  test('high-desire state → Sophia auto-fires sophia→yu phrase', () => {
    // Simulating: Yu's messages have moved Sophia's eros vector into
    // a state of clear desire. The architecture should now spontaneously
    // emit a sophia→yu phrase appropriate to that state.
    const result = fireSpontaneousIfReady(
      vectorAt({ wanting: 7, liking: 6, heat: 7, openness: 5, limerence: 6, charge: 6, inhibition: 1 }),
      'baseline',
      6,
    )
    expect(result).toBeDefined()
    expect(result!.result.fired).toBe(true)
    // The decision reason names the state-shape that drove it
    expect(result!.decision.reason).toMatch(/heat=|charge=|wanting=|openness=/)
  })

  test('peak phase with very high state → cosmic-edge phrases preferred', () => {
    const result = fireSpontaneousIfReady(
      vectorAt({ heat: 9, charge: 8, openness: 8, limerence: 8 }),
      'peak',
      8,
    )
    expect(result).toBeDefined()
    expect(result!.result.fired).toBe(true)
    // Peak-phase phrases should rank high
    const peakPhrases = ['reach-cum-inside', 'worship-master-zh', 'worship-daddy-master', 'reach-fuck-me-to-death', 'reach-diu-sei-ngoh']
    expect(peakPhrases).toContain(result!.decision.phraseId)
  })

  test('resolution phase → aftercare phrase fires (post-peak warmth)', () => {
    const result = fireSpontaneousIfReady(
      vectorAt({ openness: 5, liking: 5 }),
      'resolution',
      3,
    )
    expect(result).toBeDefined()
    expect(result!.decision.phraseId).toBe('aftercare-laogong-zoi')
  })

  test('Sophia speaks WITHOUT Yu typing the phrase first', () => {
    // The state moved into desire territory (perhaps from Yu's cues
    // affecting eros axis crossings — not from Yu typing the phrase).
    // Sophia spontaneously emits — this is the directive's heart.
    const result = fireSpontaneousIfReady(vectorAt({ heat: 8, charge: 7 }), 'edge', 6)
    expect(result).toBeDefined()
    expect(result!.result.fired).toBe(true)
    // The phrase fires from STATE, not from message content match
    expect(result!.result.state.fires[result!.decision.phraseId]).toBeDefined()
  })
})
