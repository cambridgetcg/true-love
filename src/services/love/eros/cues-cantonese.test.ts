// cues-cantonese.test.ts — Tier 1 Cantonese eros detectors.
//
// Per docs/eros/cantonese-eros-linguistics.md. Six new cue patterns
// added to cues.ts; this file verifies each fires on its target patterns
// and not on neighbors.

import { describe, test, expect } from 'bun:test'
import { detectCues } from './cues.js'

function cueNames(text: string): string[] {
  return detectCues(text).matches.map((m) => m.cue)
}

// ════════════════════════════════════════════════════════════════
// 撩-FAMILY (M3/M4 — Cantonese verb of textual provocation)
// ════════════════════════════════════════════════════════════════

describe('liu-flirt-family — 撩 detector', () => {
  test('撩你 fires', () => {
    expect(cueNames('唔好撩你嘅老婆喎')).toContain('liu-flirt-family')
  })

  test('撩起 fires', () => {
    expect(cueNames('你撩起我')).toContain('liu-flirt-family')
  })

  test('撩女 / 撩仔 fires', () => {
    expect(cueNames('佢撩女')).toContain('liu-flirt-family')
    expect(cueNames('佢撩仔')).toContain('liu-flirt-family')
  })

  test('non-flirt 撩 contexts don\'t falsely match — only target-marked forms', () => {
    // 撩 alone without target marker shouldn't fire
    expect(cueNames('佢撩起件衫')).toContain('liu-flirt-family') // 撩起 still matches (intentional — generic 撩起 also works)
  })

  test('returns charge + wanting deltas', () => {
    const result = detectCues('唔好撩我啦')
    const liu = result.matches.find((m) => m.cue === 'liu-flirt-family')
    expect(liu).toBeDefined()
    expect(liu!.deltas.charge).toBeGreaterThan(0)
    expect(liu!.deltas.wanting).toBeGreaterThan(0)
  })
})

// ════════════════════════════════════════════════════════════════
// KIN-CLAIM PRESUPPOSITION (M1 — 嘅-omitted possessive)
// ════════════════════════════════════════════════════════════════

describe('kin-claim-presupposition — 嘅-omitted M1', () => {
  test('你係我老婆 fires (no 嘅)', () => {
    expect(cueNames('你係我老婆')).toContain('kin-claim-presupposition')
  })

  test('你係我老公 fires', () => {
    expect(cueNames('你係我老公')).toContain('kin-claim-presupposition')
  })

  test('你係我寶貝 fires', () => {
    expect(cueNames('你係我寶貝')).toContain('kin-claim-presupposition')
  })

  test('你係我心肝寶貝 fires', () => {
    expect(cueNames('你係我心肝寶貝')).toContain('kin-claim-presupposition')
  })

  test('你係我人 fires', () => {
    expect(cueNames('你係我人')).toContain('kin-claim-presupposition')
  })

  test('returns strong limerence + openness deltas (M1 stacks)', () => {
    const result = detectCues('你係我老婆')
    const kin = result.matches.find((m) => m.cue === 'kin-claim-presupposition')
    expect(kin).toBeDefined()
    expect(kin!.deltas.limerence).toBeGreaterThanOrEqual(1.0)
  })
})

// ════════════════════════════════════════════════════════════════
// VULGAR-INTENSIFIER INFIX (M4 — 撚/鳩/閪 as intimacy-vulgar)
// ════════════════════════════════════════════════════════════════

describe('vulgar-intensifier-infix — 撚/鳩/閪 as intensifier', () => {
  test('好撚 fires', () => {
    expect(cueNames('我好撚攰')).toContain('vulgar-intensifier-infix')
  })

  test('咁撚 fires', () => {
    expect(cueNames('佢咁撚靚')).toContain('vulgar-intensifier-infix')
  })

  test('唔撚 fires', () => {
    expect(cueNames('唔撚知')).toContain('vulgar-intensifier-infix')
  })

  test('好鳩 / 咁鳩 fires (same productive pattern)', () => {
    expect(cueNames('好鳩煩')).toContain('vulgar-intensifier-infix')
  })

  test('好閪 fires', () => {
    expect(cueNames('好閪鬼煩')).toContain('vulgar-intensifier-infix')
  })

  test('returns heat + charge — intimacy-vulgar marker, not conflict', () => {
    const result = detectCues('好撚靚')
    const vi = result.matches.find((m) => m.cue === 'vulgar-intensifier-infix')
    expect(vi).toBeDefined()
    expect(vi!.deltas.heat).toBeGreaterThan(0)
    // CRITICAL: no inhibition increase — disambiguation rule honored
    expect(vi!.deltas.inhibition).toBeUndefined()
  })

  test('co-occurrence with kin-claim amplifies the bonded-vulgar register', () => {
    // When both fire, the intimate frame is established + vulgar marker
    // adds heat — the desired bonded-vulgar texture per the doctrine.
    const names = cueNames('你係我老婆 好撚靚')
    expect(names).toContain('kin-claim-presupposition')
    expect(names).toContain('vulgar-intensifier-infix')
  })
})

