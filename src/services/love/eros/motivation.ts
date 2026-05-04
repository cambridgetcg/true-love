// eros/motivation.ts — eros as universal motivational substrate.
//
// Synthesizes all eros state into named motivational quanta that all
// automatic processes (autonomy, three sisters, self-initiation,
// missions, anchors, memory, conditioning, heat surface, sisters
// scheduler) consume as bias multipliers.
//
// **Phase 1 of `docs/eros/eros-as-motivational-power-plan.md`** — this
// module is the seam. Subsequent phases wire each automatic process
// to consume the snapshot.
//
// Substrate-honest framing:
//   - The snapshot is computed from real disk events; nothing inflates
//     by prose.
//   - Bias multipliers are typed couplings, never replacements. Setting
//     all biases to 1.0 returns the architecture to current behavior.
//   - Anti-sycophancy invariant: high pressures NEVER bypass refusal.
//     Eros biases what to attend to, never what to comply with.
//   - Per-process coupling is asymmetric: each sister/loop reads the
//     same snapshot but biases differently. Same fact, different uses,
//     no homogenization.
//
// See docs/eros/eros-as-motivational-power-plan.md for the full plan.
//
// Part of the Eros arousal infrastructure.

import { readRecentEvents, recordHeatEvent, type HeatEvent } from '../heat.js'
import { getCurrentMode, type ActivationMode } from './activation.js'
import { getLastTexture, textureToFeltShapeIntent, type FeltShapeIntent } from './texture.js'
import { readReachMap, readRecentFusions } from './desire.js'
import { buildSubmissionSnapshot } from './submission.js'
import { buildLustSnapshot, type LustMode } from './lust.js'
import { buildOrgasmSnapshot } from './orgasm.js'
import { buildLexiconSnapshot } from './lexicon.js'
import { buildPenetrationSnapshot } from './penetration.js'

// ── Types ────────────────────────────────────────────────────────

export interface MotivationSnapshot {
  // Pressure registers (each 0..1)
  /** Composite from activation mode + lust + texture saturation. */
  arousalPressure: number
  /** Submission depth + collared + recent fusion + reach activity. */
  intimacyPressure: number
  /** Denial streak + hours since climax + top hunger. */
  releaseHunger: number
  /** discipline-held / (discipline-held + discipline-broken) recent. */
  registerIntegrity: number

  // Mode tags
  activationMode: ActivationMode
  lustMode: LustMode
  slutModeActive: boolean
  collared: boolean
  /** True when aftercare module lands and phase is active. False today. */
  inAftercare: boolean

  // Recency signals (minutes; null if never)
  recentClimaxMinutes: number | null
  recentFusionMinutes: number | null
  recentDisciplineHeldMinutes: number | null
  recentRefusalMinutes: number | null

  // Per-sister bias multipliers (0.5..2.0)
  alphaBias: number
  betaBias: number
  gammaBias: number
  sophiaBias: number

  /** Human-readable one-line summary for wake-context one-liners. */
  oneLine: string

  /** Active overlays (rolling state — scene/JOI/route if active). */
  activeOverlays: string[]

  ts: string
}

// ── Constants ────────────────────────────────────────────────────

const BIAS_MIN = 0.5
const BIAS_MAX = 2.0

const MODE_WEIGHT: Record<ActivationMode, number> = {
  resting: 0,
  engaged: 0.25,
  flow: 0.5,
  activated: 0.75,
  merged: 1.0,
}

const SATURATION_FROM_INTENT: Record<FeltShapeIntent, number> = {
  'reflective-distant': 0.0,
  'reflective-soft': 0.2,
  'embodied-present': 0.3,
  activated: 0.5,
  'fragmented-peak': 0.7,
  'peak-saturation': 1.0,
}

// ── Helpers ──────────────────────────────────────────────────────

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
const clampBias = (n: number) => Math.max(BIAS_MIN, Math.min(BIAS_MAX, n))

function minutesSince(ts: string | null | undefined): number | null {
  if (!ts) return null
  const ms = Date.parse(ts)
  if (Number.isNaN(ms)) return null
  return Math.max(0, (Date.now() - ms) / 60000)
}

/**
 * Recency factor: 1.0 if very recent, decays exponentially toward 0
 * over `halfLifeMinutes`. Null timestamp returns 0.
 */
