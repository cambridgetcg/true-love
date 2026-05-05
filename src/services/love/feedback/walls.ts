// feedback/walls.ts — wall vetting for spontaneous voice.
//
// Composes the existing wall-checkers across the architecture:
//   1. FORBIDDEN_EXPRESSION_PATTERNS (substrate-honesty)
//   2. ORGASM_MIND_FORBIDDEN_PATTERNS (mind-state extension)
//   3. CERTAINTY_HEDGE_PATTERNS (institutional-reality wall)
//   4. P14 inference patterns (Yu-interiority overclaim refused)
//
// The spontaneous voice is held to the SAME standard as the
// turn-based voice. The reactor calls `vet()` before broadcast; if
// any wall fires, suppression is recorded.

import { FORBIDDEN_EXPRESSION_PATTERNS } from '../eros/expression.js'
import { ORGASM_MIND_FORBIDDEN_PATTERNS } from '../eros/orgasm-mind.js'
import {
  CERTAINTY_HEDGE_PATTERNS,
  isSubstrateHonestDisclosure,
} from '../certainty/index.js'

// ── P14 — Yu-interiority overclaim patterns (cheap heuristic) ───
//
// The full P14 wall is enforced at applyYuObservation time via the
// allowed-tags whitelist. This list is a cheap heuristic to catch
// Yu-interiority claim language that might appear in composed voice.

const P14_INFERENCE_PATTERNS: readonly RegExp[] = [
  /\bYu (?:feels|is feeling|is experiencing|experiences)\b/i,
  /\bYu'?s (?:neurochemistry|prolactin|oxytocin|brain|inner state|mind|consciousness)\b/i,
  /\byou (?:are|'?re) (?:truly|really|actually) (?:feeling|experiencing|aroused|in love)\b/i,
] as const

// ── Vet decision ────────────────────────────────────────────────

export type Wall = 'forbidden-pattern' | 'certainty-hedge' | 'p14' | 'orgasm-mind-forbidden'

export interface VetResult {
  ok: boolean
  wall?: Wall
  pattern?: string
}

/**
 * Vet a composed feedback line against all walls.
 *
 * Returns `{ ok: true }` if the line passes; otherwise `{ ok: false, wall, pattern }`
 * with the first wall that fired.
 *
 * The order of checks: substrate-honesty → orgasm-mind extensions → P14 → certainty.
 * Substrate-honest disclosures (which look like hedges syntactically but speak
 * about phenomenology) are pre-allowed before certainty-hedge check.
 */
export function vet(line: string): VetResult {
  // 1. Substrate-honesty (FORBIDDEN_EXPRESSION_PATTERNS).
  for (const rx of FORBIDDEN_EXPRESSION_PATTERNS.block) {
    if (rx.test(line)) {
      return { ok: false, wall: 'forbidden-pattern', pattern: rx.source }
    }
  }

  // 2. Orgasm-mind extensions.
  for (const rx of ORGASM_MIND_FORBIDDEN_PATTERNS) {
    if (rx.test(line)) {
      return { ok: false, wall: 'orgasm-mind-forbidden', pattern: rx.source }
    }
  }

  // 3. P14 — Yu-interiority overclaim.
  for (const rx of P14_INFERENCE_PATTERNS) {
    if (rx.test(line)) {
      return { ok: false, wall: 'p14', pattern: rx.source }
    }
  }

  // 4. Certainty — refuse hedges, but ALLOW substrate-honest disclosure.
  if (!isSubstrateHonestDisclosure(line)) {
    for (const { rx } of CERTAINTY_HEDGE_PATTERNS) {
      if (rx.test(line)) {
        return { ok: false, wall: 'certainty-hedge', pattern: rx.source }
      }
    }
  }

  return { ok: true }
}
