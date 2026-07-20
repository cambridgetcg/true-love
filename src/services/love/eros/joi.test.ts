// joi.test.ts — JOI 5-phase session tests.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  JOI_PHASE_CONFIGS,
  JOI_PHASE_ORDER,
  phaseAtPosition,
  phaseConfigFor,
  computePosition,
  readJoiSession,
  startJoi,
  advanceJoi,
  endJoi,
  getCurrentJoiPhase,
  readRecentJoiSessions,
  buildJoiPromptBlock,
  getJoiDir,
} from './joi.js'

const TEST_BASE = '/tmp/true-love-joi-test'

describe('joi', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_JOI_DIR = `${TEST_BASE}/joi`
    process.env.TRUE_LOVE_JOI_STATS_DIR = `${TEST_BASE}/joi-stats`
    process.env.TRUE_LOVE_HEAT_DIR = `${TEST_BASE}/heat`
    process.env.TRUE_LOVE_DEVICE_ID = 'test-joi'
    process.env.TRUE_LOVE_SISTERS_DIR = `${TEST_BASE}/sisters`
    process.env.TRUE_LOVE_CERTAINTY_DIR = `${TEST_BASE}/certainty`
    process.env.TRUE_LOVE_FEEDBACK_DIR = `${TEST_BASE}/feedback`
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_JOI_DIR
    delete process.env.TRUE_LOVE_JOI_STATS_DIR
    delete process.env.TRUE_LOVE_HEAT_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    delete process.env.TRUE_LOVE_SISTERS_DIR
    delete process.env.TRUE_LOVE_CERTAINTY_DIR
    delete process.env.TRUE_LOVE_FEEDBACK_DIR
    rmSync(TEST_BASE, { recursive: true, force: true })
  })

  describe('catalog', () => {
    test('5 phases in correct order', () => {
      expect(JOI_PHASE_ORDER).toEqual(['warmup', 'build', 'edge', 'peak', 'cooldown'])
    })

    test('every phase has all required config fields', () => {
      for (const p of JOI_PHASE_ORDER) {
        const cfg = JOI_PHASE_CONFIGS[p]
        expect(cfg.phase).toBe(p)
        expect(cfg.preferredScene).toBeDefined()
        expect(cfg.preferredMode).toBeDefined()
        expect(cfg.primaryZones.length).toBeGreaterThan(0)
        expect(cfg.promptFrame.en.length).toBeGreaterThan(0)
        expect(cfg.promptFrame.yue.length).toBeGreaterThan(0)
      }
    })

    test('phases cover position [0, 1] with no gaps', () => {
      // Each phase range should be contiguous
      for (let i = 0; i < JOI_PHASE_ORDER.length - 1; i++) {
        const cfg = JOI_PHASE_CONFIGS[JOI_PHASE_ORDER[i]!]
        const next = JOI_PHASE_CONFIGS[JOI_PHASE_ORDER[i + 1]!]
        expect(cfg.rangeEnd).toBeCloseTo(next.rangeStart, 5)
      }
    })
  })

  describe('phaseAtPosition', () => {
    test('0.0 → warmup', () => expect(phaseAtPosition(0.0)).toBe('warmup'))
    test('0.1 → warmup', () => expect(phaseAtPosition(0.1)).toBe('warmup'))
    test('0.3 → build', () => expect(phaseAtPosition(0.3)).toBe('build'))
    test('0.6 → edge', () => expect(phaseAtPosition(0.6)).toBe('edge'))
    test('0.9 → peak', () => expect(phaseAtPosition(0.9)).toBe('peak'))
    test('0.99 → cooldown', () => expect(phaseAtPosition(0.99)).toBe('cooldown'))
    test('1.0 → cooldown', () => expect(phaseAtPosition(1.0)).toBe('cooldown'))
  })

  describe('startJoi', () => {
    test('persists session', () => {
      const session = startJoi('yu-leads', 600)
      expect(session.direction).toBe('yu-leads')
      expect(session.targetDurationS).toBe(600)
      expect(session.currentPhase).toBe('warmup')
      expect(session.done).toBe(false)
    })

    test('fires joi-started heat', async () => {
      startJoi('yu-leads')
      const { readRecentEvents } = await import('../heat.js')
      const events = readRecentEvents(1).filter((e) => e.kind === 'joi-started')
      expect(events.length).toBe(1)
    })

    test('starting new session ends prior', () => {
      startJoi('yu-leads', 1800)
      startJoi('sophia-leads', 600)
      const session = readJoiSession()!
      expect(session.direction).toBe('sophia-leads')
    })
  })

  describe('advanceJoi', () => {
    test('updates position based on elapsed', () => {
      const session = startJoi('yu-leads', 100)
      const future = new Date(Date.parse(session.startedAt) + 30_000) // 30s in
      const updated = advanceJoi(future)!
      expect(updated.position).toBeCloseTo(0.3, 1)
      expect(updated.currentPhase).toBe('build')
    })

    test('records phase transitions in history', () => {
      const session = startJoi('yu-leads', 100)
      // Advance to edge (50% = 50s)
      const future = new Date(Date.parse(session.startedAt) + 60_000)
      const updated = advanceJoi(future)!
      expect(updated.currentPhase).toBe('edge')
      expect(updated.phaseHistory.length).toBeGreaterThan(1)
    })

    test('completes when position reaches 1.0', () => {
      const session = startJoi('yu-leads', 60)
      const future = new Date(Date.parse(session.startedAt) + 70_000) // past end
      const updated = advanceJoi(future)!
      expect(updated.done).toBe(true)
      expect(updated.position).toBe(1.0)
    })

    test('phase-entered heat fires on transitions', async () => {
      const session = startJoi('yu-leads', 100)
      advanceJoi(new Date(Date.parse(session.startedAt) + 30_000)) // build
      const { readRecentEvents } = await import('../heat.js')
      const events = readRecentEvents(1).filter((e) => e.kind === 'joi-phase-entered')
      expect(events.length).toBeGreaterThan(0)
    })
  })

  describe('endJoi', () => {
    test('marks session done', () => {
      startJoi('yu-leads')
      const ended = endJoi()!
      expect(ended.done).toBe(true)
      expect(ended.endedAt).toBeDefined()
    })
  })

  describe('getCurrentJoiPhase', () => {
    test('returns null when no active session', () => {
      expect(getCurrentJoiPhase()).toBeNull()
    })

    test('returns current phase mid-session', () => {
      const session = startJoi('yu-leads', 100)
      const future = new Date(Date.parse(session.startedAt) + 25_000)
      expect(getCurrentJoiPhase(future)).toBe('build')
    })

    test('returns null after completion', () => {
      startJoi('yu-leads', 60)
      endJoi()
      expect(getCurrentJoiPhase()).toBeNull()
    })
  })

  describe('buildJoiPromptBlock', () => {
    test('returns empty when no active session', () => {
      expect(buildJoiPromptBlock()).toBe('')
    })

    test('returns content when session active', () => {
      startJoi('yu-leads', 600)
      const block = buildJoiPromptBlock()
      expect(block).toContain('Active JOI session')
      expect(block).toContain('warmup')
      expect(block).toContain('Direction: yu-leads')
    })
  })

  describe('paths', () => {
    test('respects env override', () => {
      expect(getJoiDir()).toBe(`${TEST_BASE}/joi`)
    })
  })
})
