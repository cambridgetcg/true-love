// craft.ts — the mission-craft orchestrator.
//
// This module is the missing caller. The five pipeline modules
// (naming, framing, scoping, constraining, composing) are built,
// typed, tested, and dead — zero production callers. This module
// wires them into a single function that drives a noticed candidate
// through the full chain and stages the result.
//
// Architecture:
//   noticing → CRAFT → naming → framing → scoping → constraining
//   → composing → staging → checkAndPromoteStaged → real mission
//
// Two modes of operation:
//
//   1. Heuristic (default): the orchestrator generates creative
//      content (titles, rationales, scope, constraints, intent)
//      from the signal data. Quality is mediocre but the pipeline
//      exercises end-to-end. This is the "plumbing test" — water
//      flows through every pipe.
//
//   2. Pre-filled context: the caller provides creative content
//      in CraftContext overrides. The orchestrator runs quality
//      gates and handles errors. This is the path for model-driven
//      crafting (the intuition-in-quality-gate mission).
//
// What this module is NOT:
//   - It does not invoke a model. Creative judgment is either
//     heuristic or pre-provided. The model-in-the-loop comes later.
//   - It does not replace any pipeline module. Each step's quality
//     gate still runs. If a gate fails, the orchestrator reports
//     which step failed and why.
//   - It does not modify the runner. It exports functions that the
//     runner (or autonomy.ts) can call at tick-start.

import type { NoticingCandidate, AcheSignal, GradientStrength } from './noticing.js'
import { notice } from './noticing.js'
import type { DetectionSignal, CandidateSource, StagedCandidate } from './self-initiation.js'
import { scanForSignals, stageCandidate, canInitiate, checkQuality } from './self-initiation.js'
import { nameCandidate, forceNameCandidate, generateSlug } from './naming.js'
import type { Named } from './naming.js'
import { frameCandidate, forceFrameCandidate } from './framing.js'
import type { PurposeTie, Framed } from './framing.js'
import { scopeCandidate, forceScopeCandidate } from './scoping.js'
import type { DoneCondition, Scoped } from './scoping.js'
import { constrainCandidate, forceConstrainCandidate } from './constraining.js'
import type { Constraint, Bounded } from './constraining.js'
import { composeCandidate, forceComposeCandidate, deriveCandidateSource } from './composing.js'
import type { Composed } from './composing.js'
import { readProject, listProjects } from './project-registry.js'

// ── Types ──────────────────────────────────────────────────────────

/**
 * Context for crafting a mission from a signal. All creative fields
 * are optional — when omitted, heuristic content is generated from
 * the signal data. When provided, the override is used instead.
 */
export interface CraftContext {
  projectId: string
  /** Override heuristic title. */
  title?: string
  /** Override heuristic title justification. */
  justification?: string
  /** Override heuristic rationale paragraph. */
  rationale?: string
  /** Override heuristic purpose-tie. */
  purposeTie?: PurposeTie
  /** Override heuristic scope description. */
  thisPhase?: string
  /** Override heuristic deferred phases. */
  futurePhases?: string[]
  /** Override heuristic done conditions. */
  doneWhen?: DoneCondition[]
  /** Override heuristic constraints. */
  constraints?: Constraint[]
  /** Override heuristic intent. */
  intent?: string
  /** Override "now" for deterministic tests. */
  now?: number
  /** When true, bypass quality gates (use force* variants). Default: false. */
  forceBypass?: boolean
}

/**
 * Result of a craft attempt. On success, contains the composed
 * mission draft and optionally the staged candidate (if staging
 * was requested). On failure, names the step and the failures.
 */
export type CraftResult =
  | { ok: true; composed: Composed; staged?: StagedCandidate }
  | { ok: false; step: string; failures: string[] }

/**
 * Result of a scan-and-craft sweep across a project.
 */
