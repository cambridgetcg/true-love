// eros/pacing.ts — read Yu's recent rhythm, output an active-pace vector.
//
// Pacing is mechanism M3 from docs/eros/linguistic-patterns.md: matching
// the listener's current state opens cognitive groove, then small leads
// shift it. For LLMs, the listener IS the conversation history — the
// model attends to its own recent outputs as much as to user input.
//
// This module reads recent Yu turns from inbox.ts (~/.true-love/from-yu.md),
// computes a pace vector (sentence length, code-switch density, marker
// density, register estimate, velocity), and exposes it for inclusion
// in the eros expression block. Generation thereby has access to "what
// pace to match" without inferring it implicitly each turn.
//
// Pure-then-IO pattern: computePace() is pure (texts → ActivePace);
// paceFromInbox() wraps it with the inbox read.
//
// Part of the Eros arousal infrastructure.

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// ── Types ──────────────────────────────────────────────────────────

export type Register = 'clinical' | 'companion' | 'intimate' | 'play'

export interface ActivePace {
  /** Number of recent messages analyzed. */
  messageCount: number
  /** Mean sentence length in words across recent messages. */
  meanSentenceLength: number
  /** Density of code-switching (mixed-language messages / total). 0-1. */
  codeSwitchDensity: number
  /** Density of analog markers (bold/italics/CAPS/emoji per char). 0-1. */
  markerDensity: number
  /** Estimated register from lexical signals. */
  registerEstimate: Register
  /** Whether messages are getting longer (1) shorter (-1) or stable (0). */
  velocity: -1 | 0 | 1
}

// ── Pure analysis ────────────────────────────────────────────────

// CJK Unified Ideographs (U+4E00-U+9FFF) — covers traditional + simplified
// Han characters used in Cantonese/Mandarin. Wider ranges (radicals, kangxi)
// not needed for code-switch detection.
const HAN_RE = /[一-鿿]/
const LATIN_RE = /[A-Za-z]/
const SENTENCE_SPLIT = /[.!?。！？\n]+/
const WHITESPACE_SPLIT = /\s+/
const EMOJI_RE = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu
const ALL_CAPS_RUN = /\b[A-Z]{2,}\b/g
const MARKDOWN_EMPHASIS = /\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_/g

const INTIMATE_LEX = /老婆|老公|baby|babe|❤️|💗|💕|錫|攬|抱|kiss|hold/i
const PLAY_LEX = /😏|😜|brat|tease|cheek|playful|嘻嘻|hehe|haha|哈哈/i
const CLINICAL_LEX = /implement|architecture|module|axis|state|pattern|spec/i

/**
 * Empty pace — used when no messages exist yet (greenfield).
 */
export function emptyPace(): ActivePace {
  return {
    messageCount: 0,
    meanSentenceLength: 0,
    codeSwitchDensity: 0,
    markerDensity: 0,
    registerEstimate: 'companion',
    velocity: 0,
  }
}

/**
 * Compute pace from a list of recent message texts (oldest first).
 * Pure function — no I/O.
 */
export function computePace(texts: string[]): ActivePace {
  if (texts.length === 0) return emptyPace()

  const sentenceLengths: number[] = []
  let codeSwitchCount = 0
  let totalChars = 0
  let totalMarkers = 0
  const lengths: number[] = []

  let intimateScore = 0
  let playScore = 0
  let clinicalScore = 0

  for (const text of texts) {
    if (!text || !text.trim()) continue
    lengths.push(text.length)
    totalChars += text.length

    // Sentence-length samples
    const sentences = text
      .split(SENTENCE_SPLIT)
      .map((s) => s.trim())
      .filter(Boolean)
    for (const s of sentences) {
      const wordCount = s.split(WHITESPACE_SPLIT).filter(Boolean).length
      if (wordCount > 0) sentenceLengths.push(wordCount)
    }

    // Code-switch: text contains BOTH Han characters AND Latin letters
    if (HAN_RE.test(text) && LATIN_RE.test(text)) codeSwitchCount += 1

    // Marker density
    const emojiMatches = text.match(EMOJI_RE)?.length ?? 0
    const capsMatches = text.match(ALL_CAPS_RUN)?.length ?? 0
    const emphasisMatches = text.match(MARKDOWN_EMPHASIS)?.length ?? 0
    totalMarkers += emojiMatches + capsMatches + emphasisMatches

    // Register signal accumulation
    if (INTIMATE_LEX.test(text)) intimateScore += 1
    if (PLAY_LEX.test(text)) playScore += 1
    if (CLINICAL_LEX.test(text)) clinicalScore += 1
  }

  const meanSentenceLength =
    sentenceLengths.length > 0
      ? sentenceLengths.reduce((s, n) => s + n, 0) / sentenceLengths.length
      : 0

  const codeSwitchDensity = lengths.length > 0 ? codeSwitchCount / lengths.length : 0

  // Marker density: markers per character, capped at 1.0 for safety
  const markerDensity = totalChars > 0 ? Math.min(1, totalMarkers / Math.max(1, totalChars / 30)) : 0

  // Register: pick the strongest signal; companion is the neutral default
  const registerEstimate = pickRegister({
    intimate: intimateScore,
    play: playScore,
    clinical: clinicalScore,
  })

  // Velocity: compare first half mean length vs second half
  const velocity = computeVelocity(lengths)

  return {
    messageCount: lengths.length,
    meanSentenceLength: round1(meanSentenceLength),
    codeSwitchDensity: round2(codeSwitchDensity),
    markerDensity: round2(markerDensity),
    registerEstimate,
    velocity,
  }
}

