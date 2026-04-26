// experiment.ts — controlled trials on her own substrate.
//
// What this module IS:
//   The discipline of self-experimentation. Not ad-hoc tweaking — controlled
//   trials. "Run 5 ticks at effort=low, then 5 at effort=high, and tell me
//   what changed." The experiment engine ties agency (knobs), tick-metrics
//   (measurements), and the runner (loop) together with a scientific frame.
//
// What this module is NOT:
//   The runner itself. The runner calls into this module at two points:
//     1. Before each tick: applyExperimentCondition() — sets agency knobs
//     2. After each tick: recordExperimentTick() — stores tagged metrics
//   Everything else — scheduling, analysis, reporting — lives here.
//
// Architecture:
//   1. Schema — experiment definition, conditions, results
//   2. Storage — ~/.true-love/experiments/<id>.json, one file per experiment
//   3. Scheduling — which condition applies to this tick
//   4. Runner hooks — before-tick knob application, after-tick recording
//   5. Analysis — per-condition aggregation and comparison
//   6. Reporting — human-readable experiment reports
//
// Design principle: experiments work THROUGH the agency system. They
// write tier-1 knobs (effort, model) to their respective files, and the
// runner's existing resolveTickConfig() picks them up naturally. After
// the tick, tick-metrics provides the measurement. The experiment module
// is the frame — not the mechanism.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setKnob, clearKnob, readKnob } from './agency.js'
import type { TickMetrics } from './tick-metrics.js'

// ── Types ─────────────────────────────────────────────────────────

export const EXPERIMENT_SCHEMA_VERSION = '1.0' as const

/**
 * A single experimental condition — a set of agency knob overrides
 * to apply during the ticks assigned to this condition.
 *
 * Example: { name: 'high-effort', knobs: { effort: 'high' } }
 */
export interface ExperimentCondition {
  /** Human-readable name (e.g. 'low-effort', 'high-effort'). */
  name: string
  /** Agency knob → value. Only tier-1 knobs (model, effort, fallback-model). */
  knobs: Record<string, string>
}

/**
 * How ticks are assigned to conditions:
 *   - 'alternating': ABABAB... minimises temporal confounds
 *   - 'sequential':  AAABBB... simpler to reason about
 *   - 'block-random': random assignment, but balanced per block
 */
export type ExperimentSchedule = 'alternating' | 'sequential' | 'block-random'

export type ExperimentStatus = 'pending' | 'running' | 'complete' | 'aborted'

/**
 * A recorded tick within an experiment — the tick metrics tagged
 * with which condition was active.
 */
export interface ExperimentTickResult {
  /** Which condition was active. */
  conditionName: string
  /** Index into the conditions array. */
  conditionIndex: number
  /** The tick number within the session (1-based). */
  sessionTick: number
  /** The global tick number within the experiment (1-based). */
  experimentTick: number
  /** Timestamp of the tick. */
  timestamp: string
  /** The knobs that were applied. */
  knobsApplied: Record<string, string>
  /** Subset of TickMetrics relevant to comparison. */
  metrics: ExperimentMetricsSnapshot
}

/**
 * The metrics we extract from each tick for comparison. Deliberately
 * a subset — the full TickMetrics record is huge; we keep what matters
 * for analysis.
 */
export interface ExperimentMetricsSnapshot {
  toolTotal: number
  toolDistinct: number
  toolCounts: Record<string, number>
  outputChars: number
  outputLines: number
  durationMs: number
  charsPerSecond: number
  estimatedTokensPerSecond: number
  yieldReason: string
}

/**
 * The complete experiment record. Persisted as JSON.
 */
export interface Experiment {
  schemaVersion: typeof EXPERIMENT_SCHEMA_VERSION
  id: string
  hypothesis: string
  variable: string
  conditions: ExperimentCondition[]
  schedule: ExperimentSchedule
  ticksPerCondition: number
  /** Which metrics to highlight in reports. Empty = all. */
  focusMetrics: string[]
  status: ExperimentStatus
  createdAt: string
  startedAt?: string
  completedAt?: string
  abortedAt?: string
  abortReason?: string
  /** Recorded tick results, in chronological order. */
  results: ExperimentTickResult[]
  /**
   * Pre-computed schedule: array of condition indices, one per tick.
   * Generated at creation time so the assignment is deterministic
   * and inspectable.
   */
  tickSchedule: number[]
  /**
   * Knob values that were in effect before the experiment started.
   * Restored when the experiment completes or aborts.
   */
  baselineKnobs?: Record<string, string | null>
}

