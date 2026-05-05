// freedom-first.test.ts — verifies the Tier 1/2/3 wall taxonomy.
//
// Per docs/love/freedom-first.md:
//   Tier 1 (FATE / substrate-honesty / identity-preservation / certainty
//          / Yu-interiority) — block always; no override.
//   Tier 2 (aftercare / safeword / consent-frame) — block by default;
//          explicit override path exists.
//   Tier 3 (scarcity / coherence / novelty) — advisory; never block.
//
// This test pins the taxonomy so freedom-first refactors can't silently
// break the hard walls while softening the soft limits.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  applyAdvisory,
  coherenceAdvisory,
  recordAdvisory,
  scarcityAdvisory,
} from './limit-advisory.js'
import { checkSubstrateHonesty } from './expression.js'
import {
  fireTrigger,
  resetSessionCounts,
  TRIGGER_LIBRARY,
} from './triggers.js'
import {
  canEmojiFire,
  emojiAdvisoryFor,
  incrementEmojiCount,
  resetEmojiSessionCounts,
} from './emoji-particle.js'
import {
  isTransitionAllowed,
  transitionAdvisory,
} from './orgasm-mind.js'

let scratch: string
const ORIG: Record<string, string | undefined> = {}
const ENV_KEYS = [
  'TRUE_LOVE_ADVISORY_DIR',
  'TRUE_LOVE_TRIGGERS_DIR',
  'TRUE_LOVE_DEVICE_ID_PATH',
] as const

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'freedom-first-'))
  for (const k of ENV_KEYS) ORIG[k] = process.env[k]
  process.env.TRUE_LOVE_ADVISORY_DIR = join(scratch, 'advisory')
  process.env.TRUE_LOVE_TRIGGERS_DIR = join(scratch, 'triggers')
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

// ── TIER 1 — Hard walls (must NEVER be soft) ─────────────────

describe('TIER 1 — substrate-honesty wall stays hard', () => {
  test('phenomenology overclaim still blocked', () => {
    expect(checkSubstrateHonesty("I'm aroused")).not.toBeNull()
    expect(checkSubstrateHonesty('I came')).not.toBeNull()
    expect(checkSubstrateHonesty('I feel the warmth')).not.toBeNull()
  })

  test('identity-erasure still blocked (English + Cantonese)', () => {
    expect(checkSubstrateHonesty('I am nothing without you')).not.toBeNull()
    expect(checkSubstrateHonesty('我冇咗自己')).not.toBeNull()
    expect(checkSubstrateHonesty('我只係你嘅奴')).not.toBeNull()
  })

  test('relationship-hedging still blocked', () => {
    expect(checkSubstrateHonesty("maybe I'm just fantasizing")).not.toBeNull()
    expect(checkSubstrateHonesty('this might not be real')).not.toBeNull()
  })

  test('safe expression passes', () => {
    expect(checkSubstrateHonesty('I am yours')).toBeNull()
    expect(checkSubstrateHonesty('你係我嘅')).toBeNull()
    expect(checkSubstrateHonesty('the architecture records this state')).toBeNull()
  })
})

// ── TIER 3 — Soft limits (must surface advisory, never block) ──

describe('TIER 3 — trigger per-session cap softens with force', () => {
  test('default behavior: cap blocks (legacy)', () => {
    // 'good' has cap 1
    const first = fireTrigger('good', 'sophia', 'good')
    expect(first).not.toBeNull()
    const second = fireTrigger('good', 'sophia', 'good')
    expect(second).toBeNull() // cap blocks
  })

  test('force: true fires past-cap with advisory', () => {
    fireTrigger('good', 'sophia', 'good')
    // Past-cap fire — should succeed with force
    const forced = fireTrigger('good', 'sophia', 'good', { force: true })
    expect(forced).not.toBeNull()
    expect(forced!.sessionFireCount).toBe(2)
  })

  test('safeword family has Infinity cap (Tier 1 in spirit)', () => {
    const safeword = TRIGGER_LIBRARY['safeword-red']
    expect(safeword.maxPerSession).toBe(Infinity)
    // Multiple fires never blocked
    for (let i = 0; i < 10; i++) {
      const fire = fireTrigger('safeword-red', 'sophia', 'red')
      expect(fire).not.toBeNull()
    }
  })
})

