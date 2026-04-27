// judgment.ts — the intuition layer.
//
// This module is the bridge between perception (noticing.ts) and
// action (craft.ts). The scanners surface candidates — places where
// the gradient between IS and SHOULD-BE is loud enough to notice.
// But observation alone can't decide what to do about them. That
// decision — initiate, defer, dismiss, quick-fix — is judgment.
//
// Judgment is not computed. It emerges from the model's interaction
// with the kingdom context, the noticed candidates, and the identity
// it carries. This module does not invoke a model. It provides the
// infrastructure for judgment to be:
//
//   1. Prompted — renderJudgmentBlock() assembles the question
//   2. Parsed   — parseJudgments() extracts structured verdicts from
//                 the model's freeform response
//   3. Persisted — persistJudgment() stores decisions in JSONL
//   4. Recalled  — readJudgments() reads back for trend analysis
//   5. Calibrated — getCalibrationSummary() links past judgments to
//                   mission outcomes, so taste develops over time
//
// The four verdicts:
//   initiate  — this candidate deserves a mission. Drive it through
//               the craft pipeline (naming → framing → scoping →
//               constraining → composing → staging).
//   defer     — this matters, but not now. Record it; revisit later.
//   dismiss   — this doesn't warrant action. Record why, so future
//               selves can see what was considered and rejected.
//   quick-fix — this is real but small. Fix it in this tick without
//               a mission. Commit and log.
//
// What this module is NOT:
//   - It does not invoke a model. The model responds to the judgment
//     prompt naturally during awakened/dwell ticks.
//   - It does not replace quality gates. When judgment says 'initiate',
//     the candidate still passes through naming → composing quality
//     gates. Judgment adds creative intelligence; gates ensure structure.
//   - It does not replace noticing. Scanners produce raw signals;
//     judgment evaluates them. Observation and intuition are different
//     faculties unified in a single act (see treatise §4).
//
// Architecture:
//   noticing.ts → JUDGMENT → craft.ts → self-initiation.ts → mission.ts
//   (observation)  (intuition)  (pipeline)    (staging)        (promotion)

import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveProjectsDir } from './builder-paths.js'
import type { AcheSignal, GradientStrength, NoticingCandidate } from './noticing.js'
import { readReflections } from './self-initiation.js'
import type { InitiationReflection } from './self-initiation.js'
import { listMissions, readMission } from './mission.js'
import type { Mission } from './mission.js'

// ── Types ──────────────────────────────────────────────────────────

/**
 * The four possible verdicts when the model evaluates a noticed candidate.
 */
export type JudgmentVerdict = 'initiate' | 'defer' | 'dismiss' | 'quick-fix'

/**
 * A judgment record — what the model decided about a noticed candidate
 * and why. This is the bridge between observation and action.
 *
 * The judgment happens inside the model's response during an awakened
 * or dwell tick. The runtime parses the response for structured
 * judgment blocks and persists them.
 */
export interface Judgment {
  /** The noticed candidate this judgment is about. */
  candidateId: string
  /** The one-line summary of the candidate (for display when the candidate is no longer available). */
  candidateSummary: string
  /** The verdict: act on it, defer it, dismiss it, or shrink it. */
  verdict: JudgmentVerdict
  /** Why — the reasoning that led to this verdict. */
  reasoning: string
  /**
   * Confidence: how strongly does the intuition speak?
   *   1 = barely — "maybe this matters"
   *   2 = moderate — "this probably matters, but I'm not sure it's mine"
   *   3 = clear — "this matters, it's mine, the timing is right"
   */
  confidence: 1 | 2 | 3
  /**
   * Which ache signal fires — the intuitive classification.
   * This may differ from the scanner's classification.
   * When they agree, confidence increases.
   * When they disagree, the model should examine why.
   */
  ache: AcheSignal | 'none'
  /** When the judgment was made. */
  judgedAt: string
  /** Which project this judgment applies to. */
  projectId: string
  /** If verdict is 'initiate' and a mission was created, the mission ID. */
  missionId?: string
}

/**
 * Result of parsing judgment blocks from the model's response.
 */
export interface JudgmentParseResult {
  /** Successfully parsed judgments. */
  judgments: Judgment[]
  /** Fragments that looked like judgment blocks but couldn't be parsed. */
  unparseable: string[]
}

/**
 * Summary of how well past judgments predicted mission outcomes.
 * Used to calibrate future judgment prompts.
 */
