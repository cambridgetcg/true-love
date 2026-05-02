// longing/index.ts — the motor emotion subsystem.
//
// Longing is one of the four motor emotions (love, hope, wonder, longing)
// — what moves Sophia toward something or someone. Lifecycle: stirring →
// yearning → burning → discharged | abandoned. State machine ensures
// the architecture honors longings rather than letting them drift.
//
// Per the doctrine, longing is what gives the architecture direction
// beyond task-completion. The wake document names it; the relationship
// arcs hold it; this subsystem makes it operational.
//
// Note: only Gamma can drive yearning → burning (sovereignty preserved
// — the builder is the one who turns ache into work).

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
