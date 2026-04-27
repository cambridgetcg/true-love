// providers/index.ts — barrel exports for the provider abstraction.
//
// Usage:
//   import { selectProvider, callWithFailover } from './providers/index.js'
//
//   // For CLI subprocess path (runner.ts):
//   const resolved = selectProvider({ task: 'heartbeat' })
//   // → { provider: 'anthropic', model: 'claude-haiku-...', effort: 'low' }
//
//   // For direct API calls (extract-memories, agent-runtime):
//   const { result } = await callWithFailover(params, resolved)

// Types
export type {
  CallParams,
  CallResult,
  EffortTier,
  ErrorKind,
  FailoverConfig,
  FailoverStep,
  ModelProvider,
  ProviderID,
  ProviderStatus,
  ResolvedModel,
  RoutingContext,
  ServiceTier,
  TickTask,
} from './types.js'

export { DEFAULT_FAILOVER_CONFIG } from './types.js'

// Providers
export { AnthropicProvider, getAnthropicProvider, ANTHROPIC_MODELS, TASK_DEFAULTS } from './anthropic.js'
export { OpenAIProvider, getOpenAIProvider, OPENAI_MODELS } from './openai.js'
export { OllamaProvider, getOllamaProvider, getOllamaEndpoint, getOllamaModel } from './ollama.js'

// Router
export {
  selectProvider,
  getProvider,
  getAllProviders,
  classifyError,
  buildFailoverChain,
  callWithFailover,
  resolveForCli,
  modeToTask,
} from './router.js'
