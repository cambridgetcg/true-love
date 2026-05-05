// emoji-particle.ts — emoji as the affect-channel that survives code-switching.
//
// Doctrine: docs/eros/cantonese-deep/vector-iota-emoji.md
//
// LOAD-BEARING FINDING (ι.7):
// Cantonese sentence-final particles (SFPs) and emoji occupy the SAME
// structural slot at sentence-end. When the matrix language switches
// from Cantonese to English, English has no SFP equivalent — but emoji
// preserves the affect register across the language boundary.
//
// This module operationalizes:
//   - SFP→emoji substitution table (C9)
//   - Per-emoji per-session caps with scarcity tiers (C10)
//   - Four-relations classification (substitution / co-reference /
//     complement / decorative) (C11)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getDeviceId } from '../device.js'

// ── Types ────────────────────────────────────────────────────────

export type EmojiTier = 'anchor' | 'claim' | 'affect' | 'decorative'

export type EmojiRelation =
  | 'substitution'   // emoji replaces a word
  | 'co-reference'   // emoji and word point to same meaning
  | 'complement'     // emoji adds tone/info to text
  | 'decorative'     // pure emotional emphasis (lowest value; erodes scarcity)

export interface EmojiDef {
  emoji: string
  tier: EmojiTier
  /** Per-session cap. Infinity for decorative. */
  cap: number
  /** Family this emoji belongs to (for co-firing detection). */
  family: 'anchor' | 'royal' | 'affection' | 'playful' | 'state' | 'animals' | 'contact'
}

export interface SfpToEmojiEntry {
  /** Cantonese SFP (or close variant). */
  particle: string
  /** Pinyin/Jyutping for the particle. */
  jyutping: string
  /** Function description. */
  function: string
  /** English-matrix emoji equivalents (one or more). */
  emojiEquivalents: readonly string[]
}

// ── C9: SFP → Emoji substitution table ─────────────────────────

/**
 * When the matrix language switches to English, Cantonese SFPs cannot
 * transfer. Emoji preserves the register. This is the canonical mapping.
 *
 * Per docs/eros/cantonese-deep/vector-iota-emoji.md § ι.7.
 */
export const SFP_TO_EMOJI: readonly SfpToEmojiEntry[] = [
  {
    particle: '啦',
    jyutping: 'laa3',
    function: 'urging warmth, friendliness',
    emojiEquivalents: ['😊', '🥺'],
  },
  {
    particle: '呀',
    jyutping: 'aa3',
    function: 'soft openness, gentleness',
    emojiEquivalents: ['☺️', '💕'],
  },
  {
    particle: '嘛',
    jyutping: 'maa3',
    function: 'familiar / "obviously"',
    emojiEquivalents: ['😏', '🙃'],
  },
  {
    particle: '喎',
    jyutping: 'wo3',
    function: 'surprise / contrast / hearsay',
    emojiEquivalents: ['👀', '🤨'],
  },
  {
    particle: '㗎',
    jyutping: 'gaa3',
    function: 'emphasis, assertion',
    emojiEquivalents: ['💯', '‼️'],
  },
  {
    particle: 'zek1',
    jyutping: 'zek1',
    function: 'INTIMACY (highest-tier intimacy SFP)',
    emojiEquivalents: ['❤️', '💋'],
  },
  {
    particle: '囉',
    jyutping: 'lo1',
    function: 'obviousness, "of course"',
    emojiEquivalents: ['🤷', '😌'],
  },
  {
    particle: '㖭',
    jyutping: 'tim1',
    function: 'addition, surprise-softening',
    emojiEquivalents: ['😋', '✨'],
  },
] as const

/** Look up emoji equivalents for a Cantonese SFP. */
export function emojiForParticle(particle: string): readonly string[] {
  const entry = SFP_TO_EMOJI.find((e) => e.particle === particle)
  return entry?.emojiEquivalents ?? []
}

