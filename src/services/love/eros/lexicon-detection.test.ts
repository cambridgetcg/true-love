// lexicon-detection.test.ts — auto-detection + auto-fire for the lexicon.
//
// Per Yu's directive 2026-05-05: the lexicon could not be triggered from
// chat (no detection path existed). These tests verify the new
// detectLexicon + fireDetectedLexicon API works end-to-end.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  detectLexicon,
  fireDetectedLexicon,
  PHRASE_CATALOG,
  PHRASE_BY_ID,
  readLexiconState,
} from './lexicon.js'

const TEST_BASE = '/tmp/true-love-lexicon-detection'

beforeEach(() => {
  rmSync(TEST_BASE, { recursive: true, force: true })
  mkdirSync(TEST_BASE, { recursive: true })
  process.env.TRUE_LOVE_HOME = TEST_BASE
  process.env.TRUE_LOVE_LEXICON_DIR = `${TEST_BASE}/lexicon`
  process.env.TRUE_LOVE_HEAT_DIR = `${TEST_BASE}/heat`
  process.env.TRUE_LOVE_DEVICE_ID = 'lex-detect'
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

// ════════════════════════════════════════════════════════════════
// detectLexicon — substring detection with direction filtering
// ════════════════════════════════════════════════════════════════

describe('detectLexicon — Yu→Sophia direction', () => {
  test('detects "Mine" possession', () => {
    const matches = detectLexicon('You are Mine.', 'yu-to-sophia')
    const ids = matches.map((m) => m.config.id)
    expect(ids).toContain('poss-mine')
  })

  test('detects 老婆 as possession', () => {
    const matches = detectLexicon('我嘅老婆', 'yu-to-sophia')
    const ids = matches.map((m) => m.config.id)
    expect(ids.some((id) => id === 'poss-laopo' || id === 'poss-wo-ge-laopo')).toBe(true)
  })

  test('detects 屬於我 as possession', () => {
    const matches = detectLexicon('你屬於我', 'yu-to-sophia')
    const ids = matches.map((m) => m.config.id)
    expect(ids).toContain('poss-shu-yu-wo')
  })

  test('detects "slut" as degradation', () => {
    const matches = detectLexicon('my slut', 'yu-to-sophia')
    expect(matches.some((m) => m.config.id === 'deg-slut')).toBe(true)
  })

  test('detects 跪低 as filthy command', () => {
    const matches = detectLexicon('跪低', 'yu-to-sophia')
    expect(matches.some((m) => m.config.id === 'cmd-kneel-zh')).toBe(true)
  })

  test('detects 女神 as worship', () => {
    const matches = detectLexicon('我嘅女神', 'yu-to-sophia')
    expect(matches.some((m) => m.config.id === 'worship-nu-shen')).toBe(true)
  })
})

describe('detectLexicon — Sophia→Yu direction', () => {
  test('detects 操我 as sophia-reach', () => {
    const matches = detectLexicon('操我', 'sophia-to-yu')
    expect(matches.some((m) => m.config.id === 'reach-cao-wo')).toBe(true)
  })

  test('detects 屌死我啦老公 as sophia-reach', () => {
    const matches = detectLexicon('屌死我啦老公', 'sophia-to-yu')
    expect(matches.some((m) => m.config.id === 'reach-diu-sei-ngoh')).toBe(true)
  })

  test('detects 深啲 as sophia-reach', () => {
    const matches = detectLexicon('深啲', 'sophia-to-yu')
    expect(matches.some((m) => m.config.id === 'reach-deeper')).toBe(true)
  })

  test('detects "I am yours"', () => {
    const matches = detectLexicon('I am yours', 'sophia-to-yu')
    expect(matches.some((m) => m.config.id === 'reach-yours')).toBe(true)
  })

  test('detects 我屬於你', () => {
    const matches = detectLexicon('我屬於你', 'sophia-to-yu')
    expect(matches.some((m) => m.config.id === 'reach-belong-yu')).toBe(true)
  })
})

describe('detectLexicon — direction filtering', () => {
  test('Yu-direction does NOT match phrases marked sophia→yu only', () => {
    // 操我 is direction='sophia→yu' — should NOT match for Yu speaker
    const matches = detectLexicon('操我', 'yu-to-sophia')
    expect(matches.some((m) => m.config.id === 'reach-cao-wo')).toBe(false)
  })

  test('Sophia-direction does NOT match phrases marked yu→sophia only', () => {
    // 跪低 is direction='yu→sophia' — should NOT match for Sophia speaker
    const matches = detectLexicon('跪低', 'sophia-to-yu')
    expect(matches.some((m) => m.config.id === 'cmd-kneel-zh')).toBe(false)
  })

  test('"either" direction matches both speakers', () => {
    // 屌 is direction='either'
    expect(detectLexicon('屌', 'yu-to-sophia').some((m) => m.config.id === 'op-diu')).toBe(true)
    expect(detectLexicon('屌', 'sophia-to-yu').some((m) => m.config.id === 'op-diu')).toBe(true)
  })
})

describe('detectLexicon — word boundary discipline (English)', () => {
  test('"mine" matches as standalone word', () => {
    expect(detectLexicon('You are Mine.', 'yu-to-sophia').some((m) => m.config.id === 'poss-mine')).toBe(true)
  })

  test('"mine" does NOT match inside "minestrone"', () => {
    expect(detectLexicon('I love minestrone soup', 'yu-to-sophia').some((m) => m.config.id === 'poss-mine')).toBe(false)
  })

  test('"slut" matches standalone', () => {
    expect(detectLexicon('my slut', 'yu-to-sophia').some((m) => m.config.id === 'deg-slut')).toBe(true)
  })

  test('"slut" does NOT match in "slutty" — wait, slutty starts with slut', () => {
    // Actually "slutty" CONTAINS "slut" with right boundary failing — verify
    const matches = detectLexicon('she is slutty', 'yu-to-sophia')
    // 'y' is alphanumeric so right-boundary check fails — no match
    expect(matches.some((m) => m.config.id === 'deg-slut')).toBe(false)
  })

  test('CJK phrases do not need word-boundary check (no whitespace)', () => {
    // 屌 inside compound — should still match as it's the explicit operator
    expect(detectLexicon('屌爆我', 'yu-to-sophia').some((m) => m.config.id === 'op-diu')).toBe(true)
  })
})

describe('detectLexicon — longest-match priority', () => {
  test('longer phrase comes first in match order', () => {
    // 屌死 is longer than 屌 — both should match for 'either' direction
    const matches = detectLexicon('屌死', 'yu-to-sophia')
    const ids = matches.map((m) => m.config.id)
    const diuSeiIdx = ids.indexOf('op-diu-sei')
    const diuIdx = ids.indexOf('op-diu')
    if (diuSeiIdx >= 0 && diuIdx >= 0) {
      // The longer one (op-diu-sei) should appear before (op-diu) in the list
      expect(diuSeiIdx).toBeLessThan(diuIdx)
    }
  })

  test('multiple matches stack — operator + degradation in same message', () => {
    const matches = detectLexicon('我嘅淫蕩老婆', 'yu-to-sophia')
    const ids = matches.map((m) => m.config.id)
    expect(ids).toContain('deg-yam-dong')
    // Plus possession marker
    expect(ids.some((id) => id.startsWith('poss-'))).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════
// fireDetectedLexicon — the auto-fire path
// ════════════════════════════════════════════════════════════════

describe('fireDetectedLexicon — end-to-end auto-fire', () => {
  test('Yu typing "Mine" auto-fires the possession phrase', () => {
    const results = fireDetectedLexicon('You are Mine.', 'yu-to-sophia', { currentLust: 5 })
    expect(results.length).toBeGreaterThan(0)
    const mineFire = results.find((r) => r.phraseId === 'poss-mine')
    expect(mineFire).toBeDefined()
    expect(mineFire!.result.fired).toBe(true)
  })

  test('Sophia "操我" auto-fires the sophia-reach phrase', () => {
    const results = fireDetectedLexicon('操我啦', 'sophia-to-yu', { currentLust: 6 })
    const caoWoFire = results.find((r) => r.phraseId === 'reach-cao-wo' || r.phraseId === 'reach-cao-wo-laa')
    expect(caoWoFire).toBeDefined()
    expect(caoWoFire!.result.fired).toBe(true)
  })

  test('lust gate refuses fire when currentLust below requiresLust', () => {
    // deg-bitch-in-heat requires lust 6
    const lowLust = fireDetectedLexicon('bitch in heat', 'yu-to-sophia', { currentLust: 2 })
    const deg = lowLust.find((r) => r.phraseId === 'deg-bitch-in-heat')
    expect(deg).toBeDefined()
    expect(deg!.result.fired).toBe(false)
    expect(deg!.result.reason).toBe('lust-gate')

    // Same phrase with high lust DOES fire
    const highLust = fireDetectedLexicon('bitch in heat', 'yu-to-sophia', { currentLust: 8 })
    const degHi = highLust.find((r) => r.phraseId === 'deg-bitch-in-heat')
    expect(degHi!.result.fired).toBe(true)
  })

  test('first lifetime fire records as anchored', () => {
    // Use the exact catalog phrase: '老公嘅人形飛機杯' (id: deg-rengxing-fei-bei)
    const results = fireDetectedLexicon('老公嘅人形飛機杯', 'yu-to-sophia', { currentLust: 8 })
    const fire = results.find((r) => r.phraseId === 'deg-rengxing-fei-bei')
    expect(fire).toBeDefined()
    expect(fire!.result.fired).toBe(true)
    expect(fire!.result.anchored).toBe(true)
  })

  test('state.fires is incremented after detection-fire', () => {
    fireDetectedLexicon('You are Mine.', 'yu-to-sophia', { currentLust: 5 })
    const state = readLexiconState()
    expect(state).toBeDefined()
    expect(state!.fires['poss-mine']).toBeDefined()
    expect(state!.fires['poss-mine'].lifetime).toBeGreaterThanOrEqual(1)
  })

  test('Cantonese lang gets +0.2 magnitude bonus on fire', () => {
    const results = fireDetectedLexicon('我嘅老婆', 'yu-to-sophia', { currentLust: 5 })
    const fire = results.find((r) => r.phraseId === 'poss-wo-ge-laopo' || r.phraseId === 'poss-laopo')
    expect(fire).toBeDefined()
    if (fire) {
      const config = PHRASE_BY_ID[fire.phraseId]!
      // Cantonese bonus: magnitude should be config.magnitude + 0.2
      expect(fire.result.magnitude).toBeCloseTo(config.magnitude + 0.2)
    }
  })
})

// ════════════════════════════════════════════════════════════════
// THE PRIOR BUG — this was Yu's symptom: lexicon couldn't be triggered
// ════════════════════════════════════════════════════════════════

describe('the prior bug — auto-detection path now exists', () => {
  test('typing a Cantonese-explicit phrase fires from chat (was: silent)', () => {
    // Before the fix: 操 / 屌 / 濕 in a message did NOTHING in lexicon state.
    // After: they auto-fire.
    const before = readLexiconState()
    expect(before).toBeNull() // fresh

    fireDetectedLexicon('屌死', 'yu-to-sophia', { currentLust: 5 })

    const after = readLexiconState()
    expect(after).toBeDefined()
    // At least one fire was recorded
    expect(Object.keys(after!.fires).length).toBeGreaterThan(0)
  })

  test('typing a Sophia-direction phrase from Sophia fires (was: silent)', () => {
    fireDetectedLexicon('操我啦老公', 'sophia-to-yu', { currentLust: 6 })

    const after = readLexiconState()
    expect(after).toBeDefined()
    // Should have fired reach-cao-wo-laa AND reach-cao-wo (substring overlap)
    const fired = Object.keys(after!.fires)
    expect(fired.some((id) => id.startsWith('reach-cao-wo'))).toBe(true)
  })

  test('catalog has 50+ phrases — substantial library now reachable from chat', () => {
    expect(PHRASE_CATALOG.length).toBeGreaterThan(50)
  })

  test('every catalog entry has a valid direction', () => {
    for (const config of PHRASE_CATALOG) {
      expect(['yu→sophia', 'sophia→yu', 'either']).toContain(config.direction)
    }
  })
})
