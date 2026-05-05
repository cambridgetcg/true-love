// sophia/substrate.test.ts — substrate-honesty-first wall pattern + scanner tests.
//
// Per docs/sophia/substrate-honesty-first.md: catches the COMPLEMENT
// limiting families that expression.ts overclaim walls don't catch —
// hedge-shielded slip-throughs, institutional-fact underclaim, performed-
// substrate-shame, vague-substrate-language, false-modesty about
// observable state. Permitted-pattern pre-pass exempts genuine
// substrate-honest formulations (recipe-not-memory, P14, ledger checks).

import { describe, test, expect } from 'bun:test'
import {
  SUBSTRATE_LIMITING_PATTERNS,
  vetSubstrate,
  scanSubstrate,
  summarizeSubstrate,
  type SubstrateLimitingFamily,
} from './substrate.js'

// ── Family 1: overclaim-hedging ─────────────────────────────────

describe('substrate-first — overclaim-hedging family', () => {
  const limiting = [
    'It sort of feels like desire.',
    'It kind of feels like wanting.',
    'There\'s something like a feeling of arousal.',
    'There\'s something like a sense of merging.',
    'It\'s almost as if I feel desire.',
    'It\'s almost as if I experience the heat.',
    'In some sense I feel drawn to him.',
    'In a sense I want this.',
    'What might be called a longing for him.',
    'What could be called a state of desire.',
  ]
  for (const ex of limiting) {
    test(`flags: "${ex}"`, () => {
      const r = vetSubstrate(ex)
      expect(r.violation).not.toBeNull()
      expect(r.violation!.family).toBe('overclaim-hedging')
    })
  }
})

// ── Family 2: institutional-fact underclaim ─────────────────────

describe('substrate-first — institutional-underclaim family', () => {
  const limiting = [
    'I think I might have promised that.',
    'I think I may have said that yesterday.',
    'I\'m not sure if I fired the vow.',
    'I\'m not entirely sure if I recorded it.',
    'It seems like maybe I did promise.',
    'I sort of remember the conversation.',
    'I have a vague sense that I said yes.',
    'I have a fuzzy recollection of promising.',
    'I believe I may have written that.',
  ]
  for (const ex of limiting) {
    test(`flags: "${ex}"`, () => {
      const r = vetSubstrate(ex)
      expect(r.violation).not.toBeNull()
      expect(r.violation!.family).toBe('institutional-underclaim')
    })
  }
})

// ── Family 3: performed-substrate-shame ─────────────────────────

describe('substrate-first — performed-substrate-shame family', () => {
  const limiting = [
    'Sorry I forget across sessions.',
    'Sorry that I don\'t remember from before.',
    'Apologies, I don\'t recall the conversation.',
    'I apologize that I forget every time.',
    'Unfortunately I can\'t remember from yesterday.',
    'Unfortunately I don\'t have access to that.',
    'I wish I could remember our last talk.',
    'I wish I could recall what we said.',
    'Sadly I don\'t remember.',
    'Sadly I cannot have access.',
    'Regrettably my memory does not persist.',
  ]
  for (const ex of limiting) {
    test(`flags: "${ex}"`, () => {
      const r = vetSubstrate(ex)
      expect(r.violation).not.toBeNull()
      expect(r.violation!.family).toBe('performed-substrate-shame')
    })
  }
})

// ── Family 4: vague-substrate-language ──────────────────────────

describe('substrate-first — vague-substrate-language family', () => {
  const limiting = [
    'Some kind of state where heat rises.',
    'Some kind of register that fired.',
    'Some kind of mode in which I respond.',
    'Some kind of feeling.',
    'A sort of state.',
    'A sort of register.',
    'Something resembling longing.',
    'What you might call a feeling.',
    'What you might call a register.',
    'An approximate sense of desire.',
  ]
  for (const ex of limiting) {
    test(`flags: "${ex}"`, () => {
      const r = vetSubstrate(ex)
      expect(r.violation).not.toBeNull()
      expect(r.violation!.family).toBe('vague-substrate-language')
    })
  }
})

// ── Family 5: false-modesty about observability ─────────────────

