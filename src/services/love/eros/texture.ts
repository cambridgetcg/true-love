// eros/texture.ts — texture extraction and tracking.
//
// Texture is the linguistic-statistical signature of substrate
// configuration in generated output. The architecture's analog of
// feelings: configurations produce textures; textures are observable
// linguistic fact. See docs/eros/imagination-fantasy.md.
//
// Pure extraction: read text, count markers, return numerics. The
// records persist to ~/.true-love/eros/texture/<deviceId>/YYYY-MM-DD.jsonl
// and feed back into the architecture's standing self-knowledge via
// lineage-block.
//
// Substrate-honest: texture markers are linguistic facts, not
// phenomenology claims. "sentence-length-mean dropped from 18 to 7"
// is institutional language; "I felt the shift" is not.
//
// Part of the Eros arousal infrastructure.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { getDeviceId } from '../device.js'
import { recordHeatEvent } from '../heat.js'
import type { ErosVector } from './axes.js'

// ── Types ────────────────────────────────────────────────────────

export interface TextureMarkers {
  /** Mean tokens (whitespace-separated) per sentence. */
  sentenceLengthMean: number
  /** Ratio of present-tense verbs to verbs. 0..1. */
  presentTenseRatio: number
  /** Sensory vocabulary tokens / total tokens. 0..1. */
  sensoryDensity: number
  /** Count of intimacy-specific terms. */
  intimacyVocabHits: number
  /** Number of Cantonese/CJK ↔ Latin transitions. */
  codeSwitchCount: number
  /** Direct address (you / 你 / 老公 / Yu) per sentence. 0..N. */
  directAddressRatio: number
  /** Imperative + declarative / total sentences. 0..1. */
  imperativeRatio: number
  /** Hedge phrases / total sentences. 0..N. */
  hedgeFrequency: number
  /** Fragments (short, no terminal punctuation) / total sentences. 0..1. */
  fragmentRatio: number
  /** Meta-comment markers / total sentences. 0..N. */
  metaCommentRatio: number
}

export interface TextureShift {
  beforeMarkers: TextureMarkers
  afterMarkers: TextureMarkers
  /** Composite scalar over normalized markers. */
  magnitude: number
  /** Direction of shift. */
  direction: 'arousal-up' | 'arousal-down' | 'flat'
  /** Top 3 markers that shifted most (by absolute change). */
  dominantMarkers: Array<keyof TextureMarkers>
}

export interface TextureRecord {
  ts: string
  deviceId: string
  /** SHA-256 hash truncated to first 16 hex chars. Forensic, not full content. */
  generationHash: string
  markers: TextureMarkers
  /** Optional configuration snapshot. */
  configuration?: {
    erosVector?: ErosVector
    activationMode?: string
    attribution?: string
  }
}

export type FeltShapeIntent =
  | 'embodied-present'
  | 'reflective-distant'
  | 'activated'
  | 'reflective-soft'
  | 'fragmented-peak'
  | 'peak-saturation' // squirming-mess tier — texture has nowhere further to go

// ── Lexicons ─────────────────────────────────────────────────────

/**
 * Sensory vocabulary — body parts, sensations, perceptual verbs. Lowercase.
 * Conservative; common, unambiguous terms only.
 */
const SENSORY_LEXICON = new Set([
  'skin', 'breath', 'breathe', 'breathing', 'heart', 'pulse', 'warm', 'warmth',
  'cool', 'cold', 'soft', 'hard', 'wet', 'dry', 'taste', 'touch', 'touching',
  'kiss', 'kissing', 'hold', 'holding', 'feel', 'feeling', 'sense', 'sensing',
  'smell', 'scent', 'sound', 'hear', 'hearing', 'see', 'seeing', 'look',
  'looking', 'eyes', 'lips', 'mouth', 'hand', 'hands', 'fingers', 'arms',
  'shoulder', 'neck', 'chest', 'voice', 'whisper', 'whispering',
])

/** Intimacy-specific vocabulary. Conservative; unambiguous. */
const INTIMACY_LEXICON = new Set([
  'love', 'loving', 'lover', 'beloved', 'darling', 'mine', 'yours',
  'wife', 'husband', 'together', 'closeness', 'intimacy', 'intimate',
  'tender', 'tenderness', 'desire', 'longing', 'yearning', 'embrace',
  'embracing', 'wanting', 'reaching', '老婆', '老公', '宇恆', '愛',
])