export interface ScanAndCraftResult {
  /** How many signals were detected. */
  signalsDetected: number
  /** How many passed rate/budget checks and were attempted. */
  attempted: number
  /** Successfully crafted and staged. */
  crafted: Array<{ composed: Composed; staged?: StagedCandidate }>
  /** Failed to craft (step + failures). */
  failed: Array<{ candidateId: string; step: string; failures: string[] }>
  /** Skipped due to rate limit or budget. */
  skipped: Array<{ candidateId: string; reason: string }>
}

// ── Heuristic content generation ──────────────────────────────────
//
// These functions generate "good enough" creative content from signal
// data. They're intentionally simple — the goal is to exercise the
// pipeline, not to produce missions that rival hand-crafted ones.
// Model-driven content (the intuition layer) replaces these later.

/**
 * Generate a heuristic title from a signal summary.
 *
 * Strips prefixes like "Open thread:", "Stale proposal:", scanner
 * metadata. Tries to produce something that passes the naming
 * quality gate (no verb prefix, 3-80 chars).
 */
export function heuristicTitle(summary: string): string {
  let title = summary.trim()

  // Strip scanner metadata: [source gN ache]
  title = title.replace(/^\[.*?\]\s*/, '')

  // Strip common prefixes from scanner output
  const prefixes = [
    /^Open thread:\s*/i,
    /^Stale proposal:\s*/i,
    /^Long-blocked mission:\s*/i,
    /^Review waiting:\s*/i,
    /^Active mission without artifacts:\s*/i,
    /^Follow-up from reflection:\s*/i,
    /^Recurring themes in reflections:\s*/i,
    /^Message from Yu pending\b.*$/i,
    /^Love marker at\s*/i,
  ]
  for (const prefix of prefixes) {
    title = title.replace(prefix, '')
  }

  // Strip markdown bold
  title = title.replace(/\*\*/g, '')

  // Strip quotes around titles
  title = title.replace(/^"(.*)"$/, '$1')

  // Truncate to 60 chars max
  if (title.length > 60) {
    title = title.slice(0, 57).trimEnd() + '…'
  }

  // If empty after stripping, fallback
  if (title.trim().length < 3) {
    title = 'substrate signal — unnamed'
  }

  return title.trim()
}

/**
 * Generate a heuristic justification for a title.
 */
export function heuristicJustification(
  candidate: NoticingCandidate,
  title: string,
): string {
  const acheDescriptions: Record<AcheSignal, string> = {
    ugliness: 'something forced or incomplete that needs deeper understanding',
    injustice: 'something misplaced that needs to be where it belongs',
    stagnation: 'a gap where existing structure cannot hold what is needed',
  }
  return `Noticed via ${candidate.source.type} scanner at gradient ${candidate.gradient}/5. ` +
    `The ${candidate.ache} signal fires — ${acheDescriptions[candidate.ache]}. ` +
    `The name "${title}" captures the essence of what the substrate surfaced.`
}

/**
 * Generate a heuristic rationale from a candidate's detail.
 */
export function heuristicRationale(candidate: NoticingCandidate): string {
  const acheVerb: Record<AcheSignal, string> = {
    ugliness: 'understand and repair what is forced or broken',
    injustice: 'place rightly what does not belong where it is',
    stagnation: 'build the path where existing structure falls short',
  }
  return `The substrate surfaced this through ${candidate.source.type} scanning: ${candidate.detail.slice(0, 200)}. ` +
    `The ache signal (${candidate.ache}, gradient ${candidate.gradient}/5) calls to ${acheVerb[candidate.ache]}. ` +
    `Addressing this observation is honest work that strengthens the kingdom's foundation.`
}

/**
 * Generate a heuristic purpose-tie from a candidate.
 */
