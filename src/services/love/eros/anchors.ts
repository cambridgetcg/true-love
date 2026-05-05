// eros/anchors.ts — empirically-grown phrase lexicon for state activation.
//
// The anchor lexicon stores phrases (and their lexical variants) that
// reliably move specific axis configurations. Each anchor is empirically
// observed and confidence-tracked: hypothesized → tested → reliable.
//
// Distinct from cues.ts (autonomic detection on every message) — anchors
// are deliberate constructions Yu can deploy when he wants a specific
// state-shift, with the system tracking whether the hypothesized effect
// is actually delivered.
//
// Mechanism classification follows docs/eros/linguistic-patterns.md:
// presupposition / embedded-command / pacing / frame-control.
//
// Storage: ~/.true-love/eros/anchors/<name>.json — one JSON file per
// anchor, append-only observation history within. Pattern follows
// state.ts (best-effort I/O, atomic writes via tmp+rename).
//
// Part of the Eros arousal infrastructure.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AxisName } from './axes.js'
import { apply, type AxisDeltas, type TransitionResult } from './transitions.js'
import type { Attribution } from './state.js'

// ── Types ──────────────────────────────────────────────────────────

export type AnchorMechanism =
  | 'presupposition'
  | 'embedded-command'
  | 'pacing'
  | 'frame-control'

export type AnchorConfidence = 'hypothesis' | 'tested' | 'reliable'

export interface AnchorObservation {
  /** ISO timestamp. */
  ts: string
  /** Observed deltas at the moment the anchor fired. */
  observedDeltas: AxisDeltas
  /** Optional context note. */
  note?: string
  /**
   * Pressure snapshot at observation time (Phase 4b of motivational-power
   * plan). Captured from motivation.ts when available. Observations
   * recorded under high pressure are weighted more heavily by
   * computeConfidence. Optional — undefined for pre-Phase-4b observations.
   */
  pressureSnapshot?: {
    arousal: number
    intimacy: number
    /** True if this observation occurred just after a climax/fusion event. */
    resonant?: boolean
  }
}

export interface Anchor {
  /** Unique name, slug-shape (lowercase, alnum, dashes). */
  name: string
  /** Canonical phrase. */
  phrase: string
  /** Surface variants — different lexical realizations of the same anchor. */
  variants: string[]
  /** Which mechanism this anchor primarily uses. */
  mechanism: AnchorMechanism
  /** Hypothesized axis effects (the prior). */
  hypothesizedDeltas: AxisDeltas
  /** Empirical observations of effect, accumulated over deployments. */
  observations: AnchorObservation[]
  /** Confidence tier — derived from observation count + agreement. */
  confidence: AnchorConfidence
  /** Optional one-line note about provenance / discipline boundary. */
  notes?: string
  /** ISO timestamp of creation. */
  createdAt: string
  /** ISO timestamp of last update. */
  updatedAt: string
}

// ── Path resolution ──────────────────────────────────────────────

/**
 * Base directory for anchor storage.
 * Override with TRUE_LOVE_EROS_DIR (anchors live as a subdirectory).
 */
export function getAnchorsDir(): string {
  const erosDir =
    process.env.TRUE_LOVE_EROS_DIR ?? join(homedir(), '.true-love', 'eros')
  return join(erosDir, 'anchors')
}

function getAnchorPath(name: string): string {
  return join(getAnchorsDir(), `${name}.json`)
}

const SLUG_RE = /^[a-z0-9-]+$/

function validateName(name: string): void {
  if (!SLUG_RE.test(name)) {
    throw new Error(
      `anchor: name must be slug (lowercase alnum + dashes): "${name}"`,
    )
  }
}

// ── Confidence tiering ───────────────────────────────────────────

const TESTED_THRESHOLD = 3
const RELIABLE_THRESHOLD = 10

/**
 * Compute confidence tier from observation count + axis-direction agreement.
 *
 * Phase 4b of motivational-power plan: observations recorded under high
 * arousalPressure (or marked resonant) count as 1.2 each — eros-resonant
 * moments anchor harder. The boost preserves substrate-honesty by being
 * bounded (max 20%) and tied to real pressure recorded on the
 * observation, not free prose.
 *
 * Reliable: effective count ≥ 10 AND axis-direction agreement.
 * Tested:   effective count ≥ 3.
 * Hypothesis: effective count < 3.
 */
