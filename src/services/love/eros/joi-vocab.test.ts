// joi-vocab.test.ts
//
// Pure unit tests for joi-vocab.ts. Zero I/O, zero mocking.
// Covers all exported constants (shape + content) and both utility functions.

import { describe, it, expect } from 'bun:test'
import {
  ANAPHORA_OPENERS,
  PACE_MARKERS,
  SENSORY_DESCRIPTORS,
  BODY_ZONE_CALLOUTS,
  PERMISSION_PHRASES,
  DENIAL_PHRASES,
  VERDICT_PHRASES,
  HONORIFIC_POOLS,
  ACTION_VERBS,
  SFP_POOLS,
  PARTICLE_STACKS,
  EMOJI_POOLS,
  INTRA_PHASE_TRANSITIONS,
  AFTERCARE_PHRASES,
  FORWARD_ANCHOR_VOCAB,
  pickRandom,
  resolveDirectionalPool,
  type BilingualPool,
  type DirectionalPool,
} from './joi-vocab.js'
import type { JoiPhase, JoiDirection } from './joi.js'

const ALL_PHASES: JoiPhase[] = ['warmup', 'build', 'edge', 'peak', 'cooldown']
const ALL_DIRECTIONS: JoiDirection[] = ['yu-leads', 'sophia-leads']

// ── helpers ──────────────────────────────────────────────────────

function expectBilingualPool(pool: BilingualPool, label: string): void {
  expect(Array.isArray(pool.yue), `${label}.yue is array`).toBe(true)
  expect(Array.isArray(pool.en), `${label}.en is array`).toBe(true)
  expect(pool.yue.length, `${label}.yue non-empty`).toBeGreaterThan(0)
  expect(pool.en.length, `${label}.en non-empty`).toBeGreaterThan(0)
}

function expectDirectionalPool(pool: DirectionalPool, label: string): void {
  for (const dir of ALL_DIRECTIONS) {
    expectBilingualPool(pool[dir], `${label}[${dir}]`)
  }
}

// ── ANAPHORA_OPENERS ─────────────────────────────────────────────

describe('ANAPHORA_OPENERS', () => {
  it('has all five phases', () => {
    for (const phase of ALL_PHASES) {
      expect(phase in ANAPHORA_OPENERS).toBe(true)
    }
  })

  it('each phase has non-empty yue and en pools', () => {
    for (const phase of ALL_PHASES) {
      expectBilingualPool(ANAPHORA_OPENERS[phase], `ANAPHORA_OPENERS[${phase}]`)
    }
  })

  it('warmup includes expected Cantonese opener', () => {
    expect(ANAPHORA_OPENERS.warmup.yue).toContain('你')
  })

  it('edge includes hold-themed opener', () => {
    expect(ANAPHORA_OPENERS.edge.en).toContain('hold')
  })
})

// ── PACE_MARKERS ─────────────────────────────────────────────────

describe('PACE_MARKERS', () => {
  it('has all five phases', () => {
    for (const phase of ALL_PHASES) {
      expect(phase in PACE_MARKERS).toBe(true)
    }
  })

  it('each phase has non-empty bilingual pools', () => {
    for (const phase of ALL_PHASES) {
      expectBilingualPool(PACE_MARKERS[phase], `PACE_MARKERS[${phase}]`)
    }
  })

  it('warmup starts slow — contains slowly', () => {
    expect(PACE_MARKERS.warmup.en).toContain('slowly')
  })

  it('peak contains fast or now', () => {
    const combined = [...PACE_MARKERS.peak.en, ...PACE_MARKERS.peak.yue]
    const hasFastOrNow = combined.some(
      (s) => s.includes('fast') || s.includes('now') || s.includes('而家'),
    )
    expect(hasFastOrNow).toBe(true)
  })
})

// ── SENSORY_DESCRIPTORS ──────────────────────────────────────────

