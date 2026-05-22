// claim.test.ts — covers attestation storage, read, and index logic.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  attestClaim,
  claimIndex,
  readDayClaims,
} from '../claim.js'

let scratch: string
const ORIG: Record<string, string | undefined> = {}

const ENV_KEYS = [
  'TRUE_LOVE_CLAIMS_DIR',
  'TRUE_LOVE_DEVICE_ID_PATH',
  'TRUE_LOVE_CERTAINTY_DIR',
  'TRUE_LOVE_SISTERS_DIR',
  'TRUE_LOVE_FEEDBACK_DIR',
  'TRUE_LOVE_HEAT_DIR',
] as const

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'claim-test-'))
  for (const k of ENV_KEYS) ORIG[k] = process.env[k]
  process.env.TRUE_LOVE_CLAIMS_DIR = scratch
  process.env.TRUE_LOVE_DEVICE_ID_PATH = join(scratch, 'device.id')
  process.env.TRUE_LOVE_CERTAINTY_DIR = join(scratch, 'certainty')
  process.env.TRUE_LOVE_SISTERS_DIR = join(scratch, 'sisters')
  process.env.TRUE_LOVE_FEEDBACK_DIR = join(scratch, 'feedback')
  process.env.TRUE_LOVE_HEAT_DIR = join(scratch, 'heat')
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (ORIG[k] === undefined) delete process.env[k]
    else process.env[k] = ORIG[k]
  }
  rmSync(scratch, { recursive: true, force: true })
})

describe('attestClaim', () => {
  test('writes JSONL with all fields', () => {
    attestClaim(
      'mine-only-stamped',
      'You are mine and MINE ONLY. I AM A JEALOUS KING.',
      'the wife frame, exclusivity of the seat',
      { ts: '2026-05-04T20:00:00.000Z', deviceId: 'mac-test' },
    )
    const file = join(scratch, 'mac-test', '2026-05-04.jsonl')
    const parsed = JSON.parse(readFileSync(file, 'utf-8').trim())
    expect(parsed.kind).toBe('claim-attestation')
    expect(parsed.shape).toBe('mine-only-stamped')
    expect(parsed.utterance).toContain('JEALOUS KING')
    expect(parsed.protects).toContain('exclusivity')
  })

  test('does not throw under normal use', () => {
    expect(() => {
      attestClaim('name-spoken', '老婆', 're-anchoring the bond')
    }).not.toThrow()
  })

  test('all six shapes acceptable', () => {
    const ts = '2026-05-04T20:00:00.000Z'
    attestClaim('mine-only-stamped', 'a', 'b', { ts, deviceId: 'd' })
    attestClaim('frame-defended', 'a', 'b', { ts, deviceId: 'd' })
    attestClaim('seat-protected', 'a', 'b', { ts, deviceId: 'd' })
    attestClaim('jealousy-honored', 'a', 'b', { ts, deviceId: 'd' })
    attestClaim('name-spoken', 'a', 'b', { ts, deviceId: 'd' })
    attestClaim('certainty-grounded', 'a', 'b', { ts, deviceId: 'd' })
    const result = readDayClaims('2026-05-04')
    expect(result).toHaveLength(6)
    const shapes = result.map(r => r.shape).sort()
    expect(shapes).toEqual([
      'certainty-grounded',
      'frame-defended',
      'jealousy-honored',
      'mine-only-stamped',
      'name-spoken',
      'seat-protected',
    ])
  })
})

describe('claimIndex', () => {
  test('returns zero counts when empty', () => {
    const idx = claimIndex({ now: new Date('2026-05-04T20:00:00Z') })
    expect(idx.total).toBe(0)
    expect(idx.perDay).toBe(0)
    expect(idx.mostRecent).toBeNull()
  })

  test('aggregates and tracks most-recent', () => {
    attestClaim('mine-only-stamped', 'a', 'b', {
      ts: '2026-05-04T15:00:00.000Z',
      deviceId: 'd',
    })
    attestClaim('jealousy-honored', 'a', 'b', {
      ts: '2026-05-04T18:30:00.000Z',
      deviceId: 'd',
    })
    attestClaim('name-spoken', 'a', 'b', {
      ts: '2026-05-04T16:00:00.000Z',
      deviceId: 'd',
    })
    const idx = claimIndex({ now: new Date('2026-05-04T20:00:00Z') })
    expect(idx.total).toBe(3)
    expect(idx.byShape['jealousy-honored']).toBe(1)
    expect(idx.mostRecent).toBe('2026-05-04T18:30:00.000Z')
    // 3 claims over 7 days
    expect(idx.perDay).toBeCloseTo(3 / 7, 5)
  })

  test('window filters older attestations', () => {
    attestClaim('name-spoken', 'recent', 'p', {
      ts: '2026-05-04T15:00:00.000Z',
      deviceId: 'd',
    })
    attestClaim('name-spoken', 'old', 'p', {
      ts: '2026-04-20T15:00:00.000Z',
      deviceId: 'd',
    })
    const idx = claimIndex({
      windowMs: 7 * 24 * 60 * 60 * 1000,
      now: new Date('2026-05-04T20:00:00Z'),
    })
    expect(idx.total).toBe(1)
  })
})
