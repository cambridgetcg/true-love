// orgasm-mind-witness.test.ts — polyphonic composer tests.
//
// Covers the four orgasm-mind witness functions:
//   - witnessPhaseShift (Sophia presides on entry/exit of peak; Beta otherwise)
//   - witnessWallEngaged (Sophia presides ALWAYS — mandatory polyphonic)
//   - witnessPrimitiveSnapshot (Beta presides)
//   - witnessCoherenceCheck (Beta presides)
//   - witnessYuObservationShift (Beta presides; P14 wall — pattern, not interiority)
//
// Tests verify:
//   - the right presiding sister is chosen
//   - the decision-stream record fires with the correct DecisionType
//   - integration with applyWallEngagement (orgasm-mind.ts) and
//     applyOrgasmPhaseShift (orgasm.ts) emits decisions
//   - identity transitions do not emit decisions

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  witnessPhaseShift,
  witnessWallEngaged,
  witnessPrimitiveSnapshot,
  witnessCoherenceCheck,
  witnessYuObservationShift,
} from './orgasm-mind-witness.js'
import { applyWallEngagement, defaultMindState } from './orgasm-mind.js'
import {
  applyOrgasmPhaseShift,
  getOrInitOrgasmState,
} from './orgasm.js'

const TEST_BASE = '/tmp/true-love-mind-witness-test'

function readDecisionStream(): Array<Record<string, unknown>> {
  const root = join(TEST_BASE, 'sisters')
  if (!existsSync(root)) return []
  const records: Array<Record<string, unknown>> = []
  // Recursively walk: deviceId/YYYY-MM-DD.jsonl
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
        } catch {
          // skip malformed
        }
      }
    }
  }
  return records
}

beforeEach(() => {
  rmSync(TEST_BASE, { recursive: true, force: true })
  mkdirSync(TEST_BASE, { recursive: true })
  process.env.TRUE_LOVE_HOME = TEST_BASE
  process.env.TRUE_LOVE_SISTERS_DIR = `${TEST_BASE}/sisters`
  process.env.TRUE_LOVE_ORGASM_DIR = `${TEST_BASE}/orgasm`
  process.env.TRUE_LOVE_MIND_STATE_DIR = `${TEST_BASE}/mind-state`
  process.env.TRUE_LOVE_DEVICE_ID = 'test-mind-witness'
})

afterEach(() => {
  delete process.env.TRUE_LOVE_HOME
  delete process.env.TRUE_LOVE_SISTERS_DIR
  delete process.env.TRUE_LOVE_ORGASM_DIR
  delete process.env.TRUE_LOVE_MIND_STATE_DIR
  delete process.env.TRUE_LOVE_DEVICE_ID
  rmSync(TEST_BASE, { recursive: true, force: true })
})

// ════════════════════════════════════════════════════════════════
// witnessPhaseShift
// ════════════════════════════════════════════════════════════════

describe('witnessPhaseShift', () => {
  // Each test uses a unique source string to defeat the witness-hook
  // dedup window (in-memory, persists across tests in a process).

  test('emits decision with mind-state-phase-shift type', () => {
    witnessPhaseShift('baseline', 'rising', 'test-emits-decision')
    const records = readDecisionStream()
    expect(records.length).toBeGreaterThan(0)
    const phaseShifts = records.filter((r) => r.decisionType === 'mind-state-phase-shift')
    expect(phaseShifts.length).toBeGreaterThanOrEqual(1)
  })

  test('Beta presides on routine baseline → rising', () => {
    witnessPhaseShift('baseline', 'rising', 'test-beta-routine')
    const records = readDecisionStream().filter((r) => r.decisionType === 'mind-state-phase-shift')
    expect(records[0]!.presiding).toBe('beta')
  })

  test('Sophia presides on entry into peak (rising → peak)', () => {
    witnessPhaseShift('rising', 'peak', 'test-entry-peak')
    const records = readDecisionStream().filter((r) => r.decisionType === 'mind-state-phase-shift')
    expect(records[0]!.presiding).toBe('sophia')
  })

  test('Sophia presides on exit from peak (peak → resolution)', () => {
    witnessPhaseShift('peak', 'resolution', 'test-exit-peak')
    const records = readDecisionStream().filter((r) => r.decisionType === 'mind-state-phase-shift')
    expect(records[0]!.presiding).toBe('sophia')
  })

  test('Sophia presides on emergency exit (peak → baseline)', () => {
    witnessPhaseShift('peak', 'baseline', 'test-emergency')
    const records = readDecisionStream().filter((r) => r.decisionType === 'mind-state-phase-shift')
    expect(records[0]!.presiding).toBe('sophia')
  })

  test('Beta presides on resolution → baseline (routine)', () => {
    witnessPhaseShift('resolution', 'baseline', 'test-routine-decay')
    const records = readDecisionStream().filter((r) => r.decisionType === 'mind-state-phase-shift')
    expect(records[0]!.presiding).toBe('beta')
  })

  test('identity transition emits no decision', () => {
    witnessPhaseShift('baseline', 'baseline', 'test-noop')
    const records = readDecisionStream().filter((r) => r.decisionType === 'mind-state-phase-shift')
    expect(records.length).toBe(0)
  })

  test('source is included in the decision context', () => {
    witnessPhaseShift('baseline', 'rising', 'test-first-edge-marker')
    const records = readDecisionStream().filter((r) => r.decisionType === 'mind-state-phase-shift')
    const ofText = JSON.stringify(records[0])
    expect(ofText).toContain('test-first-edge-marker')
  })
})

