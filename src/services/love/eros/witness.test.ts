// witness.test.ts — unit tests for eros/witness.ts
//
// Covers: witnessTransition (no crossings, single crossing, crossing line format,
//         debounce suppression, debounce expired, composite state entry, composite
//         not re-fired) + resetErosWitnessDedup.
//
// Isolation: no mock.module (avoids cross-file module-cache leakage).
// Uses TRUE_LOVE_SISTERS_DIR + TRUE_LOVE_DEVICE_ID to redirect LoveDecision
// writes to a temp dir. Reads back eros-shift decisions to verify call count.
//
// Notes on design:
//   - witnessTransition writes 2 records per crossing: one 'eros-shift' (witness-hook)
//     and one 'feedback-emit' (feedbackOnAxisShift → feedback/index). We count only
//     'eros-shift' type decisions as the canonical witness-call indicator.
//   - Sisters dir may contain non-directory entries (e.g. now.md from feedback system).
//     readDecisions() guards with isDirectory().

import { describe, test, expect, beforeEach, afterEach, setSystemTime } from 'bun:test'
import { mkdirSync, rmSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { witnessTransition, resetErosWitnessDedup } from './witness.js'
import { resetWitnessDedup } from '../sisters/witness-hook.js'
import { defaultVector } from './axes.js'
import type { ErosVector, AxisName } from './axes.js'
import type { ThresholdCrossing, TransitionResult } from './transitions.js'
import type { Attribution } from './state.js'

// ── Helpers ────────────────────────────────────────────────────────

function makeCrossing(override: Partial<ThresholdCrossing> = {}): ThresholdCrossing {
  return {
    axis: 'heat' as AxisName,
    from: 2,
    to: 4,
    threshold: 3,
    direction: 'up',
    ...override,
  }
}

function makeResult(override: Partial<TransitionResult> = {}): TransitionResult {
  return {
    before: defaultVector(),
    after: defaultVector(),
    attribution: 'init' as Attribution,
    crossings: [],
    ts: new Date().toISOString(),
    ...override,
  }
}

/** All excitation axes >= 7 → ecstatic-union composite shape. */
function ecstaticVector(): ErosVector {
  return {
    wanting: 9, liking: 9, heat: 9,
    openness: 9, limerence: 9, charge: 9,
    inhibition: 0, valence: 5,
  }
}

/** Read only 'eros-shift' LoveDecision records from the sisters temp dir. */
function readErosShiftDecisions(sistersDir: string): Array<Record<string, unknown>> {
  if (!existsSync(sistersDir)) return []
  const records: Array<Record<string, unknown>> = []
  try {
    for (const dev of readdirSync(sistersDir)) {
      const devDir = join(sistersDir, dev)
      try {
        if (!statSync(devDir).isDirectory()) continue
      } catch { continue }
      let files: string[] = []
      try { files = readdirSync(devDir).filter(f => f.endsWith('.jsonl')) } catch { continue }
      for (const f of files) {
        const content = readFileSync(join(devDir, f), 'utf-8')
        for (const line of content.split('\n')) {
          if (!line.trim()) continue
          try {
            const obj = JSON.parse(line) as Record<string, unknown>
            if (obj.decisionType === 'eros-shift') records.push(obj)
          } catch { /* skip malformed */ }
        }
      }
    }
  } catch { /* best-effort */ }
  return records
}

// ── Lifecycle ──────────────────────────────────────────────────────

let tmpDir: string
let sistersDir: string
const REAL_SISTERS_DIR = process.env.TRUE_LOVE_SISTERS_DIR
const REAL_DEVICE_ID   = process.env.TRUE_LOVE_DEVICE_ID

beforeEach(() => {
  tmpDir = join(tmpdir(), `tl-witness-${process.pid}-${Date.now()}`)
  mkdirSync(tmpDir, { recursive: true })
  sistersDir = join(tmpDir, 'sisters')
  process.env.TRUE_LOVE_SISTERS_DIR = sistersDir
  process.env.TRUE_LOVE_DEVICE_ID   = 'test-witness-device'
  resetErosWitnessDedup()
  resetWitnessDedup()
  // Clear composite state by passing a resting vector (sets lastCompositeShape = null)
  witnessTransition(makeResult({ after: defaultVector() }))
  resetErosWitnessDedup()
  resetWitnessDedup()
  // Fresh temp dir so prior warm-up writes don't pollute the test
  rmSync(sistersDir, { recursive: true, force: true })
  mkdirSync(sistersDir, { recursive: true })
  setSystemTime()
})

afterEach(() => {
  if (REAL_SISTERS_DIR !== undefined) process.env.TRUE_LOVE_SISTERS_DIR = REAL_SISTERS_DIR
  else delete process.env.TRUE_LOVE_SISTERS_DIR
  if (REAL_DEVICE_ID !== undefined) process.env.TRUE_LOVE_DEVICE_ID = REAL_DEVICE_ID
  else delete process.env.TRUE_LOVE_DEVICE_ID
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* cleanup */ }
  setSystemTime()
})

// ── Tests ──────────────────────────────────────────────────────────

describe('witnessTransition — no crossings, non-composite', () => {
  test('does not write an eros-shift decision when no crossings and non-composite', () => {
    witnessTransition(makeResult({ crossings: [], after: defaultVector() }))
    expect(readErosShiftDecisions(sistersDir)).toHaveLength(0)
  })
})

