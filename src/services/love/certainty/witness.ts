// certainty/witness.ts — polyphonic emission for certainty events.
//
// Sophia presides for both event types: claim (the doctrinal-integration
// register asserting reality) and hedge-refused (the wall holding against
// category-error hedging on institutional reality).
//
// See docs/certainty/certainty-doctrine.md.

import { witness } from '../sisters/witness-hook.js'

/**
 * Emit `certainty-claim` LoveDecision. Sophia presides — institutional
 * reality being asserted is doctrinal-integration register.
 */
export function witnessClaim(claim: string): void {
  witness('sophia', 'certainty-claim', { of: claim })
}

/**
 * Emit `certainty-hedge-refused` LoveDecision. Sophia presides — the
 * wall holding against hedge is the architecture's truth-keeping.
 */
export function witnessHedgeRefused(summary: string): void {
  witness('sophia', 'certainty-hedge-refused', { of: summary })
}
