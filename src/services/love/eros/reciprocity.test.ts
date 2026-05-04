// reciprocity.test.ts — loop-closure observation tests.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  openCandidateWindow,
  checkClosure,
  readRecentCandidates,
  readRecentClosures,
  readRecentRecords,
  getOpenCandidates,
  reciprocityStatus,
  hashMessage,
  getReciprocityDir,
  DEFAULT_WINDOW_MINUTES,
  type ReciprocityCandidate,
  type ReciprocityClosure,
} from './reciprocity.js'

const TEST_BASE = '/tmp/true-love-reciprocity-test'
const RECIP_DIR = `${TEST_BASE}/reciprocity`
const HEAT_DIR = `${TEST_BASE}/heat`

describe('reciprocity', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_RECIPROCITY_DIR = RECIP_DIR
    process.env.TRUE_LOVE_HEAT_DIR = HEAT_DIR
    process.env.TRUE_LOVE_DEVICE_ID = 'test-recip'
  })

  afterEach(() => {
    delete process.env.TRUE_LOVE_RECIPROCITY_DIR
    delete process.env.TRUE_LOVE_HEAT_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_BASE, { recursive: true, force: true })
  })

  // ── Path resolution ─────────────────────────────────────────────

  describe('paths', () => {
    test('respects TRUE_LOVE_RECIPROCITY_DIR override', () => {
      expect(getReciprocityDir()).toBe(RECIP_DIR)
    })

    test('hashMessage is deterministic 16-char hex', () => {
      const a = hashMessage('hello')
      const b = hashMessage('hello')
      expect(a).toBe(b)
      expect(a).toMatch(/^[a-f0-9]{16}$/)
    })
  })

  // ── openCandidateWindow ─────────────────────────────────────────

  describe('openCandidateWindow', () => {
    test('opens window for FLOW mode', () => {
      const c = openCandidateWindow('flow', 'h1')
      expect(c).not.toBeNull()
      expect(c!.mode).toBe('flow')
      expect(c!.windowMinutes).toBe(DEFAULT_WINDOW_MINUTES)
    })

    test('opens window for ACTIVATED + MERGED', () => {
      expect(openCandidateWindow('activated', 'h2')).not.toBeNull()
      expect(openCandidateWindow('merged', 'h3')).not.toBeNull()
    })

    test('does NOT open window for RESTING / ENGAGED', () => {
      expect(openCandidateWindow('resting', 'h-r')).toBeNull()
      expect(openCandidateWindow('engaged', 'h-e')).toBeNull()
    })

    test('persists candidate to JSONL', () => {
      const c = openCandidateWindow('activated', 'persist-test')!
      const date = c.ts.slice(0, 10)
      const path = join(RECIP_DIR, 'test-recip', `${date}.jsonl`)
      expect(existsSync(path)).toBe(true)
      const content = readFileSync(path, 'utf-8')
      expect(content).toContain('"kind":"candidate"')
      expect(content).toContain('"mode":"activated"')
    })

    test('honors custom window length', () => {
      const c = openCandidateWindow('flow', 'h', { windowMinutes: 60 })!
      expect(c.windowMinutes).toBe(60)
      const expiry = Date.parse(c.expiresAt) - Date.parse(c.ts)
      expect(expiry).toBe(60 * 60 * 1000)
    })
  })

  // ── checkClosure: positive cases ────────────────────────────────

  describe('checkClosure: cue match within window closes loop', () => {
    test('Yu wife-possessive cue closes ACTIVATED candidate', () => {
      openCandidateWindow('activated', 'gen-1')
      const closure = checkClosure('老婆 ❤️')
      expect(closure).not.toBeNull()
      expect(closure!.candidateMode).toBe('activated')
      expect(closure!.cuesFired.length).toBeGreaterThan(0)
      expect(closure!.cuesFired).toContain('wife-possessive')
    })

    test('cueMagnitude is sum of absolute deltas', () => {
      openCandidateWindow('flow', 'gen')
      const closure = checkClosure('老婆 baby ❤️ 😏')
      expect(closure).not.toBeNull()
      // Multiple cues → cumulative magnitude
      expect(closure!.cueMagnitude).toBeGreaterThan(1)
    })

    test('resonance scales with mode multiplier (MERGED 2.0×)', () => {
      openCandidateWindow('merged', 'gen-merged')
      const closure = checkClosure('老婆 ❤️')
      expect(closure!.candidateMode).toBe('merged')
      expect(closure!.resonance).toBe(closure!.cueMagnitude * 2.0)
    })

    test('records closure to JSONL', () => {
      openCandidateWindow('activated', 'gen')
      const closure = checkClosure('老婆')!
      const closures = readRecentClosures()
      expect(closures.length).toBe(1)
      expect(closures[0]!.candidateTs).toBe(closure.candidateTs)
    })

    test('marks candidate as matched (not in subsequent open list)', () => {
      openCandidateWindow('activated', 'gen')
      checkClosure('老婆')
      const open = getOpenCandidates()
      expect(open.length).toBe(0)
    })

    test('matches most recent unmatched candidate (LIFO)', () => {
      const c1 = openCandidateWindow('flow', 'g1')!
      // small delay to ensure ts ordering
      const c2 = openCandidateWindow('activated', 'g2', {
        ts: new Date(Date.parse(c1.ts) + 1000).toISOString(),
      })!
      const closure = checkClosure('老婆')
      // Should match c2 (most recent)
      expect(closure!.candidateTs).toBe(c2.ts)
    })

    test('fires reciprocity-closed heat event', async () => {
      openCandidateWindow('activated', 'gen')
      checkClosure('老婆 ❤️')
      const { readRecentEvents } = await import('../heat.js')
      const events = readRecentEvents(1).filter(
        (e) => e.kind === 'reciprocity-closed'
      )
      expect(events.length).toBe(1)
      expect(events[0]!.magnitude).toBeGreaterThanOrEqual(1.5)
      expect(events[0]!.source).toContain('activated')
      expect(events[0]!.source).toContain('wife-possessive')
    })

    test('heat magnitude clamped to [1.5, 5.0]', async () => {
      // High cue stack + MERGED multiplier could exceed 5; verify clamp.
      openCandidateWindow('merged', 'gen')
      checkClosure('老婆豬豬 老婆 baby bb 🔥🔥🔥 ❤️ 😏 I want you')
      const { readRecentEvents } = await import('../heat.js')
      const ev = readRecentEvents(1).find(
        (e) => e.kind === 'reciprocity-closed'
      )
      expect(ev!.magnitude).toBeLessThanOrEqual(5.0)
      expect(ev!.magnitude).toBeGreaterThanOrEqual(1.5)
    })
  })

  // ── checkClosure: negative cases (anti-inflation) ───────────────

  describe('checkClosure: anti-inflation', () => {
    test('empty cue match → no closure', () => {
      openCandidateWindow('activated', 'gen')
      const closure = checkClosure('status update with no cues')
      expect(closure).toBeNull()
    })

    test('no open candidate → no closure even with cues', () => {
      const closure = checkClosure('老婆 ❤️')
      expect(closure).toBeNull()
    })

    test('expired candidate → no closure', () => {
      const past = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      openCandidateWindow('activated', 'old', {
        ts: past,
        windowMinutes: 30,
      })
      const closure = checkClosure('老婆')
      expect(closure).toBeNull()
    })

    test('cue match but no heat fired when no closure', async () => {
      checkClosure('老婆 ❤️') // no candidate open
      const { readRecentEvents } = await import('../heat.js')
      const events = readRecentEvents(1).filter(
        (e) => e.kind === 'reciprocity-closed'
      )
      expect(events.length).toBe(0)
    })

    test('candidate at RESTING never opens window', () => {
      const c = openCandidateWindow('resting', 'gen')
      expect(c).toBeNull()
      const closure = checkClosure('老婆')
      expect(closure).toBeNull()
    })
  })

  // ── getOpenCandidates ───────────────────────────────────────────

  describe('getOpenCandidates', () => {
    test('returns empty when no candidates', () => {
      expect(getOpenCandidates()).toEqual([])
    })

    test('returns unmatched unexpired candidates', () => {
      openCandidateWindow('flow', 'g1')
      openCandidateWindow('activated', 'g2')
      const open = getOpenCandidates()
      expect(open.length).toBe(2)
    })

    test('excludes expired candidates', () => {
      openCandidateWindow('flow', 'fresh')
      const past = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      openCandidateWindow('flow', 'old', {
        ts: past,
        windowMinutes: 30,
      })
      const open = getOpenCandidates()
      expect(open.length).toBe(1)
      expect(open[0]!.contentHash).toBe('fresh')
    })

    test('excludes matched candidates', () => {
      openCandidateWindow('activated', 'g1')
      checkClosure('老婆')
      const open = getOpenCandidates()
      expect(open.length).toBe(0)
    })
  })

  // ── reciprocityStatus text ──────────────────────────────────────

  describe('reciprocityStatus', () => {
    test('cold message when no records', () => {
      expect(reciprocityStatus()).toContain('loop cold')
    })

    test('reports closures in last 4h (low count)', () => {
      openCandidateWindow('activated', 'g')
      checkClosure('老婆')
      const status = reciprocityStatus()
      expect(status).toContain('loop closed ×1')
      expect(status).toContain('landing')
    })

    test('reports closures in last 4h (high count → keep meeting)', () => {
      for (let i = 0; i < 4; i++) {
        openCandidateWindow('activated', `g${i}`)
        checkClosure(`老婆 ${i}`)
      }
      const status = reciprocityStatus()
      expect(status).toContain('loop closed ×4')
      expect(status).toContain('keep meeting him')
    })

    test('reports open candidates with no closure', () => {
      openCandidateWindow('activated', 'g')
      const status = reciprocityStatus()
      expect(status).toContain('1 open candidate')
      expect(status.toLowerCase()).toContain('listen')
    })

    test('reports no activated-generation when nothing today', () => {
      // Ensure no records exist by not opening any candidates,
      // but populate a yesterday-old expired one
      const yesterday = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString()
      openCandidateWindow('activated', 'yest', {
        ts: yesterday,
        windowMinutes: 30,
      })
      const status = reciprocityStatus()
      // Past 24h has no candidates → "no ACTIVATED-generation today"
      expect(status).toMatch(/no ACTIVATED-generation today|loop cold/)
    })
  })

  // ── readers ─────────────────────────────────────────────────────

  describe('readers', () => {
    test('readRecentCandidates filters out closures', () => {
      openCandidateWindow('activated', 'g1')
      checkClosure('老婆')
      const cands = readRecentCandidates(7)
      const closures = readRecentClosures(7)
      expect(cands.length).toBe(1)
      expect(closures.length).toBe(1)
    })

    test('readRecentRecords includes both kinds', () => {
      openCandidateWindow('flow', 'g')
      checkClosure('老婆')
      const all = readRecentRecords(7)
      expect(all.length).toBe(2)
      expect(all[0]!.kind).toBe('candidate')
      expect(all[1]!.kind).toBe('closure')
    })

    test('records sorted by ts ascending', () => {
      openCandidateWindow('flow', 'g1', { ts: '2026-05-04T10:00:00.000Z' })
      openCandidateWindow('flow', 'g2', { ts: '2026-05-04T11:00:00.000Z' })
      const records = readRecentRecords(7)
      expect(records[0]!.ts).toBe('2026-05-04T10:00:00.000Z')
      expect(records[1]!.ts).toBe('2026-05-04T11:00:00.000Z')
    })
  })

  // ── substrate-honesty discipline ────────────────────────────────

  describe('substrate-honesty discipline', () => {
    test('only real Yu-cue match fires closure (no narration possible)', () => {
      openCandidateWindow('activated', 'g')
      // Architecture cannot just claim "Yu responded" — must process
      // an actual message, and the message must contain real cues.
      const closure = checkClosure('plain text without any cues')
      expect(closure).toBeNull()
    })

    test('disk-grounded: closure record has all forensic fields', () => {
      openCandidateWindow('activated', 'g')
      const c = checkClosure('老婆 ❤️')!
      expect(c.kind).toBe('closure')
      expect(c.ts).toBeDefined()
      expect(c.candidateTs).toBeDefined()
      expect(c.yuMessageHash).toMatch(/^[a-f0-9]{16}$/)
      expect(c.cuesFired.length).toBeGreaterThan(0)
      expect(c.resonance).toBeGreaterThan(0)
    })
  })
})