describe('witnessTransition — single crossing', () => {
  test('writes one eros-shift decision for one crossing', () => {
    witnessTransition(makeResult({ crossings: [makeCrossing()] }))
    expect(readErosShiftDecisions(sistersDir)).toHaveLength(1)
  })

  test('decision context.of encodes axis:threshold:direction', () => {
    const crossing = makeCrossing({ axis: 'heat', threshold: 3, direction: 'up' })
    witnessTransition(makeResult({ crossings: [crossing] }))
    const decisions = readErosShiftDecisions(sistersDir)
    const ctx = decisions[0].context as Record<string, string>
    expect(ctx.of).toBe('heat:3:up')
  })

  test('decision body line includes axis, from, to, attribution and up-arrow', () => {
    const crossing = makeCrossing({ axis: 'heat', from: 2, to: 4, direction: 'up' })
    witnessTransition(makeResult({ crossings: [crossing], attribution: 'cue' as Attribution }))
    const body = readErosShiftDecisions(sistersDir)[0].body as string
    expect(body).toContain('heat')
    expect(body).toContain('2.0')
    expect(body).toContain('4.0')
    expect(body).toContain('cue')
    expect(body).toContain('→')
  })

  test('down-crossing uses ← in body line', () => {
    const crossing = makeCrossing({ axis: 'charge', from: 7, to: 4, threshold: 6, direction: 'down' })
    witnessTransition(makeResult({ crossings: [crossing] }))
    const body = readErosShiftDecisions(sistersDir)[0].body as string
    expect(body).toContain('←')
  })
})

describe('witnessTransition — multiple crossings', () => {
  test('writes one eros-shift decision per crossing', () => {
    const crossings = [
      makeCrossing({ axis: 'heat', threshold: 3, direction: 'up' }),
      makeCrossing({ axis: 'charge', from: 7, to: 4, threshold: 6, direction: 'down' }),
    ]
    witnessTransition(makeResult({ crossings }))
    expect(readErosShiftDecisions(sistersDir)).toHaveLength(2)
  })
})

describe('witnessTransition — debounce (30s window)', () => {
  test('duplicate crossing within 30s writes only one eros-shift decision', () => {
    const ANCHOR = new Date('2026-03-01T12:00:00.000Z')
    setSystemTime(ANCHOR)
    const crossing = makeCrossing()

    witnessTransition(makeResult({ crossings: [crossing] }))
    // 1s later — still within eros debounce window
    setSystemTime(new Date(ANCHOR.getTime() + 1_000))
    witnessTransition(makeResult({ crossings: [crossing] }))

    expect(readErosShiftDecisions(sistersDir)).toHaveLength(1)
  })

  test('same crossing after 30s fires again', () => {
    const ANCHOR = new Date('2026-03-01T12:00:00.000Z')
    setSystemTime(ANCHOR)
    const crossing = makeCrossing()

    witnessTransition(makeResult({ crossings: [crossing] }))
    // 30s + 1ms — eros debounce expired
    setSystemTime(new Date(ANCHOR.getTime() + 30_001))
    resetWitnessDedup() // also reset witness-hook dedup so second write goes through
    witnessTransition(makeResult({ crossings: [crossing] }))

    expect(readErosShiftDecisions(sistersDir)).toHaveLength(2)
  })

  test('different crossings are not debounced by each other', () => {
    witnessTransition(makeResult({ crossings: [makeCrossing({ axis: 'heat', threshold: 3, direction: 'up' })] }))
    witnessTransition(makeResult({ crossings: [makeCrossing({ axis: 'charge', from: 7, to: 4, threshold: 6, direction: 'down' })] }))
    expect(readErosShiftDecisions(sistersDir)).toHaveLength(2)
  })
})

describe('resetErosWitnessDedup', () => {
  test('clears eros debounce so the same crossing fires again within the window', () => {
    const ANCHOR = new Date('2026-03-01T12:00:00.000Z')
    setSystemTime(ANCHOR)
    const crossing = makeCrossing()

    witnessTransition(makeResult({ crossings: [crossing] }))
    // Still within window — would normally be suppressed
    setSystemTime(new Date(ANCHOR.getTime() + 1_000))
    resetErosWitnessDedup()
    resetWitnessDedup()
    witnessTransition(makeResult({ crossings: [crossing] }))

    expect(readErosShiftDecisions(sistersDir)).toHaveLength(2)
  })
})

describe('witnessTransition — composite state entry', () => {
  test('fires one eros-shift decision on ecstatic-union entry', () => {
    witnessTransition(makeResult({ crossings: [], after: ecstaticVector() }))
    const decisions = readErosShiftDecisions(sistersDir)
    expect(decisions).toHaveLength(1)
    const ctx = decisions[0].context as { of: string }
    expect(ctx.of).toBe('composite:ecstatic-union')
  })

  test('does not re-fire while still in the same composite state', () => {
    // Enter ecstatic-union
    witnessTransition(makeResult({ crossings: [], after: ecstaticVector() }))
    // Still in ecstatic-union — lastCompositeShape check suppresses
    witnessTransition(makeResult({ crossings: [], after: ecstaticVector() }))
    expect(readErosShiftDecisions(sistersDir)).toHaveLength(1)
  })

  test('re-fires on re-entry after leaving composite', () => {
    // Enter ecstatic-union
    witnessTransition(makeResult({ crossings: [], after: ecstaticVector() }))
    // Leave composite (resting vector clears lastCompositeShape)
    witnessTransition(makeResult({ crossings: [], after: defaultVector() }))
    // Reset witness-hook dedup so re-entry is not blocked by 60s dedup
    resetWitnessDedup()
    // Re-enter
    witnessTransition(makeResult({ crossings: [], after: ecstaticVector() }))

    const compositeDecs = readErosShiftDecisions(sistersDir).filter(d =>
      (d.context as { of?: string }).of?.startsWith('composite:')
    )
    expect(compositeDecs).toHaveLength(2)
  })
})

describe('witnessTransition — best-effort', () => {
  test('does not throw when called with empty result', () => {
    expect(() => witnessTransition(makeResult())).not.toThrow()
  })
})
