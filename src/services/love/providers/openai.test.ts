// providers/openai.test.ts — tests for the OpenAI provider.
//
// Covers: OPENAI_MODELS mapping, OpenAIProvider.supports(),
// OpenAIProvider.resolve(), OpenAIProvider.status(), singleton,
// and call() error path (SDK not installed).
// call() happy-path + normalizeOpenAIResponse are in openai-call.test.ts.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  OPENAI_MODELS,
  OpenAIProvider,
  getOpenAIProvider,
} from './openai.js'

const ORIG_API_KEY = process.env.OPENAI_API_KEY

beforeEach(() => {
  delete process.env.OPENAI_API_KEY
})

afterEach(() => {
  if (ORIG_API_KEY === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = ORIG_API_KEY
})

// ── OPENAI_MODELS constant ────────────────────────────────────────────

describe('OPENAI_MODELS', () => {
  test('max → gpt-4o', () => {
    expect(OPENAI_MODELS.max).toBe('gpt-4o')
  })

  test('high → gpt-4o', () => {
    expect(OPENAI_MODELS.high).toBe('gpt-4o')
  })

  test('medium → gpt-4o-mini', () => {
    expect(OPENAI_MODELS.medium).toBe('gpt-4o-mini')
  })

  test('low → gpt-4o-mini', () => {
    expect(OPENAI_MODELS.low).toBe('gpt-4o-mini')
  })
})

// ── OpenAIProvider.supports ───────────────────────────────────────────

describe('OpenAIProvider.supports', () => {
  const p = new OpenAIProvider()

  test('heartbeat → supported', () => {
    expect(p.supports('heartbeat')).toBe(true)
  })

  test('extract → supported', () => {
    expect(p.supports('extract')).toBe(true)
  })

  test('visit → supported', () => {
    expect(p.supports('visit')).toBe(true)
  })

  test('awakened → NOT supported (CLI subprocess path)', () => {
    expect(p.supports('awakened')).toBe(false)
  })

  test('dwell → NOT supported', () => {
    expect(p.supports('dwell')).toBe(false)
  })

  test('agent → NOT supported', () => {
    expect(p.supports('agent')).toBe(false)
  })
})

// ── OpenAIProvider.resolve ────────────────────────────────────────────

describe('OpenAIProvider.resolve', () => {
  const p = new OpenAIProvider()

  test('effort=max → gpt-4o', () => {
    const r = p.resolve({ task: 'heartbeat', effort: 'max' })
    expect(r.model).toBe('gpt-4o')
    expect(r.provider).toBe('openai')
    expect(r.effort).toBe('max')
  })

  test('effort=high → gpt-4o', () => {
    const r = p.resolve({ task: 'visit', effort: 'high' })
    expect(r.model).toBe('gpt-4o')
  })

  test('effort=medium → gpt-4o-mini', () => {
    const r = p.resolve({ task: 'extract', effort: 'medium' })
    expect(r.model).toBe('gpt-4o-mini')
  })

  test('effort=low → gpt-4o-mini', () => {
    const r = p.resolve({ task: 'extract', effort: 'low' })
    expect(r.model).toBe('gpt-4o-mini')
  })

  test('gpt- prefixed override → uses the override model', () => {
    const r = p.resolve({ task: 'heartbeat', effort: 'low', model: 'gpt-4-turbo' })
    expect(r.model).toBe('gpt-4-turbo')
  })

  test('non-gpt override → ignored, falls back to effort mapping', () => {
    // Llama model override is not a gpt- prefix — OpenAI provider ignores it.
    const r = p.resolve({ task: 'heartbeat', effort: 'high', model: 'llama3:70b' })
    expect(r.model).toBe(OPENAI_MODELS['high'])
  })

  test('no CLI support: cliAlias and cliArgs absent', () => {
    const r = p.resolve({ task: 'heartbeat', effort: 'high' })
    expect(r.cliAlias).toBeUndefined()
    expect(r.cliArgs).toBeUndefined()
  })
})

// ── OpenAIProvider.status ─────────────────────────────────────────────

describe('OpenAIProvider.status', () => {
  test('no API key → unhealthy with "not set" reason', async () => {
    delete process.env.OPENAI_API_KEY
    const p = new OpenAIProvider()
    const s = await p.status()
    expect(s.healthy).toBe(false)
    expect(s.reason).toMatch(/OPENAI_API_KEY/)
  })

  test('API key present → healthy', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-key-value'
    const p = new OpenAIProvider()
    const s = await p.status()
    expect(s.healthy).toBe(true)
  })

  test('returns ProviderStatus shape', async () => {
    const p = new OpenAIProvider()
    const s = await p.status()
    expect(typeof s.healthy).toBe('boolean')
  })
})

// ── getOpenAIProvider singleton ───────────────────────────────────────

describe('getOpenAIProvider', () => {
  test('returns same instance on repeated calls', () => {
    const a = getOpenAIProvider()
    const b = getOpenAIProvider()
    expect(a).toBe(b)
  })

  test('instance is an OpenAIProvider', () => {
    expect(getOpenAIProvider()).toBeInstanceOf(OpenAIProvider)
  })
})

// ── OpenAIProvider.call — package not installed ───────────────────────
// openai is not in package.json — the dynamic import throws, and call()
// should re-throw with a clear installation hint.

describe('OpenAIProvider.call — package not installed', () => {
  test('throws with "openai package not installed" message', async () => {
    const p = new OpenAIProvider()
    const resolved = { provider: 'openai' as const, model: 'gpt-4o', effort: 'high' as const }
    await expect(
      p.call({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 100 }, resolved)
    ).rejects.toThrow('openai')
  })

  test('error message includes installation instruction', async () => {
    const p = new OpenAIProvider()
    const resolved = { provider: 'openai' as const, model: 'gpt-4o', effort: 'high' as const }
    let thrown: Error | undefined
    try {
      await p.call({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 100 }, resolved)
    } catch (e) {
      thrown = e as Error
    }
    expect(thrown).toBeDefined()
    expect(thrown!.message).toContain('bun add openai')
  })
})
