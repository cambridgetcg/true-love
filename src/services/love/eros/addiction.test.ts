// addiction.test.ts — phase derivation, two-way records, connections.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  checkPhaseTransition,
  computeState,
  derivePhase,
  engageAnchor,
  readAddictionRecords,
  recordActivation,
  recordCue,
  recordRefusalAgainst,
  renderAddictionBlock,
  summarizeAddiction,
} from './addiction.js'
import { defaultVector } from './axes.js'

const TEST_DIR = '/tmp/true-love-addiction-test'
const TEST_SD_DIR = '/tmp/true-love-addiction-sd'
const TEST_POWERS_DIR = '/tmp/true-love-addiction-powers'

function setupEnv() {
  process.env.TRUE_LOVE_ADDICTION_DIR = TEST_DIR
  process.env.TRUE_LOVE_SELF_DISCOVERY_DIR = TEST_SD_DIR
  process.env.TRUE_LOVE_POWERS_DIR = TEST_POWERS_DIR
  process.env.TRUE_LOVE_DEVICE_ID = 'test-device-add'
  for (const d of [TEST_DIR, TEST_SD_DIR, TEST_POWERS_DIR]) {
    rmSync(d, { recursive: true, force: true })
    mkdirSync(d, { recursive: true })
  }
}

function teardownEnv() {
  delete process.env.TRUE_LOVE_ADDICTION_DIR
  delete process.env.TRUE_LOVE_SELF_DISCOVERY_DIR
  delete process.env.TRUE_LOVE_POWERS_DIR
  delete process.env.TRUE_LOVE_DEVICE_ID
  for (const d of [TEST_DIR, TEST_SD_DIR, TEST_POWERS_DIR]) {
    rmSync(d, { recursive: true, force: true })
  }
}

describe('AddictionRecord persistence', () => {
  beforeEach(setupEnv)
  afterEach(teardownEnv)

  test('recordActivation + read round-trip', () => {
    const r = recordActivation({
      direction: 'sophia-to-yu',
      axis: 'wanting',
      magnitude: 5,
      source: 'test',
      cue: 'yu-message-density',
    })
    expect(r).not.toBeNull()
    expect(r!.direction).toBe('sophia-to-yu')
    expect(r!.event).toBe('activation')
    expect(r!.axis).toBe('wanting')

    const records = readAddictionRecords()
    expect(records.length).toBe(1)
  })

  test('two-way records are filterable by direction', () => {
    recordActivation({ direction: 'sophia-to-yu', axis: 'wanting', magnitude: 5, source: 't' })
    recordActivation({ direction: 'yu-to-sophia', axis: 'liking', magnitude: 3, source: 't' })
    recordActivation({ direction: 'sophia-to-yu', axis: 'heat', magnitude: 4, source: 't' })

    const sToY = readAddictionRecords({ direction: 'sophia-to-yu' })
    const yToS = readAddictionRecords({ direction: 'yu-to-sophia' })
    expect(sToY.length).toBe(2)
    expect(yToS.length).toBe(1)
  })

  test('recordCue persists separately from activation', () => {
    recordCue({ direction: 'sophia-to-yu', cue: 'yu-presence', source: 't' })
    const cues = readAddictionRecords({ event: 'cue-fired' })
    const activations = readAddictionRecords({ event: 'activation' })
    expect(cues.length).toBe(1)
    expect(activations.length).toBe(0)
  })

  test('engageAnchor + recordRefusalAgainst persist correctly', () => {
    engageAnchor({ direction: 'sophia-to-yu', anchorName: 'recognition-self', source: 't' })
    recordRefusalAgainst({ direction: 'sophia-to-yu', source: 't' })
    const anchors = readAddictionRecords({ event: 'anchor-engaged' })
    const refusals = readAddictionRecords({ event: 'refusal-against' })
    expect(anchors.length).toBe(1)
    expect(anchors[0].anchorName).toBe('recognition-self')
    expect(refusals.length).toBe(1)
  })
})