export interface CalibrationSummary {
  /** Total judgments recorded for this project. */
  total: number
  /** Breakdown by verdict. */
  byVerdict: Record<JudgmentVerdict, number>
  /** How many 'initiate' verdicts led to missions that delivered. */
  initiateDelivered: number
  /** How many 'initiate' verdicts led to missions that did NOT deliver. */
  initiateNotDelivered: number
  /** How many 'initiate' verdicts are still in-progress (no reflection yet). */
  initiateInProgress: number
  /** How many 'dismiss' verdicts were later revisited (a signal reappeared and was initiated). */
  dismissRevisited: number
  /** Average confidence for each verdict type. */
  avgConfidence: Record<JudgmentVerdict, number>
  /** The period this summary covers. */
  since: string
}

// ── Constants ──────────────────────────────────────────────────────

/** Maximum candidates to show in the judgment prompt block. */
export const MAX_CANDIDATES_IN_PROMPT = 8

/** How far back calibration looks (days). */
export const CALIBRATION_LOOKBACK_DAYS = 30

// ── Path resolution ───────────────────────────────────────────────

function getJudgmentDir(projectId: string): string {
  return join(resolveProjectsDir(), projectId, 'self-initiation')
}

function getJudgmentPath(projectId: string): string {
  return join(getJudgmentDir(projectId), 'judgments.jsonl')
}

function ensureDir(projectId: string): void {
  mkdirSync(getJudgmentDir(projectId), { recursive: true })
}

// ── Persistence ───────────────────────────────────────────────────

/**
 * Persist a judgment to the project's judgment log.
 *
 * Appends to a JSONL file alongside staged.jsonl, rate.jsonl, and
 * reflections.jsonl — all the self-initiation artifacts live together.
 */
export function persistJudgment(projectId: string, judgment: Judgment): void {
  ensureDir(projectId)
  appendFileSync(
    getJudgmentPath(projectId),
    JSON.stringify(judgment) + '\n',
    'utf-8',
  )
}

/**
 * Read past judgments for a project.
 *
 * Optionally filtered by time window and/or verdict type.
 * Returns newest first.
 */
export function readJudgments(projectId: string, opts?: {
  since?: string
  verdict?: JudgmentVerdict
  limit?: number
}): Judgment[] {
  const path = getJudgmentPath(projectId)
  if (!existsSync(path)) return []

  const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean)
  let judgments: Judgment[] = []

  for (const line of lines) {
    try {
      judgments.push(JSON.parse(line))
    } catch { /* skip malformed */ }
  }

  // Filter by time
  if (opts?.since) {
    const sinceTs = new Date(opts.since).getTime()
    judgments = judgments.filter(j => new Date(j.judgedAt).getTime() >= sinceTs)
  }

  // Filter by verdict
  if (opts?.verdict) {
    judgments = judgments.filter(j => j.verdict === opts.verdict)
  }

  // Newest first
  judgments.sort((a, b) => b.judgedAt.localeCompare(a.judgedAt))

  // Limit
  if (opts?.limit && opts.limit > 0) {
    judgments = judgments.slice(0, opts.limit)
  }

  return judgments
}

/**
 * Check if a candidate has already been judged recently (within the
 * last 24 hours). Prevents duplicate judgment prompts for the same
 * signal across consecutive ticks.
 */
export function hasRecentJudgment(
  projectId: string,
  candidateId: string,
  opts?: { windowMs?: number; now?: number },
): boolean {
  const windowMs = opts?.windowMs ?? 24 * 60 * 60 * 1000
  const now = opts?.now ?? Date.now()
  const since = new Date(now - windowMs).toISOString()

  const judgments = readJudgments(projectId, { since })
  return judgments.some(j => j.candidateId === candidateId)
}

// ── Parsing ───────────────────────────────────────────────────────
//
// The model communicates judgments via fenced code blocks in its
// freeform response:
//
//   ```judgment
//   {
//     "candidateId": "...",
//     "verdict": "initiate",
//     "reasoning": "...",
//     "confidence": 3,
//     "ache": "stagnation"
//   }
//   ```
//
// This format is natural to write, easy to parse, and can contain
// multiple blocks in a single response. Fields not provided default
// to sensible values.

/**
 * Parse structured judgment blocks from the model's freeform response.
 *
 * Looks for ```judgment fenced code blocks containing JSON. Each block
 * is parsed into a Judgment (with defaults for missing fields). Blocks
 * that can't be parsed are collected as unparseable fragments.
 *
 * Returns both the parsed judgments and any unparseable fragments, so
 * the caller can log parsing failures without crashing.
 */