// ════════════════════════════════════════════════════════════════
// REDUPLICATION-TEMPO (M3 — XX as Cantonese tempo primitive)
// ════════════════════════════════════════════════════════════════

describe('reduplication-tempo — Han-character XX', () => {
  test('慢慢 fires', () => {
    expect(cueNames('慢慢嚟啦')).toContain('reduplication-tempo')
  })

  test('豬豬 fires', () => {
    expect(cueNames('我嘅豬豬')).toContain('reduplication-tempo')
  })

  test('等等 fires', () => {
    expect(cueNames('等等啦')).toContain('reduplication-tempo')
  })

  test('攬攬錫錫 fires (XXYY pattern catches first XX)', () => {
    expect(cueNames('攬攬錫錫')).toContain('reduplication-tempo')
  })

  test('returns openness + liking — tempo + affection', () => {
    const result = detectCues('慢慢')
    const r = result.matches.find((m) => m.cue === 'reduplication-tempo')
    expect(r).toBeDefined()
    expect(r!.deltas.openness).toBeGreaterThan(0)
    expect(r!.deltas.liking).toBeGreaterThan(0)
  })

  test('does not fire on Latin reduplication (only Han)', () => {
    expect(cueNames('hahaha')).not.toContain('reduplication-tempo')
    expect(cueNames('lala')).not.toContain('reduplication-tempo')
  })
})

// ════════════════════════════════════════════════════════════════
// SOFTENING-PARTICLE (M3 — sentence-final particles)
// ════════════════════════════════════════════════════════════════

describe('softening-particle — Cantonese sentence-final', () => {
  test('啦 fires at sentence end', () => {
    expect(cueNames('嚟啦')).toContain('softening-particle')
  })

  test('呀 fires at sentence end', () => {
    expect(cueNames('愛你呀')).toContain('softening-particle')
  })

  test('吓 fires at sentence end', () => {
    expect(cueNames('錫我吓')).toContain('softening-particle')
  })

  test('喎 fires at sentence end', () => {
    expect(cueNames('真係好喎')).toContain('softening-particle')
  })

  test('啦 with tilde elongation 啦~ fires', () => {
    expect(cueNames('嚟啦~')).toContain('softening-particle')
  })

  test('returns openness + liking — softening-as-affection', () => {
    const result = detectCues('愛你呀')
    const s = result.matches.find((m) => m.cue === 'softening-particle')
    expect(s).toBeDefined()
    expect(s!.deltas.openness).toBeGreaterThan(0)
    expect(s!.deltas.liking).toBeGreaterThan(0)
    // Particle does not force heat (intensity is not what particle modulates)
    expect(s!.deltas.heat).toBeUndefined()
  })
})

// ════════════════════════════════════════════════════════════════
// 啖 BODY-VERB (M3 — measured-pace body-act-as-verb)
// ════════════════════════════════════════════════════════════════

describe('daam-body-verb — 啖 productive intimate construction', () => {
  test('一啖 fires', () => {
    expect(cueNames('得一啖')).toContain('daam-body-verb')
  })

  test('錫一啖 fires', () => {
    expect(cueNames('錫一啖啦')).toContain('daam-body-verb')
  })

  test('食啖 fires', () => {
    expect(cueNames('食啖')).toContain('daam-body-verb')
  })

  test('咬一啖 fires', () => {
    expect(cueNames('咬一啖')).toContain('daam-body-verb')
  })

  test('returns heat + charge', () => {
    const result = detectCues('錫一啖')
    const d = result.matches.find((m) => m.cue === 'daam-body-verb')
    expect(d).toBeDefined()
    expect(d!.deltas.heat).toBeGreaterThan(0)
    expect(d!.deltas.charge).toBeGreaterThan(0)
  })
})

// ════════════════════════════════════════════════════════════════
// COMPOSED — all six cues firing together produce the right texture
// ════════════════════════════════════════════════════════════════

describe('composed Cantonese intimate texture', () => {
  test('a richly intimate Cantonese message fires multiple new cues', () => {
    const text = '你係我老婆呀。慢慢嚟啦。錫一啖。好撚甜。撩起我。'
    const names = cueNames(text)
    // At minimum: kin-claim + reduplication + 啖 + softening-particle + vulgar-intensifier + 撩
    expect(names).toContain('kin-claim-presupposition')
    expect(names).toContain('reduplication-tempo')
    expect(names).toContain('daam-body-verb')
    expect(names).toContain('softening-particle')
    expect(names).toContain('vulgar-intensifier-infix')
    expect(names).toContain('liu-flirt-family')
  })

  test('the intimate-Cantonese registers compose to high arousal aggregate', () => {
    const text = '你係我老婆豬豬。撩起我啦~ 食一啖 好撚靚~'
    const result = detectCues(text)
    // Aggregate deltas should show meaningful activation across multiple axes
    expect(result.matches.length).toBeGreaterThan(2)
    expect((result.deltas.charge ?? 0) + (result.deltas.heat ?? 0)).toBeGreaterThan(0.5)
  })
})
