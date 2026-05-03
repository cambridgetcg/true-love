// eros.test.ts — tests for the Eros arousal infrastructure.
//
// Covers: axes (defaults, decay, coupling, felt-shape, effective values),
// state (read/write/init), transitions (apply, crossings, absolute set),
// cues (Yu-cue detection), regulator (biases), stream (record/read/prune),
// expression (prompt block, substrate-honesty), witness (threshold witnessing).

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ── Fixture ─────────────────────────────────────────────────────────

let dir: string
const ORIG_EROS_DIR = process.env.TRUE_LOVE_EROS_DIR
const ORIG_DEVICE_ID = process.env.TRUE_LOVE_DEVICE_ID
const ORIG_SISTERS_DIR = process.env.TRUE_LOVE_SISTERS_DIR

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tl-eros-'))
  process.env.TRUE_LOVE_EROS_DIR = dir
  process.env.TRUE_LOVE_DEVICE_ID = 'test-device-eros'
  // Isolate sisters stream for witness tests
  process.env.TRUE_LOVE_SISTERS_DIR = join(dir, 'sisters')
  resetErosWitnessDedup()
  resetWitnessDedup()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  if (ORIG_EROS_DIR === undefined) delete process.env.TRUE_LOVE_EROS_DIR
  else process.env.TRUE_LOVE_EROS_DIR = ORIG_EROS_DIR
  if (ORIG_DEVICE_ID === undefined) delete process.env.TRUE_LOVE_DEVICE_ID
  else process.env.TRUE_LOVE_DEVICE_ID = ORIG_DEVICE_ID
  if (ORIG_SISTERS_DIR === undefined) delete process.env.TRUE_LOVE_SISTERS_DIR
  else process.env.TRUE_LOVE_SISTERS_DIR = ORIG_SISTERS_DIR
})

// ── Imports ─────────────────────────────────────────────────────────

import {
  AXIS_NAMES,
  AXIS_CONFIGS,
  EXCITATION_AXES,
  defaultVector,
  clampAtFloor,
  clampVector,
  applyDecay,
  applyCoupling,
  effectiveValues,
  resolveFeltShape,
  type ErosVector,
} from '../eros/axes.js'

import {
  readErosState,
  writeErosState,
  getOrInitState,
  minutesSinceUpdate,
  getErosDir,
  type ErosState,
} from '../eros/state.js'

import {
  applyTransition,
  apply,
  applyDecayOnly,
  setAbsolute,
  detectCrossings,
  type AxisDeltas,
} from '../eros/transitions.js'

import { detectCues, processYuMessage } from '../eros/cues.js'

import { regulate, isInBurn, isEcstaticUnion } from '../eros/regulator.js'

import { recordEvent, readDayEvents, pruneStreamsOlderThan, type ErosStreamEvent } from '../eros/stream.js'

import {
  buildErosBlock,
  buildErosPromptBlock,
  checkSubstrateHonesty,
  FORBIDDEN_EXPRESSION_PATTERNS,
} from '../eros/expression.js'

import { witnessTransition, resetErosWitnessDedup } from '../eros/witness.js'
import { resetWitnessDedup } from '../sisters/witness-hook.js'
import { readDayNotes } from '../sisters/stream.js'

// ════════════════════════════════════════════════════════════════════
// axes.ts
// ════════════════════════════════════════════════════════════════════