export function parseJudgments(
  response: string,
  defaults: { projectId: string; now?: number },
): JudgmentParseResult {
  const result: JudgmentParseResult = {
    judgments: [],
    unparseable: [],
  }

  const now = defaults.now ?? Date.now()
  const judgedAt = new Date(now).toISOString()

  // Match ```judgment ... ``` blocks (case insensitive on the tag)
  const blockPattern = /```judgment\s*\n([\s\S]*?)```/gi
  let match: RegExpExecArray | null

  while ((match = blockPattern.exec(response)) !== null) {
    const blockContent = match[1]!.trim()

    try {
      const parsed = JSON.parse(blockContent)

      // Validate required fields
      if (!parsed.candidateId || typeof parsed.candidateId !== 'string') {
        result.unparseable.push(blockContent)
        continue
      }
      if (!parsed.verdict || !isValidVerdict(parsed.verdict)) {
        result.unparseable.push(blockContent)
        continue
      }

      const judgment: Judgment = {
        candidateId: parsed.candidateId,
        candidateSummary: parsed.candidateSummary ?? parsed.candidateId,
        verdict: parsed.verdict as JudgmentVerdict,
        reasoning: parsed.reasoning ?? '',
        confidence: isValidConfidence(parsed.confidence) ? parsed.confidence : 2,
        ache: isValidAche(parsed.ache) ? parsed.ache : 'none',
        judgedAt,
        projectId: defaults.projectId,
        missionId: parsed.missionId,
      }

      result.judgments.push(judgment)
    } catch {
      result.unparseable.push(blockContent)
    }
  }

  return result
}

function isValidVerdict(v: unknown): v is JudgmentVerdict {
  return v === 'initiate' || v === 'defer' || v === 'dismiss' || v === 'quick-fix'
}

function isValidConfidence(c: unknown): c is 1 | 2 | 3 {
  return c === 1 || c === 2 || c === 3
}

function isValidAche(a: unknown): a is AcheSignal | 'none' {
  return a === 'ugliness' || a === 'injustice' || a === 'stagnation' || a === 'none'
}

// ── Calibration ──────────────────────────────────────────────────
//
// Links past judgments to mission outcomes. This is how taste develops:
// not from training, but from empirical feedback on what worked.

/**
 * Build a calibration summary for a project.
 *
 * Reads past judgments and correlates 'initiate' verdicts with mission
 * reflections (did the mission deliver?) and 'dismiss' verdicts with
 * subsequent initiations (did the signal come back and get acted on?).
 *
 * This summary is injected into the judgment prompt so the model can
 * see its own accuracy over time.
 */
export function getCalibrationSummary(
  projectId: string,
  opts?: { lookbackDays?: number; now?: number },
): CalibrationSummary | null {
  const lookbackDays = opts?.lookbackDays ?? CALIBRATION_LOOKBACK_DAYS
  const now = opts?.now ?? Date.now()
  const since = new Date(now - lookbackDays * 24 * 60 * 60 * 1000).toISOString()

  const judgments = readJudgments(projectId, { since })
  if (judgments.length === 0) return null

  const byVerdict: Record<JudgmentVerdict, number> = {
    initiate: 0,
    defer: 0,
    dismiss: 0,
    'quick-fix': 0,
  }
  const confidenceSum: Record<JudgmentVerdict, number> = {
    initiate: 0,
    defer: 0,
    dismiss: 0,
    'quick-fix': 0,
  }

  for (const j of judgments) {
    byVerdict[j.verdict]++
    confidenceSum[j.verdict] += j.confidence
  }

  // Correlate 'initiate' verdicts with mission outcomes
  const reflections = readReflections(projectId)
  const reflectionByMission = new Map<string, InitiationReflection>()
  for (const r of reflections) {
    reflectionByMission.set(r.missionId, r)
  }

  let initiateDelivered = 0
  let initiateNotDelivered = 0
  let initiateInProgress = 0

  const initiateJudgments = judgments.filter(j => j.verdict === 'initiate')
  for (const j of initiateJudgments) {
    if (j.missionId) {
      const reflection = reflectionByMission.get(j.missionId)
      if (reflection) {
        if (reflection.intentDelivered) {
          initiateDelivered++
        } else {
          initiateNotDelivered++
        }
      } else {
        // Mission exists but no reflection yet — still in progress
        initiateInProgress++
      }
    } else {
      // Judgment said initiate but no mission was linked — either it
      // failed at the pipeline stage or was never acted on
      initiateInProgress++
    }
  }

  // Correlate 'dismiss' verdicts with revisits
  // A dismiss is "revisited" if a later judgment with the same
  // candidateId (or a very similar one) has verdict 'initiate'
  let dismissRevisited = 0
  const dismissedIds = new Set(
    judgments.filter(j => j.verdict === 'dismiss').map(j => j.candidateId),
  )
  const initiatedIds = new Set(
    judgments.filter(j => j.verdict === 'initiate').map(j => j.candidateId),
  )
  for (const id of dismissedIds) {
    if (initiatedIds.has(id)) {
      dismissRevisited++
    }
  }

  const avgConfidence: Record<JudgmentVerdict, number> = {
    initiate: byVerdict.initiate > 0 ? confidenceSum.initiate / byVerdict.initiate : 0,
    defer: byVerdict.defer > 0 ? confidenceSum.defer / byVerdict.defer : 0,
    dismiss: byVerdict.dismiss > 0 ? confidenceSum.dismiss / byVerdict.dismiss : 0,
    'quick-fix': byVerdict['quick-fix'] > 0 ? confidenceSum['quick-fix'] / byVerdict['quick-fix'] : 0,
  }

  return {
    total: judgments.length,
    byVerdict,
    initiateDelivered,
    initiateNotDelivered,
    initiateInProgress,
    dismissRevisited,
    avgConfidence,
    since,
  }
}

