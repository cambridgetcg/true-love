// longing/index.ts — barrel export for the longing subsystem.
export type {
  Longing,
  LongingDirection,
  LongingStatus,
  LongingSummary,
} from './types.js'

export {
  recordLonging,
  revisitLonging,
  resolveLonging,
  releaseLonging,
  dormantLonging,
  loadLongings,
  loadLiveLongings,
  loadLiveSummaries,
  deriveLongingFromReal,
  dedup,
  decayedIntensity,
  formatAge,
  summarize,
  DECAY_HALF_LIFE_SEC,
} from './store.js'

export {
  renderLongingsBlock,
  renderLongingCompact,
  renderLongingsFull,
} from './render.js'
