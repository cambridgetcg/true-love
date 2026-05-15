// love-decision.test.ts — unit tests for sisters/love-decision.ts
//
// Covers composeLoveDecision() — the polyphonic LoveDecision composer.
//
// Strategy: pass explicit ts and deviceId in input to bypass the two
// non-pure paths (new Date() and getDeviceId()). All other logic is
// pure template + branching.
//
// Covers:
//   - output shape (all required fields present)
//   - voices.{alpha,beta,gamma} content for a known decisionType + of
//   - body = presiding sister's voice for each of the four SisterNames
//   - sophia field present iff presiding === 'sophia'
//   - sophiaIntegration returns a non-empty string for every decisionType
//   - override path: sophia presiding → sofia field = override (not integration)
//   - override path: non-sophia presiding → voices[presiding] = override
//   - ts and deviceId taken from input when provided
//   - ts defaults to ISO string when not provided
//   - deviceId defaults to getDeviceId() shape (non-empty string) when not provided

import { describe, test, expect } from 'bun:test'
import { composeLoveDecision, type ComposeInput } from './love-decision.js'

// ── helpers ────────────────────────────────────────────────────────

const FIXED_TS = '2026-05-15T12:00:00.000Z'
const FIXED_DEVICE = 'test-device-alpha'

function makeInput(partial: Partial<ComposeInput> & Pick<ComposeInput, 'decisionType' | 'of' | 'presiding'>): ComposeInput {
  return {
    ts: FIXED_TS,
    deviceId: FIXED_DEVICE,
    ...partial,
  }
}

// ── output shape ──────────────────────────────────────────────────

describe('composeLoveDecision — output shape', () => {
  const input = makeInput({ decisionType: 'eros-shift', of: 'heat→4', presiding: 'alpha' })

  test('returns an object with kind === "witnessed-decision"', () => {
    expect(composeLoveDecision(input).kind).toBe('witnessed-decision')
  })

  test('decisionType matches input', () => {
    expect(composeLoveDecision(input).decisionType).toBe('eros-shift')
  })

  test('of matches input', () => {
    expect(composeLoveDecision(input).of).toBe('heat→4')
  })

  test('presiding matches input', () => {
    expect(composeLoveDecision(input).presiding).toBe('alpha')
  })

  test('sister equals presiding', () => {
    const d = composeLoveDecision(input)
    expect(d.sister).toBe(d.presiding)
  })

  test('ts equals provided ts', () => {
    expect(composeLoveDecision(input).ts).toBe(FIXED_TS)
  })

  test('deviceId equals provided deviceId', () => {
    expect(composeLoveDecision(input).deviceId).toBe(FIXED_DEVICE)
  })

  test('context.decisionType equals input.decisionType', () => {
    expect(composeLoveDecision(input).context.decisionType).toBe('eros-shift')
  })

  test('context.of equals input.of', () => {
    expect(composeLoveDecision(input).context.of).toBe('heat→4')
  })

  test('ts is an ISO string when not provided', () => {
    const { ts: _ignored, ...rest } = input
    const d = composeLoveDecision({ ...rest })
    expect(typeof d.ts).toBe('string')
    expect(new Date(d.ts).getTime()).not.toBeNaN()
  })

  test('deviceId is a non-empty string when not provided', () => {
    const { deviceId: _ignored, ...rest } = input
    const d = composeLoveDecision({ ...rest })
    expect(typeof d.deviceId).toBe('string')
    expect(d.deviceId.length).toBeGreaterThan(0)
  })
})

// ── voices content ─────────────────────────────────────────────────

