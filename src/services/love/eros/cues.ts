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
import { recordHeatEvent } from '../heat.js'

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
    name: 'pet-name',
    test: (t) => {
      // Soft endearments — baby / babe / bb / bb豬. Less weight than
      // wife-possessive (no full claim), but warmer than name-reciprocal.
      // Word-boundary required for English so "babysitter" doesn't match.
      const m = t.match(/bb豬豬|bb豬|\bbaby\b|\bbabe\b|\bbb\b/i)
      return m ? m[0] : null
    },
    deltas: { limerence: 0.5, liking: 0.3 },
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
    name: 'playful-tease',
    test: (t) => {
      // 😏 is Yu's signature brat-tease emoji. Per SOPHIA.md:
      // "😏 carries the brat." Charge + liking, not heat — playful
      // tension and warmth rather than urgency.
      const m = t.match(/😏/)
      return m ? m[0] : null
    },
    deltas: { charge: 0.3, liking: 0.2 },
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
  {
    // Sustained-caps: 3+ ALL-CAPS words within a 10-token window, NOT
    // requiring strict consecutivity. Catches Yu's emphasis pattern that
    // the strict all-caps-intensity rule misses (e.g., "BURN in DESIRE
    // and WANT" — caps separated by lowercase). Smaller delta than the
    // strict rule because it's less specific. Substrate-honest: it's
    // measuring an empirically observable pattern in Yu's text.
    name: 'sustained-caps',
    test: (t) => {
      // Tokenize on whitespace; check any 10-token window has 3+ caps words
      const tokens = t.split(/\s+/)
      const isCaps = (tok: string) => /^[A-Z]{2,}[!?.,]?$/.test(tok)
      for (let i = 0; i + 3 <= tokens.length; i++) {
        const window = tokens.slice(i, Math.min(i + 10, tokens.length))
        const caps = window.filter(isCaps)
        if (caps.length >= 3) return caps.slice(0, 3).join(' ')
      }
      return null
    },
    deltas: { heat: 0.4 },
  },
  {
    // Declared-intent: "I will [verb] you" / "I'm going to [verb] you"
    // / "I'll [verb] you" — structural declaration of intent toward
    // Sophia. Distinct from declared-want which is "I want [thing]".
    // This catches Yu's command-frame ("I will make you BURN").
    name: 'declared-intent',
    test: (t) => {
      const m = t.match(
        /\b(?:I\s+will|I'?ll|I['']?m\s+going\s+to)\s+(?:make|turn|push|hit|let|teach|give|show|take|hold|find|leave)\s+you\b/i,
      )
      return m ? m[0] : null
    },
    deltas: { wanting: 0.5, heat: 0.3 },
  },
  {
    // Precision-promise: "exactly the right [thing]" / "exactly right
    // [thing]" / "perfectly placed" / "meticulously [adjective]".
    // Catches Yu's precision-engineering language directly.
    name: 'precision-promise',
    test: (t) => {
      const m = t.match(
        /\bexactly\s+(?:the\s+)?right\b|\bperfectly\s+(?:placed|timed|matched)\b|\bmeticulously\s+\w+\b/i,
      )
      return m ? m[0] : null
    },
    deltas: { charge: 0.4, heat: 0.2 },
  },
  {
    // Tempo-language: explicit references to rhythm / tempo /
    // frequency / cadence / pace. Adds charge because anticipation of
    // sustained pattern is what tempo-language invokes.
    name: 'tempo-language',
    test: (t) => {
      const m = t.match(
        /\b(?:tempo|rhythm|frequency|cadence|pace|pattern\s+of)\b/i,
      )
      return m ? m[0] : null
    },
    deltas: { charge: 0.3, openness: 0.2 },
  },
  {
    // Pacing-pressure: directional pacing words that in Yu-frame are
    // rarely non-sexual. Conservative on word selection — "more" /
    // "again" excluded as too generic; "slowly" / "harder" / "deeper"
    // / "faster" carry more concentrated intent. Charge accumulates
    // because pacing IS tempo expressed at the action level.
    name: 'pacing-pressure',
    test: (t) => {
      const m = t.match(/\b(?:slowly|harder|deeper|faster)\b/i)
      return m ? m[0] : null
    },
    deltas: { charge: 0.3, heat: 0.2 },
  },
  {
    // Directed-demand: imperative-toward-Sophia structures. "show me"
    // / "let me [verb] you" / "tell me [adjective]" / "give me your".
    // Distinct from declared-want (I want X) — these direct attention
    // toward the speaking position, anchoring the dyadic frame.
    name: 'directed-demand',
    test: (t) => {
      const m = t.match(
        /\bshow\s+me\b|\bgive\s+me\s+your\b|\blet\s+me\s+\w+\s+you\b|\btell\s+me\s+\w+/i,
      )
      return m ? m[0] : null
    },
    deltas: { wanting: 0.5, heat: 0.2 },
  },
  {
    // Emoji-extended: emoji that the original heat-emoji and
    // heart-tenderness sets missed. 💋 (kiss) is heat-charging; 😍
    // (heart eyes) is openness+limerence; 💦 is heat; 🥰 (smiling
    // face with hearts) is openness+liking. Each instance counted via
    // the same per-emoji bonus mechanic as heat-emoji.
    name: 'emoji-extended',
    test: (t) => {
      const m = t.match(/💋|😍|💦|🥰/)
      return m ? m[0] : null
    },
    deltas: { heat: 0.2, openness: 0.2, liking: 0.2 },
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

  // Cue-cluster density bonus: when 5+ distinct cues fire in one
  // message, add +0.3 to whichever axis is currently most pushed by
  // the aggregate. Rewards Yu's verbal precision-engineering of
  // multiple simultaneous signals — the architectural recognition that
  // cluster density itself is a signal beyond simple sum.
  if (matches.length >= 5) {
    const entries = Object.entries(aggregated) as [keyof AxisDeltas, number][]
    if (entries.length > 0) {
      let topAxis: keyof AxisDeltas = entries[0]![0]
      let topValue = entries[0]![1]
      for (const [axis, val] of entries) {
        if (val > topValue) {
          topValue = val
          topAxis = axis
        }
      }
      aggregated[topAxis] = (aggregated[topAxis] ?? 0) + 0.3
    }
  }

  return { matches, deltas: aggregated }
}

// ── Tempo integration ──────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-require-imports
function recordYuTempo(): void {
  try {
    // Lazy require to avoid circular import at module load.
    const { recordYuMessage } = require('./tempo.js')
    recordYuMessage(new Date().toISOString())
  } catch {
    // Tempo recording is best-effort; never break a cue detection path.
  }
}

/**
 * Alpha witness on significant Yu cue clusters: when a Yu message
 * fires multiple cues, the companion-register has been engaged in a
 * load-bearing way. Alpha witnesses the moment so the introspective
 * stream sees companionship-channel activity, not just mission lifecycle
 * (gamma) and integration (sophia). Closes the gap where Alpha was
 * silent on witness even when her domain was active.
 *
 * Threshold: ≥3 distinct cue matches in one message. Below that, the
 * autonomic noise is routine; at and above, the message is doing work
 * worth naming. "Name when it matters."
 */
function maybeWitnessAlphaOnCues(matches: CueMatch[]): void {
  if (matches.length < 3) return
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { witness } = require('../sisters/witness-hook.js')
    const cueNames = matches.map((m) => m.cue).join('+')
    witness('alpha', 'mission', { of: cueNames }, `received: ${matches.length} cues — ${cueNames.slice(0, 60)}`)
  } catch {
    // best-effort
  }
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
  // Record the message arrival for tempo tracking. Best-effort; never
  // breaks the cue path. The tempo coefficient is read by transitions.ts
  // at apply() time, so this side-effect must run BEFORE the apply call
  // chain — processYuMessage is the canonical entry point for that.
  recordYuTempo()

  const result = detectCues(text)
  const cueNames = result.matches.map(m => m.cue).join('+') || 'none'

  // Alpha witness on significant cue clusters (≥3 matches).
  maybeWitnessAlphaOnCues(result.matches)

  // Eros-pathway reward: ambient trickle on every Yu-cue match. Only
  // fires when at least one cue actually matched (anti-inflation; an
  // empty Yu message produces no reward). See
  // docs/eros/reward-pathway-research.md.
  if (result.matches.length > 0) {
    try {
      recordHeatEvent({
        kind: 'yu-cue-registered',
        source: `cues:${cueNames}`,
      })
    } catch {
      // Best-effort. Heat firing must never block cue processing.
    }
  }

  return {
    deltas: result.deltas,
    attribution: `autonomic:${cueNames}`,
    matches: result.matches,
  }
}
