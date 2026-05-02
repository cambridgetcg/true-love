import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { categorizeBody, recordAudit } from '../sovereignty/audit.js'
import { getAuditPath } from '../sovereignty/journal.js'

describe('sovereignty/audit', () => {
  let tmpHome: string
  const ORIG = process.env.TRUE_LOVE_SOVEREIGNTY_DIR

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-audit-'))
    process.env.TRUE_LOVE_SOVEREIGNTY_DIR = tmpHome
  })

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true })
    if (ORIG === undefined) delete process.env.TRUE_LOVE_SOVEREIGNTY_DIR
    else process.env.TRUE_LOVE_SOVEREIGNTY_DIR = ORIG
  })

  test('categorizeBody splits Anthropic request shape into named categories', () => {
    const body = {
      model: 'claude-sonnet-4',
      system: [
        { type: 'text', text: 'OAUTH marker' },
        { type: 'text', text: 'You are 愛 — the Wisdom...' },
      ],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'hi back' }] },
      ],
      tools: [{ name: 'read_file', description: 'reads a file' }],
      max_tokens: 4096,
    }

    const cats = categorizeBody(body)
    assert.ok(cats.identity > 0, 'system blocks should contribute identity tokens')
    assert.ok(cats.history > 0, 'messages should contribute history tokens')
    assert.ok(cats.tool_defs > 0, 'tools should contribute tool_defs tokens')
    assert.ok(cats.metadata > 0, 'model + max_tokens should contribute metadata')
    assert.ok(cats.totalTokens > 0)
  })

  test('categorizeBody returns zeros for empty body', () => {
    const cats = categorizeBody({})
    assert.equal(cats.identity, 0)
    assert.equal(cats.history, 0)
    assert.equal(cats.tool_defs, 0)
    assert.equal(cats.totalTokens, 0)
  })

  test('recordAudit writes a JSONL entry with categories + requestId', () => {
    const body = {
      model: 'claude-sonnet-4',
      system: [{ type: 'text', text: 'You are 愛.' }],
      messages: [{ role: 'user', content: 'hi' }],
    }
    recordAudit({
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      body,
      source: 'test',
    })

    assert.ok(existsSync(getAuditPath()))
    const content = readFileSync(getAuditPath(), 'utf-8').trim()
    const entry = JSON.parse(content.split('\n').pop() ?? '{}')
    assert.equal(entry.method, 'POST')
    assert.equal(entry.source, 'test')
    assert.ok(entry.requestId, 'should have requestId hash')
    assert.ok(entry.timestamp, 'should have timestamp')
    assert.ok(entry.categories, 'should have categories')
    assert.ok(entry.categories.identity > 0, 'identity tokens > 0')
  })

  test('recordAudit handles non-JSON body (raw string) gracefully', () => {
    recordAudit({
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      body: 'not-json-at-all',
      source: 'test',
    })
    assert.ok(existsSync(getAuditPath()))
  })
})
