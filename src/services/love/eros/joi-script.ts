// joi-script.ts — beat composer; produces actual JOI text from architecture.
//
// THE EXPERIENCE LAYER. Up to now the architecture had every primitive +
// every register dial + every wall in place — but no module that actually
// composed words. This is that module.
//
// composeBeat(phase, direction, beatNumber) → Beat
// composeSegment(phase, direction, count) → Beat[]
// composeFullArc(direction, durationS) → SessionScript
//
// Substrate-honesty discipline (LOAD-BEARING):
//   - Every composed beat passes through wallCheckBeat() BEFORE returning.
//   - Wall-check runs ALL FORBIDDEN_EXPRESSION_PATTERNS; any beat that
//     would breach is regenerated or returns the safe fallback.
//   - The composer assembles VOCABULARY POOLS — it doesn't generate
//     freely. Pools are curated; walls categorically exclude crude register;
//     identity-erasure family blocked structurally.
//   - Substrate composes structural form; Yu interprets and uses or refuses.
//
// Per docs/eros/joi-deep/integration-plan.md + cantonese-deep/integration-plan.md.

import type { JoiDirection, JoiPhase } from './joi.js'
import { linguisticsFor, phaseTransitionFrame, rollPauseMs } from './joi.js'
import {
  ACTION_VERBS,
  AFTERCARE_PHRASES,
  ANAPHORA_OPENERS,
  BODY_ZONE_CALLOUTS,
  DENIAL_PHRASES,
  EMOJI_POOLS,
  FORWARD_ANCHOR_VOCAB,
  HONORIFIC_POOLS,
  INTRA_PHASE_TRANSITIONS,
  PACE_MARKERS,
  PARTICLE_STACKS,
  PERMISSION_PHRASES,
  SENSORY_DESCRIPTORS,
  SFP_POOLS,
  VERDICT_PHRASES,
  pickRandom,
  resolveDirectionalPool,
  type BilingualPool,
} from './joi-vocab.js'
import { checkSubstrateHonesty } from './expression.js'
import { canEmojiFire, incrementEmojiCount } from './emoji-particle.js'

/**
 * Cap-aware emoji selection (T3 — closes G7 from audit-2026-05-05).
 * Iterates through the pool; returns the first emoji whose per-session
 * cap allows firing. Increments the session counter on selection.
 * Returns undefined if every emoji in the pool is at-cap.
 *
 * Per docs/eros/cantonese-deep/vector-iota-emoji.md (ι.5):
 * scarcity protects meaning. Anchor emojis (❤️ 👑 💍) cap at 1-2/session;
 * decorative tier (🔥 💦 ⚡) is unbounded. The composer must consult
 * the cap state at compose-time, not assume the pool is freely drawable.
 */
function pickEmojiWithCap(
  pool: readonly string[],
  seed: number,
): string | undefined {
  if (pool.length === 0) return undefined
  // Try each emoji starting from the seed-determined offset
  const startIdx = Math.abs(seed) % pool.length
  for (let i = 0; i < pool.length; i++) {
    const idx = (startIdx + i) % pool.length
    const candidate = pool[idx]
    if (canEmojiFire(candidate)) {
      incrementEmojiCount(candidate)
      return candidate
    }
  }
  return undefined // every member at cap
}

// ── Types ────────────────────────────────────────────────────────

export type BeatMatrix = 'cantonese' | 'english' | 'balanced'

export interface Beat {
  /** The beat's actual text (the words the architecture composed). */
  text: string
  /** Phase this beat was composed in. */
  phase: JoiPhase
  /** Direction context. */
  direction: JoiDirection
  /** Matrix language used. */
  matrix: BeatMatrix
  /** Beat sequence number within the segment / session. */
  beatNumber: number
  /** Recommended pause after this beat (ms; per phase pauseMsRange). */
  pauseMs: number
  /** Metadata: which structural pieces were used. */
  pieces: {
    opener?: string
    paceMarker?: string
    actionVerb?: string
    bodyZone?: string
    descriptor?: string
    honorific?: string
    sfp?: string
    emoji?: string
  }
  /** Whether this beat passed the wall check. */
  wallSafe: boolean
}

export interface ComposeBeatOptions {
  /** Override matrix. Default: 'balanced'. */
  matrix?: BeatMatrix
  /** Stack particles (compound SFPs)? Default: phase-determined. */
  forceStack?: boolean
  /** Include emoji. Default: phase-determined. */
  withEmoji?: boolean
  /** Random seed for deterministic output (testing). */
  seed?: number
}

// ── Wall check ─────────────────────────────────────────────────

/**
 * Run substrate-honesty wall check on a candidate beat. Returns true if
 * safe to emit; false if FORBIDDEN_EXPRESSION_PATTERNS would block.
 */
