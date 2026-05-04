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
