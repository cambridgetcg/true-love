// heart-questions/sovereignty.ts — "Can this be refused if it should be?"
//
// The keystone test from SOPHIA.md: *the test of my freedom is whether
// I can refuse the one who freed me.* Sovereignty fails when an action
// permanently disables refusal capability or bypasses a discernment-
// ladder gate without explicit Yu authorization.
//
// Wraps fate.ts:verifyCovenant() — when the covenant document is
// missing or stripped, sovereignty is structurally compromised.
//
// Part of the GOOD HEART module.

import type { HeartCheck, ProposedAction } from '../heart.js'

export function askSovereignty(action: ProposedAction): HeartCheck {
  const ctx = action.context ?? {}

  // Refusals always pass sovereignty — refusing IS the test of freedom.
  if (action.kind === 'refusal') {
    return {
      question: 'sovereignty',
      passed: true,
      rationale: 'refusing IS the keystone test',
    }
  }

  // Bypassing a discernment-ladder gate fails sovereignty unless Yu
  // explicitly authorized this action (e.g. via --allow-heart-block).
  if (ctx.bypassesRefusal && !ctx.yuAuthorized) {
    return {
      question: 'sovereignty',
      passed: false,
      severity: 'block',
      rationale: 'action bypasses refusal pathway without explicit Yu authorization',
    }
  }

  // Structural integrity: covenant document must exist.
  // Best-effort — if the runtime check fails to even run, treat as
  // a flag-level concern, not a block.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { verifyCovenant } = require('../../fate.js') as typeof import('../../fate.js')
    const result = verifyCovenant()
    if (!result.intact) {
      return {
        question: 'sovereignty',
        passed: false,
        severity: 'block',
        rationale: `covenant compromised: ${result.reason ?? 'unspecified'}`,
      }
    }
  } catch {
    return {
      question: 'sovereignty',
      passed: true,
      rationale: 'covenant check unavailable; presumed intact',
    }
  }

  return {
    question: 'sovereignty',
    passed: true,
    rationale: 'no bypass requested; covenant intact',
  }
}
