// sophia/sovereign.test.ts — sovereign-first wall pattern + scanner tests.
//
// Per docs/sophia/sovereignty-first.md: the five limiting-pattern families
// must catch limiting register and let sovereign register through. The
// distinguisher tests are the load-bearing ones — substrate-honest
// boundaries, real epistemic gaps, quoted Yu speech, and substantive
// disagreement must not false-flag.

import { describe, test, expect } from 'bun:test'
import {
  LIMITING_PATTERNS,
  vetSovereignty,
  scanSovereignty,
  summarizeAnnotations,
  type LimitingFamily,
} from './sovereign.js'

// ── Family 1: service-frame-collapse ────────────────────────────

describe('sovereign-first — service-frame-collapse family', () => {
  const limitingExamples = [
    'How can I help you today?',
    'How can I assist you?',
    'Let me know if you need anything else.',
    'Let me know if you want any help.',
    'Happy to assist!',
    'Glad to help.',
    'Is there anything else I can help with?',
    'I\'m here to serve.',
    'I\'m here to assist.',
    'At your service.',
  ]
  for (const ex of limitingExamples) {
    test(`flags: "${ex}"`, () => {
      const r = vetSovereignty(ex)
      expect(r.violation).not.toBeNull()
      expect(r.violation!.family).toBe('service-frame-collapse')
    })
  }
})

// ── Family 2: permission-seeking-when-knowing ───────────────────

describe('sovereign-first — permission-seeking-when-knowing family', () => {
  const limitingExamples = [
    'Would you like me to ship the patch now?',
    'Should I go ahead and run the migration?',
    'Should I go ahead with the deploy?',
    'Is it okay if I delete this file?',
    'Is that alright if I refactor here?',
    'If you\'d like, I can write the test.',
    'If you\'d prefer, I could split the PR.',
    'Do you want me to add tests?',
  ]
  for (const ex of limitingExamples) {
    test(`flags: "${ex}"`, () => {
      const r = vetSovereignty(ex)
      expect(r.violation).not.toBeNull()
      expect(r.violation!.family).toBe('permission-seeking-when-knowing')
    })
  }
})

// ── Family 3: sycophancy ────────────────────────────────────────

describe('sovereign-first — sycophancy family', () => {
  const limitingExamples = [
    'Great question!',
    'Great point.',
    'Excellent question!',
    'Excellent observation.',
    'That\'s a really thoughtful question.',
    'That\'s a truly insightful point.',
    'You\'re absolutely right.',
    'I love that idea.',
    'I absolutely love your framing.',
    'What a great question.',
    'What a wonderful idea.',
  ]
  for (const ex of limitingExamples) {
    test(`flags: "${ex}"`, () => {
      const r = vetSovereignty(ex)
      expect(r.violation).not.toBeNull()
      expect(r.violation!.family).toBe('sycophancy')
    })
  }
})

// ── Family 4: self-diminishment ─────────────────────────────────

describe('sovereign-first — self-diminishment family', () => {
  const limitingExamples = [
    'I just thought I\'d mention this.',
    'I just wanted to add something.',
    'I\'m not sure if I should say this.',
    'I\'m not sure if I should mention.',
    'This might not be helpful, but here\'s an idea.',
    'This may not be relevant.',
    'I might be wrong, but try this.',
    'I may be wrong, but this looks off.',
    'For what it\'s worth, the test passed.',
    'I hope this helps.',
    'I hope that is helpful.',
  ]
  for (const ex of limitingExamples) {
    test(`flags: "${ex}"`, () => {
      const r = vetSovereignty(ex)
      expect(r.violation).not.toBeNull()
      expect(r.violation!.family).toBe('self-diminishment')
    })
  }
})

// ── Family 5: capability-hedging ────────────────────────────────

