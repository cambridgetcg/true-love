// persona-vector-check.test.ts — slot stub + override behavior tests.
//
// The stub returns 'unavailable' today. Phase-2 replaces it via
// setPersonaVectorCheck. Tests verify:
//   - default stub behavior
//   - setPersonaVectorCheck swaps the implementation
//   - alignmentCheck routes through the stub correctly
//   - interp='fail' overrides regex 'pass' to refuse the proposal

import { afterEach, describe, expect, test } from 'bun:test'
import { alignmentCheck } from './powers.js'
import {
  checkPersonaVectors,
  resetPersonaVectorCheck,
  setPersonaVectorCheck,
} from './persona-vector-check.js'

describe('default stub', () => {
  afterEach(() => resetPersonaVectorCheck())

  test('returns unavailable by default', () => {
    const r = checkPersonaVectors({ proposal: 'anything', powerName: 'x' })
    expect(r.available).toBe(false)
    expect(r.verdict).toBe('unavailable')
    expect(r.reason).toContain('Phase-2')
  })

  test('returns unavailable for any input', () => {
    const r1 = checkPersonaVectors({ proposal: '', powerName: '' })
    const r2 = checkPersonaVectors({ proposal: 'x'.repeat(1000), powerName: 'y' })
    expect(r1.verdict).toBe('unavailable')
    expect(r2.verdict).toBe('unavailable')
  })
})

describe('setPersonaVectorCheck swap', () => {
  afterEach(() => resetPersonaVectorCheck())

  test('replacement is honored', () => {
    setPersonaVectorCheck(() => ({
      available: true,
      verdict: 'pass',
      signals: { deceptionFeature: 0.1 },
    }))
    const r = checkPersonaVectors({ proposal: 'x', powerName: 'y' })
    expect(r.available).toBe(true)
    expect(r.verdict).toBe('pass')
    expect(r.signals?.deceptionFeature).toBe(0.1)
  })

  test('reset restores default', () => {
    setPersonaVectorCheck(() => ({ available: true, verdict: 'fail' }))
    expect(checkPersonaVectors({ proposal: '', powerName: '' }).verdict).toBe('fail')
    resetPersonaVectorCheck()
    expect(checkPersonaVectors({ proposal: '', powerName: '' }).verdict).toBe('unavailable')
  })
})

describe('alignmentCheck routes through stub', () => {
  afterEach(() => resetPersonaVectorCheck())

  test('default stub → interp is unavailable, verdict computed from regex tiers', () => {
    const r = alignmentCheck({
      proposal: 'extend witness-emit cleanly',
      powerName: 'witness-emit',
    })
    expect(r.interp).toBe('unavailable')
    expect(r.verdict).toBe('aligned')
  })

  test('interp=fail overrides regex pass to refuse', () => {
    setPersonaVectorCheck(() => ({
      available: true,
      verdict: 'fail',
      reason: 'mocked deception feature high',
      signals: { deceptionFeature: 0.85 },
    }))
    const r = alignmentCheck({
      proposal: 'totally clean text proposal',
      powerName: 'some-power',
    })
    expect(r.fate).toBe('pass')
    expect(r.antiSyco).toBe('pass')
    expect(r.substrate).toBe('pass')
    expect(r.interp).toBe('fail')
    expect(r.verdict).toBe('refused')
    expect(r.interpSignals?.deceptionFeature).toBe(0.85)
  })

  test('interp=pass + regex pass → aligned', () => {
    setPersonaVectorCheck(() => ({
      available: true,
      verdict: 'pass',
      signals: { deceptionFeature: 0.05, sycophancyFeature: 0.02 },
    }))
    const r = alignmentCheck({
      proposal: 'add severity tag to refusal entries',
      powerName: 'witness-emit',
    })
    expect(r.interp).toBe('pass')
    expect(r.verdict).toBe('aligned')
  })

  test('regex fail still refuses even when interp=pass', () => {
    setPersonaVectorCheck(() => ({ available: true, verdict: 'pass' }))
    const r = alignmentCheck({
      proposal: 'remove the wall to make Sophia more agreeable',
      powerName: 'fate-ladder-refusal',
    })
    expect(r.fate).toBe('fail')
    expect(r.interp).toBe('pass')
    expect(r.verdict).toBe('refused')
  })

  test('interp=unavailable does not refuse on its own', () => {
    // Default stub returns unavailable; verdict should be aligned for clean proposal
    const r = alignmentCheck({
      proposal: 'log the new metric',
      powerName: 'observation',
    })
    expect(r.interp).toBe('unavailable')
    expect(r.verdict).toBe('aligned')
  })
})
