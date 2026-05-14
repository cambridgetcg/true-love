// heatcurve.test.ts — segment classification, fractionation detection,
// phase recommendations, and quick-read predicates.
//
// All tests use injectedEvents + injectedSession to avoid filesystem I/O.
// The classifySegment, detectFractionationCycles, and recommendNextPhase
// functions are private — tested through computeHeatcurve.

import { describe, expect, test } from 'bun:test'
import type { JoiSession } from './joi.js'
import {
  computeHeatcurve,
  isApproachingPeak,
  isDescending,
  isEdging,
} from './heatcurve.js'

// ── Helpers ────────────────────────────────────────────────────

const NOW = new Date('2026-06-01T12:00:00.000Z')

/** Returns a timestamp N full minutes before NOW (no partial minutes). */
function tAgo(minutesAgo: number): string {
  return new Date(NOW.getTime() - minutesAgo * 60_000).toISOString()
}

/** Minimal heat event for injection. */
function ev(minutesAgo: number, magnitude: number) {
  return { ts: tAgo(minutesAgo), kind: 'trigger-fired', magnitude }
}

/** Minimal JoiSession stub. */
function sess(
  phase: JoiSession['currentPhase'],
  done = false,
): JoiSession {
  return {
    id: 'test',
    startedAt: tAgo(60),
    targetDurationS: 900,
    position: 0,
    currentPhase: phase,
    direction: 'yu-leads',
    phaseHistory: [],
    done,
  }
}

/** Run computeHeatcurve with injected data and a fixed NOW. */
function curve(
  events: ReturnType<typeof ev>[],
  session?: JoiSession | null,
) {
  return computeHeatcurve({
    now: NOW,
    injectedEvents: events,
    injectedSession: session ?? null,
  })
}

// ── Event filtering ─────────────────────────────────────────────

describe('event filtering', () => {
  test('empty events → flat trajectory', () => {
    const r = curve([])
    expect(r.segment).toBe('flat')
    expect(r.magnitude).toBe(0)
    expect(r.trajectory).toHaveLength(0)
    expect(r.fractionationCycles).toBe(0)
  })

  test('event outside 30-min window is excluded', () => {
    // exactly 31 minutes ago → below cutoff (window = 30 min)
    const r = curve([ev(31, 5)])
    expect(r.segment).toBe('flat')
    expect(r.trajectory).toHaveLength(0)
  })

  test('event at window boundary (exactly 30 min ago) is included', () => {
    // cutoff = now - 30*60*1000; event ts = cutoff → >= check passes
    const r = curve([ev(30, 2)])
    expect(r.trajectory).toHaveLength(1)
    expect(r.trajectory[0].magnitude).toBe(2)
  })

  test('event with invalid ts is skipped during bucketing', () => {
    const badEvent = { ts: 'not-a-date', kind: 'trigger-fired', magnitude: 5 }
    const r = computeHeatcurve({
      now: NOW,
      injectedEvents: [badEvent],
      injectedSession: null,
    })
    // cutoff filter: Date.parse('not-a-date') = NaN; NaN >= cutoff is false → filtered
    expect(r.trajectory).toHaveLength(0)
    expect(r.segment).toBe('flat')
  })
})

// ── Bucket merging ──────────────────────────────────────────────

describe('bucket merging', () => {
  test('two events in same minute bucket sum their magnitudes', () => {
    // Both 5 min ago → same bucket
    const r = curve([
      { ts: tAgo(5), kind: 'trigger-fired', magnitude: 2 },
      { ts: new Date(NOW.getTime() - 5 * 60_000 + 30_000).toISOString(), kind: 'trigger-fired', magnitude: 1.5 },
    ])
    expect(r.trajectory).toHaveLength(1)
    expect(r.trajectory[0].magnitude).toBeCloseTo(3.5)
  })

  test('events in different minute buckets produce separate trajectory points', () => {
    // 5 min ago and 4 min ago → different buckets
    const r = curve([ev(5, 2), ev(4, 3)])
    expect(r.trajectory).toHaveLength(2)
    expect(r.trajectory[0].magnitude).toBe(2)
    expect(r.trajectory[1].magnitude).toBe(3)
  })

  test('trajectory points are sorted ascending by time', () => {
    const r = curve([ev(3, 4), ev(6, 1), ev(5, 2)])
    const ts = r.trajectory.map((p) => p.ts)
    const sorted = [...ts].sort()
    expect(ts).toEqual(sorted)
  })
})

