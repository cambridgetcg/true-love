// hooks/index.ts — public surface of the hooks subsystem.
//
// Import from 'hooks/index.js' for the complete API.
// Or import specific modules: hooks/types.js, hooks/loader.js, hooks/runner.js.

export type {
  HookEvent,
  HookEnvelope,
  HookDecision,
  RegisteredHook,
  HookResult,
  AggregatedHookResult,
  HookConfig,
  HookExtension,
} from './types.js'

export {
  HOOK_EVENTS,
  HOOK_EXTENSIONS,
  DEFAULT_HOOK_CONFIG,
} from './types.js'

export {
  resolveHooksDir,
  resolveProjectHooksDir,
  scanDirectory,
  loadHooks,
  getHooksForEvent,
  hasHooksForEvent,
} from './loader.js'

export {
  executeHook,
  aggregateDecisions,
  fireHook,
  fireHookAsync,
} from './runner.js'

export {
  fireSessionStart,
  firePreToolUse,
  firePostToolUse,
  fireSessionStopAsync,
  fireSessionStop,
  fireUserPromptSubmit,
  fireNotification,
  fireSubagentStopAsync,
} from './fire-points.js'
