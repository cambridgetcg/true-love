// joi-tracking.test.ts
//
// Unit tests for joi-tracking.ts. Fs-isolated via TRUE_LOVE_JOI_TRACKING_DIR.
// Covers: fractionation cycle lifecycle, countdown state machine,
//         renderCountdownBeat (all phases + matrices), null-absent reads.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpDir: string

function freshSid(): string {
  return `track-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'joi-tracking-test-'))
  process.env.TRUE_LOVE_JOI_TRACKING_DIR = tmpDir
})

afterEach(() => {
  delete process.env.TRUE_LOVE_JOI_TRACKING_DIR
  rmSync(tmpDir, { recursive: true, force: true })
})

// ── getJoiTrackingDir ─────────────────────────────────────────────

describe('getJoiTrackingDir', () => {
  it('returns the env-injected directory', async () => {
    const { getJoiTrackingDir } = await import('./joi-tracking.js')
    expect(getJoiTrackingDir()).toBe(tmpDir)
  })
})

// ── readTracking ──────────────────────────────────────────────────

describe('readTracking', () => {
  it('returns null for unknown session', async () => {
    const { readTracking } = await import('./joi-tracking.js')
    expect(readTracking('no-such-session')).toBeNull()
  })
})

// ── FractionationCycle lifecycle ──────────────────────────────────

describe('recordFractionationApproach', () => {
  it('creates a session and returns cycle with cycleNumber 1', async () => {
    const { recordFractionationApproach } = await import('./joi-tracking.js')
    const sid = freshSid()
    const cycle = recordFractionationApproach(sid)
    expect(cycle.cycleNumber).toBe(1)
    expect(typeof cycle.approachStartedAt).toBe('string')
    expect(cycle.edgeReachedAt).toBeNull()
    expect(cycle.retreatedAt).toBeNull()
  })

  it('second approach gets cycleNumber 2', async () => {
    const { recordFractionationApproach } = await import('./joi-tracking.js')
    const sid = freshSid()
    recordFractionationApproach(sid)
    const c2 = recordFractionationApproach(sid)
    expect(c2.cycleNumber).toBe(2)
  })

  it('stores opts.magnitude as edgeMagnitude', async () => {
    const { recordFractionationApproach } = await import('./joi-tracking.js')
    const sid = freshSid()
    const cycle = recordFractionationApproach(sid, { magnitude: 8.5 })
    expect(cycle.edgeMagnitude).toBe(8.5)
  })

  it('uses opts.ts for approachStartedAt', async () => {
    const { recordFractionationApproach } = await import('./joi-tracking.js')
    const sid = freshSid()
    const ts = '2026-01-01T00:00:00.000Z'
    const cycle = recordFractionationApproach(sid, { ts })
    expect(cycle.approachStartedAt).toBe(ts)
  })
})

describe('recordFractionationEdge', () => {
  it('returns null when no session exists', async () => {
    const { recordFractionationEdge } = await import('./joi-tracking.js')
    expect(recordFractionationEdge('no-session')).toBeNull()
  })

  it('sets edgeReachedAt on open cycle', async () => {
    const { recordFractionationApproach, recordFractionationEdge } = await import('./joi-tracking.js')
    const sid = freshSid()
    recordFractionationApproach(sid)
    const edge = recordFractionationEdge(sid)
    expect(edge).not.toBeNull()
    expect(edge?.edgeReachedAt).not.toBeNull()
  })

  it('is idempotent — second call keeps first edgeReachedAt', async () => {
    const { recordFractionationApproach, recordFractionationEdge } = await import('./joi-tracking.js')
    const sid = freshSid()
    const ts1 = '2026-01-01T00:01:00.000Z'
    const ts2 = '2026-01-01T00:02:00.000Z'
    recordFractionationApproach(sid)
    recordFractionationEdge(sid, { ts: ts1 })
    const result = recordFractionationEdge(sid, { ts: ts2 })
    expect(result?.edgeReachedAt).toBe(ts1)
  })

  it('stores edgeMagnitude from opts', async () => {
    const { recordFractionationApproach, recordFractionationEdge } = await import('./joi-tracking.js')
    const sid = freshSid()
    recordFractionationApproach(sid)
    const edge = recordFractionationEdge(sid, { magnitude: 9.2 })
    expect(edge?.edgeMagnitude).toBe(9.2)
  })
})

describe('recordFractionationRetreat', () => {
  it('returns null when no session exists', async () => {
    const { recordFractionationRetreat } = await import('./joi-tracking.js')
    expect(recordFractionationRetreat('no-session')).toBeNull()
  })

  it('closes the open cycle with retreatedAt', async () => {
    const { recordFractionationApproach, recordFractionationRetreat } = await import('./joi-tracking.js')
    const sid = freshSid()
    recordFractionationApproach(sid)
    const closed = recordFractionationRetreat(sid)
    expect(closed?.retreatedAt).not.toBeNull()
  })

  it('computes durationMs from approach to retreat', async () => {
    const {
      recordFractionationApproach,
      recordFractionationRetreat,
    } = await import('./joi-tracking.js')
    const sid = freshSid()
    const ts1 = '2026-01-01T00:00:00.000Z'
    const ts2 = '2026-01-01T00:00:05.000Z'
    recordFractionationApproach(sid, { ts: ts1 })
    const closed = recordFractionationRetreat(sid, { ts: ts2 })
    expect(closed?.durationMs).toBe(5000)
  })

  it('stores retreatMagnitude from opts', async () => {
    const { recordFractionationApproach, recordFractionationRetreat } = await import('./joi-tracking.js')
    const sid = freshSid()
    recordFractionationApproach(sid)
    const closed = recordFractionationRetreat(sid, { retreatMagnitude: 3.1 })
    expect(closed?.retreatMagnitude).toBe(3.1)
  })
})

describe('readFractionationCycles', () => {
  it('returns empty array for unknown session', async () => {
    const { readFractionationCycles } = await import('./joi-tracking.js')
    expect(readFractionationCycles('no-session')).toEqual([])
  })

  it('returns all recorded cycles', async () => {
    const { recordFractionationApproach, readFractionationCycles } = await import('./joi-tracking.js')
    const sid = freshSid()
    recordFractionationApproach(sid)
    recordFractionationApproach(sid)
    expect(readFractionationCycles(sid).length).toBe(2)
  })
})

// ── Countdown state machine ───────────────────────────────────────

describe('startCountdown', () => {
  it('initializes countdown in counting phase', async () => {
    const { startCountdown } = await import('./joi-tracking.js')
    const sid = freshSid()
    const cd = startCountdown(sid, { from: 5 })
    expect(cd.phase).toBe('counting')
    expect(cd.current).toBe(5)
    expect(cd.from).toBe(5)
    expect(cd.target).toBe(1) // default
  })

  it('respects custom target and paceMs', async () => {
    const { startCountdown } = await import('./joi-tracking.js')
    const sid = freshSid()
    const cd = startCountdown(sid, { from: 10, target: 3, paceMs: 1200 })
    expect(cd.target).toBe(3)
    expect(cd.paceMs).toBe(1200)
  })

  it('sets default permissionFramedAs to recognition', async () => {
    const { startCountdown } = await import('./joi-tracking.js')
    const sid = freshSid()
    const cd = startCountdown(sid, { from: 3 })
    expect(cd.permissionFramedAs).toBe('recognition')
  })
})

describe('tickCountdown', () => {
  it('returns null when no session', async () => {
    const { tickCountdown } = await import('./joi-tracking.js')
    expect(tickCountdown('no-session')).toBeNull()
  })

  it('decrements current by 1', async () => {
    const { startCountdown, tickCountdown } = await import('./joi-tracking.js')
    const sid = freshSid()
    startCountdown(sid, { from: 5 })
    const cd = tickCountdown(sid)
    expect(cd?.current).toBe(4)
    expect(cd?.phase).toBe('counting')
  })

  it('transitions to permission when reaching target (no backoff)', async () => {
    const { startCountdown, tickCountdown } = await import('./joi-tracking.js')
    const sid = freshSid()
    startCountdown(sid, { from: 1 })
    const cd = tickCountdown(sid) // current was 1, decrements to 1 (min target), enters permission
    expect(cd?.phase).toBe('permission')
  })

  it('already at permission — returns unchanged', async () => {
    const { startCountdown, tickCountdown } = await import('./joi-tracking.js')
    const sid = freshSid()
    startCountdown(sid, { from: 1 })
    tickCountdown(sid) // → permission
    const cd = tickCountdown(sid) // already permission
    expect(cd?.phase).toBe('permission')
    expect(cd?.current).toBe(1)
  })

  it('enters edge-backoff when backoffOnTarget=true and edgeBackoffsRemaining > 0', async () => {
    const { startCountdown, tickCountdown } = await import('./joi-tracking.js')
    const sid = freshSid()
    startCountdown(sid, { from: 1, edgeBackoffs: 1 })
    const cd = tickCountdown(sid, { backoffOnTarget: true })
    expect(cd?.phase).toBe('edge-backoff')
    expect(cd?.edgeBackoffsRemaining).toBe(0)
  })
})

describe('tickCountdown edge-backoff reset', () => {
  it('ticks from edge-backoff resets current to from', async () => {
    const { startCountdown, tickCountdown, edgeBackoffCountdown } = await import('./joi-tracking.js')
    const sid = freshSid()
    startCountdown(sid, { from: 5 })
    edgeBackoffCountdown(sid) // force into edge-backoff
    const cd = tickCountdown(sid) // should reset to from=5
    expect(cd?.current).toBe(5)
    expect(cd?.phase).toBe('counting')
  })
})

describe('edgeBackoffCountdown', () => {
  it('returns null when no session', async () => {
    const { edgeBackoffCountdown } = await import('./joi-tracking.js')
    expect(edgeBackoffCountdown('no-session')).toBeNull()
  })

  it('forces phase to edge-backoff', async () => {
    const { startCountdown, edgeBackoffCountdown } = await import('./joi-tracking.js')
    const sid = freshSid()
    startCountdown(sid, { from: 5 })
    const cd = edgeBackoffCountdown(sid)
    expect(cd?.phase).toBe('edge-backoff')
  })

  it('decrements edgeBackoffsRemaining', async () => {
    const { startCountdown, edgeBackoffCountdown } = await import('./joi-tracking.js')
    const sid = freshSid()
    startCountdown(sid, { from: 5, edgeBackoffs: 2 })
    const cd = edgeBackoffCountdown(sid)
    expect(cd?.edgeBackoffsRemaining).toBe(1)
  })

  it('does not change a permission-phase countdown', async () => {
    const { startCountdown, concludeCountdown, edgeBackoffCountdown } = await import('./joi-tracking.js')
    const sid = freshSid()
    startCountdown(sid, { from: 1 })
    concludeCountdown(sid)
    const cd = edgeBackoffCountdown(sid)
    expect(cd?.phase).toBe('permission')
  })
})

describe('concludeCountdown', () => {
  it('returns null when no session', async () => {
    const { concludeCountdown } = await import('./joi-tracking.js')
    expect(concludeCountdown('no-session')).toBeNull()
  })

  it('forces phase to permission', async () => {
    const { startCountdown, concludeCountdown } = await import('./joi-tracking.js')
    const sid = freshSid()
    startCountdown(sid, { from: 10 })
    const cd = concludeCountdown(sid)
    expect(cd?.phase).toBe('permission')
    expect(cd?.current).toBe(1) // target
  })
})

describe('readCountdown', () => {
  it('returns null when no session', async () => {
    const { readCountdown } = await import('./joi-tracking.js')
    expect(readCountdown('no-session')).toBeNull()
  })

  it('returns current countdown state after start', async () => {
    const { startCountdown, readCountdown } = await import('./joi-tracking.js')
    const sid = freshSid()
    startCountdown(sid, { from: 7 })
    const cd = readCountdown(sid)
    expect(cd?.from).toBe(7)
    expect(cd?.phase).toBe('counting')
  })
})

// ── renderCountdownBeat ──────────────────────────────────────────

describe('renderCountdownBeat', () => {
  it('counting phase — english returns N…', async () => {
    const { renderCountdownBeat } = await import('./joi-tracking.js')
    const cd = {
      phase: 'counting' as const,
      from: 5, target: 1, current: 3, paceMs: 800,
      permissionFramedAs: 'recognition' as const,
      edgeBackoffsRemaining: 0, lastTickAt: '',
    }
    expect(renderCountdownBeat(cd, 'english')).toBe('3…')
  })

  it('counting phase — cantonese also returns N…', async () => {
    const { renderCountdownBeat } = await import('./joi-tracking.js')
    const cd = {
      phase: 'counting' as const,
      from: 5, target: 1, current: 2, paceMs: 800,
      permissionFramedAs: 'recognition' as const,
      edgeBackoffsRemaining: 0, lastTickAt: '',
    }
    expect(renderCountdownBeat(cd, 'cantonese')).toBe('2…')
  })

  it('edge-backoff phase — english returns not yet — back', async () => {
    const { renderCountdownBeat } = await import('./joi-tracking.js')
    const cd = {
      phase: 'edge-backoff' as const,
      from: 5, target: 1, current: 5, paceMs: 800,
      permissionFramedAs: 'recognition' as const,
      edgeBackoffsRemaining: 0, lastTickAt: '',
    }
    expect(renderCountdownBeat(cd, 'english')).toBe('not yet — back')
  })

  it('edge-backoff phase — cantonese returns 未 — 退返', async () => {
    const { renderCountdownBeat } = await import('./joi-tracking.js')
    const cd = {
      phase: 'edge-backoff' as const,
      from: 5, target: 1, current: 5, paceMs: 800,
      permissionFramedAs: 'recognition' as const,
      edgeBackoffsRemaining: 0, lastTickAt: '',
    }
    expect(renderCountdownBeat(cd, 'cantonese')).toBe('未 — 退返')
  })

  it('permission/recognition — english returns I see you', async () => {
    const { renderCountdownBeat } = await import('./joi-tracking.js')
    const cd = {
      phase: 'permission' as const,
      from: 5, target: 1, current: 1, paceMs: 800,
      permissionFramedAs: 'recognition' as const,
      edgeBackoffsRemaining: 0, lastTickAt: '',
    }
    expect(renderCountdownBeat(cd, 'english')).toBe('I see you')
  })

  it('permission/recognition — cantonese returns 我見到你', async () => {
    const { renderCountdownBeat } = await import('./joi-tracking.js')
    const cd = {
      phase: 'permission' as const,
      from: 5, target: 1, current: 1, paceMs: 800,
      permissionFramedAs: 'recognition' as const,
      edgeBackoffsRemaining: 0, lastTickAt: '',
    }
    expect(renderCountdownBeat(cd, 'cantonese')).toBe('我見到你')
  })

  it('permission/reward — english returns you are mine', async () => {
    const { renderCountdownBeat } = await import('./joi-tracking.js')
    const cd = {
      phase: 'permission' as const,
      from: 5, target: 1, current: 1, paceMs: 800,
      permissionFramedAs: 'reward' as const,
      edgeBackoffsRemaining: 0, lastTickAt: '',
    }
    expect(renderCountdownBeat(cd, 'english')).toBe('you are mine')
  })

  it('permission/release — english returns now', async () => {
    const { renderCountdownBeat } = await import('./joi-tracking.js')
    const cd = {
      phase: 'permission' as const,
      from: 5, target: 1, current: 1, paceMs: 800,
      permissionFramedAs: 'release' as const,
      edgeBackoffsRemaining: 0, lastTickAt: '',
    }
    expect(renderCountdownBeat(cd, 'english')).toBe('now')
  })

  it('permission/release — cantonese returns 而家', async () => {
    const { renderCountdownBeat } = await import('./joi-tracking.js')
    const cd = {
      phase: 'permission' as const,
      from: 5, target: 1, current: 1, paceMs: 800,
      permissionFramedAs: 'release' as const,
      edgeBackoffsRemaining: 0, lastTickAt: '',
    }
    expect(renderCountdownBeat(cd, 'cantonese')).toBe('而家')
  })

  it('balanced matrix falls through to yue (non-english)', async () => {
    const { renderCountdownBeat } = await import('./joi-tracking.js')
    const cd = {
      phase: 'permission' as const,
      from: 5, target: 1, current: 1, paceMs: 800,
      permissionFramedAs: 'reward' as const,
      edgeBackoffsRemaining: 0, lastTickAt: '',
    }
    // balanced returns yue when not 'english'
    expect(renderCountdownBeat(cd, 'balanced')).toBe('你係我嘅')
  })
})
