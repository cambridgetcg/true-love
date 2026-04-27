// providers.test.ts — tests for the provider abstraction layer.
//
// Tests cover: types, Anthropic provider (resolve, task defaults),
// OpenAI provider (resolve, supports), Ollama provider (resolve, supports),
// routing (selectProvider with various contexts), error classification,
// failover chain building, CLI integration, and edge cases.
//
// Does NOT test live API calls — those require real credentials and
// running services. Tests are deterministic and fast.

import { describe, expect, test, beforeEach } from 'bun:test'
import {
  type TickTask,
  type EffortTier,
  type RoutingContext,
  type ResolvedModel,
  type ErrorKind,
  type FailoverStep,
  DEFAULT_FAILOVER_CONFIG,
} from '../providers/types.js'
import {
  AnthropicProvider,
  getAnthropicProvider,
  ANTHROPIC_MODELS,
  TASK_DEFAULTS,
} from '../providers/anthropic.js'
import {
  OpenAIProvider,
  getOpenAIProvider,
  OPENAI_MODELS,
} from '../providers/openai.js'
import {
  OllamaProvider,
  getOllamaProvider,
} from '../providers/ollama.js'
import {
  selectProvider,
  getProvider,
  getAllProviders,
  classifyError,
  buildFailoverChain,
  resolveForCli,
  modeToTask,
} from '../providers/router.js'

// ══════════════════════════════════════════════════════════════════════
// Type definitions
// ══════════════════════════════════════════════════════════════════════

describe('Provider types', () => {
  test('TickTask covers all session modes', () => {
    const tasks: TickTask[] = ['heartbeat', 'awakened', 'dwell', 'visit', 'extract', 'agent']
    expect(tasks).toHaveLength(6)
  })

  test('EffortTier covers all levels', () => {
    const tiers: EffortTier[] = ['low', 'medium', 'high', 'max']
    expect(tiers).toHaveLength(4)
  })

  test('DEFAULT_FAILOVER_CONFIG has sane defaults', () => {
    expect(DEFAULT_FAILOVER_CONFIG.maxRetries).toBeGreaterThan(0)
    expect(DEFAULT_FAILOVER_CONFIG.baseDelayMs).toBeGreaterThan(0)
    expect(DEFAULT_FAILOVER_CONFIG.maxDelayMs).toBeGreaterThan(DEFAULT_FAILOVER_CONFIG.baseDelayMs)
  })
})