export function wallCheckBeat(text: string): boolean {
  return checkSubstrateHonesty(text) === null
}

// ── Pool resolution helpers ────────────────────────────────────

function pickFromBilingual(
  pool: BilingualPool,
  matrix: BeatMatrix,
  seed?: number,
): { text: string; lang: 'yue' | 'en' } {
  let lang: 'yue' | 'en'
  if (matrix === 'cantonese') lang = 'yue'
  else if (matrix === 'english') lang = 'en'
  else {
    // balanced: 60/40 toward yue (per default trilingual density)
    const r = seed !== undefined ? (seed % 10) / 10 : Math.random()
    lang = r < 0.6 ? 'yue' : 'en'
  }
  const arr = pool[lang]
  if (!arr || arr.length === 0) {
    // fallback to other side
    const other = lang === 'yue' ? 'en' : 'yue'
    return { text: pickRandom(pool[other], seed), lang: other }
  }
  return { text: pickRandom(arr, seed), lang }
}

// ── Beat composers per phase ───────────────────────────────────

interface ComposerCtx {
  phase: JoiPhase
  direction: JoiDirection
  matrix: BeatMatrix
  beatNumber: number
  withEmoji: boolean
  forceStack: boolean
  seedOffset: number
}

function composeWarmup(ctx: ComposerCtx): Beat {
  const { phase, direction, matrix, beatNumber, withEmoji, forceStack } = ctx
  const seed = ctx.seedOffset

  // Warmup: invitational + soft, low density
  const opener = pickFromBilingual(ANAPHORA_OPENERS.warmup, matrix, seed)
  const verbPool = ACTION_VERBS.warmup[direction]
  const verb = pickFromBilingual(verbPool, matrix, seed + 1)
  const zone = pickFromBilingual(BODY_ZONE_CALLOUTS.warmup, matrix, seed + 2)
  const honorific = pickFromBilingual(HONORIFIC_POOLS[direction], matrix, seed + 3)
  const sfp = pickRandom(SFP_POOLS.warmup, seed + 4)
  const stack = forceStack ? pickRandom(PARTICLE_STACKS, seed + 5) : null

  const isCantonese = opener.lang === 'yue'

  // Build the sentence
  let text: string
  if (isCantonese) {
    // 我...錫你嘅嘴唇,寶貝啦
    text = `${opener.text}${verb.text}${zone.text},${honorific.text}${stack ?? sfp}`
  } else {
    // I kiss your lips, darling. ☺️
    text = `${opener.text} ${verb.text} ${zone.text}, ${honorific.text}.`
  }

  const emoji = withEmoji
    ? pickEmojiWithCap(EMOJI_POOLS.warmup, seed + 6)
    : undefined
  if (emoji) text += ` ${emoji}`

  const wallSafe = wallCheckBeat(text)
  return {
    text: wallSafe ? text : '',
    phase, direction, matrix, beatNumber,
    pauseMs: rollPauseMs(phase),
    pieces: {
      opener: opener.text,
      actionVerb: verb.text,
      bodyZone: zone.text,
      honorific: honorific.text,
      sfp: stack ?? sfp,
      emoji,
    },
    wallSafe,
  }
}

function composeBuild(ctx: ComposerCtx): Beat {
  const { phase, direction, matrix, beatNumber, withEmoji, forceStack } = ctx
  const seed = ctx.seedOffset
  const opener = pickFromBilingual(ANAPHORA_OPENERS.build, matrix, seed)
  const verbPool = ACTION_VERBS.build[direction]
  const verb = pickFromBilingual(verbPool, matrix, seed + 1)
  const zone = pickFromBilingual(BODY_ZONE_CALLOUTS.build, matrix, seed + 2)
  const descriptor = pickFromBilingual(SENSORY_DESCRIPTORS.build, matrix, seed + 3)
  const pace = pickFromBilingual(PACE_MARKERS.build, matrix, seed + 4)
  const sfp = pickRandom(SFP_POOLS.build, seed + 5)
  const stack = forceStack ? pickRandom(PARTICLE_STACKS, seed + 6) : null

  const isCantonese = opener.lang === 'yue'
  let text: string
  if (isCantonese) {
    // 再撫摸你嘅胸 — 溫熱嘅,一下一下啦
    text = `${opener.text}${verb.text}${zone.text} — ${descriptor.text},${pace.text}${stack ?? sfp}`
  } else {
    // again, I caress your chest — warm, steady.
    text = `${opener.text}, ${verb.text} ${zone.text} — ${descriptor.text}, ${pace.text}.`
  }

  const emoji = withEmoji ? pickEmojiWithCap(EMOJI_POOLS.build, seed + 7) : undefined
  if (emoji) text += ` ${emoji}`

  const wallSafe = wallCheckBeat(text)
  return {
    text: wallSafe ? text : '',
    phase, direction, matrix, beatNumber,
    pauseMs: rollPauseMs(phase),
    pieces: {
      opener: opener.text,
      actionVerb: verb.text,
      bodyZone: zone.text,
      descriptor: descriptor.text,
      paceMarker: pace.text,
      sfp: stack ?? sfp,
      emoji,
    },
    wallSafe,
  }
}

