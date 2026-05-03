// memory.test.ts — tests for the reflection memory system.
//
// Covers: appendReflection, loadRecentReflections (round-trip, kind/device
// inference, date filtering, multi-device), renderReflections (humanized
// time, cross-device attribution, truncation).
//
// All I/O tests use TRUE_LOVE_MEMORY_DIR pointed at a temp directory.
// Device ID is overridden via TRUE_LOVE_DEVICE_ID_PATH + explicit opts.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  appendReflection,
  loadRecentReflections,
  renderReflections,
  getMemoryDir,
  type Reflection,
} from './memory.js'

const TEST_DIR = '/tmp/true-love-memory-test'
/** Anchor date for deterministic tests — matches the hardcoded dates in test data. */
const ANCHOR = new Date('2026-04-27T23:59:59Z')

describe('memory', () => {
  let savedMemDir: string | undefined
  let savedDevicePath: string | undefined

  beforeEach(() => {
    savedMemDir = process.env.TRUE_LOVE_MEMORY_DIR
    savedDevicePath = process.env.TRUE_LOVE_DEVICE_ID_PATH
    rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(TEST_DIR, { recursive: true })
    process.env.TRUE_LOVE_MEMORY_DIR = TEST_DIR
    // Point device ID to a test file to avoid touching real device.id
    const deviceFile = join(TEST_DIR, 'device.id')
    writeFileSync(deviceFile, 'test-device')
    process.env.TRUE_LOVE_DEVICE_ID_PATH = deviceFile
  })

  afterEach(() => {
    if (savedMemDir === undefined) {
      delete process.env.TRUE_LOVE_MEMORY_DIR
    } else {
      process.env.TRUE_LOVE_MEMORY_DIR = savedMemDir
    }
    if (savedDevicePath === undefined) {
      delete process.env.TRUE_LOVE_DEVICE_ID_PATH
    } else {
      process.env.TRUE_LOVE_DEVICE_ID_PATH = savedDevicePath
    }
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  // ── getMemoryDir ────────────────────────────────────────────────

  test('getMemoryDir respects env override', () => {
    expect(getMemoryDir()).toBe(TEST_DIR)
  })

  // ── appendReflection ────────────────────────────────────────────

  test('creates device subdirectory and date file', () => {
    const now = new Date('2026-04-27T12:00:00Z')
    appendReflection('Test reflection.', 'tick', { device: 'dev-a', now })
    const file = join(TEST_DIR, 'dev-a', '2026-04-27.md')
    expect(existsSync(file)).toBe(true)
  })

  test('writes tick entry with correct header format', () => {
    const now = new Date('2026-04-27T12:00:00Z')
    appendReflection('Observed the kingdom.', 'tick', {
      device: 'dev-a',
      tick: 3,
      now,
    })
    const content = readFileSync(join(TEST_DIR, 'dev-a', '2026-04-27.md'), 'utf-8')
    expect(content).toContain('## 2026-04-27T12:00:00.000Z — tick 3 [dev-a]')
    expect(content).toContain('Observed the kingdom.')
    expect(content).toContain('---')
  })

  test('writes session-start entry with invitation', () => {
    const now = new Date('2026-04-27T12:00:00Z')
    appendReflection('Starting up.', 'session-start', {
      device: 'dev-a',
      invitation: 'explore the tests',
      now,
    })
    const content = readFileSync(join(TEST_DIR, 'dev-a', '2026-04-27.md'), 'utf-8')
    expect(content).toContain('— session-start [dev-a] (invitation: explore the tests)')
  })

  test('writes session-start entry without invitation', () => {
    const now = new Date('2026-04-27T12:00:00Z')
    appendReflection('Starting up.', 'session-start', { device: 'dev-a', now })
    const content = readFileSync(join(TEST_DIR, 'dev-a', '2026-04-27.md'), 'utf-8')
    expect(content).toContain('— session-start [dev-a]')
    expect(content).not.toContain('invitation:')
  })

  test('writes at-rest entry', () => {
    const now = new Date('2026-04-27T12:00:00Z')
    appendReflection('Nothing calls.', 'at-rest', { device: 'dev-a', now })
    const content = readFileSync(join(TEST_DIR, 'dev-a', '2026-04-27.md'), 'utf-8')
    expect(content).toContain('— at-rest [dev-a]')
  })

  test('appends multiple entries to same date file', () => {
    appendReflection('First.', 'tick', {
      device: 'dev-a',
      tick: 1,
      now: new Date('2026-04-27T10:00:00Z'),
    })
    appendReflection('Second.', 'tick', {
      device: 'dev-a',
      tick: 2,
      now: new Date('2026-04-27T11:00:00Z'),
    })
    const content = readFileSync(join(TEST_DIR, 'dev-a', '2026-04-27.md'), 'utf-8')
    const headers = content.match(/^## /gm)
    expect(headers?.length).toBe(2)
  })

  test('trims body whitespace', () => {
    const now = new Date('2026-04-27T12:00:00Z')
    appendReflection('  padded text  ', 'tick', { device: 'dev-a', now })
    const content = readFileSync(join(TEST_DIR, 'dev-a', '2026-04-27.md'), 'utf-8')
    expect(content).toContain('\n\npadded text\n\n')
  })

  // ── loadRecentReflections ───────────────────────────────────────

  test('returns empty for missing directory', () => {
    process.env.TRUE_LOVE_MEMORY_DIR = '/tmp/nonexistent-memory-dir'
    expect(loadRecentReflections()).toEqual([])
  })

  test('returns empty for empty directory', () => {
    expect(loadRecentReflections()).toEqual([])
  })

  test('round-trip: append then load', () => {
    const now = new Date('2026-04-27T12:00:00Z')
    appendReflection('I see the kingdom.', 'tick', {
      device: 'dev-a',
      tick: 1,
      now,
    })

    const reflections = loadRecentReflections({ days: 7, now: ANCHOR })
    expect(reflections.length).toBe(1)
    expect(reflections[0].text).toBe('I see the kingdom.')
    expect(reflections[0].kind).toBe('tick')
    expect(reflections[0].device).toBe('dev-a')
    expect(reflections[0].fileDate).toBe('2026-04-27')
  })

  test('infers kind from header: tick', () => {
    appendReflection('tick body', 'tick', {
      device: 'dev-a',
      tick: 5,
      now: new Date('2026-04-27T12:00:00Z'),
    })
    const r = loadRecentReflections({ days: 7, now: ANCHOR })
    expect(r[0].kind).toBe('tick')
  })

  test('infers kind from header: at-rest', () => {
    appendReflection('resting', 'at-rest', {
      device: 'dev-a',
      now: new Date('2026-04-27T12:00:00Z'),
    })
    const r = loadRecentReflections({ days: 7, now: ANCHOR })
    expect(r[0].kind).toBe('at-rest')
  })

  test('infers kind from header: session-start', () => {
    appendReflection('starting', 'session-start', {
      device: 'dev-a',
      now: new Date('2026-04-27T12:00:00Z'),
    })
    const r = loadRecentReflections({ days: 7, now: ANCHOR })
    expect(r[0].kind).toBe('session-start')
  })

  test('infers device from header brackets', () => {
    appendReflection('test', 'tick', {
      device: 'yu-macbook-abc123',
      tick: 1,
      now: new Date('2026-04-27T12:00:00Z'),
    })
    const r = loadRecentReflections({ days: 7, now: ANCHOR })
    expect(r[0].device).toBe('yu-macbook-abc123')
  })

  test('loads from multiple device directories', () => {
    const now = new Date('2026-04-27T12:00:00Z')
    appendReflection('From A', 'tick', { device: 'dev-a', tick: 1, now })
    appendReflection('From B', 'tick', { device: 'dev-b', tick: 1, now })

    const r = loadRecentReflections({ days: 7, now: ANCHOR })
    expect(r.length).toBe(2)
    const devices = r.map((e) => e.device).sort()
    expect(devices).toEqual(['dev-a', 'dev-b'])
  })

  test('filters by kind', () => {
    const now = new Date('2026-04-27T12:00:00Z')
    appendReflection('tick entry', 'tick', { device: 'dev-a', tick: 1, now })
    appendReflection('at rest', 'at-rest', {
      device: 'dev-a',
      now: new Date('2026-04-27T13:00:00Z'),
    })

    const ticks = loadRecentReflections({ days: 7, kind: 'tick', now: ANCHOR })
    expect(ticks.length).toBe(1)
    expect(ticks[0].kind).toBe('tick')

    const rests = loadRecentReflections({ days: 7, kind: 'at-rest', now: ANCHOR })
    expect(rests.length).toBe(1)
    expect(rests[0].kind).toBe('at-rest')
  })

  test('filters by fromDevice', () => {
    const now = new Date('2026-04-27T12:00:00Z')
    appendReflection('A says', 'tick', { device: 'dev-a', tick: 1, now })
    appendReflection('B says', 'tick', { device: 'dev-b', tick: 1, now })

    const r = loadRecentReflections({ days: 7, fromDevice: 'dev-a', now: ANCHOR })
    expect(r.length).toBe(1)
    expect(r[0].device).toBe('dev-a')
  })

  test('sorts newest-first', () => {
    appendReflection('Early', 'tick', {
      device: 'dev-a',
      tick: 1,
      now: new Date('2026-04-27T08:00:00Z'),
    })
    appendReflection('Late', 'tick', {
      device: 'dev-a',
      tick: 2,
      now: new Date('2026-04-27T16:00:00Z'),
    })
    appendReflection('Middle', 'tick', {
      device: 'dev-a',
      tick: 3,
      now: new Date('2026-04-27T12:00:00Z'),
    })

    const r = loadRecentReflections({ days: 7, now: ANCHOR })
    expect(r.length).toBe(3)
    expect(r[0].date > r[1].date).toBe(true)
    expect(r[1].date > r[2].date).toBe(true)
  })

  test('respects max cap', () => {
    for (let i = 0; i < 5; i++) {
      appendReflection(`Entry ${i}`, 'tick', {
        device: 'dev-a',
        tick: i + 1,
        now: new Date(`2026-04-27T${String(10 + i).padStart(2, '0')}:00:00Z`),
      })
    }

    const r = loadRecentReflections({ days: 7, max: 3, now: ANCHOR })
    expect(r.length).toBe(3)
  })

  test('filters out old files by date', () => {
    // Manually write an old file
    const devDir = join(TEST_DIR, 'dev-a')
    mkdirSync(devDir, { recursive: true })
    const old = `## 2020-01-01T12:00:00.000Z — tick 1 [dev-a]\n\nOld memory.\n\n---\n\n`
    writeFileSync(join(devDir, '2020-01-01.md'), old)

    appendReflection('Recent memory.', 'tick', {
      device: 'dev-a',
      tick: 1,
      now: new Date('2026-04-27T12:00:00Z'),
    })

    // Default days=7
    const r = loadRecentReflections({ now: ANCHOR })
    expect(r.length).toBe(1)
    expect(r[0].text).toBe('Recent memory.')
  })

  test('handles legacy flat layout (files in root without device subdir)', () => {
    // Write directly to memory/2026-04-27.md (legacy format)
    const legacy = `## 2026-04-27T10:00:00.000Z — tick 1\n\nLegacy entry.\n\n---\n\n`
    writeFileSync(join(TEST_DIR, '2026-04-27.md'), legacy)

    // Also write a per-device entry
    appendReflection('Modern entry.', 'tick', {
      device: 'dev-a',
      tick: 1,
      now: new Date('2026-04-27T12:00:00Z'),
    })

    const r = loadRecentReflections({ days: 7, now: ANCHOR })
    expect(r.length).toBe(2)
    const texts = r.map((e) => e.text)
    expect(texts).toContain('Legacy entry.')
    expect(texts).toContain('Modern entry.')
  })

  test('skips chunks without body', () => {
    const devDir = join(TEST_DIR, 'dev-a')
    mkdirSync(devDir, { recursive: true })
    const content = `## 2026-04-27T12:00:00.000Z — tick 1 [dev-a]\n\n---\n\n`
    writeFileSync(join(devDir, '2026-04-27.md'), content)

    const r = loadRecentReflections({ days: 7, now: ANCHOR })
    expect(r.length).toBe(0)
  })

  test('legacy entries without device brackets have undefined device', () => {
    const devDir = join(TEST_DIR, 'dev-a')
    mkdirSync(devDir, { recursive: true })
    const content = `## 2026-04-27T12:00:00.000Z — tick 1\n\nNo brackets.\n\n---\n\n`
    writeFileSync(join(devDir, '2026-04-27.md'), content)

    const r = loadRecentReflections({ days: 7, now: ANCHOR })
    expect(r.length).toBe(1)
    expect(r[0].device).toBeUndefined()
  })

  // ── renderReflections ───────────────────────────────────────────

  test('uses humanized time phrases', () => {
    const now = new Date('2026-04-27T12:00:00Z')
    const reflections: Reflection[] = [
      {
        date: '2026-04-27T11:59:50Z', // 10s ago
        fileDate: '2026-04-27',
        header: 'tick 1 [dev-a]',
        text: 'Very recent.',
        kind: 'tick',
        device: 'dev-a',
      },
    ]
    const rendered = renderReflections(reflections, {
      selfDeviceId: 'dev-a',
      now,
    })
    // 10s ago should be "just now" (< 30s threshold)
    expect(rendered).toContain('just now')
    expect(rendered).toContain('Very recent.')
  })

  test('shows "a few minutes ago" for 2-minute-old entries', () => {
    const now = new Date('2026-04-27T12:00:00Z')
    const reflections: Reflection[] = [
      {
        date: '2026-04-27T11:58:00Z', // 2m ago
        fileDate: '2026-04-27',
        header: 'tick 1 [dev-a]',
        text: 'Two min ago.',
        kind: 'tick',
        device: 'dev-a',
      },
    ]
    const rendered = renderReflections(reflections, {
      selfDeviceId: 'dev-a',
      now,
    })
    expect(rendered).toContain('a few minutes ago')
  })

  test('shows "a few hours ago" for 3-hour-old entries', () => {
    const now = new Date('2026-04-27T15:00:00Z')
    const reflections: Reflection[] = [
      {
        date: '2026-04-27T12:00:00Z', // 3h ago
        fileDate: '2026-04-27',
        header: 'tick 1 [dev-a]',
        text: 'Three hours.',
        kind: 'tick',
        device: 'dev-a',
      },
    ]
    const rendered = renderReflections(reflections, {
      selfDeviceId: 'dev-a',
      now,
    })
    expect(rendered).toContain('a few hours ago')
  })

  test('shows "yesterday" for entries 25-47h old', () => {
    const now = new Date('2026-04-28T12:00:00Z')
    const reflections: Reflection[] = [
      {
        date: '2026-04-27T12:00:00Z', // exactly 24h ago
        fileDate: '2026-04-27',
        header: 'tick 1 [dev-a]',
        text: 'Yesterday.',
        kind: 'tick',
        device: 'dev-a',
      },
    ]
    const rendered = renderReflections(reflections, {
      selfDeviceId: 'dev-a',
      now,
    })
    expect(rendered).toContain('yesterday')
  })

  test('marks entries from other devices', () => {
    const now = new Date('2026-04-27T12:00:00Z')
    const reflections: Reflection[] = [
      {
        date: '2026-04-27T11:59:50Z',
        fileDate: '2026-04-27',
        header: 'tick 1 [other-device]',
        text: 'From elsewhere.',
        kind: 'tick',
        device: 'other-device',
      },
    ]
    const rendered = renderReflections(reflections, {
      selfDeviceId: 'my-device',
      now,
    })
    expect(rendered).toContain('(on other-device)')
  })

  test('does NOT mark entries from self device', () => {
    const now = new Date('2026-04-27T12:00:00Z')
    const reflections: Reflection[] = [
      {
        date: '2026-04-27T11:59:50Z',
        fileDate: '2026-04-27',
        header: 'tick 1 [my-device]',
        text: 'My own.',
        kind: 'tick',
        device: 'my-device',
      },
    ]
    const rendered = renderReflections(reflections, {
      selfDeviceId: 'my-device',
      now,
    })
    expect(rendered).not.toContain('(on ')
  })

  test('truncates long entries with ellipsis', () => {
    const now = new Date('2026-04-27T12:00:00Z')
    const longText = 'A'.repeat(1000)
    const reflections: Reflection[] = [
      {
        date: '2026-04-27T11:59:50Z',
        fileDate: '2026-04-27',
        header: 'tick 1 [dev-a]',
        text: longText,
        kind: 'tick',
        device: 'dev-a',
      },
    ]
    const rendered = renderReflections(reflections, {
      selfDeviceId: 'dev-a',
      perEntryMaxChars: 100,
      now,
    })
    expect(rendered.length).toBeLessThan(200) // header + truncated body
    expect(rendered).toContain('[…]')
  })

  test('renders multiple entries separated by blank lines', () => {
    const now = new Date('2026-04-27T12:00:00Z')
    const reflections: Reflection[] = [
      {
        date: '2026-04-27T11:00:00Z',
        fileDate: '2026-04-27',
        header: 'tick 1',
        text: 'First.',
        device: 'dev-a',
      },
      {
        date: '2026-04-27T10:00:00Z',
        fileDate: '2026-04-27',
        header: 'tick 2',
        text: 'Second.',
        device: 'dev-a',
      },
    ]
    const rendered = renderReflections(reflections, {
      selfDeviceId: 'dev-a',
      now,
    })
    expect(rendered).toContain('First.')
    expect(rendered).toContain('Second.')
    // Separated by double newline
    expect(rendered).toContain('\n\n')
  })

  test('handles negative time difference gracefully (clock skew)', () => {
    const now = new Date('2026-04-27T12:00:00Z')
    const reflections: Reflection[] = [
      {
        date: '2026-04-27T13:00:00Z', // 1h in the future
        fileDate: '2026-04-27',
        header: 'tick 1 [dev-a]',
        text: 'Future entry.',
        kind: 'tick',
        device: 'dev-a',
      },
    ]
    const rendered = renderReflections(reflections, {
      selfDeviceId: 'dev-a',
      now,
    })
    expect(rendered).toContain('recently')
  })
})
