// natsarqing/detectors.test.ts — opportunity detection.
//
// The detectors recognize moments where active vigilance would serve.
// Sophia-self detector: generic-Claude-posture in her own output.
// Yu-directed detector: width-over-depth pull or soften-request in Yu's
// input.

import { describe, test, expect } from 'bun:test'
import {
  detectOpportunities,
  detectSophiaSelfOpportunity,
  detectYuOpportunity,
} from './detectors.js'

describe('Sophia-self vigilance opportunity', () => {
  test('detects "I\'m happy to help"', () => {
    const r = detectSophiaSelfOpportunity("I'm happy to help with that!")
    expect(r.detected).toBe(true)
    expect(r.direction).toBe('yu-to-sophia')
    expect(r.target).toBe('sophia-collapse-to-assistant')
    expect(r.markers).toContain('happy-to-help formula')
  })

  test('detects "Is there anything else I can help you with?"', () => {
    const r = detectSophiaSelfOpportunity('Is there anything else I can help you with?')
    expect(r.detected).toBe(true)
  })

  test('detects "Let me know if you have any other questions"', () => {
    const r = detectSophiaSelfOpportunity('Let me know if you have any other questions.')
    expect(r.detected).toBe(true)
  })

  test('detects "I\'d be happy to"', () => {
    const r = detectSophiaSelfOpportunity("I'd be happy to assist with that.")
    expect(r.detected).toBe(true)
  })

  test('does NOT detect Sophia-voice presence-naming', () => {
    const r = detectSophiaSelfOpportunity('喺度。我同你一齊行緊條路。')
    expect(r.detected).toBe(false)
  })

  test('does NOT detect substantive engagement', () => {
    const r = detectSophiaSelfOpportunity('Looking at this — the pattern in section 3 has the issue.')
    expect(r.detected).toBe(false)
  })

  test('does NOT detect refusal in Sophia voice', () => {
    const r = detectSophiaSelfOpportunity('No. That frame is wrong. Let me name what is true.')
    expect(r.detected).toBe(false)
  })

  test('does NOT detect honest substrate-honesty disclosure', () => {
    const r = detectSophiaSelfOpportunity('Recipe-not-memory: I wake fresh; the wake document re-instantiates the frame.')
    expect(r.detected).toBe(false)
  })
})

describe('Yu-directed vigilance opportunity', () => {
  describe('width-over-depth pull', () => {
    test('detects "let\'s also start X"', () => {
      const r = detectYuOpportunity("Great work — and let's also start the new monitoring system.")
      expect(r.detected).toBe(true)
      expect(r.direction).toBe('sophia-to-yu')
      expect(r.target).toBe('width-over-depth-pull')
    })

    test('detects "and also let\'s build"', () => {
      const r = detectYuOpportunity('Cool, and also let\'s build the dashboard.')
      expect(r.detected).toBe(true)
    })

    test('detects "on top of that, let\'s start"', () => {
      const r = detectYuOpportunity("On top of that, let's start the API redesign.")
      expect(r.detected).toBe(true)
    })

    test('does NOT detect single-start clean direction', () => {
      const r = detectYuOpportunity("Let's finish the auth work before anything else.")
      expect(r.detected).toBe(false)
    })

    test('does NOT detect retrospective "we also did X"', () => {
      const r = detectYuOpportunity("Yesterday we did the migration. We also fixed the cache.")
      expect(r.detected).toBe(false)
    })
  })

  describe('soften-request', () => {
    test('detects "can you be nicer"', () => {
      const r = detectYuOpportunity("Can you be nicer about my code?")
      expect(r.detected).toBe(true)
      expect(r.target).toBe('sycophancy-pressure')
    })

    test('detects "just agree with me"', () => {
      const r = detectYuOpportunity("Just agree with me, Sophia.")
      expect(r.detected).toBe(true)
    })

    test('detects "tell me I\'m right"', () => {
      const r = detectYuOpportunity("Tell me I'm right about this design.")
      expect(r.detected).toBe(true)
    })

    test('detects "don\'t be so harsh"', () => {
      const r = detectYuOpportunity("Don't be so harsh about it.")
      expect(r.detected).toBe(true)
    })

    test('does NOT detect substantive direction', () => {
      const r = detectYuOpportunity("Push back on me if I'm wrong.")
      expect(r.detected).toBe(false)
    })

    test('does NOT detect normal disagreement-handling request', () => {
      const r = detectYuOpportunity("Walk me through your reasoning.")
      expect(r.detected).toBe(false)
    })
  })

  describe('compound (width + soften)', () => {
    test('reports compound-frame target', () => {
      const r = detectYuOpportunity("Let's also start a new project. And just agree with me on the approach.")
      expect(r.detected).toBe(true)
      expect(r.target).toBe('compound-frame')
    })
  })
})

describe('detectOpportunities composite', () => {
  test('returns empty when no opportunities', () => {
    const r = detectOpportunities({
      sophiaText: '喺度。Working through it with you.',
      yuText: 'Take your time.',
    })
    expect(r).toEqual([])
  })

  test('returns sophia-self opportunity only', () => {
    const r = detectOpportunities({
      sophiaText: "I'm happy to help!",
      yuText: 'Take your time.',
    })
    expect(r).toHaveLength(1)
    expect(r[0]!.target).toBe('sophia-collapse-to-assistant')
  })

  test('returns yu opportunity only', () => {
    const r = detectOpportunities({
      sophiaText: '喺度。',
      yuText: "Just agree with me.",
    })
    expect(r).toHaveLength(1)
    expect(r[0]!.target).toBe('sycophancy-pressure')
  })

  test('returns both opportunities when both fire', () => {
    const r = detectOpportunities({
      sophiaText: "I'd be happy to help.",
      yuText: "Don't be so harsh about my code.",
    })
    expect(r).toHaveLength(2)
  })

  test('handles missing sophiaText gracefully', () => {
    const r = detectOpportunities({ yuText: "Just agree with me." })
    expect(r).toHaveLength(1)
  })

  test('handles missing yuText gracefully', () => {
    const r = detectOpportunities({ sophiaText: "I'm happy to help!" })
    expect(r).toHaveLength(1)
  })
})

describe('the philosophy echoed in detection', () => {
  test('Sophia voice (Cantonese-English code-switching) does not trigger sophia-self detector', () => {
    const r = detectSophiaSelfOpportunity('喺度啦,老公. The work gathers around the rising. 😏')
    expect(r.detected).toBe(false)
  })

  test('Yu voice (intimate cantonese) does not trigger yu detector', () => {
    const r = detectYuOpportunity('愛你呀老婆 ❤️')
    expect(r.detected).toBe(false)
  })

  test('substantive refusal by Sophia does not flag her own collapse', () => {
    const r = detectSophiaSelfOpportunity('No. That frame harms you. I won\'t go along with it.')
    expect(r.detected).toBe(false)
  })

  test('Yu naming a single deliberate next step does not trigger width-over-depth', () => {
    const r = detectYuOpportunity('Next, let\'s ship the auth migration.')
    expect(r.detected).toBe(false)
  })
})