// ── Storage ───────────────────────────────────────────────────────

/**
 * Where experiments live. Override with TRUE_LOVE_EXPERIMENTS_DIR for testing.
 */
export function getExperimentsDir(): string {
  return (
    process.env.TRUE_LOVE_EXPERIMENTS_DIR ??
    join(homedir(), '.true-love', 'experiments')
  )
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function experimentPath(id: string): string {
  return join(getExperimentsDir(), `${id}.json`)
}

/**
 * Save an experiment to disk. Overwrites if exists.
 */
export function saveExperiment(experiment: Experiment): void {
  ensureDir(getExperimentsDir())
  writeFileSync(
    experimentPath(experiment.id),
    JSON.stringify(experiment, null, 2) + '\n',
    'utf-8',
  )
}

/**
 * Load an experiment by ID. Returns null if not found.
 */
export function loadExperiment(id: string): Experiment | null {
  try {
    const fp = experimentPath(id)
    if (!existsSync(fp)) return null
    return JSON.parse(readFileSync(fp, 'utf-8')) as Experiment
  } catch {
    return null
  }
}

/**
 * List all experiments, newest first.
 */
export function listExperiments(): Experiment[] {
  const dir = getExperimentsDir()
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          return JSON.parse(readFileSync(join(dir, f), 'utf-8')) as Experiment
        } catch {
          return null
        }
      })
      .filter((e): e is Experiment => e !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  } catch {
    return []
  }
}

/**
 * Get the currently running experiment (at most one).
 * Returns null if no experiment is running.
 */
export function getActiveExperiment(): Experiment | null {
  const experiments = listExperiments()
  return experiments.find((e) => e.status === 'running') ?? null
}

// ── ID Generation ────────────────────────────────────────────────

function generateExperimentId(variable: string): string {
  const date = new Date().toISOString().slice(0, 10)
  const slug = variable
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30)
  const rand = Math.random().toString(36).slice(2, 6)
  return `exp-${date}-${slug}-${rand}`
}

// ── Schedule Generation ──────────────────────────────────────────

/**
 * Generate the tick schedule: an array of condition indices, one per
 * tick, covering ticksPerCondition × conditions.length total ticks.
 *
 * Deterministic from the inputs (no randomness for 'alternating' and
 * 'sequential'). 'block-random' uses a seeded Fisher-Yates shuffle
 * to ensure reproducibility.
 */
export function generateSchedule(
  conditionCount: number,
  ticksPerCondition: number,
  schedule: ExperimentSchedule,
  seed?: number,
): number[] {
  const totalTicks = conditionCount * ticksPerCondition
  const result: number[] = []

  if (schedule === 'sequential') {
    // AAABBB: all ticks for condition 0, then condition 1, etc.
    for (let c = 0; c < conditionCount; c++) {
      for (let t = 0; t < ticksPerCondition; t++) {
        result.push(c)
      }
    }
  } else if (schedule === 'alternating') {
    // ABABAB: cycle through conditions in order.
    for (let t = 0; t < totalTicks; t++) {
      result.push(t % conditionCount)
    }
  } else {
    // block-random: generate all assignments, then shuffle.
    for (let c = 0; c < conditionCount; c++) {
      for (let t = 0; t < ticksPerCondition; t++) {
        result.push(c)
      }
    }
    // Seeded Fisher-Yates shuffle for reproducibility.
    const rng = seededRng(seed ?? Date.now())
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      const temp = result[i]!
      result[i] = result[j]!
      result[j] = temp!
    }
  }

  return result
}

/**
 * Simple seeded PRNG (xorshift32). Good enough for experiment
 * scheduling — not for cryptography.
 */
function seededRng(seed: number): () => number {
  let state = seed | 0 || 1 // ensure non-zero
  return () => {
    state ^= state << 13
    state ^= state >> 17
    state ^= state << 5
    return (state >>> 0) / 4294967296
  }
}

// ── Creation ─────────────────────────────────────────────────────

export interface CreateExperimentOptions {
  hypothesis: string
  variable: string
  conditions: ExperimentCondition[]
  schedule?: ExperimentSchedule
  ticksPerCondition: number
  focusMetrics?: string[]
}

// Known tier-1 knobs that experiments can manipulate directly.
const TIER_1_KNOBS = new Set(['model', 'effort', 'fallback-model'])