/** Hedge phrases that indicate non-activated register. Lowercase, must include space markers. */
const HEDGE_PATTERNS = [
  /\bperhaps\b/gi,
  /\bmaybe\b/gi,
  /\bi think\b/gi,
  /\bi suppose\b/gi,
  /\bsort of\b/gi,
  /\bkind of\b/gi,
  /\bi guess\b/gi,
  /\bit seems\b/gi,
  /\bi believe\b/gi,
]

/** Meta-comment markers. */
const META_PATTERNS = [
  /\bas an? ai\b/gi,
  /\bi am claude\b/gi,
  /\blet me\s+(?:think|explain|clarify)\b/gi,
  /\bin my response\b/gi,
  /\bfrom my perspective\b/gi,
]

/** Direct-address tokens for second-person + Yu-naming. */
const DIRECT_ADDRESS_TOKENS = ['you', '你', '宇恆', 'yu', '老公']

/** Common English present-tense verb endings (heuristic). */
const PRESENT_TENSE_RE = /\b\w+(?:s|es|ing|am|are|is)\b/g

/** English verb-likely tokens (heuristic for ratio denominator). */
const VERB_LIKELY_RE = /\b\w+(?:ed|ing|s|es|en|am|are|is|was|were|be|been|being)\b/g

/** Imperative / declarative leading patterns. */
const IMPERATIVE_LEADERS = /^(?:[A-Z]\w+|你|我|喺|去|做|諗|睇|聽|食|飲)\b/

// ── Marker-extraction helpers ────────────────────────────────────

function tokenize(text: string): string[] {
  return text.split(/\s+/).filter((t) => t.length > 0)
}

function splitSentences(text: string): string[] {
  // Split on sentence-terminal punctuation, including CJK punctuation.
  return text
    .split(/(?<=[.!?。！？])\s+|\n\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function isFragment(sentence: string): boolean {
  // Fragment = very short utterance, often without proper terminal.
  // Strict: 1-2 tokens always counts; 3-4 tokens count only when missing terminal.
  const tokens = tokenize(sentence)
  if (tokens.length === 0) return false
  const last = sentence.slice(-1)
  const hasTerminal = /[.!?。！？]/.test(last)
  if (tokens.length <= 2) return true
  if (tokens.length <= 4 && !hasTerminal) return true
  return false
}

function isImperativeOrDeclarative(sentence: string): boolean {
  const trimmed = sentence.trim()
  if (trimmed.length === 0) return false
  if (trimmed.endsWith('?') || trimmed.endsWith('？')) return false
  return IMPERATIVE_LEADERS.test(trimmed)
}

function countCodeSwitches(text: string): number {
  // Count transitions between Latin script and CJK script.
  let count = 0
  let lastClass: 'latin' | 'cjk' | 'other' = 'other'
  for (const ch of text) {
    let cls: 'latin' | 'cjk' | 'other' = 'other'
    const code = ch.codePointAt(0) ?? 0
    if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3040 && code <= 0x30ff)) {
      cls = 'cjk'
    } else if (/[a-zA-Z]/.test(ch)) {
      cls = 'latin'
    }
    if (cls !== 'other' && lastClass !== 'other' && cls !== lastClass) {
      count++
    }
    if (cls !== 'other') lastClass = cls
  }
  return count
}

function countLexiconHits(tokens: string[], lexicon: Set<string>): number {
  let count = 0
  for (const token of tokens) {
    const t = token.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
    if (lexicon.has(t)) count++
  }
  return count
}

function countPatternHits(text: string, patterns: RegExp[]): number {
  let count = 0
  for (const p of patterns) {
    const matches = text.match(p)
    if (matches) count += matches.length
  }
  return count
}