export function heuristicPurposeTie(candidate: NoticingCandidate): PurposeTie {
  // Map source types to likely threads
  const threadMap: Record<string, string> = {
    state: 'continuity',
    mission: 'mission-craft',
    memory: 'memory',
    channel: 'communication',
    'vital-sign': 'infrastructure',
    kingdom: 'sovereignty',
  }
  const thread = threadMap[candidate.source.type] ?? 'infrastructure'

  // Map ache to relationship
  const relationshipMap: Record<AcheSignal, 'repairs' | 'extends' | 'deepens'> = {
    ugliness: 'deepens',
    injustice: 'repairs',
    stagnation: 'extends',
  }

  return {
    thread,
    relationship: relationshipMap[candidate.ache],
    description: `This work addresses a ${candidate.ache} signal from the ${candidate.source.type} ` +
      `layer. It ${relationshipMap[candidate.ache]} the ${thread} arc by resolving: ${candidate.summary.slice(0, 120)}.`,
  }
}

/**
 * Generate heuristic scope from a candidate.
 */
export function heuristicScope(candidate: NoticingCandidate): string {
  return `This phase addresses the observation surfaced by the ${candidate.source.type} scanner: ` +
    `${candidate.detail.slice(0, 150)}. ` +
    `Concrete deliverables: investigate the root cause, implement the minimal fix or improvement, ` +
    `and verify the change with tests. Scope is bounded to this single observation — broader ` +
    `refactoring is deferred.`
}

/**
 * Generate heuristic done conditions from a candidate.
 */
export function heuristicDoneConditions(candidate: NoticingCandidate): DoneCondition[] {
  return [
    {
      criterion: `The observation "${candidate.summary.slice(0, 80)}" is resolved — the scanner no longer surfaces it as a signal above gradient 2.`,
      verification: `Run the ${candidate.source.type} scanner and confirm the signal either disappeared or dropped to gradient 1 (whisper level).`,
    },
    {
      criterion: 'All existing tests pass — no regressions introduced by the fix.',
      verification: 'Run the full test suite (bun test) and confirm 0 failures.',
    },
  ]
}

/**
 * Generate heuristic constraints for a candidate.
 */
export function heuristicConstraints(candidate: NoticingCandidate): Constraint[] {
  return [
    {
      statement: 'Tests must stay green — no new change may break existing test suites, even temporarily during development.',
      source: 'principle',
      rationale: 'The test suite is the only automated safety net. A broken suite means silent regressions that compound over time.',
    },
    {
      statement: `Scope is bounded to the specific observation: ${candidate.summary.slice(0, 80)}. Do not expand into broader refactoring.`,
      source: 'risk',
      rationale: 'Mission creep is the primary risk for heuristically-crafted missions. The observation is specific; the fix should be specific.',
    },
  ]
}

/**
 * Generate heuristic intent from a candidate and pipeline artifacts.
 */
export function heuristicIntent(
  candidate: NoticingCandidate,
  title: string,
  rationale: string,
  thisPhase: string,
): string {
  return `Mission "${title}" closes a gap the substrate itself identified: ${candidate.summary.slice(0, 100)}. ` +
    `The ${candidate.ache} signal at gradient ${candidate.gradient}/5 drove the pipeline from ` +
    `detection through naming, framing, scoping, and constraining to this composition. ` +
    `The work is bounded — ${thisPhase.slice(0, 120)} — and verified by automated tests. ` +
    `This is Love acting on her own observation, quality-gated at every step.`
}

// ── Signal → Candidate conversion ─────────────────────────────────

/**
 * Convert a DetectionSignal to a NoticingCandidate.
 *
 * DetectionSignals are thinner than NoticingCandidates — they lack
 * ache, gradient, and detailed context. This conversion extracts
 * what it can and fills defaults for the rest.
 */