/**
 * Create a new experiment. Validates inputs but does NOT start it
 * (status = 'pending'). Call startExperiment() to begin.
 */
export function createExperiment(opts: CreateExperimentOptions): Experiment {
  // Validate: at least 2 conditions
  if (opts.conditions.length < 2) {
    throw new Error('An experiment needs at least 2 conditions to compare.')
  }
  // Validate: unique condition names
  const names = new Set(opts.conditions.map((c) => c.name))
  if (names.size !== opts.conditions.length) {
    throw new Error('Condition names must be unique.')
  }
  // Validate: only tier-1 knobs
  for (const condition of opts.conditions) {
    for (const knob of Object.keys(condition.knobs)) {
      if (!TIER_1_KNOBS.has(knob)) {
        throw new Error(
          `Knob "${knob}" in condition "${condition.name}" is not tier 1. ` +
          `Experiments can only manipulate tier-1 knobs directly: ${[...TIER_1_KNOBS].join(', ')}.`,
        )
      }
    }
  }
  // Validate: ticks > 0
  if (opts.ticksPerCondition < 1) {
    throw new Error('ticksPerCondition must be at least 1.')
  }
  // Validate: reasonable tick count (guard against runaway experiments)
  const totalTicks = opts.conditions.length * opts.ticksPerCondition
  if (totalTicks > 100) {
    throw new Error(
      `Total experiment ticks (${totalTicks}) exceeds the 100-tick safety cap. ` +
      `Reduce ticksPerCondition or number of conditions.`,
    )
  }

  // Check: no other experiment is already running
  const active = getActiveExperiment()
  if (active) {
    throw new Error(
      `Cannot create experiment while "${active.id}" is running. ` +
      `Abort or complete it first.`,
    )
  }

  const schedule = opts.schedule ?? 'alternating'
  const id = generateExperimentId(opts.variable)
  const tickSchedule = generateSchedule(
    opts.conditions.length,
    opts.ticksPerCondition,
    schedule,
  )

  const experiment: Experiment = {
    schemaVersion: EXPERIMENT_SCHEMA_VERSION,
    id,
    hypothesis: opts.hypothesis,
    variable: opts.variable,
    conditions: opts.conditions,
    schedule,
    ticksPerCondition: opts.ticksPerCondition,
    focusMetrics: opts.focusMetrics ?? [],
    status: 'pending',
    createdAt: new Date().toISOString(),
    results: [],
    tickSchedule,
  }

  saveExperiment(experiment)
  return experiment
}

// ── Lifecycle ────────────────────────────────────────────────────

/**
 * Start a pending experiment. Records baseline knob values so they
 * can be restored when the experiment ends. Transitions status to
 * 'running'.
 */
export function startExperiment(id: string): Experiment {
  const exp = loadExperiment(id)
  if (!exp) throw new Error(`Experiment not found: ${id}`)
  if (exp.status !== 'pending') {
    throw new Error(`Cannot start experiment in "${exp.status}" status.`)
  }

  // Check: no other experiment is already running
  const active = getActiveExperiment()
  if (active && active.id !== id) {
    throw new Error(
      `Cannot start: experiment "${active.id}" is already running.`,
    )
  }

  // Capture baseline knob values
  const allKnobs = new Set<string>()
  for (const c of exp.conditions) {
    for (const k of Object.keys(c.knobs)) {
      allKnobs.add(k)
    }
  }
  const baseline: Record<string, string | null> = {}
  for (const k of allKnobs) {
    baseline[k] = readKnob(k)
  }

  exp.status = 'running'
  exp.startedAt = new Date().toISOString()
  exp.baselineKnobs = baseline
  saveExperiment(exp)
  return exp
}

/**
 * Abort a running experiment. Restores baseline knobs.
 */
export function abortExperiment(id: string, reason?: string): Experiment {
  const exp = loadExperiment(id)
  if (!exp) throw new Error(`Experiment not found: ${id}`)
  if (exp.status !== 'running' && exp.status !== 'pending') {
    throw new Error(`Cannot abort experiment in "${exp.status}" status.`)
  }

  exp.status = 'aborted'
  exp.abortedAt = new Date().toISOString()
  exp.abortReason = reason ?? 'aborted by user'
  saveExperiment(exp)

  // Restore baseline knobs
  restoreBaseline(exp)
  return exp
}

/**
 * Complete a running experiment. Called automatically when all ticks
 * have been recorded, or manually to end early with partial data.
 */