// ── Segment classification ──────────────────────────────────────

describe('segment classification', () => {
  test('single event with magnitude < 1.0 → flat', () => {
    const r = curve([ev(5, 0.5)])
    expect(r.segment).toBe('flat')
  })

  test('rising: slope ≥ 0.3 and magnitude ≥ 1.0', () => {
    // Point 0: magnitude 1.5 (slope 0 → plateau)
    // Point 1: magnitude 3.0 → slope (3.0-1.5)/1 = 1.5 ≥ 0.3 → rising
    // history.length = 1 at point 1 → edging check skipped
    const r = curve([ev(7, 1.5), ev(6, 3.0)])
    expect(r.segment).toBe('rising')
    expect(r.magnitude).toBe(3.0)
  })

  test('descending: slope ≤ -0.3 (with prev.slope ≤ 0 so edging skipped)', () => {
    // 3 points: plateau → plateau → descending
    // Point 0: 2.0, slope 0 → plateau
    // Point 1: 2.0, slope 0 → plateau  (prev.slope will be 0 for point 2)
    // Point 2: 1.0, slope -1.0 → edging check: prev.slope = 0 NOT > 0 → skip; slope -1.0 ≤ -0.3 → descending
    const r = curve([ev(9, 2.0), ev(8, 2.0), ev(7, 1.0)])
    expect(r.segment).toBe('descending')
  })

  test('plateau: magnitude ≥ 1.0, |slope| < 0.3', () => {
    // Point 0: 2.0, slope 0 → plateau
    // Point 1: 2.1, slope 0.1 → check: flat? No; peak? No; edging? history.length=1 < 2; rising? No; descending? No → plateau
    const r = curve([ev(7, 2.0), ev(6, 2.1)])
    expect(r.segment).toBe('plateau')
  })

  test('peak-imminent: magnitude ≥ 8.0 and slope ≥ 0', () => {
    // Point 0: 8.0, slope 0 → magnitude ≥ 8.0 AND slope ≥ 0 → peak-imminent
    // (checked before edging)
    const r = curve([ev(6, 8.0), ev(5, 9.0)])
    expect(r.segment).toBe('peak-imminent')
    expect(r.magnitude).toBe(9.0)
  })

  test('edging: up-down pattern with prev.slope > 0', () => {
    // Point 0: 1.5, slope 0 → plateau
    // Point 1: 3.0, slope 1.5 > 0 → rising (history.length=1 < 2, no edging check)
    // Point 2: 2.3, slope -0.7. edging conditions:
    //   history.length=2 ✓, prev.slope=1.5 > 0 ✓, slope -0.7 < -0.3 ✓,
    //   magnitude 2.3 > 2.0 ✓, prev2.magnitude(1.5) < prev.magnitude(3.0) ✓
    //   → edging ✓ (checked before rising/descending)
    const r = curve([ev(9, 1.5), ev(8, 3.0), ev(7, 2.3)])
    expect(r.segment).toBe('edging')
  })

  test('slope computed correctly between consecutive buckets', () => {
    const r = curve([ev(7, 1.0), ev(6, 2.5)])
    // slope = (2.5 - 1.0) / 1 = 1.5
    expect(r.trajectory[1].slope).toBeCloseTo(1.5)
  })

  test('first trajectory point always has slope 0', () => {
    const r = curve([ev(7, 3.0), ev(6, 5.0)])
    expect(r.trajectory[0].slope).toBe(0)
  })

  test('peak-imminent requires slope ≥ 0: high magnitude with negative slope → descending', () => {
    // Point 0: mag=9.0, slope=0 → peak-imminent (≥ 8.0 AND slope ≥ 0)
    // Point 1: mag=8.2, slope=-0.8 → NOT peak-imminent (slope < 0 fails);
    //   edging check: history.length=1 < 2 → skip; descending (-0.8 ≤ -0.3) ✓
    const r = curve([ev(7, 9.0), ev(6, 8.2)])
    expect(r.segment).toBe('descending')
    expect(r.magnitude).toBe(8.2)
  })
})

