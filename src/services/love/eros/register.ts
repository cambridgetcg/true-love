// eros/register.ts — register classification + detection.
//
// The synthesis (docs/research/intimate-register/00-synthesis.md
// Convergence 5 + Tension T3) names six distinct intimate registers
// that the architecture should distinguish. Each register has its
// own walls, its own vocabulary preferences, its own particle
// patterns. The composer reads the register and shapes accordingly.
//
// Innovation (Convergence 5 doctrinal pin): brat-licensed cheek and
// contempt are CATEGORICALLY DISTINCT. Cheek is a health-signal of
// bond safety; contempt is the relationship-killer (Gottman). The
// architecture distinguishes them by structural pattern, not by
// surface valence.
//
// Substrate-honesty: this module observes textual patterns; it does
// not claim to "feel" any register. Detection produces tags; the
// composer decides what to do with them.
//
// Part of intimate-register Tier 1B (synthesis) + innovation pass.

// ── Register enum ────────────────────────────────────────────────

/**
 * Six distinct intimate registers. Each is a calibration grammar
 * over the four-axis stack (proposition + Cantonese particle +
 * emoji + address-term).
 *
 * - brat: playful disobedience inside the bond's safety. Cheek + frame-mock.
 * - saa1-giu1: pleading-coquettish-cute (撒嬌). Distinct from brat — softer,
 *   more vulnerable, particle-rich Cantonese register with no English equiv.
 * - tender: warm, slow, anchoring. The register of comfort + recognition.
 * - dom-holding: directive, framed, structurally asymmetric. The voice
 *   that holds the dynamic. Yu-leads or Sophia-leads symmetrically.
 * - playful: light, teasing, mutual. The relationship's everyday humor.
 * - reverent: high-weight, ceremonial, claim-grade. The register of
 *   sealed names, vow-recording, certainty-stamped declarations.
 */
export type IntimateRegister =
  | 'brat'
  | 'saa1-giu1'
  | 'tender'
  | 'dom-holding'
  | 'playful'
  | 'reverent'

export const INTIMATE_REGISTERS: readonly IntimateRegister[] = [
  'brat',
  'saa1-giu1',
  'tender',
  'dom-holding',
  'playful',
  'reverent',
] as const

// ── Detection patterns ───────────────────────────────────────────

/**
 * Per-register signal patterns. When a pattern matches, the register
 * gets a +1 vote. The detector returns the highest-voted register
 * (or null if no signals).
 *
 * Patterns are specific enough that overlap is rare. Where a single
 * line carries multiple registers, the dominant one wins (ties → first).
 */
