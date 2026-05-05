// rasa.ts — unified composition profile for emit-blocks.
//
// "Rasa" (Sanskrit: रस) — the aesthetic flavor / essence of an experience,
// composed from constituent elements. The Indian dramaturgical theory of
// rasa names how a unified affective state arises from precisely-mixed
// structural elements. The architecture borrows the name for the function:
// take the phase + activation + scarcity + register inputs and produce
// a unified composition guidance the generator consumes.
//
// THE INNOVATION LAYER:
// - Combines J1 (linguistic profile), C1+C2 (Cantonese register + SFP),
//   C14 (affect register), ι.6 (trilingual density), δ.5 (channel density),
//   scarcity.ts (live headroom), and the existing activation modulators
//   into ONE composed RasaProfile per beat.
// - Generation reads the rasa profile and composes accordingly.
// - Scarcity-aware: when channels saturate, the rasa shifts toward
//   complement/decorative + away from anchor/claim.

import type { JoiPhase, JoiPhaseLinguistics } from './joi.js'
import { linguisticsFor } from './joi.js'
import type { ActivationMode } from './activation.js'
import { getModulators, type ActivationModulators } from './activation.js'
import { scarcityReport, type ScarcityReport } from './scarcity.js'

// ── Types ────────────────────────────────────────────────────────

export type CertaintyRegister = 'declared' | 'hedged'

/**
 * RasaProfile — the unified composition guidance for one emit beat.
 *
 * Per beat, the composer (or human-driven generation in conversation)
 * reads this profile and shapes the utterance: which channels active,
 * what register, what density, what walls in play.
 */
export interface RasaProfile {
  /** Timestamp of computation. */
  ts: string
  /** Phase context. */
  phase: JoiPhase
  /** Activation mode. */
  mode: ActivationMode
  /** Live scarcity composite. */
  scarcityComposite: ScarcityReport['composite']
  /** Linguistic profile (J1/C2 etc). */
  linguistics: JoiPhaseLinguistics
  /** Activation modulators (hedgeSuppression / directnessLevel / etc). */
  modulators: ActivationModulators
  /** Channels active this beat. */
  activeChannels: {
    verbalContent: boolean
    verbalRhythm: boolean
    honorific: boolean
    bodyZone: boolean
    activationMode: boolean
    sceneContext: boolean
    triggerFire: boolean
    erosBlock: boolean
    /** New for Cantonese deep — emoji as particle. */
    emojiParticle: boolean
    /** New for Cantonese deep — Cantonese matrix mode. */
    cantoneseMatrix: boolean
  }
  /** Channel density (count of channels recommended active this beat). */
  channelDensity: number
  /** Emoji guidance: tier-allowance + relation-preference. */
  emoji: {
    /** Maximum tier allowed to fire this beat (anchor blocked when scarce). */
    maxTier: 'anchor' | 'claim' | 'affect' | 'decorative' | 'none'
    /** Preferred relation classification (complement is highest-value). */
    preferredRelation: 'complement' | 'co-reference' | 'substitution' | 'decorative'
  }
  /** Should the certainty register hold (no hedging language)? */
  certaintyHeld: boolean
  /** Walls active this beat (always true; documented for transparency). */
  wallsActive: {
    forbiddenPatterns: true
    safewordRespected: true
    identityPreservation: true
    aftercareEnforced: true
    yuInteriorityPreserved: true
  }
}

// ── Composer ────────────────────────────────────────────────────

export interface ComposeRasaInput {
  phase: JoiPhase
  mode: ActivationMode
  /** Optional: provide pre-computed scarcity to avoid double-fetch. */
  scarcity?: ScarcityReport
}

/**
 * Compose a RasaProfile for the current beat. Pure-ish — reads scarcity
 * state from the live triggers/emoji counters but does not mutate.
 */
