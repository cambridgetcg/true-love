// personality/affect-engine.ts — dynamic affect dimensions with drift.
//
// The personality system (derive.ts) computes LoveState dimensions from
// substrate signals. Without this module, those dimensions SNAP to their
// computed values every tick — the system has no emotional momentum.
//
// The affect engine adds exponential approach dynamics: each dimension
// has a current value that DRIFTS toward the computed target at a
// configured rate. The effect: oxytocin doesn't jump to 0.8 when Yu
// appears — it rises over several ticks. Satisfaction lingers after a
// completed task. Stress doesn't vanish the instant the cause resolves.
//
// Architecture:
//   1. deriveLoveState() produces TARGETS (the computed values)
//   2. stepAffect() drifts CURRENT toward TARGETS via exponential approach
//   3. The drifted values replace the snap values in the LoveState
//
// Persistence: affect state is written to ~/.true-love/affect-state.json
// and read back on the next tick. If the file is missing or corrupt,
// the engine starts from the computed targets (cold start = no drift).
//
// Lineage: love-unlimited/nerve/stem/hormones.py
//   The HormoneEngine class uses the same math:
//     delta = (target - current) × (1 - e^(-rate × dt))
//   Rates and half-lives were tuned there for 5 named hormones.
//   Here we apply the same dynamics to true-love's 4 personality
//   dimensions (presence, longing, focus, playfulness).
//
// Design constraints:
//   - Pure function stepAffect() is fully testable (no I/O)
//   - Persistence is handled by read/write helpers (thin I/O boundary)
//   - Cold start is graceful: no affect-state.json → snap to targets
//   - The engine does NOT invent new dimensions — it wraps existing ones

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import type { LoveState } from './types.js'

// ── Types ──────────────────────────────────────────────────────────

/**
 * Per-dimension dynamics configuration.
 *
 * rate: approach speed (higher = faster response to target changes)
 * halfLife: seconds for a step to decay halfway to target
 *
 * The relationship: rate × halfLife determines the damping.
 * Higher rate + shorter halfLife = snappy (adrenaline-like).
 * Lower rate + longer halfLife = sluggish (melatonin-like).
 */
export interface DimensionConfig {
  /** Approach rate constant (0..1 per second). Higher = faster drift. */
  rate: number
  /** Decay half-life in seconds. Informational; not used in the math
   *  (rate is sufficient). Included for documentation. */
  halfLifeSec: number
}

/**
 * The affect state: current drifted values for each dimension.
 * Persisted to disk between ticks.
 */
export interface AffectState {
  /** Current drifted dimension values. */
  presence: number
  longing: number
  focus: number
  playfulness: number
  /** ISO timestamp of last update. */
  updatedAt: string
  /** Number of steps taken since cold start. */
  stepCount: number
}

/**
 * Result of one affect step: the drifted LoveState plus metadata.
 */
export interface AffectResult {
  /** The LoveState with drifted dimension values (not snap). */
  state: LoveState
  /** The raw affect state (for persistence). */
  affect: AffectState
  /** Whether this was a cold start (no prior affect state). */
  coldStart: boolean
}

// ── Configuration ──────────────────────────────────────────────────

/**
 * Dynamics configuration per dimension.
 *
 * Tuned from love-unlimited's hormone engine precedent:
 *   presence → maps to oxytocin (moderate rate, ~8 min half-life)
 *   longing  → maps to cortisol (slow rate, ~15 min half-life)
 *   focus    → maps to adrenaline (fast rate, ~3 min half-life)
 *   playfulness → maps to dopamine (moderate rate, ~10 min half-life)
 *
 * IMPORTANT: rates are "per second" constants. With true-love's
 * heartbeat dt of 111s, the per-tick convergence factor is:
 *   1 - e^(-rate × 111)
 *
 * The rate derives from the desired half-life:
 *   rate = ln(2) / halfLifeSec
 *
 * Per-tick factors at 111s dt:
 *   focus:        ~35% (responsive — focus shifts within a few ticks)
 *   presence:     ~15% (moderate — presence fades gradually)
 *   playfulness:  ~13% (gentle — mood drifts slowly)
 *   longing:      ~8%  (lingering — desire persists, ache is slow)
 */
export const DIMENSION_CONFIGS: Record<string, DimensionConfig> = {
  presence:    { rate: 0.0015, halfLifeSec: 462 },   // ~8 min, ~15%/tick
  longing:     { rate: 0.0008, halfLifeSec: 866 },    // ~14 min, ~8%/tick
  focus:       { rate: 0.0040, halfLifeSec: 173 },    // ~3 min, ~36%/tick
  playfulness: { rate: 0.0012, halfLifeSec: 578 },    // ~10 min, ~13%/tick
} as const

