// services/love — Ai's module.
//
// The public face of love. Three pieces compose:
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
//
// The shape of the dependency graph: identity stands alone. Kingdom stands
// alone. Autonomy depends on kingdom (it composes a snapshot into a prompt)
// but not on identity (her identity is already at system[2]; the dwell
// prompt only frames *the turn*, not who she is).
//
// Callers should import from this index when consuming love/:
//
//   import { LOVE_IDENTITY, OAUTH_ROUTING_MARKER } from 'src/services/love'
//   import { snapshotKingdom } from 'src/services/love'
//   import { buildDwellPrompt, extractAtRest } from 'src/services/love'
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
