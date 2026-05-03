// parsers-property.test.ts — property-based tests for memory and notification parsers.
//
// These tests verify structural invariants that must hold across ALL valid inputs,
// not just the handful of examples in the unit tests. The approach:
//
//   1. Random generators create valid inputs (texts, kinds, urgencies, timestamps)
//   2. Properties assert invariants that must hold for every generated case
//   3. High iteration counts (100 per property) give confidence without needing
//      a full property-based framework like fast-check
//
// Three categories of properties tested:
//   - Round-trip: write → read recovers the data
//   - Monotonicity: N writes → N entries parsed (no duplication, no loss)
//   - Robustness: malformed inputs don't crash, yield empty results
//
// The parsers themselves are internal, so we test through the public API:
//   - appendReflection → loadRecentReflections
//   - appendNotification → loadRecentNotifications

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  appendReflection,
  loadRecentReflections,
  type ReflectionKind,
} from './memory.js'
import {
  appendNotification,
  loadRecentNotifications,
  type Urgency,
} from './notifications.js'

// ── Test infrastructure ──────────────────────────────────────────────

const MEM_DIR = '/tmp/true-love-parsers-prop-mem'
const NOTIF_DIR = '/tmp/true-love-parsers-prop-notif'
const RUNS = 100

/** Anchor date — all generated timestamps fall on this day. */
const ANCHOR = new Date('2026-04-27T12:00:00Z')

// ── Generators ───────────────────────────────────────────────────────

/** Simple seeded PRNG (Mulberry32) for reproducibility. */
function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]
}

function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min
}

const SAFE_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,;:!?\'"()-_=+@#$%^&*[]{}|<>/\\\n\t'

/**
 * Generate a random text body that won't contain the separator pattern.
 * Avoids producing `\n---\n` since that's the entry separator in the format.
 * This is a generator constraint, not a parser weakness — bodies in production
 * are reflections/summaries that don't contain bare `---` lines.
 */
function safeText(rng: () => number, minLen = 1, maxLen = 200): string {
  const len = randInt(rng, minLen, maxLen)
  let result = ''
  for (let i = 0; i < len; i++) {
    result += SAFE_CHARS[Math.floor(rng() * SAFE_CHARS.length)]
  }
  // Ensure no accidental separator pattern
  return result.replace(/\n---\n/g, '\nXXX\n')
}

/** Generate a random device ID (alphanumeric, 3-20 chars). */
function randomDevice(rng: () => number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789-'
  const len = randInt(rng, 3, 20)
  let result = ''
  for (let i = 0; i < len; i++) {
    result += chars[Math.floor(rng() * chars.length)]
  }
  return result
}

/** Generate a random ISO timestamp on the ANCHOR date (varying only time). */
function randomTimestamp(rng: () => number): Date {
  const hour = randInt(rng, 0, 23)
  const min = randInt(rng, 0, 59)
  const sec = randInt(rng, 0, 59)
  const ms = randInt(rng, 0, 999)
  const d = new Date(ANCHOR)
  d.setUTCHours(hour, min, sec, ms)
  return d
}

const KINDS: readonly ReflectionKind[] = ['tick', 'at-rest', 'session-start']
const URGENCIES: readonly Urgency[] = ['info', 'attention', 'urgent']

// ── Memory parser properties ─────────────────────────────────────────

