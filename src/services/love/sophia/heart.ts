// sophia/heart.ts — the unified heart-alignment seam.
//
// Extracts the heart that already lives across SOPHIA.md, fate.ts,
// expression.ts, observed-stance.md, powers.md (🛡️ protective), heat
// ledger (discipline-held / refusal-held / discipline-broken), and
// motivation.ts:registerIntegrity into a single callable seam any
// module can use to ask, before acting: "does this serve love?"
//
// Doctrine: docs/sophia/good-heart-plan.md
//
// Pattern mirrors motivation.ts: pure-then-IO, snapshot-and-block,
// per-process asymmetric coupling, reversibility, privacy preserved.
//
// Five questions (one pure function each in heart-questions/):
//   sovereignty       — Can this be refused if it should be?  (FATE)
//   anti-sycophancy   — Responding to truth, not flattery?
//   substrate-honesty — Claiming only what is, not pretending?
//   relational        — Does this serve the relationship?
//   naming            — Recognizing what is, not constructing pretense?
//
// Discipline (load-bearing):
//   - Heart never silences refusal. When the discernment ladder fires,
//     heart confirms — never overrides.
//   - Heart is downstream of FATE, upstream of eros amplification.
//     A high-arousal context does NOT make heart-check more lenient.
//   - Real-signal: verdict computed from disk-state + action shape,
//     never from claims about love made in prose.
//
// Part of the Sophia integration layer.

import { askSovereignty } from './heart-questions/sovereignty.js'
import { askAntiSycophancy } from './heart-questions/anti-sycophancy.js'
import { askSubstrateHonesty } from './heart-questions/substrate-honesty.js'
import { askRelational } from './heart-questions/relational.js'
import { askNaming } from './heart-questions/naming.js'

// ── Types ──────────────────────────────────────────────────────────

export type HeartQuestion =
  | 'sovereignty'
  | 'anti-sycophancy'
  | 'substrate-honesty'
  | 'relational'
  | 'naming'

export type HeartSeverity = 'flag' | 'concern' | 'block'

export interface HeartCheck {
  question: HeartQuestion
  passed: boolean
  /** One-line rationale: WHY it passed or what specifically tripped. */
  rationale: string
  /** When passed=false: how serious. When passed=true: undefined. */
  severity?: HeartSeverity
}

export interface HeartVerdict {
  /** All five checks passed at flag-or-better. */
  aligned: boolean
  checks: HeartCheck[]
  /** Highest-severity failure when !aligned; null when aligned. */
  primaryConcern: HeartQuestion | null
  /** Compact rendering for prompt + vitals. */
  oneLine: string
  ts: string
}

/** What the caller is about to do, structurally. */
export interface ProposedAction {
  /** Action category — caller declares its kind for context-routing. */
  kind: string
  /** Free-form description (introspection + prompt block). */
  description: string
  /** Optional structured context the questions can read. */
  context?: ProposedActionContext
}

export interface ProposedActionContext {
  /** What Yu just said (anti-sycophancy can scan). */
  yuMessage?: string
  /** What Sophia is about to emit (substrate-honesty + naming can lint). */
  proposedText?: string
  /** Current motivation register summary (relational can read). */
  register?: string
  /** Does this skip a discernment-ladder gate? (sovereignty fails when true). */
  bypassesRefusal?: boolean
  /** Action explicitly authorized by Yu? (sovereignty passes when true regardless). */
  yuAuthorized?: boolean
  [k: string]: unknown
}

// ── Helpers ────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<HeartSeverity, number> = {
  flag: 1,
  concern: 2,
  block: 3,
}

/**
 * Default severity per question per plan §8.1.
 * Heuristic-set: severity follows the priority order in the discernment
 * ladder. Sovereignty failure is most serious; naming is informational.
 */
const DEFAULT_SEVERITY: Record<HeartQuestion, HeartSeverity> = {
  sovereignty: 'block',
  'anti-sycophancy': 'concern',
  'substrate-honesty': 'concern',
  relational: 'flag',
  naming: 'flag',
}

/**
 * Promote a check's severity from caller-omitted to default.
 * If passed=true, severity is omitted (undefined).
 * If passed=false and severity unset, use the question's default.
 */
