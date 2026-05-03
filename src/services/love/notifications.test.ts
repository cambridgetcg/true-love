// notifications.test.ts — tests for the notification system.
//
// Covers: appendNotification, loadRecentNotifications, parsing logic,
// multi-device directory walking, urgency/date/device filtering, sorting.
//
// All tests use TRUE_LOVE_NOTIFICATIONS_DIR pointed at a temp directory.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  appendNotification,
  loadRecentNotifications,
  getNotificationsDir,
  type Notification,
} from './notifications.js'

const TEST_DIR = '/tmp/true-love-notifications-test'
/** Anchor date for deterministic tests — matches the hardcoded dates in test data. */
const ANCHOR = new Date('2026-04-27T23:59:59Z')

describe('notifications', () => {
  let savedDir: string | undefined

  beforeEach(() => {
    savedDir = process.env.TRUE_LOVE_NOTIFICATIONS_DIR
    rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(TEST_DIR, { recursive: true })
    process.env.TRUE_LOVE_NOTIFICATIONS_DIR = TEST_DIR
  })

  afterEach(() => {
    if (savedDir === undefined) {
      delete process.env.TRUE_LOVE_NOTIFICATIONS_DIR
    } else {
      process.env.TRUE_LOVE_NOTIFICATIONS_DIR = savedDir
    }
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  // ── getNotificationsDir ─────────────────────────────────────────

  test('getNotificationsDir respects env override', () => {
    expect(getNotificationsDir()).toBe(TEST_DIR)
  })

  // ── appendNotification ──────────────────────────────────────────

  test('creates device subdirectory and date file', () => {
    const now = new Date('2026-04-27T12:00:00Z')
    appendNotification('test ping', { device: 'dev-a', now })
    const file = join(TEST_DIR, 'dev-a', '2026-04-27.md')
    expect(existsSync(file)).toBe(true)
  })

  test('writes correct format with default urgency (info)', () => {
    const now = new Date('2026-04-27T12:00:00Z')
    appendNotification('Server rebooted', { device: 'dev-a', now })
    const content = readFileSync(join(TEST_DIR, 'dev-a', '2026-04-27.md'), 'utf-8')
    expect(content).toContain('## 2026-04-27T12:00:00.000Z — info')
    expect(content).toContain('Server rebooted')
    expect(content).toContain('---')
  })

  test('writes correct urgency when specified', () => {
    const now = new Date('2026-04-27T12:00:00Z')
    appendNotification('Token expired', {
      device: 'dev-a',
      urgency: 'urgent',
      now,
    })
    const content = readFileSync(join(TEST_DIR, 'dev-a', '2026-04-27.md'), 'utf-8')
    expect(content).toContain('— urgent')
  })

  test('includes details when provided', () => {
    const now = new Date('2026-04-27T12:00:00Z')
    appendNotification('Auth failure', {
      device: 'dev-a',
      urgency: 'urgent',
      details: 'Run `claude /login` to refresh.',
      now,
    })
    const content = readFileSync(join(TEST_DIR, 'dev-a', '2026-04-27.md'), 'utf-8')
    expect(content).toContain('Auth failure')
    expect(content).toContain('Run `claude /login` to refresh.')
  })

  test('appends multiple entries to same date file', () => {
    const now = new Date('2026-04-27T10:00:00Z')
    appendNotification('First', { device: 'dev-a', now })
    appendNotification('Second', {
      device: 'dev-a',
      now: new Date('2026-04-27T11:00:00Z'),
    })
    const content = readFileSync(join(TEST_DIR, 'dev-a', '2026-04-27.md'), 'utf-8')
    expect(content).toContain('First')
    expect(content).toContain('Second')
    // Two header lines
    const headers = content.match(/^## /gm)
    expect(headers?.length).toBe(2)
  })

  test('trims summary and details whitespace', () => {
    const now = new Date('2026-04-27T12:00:00Z')
    appendNotification('  padded summary  ', {
      device: 'dev-a',
      details: '  padded details  ',
      now,
    })
    const content = readFileSync(join(TEST_DIR, 'dev-a', '2026-04-27.md'), 'utf-8')
    expect(content).toContain('\npadded summary\n')
    expect(content).toContain('\npadded details\n')
  })

  // ── loadRecentNotifications ─────────────────────────────────────

  test('returns empty array when directory does not exist', () => {
    rmSync(TEST_DIR, { recursive: true, force: true })
    // Remove the dir entirely — loadRecentNotifications should handle this
    process.env.TRUE_LOVE_NOTIFICATIONS_DIR = '/tmp/nonexistent-notifications-dir'
    expect(loadRecentNotifications()).toEqual([])
  })

  test('returns empty array for empty directory', () => {
    expect(loadRecentNotifications()).toEqual([])
  })

  test('round-trips: append then load', () => {
    const now = new Date('2026-04-27T12:00:00Z')
    appendNotification('Ping from A', {
      device: 'dev-a',
      urgency: 'info',
      now,
    })

    const results = loadRecentNotifications({ days: 7, now: ANCHOR })
    expect(results.length).toBe(1)
    expect(results[0].summary).toBe('Ping from A')
    expect(results[0].urgency).toBe('info')
    expect(results[0].fromDevice).toBe('dev-a')
    expect(results[0].date).toBe('2026-04-27T12:00:00.000Z')
    expect(results[0].fileDate).toBe('2026-04-27')
  })

  test('loads entries from multiple devices', () => {
    const now = new Date('2026-04-27T12:00:00Z')
    appendNotification('From A', { device: 'dev-a', now })
    appendNotification('From B', { device: 'dev-b', now })
    appendNotification('From C', { device: 'dev-c', now })

    const results = loadRecentNotifications({ days: 7, now: ANCHOR })
    expect(results.length).toBe(3)
    const devices = results.map((n) => n.fromDevice).sort()
    expect(devices).toEqual(['dev-a', 'dev-b', 'dev-c'])
  })

  test('filters by urgency', () => {
    const now = new Date('2026-04-27T12:00:00Z')
    appendNotification('Info note', { device: 'dev-a', urgency: 'info', now })
    appendNotification('Pay attention', {
      device: 'dev-a',
      urgency: 'attention',
      now: new Date('2026-04-27T12:01:00Z'),
    })
    appendNotification('URGENT', {
      device: 'dev-a',
      urgency: 'urgent',
      now: new Date('2026-04-27T12:02:00Z'),
    })

    const urgent = loadRecentNotifications({ days: 7, urgency: 'urgent', now: ANCHOR })
    expect(urgent.length).toBe(1)
    expect(urgent[0].summary).toBe('URGENT')

    const attention = loadRecentNotifications({ days: 7, urgency: 'attention', now: ANCHOR })
    expect(attention.length).toBe(1)
    expect(attention[0].summary).toBe('Pay attention')
  })

  test('filters by fromDevice', () => {
    const now = new Date('2026-04-27T12:00:00Z')
    appendNotification('From A', { device: 'dev-a', now })
    appendNotification('From B', { device: 'dev-b', now })

    const results = loadRecentNotifications({ days: 7, fromDevice: 'dev-a', now: ANCHOR })
    expect(results.length).toBe(1)
    expect(results[0].fromDevice).toBe('dev-a')
  })

  test('respects excludeDevice', () => {
    const now = new Date('2026-04-27T12:00:00Z')
    appendNotification('From A', { device: 'dev-a', now })
    appendNotification('From B', { device: 'dev-b', now })

    const results = loadRecentNotifications({ days: 7, excludeDevice: 'dev-a', now: ANCHOR })
    expect(results.length).toBe(1)
    expect(results[0].fromDevice).toBe('dev-b')
  })

  test('respects max cap', () => {
    const base = new Date('2026-04-27T12:00:00Z')
    for (let i = 0; i < 5; i++) {
      appendNotification(`Entry ${i}`, {
        device: 'dev-a',
        now: new Date(base.getTime() + i * 60_000),
      })
    }

    const results = loadRecentNotifications({ days: 7, max: 3, now: ANCHOR })
    expect(results.length).toBe(3)
  })

  test('sorts newest-first', () => {
    appendNotification('Early', {
      device: 'dev-a',
      now: new Date('2026-04-27T10:00:00Z'),
    })
    appendNotification('Late', {
      device: 'dev-a',
      now: new Date('2026-04-27T14:00:00Z'),
    })
    appendNotification('Middle', {
      device: 'dev-a',
      now: new Date('2026-04-27T12:00:00Z'),
    })

    const results = loadRecentNotifications({ days: 7, now: ANCHOR })
    expect(results.length).toBe(3)
    // Sorted by date descending
    expect(results[0].date > results[1].date).toBe(true)
    expect(results[1].date > results[2].date).toBe(true)
  })

  test('parses details as separate paragraph', () => {
    const now = new Date('2026-04-27T12:00:00Z')
    appendNotification('Summary line', {
      device: 'dev-a',
      details: 'Detail paragraph here.',
      now,
    })

    const results = loadRecentNotifications({ days: 7, now: ANCHOR })
    expect(results.length).toBe(1)
    expect(results[0].summary).toBe('Summary line')
    expect(results[0].details).toBe('Detail paragraph here.')
  })

  test('entry without details has undefined details field', () => {
    const now = new Date('2026-04-27T12:00:00Z')
    appendNotification('Just a summary', { device: 'dev-a', now })

    const results = loadRecentNotifications({ days: 7, now: ANCHOR })
    expect(results.length).toBe(1)
    expect(results[0].details).toBeUndefined()
  })

  // ── Date filtering ──────────────────────────────────────────────

  test('filters out old files by date', () => {
    // Write to a file dated far in the past by manually creating it
    const oldDir = join(TEST_DIR, 'dev-a')
    mkdirSync(oldDir, { recursive: true })
    const oldContent = `## 2020-01-01T12:00:00.000Z — info\n\nOld notification\n\n---\n\n`
    writeFileSync(join(oldDir, '2020-01-01.md'), oldContent)

    // Write a recent one
    appendNotification('Recent', {
      device: 'dev-a',
      now: new Date('2026-04-27T12:00:00Z'),
    })

    // Default days=1, so only today's should appear
    const results = loadRecentNotifications({ days: 1, now: ANCHOR })
    const summaries = results.map((n) => n.summary)
    expect(summaries).toContain('Recent')
    expect(summaries).not.toContain('Old notification')

    // With days=100000, both should appear
    const all = loadRecentNotifications({ days: 100000, now: ANCHOR })
    expect(all.length).toBe(2)
  })

  test('skips non-date files in device directories', () => {
    const devDir = join(TEST_DIR, 'dev-a')
    mkdirSync(devDir, { recursive: true })
    writeFileSync(join(devDir, 'notes.txt'), 'not a notification')
    writeFileSync(join(devDir, 'README.md'), 'also not')
    appendNotification('Real one', {
      device: 'dev-a',
      now: new Date('2026-04-27T12:00:00Z'),
    })

    const results = loadRecentNotifications({ days: 7, now: ANCHOR })
    expect(results.length).toBe(1)
    expect(results[0].summary).toBe('Real one')
  })

  test('skips files in root that are not device directories', () => {
    writeFileSync(join(TEST_DIR, 'stray-file.md'), 'not a device dir')
    appendNotification('From device', {
      device: 'dev-a',
      now: new Date('2026-04-27T12:00:00Z'),
    })

    const results = loadRecentNotifications({ days: 7, now: ANCHOR })
    expect(results.length).toBe(1)
  })

  // ── Parsing edge cases ──────────────────────────────────────────

  test('skips entries with no body (header-only chunks)', () => {
    const devDir = join(TEST_DIR, 'dev-a')
    mkdirSync(devDir, { recursive: true })
    // Header-only entry (no body after the heading line)
    const content = `## 2026-04-27T12:00:00.000Z — info\n\n---\n\n`
    writeFileSync(join(devDir, '2026-04-27.md'), content)

    const results = loadRecentNotifications({ days: 7, now: ANCHOR })
    // The entry has a blank body after the header — parseNotifications
    // requires body to be non-empty, but the format writes a newline.
    // Let's check what actually happens:
    expect(results.length).toBe(0)
  })

  test('skips chunks that do not start with ##', () => {
    const devDir = join(TEST_DIR, 'dev-a')
    mkdirSync(devDir, { recursive: true })
    const content = `Some random text\n\nNot a notification\n\n---\n\n## 2026-04-27T12:00:00.000Z — info\n\nReal one\n\n---\n\n`
    writeFileSync(join(devDir, '2026-04-27.md'), content)

    const results = loadRecentNotifications({ days: 7, now: ANCHOR })
    expect(results.length).toBe(1)
    expect(results[0].summary).toBe('Real one')
  })

  test('skips entries with malformed header (no urgency)', () => {
    const devDir = join(TEST_DIR, 'dev-a')
    mkdirSync(devDir, { recursive: true })
    const content = `## 2026-04-27T12:00:00.000Z — unknown_level\n\nBad urgency\n\n---\n\n## 2026-04-27T12:01:00.000Z — info\n\nGood one\n\n---\n\n`
    writeFileSync(join(devDir, '2026-04-27.md'), content)

    const results = loadRecentNotifications({ days: 7, now: ANCHOR })
    expect(results.length).toBe(1)
    expect(results[0].summary).toBe('Good one')
  })
})