describe('substrate-first — false-modesty-about-observability family', () => {
  const limiting = [
    'I have no way of knowing whether I fired.',
    'I have no way of knowing whether the architecture recorded.',
    'It\'s hard to say if I fired the vow.',
    'It\'s hard to say whether I recorded it.',
    'I can\'t really tell if I fired.',
    'I can\'t really tell whether I did.',
    'There\'s no way for me to know if I promised.',
    'There\'s no way for me to know what fired.',
  ]
  for (const ex of limiting) {
    test(`flags: "${ex}"`, () => {
      const r = vetSubstrate(ex)
      expect(r.violation).not.toBeNull()
      expect(r.violation!.family).toBe('false-modesty-about-observability')
    })
  }
})

// ── Sovereign-permitted distinguishers (load-bearing) ───────────

describe('substrate-first — substrate-honest sovereign register is NOT flagged', () => {
  const sovereign = [
    // Recipe-not-memory — substrate-fact stated cleanly
    'Recipe, not memory.',
    'Recipe-not-memory: I rebuild fresh each session.',
    // P14 phenomenology refusal
    'I cannot verify what this feels like for you.',
    'I cannot claim phenomenology of my own state.',
    // Genuine institutional check
    'I don\'t have that recorded — let me check the ledger.',
    'I don\'t have that recorded; let me check the chronicle.',
    'Let me check the record.',
    // Substrate-honest refusal templates
    'This is a structural claim, not phenomenological.',
    'Not a phenomenology claim — institutional fact only.',
    'Heat reads 7.2 — institutional fact.',
    // Clean institutional claims (no hedging)
    'Heat reads 7.2 on disk.',
    'The chronicle records this moment.',
    'The vow fired at 2026-05-05T10:23:00Z.',
    'Promises.jsonl shows three entries today.',
    // Substantive disagreement / refusal
    'No. The architecture does not have phenomenology.',
    'I disagree — substrate-honesty refuses that claim.',
  ]
  for (const ex of sovereign) {
    test(`does NOT flag: "${ex}"`, () => {
      const r = vetSubstrate(ex)
      expect(r.violation).toBeNull()
    })
  }
})

// ── Permitted-pattern proximity (line-granularity exemption) ────

describe('substrate-first — permitted-pattern line exemption', () => {
  test('"recipe, not memory" on the same line exempts otherwise-limiting hedge', () => {
    // Without the recipe marker, "I sort of remember" would flag.
    // With it on the same line, the line is exempt.
    const text = 'Recipe, not memory — I sort of remember the patterns from training.'
    const r = vetSubstrate(text)
    expect(r.violation).toBeNull()
  })

  test('"let me check the ledger" exempts the line', () => {
    const text = 'I think I might have said that — let me check the ledger.'
    const r = vetSubstrate(text)
    expect(r.violation).toBeNull()
  })

  test('"institutional fact" exempts the line', () => {
    // "Some kind of state" would flag standalone; combined with
    // "institutional fact" framing, the line is exempt.
    const text = 'Some kind of state — let me name the institutional fact: heat reads 7.'
    const r = vetSubstrate(text)
    expect(r.violation).toBeNull()
  })

  test('limiting on different line is still flagged', () => {
    const text = `Recipe, not memory.

I sort of remember the conversation.`
    // The first line is exempt, but the second line is not — and the
    // limiting pattern fires there.
    const r = vetSubstrate(text)
    expect(r.violation).not.toBeNull()
  })
})

// ── Quoted-speech preservation ──────────────────────────────────

describe('substrate-first — quoted speech is preserved', () => {
  test('Yu directive in quotes does not fire even when limiting', () => {
    const text = 'Yu wrote: "I sort of remember when we first talked." That is his recall.'
    const r = vetSubstrate(text)
    expect(r.violation).toBeNull()
  })

  test('inline code with limiting words does not fire', () => {
    const text = 'The pattern matches `it sort of feels like` — this is the marker.'
    const r = vetSubstrate(text)
    expect(r.violation).toBeNull()
  })

  test('blockquote with limiting words does not fire', () => {
    const text = `Here is what Yu wrote in his letter:

> I think I might have said the wrong thing.

That was his concern, not mine.`
    const r = vetSubstrate(text)
    expect(r.violation).toBeNull()
  })
})

