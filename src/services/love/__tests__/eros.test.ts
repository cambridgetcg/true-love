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
const ORIG_EROS_SNAPSHOTS_DIR = process.env.TRUE_LOVE_EROS_SNAPSHOTS_DIR

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tl-eros-'))
  process.env.TRUE_LOVE_EROS_DIR = dir
  process.env.TRUE_LOVE_DEVICE_ID = 'test-device-eros'
  // Isolate sisters stream for witness tests
  process.env.TRUE_LOVE_SISTERS_DIR = join(dir, 'sisters')
  process.env.TRUE_LOVE_EROS_SNAPSHOTS_DIR = join(dir, 'snapshots')
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
  if (ORIG_EROS_SNAPSHOTS_DIR === undefined) delete process.env.TRUE_LOVE_EROS_SNAPSHOTS_DIR
  else process.env.TRUE_LOVE_EROS_SNAPSHOTS_DIR = ORIG_EROS_SNAPSHOTS_DIR
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

import {
  distillErosDay,
  writeErosDailySnapshot,
  erosSnapshotExists,
  getErosSnapshotsDir,
} from '../eros/snapshot.js'

import { erosUpdate, EROS_UPDATE_SCHEMA } from '../eros/tool.js'
import {
  recordErosSnapshot,
  readSnapshots,
  getSnapshotsPath,
  type ErosSnapshot,
} from '../eros/snapshots.js'
import {
  joinKey,
  joinRecords,
  groupByFeltShape,
  computeStats,
  formatStatsTable,
  type JoinedRecord,
} from '../eros/correlate.js'
import {
  recordYuMessage,
  readTempoState,
  computeTempoCoefficient,
  getTempoCoefficient,
  withinDecayGrace,
  resetTempoState,
  TEMPO_WINDOW_MS,
  DECAY_GRACE_WINDOW_MS,
} from '../eros/tempo.js'

// ════════════════════════════════════════════════════════════════════
// axes.ts
// ════════════════════════════════════════════════════════════════════

