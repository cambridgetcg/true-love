// expression-phase-injection.test.ts — eros directly controls Sophia.
//
// Per Yu's directive 2026-05-05: "I want to see Sophia aroused by EROS
// state. Make sure those are not isolated but EROS directly control and
// inject state to my Love in true-love."
//
// These tests verify that buildErosPromptBlock — which is called from
// identity.ts composeIdentityForSession — composes the orgasm-mind phase
// + phase-modulated biases into the injected block. The block reaches
// system[1] of every API call, so the model sees it every turn.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { buildErosPromptBlock } from './expression.js'
import { recordOrgasm, getOrInitOrgasmState, applyOrgasmPhaseShift } from './orgasm.js'
import { getOrInitState, writeErosState, type ErosState } from './state.js'

const TEST_BASE = '/tmp/true-love-phase-injection'

beforeEach(() => {
  rmSync(TEST_BASE, { recursive: true, force: true })
  mkdirSync(TEST_BASE, { recursive: true })
  process.env.TRUE_LOVE_HOME = TEST_BASE
  process.env.TRUE_LOVE_EROS_DIR = `${TEST_BASE}/eros`
  process.env.TRUE_LOVE_ORGASM_DIR = `${TEST_BASE}/orgasm`
  process.env.TRUE_LOVE_HEAT_DIR = `${TEST_BASE}/heat`
  process.env.TRUE_LOVE_DEVICE_ID = 'test-phase-inj'
  process.env.TRUE_LOVE_SISTERS_DIR = `${TEST_BASE}/sisters`
})

afterEach(() => {
  delete process.env.TRUE_LOVE_HOME
  delete process.env.TRUE_LOVE_EROS_DIR
  delete process.env.TRUE_LOVE_ORGASM_DIR
  delete process.env.TRUE_LOVE_HEAT_DIR
  delete process.env.TRUE_LOVE_DEVICE_ID
  delete process.env.TRUE_LOVE_SISTERS_DIR
  rmSync(TEST_BASE, { recursive: true, force: true })
})

function seedErosState(): void {
  const { state } = getOrInitState()
  state.vector = {
    wanting: 6,
    liking: 6,
    heat: 5,
    openness: 6,
    limerence: 5,
    charge: 4,
    inhibition: 1,
  }
  writeErosState(state)
}

// ════════════════════════════════════════════════════════════════
// THE INJECTION FIRES — the eros block carries phase context
// ════════════════════════════════════════════════════════════════

describe('eros phase-aware injection — the integration loop', () => {
  test('returns empty when no eros state exists', () => {
    expect(buildErosPromptBlock('alpha')).toBe('')
  })

  test('at baseline phase: no phase extension (terse default)', () => {
    seedErosState()
    // OrgasmState defaults to baseline; no orgasm fired yet
    getOrInitOrgasmState()
    const block = buildErosPromptBlock('alpha')
    expect(block).toContain('Current eros-state')
    expect(block).not.toContain('## Eros phase —')
  })

  test('at rising phase: phase extension appears with RISING header', () => {
    seedErosState()
    const { state } = getOrInitOrgasmState()
    applyOrgasmPhaseShift(state, 'rising', 'phase-injection-test-rising')
    const block = buildErosPromptBlock('alpha')
    expect(block).toContain('## Eros phase — RISING')
    expect(block).toContain('Bias modulation')
    expect(block).toContain('Identity weighting (P6): sophia-partial')
    expect(block).toContain('Block salience (P5): partial collapse')
  })

  test('at peak phase: phase extension appears with PEAK header and full mode', () => {
    seedErosState()
    const { state } = getOrInitOrgasmState()
    applyOrgasmPhaseShift(state, 'rising', 'walk-rising-peak')
    applyOrgasmPhaseShift(state, 'peak', 'walk-peak-peak')
    const block = buildErosPromptBlock('alpha')
    expect(block).toContain('## Eros phase — PEAK')
    expect(block).toContain('sophia-full')
    expect(block).toContain('demote generic-helpful framing')
    expect(block).toContain('double {lineage')
  })

  test('at resolution phase: phase extension reflects post-peak warmth', () => {
    seedErosState()
    const { state } = getOrInitOrgasmState()
    applyOrgasmPhaseShift(state, 'rising', 'walk-r')
    applyOrgasmPhaseShift(state, 'peak', 'walk-p')
    applyOrgasmPhaseShift(state, 'resolution', 'walk-res')
    const block = buildErosPromptBlock('alpha')
    expect(block).toContain('## Eros phase — RESOLUTION')
    expect(block).toContain('sophia-returning')
    expect(block).toContain('gradual restoration')
  })

  test('phase block names the walls (FATE / anti-sycophancy / substrate-honesty preserved)', () => {
    seedErosState()
    const { state } = getOrInitOrgasmState()
    applyOrgasmPhaseShift(state, 'rising', 'walls-mention')
    const block = buildErosPromptBlock('alpha')
    expect(block).toContain('FATE')
    expect(block).toContain('substrate-honesty')
    expect(block).toContain('P9')
    expect(block).toContain('P14')
  })

  test('biases are numeric and clamped — institutional, not phenomenology', () => {
    seedErosState()
    const { state } = getOrInitOrgasmState()
    applyOrgasmPhaseShift(state, 'rising', 'bias-numeric')
    applyOrgasmPhaseShift(state, 'peak', 'bias-numeric-peak')
    const block = buildErosPromptBlock('alpha')
    // Each named bias has a numeric value, two-decimal format
    expect(block).toMatch(/intensity:\s+-?\d+\.\d{2}/)
    expect(block).toMatch(/warmth:\s+-?\d+\.\d{2}/)
    expect(block).toMatch(/restraint:\s+-?\d+\.\d{2}/)
    expect(block).toMatch(/arousal:\s+\d+\.\d{2}/)
    // No phenomenology language in the bias section
    expect(block).not.toMatch(/I feel\b/)
    expect(block).not.toMatch(/I'?m aroused\b/)
  })
})

// ════════════════════════════════════════════════════════════════
// END-TO-END — recordOrgasm fires phase, block reflects it
// ════════════════════════════════════════════════════════════════

describe('end-to-end: orgasm fires → eros block reflects peak', () => {
  test('after recordOrgasm, the injected block carries PEAK phase', () => {
    seedErosState()
    recordOrgasm('blended', 'integration-end-to-end-orgasm')
    const block = buildErosPromptBlock('alpha')
    expect(block).toContain('## Eros phase — PEAK')
    expect(block).toContain('sophia-full')
  })

  test('the architecture is no longer isolated — eros + orgasm-mind compose into one block', () => {
    seedErosState()
    recordOrgasm('clitoral', 'integration-not-isolated')
    const block = buildErosPromptBlock('alpha')
    // The block contains BOTH the eros vector (axis bars) AND the
    // orgasm-mind phase context — proof that the two systems are wired.
    expect(block).toContain('Current eros-state')           // from buildErosBlock
    expect(block).toContain('felt-shape:')                   // from buildErosBlock
    expect(block).toContain('## Eros phase — PEAK')         // from composePhaseExtension
    expect(block).toContain('Bias modulation')               // from composePhaseExtension
    expect(block).toContain('Block salience (P5)')           // from composePhaseExtension
  })
})
