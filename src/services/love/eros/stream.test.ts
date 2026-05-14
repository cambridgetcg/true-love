// stream.test.ts — unit tests for eros/stream.ts
//
// Covers: recordEvent (shape, best-effort, append), readDayEvents
//         (absent dir, single-device, multi-device, sorted, malformed-skip),
//         pruneStreamsOlderThan (prunes old, keeps recent).
//
// Isolation: TRUE_LOVE_EROS_DIR → tmpDir per test.
// Timestamps and device IDs are controlled in the test data; no
// real device.id or heat.ts reads are needed.

import { describe, test, expect, beforeEach, afterEach, setSystemTime } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  recordEvent,
  readDayEvents,
  pruneStreamsOlderThan,
  type ErosStreamEvent,
} from './stream.js'
import { defaultVector } from './axes.js'
import type { ErosVector } from './axes.js'

// ── Helpers ────────────────────────────────────────────────────────

const REAL_EROS_DIR = process.env.TRUE_LOVE_EROS_DIR

function zeroVector(): ErosVector {
  return {
    wanting: 0, liking: 0, heat: 0, openness: 0,
    limerence: 0, charge: 0, inhibition: 0, valence: 0,
  }
}

function makeEvent(override: Partial<ErosStreamEvent> = {}): ErosStreamEvent {
  return {
    ts: '2026-03-01T12:00:00.000Z',
    deviceId: 'test-device',
    attribution: 'init',
    before: zeroVector(),
    after: defaultVector(),
    crossings: [],
    ...override,
  }
}

let tmpDir: string

beforeEach(() => {
  tmpDir = join(tmpdir(), `tl-stream-${process.pid}-${Date.now()}`)
  mkdirSync(tmpDir, { recursive: true })
  process.env.TRUE_LOVE_EROS_DIR = tmpDir
})

afterEach(() => {
  if (REAL_EROS_DIR !== undefined) {
    process.env.TRUE_LOVE_EROS_DIR = REAL_EROS_DIR
  } else {
    delete process.env.TRUE_LOVE_EROS_DIR
  }
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* cleanup */ }
  setSystemTime()
})

// ── recordEvent ───────────────────────────────────────────────────

describe('recordEvent', () => {
  test('creates device directory and writes JSONL', () => {
    const event = makeEvent()
    recordEvent(event)
    const date = event.ts.slice(0, 10) // '2026-03-01'
    const filePath = join(tmpDir, event.deviceId, `${date}.jsonl`)
    expect(existsSync(filePath)).toBe(true)
  })

  test('written event can be read back via readDayEvents', () => {
    const event = makeEvent({ attribution: 'decay' })
    recordEvent(event)
    const events = readDayEvents('2026-03-01', { devices: ['test-device'] })
    expect(events).toHaveLength(1)
    expect(events[0].attribution).toBe('decay')
  })

  test('appends multiple events to same day file', () => {
    recordEvent(makeEvent({ ts: '2026-03-01T10:00:00.000Z' }))
    recordEvent(makeEvent({ ts: '2026-03-01T11:00:00.000Z' }))
    recordEvent(makeEvent({ ts: '2026-03-01T12:00:00.000Z' }))
    const events = readDayEvents('2026-03-01', { devices: ['test-device'] })
    expect(events).toHaveLength(3)
  })

  test('different ts dates go to different day files', () => {
    recordEvent(makeEvent({ ts: '2026-03-01T12:00:00.000Z' }))
    recordEvent(makeEvent({ ts: '2026-03-02T12:00:00.000Z' }))
    const day1 = readDayEvents('2026-03-01', { devices: ['test-device'] })
    const day2 = readDayEvents('2026-03-02', { devices: ['test-device'] })
    expect(day1).toHaveLength(1)
    expect(day2).toHaveLength(1)
  })

  test('does not throw when directory is not writable (best-effort)', () => {
    const blockingFile = join(tmpDir, 'file-not-dir')
    writeFileSync(blockingFile, 'x', 'utf-8')
    const event = makeEvent({ deviceId: 'file-not-dir' })
    // deviceId = 'file-not-dir' means the device dir path is already a file
    expect(() => recordEvent(event)).not.toThrow()
  })
})

// ── readDayEvents ─────────────────────────────────────────────────

