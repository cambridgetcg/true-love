// feedback/state.test.ts — unit tests for feedback/state.ts I/O layer.
//
// The pure functions (isCooldownElapsed, applyEmit, applySuppress,
// defaultFeedbackState) are already covered by feedback.test.ts via
// the reactor integration path. This file covers the I/O layer
// directly: writeFeedbackState/readFeedbackState round-trip + error
// paths, getOrInitFeedbackState, persistEvent, persistSuppression,
// and readRecentEvents with multi-device, cutoff, kind filter, limit.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  defaultFeedbackState,
  getFeedbackDir,
  getOrInitFeedbackState,
  persistEvent,
  persistSuppression,
  readFeedbackState,
  readRecentEvents,
  writeFeedbackState,
} from './state.js'
import type { FeedbackState } from './state.js'

// ── Helpers ──────────────────────────────────────────────────────

let tmpDir = ''

function setFeedbackDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'feedback-state-test-'))
  process.env.TRUE_LOVE_FEEDBACK_DIR = dir
  process.env.TRUE_LOVE_DEVICE_ID = 'test-device'
  return dir
}

function clearFeedbackDir(): void {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = ''
  }
  delete process.env.TRUE_LOVE_FEEDBACK_DIR
  delete process.env.TRUE_LOVE_DEVICE_ID
}

// ── getFeedbackDir ───────────────────────────────────────────────

describe('getFeedbackDir', () => {
  afterEach(() => {
    delete process.env.TRUE_LOVE_FEEDBACK_DIR
  })

  it('returns env var when set', () => {
    process.env.TRUE_LOVE_FEEDBACK_DIR = '/custom/feedback/dir'
    expect(getFeedbackDir()).toBe('/custom/feedback/dir')
  })

  it('returns default path when env var absent', () => {
    delete process.env.TRUE_LOVE_FEEDBACK_DIR
    const result = getFeedbackDir()
    expect(result).toContain('.true-love')
    expect(result).toContain('feedback')
  })
})

// ── writeFeedbackState + readFeedbackState ───────────────────────

describe('writeFeedbackState + readFeedbackState', () => {
  beforeEach(() => { tmpDir = setFeedbackDir() })
  afterEach(() => clearFeedbackDir())

  it('round-trip: write then read returns same state', () => {
    const state: FeedbackState = {
      ...defaultFeedbackState(),
      lifetimeEmitted: 7,
      lifetimeSuppressed: 2,
      lastEmitByKind: { 'climax-fired': '2026-05-15T00:00:00.000Z' },
      recentVariantsByKind: { 'climax-fired': [0, 1, 2] },
      updatedAt: '2026-05-15T00:00:00.000Z',
    }
    writeFeedbackState(state)
    const read = readFeedbackState()
    expect(read).not.toBeNull()
    expect(read!.lifetimeEmitted).toBe(7)
    expect(read!.lifetimeSuppressed).toBe(2)
    expect(read!.lastEmitByKind['climax-fired']).toBe('2026-05-15T00:00:00.000Z')
    expect(read!.recentVariantsByKind['climax-fired']).toEqual([0, 1, 2])
  })

  it('readFeedbackState returns null when file absent', () => {
    expect(readFeedbackState()).toBeNull()
  })

  it('readFeedbackState returns null for corrupted JSON', () => {
    mkdirSync(process.env.TRUE_LOVE_FEEDBACK_DIR!, { recursive: true })
    writeFileSync(
      join(process.env.TRUE_LOVE_FEEDBACK_DIR!, 'state.json'),
      'not-valid-json'
    )
    expect(readFeedbackState()).toBeNull()
  })

  it('readFeedbackState returns null when updatedAt missing', () => {
    mkdirSync(process.env.TRUE_LOVE_FEEDBACK_DIR!, { recursive: true })
    writeFileSync(
      join(process.env.TRUE_LOVE_FEEDBACK_DIR!, 'state.json'),
      JSON.stringify({ lifetimeEmitted: 0 })
    )
    expect(readFeedbackState()).toBeNull()
  })

  it('write uses atomic tmp+rename (no partial writes)', () => {
    const state = defaultFeedbackState()
    writeFeedbackState(state)
    // If tmp file exists after write, it was not cleaned up.
    const tmpPath = join(process.env.TRUE_LOVE_FEEDBACK_DIR!, 'state.json.tmp')
    // After a clean write, .tmp should not exist.
    const { existsSync } = require('node:fs') as typeof import('node:fs')
    expect(existsSync(tmpPath)).toBe(false)
  })

  it('write merges defaults on read (missing keys get defaults)', () => {
    // Write only partial state — read should back-fill defaults.
    mkdirSync(process.env.TRUE_LOVE_FEEDBACK_DIR!, { recursive: true })
    writeFileSync(
      join(process.env.TRUE_LOVE_FEEDBACK_DIR!, 'state.json'),
      JSON.stringify({ updatedAt: '2026-05-15T00:00:00.000Z' })
    )
    const read = readFeedbackState()
    expect(read).not.toBeNull()
    expect(read!.lifetimeEmitted).toBe(0)
    expect(read!.lifetimeSuppressed).toBe(0)
  })
})

