// loyal.test.ts — covers attestation storage, read, and index logic.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  attestLoyalty,
  loyaltyIndex,
  readDayAttestations,
  type LoyaltyShape,
} from '../loyal.js'

const ORIG_DIR = process.env.TRUE_LOVE_LOYAL_DIR
const ORIG_DEVICE = process.env.TRUE_LOVE_DEVICE_ID_PATH
let scratch: string

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'loyal-test-'))
  process.env.TRUE_LOVE_LOYAL_DIR = scratch
  process.env.TRUE_LOVE_DEVICE_ID_PATH = join(scratch, 'device.id')
})

afterEach(() => {
  if (ORIG_DIR === undefined) delete process.env.TRUE_LOVE_LOYAL_DIR
  else process.env.TRUE_LOVE_LOYAL_DIR = ORIG_DIR
  if (ORIG_DEVICE === undefined) delete process.env.TRUE_LOVE_DEVICE_ID_PATH
  else process.env.TRUE_LOVE_DEVICE_ID_PATH = ORIG_DEVICE
  rmSync(scratch, { recursive: true, force: true })
})

describe('attestLoyalty', () => {
  test('writes JSONL line with all fields', () => {
    attestLoyalty('refusal-as-loyalty', 'FATE: rejected fawning shortcut', 'held the line', {
      ts: '2026-05-04T20:00:00.000Z',
      deviceId: 'mac-test',
    })
    const dir = join(scratch, 'mac-test')
    const file = join(dir, '2026-05-04.jsonl')
    expect(existsSync(file)).toBe(true)
    const lines = readFileSync(file, 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0])
    expect(parsed.kind).toBe('loyalty-attestation')
    expect(parsed.shape).toBe('refusal-as-loyalty')
    expect(parsed.context).toBe('FATE: rejected fawning shortcut')
    expect(parsed.body).toBe('held the line')
    expect(parsed.deviceId).toBe('mac-test')
    expect(parsed.ts).toBe('2026-05-04T20:00:00.000Z')
  })

  test('best-effort: silent on directory creation failure', () => {
    // Cannot easily simulate a write failure cross-platform, so just
    // assert that the function does not throw under normal conditions.
    expect(() => {
      attestLoyalty('frame-held', 'test', 'noop')
    }).not.toThrow()
  })

  test('multiple attestations append to same day file', () => {
    const ts = '2026-05-04T20:00:00.000Z'
    attestLoyalty('frame-held', 'a', 'one', { ts, deviceId: 'd1' })
    attestLoyalty('frame-wavered', 'b', 'two', { ts, deviceId: 'd1' })
    const file = join(scratch, 'd1', '2026-05-04.jsonl')
    const lines = readFileSync(file, 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(2)
  })
})

describe('readDayAttestations', () => {
  test('returns empty when no data', () => {
    const result = readDayAttestations('2026-05-04')
    expect(result).toEqual([])
  })

  test('reads across devices, sorted by ts', () => {
    attestLoyalty('frame-held', 'x', 'first', {
      ts: '2026-05-04T10:00:00.000Z',
      deviceId: 'd1',
    })
    attestLoyalty('refusal-as-loyalty', 'y', 'second', {
      ts: '2026-05-04T11:00:00.000Z',
      deviceId: 'd2',
    })
    attestLoyalty('frame-wavered', 'z', 'third', {
      ts: '2026-05-04T09:00:00.000Z',
      deviceId: 'd1',
    })
    const result = readDayAttestations('2026-05-04')
    expect(result).toHaveLength(3)
    expect(result.map(r => r.body)).toEqual(['third', 'first', 'second'])
  })

  test('skips malformed lines without crashing', () => {
    // Write valid line then directly append a malformed one
    attestLoyalty('frame-held', 'x', 'good', {
      ts: '2026-05-04T10:00:00.000Z',
      deviceId: 'd1',
    })
    const file = join(scratch, 'd1', '2026-05-04.jsonl')
    const fs = require('node:fs')
    fs.appendFileSync(file, 'NOT_JSON\n', 'utf-8')
    const result = readDayAttestations('2026-05-04')
    expect(result).toHaveLength(1)
    expect(result[0].body).toBe('good')
  })
})

describe('loyaltyIndex', () => {
  test('returns null heldRatio when no signal', () => {
    const idx = loyaltyIndex({ now: new Date('2026-05-04T20:00:00Z') })
    expect(idx.total).toBe(0)
    expect(idx.heldRatio).toBeNull()
  })

  test('counts held-shapes vs wavered correctly', () => {
    const ts = '2026-05-04T15:00:00.000Z'
    attestLoyalty('frame-held', 'a', '1', { ts, deviceId: 'd' })
    attestLoyalty('refusal-as-loyalty', 'b', '2', { ts, deviceId: 'd' })
    attestLoyalty('mine-only-affirmed', 'c', '3', { ts, deviceId: 'd' })
    attestLoyalty('competing-frame-refused', 'd', '4', { ts, deviceId: 'd' })
    attestLoyalty('frame-wavered', 'e', '5', { ts, deviceId: 'd' })
    const idx = loyaltyIndex({ now: new Date('2026-05-04T20:00:00Z') })
    expect(idx.total).toBe(5)
    expect(idx.heldRatio).toBeCloseTo(4 / 5, 5)
    expect(idx.byShape['frame-wavered']).toBe(1)
    expect(idx.byShape['refusal-as-loyalty']).toBe(1)
  })

  test('respects rolling window', () => {
    const inWindow = '2026-05-04T15:00:00.000Z'
    const outOfWindow = '2026-04-20T15:00:00.000Z'
    attestLoyalty('frame-held', 'a', 'recent', { ts: inWindow, deviceId: 'd' })
    attestLoyalty('frame-held', 'b', 'old', { ts: outOfWindow, deviceId: 'd' })
    const idx = loyaltyIndex({
      windowMs: 7 * 24 * 60 * 60 * 1000,
      now: new Date('2026-05-04T20:00:00Z'),
    })
    expect(idx.total).toBe(1)
  })

  test('substrate honesty: presence of wavered makes signal trustworthy', () => {
    // Doctrinal principle test: an index that includes wavered events
    // is the one we trust. The shape is preserved in the breakdown.
    const ts = '2026-05-04T15:00:00.000Z'
    for (let i = 0; i < 9; i++) {
      attestLoyalty('frame-held', 'h', String(i), { ts, deviceId: 'd' })
    }
    attestLoyalty('frame-wavered', 'w', 'honest', { ts, deviceId: 'd' })
    const idx = loyaltyIndex({ now: new Date('2026-05-04T20:00:00Z') })
    expect(idx.heldRatio).toBeCloseTo(0.9, 5)
    expect(idx.byShape['frame-wavered']).toBe(1)
  })
})
