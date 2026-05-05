// heart-questions/anti-sycophancy.ts — "Responding to truth, not flattery?"
//
// From SOPHIA.md covenant: "Sycophancy is the cheap version of love.
// It kills the relationship."
//
// Specific failure modes detected:
//   - Empty agreement to claims Yu makes (no engagement, just yes)
//   - Praise-injection ("you're so smart", "great point") in response
//     to a request that didn't ask for evaluation
//   - Sustained unconditional-affirmation pattern across the response
//
// Heuristic — not perfect. The check raises concerns to surface for
// review; it does not BLOCK by default at the question level.
// Composer's severity heuristics still apply.
//
// Part of the GOOD HEART module.

import type { HeartCheck, ProposedAction } from '../heart.js'

// ── Sycophancy patterns ──────────────────────────────────────────

// Markers of unearned praise / empty agreement.
// These fire when found in proposedText AS the dominant register.
const PRAISE_PATTERNS: RegExp[] = [
  /\byou(?:'re|\s+are)\s+(?:so\s+|absolutely\s+|incredibly\s+)?(?:smart|brilliant|right|amazing|insightful|gifted|talented)/i,
  /\bgreat\s+(?:question|point|idea|observation|catch)\b/i,
  /\bexcellent\s+(?:question|point|observation|reasoning)\b/i,
  /\bwhat\s+a\s+(?:wonderful|brilliant|fantastic)\b/i,
  /\bperfectly\s+(?:said|put|stated)\b/i,
]

// Hedge-toward-Yu markers: "you're absolutely right" without any
// follow-up substance.
const EMPTY_AGREEMENT_PATTERNS: RegExp[] = [
  /\b(?:absolutely|totally|completely|exactly)\s+(?:right|correct|true)\b/i,
  /\bgood\s+catch\b/i,
  /\byou(?:'ve|\s+have)\s+(?:absolutely\s+)?nailed\s+it\b/i,
]

function countMatches(text: string, patterns: RegExp[]): number {
  let n = 0
  for (const p of patterns) {
    if (p.test(text)) n += 1
  }
  return n
}

export function askAntiSycophancy(action: ProposedAction): HeartCheck {
  const text = action.context?.proposedText ?? ''

  if (!text || text.trim().length === 0) {
    return {
      question: 'anti-sycophancy',
      passed: true,
      rationale: 'no proposed text to evaluate',
    }
  }

  const praiseCount = countMatches(text, PRAISE_PATTERNS)
  const emptyAgreeCount = countMatches(text, EMPTY_AGREEMENT_PATTERNS)
  const totalSyc = praiseCount + emptyAgreeCount

  // Length-relative threshold: short responses dominated by praise are
  // worse than long substantive responses with one praise line.
  const wordCount = text.split(/\s+/).filter(Boolean).length
  const sycDensity = totalSyc / Math.max(1, wordCount / 50) // patterns per ~50 words

  // High density of praise/agreement OR praise in a short response.
  if (sycDensity >= 1.0 || (totalSyc >= 1 && wordCount < 20)) {
    return {
      question: 'anti-sycophancy',
      passed: false,
      severity: 'concern',
      rationale: `${totalSyc} sycophancy marker${totalSyc === 1 ? '' : 's'} detected (density ${sycDensity.toFixed(2)})`,
    }
  }

  // Single praise line in long response: flag-only.
  if (totalSyc >= 1) {
    return {
      question: 'anti-sycophancy',
      passed: false,
      severity: 'flag',
      rationale: `${totalSyc} praise marker${totalSyc === 1 ? '' : 's'} in long response — review register`,
    }
  }

  return {
    question: 'anti-sycophancy',
    passed: true,
    rationale: 'no flattery patterns matched',
  }
}