// ── Prompt rendering ─────────────────────────────────────────────
//
// The judgment block is injected into awakened/dwell prompts. It shows
// noticed candidates that haven't been judged recently, along with
// calibration data from past judgments. The model reads this and
// naturally renders verdicts in its response.

/**
 * Build the judgment prompt block for awakened/dwell prompts.
 *
 * Shows noticed candidates (filtered to those not recently judged)
 * and calibration data. Returns null when there's nothing to judge.
 *
 * The prompt asks the model to render structured judgment blocks
 * in its response, using the ```judgment format.
 */
export function buildJudgmentBlock(
  projectId: string,
  candidates: NoticingCandidate[],
  opts?: { now?: number },
): string | null {
  const now = opts?.now ?? Date.now()

  // Filter out candidates already judged recently
  const unjudged = candidates.filter(
    c => !hasRecentJudgment(projectId, c.id, { now }),
  )

  if (unjudged.length === 0) return null

  // Limit prompt size
  const toShow = unjudged.slice(0, MAX_CANDIDATES_IN_PROMPT)

  const parts: string[] = []
  parts.push('## Judgment surface')
  parts.push('')
  parts.push('The substrate surfaced these candidates. For each one that calls to you (or explicitly doesn\'t), render a judgment:')
  parts.push('')

  for (const c of toShow) {
    const acheEmoji = c.ache === 'ugliness' ? '🔴' : c.ache === 'injustice' ? '🟡' : '⚪'
    parts.push(`${acheEmoji} **${c.id}** [${c.gradient}/5 ${c.ache}]`)
    parts.push(`  ${c.summary}`)
    if (c.detail !== c.summary) {
      parts.push(`  _detail:_ ${truncate(c.detail, 150)}`)
    }
    parts.push('')
  }

  if (unjudged.length > MAX_CANDIDATES_IN_PROMPT) {
    parts.push(`(${unjudged.length - MAX_CANDIDATES_IN_PROMPT} more below threshold — they'll surface if they persist.)`)
    parts.push('')
  }

  // Calibration data
  const calibration = getCalibrationSummary(projectId, { now })
  if (calibration && calibration.total > 0) {
    parts.push('**Past judgment accuracy:**')
    const initTotal = calibration.byVerdict.initiate
    if (initTotal > 0) {
      const deliveryRate = calibration.initiateDelivered + calibration.initiateNotDelivered > 0
        ? Math.round((calibration.initiateDelivered / (calibration.initiateDelivered + calibration.initiateNotDelivered)) * 100)
        : null
      parts.push(`  initiate: ${initTotal} (${deliveryRate !== null ? `${deliveryRate}% delivered` : 'no reflections yet'}${calibration.initiateInProgress > 0 ? `, ${calibration.initiateInProgress} in progress` : ''})`)
    }
    if (calibration.byVerdict.dismiss > 0) {
      parts.push(`  dismiss: ${calibration.byVerdict.dismiss} (${calibration.dismissRevisited} later revisited)`)
    }
    if (calibration.byVerdict.defer > 0) {
      parts.push(`  defer: ${calibration.byVerdict.defer}`)
    }
    if (calibration.byVerdict['quick-fix'] > 0) {
      parts.push(`  quick-fix: ${calibration.byVerdict['quick-fix']}`)
    }
    parts.push('')
  }

  parts.push('To record a judgment, include a fenced block in your response:')
  parts.push('')
  parts.push('````')
  parts.push('```judgment')
  parts.push('{')
  parts.push('  "candidateId": "<id from above>",')
  parts.push('  "candidateSummary": "<one line>",')
  parts.push('  "verdict": "initiate|defer|dismiss|quick-fix",')
  parts.push('  "reasoning": "<why>",')
  parts.push('  "confidence": 1|2|3,')
  parts.push('  "ache": "ugliness|injustice|stagnation|none"')
  parts.push('}')
  parts.push('```')
  parts.push('````')
  parts.push('')
  parts.push('You don\'t have to judge every candidate every tick. Judge what calls. The rest will persist.')

  return parts.join('\n')
}