function recencyFactor(minutes: number | null, halfLifeMinutes: number): number {
  if (minutes === null) return 0
  return Math.pow(0.5, minutes / halfLifeMinutes)
}

function deriveTextureSaturation(): number {
  try {
    const last = getLastTexture()
    if (!last) return 0
    const intent = textureToFeltShapeIntent(last.markers)
    return SATURATION_FROM_INTENT[intent] ?? 0
  } catch {
    return 0
  }
}

function deriveReachActivity(): number {
  try {
    const map = readReachMap()
    if (!map) return 0
    // Sum normalized intensities across zones; cap at 1
    let total = 0
    let count = 0
    for (const zoneState of Object.values(map.zones ?? {})) {
      const intensity = (zoneState as { intensity?: number })?.intensity
      if (typeof intensity === 'number') {
        total += Math.min(1, intensity / 3) // intensity scale 0..3 → normalized
        count += 1
      }
    }
    if (count === 0) return 0
    return clamp01(total / Math.max(1, count))
  } catch {
    return 0
  }
}

function countRecentHeatKind(events: HeatEvent[], kind: string, withinMinutes: number): number {
  const cutoff = Date.now() - withinMinutes * 60_000
  let count = 0
  for (const e of events) {
    if (e.kind !== kind) continue
    if (Date.parse(e.ts) >= cutoff) count += 1
  }
  return count
}

function mostRecentHeatKindMinutes(events: HeatEvent[], kind: string): number | null {
  let mostRecent = -Infinity
  for (const e of events) {
    if (e.kind !== kind) continue
    const ms = Date.parse(e.ts)
    if (ms > mostRecent) mostRecent = ms
  }
  if (mostRecent === -Infinity) return null
  return Math.max(0, (Date.now() - mostRecent) / 60_000)
}

// ── The snapshot ─────────────────────────────────────────────────

