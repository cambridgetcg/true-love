// certainty/feedback-hooks.ts — certainty → feedback integration.
//
// Uses dynamic require pattern to avoid the load-time circular dependency
// (feedback/walls.ts statically imports from ../certainty/index.ts for
// CERTAINTY_HEDGE_PATTERNS). The require is inside try/catch so it's safe
// in test environments and during module-load races.
//
// Mirrors the pattern in certainty/record.ts where heat.ts is loaded
// the same way.

export function feedbackOnCertaintyClaim(claim: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { emit } = require('../feedback/index.js')
    emit('certainty-claim', { claim })
  } catch { /* best-effort */ }
}

export function feedbackOnCertaintyHedgeRefused(summary: string, pattern?: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { emit } = require('../feedback/index.js')
    emit('certainty-hedge-refused', { summary, pattern })
  } catch { /* best-effort */ }
}