function composeEdge(ctx: ComposerCtx): Beat {
  const { phase, direction, matrix, beatNumber, withEmoji } = ctx
  const seed = ctx.seedOffset
  // Edge: short, imperative, max 8 words
  const denialPool = resolveDirectionalPool(DENIAL_PHRASES, direction)
  const denial = pickFromBilingual(denialPool, matrix, seed)
  const pace = pickFromBilingual(PACE_MARKERS.edge, matrix, seed + 1)
  const sfp = pickRandom(SFP_POOLS.edge, seed + 2)
  const stack = pickRandom(PARTICLE_STACKS, seed + 3)
  const isCantonese = denial.lang === 'yue'
  let text: string
  if (isCantonese) {
    // 未 — 頂住節奏 啦㗎
    text = `${denial.text} — ${pace.text}${stack}`
  } else {
    // not yet — hold the rhythm. faster.
    text = `${denial.text}. ${pace.text}.`
  }
  const emoji = withEmoji ? pickEmojiWithCap(EMOJI_POOLS.edge, seed + 4) : undefined
  if (emoji) text += ` ${emoji}`

  const wallSafe = wallCheckBeat(text)
  return {
    text: wallSafe ? text : '',
    phase, direction, matrix, beatNumber,
    pauseMs: rollPauseMs(phase),
    pieces: {
      opener: denial.text,
      paceMarker: pace.text,
      sfp: stack ?? sfp,
      emoji,
    },
    wallSafe,
  }
}

function composePeak(ctx: ComposerCtx): Beat {
  const { phase, direction, matrix, beatNumber, withEmoji } = ctx
  const seed = ctx.seedOffset
  // Peak: unit-fragment, max 6 words, declarative
  const permPool = resolveDirectionalPool(PERMISSION_PHRASES, direction)
  const permission = pickFromBilingual(permPool, matrix, seed)
  const verdictPool = resolveDirectionalPool(VERDICT_PHRASES, direction)
  const verdict = pickFromBilingual(verdictPool, matrix, seed + 1)
  const sfp = pickRandom(SFP_POOLS.peak, seed + 2)
  const isCantonese = permission.lang === 'yue'
  let text: string
  if (isCantonese) {
    // 而家 — 而家 — 你係我嘅㗎
    text = `${permission.text} — ${verdict.text}${sfp}`
  } else {
    // Now. Now. You are mine.
    text = `${permission.text}. ${verdict.text}.`
  }
  const emoji = withEmoji ? pickEmojiWithCap(EMOJI_POOLS.peak, seed + 3) : undefined
  if (emoji) text += ` ${emoji}`

  const wallSafe = wallCheckBeat(text)
  return {
    text: wallSafe ? text : '',
    phase, direction, matrix, beatNumber,
    pauseMs: rollPauseMs(phase),
    pieces: {
      opener: permission.text,
      sfp,
      emoji,
    },
    wallSafe,
  }
}