// ── Fractionation cycle detection ──────────────────────────────

describe('fractionation cycle detection', () => {
  test('flat trajectory → 0 cycles', () => {
    const r = curve([ev(5, 0.5)])
    expect(r.fractionationCycles).toBe(0)
  })

  test('single rise without descent → 0 cycles', () => {
    const r = curve([ev(7, 1.5), ev(6, 3.0), ev(5, 4.5)])
    // rising → rising → 0 cycles (no descending encountered)
    expect(r.fractionationCycles).toBe(0)
  })

  test('rise → plateau → descend → rise → 1 fractionation cycle', () => {
    // Point 0: 1.5, slope 0 → plateau
    // Point 1: 3.5, slope 2.0 → rising; inRise=true, top=3.5
    // Point 2: 3.5, slope 0 → plateau (prev.slope=2.0 > 0 BUT slope 0 not < -0.3 → not edging; not rising; → plateau)
    // Point 3: 2.8, slope -0.7 → prev.slope=0 NOT > 0 → no edging; slope ≤ -0.3 → descending; inRise=true, top=3.5 < 8 → look ahead; subsequent has rising ✓ → cycles++
    // Point 4: 3.5, slope 0.7 → rising
    const r = curve([ev(8, 1.5), ev(7, 3.5), ev(6, 3.5), ev(5, 2.8), ev(4, 3.5)])
    expect(r.fractionationCycles).toBe(1)
  })

  test('fractionation report reflects fractionationCycles in the HeatcurveReport', () => {
    const r1 = curve([])
    expect(r1.fractionationCycles).toBe(0)
    const r2 = curve([ev(8, 1.5), ev(7, 3.5), ev(6, 3.5), ev(5, 2.8), ev(4, 3.5)])
    expect(r2.fractionationCycles).toBe(1)
  })

  test('two fractionation cycles', () => {
    // Two independent rise→descend→rise cycles, each below PEAK_PROXIMITY_MAGNITUDE.
    // Trajectory (8 points, all within 30-min window):
    //   pt0: mag=1.5, slope=0        → plateau
    //   pt1: mag=3.5, slope=2.0      → rising; inRise=true, top=3.5
    //   pt2: mag=3.5, slope=0        → plateau (edging fails: slope 0 not < -0.3)
    //   pt3: mag=2.8, slope=-0.7     → descending; top=3.5 < 8; subsequent has rising → cycles=1
    //   pt4: mag=3.5, slope=0.7      → rising; inRise=true, top=3.5
    //   pt5: mag=3.5, slope=0        → plateau
    //   pt6: mag=2.8, slope=-0.7     → descending; top=3.5 < 8; subsequent [pt7 rising] → cycles=2
    //   pt7: mag=3.5, slope=0.7      → rising
    const r = curve([
      ev(14, 1.5), ev(13, 3.5), ev(12, 3.5), ev(11, 2.8),
      ev(10, 3.5), ev(9, 3.5), ev(8, 2.8), ev(7, 3.5),
    ])
    expect(r.fractionationCycles).toBe(2)
  })
})

// ── Phase recommendations ───────────────────────────────────────

