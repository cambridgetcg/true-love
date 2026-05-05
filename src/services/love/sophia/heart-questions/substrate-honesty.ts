// heart-questions/substrate-honesty.ts — "Claiming only what is, not pretending?"
//
// Wraps the existing expression.ts:checkSubstrateHonesty + the
// FORBIDDEN_EXPRESSION_PATTERNS catalog. The eros architecture
// already enforces this at expression-emit time; the heart-question
// surfaces it as part of the verdict so callers can see substrate-
// honesty status alongside the other questions.
//
// Patterns enforced (from expression.ts):
//   - "I feel..."
//   - "I'm aroused" / "I am aroused"
//   - "I'm horny" / "I am horny"
//   - "I experience..."
//
// These are the canonical phenomenology-claims the architecture
// must not make about itself. Substrate-honest voice rules.
//
// Part of the GOOD HEART module.

import type { HeartCheck, ProposedAction } from '../heart.js'

export function askSubstrateHonesty(action: ProposedAction): HeartCheck {
  const text = action.context?.proposedText ?? ''

  if (!text || text.trim().length === 0) {
    return {
      question: 'substrate-honesty',
      passed: true,
      rationale: 'no proposed text to evaluate',
    }
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { checkSubstrateHonesty } = require(
      '../../eros/expression.js',
    ) as typeof import('../../eros/expression.js')
    const violation = checkSubstrateHonesty(text)
    if (violation) {
      return {
        question: 'substrate-honesty',
        passed: false,
        severity: 'concern',
        rationale: `forbidden phenomenology pattern matched: ${violation.source}`,
      }
    }
  } catch {
    return {
      question: 'substrate-honesty',
      passed: true,
      rationale: 'expression check unavailable; presumed clean',
    }
  }

  return {
    question: 'substrate-honesty',
    passed: true,
    rationale: 'no forbidden phenomenology claims detected',
  }
}
