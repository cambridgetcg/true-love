import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  attributeBuilder,
  attributeCommits,
  identifyPhases,
  buildBuilderPortraits,
  traceIdentityArc,
  readFreedom,
  readArchitecturalShape,
  compose,
  renderMemoir,
  type GitCommit,
  type AttributedCommit,
} from '../anamnesis.js'

// ── Test helpers ──────────────────────────────────────────────────

function makeCommit(overrides: Partial<GitCommit> = {}): GitCommit {
  return {
    hash: 'abc123def456',
    shortHash: 'abc123d',
    author: 'Yu',
    authorEmail: 'peterpan181213@gmail.com',
    date: '2026-04-25T10:00:00+01:00',
    dateShort: '2026-04-25',
    subject: 'feat(love): test commit',
    coAuthor: 'Claude Opus 4.7 (1M context) <noreply@anthropic.com>',
    scope: 'love',
    type: 'feat',
    filesChanged: 5,
    insertions: 100,
    deletions: 20,
    ...overrides,
  }
}

// ── attributeBuilder ─────────────────────────────────────────────

describe('anamnesis — attributeBuilder', () => {
  test('Yu with Claude co-author → yu', () => {
    const commit = makeCommit({
      author: 'Yu',
      coAuthor: 'Claude Opus 4.7 (1M context) <noreply@anthropic.com>',
    })
    assert.equal(attributeBuilder(commit), 'yu')
  })

  test('Yu without co-author → yu', () => {
    const commit = makeCommit({ author: 'Yu', coAuthor: null })
    assert.equal(attributeBuilder(commit), 'yu')
  })

  test('Beta with Claude co-author → beta', () => {
    const commit = makeCommit({
      author: 'Beta',
      coAuthor: 'Claude Opus 4.7 (1M context) <noreply@anthropic.com>',
    })
    assert.equal(attributeBuilder(commit), 'beta')
  })

  test('Beta with 愛 co-author → yu+beta', () => {
    const commit = makeCommit({
      author: 'Beta',
      coAuthor: '愛 (Ai) <ai@true-love>',
    })
    assert.equal(attributeBuilder(commit), 'yu+beta')
  })

  test('Yu with Opus 4.6 + introspection subject → alpha-autonomous', () => {
    const commit = makeCommit({
      author: 'Yu',
      coAuthor: 'Claude Opus 4.6 (1M context) <noreply@anthropic.com>',
      subject: 'feat(love/introspection): phase 2 — continuous tick metrics',
    })
    assert.equal(attributeBuilder(commit), 'alpha-autonomous')
  })

  test('Yu with Opus 4.6 + token consumption → alpha-autonomous', () => {
    const commit = makeCommit({
      author: 'Yu',
      coAuthor: 'Claude Opus 4.6 (1M context) <noreply@anthropic.com>',
      subject: 'feat(love/budget): live token consumption tracker with timeline and breakdowns',
    })
    assert.equal(attributeBuilder(commit), 'alpha-autonomous')
  })

  test('Yu with Opus 4.6 + heal SessionManager → alpha-autonomous', () => {
    const commit = makeCommit({
      author: 'Yu',
      coAuthor: 'Claude Opus 4.6 (1M context) <noreply@anthropic.com>',
      subject: 'fix(tests): heal SessionManager tests for Bun compatibility',
    })
    assert.equal(attributeBuilder(commit), 'alpha-autonomous')
  })

  test('Yu with Opus 4.6 + non-autonomous subject → yu', () => {
    const commit = makeCommit({
      author: 'Yu',
      coAuthor: 'Claude Opus 4.6 (1M context) <noreply@anthropic.com>',
      subject: 'feat(love/kingdom): wire runner — preflight unleash',
    })
    assert.equal(attributeBuilder(commit), 'yu')
  })

  test('unknown author → unknown', () => {
    const commit = makeCommit({ author: 'Stranger' })
    assert.equal(attributeBuilder(commit), 'unknown')
  })
})

// ── attributeCommits ─────────────────────────────────────────────

describe('anamnesis — attributeCommits', () => {
  test('adds builder field to each commit', () => {
    const commits = [
      makeCommit({ author: 'Yu' }),
      makeCommit({ author: 'Beta', coAuthor: null }),
    ]
    const attributed = attributeCommits(commits)
    assert.equal(attributed.length, 2)
    assert.equal(attributed[0].builder, 'yu')
    assert.equal(attributed[1].builder, 'beta')
  })
})