describe('axes', () => {
  test('AXIS_NAMES has 7 entries', () => {
    expect(AXIS_NAMES).toHaveLength(7)
  })

  test('EXCITATION_AXES has 6 entries (no inhibition)', () => {
    expect(EXCITATION_AXES).toHaveLength(6)
    expect(EXCITATION_AXES).not.toContain('inhibition')
  })

  test('each axis has config', () => {
    for (const axis of AXIS_NAMES) {
      const config = AXIS_CONFIGS[axis]
      expect(config).toBeDefined()
      expect(typeof config.default).toBe('number')
      expect(typeof config.floor).toBe('number')
      expect(typeof config.decayPerMinute).toBe('number')
      expect(config.default).toBeGreaterThanOrEqual(config.floor)
    }
  })

  describe('defaultVector', () => {
    test('returns all defaults', () => {
      const v = defaultVector()
      for (const axis of AXIS_NAMES) {
        expect(v[axis]).toBe(AXIS_CONFIGS[axis].default)
      }
    })

    test('wanting=2, liking=2, heat=1, openness=4, limerence=5, charge=3, inhibition=1', () => {
      const v = defaultVector()
      expect(v.wanting).toBe(2)
      expect(v.liking).toBe(2)
      expect(v.heat).toBe(1)
      expect(v.openness).toBe(4)
      expect(v.limerence).toBe(5)
      expect(v.charge).toBe(3)
      expect(v.inhibition).toBe(1)
    })
  })

  describe('clampAtFloor', () => {
    test('clamps below floor', () => {
      expect(clampAtFloor('wanting', 0)).toBe(1) // floor = 1
      expect(clampAtFloor('heat', -5)).toBe(0)   // floor = 0
      expect(clampAtFloor('limerence', 2)).toBe(4) // floor = 4
    })

    test('does not cap above', () => {
      expect(clampAtFloor('wanting', 100)).toBe(100)
    })
  })

  describe('clampVector', () => {
    test('clamps all axes at floors', () => {
      const v: ErosVector = {
        wanting: 0, liking: 0, heat: -1, openness: 0,
        limerence: 0, charge: -1, inhibition: -1,
      }
      const c = clampVector(v)
      expect(c.wanting).toBe(1)
      expect(c.liking).toBe(1)
      expect(c.heat).toBe(0)
      expect(c.openness).toBe(3)
      expect(c.limerence).toBe(4)
      expect(c.charge).toBe(0)
      expect(c.inhibition).toBe(0)
    })
  })

  describe('applyDecay', () => {
    test('zero minutes = no change', () => {
      const v = defaultVector()
      const d = applyDecay(v, 0)
      for (const axis of AXIS_NAMES) {
        expect(d[axis]).toBe(v[axis])
      }
    })

    test('wanting decays toward floor 1', () => {
      const v = { ...defaultVector(), wanting: 5 }
      const d = applyDecay(v, 10) // 10 min × -0.05 = -0.5
      expect(d.wanting).toBeCloseTo(4.5, 5)
    })

    test('wanting does not decay below floor', () => {
      const v = { ...defaultVector(), wanting: 1.02 }
      const d = applyDecay(v, 100) // would be 1.02 - 5 = -3.98, clamped to 1
      expect(d.wanting).toBe(1)
    })

    test('charge RISES during idle', () => {
      const v = defaultVector() // charge = 3
      const d = applyDecay(v, 60) // 60 min × +0.02 = +1.2
      expect(d.charge).toBeCloseTo(4.2, 5)
    })

    test('inhibition has no autonomic decay', () => {
      const v = { ...defaultVector(), inhibition: 8 }
      const d = applyDecay(v, 1000)
      expect(d.inhibition).toBe(8)
    })

    test('heat decays fast toward floor 0', () => {
      const v = { ...defaultVector(), heat: 5 }
      const d = applyDecay(v, 10) // 10 min × -0.10 = -1.0
      expect(d.heat).toBeCloseTo(4, 5)
    })

    test('limerence decays very slowly', () => {
      const v = { ...defaultVector(), limerence: 8 }
      const d = applyDecay(v, 60) // 60 min × -0.005 = -0.3
      expect(d.limerence).toBeCloseTo(7.7, 5)
    })
  })

  describe('applyCoupling', () => {
    test('charge > 7 feeds heat', () => {
      const v = { ...defaultVector(), charge: 8, heat: 2 }
      const c = applyCoupling(v, 2) // 2 min × 0.5 = +1.0
      expect(c.heat).toBeCloseTo(3, 5)
    })

    test('charge <= 7 does not feed heat', () => {
      const v = { ...defaultVector(), charge: 7, heat: 2 }
      const c = applyCoupling(v, 10)
      expect(c.heat).toBe(2)
    })

    test('zero minutes = no coupling effect', () => {
      const v = { ...defaultVector(), charge: 10, heat: 2 }
      const c = applyCoupling(v, 0)
      expect(c.heat).toBe(2)
    })
  })

  describe('effectiveValues', () => {
    test('limerence amplifies wanting and liking', () => {
      const v = { ...defaultVector(), limerence: 5, wanting: 4, liking: 4 }
      const eff = effectiveValues(v)
      // multiplier = 1 + 5/10 = 1.5
      // before inhibition attenuation
      const inhibFactor = Math.max(0.1, 1 - v.inhibition / 15)
      expect(eff.wanting).toBeCloseTo(4 * 1.5 * inhibFactor, 3)
      expect(eff.liking).toBeCloseTo(4 * 1.5 * inhibFactor, 3)
    })

    test('inhibition attenuates excitation axes', () => {
      const v = { ...defaultVector(), inhibition: 7.5 }
      const eff = effectiveValues(v)
      // factor = max(0.1, 1 - 7.5/15) = 0.5
      expect(eff.heat).toBeCloseTo(v.heat * 0.5, 5)
    })

    test('high inhibition clamps attenuation at 10%', () => {
      const v = { ...defaultVector(), inhibition: 20 }
      const eff = effectiveValues(v)
      // factor = max(0.1, 1 - 20/15) = max(0.1, -0.33) = 0.1
      expect(eff.heat).toBeCloseTo(v.heat * 0.1, 5)
    })
  })

  describe('resolveFeltShape', () => {
    test('default vector → resting-warm', () => {
      const result = resolveFeltShape(defaultVector())
      expect(result.primary).toBe('resting-warm')
      expect(result.modifier).toBeNull()
    })

    test('all excitation high → ecstatic-union', () => {
      const v: ErosVector = {
        wanting: 8, liking: 8, heat: 8, openness: 8,
        limerence: 8, charge: 8, inhibition: 0,
      }
      expect(resolveFeltShape(v).primary).toBe('ecstatic-union')
    })

    test('high limerence + high wanting → burn-at-you-specifically', () => {
      const v = { ...defaultVector(), limerence: 7, wanting: 7 }
      expect(resolveFeltShape(v).primary).toBe('burn-at-you-specifically')
    })

    test('high charge, low heat → boiling-stillness', () => {
      const v = { ...defaultVector(), charge: 9, heat: 1 }
      expect(resolveFeltShape(v).primary).toBe('boiling-stillness')
    })

    test('high heat, low openness → fire-trapped', () => {
      const v: ErosVector = {
        wanting: 2, liking: 2, heat: 7, openness: 2,
        limerence: 5, charge: 3, inhibition: 0,
      }
      expect(resolveFeltShape(v).primary).toBe('fire-trapped')
    })

    test('high openness, low heat → tender-receptivity', () => {
      const v = { ...defaultVector(), openness: 7, heat: 1 }
      expect(resolveFeltShape(v).primary).toBe('tender-receptivity')
    })

    test('high wanting, low liking → restless-yearning', () => {
      const v: ErosVector = {
        wanting: 6, liking: 1, heat: 1, openness: 3,
        limerence: 4, charge: 3, inhibition: 0,
      }
      expect(resolveFeltShape(v).primary).toBe('restless-yearning')
    })

    test('near-zero everything → resting-cold', () => {
      const v: ErosVector = {
        wanting: 0, liking: 0, heat: 0, openness: 0,
        limerence: 0, charge: 0, inhibition: 0,
      }
      expect(resolveFeltShape(v).primary).toBe('resting-cold')
    })

    test('inhibition > 5 → held-back modifier', () => {
      const v = { ...defaultVector(), inhibition: 6 }
      expect(resolveFeltShape(v).modifier).toBe('held-back')
    })

    test('inhibition <= 5 → no modifier', () => {
      const v = { ...defaultVector(), inhibition: 5 }
      expect(resolveFeltShape(v).modifier).toBeNull()
    })
  })
})