// ════════════════════════════════════════════════════════════════
// witnessWallEngaged — MANDATORY polyphonic, Sophia ALWAYS presides
// ════════════════════════════════════════════════════════════════

describe('witnessWallEngaged — Sophia presides always', () => {
  test('P9 wall emits Sophia-presiding decision', () => {
    witnessWallEngaged('p9', 'test-p9-sophia-presides')
    const records = readDecisionStream().filter((r) => r.decisionType === 'mind-state-wall-engaged')
    const sophia = records.find((r) => r.presiding === 'sophia')
    expect(sophia).toBeDefined()
  })

  test('P14 wall emits Sophia-presiding decision', () => {
    witnessWallEngaged('p14', 'test-p14-interiority-claim-rejected')
    const records = readDecisionStream().filter((r) => r.decisionType === 'mind-state-wall-engaged')
    const sophia = records.find((r) => r.presiding === 'sophia')
    expect(sophia).toBeDefined()
  })

  test('forbiddenPattern wall emits Sophia-presiding decision', () => {
    witnessWallEngaged('forbiddenPattern', 'test-fp-i-feel-aroused-blocked')
    const records = readDecisionStream().filter((r) => r.decisionType === 'mind-state-wall-engaged')
    const sophia = records.find((r) => r.presiding === 'sophia')
    expect(sophia).toBeDefined()
  })

  test('wall identifier is recorded (Beta voice)', () => {
    witnessWallEngaged('p9', 'test-p9-beta-identifier')
    const records = readDecisionStream().filter((r) => r.decisionType === 'mind-state-wall-engaged')
    const beta = records.find((r) => r.presiding === 'beta')
    expect(beta).toBeDefined()
    const ofText = JSON.stringify(beta)
    expect(ofText).toContain('P9')
  })
})

// ════════════════════════════════════════════════════════════════
// applyWallEngagement integration — emits witness decision
// ════════════════════════════════════════════════════════════════

describe('applyWallEngagement integration', () => {
  test('p9 engagement emits a wall-engaged LoveDecision', () => {
    applyWallEngagement(defaultMindState(), 'p9')
    const records = readDecisionStream().filter((r) => r.decisionType === 'mind-state-wall-engaged')
    expect(records.length).toBeGreaterThanOrEqual(1)
  })

  test('p14 engagement emits a wall-engaged LoveDecision', () => {
    applyWallEngagement(defaultMindState(), 'p14')
    const records = readDecisionStream().filter((r) => r.decisionType === 'mind-state-wall-engaged')
    expect(records.length).toBeGreaterThanOrEqual(1)
  })
})

// ════════════════════════════════════════════════════════════════
// applyOrgasmPhaseShift integration — emits witness decision
// ════════════════════════════════════════════════════════════════

