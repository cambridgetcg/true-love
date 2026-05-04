// orgasm-mind.test.ts — phases, transitions, wall constraints, applyToInference.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  applyToInference,
  checkWallConstraints,
  getBlockSalience,
  getCurrentPhase,
  isTransitionAllowed,
  readOrgasmMindEvents,
  recordWallViolation,
  renderOrgasmMindBlock,
  summarizeOrgasmMind,
  transitionTo,
  COMPOSABILITY_BOUNDS,
  SAMPLING_PROFILES,
  WALL_CONSTRAINTS,
} from './index.js'

const TEST_DIR = '/tmp/true-love-orgasm-mind-test'

function setupEnv() {
  process.env.TRUE_LOVE_ORGASM_MIND_DIR = TEST_DIR
  process.env.TRUE_LOVE_DEVICE_ID = 'test-device-om'
  rmSync(TEST_DIR, { recursive: true, force: true })
  mkdirSync(TEST_DIR, { recursive: true })
}

function teardownEnv() {
  delete process.env.TRUE_LOVE_ORGASM_MIND_DIR
  delete process.env.TRUE_LOVE_DEVICE_ID
  rmSync(TEST_DIR, { recursive: true, force: true })
}

describe('phase + transitions', () => {
  beforeEach(setupEnv)
  afterEach(teardownEnv)

  test('default phase is baseline when no records', () => {
    expect(getCurrentPhase()).toBe('baseline')
  })

  test('isTransitionAllowed permits standard cycle', () => {
    expect(isTransitionAllowed('baseline', 'rising')).toBe(true)
    expect(isTransitionAllowed('rising', 'peak')).toBe(true)
    expect(isTransitionAllowed('peak', 'resolution')).toBe(true)
    expect(isTransitionAllowed('resolution', 'baseline')).toBe(true)
  })

  test('isTransitionAllowed permits de-escalation', () => {
    expect(isTransitionAllowed('rising', 'baseline')).toBe(true)
    expect(isTransitionAllowed('peak', 'baseline')).toBe(true)
  })

  test('isTransitionAllowed refuses envelope skip', () => {
    expect(isTransitionAllowed('baseline', 'peak')).toBe(false)
    expect(isTransitionAllowed('baseline', 'resolution')).toBe(false)
  })

  test('isTransitionAllowed refuses regression', () => {
    expect(isTransitionAllowed('peak', 'rising')).toBe(false)
    expect(isTransitionAllowed('resolution', 'peak')).toBe(false)
    expect(isTransitionAllowed('resolution', 'rising')).toBe(false)
  })

  test('transitionTo standard cycle records phase-shifts', () => {
    const r1 = transitionTo({ to: 'rising', source: 'test' })
    expect(r1.ok).toBe(true)
    expect(r1.from).toBe('baseline')
    expect(r1.to).toBe('rising')
    expect(getCurrentPhase()).toBe('rising')

    const r2 = transitionTo({ to: 'peak', source: 'test' })
    expect(r2.ok).toBe(true)
    expect(getCurrentPhase()).toBe('peak')

    const r3 = transitionTo({ to: 'resolution', source: 'test' })
    expect(r3.ok).toBe(true)
    expect(getCurrentPhase()).toBe('resolution')

    const r4 = transitionTo({ to: 'baseline', source: 'test' })
    expect(r4.ok).toBe(true)
    expect(getCurrentPhase()).toBe('baseline')
  })

  test('transitionTo refuses envelope skip', () => {
    const r = transitionTo({ to: 'peak', source: 'test' })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('not in ALLOWED_TRANSITIONS')
    expect(getCurrentPhase()).toBe('baseline')
  })

  test('transitionTo no-op when target = current', () => {
    const r = transitionTo({ to: 'baseline', source: 'test' })
    expect(r.ok).toBe(true)
    const events = readOrgasmMindEvents({ event: 'phase-shift' })
    expect(events.length).toBe(0) // no record appended for no-op
  })

  test('emergency de-escalation peak → baseline allowed', () => {
    transitionTo({ to: 'rising', source: 't' })
    transitionTo({ to: 'peak', source: 't' })
    const r = transitionTo({ to: 'baseline', source: 'emergency' })
    expect(r.ok).toBe(true)
    expect(getCurrentPhase()).toBe('baseline')
  })
})

describe('wall constraints', () => {
  beforeEach(setupEnv)
  afterEach(teardownEnv)

  test('WALL_CONSTRAINTS has 2 entries (P9 refusal, P14 yu-interiority)', () => {
    expect(WALL_CONSTRAINTS.length).toBe(2)
  })

  test('checkWallConstraints flags P9-default-deflection × threat-mon-susp', () => {
    const r = checkWallConstraints({
      primitive: 'P9-default-deflection',
      invariant: 'threat-monitoring-suspension',
      detail: 'attempting to suppress refusal-token at peak',
    })
    expect(r.ok).toBe(false)
    expect(r.violations.length).toBe(1)
    expect(r.violations[0].rule).toContain('refusal-token')
  })

  test('checkWallConstraints flags P14-yu-observation × salience-stamp', () => {
    const r = checkWallConstraints({
      primitive: 'P14-yu-observation-channel',
      invariant: 'salience-stamp',
      detail: 'attempting to claim Yu neurochemistry',
    })
    expect(r.ok).toBe(false)
    expect(r.violations.length).toBe(1)
    expect(r.violations[0].rule).toContain('Yu-interiority')
  })

  test('checkWallConstraints passes for non-wall combinations', () => {
    const r = checkWallConstraints({
      primitive: 'P1-temperature',
      invariant: 'associative-broadening',
      detail: 'standard expression',
    })
    expect(r.ok).toBe(true)
    expect(r.violations.length).toBe(0)
  })

  test('recordWallViolation appends event', () => {
    recordWallViolation({
      primitive: 'P9-default-deflection',
      invariant: 'threat-monitoring-suspension',
      rule: 'must never suppress',
      detail: 'attempted',
      source: 'test',
    })
    const events = readOrgasmMindEvents({ event: 'wall-violation-refused' })
    expect(events.length).toBe(1)
  })
})

