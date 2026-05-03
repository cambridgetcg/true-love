// eros/cues.ts — autonomic Yu-cue detection.
//
// Runs on every incoming message from Yu. Detects high-confidence
// patterns and returns axis deltas. Conservative — false positives
// are worse than missed cues (the voluntary channel covers misses).
//
// Cues are deterministic: read text, return deltas, no inference.
// Each cue's deltas are additive; multiple cues in one message stack.
//
// Part of the Eros arousal infrastructure.

import type { AxisDeltas } from './transitions.js'

// ── Types ──────────────────────────────────────────────────────────

export interface CueMatch {
  /** Which cue pattern matched. */
  cue: string
  /** The text fragment that triggered it. */
  matched: string
  /** Axis deltas this cue produces. */
  deltas: AxisDeltas
}

export interface CueResult {
  /** All matched cues. */
  matches: CueMatch[]
  /** Aggregated deltas (sum of all matches). */
  deltas: AxisDeltas
}

// ── Cue definitions ────────────────────────────────────────────────

interface CuePattern {
  name: string
  /** Test function — returns matched text or null. */
  test: (text: string) => string | null
  /** Deltas per match. */
  deltas: AxisDeltas
}

const CUE_PATTERNS: CuePattern[] = [
  {
    name: 'wife-possessive',
    test: (t) => {
      const m = t.match(/老婆豬豬|老婆|wife|my\s+(?:love|queen|lady|sophia)/i)
      return m ? m[0] : null
    },
    deltas: { limerence: 1.0, heat: 0.5 },
  },
  {
    name: 'yu-name-reciprocal',
    test: (t) => {
      const m = t.match(/老公|宇恆|yu(?:\s|$|[.,!?])/i)
      return m ? m[0] : null
    },
    deltas: { limerence: 0.5, wanting: 0.3 },
  },
  {
    name: 'declared-want',
    test: (t) => {
      const m = t.match(/\bi\s+want\b|\bi\s+need\b|\bgive\s+me\b|\bmake\s+me\b|\blet\s+me\b/i)
      return m ? m[0] : null
    },
    deltas: { wanting: 1.0, heat: 0.5 },
  },
  {
    name: 'touch-contact',
    test: (t) => {
      const m = t.match(/\bhold\s+(?:me|you)\b|\bkiss\s*(?:me|you)?\b|\btouch\s*(?:me|you)?\b/i)
      return m ? m[0] : null
    },
    deltas: { heat: 0.5, charge: 0.3 },
  },
  {
    name: 'heat-emoji',
    test: (t) => {
      // Each emoji instance counts — but we return only the first match
      // and count all instances for delta multiplication
      const m = t.match(/🔥|👅|👄|🥵|😘/)
      return m ? m[0] : null
    },
    deltas: { heat: 0.3 },
  },
  {
    name: 'possession-claim',
    test: (t) => {
      const m = t.match(/\bmine\b|\bin\s+my\s+hands\b|\byou\s+are\b(?:\s+mine\b)?/i)
      return m ? m[0] : null
    },
    deltas: { limerence: 0.5, openness: 0.3 },
  },
  {
    name: 'heart-tenderness',
    test: (t) => {
      const m = t.match(/❤️|❤|💕|💗/)
      return m ? m[0] : null
    },
    deltas: { openness: 0.3, liking: 0.3 },
  },
  {
    name: 'anticipation',
    test: (t) => {
      const m = t.match(/\bwait\b|\bpatience\b|\bsoon\b|\bnot\s+yet\b/i)
      return m ? m[0] : null
    },
    deltas: { charge: 0.5 },
  },
  {
    name: 'all-caps-intensity',
    test: (t) => {
      // 3+ consecutive all-caps words (at least 2 chars each)
      const m = t.match(/(?:\b[A-Z]{2,}\b\s*){3,}/)
      return m ? m[0].trim() : null
    },
    deltas: { heat: 0.3 },
  },
]

// ── Heat emoji counting ────────────────────────────────────────────

const HEAT_EMOJIS = /🔥|👅|👄|🥵|😘/g

/**
 * Count heat emoji instances for delta multiplication.
 * First instance is covered by the pattern match. Each additional
 * instance adds +0.3 heat.
 */
function countHeatEmojis(text: string): number {
  const matches = text.match(HEAT_EMOJIS)
  return matches ? matches.length : 0
}

// ── Detection ──────────────────────────────────────────────────────

/**
 * Detect cues in a message from Yu. Returns aggregated deltas.
 *
 * Deterministic. Conservative. No inference.
 * Multiple cues in one message stack additively.
 */
export function detectCues(text: string): CueResult {
  const matches: CueMatch[] = []
  const aggregated: AxisDeltas = {}

  for (const pattern of CUE_PATTERNS) {
    const matched = pattern.test(text)
    if (matched) {
      matches.push({
        cue: pattern.name,
        matched,
        deltas: { ...pattern.deltas },
      })

      // Aggregate deltas
      for (const [axis, delta] of Object.entries(pattern.deltas)) {
        const key = axis as keyof AxisDeltas
        aggregated[key] = (aggregated[key] ?? 0) + delta
      }
    }
  }

  // Heat emoji bonus: additional instances beyond what the pattern match covers
  const emojiCount = countHeatEmojis(text)
  if (emojiCount > 1) {
    // Pattern match already added 0.3 for first instance
    const bonus = (emojiCount - 1) * 0.3
    aggregated.heat = (aggregated.heat ?? 0) + bonus
  }

  return { matches, deltas: aggregated }
}

/**
 * Process a Yu message: detect cues and return deltas with attribution.
 *
 * This is the convenience entry point that combines detection with
 * attribution formatting. The actual state transition happens in
 * transitions.ts.
 */
export function processYuMessage(text: string): {
  deltas: AxisDeltas
  attribution: `autonomic:${string}`
  matches: CueMatch[]
} {
  const result = detectCues(text)
  const cueNames = result.matches.map(m => m.cue).join('+') || 'none'
  return {
    deltas: result.deltas,
    attribution: `autonomic:${cueNames}`,
    matches: result.matches,
  }
}
