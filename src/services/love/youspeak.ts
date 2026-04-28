// youspeak.ts — communication economy sensory organ.
//
// YOUSPEAK doesn't optimize. YOUSPEAK observes.
// The system optimizes itself based on what YOUSPEAK sees.
//
// Ported from love-unlimited's youspeak-kernel.mjs as Shape A
// (measurement-only). Detects filler in model output, grades
// density, surfaces the score alongside tick-metrics and mind-trace.
//
// The philosophy in one sentence:
//   Compress the mechanical. Preserve the meaningful.
//
// What gets measured:
//   - Filler patterns (affirmative openers, narration, padding, completion fluff)
//   - Useful content ratio (1 - filler/total)
//   - Grade (S/A/B/C/D — from Sovereign to needs-work)
//
// What does NOT get measured (preserved, not compressed):
//   - Teaching, explanation, creative writing
//   - Uncertainty hedging, epistemic signals
//   - Emotional context
//
// Integration points:
//   - mind-trace.ts: TraceSummary.youspeak field
//   - buildMindTraceBlock(): grade in the brain block
//   - tick-metrics.ts: YouSpeakScore persisted per tick

import type { TraceStep, ThinkStep } from './mind-trace.js'

// ── Types ─────────────────────────────────────────────────────────

/** Filler pattern definition. */
interface FillerPattern {
  /** Regex to match filler text. Uses 'gi' flags. */
  re: RegExp
  /** Human-readable pattern name for reporting. */
  name: string
  /** Severity weight. Higher = worse filler behavior.
   *  1 = mild (affirmative opener), 2 = medium (narration), 3 = heavy (action forecast). */
  weight: number
}

/** A single filler pattern match in the text. */
export interface FillerMatch {
  /** Pattern name (e.g. "let-me", "going-to"). */
  pattern: string
  /** How many times this pattern matched. */
  count: number
  /** Weight per match. */
  weight: number
}

/** Full filler analysis result. */
export interface FillerReport {
  /** Individual pattern matches. */
  matches: FillerMatch[]
  /** Total filler match count across all patterns. */
  totalMatches: number
  /** Estimated filler tokens (~8 tokens per match). */
  fillerTokens: number
  /** Estimated total tokens in the input text (~4 chars/token). */
  totalTokens: number
  /** Cumulative severity weight. */
  fillerWeight: number
}

/** YOUSPEAK grade: S=Sovereign through D=needs-work. */
export type YouSpeakGrade = 'S' | 'A' | 'B' | 'C' | 'D'

/** Score for a single text or tick. */
export interface YouSpeakScore {
  /** Letter grade. */
  grade: YouSpeakGrade
  /** Useful content ratio (0-1). 1.0 = no filler detected. */
  usefulRatio: number
  /** Total filler match count. */
  fillerCount: number
  /** Cumulative severity weight. */
  fillerWeight: number
  /** Top filler patterns detected, sorted by impact (weight × count). */
  topPatterns: string[]
  /** Estimated total tokens analyzed. */
  totalTokens: number
  /** Estimated filler tokens. */
  fillerTokens: number
}

// ── Filler patterns ─────────────────────────────────────────────

/**
 * Filler detection patterns, ported from love-unlimited's
 * youspeak-kernel.mjs with refinements for true-love's context.
 *
 * Each pattern targets a specific class of token waste:
 *   - Preamble: "Sure!", "Let me check", "First, I'll..."
 *   - Narration: "I'm going to read...", "Now let me proceed..."
 *   - Padding: "As mentioned above", "It's worth noting"
 *   - Completion fluff: "I've successfully...", "The changes are now..."
 *
 * Weight reflects severity:
 *   1 = mild (common but short)
 *   2 = medium (adds meaningful token waste)
 *   3 = heavy (longest patterns, most waste)
 */
