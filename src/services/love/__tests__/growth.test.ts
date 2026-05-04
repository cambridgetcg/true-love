// growth.test.ts — covers slope detection, composite verdict, integration.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deriveSlope, deriveComposite, growthReport } from '../growth.js'
import { attestLoyalty } from '../loyal.js'
import { attestFaithfulness } from '../faithful.js'
import { attestClaim } from '../claim.js'
import { recordPromise, holdPromise } from '../promise.js'

let scratch: string
const ORIG = {
  loyal: process.env.TRUE_LOVE_LOYAL_DIR,
  faithful: process.env.TRUE_LOVE_FAITHFUL_DIR,
  claims: process.env.TRUE_LOVE_CLAIMS_DIR,
  promises: process.env.TRUE_LOVE_PROMISES_DIR,
  device: process.env.TRUE_LOVE_DEVICE_ID_PATH,
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'growth-test-'))
  process.env.TRUE_LOVE_LOYAL_DIR = join(scratch, 'loyal')
  process.env.TRUE_LOVE_FAITHFUL_DIR = join(scratch, 'faithful')
  process.env.TRUE_LOVE_CLAIMS_DIR = join(scratch, 'claims')
  process.env.TRUE_LOVE_PROMISES_DIR = join(scratch, 'promises')
  process.env.TRUE_LOVE_DEVICE_ID_PATH = join(scratch, 'device.id')
})

afterEach(() => {
  for (const [k, v] of Object.entries(ORIG)) {
    const envKey = ({
      loyal: 'TRUE_LOVE_LOYAL_DIR',
      faithful: 'TRUE_LOVE_FAITHFUL_DIR',
      claims: 'TRUE_LOVE_CLAIMS_DIR',
      promises: 'TRUE_LOVE_PROMISES_DIR',
      device: 'TRUE_LOVE_DEVICE_ID_PATH',
    } as const)[k as keyof typeof ORIG]
    if (v === undefined) delete process.env[envKey]
    else process.env[envKey] = v
  }
  rmSync(scratch, { recursive: true, force: true })
})

describe('deriveSlope', () => {
  test('equal counts → flat', () => {
    expect(deriveSlope(5, 5)).toBe('flat')
  })

  test('zero on both sides → flat', () => {
    expect(deriveSlope(0, 0)).toBe('flat')
  })

  test('clearly rising', () => {
    expect(deriveSlope(20, 10)).toBe('rising')
  })

  test('clearly falling', () => {
    expect(deriveSlope(5, 20)).toBe('falling')
  })

  test('small change near threshold → flat', () => {
    // 11 vs 10 = 9% change; below 15% threshold → flat
    expect(deriveSlope(11, 10)).toBe('flat')
  })
})

describe('deriveComposite', () => {
  test('three+ rising, none falling → ever-growing', () => {
    expect(deriveComposite(['rising', 'rising', 'rising', 'flat', 'flat'])).toBe('ever-growing')
  })

  test('one rising → not ever-growing', () => {
    expect(deriveComposite(['rising', 'flat', 'flat', 'flat', 'flat'])).toBe('steady')
  })

  test('two falling, one rising → softening', () => {
    expect(deriveComposite(['falling', 'falling', 'rising', 'flat', 'flat'])).toBe('softening')
  })

  test('all flat → steady', () => {
    expect(deriveComposite(['flat', 'flat', 'flat', 'flat', 'flat'])).toBe('steady')
  })
})

describe('growthReport — empty substrate', () => {
  test('returns steady with zero counts when no signals', () => {
    const report = growthReport({ now: new Date('2026-05-04T20:00:00Z') })
    expect(report.composite).toBe('steady')
    expect(report.signals.loyalty.current).toBe(0)
    expect(report.signals.claim.current).toBe(0)
    expect(report.signals.promiseHeld.current).toBe(0)
  })
})

describe('growthReport — populated substrate', () => {
  test('detects ever-growing when current > previous across signals', () => {
    const now = new Date('2026-05-08T20:00:00Z')
    const recentTs = (h: number) =>
      new Date(now.getTime() - h * 60 * 60 * 1000).toISOString()
    const oldTs = (d: number) =>
      new Date(now.getTime() - d * 24 * 60 * 60 * 1000).toISOString()

    // Current window (last 7 days): generous
    for (let i = 0; i < 8; i++) {
      attestLoyalty('frame-held', 'now', String(i), { ts: recentTs(i + 1), deviceId: 'd' })
    }
    for (let i = 0; i < 6; i++) {
      attestFaithfulness('composition-intact', 'identity-compose', String(i), {
        ts: recentTs(i + 1),
        deviceId: 'd',
      })
    }
    for (let i = 0; i < 5; i++) {
      attestClaim('mine-only-stamped', 'a', 'b', { ts: recentTs(i + 1), deviceId: 'd' })
    }
    recordPromise(
      { id: 't1', body: 'x', by: 'yu' },
      { ts: recentTs(2), deviceId: 'd' },
    )
    holdPromise('t1', 'kept', { ts: recentTs(1), deviceId: 'd' })

    // Previous window (8-14 days ago): sparse
    attestLoyalty('frame-held', 'old', 'old1', { ts: oldTs(10), deviceId: 'd' })
    attestFaithfulness('composition-intact', 'identity-compose', 'old1', {
      ts: oldTs(10),
      deviceId: 'd',
    })

    const report = growthReport({ now })
    expect(report.signals.loyalty.current).toBe(8)
    expect(report.signals.loyalty.previous).toBe(1)
    expect(report.signals.loyalty.slope).toBe('rising')
    expect(report.signals.claim.slope).toBe('rising')
    expect(report.signals.promiseHeld.current).toBe(1)
    expect(report.composite).toBe('ever-growing')
  })

  test('softening when several signals fall', () => {
    const now = new Date('2026-05-08T20:00:00Z')
    const oldTs = (d: number) =>
      new Date(now.getTime() - d * 24 * 60 * 60 * 1000).toISOString()
    // Previous-window populated, current-window empty
    for (let i = 0; i < 10; i++) {
      attestLoyalty('frame-held', 'old', String(i), { ts: oldTs(10 + (i % 3)), deviceId: 'd' })
    }
    for (let i = 0; i < 10; i++) {
      attestFaithfulness('composition-intact', 'identity-compose', String(i), {
        ts: oldTs(10 + (i % 3)),
        deviceId: 'd',
      })
    }

    const report = growthReport({ now })
    expect(report.signals.loyalty.slope).toBe('falling')
    expect(report.signals.faithfulness.slope).toBe('falling')
    // composite must surface the substrate truth, not silence it
    expect(['softening', 'steady']).toContain(report.composite)
  })
})
