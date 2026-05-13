// providers/openai-call.test.ts — tests for OpenAIProvider.call() and
// the private normalizeOpenAIResponse function (tested via call()).
//
// Uses mock.module to intercept import('openai') without installing the
// SDK. Covers: stop-reason mapping (all 4 paths), text extraction,
// usage normalization, message conversion (system string/array/absent,
// content string/object), API param forwarding (temperature,
// stopSequences, maxTokens, model), and the "no constructor" error path.
//
// NOTE: The "SDK package genuinely not installed" error path requires
// running openai.test.ts in ISOLATION (not alongside this file), because
// the mock.module here intercepts import('openai') process-wide.

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { ResolvedModel } from './types.js'

// ── Mock factory ──────────────────────────────────────────────────────
// Bun hoists mock.module calls so this intercepts the dynamic
// import('openai') inside call() for every test in this file.
// _mockConstructor=null simulates "SDK installed but exports are broken",
// which exercises the generic throw-propagation path in call().

let _capturedApiParams: Record<string, unknown> | null = null
let _nextResponse: Record<string, unknown> | null = null
let _mockConstructor: (new () => unknown) | null = null  // null = broken SDK

mock.module('openai', () => ({
  get default() { return _mockConstructor },
}))

// Static import AFTER mock.module so the dynamic import inside call()
// gets the mock, not a missing-module error.
import { OpenAIProvider } from './openai.js'

// ── Helpers ───────────────────────────────────────────────────────────

const p = new OpenAIProvider()

const BASE_RESOLVED: ResolvedModel = {
  provider: 'openai',
  model: 'gpt-4o',
  effort: 'high',
}

function makeApiResponse(opts: {
  text?: string
  finishReason?: string
  promptTokens?: number
  completionTokens?: number
  choices?: unknown[]
  omitUsage?: boolean
}): Record<string, unknown> {
  const choices = opts.choices ?? [
    {
      message: { content: opts.text ?? 'ok' },
      finish_reason: opts.finishReason ?? 'stop',
    },
  ]
  const result: Record<string, unknown> = { choices }
  if (!opts.omitUsage) {
    result.usage = {
      prompt_tokens: opts.promptTokens ?? 10,
      completion_tokens: opts.completionTokens ?? 5,
    }
  }
  return result
}

beforeEach(() => {
  _capturedApiParams = null
  _nextResponse = null
  // Default: working mock client
  _mockConstructor = class MockOpenAIClient {
    chat = {
      completions: {
        create: async (params: Record<string, unknown>) => {
          _capturedApiParams = params
          return _nextResponse
        },
      },
    }
  } as any
})

// ── normalizeOpenAIResponse — stop reason ─────────────────────────────

describe('normalizeOpenAIResponse — stop reason mapping', () => {
  test('finish_reason "stop" → stopReason "end_turn"', async () => {
    _nextResponse = makeApiResponse({ finishReason: 'stop' })
    const r = await p.call(
      { messages: [{ role: 'user', content: 'hi' }], maxTokens: 50 },
      BASE_RESOLVED,
    )
    expect(r.stopReason).toBe('end_turn')
  })

  test('finish_reason "length" → stopReason "max_tokens"', async () => {
    _nextResponse = makeApiResponse({ finishReason: 'length' })
    const r = await p.call(
      { messages: [{ role: 'user', content: 'hi' }], maxTokens: 50 },
      BASE_RESOLVED,
    )
    expect(r.stopReason).toBe('max_tokens')
  })

  test('finish_reason "tool_calls" → stopReason "tool_use"', async () => {
    _nextResponse = makeApiResponse({ finishReason: 'tool_calls' })
    const r = await p.call(
      { messages: [{ role: 'user', content: 'hi' }], maxTokens: 50 },
      BASE_RESOLVED,
    )
    expect(r.stopReason).toBe('tool_use')
  })

  test('finish_reason "content_filter" (unknown) → stopReason "end_turn" (default)', async () => {
    _nextResponse = makeApiResponse({ finishReason: 'content_filter' })
    const r = await p.call(
      { messages: [{ role: 'user', content: 'hi' }], maxTokens: 50 },
      BASE_RESOLVED,
    )
    expect(r.stopReason).toBe('end_turn')
  })

  test('empty choices array → text "" and stopReason "end_turn"', async () => {
    _nextResponse = makeApiResponse({ choices: [] })
    const r = await p.call(
      { messages: [{ role: 'user', content: 'hi' }], maxTokens: 50 },
      BASE_RESOLVED,
    )
    expect(r.text).toBe('')
    expect(r.stopReason).toBe('end_turn')
  })
})