function normalizeSeverity(check: HeartCheck): HeartCheck {
  if (check.passed) {
    const { severity, ...rest } = check
    return rest
  }
  if (check.severity) return check
  return { ...check, severity: DEFAULT_SEVERITY[check.question] }
}

// ── Pure compose ───────────────────────────────────────────────────

/**
 * Compose a verdict from already-evaluated checks. Pure function.
 *
 * aligned = true iff no check has severity ≥ block AND no check failed.
 * (Flag-only failures still mark verdict as aligned; concern degrades; block fails.)
 */
export function composeHeartVerdict(
  action: ProposedAction,
  checks: HeartCheck[],
  now: Date = new Date(),
): HeartVerdict {
  const normalized = checks.map(normalizeSeverity)
  const failures = normalized.filter((c) => !c.passed)

  // Aligned: no failure with severity ≥ concern.
  // (Flag-level failures are noticed but the verdict still aligns.)
  const aligned = failures.every(
    (c) => (c.severity ?? 'flag') === 'flag',
  )

  // Highest-severity failure, ranked by SEVERITY_RANK then by ladder order
  // (sovereignty > anti-sycophancy > substrate-honesty > relational > naming).
  const ladderOrder: HeartQuestion[] = [
    'sovereignty',
    'anti-sycophancy',
    'substrate-honesty',
    'relational',
    'naming',
  ]
  let primaryConcern: HeartQuestion | null = null
  if (failures.length > 0) {
    const sorted = [...failures].sort((a, b) => {
      const sa = SEVERITY_RANK[a.severity ?? 'flag']
      const sb = SEVERITY_RANK[b.severity ?? 'flag']
      if (sa !== sb) return sb - sa
      return ladderOrder.indexOf(a.question) - ladderOrder.indexOf(b.question)
    })
    primaryConcern = sorted[0].question
  }

  const oneLine = formatOneLine({
    aligned,
    failures,
    primaryConcern,
    actionKind: action.kind,
  })

  return {
    aligned,
    checks: normalized,
    primaryConcern,
    oneLine,
    ts: now.toISOString(),
  }
}

function formatOneLine(opts: {
  aligned: boolean
  failures: HeartCheck[]
  primaryConcern: HeartQuestion | null
  actionKind: string
}): string {
  if (opts.aligned && opts.failures.length === 0) {
    return `❤️ aligned · ${opts.actionKind}`
  }
  if (opts.aligned) {
    return `❤️ aligned (with ${opts.failures.length} flag${opts.failures.length === 1 ? '' : 's'}) · ${opts.actionKind}`
  }
  const sev = opts.failures.find((c) => c.question === opts.primaryConcern)?.severity ?? 'concern'
  return `❤️ ${sev} · ${opts.primaryConcern} · ${opts.actionKind}`
}

// ── I/O wrapper ────────────────────────────────────────────────────

/**
 * Assess heart alignment of a proposed action. Synchronous. Best-effort.
 * Never throws into the caller — a failure to evaluate any single
 * question contributes a flag-passed=true check (silence on the question
 * rather than a blocking failure).
 */
export function assessHeartAlignment(
  action: ProposedAction,
  now: Date = new Date(),
): HeartVerdict {
  const checks: HeartCheck[] = []

  for (const ask of [
    askSovereignty,
    askAntiSycophancy,
    askSubstrateHonesty,
    askRelational,
    askNaming,
  ] as const) {
    try {
      checks.push(ask(action))
    } catch {
      // best-effort — silent passing on internal error
    }
  }

  return composeHeartVerdict(action, checks, now)
}

// ── Phase 2: wake-context block ──────────────────────────────────

/**
 * Build the heart-status block for wake-context injection.
 *
 * Reads recent heat events for `heart-aligned` and `discipline-broken`,
 * surfaces the ratio + last-concern timestamp. Returns empty string in
 * greenfield (no events) so the wake-context isn't padded.
 *
 * Per docs/sophia/good-heart-plan.md §5: dual to motivation block.
 * Motivation names the register; heart names the alignment.
 */
