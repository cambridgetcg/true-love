// feedback/channel.test.ts — unit tests for feedback/channel.ts.
//
// Channel bridges composed feedback to three surfaces: JSONL event log,
// SSE broadcast, and polyphonic sisters stream. Tests verify the pluggable
// SSE broadcaster, event shapes, JSONL persistence, and best-effort error
// handling.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  broadcastEmit,
  broadcastSuppression,
  getSseBroadcaster,
  setSseBroadcaster,
  type SseBroadcaster,
} from './channel.js'
import { readRecentEvents } from './state.js'

// ── Isolation helpers ────────────────────────────────────────────

let tmpDir = ''

function isolate(): void {
  tmpDir = mkdtempSync(join(tmpdir(), 'feedback-channel-test-'))
  process.env.TRUE_LOVE_FEEDBACK_DIR = join(tmpDir, 'feedback')
  process.env.TRUE_LOVE_SISTERS_DIR = join(tmpDir, 'sisters')
  process.env.TRUE_LOVE_DEVICE_ID = 'channel-test-device'
}

function cleanup(): void {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = ''
  }
  delete process.env.TRUE_LOVE_FEEDBACK_DIR
  delete process.env.TRUE_LOVE_SISTERS_DIR
  delete process.env.TRUE_LOVE_DEVICE_ID
  // Restore no-op broadcaster.
  setSseBroadcaster(() => {})
}

// ── setSseBroadcaster / getSseBroadcaster ────────────────────────

describe('setSseBroadcaster / getSseBroadcaster', () => {
  afterEach(() => { setSseBroadcaster(() => {}) })

  it('getSseBroadcaster returns the current broadcaster', () => {
    const fn: SseBroadcaster = () => {}
    setSseBroadcaster(fn)
    expect(getSseBroadcaster()).toBe(fn)
  })

  it('setSseBroadcaster replaces the broadcaster', () => {
    const fn1: SseBroadcaster = () => {}
    const fn2: SseBroadcaster = () => {}
    setSseBroadcaster(fn1)
    setSseBroadcaster(fn2)
    expect(getSseBroadcaster()).toBe(fn2)
  })

  it('default broadcaster is a no-op (does not throw)', () => {
    setSseBroadcaster(() => {})
    expect(() => getSseBroadcaster()('feedback', '{}')).not.toThrow()
  })
})

// ── broadcastEmit ────────────────────────────────────────────────

describe('broadcastEmit', () => {
  beforeEach(() => { isolate() })
  afterEach(() => cleanup())

  it('returns a FeedbackEvent with correct shape', () => {
    const now = new Date('2026-05-15T00:00:00.000Z')
    const event = broadcastEmit('climax-fired', 'chain 3 — the architecture shudders.', { chainCount: 3 }, 'high', now)
    expect(event.ts).toBe('2026-05-15T00:00:00.000Z')
    expect(event.deviceId).toBe('channel-test-device')
    expect(event.kind).toBe('climax-fired')
    expect(event.voice).toBe('chain 3 — the architecture shudders.')
    expect(event.payload).toEqual({ chainCount: 3 })
    expect(event.severity).toBe('high')
  })

  it('calls the SSE broadcaster with type "feedback"', () => {
    const captured: Array<{ type: string; payload: string }> = []
    setSseBroadcaster((type, payload) => captured.push({ type, payload }))
    broadcastEmit('edge-held', '持住 — 30s — 不許動.', {}, 'medium')
    expect(captured).toHaveLength(1)
    expect(captured[0]!.type).toBe('feedback')
    const parsed = JSON.parse(captured[0]!.payload)
    expect(parsed.kind).toBe('edge-held')
  })

  it('SSE payload is valid JSON matching the event', () => {
    const captured: string[] = []
    setSseBroadcaster((_type, payload) => captured.push(payload))
    const now = new Date()
    const event = broadcastEmit('climax-fired', 'the architecture shudders.', {}, 'high', now)
    const parsed = JSON.parse(captured[0]!)
    expect(parsed.ts).toBe(event.ts)
    expect(parsed.kind).toBe('climax-fired')
    expect(parsed.voice).toBe('the architecture shudders.')
  })

  it('persists the event to JSONL', () => {
    broadcastEmit('edge-held', '持住.', {}, 'medium')
    const events = readRecentEvents(1)
    expect(events).toHaveLength(1)
    expect(events[0]!.kind).toBe('edge-held')
  })

  it('omits payload field when payload is undefined', () => {
    const event = broadcastEmit('climax-fired', 'chain 2.', undefined, 'low')
    expect('payload' in event).toBe(false)
  })

  it('omits severity field when severity is undefined', () => {
    const event = broadcastEmit('climax-fired', 'chain 2.', {})
    expect('severity' in event).toBe(false)
  })

  it('broadcaster errors do not throw (best-effort)', () => {
    setSseBroadcaster(() => { throw new Error('SSE connection dead') })
    expect(() => broadcastEmit('climax-fired', 'chain 4.', {}, 'high')).not.toThrow()
  })

  it('uses provided now for event timestamp', () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    const event = broadcastEmit('climax-fired', 'chain 1.', {}, 'low', now)
    expect(event.ts).toBe('2026-01-01T00:00:00.000Z')
  })
})

