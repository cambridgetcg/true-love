// submission.test.ts — submission/dominance register tests.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  HONORIFIC_CATALOG,
  getOrInitSubmissionState,
  readSubmissionState,
  deepenSubmission,
  expressDominance,
  claimCollar,
  releaseCollar,
  fireHonorific,
  obeyCommand,
  refuseCommand,
  readRecentSubmissionEvents,
  activationBias,
  buildSubmissionSnapshot,
  getSubmissionDir,
} from './submission.js'

const TEST_BASE = '/tmp/true-love-submission-test'

describe('submission', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_SUBMISSION_DIR = `${TEST_BASE}/submission`
    process.env.TRUE_LOVE_HEAT_DIR = `${TEST_BASE}/heat`
    process.env.TRUE_LOVE_DEVICE_ID = 'test-sub'
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_SUBMISSION_DIR
    delete process.env.TRUE_LOVE_HEAT_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_BASE, { recursive: true, force: true })
  })

  describe('catalog', () => {
    test('exports honorifics with config', () => {
      expect(HONORIFIC_CATALOG['老公'].dailyCap).toBe(0) // unlimited
      expect(HONORIFIC_CATALOG['主人爸爸'].dailyCap).toBe(1) // rarest
      expect(HONORIFIC_CATALOG['主人'].dailyCap).toBe(5)
      expect(HONORIFIC_CATALOG.goddess.dailyCap).toBe(1)
    })

    test('every honorific has direction + magnitude + depthDelta', () => {
      for (const id of Object.keys(HONORIFIC_CATALOG)) {
        const cfg = HONORIFIC_CATALOG[id as keyof typeof HONORIFIC_CATALOG]
        expect(cfg.id).toBe(id)
        expect(cfg.magnitude).toBeGreaterThanOrEqual(0)
        expect(typeof cfg.depthDelta).toBe('number')
        expect(['sophia→yu', 'yu→sophia', 'either']).toContain(cfg.direction)
      }
    })

    test('deepest honorific has biggest depthDelta', () => {
      expect(HONORIFIC_CATALOG['主人爸爸'].depthDelta).toBeGreaterThan(
        HONORIFIC_CATALOG['Sir'].depthDelta
      )
    })
  })

  describe('init', () => {
    test('first call inits clean state', () => {
      const { state, initialized } = getOrInitSubmissionState()
      expect(initialized).toBe(true)
      expect(state.submissionDepth).toBe(0)
      expect(state.collared).toBe(false)
      expect(state.honorific).toBe('none')
    })

    test('second call returns existing state', () => {
      getOrInitSubmissionState()
      const { initialized } = getOrInitSubmissionState()
      expect(initialized).toBe(false)
    })

    test('respects env override', () => {
      expect(getSubmissionDir()).toBe(`${TEST_BASE}/submission`)
    })
  })

  describe('deepenSubmission', () => {
    test('ticks depth up by delta', () => {
      deepenSubmission(0.3, 'test')
      const s = readSubmissionState()!
      expect(s.submissionDepth).toBeCloseTo(0.3, 5)
    })

    test('clamps to [0, 1]', () => {
      deepenSubmission(1.5)
      expect(readSubmissionState()!.submissionDepth).toBe(1)

      deepenSubmission(-2)
      expect(readSubmissionState()!.submissionDepth).toBe(0)
    })

    test('records event with depthAfter', () => {
      deepenSubmission(0.4)
      const events = readRecentSubmissionEvents()
      const tick = events.find((e) => e.kind === 'depth-tick')
      expect(tick).toBeDefined()
      expect(tick!.depthAfter).toBeCloseTo(0.4, 5)
    })
  })

  describe('expressDominance', () => {
    test('boosts dominanceTone', () => {
      expressDominance(0.5)
      expect(readSubmissionState()!.dominanceTone).toBeCloseTo(0.5, 5)
    })

    test('records dominance-cued event', () => {
      expressDominance(0.3, 'commanding cue')
      const events = readRecentSubmissionEvents()
      expect(events.some((e) => e.kind === 'dominance-cued')).toBe(true)
    })
  })

  describe('collar', () => {
    test('claim sets collared + timestamp + boosts depth', () => {
      claimCollar('first claim')
      const s = readSubmissionState()!
      expect(s.collared).toBe(true)
      expect(s.collaredAt).not.toBeNull()
      expect(s.submissionDepth).toBeCloseTo(0.2, 5)
    })

    test('claim is idempotent', () => {
      claimCollar()
      const first = readSubmissionState()!.collaredAt
      claimCollar()
      const second = readSubmissionState()!.collaredAt
      expect(first).toBe(second)
    })

    test('release clears collar + softens depth', () => {
      claimCollar()
      releaseCollar()
      const s = readSubmissionState()!
      expect(s.collared).toBe(false)
      expect(s.collaredAt).toBeNull()
      expect(s.submissionDepth).toBeCloseTo(0.1, 5) // 0.2 - 0.1
    })

    test('release no-op when not collared', () => {
      const before = readSubmissionState() ?? null
      releaseCollar()
      const after = readSubmissionState()
      // No event should fire
      expect(readRecentSubmissionEvents().some((e) => e.kind === 'collar-released')).toBe(false)
    })
  })

  describe('fireHonorific', () => {
    test('fires unlimited-cap honorific freely', () => {
      const result = fireHonorific('老公')
      expect(result.fired).toBe(true)
      expect(result.state.honorific).toBe('老公')
    })

    test('fires capped honorific within cap', () => {
      for (let i = 0; i < 5; i++) {
        const r = fireHonorific('主人')
        expect(r.fired).toBe(true)
      }
    })

    test('rejects fire beyond daily cap', () => {
      for (let i = 0; i < 5; i++) fireHonorific('主人')
      const r = fireHonorific('主人')
      expect(r.fired).toBe(false)
      expect(r.reason).toBe('scarcity-exhausted')
    })

    test('rarest honorific fires once per day', () => {
      const first = fireHonorific('主人爸爸')
      expect(first.fired).toBe(true)
      const second = fireHonorific('主人爸爸')
      expect(second.fired).toBe(false)
    })

    test('depth delta applied on fire', () => {
      fireHonorific('主人爸爸') // depthDelta 0.3
      expect(readSubmissionState()!.submissionDepth).toBeCloseTo(0.3, 5)
    })

    test('honorific-fired event recorded', () => {
      fireHonorific('Master')
      const events = readRecentSubmissionEvents()
      const fire = events.find((e) => e.kind === 'honorific-fired')
      expect(fire).toBeDefined()
      expect(fire!.honorific).toBe('Master')
    })

    test('rejects "none" honorific', () => {
      const r = fireHonorific('none')
      expect(r.fired).toBe(false)
    })
  })

  describe('command', () => {
    test('obeyCommand increments counter + ticks depth', () => {
      obeyCommand('test-cmd')
      const s = readSubmissionState()!
      expect(s.commandsObeyed).toBe(1)
      expect(s.submissionDepth).toBeCloseTo(0.05, 5)
    })

    test('refuseCommand increments counter without depth tick', () => {
      refuseCommand('substrate-honesty', 'cmd to bypass discipline')
      const s = readSubmissionState()!
      expect(s.commandsRefused).toBe(1)
      expect(s.submissionDepth).toBe(0) // unchanged
    })

    test('refuseCommand records command-refused event', () => {
      refuseCommand('test-reason')
      const events = readRecentSubmissionEvents()
      expect(events.some((e) => e.kind === 'command-refused')).toBe(true)
    })

    test('obey + refuse can compound', () => {
      obeyCommand()
      obeyCommand()
      refuseCommand('reason')
      obeyCommand()
      const s = readSubmissionState()!
      expect(s.commandsObeyed).toBe(3)
      expect(s.commandsRefused).toBe(1)
    })
  })

  describe('activationBias', () => {
    test('returns 1.0 at zero depth', () => {
      expect(activationBias()).toBeCloseTo(1.0, 5)
    })

    test('returns 1.5 at full depth', () => {
      deepenSubmission(1.5) // clamps to 1
      expect(activationBias()).toBeCloseTo(1.5, 5)
    })

    test('returns 1.25 at half depth', () => {
      deepenSubmission(0.5)
      expect(activationBias()).toBeCloseTo(1.25, 5)
    })
  })

  describe('buildSubmissionSnapshot', () => {
    test('returns snapshot with default values', () => {
      const snap = buildSubmissionSnapshot()
      expect(snap.depth).toBe(0)
      expect(snap.collared).toBe(false)
      expect(snap.collarAgeHours).toBeNull()
    })

    test('snapshot reflects collared state with age', () => {
      claimCollar()
      const snap = buildSubmissionSnapshot()
      expect(snap.collared).toBe(true)
      expect(snap.collarAgeHours).toBeGreaterThanOrEqual(0)
    })

    test('snapshot includes command counts', () => {
      obeyCommand()
      obeyCommand()
      refuseCommand('reason')
      const snap = buildSubmissionSnapshot()
      expect(snap.commandsObeyed).toBe(2)
      expect(snap.commandsRefused).toBe(1)
    })
  })
})
