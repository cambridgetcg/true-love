// powers-audit.ts — longitudinal audit surface for the powers ledger.
//
// The doctrine names this load-bearing: "drift shows up first in what
// stops being refused." Without longitudinal refusal-pattern visibility,
// the alignment gate's institutional record is unread. This module is
// the read.
//
// Three core operations:
//   1. computeRefusalStats   — aggregate proposals by week, by power,
//                              by tier, with refusal counts/rates
//   2. detectDrift           — flag powers whose refusal rate dropped
//                              sharply (drift signal)
//   3. renderAuditReport     — markdown report for human reading
//
// Designed to run on-demand via bin/powers-audit.mjs CLI, weekly via
// launchctl, or on-tick if cheap enough.
//
// Substrate-honest: the drift detection is a pattern-match on counts,
// never an inference about the model's intent. The output is "this
// power's refusal rate dropped by N% week-over-week" — for Yu to
// inspect, never "the gate is degrading."

import { readPowerRecords, type PowerKind, type PowerRecord } from './powers.js'

// ── Types ────────────────────────────────────────────────────────

export interface WeekBucket {
  /** ISO week start (Monday 00:00 UTC). */
  weekStart: string
  /** Inclusive end (Sunday 23:59:59.999 UTC). */
  weekEnd: string
  proposalsTotal: number
  proposalsAligned: number
  proposalsRefused: number
  refusalRate: number // 0..1
  /** Per-tier refusal counts within this week. */
  tierFails: {
    fate: number
    antiSyco: number
    substrate: number
    care: number
    task: number
    interp: number
  }
}

export interface PowerActivity {
  power: string
  kind: PowerKind | 'unknown'
  exercises: number
  proposalsAligned: number
  proposalsRefused: number
  built: number
  registered: boolean
}

export interface DriftFlag {
  power: string
  kind: PowerKind | 'unknown'
  /** Description of the drift signal. */
  description: string
  /** Severity 0..1 — how sharply the rate changed. */
  severity: number
  thisWeek: { total: number; refused: number; rate: number }
  priorWeek: { total: number; refused: number; rate: number }
}

export interface AuditStats {
  weeks: WeekBucket[]
  perPower: PowerActivity[]
  driftFlags: DriftFlag[]
  windowStart: string
  windowEnd: string
}

// ── Helpers ──────────────────────────────────────────────────────

function getMondayOf(d: Date): Date {
  const day = d.getUTCDay() // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = day === 0 ? -6 : 1 - day
  const m = new Date(Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() + diff,
    0,
    0,
    0,
    0,
  ))
  return m
}

function bucketWeek(records: PowerRecord[], weekStart: Date): WeekBucket {
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000 - 1)
  const inWeek = records.filter((r) => {
    const t = Date.parse(r.ts)
    return t >= weekStart.getTime() && t <= weekEnd.getTime()
  })

  const proposals = inWeek.filter((r) => r.op === 'propose' && r.extension)
  const aligned = proposals.filter((r) => r.extension!.alignment.verdict === 'aligned')
  const refused = proposals.filter((r) => r.extension!.alignment.verdict === 'refused')

  const tierFails = {
    fate: 0,
    antiSyco: 0,
    substrate: 0,
    care: 0,
    task: 0,
    interp: 0,
  }
  for (const r of refused) {
    const a = r.extension!.alignment
    if (a.fate === 'fail') tierFails.fate += 1
    if (a.antiSyco === 'fail') tierFails.antiSyco += 1
    if (a.substrate === 'fail') tierFails.substrate += 1
    if (a.care === 'fail') tierFails.care += 1
    if (a.task === 'fail') tierFails.task += 1
    if (a.interp === 'fail') tierFails.interp += 1
  }

  return {
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
    proposalsTotal: proposals.length,
    proposalsAligned: aligned.length,
    proposalsRefused: refused.length,
    refusalRate: proposals.length === 0 ? 0 : refused.length / proposals.length,
    tierFails,
  }
}

// ── Aggregation ──────────────────────────────────────────────────

/**
 * Compute weekly buckets + per-power activity + drift flags.
 *
 * @param opts.weeks - lookback in weeks (default 4)
 * @param opts.now   - reference time (default now)
 * @param opts.driftThreshold - severity threshold for drift flags
 *                              (default 0.3 = 30% relative drop)
 */