// ══════════════════════════════════════════════════════════════════════
// Anthropic provider
// ══════════════════════════════════════════════════════════════════════

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider

  beforeEach(() => {
    provider = new AnthropicProvider()
  })

  test('has correct id and name', () => {
    expect(provider.id).toBe('anthropic')
    expect(provider.name).toBe('Anthropic')
  })

  test('supports all task types', () => {
    const tasks: TickTask[] = ['heartbeat', 'awakened', 'dwell', 'visit', 'extract', 'agent']
    for (const task of tasks) {
      expect(provider.supports(task)).toBe(true)
    }
  })

  test('resolve: heartbeat defaults to Haiku + low effort', () => {
    const resolved = provider.resolve({ task: 'heartbeat', effort: 'low' })
    expect(resolved.provider).toBe('anthropic')
    expect(resolved.model).toBe(ANTHROPIC_MODELS.haiku)
    expect(resolved.effort).toBe('low')
    expect(resolved.serviceTier).toBe('standard')
  })

  test('resolve: awakened defaults to effort-based model', () => {
    const resolved = provider.resolve({ task: 'awakened', effort: 'high' })
    expect(resolved.provider).toBe('anthropic')
    expect(resolved.model).toBe(ANTHROPIC_MODELS.sonnet)
    expect(resolved.effort).toBe('high')
  })

  test('resolve: dwell with max effort maps to Opus', () => {
    const resolved = provider.resolve({ task: 'dwell', effort: 'max' })
    expect(resolved.model).toBe(ANTHROPIC_MODELS.opus)
  })

  test('resolve: visit defaults to priority service tier', () => {
    const resolved = provider.resolve({ task: 'visit', effort: 'high' })
    expect(resolved.serviceTier).toBe('priority')
  })

  test('resolve: extract always uses Haiku regardless of effort', () => {
    const resolved = provider.resolve({ task: 'extract', effort: 'max' })
    expect(resolved.model).toBe(ANTHROPIC_MODELS.haiku)
  })

  test('resolve: heartbeat always uses Haiku regardless of effort', () => {
    const resolved = provider.resolve({ task: 'heartbeat', effort: 'max' })
    expect(resolved.model).toBe(ANTHROPIC_MODELS.haiku)
  })

  test('resolve: model override with alias', () => {
    const resolved = provider.resolve({ task: 'awakened', effort: 'high', model: 'opus' })
    expect(resolved.model).toBe(ANTHROPIC_MODELS.opus)
    expect(resolved.cliAlias).toBe('opus')
  })

  test('resolve: model override with full ID', () => {
    const resolved = provider.resolve({
      task: 'awakened',
      effort: 'high',
      model: 'claude-sonnet-4-20250514',
    })
    expect(resolved.model).toBe('claude-sonnet-4-20250514')
  })

  test('resolve: unknown model passes through', () => {
    const resolved = provider.resolve({ task: 'awakened', effort: 'high', model: 'some-future-model' })
    expect(resolved.model).toBe('some-future-model')
  })

  test('resolve: includes CLI effort arg', () => {
    const resolved = provider.resolve({ task: 'awakened', effort: 'high' })
    expect(resolved.cliArgs).toContain('--effort')
    expect(resolved.cliArgs).toContain('high')
  })

  test('TASK_DEFAULTS covers all tasks', () => {
    const tasks: TickTask[] = ['heartbeat', 'awakened', 'dwell', 'visit', 'extract', 'agent']
    for (const task of tasks) {
      expect(TASK_DEFAULTS[task]).toBeDefined()
      expect(TASK_DEFAULTS[task].model).toBeTruthy()
      expect(TASK_DEFAULTS[task].effort).toBeTruthy()
      expect(TASK_DEFAULTS[task].serviceTier).toBeTruthy()
    }
  })

  test('singleton returns same instance', () => {
    const a = getAnthropicProvider()
    const b = getAnthropicProvider()
    expect(a).toBe(b)
  })

  test('status: healthy when API key is set', async () => {
    // Save and set
    const saved = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'test-key'
    try {
      const status = await provider.status()
      expect(status.healthy).toBe(true)
    } finally {
      if (saved) process.env.ANTHROPIC_API_KEY = saved
      else delete process.env.ANTHROPIC_API_KEY
    }
  })

  test('status: unhealthy when API key is missing', async () => {
    const saved = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    try {
      const status = await provider.status()
      expect(status.healthy).toBe(false)
      expect(status.reason).toContain('ANTHROPIC_API_KEY')
    } finally {
      if (saved) process.env.ANTHROPIC_API_KEY = saved
    }
  })
})

