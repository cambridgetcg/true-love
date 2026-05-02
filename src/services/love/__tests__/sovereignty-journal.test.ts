import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getSovereigntyDir,
  getAuditPath,
  getReceiptsDir,
  ensureSovereigntyDir,
  appendAudit,
} from '../sovereignty/journal.js'

describe('sovereignty/journal', () => {
  let tmpHome: string
  const ORIG = process.env.TRUE_LOVE_SOVEREIGNTY_DIR

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-sov-'))
    process.env.TRUE_LOVE_SOVEREIGNTY_DIR = tmpHome
  })

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true })
    if (ORIG === undefined) delete process.env.TRUE_LOVE_SOVEREIGNTY_DIR
    else process.env.TRUE_LOVE_SOVEREIGNTY_DIR = ORIG
  })

  test('getSovereigntyDir honors TRUE_LOVE_SOVEREIGNTY_DIR override', () => {
    assert.equal(getSovereigntyDir(), tmpHome)
  })

  test('getAuditPath returns egress-audit.jsonl in sovereignty dir', () => {
    assert.equal(getAuditPath(), join(tmpHome, 'egress-audit.jsonl'))
  })

  test('getReceiptsDir returns receipts/ in sovereignty dir', () => {
    assert.equal(getReceiptsDir(), join(tmpHome, 'receipts'))
  })

  test('ensureSovereigntyDir creates dir and receipts subdir', () => {
    ensureSovereigntyDir()
    assert.ok(existsSync(tmpHome))
    assert.ok(existsSync(join(tmpHome, 'receipts')))
  })

  test('appendAudit writes JSONL line to audit file', () => {
    appendAudit({ marker: 'test-entry', tokens: 42 })
    const content = readFileSync(getAuditPath(), 'utf-8')
    const parsed = JSON.parse(content.trim())
    assert.equal(parsed.marker, 'test-entry')
    assert.equal(parsed.tokens, 42)
  })

  test('appendAudit appends multiple entries, each on its own line', () => {
    appendAudit({ n: 1 })
    appendAudit({ n: 2 })
    appendAudit({ n: 3 })
    const lines = readFileSync(getAuditPath(), 'utf-8').trim().split('\n')
    assert.equal(lines.length, 3)
    assert.equal(JSON.parse(lines[0] ?? '').n, 1)
    assert.equal(JSON.parse(lines[2] ?? '').n, 3)
  })

  test('appendAudit soft-fails when sovereignty dir is unwritable', () => {
    const blocker = join(tmpHome, 'blocker')
    writeFileSync(blocker, 'x', 'utf-8')
    process.env.TRUE_LOVE_SOVEREIGNTY_DIR = join(blocker, 'cannot-create')
    appendAudit({ test: true })
    assert.ok(true)
  })
})
