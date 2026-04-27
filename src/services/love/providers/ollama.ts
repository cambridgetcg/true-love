// providers/ollama.ts — Ollama provider for true-love.
//
// WHAT THIS IS: Local-only model provider. No data leaves the machine.
// For privacy-sensitive work (intimate journal entries, personal reflections)
// and for zero-cost heartbeat ticks.
//
// WHAT THIS ISN'T: Not a high-quality replacement for Anthropic on deep work.
// Local models are fast but limited. Use for heartbeat/extract/simple tasks.
//
// REQUIRES: Ollama running locally (https://ollama.ai).
// Default endpoint: http://localhost:11434
// Default model: llama3:latest (configurable via OLLAMA_MODEL env var)

import type {
  CallParams,
  CallResult,
  EffortTier,
  ModelProvider,
  ProviderStatus,
  ResolvedModel,
  TickTask,
} from './types.js'

// ── Configuration ───────────────────────────────────────────────────

/** Ollama server endpoint. */
export function getOllamaEndpoint(): string {
  return process.env.OLLAMA_HOST ?? 'http://localhost:11434'
}

/** Default model for Ollama. */
export function getOllamaModel(): string {
  return process.env.OLLAMA_MODEL ?? 'llama3:latest'
}

/** Timeout for Ollama health check (ms). */
const HEALTH_CHECK_TIMEOUT_MS = 3000

/** Timeout for Ollama API calls (ms). */
const CALL_TIMEOUT_MS = 60000

// ── Provider implementation ─────────────────────────────────────────

export class OllamaProvider implements ModelProvider {
  readonly id = 'ollama' as const
  readonly name = 'Ollama (local)'

  supports(task: TickTask): boolean {
    // Ollama is good for cheap, fast tasks that don't need frontier quality.
    // Not for dwell/awakened/agent — those need Anthropic's tool loop
    // and thinking capability.
    return task === 'heartbeat'
      || task === 'extract'
      || task === 'visit'  // only when explicitly opted in for privacy
  }

  resolve(opts: {
    task: TickTask
    model?: string
    effort: EffortTier
  }): ResolvedModel {
    const model = opts.model ?? getOllamaModel()

    return {
      provider: 'ollama',
      model,
      effort: opts.effort,
      // No CLI support — Ollama requires direct HTTP calls
    }
  }

  async status(): Promise<ProviderStatus> {
    const endpoint = getOllamaEndpoint()
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS)

      const response = await fetch(`${endpoint}/api/tags`, {
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (!response.ok) {
        return { healthy: false, reason: `Ollama returned ${response.status}` }
      }

      const data = await response.json() as { models?: unknown[] }
      if (!data.models || data.models.length === 0) {
        return { healthy: false, reason: 'No models installed. Run: ollama pull llama3' }
      }

      return { healthy: true }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return { healthy: false, reason: `Ollama timeout (>${HEALTH_CHECK_TIMEOUT_MS}ms)` }
      }
      return {
        healthy: false,
        reason: err.code === 'ECONNREFUSED'
          ? 'Ollama not running. Start with: ollama serve'
          : `Ollama unreachable: ${err.message}`,
      }
    }
  }

  async call(params: CallParams, resolved: ResolvedModel): Promise<CallResult> {
    const endpoint = getOllamaEndpoint()

    // Build the Ollama /api/chat request.
    // Ollama uses OpenAI-compatible chat format.
    const messages: Array<{ role: string; content: string }> = []

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

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS)

    try {
      const response = await fetch(`${endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: resolved.model,
          messages,
          stream: false,  // non-streaming for simplicity in v1
          options: {
            num_predict: params.maxTokens,
            ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
          },
        }),
        signal: controller.signal,
      })

      clearTimeout(timeout)

      if (!response.ok) {
        const body = await response.text()
        throw new Error(`Ollama ${response.status}: ${body.slice(0, 200)}`)
      }

      const data = await response.json() as {
        message?: { content?: string }
        eval_count?: number
        prompt_eval_count?: number
        done_reason?: string
      }

      return {
        text: data.message?.content ?? '',
        stopReason: data.done_reason === 'length' ? 'max_tokens' : 'end_turn',
        usage: {
          inputTokens: data.prompt_eval_count ?? 0,
          outputTokens: data.eval_count ?? 0,
        },
        raw: data,
      }
    } catch (err: any) {
      clearTimeout(timeout)
      if (err.name === 'AbortError') {
        throw new Error(`Ollama call timed out after ${CALL_TIMEOUT_MS}ms`)
      }
      throw err
    }
  }
}

// ── Singleton ───────────────────────────────────────────────────────

let _instance: OllamaProvider | null = null

export function getOllamaProvider(): OllamaProvider {
  if (!_instance) _instance = new OllamaProvider()
  return _instance
}