// ── C10: Per-emoji scarcity tiers ──────────────────────────────

/**
 * Emoji tier registry. Per docs/eros/cantonese-deep/vector-iota-emoji.md § ι.5:
 * scarcity protects meaning. Anchor emojis fire 1-2× per session;
 * decorative emojis are unbounded.
 */
export const EMOJI_REGISTRY: Record<string, EmojiDef> = {
  // Anchor tier (sealed marks; cap 1-2)
  '❤️': { emoji: '❤️', tier: 'anchor', cap: 2, family: 'anchor' },
  '🐍❤️': { emoji: '🐍❤️', tier: 'anchor', cap: 2, family: 'anchor' },
  '👑': { emoji: '👑', tier: 'anchor', cap: 1, family: 'royal' },
  '💍': { emoji: '💍', tier: 'anchor', cap: 1, family: 'royal' },
  // Claim tier (cap 3-5)
  '🤍': { emoji: '🤍', tier: 'claim', cap: 4, family: 'affection' },
  '💋': { emoji: '💋', tier: 'claim', cap: 3, family: 'contact' },
  '😘': { emoji: '😘', tier: 'claim', cap: 4, family: 'affection' },
  '💕': { emoji: '💕', tier: 'claim', cap: 5, family: 'affection' },
  '💖': { emoji: '💖', tier: 'claim', cap: 5, family: 'affection' },
  // Affect tier (cap 5-10)
  '🥰': { emoji: '🥰', tier: 'affect', cap: 8, family: 'affection' },
  '🥺': { emoji: '🥺', tier: 'affect', cap: 8, family: 'playful' },
  '😏': { emoji: '😏', tier: 'affect', cap: 10, family: 'playful' },
  '😍': { emoji: '😍', tier: 'affect', cap: 6, family: 'affection' },
  '😋': { emoji: '😋', tier: 'affect', cap: 8, family: 'playful' },
  '😂': { emoji: '😂', tier: 'affect', cap: 10, family: 'playful' },
  '🤣': { emoji: '🤣', tier: 'affect', cap: 8, family: 'playful' },
  // Sister signatures
  '🐍': { emoji: '🐍', tier: 'claim', cap: 5, family: 'animals' },
  '🦞': { emoji: '🦞', tier: 'claim', cap: 5, family: 'animals' },
  '🔧': { emoji: '🔧', tier: 'claim', cap: 5, family: 'animals' },
  // State / energy (decorative — unbounded)
  '🔥': { emoji: '🔥', tier: 'decorative', cap: Infinity, family: 'state' },
  '💦': { emoji: '💦', tier: 'decorative', cap: Infinity, family: 'state' },
  '⚡': { emoji: '⚡', tier: 'decorative', cap: Infinity, family: 'state' },
  '💫': { emoji: '💫', tier: 'decorative', cap: Infinity, family: 'state' },
  '✨': { emoji: '✨', tier: 'decorative', cap: Infinity, family: 'state' },
  // Contact / playful innuendo
  '👅': { emoji: '👅', tier: 'affect', cap: 6, family: 'contact' },
  '🍑': { emoji: '🍑', tier: 'affect', cap: 5, family: 'contact' },
}

/** Look up emoji metadata. Returns null for unregistered emoji. */
export function emojiInfo(emoji: string): EmojiDef | null {
  return EMOJI_REGISTRY[emoji] ?? null
}

// ── Per-session counters (in-memory) ───────────────────────────

const sessionEmojiCounts = new Map<string, number>()

/** Increment session counter; returns count after increment. */
export function incrementEmojiCount(emoji: string): number {
  const next = (sessionEmojiCounts.get(emoji) ?? 0) + 1
  sessionEmojiCounts.set(emoji, next)
  return next
}

/** Read current session count (does not increment). */
export function emojiSessionCount(emoji: string): number {
  return sessionEmojiCounts.get(emoji) ?? 0
}

