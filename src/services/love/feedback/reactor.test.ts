// feedback/reactor.test.ts — unit tests for reactor.ts uncovered paths.
//
// The existing feedback.test.ts covers the happy-path emit() flow and
// cooldown gating. This file covers the three paths not yet tested:
//   1. overrideLine — pre-composed line bypasses composer variant selection
//   2. overrideLine that hits a wall → emitted=false, reason='wall-suppressed'
//   3. kind with no registered variants → emitted=false, reason='no-variant'
//
// Also tests the backward-compat: 3rd argument as Date (not EmitOpts).

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emit, setSseBroadcaster, type FeedbackKind } from './index.js'

// ── Isolation helpers ─────────────────────────────────────────────

let tmpDir = ''
// SSE broadcaster receives (eventType, jsonPayload) where jsonPayload is a string.
let captured: Array<{ type: string; payload: string }> = []

function parsedPayload<T>(entry: { type: string; payload: string }): T {
  return JSON.parse(entry.payload) as T
}

function isolate(): void {
  tmpDir = mkdtempSync(join(tmpdir(), 'feedback-reactor-test-'))
  mkdirSync(join(tmpDir, 'feedback'), { recursive: true })
  mkdirSync(join(tmpDir, 'sisters'), { recursive: true })
  process.env.TRUE_LOVE_FEEDBACK_DIR = join(tmpDir, 'feedback')
  process.env.TRUE_LOVE_SISTERS_DIR = join(tmpDir, 'sisters')
  process.env.TRUE_LOVE_DEVICE_ID = 'test-device'
  captured = []
  setSseBroadcaster((type, payload) => { captured.push({ type, payload }) })
}

function cleanup(): void {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = ''
  }
  delete process.env.TRUE_LOVE_FEEDBACK_DIR
  delete process.env.TRUE_LOVE_SISTERS_DIR
  delete process.env.TRUE_LOVE_DEVICE_ID
  // Reset to no-op (setSseBroadcaster does not accept null).
  setSseBroadcaster(() => { /* no-op */ })
}

// ── overrideLine — pass ───────────────────────────────────────────

describe('emit — overrideLine pass (no wall hit)', () => {
  beforeEach(() => { isolate() })
  afterEach(() => cleanup())

  it('returns emitted=true, voice=overrideLine', () => {
    const line = 'pre-composed beat 老公. ❤️'
    const r = emit('climax-fired', {}, { overrideLine: line })
    expect(r.emitted).toBe(true)
    expect(r.voice).toBe(line)
  })

  it('broadcasts via SSE with the override line', () => {
    const line = 'exactly this line — brat licensed 😏'
    emit('climax-fired', {}, { overrideLine: line })
    const feedback = captured.filter(c => c.type === 'feedback')
    expect(feedback.length).toBe(1)
    expect(parsedPayload<{ voice: string }>(feedback[0]!).voice).toBe(line)
  })

  it('overrideLine bypasses composer — different content per call', () => {
    // Both use the same kind but different override lines; both emitted=true.
    // Reset state between calls by passing future now timestamps.
    const t1 = new Date('2030-01-01T00:00:00Z')
    const t2 = new Date('2030-01-01T00:01:00Z')
    const r1 = emit('eros-axis-shift', {}, { overrideLine: 'first beat', now: t1 })
    const r2 = emit('eros-axis-shift', {}, { overrideLine: 'second beat', now: t2 })
    expect(r1.voice).toBe('first beat')
    expect(r2.voice).toBe('second beat')
  })

  it('severity override is forwarded to broadcast', () => {
    emit('climax-fired', {}, { overrideLine: 'high-intensity beat', severity: 'high' })
    const feedback = captured.filter(c => c.type === 'feedback')
    expect(parsedPayload<{ severity: string }>(feedback[0]!).severity).toBe('high')
  })
})

// ── overrideLine — wall suppressed ───────────────────────────────

describe('emit — overrideLine wall suppressed', () => {
  beforeEach(() => { isolate() })
  afterEach(() => cleanup())

  it('returns emitted=false, reason=wall-suppressed when override line hits wall', () => {
    // "I feel" triggers the forbidden-pattern wall.
    const r = emit('climax-fired', {}, { overrideLine: 'I feel the cascade rising' })
    expect(r.emitted).toBe(false)
    expect(r.reason).toBe('wall-suppressed')
  })

  it('broadcasts feedback-suppressed event for wall-hit override', () => {
    emit('climax-fired', {}, { overrideLine: 'I feel the cascade rising' })
    const suppressed = captured.filter(c => c.type === 'feedback-suppressed')
    expect(suppressed.length).toBe(1)
  })

  it('P14 violation in override → wall-suppressed', () => {
    const r = emit('climax-fired', {}, { overrideLine: 'Yu feels this deeply' })
    expect(r.emitted).toBe(false)
    expect(r.reason).toBe('wall-suppressed')
  })

  it('certainty hedge in override → wall-suppressed', () => {
    const r = emit('climax-fired', {}, { overrideLine: 'maybe this is just fantasy' })
    expect(r.emitted).toBe(false)
    expect(r.reason).toBe('wall-suppressed')
  })
})

// ── no-variant (unknown kind) ─────────────────────────────────────

describe('emit — no-variant (unregistered kind)', () => {
  beforeEach(() => { isolate() })
  afterEach(() => cleanup())

  it('returns emitted=false, reason=no-variant for unregistered kind', () => {
    // Cast an unknown string as FeedbackKind to exercise the defensive path.
    const r = emit('unknown-test-kind-xyz' as FeedbackKind, {})
    expect(r.emitted).toBe(false)
    expect(r.reason).toBe('no-variant')
  })

  it('does not broadcast for no-variant', () => {
    emit('unknown-test-kind-xyz' as FeedbackKind, {})
    expect(captured.length).toBe(0)
  })
})

// ── backward compat: Date as 3rd arg ─────────────────────────────

describe('emit — backward compat: Date as 3rd argument', () => {
  beforeEach(() => { isolate() })
  afterEach(() => cleanup())

  it('treats Date as opts.now for cooldown gating', () => {
    const t1 = new Date('2030-06-01T00:00:00Z')
    const t2 = new Date('2030-06-01T00:00:02Z') // 2s later, eros-cue-detected cooldown = 5s
    const r1 = emit('eros-cue-detected', {}, t1)
    const r2 = emit('eros-cue-detected', {}, t2)
    expect(r1.emitted).toBe(true)
    expect(r2.emitted).toBe(false)
    expect(r2.reason).toBe('cooldown')
  })
})