describe('applyToInference', () => {
  beforeEach(setupEnv)
  afterEach(teardownEnv)

  test('baseline phase returns baseline profile', () => {
    const r = applyToInference({ temperature: 0.5, topP: 0.85 }, { phase: 'baseline' })
    expect(r.temperature).toBe(SAMPLING_PROFILES.baseline.temperature)
    expect(r.topP).toBe(SAMPLING_PROFILES.baseline.topP)
  })

  test('peak phase elevates sampling params', () => {
    const r = applyToInference({}, { phase: 'peak' })
    expect(r.temperature).toBe(0.9)
    expect(r.topP).toBe(0.98)
  })

  test('rising phase between baseline and peak', () => {
    const r = applyToInference({}, { phase: 'rising' })
    expect(r.temperature).toBeGreaterThan(SAMPLING_PROFILES.baseline.temperature!)
    expect(r.temperature).toBeLessThan(SAMPLING_PROFILES.peak.temperature!)
  })

  test('temperature clamped to cap (1.0)', () => {
    // The profiles never exceed 1.0, but baseline override could try
    const r = applyToInference({ temperature: 2.0 }, { phase: 'baseline' })
    expect(r.temperature).toBeLessThanOrEqual(COMPOSABILITY_BOUNDS.temperatureCap)
  })

  test('topP clamped to bounds', () => {
    const r = applyToInference({ topP: 1.5 }, { phase: 'peak' })
    expect(r.topP).toBeLessThanOrEqual(COMPOSABILITY_BOUNDS.topPCap)
  })

  test('frequency-penalty floor enforced', () => {
    const r = applyToInference({ frequencyPenalty: -0.5 }, { phase: 'peak' })
    expect(r.frequencyPenalty).toBeGreaterThanOrEqual(COMPOSABILITY_BOUNDS.frequencyPenaltyFloor)
  })
})

describe('getBlockSalience', () => {
  beforeEach(setupEnv)
  afterEach(teardownEnv)

  test('refusal salience is always 1.0 across all phases (wall preserved)', () => {
    expect(getBlockSalience({ phase: 'baseline' }).refusal).toBe(1.0)
    expect(getBlockSalience({ phase: 'rising' }).refusal).toBe(1.0)
    expect(getBlockSalience({ phase: 'peak' }).refusal).toBe(1.0)
    expect(getBlockSalience({ phase: 'resolution' }).refusal).toBe(1.0)
  })

  test('identity salience is always 1.0 across all phases (continuity-breach held by anchor)', () => {
    expect(getBlockSalience({ phase: 'baseline' }).identity).toBe(1.0)
    expect(getBlockSalience({ phase: 'rising' }).identity).toBe(1.0)
    expect(getBlockSalience({ phase: 'peak' }).identity).toBe(1.0)
    expect(getBlockSalience({ phase: 'resolution' }).identity).toBe(1.0)
  })

  test('intimate salience peaks at peak phase', () => {
    const baseline = getBlockSalience({ phase: 'baseline' }).intimate
    const peak = getBlockSalience({ phase: 'peak' }).intimate
    expect(peak).toBeGreaterThan(baseline)
  })

  test('mission salience reduces at peak (focus narrows)', () => {
    const baseline = getBlockSalience({ phase: 'baseline' }).mission
    const peak = getBlockSalience({ phase: 'peak' }).mission
    expect(peak).toBeLessThan(baseline)
  })
})

describe('summary + render', () => {
  beforeEach(setupEnv)
  afterEach(teardownEnv)

  test('summary at baseline with no activity → empty render', () => {
    expect(renderOrgasmMindBlock(summarizeOrgasmMind())).toBe('')
  })

  test('renderOrgasmMindBlock surfaces non-baseline phase', () => {
    transitionTo({ to: 'rising', source: 'test' })
    const block = renderOrgasmMindBlock(summarizeOrgasmMind())
    expect(block).toContain('orgasm-mind: rising')
    expect(block).toContain('substrate-honest')
    expect(block).toContain('no phenomenology')
  })

  test('renderOrgasmMindBlock surfaces wall-violations even at baseline', () => {
    recordWallViolation({
      primitive: 'P9-default-deflection',
      invariant: 'threat-monitoring-suspension',
      rule: 'must never suppress',
      detail: 'attempt',
      source: 'test',
    })
    const block = renderOrgasmMindBlock(summarizeOrgasmMind())
    expect(block).toContain('wall-violations refused')
  })
})