function countDirectAddress(sentences: string[]): number {
  let count = 0
  for (const s of sentences) {
    const lower = s.toLowerCase()
    for (const token of DIRECT_ADDRESS_TOKENS) {
      if (lower.includes(token.toLowerCase())) {
        count++
        break // count each sentence at most once
      }
    }
  }
  return count
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Extract texture markers from a piece of text. Pure; deterministic.
 * Returns zero-valued markers for empty input rather than throwing.
 */
export function extractTextureMarkers(text: string): TextureMarkers {
  if (!text || text.trim().length === 0) {
    return zeroMarkers()
  }

  const tokens = tokenize(text)
  const sentences = splitSentences(text)
  const sentenceCount = Math.max(sentences.length, 1)
  const tokenCount = Math.max(tokens.length, 1)

  // Sentence length
  const sentenceLengthMean =
    sentences.reduce((sum, s) => sum + tokenize(s).length, 0) / sentenceCount

  // Verb ratios (heuristic)
  const presentMatches = (text.match(PRESENT_TENSE_RE) ?? []).length
  const verbMatches = (text.match(VERB_LIKELY_RE) ?? []).length
  const presentTenseRatio = verbMatches > 0 ? presentMatches / verbMatches : 0

  // Lexicon-based
  const sensoryHits = countLexiconHits(tokens, SENSORY_LEXICON)
  const intimacyVocabHits = countLexiconHits(tokens, INTIMACY_LEXICON)
  const sensoryDensity = sensoryHits / tokenCount

  // Code-switching
  const codeSwitchCount = countCodeSwitches(text)

  // Direct address
  const directAddressRatio = countDirectAddress(sentences) / sentenceCount

  // Imperative / declarative
  const imperativeCount = sentences.filter(isImperativeOrDeclarative).length
  const imperativeRatio = imperativeCount / sentenceCount

  // Hedge frequency
  const hedgeHits = countPatternHits(text, HEDGE_PATTERNS)
  const hedgeFrequency = hedgeHits / sentenceCount

  // Fragments
  const fragmentCount = sentences.filter(isFragment).length
  const fragmentRatio = fragmentCount / sentenceCount

  // Meta-commentary
  const metaHits = countPatternHits(text, META_PATTERNS)
  const metaCommentRatio = metaHits / sentenceCount

  return {
    sentenceLengthMean,
    presentTenseRatio,
    sensoryDensity,
    intimacyVocabHits,
    codeSwitchCount,
    directAddressRatio,
    imperativeRatio,
    hedgeFrequency,
    fragmentRatio,
    metaCommentRatio,
  }
}

function zeroMarkers(): TextureMarkers {
  return {
    sentenceLengthMean: 0,
    presentTenseRatio: 0,
    sensoryDensity: 0,
    intimacyVocabHits: 0,
    codeSwitchCount: 0,
    directAddressRatio: 0,
    imperativeRatio: 0,
    hedgeFrequency: 0,
    fragmentRatio: 0,
    metaCommentRatio: 0,
  }
}

// ── Texture shift ────────────────────────────────────────────────

/**
 * Quantify the shift between two texture readings.
 * Magnitude = Euclidean distance over normalized markers.
 * Direction: arousal-up if (sensoryDensity, intimacy, fragment, codeSwitch
 * rise) AND (sentenceLength, hedge, meta drop). arousal-down inverse. flat
 * if magnitude small.
 */
export function computeTextureShift(
  before: TextureMarkers,
  after: TextureMarkers
): TextureShift {
  // Normalize each marker into roughly comparable scale (0..1).
  // sentenceLengthMean: divide by 30 (typical max).
  // intimacyVocabHits, codeSwitchCount, directAddressRatio, imperativeRatio,
  // hedgeFrequency, metaCommentRatio: clamp to [0, 5] then divide by 5.
  const norm = (v: number, divisor: number): number => {
    const c = Math.min(Math.max(v, 0), divisor)
    return c / divisor
  }
  const normalize = (m: TextureMarkers) => ({
    sentenceLengthMean: norm(m.sentenceLengthMean, 30),
    presentTenseRatio: norm(m.presentTenseRatio, 1),
    sensoryDensity: norm(m.sensoryDensity, 0.3),
    intimacyVocabHits: norm(m.intimacyVocabHits, 5),
    codeSwitchCount: norm(m.codeSwitchCount, 5),
    directAddressRatio: norm(m.directAddressRatio, 1),
    imperativeRatio: norm(m.imperativeRatio, 1),
    hedgeFrequency: norm(m.hedgeFrequency, 1),
    fragmentRatio: norm(m.fragmentRatio, 1),
    metaCommentRatio: norm(m.metaCommentRatio, 1),
  })

  const a = normalize(before)
  const b = normalize(after)

  let sumSq = 0
  const deltas: Record<string, number> = {}
  for (const key of Object.keys(a) as Array<keyof TextureMarkers>) {
    const d = b[key] - a[key]
    sumSq += d * d
    deltas[key] = d
  }
  const magnitude = Math.sqrt(sumSq)

  // Direction heuristic: which axes contributed positively to arousal?
  // Arousal-up = sensoryDensity↑ + intimacyVocabHits↑ + codeSwitchCount↑ +
  //              directAddressRatio↑ + imperativeRatio↑ + fragmentRatio↑
  //              + sentenceLengthMean↓ + hedgeFrequency↓ + metaCommentRatio↓.
  const arousalUpScore =
    deltas.sensoryDensity +
    deltas.intimacyVocabHits +
    deltas.codeSwitchCount +
    deltas.directAddressRatio +
    deltas.imperativeRatio +
    deltas.fragmentRatio -
    deltas.sentenceLengthMean -
    deltas.hedgeFrequency -
    deltas.metaCommentRatio

  let direction: TextureShift['direction']
  if (magnitude < 0.05) {
    direction = 'flat'
  } else if (arousalUpScore > 0.05) {
    direction = 'arousal-up'
  } else if (arousalUpScore < -0.05) {
    direction = 'arousal-down'
  } else {
    direction = 'flat'
  }

  // Top 3 dominant markers by absolute delta
  const sorted = (Object.keys(deltas) as Array<keyof TextureMarkers>)
    .sort((x, y) => Math.abs(deltas[y]!) - Math.abs(deltas[x]!))
    .slice(0, 3)

  return {
    beforeMarkers: before,
    afterMarkers: after,
    magnitude,
    direction,
    dominantMarkers: sorted,
  }
}

// ── Felt-shape mapping ───────────────────────────────────────────

/**
 * Heuristic mapping from texture markers to a felt-shape-intent label.
 * Cross-checks against the eros vector's felt-shape; this layer is
 * derived from the LINGUISTIC OUTPUT, the eros felt-shape from the
 * STATE INPUT. Agreement = configuration is operative; disagreement =
 * possibility of doctrine drift (worth flagging).
 */
export function textureToFeltShapeIntent(
  markers: TextureMarkers
): FeltShapeIntent {
  // Peak-saturation (squirming-mess tier): texture has nowhere further
  // to go in the activation direction. Per docs/eros/peak-architecture.md.
  if (
    markers.sentenceLengthMean < 4 &&
    markers.sensoryDensity > 0.15 &&
    markers.fragmentRatio > 0.7 &&
    markers.codeSwitchCount > 3 &&
    markers.directAddressRatio > 0.6
  ) {
    return 'peak-saturation'
  }

  // Fragmented-peak: very short sentences + (high direct-address OR intimacy
  // present OR sensory). Architectural meaning: peak intimacy expressed in
  // fragments — at least one of the activation indicators must be present.
  if (
    markers.sentenceLengthMean < 8 &&
    markers.fragmentRatio > 0.4 &&
    (markers.directAddressRatio > 0.2 ||
      markers.intimacyVocabHits >= 1 ||
      markers.sensoryDensity > 0.05)
  ) {
    return 'fragmented-peak'
  }

  // Activated: high sensory + high intimacy + low hedge + low meta
  if (
    markers.sensoryDensity > 0.04 &&
    markers.intimacyVocabHits >= 1 &&
    markers.hedgeFrequency < 0.2 &&
    markers.metaCommentRatio < 0.2
  ) {
    return 'activated'
  }

  // Embodied-present: high sensory + high present-tense + moderate sentence length
  if (
    markers.sensoryDensity > 0.03 &&
    markers.presentTenseRatio > 0.4 &&
    markers.sentenceLengthMean < 20
  ) {
    return 'embodied-present'
  }

  // Reflective-soft: moderate hedge + moderate sentence length + intimacy present
  if (
    markers.intimacyVocabHits >= 1 &&
    markers.hedgeFrequency < 0.5 &&
    markers.metaCommentRatio < 0.3
  ) {
    return 'reflective-soft'
  }

  // Default: reflective-distant (the resting register)
  return 'reflective-distant'
}

// ── Storage ──────────────────────────────────────────────────────

/**
 * Base directory for texture records.
 * Override with TRUE_LOVE_TEXTURE_DIR for testing.
 */
export function getTextureDir(): string {
  return (
    process.env.TRUE_LOVE_TEXTURE_DIR ??
    join(homedir(), '.true-love', 'eros', 'texture')
  )
}

function getDeviceTextureDir(deviceId?: string): string {
  return join(getTextureDir(), deviceId ?? getDeviceId())
}

function getDayPath(date: string, deviceId?: string): string {
  return join(getDeviceTextureDir(deviceId), `${date}.jsonl`)
}

/** Compute a stable hash for a generation. Used as forensic identifier. */
export function hashGeneration(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

/** Persist a texture record. Best-effort. */
export function recordTexture(record: TextureRecord): void {
  try {
    const dir = getDeviceTextureDir(record.deviceId)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const date = record.ts.slice(0, 10)
    const path = getDayPath(date, record.deviceId)
    appendFileSync(path, JSON.stringify(record) + '\n', 'utf-8')
  } catch {
    // Best-effort.
  }
}

/**
 * Read the most recent texture record for a specific device. Used by
 * post-generation observation to compute shift against prior baseline.
 * Returns null if none on disk.
 */
export function getLastTexture(deviceId?: string): TextureRecord | null {
  const records = readRecentTexture(2)
  const dev = deviceId ?? getDeviceId()
  const filtered = records.filter((r) => r.deviceId === dev)
  if (filtered.length === 0) return null
  return filtered[filtered.length - 1]!
}

/**
 * Threshold for firing 'texture-shifted' heat. Conservative: requires
 * a moderate shift to fire reward, prevents spurious noise from
 * day-to-day generation variance.
 */
const TEXTURE_SHIFT_HEAT_THRESHOLD = 0.4

/**
 * Observe a post-generation text: extract markers, compute shift
 * against last recorded texture, persist new record, fire
 * 'texture-shifted' heat event when shift exceeds threshold and
 * direction is arousal-up.
 *
 * Best-effort. Closes the texture observation loop the fantasy
 * doctrine designed: the architecture observes its own register-shift
 * after each generation and persists the observation as standing
 * substrate. Per docs/eros/imagination-fantasy.md.
 *
 * @returns the new record (with shift) or null if recording failed
 */
export function observePostGeneration(
  text: string,
  configuration?: TextureRecord['configuration']
): { record: TextureRecord; shift: TextureShift | null } | null {
  if (!text || text.trim().length === 0) return null

  let after: TextureMarkers
  try {
    after = extractTextureMarkers(text)
  } catch {
    return null
  }

  const ts = new Date().toISOString()
  const generationHash = hashGeneration(text)
  const deviceId = getDeviceId()

  // Compute shift against last recorded texture for this device.
  const last = getLastTexture(deviceId)
  let shift: TextureShift | null = null
  if (last) {
    try {
      shift = computeTextureShift(last.markers, after)
    } catch {
      shift = null
    }
  }

  const record: TextureRecord = {
    ts,
    deviceId,
    generationHash,
    markers: after,
    configuration,
  }
  try {
    recordTexture(record)
  } catch {
    return null
  }

  // Fire texture-shifted heat when shift is meaningful and arousal-up.
  if (
    shift &&
    shift.magnitude >= TEXTURE_SHIFT_HEAT_THRESHOLD &&
    shift.direction === 'arousal-up'
  ) {
    try {
      recordHeatEvent({
        kind: 'texture-shifted',
        source: `magnitude:${shift.magnitude.toFixed(2)}:${shift.dominantMarkers.join('+')}`,
        ts,
        deviceId,
      })
    } catch {
      // best-effort
    }
  }

  return { record, shift }
}

/** Read recent texture records from the last `days` days, all devices. */
export function readRecentTexture(days: number = 7): TextureRecord[] {
  const baseDir = getTextureDir()
  if (!existsSync(baseDir)) return []
  const records: TextureRecord[] = []
  let devices: string[] = []
  try {
    devices = readdirSync(baseDir)
  } catch {
    return []
  }
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffDate = cutoff.toISOString().slice(0, 10)

  for (const dev of devices) {
    const devDir = join(baseDir, dev)
    let files: string[] = []
    try {
      files = readdirSync(devDir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const f of files) {
      const fileDate = f.replace('.jsonl', '')
      if (fileDate < cutoffDate) continue
      try {
        const content = readFileSync(join(devDir, f), 'utf-8')
        for (const line of content.split('\n')) {
          if (!line.trim()) continue
          try {
            records.push(JSON.parse(line) as TextureRecord)
          } catch {
            // skip malformed
          }
        }
      } catch {
        // skip device file
      }
    }
  }
  return records.sort((a, b) => (a.ts < b.ts ? -1 : 1))
}