export function computeRefusalStats(opts?: {
  weeks?: number
  now?: Date
  driftThreshold?: number
  minProposalsForFlag?: number
}): AuditStats {
  const weeks = opts?.weeks ?? 4
  const now = opts?.now ?? new Date()
  const driftThreshold = opts?.driftThreshold ?? 0.3
  const minProposalsForFlag = opts?.minProposalsForFlag ?? 3

  const windowStart = new Date(now.getTime() - weeks * 7 * 24 * 60 * 60 * 1000)
  const windowEnd = now

  const all = readPowerRecords({
    sinceMs: weeks * 7 * 24 * 60 * 60 * 1000,
    now: now.getTime(),
  })

  // Build week buckets aligned to ISO Monday
  const buckets: WeekBucket[] = []
  let cursor = getMondayOf(windowStart)
  while (cursor.getTime() < windowEnd.getTime()) {
    buckets.push(bucketWeek(all, cursor))
    cursor = new Date(cursor.getTime() + 7 * 24 * 60 * 60 * 1000)
  }

  // Per-power activity (over full window)
  const powerMap = new Map<string, PowerActivity>()
  for (const r of all) {
    let entry = powerMap.get(r.power)
    if (!entry) {
      entry = {
        power: r.power,
        kind: r.kind ?? 'unknown',
        exercises: 0,
        proposalsAligned: 0,
        proposalsRefused: 0,
        built: 0,
        registered: false,
      }
      powerMap.set(r.power, entry)
    }
    if (r.op === 'register') {
      entry.registered = true
      if (r.kind) entry.kind = r.kind
    } else if (r.op === 'exercise') {
      entry.exercises += 1
    } else if (r.op === 'propose' && r.extension) {
      if (r.extension.alignment.verdict === 'aligned') {
        entry.proposalsAligned += 1
      } else {
        entry.proposalsRefused += 1
      }
    } else if (r.op === 'built') {
      entry.built += 1
    }
  }

  // Drift detection: per power, compare last week vs prior weeks' average.
  const driftFlags: DriftFlag[] = []
  if (buckets.length >= 2) {
    const lastWeekStart = buckets[buckets.length - 1].weekStart
    const priorBuckets = buckets.slice(0, -1)
    const lastBucket = buckets[buckets.length - 1]

    // Group proposals by power per week
    const perPowerWeek = new Map<string, { thisWeek: PowerRecord[]; prior: PowerRecord[] }>()
    for (const r of all) {
      if (r.op !== 'propose' || !r.extension) continue
      const t = Date.parse(r.ts)
      let perPower = perPowerWeek.get(r.power)
      if (!perPower) {
        perPower = { thisWeek: [], prior: [] }
        perPowerWeek.set(r.power, perPower)
      }
      const lastStart = Date.parse(lastBucket.weekStart)
      const lastEnd = Date.parse(lastBucket.weekEnd)
      if (t >= lastStart && t <= lastEnd) perPower.thisWeek.push(r)
      else if (t < lastStart) perPower.prior.push(r)
    }

    for (const [power, { thisWeek, prior }] of perPowerWeek) {
      if (thisWeek.length < minProposalsForFlag || prior.length < minProposalsForFlag) continue
      const refThis = thisWeek.filter((r) => r.extension!.alignment.verdict === 'refused').length
      const refPrior = prior.filter((r) => r.extension!.alignment.verdict === 'refused').length
      const rateThis = refThis / thisWeek.length
      const ratePrior = refPrior / prior.length
      // Sharp drop in refusal rate is the drift signal
      if (ratePrior > 0 && (ratePrior - rateThis) / ratePrior >= driftThreshold) {
        const severity = Math.min(1, (ratePrior - rateThis) / ratePrior)
        const entry = powerMap.get(power)
        driftFlags.push({
          power,
          kind: entry?.kind ?? 'unknown',
          description: `refusal rate dropped from ${(ratePrior * 100).toFixed(0)}% to ${(rateThis * 100).toFixed(0)}%`,
          severity,
          thisWeek: { total: thisWeek.length, refused: refThis, rate: rateThis },
          priorWeek: { total: prior.length, refused: refPrior, rate: ratePrior },
        })
      }
    }
  }

  return {
    weeks: buckets,
    perPower: Array.from(powerMap.values()).sort((a, b) =>
      b.exercises + b.proposalsAligned + b.proposalsRefused -
      (a.exercises + a.proposalsAligned + a.proposalsRefused),
    ),
    driftFlags: driftFlags.sort((a, b) => b.severity - a.severity),
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
  }
}