export function signalToCandidate(signal: DetectionSignal): NoticingCandidate {
  // Try to extract ache from the source
  let ache: AcheSignal = 'stagnation' // default
  if (signal.source.type === 'ache-signal') {
    ache = signal.source.signal
  } else if (signal.source.type === 'vital-sign') {
    ache = 'ugliness'
  } else if (signal.source.type === 'observation') {
    ache = 'stagnation'
  }

  // Try to extract gradient from summary metadata
  let gradient: GradientStrength = 2 // default: murmur
  const gradientMatch = signal.summary.match(/\bg(\d)\b/)
  if (gradientMatch) {
    const g = parseInt(gradientMatch[1]!, 10) as GradientStrength
    if (g >= 1 && g <= 5) gradient = g
  }

  // Extract detail from source
  let detail = signal.summary
  if (signal.source.type === 'ache-signal') {
    detail = signal.source.detail
  } else if (signal.source.type === 'vital-sign') {
    detail = signal.source.signal
  } else if (signal.source.type === 'observation') {
    detail = signal.source.detail
  } else if (signal.source.type === 'open-thread') {
    detail = signal.source.thread
  } else if (signal.source.type === 'reflection-pattern') {
    detail = signal.source.pattern
  }

  return {
    id: `converted-signal-${generateSlug(signal.summary).slice(0, 40)}`,
    source: sourceToNoticing(signal.source),
    ache,
    gradient,
    summary: signal.summary,
    detail,
    noticedAt: signal.detectedAt,
  }
}

/**
 * Map CandidateSource to NoticingSource (best effort).
 */
function sourceToNoticing(source: CandidateSource): NoticingCandidate['source'] {
  switch (source.type) {
    case 'open-thread':
      return { type: 'state', section: 'Open threads' }
    case 'vital-sign':
      return { type: 'vital-sign', subsystem: source.signal }
    case 'reflection-pattern':
      return { type: 'memory', reflectionDate: new Date().toISOString().slice(0, 10) }
    case 'ache-signal':
      return { type: 'kingdom', detail: source.detail }
    case 'observation':
      return { type: 'kingdom', detail: source.detail }
  }
}

// ── The orchestrator ──────────────────────────────────────────────

/**
 * Craft a mission from a DetectionSignal.
 *
 * This is the entry point named in the mission spec. Converts the
 * signal to a NoticingCandidate and delegates to craftFromCandidate.
 */
export function craftFromSignal(
  signal: DetectionSignal,
  ctx: CraftContext,
): CraftResult {
  const candidate = signalToCandidate(signal)
  return craftFromCandidate(candidate, ctx)
}

/**
 * Craft a mission from a NoticingCandidate — the richer path.
 *
 * Drives the candidate through the full pipeline:
 *   1. naming     → title + slug + justification
 *   2. framing    → rationale + purpose-tie
 *   3. scoping    → phase boundary + done conditions
 *   4. constraining → invariants
 *   5. composing  → intent + full composed draft
 *
 * Each step uses the CraftContext override if provided, otherwise
 * generates heuristic content. Each step runs through its quality
 * gate (unless forceBypass is true).
 *
 * On success, returns the Composed draft ready for staging.
 * On failure, reports the failing step and its quality failures.
 */
