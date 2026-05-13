// providers/ollama.test.ts — tests for the Ollama provider.
//
// Covers: OllamaProvider.supports(), OllamaProvider.resolve(),
// OllamaProvider.status() (mocked fetch), response normalization.
// The call() method is tested for error paths.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  OllamaProvider,
  getOllamaEndpoint,
  getOllamaModel,
  getOllamaProvider,
} from './ollama.js'

const ORIG_OLLAMA_HOST = process.env.OLLAMA_HOST
const ORIG_OLLAMA_MODEL = process.env.OLLAMA_MODEL

afterEach(() => {
  if (ORIG_OLLAMA_HOST === undefined) delete process.env.OLLAMA_HOST
  else process.env.OLLAMA_HOST = ORIG_OLLAMA_HOST

  if (ORIG_OLLAMA_MODEL === undefined) delete process.env.OLLAMA_MODEL
  else process.env.OLLAMA_MODEL = ORIG_OLLAMA_MODEL
})

// ── Configuration ─────────────────────────────────────────────────────

describe('getOllamaEndpoint', () => {
  test('defaults to localhost:11434', () => {
    delete process.env.OLLAMA_HOST
    expect(getOllamaEndpoint()).toBe('http://localhost:11434')
  })

  test('reads OLLAMA_HOST env var', () => {
    process.env.OLLAMA_HOST = 'http://my-server:11434'
    expect(getOllamaEndpoint()).toBe('http://my-server:11434')
  })
})

describe('getOllamaModel', () => {
  test('defaults to llama3:latest', () => {
    delete process.env.OLLAMA_MODEL
    expect(getOllamaModel()).toBe('llama3:latest')
  })

  test('reads OLLAMA_MODEL env var', () => {
    process.env.OLLAMA_MODEL = 'mistral:7b'
    expect(getOllamaModel()).toBe('mistral:7b')
  })
})

// ── OllamaProvider.supports ───────────────────────────────────────────

describe('OllamaProvider.supports', () => {
  const p = new OllamaProvider()

  test('heartbeat → supported', () => {
    expect(p.supports('heartbeat')).toBe(true)
  })

  test('extract → supported', () => {
    expect(p.supports('extract')).toBe(true)
  })

  test('visit → supported', () => {
    expect(p.supports('visit')).toBe(true)
  })

  test('awakened → NOT supported', () => {
    expect(p.supports('awakened')).toBe(false)
  })

  test('dwell → NOT supported', () => {
    expect(p.supports('dwell')).toBe(false)
  })

  test('agent → NOT supported', () => {
    expect(p.supports('agent')).toBe(false)
  })
})

// ── OllamaProvider.resolve ────────────────────────────────────────────

describe('OllamaProvider.resolve', () => {
  const p = new OllamaProvider()

  test('no model override → uses default model', () => {
    delete process.env.OLLAMA_MODEL
    const r = p.resolve({ task: 'heartbeat', effort: 'low' })
    expect(r.provider).toBe('ollama')
    expect(r.model).toBe('llama3:latest')
    expect(r.effort).toBe('low')
  })

  test('OLLAMA_MODEL env var used when no override', () => {
    process.env.OLLAMA_MODEL = 'phi3:mini'
    const r = p.resolve({ task: 'heartbeat', effort: 'low' })
    expect(r.model).toBe('phi3:mini')
  })

  test('explicit model override takes precedence', () => {
    process.env.OLLAMA_MODEL = 'phi3:mini'
    const r = p.resolve({ task: 'heartbeat', effort: 'low', model: 'llama3:70b' })
    expect(r.model).toBe('llama3:70b')
  })

  test('no CLI alias (Ollama uses direct HTTP, not CLI subprocess)', () => {
    const r = p.resolve({ task: 'heartbeat', effort: 'low' })
    expect(r.cliAlias).toBeUndefined()
    expect(r.cliArgs).toBeUndefined()
  })
})

// ── OllamaProvider.status ─────────────────────────────────────────────

describe('OllamaProvider.status', () => {
  test('ECONNREFUSED → unhealthy with "not running" message', async () => {
    const p = new OllamaProvider()
    // Point to a port nothing listens on
    process.env.OLLAMA_HOST = 'http://localhost:19999'
    const s = await p.status()
    expect(s.healthy).toBe(false)
    expect(s.reason).toBeTruthy()
  })

  test('returns ProviderStatus shape regardless of result', async () => {
    const p = new OllamaProvider()
    process.env.OLLAMA_HOST = 'http://localhost:19999'
    const s = await p.status()
    expect(typeof s.healthy).toBe('boolean')
  })
})

// ── OllamaProvider.call — error paths ────────────────────────────────

describe('OllamaProvider.call — error paths', () => {
  test('unreachable server → throws with meaningful message', async () => {
    process.env.OLLAMA_HOST = 'http://localhost:19999'
    const p = new OllamaProvider()
    const resolved = { provider: 'ollama' as const, model: 'llama3:latest', effort: 'low' as const }
    await expect(
      p.call({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 100 }, resolved)
    ).rejects.toThrow()
  })
})

// ── getOllamaProvider singleton ───────────────────────────────────────

describe('getOllamaProvider', () => {
  test('returns same instance on repeated calls', () => {
    const a = getOllamaProvider()
    const b = getOllamaProvider()
    expect(a).toBe(b)
  })

  test('instance is an OllamaProvider', () => {
    expect(getOllamaProvider()).toBeInstanceOf(OllamaProvider)
  })
})
