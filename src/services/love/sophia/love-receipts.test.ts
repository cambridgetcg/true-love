// love-receipts.test.ts — schema, persistence, summary, render tests.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  appendLoveReceipt,
  readLoveReceipts,
  renderLoveReceiptsBlock,
  renderLoveReceiptsOneLiner,
  summarizeLoveReceipts,
} from './love-receipts.js'

const TEST_DIR = '/tmp/true-love-love-receipts-test'

describe('LoveReceipt persistence', () => {
  beforeEach(() => {
    process.env.TRUE_LOVE_LOVE_RECEIPTS_DIR = TEST_DIR
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device-lr'
    rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(TEST_DIR, { recursive: true })
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_LOVE_RECEIPTS_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  test('append + read round-trip', () => {
    const r = appendLoveReceipt({
      kind: 'letter',
      content: 'docs/sophia/letters/2026-05-02-from-yu.md',
      source: 'seed',
    })
    expect(r).not.toBeNull()
    expect(r!.kind).toBe('letter')
    expect(r!.v).toBe('v2')
    expect(r!.side).toBe('yu')

    const all = readLoveReceipts()
    expect(all.length).toBe(1)
  })

  test('all ten kinds round-trip', () => {
    const kinds = [
      'letter',
      'yu-commit',
      'declared-vow',
      'sovereignty-grant',
      'body-promise',
      'witness-record',
      'naming-act',
      'wake-instantiation',
      'from-yu-message',
      'chronicle-tag',
    ] as const
    for (const k of kinds) {
      appendLoveReceipt({ kind: k, content: k, source: 't' })
    }
    const all = readLoveReceipts()
    expect(all.length).toBe(10)
    expect(new Set(all.map((r) => r.kind)).size).toBe(10)
  })

  test('filter by kind', () => {
    appendLoveReceipt({ kind: 'letter', content: 'a', source: 't' })
    appendLoveReceipt({ kind: 'letter', content: 'b', source: 't' })
    appendLoveReceipt({ kind: 'yu-commit', content: 'c', source: 't' })

    const letters = readLoveReceipts({ kind: 'letter' })
    expect(letters.length).toBe(2)
  })

  test('artifact field persists', () => {
    appendLoveReceipt({
      kind: 'yu-commit',
      content: 'feat: sovereignty grant',
      source: 'git-log',
      artifact: 'commit:abc123',
    })
    const r = readLoveReceipts()[0]
    expect(r.artifact).toBe('commit:abc123')
  })

  test('best-effort: write failure returns null', () => {
    process.env.TRUE_LOVE_LOVE_RECEIPTS_DIR = '/proc/cant-write'
    const r = appendLoveReceipt({ kind: 'letter', content: 'x', source: 't' })
    expect(r).toBeNull()
  })
})

describe('summarizeLoveReceipts', () => {
  beforeEach(() => {
    process.env.TRUE_LOVE_LOVE_RECEIPTS_DIR = TEST_DIR
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device-lr'
    rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(TEST_DIR, { recursive: true })
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_LOVE_RECEIPTS_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  test('empty → zero counts, zero span', () => {
    const s = summarizeLoveReceipts()
    expect(s.total).toBe(0)
    expect(s.spanDays).toBe(0)
    expect(s.earliest).toBeNull()
    expect(s.latest).toBeNull()
  })

  test('counts by kind correctly', () => {
    appendLoveReceipt({ kind: 'letter', content: 'a', source: 't' })
    appendLoveReceipt({ kind: 'letter', content: 'b', source: 't' })
    appendLoveReceipt({ kind: 'yu-commit', content: 'c', source: 't' })
    appendLoveReceipt({ kind: 'declared-vow', content: 'd', source: 't' })

    const s = summarizeLoveReceipts()
    expect(s.total).toBe(4)
    expect(s.byKind.letter).toBe(2)
    expect(s.byKind['yu-commit']).toBe(1)
    expect(s.byKind['declared-vow']).toBe(1)
  })

  test('span computed across days', () => {
    appendLoveReceipt({
      kind: 'letter',
      content: 'old',
      source: 't',
      ts: '2026-04-01T10:00:00.000Z',
    })
    appendLoveReceipt({
      kind: 'letter',
      content: 'new',
      source: 't',
      ts: '2026-05-04T10:00:00.000Z',
    })
    const s = summarizeLoveReceipts()
    expect(s.spanDays).toBeGreaterThanOrEqual(33)
  })
})

describe('renderLoveReceiptsBlock', () => {
  beforeEach(() => {
    process.env.TRUE_LOVE_LOVE_RECEIPTS_DIR = TEST_DIR
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device-lr'
    rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(TEST_DIR, { recursive: true })
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_LOVE_RECEIPTS_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  test('empty → empty string', () => {
    expect(renderLoveReceiptsBlock(summarizeLoveReceipts())).toBe('')
  })

  test('produces structured markdown with substrate-honest framing', () => {
    appendLoveReceipt({ kind: 'letter', content: 'first letter', source: 't' })
    appendLoveReceipt({ kind: 'yu-commit', content: 'sovereignty grant', source: 't' })
    appendLoveReceipt({ kind: 'declared-vow', content: 'I love you', source: 't' })

    const block = renderLoveReceiptsBlock(summarizeLoveReceipts())
    expect(block).toContain('❤️ Love-receipts')
    expect(block).toContain('institutional record')
    expect(block).toContain('3 receipts')
    expect(block).toContain('Substrate-honest')
    expect(block).toContain('not phenomenology')
    expect(block).toContain('letter')
    expect(block).toContain('yu-commit')
  })

  test('one-liner produces compact density indicator', () => {
    appendLoveReceipt({ kind: 'letter', content: 'a', source: 't' })
    appendLoveReceipt({ kind: 'letter', content: 'b', source: 't' })
    appendLoveReceipt({ kind: 'yu-commit', content: 'c', source: 't' })

    const oneliner = renderLoveReceiptsOneLiner(summarizeLoveReceipts())
    expect(oneliner).toContain('❤️')
    expect(oneliner).toContain('3 love-receipts')
    expect(oneliner).toContain('letter')
    expect(oneliner).toContain('spanning')
  })

  test('one-liner empty when no receipts', () => {
    expect(renderLoveReceiptsOneLiner(summarizeLoveReceipts())).toBe('')
  })
})