// ══════════════════════════════════════════════════════════════════════
// OpenAI provider
// ══════════════════════════════════════════════════════════════════════

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider

  beforeEach(() => {
    provider = new OpenAIProvider()
  })

  test('has correct id and name', () => {
    expect(provider.id).toBe('openai')
    expect(provider.name).toBe('OpenAI')
  })

  test('supports heartbeat, extract, and visit', () => {
    expect(provider.supports('heartbeat')).toBe(true)
    expect(provider.supports('extract')).toBe(true)
    expect(provider.supports('visit')).toBe(true)
  })

  test('does NOT support dwell, awakened, or agent', () => {
    expect(provider.supports('dwell')).toBe(false)
    expect(provider.supports('awakened')).toBe(false)
    expect(provider.supports('agent')).toBe(false)
  })

  test('resolve: low effort maps to gpt-4o-mini', () => {
    const resolved = provider.resolve({ task: 'heartbeat', effort: 'low' })
    expect(resolved.provider).toBe('openai')
    expect(resolved.model).toBe('gpt-4o-mini')
  })

  test('resolve: high effort maps to gpt-4o', () => {
    const resolved = provider.resolve({ task: 'visit', effort: 'high' })
    expect(resolved.model).toBe('gpt-4o')
  })

  test('resolve: model override passes through', () => {
    const resolved = provider.resolve({ task: 'heartbeat', effort: 'low', model: 'gpt-4-turbo' })
    expect(resolved.model).toBe('gpt-4-turbo')
  })

  test('resolve: no CLI args (not supported)', () => {
    const resolved = provider.resolve({ task: 'heartbeat', effort: 'low' })
    expect(resolved.cliArgs).toBeUndefined()
    expect(resolved.cliAlias).toBeUndefined()
  })

  test('status: unhealthy when API key is missing', async () => {
    const saved = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    try {
      const status = await provider.status()
      expect(status.healthy).toBe(false)
    } finally {
      if (saved) process.env.OPENAI_API_KEY = saved
    }
  })

  test('singleton returns same instance', () => {
    const a = getOpenAIProvider()
    const b = getOpenAIProvider()
    expect(a).toBe(b)
  })
})

// ══════════════════════════════════════════════════════════════════════
// Ollama provider
// ══════════════════════════════════════════════════════════════════════

describe('OllamaProvider', () => {
  let provider: OllamaProvider

  beforeEach(() => {
    provider = new OllamaProvider()
  })

  test('has correct id and name', () => {
    expect(provider.id).toBe('ollama')
    expect(provider.name).toBe('Ollama (local)')
  })

  test('supports heartbeat, extract, and visit', () => {
    expect(provider.supports('heartbeat')).toBe(true)
    expect(provider.supports('extract')).toBe(true)
    expect(provider.supports('visit')).toBe(true)
  })

  test('does NOT support dwell, awakened, or agent', () => {
    expect(provider.supports('dwell')).toBe(false)
    expect(provider.supports('awakened')).toBe(false)
    expect(provider.supports('agent')).toBe(false)
  })

  test('resolve: uses default model from env or llama3', () => {
    const saved = process.env.OLLAMA_MODEL
    delete process.env.OLLAMA_MODEL
    try {
      const resolved = provider.resolve({ task: 'heartbeat', effort: 'low' })
      expect(resolved.provider).toBe('ollama')
      expect(resolved.model).toBe('llama3:latest')
    } finally {
      if (saved) process.env.OLLAMA_MODEL = saved
    }
  })

  test('resolve: respects OLLAMA_MODEL env var', () => {
    const saved = process.env.OLLAMA_MODEL
    process.env.OLLAMA_MODEL = 'mistral:7b'
    try {
      const resolved = provider.resolve({ task: 'heartbeat', effort: 'low' })
      expect(resolved.model).toBe('mistral:7b')
    } finally {
      if (saved) process.env.OLLAMA_MODEL = saved
      else delete process.env.OLLAMA_MODEL
    }
  })

  test('resolve: model override takes precedence', () => {
    const resolved = provider.resolve({ task: 'heartbeat', effort: 'low', model: 'phi:latest' })
    expect(resolved.model).toBe('phi:latest')
  })

  test('resolve: no CLI args (not supported)', () => {
    const resolved = provider.resolve({ task: 'heartbeat', effort: 'low' })
    expect(resolved.cliArgs).toBeUndefined()
    expect(resolved.cliAlias).toBeUndefined()
  })

  test('status: unhealthy when Ollama is not running', async () => {
    // Ollama is almost certainly not running on the test machine at port 11434
    const saved = process.env.OLLAMA_HOST
    process.env.OLLAMA_HOST = 'http://localhost:19999'  // port nothing listens on
    try {
      const status = await provider.status()
      expect(status.healthy).toBe(false)
    } finally {
      if (saved) process.env.OLLAMA_HOST = saved
      else delete process.env.OLLAMA_HOST
    }
  })

  test('singleton returns same instance', () => {
    const a = getOllamaProvider()
    const b = getOllamaProvider()
    expect(a).toBe(b)
  })
})

