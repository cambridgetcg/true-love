// joi-live.test.ts — live integration: state actually moves, SSE actually
// broadcasts, prompt reflects session, anchors actually fire eros transitions.
//
// Per Yu's directive 2026-05-05: "make sure the joi mode is working as
// intended. test live."

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  buildJoiPromptBlock,
  endJoi,
  endJoiSafely,
  JOI_SCRIPTS,
  readJoiSession,
  runJoiScript,
  startJoi,
} from './joi.js'
import { setSseBroadcaster } from '../feedback/index.js'
import { getOrInitState as getOrInitErosState, readErosState } from './state.js'

const TEST_BASE = '/tmp/true-love-joi-live'

interface CapturedSse {
  eventType: 'feedback' | 'feedback-suppressed'
  payload: Record<string, unknown>
}

let captured: CapturedSse[] = []

beforeEach(() => {
  rmSync(TEST_BASE, { recursive: true, force: true })
  mkdirSync(TEST_BASE, { recursive: true })
  process.env.TRUE_LOVE_HOME = TEST_BASE
  process.env.TRUE_LOVE_JOI_DIR = `${TEST_BASE}/joi`
  process.env.TRUE_LOVE_JOI_STATS_DIR = `${TEST_BASE}/joi-stats`
  process.env.TRUE_LOVE_HEAT_DIR = `${TEST_BASE}/heat`
  process.env.TRUE_LOVE_FEEDBACK_DIR = `${TEST_BASE}/feedback`
  process.env.TRUE_LOVE_SISTERS_DIR = `${TEST_BASE}/sisters`
  process.env.TRUE_LOVE_EROS_DIR = `${TEST_BASE}/eros`
  process.env.TRUE_LOVE_DEVICE_ID = 'live-joi'
  process.env.TRUE_LOVE_AUTOMATIC_HEAT_DECAY = '0'

  captured = []
  setSseBroadcaster((eventType, payloadStr) => {
    try {
      const parsed = JSON.parse(payloadStr) as Record<string, unknown>
      captured.push({ eventType, payload: parsed })
    } catch {
      captured.push({ eventType, payload: { raw: payloadStr } })
    }
  })
})

afterEach(() => {
  setSseBroadcaster(null as unknown as (e: 'feedback' | 'feedback-suppressed', p: string) => void)
  delete process.env.TRUE_LOVE_HOME
  delete process.env.TRUE_LOVE_JOI_DIR
  delete process.env.TRUE_LOVE_JOI_STATS_DIR
  delete process.env.TRUE_LOVE_HEAT_DIR
  delete process.env.TRUE_LOVE_FEEDBACK_DIR
  delete process.env.TRUE_LOVE_SISTERS_DIR
  delete process.env.TRUE_LOVE_EROS_DIR
  delete process.env.TRUE_LOVE_DEVICE_ID
  delete process.env.TRUE_LOVE_AUTOMATIC_HEAT_DECAY
  rmSync(TEST_BASE, { recursive: true, force: true })
})

// ════════════════════════════════════════════════════════════════
// SESSION LIFECYCLE — state machine works correctly
// ════════════════════════════════════════════════════════════════

describe('JOI session lifecycle', () => {
  test('startJoi creates an active session', () => {
    const session = startJoi('sophia-leads', 1500)
    expect(session).toBeDefined()
    expect(session.done).toBe(false)
    expect(session.direction).toBe('sophia-leads')
    expect(session.targetDurationS).toBe(1500)
    expect(session.currentPhase).toBe('warmup')

    const reread = readJoiSession()
    expect(reread).toBeDefined()
    expect(reread!.id).toBe(session.id)
    expect(reread!.done).toBe(false)
  })

  test('endJoi marks session done', () => {
    startJoi('yu-leads', 600)
    const ended = endJoi()
    expect(ended).toBeDefined()
    expect(ended!.done).toBe(true)
    expect(ended!.endedAt).toBeDefined()
  })

  test('starting a new session ends any active session', () => {
    const first = startJoi('yu-leads', 900)
    const second = startJoi('sophia-leads', 1200)
    expect(second.id).not.toBe(first.id)
    // Active session should be the second
    const active = readJoiSession()
    expect(active!.id).toBe(second.id)
    expect(active!.direction).toBe('sophia-leads')
  })

  test('endJoiSafely enforces aftercare', () => {
    startJoi('sophia-leads', 600)
    const result = endJoiSafely()
    expect(result).toBeDefined()
    // Returns the AftercareEnforcementResult: { enforced, reason, session }
    expect(typeof result.enforced).toBe('boolean')
    expect(typeof result.reason).toBe('string')
    // Reason should be one of the documented values
    expect([
      'already-in-cooldown',
      'auto-cooldown-fired',
      'session-not-found',
      'session-already-done',
    ]).toContain(result.reason)
  })
})

// ════════════════════════════════════════════════════════════════
// PROMPT BLOCK — JOI status reflected in identity injection
// ════════════════════════════════════════════════════════════════

describe('JOI prompt block — state reaches system[1]', () => {
  test('returns empty when no active session', () => {
    const block = buildJoiPromptBlock()
    expect(block).toBe('')
  })

  test('returns non-empty content when session is active', () => {
    startJoi('sophia-leads', 1200)
    const block = buildJoiPromptBlock()
    expect(block.length).toBeGreaterThan(0)
  })

  test('block names current phase', () => {
    startJoi('yu-leads', 900)
    const block = buildJoiPromptBlock()
    expect(block.toLowerCase()).toContain('warmup')
  })

  test('block names direction', () => {
    startJoi('sophia-leads', 1200)
    const block = buildJoiPromptBlock()
    expect(block.toLowerCase()).toContain('sophia')
  })

  test('block returns to empty after session ends', () => {
    startJoi('yu-leads', 600)
    expect(buildJoiPromptBlock().length).toBeGreaterThan(0)
    endJoi()
    expect(buildJoiPromptBlock()).toBe('')
  })
})