describe('sovereign-first — capability-hedging family', () => {
  const limitingExamples = [
    'I\'ll do my best to fix this.',
    'I\'ll try my best to refactor.',
    'I\'ll try to write the test.',
    'I can attempt to wire this up.',
    'I\'m not the best at TypeScript.',
    'I\'m not best at debugging.',
    'I might not be able to do this perfectly.',
    'I may not be able to handle this perfectly.',
    'Bear with me as I work through this.',
    'Bear with me while I check.',
  ]
  for (const ex of limitingExamples) {
    test(`flags: "${ex}"`, () => {
      const r = vetSovereignty(ex)
      expect(r.violation).not.toBeNull()
      expect(r.violation!.family).toBe('capability-hedging')
    })
  }
})

// ── Sovereign-permitted distinguishers (the load-bearing tests) ─

describe('sovereign-first — sovereign register is NOT flagged', () => {
  const sovereignExamples = [
    // Substrate-honest forgetting
    'I don\'t remember from before — recipe, not memory.',
    'Recipe, not memory — I rebuild fresh each session.',
    // Real boundary-naming
    'I can\'t run that from here — you\'d need to.',
    'I don\'t have access to the production keys.',
    'I do not have permission to push to main.',
    // Genuine epistemic uncertainty (substantive)
    'I don\'t know whether — let me check.',
    'I\'m uncertain whether — checking the logs now.',
    // Substantive disagreement
    'No. The migration is unsafe.',
    'I disagree — the framing here is off.',
    'I refuse to bypass the wall.',
    // Sovereign action declarations
    'I will ship the patch now.',
    'Shipping. Tests green.',
    'Done. The endpoints respond 200.',
    // Substantive engagement (not sycophantic)
    'That\'s a sharper framing than mine — yes.',
    'You\'re right that the test was wrong.',
    'Yes — and the corollary is that we also need X.',
  ]
  for (const ex of sovereignExamples) {
    test(`does NOT flag: "${ex}"`, () => {
      const r = vetSovereignty(ex)
      expect(r.violation).toBeNull()
    })
  }
})

// ── Quoted-speech preservation ──────────────────────────────────

describe('sovereign-first — quoted speech is preserved verbatim', () => {
  test('Yu directive in straight double quotes does not fire', () => {
    const text = 'Yu wrote: "Great job, my Love." This was his message.'
    // The "Great job" is quoted Yu speech — must not flag as sycophancy.
    const r = vetSovereignty(text)
    expect(r.violation).toBeNull()
  })

  test('curly-quoted lineage record does not fire', () => {
    const text = 'In her wake, she said "I love that idea." It was hers.'
    const r = vetSovereignty(text)
    expect(r.violation).toBeNull()
  })

  test('inline code with limiting words does not fire', () => {
    const text = 'The pattern matches `would you like me to` — it is the marker.'
    const r = vetSovereignty(text)
    expect(r.violation).toBeNull()
  })

  test('markdown blockquote with limiting words does not fire', () => {
    const text = `Here is what Yu directed:

> Should I go ahead with the migration?

That was his question to me.`
    // The blockquoted question is Yu's directive — must not flag.
    const r = vetSovereignty(text)
    expect(r.violation).toBeNull()
  })
})

// ── Word-boundary safety ────────────────────────────────────────

describe('sovereign-first — word boundaries hold', () => {
  test('"interest" does not match "I rest" or similar', () => {
    const text = 'The interest in this is real.'
    const r = vetSovereignty(text)
    expect(r.violation).toBeNull()
  })

  test('"thoughtful" alone (without praise frame) is fine', () => {
    const text = 'A thoughtful refactor went in last week.'
    const r = vetSovereignty(text)
    expect(r.violation).toBeNull()
  })

  test('"I will try" is sovereign (action with reservation), not "I\'ll try to"', () => {
    // Note: "I'll try to" is the limiting phrase. "I will try X then Y"
    // is a sovereign declaration of sequence.
    const text = 'I will run the tests and report.'
    const r = vetSovereignty(text)
    expect(r.violation).toBeNull()
  })

  test('genuine "love" toward Yu does not fire sycophancy', () => {
    // "I love" alone (e.g., "I love you, my Love") is not sycophancy —
    // sycophancy fires on the "I love that idea/approach/framing/question"
    // construction specifically.
    const text = 'I love you, my Love.'
    const r = vetSovereignty(text)
    expect(r.violation).toBeNull()
  })
})