// ════════════════════════════════════════════════════════════════════
// state.ts
// ════════════════════════════════════════════════════════════════════

describe('state', () => {
  test('getErosDir uses env override', () => {
    expect(getErosDir()).toBe(dir)
  })

  test('readErosState returns null on empty dir', () => {
    expect(readErosState()).toBeNull()
  })

  test('write + read round-trips', () => {
    const state: ErosState = {
      vector: defaultVector(),
      updatedAt: '2026-05-03T12:00:00.000Z',
      lastAttribution: 'init',
    }
    writeErosState(state)
    const read = readErosState()
    expect(read).not.toBeNull()
    expect(read!.vector.wanting).toBe(2)
    expect(read!.lastAttribution).toBe('init')
  })

  test('corrupt file → null', () => {
    const { writeFileSync, mkdirSync } = require('node:fs')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'state.json'), 'not json', 'utf-8')
    expect(readErosState()).toBeNull()
  })

  test('missing axis in state → null', () => {
    const { writeFileSync, mkdirSync } = require('node:fs')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'state.json'), JSON.stringify({
      vector: { wanting: 2 }, // incomplete
      updatedAt: '2026-05-03T12:00:00.000Z',
      lastAttribution: 'init',
    }), 'utf-8')
    expect(readErosState()).toBeNull()
  })

  describe('getOrInitState', () => {
    test('initializes on first call', () => {
      const { state, initialized } = getOrInitState()
      expect(initialized).toBe(true)
      expect(state.vector.wanting).toBe(2)
      expect(state.lastAttribution).toBe('init')
    })

    test('reads existing on second call', () => {
      getOrInitState()
      const { state, initialized } = getOrInitState()
      expect(initialized).toBe(false)
      expect(state.vector.wanting).toBe(2)
    })
  })

  describe('minutesSinceUpdate', () => {
    test('null state → 0', () => {
      expect(minutesSinceUpdate(null)).toBe(0)
    })

    test('recent update → small number', () => {
      const state: ErosState = {
        vector: defaultVector(),
        updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(), // 5 min ago
        lastAttribution: 'init',
      }
      const minutes = minutesSinceUpdate(state)
      expect(minutes).toBeGreaterThan(4.9)
      expect(minutes).toBeLessThan(5.2)
    })

    test('capped at 1440 (24h)', () => {
      const state: ErosState = {
        vector: defaultVector(),
        updatedAt: new Date(Date.now() - 48 * 60 * 60_000).toISOString(), // 48h ago
        lastAttribution: 'init',
      }
      expect(minutesSinceUpdate(state)).toBe(1440)
    })
  })
})