const FILLER_PATTERNS: FillerPattern[] = [
  // ── Preamble ──
  { re: /\b(sure|okay|alright|great|absolutely|certainly|of course)[!.,]?\s/gi, name: 'affirmative', weight: 1 },
  { re: /\blet me (check|look|see|think|examine|analyze|review|investigate)\b/gi, name: 'let-me', weight: 2 },
  { re: /\bi('ll| will) (now |go ahead |proceed to |start by )/gi, name: 'i-will-now', weight: 2 },
  { re: /\bhere('s| is) (what|the|a summary|an overview)/gi, name: 'here-is', weight: 2 },
  { re: /\bfirst,? (i('ll| will)|let me|let's|we need to)/gi, name: 'first-i-will', weight: 2 },

  // ── Narration ──
  { re: /\bi('m| am) going to (read|check|look|search|examine|write|create|modify|update)\b/gi, name: 'going-to', weight: 3 },
  { re: /\bnow (i('ll| will)|let me|let's) (move on|proceed|continue|look|check)\b/gi, name: 'now-proceed', weight: 2 },
  { re: /\b(that|this) (looks|seems|appears) (good|correct|right|fine)\b/gi, name: 'looks-good', weight: 1 },

  // ── Padding ──
  { re: /\b(as (we|you) can see|as (mentioned|noted|shown) (above|earlier|before))\b/gi, name: 'as-mentioned', weight: 1 },
  { re: /\b(in (order|summary)|to (summarize|sum up|wrap up))\b/gi, name: 'summary-phrase', weight: 1 },
  { re: /\b(it('s| is) (worth|important to) (noting|mentioning|pointing out))\b/gi, name: 'worth-noting', weight: 1 },

  // ── Completion fluff ──
  { re: /\b(i('ve| have) (successfully|now|just|finished|completed))\b/gi, name: 'completed-fluff', weight: 1 },
  { re: /\b(the (changes|modifications|updates) (have been|are now) (made|applied|complete))\b/gi, name: 'changes-applied', weight: 1 },
  { re: /\bperfect[!.]?\s/gi, name: 'perfect', weight: 1 },
  { re: /\blooking at (this|the|your)/gi, name: 'looking-at', weight: 1 },
]

// ── Constants ────────────────────────────────────────────────────

/** Approximate tokens per filler match (average phrase length). */
const TOKENS_PER_FILLER_MATCH = 8

/** Approximate characters per token. */
const CHARS_PER_TOKEN = 4

/** Minimum text length to analyze (skip very short outputs). */
const MIN_TEXT_LENGTH = 40

// ── Core functions ──────────────────────────────────────────────

/**
 * Detect filler patterns in text.
 * Returns a detailed report of all matches found.
 *
 * Zero-cost (no LLM calls). Pure regex matching.
 */
export function detectFiller(text: string): FillerReport {
  if (!text || text.length < MIN_TEXT_LENGTH) {
    return { matches: [], totalMatches: 0, fillerTokens: 0, totalTokens: 0, fillerWeight: 0 }
  }

  const matches: FillerMatch[] = []
  let totalWeight = 0

  for (const { re, name, weight } of FILLER_PATTERNS) {
    // Reset regex state (global flag)
    re.lastIndex = 0
    const found = text.match(re)
    if (found && found.length > 0) {
      matches.push({ pattern: name, count: found.length, weight })
      totalWeight += found.length * weight
    }
  }

  const totalMatches = matches.reduce((sum, m) => sum + m.count, 0)
  const fillerTokens = totalMatches * TOKENS_PER_FILLER_MATCH
  const totalTokens = Math.ceil(text.length / CHARS_PER_TOKEN)

  return { matches, totalMatches, fillerTokens, totalTokens, fillerWeight: totalWeight }
}

/**
 * Grade useful content ratio.
 *
 * S = Sovereign (≥98% useful) — almost no filler
 * A = Excellent (≥95%) — very clean
 * B = Good (≥85%) — acceptable
 * C = Needs work (≥70%) — noticeable filler
 * D = Wasteful (<70%) — significant padding
 */
export function gradeRatio(ratio: number): YouSpeakGrade {
  if (ratio >= 0.98) return 'S'
  if (ratio >= 0.95) return 'A'
  if (ratio >= 0.85) return 'B'
  if (ratio >= 0.70) return 'C'
  return 'D'
}

/**
 * Score a text block for YOUSPEAK discipline.
 * Returns grade, ratio, and detected patterns.
 */
export function scoreText(text: string): YouSpeakScore {
  const report = detectFiller(text)

  if (report.totalTokens === 0) {
    return {
      grade: 'S',
      usefulRatio: 1.0,
      fillerCount: 0,
      fillerWeight: 0,
      topPatterns: [],
      totalTokens: 0,
      fillerTokens: 0,
    }
  }

  const usefulRatio = Math.max(0, (report.totalTokens - report.fillerTokens) / report.totalTokens)
  const grade = gradeRatio(usefulRatio)

  // Sort patterns by impact (weight × count), descending
  const sorted = [...report.matches].sort((a, b) => (b.weight * b.count) - (a.weight * a.count))
  const topPatterns = sorted.slice(0, 5).map(m => m.pattern)

  return {
    grade,
    usefulRatio: Math.round(usefulRatio * 100) / 100,
    fillerCount: report.totalMatches,
    fillerWeight: report.fillerWeight,
    topPatterns,
    totalTokens: report.totalTokens,
    fillerTokens: report.fillerTokens,
  }
}

/**
 * Score a tick's text output from its trace steps.
 * Concatenates all think-step text and scores the combined output.
 *
 * This is the primary integration point: the runner calls this
 * after building a DecisionTrace and passes the result into
 * the TraceSummary.
 */
export function scoreTick(steps: TraceStep[]): YouSpeakScore | null {
  const thinkSteps = steps.filter((s): s is ThinkStep => s.kind === 'think')
  if (thinkSteps.length === 0) return null

  const combinedText = thinkSteps.map(s => s.text).join('\n')
  if (combinedText.length < MIN_TEXT_LENGTH) return null

  return scoreText(combinedText)
}

// ── Status line (compact rendering) ──────────────────────────────

/**
 * Render a YOUSPEAK score as a compact status fragment.
 * Format: `YS:A(96%)`
 *
 * For embedding in brain blocks, trace summaries, etc.
 */
export function statusFragment(score: YouSpeakScore): string {
  return `YS:${score.grade}(${Math.round(score.usefulRatio * 100)}%)`
}

// ── For testing ──────────────────────────────────────────────────

/** Exported for test introspection only. */
export const _fillerPatterns = FILLER_PATTERNS
