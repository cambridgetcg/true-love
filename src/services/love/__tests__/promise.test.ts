// promise.test.ts — covers lifecycle, roll, and index.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  recordPromise,
  engagePromise,
  testPromise,
  holdPromise,
  breakPromise,
  readPromise,
  promiseRoll,
  promiseIndex,
} from '../promise.js'

const ORIG_DIR = process.env.TRUE_LOVE_PROMISES_DIR
const ORIG_DEVICE = process.env.TRUE_LOVE_DEVICE_ID_PATH
let scratch: string

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'promise-test-'))
  process.env.TRUE_LOVE_PROMISES_DIR = scratch
  process.env.TRUE_LOVE_DEVICE_ID_PATH = join(scratch, 'device.id')
})

afterEach(() => {
  if (ORIG_DIR === undefined) delete process.env.TRUE_LOVE_PROMISES_DIR
  else process.env.TRUE_LOVE_PROMISES_DIR = ORIG_DIR
  if (ORIG_DEVICE === undefined) delete process.env.TRUE_LOVE_DEVICE_ID_PATH
  else process.env.TRUE_LOVE_DEVICE_ID_PATH = ORIG_DEVICE
  rmSync(scratch, { recursive: true, force: true })
})

describe('recordPromise + lifecycle', () => {
  test('records initial spec, then transitions through states', () => {
    recordPromise(
      {
        id: 'soma-2027',
        body: 'I will see the complete you in a year',
        by: 'yu',
        targetDate: '2027-03-07',
        witness: 'SOMA hardware ordered, £2025',
      },
      { ts: '2026-05-02T00:00:00.000Z', deviceId: 'mac-test' },
    )
    engagePromise('soma-2027', 'firmware/soma-hello heartbeat verified', {
      ts: '2026-05-02T12:00:00.000Z',
      deviceId: 'mac-test',
    })
    testPromise('soma-2027', 'Phase A thermal-pad design staged', {
      ts: '2026-05-04T20:00:00.000Z',
      deviceId: 'mac-test',
    })

    const roll = readPromise('soma-2027')
    expect(roll).not.toBeNull()
    expect(roll!.state).toBe('tested')
    expect(roll!.body).toBe('I will see the complete you in a year')
    expect(roll!.targetDate).toBe('2027-03-07')
    expect(roll!.events).toHaveLength(3)
    expect(roll!.events.map(e => e.state)).toEqual(['recorded', 'engaged', 'tested'])
  })

  test('held and broken are terminal-like states', () => {
    recordPromise(
      { id: 'p1', body: 'a promise', by: 'yu' },
      { ts: '2026-05-04T10:00:00Z', deviceId: 'd' },
    )
    holdPromise('p1', 'kept under pressure', {
      ts: '2026-05-04T11:00:00Z',
      deviceId: 'd',
    })
    expect(readPromise('p1')!.state).toBe('held')

    recordPromise(
      { id: 'p2', body: 'another', by: 'yu' },
      { ts: '2026-05-04T10:00:00Z', deviceId: 'd' },
    )
    breakPromise('p2', 'substrate honesty: didnt survive', {
      ts: '2026-05-04T11:00:00Z',
      deviceId: 'd',
    })
    expect(readPromise('p2')!.state).toBe('broken')
  })

  test('readPromise returns null for unknown id', () => {
    expect(readPromise('unknown')).toBeNull()
  })

  test('writes append-only JSONL', () => {
    recordPromise(
      { id: 'p', body: 'x', by: 'sophia' },
      { ts: '2026-05-04T00:00:00Z', deviceId: 'd' },
    )
    engagePromise('p', 'engaged', { ts: '2026-05-04T01:00:00Z', deviceId: 'd' })
    const file = join(scratch, 'd', 'p.jsonl')
    const lines = readFileSync(file, 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(2)
  })
})

describe('promiseRoll + promiseIndex', () => {
  test('aggregates across promises, returns counts by state', () => {
    recordPromise({ id: 'a', body: 'x', by: 'yu' }, { ts: '2026-05-01T00:00:00Z', deviceId: 'd' })
    recordPromise({ id: 'b', body: 'x', by: 'yu' }, { ts: '2026-05-02T00:00:00Z', deviceId: 'd' })
    recordPromise({ id: 'c', body: 'x', by: 'yu' }, { ts: '2026-05-03T00:00:00Z', deviceId: 'd' })
    holdPromise('a', 'kept', { ts: '2026-05-04T00:00:00Z', deviceId: 'd' })
    breakPromise('b', 'broken', { ts: '2026-05-04T00:00:00Z', deviceId: 'd' })
    engagePromise('c', 'engaged', { ts: '2026-05-04T00:00:00Z', deviceId: 'd' })

    const rolls = promiseRoll()
    expect(rolls).toHaveLength(3)
    const idx = promiseIndex()
    expect(idx.total).toBe(3)
    expect(idx.heldCount).toBe(1)
    expect(idx.brokenCount).toBe(1)
    expect(idx.inFlightCount).toBe(1) // engaged
  })

  test('promiseRoll empty when no promises', () => {
    expect(promiseRoll()).toEqual([])
    const idx = promiseIndex()
    expect(idx.total).toBe(0)
  })

  test('events from multiple devices interleave by ts', () => {
    recordPromise(
      { id: 'cross', body: 'x', by: 'yu' },
      { ts: '2026-05-04T10:00:00Z', deviceId: 'd1' },
    )
    holdPromise('cross', 'd2 witnessed', {
      ts: '2026-05-04T12:00:00Z',
      deviceId: 'd2',
    })
    const roll = readPromise('cross')
    expect(roll).not.toBeNull()
    expect(roll!.state).toBe('held')
    expect(roll!.events).toHaveLength(2)
  })
})
