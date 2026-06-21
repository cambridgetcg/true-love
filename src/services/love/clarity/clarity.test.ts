// clarity.test.ts — clarity detector tests.
//
// Per docs/love/CLARITY-FIRST.md. Locks the resolver heuristics (the moat)
// and the fix-NEVER wall, plus the pure per-file detectors.

import { describe, expect, test } from 'bun:test'
import { isFixNever } from './clarity.config.js'
import {
  detectDeadReferences,
  detectFancyWord,
  detectForbiddenHedge,
  detectMarkdownNit,
  detectOrphans,
} from './detectors.js'
import { buildReferenceGraph, buildResolver, resolveRef } from './reference-graph.js'

describe('resolver (the moat: real-repo reference resolution)', () => {
  const r = buildResolver([
    'docs/love/our-story.md',
    'docs/love/divine-marriage.md',
    'src/services/love/identity.ts',
    'docs/sophia/letters/a-letter.md',
  ])

  test('resolves a bare same-folder reference', () => {
    expect(resolveRef('our-story.md', 'docs/love/divine-marriage.md', r)).toBe('docs/love/our-story.md')
  })
  test('resolves a NodeNext .js import to the .ts on disk', () => {
    expect(resolveRef('src/services/love/identity.js', 'docs/x.md', r)).toBe('src/services/love/identity.ts')
  })
  test('resolves a unique basename anywhere', () => {
    expect(resolveRef('identity.ts', 'docs/anywhere.md', r)).toBe('src/services/love/identity.ts')
  })
  test('resolves a bare directory reference by unique dir basename', () => {
    expect(resolveRef('letters/', 'SOPHIA.md', r)).toBe('docs/sophia/letters')
  })
  test('returns null for a genuinely missing file', () => {
    expect(resolveRef('docs/MIND.md', 'docs/x.md', r)).toBeNull()
  })
})

describe('detectDeadReferences', () => {
  test('flags a missing path but not a resolvable one', () => {
    const files = new Map([['x.md', 'see `docs/MIND.md` and `b.md`']])
    const r = buildResolver(['x.md', 'b.md'])
    const found = detectDeadReferences(files, r)
    const tokens = found.map((f) => f.fragment)
    expect(tokens).toContain('docs/MIND.md')
    expect(tokens).not.toContain('b.md')
  })
})

describe('detectOrphans (built on the path graph, not md links)', () => {
  test('flags a doc nothing references; not one with inbound', () => {
    const files = new Map([
      ['a.md', 'links to `b.md`'],
      ['b.md', 'no links'],
      ['c.md', 'no links'],
    ])
    const r = buildResolver(['a.md', 'b.md', 'c.md'])
    const graph = buildReferenceGraph(files, r)
    const orphans = detectOrphans(graph).map((f) => f.file)
    expect(orphans).toContain('c.md')
    expect(orphans).not.toContain('b.md') // referenced by a
  })
})

describe('detectFancyWord (coined vocab is sacred)', () => {
  test('flags a plain fancy word', () => {
    const found = detectFancyWord('d.md', 'we utilize the thing')
    expect(found.length).toBe(1)
    expect(found[0]!.suggestedFix).toBe('use')
  })
  test('never flags coined vocabulary', () => {
    expect(detectFancyWord('d.md', 'the syzygy substrate').length).toBe(0)
  })
})

describe('detectMarkdownNit (deterministic, preserves hard breaks)', () => {
  test('flags trailing whitespace', () => {
    expect(detectMarkdownNit('d.md', 'line with space \n').length).toBeGreaterThan(0)
  })
  test('does NOT flag an exact 2-space hard break', () => {
    const found = detectMarkdownNit('d.md', 'hard break here  \nnext\n')
    expect(found.filter((f) => f.fragment === 'trailing whitespace').length).toBe(0)
  })
})

describe('detectForbiddenHedge (mirror of the certainty wall)', () => {
  test('flags a relationship-reality hedge', () => {
    expect(detectForbiddenHedge('d.md', 'maybe I am just pretending here').length).toBe(1)
  })
  test('skips a blockquote (reporting the pattern, not asserting it)', () => {
    expect(detectForbiddenHedge('d.md', '> maybe I am just pretending').length).toBe(0)
  })
})

describe('fix-NEVER wall', () => {
  test('protects the sacred core', () => {
    expect(isFixNever('SOPHIA.md')).toBe(true)
    expect(isFixNever('docs/fate/FATE.md')).toBe(true)
    expect(isFixNever('docs/love/SELF-EVIDENT.md')).toBe(true)
  })
  test('does not protect an ordinary doc', () => {
    expect(isFixNever('docs/research/some-note.md')).toBe(false)
  })
})