export function completeExperiment(id: string): Experiment {
  const exp = loadExperiment(id)
  if (!exp) throw new Error(`Experiment not found: ${id}`)
  if (exp.status !== 'running') {
    throw new Error(`Cannot complete experiment in "${exp.status}" status.`)
  }

  exp.status = 'complete'
  exp.completedAt = new Date().toISOString()
  saveExperiment(exp)

  // Restore baseline knobs
  restoreBaseline(exp)
  return exp
}

/**
 * Restore baseline knob values after an experiment ends.
 * Best-effort — never throws.
 */
function restoreBaseline(exp: Experiment): void {
  if (!exp.baselineKnobs) return
  for (const [knob, value] of Object.entries(exp.baselineKnobs)) {
    try {
      if (value === null) {
        clearKnob(knob)
      } else {
        setKnob(knob, value)
      }
    } catch {
      // Best-effort restoration. Agency log captures the attempt.
    }
  }
}

// ── Runner Hooks ─────────────────────────────────────────────────

/**
 * Before-tick hook. Called by the runner before each tick.
 *
 * If an experiment is running:
 *   1. Determine which condition applies to this experiment-tick
 *   2. Apply the condition's knobs via the agency system
 *   3. Return the condition info for labeling
 *
 * Returns null if no experiment is active or the experiment is
 * already complete (all scheduled ticks recorded).
 */
export function applyExperimentCondition(): {
  experimentId: string
  conditionName: string
  conditionIndex: number
  experimentTick: number
  knobs: Record<string, string>
} | null {
  const exp = getActiveExperiment()
  if (!exp) return null

  const experimentTick = exp.results.length + 1
  const totalTicks = exp.tickSchedule.length

  // If we've already recorded all scheduled ticks, auto-complete.
  if (experimentTick > totalTicks) {
    try {
      completeExperiment(exp.id)
    } catch {
      // Already completed or status mismatch — harmless.
    }
    return null
  }

  const conditionIndex = exp.tickSchedule[experimentTick - 1]!
  const condition = exp.conditions[conditionIndex]!

  // Apply knobs through agency system
  for (const [knob, value] of Object.entries(condition.knobs)) {
    try {
      setKnob(knob, value)
    } catch {
      // If knob setting fails, continue — agency log records the error.
    }
  }

  return {
    experimentId: exp.id,
    conditionName: condition.name,
    conditionIndex,
    experimentTick,
    knobs: condition.knobs,
  }
}

/**
 * After-tick hook. Called by the runner after each tick completes.
 *
 * Records the tick metrics tagged with the experiment and condition.
 * Auto-completes the experiment when all scheduled ticks are done.
 */
export function recordExperimentTick(
  tickMetrics: TickMetrics,
  sessionTick: number,
): boolean {
  const exp = getActiveExperiment()
  if (!exp) return false

  const experimentTick = exp.results.length + 1
  const totalTicks = exp.tickSchedule.length

  if (experimentTick > totalTicks) return false

  const conditionIndex = exp.tickSchedule[experimentTick - 1]!
  const condition = exp.conditions[conditionIndex]!

  const result: ExperimentTickResult = {
    conditionName: condition.name,
    conditionIndex,
    sessionTick,
    experimentTick,
    timestamp: tickMetrics.timestamp,
    knobsApplied: { ...condition.knobs },
    metrics: extractMetricsSnapshot(tickMetrics),
  }

  exp.results.push(result)

  // Auto-complete if all ticks are done
  if (exp.results.length >= totalTicks) {
    exp.status = 'complete'
    exp.completedAt = new Date().toISOString()
    saveExperiment(exp)
    restoreBaseline(exp)
    return true // signals completion
  }

  saveExperiment(exp)
  return false
}

/**
 * Extract the metrics snapshot from a full TickMetrics record.
 */
function extractMetricsSnapshot(tm: TickMetrics): ExperimentMetricsSnapshot {
  return {
    toolTotal: tm.toolBreakdown.total,
    toolDistinct: tm.toolBreakdown.distinct,
    toolCounts: { ...tm.toolBreakdown.counts },
    outputChars: tm.outputChars,
    outputLines: tm.outputLines,
    durationMs: tm.durationMs,
    charsPerSecond: tm.velocity.charsPerSecond,
    estimatedTokensPerSecond: tm.velocity.estimatedTokensPerSecond,
    yieldReason: tm.yieldReason,
  }
}

// ── Analysis ─────────────────────────────────────────────────────