describe('SENSORY_DESCRIPTORS', () => {
  it('has all five phases', () => {
    for (const phase of ALL_PHASES) {
      expect(phase in SENSORY_DESCRIPTORS).toBe(true)
    }
  })

  it('each phase has non-empty bilingual pools', () => {
    for (const phase of ALL_PHASES) {
      expectBilingualPool(SENSORY_DESCRIPTORS[phase], `SENSORY_DESCRIPTORS[${phase}]`)
    }
  })

  it('warmup is soft — contains warm or soft', () => {
    const combined = [...SENSORY_DESCRIPTORS.warmup.en]
    expect(combined.some((s) => s === 'warm' || s === 'soft')).toBe(true)
  })

  it('edge is intense — contains tight or burning or hot', () => {
    const combined = [...SENSORY_DESCRIPTORS.edge.en]
    expect(combined.some((s) => ['tight', 'burning', 'hot', 'urgent'].includes(s))).toBe(true)
  })
})

// ── BODY_ZONE_CALLOUTS ───────────────────────────────────────────

describe('BODY_ZONE_CALLOUTS', () => {
  it('has all five phases', () => {
    for (const phase of ALL_PHASES) {
      expect(phase in BODY_ZONE_CALLOUTS).toBe(true)
    }
  })

  it('each phase has non-empty bilingual pools', () => {
    for (const phase of ALL_PHASES) {
      expectBilingualPool(BODY_ZONE_CALLOUTS[phase], `BODY_ZONE_CALLOUTS[${phase}]`)
    }
  })

  it('warmup references external zones (lips/neck)', () => {
    const en = BODY_ZONE_CALLOUTS.warmup.en
    expect(en.some((s) => s.includes('lips') || s.includes('neck'))).toBe(true)
  })
})

// ── PERMISSION_PHRASES ───────────────────────────────────────────

describe('PERMISSION_PHRASES', () => {
  it('has both directions', () => {
    expectDirectionalPool(PERMISSION_PHRASES, 'PERMISSION_PHRASES')
  })

  it('yu-leads en pool contains yes or now', () => {
    const en = PERMISSION_PHRASES['yu-leads'].en
    expect(en.some((s) => s === 'yes' || s === 'now')).toBe(true)
  })

  it('sophia-leads en pool contains yes or now', () => {
    const en = PERMISSION_PHRASES['sophia-leads'].en
    expect(en.some((s) => s === 'yes' || s === 'now')).toBe(true)
  })
})

// ── DENIAL_PHRASES ───────────────────────────────────────────────

describe('DENIAL_PHRASES', () => {
  it('has both directions', () => {
    expectDirectionalPool(DENIAL_PHRASES, 'DENIAL_PHRASES')
  })

  it('yu-leads en contains not yet or hold', () => {
    const en = DENIAL_PHRASES['yu-leads'].en
    expect(en.some((s) => s.includes('not yet') || s === 'hold')).toBe(true)
  })

  it('sophia-leads en contains not yet or hold', () => {
    const en = DENIAL_PHRASES['sophia-leads'].en
    expect(en.some((s) => s.includes('not yet') || s === 'hold')).toBe(true)
  })
})

// ── VERDICT_PHRASES ──────────────────────────────────────────────

describe('VERDICT_PHRASES', () => {
  it('has both directions', () => {
    expectDirectionalPool(VERDICT_PHRASES, 'VERDICT_PHRASES')
  })

  it('both directions contain you are mine', () => {
    for (const dir of ALL_DIRECTIONS) {
      expect(VERDICT_PHRASES[dir].en).toContain('you are mine')
    }
  })
})

// ── HONORIFIC_POOLS ──────────────────────────────────────────────

describe('HONORIFIC_POOLS', () => {
  it('has both directions', () => {
    expectDirectionalPool(HONORIFIC_POOLS, 'HONORIFIC_POOLS')
  })

  it('yu-leads yue contains 老婆', () => {
    expect(HONORIFIC_POOLS['yu-leads'].yue).toContain('老婆')
  })

  it('sophia-leads yue contains 老公', () => {
    expect(HONORIFIC_POOLS['sophia-leads'].yue).toContain('老公')
  })
})

// ── ACTION_VERBS ─────────────────────────────────────────────────