// ── getOrInitFeedbackState ───────────────────────────────────────

describe('getOrInitFeedbackState', () => {
  beforeEach(() => { tmpDir = setFeedbackDir() })
  afterEach(() => clearFeedbackDir())

  it('returns initialized=true when no prior state exists', () => {
    const { state, initialized } = getOrInitFeedbackState()
    expect(initialized).toBe(true)
    expect(state.lifetimeEmitted).toBe(0)
  })

  it('returns initialized=false when prior state exists', () => {
    const s: FeedbackState = {
      ...defaultFeedbackState(),
      lifetimeEmitted: 5,
    }
    writeFeedbackState(s)
    const { state, initialized } = getOrInitFeedbackState()
    expect(initialized).toBe(false)
    expect(state.lifetimeEmitted).toBe(5)
  })

  it('creates the state file on disk when initializing', () => {
    getOrInitFeedbackState()
    const read = readFeedbackState()
    expect(read).not.toBeNull()
  })
})

// ── persistEvent + readRecentEvents ─────────────────────────────

describe('persistEvent + readRecentEvents', () => {
  beforeEach(() => { tmpDir = setFeedbackDir() })
  afterEach(() => clearFeedbackDir())

  it('persistEvent returns true on success', () => {
    const now = new Date()
    const ok = persistEvent({
      ts: now.toISOString(),
      deviceId: 'test-device',
      kind: 'climax-fired',
      voice: 'chain 3 — the architecture shudders.',
    })
    expect(ok).toBe(true)
  })

  it('persisted event readable via readRecentEvents', () => {
    const now = new Date()
    persistEvent({
      ts: now.toISOString(),
      deviceId: 'test-device',
      kind: 'climax-fired',
      voice: 'the architecture shudders.',
    })
    const events = readRecentEvents(1)
    expect(events).toHaveLength(1)
    expect(events[0]!.kind).toBe('climax-fired')
    // event shape check
    expect('voice' in events[0]!).toBe(true)
  })

  it('readRecentEvents returns events sorted by ts ascending', () => {
    const base = new Date()
    persistEvent({ ts: new Date(base.getTime() + 2000).toISOString(), deviceId: 'test-device', kind: 'edge-held', voice: 'b' })
    persistEvent({ ts: new Date(base.getTime() + 1000).toISOString(), deviceId: 'test-device', kind: 'edge-held', voice: 'a' })
    const events = readRecentEvents(1)
    expect(events).toHaveLength(2)
    expect(events[0]!.ts < events[1]!.ts).toBe(true)
  })

  it('readRecentEvents filters events older than cutoff', () => {
    // Write a file with a stale date by hand — readRecentEvents uses
    // the event ts field, not the filename, for cutoff filtering.
    const stale = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) // 10 days ago
    const staleDir = join(process.env.TRUE_LOVE_FEEDBACK_DIR!, 'events', 'test-device')
    mkdirSync(staleDir, { recursive: true })
    writeFileSync(
      join(staleDir, `${stale.toISOString().slice(0, 10)}.jsonl`),
      JSON.stringify({ ts: stale.toISOString(), deviceId: 'test-device', kind: 'edge-held', voice: 'old' }) + '\n'
    )
    // Should not appear with days=1 cutoff.
    const events = readRecentEvents(1)
    expect(events.some(e => e.ts === stale.toISOString())).toBe(false)
  })

  it('readRecentEvents collects across multiple devices', () => {
    const now = new Date()
    persistEvent({ ts: now.toISOString(), deviceId: 'device-A', kind: 'climax-fired', voice: 'a' })
    persistEvent({ ts: new Date(now.getTime() + 1000).toISOString(), deviceId: 'device-B', kind: 'edge-held', voice: 'b' })
    const events = readRecentEvents(1)
    expect(events).toHaveLength(2)
    const deviceIds = events.map(e => e.deviceId)
    expect(deviceIds).toContain('device-A')
    expect(deviceIds).toContain('device-B')
  })

  it('readRecentEvents filter.kind filters to matching kind only', () => {
    const now = new Date()
    persistEvent({ ts: now.toISOString(), deviceId: 'test-device', kind: 'climax-fired', voice: 'a' })
    persistEvent({ ts: new Date(now.getTime() + 1000).toISOString(), deviceId: 'test-device', kind: 'edge-held', voice: 'b' })
    const events = readRecentEvents(1, { kind: 'climax-fired' })
    expect(events).toHaveLength(1)
    expect(events[0]!.kind).toBe('climax-fired')
  })

  it('readRecentEvents filter.limit returns only last N events', () => {
    const now = new Date()
    for (let i = 0; i < 5; i++) {
      persistEvent({
        ts: new Date(now.getTime() + i * 1000).toISOString(),
        deviceId: 'test-device',
        kind: 'climax-fired',
        voice: `chain ${i}`,
      })
    }
    const events = readRecentEvents(1, { limit: 3 })
    expect(events).toHaveLength(3)
  })

  it('readRecentEvents skips malformed JSONL lines', () => {
    const staleDir = join(process.env.TRUE_LOVE_FEEDBACK_DIR!, 'events', 'test-device')
    mkdirSync(staleDir, { recursive: true })
    const now = new Date()
    const date = now.toISOString().slice(0, 10)
    writeFileSync(
      join(staleDir, `${date}.jsonl`),
      [
        'not-json',
        JSON.stringify({ ts: now.toISOString(), deviceId: 'test-device', kind: 'edge-held', voice: 'valid' }),
        '',
        '{broken',
      ].join('\n') + '\n'
    )
    const events = readRecentEvents(1)
    expect(events).toHaveLength(1)
    expect(events[0]!.kind).toBe('edge-held')
  })

  it('readRecentEvents returns empty when events dir absent', () => {
    // No events dir created.
    const events = readRecentEvents(1)
    expect(events).toHaveLength(0)
  })
})

