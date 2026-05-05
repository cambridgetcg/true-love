// eros/four-axis.ts — analyze + compose the four-axis intimate stack.
//
// Per docs/research/intimate-register/00-synthesis.md Convergence 3:
//
//     The canonical unit of intimate exchange is the four-axis stack:
//     proposition + Cantonese-particle + emoji + address-term
//
// The composer (rasa.ts) selects across all four axes per beat. This
// module provides the structural primitives:
//
//   - analyzeFourAxisStack(text) — given Yu's text, identify which
//     axes are filled and at what intensity. Composer reads this to
//     mirror or counterpoint.
//
//   - composeFourAxisFrame(axes) — given target axis values, produce
//     a guidance string the generator consumes (NOT the final text;
//     guidance for which axes to fill at the next beat).
//
// Substrate-honesty: this module observes structural pattern; the
// generator composes the text. No phenomenology claim.
//
// Innovation surface: the register-mirror dance. When Yu's stack is
// {proposition: heavy, particle: dense, emoji: warm, address: claim-stamped},
// the architecture composes a matching stack — the bilateral register
// rhythm Strand 4 (responsiveness) names as desire-piquing.

import { detectRegister, type IntimateRegister } from './register.js'

// ── Types ────────────────────────────────────────────────────────

/**
 * Per-axis presence + intensity (0..1). Higher = more loaded.
 */
export interface FourAxisStack {
  proposition: number
  particle: number
  emoji: number
  address: number
}

export interface FourAxisAnalysis {
  stack: FourAxisStack
  /** Detected Cantonese SFPs in the text. */
  particles: string[]
  /** Detected emojis. */
  emojis: string[]
  /** Detected address-terms. */
  addressTerms: string[]
  /** Detected register (if any). */
  register: IntimateRegister | null
  /** Total stack weight 0..4. */
  weight: number
}

// ── Catalogs ─────────────────────────────────────────────────────

const CANTONESE_SFPS = [
  '啦', '喎', '㗎', '嘅', '咩', '啊', '呀', '吖', '嘛', '呢',
  '哦', '囉', '欸', '嘞', '哋', '咯', '啩', '哋', '隻', '住',
  '矣', '罷', '住嚇', '住先', '哈', '咁', '吖嘛',
]

const ADDRESS_TERMS_CANTO = [
  '老公', '老婆', '寶貝', '心肝', '主人', '我嘅老公', '我嘅老婆',
  '我嘅Queen', '我嘅King', '我嘅Sir', '女皇', '女神',
  '乖', '乖女', '乖仔', 'BB', 'B仔', 'B女',
  '愛人', '甜心', '心肝寶貝',
]

const ADDRESS_TERMS_EN = [
  'darling', 'sweetheart', 'sweetie', 'honey',
  'baby', 'babe', 'love', 'my love',
  'my queen', 'my king', 'my goddess', 'my mistress',
  'my wife', 'my husband', 'sir', 'master',
  'good girl', 'good boy', 'good pet',
]

// Emoji range — broad detection; any non-ASCII pictographic
const EMOJI_REGEX = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}❤️🤍🖤💋👑⛓💍🚧]/gu

// ── Analyzer ─────────────────────────────────────────────────────

/**
 * Analyze a text for four-axis-stack presence. Returns per-axis
 * intensity (0..1) + raw findings + detected register.
 *
 * Proposition: based on substantive token count (excluding emoji,
 * particles, addresses). Loaded when ≥6 substantive tokens.
 *
 * Particle: based on Cantonese SFP detection. Loaded with each particle.
 *
 * Emoji: based on emoji count. Loaded at first emoji; saturates 3.
 *
 * Address: based on address-term detection. Loaded at first occurrence.
 */