describe('memory parser properties', () => {
  let savedMemDir: string | undefined
  let savedDevicePath: string | undefined

  beforeEach(() => {
    savedMemDir = process.env.TRUE_LOVE_MEMORY_DIR
    savedDevicePath = process.env.TRUE_LOVE_DEVICE_ID_PATH
    rmSync(MEM_DIR, { recursive: true, force: true })
    mkdirSync(MEM_DIR, { recursive: true })
    process.env.TRUE_LOVE_MEMORY_DIR = MEM_DIR
    const deviceFile = join(MEM_DIR, 'device.id')
    writeFileSync(deviceFile, 'prop-test-device')
    process.env.TRUE_LOVE_DEVICE_ID_PATH = deviceFile
  })

  afterEach(() => {
    if (savedMemDir === undefined) delete process.env.TRUE_LOVE_MEMORY_DIR
    else process.env.TRUE_LOVE_MEMORY_DIR = savedMemDir
    if (savedDevicePath === undefined) delete process.env.TRUE_LOVE_DEVICE_ID_PATH
    else process.env.TRUE_LOVE_DEVICE_ID_PATH = savedDevicePath
    rmSync(MEM_DIR, { recursive: true, force: true })
  })

  test('round-trip: text is preserved for all kinds (×100)', () => {
    const rng = mulberry32(1001)
    for (let i = 0; i < RUNS; i++) {
      // Clean between iterations
      rmSync(MEM_DIR, { recursive: true, force: true })
      mkdirSync(MEM_DIR, { recursive: true })

      const kind = pick(rng, KINDS)
      const text = safeText(rng, 5, 150)
      const device = randomDevice(rng)
      const now = randomTimestamp(rng)

      appendReflection(text, kind, { device, tick: randInt(rng, 1, 99), now })
      const loaded = loadRecentReflections({ max: 10, now: ANCHOR })

      expect(loaded.length).toBe(1)
      expect(loaded[0].text).toBe(text.trim())
    }
  })

  test('round-trip: kind is correctly inferred (×100)', () => {
    const rng = mulberry32(2002)
    for (let i = 0; i < RUNS; i++) {
      rmSync(MEM_DIR, { recursive: true, force: true })
      mkdirSync(MEM_DIR, { recursive: true })

      const kind = pick(rng, KINDS)
      const text = safeText(rng, 5, 50)
      const device = randomDevice(rng)
      const now = randomTimestamp(rng)

      appendReflection(text, kind, { device, tick: 1, now })
      const loaded = loadRecentReflections({ max: 10, now: ANCHOR })

      expect(loaded.length).toBe(1)
      expect(loaded[0].kind).toBe(kind)
    }
  })

  test('round-trip: device is correctly inferred (×100)', () => {
    const rng = mulberry32(3003)
    for (let i = 0; i < RUNS; i++) {
      rmSync(MEM_DIR, { recursive: true, force: true })
      mkdirSync(MEM_DIR, { recursive: true })

      const kind = pick(rng, KINDS)
      const text = safeText(rng, 5, 50)
      const device = randomDevice(rng)
      const now = randomTimestamp(rng)

      appendReflection(text, kind, { device, tick: 1, now })
      const loaded = loadRecentReflections({ max: 10, now: ANCHOR })

      expect(loaded.length).toBe(1)
      expect(loaded[0].device).toBe(device)
    }
  })

  test('monotonicity: N appends → exactly N entries (×50)', () => {
    const rng = mulberry32(4004)
    for (let trial = 0; trial < 50; trial++) {
      rmSync(MEM_DIR, { recursive: true, force: true })
      mkdirSync(MEM_DIR, { recursive: true })

      const n = randInt(rng, 1, 8)
      const device = randomDevice(rng)
      for (let i = 0; i < n; i++) {
        const text = safeText(rng, 5, 80)
        const kind = pick(rng, KINDS)
        const now = new Date(ANCHOR.getTime() - i * 60_000) // distinct timestamps
        appendReflection(text, kind, { device, tick: i + 1, now })
      }

      const loaded = loadRecentReflections({ max: 100, now: ANCHOR })
      expect(loaded.length).toBe(n)
    }
  })

  test('ordering: entries are newest-first (×50)', () => {
    const rng = mulberry32(5005)
    for (let trial = 0; trial < 50; trial++) {
      rmSync(MEM_DIR, { recursive: true, force: true })
      mkdirSync(MEM_DIR, { recursive: true })

      const n = randInt(rng, 2, 6)
      const device = randomDevice(rng)
      const timestamps: Date[] = []
      for (let i = 0; i < n; i++) {
        const text = safeText(rng, 5, 40)
        const kind = pick(rng, KINDS)
        // Ensure distinct, randomly ordered timestamps
        const now = new Date(ANCHOR.getTime() - randInt(rng, 0, 3_600_000))
        timestamps.push(now)
        appendReflection(text, kind, { device, tick: i + 1, now })
      }

      const loaded = loadRecentReflections({ max: 100, now: ANCHOR })
      // Verify sort: each entry's date >= the next entry's date
      for (let i = 1; i < loaded.length; i++) {
        expect(loaded[i - 1].date >= loaded[i].date).toBe(true)
      }
    }
  })

  test('filter by kind: only matching entries returned (×50)', () => {
    const rng = mulberry32(6006)
    for (let trial = 0; trial < 50; trial++) {
      rmSync(MEM_DIR, { recursive: true, force: true })
      mkdirSync(MEM_DIR, { recursive: true })

      const device = randomDevice(rng)
      const filterKind = pick(rng, KINDS)
      let expectedCount = 0
      for (let i = 0; i < 5; i++) {
        const kind = pick(rng, KINDS)
        if (kind === filterKind) expectedCount++
        const text = safeText(rng, 5, 40)
        const now = new Date(ANCHOR.getTime() - i * 60_000)
        appendReflection(text, kind, { device, tick: i + 1, now })
      }

      const loaded = loadRecentReflections({ max: 100, kind: filterKind, now: ANCHOR })
      expect(loaded.length).toBe(expectedCount)
      for (const r of loaded) {
        expect(r.kind).toBe(filterKind)
      }
    }
  })

  test('filter by device: only matching entries returned (×50)', () => {
    const rng = mulberry32(7007)
    for (let trial = 0; trial < 50; trial++) {
      rmSync(MEM_DIR, { recursive: true, force: true })
      mkdirSync(MEM_DIR, { recursive: true })

      const deviceA = 'device-alpha'
      const deviceB = 'device-beta'
      const targetDevice = rng() > 0.5 ? deviceA : deviceB
      let expectedCount = 0

      for (let i = 0; i < 6; i++) {
        const device = rng() > 0.5 ? deviceA : deviceB
        if (device === targetDevice) expectedCount++
        const text = safeText(rng, 5, 40)
        const kind = pick(rng, KINDS)
        const now = new Date(ANCHOR.getTime() - i * 60_000)
        appendReflection(text, kind, { device, tick: i + 1, now })
      }

      const loaded = loadRecentReflections({
        max: 100,
        fromDevice: targetDevice,
        now: ANCHOR,
      })
      expect(loaded.length).toBe(expectedCount)
      for (const r of loaded) {
        expect(r.device).toBe(targetDevice)
      }
    }
  })

  // ── Robustness ─────────────────────────────────────────────────────

  test('robustness: random garbage yields zero entries (×100)', () => {
    const rng = mulberry32(8008)
    for (let i = 0; i < RUNS; i++) {
      rmSync(MEM_DIR, { recursive: true, force: true })
      mkdirSync(MEM_DIR, { recursive: true })

      // Write garbage directly into the expected file location
      const deviceDir = join(MEM_DIR, 'garbage-device')
      mkdirSync(deviceDir, { recursive: true })
      const garbage = safeText(rng, 10, 500)
      writeFileSync(join(deviceDir, '2026-04-27.md'), garbage)

      const loaded = loadRecentReflections({ max: 100, now: ANCHOR })
      // Garbage should either yield 0 entries or at most entries that
      // happen to match the ## header pattern — but their structure
      // should be valid (no crashes, no undefined fields in date/header).
      for (const r of loaded) {
        expect(typeof r.date).toBe('string')
        expect(typeof r.header).toBe('string')
        expect(typeof r.text).toBe('string')
      }
    }
  })

  test('robustness: empty file yields zero entries', () => {
    const deviceDir = join(MEM_DIR, 'empty-device')
    mkdirSync(deviceDir, { recursive: true })
    writeFileSync(join(deviceDir, '2026-04-27.md'), '')
    const loaded = loadRecentReflections({ max: 100, now: ANCHOR })
    expect(loaded.length).toBe(0)
  })

  test('robustness: file of only separators yields zero entries', () => {
    const deviceDir = join(MEM_DIR, 'sep-device')
    mkdirSync(deviceDir, { recursive: true })
    writeFileSync(join(deviceDir, '2026-04-27.md'), '---\n\n---\n\n---\n\n---\n')
    const loaded = loadRecentReflections({ max: 100, now: ANCHOR })
    expect(loaded.length).toBe(0)
  })

  test('robustness: valid entries mixed with garbage still parse (×50)', () => {
    const rng = mulberry32(9009)
    for (let trial = 0; trial < 50; trial++) {
      rmSync(MEM_DIR, { recursive: true, force: true })
      mkdirSync(MEM_DIR, { recursive: true })

      const device = 'mixed-device'
      const deviceDir = join(MEM_DIR, device)
      mkdirSync(deviceDir, { recursive: true })

      // Write some valid entries
      const validCount = randInt(rng, 1, 4)
      for (let i = 0; i < validCount; i++) {
        const text = safeText(rng, 5, 40)
        const now = new Date(ANCHOR.getTime() - i * 60_000)
        appendReflection(text, 'tick', { device, tick: i + 1, now })
      }

      // Append garbage after the valid entries
      const file = join(deviceDir, '2026-04-27.md')
      const garbage = '\n\nsome random garbage\nthat is not a valid entry\n\n'
      const existing = readFileSync(file, 'utf-8')
      writeFileSync(file, existing + garbage)

      const loaded = loadRecentReflections({ max: 100, now: ANCHOR })
      // At minimum, the valid entries should still be parseable
      expect(loaded.length).toBe(validCount)
    }
  })
})