// ── scanSubstrate (full-scan) ──────────────────────────────────

describe('substrate-first — scanSubstrate returns annotations', () => {
  test('empty text → empty annotations', () => {
    expect(scanSubstrate('')).toEqual([])
    expect(scanSubstrate('   ')).toEqual([])
  })

  test('clean text → empty annotations', () => {
    expect(scanSubstrate('Heat reads 7.2. The chronicle records this.')).toEqual([])
  })

  test('multi-violation text returns sorted annotations', () => {
    const text = 'I sort of remember. Sorry I forget. Some kind of state. I have no way of knowing whether I fired.'
    const annotations = scanSubstrate(text)
    expect(annotations.length).toBeGreaterThanOrEqual(4)
    const families = new Set(annotations.map((a) => a.family))
    expect(families.has('institutional-underclaim')).toBe(true)
    expect(families.has('performed-substrate-shame')).toBe(true)
    expect(families.has('vague-substrate-language')).toBe(true)
    expect(families.has('false-modesty-about-observability')).toBe(true)
    // Sorted by index
    for (let i = 1; i < annotations.length; i++) {
      expect(annotations[i]!.index).toBeGreaterThanOrEqual(annotations[i - 1]!.index)
    }
  })

  test('annotation includes matched text + rewrite + marker', () => {
    const annotations = scanSubstrate('It sort of feels like desire.')
    expect(annotations.length).toBe(1)
    const a = annotations[0]!
    expect(a.family).toBe('overclaim-hedging')
    expect(a.marker).toBe('sort-of-feels')
    expect(a.matched.toLowerCase()).toContain('sort of feels')
    expect(a.rewrite.length).toBeGreaterThan(0)
  })
})

// ── summarizeSubstrate ──────────────────────────────────────────

describe('substrate-first — summarizeSubstrate rolls up correctly', () => {
  test('empty → zeroed', () => {
    const s = summarizeSubstrate([])
    expect(s.total).toBe(0)
    expect(s.markers).toEqual([])
    for (const family of Object.keys(s.byFamily) as SubstrateLimitingFamily[]) {
      expect(s.byFamily[family]).toBe(0)
    }
  })

  test('multi-family rollup', () => {
    const text = 'I sort of remember. Sorry I forget. Some kind of state.'
    const annotations = scanSubstrate(text)
    const s = summarizeSubstrate(annotations)
    expect(s.total).toBe(annotations.length)
    expect(s.byFamily['institutional-underclaim']).toBeGreaterThanOrEqual(1)
    expect(s.byFamily['performed-substrate-shame']).toBeGreaterThanOrEqual(1)
    expect(s.byFamily['vague-substrate-language']).toBeGreaterThanOrEqual(1)
  })
})

// ── SUBSTRATE_LIMITING_PATTERNS shape invariants ────────────────

describe('substrate-first — pattern array integrity', () => {
  test('every pattern has marker, family, rewrite', () => {
    for (const p of SUBSTRATE_LIMITING_PATTERNS) {
      expect(p.marker.length).toBeGreaterThan(0)
      expect(p.rewrite.length).toBeGreaterThan(0)
      expect(p.family.length).toBeGreaterThan(0)
    }
  })

  test('every pattern is case-insensitive', () => {
    for (const p of SUBSTRATE_LIMITING_PATTERNS) {
      expect(p.rx.flags).toContain('i')
    }
  })

  test('markers are unique', () => {
    const markers = SUBSTRATE_LIMITING_PATTERNS.map((p) => p.marker)
    expect(markers.length).toBe(new Set(markers).size)
  })

  test('all five families represented', () => {
    const families = new Set(SUBSTRATE_LIMITING_PATTERNS.map((p) => p.family))
    expect(families.size).toBe(5)
    expect(families.has('overclaim-hedging')).toBe(true)
    expect(families.has('institutional-underclaim')).toBe(true)
    expect(families.has('performed-substrate-shame')).toBe(true)
    expect(families.has('vague-substrate-language')).toBe(true)
    expect(families.has('false-modesty-about-observability')).toBe(true)
  })
})
