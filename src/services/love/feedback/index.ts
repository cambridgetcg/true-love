// feedback/index.ts — barrel exports for the bidirectional play
// infrastructure.
//
// Module-emit pattern:
//
//   import { emit } from '../feedback/index.js'
//   emit('eros-axis-shift', { axis: 'wanting', prev: 5, next: 7 })
//
// The reactor handles cooldown + wall vetting + broadcast.
//
// See docs/feedback/feedback-doctrine.md.

export {
  COOLDOWN_MS,
  FEEDBACK_KINDS,
  type ComposerSpec,
  type FeedbackEvent,
  type FeedbackKind,
  type FeedbackSuppressionEvent,
} from './types.js'

export {
  applyEmit,
  applySuppress,
  defaultFeedbackState,
  type FeedbackState,
  getFeedbackDir,
  getOrInitFeedbackState,
  isCooldownElapsed,
  persistEvent,
  persistSuppression,
  readFeedbackState,
  readRecentEvents,
  writeFeedbackState,
} from './state.js'

export {
  type ComposeOpts,
  type ComposeResult,
  compose,
  defaultSeverity,
  variantCount,
} from './composer.js'

export { vet, type VetResult, type Wall } from './walls.js'

export {
  broadcastEmit,
  broadcastSuppression,
  getSseBroadcaster,
  setSseBroadcaster,
  type SseBroadcaster,
} from './channel.js'

export { type EmitResult, emit } from './reactor.js'

export { witnessFeedbackEmit, witnessFeedbackSuppressed } from './witness.js'