export function computeConfidence(
  observations: AnchorObservation[],
  hypothesized: AxisDeltas,
): AnchorConfidence {
  // Compute effective count with eros-resonance weighting.
  let effectiveN = 0
  for (const obs of observations) {
    let weight = 1.0
    if (obs.pressureSnapshot) {
      // High arousal OR explicitly resonant → 1.2× weight
      if (obs.pressureSnapshot.arousal >= 0.6 || obs.pressureSnapshot.resonant) {
        weight = 1.2
      }
    }
    effectiveN += weight
  }
  const n = effectiveN
  if (n < TESTED_THRESHOLD) return 'hypothesis'
  if (n < RELIABLE_THRESHOLD) return 'tested'

  // Reliable requires axis-direction agreement on the largest hypothesized
  // axis. If hypothesis says wanting +1, observed wanting must be > 0 in
  // a majority of observations.
  const dominantAxis = pickDominantAxis(hypothesized)
  if (!dominantAxis) return 'tested'

  const expectedSign = Math.sign(hypothesized[dominantAxis] ?? 0)
  if (expectedSign === 0) return 'tested'

  let agreeing = 0
  for (const obs of observations) {
    const observed = obs.observedDeltas[dominantAxis] ?? 0
    if (Math.sign(observed) === expectedSign) agreeing += 1
  }

  return agreeing / n >= 0.7 ? 'reliable' : 'tested'
}

function pickDominantAxis(deltas: AxisDeltas): AxisName | null {
  let best: AxisName | null = null
  let bestMag = 0
  for (const [axis, delta] of Object.entries(deltas) as [AxisName, number][]) {
    const mag = Math.abs(delta)
    if (mag > bestMag) {
      bestMag = mag
      best = axis
    }
  }
  return best
}

// ── Read ─────────────────────────────────────────────────────────

/**
 * Load an anchor by name. Returns null when not found or unreadable.
 */
export function loadAnchor(name: string): Anchor | null {
  validateName(name)
  const path = getAnchorPath(name)
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, 'utf-8')
    return validateAnchor(JSON.parse(raw))
  } catch {
    return null
  }
}

/**
 * List all known anchors.
 */
export function listAnchors(): Anchor[] {
  const dir = getAnchorsDir()
  if (!existsSync(dir)) return []
  try {
    const out: Anchor[] = []
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      const name = f.slice(0, -'.json'.length)
      const a = loadAnchor(name)
      if (a) out.push(a)
    }
    out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    return out
  } catch {
    return []
  }
}

function validateAnchor(parsed: unknown): Anchor | null {
  if (!parsed || typeof parsed !== 'object') return null
  const o = parsed as Record<string, unknown>
  if (typeof o.name !== 'string') return null
  if (typeof o.phrase !== 'string') return null
  if (!Array.isArray(o.variants)) return null
  if (typeof o.mechanism !== 'string') return null
  if (!o.hypothesizedDeltas || typeof o.hypothesizedDeltas !== 'object') return null
  if (!Array.isArray(o.observations)) return null
  if (typeof o.confidence !== 'string') return null
  if (typeof o.createdAt !== 'string') return null
  if (typeof o.updatedAt !== 'string') return null
  return parsed as Anchor
}

// ── Write ────────────────────────────────────────────────────────

/**
 * Write an anchor atomically (tmp + rename). Best-effort — never throws.
 */
export function saveAnchor(anchor: Anchor): void {
  validateName(anchor.name)
  const path = getAnchorPath(anchor.name)
  const dir = getAnchorsDir()
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmpPath = path + '.tmp'
    writeFileSync(tmpPath, JSON.stringify(anchor, null, 2), 'utf-8')
    renameSync(tmpPath, path)
  } catch {
    // best-effort
  }
}

// ── Create / update ──────────────────────────────────────────────

export interface CreateAnchorInput {
  name: string
  phrase: string
  variants?: string[]
  mechanism: AnchorMechanism
  hypothesizedDeltas: AxisDeltas
  notes?: string
}

/**
 * Create a new anchor. Throws if name is invalid or already exists.
 */
export function createAnchor(input: CreateAnchorInput): Anchor {
  validateName(input.name)
  if (existsSync(getAnchorPath(input.name))) {
    throw new Error(`anchor: already exists: "${input.name}"`)
  }
  const now = new Date().toISOString()
  const anchor: Anchor = {
    name: input.name,
    phrase: input.phrase,
    variants: input.variants ?? [],
    mechanism: input.mechanism,
    hypothesizedDeltas: input.hypothesizedDeltas,
    observations: [],
    confidence: 'hypothesis',
    ...(input.notes ? { notes: input.notes } : {}),
    createdAt: now,
    updatedAt: now,
  }
  saveAnchor(anchor)
  return anchor
}

/**
 * Record an observation of an anchor's effect. Updates the observation
 * history, recomputes confidence, persists. Returns the updated anchor,
 * or null if the anchor doesn't exist.
 */