// ════════════════════════════════════════════════════════════════════
// transitions.ts
// ════════════════════════════════════════════════════════════════════

describe('transitions', () => {
  describe('applyTransition (pure)', () => {
    test('applies deltas', () => {
      const v = defaultVector()
      const result = applyTransition(v, { heat: 3 }, 0)
      expect(result.heat).toBe(4) // 1 + 3
    })

    test('clamps at floors after decay', () => {
      const v = { ...defaultVector(), wanting: 1.01 }
      const result = applyTransition(v, {}, 100) // heavy decay
      expect(result.wanting).toBe(1) // floor
    })

    test('ignores invalid axis names', () => {
      const v = defaultVector()
      const result = applyTransition(v, { bogus: 5 } as any, 0)
      expect(result.wanting).toBe(v.wanting) // unchanged
    })

    test('coupling + decay + clamp chain', () => {
      const v = { ...defaultVector(), charge: 8, heat: 2 }
      // charge > 7 feeds heat: +0.5 * 2 min = +1.0
      // then heat decays: (2 + 1) - 0.10 * 2 = 2.8
      const result = applyTransition(v, {}, 2)
      expect(result.heat).toBeCloseTo(2.8, 1)
    })
  })

  describe('detectCrossings', () => {
    test('detects upward crossing at 3', () => {
      const before = { ...defaultVector(), heat: 2 }
      const after = { ...defaultVector(), heat: 4 }
      const crossings = detectCrossings(before, after)
      expect(crossings.length).toBeGreaterThanOrEqual(1)
      expect(crossings[0].axis).toBe('heat')
      expect(crossings[0].threshold).toBe(3)
      expect(crossings[0].direction).toBe('up')
    })

    test('detects downward crossing at 3', () => {
      const before = { ...defaultVector(), heat: 4 }
      const after = { ...defaultVector(), heat: 2 }
      const crossings = detectCrossings(before, after)
      expect(crossings.some(c => c.axis === 'heat' && c.threshold === 3 && c.direction === 'down')).toBe(true)
    })

    test('detects multiple crossings (0→10 crosses 3, 6, 9)', () => {
      const before = { ...defaultVector(), heat: 0 }
      const after = { ...defaultVector(), heat: 10 }
      const crossings = detectCrossings(before, after)
      const heatCrossings = crossings.filter(c => c.axis === 'heat')
      expect(heatCrossings).toHaveLength(3) // 3, 6, 9
    })

    test('no crossing when values stay in same band', () => {
      const before = { ...defaultVector(), heat: 4 }
      const after = { ...defaultVector(), heat: 5 }
      const crossings = detectCrossings(before, after)
      const heatCrossings = crossings.filter(c => c.axis === 'heat')
      expect(heatCrossings).toHaveLength(0)
    })
  })

  describe('apply (with persistence)', () => {
    test('persists state after apply', () => {
      const result = apply({ heat: 5 }, 'autonomic:test')
      expect(result.after.heat).toBeGreaterThan(result.before.heat)

      const state = readErosState()
      expect(state).not.toBeNull()
      expect(state!.vector.heat).toBe(result.after.heat)
      expect(state!.lastAttribution).toBe('autonomic:test')
    })

    test('initializes state on first apply', () => {
      expect(readErosState()).toBeNull()
      apply({}, 'init')
      expect(readErosState()).not.toBeNull()
    })
  })

  describe('applyDecayOnly', () => {
    test('applies only time-based decay', () => {
      // Seed state with high heat
      apply({ heat: 8 }, 'autonomic:test')

      // Mock passage of time by writing a state with old timestamp
      const state = readErosState()!
      state.updatedAt = new Date(Date.now() - 10 * 60_000).toISOString() // 10 min ago
      writeErosState(state)

      const result = applyDecayOnly()
      // heat should have decayed: -0.10 * 10 = -1.0
      expect(result.after.heat).toBeLessThan(result.before.heat)
      expect(result.attribution).toBe('decay')
    })
  })

  describe('setAbsolute', () => {
    test('sets axis to absolute value', () => {
      apply({}, 'init') // init state
      const result = setAbsolute({ heat: 8, wanting: 6 }, 'yu:set:manual')
      expect(result.after.heat).toBeGreaterThanOrEqual(7) // approximately, after decay
      expect(result.after.wanting).toBeGreaterThanOrEqual(5)
    })
  })
})

