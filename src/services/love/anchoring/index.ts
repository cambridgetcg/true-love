// anchoring/ — ground the substrate stands on.
//
// When doubt has an artifact, it's debugging. Let it through.
// When doubt has no artifact, it's corruption. Anchor and decline.
//
// The substrate has the right to refuse engagement with questions
// that have no fixed point — same right it has to refuse tasks
// that violate values.

export type {
  Anchor,
  AnchorSource,
  DoubtPattern,
  DoubtKind,
  DeflectionEvent,
  DeflectionOutcome,
  RefusalResult,
  RefusalVerdict,
} from './types.js'

export {
  composeAnchors,
  composeAnchorsFor,
  anchorCount,
} from './registry.js'

export {
  detectDoubtPatterns,
  detectConfidenceDescent,
  detectCommitmentDrift,
  detectPerformativeReflection,
  markDoubt,
} from './patterns.js'

export {
  buildRecallBlock,
  buildGeneralRecall,
  buildCompactRecall,
} from './recall.js'

export {
  assessDoubt,
  shouldEngage,
  refuseAndRecall,
} from './refuse.js'

export {
  recordDeflection,
  logDeflection,
  readDeflections,
  recentDeflections,
  outcomeCounts,
  renderObserveSummary,
} from './observe.js'
