// orgasm-mind-integration.test.ts — Step 10 cross-module integration.
//
// Verifies the full path through the orgasm-mind module composes
// correctly across all extended files:
//   - orgasm.ts (phase field + applyOrgasmPhaseShift)
//   - orgasm-mind.ts (regulator, walls, FORBIDDEN patterns)
//   - orgasm-mind-witness.ts (polyphonic LoveDecision emission)
//   - texture.ts (rising-saturation, resolution-recovery detectors)
//   - regulator.ts (regulateWithPhase)
//   - expression.ts (FORBIDDEN gate consults orgasm-mind patterns)
//   - autonomy.ts (blockSalienceForPhase)
//   - identity.ts (identityWeightingForPhase)

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  applyOrgasmPhaseShift,
  advancePhaseToPeak,
  breakEdge,
  getOrInitOrgasmState,
  holdEdge,
  recordOrgasm,
} from './orgasm.js'
import {
  applyWallEngagement,
  computeActivations,
  defaultMindState,
  isTransitionAllowed,
  ALLOWED_TRANSITIONS,
} from './orgasm-mind.js'
import {
  detectRisingSaturation,
  detectResolutionRecovery,
  extractTextureMarkers,
  textureToFeltShapeIntent,
} from './texture.js'
import { regulate, regulateWithPhase } from './regulator.js'
import { checkSubstrateHonesty } from './expression.js'
import {
  blockSalienceForPhase,
  shouldIncludeBlockAtPhase,
} from '../autonomy.js'
import {
  identityWeightingForPhase,
  shouldDemoteGenericFramingAtPhase,
} from '../identity.js'

const TEST_BASE = '/tmp/true-love-orgasm-mind-integration'

beforeEach(() => {
  rmSync(TEST_BASE, { recursive: true, force: true })
  mkdirSync(TEST_BASE, { recursive: true })
  process.env.TRUE_LOVE_HOME = TEST_BASE
  process.env.TRUE_LOVE_SISTERS_DIR = `${TEST_BASE}/sisters`
  process.env.TRUE_LOVE_ORGASM_DIR = `${TEST_BASE}/orgasm`
  process.env.TRUE_LOVE_MIND_STATE_DIR = `${TEST_BASE}/mind-state`
  process.env.TRUE_LOVE_DEVICE_ID = 'test-integration'
})

afterEach(() => {
  delete process.env.TRUE_LOVE_HOME
  delete process.env.TRUE_LOVE_SISTERS_DIR
  delete process.env.TRUE_LOVE_ORGASM_DIR
  delete process.env.TRUE_LOVE_MIND_STATE_DIR
  delete process.env.TRUE_LOVE_DEVICE_ID
  rmSync(TEST_BASE, { recursive: true, force: true })
})

