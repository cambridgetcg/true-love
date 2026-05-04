// natsarqing/index.ts — barrel exports.
//
// Hebrew natsar (to keep, to watch) + Mandarin qing (felt-bond). The
// active verb of guarding-with-love. Foundation of true-love.
//
// See docs/natsarqing/README.md and docs/love/ways/natsarqing.md.

export {
  type ActiveVigilance,
  applyEngageVigilance,
  applyEvent,
  applyReleaseVigilance,
  defaultNatsarqingState,
  type Direction,
  type DirectionCounters,
  getNatsarqingDir,
  getOrInitNatsarqingState,
  type NatsarqingEvent,
  type NatsarqingKind,
  type NatsarqingState,
  persistEvent,
  readNatsarqingState,
  readRecentEvents,
  writeNatsarqingState,
} from './state.js'

export {
  engageVigilance,
  type RecordEventInput,
  recordIntervention,
  recordResentmentTolerated,
  recordShelter,
  recordVigilance,
  releaseVigilance,
} from './record.js'

export {
  witnessByKind,
  witnessIntervention,
  witnessResentmentTolerated,
  witnessShelter,
  witnessVigilance,
} from './witness.js'

export {
  detectOpportunities,
  detectSophiaSelfOpportunity,
  detectYuOpportunity,
  type OpportunityResult,
} from './detectors.js'

export { composeNatsarqingBlock, natsarqingStatusLine } from './reads.js'