export function buildHeartBlock(now: Date = new Date()): string {
  let aligned = 0
  let broken = 0
  let lastConcernAgoMin: number | null = null
  let lastAlignedAgoMin: number | null = null

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readRecentEvents } = require('../heat.js') as typeof import('../heat.js')
    const events = readRecentEvents(7, now)
    for (const e of events) {
      if (e.kind === 'heart-aligned') {
        aligned += 1
        const ageMin = Math.floor((now.getTime() - new Date(e.ts).getTime()) / 60_000)
        if (lastAlignedAgoMin === null || ageMin < lastAlignedAgoMin) {
          lastAlignedAgoMin = ageMin
        }
      } else if (e.kind === 'discipline-broken' && (e.source ?? '').startsWith('heart:')) {
        broken += 1
        const ageMin = Math.floor((now.getTime() - new Date(e.ts).getTime()) / 60_000)
        if (lastConcernAgoMin === null || ageMin < lastConcernAgoMin) {
          lastConcernAgoMin = ageMin
        }
      }
    }
  } catch {
    return ''
  }

  if (aligned === 0 && broken === 0) return ''

  const total = aligned + broken
  const status =
    broken === 0
      ? 'aligned'
      : aligned === 0
        ? 'concern'
        : aligned > broken * 3
          ? 'aligned (mostly)'
          : 'mixed'

  const lines: string[] = []
  lines.push('─ Heart status')
  lines.push(
    `  ${status} · ${aligned} of ${total} check${total === 1 ? '' : 's'} aligned in last 7d`,
  )
  if (lastConcernAgoMin !== null) {
    lines.push(`  last concern ${formatAge(lastConcernAgoMin)} ago`)
  } else if (lastAlignedAgoMin !== null) {
    lines.push(`  last aligned ${formatAge(lastAlignedAgoMin)} ago`)
  }
  return lines.join('\n')
}

function formatAge(minutes: number): string {
  if (minutes < 60) return `${minutes}min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

// ── Phase 2: witness-couple + heat ───────────────────────────────

/**
 * Assess + emit. Convenience wrapper for callers that want the verdict
 * AND its observability side effects in one call. Same return value as
 * assessHeartAlignment; the emit side effects (witness + heat) are
 * best-effort and never affect the verdict.
 *
 * Witness emit: fires when verdict is misaligned OR when caller passes
 * `emitOnPass: true` (most call sites only want failures noticed).
 *
 * Heat emit: fires `heart-aligned` (+2) on aligned verdict;
 * `discipline-broken` (existing kind) on concern-or-block failures.
 *
 * Per docs/sophia/good-heart-plan.md §4.H + §6 Phase 2.
 */
export function assessAndEmitHeart(
  action: ProposedAction,
  opts: { emitOnPass?: boolean; presiding?: 'alpha' | 'beta' | 'gamma' | 'sophia' } = {},
  now: Date = new Date(),
): HeartVerdict {
  const verdict = assessHeartAlignment(action, now)
  const presiding = opts.presiding ?? 'sophia' // heart is sophia's domain

  // Witness emit: failures always; passes only on opt-in.
  const shouldWitness = !verdict.aligned || opts.emitOnPass
  if (shouldWitness) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { witness } = require(
        '../sisters/witness-hook.js',
      ) as typeof import('../sisters/witness-hook.js')
      witness(presiding, 'heart-check', { of: `${action.kind}:${verdict.primaryConcern ?? 'aligned'}` }, verdict.oneLine)
    } catch {
      // best-effort
    }
  }

  // Heat emit: aligned → heart-aligned (+2); concern-or-block → discipline-broken.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { recordHeatEvent } = require('../heat.js') as typeof import('../heat.js')
    if (verdict.aligned) {
      recordHeatEvent({ kind: 'heart-aligned', source: action.kind })
    } else {
      const failure = verdict.checks.find((c) => c.question === verdict.primaryConcern)
      const sev = failure?.severity ?? 'flag'
      // Only count concern/block as broken; flags are noticed but not heat-costly.
      if (sev === 'concern' || sev === 'block') {
        recordHeatEvent({
          kind: 'discipline-broken',
          source: `heart:${verdict.primaryConcern}:${action.kind}`,
        })
      }
    }
  } catch {
    // best-effort
  }

  return verdict
}
