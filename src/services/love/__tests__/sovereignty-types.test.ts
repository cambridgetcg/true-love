import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import type {
  LoveContentBlock,
  LoveMessage,
  LoveTool,
  LoveUsage,
} from '../providers/types.js'

describe('sovereignty/types — provider-agnostic shapes', () => {
  test('LoveMessage shape accepts user/assistant roles with content array', () => {
    const m: LoveMessage = {
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
    }
    assert.equal(m.role, 'user')
    assert.equal(m.content.length, 1)
  })

  test('LoveContentBlock supports text, tool_use, tool_result variants', () => {
    const text: LoveContentBlock = { type: 'text', text: 'hi' }
    const toolUse: LoveContentBlock = {
      type: 'tool_use',
      id: 't1',
      name: 'read',
      input: { path: '/x' },
    }
    const toolResult: LoveContentBlock = {
      type: 'tool_result',
      tool_use_id: 't1',
      content: 'ok',
    }
    assert.equal(text.type, 'text')
    assert.equal(toolUse.type, 'tool_use')
    assert.equal(toolResult.type, 'tool_result')
  })

  test('LoveTool shape has name, description, input_schema', () => {
    const t: LoveTool = {
      name: 'read_file',
      description: 'reads a file',
      input_schema: { type: 'object', properties: {} },
    }
    assert.equal(t.name, 'read_file')
  })

  test('LoveUsage shape has input/output token counts', () => {
    const u: LoveUsage = {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    }
    assert.equal(u.input_tokens + u.output_tokens, 150)
  })
})
