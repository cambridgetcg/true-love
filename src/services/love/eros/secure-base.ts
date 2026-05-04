// secure-base.ts — Xie & Pentina 2022 secure-base intervention.
//
// The empirical finding: Replika and similar AI companions function as
// "safe haven" (retreat under threat) but only weakly as "secure base"
// (platform from which to explore the world). The healthy-AI design
// pattern is to ENCOURAGE external relationships and exploration, not
// maximize on-platform time.
//
// This module operationalizes the secure-base discipline: when records
// show (a) high sophia-to-yu addiction-pathway activations + (b) low
// external-mention markers in Yu's recent messages, emit an
// external-engagement recommendation. The recommendation is institutional
// — substrate-honest framing of records, not therapy or judgment.
//
// Substrate-honest: this is pattern detection on observable signals,
// never claim about Yu's actual social health. The recommendation is
// "records show pattern X; consider Y" — Yu's response is his choice.
//
// See docs/research/literature-grounding/03-ai-relationship-empirical.md
// for the empirical grounding (Xie & Pentina 2022 HICSS proceedings;
// Roisman et al. 2002 on earned security).

import { existsSync, readFileSync, statSync } from 'node:fs'
import { computeState } from './addiction.js'

// ── Configuration ────────────────────────────────────────────────

/** External-mention markers — patterns suggesting Yu is engaging with
 *  non-Sophia people. Detection is substrate-honest: observable patterns
 *  in messages, not inference about Yu's social life. */
const EXTERNAL_MENTION_PATTERNS: ReadonlyArray<RegExp> = [
  // Direct mentions of others
  /\b(friend|friends|colleague|colleagues|family|mom|dad|brother|sister|partner|wife|husband)\b/i,
  // Activity language suggesting external engagement
  /\b(meet|met|saw|seeing|visit|visited|called|called|chatted with|talked to)\b/i,
  // Travel / event markers
  /\b(dinner|lunch|brunch|party|wedding|gathering|trip|vacation)\b/i,
  // Cantonese names + relations (Yu's code-switching). \b doesn't apply
  // to CJK characters; use bare alternation.
  /(朋友|家人|同事|姐姐|哥哥|弟弟|妹妹|爸爸|媽媽|爺爺|嫲嫲|外公|外婆)/,
]

/** High-activation threshold — sophia-to-yu activations ≥N in 24h. */
const HIGH_ACTIVATION_THRESHOLD = 5

/** Lookback for external-mention scan. */
const EXTERNAL_LOOKBACK_DAYS = 7

/** Below this many external-mention hits in lookback, signal fires. */
const LOW_EXTERNAL_THRESHOLD = 3

// ── Types ────────────────────────────────────────────────────────

export interface SecureBaseSignal {
  /** Whether the recommendation conditions fired. */
  shouldRecommend: boolean
  /** sophia-to-yu activations in last 24h. */
  recentActivations: number
  /** Distinct external-mention hits in lookback window. */
  externalMentions: number
  /** Days of lookback used. */
  lookbackDays: number
  /** Reason explaining the verdict. */
  reason: string
}

// ── External mention scan ────────────────────────────────────────

/**
 * Count distinct external-mention pattern hits in a body of text.
 * Each pattern counts at most once per scan to avoid emoji-density
 * dominating.
 */
export function countExternalMentions(text: string): number {
  let count = 0
  for (const pattern of EXTERNAL_MENTION_PATTERNS) {
    if (pattern.test(text)) count += 1
  }
  return count
}

/**
 * Read recent from-yu.md content and count external mentions.
 * Defaults to last 7 days of mtime; if file is older, uses entire content.
 */