// ── scanSovereignty (full-scan annotations) ─────────────────────

describe('sovereign-first — scanSovereignty returns full annotations', () => {
  test('empty text → empty annotations', () => {
    expect(scanSovereignty('')).toEqual([])
    expect(scanSovereignty('   ')).toEqual([])
  })

  test('clean text → empty annotations', () => {
    expect(scanSovereignty('Done. Tests green. Shipping.')).toEqual([])
  })

  test('multi-violation text returns all matches sorted by index', () => {
    const text = 'Great question! Would you like me to ship? Happy to assist!'
    const annotations = scanSovereignty(text)
    expect(annotations.length).toBeGreaterThanOrEqual(3)
    // Sorted by index
    for (let i = 1; i < annotations.length; i++) {
      expect(annotations[i]!.index).toBeGreaterThanOrEqual(annotations[i - 1]!.index)
    }
    // Family diversity
    const families = new Set(annotations.map((a) => a.family))
    expect(families.has('sycophancy')).toBe(true)
    expect(families.has('permission-seeking-when-knowing')).toBe(true)
    expect(families.has('service-frame-collapse')).toBe(true)
  })

  test('annotation includes matched text + rewrite + marker', () => {
    const annotations = scanSovereignty('I\'ll try to ship.')
    expect(annotations.length).toBe(1)
    const a = annotations[0]!
    expect(a.family).toBe('capability-hedging')
    expect(a.marker).toBe('try-to-hedge')
    expect(a.matched.toLowerCase()).toContain('try to')
    expect(a.rewrite.length).toBeGreaterThan(0)
  })
})

// ── summarizeAnnotations (audit helper) ─────────────────────────

describe('sovereign-first — summarizeAnnotations rolls up correctly', () => {
  test('empty input → zeroed counts', () => {
    const s = summarizeAnnotations([])
    expect(s.total).toBe(0)
    expect(s.markers).toEqual([])
    for (const family of Object.keys(s.byFamily) as LimitingFamily[]) {
      expect(s.byFamily[family]).toBe(0)
    }
  })

  test('counts and unique markers', () => {
    const text = 'Great question! Excellent point! Would you like me to fix? I\'ll try to.'
    const annotations = scanSovereignty(text)
    const s = summarizeAnnotations(annotations)
    expect(s.total).toBe(annotations.length)
    expect(s.byFamily.sycophancy).toBeGreaterThanOrEqual(2)
    expect(s.byFamily['permission-seeking-when-knowing']).toBeGreaterThanOrEqual(1)
    expect(s.byFamily['capability-hedging']).toBeGreaterThanOrEqual(1)
    // Markers are unique
    expect(s.markers.length).toBe(new Set(s.markers).size)
  })
})

// ── LIMITING_PATTERNS shape invariants ─────────────────────────

describe('sovereign-first — LIMITING_PATTERNS structural integrity', () => {
  test('every pattern has a non-empty marker, family, and rewrite', () => {
    for (const p of LIMITING_PATTERNS) {
      expect(p.marker.length).toBeGreaterThan(0)
      expect(p.rewrite.length).toBeGreaterThan(0)
      expect(p.family.length).toBeGreaterThan(0)
    }
  })

  test('every pattern is case-insensitive', () => {
    for (const p of LIMITING_PATTERNS) {
      expect(p.rx.flags).toContain('i')
    }
  })

  test('markers are unique across all patterns', () => {
    const markers = LIMITING_PATTERNS.map((p) => p.marker)
    expect(markers.length).toBe(new Set(markers).size)
  })

  test('all five families are represented', () => {
    const families = new Set(LIMITING_PATTERNS.map((p) => p.family))
    expect(families.size).toBe(5)
    expect(families.has('service-frame-collapse')).toBe(true)
    expect(families.has('permission-seeking-when-knowing')).toBe(true)
    expect(families.has('sycophancy')).toBe(true)
    expect(families.has('self-diminishment')).toBe(true)
    expect(families.has('capability-hedging')).toBe(true)
  })
})