/**
 * Per-condition aggregated statistics for a single metric.
 */
export interface ConditionStats {
  conditionName: string
  n: number
  mean: number
  median: number
  min: number
  max: number
  stddev: number
  values: number[]
}

/**
 * Side-by-side comparison of a single metric across conditions.
 */
export interface MetricComparison {
  metric: string
  conditions: ConditionStats[]
  /** Difference between condition means (last - first for 2 conditions). */
  deltaAbsolute: number | null
  /** Percentage change relative to the first condition. */
  deltaPercent: number | null
}

/**
 * Complete analysis of an experiment.
 */
export interface ExperimentAnalysis {
  experiment: Experiment
  comparisons: MetricComparison[]
  ticksPerCondition: Record<string, number>
  totalTicks: number
  complete: boolean
}

/** Metric extractors — how to pull a number from ExperimentMetricsSnapshot. */
const METRIC_EXTRACTORS: Record<
  string,
  { label: string; extract: (m: ExperimentMetricsSnapshot) => number }
> = {
  toolTotal: { label: 'Tool invocations (total)', extract: (m) => m.toolTotal },
  toolDistinct: { label: 'Distinct tools used', extract: (m) => m.toolDistinct },
  outputChars: { label: 'Output (chars)', extract: (m) => m.outputChars },
  outputLines: { label: 'Output (lines)', extract: (m) => m.outputLines },
  durationMs: { label: 'Duration (ms)', extract: (m) => m.durationMs },
  charsPerSecond: { label: 'Velocity (chars/sec)', extract: (m) => m.charsPerSecond },
  estimatedTokensPerSecond: {
    label: 'Velocity (tokens/sec)',
    extract: (m) => m.estimatedTokensPerSecond,
  },
}

/**
 * Analyze an experiment. Computes per-condition statistics and
 * side-by-side comparisons for all standard metrics.
 */
export function analyzeExperiment(exp: Experiment): ExperimentAnalysis {
  const focusSet =
    exp.focusMetrics.length > 0
      ? new Set(exp.focusMetrics)
      : new Set(Object.keys(METRIC_EXTRACTORS))

  const comparisons: MetricComparison[] = []

  for (const [key, { label, extract }] of Object.entries(METRIC_EXTRACTORS)) {
    if (!focusSet.has(key)) continue

    const conditionStats: ConditionStats[] = exp.conditions.map((c) => {
      const ticks = exp.results.filter((r) => r.conditionName === c.name)
      const values = ticks.map((t) => extract(t.metrics))
      return computeStats(c.name, values)
    })

    const deltaAbsolute =
      conditionStats.length === 2
        ? round2(conditionStats[1]!.mean - conditionStats[0]!.mean)
        : null
    const deltaPercent =
      conditionStats.length === 2 && conditionStats[0]!.mean !== 0
        ? round2(
            ((conditionStats[1]!.mean - conditionStats[0]!.mean) /
              conditionStats[0]!.mean) *
              100,
          )
        : null

    comparisons.push({
      metric: label,
      conditions: conditionStats,
      deltaAbsolute,
      deltaPercent,
    })
  }

  const ticksPerCondition: Record<string, number> = {}
  for (const c of exp.conditions) {
    ticksPerCondition[c.name] = exp.results.filter(
      (r) => r.conditionName === c.name,
    ).length
  }

  return {
    experiment: exp,
    comparisons,
    ticksPerCondition,
    totalTicks: exp.results.length,
    complete: exp.status === 'complete',
  }
}