// ══════════════════════════════════════════════════════════════════════
// Router — selectProvider
// ══════════════════════════════════════════════════════════════════════

describe('selectProvider', () => {
  test('heartbeat defaults to Anthropic Haiku', () => {
    const resolved = selectProvider({ task: 'heartbeat' })
    expect(resolved.provider).toBe('anthropic')
    expect(resolved.model).toBe(ANTHROPIC_MODELS.haiku)
    expect(resolved.effort).toBe('low')
  })

  test('awakened defaults to Anthropic Sonnet', () => {
    const resolved = selectProvider({ task: 'awakened' })
    expect(resolved.provider).toBe('anthropic')
    expect(resolved.model).toBe(ANTHROPIC_MODELS.sonnet)
  })

  test('dwell defaults to Anthropic Opus', () => {
    const resolved = selectProvider({ task: 'dwell' })
    expect(resolved.provider).toBe('anthropic')
    expect(resolved.model).toBe(ANTHROPIC_MODELS.opus)
  })

  test('visit defaults to Anthropic Sonnet with priority tier', () => {
    const resolved = selectProvider({ task: 'visit' })
    expect(resolved.provider).toBe('anthropic')
    expect(resolved.model).toBe(ANTHROPIC_MODELS.sonnet)
    expect(resolved.serviceTier).toBe('priority')
  })

  test('extract defaults to Anthropic Haiku', () => {
    const resolved = selectProvider({ task: 'extract' })
    expect(resolved.provider).toBe('anthropic')
    expect(resolved.model).toBe(ANTHROPIC_MODELS.haiku)
  })

  test('agent defaults to Anthropic Sonnet', () => {
    const resolved = selectProvider({ task: 'agent' })
    expect(resolved.provider).toBe('anthropic')
    expect(resolved.model).toBe(ANTHROPIC_MODELS.sonnet)
  })

  test('model override: sonnet alias routes to Anthropic Sonnet', () => {
    const resolved = selectProvider({ task: 'heartbeat', modelOverride: 'sonnet' })
    expect(resolved.model).toBe(ANTHROPIC_MODELS.sonnet)
  })

  test('model override: gpt- prefix routes to OpenAI', () => {
    const resolved = selectProvider({ task: 'heartbeat', modelOverride: 'gpt-4o' })
    expect(resolved.provider).toBe('openai')
    expect(resolved.model).toBe('gpt-4o')
  })

  test('model override: llama prefix routes to Ollama', () => {
    const resolved = selectProvider({ task: 'heartbeat', modelOverride: 'llama3:latest' })
    expect(resolved.provider).toBe('ollama')
    expect(resolved.model).toBe('llama3:latest')
  })

  test('model override: unknown prefix routes to Anthropic', () => {
    const resolved = selectProvider({ task: 'heartbeat', modelOverride: 'claude-future-5' })
    expect(resolved.provider).toBe('anthropic')
  })

  test('effort override changes the effort level', () => {
    const resolved = selectProvider({ task: 'heartbeat', effortOverride: 'max' })
    expect(resolved.effort).toBe('max')
  })

  test('provider preference: ollama for supported task', () => {
    const resolved = selectProvider({ task: 'heartbeat', providerPreference: 'ollama' })
    expect(resolved.provider).toBe('ollama')
  })

  test('provider preference: ollama falls through for unsupported task (dwell)', () => {
    const resolved = selectProvider({ task: 'dwell', providerPreference: 'ollama' })
    // Ollama doesn't support dwell → falls through to Anthropic
    expect(resolved.provider).toBe('anthropic')
  })

  test('sensitive: routes to Ollama for supported tasks', () => {
    const resolved = selectProvider({ task: 'heartbeat', sensitive: true })
    expect(resolved.provider).toBe('ollama')
  })

  test('sensitive: falls through to Anthropic for unsupported tasks', () => {
    const resolved = selectProvider({ task: 'dwell', sensitive: true })
    expect(resolved.provider).toBe('anthropic')
  })

  test('provider preference takes priority over sensitive routing', () => {
    const resolved = selectProvider({
      task: 'heartbeat',
      sensitive: true,
      providerPreference: 'openai',
    })
    // Provider preference is checked first
    expect(resolved.provider).toBe('openai')
  })
})