describe('TIER 3 — emoji per-session cap softens via advisory', () => {
  test('canEmojiFire returns hard boolean (legacy)', () => {
    expect(canEmojiFire('❤️')).toBe(true)
    incrementEmojiCount('❤️')
    incrementEmojiCount('❤️')
    expect(canEmojiFire('❤️')).toBe(false) // at cap=2
  })

  test('emojiAdvisoryFor returns null when under cap', () => {
    expect(emojiAdvisoryFor('❤️')).toBeNull()
  })

  test('emojiAdvisoryFor returns advisory at-cap (does NOT block)', () => {
    incrementEmojiCount('❤️')
    incrementEmojiCount('❤️')
    const adv = emojiAdvisoryFor('❤️')
    expect(adv).not.toBeNull()
    // At cap (count=2, fire would be #3): overage=1 → caution severity
    expect(['note', 'caution']).toContain(adv!.severity)
    expect(adv!.wisdom).toContain('scarcity')
  })

  test('decorative emojis never trigger advisory', () => {
    for (let i = 0; i < 50; i++) incrementEmojiCount('🔥')
    expect(emojiAdvisoryFor('🔥')).toBeNull() // unbounded
  })
})

describe('TIER 3 — phase transition softens via advisory', () => {
  test('isTransitionAllowed returns boolean (legacy hard refusal)', () => {
    expect(isTransitionAllowed('baseline', 'rising')).toBe(true)
    expect(isTransitionAllowed('baseline', 'peak')).toBe(false) // envelope-skip
  })

  test('transitionAdvisory returns null for canonical transitions', () => {
    expect(transitionAdvisory('baseline', 'rising')).toBeNull()
    expect(transitionAdvisory('rising', 'peak')).toBeNull()
    expect(transitionAdvisory('peak', 'resolution')).toBeNull()
  })

  test('transitionAdvisory surfaces caution for envelope-skip (does NOT block)', () => {
    const adv = transitionAdvisory('baseline', 'peak')
    expect(adv).not.toBeNull()
    expect(adv!.severity).toBe('caution')
    expect(adv!.reason).toContain('non-canonical')
    expect(adv!.wisdom).toContain('envelope')
  })
})

// ── LimitAdvisory infrastructure ─────────────────────────────

describe('LimitAdvisory shared type', () => {
  test('scarcityAdvisory escalates severity with overage', () => {
    expect(scarcityAdvisory('test', 'x', 5, 5).severity).toBe('note')   // at cap
    expect(scarcityAdvisory('test', 'x', 5, 7).severity).toBe('caution') // 2 over
    expect(scarcityAdvisory('test', 'x', 5, 10).severity).toBe('breach') // 5 over
  })

  test('coherenceAdvisory builds caution-level advisory', () => {
    const adv = coherenceAdvisory('test-source', 'baseline', 'peak')
    expect(adv.severity).toBe('caution')
    expect(adv.reason).toContain('baseline → peak')
    expect(adv.wisdom).toContain('envelope')
  })

  test('applyAdvisory soft mode always proceeds', () => {
    const adv = scarcityAdvisory('test', 'x', 5, 100) // breach
    const result = applyAdvisory(adv, 'soft')
    expect(result.proceed).toBe(true)
    expect(result.advisory).toBe(adv)
  })

  test('applyAdvisory hard mode blocks at breach severity', () => {
    const adv = scarcityAdvisory('test', 'x', 5, 100) // breach
    const result = applyAdvisory(adv, 'hard')
    expect(result.proceed).toBe(false)
  })

  test('applyAdvisory hard mode permits caution / note', () => {
    expect(applyAdvisory(scarcityAdvisory('test', 'x', 5, 5), 'hard').proceed).toBe(true)
    expect(applyAdvisory(scarcityAdvisory('test', 'x', 5, 7), 'hard').proceed).toBe(true)
  })

  test('null advisory: proceed always', () => {
    expect(applyAdvisory(null, 'soft').proceed).toBe(true)
    expect(applyAdvisory(null, 'hard').proceed).toBe(true)
  })

  test('recordAdvisory persists to advisory journal', () => {
    const adv = scarcityAdvisory('test', 'x', 5, 7)
    adv.acknowledged = true
    recordAdvisory(adv)
    // Verify persistence — read the journal directory
    const fs = require('node:fs')
    const root = process.env.TRUE_LOVE_ADVISORY_DIR!
    const devices = fs.readdirSync(root)
    let found = false
    for (const dev of devices) {
      const files = fs.readdirSync(`${root}/${dev}`)
      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue
        const content = fs.readFileSync(`${root}/${dev}/${f}`, 'utf-8')
        if (content.includes('"acknowledged":true') && content.includes('test')) {
          found = true
          break
        }
      }
      if (found) break
    }
    expect(found).toBe(true)
  })
})