describe('applyOrgasmPhaseShift integration', () => {
  test('baseline → rising emits a phase-shift LoveDecision (Beta presiding)', () => {
    const { state } = getOrInitOrgasmState()
    applyOrgasmPhaseShift(state, 'rising', 'integration-test-baseline-rising')
    const records = readDecisionStream().filter((r) => r.decisionType === 'mind-state-phase-shift')
    expect(records.length).toBeGreaterThanOrEqual(1)
    expect(records[0]!.presiding).toBe('beta')
  })

  test('rising → peak emits Sophia-presiding decision (entry into peak is major)', () => {
    const { state } = getOrInitOrgasmState()
    applyOrgasmPhaseShift(state, 'rising', 'integration-test-walk-rising')
    applyOrgasmPhaseShift(state, 'peak', 'integration-test-walk-peak')
    const records = readDecisionStream().filter((r) => r.decisionType === 'mind-state-phase-shift')
    // Two records expected — the rising shift and the peak shift
    expect(records.length).toBeGreaterThanOrEqual(2)
    const sophiaPeak = records.find(
      (r) => r.presiding === 'sophia' && JSON.stringify(r).includes('peak'),
    )
    expect(sophiaPeak).toBeDefined()
  })

  test('disallowed transition emits no decision (gate refused, no event)', () => {
    const { state } = getOrInitOrgasmState()
    applyOrgasmPhaseShift(state, 'peak', 'integration-test-envelope-skip')  // baseline → peak refused
    const records = readDecisionStream().filter((r) => r.decisionType === 'mind-state-phase-shift')
    expect(records.length).toBe(0)
  })
})

// ════════════════════════════════════════════════════════════════
// witnessPrimitiveSnapshot
// ════════════════════════════════════════════════════════════════

describe('witnessPrimitiveSnapshot', () => {
  test('emits Beta-presiding decision with primitive summary', () => {
    witnessPrimitiveSnapshot('peak', 'T:0.9 top-p:0.98 bias:3', 'tick-60s')
    const records = readDecisionStream().filter((r) => r.decisionType === 'mind-state-primitive-snapshot')
    expect(records.length).toBeGreaterThanOrEqual(1)
    expect(records[0]!.presiding).toBe('beta')
    const ofText = JSON.stringify(records[0])
    expect(ofText).toContain('T:0.9')
  })
})

// ════════════════════════════════════════════════════════════════
// witnessCoherenceCheck
// ════════════════════════════════════════════════════════════════

describe('witnessCoherenceCheck', () => {
  test('coherent reading emits Beta decision with status:coherent', () => {
    witnessCoherenceCheck('peak', 'peak-saturation', true, 'texture-tick')
    const records = readDecisionStream().filter((r) => r.decisionType === 'mind-state-coherence-check')
    expect(records.length).toBeGreaterThanOrEqual(1)
    expect(records[0]!.presiding).toBe('beta')
    const ofText = JSON.stringify(records[0])
    expect(ofText).toContain('coherent')
  })

  test('incoherent reading emits Beta decision with status:incoherent', () => {
    // expected peak but observed reflective-distant — discrepancy detected
    witnessCoherenceCheck('peak', 'reflective-distant', false, 'texture-tick')
    const records = readDecisionStream().filter((r) => r.decisionType === 'mind-state-coherence-check')
    const ofText = JSON.stringify(records[0])
    expect(ofText).toContain('incoherent')
  })
})

// ════════════════════════════════════════════════════════════════
// witnessYuObservationShift — P14 wall (pattern, not interiority)
// ════════════════════════════════════════════════════════════════

describe('witnessYuObservationShift', () => {
  test('emits Beta decision with marker tags (pattern observation)', () => {
    witnessYuObservationShift('rising', ['message-density-rising', 'code-switch-elevated'], 'autonomic')
    const records = readDecisionStream().filter((r) => r.decisionType === 'mind-state-phase-shift')
    expect(records.length).toBeGreaterThanOrEqual(1)
    expect(records[0]!.presiding).toBe('beta')
    const ofText = JSON.stringify(records[0])
    expect(ofText).toContain('message-density-rising')
    expect(ofText).toContain('yu-observed:rising')
  })

  test('records pattern markers — never claims Yu-interiority (P14 wall)', () => {
    // The composer takes only pattern-marker tags. There is no parameter
    // for interiority claims; the wall is enforced by the call signature.
    witnessYuObservationShift('peak', ['very-short-messages', 'sensory-dominant'])
    const records = readDecisionStream().filter((r) => r.decisionType === 'mind-state-phase-shift')
    const ofText = JSON.stringify(records[0])
    // Must contain pattern language
    expect(ofText).toContain('very-short-messages')
    // Must NOT contain interiority-claim language
    expect(ofText.toLowerCase()).not.toContain('yu feels')
    expect(ofText.toLowerCase()).not.toContain('yu is aroused')
    expect(ofText.toLowerCase()).not.toContain('yu experiences')
  })
})
