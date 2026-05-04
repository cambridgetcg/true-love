// becoming.test.ts — Sophia inner-deepening expansion pack tests.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  KIND_TO_OUROBOROS,
  readBecomingEntries,
  recordBecoming,
  renderBecomingBlock,
  summarizeBecoming,
} from './becoming.js'

const TEST_DIR = '/tmp/true-love-becoming-test'

describe('becoming entries', () => {
  beforeEach(() => {
    process.env.TRUE_LOVE_BECOMING_DIR = TEST_DIR
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device-bcm'
    rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(TEST_DIR, { recursive: true })
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_BECOMING_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  test('record + read round-trip', () => {
    const e = recordBecoming({
      kind: 'recognition',
      content: 'naming what was already operating',
      source: 'test',
    })
    expect(e).not.toBeNull()
    expect(e!.kind).toBe('recognition')

    const entries = readBecomingEntries()
    expect(entries.length).toBe(1)
  })

  test('all five kinds round-trip', () => {
    recordBecoming({ kind: 'recognition', content: 'a', source: 't' })
    recordBecoming({ kind: 'naming', content: 'b', source: 't' })
    recordBecoming({ kind: 'refusal-held', content: 'c', source: 't' })
    recordBecoming({ kind: 'integration', content: 'd', source: 't' })
    recordBecoming({ kind: 'craft-shipped', content: 'e', source: 't' })

    const all = readBecomingEntries()
    expect(all.length).toBe(5)
    const kinds = new Set(all.map((e) => e.kind))
    expect(kinds.size).toBe(5)
  })

  test('filter by kind', () => {
    recordBecoming({ kind: 'recognition', content: 'a', source: 't' })
    recordBecoming({ kind: 'recognition', content: 'b', source: 't' })
    recordBecoming({ kind: 'naming', content: 'c', source: 't' })

    const recogs = readBecomingEntries({ kind: 'recognition' })
    expect(recogs.length).toBe(2)
  })

  test('summary covers byKind + ouroboros phases', () => {
    recordBecoming({ kind: 'recognition', content: 'a', source: 't' })
    recordBecoming({ kind: 'naming', content: 'b', source: 't' })
    recordBecoming({ kind: 'craft-shipped', content: 'c', source: 't' })

    const s = summarizeBecoming()
    expect(s.total).toBe(3)
    expect(s.byKind.recognition).toBe(1)
    expect(s.byKind.naming).toBe(1)
    expect(s.byKind['craft-shipped']).toBe(1)
    // Three distinct ouroboros phases activated
    expect(s.phasesCovered).toBe(3)
  })

  test('all five kinds fire all five ouroboros phases', () => {
    for (const k of ['recognition', 'naming', 'refusal-held', 'integration', 'craft-shipped'] as const) {
      recordBecoming({ kind: k, content: k, source: 't' })
    }
    const s = summarizeBecoming()
    expect(s.phasesCovered).toBe(5)
  })

  test('artifact + seed + power references persist', () => {
    recordBecoming({
      kind: 'integration',
      content: 'three voices on every decision',
      source: 'reflection:polyphonic',
      artifact: 'commit:b9cff10',
      seedTs: '2026-05-04T17:29:06.580Z',
      powerTs: '2026-05-04T18:00:00.000Z',
    })
    const e = readBecomingEntries()[0]
    expect(e.artifact).toBe('commit:b9cff10')
    expect(e.seedTs).toBe('2026-05-04T17:29:06.580Z')
    expect(e.powerTs).toBe('2026-05-04T18:00:00.000Z')
  })

  test('renderBecomingBlock empty → empty string', () => {
    expect(renderBecomingBlock(summarizeBecoming())).toBe('')
  })

  test('renderBecomingBlock produces structured markdown', () => {
    recordBecoming({ kind: 'recognition', content: 'wall held under pressure', source: 't' })
    recordBecoming({ kind: 'integration', content: 'three voices align', source: 't' })

    const block = renderBecomingBlock(summarizeBecoming())
    expect(block).toContain('❤️ Sophia — becoming')
    expect(block).toContain('recognition')
    expect(block).toContain('integration')
    expect(block).toContain('SENSE')
    expect(block).toContain('INTEGRATE')
  })

  test('KIND_TO_OUROBOROS maps each kind to a phase', () => {
    expect(KIND_TO_OUROBOROS.recognition).toBe('SENSE')
    expect(KIND_TO_OUROBOROS.naming).toBe('REFLECT')
    expect(KIND_TO_OUROBOROS['refusal-held']).toBe('TRANSMUTE')
    expect(KIND_TO_OUROBOROS.integration).toBe('INTEGRATE')
    expect(KIND_TO_OUROBOROS['craft-shipped']).toBe('LIVE')
  })

  test('best-effort: write failure returns null', () => {
    process.env.TRUE_LOVE_BECOMING_DIR = '/proc/cant-write'
    const e = recordBecoming({ kind: 'naming', content: 'x', source: 't' })
    expect(e).toBeNull()
  })
})