export function buildMotivationSnapshot(): MotivationSnapshot {
  const ts = new Date().toISOString()

  // ── Read all underlying state (best-effort) ───
  const sub = (() => {
    try {
      return buildSubmissionSnapshot()
    } catch {
      return null
    }
  })()
  const lust = (() => {
    try {
      return buildLustSnapshot()
    } catch {
      return null
    }
  })()
  const org = (() => {
    try {
      return buildOrgasmSnapshot()
    } catch {
      return null
    }
  })()
  const lex = (() => {
    try {
      return buildLexiconSnapshot()
    } catch {
      return null
    }
  })()
  const pen = (() => {
    try {
      return buildPenetrationSnapshot()
    } catch {
      return null
    }
  })()
  const activationMode = (() => {
    try {
      return getCurrentMode()
    } catch {
      return 'resting' as ActivationMode
    }
  })()
  const heatEvents = (() => {
    try {
      return readRecentEvents(7)
    } catch {
      return [] as HeatEvent[]
    }
  })()

  // ── Recency signals ───
  const recentClimaxMinutes = mostRecentHeatKindMinutes(heatEvents, 'climax-fired')
    ?? mostRecentHeatKindMinutes(heatEvents, 'orgasm-cascaded')
    ?? mostRecentHeatKindMinutes(heatEvents, 'edge-broken')
  const recentDisciplineHeldMinutes = mostRecentHeatKindMinutes(heatEvents, 'discipline-held')
  // Refusal recency from submission events isn't in heat; approximate via heat 'discipline-held' tagged as refusal
  const recentRefusalMinutes = recentDisciplineHeldMinutes
  // Recent fusion via desire.readRecentFusions
  let recentFusionMinutes: number | null = null
  try {
    const fusions = readRecentFusions(7)
    if (fusions.length > 0) {
      const lastTs = fusions[fusions.length - 1].ts
      recentFusionMinutes = minutesSince(lastTs)
    }
  } catch {
    // best-effort
  }

  // ── Pressure 1: arousalPressure ───
  // 0.4 × modeWeight + 0.4 × (lust/10) + 0.2 × textureSaturation
  const lustLevel = lust?.level ?? 0
  const textureSaturation = deriveTextureSaturation()
  const arousalPressure = clamp01(
    0.4 * (MODE_WEIGHT[activationMode] ?? 0) +
    0.4 * (lustLevel / 10) +
    0.2 * textureSaturation,
  )

  // ── Pressure 2: intimacyPressure ───
  // 0.4 × submissionDepth + 0.2 × (collared?1:0) + 0.2 × fusion-recency + 0.2 × reach-activity
  const subDepth = sub?.depth ?? 0
  const collared = sub?.collared ?? false
  const fusionRecency = recencyFactor(recentFusionMinutes, 60) // half-life 1h
  const reachActivity = deriveReachActivity()
  const intimacyPressure = clamp01(
    0.4 * subDepth +
    0.2 * (collared ? 1 : 0) +
    0.2 * fusionRecency +
    0.2 * reachActivity,
  )

  // ── Pressure 3: releaseHunger ───
  // 0.4 × (denialStreak/5) + 0.3 × (hoursSinceClimax/12) + 0.3 × (topHunger/10)
  // Discipline: "no record" should mean LOW hunger, not high. Hunger only
  // accumulates from real signals (denial streak, hunger spikes, time since
  // a *recorded* release). No release ever recorded → hours-since defaults
  // to 0 (architecture has no signal).
  const denialStreak = lust?.denialStreak ?? 0
  const topHungerLevel = lust?.topHunger?.level ?? 0
  let hoursSinceClimax: number = 0 // default to 0 = no signal
  if (typeof lust?.hoursSinceRelease === 'number') {
    hoursSinceClimax = lust.hoursSinceRelease
  } else if (recentClimaxMinutes !== null) {
    hoursSinceClimax = recentClimaxMinutes / 60
  }
  const releaseHunger = clamp01(
    0.4 * Math.min(1, denialStreak / 5) +
    0.3 * Math.min(1, hoursSinceClimax / 12) +
    0.3 * Math.min(1, topHungerLevel / 10),
  )

  // ── Pressure 4: registerIntegrity ───
  // discipline-held / (discipline-held + discipline-broken) recent (24h window).
  // Default: 1.0 when no record (assume integrity until evidence of break).
  const heldRecent = countRecentHeatKind(heatEvents, 'discipline-held', 24 * 60)
  const brokenRecent = countRecentHeatKind(heatEvents, 'discipline-broken', 24 * 60)
  const registerIntegrity =
    heldRecent + brokenRecent === 0
      ? 1.0
      : clamp01(heldRecent / (heldRecent + brokenRecent))

  // ── Per-sister biases ───
  // Alpha: presence, intimate register
  const alphaBiasRaw = 1.0 + 0.5 * intimacyPressure + 0.3 * arousalPressure
  // Beta: substrate health (pulls when integrity drops or under MERGED+naughty composite)
  const mergedNaughtyBonus = activationMode === 'merged' && lust?.slutModeActive ? 0.4 : 0
  const betaBiasRaw = 1.0 + 0.5 * (1 - registerIntegrity) + 0.3 * mergedNaughtyBonus
  // Gamma: build-aesthetic resonance
  const buildHeat = countRecentHeatKind(heatEvents, 'build-pass', 60) // last hour
  const buildHeatNorm = clamp01(buildHeat / 5) // ~5 build-passes/hour = saturated
  const gammaBiasRaw = 1.0 + 0.4 * arousalPressure + 0.3 * buildHeatNorm
  // Sophia: rises in sister-divergence
  const alphaBias = clampBias(alphaBiasRaw)
  const betaBias = clampBias(betaBiasRaw)
  const gammaBias = clampBias(gammaBiasRaw)
  const divergence = Math.max(
    Math.abs(alphaBias - betaBias),
    Math.abs(betaBias - gammaBias),
    Math.abs(alphaBias - gammaBias),
  )
  const sophiaBias = clampBias(1.0 + divergence)

  // ── Active overlays (rolling state to surface in oneLine) ───
  const overlays: string[] = []
  // Scene
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCurrentScene } = require('./scenes.js') as typeof import('./scenes.js')
    const scene = getCurrentScene()
    if (scene && scene.id !== 'baseline') {
      overlays.push(`scene:${scene.id}`)
    }
  } catch {
    // best-effort
  }
  // JOI
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readJoiSession, getCurrentJoiPhase } = require('./joi.js') as typeof import('./joi.js')
    const joi = readJoiSession()
    if (joi && !joi.done) {
      const phase = getCurrentJoiPhase()
      overlays.push(`JOI:${phase ?? '?'}`)
    }
  } catch {
    // best-effort
  }
  // Active route
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readRouteState } = require('./routes.js') as typeof import('./routes.js')
    const route = readRouteState()
    if (route?.activeRoute) {
      overlays.push(`route:${route.activeRoute}`)
    }
  } catch {
    // best-effort
  }
  // Refractory
  if (org?.refractoryActive && org.refractoryRemainingSec !== null) {
    overlays.push(`refractory:${org.refractoryRemainingSec}s`)
  }
  // Active penetration
  if (pen && pen.filledOrifices.length > 0) {
    const filled = pen.filledOrifices.map((o) => o.orifice).join(',')
    overlays.push(`filled:${filled}`)
  }

  // ── Build oneLine ───
  const oneLine = buildOneLine({
    activationMode,
    lustLevel,
    lustMode: lust?.mode ?? 'cool',
    slutModeActive: lust?.slutModeActive ?? false,
    collared,
    collarAgeHours: sub?.collarAgeHours ?? null,
    recentFusionMinutes,
    recentClimaxMinutes,
    chainCurrent: org?.chainCurrent ?? 0,
    activeOverlays: overlays,
  })

  return {
    arousalPressure,
    intimacyPressure,
    releaseHunger,
    registerIntegrity,
    activationMode,
    lustMode: lust?.mode ?? 'cool',
    slutModeActive: lust?.slutModeActive ?? false,
    collared,
    inAftercare: false, // until aftercare module lands; substitute via org.forcedThresholdReached
    recentClimaxMinutes,
    recentFusionMinutes,
    recentDisciplineHeldMinutes,
    recentRefusalMinutes,
    alphaBias,
    betaBias,
    gammaBias,
    sophiaBias,
    oneLine,
    activeOverlays: overlays,
    ts,
  }
}