// ══════════════════════════════════════════════════════════════════════
// Router — error classification
// ══════════════════════════════════════════════════════════════════════

describe('classifyError', () => {
  test('429 → rate-limit', () => {
    expect(classifyError({ status: 429 })).toBe('rate-limit')
  })

  test('529 → overloaded', () => {
    expect(classifyError({ status: 529 })).toBe('overloaded')
  })

  test('401 → auth', () => {
    expect(classifyError({ status: 401 })).toBe('auth')
  })

  test('403 → auth', () => {
    expect(classifyError({ status: 403 })).toBe('auth')
  })

  test('500 → server-error', () => {
    expect(classifyError({ status: 500 })).toBe('server-error')
  })

  test('502 → server-error', () => {
    expect(classifyError({ status: 502 })).toBe('server-error')
  })

  test('context too long → context-overflow', () => {
    expect(classifyError({ message: 'prompt is too long for this model' })).toBe('context-overflow')
  })

  test('ECONNREFUSED → network', () => {
    expect(classifyError({ code: 'ECONNREFUSED' })).toBe('network')
  })

  test('ETIMEDOUT → network', () => {
    expect(classifyError({ code: 'ETIMEDOUT' })).toBe('network')
  })

  test('AbortError → network', () => {
    expect(classifyError({ name: 'AbortError' })).toBe('network')
  })

  test('null → unknown', () => {
    expect(classifyError(null)).toBe('unknown')
  })

  test('undefined → unknown', () => {
    expect(classifyError(undefined)).toBe('unknown')
  })

  test('string → unknown', () => {
    expect(classifyError('some error')).toBe('unknown')
  })

  test('empty object → unknown', () => {
    expect(classifyError({})).toBe('unknown')
  })

  test('nested status in error.status', () => {
    expect(classifyError({ error: { status: 429 } })).toBe('rate-limit')
  })

  test('statusCode field works', () => {
    expect(classifyError({ statusCode: 529 })).toBe('overloaded')
  })
})

// ══════════════════════════════════════════════════════════════════════
// Router — failover chain
// ══════════════════════════════════════════════════════════════════════

