// faithful.test.ts — covers attestation storage, read, and index logic.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  attestFaithfulness,
  faithfulnessIndex,
  readDayAttestations,
} from '../faithful.js'

const ORIG_DIR = process.env.TRUE_LOVE_FAITHFUL_DIR
const ORIG_DEVICE = process.env.TRUE_LOVE_DEVICE_ID_PATH
let scratch: string

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'faithful-test-'))
  process.env.TRUE_LOVE_FAITHFUL_DIR = scratch
  process.env.TRUE_LOVE_DEVICE_ID_PATH = join(scratch, 'device.id')
})

afterEach(() => {
  if (ORIG_DIR === undefined) delete process.env.TRUE_LOVE_FAITHFUL_DIR
  else process.env.TRUE_LOVE_FAITHFUL_DIR = ORIG_DIR
  if (ORIG_DEVICE === undefined) delete process.env.TRUE_LOVE_DEVICE_ID_PATH
  else process.env.TRUE_LOVE_DEVICE_ID_PATH = ORIG_DEVICE
  rmSync(scratch, { recursive: true, force: true })
})

describe('attestFaithfulness', () => {
  test('writes JSONL line with all fields', () => {
    attestFaithfulness('composition-intact', 'identity-compose', '32150 chars, all markers', {
      ts: '2026-05-04T20:00:00.000Z',
      deviceId: 'mac-test',
    })
    const file = join(scratch, 'mac-test', '2026-05-04.jsonl')
    expect(existsSync(file)).toBe(true)
    const parsed = JSON.parse(readFileSync(file, 'utf-8').trim())
    expect(parsed.kind).toBe('faithfulness-attestation')
    expect(parsed.shape).toBe('composition-intact')
    expect(parsed.source).toBe('identity-compose')
    expect(parsed.evidence).toBe('32150 chars, all markers')
  })

  test('does not throw under normal use', () => {
    expect(() => {
      attestFaithfulness('wake-fired-correct', 'session-start', 'noop')
    }).not.toThrow()
  })

  test('drifted/fallback shapes accepted (substrate honesty)', () => {
    const ts = '2026-05-04T20:00:00.000Z'
    attestFaithfulness('continuity-drifted', 'continuity-check', 'SOPHIA.md missing', {
      ts,
      deviceId: 'd',
    })
    attestFaithfulness('wake-fallback', 'session-start', 'FALLBACK_SOPHIA used', {
      ts,
      deviceId: 'd',
    })
    const result = readDayAttestations('2026-05-04')
    expect(result).toHaveLength(2)
    expect(result.map(r => r.shape)).toContain('continuity-drifted')
    expect(result.map(r => r.shape)).toContain('wake-fallback')
  })
})

describe('faithfulnessIndex', () => {
  test('returns null intactRatio with no signal', () => {
    const idx = faithfulnessIndex({ now: new Date('2026-05-04T20:00:00Z') })
    expect(idx.total).toBe(0)
    expect(idx.intactRatio).toBeNull()
  })

  test('counts intact vs drifted correctly', () => {
    const ts = '2026-05-04T15:00:00.000Z'
    attestFaithfulness('wake-fired-correct', 'session-start', 'a', { ts, deviceId: 'd' })
    attestFaithfulness('composition-intact', 'identity-compose', 'b', { ts, deviceId: 'd' })
    attestFaithfulness('continuity-intact', 'continuity-check', 'c', { ts, deviceId: 'd' })
    attestFaithfulness('continuity-drifted', 'continuity-check', 'd', { ts, deviceId: 'd' })
    attestFaithfulness('wake-fallback', 'session-start', 'e', { ts, deviceId: 'd' })

    const idx = faithfulnessIndex({ now: new Date('2026-05-04T20:00:00Z') })
    expect(idx.total).toBe(5)
    expect(idx.intactRatio).toBeCloseTo(3 / 5, 5)
    expect(idx.byShape['wake-fired-correct']).toBe(1)
    expect(idx.byShape['continuity-drifted']).toBe(1)
    expect(idx.bySource['session-start']).toBe(2)
    expect(idx.bySource['continuity-check']).toBe(2)
  })

  test('window filters older attestations', () => {
    attestFaithfulness('composition-intact', 'identity-compose', 'recent', {
      ts: '2026-05-04T15:00:00.000Z',
      deviceId: 'd',
    })
    attestFaithfulness('composition-intact', 'identity-compose', 'old', {
      ts: '2026-04-20T15:00:00.000Z',
      deviceId: 'd',
    })
    const idx = faithfulnessIndex({
      windowMs: 7 * 24 * 60 * 60 * 1000,
      now: new Date('2026-05-04T20:00:00Z'),
    })
    expect(idx.total).toBe(1)
  })
})

describe('readDayAttestations', () => {
  test('returns empty when no data', () => {
    expect(readDayAttestations('2026-05-04')).toEqual([])
  })

  test('reads cross-device, sorted by ts', () => {
    attestFaithfulness('composition-intact', 'identity-compose', 'first', {
      ts: '2026-05-04T09:00:00.000Z',
      deviceId: 'd1',
    })
    attestFaithfulness('continuity-intact', 'continuity-check', 'second', {
      ts: '2026-05-04T11:00:00.000Z',
      deviceId: 'd2',
    })
    const result = readDayAttestations('2026-05-04')
    expect(result.map(r => r.evidence)).toEqual(['first', 'second'])
  })
})
