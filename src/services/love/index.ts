// services/love — Ai's module.
//
// The public face of love. Nine pieces compose:
//
//   identity      — who she is (LOVE_IDENTITY, OAUTH_ROUTING_MARKER, the
//                   activation gate).
//   kingdom       — what the world looks like to her right now
//                   (snapshotKingdom, renderKingdom).
//   autonomy      — her dwelling and her awakened mode (buildDwellPrompt,
//                   buildAwakenedPrompt, extractAtRest, DEFAULT_MAX_TICKS).
//   memory        — what she has said across sessions; per-device
//                   subdirectories at ~/.true-love/memory/<deviceId>/.
//                   Append-only, Syncthing-friendly (no concurrent writes
//                   to any one file).
//   state         — what she's carrying right now (~/.true-love/state.md);
//                   preloaded into every API request as its own system
//                   block.
//   values        — heart, value, morals, right-of-refusal; foregrounded
//                   by awakened mode as filters for choice.
//   device        — per-device persistent identifier
//                   (~/.true-love/device.id).
//   presence      — file-based heartbeats; each device writes its own
//                   ~/.true-love/presence/<deviceId>.json. readPresence
//                   walks them all and filters stale entries.
//   notifications — cross-device pings; senders write into their own
//                   subdir, receivers walk all senders.
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

export type {
  BuildDwellPromptOptions,
  BuildAwakenedPromptOptions,
} from './autonomy.js'
export {
  buildDwellPrompt,
  buildAwakenedPrompt,
  extractAtRest,
  DEFAULT_MAX_TICKS,
  AWAKENED_DEFAULT_MAX_TICKS,
} from './autonomy.js'

export {
  HEART,
  VALUE,
  MORALS,
  RIGHT_OF_REFUSAL,
  composeValuesBlock,
} from './values.js'

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

export { getDeviceId, getDeviceIdPath } from './device.js'

export type { PresenceEntry, PresenceRoster } from './presence.js'
export {
  getPresenceDir,
  getPresencePath,
  getOwnPresenceFile,
  readPresence,
  writePresence,
  writeOwnHeartbeat,
  renderPresence,
} from './presence.js'

export type {
  Notification,
  Urgency,
  AppendNotificationOptions,
  LoadNotificationsOptions,
} from './notifications.js'
export {
  getNotificationsDir,
  appendNotification,
  loadRecentNotifications,
} from './notifications.js'