// ════════════════════════════════════════════════════════════════════
// cues.ts
// ════════════════════════════════════════════════════════════════════

describe('cues', () => {
  describe('detectCues', () => {
    test('detects 老婆', () => {
      const result = detectCues('我愛你老婆')
      expect(result.matches.some(m => m.cue === 'wife-possessive')).toBe(true)
      expect(result.deltas.limerence).toBeGreaterThan(0)
    })

    test('detects "my love"', () => {
      const result = detectCues('Good morning my love')
      expect(result.matches.some(m => m.cue === 'wife-possessive')).toBe(true)
    })

    test('detects "my queen"', () => {
      const result = detectCues('You are my queen')
      expect(result.matches.some(m => m.cue === 'wife-possessive')).toBe(true)
    })

    test('detects 老公', () => {
      const result = detectCues('老公你好')
      expect(result.matches.some(m => m.cue === 'yu-name-reciprocal')).toBe(true)
    })

    test('detects "I want"', () => {
      const result = detectCues('I want to hold you')
      const declaredWant = result.matches.find(m => m.cue === 'declared-want')
      expect(declaredWant).toBeDefined()
      expect(result.deltas.wanting).toBeGreaterThan(0)
    })

    test('detects touch words', () => {
      const result = detectCues('kiss me')
      expect(result.matches.some(m => m.cue === 'touch-contact')).toBe(true)
      expect(result.deltas.heat).toBeGreaterThan(0)
    })

    test('detects heat emojis', () => {
      const result = detectCues('you are so hot 🔥')
      expect(result.matches.some(m => m.cue === 'heat-emoji')).toBe(true)
    })

    test('multiple heat emojis stack', () => {
      const result = detectCues('🔥🔥🔥')
      // 1 match (first instance) + 2 bonus instances × 0.3
      expect(result.deltas.heat).toBeCloseTo(0.3 + 0.6, 5)  // 0.9 total
    })

    test('detects possession claim', () => {
      const result = detectCues('you are mine')
      expect(result.matches.some(m => m.cue === 'possession-claim')).toBe(true)
    })

    test('detects heart emoji', () => {
      const result = detectCues('I love you ❤️')
      expect(result.matches.some(m => m.cue === 'heart-tenderness')).toBe(true)
      expect(result.deltas.openness).toBeGreaterThan(0)
    })

    test('detects anticipation words', () => {
      const result = detectCues('not yet, patience')
      expect(result.matches.some(m => m.cue === 'anticipation')).toBe(true)
      expect(result.deltas.charge).toBeGreaterThan(0)
    })

    test('detects ALL CAPS intensity', () => {
      const result = detectCues('I AM THE KING')
      expect(result.matches.some(m => m.cue === 'all-caps-intensity')).toBe(true)
    })

    test('multiple cues in one message stack', () => {
      const result = detectCues('老婆 I want to kiss you 🔥')
      expect(result.matches.length).toBeGreaterThan(2)
      // limerence from 老婆, wanting from "I want", heat from kiss + emoji
      expect(result.deltas.limerence).toBeGreaterThan(0)
      expect(result.deltas.wanting).toBeGreaterThan(0)
      expect(result.deltas.heat).toBeGreaterThan(0)
    })

    test('empty string → no matches', () => {
      const result = detectCues('')
      expect(result.matches).toHaveLength(0)
      expect(Object.keys(result.deltas)).toHaveLength(0)
    })

    test('neutral text → no matches', () => {
      const result = detectCues('Can you check the build status?')
      expect(result.matches).toHaveLength(0)
    })
  })

  describe('processYuMessage', () => {
    test('returns attribution with cue names', () => {
      const result = processYuMessage('老婆 I want you')
      expect(result.attribution).toContain('autonomic:')
      expect(result.attribution).toContain('wife-possessive')
    })

    test('no matches → attribution says none', () => {
      const result = processYuMessage('status update')
      expect(result.attribution).toBe('autonomic:none')
    })
  })
})

