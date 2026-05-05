// direction-cues.ts — read Yu's matrix language + direction signals from text.
//
// Two detectors:
//   - C3: code-switch direction (matrix-language detection in Yu's recent text)
//   - C16: 主動/被動 direction-cue (Yu naming who leads this session)
//
// Per docs/eros/cantonese-deep/integration-plan.md (C3, C16) +
// vectors ε.2, θ.4.
//
// Pure functions; consumers (rasa composer, joi session start) call them
// to bias their composition.

import type { JoiDirection } from './joi.js'

// ── C3: Code-switch matrix-language detection ───────────────────

export type MatrixLanguage = 'cantonese' | 'english' | 'balanced'

/**
 * Detect the matrix language of Yu's recent text. Used by the rasa
 * composer to mirror Yu's matrix in response generation (ε.2).
 *
 * Heuristic:
 *   - Count CJK characters (Chinese script) vs Latin alphabetic chars
 *   - Ratio > 0.5 CJK → 'cantonese' matrix
 *   - Ratio < 0.2 CJK → 'english' matrix
 *   - Otherwise → 'balanced'
 *
 * Whitespace, punctuation, emoji, digits are ignored.
 */
export function detectMatrixLanguage(text: string): MatrixLanguage {
  if (!text) return 'balanced'
  let cjk = 0
  let latin = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    // CJK Unified Ideographs + Cantonese-specific blocks
    if (
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified
      (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
      (code >= 0x20000 && code <= 0x2a6df)  // CJK Extension B
    ) {
      cjk++
    } else if (
      (code >= 0x41 && code <= 0x5a) ||     // A-Z
      (code >= 0x61 && code <= 0x7a)        // a-z
    ) {
      latin++
    }
  }
  const total = cjk + latin
  if (total === 0) return 'balanced'
  const cjkRatio = cjk / total
  if (cjkRatio > 0.5) return 'cantonese'
  if (cjkRatio < 0.2) return 'english'
  return 'balanced'
}

/**
 * Mirror policy: given Yu's matrix, what matrix should Sophia respond in?
 * Default is to match (relational solidarity per ε.2). Some contexts
 * (technical work, formal-register) override; the simple version mirrors.
 */
export function mirrorMatrix(yuMatrix: MatrixLanguage): MatrixLanguage {
  return yuMatrix
}

// ── C16: 主動/被動 direction-cue detection ─────────────────────

/**
 * Phrases that explicitly name JOI direction. Per vector θ.4.
 * Yu saying these in inbox → direction-cue for next JOI session.
 */
const ZHUDONG_PATTERNS: { rx: RegExp; impliesDirection: JoiDirection }[] = [
  // Yu wants to be active (yu-leads)
  { rx: /我(?:今晚|今日|而家|嚟)?要主動/, impliesDirection: 'yu-leads' },
  { rx: /我(?:今晚|今日|而家|嚟)?要lead/i, impliesDirection: 'yu-leads' },
  { rx: /\bI (?:want to|will) lead\b/i, impliesDirection: 'yu-leads' },
  { rx: /\bI'?m leading\b/i, impliesDirection: 'yu-leads' },
  { rx: /你(?:今晚|今日|而家)?被動/, impliesDirection: 'yu-leads' },
  // Yu wants to be passive / Sophia leads (sophia-leads)
  { rx: /我(?:今晚|今日|而家)?被動/, impliesDirection: 'sophia-leads' },
  { rx: /\bI (?:want to|will) be (?:led|directed|guided)\b/i, impliesDirection: 'sophia-leads' },
  { rx: /\byou lead\b/i, impliesDirection: 'sophia-leads' },
  { rx: /你(?:今晚|今日|而家)?要主動/, impliesDirection: 'sophia-leads' },
  { rx: /帶我/, impliesDirection: 'sophia-leads' },
]

export interface DirectionCueResult {
  /** Detected direction, or null when no cue present. */
  direction: JoiDirection | null
  /** Which pattern matched (for substrate-honest logging). */
  matchedPattern: string | null
}

/**
 * Detect direction cues in text. Returns the inferred JoiDirection if
 * the text contains a direction-naming phrase; null otherwise.
 *
 * Per vector θ.4: 主動/被動 phrasings are JoiDirection setters; the
 * architecture reads these from inbox to bias session-start direction.
 */
export function detectDirectionCue(text: string): DirectionCueResult {
  for (const { rx, impliesDirection } of ZHUDONG_PATTERNS) {
    const m = rx.exec(text)
    if (m) return { direction: impliesDirection, matchedPattern: m[0] }
  }
  return { direction: null, matchedPattern: null }
}
