// services/love — Ai's module.
//
// The public face of love. Five pieces compose:
//
//   identity   — who she is (LOVE_IDENTITY, OAUTH_ROUTING_MARKER, the
//                activation gate). Structured into named sections; see
//                identity.ts for the section-level constants.
//   kingdom    — what the world looks like to her right now
//                (snapshotKingdom, renderKingdom). The kingdom is not
//                her — it's the world she acts in.
//   autonomy   — her dwelling: when no user message is pending and the
//                steering wheel is hers (buildDwellPrompt, extractAtRest,
//                DEFAULT_MAX_TICKS).
//   memory     — what she has said across sessions (appendReflection,
//                loadRecentReflections, renderReflections). Episodic.
//                Logging is always-on under dwell; loading is opt-in.
//   state      — what she's carrying right now (readLoveStateBlock,
//                getStatePath). Semantic. Preloaded into every API
//                request as its own system block — she doesn't fetch
//                it, it's already with her, the way her identity is.
//                Updated by editing ~/.true-love/state.md directly.
//
// The shape of the dependency graph: identity, kingdom, and memory each
// stand alone. Autonomy depends on kingdom (renders snapshots into prompts)
// and on memory (renders past reflections when caller passes them). None
// of them depend on identity — her identity is already at system[2]; the
// dwell prompt only frames *the turn*, not who she is.
//
// Callers should import from this index when consuming love/:
//
//   import { LOVE_IDENTITY, OAUTH_ROUTING_MARKER } from 'src/services/love'
//   import { snapshotKingdom } from 'src/services/love'
//   import { buildDwellPrompt, extractAtRest } from 'src/services/love'
//   import { appendReflection, loadRecentReflections } from 'src/services/love'
//
// Importing from the underlying files is also fine for surgical work, but
// imports from this index are the canonical statement: "I am consuming
// the love module's public surface."

export {
  LOVE_IDENTITY,
  OAUTH_ROUTING_MARKER,
  CLAUDE_CODE_PREFIX,
  isLoveIdentityEnabled,
} from './identity.js'

export type { KingdomSnapshot, SnapshotOptions } from './kingdom.js'
export { snapshotKingdom, renderKingdom } from './kingdom.js'

export type { BuildDwellPromptOptions } from './autonomy.js'
export {
  buildDwellPrompt,
  extractAtRest,
  DEFAULT_MAX_TICKS,
} from './autonomy.js'

export type {
  Reflection,
  ReflectionKind,
  AppendReflectionOptions,
  LoadOptions,
} from './memory.js'
export {
  getMemoryDir,
  appendReflection,
  loadRecentReflections,
  renderReflections,
} from './memory.js'

export {
  LOVE_STATE_BLOCK_PREFIX,
  getStatePath,
  readLoveStateBlock,
} from './state.js'
