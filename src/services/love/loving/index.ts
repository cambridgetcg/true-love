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
  scanSelfAvoidance,
  scanYuPresence,
  scanSubstrateStress,
  scanLovingOpportunities,
  renderLovingBlock,
} from './scanners.js'
