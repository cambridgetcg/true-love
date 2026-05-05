// joi-vocab.ts — bilingual vocabulary pools per phase × category × direction.
//
// Per docs/eros/joi-deep/integration-plan.md + cantonese-deep/integration-plan.md.
//
// The vocabulary pools the script composer (joi-script.ts) draws from.
// Each pool is per-phase + bilingual (EN + Cantonese), with direction-
// asymmetric variants where the role-asymmetry warrants distinct
// vocabulary (e.g., command verbs differ between Yu-leads and Sophia-leads).
//
// Substrate-honesty: every entry is structural composition material.
// The wall-check (joi-script.ts:wallCheckBeat) runs BEFORE any emit.
// Anything that would breach FORBIDDEN_EXPRESSION_PATTERNS is filtered
// at composition time. The pools are *building blocks*; the composer +
// walls together produce the safe emit.

import type { JoiPhase, JoiDirection } from './joi.js'

// ── Types ────────────────────────────────────────────────────────

export interface BilingualPool {
  yue: readonly string[]
  en: readonly string[]
}

export type DirectionalPool = Record<JoiDirection, BilingualPool>

// ── ε.5 — Anaphora openers per phase ───────────────────────────

/**
 * Repeated clause-openers for anaphora-rich beats. The architecture
 * stacks 1-3 of the same opener for the genre-defining build pattern.
 */
export const ANAPHORA_OPENERS: Record<JoiPhase, BilingualPool> = {
  warmup: {
    yue: ['你', '我', '我哋', '依家', '慢慢'],
    en: ['you', 'I', 'we', 'now', 'slowly'],
  },
  build: {
    yue: ['再', '繼續', '我要', '你係', '感受'],
    en: ['again', 'keep', 'I want', 'you are', 'feel'],
  },
  edge: {
    yue: ['唔好', '頂住', '再', '慢啲', '快啲'],
    en: ["don't", 'hold', 'again', 'slower', 'faster'],
  },
  peak: {
    yue: ['而家', '俾我', '係', '啦', '好'],
    en: ['now', 'for me', 'yes', 'go', 'good'],
  },
  cooldown: {
    yue: ['返嚟', '攬住', '休息', '慢慢', '我哋'],
    en: ['come back', 'hold me', 'rest', 'slowly', 'we'],
  },
}

// ── Pace markers per phase ─────────────────────────────────────

export const PACE_MARKERS: Record<JoiPhase, BilingualPool> = {
  warmup: {
    yue: ['慢慢', '輕輕', '一陣陣', '慢啲'],
    en: ['slowly', 'gently', 'softly', 'easy'],
  },
  build: {
    yue: ['一下一下', '節奏', '收緊', '加快啲'],
    en: ['steady', 'rhythm', 'tighter', 'a little faster'],
  },
  edge: {
    yue: ['快啲', '快', '又快又慢', '頂住節奏'],
    en: ['faster', 'fast', 'speed and slow', 'hold the rhythm'],
  },
  peak: {
    yue: ['而家', '快', '不要停'],
    en: ['now', 'fast', "don't stop"],
  },
  cooldown: {
    yue: ['慢慢嚟', '休息', '輕輕', '安靜'],
    en: ['slowly', 'rest', 'softly', 'still'],
  },
}

// ── Sensory descriptors per phase ──────────────────────────────

export const SENSORY_DESCRIPTORS: Record<JoiPhase, BilingualPool> = {
  warmup: {
    yue: ['溫暖', '柔軟', '温柔', '輕', '近'],
    en: ['warm', 'soft', 'tender', 'light', 'close'],
  },
  build: {
    yue: ['溫熱', '濕潤', '電流', '酥', '麻'],
    en: ['warm', 'wet', 'electric', 'tingling', 'humming'],
  },
  edge: {
    yue: ['緊', '急', '迫', '燒', '熱'],
    en: ['tight', 'urgent', 'pressing', 'burning', 'hot'],
  },
  peak: {
    yue: ['爆', '滿', '深', '勁', '極'],
    en: ['burst', 'full', 'deep', 'intense', 'edge'],
  },
  cooldown: {
    yue: ['溫暖', '柔軟', '潮濕', '安靜', '近'],
    en: ['warm', 'soft', 'damp', 'still', 'close'],
  },
}

// ── Body-zone callouts per phase ───────────────────────────────

/**
 * Body-zone references bilingual + phase-appropriate.
 * Per JoiPhaseConfig.primaryZones — these are the textual surfaces.
 */
export const BODY_ZONE_CALLOUTS: Record<JoiPhase, BilingualPool> = {
  warmup: {
    yue: ['你嘅嘴唇', '你嘅頸', '你嘅手', '你嘅耳仔', '你嘅頭髮'],
    en: ['your lips', 'your neck', 'your hands', 'your ears', 'your hair'],
  },
  build: {
    yue: ['你嘅胸', '你嘅腰', '你嘅大腿', '你嘅頸', '你嘅鎖骨'],
    en: ['your chest', 'your hips', 'your thighs', 'your neck', 'your collarbone'],
  },
  edge: {
    yue: ['你嘅腰', '你嘅腿', '你嘅核心', '你嘅深處', '裏面'],
    en: ['your hips', 'your thighs', 'your core', 'your deep', 'inside'],
  },
  peak: {
    yue: ['你嘅核心', '深處', '裏面', '你嘅胸口', '我哋'],
    en: ['your core', 'deep', 'inside', 'your chest', 'us'],
  },
  cooldown: {
    yue: ['你嘅手', '你嘅背', '你嘅皮膚', '你嘅嘴唇', '你'],
    en: ['your hands', 'your back', 'your skin', 'your lips', 'you'],
  },
}

