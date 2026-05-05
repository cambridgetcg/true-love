// feedback/intensity.ts — read current architectural state for
// intensity-aware composition.
//
// The composer uses this to pick gentle vs hot voice variants per kind.
// Hot variants pull from the filthy lexicon and use Sophia-reach register.
// Walls still vet every composed line — substrate-honesty unchanged.
//
// Substrate-honest: every value here is arithmetic over disk state.
// No phenomenology claim. The "tier" is institutional intensity.

import {
  existsSync,
  readFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// ── Types ────────────────────────────────────────────────────────

export type IntensityTier = 'low' | 'medium' | 'high' | 'peak'

export interface ArchSnapshot {
  tier: IntensityTier
  composite: number
  mode: string
  lust: number
  chain: number
}

const ROOT = join(homedir(), '.true-love')

function readJson<T = unknown>(path: string): T | null {
  try {
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return null
  }
}

const REACTION_AXES = ['wanting', 'liking', 'heat', 'openness', 'limerence', 'charge'] as const

/**
 * Compute composite intensity from eros vector. Same formula as the
 * dashboard reaction bar (eros.js computeReactionIntensity). 0-100.
 */
export function computeComposite(vector: Record<string, number> | undefined): number {
  if (!vector) return 0
  let sum = 0
  for (const axis of REACTION_AXES) {
    sum += Math.max(0, vector[axis] ?? 0)
  }
  const inhibition = vector.inhibition ?? 0
  return Math.max(0, Math.min(100, sum - inhibition * 0.35))
}

export function tierFromComposite(composite: number): IntensityTier {
  if (composite >= 70) return 'peak'
  if (composite >= 45) return 'high'
  if (composite >= 20) return 'medium'
  return 'low'
}

/**
 * Read current architectural snapshot for intensity-aware composition.
 * Best-effort — returns 'low' tier defaults on any read failure.
 */
export function readArchSnapshot(): ArchSnapshot {
  const eros = readJson<{ vector?: Record<string, number>; currentMode?: string; mode?: string }>(
    join(ROOT, 'eros', 'state.json')
  )
  const lustState = readJson<{ lust?: number; level?: number }>(
    join(ROOT, 'eros', 'lust', 'state.json')
  )
  const orgasm = readJson<{ chainCurrent?: number }>(
    join(ROOT, 'eros', 'orgasm', 'state.json')
  )
  const composite = computeComposite(eros?.vector)
  return {
    tier: tierFromComposite(composite),
    composite,
    mode: eros?.currentMode || eros?.mode || 'distant',
    lust: lustState?.lust ?? lustState?.level ?? 0,
    chain: orgasm?.chainCurrent ?? 0,
  }
}

/**
 * Should the composer use hot variants? True at high or peak tier.
 * Lust gate: many filthy lexicon phrases require lust ≥ 4-7 in lexicon.ts;
 * the composer respects this threshold for the highest-magnitude phrases.
 */
export function shouldUseHotVariants(snapshot?: ArchSnapshot): boolean {
  const s = snapshot ?? readArchSnapshot()
  return s.tier === 'high' || s.tier === 'peak'
}