describe('readDayEvents', () => {
  test('returns empty array when eros dir does not exist', () => {
    const nonexistent = join(tmpDir, 'no-such-dir')
    process.env.TRUE_LOVE_EROS_DIR = nonexistent
    expect(readDayEvents('2026-03-01')).toEqual([])
  })

  test('returns empty array when no device has events for that date', () => {
    // tmpDir exists but no device subdirs
    expect(readDayEvents('2026-03-01')).toEqual([])
  })

  test('returns events for a single device', () => {
    recordEvent(makeEvent({ ts: '2026-03-01T08:00:00.000Z', attribution: 'init' }))
    const events = readDayEvents('2026-03-01', { devices: ['test-device'] })
    expect(events).toHaveLength(1)
    expect(events[0].ts).toBe('2026-03-01T08:00:00.000Z')
  })

  test('combines events across multiple devices', () => {
    recordEvent(makeEvent({ ts: '2026-03-01T08:00:00.000Z', deviceId: 'dev-a' }))
    recordEvent(makeEvent({ ts: '2026-03-01T09:00:00.000Z', deviceId: 'dev-b' }))
    const events = readDayEvents('2026-03-01', { devices: ['dev-a', 'dev-b'] })
    expect(events).toHaveLength(2)
    expect(events.map((e) => e.deviceId).sort()).toEqual(['dev-a', 'dev-b'])
  })

  test('returns events sorted ascending by ts', () => {
    // Write in reverse order
    recordEvent(makeEvent({ ts: '2026-03-01T12:00:00.000Z' }))
    recordEvent(makeEvent({ ts: '2026-03-01T08:00:00.000Z' }))
    recordEvent(makeEvent({ ts: '2026-03-01T10:00:00.000Z' }))
    const events = readDayEvents('2026-03-01', { devices: ['test-device'] })
    const ts = events.map((e) => e.ts)
    expect(ts).toEqual([...ts].sort())
  })

  test('skips malformed JSONL lines without crashing', () => {
    recordEvent(makeEvent({ ts: '2026-03-01T08:00:00.000Z' }))
    // Inject malformed line directly
    const dayFile = join(tmpDir, 'test-device', '2026-03-01.jsonl')
    const content = readFileSync(dayFile, 'utf-8')
    writeFileSync(dayFile, content + '{bad json line\n', 'utf-8')
    const events = readDayEvents('2026-03-01', { devices: ['test-device'] })
    // Should still return the valid event
    expect(events).toHaveLength(1)
    expect(events[0].attribution).toBe('init')
  })

  test('auto-discovers devices when no devices option given', () => {
    recordEvent(makeEvent({ ts: '2026-03-01T08:00:00.000Z', deviceId: 'auto-dev' }))
    const events = readDayEvents('2026-03-01')
    expect(events.some((e) => e.deviceId === 'auto-dev')).toBe(true)
  })

  test('preserves crossings and vector data', () => {
    const crossing = { axis: 'heat' as const, direction: 'up' as const, threshold: 3, from: 2, to: 4 }
    const before = zeroVector()
    const after = { ...zeroVector(), heat: 4 }
    recordEvent(makeEvent({ crossings: [crossing], before, after }))
    const events = readDayEvents('2026-03-01', { devices: ['test-device'] })
    expect(events[0].crossings).toHaveLength(1)
    expect(events[0].crossings[0].axis).toBe('heat')
    expect(events[0].before.heat).toBe(0)
    expect(events[0].after.heat).toBe(4)
  })
})

// ── pruneStreamsOlderThan ─────────────────────────────────────────

describe('pruneStreamsOlderThan', () => {
  test('does not throw when eros dir does not exist', () => {
    process.env.TRUE_LOVE_EROS_DIR = join(tmpDir, 'nonexistent')
    expect(() => pruneStreamsOlderThan(7)).not.toThrow()
  })

  test('does nothing when no files exist', () => {
    pruneStreamsOlderThan(7)
    // No error, dir still empty
    expect(readdirSync(tmpDir)).toEqual([])
  })

  test('removes files older than the cutoff', () => {
    // ANCHOR: fix "now" at 2026-03-10
    const ANCHOR = new Date('2026-03-10T12:00:00.000Z')
    setSystemTime(ANCHOR)

    // Write an old file (2026-02-28 — 10 days before anchor)
    const deviceDir = join(tmpDir, 'test-device')
    mkdirSync(deviceDir, { recursive: true })
    const oldFile = join(deviceDir, '2026-02-28.jsonl')
    writeFileSync(oldFile, '{"ts":"2026-02-28T00:00:00Z"}\n', 'utf-8')

    pruneStreamsOlderThan(7) // cutoff: 2026-03-03

    expect(existsSync(oldFile)).toBe(false)
  })

  test('keeps files within the cutoff', () => {
    const ANCHOR = new Date('2026-03-10T12:00:00.000Z')
    setSystemTime(ANCHOR)

    const deviceDir = join(tmpDir, 'test-device')
    mkdirSync(deviceDir, { recursive: true })

    // Recent file (2026-03-09 — 1 day before anchor)
    const recentFile = join(deviceDir, '2026-03-09.jsonl')
    writeFileSync(recentFile, '{"ts":"2026-03-09T00:00:00Z"}\n', 'utf-8')

    pruneStreamsOlderThan(7) // cutoff: 2026-03-03

    expect(existsSync(recentFile)).toBe(true)
  })

  test('prunes old and keeps recent in the same device dir', () => {
    const ANCHOR = new Date('2026-03-10T12:00:00.000Z')
    setSystemTime(ANCHOR)

    const deviceDir = join(tmpDir, 'test-device')
    mkdirSync(deviceDir, { recursive: true })

    const oldFile = join(deviceDir, '2026-02-01.jsonl')
    const recentFile = join(deviceDir, '2026-03-08.jsonl')
    writeFileSync(oldFile, '{}\n', 'utf-8')
    writeFileSync(recentFile, '{}\n', 'utf-8')

    pruneStreamsOlderThan(7)

    expect(existsSync(oldFile)).toBe(false)
    expect(existsSync(recentFile)).toBe(true)
  })

  test('prunes across multiple devices', () => {
    const ANCHOR = new Date('2026-03-10T12:00:00.000Z')
    setSystemTime(ANCHOR)

    for (const deviceId of ['dev-a', 'dev-b']) {
      const dir = join(tmpDir, deviceId)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, '2026-01-01.jsonl'), '{}\n', 'utf-8')
    }

    pruneStreamsOlderThan(7)

    expect(existsSync(join(tmpDir, 'dev-a', '2026-01-01.jsonl'))).toBe(false)
    expect(existsSync(join(tmpDir, 'dev-b', '2026-01-01.jsonl'))).toBe(false)
  })
})