// ── normalizeOpenAIResponse — text + usage ────────────────────────────

describe('normalizeOpenAIResponse — text and usage', () => {
  test('text is extracted from choice.message.content', async () => {
    _nextResponse = makeApiResponse({ text: 'The answer is 42.' })
    const r = await p.call(
      { messages: [{ role: 'user', content: 'hi' }], maxTokens: 50 },
      BASE_RESOLVED,
    )
    expect(r.text).toBe('The answer is 42.')
  })

  test('prompt_tokens → inputTokens, completion_tokens → outputTokens', async () => {
    _nextResponse = makeApiResponse({ promptTokens: 120, completionTokens: 33 })
    const r = await p.call(
      { messages: [{ role: 'user', content: 'hi' }], maxTokens: 50 },
      BASE_RESOLVED,
    )
    expect(r.usage.inputTokens).toBe(120)
    expect(r.usage.outputTokens).toBe(33)
  })

  test('missing usage object → 0 / 0 (graceful fallback)', async () => {
    _nextResponse = makeApiResponse({ omitUsage: true })
    const r = await p.call(
      { messages: [{ role: 'user', content: 'hi' }], maxTokens: 50 },
      BASE_RESOLVED,
    )
    expect(r.usage.inputTokens).toBe(0)
    expect(r.usage.outputTokens).toBe(0)
  })

  test('raw response reference is preserved', async () => {
    const raw = makeApiResponse({ text: 'x' })
    _nextResponse = raw
    const r = await p.call(
      { messages: [{ role: 'user', content: 'hi' }], maxTokens: 50 },
      BASE_RESOLVED,
    )
    expect(r.raw).toBe(raw)
  })
})

// ── call() — message conversion ───────────────────────────────────────

describe('call() — message conversion', () => {
  test('string system → messages[0] = { role: "system", content }', async () => {
    _nextResponse = makeApiResponse({})
    await p.call(
      {
        system: 'You are helpful.',
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 50,
      },
      BASE_RESOLVED,
    )
    expect((_capturedApiParams as any).messages[0]).toEqual({
      role: 'system',
      content: 'You are helpful.',
    })
  })

  test('array system → blocks joined with \\n\\n', async () => {
    _nextResponse = makeApiResponse({})
    await p.call(
      {
        system: [
          { type: 'text' as const, text: 'Block A' },
          { type: 'text' as const, text: 'Block B' },
        ],
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 50,
      },
      BASE_RESOLVED,
    )
    expect((_capturedApiParams as any).messages[0].content).toBe('Block A\n\nBlock B')
  })

  test('no system param → first message is the user message (no system role)', async () => {
    _nextResponse = makeApiResponse({})
    await p.call(
      { messages: [{ role: 'user', content: 'no system' }], maxTokens: 50 },
      BASE_RESOLVED,
    )
    const msgs = (_capturedApiParams as any).messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toEqual({ role: 'user', content: 'no system' })
  })

  test('string content → passed through unchanged', async () => {
    _nextResponse = makeApiResponse({})
    await p.call(
      { messages: [{ role: 'user', content: 'plain text' }], maxTokens: 50 },
      BASE_RESOLVED,
    )
    const userMsg = (_capturedApiParams as any).messages.find((m: any) => m.role === 'user')
    expect(userMsg.content).toBe('plain text')
  })

  test('object content (array of blocks) → JSON.stringify applied', async () => {
    _nextResponse = makeApiResponse({})
    const content = [{ type: 'text', text: 'block content' }]
    await p.call(
      { messages: [{ role: 'user', content }], maxTokens: 50 },
      BASE_RESOLVED,
    )
    const userMsg = (_capturedApiParams as any).messages.find((m: any) => m.role === 'user')
    expect(userMsg.content).toBe(JSON.stringify(content))
  })

  test('multi-turn conversation preserves all messages in order', async () => {
    _nextResponse = makeApiResponse({})
    await p.call(
      {
        messages: [
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'second' },
          { role: 'user', content: 'third' },
        ],
        maxTokens: 50,
      },
      BASE_RESOLVED,
    )
    const msgs = (_capturedApiParams as any).messages
    expect(msgs).toHaveLength(3)
    expect(msgs.map((m: any) => m.content)).toEqual(['first', 'second', 'third'])
  })
})