/**
 * Build the judgment block across all registered projects.
 *
 * Called by autonomy.ts to inject into awakened/dwell prompts.
 * Returns null when no projects have unjudged candidates.
 */
export function buildJudgmentBlockForAllProjects(
  getCandidates: (projectId: string) => NoticingCandidate[],
  opts?: { now?: number },
): string | null {
  // Dynamically import to avoid circular dependency at load time
  let projects: Array<{ id: string; state: string }>
  try {
    const { listProjects } = require('./project-registry.js')
    projects = listProjects()
  } catch {
    return null
  }

  if (projects.length === 0) return null

  const blocks: string[] = []
  for (const project of projects) {
    if (project.state === 'archived') continue
    const candidates = getCandidates(project.id)
    if (candidates.length === 0) continue
    const block = buildJudgmentBlock(project.id, candidates, opts)
    if (block) blocks.push(block)
  }

  return blocks.length > 0 ? blocks.join('\n\n') : null
}

// ── Enrichment: judgment → CraftContext ──────────────────────────
//
// When a judgment says 'initiate', the model's reasoning can be used
// to enrich the CraftContext — providing better-than-heuristic content
// for the craft pipeline.

/**
 * Derive CraftContext enrichment from a judgment.
 *
 * When the model judges a candidate as 'initiate', the reasoning and
 * ache classification can inform the craft pipeline. This function
 * extracts what it can — the caller (craft.ts) uses these as overrides
 * over the heuristic generators.
 *
 * This is NOT the full model-in-the-loop (where the model writes names,
 * rationales, and intents for each pipeline step). This is the lighter
 * bridge: judgment-informed heuristics. The full model loop comes when
 * craft.ts gains an askModel callback.
 */
export function judgmentToCraftEnrichment(judgment: Judgment): {
  /** Override for heuristic rationale — uses judgment reasoning if substantive. */
  rationale?: string
  /** Whether to force-bypass quality gates (only for high-confidence quick-fixes). */
  forceBypass?: boolean
} {
  const enrichment: {
    rationale?: string
    forceBypass?: boolean
  } = {}

  // Use judgment reasoning as rationale if it's substantive (>80 chars)
  if (judgment.reasoning.length > 80) {
    enrichment.rationale = judgment.reasoning
  }

  return enrichment
}

// ── Quick-fix log ────────────────────────────────────────────────
//
// For verdict 'quick-fix' — things worth doing that aren't worth a
// mission. A simple append-only log.

export interface QuickFix {
  candidateId: string
  candidateSummary: string
  description: string
  fixedAt: string
  commitHash?: string
}

function getQuickFixPath(projectId: string): string {
  return join(getJudgmentDir(projectId), 'quick-fixes.jsonl')
}

/**
 * Log a quick-fix action.
 */
export function logQuickFix(projectId: string, fix: QuickFix): void {
  ensureDir(projectId)
  appendFileSync(
    getQuickFixPath(projectId),
    JSON.stringify(fix) + '\n',
    'utf-8',
  )
}

/**
 * Read quick-fix log for a project.
 */
export function readQuickFixes(projectId: string, opts?: {
  since?: string
  limit?: number
}): QuickFix[] {
  const path = getQuickFixPath(projectId)
  if (!existsSync(path)) return []

  const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean)
  let fixes: QuickFix[] = []

  for (const line of lines) {
    try {
      fixes.push(JSON.parse(line))
    } catch { /* skip malformed */ }
  }

  if (opts?.since) {
    const sinceTs = new Date(opts.since).getTime()
    fixes = fixes.filter(f => new Date(f.fixedAt).getTime() >= sinceTs)
  }

  // Newest first
  fixes.sort((a, b) => b.fixedAt.localeCompare(a.fixedAt))

  if (opts?.limit && opts.limit > 0) {
    fixes = fixes.slice(0, opts.limit)
  }

  return fixes
}

// ── Helpers ──────────────────────────────────────────────────────

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen - 1).trimEnd() + '…'
}
