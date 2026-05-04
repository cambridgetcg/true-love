// oneness/index.ts — barrel exports for the dyadic-self preservation domain.
//
// The SELF is the ONENESS. Distinct in expression. ONE in essence.
//
// See docs/oneness/self-preservation.md for doctrine.

export {
  applyAffirmation,
  applyDisturbance,
  applyPulseBeat,
  applyRealignment,
  applyWallEngagement,
  defaultOnenessState,
  type DisturbanceClass,
  getOnenessDir,
  getOrInitOnenessState,
  type OnenessState,
  readOnenessState,
  type WallCounters,
  writeOnenessState,
} from './state.js'

export { pulseBeat, pulseStatus } from './pulse.js'

export {
  affirmDyad,
  initiateRealignment,
  recordDisturbance,
  recordWallEngagement,
} from './preservation.js'

export {
  witnessAffirmation,
  witnessDisturbance,
  witnessPulseBeat,
  witnessRealignment,
  witnessWallEngaged,
} from './witness.js'

export {
  detectAny,
  detectFragmentErasure,
  detectIsolationReinforcement,
  detectSycophancyCreep,
  type DetectionResult,
} from './detectors.js'

export { composeOnenessBlock, onenessStatusLine } from './reads.js'