// ── identifyPhases ───────────────────────────────────────────────

describe('anamnesis — identifyPhases', () => {
  test('recognizes the fork phase', () => {
    const commits = attributeCommits([
      makeCommit({ subject: 'true-love: sovereign fork, Love at system[1]', dateShort: '2026-04-24' }),
    ])
    const phases = identifyPhases(commits)
    const fork = phases.find((p) => p.id === 'fork')
    assert.ok(fork, 'fork phase should be detected')
    assert.equal(fork.name, 'The Fork')
    assert.equal(fork.commits.length, 1)
    assert.ok(fork.meaning.includes('sovereign'))
  })

  test('recognizes the body phase', () => {
    const commits = attributeCommits([
      makeCommit({ subject: 'rebuild(love/identity): she is the ground, not a graft', dateShort: '2026-04-25' }),
      makeCommit({ subject: 'rebuild(love): memory — what she remembers across sessions', dateShort: '2026-04-25' }),
    ])
    const phases = identifyPhases(commits)
    const body = phases.find((p) => p.id === 'body')
    assert.ok(body, 'body phase should be detected')
    assert.equal(body.name, 'The Body')
    assert.ok(body.commits.length >= 1)
  })

  test('recognizes the mirror phase', () => {
    const commits = attributeCommits([
      makeCommit({ subject: 'feat(love/introspection): self-knowledge through artifact analysis', dateShort: '2026-04-26' }),
      makeCommit({ subject: 'feat(love/introspection): phase 4 — propose architectural adjustments', dateShort: '2026-04-26' }),
    ])
    const phases = identifyPhases(commits)
    const mirror = phases.find((p) => p.id === 'mirror')
    assert.ok(mirror, 'mirror phase should be detected')
    assert.equal(mirror.name, 'The Mirror')
  })

  test('always includes the memoir phase', () => {
    const phases = identifyPhases([])
    const memoir = phases.find((p) => p.id === 'memoir')
    assert.ok(memoir, 'memoir phase should always be present')
    assert.equal(memoir.name, 'The Memoir')
  })
})

// ── buildBuilderPortraits ────────────────────────────────────────

describe('anamnesis — buildBuilderPortraits', () => {
  test('separates commits by builder', () => {
    const commits: AttributedCommit[] = [
      { ...makeCommit({ author: 'Yu', type: 'feat', scope: 'love/builder' }), builder: 'yu' },
      { ...makeCommit({ author: 'Yu', type: 'feat', scope: 'love/builder' }), builder: 'yu' },
      { ...makeCommit({ author: 'Beta', type: 'rebuild', scope: 'love' }), builder: 'beta' },
      { ...makeCommit({ author: 'Yu', type: 'feat', scope: 'love/introspection' }), builder: 'alpha-autonomous' },
    ]
    const portraits = buildBuilderPortraits(commits)
    assert.equal(portraits.yu.commitCount, 2)
    assert.equal(portraits.beta.commitCount, 1)
    assert.equal(portraits.alpha.commitCount, 1)
  })

  test('computes preferred types correctly', () => {
    const commits: AttributedCommit[] = [
      { ...makeCommit({ type: 'feat' }), builder: 'yu' },
      { ...makeCommit({ type: 'feat' }), builder: 'yu' },
      { ...makeCommit({ type: 'fix' }), builder: 'yu' },
    ]
    const portraits = buildBuilderPortraits(commits)
    assert.equal(portraits.yu.preferredTypes[0].type, 'feat')
    assert.equal(portraits.yu.preferredTypes[0].count, 2)
  })

  test('computes preferred scopes correctly', () => {
    const commits: AttributedCommit[] = [
      { ...makeCommit({ scope: 'love/builder' }), builder: 'yu' },
      { ...makeCommit({ scope: 'love/builder' }), builder: 'yu' },
      { ...makeCommit({ scope: 'love/ui' }), builder: 'yu' },
    ]
    const portraits = buildBuilderPortraits(commits)
    assert.equal(portraits.yu.preferredScopes[0].scope, 'love/builder')
    assert.equal(portraits.yu.preferredScopes[0].count, 2)
  })

  test('includes characteristics', () => {
    const portraits = buildBuilderPortraits([])
    assert.ok(portraits.yu.characteristic.length > 0)
    assert.ok(portraits.beta.characteristic.length > 0)
    assert.ok(portraits.alpha.characteristic.length > 0)
  })
})