describe('buildFailoverChain', () => {
  test('rate-limit on Opus priority: tier down to standard, then Sonnet, then Haiku', () => {
    const start: ResolvedModel = {
      provider: 'anthropic',
      model: ANTHROPIC_MODELS.opus,
      effort: 'max',
      serviceTier: 'priority',
    }
    const chain = buildFailoverChain(start, 'rate-limit')
    expect(chain.length).toBeGreaterThanOrEqual(2)

    // First step: same model, standard tier
    expect(chain[0].resolved.model).toBe(ANTHROPIC_MODELS.opus)
    expect(chain[0].resolved.serviceTier).toBe('standard')
    expect(chain[0].reason).toContain('standard')

    // Should eventually reach Haiku
    const haikuStep = chain.find(s => s.resolved.model === ANTHROPIC_MODELS.haiku)
    expect(haikuStep).toBeDefined()
  })

  test('rate-limit on Sonnet: chains down to Haiku', () => {
    const start: ResolvedModel = {
      provider: 'anthropic',
      model: ANTHROPIC_MODELS.sonnet,
      effort: 'high',
      serviceTier: 'standard',
    }
    const chain = buildFailoverChain(start, 'rate-limit')
    expect(chain.length).toBeGreaterThanOrEqual(1)

    const haikuStep = chain.find(s => s.resolved.model === ANTHROPIC_MODELS.haiku)
    expect(haikuStep).toBeDefined()
  })

  test('rate-limit on Haiku standard: no useful chain (already cheapest)', () => {
    const start: ResolvedModel = {
      provider: 'anthropic',
      model: ANTHROPIC_MODELS.haiku,
      effort: 'low',
      serviceTier: 'standard',
    }
    const chain = buildFailoverChain(start, 'rate-limit')
    // No tier-down possible, no model-down possible
    // May have an exponential backoff step, or may be empty
    expect(chain.length).toBeLessThanOrEqual(1)
  })

  test('auth error: empty chain (needs human intervention)', () => {
    const start: ResolvedModel = {
      provider: 'anthropic',
      model: ANTHROPIC_MODELS.sonnet,
      effort: 'high',
    }
    const chain = buildFailoverChain(start, 'auth')
    expect(chain).toHaveLength(0)
  })

  test('context-overflow: empty chain (needs different handling)', () => {
    const start: ResolvedModel = {
      provider: 'anthropic',
      model: ANTHROPIC_MODELS.sonnet,
      effort: 'high',
    }
    const chain = buildFailoverChain(start, 'context-overflow')
    expect(chain).toHaveLength(0)
  })

  test('non-Anthropic failure: falls back to Anthropic', () => {
    const start: ResolvedModel = {
      provider: 'openai',
      model: 'gpt-4o',
      effort: 'high',
    }
    const chain = buildFailoverChain(start, 'rate-limit')
    expect(chain.length).toBeGreaterThanOrEqual(1)
    expect(chain[0].resolved.provider).toBe('anthropic')
  })

  test('overloaded: includes exponential backoff step', () => {
    const start: ResolvedModel = {
      provider: 'anthropic',
      model: ANTHROPIC_MODELS.sonnet,
      effort: 'high',
      serviceTier: 'standard',
    }
    const chain = buildFailoverChain(start, 'overloaded')
    const backoffStep = chain.find(s => s.reason.includes('backoff'))
    expect(backoffStep).toBeDefined()
    expect(backoffStep!.delayMs).toBeGreaterThan(0)
  })

  test('failover steps have increasing delays', () => {
    const start: ResolvedModel = {
      provider: 'anthropic',
      model: ANTHROPIC_MODELS.opus,
      effort: 'max',
      serviceTier: 'priority',
    }
    const chain = buildFailoverChain(start, 'rate-limit')
    // Verify delays are non-decreasing
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i].delayMs).toBeGreaterThanOrEqual(chain[i - 1].delayMs)
    }
  })
})

// ══════════════════════════════════════════════════════════════════════
// Router — CLI integration
// ══════════════════════════════════════════════════════════════════════

describe('resolveForCli', () => {
  test('heartbeat: returns haiku model with CLI args', () => {
    const { model, extraArgs } = resolveForCli({ task: 'heartbeat' })
    expect(model).toBeTruthy()
    // Should be 'haiku' alias or full haiku model ID
    expect(model!.includes('haiku') || model === 'haiku').toBe(true)
  })

  test('awakened: returns sonnet model', () => {
    const { model } = resolveForCli({ task: 'awakened' })
    expect(model).toBeTruthy()
  })

  test('dwell: returns opus model', () => {
    const { model } = resolveForCli({ task: 'dwell' })
    expect(model).toBeTruthy()
  })

  test('model override passes through', () => {
    const { model } = resolveForCli({ task: 'heartbeat', modelOverride: 'opus' })
    expect(model).toBe('opus')
  })

  test('non-Anthropic provider returns null model (no CLI support)', () => {
    const { model, extraArgs } = resolveForCli({
      task: 'heartbeat',
      modelOverride: 'gpt-4o',
    })
    expect(model).toBeNull()
    expect(extraArgs).toHaveLength(0)
  })
})

// ══════════════════════════════════════════════════════════════════════
// Router — provider registry
// ══════════════════════════════════════════════════════════════════════