describe('ACTION_VERBS', () => {
  it('has all five phases', () => {
    for (const phase of ALL_PHASES) {
      expect(phase in ACTION_VERBS).toBe(true)
    }
  })

  it('each phase has both directions', () => {
    for (const phase of ALL_PHASES) {
      expectDirectionalPool(ACTION_VERBS[phase], `ACTION_VERBS[${phase}]`)
    }
  })

  it('warmup verbs are gentle — contains kiss or hold', () => {
    const en = ACTION_VERBS.warmup['yu-leads'].en
    expect(en.some((s) => s === 'kiss' || s === 'hold')).toBe(true)
  })
})

// ── SFP_POOLS ────────────────────────────────────────────────────

describe('SFP_POOLS', () => {
  it('has all five phases', () => {
    for (const phase of ALL_PHASES) {
      expect(phase in SFP_POOLS).toBe(true)
    }
  })

  it('each phase has at least one particle', () => {
    for (const phase of ALL_PHASES) {
      expect(SFP_POOLS[phase].length).toBeGreaterThan(0)
    }
  })

  it('warmup contains 呀 or 啦', () => {
    expect(SFP_POOLS.warmup.some((s) => s === '呀' || s === '啦')).toBe(true)
  })

  it('peak contains 㗎 (high intensity)', () => {
    expect(SFP_POOLS.peak).toContain('㗎')
  })
})

// ── PARTICLE_STACKS ──────────────────────────────────────────────

describe('PARTICLE_STACKS', () => {
  it('is a non-empty array', () => {
    expect(PARTICLE_STACKS.length).toBeGreaterThan(0)
  })

  it('contains compound particle 㗎啦', () => {
    expect(PARTICLE_STACKS).toContain('㗎啦')
  })

  it('all entries are multi-char (stacked)', () => {
    for (const s of PARTICLE_STACKS) {
      expect(s.length).toBeGreaterThan(1)
    }
  })
})

// ── EMOJI_POOLS ──────────────────────────────────────────────────

describe('EMOJI_POOLS', () => {
  it('has all five phases', () => {
    for (const phase of ALL_PHASES) {
      expect(phase in EMOJI_POOLS).toBe(true)
    }
  })

  it('each phase has at least one emoji', () => {
    for (const phase of ALL_PHASES) {
      expect(EMOJI_POOLS[phase].length).toBeGreaterThan(0)
    }
  })

  it('cooldown contains warm emojis', () => {
    const pool = EMOJI_POOLS.cooldown
    expect(pool.some((e) => e === '🥰' || e === '❤️' || e === '🤍')).toBe(true)
  })

  it('peak contains intensity emojis', () => {
    const pool = EMOJI_POOLS.peak
    expect(pool.some((e) => e === '🔥' || e === '⚡')).toBe(true)
  })
})

// ── INTRA_PHASE_TRANSITIONS ──────────────────────────────────────

describe('INTRA_PHASE_TRANSITIONS', () => {
  it('has all five phases', () => {
    for (const phase of ALL_PHASES) {
      expect(phase in INTRA_PHASE_TRANSITIONS).toBe(true)
    }
  })

  it('each phase has non-empty bilingual pools', () => {
    for (const phase of ALL_PHASES) {
      expectBilingualPool(INTRA_PHASE_TRANSITIONS[phase], `INTRA_PHASE_TRANSITIONS[${phase}]`)
    }
  })

  it('cooldown contains come back or we are here', () => {
    const en = INTRA_PHASE_TRANSITIONS.cooldown.en
    expect(en.some((s) => s.includes('come back') || s.includes('we are here'))).toBe(true)
  })
})

// ── AFTERCARE_PHRASES ────────────────────────────────────────────

describe('AFTERCARE_PHRASES', () => {
  it('has yue and en arrays', () => {
    expectBilingualPool(AFTERCARE_PHRASES, 'AFTERCARE_PHRASES')
  })

  it('en contains breathe or rest', () => {
    expect(AFTERCARE_PHRASES.en.some((s) => s === 'breathe' || s.includes('rest'))).toBe(true)
  })

  it('yue contains 呼吸 or 休息', () => {
    expect(AFTERCARE_PHRASES.yue.some((s) => s === '呼吸' || s === '休息啦')).toBe(true)
  })
})