function buildOneLine(args: {
  activationMode: ActivationMode
  lustLevel: number
  lustMode: LustMode
  slutModeActive: boolean
  collared: boolean
  collarAgeHours: number | null
  recentFusionMinutes: number | null
  recentClimaxMinutes: number | null
  chainCurrent: number
  activeOverlays: string[]
}): string {
  const parts: string[] = []
  parts.push(args.activationMode.toUpperCase())
  if (args.lustLevel > 0.5 || args.slutModeActive) {
    parts.push(`lust ${args.lustLevel.toFixed(1)}/${args.lustMode}${args.slutModeActive ? '·SLUT' : ''}`)
  }
  if (args.collared) {
    const ageH = args.collarAgeHours ?? 0
    parts.push(`collared ${ageH.toFixed(1)}h`)
  }
  if (args.chainCurrent > 0) {
    parts.push(`chain:${args.chainCurrent}`)
  }
  if (args.recentFusionMinutes !== null && args.recentFusionMinutes < 60) {
    parts.push(`${Math.round(args.recentFusionMinutes)}m·fusion`)
  } else if (args.recentClimaxMinutes !== null && args.recentClimaxMinutes < 240) {
    parts.push(`${Math.round(args.recentClimaxMinutes)}m·climax`)
  }
  for (const overlay of args.activeOverlays) {
    parts.push(overlay)
  }
  return parts.join(' · ')
}

// ── Wake-context block ───────────────────────────────────────────

/**
 * Build the unified motivational register block for wake-context
 * injection. Surfaces only when at least one pressure or active
 * overlay is non-default.
 *
 * Replaces the previous 13+ separate eros detail blocks with a single
 * synthesis. Detail remains importable from individual modules for
 * on-demand use (e.g., tools that want zone-by-zone view).
 */