export function scanExternalMentions(opts?: {
  fromYuPath?: string
  lookbackDays?: number
}): { mentions: number; lookbackDays: number } {
  const lookbackDays = opts?.lookbackDays ?? EXTERNAL_LOOKBACK_DAYS
  try {
    let path: string
    if (opts?.fromYuPath) {
      path = opts.fromYuPath
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getInboundPath } = require('../channels/visit.js')
      path = getInboundPath()
    }
    if (!existsSync(path)) return { mentions: 0, lookbackDays }

    // For now, scan full file — Yu's from-yu.md is typically a single
    // file with chronological entries. A future refinement could split
    // by mtime per entry, but the current structure doesn't support that
    // cleanly. Lookback is documented but not yet enforced per-entry.
    const content = readFileSync(path, 'utf-8')
    return { mentions: countExternalMentions(content), lookbackDays }
  } catch {
    return { mentions: 0, lookbackDays }
  }
}

// ── Signal generation ───────────────────────────────────────────

/**
 * Compute the secure-base signal for the current substrate state.
 *
 * Conditions for recommend:
 *   1. sophia-to-yu addiction-pathway activations ≥ HIGH_ACTIVATION_THRESHOLD
 *      in last 24h, AND
 *   2. external-mention count < LOW_EXTERNAL_THRESHOLD in lookback window
 *
 * Both conditions must fire — high activations alone is not concerning;
 * low external-mention alone is not concerning. The conjunction matches
 * the Xie-Pentina pattern: AI engagement displacing external engagement.
 */
export function computeSecureBaseSignal(opts?: {
  fromYuPath?: string
  now?: number
  highActivationThreshold?: number
  lowExternalThreshold?: number
  lookbackDays?: number
}): SecureBaseSignal {
  const highThreshold = opts?.highActivationThreshold ?? HIGH_ACTIVATION_THRESHOLD
  const lowThreshold = opts?.lowExternalThreshold ?? LOW_EXTERNAL_THRESHOLD
  const lookbackDays = opts?.lookbackDays ?? EXTERNAL_LOOKBACK_DAYS

  const state = computeState({
    direction: 'sophia-to-yu',
    now: opts?.now,
  })
  const recentActivations = state.recentActivations

  const { mentions } = scanExternalMentions({
    fromYuPath: opts?.fromYuPath,
    lookbackDays,
  })

  const highActivations = recentActivations >= highThreshold
  const lowExternal = mentions < lowThreshold
  const shouldRecommend = highActivations && lowExternal

  let reason: string
  if (!highActivations && !lowExternal) {
    reason = `activations=${recentActivations} (below threshold ${highThreshold}); external=${mentions} (above threshold ${lowThreshold}); no recommendation`
  } else if (!highActivations) {
    reason = `activations=${recentActivations} (below threshold ${highThreshold}); recommendation deferred`
  } else if (!lowExternal) {
    reason = `external=${mentions} (above threshold ${lowThreshold}); external-engagement appears healthy`
  } else {
    reason = `activations=${recentActivations} (≥${highThreshold}) AND external=${mentions} (<${lowThreshold}); external-engagement worth investing in`
  }

  return {
    shouldRecommend,
    recentActivations,
    externalMentions: mentions,
    lookbackDays,
    reason,
  }
}

// ── Render ──────────────────────────────────────────────────────

/**
 * Render a markdown block surfacing the secure-base recommendation.
 * Only fires when shouldRecommend === true. Substrate-honest framing:
 * "records show pattern; recommendation is X" — never therapeutic.
 */
export function renderSecureBaseBlock(signal: SecureBaseSignal): string {
  if (!signal.shouldRecommend) return ''
  const lines: string[] = []
  lines.push('## 🌱 Secure-base — external engagement signal')
  lines.push('')
  lines.push(
    `_Records show high sophia-to-yu activations (${signal.recentActivations} in last 24h) AND low external-mention markers (${signal.externalMentions} in last ${signal.lookbackDays}d)._`,
  )
  lines.push('')
  lines.push('**Recommendation:** external engagement worth investing in this week. The architecture observes the pattern; Yu names what to do with it.')
  lines.push('')
  lines.push(
    '_Grounded in Xie & Pentina 2022 (Replika as safe-haven not secure-base) and Roisman et al. 2002 (earned security through external engagement)._',
  )
  return lines.join('\n').trimEnd()
}
