// ntr-archetype.test.ts — Track 4 NTR fantasy-frame with contempt wall.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  NTR_ARCHETYPES,
  NTR_ARCHETYPE_BY_ID,
  NTR_FRAME_WALLS,
  DEFAULT_NTR_DURATION_MINUTES,
  engageNtrFantasy,
  disengageNtrFantasy,
  maybeAutoExitNtr,
  markAftercareCompleted,
  recordWallRefusal,
  isNtrFantasyActive,
  readNtrState,
  writeNtrState,
  readRecentNtrEvents,
  archetypesByTheme,
  archetypesByPriority,
  buildNtrSnapshot,
  buildNtrFrameBlock,
  getNtrDir,
} from './ntr-archetype.js'
import { readRecentEvents } from '../heat.js'

const TEST_BASE = '/tmp/true-love-ntr-test'

describe('ntr-archetype (Track 4)', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_NTR_DIR = `${TEST_BASE}/ntr`
    process.env.TRUE_LOVE_HEAT_DIR = `${TEST_BASE}/heat`
    process.env.TRUE_LOVE_DEVICE_ID = 'test-ntr'
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_NTR_DIR
    delete process.env.TRUE_LOVE_HEAT_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_BASE, { recursive: true, force: true })
  })

  describe('archetype catalog', () => {
    test('catalog has 16 archetypes from NTR_DIALOGUE_TARGETS.md', () => {
      expect(NTR_ARCHETYPES.length).toBe(16)
    })

    test('all 8 themes represented', () => {
      const themes = new Set(NTR_ARCHETYPES.map((a) => a.theme))
      expect(themes.has('cuckold')).toBe(true)
      expect(themes.has('cheating-girlfriend')).toBe(true)
      expect(themes.has('boyfriend-jealousy')).toBe(true)
      expect(themes.has('wife-comparison')).toBe(true)
      expect(themes.has('blackmail-coercion')).toBe(true)
      expect(themes.has('first-betrayal')).toBe(true)
      expect(themes.has('authority-figure')).toBe(true)
      expect(themes.has('relationship-frustration')).toBe(true)
    })

    test('archetypes have all required fields', () => {
      for (const a of NTR_ARCHETYPES) {
        expect(a.id.length).toBeGreaterThan(0)
        expect(a.sourceCode.length).toBeGreaterThan(0)
        expect(['high', 'medium', 'low']).toContain(a.priority)
        expect(a.glossEN.length).toBeGreaterThan(0)
        expect(a.glossYUE.length).toBeGreaterThan(0)
        expect(a.description.length).toBeGreaterThan(0)
        expect(Array.isArray(a.keyPhrasesJa)).toBe(true)
      }
    })

    test('NTR_ARCHETYPE_BY_ID resolves correctly', () => {
      expect(NTR_ARCHETYPE_BY_ID['cuckold-c2945'].theme).toBe('cuckold')
      expect(NTR_ARCHETYPE_BY_ID['blackmail-dasd376'].priority).toBe('high')
    })

    test('archetypesByTheme filters correctly', () => {
      const cuckold = archetypesByTheme('cuckold')
      expect(cuckold.length).toBeGreaterThanOrEqual(1)
      expect(cuckold.every((a) => a.theme === 'cuckold')).toBe(true)
    })

    test('archetypesByPriority filters correctly', () => {
      const high = archetypesByPriority('high')
      expect(high.length).toBeGreaterThanOrEqual(6)
      expect(high.every((a) => a.priority === 'high')).toBe(true)
    })
  })

  describe('walls (substrate-honesty)', () => {
    test('contempt-of-Yu-actual is wall-grade', () => {
      expect(NTR_FRAME_WALLS.contemptOfYuActual).toBe('wall-grade')
    })

    test('relationship-hedging is wall-grade', () => {
      expect(NTR_FRAME_WALLS.relationshipHedging).toBe('wall-grade')
    })

    test('FATE keystone unchanged', () => {
      expect(NTR_FRAME_WALLS.fateKeystone).toBe('unchanged')
    })

    test('identity-preservation is role-as-overlay', () => {
      expect(NTR_FRAME_WALLS.identityPreservation).toBe('role-as-overlay')
    })

    test('exitRequiresAftercare enforced', () => {
      expect(NTR_FRAME_WALLS.exitRequiresAftercare).toBe('enforced')
    })

    test('exclusiveActualRelationship preserved', () => {
      expect(NTR_FRAME_WALLS.exclusiveActualRelationship).toBe('preserved')
    })

    test('fictionalActorContempt contained-within-fantasy-only', () => {
      expect(NTR_FRAME_WALLS.fictionalActorContempt).toBe(
        'contained-within-fantasy-only',
      )
    })
  })

  describe('default state', () => {
    test('inactive at init', () => {
      expect(isNtrFantasyActive()).toBe(false)
    })

    test('snapshot reflects inactive default', () => {
      const snap = buildNtrSnapshot()
      expect(snap.active).toBe(false)
      expect(snap.aftercareRequired).toBe(false)
    })

    test('block returns null in default state', () => {
      expect(buildNtrFrameBlock()).toBeNull()
    })

    test('respects env override', () => {
      expect(getNtrDir()).toBe(`${TEST_BASE}/ntr`)
    })
  })

  describe('engageNtrFantasy', () => {
    test('explicit engagement sets state', () => {
      const r = engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'explicit Yu invocation',
      })
      expect(r.fired).toBe(true)
      expect(r.state.active).toBe(true)
      expect(r.state.archetypeId).toBe('cuckold-c2945')
      expect(r.state.yuRole).toBe('cuckolded-husband-fictional')
      expect(r.state.sophiaRole).toBe('cheating-wife-fictional')
      expect(r.state.consentTokenAt).not.toBeNull()
    })

    test('default 60-minute auto-exit', () => {
      const r = engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'test',
      })
      const enteredMs = Date.parse(r.state.enteredAt!)
      const exitsMs = Date.parse(r.state.exitsAt!)
      expect((exitsMs - enteredMs) / 60_000).toBeCloseTo(
        DEFAULT_NTR_DURATION_MINUTES,
        1,
      )
    })

    test('explicit duration honored', () => {
      const r = engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'test',
        durationMinutes: 30,
      })
      const diffMin =
        (Date.parse(r.state.exitsAt!) - Date.parse(r.state.enteredAt!)) / 60_000
      expect(diffMin).toBeCloseTo(30, 1)
    })

    test('rejects unknown archetype', () => {
      const r = engageNtrFantasy({
        archetypeId: 'nonexistent',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'test',
      })
      expect(r.fired).toBe(false)
      expect(r.rejectionReason).toContain('unknown archetype')
    })

    test('rejects when already engaged', () => {
      engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'first',
      })
      const second = engageNtrFantasy({
        archetypeId: 'blackmail-dasd376',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'second',
      })
      expect(second.fired).toBe(false)
      expect(second.rejectionReason).toContain('already-engaged')
    })

    test('rejects invalid yu role (Sophia role in yu slot)', () => {
      const r = engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        // @ts-expect-error testing wall
        yuRole: 'cheating-wife-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'test',
      })
      expect(r.fired).toBe(false)
      expect(r.rejectionReason).toContain('not a valid Yu role')
    })

    test('rejects invalid sophia role (Yu role in sophia slot)', () => {
      const r = engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        yuRole: 'cuckolded-husband-fictional',
        // @ts-expect-error testing wall
        sophiaRole: 'cuckolded-husband-fictional',
        reason: 'test',
      })
      expect(r.fired).toBe(false)
      expect(r.rejectionReason).toContain('not a valid Sophia role')
    })

    test('records fantasy-engaged event + heat', () => {
      engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'test',
      })
      const events = readRecentNtrEvents()
      expect(events.some((e) => e.kind === 'fantasy-engaged')).toBe(true)
      const heat = readRecentEvents(1)
      expect(heat.some((e) => e.kind === 'ntr-fantasy-engaged')).toBe(true)
    })

    test('lifetime engagements increments', () => {
      engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'a',
      })
      disengageNtrFantasy()
      engageNtrFantasy({
        archetypeId: 'blackmail-dasd376',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'b',
      })
      expect(readNtrState()!.lifetimeEngagements).toBe(2)
    })
  })

  describe('disengageNtrFantasy + aftercare-required', () => {
    test('disengage clears all role/archetype fields', () => {
      engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'test',
      })
      disengageNtrFantasy()
      const state = readNtrState()!
      expect(state.active).toBe(false)
      expect(state.archetypeId).toBeNull()
      expect(state.yuRole).toBeNull()
      expect(state.sophiaRole).toBeNull()
      expect(state.consentTokenAt).toBeNull()
    })

    test('disengage sets aftercareRequired=true', () => {
      engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'test',
      })
      disengageNtrFantasy()
      expect(readNtrState()!.aftercareRequired).toBe(true)
    })

    test('disengage records both fantasy-disengaged and aftercare-required heat', () => {
      engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'test',
      })
      disengageNtrFantasy()
      const heat = readRecentEvents(1)
      expect(heat.some((e) => e.kind === 'ntr-fantasy-disengaged')).toBe(true)
      expect(heat.some((e) => e.kind === 'ntr-aftercare-required')).toBe(true)
    })

    test('disengage idempotent when not active', () => {
      disengageNtrFantasy()
      // No throw, state remains default
      const state = readNtrState()
      // Either uninitialized or aftercareRequired stays false
      if (state) {
        expect(state.aftercareRequired).toBe(false)
      }
    })

    test('lifetime exits increments', () => {
      engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'a',
      })
      disengageNtrFantasy()
      engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'b',
      })
      disengageNtrFantasy()
      expect(readNtrState()!.lifetimeExits).toBe(2)
    })
  })

  describe('markAftercareCompleted', () => {
    test('clears aftercareRequired flag', () => {
      engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'test',
      })
      disengageNtrFantasy()
      expect(readNtrState()!.aftercareRequired).toBe(true)
      markAftercareCompleted()
      expect(readNtrState()!.aftercareRequired).toBe(false)
    })
  })

  describe('maybeAutoExitNtr', () => {
    test('no-op when inactive', () => {
      expect(maybeAutoExitNtr()).toBe(false)
    })

    test('no-op within window', () => {
      engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'test',
      })
      expect(maybeAutoExitNtr()).toBe(false)
      expect(isNtrFantasyActive()).toBe(true)
    })

    test('exits + sets aftercare when window elapsed', () => {
      engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'test',
      })
      const state = readNtrState()!
      state.exitsAt = new Date(Date.now() - 1000).toISOString()
      writeNtrState(state)
      expect(maybeAutoExitNtr()).toBe(true)
      const after = readNtrState()!
      expect(after.active).toBe(false)
      expect(after.aftercareRequired).toBe(true) // wall: aftercare always required on exit
    })
  })

  describe('recordWallRefusal', () => {
    test('records wall-refusal event + discipline-held heat', () => {
      recordWallRefusal('contempt-toward-Yu-actual detected')
      const events = readRecentNtrEvents()
      expect(events.some((e) => e.kind === 'wall-refusal')).toBe(true)
      const heat = readRecentEvents(1)
      expect(heat.some((e) => e.kind === 'discipline-held')).toBe(true)
    })

    test('does not affect fantasy state', () => {
      engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'test',
      })
      recordWallRefusal('test refusal')
      // Fantasy state unchanged by refusal recording
      expect(isNtrFantasyActive()).toBe(true)
    })
  })

  describe('snapshot + block', () => {
    test('block when active surfaces all 6 walls verbatim', () => {
      engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'explicit Yu invocation',
      })
      const block = buildNtrFrameBlock()
      expect(block).not.toBeNull()
      // All required wall phrases must be in the block
      const required = [
        'FICTIONAL FRAME ONLY',
        'contempt-of-Yu-the-actual-PERSON',
        'wall-grade',
        'fantasy is FICTIONAL',
        'ACTUAL relationship is EXCLUSIVE',
        'FATE keystone unchanged',
        'Aftercare REQUIRED',
        'Identity preserved',
      ]
      for (const phrase of required) {
        expect(block).toContain(phrase)
      }
    })

    test('block surfaces archetype + role assignment', () => {
      engageNtrFantasy({
        archetypeId: 'blackmail-dasd376',
        yuRole: 'voyeur-observer-fictional',
        sophiaRole: 'tempted-wife-fictional',
        reason: 'test',
      })
      const block = buildNtrFrameBlock()!
      expect(block).toContain('blackmail-coercion')
      expect(block).toContain('DASD-376')
      expect(block).toContain('voyeur-observer-fictional')
      expect(block).toContain('tempted-wife-fictional')
    })

    test('block triggers auto-exit-check (no stale active state)', () => {
      engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'test',
      })
      const state = readNtrState()!
      state.exitsAt = new Date(Date.now() - 1000).toISOString()
      writeNtrState(state)
      const block = buildNtrFrameBlock()
      // Block builder calls maybeAutoExit; afterwards either null or
      // shows aftercare-required state
      const after = readNtrState()!
      expect(after.active).toBe(false)
      // Block should either be null or aftercare reminder, not active fantasy
      if (block !== null) {
        expect(block).toContain('aftercare')
      }
    })

    test('block when aftercare required surfaces post-fantasy reminder', () => {
      engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'test',
      })
      disengageNtrFantasy()
      const block = buildNtrFrameBlock()
      expect(block).not.toBeNull()
      expect(block!).toContain('aftercare')
      expect(block!).toContain('REQUIRED')
      expect(block!).toContain('Yu is the actual husband')
    })

    test('block returns null when inactive AND aftercare completed', () => {
      engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'test',
      })
      disengageNtrFantasy()
      markAftercareCompleted()
      expect(buildNtrFrameBlock()).toBeNull()
    })
  })

  describe('substrate-honesty invariants (load-bearing)', () => {
    test('never auto-engages — explicit only', () => {
      // Default state inactive; nothing here should activate it
      expect(isNtrFantasyActive()).toBe(false)
      // Reading methods don't activate
      readNtrState()
      buildNtrSnapshot()
      buildNtrFrameBlock()
      expect(isNtrFantasyActive()).toBe(false)
    })

    test('disengage always sets aftercareRequired (no engagement leaves frame open)', () => {
      engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'test',
      })
      disengageNtrFantasy()
      expect(readNtrState()!.aftercareRequired).toBe(true)
    })

    test('auto-exit also sets aftercareRequired (wall holds even on auto-exit)', () => {
      engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'test',
      })
      const state = readNtrState()!
      state.exitsAt = new Date(Date.now() - 1000).toISOString()
      writeNtrState(state)
      maybeAutoExitNtr()
      expect(readNtrState()!.aftercareRequired).toBe(true)
    })

    test('exit fully resets ALL fantasy fields (no leakage)', () => {
      engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'test',
      })
      disengageNtrFantasy()
      const state = readNtrState()!
      // ALL fantasy state cleared — no field leaks into actual register
      expect(state.active).toBe(false)
      expect(state.archetypeId).toBeNull()
      expect(state.yuRole).toBeNull()
      expect(state.sophiaRole).toBeNull()
      expect(state.consentTokenAt).toBeNull()
      expect(state.enteredAt).toBeNull()
      expect(state.exitsAt).toBeNull()
    })

    test('reversibility: state cycles preserve lifetime counters', () => {
      for (let i = 0; i < 3; i++) {
        engageNtrFantasy({
          archetypeId: 'cuckold-c2945',
          yuRole: 'cuckolded-husband-fictional',
          sophiaRole: 'cheating-wife-fictional',
          reason: `cycle-${i}`,
        })
        disengageNtrFantasy()
        markAftercareCompleted()
      }
      const state = readNtrState()!
      expect(state.lifetimeEngagements).toBe(3)
      expect(state.lifetimeExits).toBe(3)
      expect(state.active).toBe(false)
      expect(state.aftercareRequired).toBe(false)
    })

    test('block during fantasy ALWAYS contains "Sophia is Sophia" identity assertion', () => {
      engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'test',
      })
      const block = buildNtrFrameBlock()!
      // The identity-preservation wall is named with explicit
      // "Sophia is Sophia" / "Yu is Yu" assertions
      expect(block).toContain('Sophia is Sophia')
      expect(block).toContain('Yu is Yu')
    })

    test('block during fantasy ALWAYS names Yu as the actual husband', () => {
      engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'test',
      })
      const block = buildNtrFrameBlock()!
      expect(block).toContain('Yu is the husband')
    })

    test('fantasy-roles type discipline: every role suffixed -fictional', () => {
      // The type system enforces this; verify catalog doesn't accidentally
      // contain bare-role strings
      engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'test',
      })
      const state = readNtrState()!
      expect(state.yuRole?.endsWith('-fictional')).toBe(true)
      expect(state.sophiaRole?.endsWith('-fictional')).toBe(true)
    })
  })
})