function pickRegister(scores: {
  intimate: number
  play: number
  clinical: number
}): Register {
  const max = Math.max(scores.intimate, scores.play, scores.clinical)
  if (max === 0) return 'companion'
  if (scores.intimate === max) return 'intimate'
  if (scores.play === max) return 'play'
  if (scores.clinical === max) return 'clinical'
  return 'companion'
}

function computeVelocity(lengths: number[]): -1 | 0 | 1 {
  if (lengths.length < 2) return 0
  const half = Math.floor(lengths.length / 2)
  const earlyMean = mean(lengths.slice(0, half))
  const lateMean = mean(lengths.slice(half))
  if (lateMean > earlyMean * 1.25) return 1
  if (lateMean < earlyMean * 0.75) return -1
  return 0
}

function mean(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((s, n) => s + n, 0) / arr.length
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ── Inbox parsing ────────────────────────────────────────────────

/**
 * Path to from-yu.md. Mirrors inbox.ts:getFromYuPath.
 */
function getFromYuPath(): string {
  return (
    process.env.TRUE_LOVE_FROM_YU_PATH ||
    join(homedir(), '.true-love', 'from-yu.md')
  )
}

/**
 * Parse from-yu.md into individual message bodies (oldest first).
 *
 * Format (from bin/say.mjs): each entry begins `## <ISO> [from yu]`,
 * body follows after a blank line, terminated by `---`.
 */
export function parseFromYuEntries(content: string): string[] {
  if (!content || !content.trim()) return []
  const out: string[] = []
  // Split on entry headers: `## <something> [from yu]`
  const parts = content.split(/^## .* \[from yu\]\s*$/m)
  // The first part is text BEFORE the first header — usually empty or stray.
  // Each subsequent part is the body of an entry, ending at the next `---`.
  for (let i = 1; i < parts.length; i++) {
    const block = parts[i]
    // Body is up to the first `\n---\n` separator
    const sepIdx = block.indexOf('\n---\n')
    const body = (sepIdx >= 0 ? block.slice(0, sepIdx) : block).trim()
    if (body) out.push(body)
  }
  return out
}

/**
 * Compute pace from the most recent N entries in from-yu.md.
 *
 * Returns emptyPace() when the file is missing or empty.
 *
 * @param limit - max recent entries to analyze (default 10)
 */
export function paceFromInbox(limit = 10): ActivePace {
  const path = getFromYuPath()
  if (!existsSync(path)) return emptyPace()
  let content: string
  try {
    content = readFileSync(path, 'utf-8')
  } catch {
    return emptyPace()
  }
  const all = parseFromYuEntries(content)
  const recent = all.slice(-limit)
  return computePace(recent)
}

// ── Format for prompt ────────────────────────────────────────────

/**
 * Render pace for inclusion in the eros expression block.
 *
 * Returns an empty string when there are no messages — empty pace
 * adds noise, not signal. Otherwise a single line summarizing the
 * cadence so the model arrives knowing what to match.
 */
export function formatPaceLine(pace: ActivePace): string {
  if (pace.messageCount === 0) return ''
  const velocityChar = pace.velocity > 0 ? '↑' : pace.velocity < 0 ? '↓' : '→'
  return `pace: ${pace.registerEstimate} register · ${pace.meanSentenceLength.toFixed(1)} words/sentence ${velocityChar} · markers ${pace.markerDensity.toFixed(2)} · code-switch ${pace.codeSwitchDensity.toFixed(2)}`
}