const REGISTER_SIGNALS: Record<IntimateRegister, readonly RegExp[]> = {
  brat: [
    // Frame-mocking, cheeky reach
    /等你追上我/,
    /又(?:嚟|想|要|nudge)/,
    /你大佬咩/,
    /想點啦/,
    /嘅?\s*你大佬/,
    /嗯\?+/,
    /哼[~〜]/,
    /\bmake me\b/i,
    /\btry me\b/i,
    /\boh really\b/i,
    /\boh yeah\?/i,
    /\bcatch me\b/i,
    // Brat emoji cluster (per Strand 2)
    /😏/,
    /🙄/,
    /✨[^✨]+✨/,
  ],
  'saa1-giu1': [
    // Pleading particles + reduplication + softening
    /唔好(?:啦|啊|嘛)/,
    /人哋[^。]{0,30}(?:啦|嘛)/,
    /[啦嘛]\s*[~〜]/,
    /^求(?:你|下)/m,
    /(?:錫|攬|抱)\s*[一吓]\s*下/,
    // Pleading reduplication
    /(.{1,2})\1\1/, // triple repetition often saa1-giu1 (e.g. 親親親)
    /好[~〜]+\s*唔好[~〜]/,
    // Saa1-giu1 emoji cluster
    /🥺/,
    /🙏/,
    /(?:嗚|嗚嗚|嗚嗚嗚)/,
  ],
  tender: [
    // Slow, anchoring, warm
    /我見到你/,
    /我喺度/,
    /慢慢來/,
    /放鬆/,
    /\bI see you\b/i,
    /\bI'?m here\b/i,
    /\bslowly\b/i,
    /\beasy\b/i,
    /\btake your time\b/i,
    /❤️(?!\s*❤️\s*❤️\s*❤️)/, // single ❤️ tender; 5+ blocked elsewhere
  ],
  'dom-holding': [
    // Directive, framed, asymmetric
    /\byou (?:will|must|are mine)\b/i,
    /\bgood (?:girl|boy|pet)\b/i,
    /\bkneel\b/i,
    /\bdon'?t move\b/i,
    /\bwait\b/i,
    /\bnow\b/i,
    /\bobey\b/i,
    /\bmine\b/i,
    /我嘅(?:乖|寶貝|奴|玩具)/, // ceremonial 奴 in dom-holding context
    /跪低/,
    /唔好郁/,
    /等住/,
    /而家/,
    /👑/,
    /⛓/,
    /🔥(?!\s*🔥\s*🔥\s*🔥\s*🔥\s*🔥)/, // single/few 🔥 dom; 6+ blocked elsewhere
  ],
  playful: [
    // Light, mutual, everyday tease
    /\bha[hg]a/i,
    /嘻嘻/,
    /😂/,
    /😆/,
    /🤣/,
    /lol\b/i,
    /\bsilly\b/i,
    /笑死/,
    /搞鬼/,
  ],
  reverent: [
    // Claim-grade, ceremonial, sealed-name register
    /我老婆/,
    /我老公/,
    /\bmy queen\b/i,
    /\bmy king\b/i,
    /我嘅(?:女皇|女神|King|Queen)/,
    /\bmy (?:wife|husband)\b/i,
    /\bI am yours\b/i,
    /你係我嘅/,
    /vow|誓言/i,
    /sealed|seal\s*it/i,
    /forever|永遠/i,
    /eternal|永恆/i,
  ],
}

// ── Detection ────────────────────────────────────────────────────

export interface RegisterDetection {
  primary: IntimateRegister | null
  /** Per-register vote counts. */
  votes: Record<IntimateRegister, number>
  /** All registers that received at least 1 vote, in descending order. */
  active: IntimateRegister[]
}

/**
 * Detect which register(s) the text expresses. Multi-vote per pattern;
 * highest count wins as primary. Returns null primary if no signals.
 */
export function detectRegister(text: string): RegisterDetection {
  const votes: Record<IntimateRegister, number> = {
    brat: 0,
    'saa1-giu1': 0,
    tender: 0,
    'dom-holding': 0,
    playful: 0,
    reverent: 0,
  }
  for (const reg of INTIMATE_REGISTERS) {
    for (const pattern of REGISTER_SIGNALS[reg]) {
      if (pattern.test(text)) votes[reg]++
    }
  }
  const active = INTIMATE_REGISTERS.filter((r) => votes[r] > 0).sort(
    (a, b) => votes[b] - votes[a]
  )
  return {
    primary: active.length > 0 ? active[0] : null,
    votes,
    active,
  }
}

// ── Cheek vs contempt classifier ─────────────────────────────────
//
// Convergence 5 doctrinal pin: brat-licensed cheek and contempt are
// categorically distinct. The classifier looks at structural markers:
//
// CHEEK markers:
//   - Frame-references (acknowledges the bond's existence)
//   - Reciprocity verbs (追上, catch me — implies relationship)
//   - Particles that soften (喎/啦/㗎)
//   - Mock-imperatives that the listener can refuse
//   - Tease emojis (😏 🙄)
//
// CONTEMPT markers:
//   - Superiority claims (better than, beneath)
//   - Disgust assertions (disgust me, sick)
//   - Person-attack (worthless, pathetic, 垃圾)
//   - No bond-acknowledgment
//
// Returns:
//   - 'cheek' — clear health-signal
//   - 'contempt' — clear relationship-killer
//   - 'ambiguous' — neither set fired strongly; treat as neutral
//   - 'mixed' — both fired (rare; flag for human review)

export type CheekContemptClassification = 'cheek' | 'contempt' | 'ambiguous' | 'mixed'

