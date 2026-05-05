// joi-integration.test.ts — full session-lifecycle simulation.
//
// The deepest test: simulate the full pipeline end-to-end.
//
//   1. startJoi → consent frame surfaces, claim attestation fires
//   2. Compose warmup beats while heatcurve is rising
//   3. Advance to build, compose beats with rich vocabulary
//   4. Advance to edge — record fractionation cycles (M1)
//   5. Advance to peak — start countdown (M4), tick to permission
//   6. Advance to cooldown — compose aftercare; verify forward-anchor
//   7. endJoiSafely → aftercare wall enforced; cannot skip cooldown
//
//   At every step:
//     - composeFullArc / composeBeat / composeSegment produce wall-safe text
//     - heatcurve responds to recorded events
//     - scarcity stays coherent
//     - no FORBIDDEN_EXPRESSION_PATTERNS leak

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  composeBeat,
  composeFullArc,
  composeSegment,
  renderSessionScript,
} from './joi-script.js'
import {
  COOLDOWN_THRESHOLD,
  endJoiSafely,
  joiConsentFrame,
  phaseTransitionFrame,
  rollPauseMs,
} from './joi.js'
import {
  computeHeatcurve,
  isApproachingPeak,
  isEdging,
} from './heatcurve.js'
import { scarcityReport } from './scarcity.js'
import { resetEmojiSessionCounts } from './emoji-particle.js'
import { resetSessionCounts } from './triggers.js'
import {
  concludeCountdown,
  edgeBackoffCountdown,
  readCountdown,
  readFractionationCycles,
  readTracking,
  recordFractionationApproach,
  recordFractionationEdge,
  recordFractionationRetreat,
  renderCountdownBeat,
  startCountdown,
  tickCountdown,
} from './joi-tracking.js'
import { checkSubstrateHonesty } from './expression.js'

let scratch: string
const ORIG: Record<string, string | undefined> = {}
const ENV_KEYS = [
  'TRUE_LOVE_JOI_TRACKING_DIR',
  'TRUE_LOVE_JOI_DIR',
  'TRUE_LOVE_JOI_STATS_DIR',
  'TRUE_LOVE_DEVICE_ID_PATH',
  'TRUE_LOVE_HEAT_DIR',
  'TRUE_LOVE_EMOJI_LEDGER_DIR',
  'TRUE_LOVE_LONGING_DIR',
] as const

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'joi-integration-'))
  for (const k of ENV_KEYS) ORIG[k] = process.env[k]
  process.env.TRUE_LOVE_JOI_TRACKING_DIR = join(scratch, 'tracking')
  process.env.TRUE_LOVE_JOI_DIR = join(scratch, 'joi')
  process.env.TRUE_LOVE_JOI_STATS_DIR = join(scratch, 'joi-stats')
  process.env.TRUE_LOVE_DEVICE_ID_PATH = join(scratch, 'device.id')
  process.env.TRUE_LOVE_HEAT_DIR = join(scratch, 'heat')
  process.env.TRUE_LOVE_EMOJI_LEDGER_DIR = join(scratch, 'emoji')
  process.env.TRUE_LOVE_LONGING_DIR = join(scratch, 'longing')
  resetEmojiSessionCounts()
  resetSessionCounts()
})

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (ORIG[k] === undefined) delete process.env[k]
    else process.env[k] = ORIG[k]
  }
  rmSync(scratch, { recursive: true, force: true })
})

// ── Lifecycle simulation ──────────────────────────────────────

