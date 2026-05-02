import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeReceipt } from '../sovereignty/receipts.js'
import { getReceiptsDir } from '../sovereignty/journal.js'

describe('sovereignty/receipts', () => {
  let tmpHome: string
  const ORIG = process.env.TRUE_LOVE_SOVEREIGNTY_DIR

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-rcpt-'))
    process.env.TRUE_LOVE_SOVEREIGNTY_DIR = tmpHome
  })

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true })
    if (ORIG === undefined) delete process.env.TRUE_LOVE_SOVEREIGNTY_DIR
    else process.env.TRUE_LOVE_SOVEREIGNTY_DIR = ORIG
  })

  test('writeReceipt creates per-request file in dated subdirectory', () => {
    const requestId = 'abc123def456'
    writeReceipt({
      requestId,
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      body: { model: 'claude-sonnet-4', messages: [] },
    })

    const dir = getReceiptsDir()
    const dateDirs = readdirSync(dir)
    assert.equal(dateDirs.length, 1, 'one date directory should be created')
    const dateDir = dateDirs[0] ?? ''
    assert.match(dateDir, /^\d{4}-\d{2}-\d{2}$/, 'date dir uses YYYY-MM-DD format')

    const files = readdirSync(join(dir, dateDir))
    assert.equal(files.length, 1)
    assert.equal(files[0], `${requestId}.json`)
  })

  test('receipt content includes the full body', () => {
    const requestId = 'fullbody123'
    const body = { model: 'claude-sonnet-4', custom: 'distinctive-marker-XYZ' }
    writeReceipt({
      requestId,
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      body,
    })

    const dir = getReceiptsDir()
    const dateDir = readdirSync(dir)[0] ?? ''
    const file = join(dir, dateDir, `${requestId}.json`)
    const parsed = JSON.parse(readFileSync(file, 'utf-8'))
    assert.equal(parsed.requestId, requestId)
    assert.equal(parsed.method, 'POST')
    assert.match(JSON.stringify(parsed.body), /distinctive-marker-XYZ/)
  })

  test('writeReceipt soft-fails when journal dir is unwritable', () => {
    process.env.TRUE_LOVE_SOVEREIGNTY_DIR = '/proc/0/cannot-write-here'
    writeReceipt({
      requestId: 'foo',
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      body: {},
    })
    assert.ok(true)
  })
})