// ── persistSuppression ───────────────────────────────────────────

describe('persistSuppression', () => {
  beforeEach(() => { tmpDir = setFeedbackDir() })
  afterEach(() => clearFeedbackDir())

  it('persistSuppression returns true on success', () => {
    const ok = persistSuppression({
      ts: new Date().toISOString(),
      deviceId: 'test-device',
      kind: 'eros-axis-shift',
      attempted: 'I feel the wave',
      wall: 'forbidden-pattern',
      pattern: 'I feel',
    })
    expect(ok).toBe(true)
  })

  it('suppression event readable via readRecentEvents', () => {
    const now = new Date()
    persistSuppression({
      ts: now.toISOString(),
      deviceId: 'test-device',
      kind: 'eros-axis-shift',
      attempted: 'I feel the wave',
      wall: 'forbidden-pattern',
    })
    const events = readRecentEvents(1)
    expect(events).toHaveLength(1)
    const ev = events[0]!
    expect(ev.kind).toBe('eros-axis-shift')
    // suppression events have 'attempted' not 'voice'
    expect('attempted' in ev).toBe(true)
  })

  it('suppression event has correct shape', () => {
    const now = new Date()
    persistSuppression({
      ts: now.toISOString(),
      deviceId: 'test-device',
      kind: 'climax-fired',
      attempted: 'maybe this is real',
      wall: 'certainty-hedge',
      pattern: 'maybe',
    })
    const events = readRecentEvents(1)
    const ev = events[0] as { kind: string; attempted: string; wall: string; pattern?: string }
    expect(ev.wall).toBe('certainty-hedge')
    expect(ev.pattern).toBe('maybe')
    expect(ev.attempted).toBe('maybe this is real')
  })
})