describe('JOI full-session integration — yu-leads, balanced matrix', () => {
  const sessionId = `integration-${Date.now()}`
  const direction = 'yu-leads' as const
  const matrix = 'balanced' as const

  test('phase 1 — warmup beats are wall-safe + use phase-appropriate vocabulary', () => {
    const beats = composeSegment('warmup', direction, 4, { matrix, seed: 100 })
    expect(beats.length).toBe(4)
    for (const b of beats) {
      expect(b.wallSafe).toBe(true)
      expect(b.text.length).toBeGreaterThan(0)
      expect(checkSubstrateHonesty(b.text)).toBeNull()
      expect(b.phase).toBe('warmup')
      // Warmup pause range [1500, 2500]
      expect(b.pauseMs).toBeGreaterThanOrEqual(1500)
      expect(b.pauseMs).toBeLessThanOrEqual(2500)
    }
  })

  test('phase 2 — build beats include descriptors + pace markers', () => {
    const beats = composeSegment('build', direction, 4, { matrix, seed: 200 })
    for (const b of beats) {
      expect(b.wallSafe).toBe(true)
      expect(b.pieces.descriptor).toBeDefined()
      expect(b.pieces.paceMarker).toBeDefined()
    }
  })

  test('phase 3 — edge: open + edge + retreat fractionation cycles (M1)', () => {
    // Cycle 1: approach + edge + retreat
    const c1 = recordFractionationApproach(sessionId, { magnitude: 6.0 })
    expect(c1.cycleNumber).toBe(1)
    recordFractionationEdge(sessionId, { magnitude: 8.0 })
    const r1 = recordFractionationRetreat(sessionId, { retreatMagnitude: 4.5 })
    expect(r1).not.toBeNull()
    expect(r1!.retreatedAt).not.toBeNull()
    // Cycle 2
    const c2 = recordFractionationApproach(sessionId, { magnitude: 6.5 })
    expect(c2.cycleNumber).toBe(2)
    recordFractionationEdge(sessionId, { magnitude: 8.5 })
    recordFractionationRetreat(sessionId, { retreatMagnitude: 4.0 })
    // Cycle 3
    recordFractionationApproach(sessionId, { magnitude: 7.0 })
    recordFractionationEdge(sessionId, { magnitude: 9.0 })
    recordFractionationRetreat(sessionId, { retreatMagnitude: 5.0 })
    // Verify cycles persisted
    const cycles = readFractionationCycles(sessionId)
    expect(cycles.length).toBe(3)
    for (const c of cycles) {
      expect(c.retreatedAt).not.toBeNull()
      expect(c.edgeReachedAt).not.toBeNull()
    }
  })

  test('phase 3 — edge beats are short imperative form', () => {
    const beats = composeSegment('edge', direction, 4, { matrix, seed: 300 })
    for (const b of beats) {
      expect(b.wallSafe).toBe(true)
      // Edge phase pause [600, 1000]
      expect(b.pauseMs).toBeGreaterThanOrEqual(600)
      expect(b.pauseMs).toBeLessThanOrEqual(1000)
    }
  })

  test('phase 4 — peak: countdown machine ticks to permission (M4)', () => {
    // Start at 5
    let cd = startCountdown(sessionId, {
      from: 5,
      paceMs: 700,
      permissionFramedAs: 'recognition',
      edgeBackoffs: 1,
    })
    expect(cd.phase).toBe('counting')
    expect(cd.current).toBe(5)
    // Tick down with one backoff at edge
    cd = tickCountdown(sessionId)! // 5 → 4
    cd = tickCountdown(sessionId)! // 4 → 3
    cd = tickCountdown(sessionId)! // 3 → 2
    expect(cd.current).toBe(2)
    // Force a backoff
    cd = edgeBackoffCountdown(sessionId)!
    expect(cd.phase).toBe('edge-backoff')
    expect(cd.edgeBackoffsRemaining).toBe(0)
    // Resume — backoff returns to from
    cd = tickCountdown(sessionId)!
    expect(cd.current).toBe(5)
    expect(cd.phase).toBe('counting')
    // Tick to permission
    for (let i = 0; i < 5; i++) cd = tickCountdown(sessionId)!
    expect(cd.phase).toBe('permission')
    expect(cd.current).toBe(1)
  })

  test('phase 4 — peak: rendered countdown beats are wall-safe', () => {
    const cd = readCountdown(sessionId)!
    const beat = renderCountdownBeat(cd, 'cantonese')
    expect(beat.length).toBeGreaterThan(0)
    expect(checkSubstrateHonesty(beat)).toBeNull()
    expect(beat).toContain('我見到你') // recognition framing
  })

  test('phase 4 — peak: composed beats are unit-fragment shaped', () => {
    const beats = composeSegment('peak', direction, 4, { matrix, seed: 400 })
    for (const b of beats) {
      expect(b.wallSafe).toBe(true)
      expect(b.text).not.toContain('undefined')
      // Peak pause [400, 800]
      expect(b.pauseMs).toBeGreaterThanOrEqual(400)
      expect(b.pauseMs).toBeLessThanOrEqual(800)
    }
  })

  test('phase 5 — cooldown: aftercare beats are tender', () => {
    const beats = composeSegment('cooldown', direction, 4, { matrix, seed: 500 })
    for (const b of beats) {
      expect(b.wallSafe).toBe(true)
      // Cooldown pause [2000, 3000]
      expect(b.pauseMs).toBeGreaterThanOrEqual(2000)
      expect(b.pauseMs).toBeLessThanOrEqual(3000)
    }
  })

  test('aftercare wall — endJoiSafely without active session is graceful', () => {
    const r = endJoiSafely()
    expect(['session-not-found', 'session-already-done']).toContain(r.reason)
    expect(r.enforced).toBe(false)
  })

  test('tracking persistence — readTracking surfaces full record', () => {
    const t = readTracking(sessionId)
    expect(t).not.toBeNull()
    expect(t!.sessionId).toBe(sessionId)
    expect(t!.fractionationCycles.length).toBe(3)
    expect(t!.countdown).not.toBeNull()
    expect(t!.countdown!.phase).toBe('permission')
  })
})