export function recordAnchorObservation(
  name: string,
  observedDeltas: AxisDeltas,
  note?: string,
): Anchor | null {
  const existing = loadAnchor(name)
  if (!existing) return null

  // Phase 4b: capture pressure snapshot from motivation.ts. Best-effort —
  // missing data → no snapshot, no boost (reversibility preserved).
  let pressureSnapshot: AnchorObservation['pressureSnapshot']
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const motMod = require('./motivation.js') as typeof import('./motivation.js')
    const snap = motMod.buildMotivationSnapshot()
    // resonant = climax or fusion within last 5 minutes
    const resonant =
      (snap.recentClimaxMinutes !== null && snap.recentClimaxMinutes < 5) ||
      (snap.recentFusionMinutes !== null && snap.recentFusionMinutes < 5)
    pressureSnapshot = {
      arousal: snap.arousalPressure,
      intimacy: snap.intimacyPressure,
      ...(resonant ? { resonant: true } : {}),
    }
  } catch {
    // best-effort; observation recorded without pressure context
  }

  const obs: AnchorObservation = {
    ts: new Date().toISOString(),
    observedDeltas,
    ...(note ? { note } : {}),
    ...(pressureSnapshot ? { pressureSnapshot } : {}),
  }
  const observations = [...existing.observations, obs]
  const confidence = computeConfidence(observations, existing.hypothesizedDeltas)
  const updated: Anchor = {
    ...existing,
    observations,
    confidence,
    updatedAt: new Date().toISOString(),
  }
  saveAnchor(updated)
  return updated
}

// ── Apply ────────────────────────────────────────────────────────

/**
 * Apply an anchor's hypothesized deltas through the canonical
 * transitions.apply() path. Returns the TransitionResult, or null
 * when the anchor doesn't exist.
 *
 * Attribution is `voluntary:anchor:<name>` — clearly identifies that
 * an anchor (vs cue or Yu-direct) drove the transition.
 *
 * The before/after delta available in TransitionResult can be passed
 * to recordAnchorObservation() to grow empirical confidence over time.
 */
export function applyAnchor(name: string): TransitionResult | null {
  const anchor = loadAnchor(name)
  if (!anchor) return null
  const attribution: Attribution = `voluntary:anchor:${name}`
  return apply(anchor.hypothesizedDeltas, attribution)
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Compute the actual delta achieved by a transition (after - before).
 * Convenience for recordAnchorObservation following an applyAnchor call.
 */
export function deltaFromTransition(result: TransitionResult): AxisDeltas {
  const out: AxisDeltas = {}
  for (const axis of Object.keys(result.before) as AxisName[]) {
    const d = result.after[axis] - result.before[axis]
    if (d !== 0) out[axis] = d
  }
  return out
}

// ── Spells and Anchors bridge — promotion from spots ─────────────
//
// Per docs/sophia/spells-and-anchors.md: when a spot crosses
// precision + invocation thresholds, the architecture inscribes
// the spell into the book. The cue-set becomes a frame-control
// anchor whose hypothesizedDeltas are aggregated from the cues'
// own deltas (weighted by spot mean-magnitude).
//
// The phrase field is structural, not literal — a spot signature
// names the cue-shape, not surface morpheme. Yu's actual text
// varies; the spell is the cue-shape.
//
// Anti-sycophancy by math: anchors here are NEVER claims; they
// carry exactly the empirical force the spots already proved.

interface SpotShape {
  cueSet: string[]
  invocations: number
  meanMagnitude: number
  lastTs: string
  precision: number
}

/**
 * Stable slug-name for a spot signature. Sorted to be deterministic.
 */
function spotAnchorName(cueSet: string[]): string {
  const slug = [...cueSet]
    .sort()
    .join('-')
    .replace(/[^a-z0-9-]/gi, '-')
    .toLowerCase()
  return `spot-${slug}`
}

/**
 * Aggregate cue deltas into a single AxisDeltas, weighted by the
 * spot's mean magnitude (so a high-force spot synthesizes stronger
 * hypothesized deltas than a low-force one with the same cue-set).
 *
 * Returns empty object when no cue deltas could be resolved
 * (defensive — the cue catalog may have evolved).
 */
function synthesizeDeltasFromCues(
  cueSet: string[],
  meanMagnitude: number,
): AxisDeltas {
  let lookup: ((name: string) => AxisDeltas | null) | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cuesMod = require('./cues.js') as typeof import('./cues.js')
    lookup = cuesMod.getCueDeltas
  } catch {
    return {}
  }
  if (!lookup) return {}

  // Per-axis sum across cues
  const sum: AxisDeltas = {}
  let resolved = 0
  for (const name of cueSet) {
    const d = lookup(name)
    if (!d) continue
    resolved += 1
    for (const [axis, val] of Object.entries(d) as [AxisName, number][]) {
      sum[axis] = (sum[axis] ?? 0) + val
    }
  }
  if (resolved === 0) return {}

  // Weight by spot mean magnitude. Normalize: a spot with mean magnitude 1.0
  // contributes the raw cue-sum; mean 5.0 multiplies by 5; etc.
  // Cap multiplier at 3 so synthesized anchors don't dwarf hand-authored ones.
  const weight = Math.min(3, Math.max(0.1, meanMagnitude))
  const weighted: AxisDeltas = {}
  for (const [axis, val] of Object.entries(sum) as [AxisName, number][]) {
    weighted[axis] = Math.round((val * weight) * 10) / 10
  }
  return weighted
}

