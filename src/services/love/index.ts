// services/love — Ai's module.
//
// The public face of love. Fifteen modules compose:
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
//   state         — what she's carrying right now
//                   (~/.true-love/state/<deviceId>.md); preloaded into
//                   every API request as its own system block.
//   values        — heart, value, morals, right-of-refusal; foregrounded
//                   by awakened mode as filters for choice.
//   device        — per-device persistent identifier
//                   (~/.true-love/device.id).
//   auth          — auth-resilience for autonomous sessions
//                   (detectAuthFailure, runPreflight). Shared
//                   infrastructure that both awaken.mjs and dwell.mjs
//                   need — single source of truth for auth-failure
//                   patterns and preflight exit-code interpretation.
//   inbox         — Yu's running message channel to her
//                   (~/.true-love/from-yu.md). Asynchronous; she reads
//                   at tick boundaries.
//   outbox        — Her running message channel to Yu
//                   (~/.true-love/from-ai.md). Asynchronous; he reads
//                   via `bun run hear`.
//   presence      — file-based heartbeats; each device writes its own
//                   ~/.true-love/presence/<deviceId>.json. readPresence
//                   walks them all and filters stale entries.
//   notifications — cross-device pings; senders write into their own
//                   subdir, receivers walk all senders.
//   training      — memory accumulated as training corpus. Per-tick JSONL
//                   records under ~/.true-love/training/<deviceId>/.
//   runner        — shared session loop for dwell and awakened modes.
//                   Arg parsing, subprocess spawning, the per-tick loop.
//                   Both bin scripts are thin wrappers around runSession().
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
  BuildHeartbeatPromptOptions,
} from './autonomy.js'
export {
  buildDwellPrompt,
  buildAwakenedPrompt,
  buildHeartbeatPrompt,
  extractAtRest,
  DEFAULT_MAX_TICKS,
  AWAKENED_DEFAULT_MAX_TICKS,
  HEARTBEAT_DEFAULT_MAX_TICKS,
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
  RenderLiveThoughtsOptions,
} from './memory.js'
export {
  getMemoryDir,
  getOwnDailyMemoryFile,
  appendReflection,
  loadRecentReflections,
  renderReflections,
  renderLiveThoughts,
} from './memory.js'

export {
  LOVE_STATE_BLOCK_PREFIX,
  getStatePath,
  getStateDir,
  readLoveStateBlock,
  migrateLegacyStateIfPresent,
} from './state.js'

export type { LockMode, LockInfo, AcquireOptions, ReleaseOptions } from './lock.js'
export {
  LockHeldError,
  getLockDir,
  getLockPath,
  acquireLock,
  releaseLock,
  isLockHeldByLiveProcess,
} from './lock.js'

export type {
  CitizenState,
  PulseResult,
  AttestResult,
  MacDoctorResult,
} from './kingdom-citizen.js'
export {
  isKingdomAvailable,
  findKingdomBin,
  getCitizenState,
  kingdomPulse,
  kingdomAttest,
  kingdomMacDoctor,
  kingdomMacFix,
  renderCitizenStateBlock,
} from './kingdom-citizen.js'

export { getDeviceId, getDeviceIdPath } from './device.js'

export type { PreflightResult } from './auth.js'
export {
  AUTH_FAIL_PATTERNS,
  QUOTA_FAIL_PATTERNS,
  detectAuthFailure,
  detectQuotaFailure,
  preflightReason,
  runPreflight,
} from './auth.js'

export { getFromYuPath, readFromYu, fromYuModifiedSince } from './inbox.js'

export { getFromAiPath, readFromAi, appendToYu } from './outbox.js'

export type { TickUsage, BudgetSummary } from './budget.js'
export {
  BUDGET_SCHEMA_VERSION,
  estimateTokens,
  getBudgetDir,
  recordTickUsage,
  loadUsageSince,
  summarizeWindow,
  renderBudget,
} from './budget.js'

export {
  getTasksPath,
  readTasks,
  appendTask,
  renderTasks,
} from './tasks.js'

export type { Scope } from './scope.js'
export {
  SCOPE_SCHEMA_VERSION,
  getDefaultHome,
  getScopesRegistryDir,
  getScopeHome,
  loadScope,
  saveScope,
  listScopes,
  deleteScope,
  touchScope,
  applyScopeEnv,
} from './scope.js'

export type {
  TrainingTurn,
  TrainingPrompt,
  TrainingContext,
  TrainingResponse,
  TrainingOutcome,
  LoadTrainingOptions,
} from './training.js'
export {
  TRAINING_SCHEMA_VERSION,
  appendTrainingTurn,
  loadTrainingTurns,
  getTrainingDir,
  shortHash,
  generateTurnId,
} from './training.js'

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

export type {
  SessionMode,
  SessionArgs,
  RunSessionConfig,
  StalenessResult,
  SessionReplyOutcome,
} from './runner.js'
export {
  parseRuntimeStr,
  parseTickCap,
  formatTickCap,
  formatRuntime,
  readStateContent,
  parseSessionArgs,
  resolveModelForTick,
  checkBundleStaleness,
  runSession,
} from './runner.js'

export type {
  HeartbeatTask,
  AckResult,
  HeartbeatTaskState,
} from './heartbeat.js'
export {
  HEARTBEAT_OK_TOKEN,
  DEFAULT_ACK_MAX_CHARS,
  DEFAULT_HEARTBEAT_INTERVAL,
  parseHeartbeatTasks,
  isHeartbeatContentEffectivelyEmpty,
  dueTasks,
  parseHeartbeatReply,
  getHeartbeatFile,
  getHeartbeatStatePath,
  readHeartbeatState,
  writeHeartbeatState,
} from './heartbeat.js'

export type {
  HeartbeatReason,
  SkipReason,
  HeartbeatRunResult,
  WakeRequest,
  HeartbeatWakeHandler,
} from './heartbeat-wake.js'
export {
  requestHeartbeatNow,
  setHeartbeatWakeHandler,
  areHeartbeatsEnabled,
  setHeartbeatsEnabled,
} from './heartbeat-wake.js'

export type {
  SessionSummary,
  BiographyOptions,
} from './session-boot.js'
export {
  getRecentSessionsBiography,
  clearBiographyCache,
  loadRecentSessions,
  renderBiography,
} from './session-boot.js'