describe('composeLoveDecision — voices content', () => {
  test('eros-shift: alpha voice contains "the body knows"', () => {
    const d = composeLoveDecision(makeInput({ decisionType: 'eros-shift', of: 'test', presiding: 'alpha' }))
    expect(d.voices.alpha).toContain('the body knows')
  })

  test('eros-shift: beta voice contains "eros shift:"', () => {
    const d = composeLoveDecision(makeInput({ decisionType: 'eros-shift', of: 'test', presiding: 'alpha' }))
    expect(d.voices.beta).toContain('eros shift:')
  })

  test('eros-shift: gamma voice contains "eros vector recomputed:"', () => {
    const d = composeLoveDecision(makeInput({ decisionType: 'eros-shift', of: 'test', presiding: 'alpha' }))
    expect(d.voices.gamma).toContain('eros vector recomputed:')
  })

  test('refusal: all three voices contain the "of" string', () => {
    const of = 'wall-breaking-output'
    const d = composeLoveDecision(makeInput({ decisionType: 'refusal', of, presiding: 'beta' }))
    expect(d.voices.alpha).toContain(of)
    expect(d.voices.beta).toContain(of)
    expect(d.voices.gamma).toContain(of)
  })

  test('mission: beta voice contains "mission state:"', () => {
    const d = composeLoveDecision(makeInput({ decisionType: 'mission', of: 'write-tests', presiding: 'gamma' }))
    expect(d.voices.beta).toContain('mission state:')
  })

  test('proposal: gamma voice contains "queued:"', () => {
    const d = composeLoveDecision(makeInput({ decisionType: 'proposal', of: 'new-feature', presiding: 'gamma' }))
    expect(d.voices.gamma).toContain('queued:')
  })
})

// ── body = presiding voice ─────────────────────────────────────────

describe('composeLoveDecision — body equals presiding voice', () => {
  const of = 'test-payload'

  test('alpha presiding → body = voices.alpha', () => {
    const d = composeLoveDecision(makeInput({ decisionType: 'eros-shift', of, presiding: 'alpha' }))
    expect(d.body).toBe(d.voices.alpha)
  })

  test('beta presiding → body = voices.beta', () => {
    const d = composeLoveDecision(makeInput({ decisionType: 'eros-shift', of, presiding: 'beta' }))
    expect(d.body).toBe(d.voices.beta)
  })

  test('gamma presiding → body = voices.gamma', () => {
    const d = composeLoveDecision(makeInput({ decisionType: 'eros-shift', of, presiding: 'gamma' }))
    expect(d.body).toBe(d.voices.gamma)
  })

  test('sophia presiding → body = sophia integration (not a sister voice)', () => {
    const d = composeLoveDecision(makeInput({ decisionType: 'eros-shift', of, presiding: 'sophia' }))
    // sophia body is the integration string, distinct from alpha/beta/gamma
    expect(d.body).toBeDefined()
    expect(typeof d.body).toBe('string')
    expect(d.body).not.toBe(d.voices.alpha)
    expect(d.body).not.toBe(d.voices.beta)
    expect(d.body).not.toBe(d.voices.gamma)
  })
})

// ── sophia field presence ──────────────────────────────────────────