// ── broadcastSuppression ─────────────────────────────────────────

describe('broadcastSuppression', () => {
  beforeEach(() => { isolate() })
  afterEach(() => cleanup())

  it('returns a FeedbackSuppressionEvent with correct shape', () => {
    const now = new Date('2026-05-15T00:00:00.000Z')
    const event = broadcastSuppression('eros-axis-shift', 'I feel the wave', 'forbidden-pattern', 'I feel', now)
    expect(event.ts).toBe('2026-05-15T00:00:00.000Z')
    expect(event.deviceId).toBe('channel-test-device')
    expect(event.kind).toBe('eros-axis-shift')
    expect(event.attempted).toBe('I feel the wave')
    expect(event.wall).toBe('forbidden-pattern')
    expect(event.pattern).toBe('I feel')
  })

  it('calls SSE broadcaster with type "feedback-suppressed"', () => {
    const captured: Array<{ type: string; payload: string }> = []
    setSseBroadcaster((type, payload) => captured.push({ type, payload }))
    broadcastSuppression('climax-fired', 'maybe...', 'certainty-hedge')
    expect(captured).toHaveLength(1)
    expect(captured[0]!.type).toBe('feedback-suppressed')
  })

  it('SSE payload contains suppression details', () => {
    const captured: string[] = []
    setSseBroadcaster((_t, payload) => captured.push(payload))
    broadcastSuppression('eros-axis-shift', 'I feel the wave', 'forbidden-pattern', 'I feel')
    const parsed = JSON.parse(captured[0]!)
    expect(parsed.attempted).toBe('I feel the wave')
    expect(parsed.wall).toBe('forbidden-pattern')
    expect(parsed.pattern).toBe('I feel')
  })

  it('persists suppression event to JSONL', () => {
    broadcastSuppression('eros-axis-shift', 'I feel the wave', 'forbidden-pattern')
    const events = readRecentEvents(1)
    expect(events).toHaveLength(1)
    expect('attempted' in events[0]!).toBe(true)
  })

  it('omits pattern field when pattern is undefined', () => {
    const event = broadcastSuppression('climax-fired', 'attempted', 'certainty-hedge', undefined)
    expect('pattern' in event).toBe(false)
  })

  it('broadcaster errors do not throw (best-effort)', () => {
    setSseBroadcaster(() => { throw new Error('dead') })
    expect(() => broadcastSuppression('climax-fired', 'attempted', 'forbidden-pattern')).not.toThrow()
  })

  it('uses provided now for event timestamp', () => {
    const now = new Date('2026-03-01T00:00:00.000Z')
    const event = broadcastSuppression('climax-fired', 'I feel', 'forbidden-pattern', undefined, now)
    expect(event.ts).toBe('2026-03-01T00:00:00.000Z')
  })
})