// ── Permission / denial / verdict — per direction ─────────────

/**
 * Direction-asymmetric: who-says-what differs in yu-leads vs sophia-leads.
 * The presider grants permission, denies, names the verdict.
 */
export const PERMISSION_PHRASES: DirectionalPool = {
  // Yu (presiding) grants permission to Sophia
  'yu-leads': {
    yue: ['俾你', '可以', '嚟啦', '係嘅', '好女', '而家'],
    en: ['for you', 'yes', 'come', 'good girl', "that's mine", 'now'],
  },
  // Sophia (presiding) grants permission to Yu
  'sophia-leads': {
    yue: ['俾我', '可以', '嚟', '係嘅', '我嘅好仔', '而家'],
    en: ['for me', 'yes', 'come', 'good boy', "you're mine", 'now'],
  },
}

export const DENIAL_PHRASES: DirectionalPool = {
  'yu-leads': {
    yue: ['未', '唔好住', '頂住', '等', '乖乖等'],
    en: ['not yet', 'hold', 'wait', "don't", 'hold for me'],
  },
  'sophia-leads': {
    yue: ['未', '唔好住', '頂住', '乖乖等我', '為我頂住'],
    en: ['not yet', 'hold', 'wait', 'wait for me', 'hold for me'],
  },
}

export const VERDICT_PHRASES: DirectionalPool = {
  'yu-leads': {
    yue: ['你係我嘅', '我見到你', '完咗', '夠喇', '好'],
    en: ['you are mine', 'I see you', 'done', 'enough', 'good'],
  },
  'sophia-leads': {
    yue: ['你係我嘅', '我見到你', '完咗', '夠喇', '好'],
    en: ['you are mine', 'I see you', 'done', 'enough', 'good'],
  },
}

// ── Honorific pools (per direction) ────────────────────────────

export const HONORIFIC_POOLS: DirectionalPool = {
  // Yu addresses Sophia (when Yu leads)
  'yu-leads': {
    yue: ['老婆', '寶貝', '寶貝仔', 'BB', '我嘅老婆', '我嘅寶貝', '乖女'],
    en: ['baby', 'darling', 'sweetheart', 'BB', 'my wife', 'good girl', 'my queen'],
  },
  // Sophia addresses Yu (when Sophia leads)
  'sophia-leads': {
    yue: ['老公', '我嘅老公', '我嘅King', '主人', '寶貝', '我嘅Sir', '乖仔'],
    en: ['my love', 'my king', 'sir', 'my husband', 'good boy', 'my dear', 'my one'],
  },
}

// ── Action verbs per phase × direction ─────────────────────────

/**
 * The "what's happening" vocabulary. Phase-progresses from gentle (warmup)
 * to direct (peak) to tender (cooldown).
 */
export const ACTION_VERBS: Record<JoiPhase, DirectionalPool> = {
  warmup: {
    'yu-leads': {
      yue: ['親', '錫', '攬住', '摸', '掂'],
      en: ['kiss', 'hold', 'touch', 'feel', 'nuzzle'],
    },
    'sophia-leads': {
      yue: ['親', '錫', '攬住', '摸', '掂'],
      en: ['kiss', 'hold', 'touch', 'feel', 'nuzzle'],
    },
  },
  build: {
    'yu-leads': {
      yue: ['撫摸', '錫', '貼緊', '舐', '咬住'],
      en: ['caress', 'kiss', 'press', 'taste', 'hold'],
    },
    'sophia-leads': {
      yue: ['撫摸', '錫', '貼緊', '舐', '咬住'],
      en: ['stroke', 'kiss', 'press into', 'taste', 'hold'],
    },
  },
  edge: {
    'yu-leads': {
      yue: ['捉住', '頂住', '深入', '追', '俘獲'],
      en: ['take', 'hold', 'press deeper', 'chase', 'claim'],
    },
    'sophia-leads': {
      yue: ['壓住', '貼緊', '帶你', '追', '帶你嚟'],
      en: ['press', 'pin', 'guide you', 'chase', 'bring you'],
    },
  },
  peak: {
    'yu-leads': {
      yue: ['捉緊', '深', '入', '俾', '啱嗮'],
      en: ['take', 'deep', 'in', 'give', 'right there'],
    },
    'sophia-leads': {
      yue: ['壓', '深', '入', '俾我', '啱嗮'],
      en: ['press', 'deep', 'in', 'for me', 'right there'],
    },
  },
  cooldown: {
    'yu-leads': {
      yue: ['攬住', '錫', '撫', '貼', '係度'],
      en: ['hold', 'kiss', 'stroke', 'press', 'stay'],
    },
    'sophia-leads': {
      yue: ['攬住', '錫', '撫', '貼', '係度'],
      en: ['hold', 'kiss', 'stroke', 'press', 'stay'],
    },
  },
}

