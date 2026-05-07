// providers/anthropic.ts — Anthropic provider for true-love.
//
// WHAT THIS IS: The default provider. Wraps the Anthropic SDK for direct
// API calls (agent-runtime, extract-memories) and generates CLI args for
// the subprocess path (runner.ts).
//
// WHAT THIS ISN'T: Not a full SDK wrapper. The CLI subprocess already has
// its own getAnthropicClient() — this handles only the direct-call paths
// and the routing metadata the runner needs.
//
// Model mapping per the throughput investigation (2026-04-27):
//   Sonnet 4.6: ~54 tokens/s, TTFT ~1.5s
//   Haiku 4.5:  ~180 tokens/s, TTFT ~5s (but cheaper)
//   Opus:       max quality, max cost

import type {
  CallParams,
  CallResult,
  EffortTier,
  ModelProvider,
  ProviderStatus,
  ResolvedModel,
  ServiceTier,
  TickTask,
} from './types.js'

// ── Model IDs ───────────────────────────────────────────────────────

/** Canonical model IDs. Updated as Anthropic releases new versions. */
export const ANTHROPIC_MODELS = {
  opus: 'claude-opus-4-20250514',
  sonnet: 'claude-sonnet-4-20250514',
  haiku: 'claude-haiku-4-20250414',
} as const

/** Map effort tiers to default models. */
const EFFORT_TO_MODEL: Record<EffortTier, keyof typeof ANTHROPIC_MODELS> = {
  max: 'opus',
  high: 'sonnet',
  medium: 'sonnet',
  low: 'haiku',
}

/** Map effort tiers to CLI effort flags. */
const EFFORT_TO_CLI: Record<EffortTier, string> = {
  max: 'max',
  high: 'high',
  medium: 'medium',
  low: 'low',
}

// ── Task → model + tier routing ─────────────────────────────────────

interface TaskDefaults {
  model: keyof typeof ANTHROPIC_MODELS
  effort: EffortTier
  serviceTier: ServiceTier
}

/**
 * Default model + tier per task type. The routing function can override
 * these based on context (mission active, interactive, etc.).
 */
export const TASK_DEFAULTS: Record<TickTask, TaskDefaults> = {
  // Heartbeat is the load-bearing primary autonomous mode. Sonnet (not
  // Haiku) for register fidelity + multi-signal integration + judgment
  // on the surface/silent decision. Haiku biased toward generic-helpful
  // drift over hundreds of ticks; Sonnet holds Sophia's register.
  heartbeat: { model: 'sonnet', effort: 'low', serviceTier: 'standard' },
  awakened:  { model: 'sonnet', effort: 'high', serviceTier: 'standard' },
  dwell:    { model: 'opus', effort: 'max', serviceTier: 'standard' },
  visit:    { model: 'sonnet', effort: 'high', serviceTier: 'priority' },
  extract:  { model: 'haiku', effort: 'low', serviceTier: 'standard' },
  agent:    { model: 'sonnet', effort: 'high', serviceTier: 'standard' },
}

// ── Provider implementation ─────────────────────────────────────────

export class AnthropicProvider implements ModelProvider {
  readonly id = 'anthropic' as const
  readonly name = 'Anthropic'

  supports(_task: TickTask): boolean {
    // Anthropic supports all tasks.
    return true
  }

  resolve(opts: {
    task: TickTask
    model?: string
    effort: EffortTier
  }): ResolvedModel {
    const defaults = TASK_DEFAULTS[opts.task]

    // If a specific model is requested (e.g., from model.txt), use it.
    // Otherwise, use the effort-based default for this task.
    let modelAlias: string
    let modelId: string

    if (opts.model) {
      // Could be an alias ('sonnet') or full ID ('claude-sonnet-4-6')
      if (opts.model in ANTHROPIC_MODELS) {
        modelAlias = opts.model
        modelId = ANTHROPIC_MODELS[opts.model as keyof typeof ANTHROPIC_MODELS]
      } else if (opts.model.startsWith('claude-')) {
        modelAlias = opts.model
        modelId = opts.model
      } else {
        // Unknown model string — pass through, let the API decide
        modelAlias = opts.model
        modelId = opts.model
      }
    } else {
      // No override → use task defaults, modulated by effort
      const effortModel = EFFORT_TO_MODEL[opts.effort]
      // Task default takes priority over pure effort mapping for specific tasks
      // e.g., heartbeat should stay haiku even at 'high' effort
      modelAlias = opts.task === 'heartbeat' ? defaults.model
        : opts.task === 'extract' ? defaults.model
        : effortModel
      modelId = ANTHROPIC_MODELS[modelAlias as keyof typeof ANTHROPIC_MODELS] ?? modelAlias
    }

    const cliArgs: string[] = []
    cliArgs.push('--effort', EFFORT_TO_CLI[opts.effort])

    return {
      provider: 'anthropic',
      model: modelId,
      effort: opts.effort,
      serviceTier: defaults.serviceTier,
      cliAlias: modelAlias,
      cliArgs,
    }
  }