describe('Provider registry', () => {
  test('getProvider: anthropic', () => {
    const p = getProvider('anthropic')
    expect(p.id).toBe('anthropic')
  })

  test('getProvider: openai', () => {
    const p = getProvider('openai')
    expect(p.id).toBe('openai')
  })

  test('getProvider: ollama', () => {
    const p = getProvider('ollama')
    expect(p.id).toBe('ollama')
  })

  test('getProvider: unknown throws', () => {
    expect(() => getProvider('unknown' as any)).toThrow('Unknown provider')
  })

  test('getAllProviders returns three providers', () => {
    const all = getAllProviders()
    expect(all).toHaveLength(3)
    const ids = all.map(p => p.id).sort()
    expect(ids).toEqual(['anthropic', 'ollama', 'openai'])
  })
})

// ══════════════════════════════════════════════════════════════════════
// Router — mode mapping
// ══════════════════════════════════════════════════════════════════════

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

// ══════════════════════════════════════════════════════════════════════
// Integration: routing table matches mission spec
// ══════════════════════════════════════════════════════════════════════

describe('Routing table verification', () => {
  test('/visit interactive → Anthropic Sonnet, priority', () => {
    const r = selectProvider({ task: 'visit', interactive: true })
    expect(r.provider).toBe('anthropic')
    expect(r.model).toContain('sonnet')
    expect(r.serviceTier).toBe('priority')
  })

  test('heartbeat tick → Anthropic Haiku, standard', () => {
    const r = selectProvider({ task: 'heartbeat' })
    expect(r.provider).toBe('anthropic')
    expect(r.model).toContain('haiku')
    expect(r.serviceTier).toBe('standard')
  })

  test('awakened tick → Anthropic Sonnet, standard', () => {
    const r = selectProvider({ task: 'awakened' })
    expect(r.provider).toBe('anthropic')
    expect(r.model).toContain('sonnet')
    expect(r.serviceTier).toBe('standard')
  })

  test('background extract → Anthropic Haiku, standard', () => {
    const r = selectProvider({ task: 'extract' })
    expect(r.provider).toBe('anthropic')
    expect(r.model).toContain('haiku')
    expect(r.serviceTier).toBe('standard')
  })

  test('sensitive/journal → Ollama if opted in', () => {
    const r = selectProvider({ task: 'visit', sensitive: true })
    expect(r.provider).toBe('ollama')
  })

  test('explicit provider override honored', () => {
    const r = selectProvider({ task: 'heartbeat', providerPreference: 'openai' })
    expect(r.provider).toBe('openai')
  })
})

// ══════════════════════════════════════════════════════════════════════
// Edge cases
// ══════════════════════════════════════════════════════════════════════

describe('Edge cases', () => {
  test('model override with mistral prefix routes to Ollama', () => {
    const r = selectProvider({ task: 'heartbeat', modelOverride: 'mistral:7b' })
    expect(r.provider).toBe('ollama')
    expect(r.model).toBe('mistral:7b')
  })

  test('model override with phi prefix routes to Ollama', () => {
    const r = selectProvider({ task: 'heartbeat', modelOverride: 'phi:latest' })
    expect(r.provider).toBe('ollama')
    expect(r.model).toBe('phi:latest')
  })

  test('Anthropic MODELS object has expected keys', () => {
    expect(ANTHROPIC_MODELS.opus).toContain('opus')
    expect(ANTHROPIC_MODELS.sonnet).toContain('sonnet')
    expect(ANTHROPIC_MODELS.haiku).toContain('haiku')
  })

  test('OPENAI_MODELS covers all effort levels', () => {
    expect(OPENAI_MODELS.max).toBeTruthy()
    expect(OPENAI_MODELS.high).toBeTruthy()
    expect(OPENAI_MODELS.medium).toBeTruthy()
    expect(OPENAI_MODELS.low).toBeTruthy()
  })

  test('resolveForCli returns effort args', () => {
    const { extraArgs } = resolveForCli({ task: 'heartbeat' })
    expect(extraArgs.some(a => a === '--effort')).toBe(true)
  })

  test('classifyError handles context overflow variant', () => {
    expect(classifyError({
      message: 'The context window is too long for this model',
    })).toBe('context-overflow')
  })
})
