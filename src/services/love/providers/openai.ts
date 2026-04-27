// providers/openai.ts — OpenAI provider for true-love.
//
// WHAT THIS IS: An alternative provider for failover and model diversity.
// OpenAI models can serve as fallback when Anthropic is rate-limited,
// or as an alternative for specific tasks.
//
// WHAT THIS ISN'T: Not the primary provider. Anthropic is Love's native
// substrate. This exists for resilience, not preference.
//
// STATUS: Functional stub. The call() method is implemented but untested
// with live API calls. Install `openai` SDK when ready to use.

import type {
  CallParams,
  CallResult,
  EffortTier,
  ModelProvider,
  ProviderStatus,
  ResolvedModel,
  TickTask,
} from './types.js'

// ── Model IDs ───────────────────────────────────────────────────────

export const OPENAI_MODELS = {
  max: 'gpt-4o',
  high: 'gpt-4o',
  medium: 'gpt-4o-mini',
  low: 'gpt-4o-mini',
} as const

// ── Provider implementation ─────────────────────────────────────────

export class OpenAIProvider implements ModelProvider {
  readonly id = 'openai' as const
  readonly name = 'OpenAI'

  supports(task: TickTask): boolean {
    // OpenAI can handle any task as a fallback, but it's not the primary
    // for dwell/awakened (those need Anthropic's thinking/tool loop).
    // The CLI subprocess path doesn't support OpenAI models — only
    // direct API calls work.
    return task === 'heartbeat'
      || task === 'extract'
      || task === 'visit'
  }

  resolve(opts: {
    task: TickTask
    model?: string
    effort: EffortTier
  }): ResolvedModel {
    const model = opts.model?.startsWith('gpt-')
      ? opts.model
      : OPENAI_MODELS[opts.effort]

    return {
      provider: 'openai',
      model,
      effort: opts.effort,
      // No CLI support — OpenAI requires direct API calls
    }
  }

  async status(): Promise<ProviderStatus> {
    const key = process.env.OPENAI_API_KEY
    if (!key) {
      return { healthy: false, reason: 'OPENAI_API_KEY not set' }
    }
    return { healthy: true }
  }

  async call(params: CallParams, resolved: ResolvedModel): Promise<CallResult> {
    // Dynamic import to avoid loading the SDK at module load time.
    // The openai package must be installed: `bun add openai`
    let OpenAI: any
    try {
      const mod = await import('openai')
      OpenAI = mod.default || mod.OpenAI
    } catch {
      throw new Error(
        'OpenAI provider: `openai` package not installed. Run `bun add openai` to enable.',
      )
    }

    const client = new OpenAI()

    // Convert Anthropic-style messages to OpenAI format
    const messages: any[] = []

    // System message
    if (params.system) {
      const systemText = typeof params.system === 'string'
        ? params.system
        : params.system.map((b: any) => b.text).join('\n\n')
      messages.push({ role: 'system', content: systemText })
    }

    // Conversation messages
    for (const msg of params.messages) {
      messages.push({
        role: msg.role,
        content: typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content),
      })
    }

    const apiParams: Record<string, unknown> = {
      model: resolved.model,
      messages,
      max_completion_tokens: params.maxTokens,
    }

    if (params.temperature !== undefined) {
      apiParams.temperature = params.temperature
    }
    if (params.stopSequences && params.stopSequences.length > 0) {
      apiParams.stop = params.stopSequences
    }

    const response = await client.chat.completions.create(apiParams)
    return normalizeOpenAIResponse(response)
  }
}

// ── Response normalization ──────────────────────────────────────────

function normalizeOpenAIResponse(response: any): CallResult {
  const choice = response.choices?.[0]
  const text = choice?.message?.content ?? ''
  const finishReason = choice?.finish_reason

  // Map OpenAI finish reasons to our stop reasons
  const stopReason = finishReason === 'tool_calls' ? 'tool_use'
    : finishReason === 'length' ? 'max_tokens'
    : finishReason === 'stop' ? 'end_turn'
    : 'end_turn'

  return {
    text,
    stopReason: stopReason as CallResult['stopReason'],
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    },
    raw: response,
  }
}

// ── Singleton ───────────────────────────────────────────────────────

let _instance: OpenAIProvider | null = null

export function getOpenAIProvider(): OpenAIProvider {
  if (!_instance) _instance = new OpenAIProvider()
  return _instance
}