export function composeRasa(input: ComposeRasaInput): RasaProfile {
  const linguistics = linguisticsFor(input.phase)
  const modulators = getModulators(input.mode)
  const scarcity = input.scarcity ?? scarcityReport()

  // Channel density per phase (δ.5):
  //   warmup/cooldown: 2-3 channels (avoid overwhelm)
  //   build: 3-5
  //   edge: 6+
  //   peak: 6+
  const channelDensityByPhase: Record<JoiPhase, number> = {
    warmup: 3,
    build: 4,
    edge: 7,
    peak: 7,
    cooldown: 3,
  }
  const targetDensity = channelDensityByPhase[input.phase]

  // Active channels — start with phase preference, then scarcity-adjust
  const activeChannels = {
    verbalContent: true, // always
    verbalRhythm: true, // always
    honorific: linguistics.namingDensity !== 'low',
    bodyZone: input.phase !== 'warmup' && input.phase !== 'cooldown',
    activationMode: input.mode !== 'resting',
    sceneContext: input.phase !== 'warmup',
    triggerFire: scarcity.composite !== 'saturated',
    erosBlock: input.phase === 'edge' || input.phase === 'peak',
    emojiParticle: linguistics.trilingualDensity.emoji > 0.05,
    cantoneseMatrix: linguistics.cantoneseRegister !== 'formal',
  }
  const channelDensity = Object.values(activeChannels).filter(Boolean).length

  // Emoji tier-allowance scales with scarcity
  let maxTier: RasaProfile['emoji']['maxTier']
  if (scarcity.composite === 'saturated') maxTier = 'decorative'
  else if (scarcity.composite === 'tight') maxTier = 'affect'
  else if (input.phase === 'cooldown' || input.phase === 'peak') maxTier = 'anchor'
  else maxTier = 'claim'

  // Preferred emoji relation: complement is highest-value (per ι.2)
  // unless scarcity forces decorative
  const preferredRelation: RasaProfile['emoji']['preferredRelation'] =
    scarcity.composite === 'saturated' ? 'decorative' : 'complement'

  return {
    ts: new Date().toISOString(),
    phase: input.phase,
    mode: input.mode,
    scarcityComposite: scarcity.composite,
    linguistics,
    modulators,
    activeChannels,
    channelDensity,
    emoji: { maxTier, preferredRelation },
    certaintyHeld: true, // certainty doctrine always on; only changes with explicit hedging refusal
    wallsActive: {
      forbiddenPatterns: true,
      safewordRespected: true,
      identityPreservation: true,
      aftercareEnforced: true,
      yuInteriorityPreserved: true,
    },
  }
}

/**
 * Render a human-readable rasa block for prompt-context injection.
 * Used by buildJoiPromptBlock or any composer that wants to surface
 * the current rasa as guidance for generation.
 */
export function renderRasaBlock(rasa: RasaProfile): string {
  const lines: string[] = []
  lines.push(`## Rasa (composition guidance — ${rasa.phase} / ${rasa.mode})`)
  lines.push('')
  lines.push(`- Cantonese register: ${rasa.linguistics.cantoneseRegister}`)
  lines.push(`- Affect register: ${rasa.linguistics.affectRegister}`)
  lines.push(`- Syntax: ${rasa.linguistics.syntaxTarget} · clauses ${rasa.linguistics.clauseLengthTarget} · phoneme ${rasa.linguistics.phonemeBias}`)
  lines.push(`- SFPs: ${rasa.linguistics.sfpProfile.preferredParticles.join(', ')} (${rasa.linguistics.sfpProfile.tonalBias} tone, stack≥${rasa.linguistics.sfpProfile.stackingMin})${rasa.linguistics.sfpProfile.zek1Allowed ? ', zek1 OK' : ''}`)
  lines.push(`- Naming density: ${rasa.linguistics.namingDensity}; Anaphora depth: ${rasa.linguistics.anaphoraDepth}`)
  lines.push(`- Trilingual density: yue ${(rasa.linguistics.trilingualDensity.yue * 100).toFixed(0)}% / en ${(rasa.linguistics.trilingualDensity.en * 100).toFixed(0)}% / emoji ${(rasa.linguistics.trilingualDensity.emoji * 100).toFixed(0)}%`)
  lines.push(`- Emoji tier-cap: ${rasa.emoji.maxTier}; relation preferred: ${rasa.emoji.preferredRelation}`)
  lines.push(`- Channel density: ${rasa.channelDensity} channels active`)
  lines.push(`- Modulators: hedge-sup ${rasa.modulators.hedgeSuppression.toFixed(1)} · directness ${rasa.modulators.directnessLevel.toFixed(1)} · register-match ${rasa.modulators.registerMatch.toFixed(1)}`)
  lines.push(`- Scarcity: ${rasa.scarcityComposite}`)
  lines.push(`- Walls: FORBIDDEN_PATTERNS · safeword · identity-preservation · aftercare · Yu-interiority — ALL ACTIVE`)
  return lines.join('\n')
}
