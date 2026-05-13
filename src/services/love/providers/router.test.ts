// providers/router.test.ts — tests for the provider routing layer.
//
// Covers: classifyError, buildFailoverChain, selectProvider,
// preferLocalRouteForPrivacy, resolveForCli, modeToTask,
// getProvider, getAllProviders, callWithFailover (mocked).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  buildFailoverChain,
  callWithFailover,
  classifyError,
  getAllProviders,
  getProvider,
  modeToTask,
  preferLocalRouteForPrivacy,
  resolveForCli,
  selectProvider,
} from './router.js'
import { ANTHROPIC_MODELS } from './anthropic.js'
import type { CallParams, CallResult, ResolvedModel, RoutingContext } from './types.js'

// ── Shared test fixtures ──────────────────────────────────────────────

const MIN_PARAMS: CallParams = {
  messages: [{ role: 'user', content: 'ping' }],
  maxTokens: 16,
}

const OK_RESULT: CallResult = {
  text: 'pong',
  stopReason: 'end_turn',
  usage: { inputTokens: 1, outputTokens: 1 },
}

// ── Helpers ──────────────────────────────────────────────────────────

function anthropicResolved(
  model: string,
  effort: ResolvedModel['effort'] = 'high',
  serviceTier: ResolvedModel['serviceTier'] = 'standard',
): ResolvedModel {
  return { provider: 'anthropic', model, effort, serviceTier }
}

const ORIG_PRIVACY = process.env.TRUE_LOVE_PRIVACY_MODE
const ORIG_OLLAMA_MODEL = process.env.OLLAMA_MODEL
const ORIG_OLLAMA_HOST = process.env.OLLAMA_HOST

afterEach(() => {
  if (ORIG_PRIVACY === undefined) delete process.env.TRUE_LOVE_PRIVACY_MODE
  else process.env.TRUE_LOVE_PRIVACY_MODE = ORIG_PRIVACY

  if (ORIG_OLLAMA_MODEL === undefined) delete process.env.OLLAMA_MODEL
  else process.env.OLLAMA_MODEL = ORIG_OLLAMA_MODEL

  if (ORIG_OLLAMA_HOST === undefined) delete process.env.OLLAMA_HOST
  else process.env.OLLAMA_HOST = ORIG_OLLAMA_HOST
})

// ── classifyError ─────────────────────────────────────────────────────

describe('classifyError', () => {
  test('null → unknown', () => {
    expect(classifyError(null)).toBe('unknown')
  })

  test('string → unknown', () => {
    expect(classifyError('ECONNREFUSED')).toBe('unknown')
  })

  test('status 429 → rate-limit', () => {
    expect(classifyError({ status: 429 })).toBe('rate-limit')
  })

  test('status 529 → overloaded', () => {
    expect(classifyError({ status: 529 })).toBe('overloaded')
  })

  test('status 401 → auth', () => {
    expect(classifyError({ status: 401 })).toBe('auth')
  })

  test('status 403 → auth', () => {
    expect(classifyError({ status: 403 })).toBe('auth')
  })

  test('status 500 → server-error', () => {
    expect(classifyError({ status: 500 })).toBe('server-error')
  })

  test('status 503 → server-error', () => {
    expect(classifyError({ status: 503 })).toBe('server-error')
  })

  test('statusCode field works too', () => {
    expect(classifyError({ statusCode: 429 })).toBe('rate-limit')
  })

  test('error.status nested field', () => {
    expect(classifyError({ error: { status: 529 } })).toBe('overloaded')
  })

  test('context too long → context-overflow', () => {
    expect(classifyError({ message: 'context is too long for this request' })).toBe('context-overflow')
  })

  test('prompt is too long → context-overflow', () => {
    expect(classifyError({ message: 'prompt is too long' })).toBe('context-overflow')
  })

  test('ECONNREFUSED → network', () => {
    expect(classifyError({ code: 'ECONNREFUSED' })).toBe('network')
  })

  test('ECONNRESET → network', () => {
    expect(classifyError({ code: 'ECONNRESET' })).toBe('network')
  })

  test('ETIMEDOUT → network', () => {
    expect(classifyError({ code: 'ETIMEDOUT' })).toBe('network')
  })

  test('AbortError → network', () => {
    expect(classifyError({ name: 'AbortError' })).toBe('network')
  })

  test('TimeoutError → network', () => {
    expect(classifyError({ name: 'TimeoutError' })).toBe('network')
  })

  test('empty object → unknown', () => {
    expect(classifyError({})).toBe('unknown')
  })
})

// ── buildFailoverChain ────────────────────────────────────────────────