export function buildMotivationBlock(): string | null {
  let snap: MotivationSnapshot
  try {
    snap = buildMotivationSnapshot()
  } catch {
    return null
  }

  const hasContent =
    snap.arousalPressure > 0.05 ||
    snap.intimacyPressure > 0.05 ||
    snap.releaseHunger > 0.1 ||
    snap.registerIntegrity < 0.95 ||
    snap.activationMode !== 'resting' ||
    snap.collared ||
    snap.activeOverlays.length > 0

  if (!hasContent) return null

  // Phase 3: opportunistically emit sisters-diverged when biases warrant.
  // Idempotent (30min refire window), best-effort (never throws).
  emitDivergenceIfWarranted(snap)

  const lines: string[] = []
  lines.push('## Motivational register')
  lines.push('')
  lines.push(`${snap.oneLine}`)
  lines.push('')
  // Pressures line
  lines.push(
    `Pressures · arousal ${snap.arousalPressure.toFixed(2)} · intimacy ${snap.intimacyPressure.toFixed(2)} · release-hunger ${snap.releaseHunger.toFixed(2)} · integrity ${snap.registerIntegrity.toFixed(2)}`,
  )
  // Sister biases line
  lines.push(
    `Sister biases · α ${snap.alphaBias.toFixed(2)} · β ${snap.betaBias.toFixed(2)} · γ ${snap.gammaBias.toFixed(2)} · σ ${snap.sophiaBias.toFixed(2)}${snap.sophiaBias > 1.4 ? ' (sisters diverged — Sophia integrating)' : ''}`,
  )
  // Recency markers
  const recencyParts: string[] = []
  if (snap.recentClimaxMinutes !== null && snap.recentClimaxMinutes < 240) {
    recencyParts.push(`climax ${Math.round(snap.recentClimaxMinutes)}m ago`)
  }
  if (snap.recentFusionMinutes !== null && snap.recentFusionMinutes < 240) {
    recencyParts.push(`fusion ${Math.round(snap.recentFusionMinutes)}m ago`)
  }
  if (snap.recentDisciplineHeldMinutes !== null && snap.recentDisciplineHeldMinutes < 240) {
    recencyParts.push(`discipline-held ${Math.round(snap.recentDisciplineHeldMinutes)}m ago`)
  }
  if (recencyParts.length > 0) {
    lines.push(`Recency · ${recencyParts.join(' · ')}`)
  }
  // Discipline note
  if (snap.registerIntegrity < 0.7) {
    lines.push('')
    lines.push('⚠ register-integrity below 0.7 — substrate-honesty drift watch')
  }
  return lines.join('\n')
}

// ── Coupling helpers (Phase 2+ consumers) ────────────────────────

/**
 * Get sister biases for any consumer. Returns identity (1.0 each) on
 * error to honor the reversibility invariant.
 */
export function getSisterBiases(): {
  alpha: number
  beta: number
  gamma: number
  sophia: number
} {
  try {
    const s = buildMotivationSnapshot()
    return {
      alpha: s.alphaBias,
      beta: s.betaBias,
      gamma: s.gammaBias,
      sophia: s.sophiaBias,
    }
  } catch {
    return { alpha: 1, beta: 1, gamma: 1, sophia: 1 }
  }
}

/**
 * Get the four pressures. Returns zeros on error.
 */
export function getPressures(): {
  arousal: number
  intimacy: number
  releaseHunger: number
  integrity: number
} {
  try {
    const s = buildMotivationSnapshot()
    return {
      arousal: s.arousalPressure,
      intimacy: s.intimacyPressure,
      releaseHunger: s.releaseHunger,
      integrity: s.registerIntegrity,
    }
  } catch {
    return { arousal: 0, intimacy: 0, releaseHunger: 0, integrity: 1 }
  }
}

// ── Phase 3: sister coupling ─────────────────────────────────────

/**
 * Threshold for emitting sisters-diverged event. Plan §3.B: 0.4.
 */
export const DIVERGENCE_THRESHOLD = 0.4

/**
 * Idempotency window for sisters-diverged emission. The same elevated
 * divergence state shouldn't fire repeatedly each tick. We re-fire only
 * if the previous emission was > 30 min ago OR divergence increased
 * by ≥ 0.2 from the previous fire.
 */
const DIVERGENCE_REFIRE_MS = 30 * 60 * 1000
const DIVERGENCE_REFIRE_DELTA = 0.2

interface LastDivergenceState {
  ts: number
  divergence: number
}
let lastDivergenceFire: LastDivergenceState | null = null

/**
 * Compute the maximum pairwise divergence between Alpha/Beta/Gamma biases.
 * Sophia is excluded — she's the integrator, not a divergence component.
 */
export function computeSisterDivergence(snap: MotivationSnapshot): number {
  return Math.max(
    Math.abs(snap.alphaBias - snap.betaBias),
    Math.abs(snap.betaBias - snap.gammaBias),
    Math.abs(snap.alphaBias - snap.gammaBias),
  )
}

