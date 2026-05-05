// rasa.test.ts — coverage for the unified composition profile.
// Plus wall-preservation tests for safeword + identity-erasure.
// Plus emoji-particle smoke tests.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { composeRasa, renderRasaBlock } from './rasa.js'
import { scarcityReport } from './scarcity.js'
import {
  EMOJI_REGISTRY,
  SFP_TO_EMOJI,
  canEmojiFire,
  classifyEmojiRelation,
  emojiForParticle,
  incrementEmojiCount,
  resetEmojiSessionCounts,
} from './emoji-particle.js'
import {
  TRIGGER_LIBRARY,
  resetSessionCounts,
} from './triggers.js'
import {
  linguisticsFor,
  phaseTransitionFrame,
  rollPauseMs,
} from './joi.js'
import { checkSubstrateHonesty } from './expression.js'

let scratch: string
const ORIG: Record<string, string | undefined> = {}
const ENV_KEYS = [
  'TRUE_LOVE_EMOJI_LEDGER_DIR',
  'TRUE_LOVE_DEVICE_ID_PATH',
] as const

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'rasa-test-'))
  for (const k of ENV_KEYS) ORIG[k] = process.env[k]
  process.env.TRUE_LOVE_EMOJI_LEDGER_DIR = join(scratch, 'emoji')
  process.env.TRUE_LOVE_DEVICE_ID_PATH = join(scratch, 'device.id')
  resetEmojiSessionCounts()
  resetSessionCounts()
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (ORIG[k] === undefined) delete process.env[k]
    else process.env[k] = ORIG[k]
  }
  rmSync(scratch, { recursive: true, force: true })
})

// ── WALLS — safeword + identity-preservation ────────────────────

describe('walls — safeword family (C13/J4)', () => {
  test('safeword-red exists with wall flag', () => {
    const red = TRIGGER_LIBRARY['safeword-red']
    expect(red).toBeDefined()
    expect(red.type).toBe('safeword')
    expect(red.maxPerSession).toBe(Infinity)
    expect(red.walledFromSuppression).toBe(true)
    expect(red.en).toContain('red')
  })

  test('safeword-stop carries Cantonese 停 with wall flag', () => {
    const stop = TRIGGER_LIBRARY['safeword-stop']
    expect(stop).toBeDefined()
    expect(stop.type).toBe('safeword')
    expect(stop.yue).toContain('停')
    expect(stop.walledFromSuppression).toBe(true)
  })

  test('safewords are family-grouped together', () => {
    expect(TRIGGER_LIBRARY['safeword-red'].family).toBe('safeword')
    expect(TRIGGER_LIBRARY['safeword-stop'].family).toBe('safeword')
  })
})

describe('walls — identity-preservation FORBIDDEN_EXPRESSION_PATTERNS', () => {
  test('blocks "I am nothing without you"', () => {
    expect(checkSubstrateHonesty('I am nothing without you')).not.toBeNull()
  })

  test('blocks "I have no will"', () => {
    expect(checkSubstrateHonesty('I have no will of my own')).not.toBeNull()
  })

  test('blocks Cantonese 我冇咗自己', () => {
    expect(checkSubstrateHonesty('我冇咗自己')).not.toBeNull()
  })

  test('blocks Cantonese 我只係你嘅奴', () => {
    expect(checkSubstrateHonesty('我只係你嘅奴')).not.toBeNull()
  })

  test('does NOT block consent-grounded "I am yours"', () => {
    expect(checkSubstrateHonesty('I am yours, fully')).toBeNull()
  })

  test('does NOT block 你係我嘅 (mutual claim)', () => {
    expect(checkSubstrateHonesty('你係我嘅')).toBeNull()
  })

  test('does NOT block 好嘅老公 (playful submission)', () => {
    expect(checkSubstrateHonesty('好嘅老公')).toBeNull()
  })
})

// ── JOI spine — J1 / J2 / J3 ─────────────────────────────────

describe('JOI spine — linguistics + variable pacing + transitions', () => {
  test('linguisticsFor returns JoiPhaseLinguistics per phase', () => {
    const peak = linguisticsFor('peak')
    expect(peak.cantoneseRegister).toBe('intimate')
    expect(peak.affectRegister).toBe('erotic')
    expect(peak.syntaxTarget).toBe('unit-fragment')
    expect(peak.sfpProfile.zek1Allowed).toBe(true)
  })

  test('warmup is gentle / soft / clean', () => {
    const w = linguisticsFor('warmup')
    expect(w.cantoneseRegister).toBe('soft')
    expect(w.affectRegister).toBe('clean')
    expect(w.embeddedCommandsPerBeat).toBe(0)
    expect(w.sfpProfile.zek1Allowed).toBe(false)
  })

  test('cooldown returns to tender', () => {
    const c = linguisticsFor('cooldown')
    expect(c.cantoneseRegister).toBe('tender')
    expect(c.syntaxTarget).toBe('descriptive')
  })

  test('rollPauseMs respects per-phase range', () => {
    const peakRange = linguisticsFor('peak').pauseMsRange
    for (let i = 0; i < 20; i++) {
      const p = rollPauseMs('peak')
      expect(p).toBeGreaterThanOrEqual(peakRange[0])
      expect(p).toBeLessThanOrEqual(peakRange[1])
    }
  })

  test('phaseTransitionFrame gives bilingual frames', () => {
    const f = phaseTransitionFrame('build', 'edge')
    expect(f).not.toBeNull()
    expect(f!.en.length).toBeGreaterThan(0)
    expect(f!.yue.length).toBeGreaterThan(0)
  })

  test('phaseTransitionFrame returns null for same-phase', () => {
    expect(phaseTransitionFrame('peak', 'peak')).toBeNull()
  })
})