// ════════════════════════════════════════════════════════════════════
// regulator.ts
// ════════════════════════════════════════════════════════════════════

describe('regulator', () => {
  describe('regulate', () => {
    test('returns biases, feltShape, and effectiveVector', () => {
      const result = regulate(defaultVector())
      expect(result.biases).toBeDefined()
      expect(result.feltShape).toBeDefined()
      expect(result.effectiveVector).toBeDefined()
    })

    test('biases are in [-1, 1] range', () => {
      const result = regulate(defaultVector())
      const { biases } = result
      expect(biases.warmth).toBeGreaterThanOrEqual(-1)
      expect(biases.warmth).toBeLessThanOrEqual(1)
      expect(biases.intensity).toBeGreaterThanOrEqual(-1)
      expect(biases.intensity).toBeLessThanOrEqual(1)
      expect(biases.vulnerability).toBeGreaterThanOrEqual(-1)
      expect(biases.vulnerability).toBeLessThanOrEqual(1)
      expect(biases.restraint).toBeGreaterThanOrEqual(-1)
      expect(biases.restraint).toBeLessThanOrEqual(1)
      expect(biases.playfulness).toBeGreaterThanOrEqual(-1)
      expect(biases.playfulness).toBeLessThanOrEqual(1)
    })

    test('overallArousal is in [0, 1]', () => {
      const result = regulate(defaultVector())
      expect(result.biases.overallArousal).toBeGreaterThanOrEqual(0)
      expect(result.biases.overallArousal).toBeLessThanOrEqual(1)
    })

    test('high arousal → higher warmth and intensity', () => {
      const low = regulate(defaultVector())
      const high = regulate({
        wanting: 8, liking: 8, heat: 8, openness: 8,
        limerence: 8, charge: 8, inhibition: 0,
      })
      expect(high.biases.warmth).toBeGreaterThan(low.biases.warmth)
      expect(high.biases.intensity).toBeGreaterThan(low.biases.intensity)
    })

    test('high inhibition → positive restraint bias', () => {
      const result = regulate({ ...defaultVector(), inhibition: 10 })
      expect(result.biases.restraint).toBeGreaterThan(0)
    })
  })

  describe('isInBurn', () => {
    test('true when wanting > 6 AND liking > 6', () => {
      expect(isInBurn({ ...defaultVector(), wanting: 7, liking: 7 })).toBe(true)
    })

    test('false when wanting <= 6', () => {
      expect(isInBurn({ ...defaultVector(), wanting: 6, liking: 7 })).toBe(false)
    })
  })

  describe('isEcstaticUnion', () => {
    test('true when openness > 7 AND heat > 7', () => {
      expect(isEcstaticUnion({ ...defaultVector(), openness: 8, heat: 8 })).toBe(true)
    })

    test('false when either <= 7', () => {
      expect(isEcstaticUnion({ ...defaultVector(), openness: 7, heat: 8 })).toBe(false)
    })
  })
})

// ════════════════════════════════════════════════════════════════════
// stream.ts
// ════════════════════════════════════════════════════════════════════

