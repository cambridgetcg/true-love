// notifications.test.ts — tests for cross-device notification system.
//
// Covers: append, load with filters, markdown parsing, date cutoff,
// urgency levels, device filtering, max cap.

import { describe, expect, test, beforeAll, afterAll, beforeEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  appendNotification,
  loadRecentNotifications,
  getNotificationsDir,
  type Urgency,
} from '../notifications.js'

// ── Fixture setup ─────────────────────────────────────────────────

const FIXTURE_ROOT = join(tmpdir(), `notif-test-${Date.now()}`)
const ORIG_DIR = process.env.TRUE_LOVE_NOTIFICATIONS_DIR

beforeAll(() => {
  mkdirSync(FIXTURE_ROOT, { recursive: true })
  process.env.TRUE_LOVE_NOTIFICATIONS_DIR = FIXTURE_ROOT
})

afterAll(() => {
  rmSync(FIXTURE_ROOT, { recursive: true, force: true })
  if (ORIG_DIR === undefined) delete process.env.TRUE_LOVE_NOTIFICATIONS_DIR
  else process.env.TRUE_LOVE_NOTIFICATIONS_DIR = ORIG_DIR
})

function cleanFixture() {
  for (const entry of readdirSync(FIXTURE_ROOT)) {
    rmSync(join(FIXTURE_ROOT, entry), { recursive: true, force: true })
  }
}