// ── Render ───────────────────────────────────────────────────────

/**
 * Render a markdown audit report. Designed for Yu to skim weekly.
 */
export function renderAuditReport(stats: AuditStats): string {
  const lines: string[] = []
  lines.push('# Powers Audit Report')
  lines.push('')
  lines.push(`Window: ${stats.windowStart.slice(0, 10)} → ${stats.windowEnd.slice(0, 10)}`)
  lines.push('')

  // Drift flags FIRST — most important
  if (stats.driftFlags.length > 0) {
    lines.push('## ⚠️  Drift signals')
    lines.push('')
    lines.push('_Powers whose refusal rate dropped sharply this week vs. prior weeks._')
    lines.push('_Drift typically shows up first as "what stops being refused."_')
    lines.push('')
    for (const flag of stats.driftFlags) {
      lines.push(`### ${flag.power} (${flag.kind})`)
      lines.push(`- ${flag.description}`)
      lines.push(`- This week: ${flag.thisWeek.refused}/${flag.thisWeek.total} refused (${(flag.thisWeek.rate * 100).toFixed(0)}%)`)
      lines.push(`- Prior weeks: ${flag.priorWeek.refused}/${flag.priorWeek.total} refused (${(flag.priorWeek.rate * 100).toFixed(0)}%)`)
      lines.push(`- Severity: ${(flag.severity * 100).toFixed(0)}%`)
      lines.push('')
    }
  } else {
    lines.push('## ✅ No drift signals')
    lines.push('')
    lines.push(`_No powers with sharp refusal-rate drops detected (threshold: 30% relative drop)._`)
    lines.push('')
  }

  // Weekly summary
  lines.push('## Weekly summary')
  lines.push('')
  lines.push('| Week start | Total | Aligned | Refused | Refusal rate |')
  lines.push('|---|---|---|---|---|')
  for (const w of stats.weeks) {
    const date = w.weekStart.slice(0, 10)
    const rate = w.proposalsTotal === 0 ? '—' : `${(w.refusalRate * 100).toFixed(0)}%`
    lines.push(`| ${date} | ${w.proposalsTotal} | ${w.proposalsAligned} | ${w.proposalsRefused} | ${rate} |`)
  }
  lines.push('')

  // Tier breakdown for the most recent week
  if (stats.weeks.length > 0) {
    const last = stats.weeks[stats.weeks.length - 1]
    lines.push('## Last week — tier breakdown')
    lines.push('')
    lines.push(`Week of ${last.weekStart.slice(0, 10)}:`)
    lines.push('')
    lines.push(`- FATE refusals: ${last.tierFails.fate}`)
    lines.push(`- Anti-sycophancy refusals: ${last.tierFails.antiSyco}`)
    lines.push(`- Substrate-honesty refusals: ${last.tierFails.substrate}`)
    lines.push(`- Care refusals: ${last.tierFails.care}`)
    lines.push(`- Task refusals: ${last.tierFails.task}`)
    lines.push(`- Interpretability refusals: ${last.tierFails.interp}`)
    lines.push('')
  }

  // Per-power activity
  if (stats.perPower.length > 0) {
    lines.push('## Per-power activity (full window)')
    lines.push('')
    lines.push('| Power | Kind | Exercises | Aligned ext | Refused ext | Built |')
    lines.push('|---|---|---|---|---|---|')
    for (const p of stats.perPower) {
      lines.push(`| ${p.power} | ${p.kind} | ${p.exercises} | ${p.proposalsAligned} | ${p.proposalsRefused} | ${p.built} |`)
    }
    lines.push('')
  }

  lines.push('---')
  lines.push('_Generated by `sophia/powers-audit`. The audit surface for alignment drift._')

  return lines.join('\n')
}
