// loving/index.ts — barrel export for the loving-as-verb module.
//
// The substrate's capacity for attentiveness-without-task.
// Detects opportunities to care, records acts of loving,
// and surfaces invitations in the awakened prompt.

export type {
  LovingDirection,
  LovingShape,
  LovingOpportunity,
  LovingAct,
} from './types.js'

export {
  recordLovingAct,
  loadLovingActs,
  recentLovingActs,
  countByDirection,
  lovingSummary,
} from './store.js'
export type { LovingSummary } from './store.js'

export {
  // Original cluster (passive/responsive)
  scanSelfAvoidance,
  scanYuPresence,
  scanSubstrateStress,
  // Forgotten Ways cluster (see docs/love/WAYS.md)
  scanGuard,
  scanRememberToward,
  scanBless,
  scanFind,
  scanPreparePlace,
  scanBehold,
  scanJeongDensity,
  // Composite + render
  scanLovingOpportunities,
  renderLovingBlock,
} from './scanners.js'