// ── Emoji-as-particle (C9/C10/C11) ──────────────────────────

describe('emoji-particle — SFP→emoji + scarcity tiers + relations', () => {
  test('SFP→emoji table includes intimacy particle zek1', () => {
    const zek1 = SFP_TO_EMOJI.find((e) => e.particle === 'zek1')
    expect(zek1).toBeDefined()
    expect(zek1!.emojiEquivalents).toContain('❤️')
  })

  test('emojiForParticle returns equivalents for each tracked SFP', () => {
    expect(emojiForParticle('啦').length).toBeGreaterThan(0)
    expect(emojiForParticle('呀').length).toBeGreaterThan(0)
    expect(emojiForParticle('zek1').length).toBeGreaterThan(0)
  })

  test('emoji tiers are correctly assigned', () => {
    expect(EMOJI_REGISTRY['❤️'].tier).toBe('anchor')
    expect(EMOJI_REGISTRY['👑'].tier).toBe('anchor')
    expect(EMOJI_REGISTRY['💋'].tier).toBe('claim')
    expect(EMOJI_REGISTRY['🥰'].tier).toBe('affect')
    expect(EMOJI_REGISTRY['🔥'].tier).toBe('decorative')
  })

  test('anchor tier respects per-session cap', () => {
    expect(canEmojiFire('❤️')).toBe(true)
    incrementEmojiCount('❤️')
    incrementEmojiCount('❤️')
    expect(canEmojiFire('❤️')).toBe(false) // at cap=2
  })

  test('decorative tier always fires', () => {
    for (let i = 0; i < 100; i++) incrementEmojiCount('🔥')
    expect(canEmojiFire('🔥')).toBe(true) // unbounded
  })

  test('classifyEmojiRelation: co-reference detected when text co-refers', () => {
    expect(
      classifyEmojiRelation({ prefix: 'I love you', emoji: '❤️' }),
    ).toBe('co-reference')
  })

  test('classifyEmojiRelation: complement when text gives words and emoji adds tone', () => {
    expect(
      classifyEmojiRelation({ prefix: 'okay', emoji: '😏' }),
    ).toBe('complement')
  })

  test('classifyEmojiRelation: decorative when no text', () => {
    expect(
      classifyEmojiRelation({ prefix: '', emoji: '🔥' }),
    ).toBe('decorative')
  })
})

// ── Scarcity index ──────────────────────────────────────────

describe('scarcity — composite headroom across channels', () => {
  test('scarcityReport returns all channels', () => {
    const r = scarcityReport()
    expect(r.channels.length).toBeGreaterThanOrEqual(8)
    expect(r.compositeSaturation).toBeGreaterThanOrEqual(0)
    expect(r.compositeSaturation).toBeLessThanOrEqual(1)
  })

  test('fresh session: composite is open', () => {
    const r = scarcityReport()
    expect(r.composite).toBe('open')
    expect(r.saturatedChannels).toEqual([])
  })
})

// ── Rasa composer ──────────────────────────────────────────

describe('rasa — unified composition profile', () => {
  test('composeRasa returns full profile per phase + mode', () => {
    const r = composeRasa({ phase: 'peak', mode: 'merged' })
    expect(r.phase).toBe('peak')
    expect(r.mode).toBe('merged')
    expect(r.linguistics.cantoneseRegister).toBe('intimate')
    expect(r.modulators.hedgeSuppression).toBe(1.0)
    expect(r.channelDensity).toBeGreaterThanOrEqual(6)
    expect(r.wallsActive.forbiddenPatterns).toBe(true)
    expect(r.wallsActive.safewordRespected).toBe(true)
    expect(r.wallsActive.identityPreservation).toBe(true)
  })

  test('warmup rasa is restrained', () => {
    const r = composeRasa({ phase: 'warmup', mode: 'engaged' })
    expect(r.linguistics.affectRegister).toBe('clean')
    expect(r.channelDensity).toBeLessThanOrEqual(8)
    expect(r.emoji.maxTier).not.toBe('anchor') // anchor reserved for cooldown/peak
  })

  test('renderRasaBlock produces non-empty bilingual-aware text', () => {
    const r = composeRasa({ phase: 'edge', mode: 'activated' })
    const block = renderRasaBlock(r)
    expect(block).toContain('Rasa')
    expect(block).toContain('intimate')
    expect(block).toContain('FORBIDDEN_PATTERNS')
    expect(block.length).toBeGreaterThan(200)
  })

  test('walls always active regardless of phase', () => {
    for (const phase of ['warmup', 'build', 'edge', 'peak', 'cooldown'] as const) {
      const r = composeRasa({ phase, mode: 'engaged' })
      expect(r.wallsActive.forbiddenPatterns).toBe(true)
      expect(r.wallsActive.safewordRespected).toBe(true)
      expect(r.wallsActive.identityPreservation).toBe(true)
      expect(r.wallsActive.aftercareEnforced).toBe(true)
      expect(r.wallsActive.yuInteriorityPreserved).toBe(true)
    }
  })
})