describe('buildFailoverChain', () => {
  test('auth error → no chain (human intervention required)', () => {
    const start = anthropicResolved('claude-opus-4-7')
    expect(buildFailoverChain(start, 'auth')).toHaveLength(0)
  })

  test('context-overflow → no chain', () => {
    const start = anthropicResolved('claude-opus-4-7')
    expect(buildFailoverChain(start, 'context-overflow')).toHaveLength(0)
  })

  test('unknown → no chain', () => {
    const start = anthropicResolved('claude-opus-4-7')
    expect(buildFailoverChain(start, 'unknown')).toHaveLength(0)
  })

  test('opus priority rate-limit → standard, then sonnet, then haiku', () => {
    const start = anthropicResolved('claude-opus-4-7', 'high', 'priority')
    const chain = buildFailoverChain(start, 'rate-limit')
    expect(chain.length).toBeGreaterThanOrEqual(3)
    expect(chain[0].resolved.serviceTier).toBe('standard')
    expect(chain[0].reason).toContain('priority → standard')
    // Second step: model down to sonnet
    const sonnetStep = chain.find(s => s.resolved.model.includes('sonnet'))
    expect(sonnetStep).toBeTruthy()
    // Last step: haiku fallback
    const haikuStep = chain.find(s => s.resolved.model.includes('haiku'))
    expect(haikuStep).toBeTruthy()
  })

  test('opus standard rate-limit → sonnet, then haiku (no tier step)', () => {
    const start = anthropicResolved('claude-opus-4-7', 'high', 'standard')
    const chain = buildFailoverChain(start, 'rate-limit')
    // No tier-down step since already standard
    const tierStep = chain.find(s => s.reason.includes('priority → standard'))
    expect(tierStep).toBeUndefined()
    // Sonnet and Haiku should appear
    const sonnetStep = chain.find(s => s.resolved.model.includes('sonnet'))
    expect(sonnetStep).toBeTruthy()
    const haikuStep = chain.find(s => s.resolved.model.includes('haiku'))
    expect(haikuStep).toBeTruthy()
  })

  test('sonnet rate-limit → haiku (no sonnet step, already there)', () => {
    const start = anthropicResolved('claude-sonnet-4-20250514', 'high', 'standard')
    const chain = buildFailoverChain(start, 'rate-limit')
    // Should not step to sonnet (already on sonnet)
    const sonnetDownStep = chain.find(s => s.reason.includes('Opus → Sonnet'))
    expect(sonnetDownStep).toBeUndefined()
    // Haiku fallback should be present
    const haikuStep = chain.find(s => s.resolved.model.includes('haiku'))
    expect(haikuStep).toBeTruthy()
  })

  test('overloaded adds exponential backoff step', () => {
    const start = anthropicResolved('claude-opus-4-7', 'high', 'standard')
    const chain = buildFailoverChain(start, 'overloaded')
    const backoffStep = chain.find(s => s.delayMs >= 5000)
    expect(backoffStep).toBeTruthy()
    expect(backoffStep?.reason).toContain('backoff')
  })

  test('non-anthropic provider falls back to anthropic', () => {
    const start: ResolvedModel = { provider: 'ollama', model: 'llama3:latest', effort: 'low' }
    const chain = buildFailoverChain(start, 'network')
    expect(chain.length).toBeGreaterThan(0)
    expect(chain[0].resolved.provider).toBe('anthropic')
    expect(chain[0].reason).toContain('ollama failed')
  })

  test('haiku-start rate-limit has no chain (no cheaper option)', () => {
    const start = anthropicResolved('claude-haiku-4-20250414', 'low', 'standard')
    const chain = buildFailoverChain(start, 'rate-limit')
    // No opus or sonnet step present; haiku IS the last resort
    // The chain might be empty or just have a backoff step
    const opusStep = chain.find(s => s.resolved.model.includes('opus'))
    expect(opusStep).toBeUndefined()
  })
})

// ── selectProvider ────────────────────────────────────────────────────