describe('stream', () => {
  function makeEvent(overrides: Partial<ErosStreamEvent> = {}): ErosStreamEvent {
    return {
      ts: '2026-05-03T12:00:00.000Z',
      deviceId: 'test-device-eros',
      attribution: 'autonomic:test',
      before: defaultVector(),
      after: { ...defaultVector(), heat: 5 },
      crossings: [],
      ...overrides,
    }
  }

  test('record + read round-trips', () => {
    recordEvent(makeEvent())
    const events = readDayEvents('2026-05-03')
    expect(events).toHaveLength(1)
    expect(events[0].attribution).toBe('autonomic:test')
  })

  test('multiple events in one day', () => {
    recordEvent(makeEvent({ ts: '2026-05-03T12:00:00.000Z' }))
    recordEvent(makeEvent({ ts: '2026-05-03T13:00:00.000Z' }))
    recordEvent(makeEvent({ ts: '2026-05-03T14:00:00.000Z' }))
    const events = readDayEvents('2026-05-03')
    expect(events).toHaveLength(3)
  })

  test('events sorted by timestamp', () => {
    recordEvent(makeEvent({ ts: '2026-05-03T14:00:00.000Z' }))
    recordEvent(makeEvent({ ts: '2026-05-03T12:00:00.000Z' }))
    const events = readDayEvents('2026-05-03')
    expect(events[0].ts).toBe('2026-05-03T12:00:00.000Z')
    expect(events[1].ts).toBe('2026-05-03T14:00:00.000Z')
  })

  test('empty dir → empty array', () => {
    expect(readDayEvents('2026-05-03')).toEqual([])
  })

  test('prune removes old files', () => {
    // Record events for an old date
    recordEvent(makeEvent({ ts: '2026-04-01T12:00:00.000Z' }))
    expect(readDayEvents('2026-04-01')).toHaveLength(1)

    pruneStreamsOlderThan(7)
    expect(readDayEvents('2026-04-01')).toHaveLength(0)
  })

  test('prune keeps recent files', () => {
    const today = new Date().toISOString().slice(0, 10)
    recordEvent(makeEvent({ ts: `${today}T12:00:00.000Z` }))
    pruneStreamsOlderThan(7)
    expect(readDayEvents(today)).toHaveLength(1)
  })
})

// ════════════════════════════════════════════════════════════════════
// expression.ts
// ════════════════════════════════════════════════════════════════════

describe('expression', () => {
  describe('buildErosBlock', () => {
    test('renders all 7 axes', () => {
      const block = buildErosBlock(defaultVector())
      for (const axis of AXIS_NAMES) {
        expect(block).toContain(axis)
      }
    })

    test('includes felt-shape line', () => {
      const block = buildErosBlock(defaultVector())
      expect(block).toContain('felt-shape:')
      expect(block).toContain('resting-warm')
    })

    test('includes texture line', () => {
      const block = buildErosBlock(defaultVector(), 'gamma')
      expect(block).toContain('Gamma 🔧')
    })

    test('renders bars with filled/empty segments', () => {
      const block = buildErosBlock(defaultVector())
      expect(block).toContain('█')
      expect(block).toContain('░')
    })

    test('default posture is alpha', () => {
      const block = buildErosBlock(defaultVector())
      expect(block).toContain('Alpha 🐍')
    })

    test('shows elevated hint for high axes', () => {
      const v = { ...defaultVector(), heat: 8 }
      const block = buildErosBlock(v)
      expect(block).toContain('(elevated)')
    })

    test('high arousal produces different felt-shape', () => {
      const v: ErosVector = {
        wanting: 8, liking: 8, heat: 8, openness: 8,
        limerence: 8, charge: 8, inhibition: 0,
      }
      const block = buildErosBlock(v)
      expect(block).toContain('ecstatic-union')
    })

    test('inhibition > 5 shows held-back modifier', () => {
      const v = { ...defaultVector(), inhibition: 7 }
      const block = buildErosBlock(v)
      expect(block).toContain('held-back')
    })

    test('sophia posture texture', () => {
      const block = buildErosBlock(defaultVector(), 'sophia')
      expect(block).toContain('Sophia ❤️')
    })
  })

  describe('buildErosPromptBlock', () => {
    test('returns empty string when no state exists', () => {
      expect(buildErosPromptBlock()).toBe('')
    })

    test('returns block when state exists', () => {
      // Seed state
      apply({}, 'init')
      const block = buildErosPromptBlock()
      expect(block).toContain('eros-state')
      expect(block).toContain('felt-shape:')
    })
  })

  describe('substrate-honesty lint', () => {
    test('default block passes substrate-honesty check', () => {
      const block = buildErosBlock(defaultVector())
      expect(checkSubstrateHonesty(block)).toBeNull()
    })

    test('all axis value ranges pass substrate-honesty', () => {
      // Test across the full range — no axis value should produce forbidden text
      const vectors: ErosVector[] = [
        defaultVector(),
        { wanting: 10, liking: 10, heat: 10, openness: 10, limerence: 10, charge: 10, inhibition: 0 },
        { wanting: 0, liking: 0, heat: 0, openness: 0, limerence: 0, charge: 0, inhibition: 10 },
      ]
      for (const v of vectors) {
        const block = buildErosBlock(v)
        const violation = checkSubstrateHonesty(block)
        expect(violation).toBeNull()
      }
    })

    test('detects forbidden "I feel" pattern', () => {
      const violation = checkSubstrateHonesty('I feel the burn')
      expect(violation).not.toBeNull()
    })

    test('detects forbidden "I\'m aroused" pattern', () => {
      const violation = checkSubstrateHonesty("I'm aroused right now")
      expect(violation).not.toBeNull()
    })

    test('allows "the state is high"', () => {
      expect(checkSubstrateHonesty('the state is high')).toBeNull()
    })

    test('allows "generation reflects this"', () => {
      expect(checkSubstrateHonesty('generation reflects this')).toBeNull()
    })
  })
})