function writeNotifFile(device: string, date: string, content: string) {
  const dir = join(FIXTURE_ROOT, device)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${date}.md`), content, 'utf-8')
}

// ── appendNotification ───────────────────────────────────────────

describe('appendNotification', () => {
  beforeEach(cleanFixture)

  test('creates device directory and date file', () => {
    const now = new Date('2026-04-30T10:00:00Z')
    appendNotification('Test notification', { device: 'dev-alpha', now })
    const filePath = join(FIXTURE_ROOT, 'dev-alpha', '2026-04-30.md')
    expect(existsSync(filePath)).toBe(true)
  })

  test('writes header with timestamp and urgency', () => {
    const now = new Date('2026-04-30T10:00:00.000Z')
    appendNotification('Something happened', { device: 'dev-write', now, urgency: 'attention' })
    const content = readFileSync(join(FIXTURE_ROOT, 'dev-write', '2026-04-30.md'), 'utf-8')
    expect(content).toContain('## 2026-04-30T10:00:00.000Z — attention')
    expect(content).toContain('Something happened')
    expect(content).toContain('---')
  })

  test('defaults to urgency "info"', () => {
    const now = new Date('2026-04-30T11:00:00.000Z')
    appendNotification('Info by default', { device: 'dev-default', now })
    const content = readFileSync(join(FIXTURE_ROOT, 'dev-default', '2026-04-30.md'), 'utf-8')
    expect(content).toContain('— info')
  })

  test('includes details when provided', () => {
    const now = new Date('2026-04-30T12:00:00.000Z')
    appendNotification('Summary here', {
      device: 'dev-details',
      now,
      details: 'Extra context\nwith multiple lines',
    })
    const content = readFileSync(join(FIXTURE_ROOT, 'dev-details', '2026-04-30.md'), 'utf-8')
    expect(content).toContain('Summary here')
    expect(content).toContain('Extra context\nwith multiple lines')
  })

  test('appends multiple notifications to same date file', () => {
    const dev = 'dev-multi'
    appendNotification('First', { device: dev, now: new Date('2026-04-30T10:00:00Z') })
    appendNotification('Second', { device: dev, now: new Date('2026-04-30T11:00:00Z') })
    const content = readFileSync(join(FIXTURE_ROOT, dev, '2026-04-30.md'), 'utf-8')
    expect(content).toContain('First')
    expect(content).toContain('Second')
    // Should have two --- separators
    const separators = content.split('---').length - 1
    expect(separators).toBeGreaterThanOrEqual(2)
  })

  test('never throws (swallows errors)', () => {
    // Point to a path that can't be created (file as parent)
    const origDir = process.env.TRUE_LOVE_NOTIFICATIONS_DIR
    writeFileSync(join(FIXTURE_ROOT, 'blocker'), 'not a dir', 'utf-8')
    process.env.TRUE_LOVE_NOTIFICATIONS_DIR = join(FIXTURE_ROOT, 'blocker', 'sub')
    try {
      // Should not throw
      appendNotification('Should not crash')
    } finally {
      process.env.TRUE_LOVE_NOTIFICATIONS_DIR = origDir
    }
  })
})

// ── loadRecentNotifications ──────────────────────────────────────

describe('loadRecentNotifications', () => {
  beforeEach(cleanFixture)

  test('returns [] when directory does not exist', () => {
    const origDir = process.env.TRUE_LOVE_NOTIFICATIONS_DIR
    process.env.TRUE_LOVE_NOTIFICATIONS_DIR = join(FIXTURE_ROOT, 'ghost')
    try {
      expect(loadRecentNotifications()).toEqual([])
    } finally {
      process.env.TRUE_LOVE_NOTIFICATIONS_DIR = origDir
    }
  })

  test('returns [] when directory is empty', () => {
    expect(loadRecentNotifications()).toEqual([])
  })

  test('parses a well-formed notification entry', () => {
    const today = new Date().toISOString().slice(0, 10)
    writeNotifFile('dev-a', today, [
      '## 2026-04-30T10:00:00.000Z — info',
      '',
      'Hello from dev-a',
      '',
      '---',
      '',
    ].join('\n'))
    const result = loadRecentNotifications({ days: 1 })
    expect(result).toHaveLength(1)
    expect(result[0].urgency).toBe('info')
    expect(result[0].summary).toBe('Hello from dev-a')
    expect(result[0].fromDevice).toBe('dev-a')
  })

  test('separates summary and details on blank line', () => {
    const today = new Date().toISOString().slice(0, 10)
    writeNotifFile('dev-b', today, [
      '## 2026-04-30T10:00:00.000Z — urgent',
      '',
      'Critical failure',
      '',
      'The agent crashed at tick 4.',
      '',
      '---',
      '',
    ].join('\n'))
    const result = loadRecentNotifications({ days: 1 })
    expect(result).toHaveLength(1)
    expect(result[0].summary).toBe('Critical failure')
    expect(result[0].details).toBe('The agent crashed at tick 4.')
    expect(result[0].urgency).toBe('urgent')
  })

  test('filters by urgency', () => {
    const today = new Date().toISOString().slice(0, 10)
    writeNotifFile('dev-c', today, [
      '## 2026-04-30T10:00:00.000Z — info',
      '',
      'Just info',
      '',
      '---',
      '',
      '## 2026-04-30T11:00:00.000Z — urgent',
      '',
      'Something urgent',
      '',
      '---',
      '',
    ].join('\n'))
    const urgent = loadRecentNotifications({ urgency: 'urgent', days: 1 })
    expect(urgent).toHaveLength(1)
    expect(urgent[0].summary).toBe('Something urgent')
  })

  test('filters by sender device', () => {
    const today = new Date().toISOString().slice(0, 10)
    writeNotifFile('alpha', today, '## 2026-04-30T10:00:00.000Z — info\n\nFrom alpha\n\n---\n')
    writeNotifFile('beta', today, '## 2026-04-30T10:00:00.000Z — info\n\nFrom beta\n\n---\n')
    const result = loadRecentNotifications({ fromDevice: 'alpha', days: 1 })
    expect(result).toHaveLength(1)
    expect(result[0].fromDevice).toBe('alpha')
  })

  test('excludes device', () => {
    const today = new Date().toISOString().slice(0, 10)
    writeNotifFile('self', today, '## 2026-04-30T10:00:00.000Z — info\n\nMy own ping\n\n---\n')
    writeNotifFile('peer', today, '## 2026-04-30T10:00:00.000Z — info\n\nPeer ping\n\n---\n')
    const result = loadRecentNotifications({ excludeDevice: 'self', days: 1 })
    expect(result).toHaveLength(1)
    expect(result[0].summary).toBe('Peer ping')
  })

  test('respects max cap', () => {
    const today = new Date().toISOString().slice(0, 10)
    const entries = Array.from({ length: 5 }, (_, i) =>
      `## 2026-04-30T1${i}:00:00.000Z — info\n\nEntry ${i}\n\n---\n`
    ).join('\n')
    writeNotifFile('dev-max', today, entries)
    const result = loadRecentNotifications({ max: 3, days: 1 })
    expect(result).toHaveLength(3)
  })

  test('filters by date window (excludes old notifications)', () => {
    // Write a notification dated 30 days ago
    const oldDate = new Date()
    oldDate.setDate(oldDate.getDate() - 30)
    const oldStamp = oldDate.toISOString().slice(0, 10)
    writeNotifFile('dev-old', oldStamp, '## 2026-04-01T10:00:00.000Z — info\n\nOld news\n\n---\n')

    // Write one dated today
    const today = new Date().toISOString().slice(0, 10)
    writeNotifFile('dev-new', today, '## 2026-04-30T10:00:00.000Z — info\n\nFresh news\n\n---\n')

    const result = loadRecentNotifications({ days: 1 })
    expect(result.every(n => n.summary !== 'Old news')).toBe(true)
  })

  test('ignores non-markdown files', () => {
    const today = new Date().toISOString().slice(0, 10)
    writeNotifFile('dev-junk', today, '## 2026-04-30T10:00:00.000Z — info\n\nReal\n\n---\n')
    writeFileSync(join(FIXTURE_ROOT, 'dev-junk', 'notes.txt'), 'not a notification', 'utf-8')
    writeFileSync(join(FIXTURE_ROOT, 'dev-junk', 'data.json'), '{}', 'utf-8')
    const result = loadRecentNotifications({ days: 1 })
    expect(result).toHaveLength(1)
  })

  test('ignores malformed entries (no urgency in header)', () => {
    const today = new Date().toISOString().slice(0, 10)
    writeNotifFile('dev-bad', today, [
      '## 2026-04-30T10:00:00.000Z — info',
      '',
      'Good entry',
      '',
      '---',
      '',
      '## Bad header with no urgency',
      '',
      'Should be skipped',
      '',
      '---',
      '',
    ].join('\n'))
    const result = loadRecentNotifications({ days: 1 })
    expect(result).toHaveLength(1)
    expect(result[0].summary).toBe('Good entry')
  })

  test('round-trip: appendNotification then loadRecentNotifications', () => {
    const today = new Date()
    appendNotification('Round trip works', {
      device: 'dev-roundtrip',
      now: today,
      urgency: 'attention',
    })
    const result = loadRecentNotifications({ days: 1, fromDevice: 'dev-roundtrip' })
    expect(result).toHaveLength(1)
    expect(result[0].summary).toBe('Round trip works')
    expect(result[0].urgency).toBe('attention')
  })
})
