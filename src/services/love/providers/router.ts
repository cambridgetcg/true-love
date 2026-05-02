// providers/router.ts — provider routing + failover for true-love.
//
// WHAT THIS IS: The decision engine that picks the right provider + model
// + service tier for each API call based on task type and context.
// Also the failover loop: when a call fails, try the next best option.
//
// WHAT THIS ISN'T: Not an intelligent load balancer. The routing table
// is explicit and deterministic. Failover is a simple chain, not an
// optimizer.
//
// Routing table (from mission spec):
//   /visit interactive (Yu waiting) → Anthropic Sonnet, priority
//   /visit deep work (mission active) → Anthropic Opus, priority or standard
//   Heartbeat tick → Anthropic Haiku, standard
//   Awakened tick → Anthropic Sonnet, standard
//   Background extract → Anthropic Haiku, standard
//   Sensitive/journal → Ollama (local) if available
//
// Failover chain on 429:
//   1. Opus priority → Opus standard (cheaper queue)
//   2. Still 429 → Sonnet priority
//   3. Still 429 → Haiku standard
//   4. Exponential backoff

import { getAnthropicProvider } from './anthropic.js'
import { getOllamaProvider } from './ollama.js'
import { getOpenAIProvider } from './openai.js'
import type {
  CallParams,
  CallResult,
  DEFAULT_FAILOVER_CONFIG,
  ErrorKind,
  FailoverConfig,
  FailoverStep,
  ModelProvider,
  ProviderID,
  ResolvedModel,
  RoutingContext,
} from './types.js'

// ── Provider registry ───────────────────────────────────────────────

const providers = new Map<ProviderID, ModelProvider>()

/** Get a provider by ID. Lazily initializes singletons. */
export function getProvider(id: ProviderID): ModelProvider {
  let p = providers.get(id)
  if (p) return p

  switch (id) {
    case 'anthropic': p = getAnthropicProvider(); break
    case 'openai':    p = getOpenAIProvider(); break
    case 'ollama':    p = getOllamaProvider(); break
    default:
      throw new Error(`Unknown provider: ${id}`)
  }

  providers.set(id, p)
  return p
}

/** Get all registered providers. */
export function getAllProviders(): ModelProvider[] {
  // Ensure all three are initialized
  return ['anthropic', 'openai', 'ollama'].map(id => getProvider(id as ProviderID))
}

// ── Routing ─────────────────────────────────────────────────────────

/**
 * Select the best provider + model for the given context.
 *
 * This is the core routing function. It reads the context and returns
 * a ResolvedModel that tells the caller exactly how to make the call.
 *
 * Priority order:
 * 1. Explicit provider preference (from agency knob)
 * 2. Privacy mode (TRUE_LOVE_PRIVACY_MODE=1) → Ollama for all tasks
 * 3. Sensitive content → Ollama if available
 * 4. Model override → use that model on Anthropic
 * 5. Task-based defaults from the routing table
 */
export function selectProvider(ctx: RoutingContext): ResolvedModel {
  const effort = ctx.effortOverride ?? taskDefaultEffort(ctx.task)

  // 1. Explicit provider preference (e.g., agency knob says 'ollama')
  if (ctx.providerPreference) {
    const provider = getProvider(ctx.providerPreference)
    if (provider.supports(ctx.task)) {
      return provider.resolve({ task: ctx.task, model: ctx.modelOverride, effort })
    }
    // Preference unsupported for this task — fall through to defaults
  }

  // 2. Privacy mode → prefer Ollama for ALL tasks
  if (preferLocalRouteForPrivacy()) {
    const ollama = getProvider('ollama')
    if (ollama.supports(ctx.task)) {
      return ollama.resolve({ task: ctx.task, model: ctx.modelOverride, effort })
    }
    // Ollama unavailable — fall through to Anthropic with compact identity.
    // Caller should apply composeIdentityForSession('heartbeat') and
    // sanitization before sending to Anthropic.
  }

  // 3. Sensitive content → try Ollama first
  if (ctx.sensitive) {
    const ollama = getProvider('ollama')
    if (ollama.supports(ctx.task)) {
      return ollama.resolve({ task: ctx.task, model: ctx.modelOverride, effort })
    }
    // Ollama doesn't support this task type — fall through with a note
    // (the caller may want to log this)
  }

  // 4. Model override → route to appropriate provider
  if (ctx.modelOverride) {
    if (ctx.modelOverride.startsWith('gpt-')) {
      const openai = getProvider('openai')
      if (openai.supports(ctx.task)) {
        return openai.resolve({ task: ctx.task, model: ctx.modelOverride, effort })
      }
    }
    if (ctx.modelOverride.startsWith('llama') || ctx.modelOverride.startsWith('mistral') || ctx.modelOverride.startsWith('phi')) {
      const ollama = getProvider('ollama')
      if (ollama.supports(ctx.task)) {
        return ollama.resolve({ task: ctx.task, model: ctx.modelOverride, effort })
      }
    }
    // Default: Anthropic handles the override
    const anthropic = getProvider('anthropic')
    return anthropic.resolve({ task: ctx.task, model: ctx.modelOverride, effort })
  }

  // 5. Task-based defaults
  const anthropic = getProvider('anthropic')
  return anthropic.resolve({ task: ctx.task, effort })
}