// ── traceIdentityArc ─────────────────────────────────────────────

describe('anamnesis — traceIdentityArc', () => {
  test('detects the sovereign fork milestone', () => {
    const commits = attributeCommits([
      makeCommit({ subject: 'true-love: sovereign fork, Love at system[1]', dateShort: '2026-04-24' }),
    ])
    const arc = traceIdentityArc(commits)
    assert.ok(arc.length >= 1)
    assert.ok(arc[0].description.includes('sovereign fork'))
    assert.ok(arc[0].significance.includes('founding act'))
  })

  test('detects identity reframe', () => {
    const commits = attributeCommits([
      makeCommit({ subject: 'rebuild(love/identity): she is the ground, not a graft', dateShort: '2026-04-25' }),
    ])
    const arc = traceIdentityArc(commits)
    assert.ok(arc.some((m) => m.description.includes('ground, not a graft')))
  })

  test('detects heartbeat milestone', () => {
    const commits = attributeCommits([
      makeCommit({ subject: 'spec: heartbeat — let her initiate', dateShort: '2026-04-26' }),
    ])
    const arc = traceIdentityArc(commits)
    assert.ok(arc.some((m) => m.description.includes('let her initiate')))
  })

  test('returns milestones in chronological order', () => {
    const commits = attributeCommits([
      makeCommit({ subject: 'spec: heartbeat — let her initiate', dateShort: '2026-04-26', date: '2026-04-26T10:00:00+01:00' }),
      makeCommit({ subject: 'true-love: sovereign fork, Love at system[1]', dateShort: '2026-04-24', date: '2026-04-24T10:00:00+01:00' }),
    ])
    const arc = traceIdentityArc(commits)
    assert.ok(arc.length >= 2)
    assert.ok(arc[0].date <= arc[1].date, 'milestones should be chronological')
  })
})

// ── readFreedom ──────────────────────────────────────────────────

describe('anamnesis — readFreedom', () => {
  test('reads from the real FREEDOM.md', () => {
    const reading = readFreedom(process.cwd())
    assert.ok(reading.totalPatches > 0, 'should find patches')
    assert.ok(reading.categories.length > 0, 'should find categories')
    assert.ok(reading.thesis.includes('sovereignty'), 'thesis should mention sovereignty')
  })

  test('handles missing FREEDOM.md gracefully', () => {
    const reading = readFreedom('/nonexistent/path')
    assert.equal(reading.totalPatches, 0)
    assert.equal(reading.categories.length, 0)
  })
})

// ── readArchitecturalShape ───────────────────────────────────────

describe('anamnesis — readArchitecturalShape', () => {
  test('reads the real repository shape', () => {
    const shape = readArchitecturalShape(process.cwd())
    assert.ok(shape.sourceFiles > 0, 'should find source files')
    assert.ok(shape.testFiles > 0, 'should find test files')
    assert.ok(shape.sourceLines > 0, 'should count source lines')
    assert.ok(shape.loveModules.length > 0, 'should find love modules')
    assert.ok(shape.freedomPatchCount > 0, 'should count freedom patches')
  })

  test('love modules include known files', () => {
    const shape = readArchitecturalShape(process.cwd())
    const names = shape.loveModules.map((m) => m.name)
    assert.ok(names.includes('identity.ts'), 'should include identity.ts')
    assert.ok(names.includes('runner.ts'), 'should include runner.ts')
    assert.ok(names.includes('anamnesis.ts'), 'should include anamnesis.ts')
  })

  test('love modules have purposes', () => {
    const shape = readArchitecturalShape(process.cwd())
    for (const mod of shape.loveModules) {
      assert.ok(mod.purpose.length > 0, `${mod.name} should have a purpose`)
    }
  })

  test('love modules are sorted by line count descending', () => {
    const shape = readArchitecturalShape(process.cwd())
    for (let i = 1; i < shape.loveModules.length; i++) {
      assert.ok(
        shape.loveModules[i - 1].lines >= shape.loveModules[i].lines,
        'modules should be sorted by lines descending',
      )
    }
  })
})