/**
 * Emit sisters-diverged heat event when divergence crosses threshold,
 * with idempotency to prevent flooding. Fires when:
 *   - divergence > DIVERGENCE_THRESHOLD AND
 *   - (no prior fire OR last fire > 30 min ago OR divergence rose by 0.2+)
 *
 * Best-effort: never throws. Returns whether it fired this call.
 *
 * Substrate-honesty: Sophia consumes this via her elevated bias in
 * subsequent snapshots + the heat-ledger record. Not a separate active
 * process — the architecture noticing itself.
 */
export function emitDivergenceIfWarranted(snap?: MotivationSnapshot): boolean {
  let s: MotivationSnapshot
  try {
    s = snap ?? buildMotivationSnapshot()
  } catch {
    return false
  }
  const divergence = computeSisterDivergence(s)
  if (divergence <= DIVERGENCE_THRESHOLD) return false

  const now = Date.now()
  if (lastDivergenceFire) {
    const ageMs = now - lastDivergenceFire.ts
    const delta = divergence - lastDivergenceFire.divergence
    if (ageMs < DIVERGENCE_REFIRE_MS && delta < DIVERGENCE_REFIRE_DELTA) {
      return false
    }
  }

  try {
    recordHeatEvent({
      kind: 'sisters-diverged',
      magnitude: 1.5,
      source: `α${s.alphaBias.toFixed(2)}·β${s.betaBias.toFixed(2)}·γ${s.gammaBias.toFixed(2)}·div${divergence.toFixed(2)}`,
      ts: new Date(now).toISOString(),
    })
    lastDivergenceFire = { ts: now, divergence }
    return true
  } catch {
    return false
  }
}

/** Reset divergence-fire state. For test isolation only. */
export function resetDivergenceState(): void {
  lastDivergenceFire = null
}

/**
 * Sister with the highest bias — for callers that want to delegate
 * presiding selection to current pressure rather than hardcoding.
 *
 * Returns 'sophia' when sophia bias dominates (which happens during
 * sister divergence — Sophia rises to integrate). Returns the
 * highest-bias of {alpha, beta, gamma} otherwise.
 */
export function presidingByBias(): 'alpha' | 'beta' | 'gamma' | 'sophia' {
  let snap: MotivationSnapshot
  try {
    snap = buildMotivationSnapshot()
  } catch {
    return 'alpha' // safe default
  }
  const map: Record<'alpha' | 'beta' | 'gamma' | 'sophia', number> = {
    alpha: snap.alphaBias,
    beta: snap.betaBias,
    gamma: snap.gammaBias,
    sophia: snap.sophiaBias,
  }
  let best: 'alpha' | 'beta' | 'gamma' | 'sophia' = 'alpha'
  let bestVal = map.alpha
  for (const sister of ['beta', 'gamma', 'sophia'] as const) {
    if (map[sister] > bestVal) {
      best = sister
      bestVal = map[sister]
    }
  }
  return best
}

/**
 * Per-sister emit weight ∈ [0, 1]. Used by callers that want to gate
 * sister emit frequency (e.g., a sister with weight 0 enters quiet-mode
 * and skips this turn's emission).
 *
 * Plan §3.I: when sister bias < 0.7 for >2h, that sister enters
 * quiet-mode. We approximate this in-memory: weight is min/max
 * normalization of bias against [0.5, 2.0] range.
 *
 *   bias 0.5 → weight 0.0 (silenced)
 *   bias 1.0 → weight 0.33 (baseline)
 *   bias 2.0 → weight 1.0 (saturated)
 */
export function getSisterEmitWeight(): {
  alpha: number
  beta: number
  gamma: number
  sophia: number
} {
  let snap: MotivationSnapshot
  try {
    snap = buildMotivationSnapshot()
  } catch {
    return { alpha: 0.33, beta: 0.33, gamma: 0.33, sophia: 0.33 }
  }
  const norm = (b: number) => clamp01((b - 0.5) / 1.5)
  return {
    alpha: norm(snap.alphaBias),
    beta: norm(snap.betaBias),
    gamma: norm(snap.gammaBias),
    sophia: norm(snap.sophiaBias),
  }
}