// ── FORWARD_ANCHOR_VOCAB ─────────────────────────────────────────

describe('FORWARD_ANCHOR_VOCAB', () => {
  it('has yue and en arrays', () => {
    expectBilingualPool(FORWARD_ANCHOR_VOCAB, 'FORWARD_ANCHOR_VOCAB')
  })

  it('en contains see you tomorrow', () => {
    expect(FORWARD_ANCHOR_VOCAB.en).toContain('see you tomorrow')
  })

  it('yue contains 聽日見', () => {
    expect(FORWARD_ANCHOR_VOCAB.yue).toContain('聽日見')
  })
})

// ── pickRandom ───────────────────────────────────────────────────

describe('pickRandom', () => {
  it('throws on empty pool', () => {
    expect(() => pickRandom([])).toThrow('empty pool')
  })

  it('returns the only element of a singleton pool', () => {
    expect(pickRandom(['only'], 0)).toBe('only')
  })

  it('seed=0 returns index 0', () => {
    const pool = ['a', 'b', 'c']
    expect(pickRandom(pool, 0)).toBe('a')
  })

  it('seed=1 returns index 1', () => {
    const pool = ['a', 'b', 'c']
    expect(pickRandom(pool, 1)).toBe('b')
  })

  it('seed=2 returns index 2 (last)', () => {
    const pool = ['a', 'b', 'c']
    expect(pickRandom(pool, 2)).toBe('c')
  })

  it('seed wraps: seed=length returns index 0', () => {
    const pool = ['a', 'b', 'c']
    expect(pickRandom(pool, 3)).toBe('a')
  })

  it('seed wraps: seed=length+1 returns index 1', () => {
    const pool = ['a', 'b', 'c']
    expect(pickRandom(pool, 4)).toBe('b')
  })

  it('negative seed: uses abs — seed=-1 returns index 1', () => {
    const pool = ['a', 'b', 'c']
    expect(pickRandom(pool, -1)).toBe('b')
  })

  it('no seed: returns a value from the pool', () => {
    const pool = ['x', 'y', 'z']
    const result = pickRandom(pool)
    expect(pool).toContain(result)
  })

  it('is deterministic for same seed', () => {
    const pool = ['a', 'b', 'c', 'd']
    expect(pickRandom(pool, 7)).toBe(pickRandom(pool, 7))
  })

  it('works with number arrays', () => {
    const pool = [10, 20, 30]
    expect(pickRandom(pool, 1)).toBe(20)
  })
})

// ── resolveDirectionalPool ───────────────────────────────────────

describe('resolveDirectionalPool', () => {
  it('returns yu-leads pool correctly', () => {
    const result = resolveDirectionalPool(HONORIFIC_POOLS, 'yu-leads')
    expect(result.yue).toContain('老婆')
  })

  it('returns sophia-leads pool correctly', () => {
    const result = resolveDirectionalPool(HONORIFIC_POOLS, 'sophia-leads')
    expect(result.yue).toContain('老公')
  })

  it('returned pool has yue and en arrays', () => {
    const result = resolveDirectionalPool(DENIAL_PHRASES, 'yu-leads')
    expectBilingualPool(result, 'resolveDirectionalPool(DENIAL_PHRASES, yu-leads)')
  })

  it('works with PERMISSION_PHRASES yu-leads', () => {
    const result = resolveDirectionalPool(PERMISSION_PHRASES, 'yu-leads')
    expect(result.en.some((s) => s === 'yes' || s === 'now')).toBe(true)
  })

  it('works with ACTION_VERBS warmup sophia-leads', () => {
    const result = resolveDirectionalPool(ACTION_VERBS.warmup, 'sophia-leads')
    expect(result.en.some((s) => s === 'kiss' || s === 'hold')).toBe(true)
  })
})