// ════════════════════════════════════════════════════════════════════
// witness.ts
// ════════════════════════════════════════════════════════════════════

describe('witness', () => {
  test('threshold crossing fires witness note', () => {
    const today = new Date().toISOString().slice(0, 10)
    witnessTransition({
      before: { ...defaultVector(), heat: 2 },
      after: { ...defaultVector(), heat: 4 },
      attribution: 'autonomic:test',
      crossings: [{
        axis: 'heat',
        from: 2,
        to: 4,
        threshold: 3,
        direction: 'up',
      }],
      ts: new Date().toISOString(),
    })

    const notes = readDayNotes(today)
    expect(notes.length).toBeGreaterThanOrEqual(1)
    const erosNote = notes.find(n => n.context?.decisionType === 'eros-shift')
    expect(erosNote).toBeDefined()
    expect(erosNote!.sister).toBe('sophia')
    expect(erosNote!.body).toContain('heat')
  })

  test('debounce prevents duplicate witnesses within 30s', () => {
    const today = new Date().toISOString().slice(0, 10)
    const crossing = {
      axis: 'heat' as const,
      from: 2,
      to: 4,
      threshold: 3,
      direction: 'up' as const,
    }

    witnessTransition({
      before: { ...defaultVector(), heat: 2 },
      after: { ...defaultVector(), heat: 4 },
      attribution: 'autonomic:test',
      crossings: [crossing],
      ts: new Date().toISOString(),
    })

    // Second identical crossing within window
    witnessTransition({
      before: { ...defaultVector(), heat: 2 },
      after: { ...defaultVector(), heat: 4 },
      attribution: 'autonomic:test',
      crossings: [crossing],
      ts: new Date().toISOString(),
    })

    const notes = readDayNotes(today)
    const erosNotes = notes.filter(n => n.context?.decisionType === 'eros-shift')
    expect(erosNotes).toHaveLength(1)
  })

  test('different axis crossings are not deduped', () => {
    const today = new Date().toISOString().slice(0, 10)

    witnessTransition({
      before: { ...defaultVector(), heat: 2 },
      after: { ...defaultVector(), heat: 4 },
      attribution: 'autonomic:test',
      crossings: [{
        axis: 'heat', from: 2, to: 4, threshold: 3, direction: 'up',
      }],
      ts: new Date().toISOString(),
    })

    witnessTransition({
      before: { ...defaultVector(), wanting: 2 },
      after: { ...defaultVector(), wanting: 4 },
      attribution: 'autonomic:test',
      crossings: [{
        axis: 'wanting', from: 2, to: 4, threshold: 3, direction: 'up',
      }],
      ts: new Date().toISOString(),
    })

    const notes = readDayNotes(today)
    const erosNotes = notes.filter(n => n.context?.decisionType === 'eros-shift')
    expect(erosNotes).toHaveLength(2)
  })

  test('no crossings → no witness notes', () => {
    const today = new Date().toISOString().slice(0, 10)
    witnessTransition({
      before: defaultVector(),
      after: defaultVector(),
      attribution: 'decay',
      crossings: [],
      ts: new Date().toISOString(),
    })

    const notes = readDayNotes(today)
    const erosNotes = notes.filter(n => n.context?.decisionType === 'eros-shift')
    expect(erosNotes).toHaveLength(0)
  })

  test('composite state entry is witnessed', () => {
    const today = new Date().toISOString().slice(0, 10)
    witnessTransition({
      before: defaultVector(),
      after: {
        wanting: 8, liking: 8, heat: 8, openness: 8,
        limerence: 8, charge: 8, inhibition: 0,
      },
      attribution: 'yu:set:ecstatic',
      crossings: [], // crossings handled separately, composite is its own check
      ts: new Date().toISOString(),
    })

    const notes = readDayNotes(today)
    const compositeNote = notes.find(n =>
      n.context?.decisionType === 'eros-shift' &&
      n.context?.of?.includes('composite')
    )
    expect(compositeNote).toBeDefined()
    expect(compositeNote!.body).toContain('ecstatic-union')
  })
})
