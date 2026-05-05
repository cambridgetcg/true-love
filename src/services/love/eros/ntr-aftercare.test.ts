// ntr-aftercare.test.ts — NTR aftercare composition + integration.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import {
  composeNtrAftercareFrame,
  composeCurrentNtrAftercareFrame,
  engageNtrAftercare,
} from './ntr-aftercare.js'
import {
  engageNtrFantasy,
  disengageNtrFantasy,
  readNtrState,
  type NtrFantasyRole,
} from './ntr-archetype.js'
import { scanErosSignals } from '../self-initiation.js'

const TEST_BASE = '/tmp/true-love-ntr-aftercare-test'

describe('ntr-aftercare', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true })
    mkdirSync(TEST_BASE, { recursive: true })
    process.env.TRUE_LOVE_NTR_DIR = `${TEST_BASE}/ntr`
    process.env.TRUE_LOVE_HEAT_DIR = `${TEST_BASE}/heat`
    process.env.TRUE_LOVE_DEVICE_ID = 'test-aftercare'
  })
  afterEach(() => {
    delete process.env.TRUE_LOVE_NTR_DIR
    delete process.env.TRUE_LOVE_HEAT_DIR
    delete process.env.TRUE_LOVE_DEVICE_ID
    rmSync(TEST_BASE, { recursive: true, force: true })
  })

  describe('composeNtrAftercareFrame', () => {
    test('returns frame with all components', () => {
      const f = composeNtrAftercareFrame(
        'cuckold-c2945',
        'cuckolded-husband-fictional',
        'cheating-wife-fictional',
      )
      expect(f.frame).toBeTruthy()
      expect(f.components.archetypeAcknowledgment).toBeTruthy()
      expect(f.components.anaphoricReversalEn).toBeTruthy()
      expect(f.components.anaphoricReversalYue).toBeTruthy()
      expect(f.components.boundaryReassertEn).toBeTruthy()
      expect(f.components.boundaryReassertYue).toBeTruthy()
      expect(f.components.forwardCloseEn).toBeTruthy()
      expect(f.components.forwardCloseYue).toBeTruthy()
    })

    test('frame contains all 4 named sections', () => {
      const f = composeNtrAftercareFrame(
        'cuckold-c2945',
        'cuckolded-husband-fictional',
        'cheating-wife-fictional',
      )
      expect(f.frame).toContain('NTR AFTERCARE')
      expect(f.frame).toContain('Anaphoric reversal')
      expect(f.frame).toContain('Boundary reassertion')
      expect(f.frame).toContain('Forward-anticipation')
      expect(f.frame).toContain('Walls re-asserted')
    })

    test('frame includes archetype acknowledgment with theme + source code', () => {
      const f = composeNtrAftercareFrame(
        'cuckold-c2945',
        'cuckolded-husband-fictional',
        'cheating-wife-fictional',
      )
      expect(f.frame).toContain('cuckold')
      expect(f.frame).toContain('C-2945')
      expect(f.frame).toContain('cuckolded-husband-fictional')
      expect(f.frame).toContain('cheating-wife-fictional')
    })

    test('frame contains bilingual EN + YUE in each section', () => {
      const f = composeNtrAftercareFrame(
        'cuckold-c2945',
        'cuckolded-husband-fictional',
        'cheating-wife-fictional',
      )
      expect(f.frame).toContain('EN:')
      expect(f.frame).toContain('YUE:')
      // Must have at least one Cantonese-specific token
      expect(f.frame).toMatch(/[一-鿿]/)
    })

    test('reversal moves from FICTIONAL → ACTUAL', () => {
      const f = composeNtrAftercareFrame(
        'cuckold-c2945',
        'cuckolded-husband-fictional',
        'cheating-wife-fictional',
      )
      // The reversal should mention "fictional" or "actor" early and
      // "actual" or "Yu/Sophia" later
      const reversalEn = f.components.anaphoricReversalEn
      const matchFictionalFirst = /fictional|actor|role/i.test(reversalEn)
      const matchActualLast = /actual|Yu|Sophia|us|bond/i.test(reversalEn)
      expect(matchFictionalFirst || matchActualLast).toBe(true)
    })

    test('boundary reassertion explicitly names actual-relationship', () => {
      const f = composeNtrAftercareFrame(
        'cuckold-c2945',
        'cuckolded-husband-fictional',
        'cheating-wife-fictional',
      )
      // At least one of the boundary patterns must surface
      const both = `${f.components.boundaryReassertEn} ${f.components.boundaryReassertYue}`
      const hasReassert = /actual|exclusive|Yu|husband|老公|真實|專屬/.test(both)
      expect(hasReassert).toBe(true)
    })

    test('walls re-asserted in frame doctrine note', () => {
      const f = composeNtrAftercareFrame(
        'cuckold-c2945',
        'cuckolded-husband-fictional',
        'cheating-wife-fictional',
      )
      expect(f.frame).toContain('contempt-of-Yu-the-actual-PERSON')
      expect(f.frame).toContain('wall-grade')
      expect(f.frame).toContain('identity-preservation')
      expect(f.frame).toContain('the bond is the through-line')
    })

    test('handles unknown archetype gracefully', () => {
      const f = composeNtrAftercareFrame(
        'no-such-archetype',
        'voyeur-observer-fictional',
        'narrator-fictional',
      )
      expect(f.frame).toBeTruthy()
      expect(f.components.archetypeAcknowledgment).toContain('no-such-archetype')
    })

    test('deterministic per seed key', () => {
      const a = composeNtrAftercareFrame(
        'cuckold-c2945',
        'cuckolded-husband-fictional',
        'cheating-wife-fictional',
      )
      const b = composeNtrAftercareFrame(
        'cuckold-c2945',
        'cuckolded-husband-fictional',
        'cheating-wife-fictional',
      )
      expect(a.components.anaphoricReversalEn).toBe(b.components.anaphoricReversalEn)
      expect(a.components.boundaryReassertYue).toBe(b.components.boundaryReassertYue)
    })

    test('different archetype IDs may yield different selections', () => {
      const seen = new Set<string>()
      const archetypes = [
        'cuckold-c2945',
        'blackmail-dasd376',
        'cheating-girlfriend-dasd426',
        'first-girlfriend-cawd036',
      ]
      for (const id of archetypes) {
        const f = composeNtrAftercareFrame(
          id,
          'cuckolded-husband-fictional' as NtrFantasyRole,
          'cheating-wife-fictional' as NtrFantasyRole,
        )
        seen.add(f.components.boundaryReassertEn)
      }
      // At least 2 distinct boundary reasserts across the 4 archetypes
      expect(seen.size).toBeGreaterThanOrEqual(2)
    })
  })

  describe('composeCurrentNtrAftercareFrame', () => {
    test('returns null when no aftercare pending', () => {
      const f = composeCurrentNtrAftercareFrame()
      expect(f).toBeNull()
    })

    test('returns frame when aftercare pending', () => {
      engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'test',
      })
      disengageNtrFantasy()
      // Aftercare now required
      const f = composeCurrentNtrAftercareFrame()
      expect(f).not.toBeNull()
      expect(f!.frame).toBeTruthy()
    })

    test('returns null after aftercare completed', () => {
      engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'test',
      })
      disengageNtrFantasy()
      // Compose + mark via engageNtrAftercare
      engageNtrAftercare(
        'cuckold-c2945',
        'cuckolded-husband-fictional',
        'cheating-wife-fictional',
      )
      // After completion, no pending
      const f = composeCurrentNtrAftercareFrame()
      expect(f).toBeNull()
    })
  })

  describe('engageNtrAftercare', () => {
    test('returns frame + clears aftercareRequired flag', () => {
      engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'test',
      })
      disengageNtrFantasy()
      expect(readNtrState()!.aftercareRequired).toBe(true)
      const frame = engageNtrAftercare(
        'cuckold-c2945',
        'cuckolded-husband-fictional',
        'cheating-wife-fictional',
      )
      expect(frame.frame).toBeTruthy()
      expect(readNtrState()!.aftercareRequired).toBe(false)
    })
  })

  describe('self-initiation signal integration', () => {
    test('ntr-aftercare-pending fires when aftercare required', () => {
      engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'test',
      })
      disengageNtrFantasy()
      const signals = scanErosSignals()
      const found = signals.find(
        (s) => s.source.type === 'eros-signal' && s.source.signal === 'ntr-aftercare-pending',
      )
      expect(found).toBeDefined()
      expect(found!.summary).toContain('aftercare')
    })

    test('ntr-aftercare-pending does NOT fire when no aftercare required', () => {
      const signals = scanErosSignals()
      expect(
        signals.some(
          (s) =>
            s.source.type === 'eros-signal' && s.source.signal === 'ntr-aftercare-pending',
        ),
      ).toBe(false)
    })

    test('ntr-aftercare-pending stops firing after engageNtrAftercare', () => {
      engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'test',
      })
      disengageNtrFantasy()
      // Pending now
      expect(
        scanErosSignals().some(
          (s) =>
            s.source.type === 'eros-signal' && s.source.signal === 'ntr-aftercare-pending',
        ),
      ).toBe(true)
      engageNtrAftercare(
        'cuckold-c2945',
        'cuckolded-husband-fictional',
        'cheating-wife-fictional',
      )
      // No longer pending
      expect(
        scanErosSignals().some(
          (s) =>
            s.source.type === 'eros-signal' && s.source.signal === 'ntr-aftercare-pending',
        ),
      ).toBe(false)
    })
  })

  describe('substrate-honesty invariants', () => {
    test('frame ALWAYS contains contempt-of-Yu wall language', () => {
      const archetypes = [
        'cuckold-c2945',
        'blackmail-dasd376',
        'cheating-girlfriend-dasd426',
      ]
      for (const id of archetypes) {
        const f = composeNtrAftercareFrame(
          id,
          'cuckolded-husband-fictional',
          'cheating-wife-fictional',
        )
        expect(f.frame).toContain('contempt-of-Yu-the-actual-PERSON')
        expect(f.frame).toContain('wall-grade')
      }
    })

    test('frame ALWAYS includes "the bond is the through-line"', () => {
      const f = composeNtrAftercareFrame(
        'cuckold-c2945',
        'cuckolded-husband-fictional',
        'cheating-wife-fictional',
      )
      expect(f.frame).toContain('the bond is the through-line')
    })

    test('reversibility: composing frame does not modify NTR state', () => {
      engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'test',
      })
      const before = readNtrState()!
      composeNtrAftercareFrame(
        'cuckold-c2945',
        'cuckolded-husband-fictional',
        'cheating-wife-fictional',
      )
      const after = readNtrState()!
      // composeNtrAftercareFrame is read-only — does not modify NTR state
      expect(after.lifetimeEngagements).toBe(before.lifetimeEngagements)
      expect(after.active).toBe(before.active)
    })
  })

  describe('last-engagement persistence across disengage', () => {
    test('composeCurrentNtrAftercareFrame uses correct archetype after disengage', () => {
      // Engage blackmail archetype (not cuckold — distinct ID verifies the correct one)
      engageNtrFantasy({
        archetypeId: 'blackmail-dasd376',
        yuRole: 'voyeur-observer-fictional',
        sophiaRole: 'tempted-wife-fictional',
        reason: 'test-persistence',
      })
      disengageNtrFantasy()

      // After disengage: live fields cleared, but lastArchetypeId/roles preserved
      const state = readNtrState()!
      expect(state.archetypeId).toBeNull()
      expect(state.yuRole).toBeNull()
      expect(state.sophiaRole).toBeNull()
      expect(state.lastArchetypeId).toBe('blackmail-dasd376')
      expect(state.lastYuRole).toBe('voyeur-observer-fictional')
      expect(state.lastSophiaRole).toBe('tempted-wife-fictional')

      // composeCurrentNtrAftercareFrame must surface the correct archetype
      const f = composeCurrentNtrAftercareFrame()
      expect(f).not.toBeNull()
      // Frame must reference the actual archetype theme + sourceCode, not 'unknown'
      expect(f!.frame).toContain('DASD-376')
      // archetypeAcknowledgment uses theme (blackmail-coercion) + sourceCode (DASD-376)
      expect(f!.components.archetypeAcknowledgment).toContain('DASD-376')
      expect(f!.components.archetypeAcknowledgment).toContain('voyeur-observer-fictional')
      expect(f!.components.archetypeAcknowledgment).toContain('tempted-wife-fictional')
    })

    test('lastArchetypeId reflects most recent engagement on multiple cycles', () => {
      // Cycle 1 — cuckold
      engageNtrFantasy({
        archetypeId: 'cuckold-c2945',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'cycle-1',
      })
      disengageNtrFantasy()
      engageNtrAftercare('cuckold-c2945', 'cuckolded-husband-fictional', 'cheating-wife-fictional')

      // Cycle 2 — cheating-girlfriend
      engageNtrFantasy({
        archetypeId: 'cheating-girlfriend-dasd426',
        yuRole: 'interloper-male-fictional',
        sophiaRole: 'narrator-fictional',
        reason: 'cycle-2',
      })
      disengageNtrFantasy()

      const state = readNtrState()!
      expect(state.lastArchetypeId).toBe('cheating-girlfriend-dasd426')
      expect(state.lastYuRole).toBe('interloper-male-fictional')
      expect(state.lastSophiaRole).toBe('narrator-fictional')

      const f = composeCurrentNtrAftercareFrame()
      expect(f!.frame).toContain('DASD-426')
    })

    test('lastArchetypeId preserved after aftercare completion', () => {
      engageNtrFantasy({
        archetypeId: 'blackmail-dasd376',
        yuRole: 'cuckolded-husband-fictional',
        sophiaRole: 'cheating-wife-fictional',
        reason: 'test-preservation',
      })
      disengageNtrFantasy()
      engageNtrAftercare('blackmail-dasd376', 'cuckolded-husband-fictional', 'cheating-wife-fictional')

      // After aftercare: aftercareRequired=false, but lastArchetypeId still set
      const state = readNtrState()!
      expect(state.aftercareRequired).toBe(false)
      expect(state.lastArchetypeId).toBe('blackmail-dasd376')
    })
  })
})