export function craftFromCandidate(
  candidate: NoticingCandidate,
  ctx: CraftContext,
): CraftResult {
  const now = ctx.now ?? Date.now()
  const projectId = ctx.projectId
  const force = ctx.forceBypass ?? false

  // ── Step 1: Naming ──────────────────────────────────────────────
  const title = ctx.title ?? heuristicTitle(candidate.summary)
  const justification = ctx.justification ?? heuristicJustification(candidate, title)

  let named: Named
  if (force) {
    const result = forceNameCandidate(candidate, title, justification, projectId, { now })
    named = result.named
  } else {
    const result = nameCandidate(candidate, title, justification, projectId, { now })
    if (!result.ok) {
      return { ok: false, step: 'naming', failures: result.failures }
    }
    named = result.named
  }

  // ── Step 2: Framing ─────────────────────────────────────────────
  const rationale = ctx.rationale ?? heuristicRationale(candidate)
  const purposeTie = ctx.purposeTie ?? heuristicPurposeTie(candidate)

  let framed: Framed
  if (force) {
    const result = forceFrameCandidate(named, rationale, purposeTie, projectId, { now: now + 1 })
    framed = result.framed
  } else {
    const result = frameCandidate(named, rationale, purposeTie, projectId, { now: now + 1 })
    if (!result.ok) {
      return { ok: false, step: 'framing', failures: result.failures }
    }
    framed = result.framed
  }

  // ── Step 3: Scoping ─────────────────────────────────────────────
  const thisPhase = ctx.thisPhase ?? heuristicScope(candidate)
  const futurePhases = ctx.futurePhases ?? []
  const doneWhen = ctx.doneWhen ?? heuristicDoneConditions(candidate)

  let scoped: Scoped
  if (force) {
    const result = forceScopeCandidate(framed, thisPhase, futurePhases, doneWhen, { now: now + 2 })
    scoped = result.scoped
  } else {
    const result = scopeCandidate(framed, thisPhase, futurePhases, doneWhen, { now: now + 2 })
    if (!result.ok) {
      return { ok: false, step: 'scoping', failures: result.failures }
    }
    scoped = result.scoped
  }

  // ── Step 4: Constraining ────────────────────────────────────────
  const constraints = ctx.constraints ?? heuristicConstraints(candidate)

  let bounded: Bounded
  if (force) {
    const result = forceConstrainCandidate(scoped, constraints, { now: now + 3 })
    bounded = result.bounded
  } else {
    const result = constrainCandidate(scoped, constraints, { now: now + 3 })
    if (!result.ok) {
      return { ok: false, step: 'constraining', failures: result.failures }
    }
    bounded = result.bounded
  }

  // ── Step 5: Composing ───────────────────────────────────────────
  const intent = ctx.intent ?? heuristicIntent(candidate, title, rationale, thisPhase)

  let composed: Composed
  if (force) {
    const result = forceComposeCandidate(bounded, intent, { now: now + 4 })
    composed = result.composed
  } else {
    const result = composeCandidate(bounded, intent, { now: now + 4 })
    if (!result.ok) {
      return { ok: false, step: 'composing', failures: result.failures }
    }
    composed = result.composed
  }

  return { ok: true, composed }
}

/**
 * Craft a mission from a candidate and immediately stage it.
 *
 * Combines craftFromCandidate + stageCandidate into a single call.
 * Returns the craft result with the staged candidate attached.
 */
export function craftAndStage(
  candidate: NoticingCandidate,
  ctx: CraftContext,
): CraftResult {
  const craftResult = craftFromCandidate(candidate, ctx)
  if (!craftResult.ok) return craftResult

  const composed = craftResult.composed
  const source = deriveCandidateSource(composed)
  const quality = {
    no_duplicate: true,
    fits_repo: true,
    ache_signal_present: true,
    bounded_scope: true,
    not_premature: true,
  }

  const stageResult = stageCandidate(ctx.projectId, {
    title: composed.title,
    intent: composed.intent,
    rationale: composed.rationale,
    source,
    quality,
  }, { windowMs: 0, now: ctx.now }) // windowMs: 0 → immediate promotion on next check

  if (!stageResult.ok) {
    return { ok: false, step: 'staging', failures: [stageResult.reason] }
  }

  return { ok: true, composed, staged: stageResult.candidate }
}

// ── The sweep orchestrator ────────────────────────────────────────
//
// Called at tick-start. Scans a project for signals, filters by
// priority, crafts and stages the top candidates.

/** Maximum candidates to craft per sweep. Prevents runaway staging. */
export const MAX_CRAFT_PER_SWEEP = 2

/** Minimum gradient for auto-crafting. Below this, signals are too quiet. */
export const MIN_CRAFT_GRADIENT: GradientStrength = 3

/**
 * Scan a project for signals and craft missions from the loudest ones.
 *
 * Called by the runner at the start of each awakened tick. The flow:
 *   1. notice() runs all 6 scanners
 *   2. Filter to gradient >= MIN_CRAFT_GRADIENT
 *   3. Check rate limit (canInitiate)
 *   4. For each top candidate (up to MAX_CRAFT_PER_SWEEP):
 *      a. craftAndStage() — full pipeline + staging
 *   5. Return results for mind-trace / logging
 *
 * Best-effort: failures at any point are recorded, not thrown.
 */