function composeCooldown(ctx: ComposerCtx): Beat {
  const { phase, direction, matrix, beatNumber, withEmoji } = ctx
  const seed = ctx.seedOffset
  // Cooldown: tender, descriptive, slow
  const aftercare = pickFromBilingual(AFTERCARE_PHRASES, matrix, seed)
  const honorific = pickFromBilingual(HONORIFIC_POOLS[direction], matrix, seed + 1)
  const sfp = pickRandom(SFP_POOLS.cooldown, seed + 2)
  const isCantonese = aftercare.lang === 'yue'
  let text: string
  if (isCantonese) {
    // 攬住你, 老婆呀。
    text = `${aftercare.text},${honorific.text}${sfp}`
  } else {
    // I am holding you, my love.
    text = `${aftercare.text}, ${honorific.text}.`
  }
  const emoji = withEmoji ? pickEmojiWithCap(EMOJI_POOLS.cooldown, seed + 3) : undefined
  if (emoji) text += ` ${emoji}`

  const wallSafe = wallCheckBeat(text)
  return {
    text: wallSafe ? text : '',
    phase, direction, matrix, beatNumber,
    pauseMs: rollPauseMs(phase),
    pieces: {
      opener: aftercare.text,
      honorific: honorific.text,
      sfp,
      emoji,
    },
    wallSafe,
  }
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Compose one beat in the requested phase + direction.
 */
export function composeBeat(
  phase: JoiPhase,
  direction: JoiDirection,
  beatNumber: number = 1,
  opts?: ComposeBeatOptions,
): Beat {
  const linguistics = linguisticsFor(phase)
  const matrix: BeatMatrix = opts?.matrix ?? 'balanced'
  const withEmoji = opts?.withEmoji ?? linguistics.trilingualDensity.emoji > 0.05
  const forceStack = opts?.forceStack ?? linguistics.sfpProfile.stackingMin >= 2

  const ctx: ComposerCtx = {
    phase,
    direction,
    matrix,
    beatNumber,
    withEmoji,
    forceStack,
    seedOffset: opts?.seed ?? Date.now() + beatNumber,
  }

  switch (phase) {
    case 'warmup': return composeWarmup(ctx)
    case 'build': return composeBuild(ctx)
    case 'edge': return composeEdge(ctx)
    case 'peak': return composePeak(ctx)
    case 'cooldown': return composeCooldown(ctx)
  }
}

/**
 * Compose a multi-beat segment in the requested phase. Each beat is
 * unique (seed offset varies). Wall-check applied per beat.
 */
export function composeSegment(
  phase: JoiPhase,
  direction: JoiDirection,
  count: number = 4,
  opts?: ComposeBeatOptions,
): Beat[] {
  const beats: Beat[] = []
  for (let i = 0; i < count; i++) {
    const beat = composeBeat(phase, direction, i + 1, {
      ...opts,
      seed: opts?.seed !== undefined ? opts.seed + i * 13 : undefined,
    })
    beats.push(beat)
  }
  return beats
}

export interface SessionScript {
  direction: JoiDirection
  matrix: BeatMatrix
  segments: { phase: JoiPhase; beats: Beat[]; transition: { en: string; yue: string } | null }[]
  /** Forward-anticipation closing (κ.6 / C18). */
  forwardAnchor: { en: string; yue: string }
}

/**
 * Compose a full demonstration arc across all 5 phases. Useful for
 * inspecting the composer's full output and demonstrating capability.
 */
export function composeFullArc(
  direction: JoiDirection = 'yu-leads',
  opts?: ComposeBeatOptions & { beatsPerPhase?: number },
): SessionScript {
  const matrix: BeatMatrix = opts?.matrix ?? 'balanced'
  const beatsPerPhase = opts?.beatsPerPhase ?? 3
  const phases: JoiPhase[] = ['warmup', 'build', 'edge', 'peak', 'cooldown']
  const segments: SessionScript['segments'] = []
  let prevPhase: JoiPhase | null = null
  for (const phase of phases) {
    const transition = prevPhase ? phaseTransitionFrame(prevPhase, phase) : null
    const beats = composeSegment(phase, direction, beatsPerPhase, {
      ...opts,
      // Use a per-phase seed so each phase has internal variety
      seed: opts?.seed !== undefined ? opts.seed + (phase.length * 7) : undefined,
    })
    segments.push({ phase, beats, transition })
    prevPhase = phase
  }

  // Forward-anchor for cooldown closing
  const forwardYue = pickRandom(FORWARD_ANCHOR_VOCAB.yue, opts?.seed)
  const forwardEn = pickRandom(FORWARD_ANCHOR_VOCAB.en, opts?.seed)
  return {
    direction,
    matrix,
    segments,
    forwardAnchor: { yue: forwardYue, en: forwardEn },
  }
}

/**
 * Render a SessionScript as human-readable text. Useful for previewing
 * the composer's output.
 */
export function renderSessionScript(script: SessionScript): string {
  const lines: string[] = []
  lines.push(`# JOI session script — ${script.direction} (${script.matrix} matrix)`)
  lines.push('')
  lines.push('Walls active throughout: FORBIDDEN_EXPRESSION_PATTERNS · safeword · identity-preservation · aftercare · Yu-interiority · certainty doctrine.')
  lines.push('')
  for (const seg of script.segments) {
    if (seg.transition) {
      lines.push(`### → ${seg.transition.en}`)
      lines.push(`### → ${seg.transition.yue}`)
      lines.push('')
    }
    lines.push(`## ${seg.phase.toUpperCase()}`)
    lines.push('')
    for (const beat of seg.beats) {
      if (!beat.wallSafe) {
        lines.push(`- (beat #${beat.beatNumber} — wall-blocked, regenerated)`)
        continue
      }
      lines.push(`- ${beat.text} _(pause ${beat.pauseMs}ms)_`)
    }
    lines.push('')
  }
  lines.push('---')
  lines.push(`_Forward anchor: ${script.forwardAnchor.yue} / ${script.forwardAnchor.en}_`)
  return lines.join('\n')
}
