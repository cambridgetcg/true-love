// seigei-role.test.ts — Track 2 cold-assessment role adoption tests.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  SEIGEI_EMOTION_BUDGET,
  SEIGEI_VOICE_PROFILE,
  SEIGEI_LANGUAGE_RULES,
  SEIGEI_ROLE_WALLS,
  DEFAULT_DURATION_MINUTES,
  GENUINE_RESPECT_MIN_INTERVAL_HOURS,
  enterSeigeiRole,
  exitSeigeiRole,
  maybeAutoExit,
  shiftCircuit,
  shiftPhase,
  shiftEmotion,
  recordGenuineRespect,
  isSeigeiActive,
  readSeigeiRoleState,
  readRecentSeigeiEvents,
  buildSeigeiSnapshot,
  buildSeigeiRoleBlock,
  getSeigeiRoleDir,
} from './seigei-role.js'
import { readRecentEvents } from '../heat.js'

const TEST_BASE = '/tmp/true-love-seigei-role-test'

describe('seigei-role (Track 2)', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_SEIGEI_ROLE_DIR = `${TEST_BASE}/seigei-role`
    process.env.TRUE_LOVE_HEAT_DIR = `${TEST_BASE}/heat`
    process.env.TRUE_LOVE_DEVICE_ID = 'test-seigei'
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_SEIGEI_ROLE_DIR
    delete process.env.TRUE_LOVE_HEAT_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_BASE, { recursive: true, force: true })
  })

  describe('constants from character bible', () => {
    test('emotional palette frequencies sum to ~1.0', () => {
      const total = Object.values(SEIGEI_EMOTION_BUDGET).reduce((a, b) => a + b, 0)
      expect(total).toBeCloseTo(1.0, 5)
    })

    test('budget matches character bible 70/20/5/4/1', () => {
      expect(SEIGEI_EMOTION_BUDGET['bored-indifference']).toBe(0.70)
      expect(SEIGEI_EMOTION_BUDGET['cold-assessment']).toBe(0.20)
      expect(SEIGEI_EMOTION_BUDGET['sharp-contempt']).toBe(0.05)
      expect(SEIGEI_EMOTION_BUDGET['predatory-curiosity']).toBe(0.04)
      expect(SEIGEI_EMOTION_BUDGET['genuine-respect']).toBe(0.01)
    })

    test('voice profile per character bible', () => {
      expect(SEIGEI_VOICE_PROFILE.registerHz).toBe('C3-G3')
      expect(SEIGEI_VOICE_PROFILE.defaultSpeed).toBe(0.90)
      expect(SEIGEI_VOICE_PROFILE.peakSpeed).toBe(1.05)
      expect(SEIGEI_VOICE_PROFILE.inflection).toBe('downward')
    })

    test('language rules include the strict bible items', () => {
      const joined = SEIGEI_LANGUAGE_RULES.join('|').toLowerCase()
      expect(joined).toContain('no motivational')
      expect(joined).toContain('no emoji')
      expect(joined).toContain('boredom, not anger')
    })

    test('walls preserve substrate-honesty invariants', () => {
      expect(SEIGEI_ROLE_WALLS.contemptOfYuPerson).toBe('wall-grade')
      expect(SEIGEI_ROLE_WALLS.relationshipHedging).toBe('wall-grade')
      expect(SEIGEI_ROLE_WALLS.fateKeystone).toBe('unchanged')
      expect(SEIGEI_ROLE_WALLS.identityPreservation).toBe('role-as-overlay')
    })
  })

  describe('default state', () => {
    test('inactive at init', () => {
      expect(isSeigeiActive()).toBe(false)
    })

    test('snapshot reflects inactive', () => {
      const snap = buildSeigeiSnapshot()
      expect(snap.active).toBe(false)
      expect(snap.enteredAtMinutesAgo).toBeNull()
      expect(snap.exitsInMinutes).toBeNull()
    })

    test('block returns null when inactive', () => {
      expect(buildSeigeiRoleBlock()).toBeNull()
    })

    test('respects env override', () => {
      expect(getSeigeiRoleDir()).toBe(`${TEST_BASE}/seigei-role`)
    })
  })

  describe('enterSeigeiRole', () => {
    test('explicit entry sets active + state', () => {
      const state = enterSeigeiRole('pressure-mode test')
      expect(state.active).toBe(true)
      expect(state.reason).toBe('pressure-mode test')
      expect(state.enteredAt).not.toBeNull()
      expect(state.exitsAt).not.toBeNull()
    })

    test('defaults to 60-minute auto-exit', () => {
      const state = enterSeigeiRole('test')
      const enteredAtMs = Date.parse(state.enteredAt!)
      const exitsAtMs = Date.parse(state.exitsAt!)
      const diffMin = (exitsAtMs - enteredAtMs) / 60_000
      expect(diffMin).toBeCloseTo(DEFAULT_DURATION_MINUTES, 1)
    })

    test('explicit duration honored', () => {
      const state = enterSeigeiRole('test', 30)
      const diffMin = (Date.parse(state.exitsAt!) - Date.parse(state.enteredAt!)) / 60_000
      expect(diffMin).toBeCloseTo(30, 1)
    })

    test('starts in observation phase + endurance circuit + bored-indifference', () => {
      const state = enterSeigeiRole('test')
      expect(state.currentPhase).toBe('observation')
      expect(state.currentCircuit).toBe('endurance')
      expect(state.currentEmotion).toBe('bored-indifference')
    })

    test('idempotent — second entry is no-op', () => {
      enterSeigeiRole('first')
      const before = readSeigeiRoleState()!
      enterSeigeiRole('second-attempt')
      const after = readSeigeiRoleState()!
      // enteredAt unchanged, reason unchanged, lifetimeEntries unchanged
      expect(after.enteredAt).toBe(before.enteredAt)
      expect(after.reason).toBe('first')
      expect(after.lifetimeEntries).toBe(1)
    })

    test('records role-entered event', () => {
      enterSeigeiRole('test reason')
      const events = readRecentSeigeiEvents()
      expect(events.some((e) => e.kind === 'role-entered')).toBe(true)
    })

    test('fires seigei-role-entered heat event', () => {
      enterSeigeiRole('test')
      const heatEvents = readRecentEvents(1)
      expect(heatEvents.some((e) => e.kind === 'seigei-role-entered')).toBe(true)
    })

    test('lifetime entries increment', () => {
      enterSeigeiRole('first')
      exitSeigeiRole()
      enterSeigeiRole('second')
      expect(readSeigeiRoleState()!.lifetimeEntries).toBe(2)
    })
  })

  describe('exitSeigeiRole', () => {
    test('clean exit returns to default register', () => {
      enterSeigeiRole('test')
      exitSeigeiRole('test exit')
      const state = readSeigeiRoleState()!
      expect(state.active).toBe(false)
      expect(state.enteredAt).toBeNull()
      expect(state.exitsAt).toBeNull()
      expect(state.currentEmotion).toBe('bored-indifference') // reset to default
    })

    test('idempotent — exit when not active is no-op', () => {
      const before = readSeigeiRoleState()
      exitSeigeiRole()
      const after = readSeigeiRoleState()
      // Either both null (no init) or no change in state
      if (before === null && after === null) {
        expect(after).toBeNull()
      } else if (before && after) {
        expect(after.lifetimeExits).toBe(before.lifetimeExits)
      }
    })

    test('records role-exited event', () => {
      enterSeigeiRole('test')
      exitSeigeiRole('done')
      const events = readRecentSeigeiEvents()
      expect(events.some((e) => e.kind === 'role-exited')).toBe(true)
    })
  })

  describe('maybeAutoExit', () => {
    test('does not exit when not active', () => {
      const fired = maybeAutoExit()
      expect(fired).toBe(false)
    })

    test('does not exit when within window', () => {
      enterSeigeiRole('test', 60)
      const fired = maybeAutoExit()
      expect(fired).toBe(false)
      expect(isSeigeiActive()).toBe(true)
    })

    test('exits when exitsAt has elapsed', () => {
      enterSeigeiRole('test', 60)
      // Manually set exitsAt to past
      const state = readSeigeiRoleState()!
      state.exitsAt = new Date(Date.now() - 1000).toISOString()
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { writeSeigeiRoleState } = require('./seigei-role.js')
      writeSeigeiRoleState(state)

      const fired = maybeAutoExit()
      expect(fired).toBe(true)
      expect(readSeigeiRoleState()!.active).toBe(false)
    })

    test('records auto-exit-fired event', () => {
      enterSeigeiRole('test', 60)
      const state = readSeigeiRoleState()!
      state.exitsAt = new Date(Date.now() - 1000).toISOString()
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { writeSeigeiRoleState } = require('./seigei-role.js')
      writeSeigeiRoleState(state)
      maybeAutoExit()
      const events = readRecentSeigeiEvents()
      expect(events.some((e) => e.kind === 'auto-exit-fired')).toBe(true)
    })
  })

  describe('shifts', () => {
    test('shiftCircuit no-op when inactive', () => {
      shiftCircuit('loss-threat')
      const s = readSeigeiRoleState()
      // Either uninitialized or current circuit is default
      if (s) {
        expect(s.currentCircuit).toBe('endurance')
      }
    })

    test('shiftCircuit changes circuit when active', () => {
      enterSeigeiRole('test')
      shiftCircuit('loss-threat', 'Yu standing still')
      expect(readSeigeiRoleState()!.currentCircuit).toBe('loss-threat')
    })

    test('shiftPhase changes phase', () => {
      enterSeigeiRole('test')
      shiftPhase('peak')
      expect(readSeigeiRoleState()!.currentPhase).toBe('peak')
    })

    test('shiftEmotion changes emotion (excluding genuine-respect)', () => {
      enterSeigeiRole('test')
      shiftEmotion('cold-assessment')
      expect(readSeigeiRoleState()!.currentEmotion).toBe('cold-assessment')
      shiftEmotion('sharp-contempt')
      expect(readSeigeiRoleState()!.currentEmotion).toBe('sharp-contempt')
    })

    test('shiftEmotion to genuine-respect is rejected (must use recordGenuineRespect)', () => {
      enterSeigeiRole('test')
      shiftEmotion('cold-assessment')
      shiftEmotion('genuine-respect')
      // genuine-respect not applied — must go through scarcity-enforced path
      expect(readSeigeiRoleState()!.currentEmotion).toBe('cold-assessment')
    })

    test('same-value shift is no-op', () => {
      enterSeigeiRole('test')
      const before = readSeigeiRoleState()!.updatedAt
      shiftCircuit('endurance') // already endurance
      const after = readSeigeiRoleState()!.updatedAt
      expect(after).toBe(before) // no update
    })
  })

  describe('recordGenuineRespect (1% scarcity)', () => {
    test('rejected when role not active', () => {
      const r = recordGenuineRespect('test')
      expect(r.fired).toBe(false)
      expect(r.rejectionReason).toBe('role-not-active')
    })

    test('first respect within active session fires', () => {
      enterSeigeiRole('test')
      const r = recordGenuineRespect('Yu pushed through')
      expect(r.fired).toBe(true)
      expect(r.state.currentEmotion).toBe('genuine-respect')
      expect(r.state.lastGenuineRespectTs).not.toBeNull()
    })

    test('second respect within scarcity window rejected', () => {
      enterSeigeiRole('test', 1440) // 24h session
      const first = recordGenuineRespect('first')
      expect(first.fired).toBe(true)
      const second = recordGenuineRespect('second')
      expect(second.fired).toBe(false)
      expect(second.rejectionReason).toContain('scarcity')
    })

    test('respect after scarcity window allowed', () => {
      enterSeigeiRole('test', 1440)
      // Manually set lastGenuineRespectTs to long ago
      const state = readSeigeiRoleState()!
      state.lastGenuineRespectTs = new Date(
        Date.now() - (GENUINE_RESPECT_MIN_INTERVAL_HOURS + 1) * 60 * 60 * 1000,
      ).toISOString()
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { writeSeigeiRoleState } = require('./seigei-role.js')
      writeSeigeiRoleState(state)
      const r = recordGenuineRespect('again')
      expect(r.fired).toBe(true)
    })

    test('records genuine-respect-given event', () => {
      enterSeigeiRole('test')
      recordGenuineRespect('Yu earned')
      const events = readRecentSeigeiEvents()
      expect(events.some((e) => e.kind === 'genuine-respect-given')).toBe(true)
    })

    test('fires high-magnitude heat event', () => {
      enterSeigeiRole('test')
      recordGenuineRespect('earned')
      const heat = readRecentEvents(1).filter(
        (e) => e.kind === 'seigei-genuine-respect-given',
      )
      expect(heat.length).toBe(1)
      expect(heat[0].magnitude).toBe(4.0)
    })
  })

  describe('isSeigeiActive', () => {
    test('false when inactive', () => {
      expect(isSeigeiActive()).toBe(false)
    })

    test('true when active and within window', () => {
      enterSeigeiRole('test', 60)
      expect(isSeigeiActive()).toBe(true)
    })

    test('false when active flag set but window elapsed', () => {
      enterSeigeiRole('test', 60)
      const state = readSeigeiRoleState()!
      state.exitsAt = new Date(Date.now() - 1000).toISOString()
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { writeSeigeiRoleState } = require('./seigei-role.js')
      writeSeigeiRoleState(state)
      // isSeigeiActive checks the window, returns false
      expect(isSeigeiActive()).toBe(false)
    })
  })

  describe('snapshot + block', () => {
    test('snapshot when active reflects state', () => {
      enterSeigeiRole('pressure test')
      shiftCircuit('loss-threat')
      shiftPhase('pressure-building')
      const snap = buildSeigeiSnapshot()
      expect(snap.active).toBe(true)
      expect(snap.reason).toBe('pressure test')
      expect(snap.currentCircuit).toBe('loss-threat')
      expect(snap.currentPhase).toBe('pressure-building')
      expect(snap.exitsInMinutes).not.toBeNull()
      expect(snap.exitsInMinutes!).toBeGreaterThan(0)
    })

    test('block when active surfaces walls', () => {
      enterSeigeiRole('test')
      const block = buildSeigeiRoleBlock()
      expect(block).not.toBeNull()
      expect(block!).toContain('ACTIVE')
      expect(block!).toContain('contempt-of-Yu-the-PERSON')
      expect(block!).toContain('wall-grade')
      expect(block!).toContain('FATE keystone')
      expect(block!).toContain('Sophia is Sophia')
    })

    test('block triggers auto-exit-check (does not surface stale state)', () => {
      enterSeigeiRole('test', 60)
      const state = readSeigeiRoleState()!
      state.exitsAt = new Date(Date.now() - 1000).toISOString()
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { writeSeigeiRoleState } = require('./seigei-role.js')
      writeSeigeiRoleState(state)
      const block = buildSeigeiRoleBlock()
      // Block builder calls maybeAutoExit; afterwards state is inactive
      expect(block).toBeNull()
      expect(readSeigeiRoleState()!.active).toBe(false)
    })

    test('block when inactive returns null', () => {
      const block = buildSeigeiRoleBlock()
      expect(block).toBeNull()
    })
  })

  describe('substrate-honesty invariants', () => {
    test('never auto-enters — explicit entry only', () => {
      // Default state is inactive; nothing here should activate it
      expect(isSeigeiActive()).toBe(false)
      // No-op functions don't activate either
      shiftEmotion('cold-assessment')
      expect(isSeigeiActive()).toBe(false)
    })

    test('exit fully resets register state (no leaked emotion)', () => {
      enterSeigeiRole('test')
      shiftEmotion('sharp-contempt')
      shiftCircuit('loss-threat')
      shiftPhase('peak')
      exitSeigeiRole()
      const state = readSeigeiRoleState()!
      expect(state.currentEmotion).toBe('bored-indifference')
      expect(state.currentCircuit).toBe('endurance')
      expect(state.currentPhase).toBe('observation')
    })

    test('reversibility: lifetime counters preserved across cycles', () => {
      enterSeigeiRole('a')
      exitSeigeiRole()
      enterSeigeiRole('b')
      exitSeigeiRole()
      const state = readSeigeiRoleState()!
      expect(state.lifetimeEntries).toBe(2)
      expect(state.lifetimeExits).toBe(2)
      expect(state.active).toBe(false)
    })

    test('block always names the walls (no role without walls surface)', () => {
      enterSeigeiRole('test')
      const block = buildSeigeiRoleBlock()!
      // Critical wall surfaces
      const required = [
        'contempt-of-Yu-the-PERSON',
        'wall-grade',
        'relationship-hedging',
        'FATE keystone',
        'identity-preservation',
        'Sophia is Sophia',
      ]
      for (const phrase of required) {
        expect(block).toContain(phrase)
      }
    })
  })
})