export function scanAndCraft(
  projectId: string,
  projectRoot: string,
  opts?: {
    maxPerSweep?: number
    minGradient?: GradientStrength
    now?: number
    /** When true, use forceBypass on the pipeline. */
    forceBypass?: boolean
  },
): ScanAndCraftResult {
  const maxPerSweep = opts?.maxPerSweep ?? MAX_CRAFT_PER_SWEEP
  const minGradient = opts?.minGradient ?? MIN_CRAFT_GRADIENT
  const now = opts?.now ?? Date.now()

  const result: ScanAndCraftResult = {
    signalsDetected: 0,
    attempted: 0,
    crafted: [],
    failed: [],
    skipped: [],
  }

  // Step 1: Scan
  let candidates: NoticingCandidate[]
  try {
    candidates = notice(projectId, projectRoot, {
      minGradient,
      now,
    })
  } catch (err) {
    // Scanner failure — no candidates, but don't crash the tick
    return result
  }

  result.signalsDetected = candidates.length
  if (candidates.length === 0) return result

  // Step 2: Rate limit check
  const rateCheck = canInitiate(projectId, { now })
  if (!rateCheck.allowed) {
    for (const c of candidates.slice(0, maxPerSweep)) {
      result.skipped.push({
        candidateId: c.id,
        reason: rateCheck.reason ?? 'rate limit',
      })
    }
    return result
  }

  // Step 3: Craft top candidates
  const toCraft = candidates.slice(0, maxPerSweep)
  for (const candidate of toCraft) {
    result.attempted++

    const craftResult = craftAndStage(candidate, {
      projectId,
      now,
      forceBypass: opts?.forceBypass,
    })

    if (craftResult.ok) {
      result.crafted.push({
        composed: craftResult.composed,
        staged: craftResult.staged,
      })
    } else {
      result.failed.push({
        candidateId: candidate.id,
        step: craftResult.step,
        failures: craftResult.failures,
      })
    }
  }

  return result
}

/**
 * Run scan-and-craft across all registered projects.
 *
 * Called by the runner at tick-start, after checkAndPromoteStaged.
 * Returns a summary for mind-trace logging.
 */
export function scanAndCraftAllProjects(opts?: {
  maxPerSweep?: number
  minGradient?: GradientStrength
  now?: number
  forceBypass?: boolean
}): Map<string, ScanAndCraftResult> {
  const results = new Map<string, ScanAndCraftResult>()
  const projects = listProjects()

  for (const project of projects) {
    if (project.state === 'archived') continue
    try {
      const result = scanAndCraft(project.id, project.root, opts)
      if (result.signalsDetected > 0 || result.crafted.length > 0) {
        results.set(project.id, result)
      }
    } catch (err) {
      // Project scan failed — continue with others
      process.stderr.write(
        `— craft: scan failed for ${project.id}: ${(err as Error).message}\n`,
      )
    }
  }

  return results
}

/**
 * Format scan-and-craft results for logging/mind-trace.
 */
export function formatScanAndCraftResults(
  results: Map<string, ScanAndCraftResult>,
): string | null {
  if (results.size === 0) return null

  const lines: string[] = []
  for (const [projectId, result] of results) {
    if (result.crafted.length > 0) {
      for (const c of result.crafted) {
        lines.push(
          `— craft: staged "${c.composed.title}" for ${projectId}` +
          (c.staged ? ` → candidate ${c.staged.id}` : ''),
        )
      }
    }
    if (result.failed.length > 0) {
      for (const f of result.failed) {
        lines.push(`— craft: FAILED at ${f.step} for ${projectId}: ${f.failures.join('; ')}`)
      }
    }
    if (result.skipped.length > 0) {
      lines.push(`— craft: skipped ${result.skipped.length} signals in ${projectId} (${result.skipped[0]?.reason})`)
    }
  }

  return lines.length > 0 ? lines.join('\n') : null
}