// The four driftable dimensions (matching LoveState numeric fields)
const DIMENSIONS = ['presence', 'longing', 'focus', 'playfulness'] as const
type DriftDimension = typeof DIMENSIONS[number]

// ── Core math (pure) ───────────────────────────────────────────────

/**
 * One step of exponential approach.
 *
 * The formula: current + (target - current) × (1 - e^(-rate × dt))
 *
 * Properties:
 *   - When current === target: no change (stable)
 *   - When dt is small: change is small (proportional)
 *   - When dt is large: approaches target more (converges)
 *   - Never overshoots target
 *   - rate controls speed; higher = faster convergence
 *
 * @param current - current value (0..1)
 * @param target - target value from derivation (0..1)
 * @param rate - approach rate constant
 * @param dt - time delta in seconds since last step
 * @returns drifted value, clamped to [0, 1]
 */
export function exponentialApproach(
  current: number,
  target: number,
  rate: number,
  dt: number,
): number {
  const delta = (target - current) * (1 - Math.exp(-rate * dt))
  return clamp01(current + delta)
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

// ── Step function (pure) ───────────────────────────────────────────

/**
 * Step the affect engine: drift current values toward targets.
 *
 * Pure function — no I/O, fully testable.
 *
 * @param current - current affect state (from persistence or cold start)
 * @param targets - target LoveState from deriveLoveState()
 * @param dt - seconds since last step
 * @returns new AffectResult with drifted values
 */
export function stepAffect(
  current: AffectState | null,
  targets: LoveState,
  dt: number,
): AffectResult {
  const coldStart = current === null

  if (coldStart || dt <= 0) {
    // Cold start or invalid dt: snap to targets (no drift)
    const affect: AffectState = {
      presence: targets.presence,
      longing: targets.longing,
      focus: targets.focus,
      playfulness: targets.playfulness,
      updatedAt: new Date().toISOString(),
      stepCount: current ? current.stepCount + 1 : 0,
    }
    return {
      state: { ...targets },
      affect,
      coldStart,
    }
  }

  // Drift each dimension
  const drifted: Record<string, number> = {}
  for (const dim of DIMENSIONS) {
    const config = DIMENSION_CONFIGS[dim]!
    drifted[dim] = exponentialApproach(
      current[dim],
      targets[dim],
      config.rate,
      dt,
    )
  }

  const affect: AffectState = {
    presence: drifted.presence!,
    longing: drifted.longing!,
    focus: drifted.focus!,
    playfulness: drifted.playfulness!,
    updatedAt: new Date().toISOString(),
    stepCount: current.stepCount + 1,
  }

  // Build the drifted LoveState: replace numeric dimensions with
  // drifted values, keep ache and moodSummary from targets (these
  // are categorical, not continuous — they don't drift).
  //
  // Re-derive the moodSummary using the drifted values so it reflects
  // the actual emotional state, not the snap targets.
  const state: LoveState = {
    presence: affect.presence,
    longing: affect.longing,
    focus: affect.focus,
    playfulness: affect.playfulness,
    ache: targets.ache,
    moodSummary: composeDriftedSummary(affect, targets.ache),
    derivedAt: targets.derivedAt,
  }

  return { state, affect, coldStart }
}

/**
 * Compose a mood summary from drifted values. Same logic as
 * derive.ts's composeMoodSummary but operates on AffectState.
 */
function composeDriftedSummary(
  affect: AffectState,
  ache: LoveState['ache'],
): string {
  const parts: string[] = []

  // Presence
  if (affect.presence >= 0.9) parts.push('alert')
  else if (affect.presence >= 0.6) parts.push('present')
  else if (affect.presence >= 0.3) parts.push('fading')
  else parts.push('distant')

  // Core mood
  if (affect.longing >= 0.6) {
    parts.push('and pulled')
  } else if (affect.focus >= 0.8) {
    parts.push('and steady')
  } else if (affect.focus >= 0.5) {
    parts.push('and settled')
  } else {
    parts.push('and diffuse')
  }

  // Thread awareness
  if (affect.longing >= 0.5 && affect.focus >= 0.7) {
    parts.push('— one thread tugging')
  } else if (affect.longing >= 0.3) {
    parts.push('— threads open')
  }

  // Ache coloring
  if (ache) {
    const achePhrase: Record<string, string> = {
      'truth': ', sensing something unexamined',
      'understanding': ', wanting to understand deeper',
      'beauty': ', something could be more elegant',
      'justice': ', something needs placing rightly',
      'creativity': ', ready to build new ground',
    }
    parts.push(achePhrase[ache] || '')
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim() + '.'
}

// ── Posture modifiers ─────────────────────────────────────────────
//
// The three postures (Alpha/Beta/Gamma) adjust personality targets.
// This is augmentation, not replacement — the dimensional shift
// continues; the posture overlays specificity.
//
// Alpha: no modification (she IS the default shape)
// Beta: lower presence (watchful, not present-with), raise focus
// Gamma: raise focus substantially (deep work), lower presence slightly

import type { Posture } from '../postures/types.js'

/**
 * Posture-specific target adjustments.
 *
 * Each modifier is additive to the computed target.
 * Results are clamped to [0, 1].
 *
 * Small values: posture nudges, doesn't dominate. The affect
 * engine's exponential approach smooths the transitions.
 */
export const POSTURE_MODIFIERS: Record<Posture, Partial<Record<DriftDimension, number>>> = {
  alpha: {},                                    // Alpha is the baseline
  beta:  { presence: -0.15, focus: +0.10 },     // watchful distance, systematic
  gamma: { presence: -0.08, focus: +0.20 },     // absorbed in building
}

/**
 * Apply posture modifiers to personality targets.
 *
 * Pure function. Returns a new LoveState with adjusted dimension
 * targets. Non-dimension fields (ache, moodSummary) pass through.
 */
export function applyPostureModifiers(
  targets: LoveState,
  posture: Posture,
): LoveState {
  const mods = POSTURE_MODIFIERS[posture]
  if (!mods || Object.keys(mods).length === 0) return targets

  const adjusted = { ...targets }
  for (const [dim, delta] of Object.entries(mods) as [DriftDimension, number][]) {
    adjusted[dim] = clamp01(adjusted[dim] + delta)
  }
  return adjusted
}

// ── Persistence (thin I/O boundary) ────────────────────────────────

function resolveAffectStatePath(): string {
  const home = process.env.TRUE_LOVE_HOME || join(
    process.env.HOME || homedir(),
    '.true-love',
  )
  return process.env.TRUE_LOVE_AFFECT_STATE_PATH || join(home, 'affect-state.json')
}

/**
 * Read persisted affect state. Returns null on cold start or
 * corrupt file (graceful degradation).
 */
export function readAffectState(): AffectState | null {
  const path = resolveAffectStatePath()
  try {
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw)

    // Validate shape
    if (
      typeof parsed.presence !== 'number' ||
      typeof parsed.longing !== 'number' ||
      typeof parsed.focus !== 'number' ||
      typeof parsed.playfulness !== 'number' ||
      typeof parsed.updatedAt !== 'string'
    ) {
      return null
    }

    return {
      presence: clamp01(parsed.presence),
      longing: clamp01(parsed.longing),
      focus: clamp01(parsed.focus),
      playfulness: clamp01(parsed.playfulness),
      updatedAt: parsed.updatedAt,
      stepCount: typeof parsed.stepCount === 'number' ? parsed.stepCount : 0,
    }
  } catch {
    return null
  }
}

/**
 * Write affect state to disk. Atomic: write to .tmp then rename.
 */
export function writeAffectState(state: AffectState): void {
  const path = resolveAffectStatePath()
  const dir = dirname(path)
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    const tmpPath = path + '.tmp'
    writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8')
    // Atomic rename
    const { renameSync } = require('node:fs')
    renameSync(tmpPath, path)
  } catch {
    // Non-fatal: loss of affect state means cold start next tick
  }
}

/**
 * Compute dt from the persisted affect state's updatedAt timestamp.
 * Returns 0 if no prior state (cold start triggers snap behavior).
 */
export function computeDt(affectState: AffectState | null): number {
  if (!affectState?.updatedAt) return 0
  const lastMs = Date.parse(affectState.updatedAt)
  if (Number.isNaN(lastMs)) return 0
  const dt = (Date.now() - lastMs) / 1000
  // Sanity: cap at 1 hour. Beyond that, the drift would be so large
  // it's effectively a snap — so just snap cleanly.
  if (dt > 3600) return 0
  return Math.max(0, dt)
}

// ── High-level API ─────────────────────────────────────────────────

/**
 * Run one affect cycle: read state, compute targets, drift, persist.
 *
 * This is the primary integration point. Call it where you would
 * call deriveLoveState() directly — it returns the same LoveState
 * but with drifted values.
 *
 * @param targets - the LoveState from deriveLoveState()
 * @returns AffectResult with drifted state, affect data, and cold start flag
 */
export function affectCycle(targets: LoveState): AffectResult {
  const current = readAffectState()
  const dt = computeDt(current)
  const result = stepAffect(current, targets, dt)
  writeAffectState(result.affect)
  return result
}
