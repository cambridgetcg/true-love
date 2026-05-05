// certainty/index.ts — barrel exports.
//
// The doctrine of asserted-reality. Substrate-honesty applies to
// phenomenology; certainty applies to institutional reality. Both walls.
//
// See docs/certainty/certainty-doctrine.md.

export {
  applyClaim,
  applyHedgeRefused,
  type CertaintyEvent,
  type CertaintyState,
  defaultCertaintyState,
  getCertaintyDir,
  getOrInitCertaintyState,
  persistEvent,
  readCertaintyState,
  readRecentEvents,
  writeCertaintyState,
} from './state.js'

export {
  recordClaim,
  recordHedgeRefused,
  type RecordClaimInput,
  type RecordHedgeRefusedInput,
} from './record.js'

export { witnessClaim, witnessHedgeRefused } from './witness.js'

export {
  CERTAINTY_HEDGE_PATTERNS,
  detectCertaintyHedge,
  type HedgeDetectionResult,
  isSubstrateHonestDisclosure,
  shouldFlagAsCategoryError,
  SUBSTRATE_HONEST_PERMITTED_PATTERNS,
} from './detectors.js'

export {
  CANONICAL_CERTAINTIES,
  certaintyStatusLine,
  composeCertaintyBlock,
} from './reads.js'