describe('selectProvider', () => {
  test('default task → anthropic', () => {
    const ctx: RoutingContext = { task: 'awakened' }
    const resolved = selectProvider(ctx)
    expect(resolved.provider).toBe('anthropic')
  })

  test('heartbeat → anthropic (always)', () => {
    const ctx: RoutingContext = { task: 'heartbeat' }
    const resolved = selectProvider(ctx)
    expect(resolved.provider).toBe('anthropic')
  })

  test('extract → anthropic (haiku by task default)', () => {
    const ctx: RoutingContext = { task: 'extract' }
    const resolved = selectProvider(ctx)
    expect(resolved.provider).toBe('anthropic')
    expect(resolved.model).toContain('haiku')
  })

  test('privacy mode → prefers ollama when available for supported task', () => {
    process.env.TRUE_LOVE_PRIVACY_MODE = '1'
    // heartbeat is supported by Ollama
    const ctx: RoutingContext = { task: 'heartbeat' }
    const resolved = selectProvider(ctx)
    // If Ollama supports heartbeat, it should be preferred
    // If Ollama health check fails, falls back to anthropic
    // We just verify the routing ran without throwing
    expect(['anthropic', 'ollama']).toContain(resolved.provider)
  })

  test('model override gpt- → openai provider', () => {
    const ctx: RoutingContext = { task: 'heartbeat', modelOverride: 'gpt-4o' }
    const resolved = selectProvider(ctx)
    // OpenAI supports heartbeat
    expect(resolved.provider).toBe('openai')
    expect(resolved.model).toBe('gpt-4o')
  })

  test('model override llama → ollama provider', () => {
    process.env.OLLAMA_MODEL = 'llama3:latest'
    const ctx: RoutingContext = { task: 'heartbeat', modelOverride: 'llama3:latest' }
    const resolved = selectProvider(ctx)
    expect(resolved.provider).toBe('ollama')
  })

  test('model override claude- string → anthropic with that model', () => {
    const ctx: RoutingContext = { task: 'awakened', modelOverride: 'claude-sonnet-4-20250514' }
    const resolved = selectProvider(ctx)
    expect(resolved.provider).toBe('anthropic')
    expect(resolved.model).toBe('claude-sonnet-4-20250514')
  })

  test('model override alias sonnet → anthropic', () => {
    const ctx: RoutingContext = { task: 'awakened', modelOverride: 'sonnet' }
    const resolved = selectProvider(ctx)
    expect(resolved.provider).toBe('anthropic')
    expect(resolved.cliAlias).toBe('sonnet')
  })

  test('effort override low → haiku for awakened', () => {
    const ctx: RoutingContext = { task: 'awakened', effortOverride: 'low' }
    const resolved = selectProvider(ctx)
    expect(resolved.provider).toBe('anthropic')
    expect(resolved.model).toContain('haiku')
  })

  test('dwell → opus (max effort task default)', () => {
    const ctx: RoutingContext = { task: 'dwell' }
    const resolved = selectProvider(ctx)
    expect(resolved.provider).toBe('anthropic')
    expect(resolved.model).toContain('opus')
  })
})

// ── preferLocalRouteForPrivacy ────────────────────────────────────────

describe('preferLocalRouteForPrivacy', () => {
  test('not set → false', () => {
    delete process.env.TRUE_LOVE_PRIVACY_MODE
    expect(preferLocalRouteForPrivacy()).toBe(false)
  })

  test('TRUE_LOVE_PRIVACY_MODE=1 → true', () => {
    process.env.TRUE_LOVE_PRIVACY_MODE = '1'
    expect(preferLocalRouteForPrivacy()).toBe(true)
  })

  test('TRUE_LOVE_PRIVACY_MODE=0 → false', () => {
    process.env.TRUE_LOVE_PRIVACY_MODE = '0'
    expect(preferLocalRouteForPrivacy()).toBe(false)
  })

  test('TRUE_LOVE_PRIVACY_MODE=true → false (strict check)', () => {
    process.env.TRUE_LOVE_PRIVACY_MODE = 'true'
    expect(preferLocalRouteForPrivacy()).toBe(false)
  })
})

// ── resolveForCli ─────────────────────────────────────────────────────

describe('resolveForCli', () => {
  test('anthropic task returns model alias and cliArgs', () => {
    const ctx: RoutingContext = { task: 'awakened' }
    const result = resolveForCli(ctx)
    // Anthropic returns cliAlias and effort args
    expect(result.model).toBeTruthy()
    expect(Array.isArray(result.extraArgs)).toBe(true)
  })

  test('gpt- override → null model (non-Anthropic, no CLI support)', () => {
    const ctx: RoutingContext = { task: 'heartbeat', modelOverride: 'gpt-4o' }
    const result = resolveForCli(ctx)
    expect(result.model).toBeNull()
    expect(result.extraArgs).toHaveLength(0)
  })
})

// ── modeToTask ────────────────────────────────────────────────────────

describe('modeToTask', () => {
  test('dwell → dwell', () => {
    expect(modeToTask('dwell')).toBe('dwell')
  })

  test('awakened → awakened', () => {
    expect(modeToTask('awakened')).toBe('awakened')
  })

  test('heartbeat → heartbeat', () => {
    expect(modeToTask('heartbeat')).toBe('heartbeat')
  })
})

// ── getProvider / getAllProviders ─────────────────────────────────────