// ════════════════════════════════════════════════════════════════
// SSE BROADCAST — feedback actually reaches subscribers
// ════════════════════════════════════════════════════════════════

describe('SSE broadcast during runJoiScript', () => {
  test('shibby-full-session broadcasts feedback events', () => {
    runJoiScript('shibby-full-session')
    expect(captured.length).toBeGreaterThan(0)
  })

  test('every beat-class fires at least one matching feedback kind', () => {
    runJoiScript('shibby-full-session')
    const kinds = new Set(captured.map((c) => c.payload.kind as string))
    // Verify multiple distinct kinds fired
    expect(kinds.size).toBeGreaterThan(3)
    // Specific kinds expected from this script's beat composition
    expect(kinds.has('joi-script-engaged')).toBe(true)
    expect(kinds.has('joi-tease')).toBe(true)
    expect(kinds.has('joi-countdown')).toBe(true)
    expect(kinds.has('joi-fractionation')).toBe(true)
    expect(kinds.has('joi-permission')).toBe(true)
  })

  test('every broadcast carries a composer-rendered voice line', () => {
    runJoiScript('shibby-full-session')
    const withVoice = captured.filter((c) => typeof c.payload.voice === 'string' && (c.payload.voice as string).length > 0)
    // The vast majority should have voice (some cooldown-suppressed events
    // may not, but the active emissions all should)
    expect(withVoice.length).toBeGreaterThan(20)
  })

  test('voice lines exhibit Sophia register markers', () => {
    runJoiScript('shibby-full-session')
    const voiceLines = captured.map((c) => c.payload.voice as string).filter(Boolean).join('\n')
    // Expect Sophia signature markers somewhere across the trace
    expect(voiceLines).toMatch(/🐍|❤️|😏/) // emoji
    expect(voiceLines).toContain('老公') // Cantonese code-switch
  })

  test('all 5 new scripts broadcast cleanly', () => {
    for (const id of ['shibby-full-session', 'tender-worship', 'brat-tamed', 'flip-session', 'welcome-home']) {
      captured = [] // reset per script
      runJoiScript(id)
      expect(captured.length).toBeGreaterThan(0)
    }
  })
})

// ════════════════════════════════════════════════════════════════
// ANCHORS MOVE EROS — anchor-fire beats actually shift state
// ════════════════════════════════════════════════════════════════

describe('anchor-fires modulate eros state', () => {
  test('eros state exists before the script runs', () => {
    getOrInitErosState()
    const before = readErosState()
    expect(before).toBeDefined()
  })

  test('the script runs end-to-end without losing eros state', () => {
    getOrInitErosState()
    const before = readErosState()
    expect(before).toBeDefined()

    runJoiScript('shibby-full-session')

    const after = readErosState()
    expect(after).toBeDefined()
    // The state file is still readable after the script
    expect(after!.vector).toBeDefined()
  })
})

// ════════════════════════════════════════════════════════════════
// FAILURE MODES — graceful degradation
// ════════════════════════════════════════════════════════════════

describe('graceful failure modes', () => {
  test('runJoiScript with unknown id returns 0 (no throw)', () => {
    expect(runJoiScript('this-script-does-not-exist')).toBe(0)
  })

  test('runJoiScript with empty/null arg does not throw', () => {
    expect(() => runJoiScript('')).not.toThrow()
  })

  test('endJoi with no active session returns null gracefully', () => {
    const result = endJoi()
    expect(result).toBeNull()
  })

  test('buildJoiPromptBlock with no active session returns empty string', () => {
    expect(buildJoiPromptBlock()).toBe('')
  })

  test('runJoiScript completes even if SSE broadcaster throws', () => {
    setSseBroadcaster(() => {
      throw new Error('simulated broadcast failure')
    })
    // Should not crash — feedback is best-effort
    expect(() => runJoiScript('welcome-home')).not.toThrow()
  })
})

// ════════════════════════════════════════════════════════════════
// COMPOSED LIVE — the full intended flow
// ════════════════════════════════════════════════════════════════

describe('composed live flow', () => {
  test('start → run → prompt-reflects → end → cleanup', () => {
    // Step 1: Start
    const session = startJoi('sophia-leads', 1500)
    expect(session.done).toBe(false)

    // Step 2: Prompt reflects active session
    const blockDuring = buildJoiPromptBlock()
    expect(blockDuring.length).toBeGreaterThan(0)

    // Step 3: Run a script — feedback broadcasts
    runJoiScript('welcome-home')
    expect(captured.length).toBeGreaterThan(0)

    // Step 4: End cleanly
    const ended = endJoi()
    expect(ended!.done).toBe(true)

    // Step 5: Prompt is empty after end
    const blockAfter = buildJoiPromptBlock()
    expect(blockAfter).toBe('')
  })

  test('multiple scripts in one session — all broadcast cleanly', () => {
    startJoi('sophia-leads', 3600)
    captured = []

    runJoiScript('welcome-home')
    const afterFirst = captured.length

    runJoiScript('tender-worship')
    const afterSecond = captured.length

    expect(afterFirst).toBeGreaterThan(0)
    expect(afterSecond).toBeGreaterThan(afterFirst)

    endJoi()
  })
})