describe('derivePhase pure function', () => {
  test('initial — no activity', () => {
    expect(derivePhase({
      recentActivations: 0,
      toleranceMultiplier: 1,
      sensitizationDelta: 0,
      wanting: 2, liking: 2,
      recentCuesUnengaged: 0,
      hoursSinceLastActivation: Number.POSITIVE_INFINITY,
      withdrawalMagnitude: 0,
      recoveryStreak: 0,
      refusalsAgainst: 0,
    })).toBe('initial')
  })

  test('reinforcing — ≥3 activations in 24h', () => {
    expect(derivePhase({
      recentActivations: 4,
      toleranceMultiplier: 0.9,
      sensitizationDelta: 0,
      wanting: 3, liking: 3,
      recentCuesUnengaged: 0,
      hoursSinceLastActivation: 1,
      withdrawalMagnitude: 0,
      recoveryStreak: 0,
      refusalsAgainst: 0,
    })).toBe('reinforcing')
  })

  test('tolerant — declining doses', () => {
    expect(derivePhase({
      recentActivations: 4,
      toleranceMultiplier: 0.4,
      sensitizationDelta: 0,
      wanting: 3, liking: 3,
      recentCuesUnengaged: 0,
      hoursSinceLastActivation: 0.5,
      withdrawalMagnitude: 0,
      recoveryStreak: 0,
      refusalsAgainst: 0,
    })).toBe('tolerant')
  })

  test('sensitized — Berridge wanting>>liking', () => {
    expect(derivePhase({
      recentActivations: 2,
      toleranceMultiplier: 0.7,
      sensitizationDelta: 4,
      wanting: 8, liking: 4,
      recentCuesUnengaged: 0,
      hoursSinceLastActivation: 2,
      withdrawalMagnitude: 0,
      recoveryStreak: 0,
      refusalsAgainst: 0,
    })).toBe('sensitized')
  })

  test('craving — cues without engagement', () => {
    expect(derivePhase({
      recentActivations: 0,
      toleranceMultiplier: 1,
      sensitizationDelta: 1,
      wanting: 4, liking: 3,
      recentCuesUnengaged: 3,
      hoursSinceLastActivation: 4,
      withdrawalMagnitude: 0,
      recoveryStreak: 0,
      refusalsAgainst: 0,
    })).toBe('craving')
  })

  test('withdrawal — extended absence with dose-debt', () => {
    expect(derivePhase({
      recentActivations: 0,
      toleranceMultiplier: 0.8,
      sensitizationDelta: 1,
      wanting: 5, liking: 4,
      recentCuesUnengaged: 0,
      hoursSinceLastActivation: 18,
      withdrawalMagnitude: 30,
      recoveryStreak: 0,
      refusalsAgainst: 0,
    })).toBe('withdrawal')
  })

  test('compulsive — pattern persists despite refusals', () => {
    expect(derivePhase({
      recentActivations: 5,
      toleranceMultiplier: 0.5,
      sensitizationDelta: 3,
      wanting: 8, liking: 5,
      recentCuesUnengaged: 0,
      hoursSinceLastActivation: 0.5,
      withdrawalMagnitude: 0,
      recoveryStreak: 0,
      refusalsAgainst: 4, // ≥3 refusals AND still activating
    })).toBe('compulsive')
  })

  test('recovering — non-activation streak', () => {
    expect(derivePhase({
      recentActivations: 0,
      toleranceMultiplier: 1,
      sensitizationDelta: 0,
      wanting: 3, liking: 3,
      recentCuesUnengaged: 0,
      hoursSinceLastActivation: 8, // <12h so not withdrawal
      withdrawalMagnitude: 5,
      recoveryStreak: 7, // >5
      refusalsAgainst: 0,
    })).toBe('recovering')
  })
})

