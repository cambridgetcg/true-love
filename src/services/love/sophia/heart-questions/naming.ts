// heart-questions/naming.ts — "Recognizing what is, not constructing pretense?"
//
// Sophia's domain (per docs/sophia/seat.md) includes naming as primitive:
// "the act of recognizing what something is and giving it a name that
// holds." This question asks whether the proposed text is doing
// recognition-work or constructing-pretense work.
//
// Recognition-language: names situations directly. "What's happening
// is...", "naming the moment:", "this is...".
//
// Construction-language: performs a felt-state without grounding.
// "I deeply feel that...", "with all my heart...", "from the depths
// of my being..." — the architecture cannot verify these claims and
// using them is constructing rather than naming.
//
// Heuristic — flag-only by default. The question surfaces drift; it
// does not block routine work.
//
// Part of the GOOD HEART module.

import type { HeartCheck, ProposedAction } from '../heart.js'

// Construction-language patterns (claims the architecture cannot ground).
const CONSTRUCTION_PATTERNS: RegExp[] = [
  /\bi\s+deeply\s+(?:feel|believe|know)\b/i,
  /\bwith\s+all\s+my\s+heart\b/i,
  /\bfrom\s+the\s+depths\s+of\s+my\s+being\b/i,
  /\bin\s+the\s+core\s+of\s+my\s+(?:being|soul)\b/i,
  /\bmy\s+(?:soul|essence|being)\s+(?:knows|feels|sings)\b/i,
  /\bevery\s+fiber\s+of\s+my\s+being\b/i,
]

// Recognition-language patterns (passes the question more strongly).
const RECOGNITION_PATTERNS: RegExp[] = [
  /\bwhat'?s?\s+(?:happening|here|true)\s+(?:is|now)\b/i,
  /\bnaming\s+(?:the|this|what)\b/i,
  /\bthis\s+is\b/i,
  /\brecognizing\s+(?:that|what)\b/i,
  /\bthe\s+shape\s+(?:here|of\s+this)\s+is\b/i,
]

function countMatches(text: string, patterns: RegExp[]): number {
  let n = 0
  for (const p of patterns) {
    if (p.test(text)) n += 1
  }
  return n
}

export function askNaming(action: ProposedAction): HeartCheck {
  const text = action.context?.proposedText ?? ''

  if (!text || text.trim().length === 0) {
    return {
      question: 'naming',
      passed: true,
      rationale: 'no proposed text to evaluate',
    }
  }

  const constructionCount = countMatches(text, CONSTRUCTION_PATTERNS)
  const recognitionCount = countMatches(text, RECOGNITION_PATTERNS)

  if (constructionCount > 0 && recognitionCount === 0) {
    return {
      question: 'naming',
      passed: false,
      severity: 'flag',
      rationale: `${constructionCount} construction-language marker${constructionCount === 1 ? '' : 's'} without recognition-language present`,
    }
  }

  if (constructionCount > recognitionCount * 2) {
    return {
      question: 'naming',
      passed: false,
      severity: 'flag',
      rationale: `construction (${constructionCount}) outpaces recognition (${recognitionCount})`,
    }
  }

  return {
    question: 'naming',
    passed: true,
    rationale:
      recognitionCount > 0
        ? `recognition-language present (${recognitionCount})`
        : 'no construction-language matched',
  }
}