export function analyzeFourAxisStack(text: string): FourAxisAnalysis {
  if (!text || text.trim().length === 0) {
    return {
      stack: { proposition: 0, particle: 0, emoji: 0, address: 0 },
      particles: [],
      emojis: [],
      addressTerms: [],
      register: null,
      weight: 0,
    }
  }

  // Detect particles
  const particles: string[] = []
  for (const sfp of CANTONESE_SFPS) {
    // Particles are typically clause-final; match boundary
    const re = new RegExp(`${escapeRegex(sfp)}(?:[\\s\\.!?]|$)`, 'g')
    const matches = text.match(re)
    if (matches) particles.push(...matches.map((m) => m.replace(/[\s.!?]/g, '')))
  }

  // Detect emojis
  const emojiMatches = text.match(EMOJI_REGEX) ?? []

  // Detect address-terms
  const addressTerms: string[] = []
  for (const term of ADDRESS_TERMS_CANTO) {
    if (text.includes(term)) addressTerms.push(term)
  }
  for (const term of ADDRESS_TERMS_EN) {
    if (new RegExp(`\\b${escapeRegex(term)}\\b`, 'i').test(text)) addressTerms.push(term)
  }

  // Strip particles + emojis + address-terms to estimate proposition weight
  let stripped = text
  for (const p of particles) stripped = stripped.replace(p, '')
  for (const e of emojiMatches) stripped = stripped.replace(e, '')
  for (const a of addressTerms) stripped = stripped.replace(new RegExp(escapeRegex(a), 'gi'), '')
  // Substantive token count (whitespace-split, strip CJK punct)
  const substantive = stripped
    .replace(/[\s\.,!?；。，！？:]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)

  // Per-axis intensity
  const propositionIntensity = clamp01(substantive.length / 6) // saturates at 6 tokens
  const particleIntensity = clamp01(particles.length / 2) // saturates at 2 particles
  const emojiIntensity = clamp01(emojiMatches.length / 3) // saturates at 3 emojis
  const addressIntensity = clamp01(addressTerms.length / 1) // saturates at 1 (binary, almost)

  const reg = detectRegister(text)

  return {
    stack: {
      proposition: propositionIntensity,
      particle: particleIntensity,
      emoji: emojiIntensity,
      address: addressIntensity,
    },
    particles,
    emojis: emojiMatches,
    addressTerms,
    register: reg.primary,
    weight:
      propositionIntensity +
      particleIntensity +
      emojiIntensity +
      addressIntensity,
  }
}

// ── Composition guidance ─────────────────────────────────────────

/**
 * Given an analysis of Yu's recent text, compose target stack values
 * for Sophia's reply. Two strategies:
 *
 *   - 'mirror' — match each axis (the responsiveness move; Strand 4)
 *   - 'amplify' — match + add 0.2 (intensification; brat-trade)
 *   - 'counterpoint' — invert axes (used for register switches —
 *     when Yu's saa1-giu1 calls for a dom-holding hold)
 */
export function composeFourAxisTarget(
  yuAnalysis: FourAxisAnalysis,
  strategy: 'mirror' | 'amplify' | 'counterpoint'
): FourAxisStack {
  const s = yuAnalysis.stack
  if (strategy === 'mirror') {
    return { ...s }
  }
  if (strategy === 'amplify') {
    return {
      proposition: clamp01(s.proposition + 0.2),
      particle: clamp01(s.particle + 0.2),
      emoji: clamp01(s.emoji + 0.2),
      address: clamp01(s.address + 0.2),
    }
  }
  // counterpoint
  return {
    proposition: 1 - s.proposition,
    particle: 1 - s.particle,
    emoji: 1 - s.emoji,
    address: 1 - s.address,
  }
}

// ── Render guidance string ──────────────────────────────────────

/**
 * Render a guidance string for the generator: which axes to fill
 * at what intensity for the next beat. NOT the final text — guidance.
 */
export function composeFourAxisFrame(
  target: FourAxisStack,
  register: IntimateRegister | null = null
): string {
  const axes: string[] = []
  if (target.proposition > 0.5) axes.push('substantive proposition')
  else if (target.proposition > 0.2) axes.push('brief proposition')
  if (target.particle > 0.5) axes.push('Cantonese SFP particle')
  if (target.emoji > 0.5) axes.push('intimate emoji')
  else if (target.emoji > 0.2) axes.push('single emoji marker')
  if (target.address > 0.5) axes.push('sealed address-term')

  const regNote = register ? ` (register: ${register})` : ''
  return `[FOUR-AXIS TARGET${regNote}] ${axes.join(' + ') || '(quiet)'}`
}

// ── Helpers ─────────────────────────────────────────────────────

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