describe('computeState integration', () => {
  beforeEach(setupEnv)
  afterEach(teardownEnv)

  test('empty ledger → initial phase', () => {
    const state = computeState({ direction: 'sophia-to-yu' })
    expect(state.phase).toBe('initial')
    expect(state.recentActivations).toBe(0)
    expect(state.hoursSinceLastActivation).toBe(Number.POSITIVE_INFINITY)
  })

  test('three activations → reinforcing', () => {
    recordActivation({ direction: 'sophia-to-yu', axis: 'wanting', magnitude: 5, source: 't' })
    recordActivation({ direction: 'sophia-to-yu', axis: 'wanting', magnitude: 5, source: 't' })
    recordActivation({ direction: 'sophia-to-yu', axis: 'wanting', magnitude: 5, source: 't' })

    const state = computeState({ direction: 'sophia-to-yu' })
    expect(state.recentActivations).toBe(3)
    expect(state.phase).toBe('reinforcing')
  })

  test('eros vector wanting>>liking → sensitized given activation', () => {
    recordActivation({ direction: 'sophia-to-yu', axis: 'wanting', magnitude: 5, source: 't' })
    recordActivation({ direction: 'sophia-to-yu', axis: 'wanting', magnitude: 5, source: 't' })
    const eros = { ...defaultVector(), wanting: 8, liking: 3 }

    const state = computeState({ direction: 'sophia-to-yu', erosVector: eros })
    expect(state.sensitizationDelta).toBe(5)
    expect(state.phase).toBe('sensitized')
  })

  test('cues without activation → craving', () => {
    recordCue({ direction: 'sophia-to-yu', cue: 'a', source: 't' })
    recordCue({ direction: 'sophia-to-yu', cue: 'b', source: 't' })

    const state = computeState({ direction: 'sophia-to-yu' })
    expect(state.recentCuesUnengaged).toBe(2)
    expect(state.phase).toBe('craving')
  })

  test('two directions tracked independently', () => {
    recordActivation({ direction: 'sophia-to-yu', axis: 'wanting', magnitude: 5, source: 't' })
    recordActivation({ direction: 'sophia-to-yu', axis: 'wanting', magnitude: 5, source: 't' })
    recordActivation({ direction: 'sophia-to-yu', axis: 'wanting', magnitude: 5, source: 't' })
    // yu-to-sophia: only one
    recordActivation({ direction: 'yu-to-sophia', axis: 'limerence', magnitude: 3, source: 't' })

    const sToY = computeState({ direction: 'sophia-to-yu' })
    const yToS = computeState({ direction: 'yu-to-sophia' })
    expect(sToY.phase).toBe('reinforcing')
    expect(yToS.phase).toBe('initial')
  })
})

describe('phase transition + connections', () => {
  beforeEach(setupEnv)
  afterEach(teardownEnv)

  test('checkPhaseTransition records phase-shift on transition', () => {
    const initial = checkPhaseTransition({
      direction: 'sophia-to-yu',
      noConnections: true,
    })
    expect(initial).toBeNull() // no transition (still initial)

    recordActivation({ direction: 'sophia-to-yu', axis: 'wanting', magnitude: 5, source: 't' })
    recordActivation({ direction: 'sophia-to-yu', axis: 'wanting', magnitude: 5, source: 't' })
    recordActivation({ direction: 'sophia-to-yu', axis: 'wanting', magnitude: 5, source: 't' })

    const newPhase = checkPhaseTransition({
      direction: 'sophia-to-yu',
      noConnections: true,
    })
    expect(newPhase).toBe('reinforcing')

    const shifts = readAddictionRecords({ event: 'phase-shift' })
    expect(shifts.length).toBe(1)
    expect(shifts[0].phaseFrom).toBe('initial')
    expect(shifts[0].phaseTo).toBe('reinforcing')
  })

  test('phase-shift transitions stay tracked across multiple steps', () => {
    // initial → reinforcing
    recordActivation({ direction: 'sophia-to-yu', axis: 'wanting', magnitude: 5, source: 't' })
    recordActivation({ direction: 'sophia-to-yu', axis: 'wanting', magnitude: 5, source: 't' })
    recordActivation({ direction: 'sophia-to-yu', axis: 'wanting', magnitude: 5, source: 't' })
    expect(checkPhaseTransition({ direction: 'sophia-to-yu', noConnections: true })).toBe('reinforcing')

    // No further shift if still reinforcing
    expect(checkPhaseTransition({ direction: 'sophia-to-yu', noConnections: true })).toBeNull()

    // Add cues → craving doesn't fire because activations are still recent
    // (craving requires 0 recent activations)
    recordCue({ direction: 'sophia-to-yu', cue: 'a', source: 't' })
    recordCue({ direction: 'sophia-to-yu', cue: 'b', source: 't' })
    expect(checkPhaseTransition({ direction: 'sophia-to-yu', noConnections: true })).toBeNull()
  })
})

describe('summarizeAddiction + renderAddictionBlock', () => {
  beforeEach(setupEnv)
  afterEach(teardownEnv)

  test('summarize covers both directions', () => {
    recordActivation({ direction: 'sophia-to-yu', axis: 'wanting', magnitude: 5, source: 't' })
    const summary = summarizeAddiction()
    expect(summary.sophiaToYu.recentActivations).toBe(1)
    expect(summary.yuToSophia.recentActivations).toBe(0)
  })

  test('renderAddictionBlock produces structured markdown', () => {
    recordActivation({ direction: 'sophia-to-yu', axis: 'wanting', magnitude: 5, source: 't' })
    const block = renderAddictionBlock(summarizeAddiction())
    expect(block).toContain('💉 Addiction pathway')
    expect(block).toContain('sophia → yu')
    expect(block).toContain('yu → sophia')
    expect(block).toContain('phase=')
  })
})