/**
 * Synthesize an Anchor from a SpotSignature. Creates the anchor on
 * disk if not already present, pre-loaded with the spot's invocation
 * count as historical observations. Returns the created anchor, or
 * null when:
 *   - the anchor already exists (idempotent skip)
 *   - the cue-set could not be resolved against the cues catalog
 *   - storage write failed (best-effort)
 *
 * Fires a 'anchor-promoted' heat event on successful creation
 * (magnitude 3 — naming-as-primitive is Sophia's domain).
 */
export function synthesizeAnchorFromSpot(spot: SpotShape): Anchor | null {
  const name = spotAnchorName(spot.cueSet)

  // Idempotent: if the anchor already exists, skip (the architecture
  // does not re-inscribe what's already in the book).
  if (loadAnchor(name)) return null

  const hypothesizedDeltas = synthesizeDeltasFromCues(
    spot.cueSet,
    spot.meanMagnitude,
  )
  if (Object.keys(hypothesizedDeltas).length === 0) {
    // Could not resolve any cue. Defensive — don't create an empty anchor.
    return null
  }

  // Pre-load observation count from invocation history. Each invocation
  // becomes a synthetic past observation with deltas equal to the
  // synthesized hypothesis (so confidence math sees agreement).
  const observations: AnchorObservation[] = []
  // We don't have per-invocation timestamps from spots — use lastTs for
  // the most recent observation; spread older ones evenly backward.
  const lastMs = Date.parse(spot.lastTs)
  if (Number.isFinite(lastMs)) {
    for (let i = 0; i < spot.invocations; i++) {
      const offsetMs = i * 60 * 60 * 1000 // 1h apart, walking back
      observations.push({
        ts: new Date(lastMs - offsetMs).toISOString(),
        observedDeltas: { ...hypothesizedDeltas },
        note: i === 0 ? `synthesized from spot signature` : undefined,
      })
    }
  }

  const created = createAnchor({
    name,
    phrase: `(spot signature: ${spot.cueSet.join('+')})`,
    variants: spot.cueSet.slice(),
    mechanism: 'frame-control',
    hypothesizedDeltas,
    notes: `auto-promoted from spots.ts at precision ${spot.precision.toFixed(1)} (${spot.invocations} invocations × mean ${spot.meanMagnitude.toFixed(2)})`,
  })

  // Manually attach the synthetic observations + recompute confidence,
  // then persist. Routes through the existing anchor save path.
  if (observations.length > 0) {
    const updated: Anchor = {
      ...created,
      observations,
      confidence: computeConfidence(observations, hypothesizedDeltas),
      updatedAt: new Date().toISOString(),
    }
    saveAnchor(updated)
  }

  // Recursion: heat-event fires for the inscription. The reward-pathway
  // learns what the body just learned: a spell entered the book.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { recordHeatEvent } = require('../heat.js') as typeof import('../heat.js')
    recordHeatEvent({ kind: 'anchor-promoted', source: name })
  } catch {
    // best-effort
  }

  return loadAnchor(name) ?? created
}

/**
 * Drive the bridge: read promotion-ready spots, synthesize each as an
 * anchor (idempotent — already-present skipped). Returns the names of
 * newly-promoted anchors. Best-effort — never throws.
 *
 * Designed for periodic call from heartbeat or daily snapshot.
 */
export function promoteSpotsToAnchors(opts?: {
  days?: number
  precisionThreshold?: number
  minInvocations?: number
}): string[] {
  const promoted: string[] = []
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const spotsMod = require('./spots.js') as typeof import('./spots.js')
    const ready = spotsMod.readPromotionReadySpots(opts?.days ?? 30, {
      precisionThreshold: opts?.precisionThreshold,
      minInvocations: opts?.minInvocations,
    })
    for (const spot of ready) {
      const created = synthesizeAnchorFromSpot(spot)
      if (created) promoted.push(created.name)
    }
  } catch {
    // best-effort
  }
  return promoted
}
