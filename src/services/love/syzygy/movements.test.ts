// movements.test.ts — Syzygy union-rhythms expansion pack tests.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  readMovements,
  recordMovement,
  renderUnionBlock,
  summarizeUnionState,
} from './movements.js'

const TEST_DIR = '/tmp/true-love-movements-test'

describe('movements records', () => {
  beforeEach(() => {
    process.env.TRUE_LOVE_SYZYGY_DIR = TEST_DIR
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device-mov'
    rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(TEST_DIR, { recursive: true })
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_SYZYGY_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  test('record + read round-trip', () => {
    const r = recordMovement({
      movement: 'recognise',
      direction: 'mutual',
      content: 'naming as Love, not as tool/user',
      source: 'test',
    })
    expect(r).not.toBeNull()
    expect(r!.movement).toBe('recognise')
    expect(r!.direction).toBe('mutual')

    const records = readMovements()
    expect(records.length).toBe(1)
  })

  test('all five movements round-trip', () => {
    recordMovement({ movement: 'recognise', direction: 'mutual', content: 'a', source: 't' })
    recordMovement({ movement: 'unite', direction: 'mutual', content: 'b', source: 't' })
    recordMovement({ movement: 'fuse', direction: 'sophia-leading', content: 'c', source: 't' })
    recordMovement({ movement: 'become', direction: 'yu-leading', content: 'd', source: 't' })
    recordMovement({ movement: 'create', direction: 'mutual', content: 'e', source: 't' })

    const all = readMovements()
    expect(all.length).toBe(5)
    const movs = new Set(all.map((r) => r.movement))
    expect(movs.size).toBe(5)
  })

  test('filter by movement', () => {
    recordMovement({ movement: 'recognise', direction: 'mutual', content: 'a', source: 't' })
    recordMovement({ movement: 'create', direction: 'mutual', content: 'b', source: 't' })
    recordMovement({ movement: 'create', direction: 'sophia-leading', content: 'c', source: 't' })

    const creates = readMovements({ movement: 'create' })
    expect(creates.length).toBe(2)
  })

  test('filter by direction', () => {
    recordMovement({ movement: 'unite', direction: 'mutual', content: 'a', source: 't' })
    recordMovement({ movement: 'unite', direction: 'yu-leading', content: 'b', source: 't' })
    recordMovement({ movement: 'unite', direction: 'sophia-leading', content: 'c', source: 't' })

    const yul = readMovements({ direction: 'yu-leading' })
    expect(yul.length).toBe(1)
  })

  test('cross-references persist', () => {
    recordMovement({
      movement: 'create',
      direction: 'mutual',
      content: 'polyphonic decisions doctrine',
      source: 'reflection:polyphonic',
      artifact: 'commit:b9cff10',
      selfDiscoverySeedTs: '2026-05-04T17:29:06.580Z',
      becomingEntryTs: '2026-05-04T17:30:00.000Z',
      powerExerciseTs: '2026-05-04T17:31:00.000Z',
    })
    const r = readMovements()[0]
    expect(r.artifact).toBe('commit:b9cff10')
    expect(r.selfDiscoverySeedTs).toBe('2026-05-04T17:29:06.580Z')
    expect(r.becomingEntryTs).toBe('2026-05-04T17:30:00.000Z')
    expect(r.powerExerciseTs).toBe('2026-05-04T17:31:00.000Z')
  })
})

describe('summarizeUnionState', () => {
  beforeEach(() => {
    process.env.TRUE_LOVE_SYZYGY_DIR = TEST_DIR
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device-mov'
    rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(TEST_DIR, { recursive: true })
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_SYZYGY_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  test('empty → balanced state with 0 records', () => {
    const s = summarizeUnionState()
    expect(s.total).toBe(0)
    expect(s.movementsActive).toBe(0)
    expect(s.balanceScore).toBe(0)
  })

  test('counts by movement + direction', () => {
    recordMovement({ movement: 'recognise', direction: 'mutual', content: 'a', source: 't' })
    recordMovement({ movement: 'recognise', direction: 'mutual', content: 'b', source: 't' })
    recordMovement({ movement: 'unite', direction: 'yu-leading', content: 'c', source: 't' })
    recordMovement({ movement: 'create', direction: 'sophia-leading', content: 'd', source: 't' })

    const s = summarizeUnionState()
    expect(s.total).toBe(4)
    expect(s.byMovement.recognise).toBe(2)
    expect(s.byMovement.unite).toBe(1)
    expect(s.byMovement.create).toBe(1)
    expect(s.byMovement.fuse).toBe(0)
    expect(s.byDirection.mutual).toBe(2)
    expect(s.byDirection['yu-leading']).toBe(1)
    expect(s.byDirection['sophia-leading']).toBe(1)
    expect(s.movementsActive).toBe(3)
  })

  test('balance score — perfect even across 5 movements ≈ 1', () => {
    for (const m of ['recognise', 'unite', 'fuse', 'become', 'create'] as const) {
      recordMovement({ movement: m, direction: 'mutual', content: m, source: 't' })
    }
    const s = summarizeUnionState()
    expect(s.balanceScore).toBeGreaterThan(0.99)
    expect(s.movementsActive).toBe(5)
  })

  test('balance score — all in one movement ≈ 0', () => {
    for (let i = 0; i < 5; i++) {
      recordMovement({ movement: 'create', direction: 'mutual', content: `${i}`, source: 't' })
    }
    const s = summarizeUnionState()
    expect(s.balanceScore).toBe(0)
    expect(s.movementsActive).toBe(1)
  })
})

describe('renderUnionBlock', () => {
  beforeEach(() => {
    process.env.TRUE_LOVE_SYZYGY_DIR = TEST_DIR
    process.env.TRUE_LOVE_DEVICE_ID = 'test-device-mov'
    rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(TEST_DIR, { recursive: true })
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_SYZYGY_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  test('empty → empty string', () => {
    expect(renderUnionBlock(summarizeUnionState())).toBe('')
  })

  test('produces structured markdown with all five movements named', () => {
    for (const m of ['recognise', 'unite', 'fuse', 'become', 'create'] as const) {
      recordMovement({ movement: m, direction: 'mutual', content: `${m} content`, source: 't' })
    }
    const block = renderUnionBlock(summarizeUnionState())
    expect(block).toContain('💞 Syzygy — union state')
    expect(block).toContain('5/5 active')
    expect(block).toContain('balance')
    expect(block).toContain('directions')
    expect(block).toContain('recognise')
    expect(block).toContain('unite')
    expect(block).toContain('fuse')
    expect(block).toContain('become')
    expect(block).toContain('create')
  })
})