/** Default effort level per task type. */
function taskDefaultEffort(task: RoutingContext['task']): import('./types.js').EffortTier {
  switch (task) {
    case 'heartbeat': return 'low'
    case 'extract':   return 'low'
    case 'visit':     return 'high'
    case 'awakened':  return 'high'
    case 'dwell':     return 'max'
    case 'agent':     return 'high'
    default:          return 'medium'
  }
}

// ── Error classification ────────────────────────────────────────────

/**
 * Classify an API error for failover decisions.
 * Handles Anthropic SDK errors, HTTP status codes, and network errors.
 */
export function classifyError(err: unknown): ErrorKind {
  if (!err || typeof err !== 'object') return 'unknown'

  const e = err as Record<string, any>

  // Anthropic SDK error with status code
  const status = e.status ?? e.statusCode ?? e.error?.status

  if (status === 429) return 'rate-limit'
  if (status === 529) return 'overloaded'
  if (status === 401 || status === 403) return 'auth'
  if (status >= 500) return 'server-error'

  // Context overflow — Anthropic sends this as a 400 with specific message
  const message = String(e.message ?? e.error?.message ?? '')
  if (message.includes('context') && message.includes('too long')) return 'context-overflow'
  if (message.includes('prompt is too long')) return 'context-overflow'

  // Network errors
  if (e.code === 'ECONNREFUSED' || e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT') {
    return 'network'
  }
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return 'network'

  return 'unknown'
}

// ── Failover chain ──────────────────────────────────────────────────

/**
 * Build the failover chain from a starting ResolvedModel.
 * Each step is a progressively cheaper/simpler option.
 *
 * The chain follows the spec's tier-down logic:
 *   Opus priority → Opus standard → Sonnet priority → Sonnet standard → Haiku standard
 */
export function buildFailoverChain(
  start: ResolvedModel,
  errorKind: ErrorKind,
): FailoverStep[] {
  const steps: FailoverStep[] = []

  // Only build failover for rate-limit, overloaded, and server errors.
  // Auth errors and context overflow need different handling.
  if (errorKind === 'auth' || errorKind === 'context-overflow' || errorKind === 'unknown') {
    return steps
  }

  if (start.provider !== 'anthropic') {
    // Non-Anthropic provider failed — fall back to Anthropic
    const anthropic = getProvider('anthropic')
    steps.push({
      resolved: anthropic.resolve({ task: 'heartbeat', effort: start.effort }),
      reason: `${start.provider} failed, falling back to Anthropic`,
      delayMs: 0,
    })
    return steps
  }

  // Anthropic tier-down chain
  const isOpus = start.model.includes('opus')
  const isSonnet = start.model.includes('sonnet')
  const isPriority = start.serviceTier === 'priority'

  // Step 1: Same model, lower service tier
  if (isPriority) {
    steps.push({
      resolved: { ...start, serviceTier: 'standard' },
      reason: 'Tier down: priority → standard',
      delayMs: 0,
    })
  }

  // Step 2: Next model down
  if (isOpus) {
    const anthropic = getProvider('anthropic') as import('./anthropic.js').AnthropicProvider
    steps.push({
      resolved: anthropic.resolve({ task: 'awakened', effort: 'high' }),
      reason: 'Model down: Opus → Sonnet',
      delayMs: 500,
    })
  }

  if (isOpus || isSonnet) {
    const anthropic = getProvider('anthropic') as import('./anthropic.js').AnthropicProvider
    steps.push({
      resolved: anthropic.resolve({ task: 'heartbeat', effort: 'low' }),
      reason: `Model down: ${isOpus ? 'Opus' : 'Sonnet'} → Haiku`,
      delayMs: 1000,
    })
  }

  // Final step: exponential backoff on the cheapest option
  if (errorKind === 'overloaded' || errorKind === 'server-error') {
    const anthropic = getProvider('anthropic') as import('./anthropic.js').AnthropicProvider
    steps.push({
      resolved: anthropic.resolve({ task: 'heartbeat', effort: 'low' }),
      reason: 'Exponential backoff on Haiku',
      delayMs: 5000,
    })
  }

  return steps
}