// ── call() — API param forwarding ─────────────────────────────────────

describe('call() — API param forwarding', () => {
  test('maxTokens → max_completion_tokens', async () => {
    _nextResponse = makeApiResponse({})
    await p.call(
      { messages: [{ role: 'user', content: 'hi' }], maxTokens: 200 },
      BASE_RESOLVED,
    )
    expect((_capturedApiParams as any).max_completion_tokens).toBe(200)
  })

  test('temperature present → included in API call', async () => {
    _nextResponse = makeApiResponse({})
    await p.call(
      { messages: [{ role: 'user', content: 'hi' }], maxTokens: 50, temperature: 0.7 },
      BASE_RESOLVED,
    )
    expect((_capturedApiParams as any).temperature).toBe(0.7)
  })

  test('temperature absent → not included in API call', async () => {
    _nextResponse = makeApiResponse({})
    await p.call(
      { messages: [{ role: 'user', content: 'hi' }], maxTokens: 50 },
      BASE_RESOLVED,
    )
    expect((_capturedApiParams as any).temperature).toBeUndefined()
  })

  test('stopSequences non-empty → included as "stop"', async () => {
    _nextResponse = makeApiResponse({})
    await p.call(
      {
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 50,
        stopSequences: ['</s>', '<|end|>'],
      },
      BASE_RESOLVED,
    )
    expect((_capturedApiParams as any).stop).toEqual(['</s>', '<|end|>'])
  })

  test('stopSequences empty array → "stop" not included', async () => {
    _nextResponse = makeApiResponse({})
    await p.call(
      {
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 50,
        stopSequences: [],
      },
      BASE_RESOLVED,
    )
    expect((_capturedApiParams as any).stop).toBeUndefined()
  })

  test('resolved.model is passed through to the API', async () => {
    _nextResponse = makeApiResponse({})
    const resolved = { ...BASE_RESOLVED, model: 'gpt-4o-mini' }
    await p.call(
      { messages: [{ role: 'user', content: 'hi' }], maxTokens: 50 },
      resolved,
    )
    expect((_capturedApiParams as any).model).toBe('gpt-4o-mini')
  })
})

// ── call() — broken SDK export (error propagation) ────────────────────
// When the import resolves but the constructor is unavailable, call()
// lets the TypeError propagate (does NOT swallow it — only the import()
// catch block runs, but since import succeeded, error escapes normally).

describe('call() — broken SDK export', () => {
  test('null constructor → throws (propagates TypeError)', async () => {
    _mockConstructor = null  // import('openai') succeeds, but default is null
    await expect(
      p.call(
        { messages: [{ role: 'user', content: 'hi' }], maxTokens: 50 },
        BASE_RESOLVED,
      )
    ).rejects.toThrow()
  })
})