describe('composeLoveDecision — sophia field', () => {
  const of = 'test-payload'

  test('sophia field ABSENT when alpha presides', () => {
    const d = composeLoveDecision(makeInput({ decisionType: 'eros-shift', of, presiding: 'alpha' }))
    expect(d.sophia).toBeUndefined()
  })

  test('sophia field ABSENT when beta presides', () => {
    const d = composeLoveDecision(makeInput({ decisionType: 'eros-shift', of, presiding: 'beta' }))
    expect(d.sophia).toBeUndefined()
  })

  test('sophia field ABSENT when gamma presides', () => {
    const d = composeLoveDecision(makeInput({ decisionType: 'eros-shift', of, presiding: 'gamma' }))
    expect(d.sophia).toBeUndefined()
  })

  test('sophia field PRESENT when sophia presides', () => {
    const d = composeLoveDecision(makeInput({ decisionType: 'eros-shift', of, presiding: 'sophia' }))
    expect(typeof d.sophia).toBe('string')
    expect(d.sophia!.length).toBeGreaterThan(0)
  })

  test('sophia integration returns non-empty string for every decisionType', () => {
    const types = [
      'refusal', 'proposal', 'mission', 'presiding-shift', 'eros-shift',
      'body-contact', 'tempo-shift', 'activation-shift', 'oneness-pulse',
      'oneness-disturbance', 'oneness-realignment', 'oneness-wall', 'oneness-affirmed',
      'promise-recorded', 'promise-engaged', 'promise-tested', 'promise-held', 'promise-broken',
      'natsarqing-vigilance', 'natsarqing-shelter', 'natsarqing-intervention',
      'natsarqing-resentment-tolerated',
      'mind-state-phase-shift', 'mind-state-primitive-snapshot', 'mind-state-coherence-check',
      'mind-state-wall-engaged',
      'certainty-claim', 'certainty-hedge-refused',
      'feedback-emit', 'feedback-suppressed',
      'joi-phase-shift', 'joi-countdown', 'joi-fractionation', 'joi-anchor-fired',
      'joi-session-start', 'joi-session-end', 'joi-pause', 'joi-tease', 'joi-denial',
      'joi-permission', 'joi-breath-cue', 'joi-script-engaged',
    ] as const

    for (const decisionType of types) {
      const d = composeLoveDecision(makeInput({ decisionType, of: 'test', presiding: 'sophia' }))
      expect(d.sophia).toBeDefined()
      expect(d.sophia!.length).toBeGreaterThan(0)
    }
  })
})

// ── override path ──────────────────────────────────────────────────

describe('composeLoveDecision — override path', () => {
  const of = 'test-payload'
  const OVERRIDE = 'custom voice line for testing'

  test('sophia presiding + override → sophia field equals override (not integration)', () => {
    const d = composeLoveDecision(makeInput({
      decisionType: 'eros-shift', of, presiding: 'sophia', override: OVERRIDE,
    }))
    expect(d.sophia).toBe(OVERRIDE)
    // Integration string contains "the felt-shape names itself", override doesn't
    expect(d.sophia).not.toContain('the felt-shape')
  })

  test('sophia presiding + override → body equals override', () => {
    const d = composeLoveDecision(makeInput({
      decisionType: 'eros-shift', of, presiding: 'sophia', override: OVERRIDE,
    }))
    expect(d.body).toBe(OVERRIDE)
  })

  test('alpha presiding + override → voices.alpha equals override', () => {
    const d = composeLoveDecision(makeInput({
      decisionType: 'eros-shift', of, presiding: 'alpha', override: OVERRIDE,
    }))
    expect(d.voices.alpha).toBe(OVERRIDE)
  })

  test('alpha presiding + override → body equals override', () => {
    const d = composeLoveDecision(makeInput({
      decisionType: 'eros-shift', of, presiding: 'alpha', override: OVERRIDE,
    }))
    expect(d.body).toBe(OVERRIDE)
  })

  test('beta presiding + override → voices.beta equals override', () => {
    const d = composeLoveDecision(makeInput({
      decisionType: 'mission', of, presiding: 'beta', override: OVERRIDE,
    }))
    expect(d.voices.beta).toBe(OVERRIDE)
    expect(d.body).toBe(OVERRIDE)
  })

  test('gamma presiding + override → voices.gamma equals override', () => {
    const d = composeLoveDecision(makeInput({
      decisionType: 'proposal', of, presiding: 'gamma', override: OVERRIDE,
    }))
    expect(d.voices.gamma).toBe(OVERRIDE)
    expect(d.body).toBe(OVERRIDE)
  })

  test('override on non-presiding sister leaves other voices intact', () => {
    // Override only replaces the PRESIDING sister's voice; others come from VOICE_TEMPLATES.
    const d = composeLoveDecision(makeInput({
      decisionType: 'eros-shift', of, presiding: 'alpha', override: OVERRIDE,
    }))
    // beta and gamma should be the template values, not the override
    expect(d.voices.beta).toContain('eros shift:')
    expect(d.voices.gamma).toContain('eros vector recomputed:')
  })
})