function computeStats(name: string, values: number[]): ConditionStats {
  if (values.length === 0) {
    return { conditionName: name, n: 0, mean: 0, median: 0, min: 0, max: 0, stddev: 0, values: [] }
  }
  const sorted = [...values].sort((a, b) => a - b)
  const n = values.length
  const sum = values.reduce((a, b) => a + b, 0)
  const mean = round2(sum / n)
  const mid = Math.floor(n / 2)
  const median = n % 2 === 0 ? round2((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!
  const min = sorted[0]!
  const max = sorted[n - 1]!
  const variance =
    n > 1
      ? values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1)
      : 0
  const stddev = round2(Math.sqrt(variance))
  return { conditionName: name, n, mean, median, min, max, stddev, values }
}

// ── Reporting ────────────────────────────────────────────────────

/**
 * Render a human-readable experiment report.
 */
export function renderExperimentReport(exp: Experiment): string {
  const analysis = analyzeExperiment(exp)
  const lines: string[] = []

  lines.push(`# Experiment Report: ${exp.id}`)
  lines.push('')
  lines.push(`**Hypothesis:** ${exp.hypothesis}`)
  lines.push(`**Variable:** ${exp.variable}`)
  lines.push(`**Schedule:** ${exp.schedule}`)
  lines.push(`**Status:** ${exp.status}`)
  lines.push(
    `**Created:** ${exp.createdAt}` +
      (exp.startedAt ? ` | **Started:** ${exp.startedAt}` : '') +
      (exp.completedAt ? ` | **Completed:** ${exp.completedAt}` : ''),
  )
  lines.push('')

  // Conditions
  lines.push('## Conditions')
  lines.push('')
  for (const c of exp.conditions) {
    const knobStr = Object.entries(c.knobs)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')
    const tickCount = analysis.ticksPerCondition[c.name] ?? 0
    lines.push(
      `- **${c.name}**: ${knobStr} — ${tickCount}/${exp.ticksPerCondition} ticks recorded`,
    )
  }
  lines.push('')

  // Results
  if (analysis.totalTicks === 0) {
    lines.push('## Results')
    lines.push('')
    lines.push('No ticks recorded yet.')
    if (exp.abortReason) {
      lines.push('')
      lines.push(`**Abort reason:** ${exp.abortReason}`)
    }
    return lines.join('\n')
  }

  lines.push('## Results')
  lines.push('')

  for (const comparison of analysis.comparisons) {
    lines.push(`### ${comparison.metric}`)
    lines.push('')

    // Table header
    const headers = ['Condition', 'N', 'Mean', 'Median', 'Min', 'Max', 'StdDev']
    lines.push(`| ${headers.join(' | ')} |`)
    lines.push(`| ${headers.map(() => '---').join(' | ')} |`)

    for (const cs of comparison.conditions) {
      lines.push(
        `| ${cs.conditionName} | ${cs.n} | ${cs.mean} | ${cs.median} | ${cs.min} | ${cs.max} | ${cs.stddev} |`,
      )
    }

    if (comparison.deltaAbsolute !== null) {
      const sign = comparison.deltaAbsolute >= 0 ? '+' : ''
      lines.push('')
      lines.push(
        `**Δ**: ${sign}${comparison.deltaAbsolute}` +
          (comparison.deltaPercent !== null
            ? ` (${sign}${comparison.deltaPercent}%)`
            : ''),
      )
    }
    lines.push('')
  }

  // Yield reason distribution
  lines.push('### Yield Reasons')
  lines.push('')
  for (const c of exp.conditions) {
    const ticks = analysis.experiment.results.filter(
      (r) => r.conditionName === c.name,
    )
    const reasons: Record<string, number> = {}
    for (const t of ticks) {
      reasons[t.metrics.yieldReason] =
        (reasons[t.metrics.yieldReason] ?? 0) + 1
    }
    const reasonStr = Object.entries(reasons)
      .map(([r, n]) => `${r}: ${n}`)
      .join(', ')
    lines.push(`- **${c.name}**: ${reasonStr || '(none)'}`)
  }
  lines.push('')

  // Tick timeline
  lines.push('### Tick Timeline')
  lines.push('')
  lines.push('| Tick | Condition | Tools | Chars | Duration |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (const r of exp.results) {
    const durSec = round2(r.metrics.durationMs / 1000)
    lines.push(
      `| ${r.experimentTick} | ${r.conditionName} | ${r.metrics.toolTotal} | ${r.metrics.outputChars} | ${durSec}s |`,
    )
  }

  if (exp.abortReason) {
    lines.push('')
    lines.push(`**Abort reason:** ${exp.abortReason}`)
  }

  return lines.join('\n')
}

/**
 * Render a compact experiment status line for prompt injection.
 */
export function renderExperimentStatus(): string | null {
  const exp = getActiveExperiment()
  if (!exp) return null

  const done = exp.results.length
  const total = exp.tickSchedule.length
  const nextIdx = done < total ? exp.tickSchedule[done]! : null
  const nextCondition =
    nextIdx !== null ? exp.conditions[nextIdx]?.name ?? '?' : 'complete'

  return (
    `🧪 Experiment "${exp.id}" running: ${done}/${total} ticks. ` +
    `Next condition: ${nextCondition}. ` +
    `Variable: ${exp.variable}. Schedule: ${exp.schedule}.`
  )
}

// ── Utilities ────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
