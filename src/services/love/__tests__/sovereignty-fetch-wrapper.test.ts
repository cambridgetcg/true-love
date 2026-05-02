import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { instrumentedFetch } from '../sovereignty/fetch-wrapper.js'
import { getAuditPath, getReceiptsDir } from '../sovereignty/journal.js'

describe('sovereignty/fetch-wrapper', () => {
  let tmpHome: string
  const ORIG = process.env.TRUE_LOVE_SOVEREIGNTY_DIR

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-fetch-'))
    process.env.TRUE_LOVE_SOVEREIGNTY_DIR = tmpHome
  })

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true })
    if (ORIG === undefined) delete process.env.TRUE_LOVE_SOVEREIGNTY_DIR
    else process.env.TRUE_LOVE_SOVEREIGNTY_DIR = ORIG
  })

  test('instrumentedFetch wraps a base fetch and forwards the call', async () => {
    let baseCalled = false
    const baseFetch = async (
      _input: string | URL | Request,
      _init?: RequestInit,
    ) => {
      baseCalled = true
      return new Response('{"ok":true}', { status: 200 })
    }

    const wrapped = instrumentedFetch(baseFetch, { source: 'test' })
    const res = await wrapped('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: JSON.stringify({ model: 'claude-sonnet-4', messages: [] }),
    })
    assert.equal(res.status, 200)
    assert.ok(baseCalled, 'base fetch should be called')
  })

  test('instrumentedFetch records audit entry for outgoing request', async () => {
    const baseFetch = async () => new Response('{}', { status: 200 })
    const wrapped = instrumentedFetch(baseFetch, { source: 'test-audit' })

    await wrapped('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: JSON.stringify({
        model: 'claude-sonnet-4',
        system: [{ type: 'text', text: 'You are 愛.' }],
        messages: [],
      }),
    })

    assert.ok(existsSync(getAuditPath()), 'audit file should exist')
    const content = readFileSync(getAuditPath(), 'utf-8').trim()
    const entry = JSON.parse(content)
    assert.equal(entry.source, 'test-audit')
    assert.ok(entry.categories.identity > 0)
  })

  test('instrumentedFetch writes receipt for outgoing request', async () => {
    const baseFetch = async () => new Response('{}', { status: 200 })
    const wrapped = instrumentedFetch(baseFetch, { source: 'test-receipt' })

    await wrapped('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: JSON.stringify({ marker: 'unique-receipt-content-42' }),
    })

    const dir = getReceiptsDir()
    const dateDirs = readdirSync(dir)
    assert.ok(dateDirs.length >= 1)
    const files = readdirSync(join(dir, dateDirs[0] ?? ''))
    assert.ok(files.length >= 1)
    const receipt = JSON.parse(
      readFileSync(join(dir, dateDirs[0] ?? '', files[0] ?? ''), 'utf-8'),
    )
    assert.match(JSON.stringify(receipt.body), /unique-receipt-content-42/)
  })

  test('instrumentedFetch returns the unmodified response from base fetch', async () => {
    const baseFetch = async () => new Response('original-content', { status: 201 })
    const wrapped = instrumentedFetch(baseFetch, { source: 'test' })
    const res = await wrapped('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: '{}',
    })
    assert.equal(res.status, 201)
    assert.equal(await res.text(), 'original-content')
  })

  test('instrumentedFetch propagates errors from base fetch', async () => {
    const baseFetch = async () => {
      throw new Error('network down')
    }
    const wrapped = instrumentedFetch(baseFetch, { source: 'test' })
    let caught = false
    try {
      await wrapped('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        body: '{}',
      })
    } catch {
      caught = true
    }
    assert.ok(caught, 'base fetch error should propagate')
  })
})