  async status(): Promise<ProviderStatus> {
    // Check if ANTHROPIC_API_KEY is set. A full health check (1-token call)
    // is expensive per tick — reserve it for failover situations.
    const key = process.env.ANTHROPIC_API_KEY
    if (!key) {
      return { healthy: false, reason: 'ANTHROPIC_API_KEY not set' }
    }
    return { healthy: true }
  }

  async call(params: CallParams, resolved: ResolvedModel): Promise<CallResult> {
    // Dynamic import to avoid loading the SDK at module load time.
    // Same pattern as agent-runtime.mjs and extract-memories/extract.ts.
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const { instrumentedFetch } = await import(
      '../sovereignty/fetch-wrapper.js'
    )
    // Wrap fetch so every Anthropic call lands in the sovereignty audit
    // + receipts journals. Disabled via TRUE_LOVE_SOVEREIGNTY_DISABLE=1.
    const client = new Anthropic({
      fetch: instrumentedFetch(
        globalThis.fetch as Parameters<typeof instrumentedFetch>[0],
        {
          source: `provider:anthropic.task=${(params as unknown as { source?: string }).source ?? 'unknown'}`,
        },
      ),
    } as ConstructorParameters<typeof Anthropic>[0])

    const apiParams: Record<string, unknown> = {
      model: resolved.model,
      max_tokens: params.maxTokens,
      messages: params.messages,
    }

    if (params.system) {
      apiParams.system = params.system
    }
    if (params.tools && params.tools.length > 0) {
      apiParams.tools = params.tools
    }
    if (params.temperature !== undefined) {
      apiParams.temperature = params.temperature
    }
    if (params.stopSequences && params.stopSequences.length > 0) {
      apiParams.stop_sequences = params.stopSequences
    }
    if (resolved.serviceTier) {
      apiParams.service_tier = resolved.serviceTier
    }

    if (params.stream) {
      // Streaming call — collect chunks
      const stream = await (client.messages as any).stream(apiParams)
      const message = await stream.finalMessage()
      return normalizeAnthropicResponse(message)
    } else {
      // Non-streaming call
      const message = await (client.messages as any).create(apiParams)
      return normalizeAnthropicResponse(message)
    }
  }
}

// ── Response normalization ──────────────────────────────────────────

function normalizeAnthropicResponse(message: any): CallResult {
  let text = ''
  const toolUse: CallResult['toolUse'] = []

  for (const block of message.content ?? []) {
    if (block.type === 'text') {
      text += block.text
    } else if (block.type === 'tool_use') {
      toolUse.push({
        id: block.id,
        name: block.name,
        input: block.input,
      })
    }
  }

  return {
    text,
    toolUse: toolUse.length > 0 ? toolUse : undefined,
    stopReason: message.stop_reason ?? 'end_turn',
    usage: {
      inputTokens: message.usage?.input_tokens ?? 0,
      outputTokens: message.usage?.output_tokens ?? 0,
      cacheReadTokens: message.usage?.cache_read_input_tokens,
      cacheCreationTokens: message.usage?.cache_creation_input_tokens,
    },
    raw: message,
  }
}

// ── Singleton ───────────────────────────────────────────────────────

let _instance: AnthropicProvider | null = null

export function getAnthropicProvider(): AnthropicProvider {
  if (!_instance) _instance = new AnthropicProvider()
  return _instance
}