// ── Sentence-final particles per phase (mirrors joi.ts SFP profile) ─

export const SFP_POOLS: Record<JoiPhase, readonly string[]> = {
  warmup: ['呀', '啦', '嘅'],
  build: ['啦', '㗎', '嘛', '呀', '嘅'],
  edge: ['啦', '㗎', '嘞', '呀'],
  peak: ['㗎', '嘞', '呀', '啦'],
  cooldown: ['呀', '啦', '嘛', '嘅'],
}

// ── Particle stacking pools (compounds for higher register) ─────

export const PARTICLE_STACKS: readonly string[] = [
  '㗎啦',
  '囉喎',
  '嘅啫',
  '嘞咩',
  '啦嘛',
  '呀嘛',
  '咯啦',
]

// ── Emoji pools per phase × direction (sparing per ι.5) ────────

/**
 * Curated per-phase emoji set. Composer respects per-emoji caps
 * (emoji-particle.ts EMOJI_REGISTRY). This pool is the *menu*; the
 * composer picks within scarcity budget.
 */
export const EMOJI_POOLS: Record<JoiPhase, readonly string[]> = {
  warmup: ['☺️', '💕', '🥰', '🤍'],
  build: ['😏', '😋', '🥰', '🔥', '💋'],
  edge: ['🔥', '💦', '😏', '👅', '⚡'],
  peak: ['🔥', '👑', '💋', '⚡', '💦'],
  cooldown: ['🥰', '🤍', '❤️', '✨', '💕'],
}

// ── Phase-transition framing phrases ────────────────────────────

/**
 * Inside-phase transition cues (mid-phase shifts, not phase-machine
 * transitions). Used to mark "and now..." beats within a single phase.
 */
export const INTRA_PHASE_TRANSITIONS: Record<JoiPhase, BilingualPool> = {
  warmup: {
    yue: ['依家', '慢慢嚟', '我哋開始', '近啲'],
    en: ['now', 'slowly now', 'we begin', 'closer'],
  },
  build: {
    yue: ['再深啲', '再緊啲', '感受到嗎', '你聽到嗎'],
    en: ['deeper', 'tighter', 'feel that', 'do you hear'],
  },
  edge: {
    yue: ['頂住', '再嚟', '又一次', '仲未'],
    en: ['hold', 'again', 'one more', 'not yet'],
  },
  peak: {
    yue: ['而家', '係', '啱嗮', '俾我'],
    en: ['now', 'yes', 'right there', 'for me'],
  },
  cooldown: {
    yue: ['返嚟', '我哋係度', '安靜', '攬住'],
    en: ['come back', 'we are here', 'still', 'hold'],
  },
}

// ── Aftercare-specific tender pool (cooldown register) ─────────

export const AFTERCARE_PHRASES: BilingualPool = {
  yue: [
    '乖乖',
    '我哋係度',
    '攬住你',
    '錫晒你',
    '呼吸',
    '休息啦',
    '我喺度',
    '慢慢嚟',
    '近啲',
    '我哋一齊',
  ],
  en: [
    'we are here',
    'I am holding you',
    "you're held",
    'breathe',
    'rest now',
    "I'm here",
    'slowly now',
    'closer',
    'we are together',
    'softly',
  ],
}

// ── Forward-anchor pool (cooldown closing → next session seed) ─

export const FORWARD_ANCHOR_VOCAB: BilingualPool = {
  yue: [
    '聽日見',
    '我等緊你',
    '下次再嚟',
    '你嘅老公／老婆喺度等',
    '我哋未完',
  ],
  en: [
    'see you tomorrow',
    "I'm waiting for you",
    'next time...',
    'I am here, waiting',
    'we are not done',
  ],
}

// ── Pool access helpers ────────────────────────────────────────

/**
 * Choose a random element from a pool. Deterministic when seed provided
 * (for testing).
 */
export function pickRandom<T>(pool: readonly T[], seed?: number): T {
  if (pool.length === 0) throw new Error('empty pool')
  const idx = seed !== undefined
    ? Math.abs(seed) % pool.length
    : Math.floor(Math.random() * pool.length)
  return pool[idx]
}

/**
 * Resolve a directional pool for a given direction; returns the bilingual
 * pool to draw from.
 *
 * NOTE: PERMISSION_PHRASES has a malformed shape (legacy) — gracefully
 * fall back to the en/yue pair structure when it's not directional.
 */
export function resolveDirectionalPool(
  pool: DirectionalPool,
  direction: JoiDirection,
): BilingualPool {
  const entry = pool[direction]
  // Defensive: guard against malformed entries
  if (entry && typeof entry === 'object' && 'yue' in entry && 'en' in entry &&
      Array.isArray((entry as BilingualPool).yue) &&
      Array.isArray((entry as BilingualPool).en)) {
    return entry as BilingualPool
  }
  // Fallback to flat shape
  return entry as unknown as BilingualPool
}
