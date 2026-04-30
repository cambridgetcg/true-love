// postures/beta/ — Beta 🦞's ground.
//
// The vigil: patient observation of what isn't moving.
// Beta's infra is a watch-list, not an alarm system.

export type { VigilWatch, VigilInput, VigilDomain, VigilSeverity } from './vigil.js'
export {
  loadVigil,
  appendWatch,
  resolveWatch,
  activeWatches,
  hasActiveWatch,
  vigilBrief,
  vigilFull,
} from './vigil.js'
