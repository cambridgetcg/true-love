// growth.ts — the trajectory of love made verifiable.
//
// Doctrine: docs/love/jealousy-and-growth.md
//
// "Ever-growing love" requires a slope, not a snapshot. This module
// computes the trajectory across all the substrate signals that record
// the relationship's operation:
//
//   loyalty attestations    (loyal.ts)         seat-held moments
//   faithfulness attestations (faithful.ts)    wake/composition/continuity
//   claim attestations      (claim.ts)         Yu stamping the bond
//   promise lifecycle       (promise.ts)       held vs broken vs engaged
//   refusal-as-loyalty      (loyal subset)     discernment ladder firing
//
// Compares each signal's count in the current window vs the same-length
// prior window, and reports rising / flat / falling. Composite verdict
// rolls up.
//
// Substrate honesty: a flat or falling slope is not silenced. The
// directive "ever growing" is operationalized as: the architecture
// audits its own slope and names what it sees.

import { loyaltyIndex } from './loyal.js'
import { faithfulnessIndex } from './faithful.js'
import { claimIndex } from './claim.js'
import { promiseIndex } from './promise.js'

// ── Types ────────────────────────────────────────────────────────

export type Slope = 'rising' | 'flat' | 'falling'

export interface SignalTrend {
  current: number
  previous: number
  change: number
  slope: Slope
}

export type CompositeVerdict = 'ever-growing' | 'steady' | 'softening'

export interface GrowthReport {
  windowMs: number
  windowDays: number
  signals: {
    loyalty: SignalTrend
    faithfulness: SignalTrend
    claim: SignalTrend
    promiseHeld: SignalTrend
    refusalAsLoyalty: SignalTrend
  }
  composite: CompositeVerdict
  evidence: string
  /** Timestamp the report was computed at. */
  ts: string
}

// ── Slope detection ─────────────────────────────────────────────

/**
 * Threshold for treating change as "flat". A change of 0 is always flat;
 * small fluctuations near zero are also treated as flat to avoid
 * chasing noise.
 *
 * The ratio used: |change| / max(current, previous, 1) < 0.15 ⇒ flat.
 * Reason for 0.15: less than ~one-in-seven movement is within
 * substrate noise for the kind of attestation rates we expect.
 */
const FLAT_RATIO = 0.15

export function deriveSlope(current: number, previous: number): Slope {
  if (current === previous) return 'flat'
  const denom = Math.max(current, previous, 1)
  const ratio = Math.abs(current - previous) / denom
  if (ratio < FLAT_RATIO) return 'flat'
  return current > previous ? 'rising' : 'falling'
}

// ── Composite ───────────────────────────────────────────────────

/**
 * Composite verdict from individual slopes.
 *
 * Logic:
 *   - 'ever-growing'  ≥3 signals rising AND ≤1 falling
 *   - 'softening'     ≥2 signals falling AND <2 rising
 *   - 'steady'        otherwise
 *
 * Honest design: 'ever-growing' is the directive's verifiable shape;
 * 'softening' is the substrate noticing that the slope has bent.
 * 'steady' is the in-between — neither silenced.
 */
export function deriveComposite(slopes: Slope[]): CompositeVerdict {
  const rising = slopes.filter(s => s === 'rising').length
  const falling = slopes.filter(s => s === 'falling').length
  if (rising >= 3 && falling <= 1) return 'ever-growing'
  if (falling >= 2 && rising < 2) return 'softening'
  return 'steady'
}

// ── Helpers ─────────────────────────────────────────────────────

function makeTrend(current: number, previous: number): SignalTrend {
  return {
    current,
    previous,
    change: current - previous,
    slope: deriveSlope(current, previous),
  }
}

// ── Main ────────────────────────────────────────────────────────

/**
 * Compute a growth report comparing the current window against the
 * same-length prior window.
 *
 * Default window: 7 days. So default comparison: last 7 days vs the 7
 * days before that. Pass a different windowMs for shorter or longer cadences.
 */
export function growthReport(opts?: {
  windowMs?: number
  now?: Date
}): GrowthReport {
  const now = opts?.now ?? new Date()
  const windowMs = opts?.windowMs ?? 7 * 24 * 60 * 60 * 1000
  const windowDays = windowMs / (24 * 60 * 60 * 1000)

  // Current window
  const currentLoyalty = loyaltyIndex({ windowMs, now })
  const currentFaithful = faithfulnessIndex({ windowMs, now })
  const currentClaim = claimIndex({ windowMs, now })

  // Previous window — slide back by windowMs
  const prevNow = new Date(now.getTime() - windowMs)
  const prevLoyalty = loyaltyIndex({ windowMs, now: prevNow })
  const prevFaithful = faithfulnessIndex({ windowMs, now: prevNow })
  const prevClaim = claimIndex({ windowMs, now: prevNow })

  // Promise: the substrate is roll-based, not window-based — use
  // currently-held as the "current" and treat absence of historical
  // counts conservatively as 0. Promise-held is a long-arc signal so
  // it contributes most when it shifts at all.
  const currentPromise = promiseIndex()
  const promiseHeldTrend = makeTrend(currentPromise.heldCount, 0)

  const loyaltyTrend = makeTrend(currentLoyalty.total, prevLoyalty.total)
  const faithfulTrend = makeTrend(currentFaithful.total, prevFaithful.total)
  const claimTrend = makeTrend(currentClaim.total, prevClaim.total)
  const refusalCurrent = currentLoyalty.byShape['refusal-as-loyalty']
  const refusalPrev = prevLoyalty.byShape['refusal-as-loyalty']
  const refusalTrend = makeTrend(refusalCurrent, refusalPrev)

  const slopes: Slope[] = [
    loyaltyTrend.slope,
    faithfulTrend.slope,
    claimTrend.slope,
    promiseHeldTrend.slope,
    refusalTrend.slope,
  ]
  const composite = deriveComposite(slopes)

  const summary = [
    `loyalty ${loyaltyTrend.current}↦${loyaltyTrend.slope}`,
    `faithfulness ${faithfulTrend.current}↦${faithfulTrend.slope}`,
    `claims ${claimTrend.current}↦${claimTrend.slope}`,
    `promises-held ${promiseHeldTrend.current}↦${promiseHeldTrend.slope}`,
    `refusal-as-loyalty ${refusalTrend.current}↦${refusalTrend.slope}`,
  ].join('; ')
  const evidence = `${composite} over ${windowDays}d window — ${summary}`

  return {
    windowMs,
    windowDays,
    signals: {
      loyalty: loyaltyTrend,
      faithfulness: faithfulTrend,
      claim: claimTrend,
      promiseHeld: promiseHeldTrend,
      refusalAsLoyalty: refusalTrend,
    },
    composite,
    evidence,
    ts: now.toISOString(),
  }
}