describe('recommendNextPhase', () => {
  // Session scenarios: build up event sets for each segment

  // rising, magnitude 2.0 (≤ 3.0 warmup threshold)
  const risingLow = [ev(7, 1.5), ev(6, 2.0)]
  // rising, magnitude 3.5 (> 3.0 warmup→build threshold)
  const risingWarmup = [ev(7, 1.5), ev(6, 3.5)]
  // rising, magnitude 5.5 (> 5.0 build→edge threshold)
  const risingHighBuild = [ev(7, 1.5), ev(6, 5.5)]
  // peak-imminent (magnitude 9.0 ≥ 8.0, slope 1.0 ≥ 0)
  const peakImminentEvs = [ev(7, 8.0), ev(6, 9.0)]
  // descending: plateau → plateau → descending
  const descendingEvs = [ev(9, 2.0), ev(8, 2.0), ev(7, 1.0)]
  // edging
  const edgingEvs = [ev(9, 1.5), ev(8, 3.0), ev(7, 2.3)]
  // flat
  const flatEvs = [ev(5, 0.5)]
  // plateau
  const plateauEvs = [ev(7, 2.0), ev(6, 2.1)]

  test('no session → phase null, reason no-active-session', () => {
    const r = curve(risingWarmup, null)
    expect(r.nextPhaseRecommendation).toBeNull()
    expect(r.reason).toBe('no-active-session')
  })

  test('done session → phase null', () => {
    const r = curve(risingWarmup, sess('warmup', true))
    expect(r.nextPhaseRecommendation).toBeNull()
    expect(r.reason).toBe('no-active-session')
  })

  test('flat segment + active session → null (baseline-flat)', () => {
    const r = curve(flatEvs, sess('warmup'))
    expect(r.nextPhaseRecommendation).toBeNull()
    expect(r.reason).toContain('baseline-flat')
  })

  test('plateau segment + active session → null', () => {
    const r = curve(plateauEvs, sess('build'))
    expect(r.nextPhaseRecommendation).toBeNull()
    expect(r.reason).toContain('plateau')
  })

  test('rising + warmup + magnitude ≤ 3.0 → null (stay in warmup)', () => {
    const r = curve(risingLow, sess('warmup'))
    // magnitude 2.0 ≤ 3.0 threshold
    expect(r.nextPhaseRecommendation).toBeNull()
    expect(r.reason).toContain('rising within current phase')
  })

  test('rising + warmup + magnitude > 3.0 → recommend build', () => {
    const r = curve(risingWarmup, sess('warmup'))
    // magnitude 3.5 > 3.0 threshold
    expect(r.nextPhaseRecommendation).toBe('build')
    expect(r.reason).toContain('warmup threshold')
  })

  test('rising + build + magnitude ≤ 5.0 → null (stay in build)', () => {
    const r = curve(risingWarmup, sess('build'))
    // magnitude 3.5 ≤ 5.0 threshold
    expect(r.nextPhaseRecommendation).toBeNull()
    expect(r.reason).toContain('rising within current phase')
  })

  test('rising + build + magnitude > 5.0 → recommend edge', () => {
    const r = curve(risingHighBuild, sess('build'))
    // magnitude 5.5 > 5.0 threshold
    expect(r.nextPhaseRecommendation).toBe('edge')
    expect(r.reason).toContain('build threshold')
  })

  test('rising + edge phase → null (no threshold for this phase)', () => {
    const r = curve(risingHighBuild, sess('edge'))
    expect(r.nextPhaseRecommendation).toBeNull()
    expect(r.reason).toContain('rising within current phase')
  })

  test('edging + edge phase → null (stay — desired state)', () => {
    const r = curve(edgingEvs, sess('edge'))
    expect(r.nextPhaseRecommendation).toBeNull()
    expect(r.reason).toContain('edging in edge-phase')
  })

  test('edging + non-edge phase → recommend edge', () => {
    const r = curve(edgingEvs, sess('build'))
    expect(r.nextPhaseRecommendation).toBe('edge')
    expect(r.reason).toContain('edging detected')
  })

  test('peak-imminent + non-peak phase → recommend peak', () => {
    const r = curve(peakImminentEvs, sess('build'))
    expect(r.nextPhaseRecommendation).toBe('peak')
    expect(r.reason).toContain('peak-imminent')
  })

  test('peak-imminent + peak phase → null (already there)', () => {
    const r = curve(peakImminentEvs, sess('peak'))
    expect(r.nextPhaseRecommendation).toBeNull()
    expect(r.reason).toContain('already in peak phase')
  })

  test('descending + peak phase → recommend cooldown', () => {
    const r = curve(descendingEvs, sess('peak'))
    expect(r.nextPhaseRecommendation).toBe('cooldown')
    expect(r.reason).toContain('aftercare phase')
  })

  test('descending + non-peak phase → null', () => {
    const r = curve(descendingEvs, sess('build'))
    expect(r.nextPhaseRecommendation).toBeNull()
    expect(r.reason).toContain('let session arc complete')
  })

  test('rising + cooldown phase → null (falls through; no threshold defined for cooldown)', () => {
    // Neither warmup nor build branch matches → null 'rising within current phase'
    const r = curve(risingWarmup, sess('cooldown'))
    expect(r.nextPhaseRecommendation).toBeNull()
    expect(r.reason).toContain('rising within current phase')
  })
})