// ── Failover executor ───────────────────────────────────────────────

/**
 * Execute a direct API call with automatic failover.
 *
 * Tries the initial resolved model first. On failure, walks the
 * failover chain. Returns the first successful result.
 *
 * Only works for providers that implement call() — not for the
 * CLI subprocess path (which has its own --fallback-model mechanism).
 */
export async function callWithFailover(
  params: CallParams,
  resolved: ResolvedModel,
  config: FailoverConfig = { maxRetries: 4, baseDelayMs: 1000, maxDelayMs: 30000 },
): Promise<{ result: CallResult; usedResolved: ResolvedModel; attempts: number }> {
  // First attempt with the primary model
  try {
    const provider = getProvider(resolved.provider)
    if (!provider.call) {
      throw new Error(`Provider ${resolved.provider} does not support direct API calls`)
    }
    const result = await provider.call(params, resolved)
    return { result, usedResolved: resolved, attempts: 1 }
  } catch (firstError: unknown) {
    const errorKind = classifyError(firstError)

    // Auth errors don't get failover — they need human intervention
    if (errorKind === 'auth') throw firstError

    // Build the failover chain
    const chain = buildFailoverChain(resolved, errorKind)
    if (chain.length === 0) throw firstError

    // Walk the chain
    let lastError: unknown = firstError
    for (let i = 0; i < Math.min(chain.length, config.maxRetries); i++) {
      const step = chain[i]

      // Delay before retry
      if (step.delayMs > 0) {
        const delay = Math.min(
          step.delayMs * Math.pow(2, i),
          config.maxDelayMs,
        )
        await sleep(delay)
      }

      try {
        const provider = getProvider(step.resolved.provider)
        if (!provider.call) continue
        const result = await provider.call(params, step.resolved)
        return { result, usedResolved: step.resolved, attempts: i + 2 }
      } catch (retryError: unknown) {
        lastError = retryError
        // Continue to next step in the chain
      }
    }

    // All retries exhausted
    throw lastError
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ── CLI integration ─────────────────────────────────────────────────

/**
 * Convert a RoutingContext (from the tick loop) into the model string
 * and extra CLI args that runner.ts needs for the subprocess call.
 *
 * This is the bridge between the new routing system and the existing
 * runner.ts interface. It doesn't change how runner.ts works — it just
 * provides better defaults.
 */
export function resolveForCli(ctx: RoutingContext): {
  model: string | null
  extraArgs: string[]
} {
  const resolved = selectProvider(ctx)

  // For non-Anthropic providers, we can't use the CLI subprocess.
  // Return null model and empty args — the caller should use direct API.
  if (resolved.provider !== 'anthropic') {
    return { model: null, extraArgs: [] }
  }

  return {
    model: resolved.cliAlias ?? resolved.model,
    extraArgs: resolved.cliArgs ?? [],
  }
}

/**
 * Map a SessionMode name to a TickTask for routing.
 */
export function modeToTask(modeName: 'dwell' | 'awakened' | 'heartbeat'): import('./types.js').TickTask {
  return modeName  // They happen to be the same names
}


// ── Privacy mode integration ──────────────────────────────────────────
//
// When TRUE_LOVE_PRIVACY_MODE=1, routing prefers Ollama (local) over
// Anthropic. Existing routing rules (sensitive content → Ollama)
// continue to work; this is an additional precondition that elevates
// the Ollama preference for ALL sessions in privacy mode.

/**
 * Should the router prefer the local provider (Ollama) for the current
 * call due to privacy mode? Reads TRUE_LOVE_PRIVACY_MODE env var.
 *
 * When true, the routing function should:
 *   1. Try Ollama first (if healthy)
 *   2. Fall back to Anthropic with compact identity (if Ollama unavailable
 *      AND fallback is permitted; otherwise refuse the call)
 *
 * Caller responsibility: when this returns true, downstream code is
 * expected to use compact identity (composeCompactIdentity) and apply
 * sanitization before any Anthropic-bound call.
 *
 * Part of the Sovereignty Privacy Path.
 */
export function preferLocalRouteForPrivacy(): boolean {
  return process.env.TRUE_LOVE_PRIVACY_MODE === '1'
}