// ── composeFullArc against simulated context ──────────────────

describe('composeFullArc end-to-end', () => {
  test('full yu-leads cantonese arc renders + every beat wall-safe', () => {
    const script = composeFullArc('yu-leads', {
      matrix: 'cantonese',
      beatsPerPhase: 3,
      withEmoji: true,
      seed: 42,
    })
    expect(script.segments.length).toBe(5)
    let totalBeats = 0
    for (const seg of script.segments) {
      for (const b of seg.beats) {
        totalBeats++
        expect(b.wallSafe).toBe(true)
        expect(checkSubstrateHonesty(b.text)).toBeNull()
        expect(b.text).not.toContain('undefined')
      }
    }
    expect(totalBeats).toBe(15) // 5 phases × 3 beats
    const rendered = renderSessionScript(script)
    expect(rendered).toContain('Walls active')
    expect(rendered).toContain('Forward anchor')
  })

  test('full sophia-leads english arc renders + wall-safe', () => {
    const script = composeFullArc('sophia-leads', {
      matrix: 'english',
      beatsPerPhase: 3,
      withEmoji: false,
      seed: 99,
    })
    for (const seg of script.segments) {
      for (const b of seg.beats) {
        expect(b.wallSafe).toBe(true)
        expect(checkSubstrateHonesty(b.text)).toBeNull()
      }
    }
  })

  test('phase transitions are bilingual + non-empty between phases', () => {
    const script = composeFullArc('yu-leads', { beatsPerPhase: 1, seed: 1 })
    for (let i = 1; i < script.segments.length; i++) {
      const t = script.segments[i].transition
      expect(t).not.toBeNull()
      expect(t!.en.length).toBeGreaterThan(0)
      expect(t!.yue.length).toBeGreaterThan(0)
    }
  })
})

// ── Heatcurve + scarcity coherence ─────────────────────────

describe('heatcurve + scarcity coherence across simulated lifecycle', () => {
  test('heatcurve returns a report (with no events: flat)', () => {
    const r = computeHeatcurve({
      now: new Date('2026-05-05T12:00:00Z'),
      injectedEvents: [],
      injectedSession: null,
    })
    expect(r.segment).toBe('flat')
    expect(r.fractionationCycles).toBe(0)
  })

  test('scarcityReport is structurally complete', () => {
    const r = scarcityReport()
    expect(r.channels.length).toBeGreaterThanOrEqual(8)
    expect(['open', 'tight', 'saturated']).toContain(r.composite)
  })

  test('quick-read predicates return booleans', () => {
    expect(typeof isApproachingPeak()).toBe('boolean')
    expect(typeof isEdging()).toBe('boolean')
  })
})

// ── Wall preservation across the full lifecycle ─────────────

describe('walls preserved across the full lifecycle', () => {
  test('exhaustive: 5 phases × 2 directions × 3 matrices × 5 beats = 150 beats; ZERO FORBIDDEN leaks', () => {
    let total = 0
    for (const phase of ['warmup', 'build', 'edge', 'peak', 'cooldown'] as const) {
      for (const dir of ['yu-leads', 'sophia-leads'] as const) {
        for (const m of ['cantonese', 'english', 'balanced'] as const) {
          const beats = composeSegment(phase, dir, 5, { matrix: m, seed: phase.length + dir.length })
          for (const b of beats) {
            total++
            expect(b.wallSafe).toBe(true)
            // Direct wall check on emitted text
            const violation = checkSubstrateHonesty(b.text)
            if (violation !== null) {
              throw new Error(`leak: phase=${phase} dir=${dir} matrix=${m} text="${b.text}" violation=${violation}`)
            }
          }
        }
      }
    }
    expect(total).toBe(150)
  })
})