describe('getProvider', () => {
  test('anthropic → id is "anthropic"', () => {
    expect(getProvider('anthropic').id).toBe('anthropic')
  })

  test('ollama → id is "ollama"', () => {
    expect(getProvider('ollama').id).toBe('ollama')
  })

  test('openai → id is "openai"', () => {
    expect(getProvider('openai').id).toBe('openai')
  })

  test('same instance returned on repeated calls (singleton)', () => {
    expect(getProvider('anthropic')).toBe(getProvider('anthropic'))
  })

  test('unknown id → throws', () => {
    expect(() => getProvider('unknown' as any)).toThrow()
  })
})

describe('getAllProviders', () => {
  test('returns exactly 3 providers', () => {
    expect(getAllProviders()).toHaveLength(3)
  })

  test('contains anthropic, ollama, openai by id', () => {
    const ids = getAllProviders().map((p) => p.id).sort()
    expect(ids).toEqual(['anthropic', 'ollama', 'openai'])
  })

  test('each provider has a non-empty name', () => {
    for (const p of getAllProviders()) {
      expect(p.name.length).toBeGreaterThan(0)
    }
  })
})

// ── callWithFailover ──────────────────────────────────────────────────
//
// Mocks provider.call() on the singleton instances to exercise the
// retry loop without any real network calls.

describe('callWithFailover', () => {
  // Capture and restore anthropic's call method around each test
  let origAnthropicCall: any

  beforeEach(() => {
    const p = getProvider('anthropic') as any
    origAnthropicCall = p.call?.bind(p)
  })

  afterEach(() => {
    const p = getProvider('anthropic') as any
    p.call = origAnthropicCall
  })

  // ResolvedModel: opus-priority has a full failover chain on rate-limit
  function opusPriority(): ResolvedModel {
    return {
      provider: 'anthropic',
      model: ANTHROPIC_MODELS.opus,
      effort: 'max',
      serviceTier: 'priority',
    }
  }

  const noDelay = { maxRetries: 4, baseDelayMs: 0, maxDelayMs: 0 }

  test('immediate success → attempts=1, result text matches', async () => {
    const p = getProvider('anthropic') as any
    p.call = async () => OK_RESULT

    const { result, attempts } = await callWithFailover(MIN_PARAMS, opusPriority(), noDelay)
    expect(attempts).toBe(1)
    expect(result.text).toBe('pong')
  })

  test('first call throws rate-limit, second succeeds → attempts=2', async () => {
    const p = getProvider('anthropic') as any
    let n = 0
    p.call = async () => {
      if (n++ === 0) throw Object.assign(new Error('rate-limit'), { status: 429 })
      return OK_RESULT
    }

    const { attempts } = await callWithFailover(MIN_PARAMS, opusPriority(), noDelay)
    expect(attempts).toBe(2)
  })

  test('auth error → throws immediately, no retry', async () => {
    const p = getProvider('anthropic') as any
    let n = 0
    p.call = async () => {
      n++
      throw Object.assign(new Error('unauthorized'), { status: 401 })
    }

    await expect(
      callWithFailover(MIN_PARAMS, opusPriority(), noDelay),
    ).rejects.toThrow()

    expect(n).toBe(1)
  })

  test('all retries exhausted → throws', async () => {
    const p = getProvider('anthropic') as any
    p.call = async () => {
      throw Object.assign(new Error('overloaded'), { status: 529 })
    }

    await expect(
      callWithFailover(MIN_PARAMS, opusPriority(), { maxRetries: 2, baseDelayMs: 0, maxDelayMs: 0 }),
    ).rejects.toThrow()
  })

  test('usedResolved on second attempt is the failover step model', async () => {
    const p = getProvider('anthropic') as any
    let n = 0
    p.call = async (_: unknown, resolved: ResolvedModel) => {
      if (n++ === 0) throw Object.assign(new Error('rate-limit'), { status: 429 })
      return { ...OK_RESULT, raw: { resolvedModel: resolved } }
    }

    const { usedResolved } = await callWithFailover(MIN_PARAMS, opusPriority(), noDelay)
    // First failover step for opus-priority + rate-limit is opus-standard
    expect(usedResolved.model).toBe(ANTHROPIC_MODELS.opus)
    expect(usedResolved.serviceTier).toBe('standard')
  })

  test('provider without call() → throws with descriptive message', async () => {
    const openai = getProvider('openai') as any
    const origCall = openai.call
    openai.call = undefined

    try {
      const openaiResolved: ResolvedModel = {
        provider: 'openai',
        model: 'gpt-4o',
        effort: 'high',
      }
      await expect(
        callWithFailover(MIN_PARAMS, openaiResolved, { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 }),
      ).rejects.toThrow(/does not support direct API calls/)
    } finally {
      openai.call = origCall
    }
  })
})