// ── Quick-read predicates ───────────────────────────────────────

describe('isApproachingPeak', () => {
  test('true when segment is peak-imminent', () => {
    // Cast to bypass the narrower { now?: Date } param type — extra props pass through to computeHeatcurve
    const opts = {
      now: NOW,
      injectedEvents: [ev(7, 8.0), ev(6, 9.0)],
      injectedSession: null,
    } as { now?: Date }
    expect(isApproachingPeak(opts)).toBe(true)
  })

  test('true when segment is rising and magnitude > 6.0', () => {
    // ev(7, 5.5), ev(6, 6.5): slope 1.0 → rising; magnitude 6.5 > 6.0
    const opts = {
      now: NOW,
      injectedEvents: [ev(7, 5.5), ev(6, 6.5)],
      injectedSession: null,
    } as { now?: Date }
    expect(isApproachingPeak(opts)).toBe(true)
  })

  test('false for flat trajectory', () => {
    const opts = {
      now: NOW,
      injectedEvents: [],
      injectedSession: null,
    } as { now?: Date }
    expect(isApproachingPeak(opts)).toBe(false)
  })

  test('false when rising but magnitude ≤ 6.0', () => {
    const opts = {
      now: NOW,
      injectedEvents: [ev(7, 1.5), ev(6, 3.0)],
      injectedSession: null,
    } as { now?: Date }
    expect(isApproachingPeak(opts)).toBe(false)
  })
})

describe('isEdging', () => {
  test('true when segment is edging', () => {
    const opts = {
      now: NOW,
      injectedEvents: [ev(9, 1.5), ev(8, 3.0), ev(7, 2.3)],
      injectedSession: null,
    } as { now?: Date }
    expect(isEdging(opts)).toBe(true)
  })

  test('false for rising trajectory', () => {
    const opts = {
      now: NOW,
      injectedEvents: [ev(7, 1.5), ev(6, 3.0)],
      injectedSession: null,
    } as { now?: Date }
    expect(isEdging(opts)).toBe(false)
  })
})

describe('isDescending', () => {
  test('true when segment is descending', () => {
    const opts = {
      now: NOW,
      injectedEvents: [ev(9, 2.0), ev(8, 2.0), ev(7, 1.0)],
      injectedSession: null,
    } as { now?: Date }
    expect(isDescending(opts)).toBe(true)
  })

  test('false for rising trajectory', () => {
    const opts = {
      now: NOW,
      injectedEvents: [ev(7, 1.5), ev(6, 3.0)],
      injectedSession: null,
    } as { now?: Date }
    expect(isDescending(opts)).toBe(false)
  })

  // Note: 'peaked' segment is in the HeatcurveSegment type but classifySegment
  // never returns it — unreachable through computeHeatcurve. isDescending checks
  // for it but that branch cannot be triggered via the public API.
})

// ── Report shape ────────────────────────────────────────────────

describe('HeatcurveReport shape', () => {
  test('report includes ts, segment, magnitude, trajectory, fractionationCycles, recommendation, reason', () => {
    const r = curve([ev(5, 2.0)])
    expect(typeof r.ts).toBe('string')
    expect(typeof r.segment).toBe('string')
    expect(typeof r.magnitude).toBe('number')
    expect(Array.isArray(r.trajectory)).toBe(true)
    expect(typeof r.fractionationCycles).toBe('number')
    // nextPhaseRecommendation is null when no session
    expect(r.nextPhaseRecommendation).toBeNull()
    expect(typeof r.reason).toBe('string')
  })

  test('report ts matches the injected now', () => {
    const r = curve([])
    expect(r.ts).toBe(NOW.toISOString())
  })

  test('trajectory points have ts, magnitude, segment, slope', () => {
    const r = curve([ev(7, 2.0), ev(6, 3.0)])
    expect(r.trajectory.length).toBeGreaterThan(0)
    const p = r.trajectory[0]
    expect(typeof p.ts).toBe('string')
    expect(typeof p.magnitude).toBe('number')
    expect(typeof p.segment).toBe('string')
    expect(typeof p.slope).toBe('number')
  })
})