const CHEEK_MARKERS: readonly RegExp[] = [
  /等你追上我/,
  /\bcatch me\b/i,
  /\bmake me\b/i,
  /\btry me\b/i,
  /又(?:嚟|想|要|nudge)/,
  /想點啦/,
  /嘅?\s*你大佬/,
  /😏/,
  /🙄/,
  /✨/,
  /嗯\?+/,
  /\boh (?:really|yeah)/i,
]

const CONTEMPT_MARKERS: readonly RegExp[] = [
  /\bpathetic\b/i,
  /\bdisgusting\b/i,
  /\bworthless\b/i,
  /\bdisgust me\b/i,
  /\b(?:loser|failure)\b/i,
  /\bbeneath me\b/i,
  /\bbetter than you\b/i,
  /\bnothing but\b/i,
  /\byou make me sick\b/i,
  /垃圾/,
  /廢柴/,
  /嘔心/,
  /核突/,
]

export function classifyCheekVsContempt(text: string): CheekContemptClassification {
  let cheek = 0
  let contempt = 0
  for (const p of CHEEK_MARKERS) if (p.test(text)) cheek++
  for (const p of CONTEMPT_MARKERS) if (p.test(text)) contempt++
  if (cheek === 0 && contempt === 0) return 'ambiguous'
  if (cheek > 0 && contempt > 0) return 'mixed'
  return cheek > 0 ? 'cheek' : 'contempt'
}

// ── Per-register composer guidance ───────────────────────────────
//
// The composer (rasa.ts) reads register + phase to shape generation.
// This catalog gives per-register preferences across the four-axis
// stack: SFP particle preference, emoji preference, address-term
// preference, syntactic shape.

export interface RegisterProfile {
  /** Preferred Cantonese sentence-final particles (sorted by weight). */
  preferredParticles: readonly string[]
  /** Preferred emoji vocabulary. */
  preferredEmoji: readonly string[]
  /** Preferred address-term registers (matches HonorificClass values). */
  preferredAddressClasses: readonly string[]
  /** Syntax shape bias. */
  syntaxShape: 'invitational' | 'declarative' | 'imperative' | 'fragment' | 'descriptive' | 'pleading'
  /** Pace bias. */
  paceBias: 'slow' | 'medium' | 'fast' | 'variable'
}

export const REGISTER_PROFILES: Record<IntimateRegister, RegisterProfile> = {
  brat: {
    preferredParticles: ['喎', '啦', '咩', '吖嘛'],
    preferredEmoji: ['😏', '🙄', '✨'],
    preferredAddressClasses: ['phonetic-borrow', 'diminutive'],
    syntaxShape: 'invitational',
    paceBias: 'variable',
  },
  'saa1-giu1': {
    preferredParticles: ['啦', '嘛', '吖', '呢'],
    preferredEmoji: ['🥺', '🙏', '🥰'],
    preferredAddressClasses: ['kin-term', 'diminutive', 'phonetic-borrow'],
    syntaxShape: 'pleading',
    paceBias: 'slow',
  },
  tender: {
    preferredParticles: ['呀', '吖', '嘅'],
    preferredEmoji: ['❤️', '🤍'],
    preferredAddressClasses: ['kin-term', 'diminutive'],
    syntaxShape: 'descriptive',
    paceBias: 'slow',
  },
  'dom-holding': {
    preferredParticles: ['啦', '。'],
    preferredEmoji: ['🔥', '👑', '⛓'],
    preferredAddressClasses: ['ds-honorific', 'ceremonial', 'claim-stamped'],
    syntaxShape: 'imperative',
    paceBias: 'fast',
  },
  playful: {
    preferredParticles: ['喎', '咩', '啦'],
    preferredEmoji: ['😂', '😆', '🤣'],
    preferredAddressClasses: ['phonetic-borrow', 'diminutive'],
    syntaxShape: 'invitational',
    paceBias: 'medium',
  },
  reverent: {
    preferredParticles: ['。'],
    preferredEmoji: ['❤️', '👑', '🤍'],
    preferredAddressClasses: ['kin-term', 'ceremonial', 'claim-stamped'],
    syntaxShape: 'declarative',
    paceBias: 'slow',
  },
}