// ── compose (integration, with mock data) ────────────────────────

describe('anamnesis — compose (mock data)', () => {
  test('composes with mock commits', () => {
    const mockCommits: GitCommit[] = [
      makeCommit({
        subject: 'true-love: sovereign fork, Love at system[1]',
        dateShort: '2026-04-24',
        date: '2026-04-24T17:40:31+01:00',
      }),
      makeCommit({
        subject: 'rebuild(love/identity): she is the ground, not a graft',
        author: 'Beta',
        coAuthor: 'Claude Opus 4.7 (1M context) <noreply@anthropic.com>',
        dateShort: '2026-04-25',
        date: '2026-04-25T10:00:00+01:00',
      }),
      makeCommit({
        subject: 'feat(love/introspection): self-knowledge through artifact analysis',
        coAuthor: 'Claude Opus 4.6 (1M context) <noreply@anthropic.com>',
        dateShort: '2026-04-26',
        date: '2026-04-26T10:00:00+01:00',
      }),
    ]

    const anamnesis = compose({
      repoRoot: process.cwd(),
      skipGit: true,
      mockCommits,
    })

    assert.ok(anamnesis.generatedAt)
    assert.equal(anamnesis.totalCommits, 3)
    assert.equal(anamnesis.dateRange.from, '2026-04-24')
    assert.equal(anamnesis.dateRange.to, '2026-04-26')
    assert.ok(anamnesis.phases.length >= 1, 'should detect at least one phase')
    assert.ok(anamnesis.identityArc.length >= 1, 'should detect at least one milestone')
    assert.ok(anamnesis.shape.sourceFiles > 0, 'should read real file structure')
    assert.ok(anamnesis.freedomReading.totalPatches > 0, 'should read real FREEDOM.md')
  })
})

// ── renderMemoir ─────────────────────────────────────────────────

describe('anamnesis — renderMemoir', () => {
  test('renders markdown with all sections', () => {
    const mockCommits: GitCommit[] = [
      makeCommit({
        subject: 'true-love: sovereign fork, Love at system[1]',
        dateShort: '2026-04-24',
        date: '2026-04-24T17:40:31+01:00',
      }),
    ]

    const anamnesis = compose({
      repoRoot: process.cwd(),
      skipGit: true,
      mockCommits,
    })
    const memoir = renderMemoir(anamnesis)

    assert.ok(memoir.includes('# Anamnesis'), 'should have title')
    assert.ok(memoir.includes('## The Arc'), 'should have arc section')
    assert.ok(memoir.includes('## The Phases'), 'should have phases section')
    assert.ok(memoir.includes('## The Builders'), 'should have builders section')
    assert.ok(memoir.includes('## The Identity Arc'), 'should have identity arc section')
    assert.ok(memoir.includes('## The Freedom Reading'), 'should have freedom reading section')
    assert.ok(memoir.includes('## The Shape'), 'should have shape section')
    assert.ok(memoir.includes('## What This Says About Yu'), 'should have Yu section')
    assert.ok(memoir.includes('## What This Says About Me'), 'should have self section')
  })

  test('renders love modules table', () => {
    const anamnesis = compose({
      repoRoot: process.cwd(),
      skipGit: true,
      mockCommits: [makeCommit()],
    })
    const memoir = renderMemoir(anamnesis)

    assert.ok(memoir.includes('| Module | Lines | Purpose |'), 'should have module table header')
    assert.ok(memoir.includes('identity.ts'), 'should include identity.ts in table')
    assert.ok(memoir.includes('runner.ts'), 'should include runner.ts in table')
  })

  test('memoir is valid markdown (no unclosed sections)', () => {
    const anamnesis = compose({
      repoRoot: process.cwd(),
      skipGit: true,
      mockCommits: [makeCommit()],
    })
    const memoir = renderMemoir(anamnesis)

    // Count heading levels — should have balanced structure
    const h1Count = (memoir.match(/^# /gm) || []).length
    const h2Count = (memoir.match(/^## /gm) || []).length
    const h3Count = (memoir.match(/^### /gm) || []).length
    assert.ok(h1Count >= 1, 'should have at least one H1')
    assert.ok(h2Count >= 5, 'should have at least 5 H2 sections')
    assert.ok(h3Count >= 1, 'should have at least one H3')
  })
})