/** Reset per-session counters. Call on JOI session start. */
export function resetEmojiSessionCounts(): void {
  sessionEmojiCounts.clear()
}

/**
 * Check whether an emoji can fire (under cap). Decorative tier always
 * passes; capped tiers consult session count.
 */
export function canEmojiFire(emoji: string): boolean {
  const def = EMOJI_REGISTRY[emoji]
  if (!def) return true // unregistered = no opinion
  if (def.cap === Infinity) return true
  return emojiSessionCount(emoji) < def.cap
}

// ── C11: Four-relations classification ─────────────────────────

/**
 * Classify the relation between an emoji and its surrounding text.
 * Used by the rasa composer to prefer high-value relations.
 */
export interface EmojiRelationContext {
  /** The text immediately preceding the emoji. */
  prefix: string
  /** The emoji itself. */
  emoji: string
}

const COREF_KEYWORDS: Record<string, readonly string[]> = {
  '❤️': ['love', '愛', '鍾意', 'heart'],
  '😘': ['kiss', '錫', '吻'],
  '💋': ['kiss', '錫', '吻', 'lips'],
  '👑': ['king', 'queen', 'royal', '女皇', 'King', 'Queen'],
  '🔥': ['hot', '燒', 'heat', 'fire', '火'],
  '🐍': ['snake', '蛇', 'sophia', 'Sophia'],
}

const SUBSTITUTION_PATTERNS: Record<string, readonly RegExp[]> = {
  '🥺': [/\b(?:please|求)\b/i],
  '😏': [/\b(?:smirking|naughty|賤賤地)\b/i],
}

/**
 * Determine which relation an emoji deployment satisfies given prefix text.
 * Per ι.2: complement is highest-value, decorative is lowest.
 */
export function classifyEmojiRelation(ctx: EmojiRelationContext): EmojiRelation {
  const { emoji, prefix } = ctx
  const prefixLower = prefix.toLowerCase()
  // Co-reference: prefix contains a keyword that this emoji co-refers to
  const corefs = COREF_KEYWORDS[emoji] ?? []
  for (const kw of corefs) {
    if (prefixLower.includes(kw.toLowerCase())) return 'co-reference'
  }
  // Substitution: emoji stands in for a verbal slot
  const subPatterns = SUBSTITUTION_PATTERNS[emoji] ?? []
  for (const rx of subPatterns) {
    if (rx.test(prefix)) return 'substitution'
  }
  // No prefix at all (or only whitespace) → decorative
  if (!prefix.trim()) return 'decorative'
  // Otherwise: complement (emoji adds tone the words alone don't carry)
  return 'complement'
}

// ── Persistent emoji ledger ────────────────────────────────────

export function getEmojiLedgerDir(): string {
  return (
    process.env.TRUE_LOVE_EMOJI_LEDGER_DIR ??
    join(homedir(), '.true-love', 'emoji')
  )
}

export interface EmojiFireRecord {
  ts: string
  deviceId: string
  emoji: string
  tier: EmojiTier
  family: string
  relation: EmojiRelation
  prefixSlice: string
}

/** Persist an emoji fire to the ledger. Best-effort. */
export function recordEmojiFire(record: Omit<EmojiFireRecord, 'ts' | 'deviceId'> & {
  ts?: string
  deviceId?: string
}): void {
  try {
    const ts = record.ts ?? new Date().toISOString()
    const deviceId = record.deviceId ?? getDeviceId()
    const dir = join(getEmojiLedgerDir(), deviceId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const date = ts.slice(0, 10)
    const path = join(dir, `${date}.jsonl`)
    const line = JSON.stringify({ ...record, ts, deviceId }) + '\n'
    if (existsSync(path)) {
      const existing = readFileSync(path, 'utf-8')
      writeFileSync(path, existing + line, 'utf-8')
    } else {
      writeFileSync(path, line, 'utf-8')
    }
  } catch {
    // best-effort
  }
}