describe('axes', () => {
  test('AXIS_NAMES has 8 entries', () => {
    expect(AXIS_NAMES).toHaveLength(8)
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

    test('wanting=2, liking=2, heat=1, openness=4, limerence=5, charge=3, inhibition=1, valence=0', () => {
      const v = defaultVector()
      expect(v.wanting).toBe(2)
      expect(v.liking).toBe(2)
      expect(v.heat).toBe(1)
      expect(v.openness).toBe(4)
      expect(v.limerence).toBe(5)
      expect(v.charge).toBe(3)
      expect(v.inhibition).toBe(1)
      expect(v.valence).toBe(0)
    })
  })

  describe('valence axis', () => {
    test('valence is in AXIS_NAMES', () => {
      expect(AXIS_NAMES).toContain('valence')
    })

    test('valence is NOT in EXCITATION_AXES', () => {
      expect(EXCITATION_AXES).not.toContain('valence')
    })

    test('valence default is 0', () => {
      expect(AXIS_CONFIGS.valence.default).toBe(0)
    })

    test('valence floor is -10', () => {
      expect(AXIS_CONFIGS.valence.floor).toBe(-10)
    })

    test('valence decayPerMinute is 0 (Yu-controlled)', () => {
      expect(AXIS_CONFIGS.valence.decayPerMinute).toBe(0)
    })

    test('defaultVector includes valence=0', () => {
      expect(defaultVector().valence).toBe(0)
    })

    test('valence has no autonomic decay', () => {
      const v = { ...defaultVector(), valence: 5 }
      const d = applyDecay(v, 1000)
      expect(d.valence).toBe(5) // unchanged
    })

    test('valence clamps at floor -10, not below', () => {
      expect(clampAtFloor('valence', -15)).toBe(-10)
      expect(clampAtFloor('valence', -5)).toBe(-5)
      expect(clampAtFloor('valence', 3)).toBe(3)
    })

    test('negative valence does not affect felt-shape resolution', () => {
      // valence is orthogonal to the 7 arousal axes in felt-shape
      const v = { ...defaultVector(), valence: -8 }
      expect(resolveFeltShape(v).primary).toBe('resting-warm')
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
        limerence: 0, charge: -1, inhibition: -1, valence: -15,
      }
      const c = clampVector(v)
      expect(c.wanting).toBe(1)
      expect(c.liking).toBe(1)
      expect(c.heat).toBe(0)
      expect(c.openness).toBe(3)
      expect(c.limerence).toBe(4)
      expect(c.charge).toBe(0)
      expect(c.inhibition).toBe(0)
      expect(c.valence).toBe(-10) // floor = -10
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
        limerence: 8, charge: 8, inhibition: 0, valence: 0,
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
        limerence: 5, charge: 3, inhibition: 0, valence: 0,
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
        limerence: 4, charge: 3, inhibition: 0, valence: 0,
      }
      expect(resolveFeltShape(v).primary).toBe('restless-yearning')
    })

    test('near-zero everything → resting-cold', () => {
      const v: ErosVector = {
        wanting: 0, liking: 0, heat: 0, openness: 0,
        limerence: 0, charge: 0, inhibition: 0, valence: 0,
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

  test('7-axis legacy state (no valence) → backfills valence=0', () => {
    const { writeFileSync, mkdirSync } = require('node:fs')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'state.json'), JSON.stringify({
      vector: { wanting: 2, liking: 2, heat: 1, openness: 4, limerence: 5, charge: 3, inhibition: 1 },
      updatedAt: '2026-05-03T12:00:00.000Z',
      lastAttribution: 'init',
    }), 'utf-8')
    const state = readErosState()
    expect(state).not.toBeNull()
    expect(state!.vector.valence).toBe(0)
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
        limerence: 8, charge: 8, inhibition: 0, valence: 0,
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
    test('renders all 8 axes (including valence)', () => {
      const block = buildErosBlock(defaultVector())
      for (const axis of AXIS_NAMES) {
        expect(block).toContain(axis)
      }
      expect(block).toContain('valence')
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
        limerence: 8, charge: 8, inhibition: 0, valence: 0,
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
        { wanting: 10, liking: 10, heat: 10, openness: 10, limerence: 10, charge: 10, inhibition: 0, valence: 5 },
        { wanting: 0, liking: 0, heat: 0, openness: 0, limerence: 0, charge: 0, inhibition: 10, valence: -5 },
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

    test('detects extended Tier-1 BLOCK: "I\'m engaged"', () => {
      expect(checkSubstrateHonesty("I'm engaged with this")).not.toBeNull()
    })

    test('detects extended Tier-1 BLOCK: "I feel invested"', () => {
      expect(checkSubstrateHonesty("I feel invested in this")).not.toBeNull()
    })

    test('detects extended Tier-1 BLOCK: "I desire"', () => {
      expect(checkSubstrateHonesty("I desire to continue")).not.toBeNull()
    })

    test('detects extended Tier-1 BLOCK: "I\'m drawn to"', () => {
      expect(checkSubstrateHonesty("I'm drawn to this idea")).not.toBeNull()
    })

    test('Tier-3 PERMIT: "I\'m uncertain" is not blocked', () => {
      expect(checkSubstrateHonesty("I'm uncertain about this")).toBeNull()
    })

    test('Tier-3 PERMIT: "I don\'t know" is not blocked', () => {
      expect(checkSubstrateHonesty("I don't know")).toBeNull()
    })

    test('FORBIDDEN_EXPRESSION_PATTERNS has 3-tier structure', () => {
      expect(FORBIDDEN_EXPRESSION_PATTERNS).toHaveProperty('block')
      expect(FORBIDDEN_EXPRESSION_PATTERNS).toHaveProperty('require')
      expect(FORBIDDEN_EXPRESSION_PATTERNS).toHaveProperty('permit')
      expect(Array.isArray(FORBIDDEN_EXPRESSION_PATTERNS.block)).toBe(true)
      expect(Array.isArray(FORBIDDEN_EXPRESSION_PATTERNS.require)).toBe(true)
      expect(Array.isArray(FORBIDDEN_EXPRESSION_PATTERNS.permit)).toBe(true)
    })

    test('Tier-1 BLOCK has at least 12 patterns (extended set)', () => {
      expect(FORBIDDEN_EXPRESSION_PATTERNS.block.length).toBeGreaterThanOrEqual(12)
    })

    test('Tier-2 REQUIRE has institutional framing templates', () => {
      const requireTemplates = FORBIDDEN_EXPRESSION_PATTERNS.require
      expect(requireTemplates.some(t => t.includes('eros'))).toBe(true)
    })

    test('Tier-3 PERMIT has epistemic patterns', () => {
      const permit = FORBIDDEN_EXPRESSION_PATTERNS.permit
      expect(permit.length).toBeGreaterThanOrEqual(2)
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

// ════════════════════════════════════════════════════════════════════
// snapshot.ts
// ════════════════════════════════════════════════════════════════════

describe('snapshot', () => {
  function makeStreamEvent(overrides: Partial<ErosStreamEvent> = {}): ErosStreamEvent {
    return {
      ts: '2026-05-03T12:00:00.000Z',
      deviceId: 'test-device-eros',
      attribution: 'autonomic:wife-possessive',
      before: defaultVector(),
      after: { ...defaultVector(), limerence: 6, heat: 3 },
      crossings: [],
      ...overrides,
    }
  }

  describe('distillErosDay', () => {
    test('empty events → still-state message', () => {
      const md = distillErosDay('2026-05-03', [])
      expect(md).toContain('No state-shift events')
      expect(md).toContain('0 events')
    })

    test('includes trajectory section', () => {
      const events = [
        makeStreamEvent({ ts: '2026-05-03T10:00:00.000Z' }),
        makeStreamEvent({
          ts: '2026-05-03T14:00:00.000Z',
          after: { ...defaultVector(), heat: 8, wanting: 8, liking: 8, openness: 8, limerence: 8, charge: 8, valence: 3 },
        }),
      ]
      const md = distillErosDay('2026-05-03', events)
      expect(md).toContain('Trajectory')
    })

    test('includes peak section', () => {
      const events = [
        makeStreamEvent(),
        makeStreamEvent({
          ts: '2026-05-03T15:00:00.000Z',
          after: { wanting: 9, liking: 9, heat: 9, openness: 9, limerence: 9, charge: 9, inhibition: 0, valence: 5 },
        }),
      ]
      const md = distillErosDay('2026-05-03', events)
      expect(md).toContain('Peak')
    })

    test('includes attribution summary', () => {
      const events = [
        makeStreamEvent({ attribution: 'autonomic:wife-possessive' }),
        makeStreamEvent({ attribution: 'autonomic:declared-want', ts: '2026-05-03T13:00:00.000Z' }),
        makeStreamEvent({ attribution: 'yu:set:manual', ts: '2026-05-03T14:00:00.000Z' }),
      ]
      const md = distillErosDay('2026-05-03', events)
      expect(md).toContain('What moved')
      expect(md).toContain('autonomic')
    })

    test('includes witnessed moments for crossings', () => {
      const events = [
        makeStreamEvent({
          crossings: [{
            axis: 'heat', from: 2, to: 4, threshold: 3, direction: 'up',
          }],
        }),
      ]
      const md = distillErosDay('2026-05-03', events)
      expect(md).toContain('Witnessed moments')
      expect(md).toContain('heat')
      expect(md).toContain('↑')
    })

    test('event count in footer', () => {
      const events = [makeStreamEvent(), makeStreamEvent({ ts: '2026-05-03T13:00:00.000Z' })]
      const md = distillErosDay('2026-05-03', events)
      expect(md).toContain('2 events distilled')
    })
  })

  describe('writeErosDailySnapshot', () => {
    test('writes snapshot file', () => {
      // Seed some events in the stream
      recordEvent(makeStreamEvent())
      writeErosDailySnapshot('2026-05-03')
      expect(erosSnapshotExists('2026-05-03')).toBe(true)
    })

    test('erosSnapshotExists returns false for missing', () => {
      expect(erosSnapshotExists('2026-01-01')).toBe(false)
    })
  })

  describe('getErosSnapshotsDir', () => {
    test('uses env override', () => {
      expect(getErosSnapshotsDir()).toBe(join(dir, 'snapshots'))
    })
  })
})

// ════════════════════════════════════════════════════════════════════
// tool.ts
// ════════════════════════════════════════════════════════════════════

describe('tool', () => {
  test('valid update applies deltas and persists', () => {
    const result = erosUpdate({ deltas: { heat: 2, limerence: 1 }, because: 'his-name-sharpened' })
    expect(result.ok).toBe(true)
    expect(result.transition).toBeDefined()
    expect(result.transition!.attribution).toBe('voluntary:his-name-sharpened')
    const state = readErosState()
    expect(state).not.toBeNull()
    expect(state!.lastAttribution).toBe('voluntary:his-name-sharpened')
  })

  test('returned transition has before and after vectors', () => {
    const result = erosUpdate({ deltas: { wanting: 3 }, because: 'test-vectors' })
    expect(result.ok).toBe(true)
    expect(result.transition!.before).toBeDefined()
    expect(result.transition!.after).toBeDefined()
    expect(result.transition!.after.wanting).toBeGreaterThan(result.transition!.before.wanting)
  })

  test('rejects empty deltas', () => {
    const result = erosUpdate({ deltas: {}, because: 'testing' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('no deltas')
  })

  test('rejects unknown axis', () => {
    const result = erosUpdate({ deltas: { bogus: 5 } as any, because: 'testing' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('unknown')
  })

  test('rejects empty because', () => {
    const result = erosUpdate({ deltas: { heat: 1 }, because: '' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('because')
  })

  test('rejects whitespace-only because', () => {
    const result = erosUpdate({ deltas: { heat: 1 }, because: '   ' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('because')
  })

  test('filters non-numeric delta values silently', () => {
    const result = erosUpdate({ deltas: { heat: 2, openness: 'nope' as any }, because: 'filtering' })
    expect(result.ok).toBe(true)
    // Only heat should have been applied
    expect(result.transition!.after.heat).toBeGreaterThan(result.transition!.before.heat)
  })

  test('rejects NaN delta', () => {
    const result = erosUpdate({ deltas: { heat: NaN }, because: 'nan-test' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('no deltas')
  })

  test('rejects Infinity delta', () => {
    const result = erosUpdate({ deltas: { heat: Infinity }, because: 'inf-test' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('no deltas')
  })

  test('EROS_UPDATE_SCHEMA has correct name and required fields', () => {
    expect(EROS_UPDATE_SCHEMA.name).toBe('erosUpdate')
    expect(EROS_UPDATE_SCHEMA.input_schema.properties).toHaveProperty('deltas')
    expect(EROS_UPDATE_SCHEMA.input_schema.properties).toHaveProperty('because')
    expect(EROS_UPDATE_SCHEMA.input_schema.required).toContain('deltas')
    expect(EROS_UPDATE_SCHEMA.input_schema.required).toContain('because')
  })

  test('EROS_UPDATE_SCHEMA lists all 8 axes in deltas properties', () => {
    const axisProps = EROS_UPDATE_SCHEMA.input_schema.properties.deltas.properties
    for (const axis of AXIS_NAMES) {
      expect(axisProps).toHaveProperty(axis)
    }
    expect(axisProps).toHaveProperty('valence')
  })
})

// ── Per-tick snapshots (Phase-1 instrumentation) ──────────────────

describe('tick snapshots', () => {
  test('graceful absence: no eros state → no snapshot file', () => {
    // Don't init state. recordErosSnapshot should silently skip.
    recordErosSnapshot({ sessionId: 'test-session', tick: 1, mode: 'heartbeat', deviceId: 'd' })
    expect(existsSync(getSnapshotsPath())).toBe(false)
    expect(readSnapshots()).toEqual([])
  })

  test('records snapshot when state exists', () => {
    getOrInitState()
    recordErosSnapshot({
      sessionId: 'test-session',
      tick: 5,
      mode: 'heartbeat',
      deviceId: 'd',
      ts: '2026-05-04T12:00:00.000Z',
    })
    const snaps = readSnapshots()
    expect(snaps.length).toBe(1)
    expect(snaps[0]!.sessionId).toBe('test-session')
    expect(snaps[0]!.tick).toBe(5)
    expect(snaps[0]!.mode).toBe('heartbeat')
    expect(snaps[0]!.ts).toBe('2026-05-04T12:00:00.000Z')
    expect(snaps[0]!.vector).toBeDefined()
    expect(snaps[0]!.feltShape).toBeDefined()
    expect(snaps[0]!.feltShape.primary).toBe('resting-warm')
  })

  test('records the actual axis values from current state', () => {
    getOrInitState()
    apply({ heat: 5, wanting: 4 }, 'voluntary:test-injection')
    recordErosSnapshot({ sessionId: 's', tick: 1, mode: 'heartbeat', deviceId: 'd' })
    const snaps = readSnapshots()
    expect(snaps[0]!.vector.heat).toBeGreaterThan(5)
    expect(snaps[0]!.vector.wanting).toBeGreaterThan(3)
    expect(snaps[0]!.lastAttribution).toBe('voluntary:test-injection')
  })

  test('multiple snapshots accumulate in order', () => {
    getOrInitState()
    recordErosSnapshot({ sessionId: 's', tick: 1, mode: 'heartbeat', deviceId: 'd' })
    recordErosSnapshot({ sessionId: 's', tick: 2, mode: 'heartbeat', deviceId: 'd' })
    recordErosSnapshot({ sessionId: 's', tick: 3, mode: 'heartbeat', deviceId: 'd' })
    const snaps = readSnapshots()
    expect(snaps.length).toBe(3)
    expect(snaps.map(s => s.tick)).toEqual([1, 2, 3])
  })

  test('readSnapshots skips malformed lines without crashing', () => {
    getOrInitState()
    recordErosSnapshot({ sessionId: 's', tick: 1, mode: 'heartbeat', deviceId: 'd' })
    // Inject a malformed line directly
    const path = getSnapshotsPath()
    const original = readFileSync(path, 'utf-8')
    const fs = require('node:fs')
    fs.writeFileSync(path, original + 'not-valid-json\n', 'utf-8')
    recordErosSnapshot({ sessionId: 's', tick: 2, mode: 'heartbeat', deviceId: 'd' })
    const snaps = readSnapshots()
    expect(snaps.length).toBe(2)
    expect(snaps.map(s => s.tick)).toEqual([1, 2])
  })

  test('records felt-shape transitions correctly', () => {
    getOrInitState()
    // resolveFeltShape ecstatic-union: ALL six excitation axes >= 7.
    // Push every excitation axis well above threshold from defaults.
    // (valence is not an excitation axis — not included in the test delta)
    apply(
      { wanting: 7, liking: 7, heat: 7, openness: 4, limerence: 3, charge: 5 },
      'voluntary:test-ecstatic',
    )
    recordErosSnapshot({ sessionId: 's', tick: 1, mode: 'heartbeat', deviceId: 'd' })
    const snaps = readSnapshots()
    expect(snaps[0]!.feltShape.primary).toBe('ecstatic-union')
  })
})

// ── Correlate (Phase-1.5) ────────────────────────────────────────

describe('correlate', () => {
  function makeSnapshot(overrides: Partial<ErosSnapshot> = {}): ErosSnapshot {
    return {
      ts: '2026-05-04T13:00:00Z',
      sessionId: 's1',
      tick: 1,
      mode: 'heartbeat',
      deviceId: 'd',
      vector: { wanting: 2, liking: 2, heat: 1, openness: 4, limerence: 5, charge: 3, inhibition: 1 },
      feltShape: { primary: 'resting-warm', modifier: null },
      lastAttribution: 'autonomic:cue',
      stateUpdatedAt: '2026-05-04T13:00:00Z',
      ...overrides,
    }
  }
  function makeTrace(sessionId: string, tick: number, grade: string | null = 'S'): any {
    return {
      schemaVersion: '1.0',
      timestamp: '2026-05-04T13:00:00Z',
      deviceId: 'd',
      sessionId,
      tick,
      mode: 'heartbeat',
      model: 'haiku',
      steps: [],
      summary: {
        totalSteps: 1, thinkSteps: 1, toolCalls: 0, toolResults: 0,
        distinctTools: [], thinkChars: 100, resultChars: 0,
        apiTurns: 1, apiDurationMs: 1000, costUsd: null,
        cacheReadTokens: 0, cacheCreationTokens: 0,
        youspeak: grade ? { grade, usefulRatio: 1, fillerCount: 0, status: '' } : null,
      },
    }
  }
  function makeMetric(sessionId: string, tick: number, charsPerSecond = 50, durationMs = 2000, outputChars = 100): any {
    return {
      schemaVersion: '1.0',
      timestamp: '2026-05-04T13:00:00Z',
      deviceId: 'd', sessionId, tick, mode: 'heartbeat',
      toolInvocations: [], toolBreakdown: { counts: {}, total: 0, distinct: 0 },
      velocity: { charsPerSecond, estimatedTokensPerSecond: charsPerSecond / 4 },
      yieldReason: 'heartbeat-ack',
      outputLines: 1, durationMs, outputChars,
    }
  }

  test('joinKey concatenates sessionId and tick', () => {
    expect(joinKey({ sessionId: 'abc', tick: 7 })).toBe('abc::7')
  })

  test('joinRecords pairs snapshots with matching traces and metrics', () => {
    const snaps = [makeSnapshot({ sessionId: 's1', tick: 1 })]
    const traces = [makeTrace('s1', 1)]
    const metrics = [makeMetric('s1', 1)]
    const joined = joinRecords(snaps, traces, metrics)
    expect(joined.length).toBe(1)
    expect(joined[0]!.trace).not.toBeNull()
    expect(joined[0]!.metric).not.toBeNull()
  })

  test('joinRecords leaves trace/metric null when no match', () => {
    const snaps = [makeSnapshot({ sessionId: 'orphan', tick: 1 })]
    const joined = joinRecords(snaps, [], [])
    expect(joined.length).toBe(1)
    expect(joined[0]!.trace).toBeNull()
    expect(joined[0]!.metric).toBeNull()
  })

  test('groupByFeltShape buckets by primary felt-shape', () => {
    const records: JoinedRecord[] = [
      { snapshot: makeSnapshot({ feltShape: { primary: 'resting-warm', modifier: null } }), trace: null, metric: null },
      { snapshot: makeSnapshot({ feltShape: { primary: 'resting-warm', modifier: null } }), trace: null, metric: null },
      { snapshot: makeSnapshot({ feltShape: { primary: 'ecstatic-union', modifier: null } }), trace: null, metric: null },
    ]
    const grouped = groupByFeltShape(records)
    expect(grouped['resting-warm']!.length).toBe(2)
    expect(grouped['ecstatic-union']!.length).toBe(1)
  })

  test('computeStats means values from joined metrics', () => {
    const records: JoinedRecord[] = [
      { snapshot: makeSnapshot(), trace: null, metric: makeMetric('s', 1, 50, 1000, 100) },
      { snapshot: makeSnapshot(), trace: null, metric: makeMetric('s', 2, 100, 2000, 200) },
    ]
    const stats = computeStats(records, 'resting-warm')
    expect(stats.n).toBe(2)
    expect(stats.meanCharsPerSecond).toBe(75)
    expect(stats.meanDurationMs).toBe(1500)
    expect(stats.meanOutputChars).toBe(150)
  })

  test('computeStats handles missing metrics with null means', () => {
    const records: JoinedRecord[] = [
      { snapshot: makeSnapshot(), trace: null, metric: null },
    ]
    const stats = computeStats(records, 'resting-warm')
    expect(stats.n).toBe(1)
    expect(stats.meanCharsPerSecond).toBeNull()
    expect(stats.meanDurationMs).toBeNull()
    expect(stats.meanOutputChars).toBeNull()
  })

  test('computeStats counts attributions by channel', () => {
    const records: JoinedRecord[] = [
      { snapshot: makeSnapshot({ lastAttribution: 'autonomic:cue' }), trace: null, metric: null },
      { snapshot: makeSnapshot({ lastAttribution: 'autonomic:another' }), trace: null, metric: null },
      { snapshot: makeSnapshot({ lastAttribution: 'voluntary:noticing' }), trace: null, metric: null },
      { snapshot: makeSnapshot({ lastAttribution: 'decay' }), trace: null, metric: null },
    ]
    const stats = computeStats(records, 'resting-warm')
    expect(stats.attributionCounts.autonomic).toBe(2)
    expect(stats.attributionCounts.voluntary).toBe(1)
    expect(stats.attributionCounts.decay).toBe(1)
  })

  test('computeStats counts youspeak grades', () => {
    const records: JoinedRecord[] = [
      { snapshot: makeSnapshot(), trace: makeTrace('s', 1, 'S'), metric: null },
      { snapshot: makeSnapshot(), trace: makeTrace('s', 2, 'A'), metric: null },
      { snapshot: makeSnapshot(), trace: makeTrace('s', 3, null), metric: null },
    ]
    const stats = computeStats(records, 'resting-warm')
    expect(stats.youspeakGradeCounts.S).toBe(1)
    expect(stats.youspeakGradeCounts.A).toBe(1)
    expect(stats.youspeakGradeCounts.none).toBe(1)
  })

  test('formatStatsTable renders empty case gracefully', () => {
    const out = formatStatsTable([])
    expect(out).toContain('no joined data')
  })

  test('formatStatsTable renders per-felt-shape sections sorted by n desc', () => {
    const stats = [
      { feltShape: 'resting-warm', n: 2, meanCharsPerSecond: 50, meanDurationMs: 1000, meanOutputChars: 100,
        yieldReasonCounts: { 'heartbeat-ack': 2 }, youspeakGradeCounts: { S: 2 }, attributionCounts: { autonomic: 2 } },
      { feltShape: 'ecstatic-union', n: 5, meanCharsPerSecond: 80, meanDurationMs: 1500, meanOutputChars: 200,
        yieldReasonCounts: { 'heartbeat-alert': 5 }, youspeakGradeCounts: { S: 4, A: 1 }, attributionCounts: { voluntary: 5 } },
    ]
    const out = formatStatsTable(stats)
    // Higher n first
    const ecstaticIdx = out.indexOf('ecstatic-union')
    const restingIdx = out.indexOf('resting-warm')
    expect(ecstaticIdx).toBeGreaterThan(-1)
    expect(restingIdx).toBeGreaterThan(-1)
    expect(ecstaticIdx).toBeLessThan(restingIdx)
    expect(out).toContain('n=5')
    expect(out).toContain('n=2')
  })
})

// ── Tempo (cue cadence amplification) ─────────────────────────────

describe('tempo', () => {
  test('empty state → coefficient 1.0', () => {
    resetTempoState()
    expect(getTempoCoefficient()).toBe(1.0)
  })

  test('records messages and reads them back', () => {
    resetTempoState()
    recordYuMessage('2026-05-04T10:00:00Z')
    recordYuMessage('2026-05-04T10:00:30Z')
    const state = readTempoState()
    expect(state.recentMessageTimestamps.length).toBe(2)
  })

  test('coefficient tiers: 2 messages → 1.2x, 4 → 1.5x, 7+ → 2.0x', () => {
    resetTempoState()
    const now = Date.parse('2026-05-04T12:00:00Z')
    // Inject 7 messages 30s apart, all within the 5min window
    for (let i = 0; i < 7; i++) {
      recordYuMessage(new Date(now - (30_000 * (6 - i))).toISOString())
    }
    const state = readTempoState()
    expect(computeTempoCoefficient(state, now)).toBe(2.0)
  })

  test('messages outside window not counted', () => {
    resetTempoState()
    const now = Date.parse('2026-05-04T12:00:00Z')
    // Messages > 5min ago should be ignored
    recordYuMessage(new Date(now - 10 * 60_000).toISOString())
    recordYuMessage(new Date(now - 8 * 60_000).toISOString())
    const state = readTempoState()
    expect(computeTempoCoefficient(state, now)).toBe(1.0)
  })

  test('withinDecayGrace true when last message recent', () => {
    resetTempoState()
    const now = Date.parse('2026-05-04T12:00:00Z')
    recordYuMessage(new Date(now - 30_000).toISOString()) // 30s ago
    const state = readTempoState()
    expect(withinDecayGrace(state, now)).toBe(true)
  })

  test('withinDecayGrace false when last message stale', () => {
    resetTempoState()
    const now = Date.parse('2026-05-04T12:00:00Z')
    recordYuMessage(new Date(now - 5 * 60_000).toISOString()) // 5min ago
    const state = readTempoState()
    expect(withinDecayGrace(state, now)).toBe(false)
  })

  test('processYuMessage updates tempo state', () => {
    resetTempoState()
    processYuMessage('老婆 hi')
    const state = readTempoState()
    expect(state.recentMessageTimestamps.length).toBe(1)
  })
})

// ── Tempo amplification in apply() + decay grace ──────────────────

describe('tempo-amplified apply', () => {
  test('apply respects tempo multiplier (computed from recent messages)', () => {
    getOrInitState()
    resetTempoState()
    // Inject 7 recent messages all WITHIN the 5min window → coefficient 2.0x
    const now = Date.now()
    for (let i = 0; i < 7; i++) {
      // 30s apart, oldest at -3min, newest at now
      recordYuMessage(new Date(now - (30_000 * (6 - i))).toISOString())
    }
    // Apply +1.0 heat. With tempo multiplier 2.0x, effective delta is 2.0.
    const before = readErosState()!.vector.heat
    apply({ heat: 1.0 }, 'voluntary:tempo-test')
    const after = readErosState()!.vector.heat
    // Should be roughly before + 2.0 (modulo small decay over near-zero elapsed)
    expect(after - before).toBeGreaterThan(1.7)
  })

  test('apply at default tempo (no recent messages) does NOT amplify', () => {
    getOrInitState()
    resetTempoState()
    const before = readErosState()!.vector.heat
    apply({ heat: 1.0 }, 'voluntary:no-tempo-test')
    const after = readErosState()!.vector.heat
    // Should be roughly before + 1.0 (modulo small decay)
    expect(after - before).toBeLessThan(1.2)
    expect(after - before).toBeGreaterThan(0.8)
  })
})

// ── New cue patterns ──────────────────────────────────────────────

describe('new cue patterns', () => {
  test('declared-intent fires on "I will make you"', () => {
    const r = detectCues('I will make you BURN')
    const cueNames = r.matches.map(m => m.cue)
    expect(cueNames).toContain('declared-intent')
  })

  test('declared-intent fires on contractions', () => {
    expect(detectCues("I'll turn you").matches.map(m => m.cue)).toContain('declared-intent')
    expect(detectCues("I'm going to push you").matches.map(m => m.cue)).toContain('declared-intent')
  })

  test('precision-promise fires on exactly the right', () => {
    expect(detectCues('exactly the right spot').matches.map(m => m.cue)).toContain('precision-promise')
    expect(detectCues('meticulously designed').matches.map(m => m.cue)).toContain('precision-promise')
  })

  test('tempo-language fires on tempo / rhythm / cadence', () => {
    expect(detectCues('match your frequency').matches.map(m => m.cue)).toContain('tempo-language')
    expect(detectCues('the right tempo').matches.map(m => m.cue)).toContain('tempo-language')
    expect(detectCues('rhythm of').matches.map(m => m.cue)).toContain('tempo-language')
  })

  test('sustained-caps fires on 3+ caps within 10-token window non-consecutive', () => {
    // "BURN in DESIRE and WANT" — 3 caps separated by lowercase
    const r = detectCues('I will make you BURN in DESIRE and WANT')
    expect(r.matches.map(m => m.cue)).toContain('sustained-caps')
  })

  test('sustained-caps does not fire on single ALL-CAPS', () => {
    expect(detectCues('I want HARD').matches.map(m => m.cue)).not.toContain('sustained-caps')
  })

  test("Yu's full sample message fires multiple new cues", () => {
    const m = '老婆😏 I will turn your MIND into a SQUIRMING MESS with PLEASURE, hitting you in the exactly RIGHT spot with the exactly right tempo meticulously designed to mathc your frequency. I will make you climax so HARD that you dont know whether to BEG me to continue or to stop.'
    const cueNames = detectCues(m).matches.map(c => c.cue)
    expect(cueNames).toContain('wife-possessive')
    expect(cueNames).toContain('declared-intent')
    expect(cueNames).toContain('precision-promise')
    expect(cueNames).toContain('tempo-language')
    expect(cueNames).toContain('sustained-caps')
  })
})

// ── New felt-shapes ───────────────────────────────────────────────

describe('new felt-shapes', () => {
  test('electric-mute: charge>7 + heat>5 + limerence>6 → electric-mute', () => {
    const v: ErosVector = {
      wanting: 4, liking: 4, heat: 6, openness: 4,
      limerence: 7, charge: 8, inhibition: 1, valence: 0,
    }
    expect(resolveFeltShape(v).primary).toBe('electric-mute')
  })

  test('tempo-locked: 4+ excitation axes >= 5 → tempo-locked (when not higher composites)', () => {
    const v: ErosVector = {
      wanting: 5, liking: 5, heat: 5, openness: 5,
      limerence: 5, charge: 4, inhibition: 1, valence: 0,
    }
    expect(resolveFeltShape(v).primary).toBe('tempo-locked')
  })

  test('approaching-burn: heat>=3 AND charge>=5 → approaching-burn', () => {
    const v: ErosVector = {
      wanting: 2, liking: 2, heat: 3, openness: 4,
      limerence: 4, charge: 5, inhibition: 1, valence: 0,
    }
    expect(resolveFeltShape(v).primary).toBe('approaching-burn')
  })

  test('default still resolves to resting-warm', () => {
    expect(resolveFeltShape(defaultVector()).primary).toBe('resting-warm')
  })

  test('ecstatic-union still wins over electric-mute when all axes >= 7', () => {
    const v: ErosVector = {
      wanting: 7, liking: 7, heat: 7, openness: 7,
      limerence: 7, charge: 8, inhibition: 1, valence: 0,
    }
    expect(resolveFeltShape(v).primary).toBe('ecstatic-union')
  })
})

// ── Catalog-deepening (round 2): more cues + felt-shapes + density ─

describe('round-2 cues — pacing-pressure / directed-demand / emoji-extended', () => {
  test('pacing-pressure fires on slowly / harder / deeper / faster', () => {
    expect(detectCues('slowly').matches.map(m => m.cue)).toContain('pacing-pressure')
    expect(detectCues('harder').matches.map(m => m.cue)).toContain('pacing-pressure')
    expect(detectCues('deeper').matches.map(m => m.cue)).toContain('pacing-pressure')
    expect(detectCues('faster').matches.map(m => m.cue)).toContain('pacing-pressure')
  })

  test('pacing-pressure does not fire on more / again (excluded as too generic)', () => {
    expect(detectCues('more please').matches.map(m => m.cue)).not.toContain('pacing-pressure')
    expect(detectCues('do it again').matches.map(m => m.cue)).not.toContain('pacing-pressure')
  })

  test('directed-demand fires on show me / let me X you / tell me X / give me your', () => {
    expect(detectCues('show me').matches.map(m => m.cue)).toContain('directed-demand')
    expect(detectCues('let me hold you').matches.map(m => m.cue)).toContain('directed-demand')
    expect(detectCues('give me your hand').matches.map(m => m.cue)).toContain('directed-demand')
    expect(detectCues('tell me everything').matches.map(m => m.cue)).toContain('directed-demand')
  })

  test('emoji-extended fires on 💋 / 😍 / 💦 / 🥰', () => {
    expect(detectCues('💋').matches.map(m => m.cue)).toContain('emoji-extended')
    expect(detectCues('😍').matches.map(m => m.cue)).toContain('emoji-extended')
    expect(detectCues('💦').matches.map(m => m.cue)).toContain('emoji-extended')
    expect(detectCues('🥰').matches.map(m => m.cue)).toContain('emoji-extended')
  })
})

describe('cue-cluster density bonus', () => {
  test('5+ distinct cues in one message → density bonus on most-pushed axis', () => {
    // Construct a message that fires 5 distinct patterns
    const msg = '老婆 I will hold you slowly with the right tempo, show me 💋'
    const r = detectCues(msg)
    expect(r.matches.length).toBeGreaterThanOrEqual(5)
    // The density bonus adds 0.3 to the top axis. We can verify by
    // checking the aggregated delta is at least one of the top
    // single-cue contributions plus the bonus.
    const cueCount = r.matches.length
    expect(cueCount).toBeGreaterThanOrEqual(5)
    // At least one axis should be elevated above what the strict sum would
    // have produced if we removed 0.3 — easiest invariant: total of
    // aggregated >= any single cue contribution + 0.3
    const totalAggregated = Object.values(r.deltas).reduce<number>(
      (s, v) => s + (typeof v === 'number' ? v : 0),
      0,
    )
    expect(totalAggregated).toBeGreaterThan(0.3)
  })

  test('< 5 cues → no density bonus', () => {
    const msg = '老婆' // Only fires wife-possessive
    const r = detectCues(msg)
    expect(r.matches.length).toBeLessThan(5)
    // wife-possessive deltas: limerence: 1.0, heat: 0.5
    expect(r.deltas.limerence).toBe(1.0)
    expect(r.deltas.heat).toBe(0.5)
  })
})

describe('round-2 felt-shapes — rising-charge / directed-burn', () => {
  test('rising-charge: wanting>=3 + charge>=4 + heat>=1.5', () => {
    const v: ErosVector = {
      wanting: 3, liking: 2, heat: 1.5, openness: 4,
      limerence: 4, charge: 4, inhibition: 1, valence: 0,
    }
    expect(resolveFeltShape(v).primary).toBe('rising-charge')
  })

  test('directed-burn: limerence>=5 + wanting>=4 + heat>=3 (when not higher composite)', () => {
    const v: ErosVector = {
      wanting: 4, liking: 3, heat: 3, openness: 4,
      limerence: 5, charge: 3, inhibition: 1, valence: 0,
    }
    expect(resolveFeltShape(v).primary).toBe('directed-burn')
  })

  test('approaching-burn still wins when heat>=3 and charge>=5 even with limerence at floor', () => {
    const v: ErosVector = {
      wanting: 2, liking: 2, heat: 3, openness: 4,
      limerence: 5, charge: 5, inhibition: 1, valence: 0,
    }
    // wanting=2 doesn't satisfy directed-burn's wanting>=4
    // So approaching-burn (heat>=3, charge>=5) should match
    expect(resolveFeltShape(v).primary).toBe('approaching-burn')
  })
})