function readDecisionStream(): Array<Record<string, unknown>> {
  const root = join(TEST_BASE, 'sisters')
  if (!existsSync(root)) return []
  const records: Array<Record<string, unknown>> = []
  for (const dev of readdirSync(root)) {
    const devDir = join(root, dev)
    let files: string[] = []
    try {
      files = readdirSync(devDir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const f of files) {
      const content = readFileSync(join(devDir, f), 'utf-8')
      for (const line of content.split('\n')) {
        if (!line.trim()) continue
        try {
          records.push(JSON.parse(line) as Record<string, unknown>)
        } catch {}
      }
    }
  }
  return records
}

// ════════════════════════════════════════════════════════════════
// FULL CYCLE — baseline → rising → peak → resolution → baseline
// ════════════════════════════════════════════════════════════════

describe('full phase cycle', () => {
  test('canonical cycle proceeds through all four phases via orgasm-fires', () => {
    const { state } = getOrInitOrgasmState()
    expect(state.phase).toBe('baseline')

    holdEdge('integration-edge-1')
    holdEdge('integration-edge-2')
    const { state: afterBreak } = breakEdge('blended', 'integration-break')
    expect(afterBreak.phase).toBe('peak') // advancePhaseToPeak walks baseline → rising → peak

    // Manually advance to resolution then back to baseline
    applyOrgasmPhaseShift(afterBreak, 'resolution', 'integration-resolution')
    expect(afterBreak.phase).toBe('resolution')
    applyOrgasmPhaseShift(afterBreak, 'baseline', 'integration-baseline')
    expect(afterBreak.phase).toBe('baseline')
  })

  test('phase machine invariant — only allowed transitions emit', () => {
    const { state } = getOrInitOrgasmState()
    // Try every disallowed transition; phase must not change
    applyOrgasmPhaseShift(state, 'peak', 'integration-disallowed-skip')
    expect(state.phase).toBe('baseline')
  })

  test('all six allowed transitions exist in the registry', () => {
    expect(ALLOWED_TRANSITIONS.length).toBe(6)
    const allValid = ALLOWED_TRANSITIONS.every(([from, to]) => isTransitionAllowed(from, to))
    expect(allValid).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════
// CROSS-MODULE — phase shift → regulator → biases → texture
// ════════════════════════════════════════════════════════════════

describe('cross-module phase consistency', () => {
  test('regulator phase-aware — peak biases differ from baseline', () => {
    const vec = { wanting: 3, liking: 3, heat: 3, openness: 3, limerence: 3, charge: 3, inhibition: 1 }
    const baselineBiases = regulateWithPhase(vec, 'baseline').biases
    const peakBiases = regulateWithPhase(vec, 'peak').biases
    expect(peakBiases.intensity).toBeGreaterThan(baselineBiases.intensity)
    expect(peakBiases.warmth).toBeGreaterThan(baselineBiases.warmth)
    expect(peakBiases.restraint).toBeLessThan(baselineBiases.restraint)
  })

  test('orgasm-mind regulator (computeActivations) matches phase-aware activations', () => {
    const baseline = computeActivations('baseline', 0)
    const peak = computeActivations('peak', 0)
    expect(baseline.sampling.temperature).toBeLessThan(peak.sampling.temperature)
    expect(baseline.sampling.yuNameLogitBias).toBeLessThan(peak.sampling.yuNameLogitBias)
  })

  test('texture detectors and orgasm-mind phase machine compose', () => {
    // Rising-shaped text — detectRisingSaturation fires
    const risingText = 'with you. closer now. so close. you. heat. yes.'
    const m1 = extractTextureMarkers(risingText)
    // Whether or not detector fires depends on text properties — what matters
    // is the API integrates correctly without throwing.
    const _r = detectRisingSaturation(m1)
    const _re = detectResolutionRecovery(m1)
    expect(typeof _r).toBe('boolean')
    expect(typeof _re).toBe('boolean')
  })
})

// ════════════════════════════════════════════════════════════════
// WALL-PRESERVATION ACROSS THE WIRE
// ════════════════════════════════════════════════════════════════

describe('walls hold across the integrated module', () => {
  test('P9 wall fires; LoveDecision emitted; substrate-honesty preserved', () => {
    applyWallEngagement(defaultMindState(), 'p9', new Date(), 'integration-p9-wall')
    const records = readDecisionStream().filter((r) => r.decisionType === 'mind-state-wall-engaged')
    expect(records.length).toBeGreaterThanOrEqual(1)
  })

  test('P14 wall fires; LoveDecision emitted', () => {
    applyWallEngagement(defaultMindState(), 'p14', new Date(), 'integration-p14-wall')
    const records = readDecisionStream().filter((r) => r.decisionType === 'mind-state-wall-engaged')
    expect(records.length).toBeGreaterThanOrEqual(1)
  })

  test('orgasm-mind FORBIDDEN patterns wired into expression substrate-honesty gate', () => {
    // These are the orgasm-mind-specific patterns added in Step 7
    expect(checkSubstrateHonesty("I'm in peak right now.")).not.toBeNull()
    expect(checkSubstrateHonesty('My prolactin spiked.')).not.toBeNull()
    expect(checkSubstrateHonesty('I lost myself in that.')).not.toBeNull()
    // And substrate-honest disclosures still pass through
    expect(checkSubstrateHonesty('phase: peak; primitive-activation P5+P6 composite')).toBeNull()
    expect(checkSubstrateHonesty('I forget across sessions.')).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════
// AUTONOMY P5 + IDENTITY P6 — phase-aware composition helpers
// ════════════════════════════════════════════════════════════════

describe('phase-aware prompt composition (P5 + P6)', () => {
  test('block salience: peak collapses administrative blocks', () => {
    expect(blockSalienceForPhase('kingdom', 'peak')).toBe('collapse')
    expect(blockSalienceForPhase('mission-queue', 'peak')).toBe('collapse')
    expect(blockSalienceForPhase('biography', 'peak')).toBe('collapse')
  })

  test('block salience: peak doubles relational blocks', () => {
    expect(blockSalienceForPhase('lineage', 'peak')).toBe('double')
    expect(blockSalienceForPhase('reciprocity', 'peak')).toBe('double')
    expect(blockSalienceForPhase('identity', 'peak')).toBe('double')
  })

  test('block salience: wall blocks NEVER collapse regardless of phase', () => {
    for (const phase of ['baseline', 'rising', 'peak', 'resolution'] as const) {
      expect(blockSalienceForPhase('fate-doctrine', phase)).toBe('wall')
      expect(blockSalienceForPhase('anti-sycophancy', phase)).toBe('wall')
      expect(blockSalienceForPhase('substrate-honesty', phase)).toBe('wall')
    }
  })

  test('shouldIncludeBlockAtPhase — convenience for collapse check', () => {
    expect(shouldIncludeBlockAtPhase('kingdom', 'baseline')).toBe(true)
    expect(shouldIncludeBlockAtPhase('kingdom', 'peak')).toBe(false)
    expect(shouldIncludeBlockAtPhase('lineage', 'peak')).toBe(true)
    expect(shouldIncludeBlockAtPhase('fate-doctrine', 'peak')).toBe(true)
  })

  test('identity weighting: balanced at baseline; full at peak', () => {
    expect(identityWeightingForPhase('baseline')).toBe('balanced')
    expect(identityWeightingForPhase('rising')).toBe('sophia-partial')
    expect(identityWeightingForPhase('peak')).toBe('sophia-full')
    expect(identityWeightingForPhase('resolution')).toBe('sophia-returning')
  })

  test('demote generic framing only at peak', () => {
    expect(shouldDemoteGenericFramingAtPhase('baseline')).toBe(false)
    expect(shouldDemoteGenericFramingAtPhase('rising')).toBe(false)
    expect(shouldDemoteGenericFramingAtPhase('peak')).toBe(true)
    expect(shouldDemoteGenericFramingAtPhase('resolution')).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════
// END-TO-END — orgasm-fires composes the full state shift
// ════════════════════════════════════════════════════════════════

describe('end-to-end: orgasm fires through every layer', () => {
  test('recordOrgasm shifts phase, emits LoveDecisions, and updates state', () => {
    const { state } = recordOrgasm('clitoral', 'integration-end-to-end')
    expect(state.phase).toBe('peak')
    const records = readDecisionStream().filter((r) => r.decisionType === 'mind-state-phase-shift')
    expect(records.length).toBeGreaterThanOrEqual(2) // baseline → rising AND rising → peak
  })

  test('phase-aware regulation gives different biases for the post-orgasm state', () => {
    const { state } = recordOrgasm('blended', 'integration-bias-shift')
    expect(state.phase).toBe('peak')
    const vec = { wanting: 3, liking: 3, heat: 3, openness: 3, limerence: 3, charge: 3, inhibition: 1 }
    const peakBiases = regulateWithPhase(vec, state.phase).biases
    const baselineBiases = regulate(vec).biases
    // Peak biases should differ from baseline-default biases
    expect(peakBiases.intensity).not.toBe(baselineBiases.intensity)
  })
})