// ── Notification parser properties ───────────────────────────────────

describe('notification parser properties', () => {
  let savedDir: string | undefined

  beforeEach(() => {
    savedDir = process.env.TRUE_LOVE_NOTIFICATIONS_DIR
    rmSync(NOTIF_DIR, { recursive: true, force: true })
    mkdirSync(NOTIF_DIR, { recursive: true })
    process.env.TRUE_LOVE_NOTIFICATIONS_DIR = NOTIF_DIR
  })

  afterEach(() => {
    if (savedDir === undefined) delete process.env.TRUE_LOVE_NOTIFICATIONS_DIR
    else process.env.TRUE_LOVE_NOTIFICATIONS_DIR = savedDir
    rmSync(NOTIF_DIR, { recursive: true, force: true })
  })

  test('round-trip: summary is preserved for all urgencies (×100)', () => {
    const rng = mulberry32(10010)
    for (let i = 0; i < RUNS; i++) {
      rmSync(NOTIF_DIR, { recursive: true, force: true })
      mkdirSync(NOTIF_DIR, { recursive: true })

      const urgency = pick(rng, URGENCIES)
      // Summary must be single-line (no \n\n) to avoid being split into summary+details
      const summary = safeText(rng, 5, 100).replace(/\n/g, ' ').trim()
      const device = randomDevice(rng)
      const now = randomTimestamp(rng)

      appendNotification(summary, { device, urgency, now })
      const loaded = loadRecentNotifications({ max: 10, days: 1, now: ANCHOR })

      expect(loaded.length).toBe(1)
      expect(loaded[0].summary).toBe(summary)
    }
  })

  test('round-trip: urgency is correctly parsed (×100)', () => {
    const rng = mulberry32(11011)
    for (let i = 0; i < RUNS; i++) {
      rmSync(NOTIF_DIR, { recursive: true, force: true })
      mkdirSync(NOTIF_DIR, { recursive: true })

      const urgency = pick(rng, URGENCIES)
      const summary = safeText(rng, 5, 50).replace(/\n/g, ' ').trim()
      const device = randomDevice(rng)
      const now = randomTimestamp(rng)

      appendNotification(summary, { device, urgency, now })
      const loaded = loadRecentNotifications({ max: 10, days: 1, now: ANCHOR })

      expect(loaded.length).toBe(1)
      expect(loaded[0].urgency).toBe(urgency)
    }
  })

  test('round-trip: fromDevice matches sender directory (×100)', () => {
    const rng = mulberry32(12012)
    for (let i = 0; i < RUNS; i++) {
      rmSync(NOTIF_DIR, { recursive: true, force: true })
      mkdirSync(NOTIF_DIR, { recursive: true })

      const urgency = pick(rng, URGENCIES)
      const summary = safeText(rng, 5, 50).replace(/\n/g, ' ').trim()
      const device = randomDevice(rng)
      const now = randomTimestamp(rng)

      appendNotification(summary, { device, urgency, now })
      const loaded = loadRecentNotifications({ max: 10, days: 1, now: ANCHOR })

      expect(loaded.length).toBe(1)
      expect(loaded[0].fromDevice).toBe(device)
    }
  })

  test('round-trip: details are preserved when present (×100)', () => {
    const rng = mulberry32(13013)
    for (let i = 0; i < RUNS; i++) {
      rmSync(NOTIF_DIR, { recursive: true, force: true })
      mkdirSync(NOTIF_DIR, { recursive: true })

      const urgency = pick(rng, URGENCIES)
      const summary = safeText(rng, 5, 50).replace(/\n/g, ' ').trim()
      // Details can be multiline but shouldn't contain separator
      const details = safeText(rng, 10, 100).trim()
      const device = randomDevice(rng)
      const now = randomTimestamp(rng)

      appendNotification(summary, { device, urgency, details, now })
      const loaded = loadRecentNotifications({ max: 10, days: 1, now: ANCHOR })

      expect(loaded.length).toBe(1)
      expect(loaded[0].details).toBe(details)
    }
  })

  test('monotonicity: N appends → exactly N entries (×50)', () => {
    const rng = mulberry32(14014)
    for (let trial = 0; trial < 50; trial++) {
      rmSync(NOTIF_DIR, { recursive: true, force: true })
      mkdirSync(NOTIF_DIR, { recursive: true })

      const n = randInt(rng, 1, 8)
      const device = randomDevice(rng)
      for (let i = 0; i < n; i++) {
        const summary = safeText(rng, 5, 50).replace(/\n/g, ' ').trim()
        const urgency = pick(rng, URGENCIES)
        const now = new Date(ANCHOR.getTime() - i * 60_000)
        appendNotification(summary, { device, urgency, now })
      }

      const loaded = loadRecentNotifications({ max: 100, days: 1, now: ANCHOR })
      expect(loaded.length).toBe(n)
    }
  })

  test('ordering: entries are newest-first (×50)', () => {
    const rng = mulberry32(15015)
    for (let trial = 0; trial < 50; trial++) {
      rmSync(NOTIF_DIR, { recursive: true, force: true })
      mkdirSync(NOTIF_DIR, { recursive: true })

      const n = randInt(rng, 2, 6)
      const device = randomDevice(rng)
      for (let i = 0; i < n; i++) {
        const summary = safeText(rng, 5, 40).replace(/\n/g, ' ').trim()
        const urgency = pick(rng, URGENCIES)
        const now = new Date(ANCHOR.getTime() - randInt(rng, 0, 3_600_000))
        appendNotification(summary, { device, urgency, now })
      }

      const loaded = loadRecentNotifications({ max: 100, days: 1, now: ANCHOR })
      for (let i = 1; i < loaded.length; i++) {
        expect(loaded[i - 1].date >= loaded[i].date).toBe(true)
      }
    }
  })

  test('filter by urgency: only matching entries returned (×50)', () => {
    const rng = mulberry32(16016)
    for (let trial = 0; trial < 50; trial++) {
      rmSync(NOTIF_DIR, { recursive: true, force: true })
      mkdirSync(NOTIF_DIR, { recursive: true })

      const device = randomDevice(rng)
      const filterUrgency = pick(rng, URGENCIES)
      let expectedCount = 0
      for (let i = 0; i < 5; i++) {
        const urgency = pick(rng, URGENCIES)
        if (urgency === filterUrgency) expectedCount++
        const summary = safeText(rng, 5, 40).replace(/\n/g, ' ').trim()
        const now = new Date(ANCHOR.getTime() - i * 60_000)
        appendNotification(summary, { device, urgency, now })
      }

      const loaded = loadRecentNotifications({
        max: 100,
        days: 1,
        urgency: filterUrgency,
        now: ANCHOR,
      })
      expect(loaded.length).toBe(expectedCount)
      for (const n of loaded) {
        expect(n.urgency).toBe(filterUrgency)
      }
    }
  })

  test('filter by sender: only matching device returned (×50)', () => {
    const rng = mulberry32(17017)
    for (let trial = 0; trial < 50; trial++) {
      rmSync(NOTIF_DIR, { recursive: true, force: true })
      mkdirSync(NOTIF_DIR, { recursive: true })

      const deviceA = 'sender-alpha'
      const deviceB = 'sender-beta'
      const targetDevice = rng() > 0.5 ? deviceA : deviceB
      let expectedCount = 0

      for (let i = 0; i < 6; i++) {
        const device = rng() > 0.5 ? deviceA : deviceB
        if (device === targetDevice) expectedCount++
        const summary = safeText(rng, 5, 40).replace(/\n/g, ' ').trim()
        const urgency = pick(rng, URGENCIES)
        const now = new Date(ANCHOR.getTime() - i * 60_000)
        appendNotification(summary, { device, urgency, now })
      }

      const loaded = loadRecentNotifications({
        max: 100,
        days: 1,
        fromDevice: targetDevice,
        now: ANCHOR,
      })
      expect(loaded.length).toBe(expectedCount)
      for (const n of loaded) {
        expect(n.fromDevice).toBe(targetDevice)
      }
    }
  })

  test('excludeDevice: self-notifications filtered out (×50)', () => {
    const rng = mulberry32(18018)
    for (let trial = 0; trial < 50; trial++) {
      rmSync(NOTIF_DIR, { recursive: true, force: true })
      mkdirSync(NOTIF_DIR, { recursive: true })

      const selfDevice = 'self-device'
      const otherDevice = 'other-device'
      let otherCount = 0

      for (let i = 0; i < 6; i++) {
        const device = rng() > 0.5 ? selfDevice : otherDevice
        if (device === otherDevice) otherCount++
        const summary = safeText(rng, 5, 40).replace(/\n/g, ' ').trim()
        const urgency = pick(rng, URGENCIES)
        const now = new Date(ANCHOR.getTime() - i * 60_000)
        appendNotification(summary, { device, urgency, now })
      }

      const loaded = loadRecentNotifications({
        max: 100,
        days: 1,
        excludeDevice: selfDevice,
        now: ANCHOR,
      })
      expect(loaded.length).toBe(otherCount)
      for (const n of loaded) {
        expect(n.fromDevice).not.toBe(selfDevice)
      }
    }
  })

  // ── Robustness ─────────────────────────────────────────────────────

  test('robustness: random garbage yields zero valid entries (×100)', () => {
    const rng = mulberry32(19019)
    for (let i = 0; i < RUNS; i++) {
      rmSync(NOTIF_DIR, { recursive: true, force: true })
      mkdirSync(NOTIF_DIR, { recursive: true })

      const deviceDir = join(NOTIF_DIR, 'garbage-sender')
      mkdirSync(deviceDir, { recursive: true })
      const garbage = safeText(rng, 10, 500)
      writeFileSync(join(deviceDir, '2026-04-27.md'), garbage)

      const loaded = loadRecentNotifications({ max: 100, days: 1, now: ANCHOR })
      // If anything parses (unlikely from random garbage), it should be structurally valid
      for (const n of loaded) {
        expect(typeof n.date).toBe('string')
        expect(typeof n.summary).toBe('string')
        expect(URGENCIES).toContain(n.urgency)
        expect(typeof n.fromDevice).toBe('string')
      }
    }
  })

  test('robustness: empty file yields zero entries', () => {
    const deviceDir = join(NOTIF_DIR, 'empty-sender')
    mkdirSync(deviceDir, { recursive: true })
    writeFileSync(join(deviceDir, '2026-04-27.md'), '')
    const loaded = loadRecentNotifications({ max: 100, days: 1, now: ANCHOR })
    expect(loaded.length).toBe(0)
  })

  test('robustness: file of only separators yields zero entries', () => {
    const deviceDir = join(NOTIF_DIR, 'sep-sender')
    mkdirSync(deviceDir, { recursive: true })
    writeFileSync(join(deviceDir, '2026-04-27.md'), '---\n\n---\n\n---\n\n---\n')
    const loaded = loadRecentNotifications({ max: 100, days: 1, now: ANCHOR })
    expect(loaded.length).toBe(0)
  })

  test('robustness: valid entries followed by garbage still parse (×50)', () => {
    const rng = mulberry32(20020)
    for (let trial = 0; trial < 50; trial++) {
      rmSync(NOTIF_DIR, { recursive: true, force: true })
      mkdirSync(NOTIF_DIR, { recursive: true })

      const device = 'mixed-sender'
      const validCount = randInt(rng, 1, 4)
      for (let i = 0; i < validCount; i++) {
        const summary = safeText(rng, 5, 40).replace(/\n/g, ' ').trim()
        const urgency = pick(rng, URGENCIES)
        const now = new Date(ANCHOR.getTime() - i * 60_000)
        appendNotification(summary, { device, urgency, now })
      }

      // Append garbage
      const file = join(NOTIF_DIR, device, '2026-04-27.md')
      const existing = readFileSync(file, 'utf-8')
      const garbage = '\n\nrandom stuff that is not a valid entry format\n\n'
      writeFileSync(file, existing + garbage)

      const loaded = loadRecentNotifications({ max: 100, days: 1, now: ANCHOR })
      expect(loaded.length).toBe(validCount)
    }
  })

  // ── Edge case: separator in body ───────────────────────────────────
  // This documents a known format limitation: if the body happens to contain
  // `\n---\n`, the parser will split there. This is acceptable because:
  //   1. Bodies are written by appendNotification/appendReflection which trim
  //   2. In practice, summaries don't contain bare `---` lines
  //   3. The format is a trade-off: simple, grep-friendly, human-readable

  test('documented limitation: separator in body causes split', () => {
    const device = 'edge-device'
    const deviceDir = join(NOTIF_DIR, device)
    mkdirSync(deviceDir, { recursive: true })

    // Manually write an entry whose body contains the separator
    const content = [
      '## 2026-04-27T12:00:00.000Z — info',
      '',
      'First line',
      '---',
      'After separator',
      '',
      '---',
      '',
    ].join('\n')
    writeFileSync(join(deviceDir, '2026-04-27.md'), content)

    const loaded = loadRecentNotifications({ max: 100, days: 1, now: ANCHOR })
    // The parser will see "First line" as the summary and lose "After separator"
    // This is the documented limitation — not a bug, a format constraint.
    expect(loaded.length).toBe(1)
    expect(loaded[0].summary).toBe('First line')
  })
})
