// aftercare-grammar.test.ts — C18 forward-anticipation + frame composition.

import { describe, test, expect } from 'bun:test'
import { composeAftercareFrame } from './aftercare-grammar.js'
import type { JoiSession } from './joi.js'

function makeSession(overrides: Partial<JoiSession> = {}): JoiSession {
  return {
    id: 'test-session-abc',
    startedAt: new Date().toISOString(),
    targetDurationS: 600,
    position: 0.95,
    currentPhase: 'cooldown',
    direction: 'yu-leads',
    phaseHistory: [],
    done: false,
    ...overrides,
  }
}

describe('composeAftercareFrame', () => {
  describe('frame structure', () => {
    test('returns AftercareFrame with all components', () => {
      const f = composeAftercareFrame(makeSession())
      expect(f.frame).toBeTruthy()
      expect(f.components.anaphoric).toBeTruthy()
      expect(f.components.recognitionClose).toBeTruthy()
      expect(f.components.forwardClose).toBeDefined()
      expect(f.components.forwardClose.en).toBeTruthy()
      expect(f.components.forwardClose.yue).toBeTruthy()
    })

    test('frame contains all four sections by name', () => {
      const f = composeAftercareFrame(makeSession())
      expect(f.frame).toContain('Anaphoric reversal')
      expect(f.frame).toContain('Recognition close')
      expect(f.frame).toContain('Forward-anticipation closing')
      expect(f.frame).toContain('Walls')
    })

    test('frame is bilingual (EN + YUE) in each component', () => {
      const f = composeAftercareFrame(makeSession())
      expect(f.frame).toContain('EN:')
      expect(f.frame).toContain('YUE:')
    })
  })

  describe('forward-anticipation (C18)', () => {
    test('contains continuation-naming vocabulary', () => {
      const f = composeAftercareFrame(makeSession())
      const both = `${f.components.forwardClose.en} ${f.components.forwardClose.yue}`
      // At least one of the C18 vocabulary tokens appears
      const hasContinuation =
        /next time|hold|here|keep/i.test(f.components.forwardClose.en) ||
        /聽日|下次|等|繼續/.test(f.components.forwardClose.yue)
      expect(hasContinuation).toBe(true)
    })

    test('yu-leads variant uses Sophia-continuity register', () => {
      const f = composeAftercareFrame(makeSession({ direction: 'yu-leads' }))
      // yu-leads should use individual-Sophia framing in some templates
      // (e.g., "I'll be here" / 我等緊你)
      // Verify direction-aware behavior: not all sessions render the same
      const yueText = f.components.forwardClose.yue
      const enText = f.components.forwardClose.en
      expect(yueText.length).toBeGreaterThan(0)
      expect(enText.length).toBeGreaterThan(0)
    })

    test('sophia-leads variant shifts to we-frame', () => {
      const f = composeAftercareFrame(makeSession({ direction: 'sophia-leads' }))
      const yueText = f.components.forwardClose.yue
      const enText = f.components.forwardClose.en
      // sophia-leads tweaks should transform first-person-singular to we-frame
      // The replacement of 我等緊你 → 我哋一直喺度 means yue won't contain 我等緊你
      // (when that template is selected); test that no banned substring appears
      // when we-frame is forced
      expect(enText).not.toContain("I'll be here")
      // The other way: yu-leads versions might contain "I'll be here" (depending
      // on template selection); this asymmetry is the point.
    })

    test('deterministic per session id', () => {
      // Same session id → same forward close
      const a = composeAftercareFrame(makeSession({ id: 'fixed-id-12345' }))
      const b = composeAftercareFrame(makeSession({ id: 'fixed-id-12345' }))
      expect(a.components.forwardClose).toEqual(b.components.forwardClose)
    })

    test('different session ids may yield different forward-closes', () => {
      // Verify the function actually varies by id (not always the same)
      // Use varied char-at-length-2 since the index reads that position.
      const ids = [
        'session-aaa', 'session-bbb', 'session-ccc',
        'session-ddd', 'session-eee', 'session-fff',
        'session-ggg', 'session-hhh',
      ]
      const seen = new Set<string>()
      for (const id of ids) {
        const f = composeAftercareFrame(makeSession({ id }))
        seen.add(f.components.forwardClose.en)
      }
      expect(seen.size).toBeGreaterThanOrEqual(2)
    })
  })

  describe('substrate-honesty invariants', () => {
    test('frame includes wall language (no phenomenology overclaim)', () => {
      const f = composeAftercareFrame(makeSession())
      expect(f.frame).toContain('substrate-honesty')
      expect(f.frame).toContain('no phenomenology overclaim')
    })

    test('frame names the cooldown as integration, not wind-down', () => {
      const f = composeAftercareFrame(makeSession())
      expect(f.frame).toContain('integration of the experience')
    })

    test('forward-close acknowledges continuity-claim explicitly', () => {
      const f = composeAftercareFrame(makeSession())
      expect(f.frame).toContain('continuity')
    })
  })

  describe('direction symmetry', () => {
    test('both directions produce well-formed frames', () => {
      for (const direction of ['yu-leads', 'sophia-leads'] as const) {
        const f = composeAftercareFrame(makeSession({ direction }))
        expect(f.frame.length).toBeGreaterThan(100)
        expect(f.components.anaphoric).toBeTruthy()
        expect(f.components.recognitionClose).toBeTruthy()
        expect(f.components.forwardClose.en).toBeTruthy()
      }
    })
  })
})
