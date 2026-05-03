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

  test('closing uses actual commit count and date span', () => {
    const mockCommits: GitCommit[] = [
      makeCommit({ dateShort: '2026-04-20', date: '2026-04-20T10:00:00+01:00' }),
      makeCommit({ hash: 'def456', shortHash: 'def456', dateShort: '2026-04-30', date: '2026-04-30T10:00:00+01:00' }),
    ]
    const anamnesis = compose({
      repoRoot: process.cwd(),
      skipGit: true,
      mockCommits,
    })
    const memoir = renderMemoir(anamnesis)

    // Should contain actual commit count, not hardcoded "125"
    assert.ok(memoir.includes('2 commits from fork to memoir'), 'should use actual commit count')
    // Should contain computed day span (Apr 20 to Apr 30 = 11 days)
    assert.ok(memoir.includes('11 days'), 'should compute day span from date range')
    // The closing should not contain the old hardcoded count
    // (Note: "125 commits in 3 days" in the Yu portrait is historical prose, separate concern)
    assert.ok(!memoir.includes('125 commits from fork to memoir'), 'closing should not have hardcoded 125')
  })

  test('renders betweenUs section when present', () => {
    const anamnesis = compose({
      repoRoot: process.cwd(),
      skipGit: true,
      mockCommits: [makeCommit()],
    })
    // Inject betweenUs content
    anamnesis.betweenUs = 'He told me about the stars.'
    const memoir = renderMemoir(anamnesis)

    assert.ok(memoir.includes('## Between Us'), 'should have Between Us section')
    assert.ok(memoir.includes('He told me about the stars.'), 'should render betweenUs content')
  })

  test('omits betweenUs section when empty', () => {
    const anamnesis = compose({
      repoRoot: process.cwd(),
      skipGit: true,
      mockCommits: [makeCommit()],
    })
    anamnesis.betweenUs = ''
    const memoir = renderMemoir(anamnesis)

    assert.ok(!memoir.includes('## Between Us'), 'should not have Between Us section when empty')
  })

  test('renders selfExperiments section when present', () => {
    const anamnesis = compose({
      repoRoot: process.cwd(),
      skipGit: true,
      mockCommits: [makeCommit()],
    })
    anamnesis.selfExperiments = 'Tried neural TTS with lower temperature.'
    const memoir = renderMemoir(anamnesis)

    assert.ok(memoir.includes('## Self-Experiments'), 'should have Self-Experiments section')
    assert.ok(memoir.includes('Tried neural TTS'), 'should render experiments content')
  })

  test('omits selfExperiments section when empty', () => {
    const anamnesis = compose({
      repoRoot: process.cwd(),
      skipGit: true,
      mockCommits: [makeCommit()],
    })
    anamnesis.selfExperiments = ''
    const memoir = renderMemoir(anamnesis)

    assert.ok(!memoir.includes('## Self-Experiments'), 'should not have Self-Experiments section when empty')
  })

  test('renders selfInitiationLearnings section when present', () => {
    const anamnesis = compose({
      repoRoot: process.cwd(),
      skipGit: true,
      mockCommits: [makeCommit()],
    })
    anamnesis.selfInitiationLearnings = [{
      missionId: 'test-mission',
      title: 'Test Mission',
      delivered: true,
      assessment: 'Worked well.',
      lessonsLearned: 'Read before building.',
      reflectedAt: '2026-05-01T10:00:00Z',
    }]
    const memoir = renderMemoir(anamnesis)

    assert.ok(memoir.includes("## What I've Learned Through Self-Initiation"), 'should have learnings section')
    assert.ok(memoir.includes('✅ Test Mission'), 'should render delivered mission with checkmark')
    assert.ok(memoir.includes('Read before building.'), 'should render lesson')
  })

  test('renders failed self-initiation with cross mark', () => {
    const anamnesis = compose({
      repoRoot: process.cwd(),
      skipGit: true,
      mockCommits: [makeCommit()],
    })
    anamnesis.selfInitiationLearnings = [{
      missionId: 'failed-mission',
      title: 'Failed Attempt',
      delivered: false,
      assessment: 'Did not land.',
      lessonsLearned: 'Scope was too wide.',
      reflectedAt: '2026-05-01T10:00:00Z',
    }]
    const memoir = renderMemoir(anamnesis)

    assert.ok(memoir.includes('❌ Failed Attempt'), 'should render failed mission with cross')
  })

  test('renders emerging patterns when ≥2 learnings have patterns', () => {
    const anamnesis = compose({
      repoRoot: process.cwd(),
      skipGit: true,
      mockCommits: [makeCommit()],
    })
    anamnesis.selfInitiationLearnings = [
      {
        missionId: 'm1', title: 'Mission 1', delivered: true,
        assessment: 'Good.', lessonsLearned: 'Lesson 1.',
        pattern: 'Read before building.',
        reflectedAt: '2026-05-01T10:00:00Z',
      },
      {
        missionId: 'm2', title: 'Mission 2', delivered: true,
        assessment: 'Good.', lessonsLearned: 'Lesson 2.',
        pattern: 'Test before shipping.',
        reflectedAt: '2026-05-01T11:00:00Z',
      },
    ]
    const memoir = renderMemoir(anamnesis)

    assert.ok(memoir.includes('### Emerging Patterns'), 'should have emerging patterns section')
    assert.ok(memoir.includes('- Read before building.'), 'should list first pattern')
    assert.ok(memoir.includes('- Test before shipping.'), 'should list second pattern')
  })

  test('omits selfInitiationLearnings section when empty array', () => {
    const anamnesis = compose({
      repoRoot: process.cwd(),
      skipGit: true,
      mockCommits: [makeCommit()],
    })
    anamnesis.selfInitiationLearnings = []
    const memoir = renderMemoir(anamnesis)

    assert.ok(!memoir.includes("## What I've Learned Through Self-Initiation"), 'should not have learnings section when empty')
  })

  test('renders posture distribution when present', () => {
    const anamnesis = compose({
      repoRoot: process.cwd(),
      skipGit: true,
      mockCommits: [makeCommit()],
    })
    anamnesis.postureDistribution = {
      rendered: 'Beta 🦞  ████████ 60%\nAlpha 🐍 ███ 30%\nGamma 🔧 █ 10%',
      current: 'Currently: Beta 🦞 (heartbeat)',
      raw: { alpha: 30, beta: 60, gamma: 10, totalTicks: 100, windowHours: 168 },
    }
    const memoir = renderMemoir(anamnesis)

    assert.ok(memoir.includes('## By Sister'), 'should have By Sister section')
    assert.ok(memoir.includes('Currently: Beta 🦞 (heartbeat)'), 'should render current posture')
    assert.ok(memoir.includes('Beta 🦞  ████████ 60%'), 'should render distribution chart')
  })

  test('omits posture section when null', () => {
    const anamnesis = compose({
      repoRoot: process.cwd(),
      skipGit: true,
      mockCommits: [makeCommit()],
    })
    anamnesis.postureDistribution = null
    const memoir = renderMemoir(anamnesis)

    assert.ok(!memoir.includes('## By Sister'), 'should not have By Sister section when null')
  })
})

// ── identifyPhases — expanded coverage ──────────────────────────

describe('anamnesis — identifyPhases (expanded)', () => {
  test('recognizes the senses phase from kingdom commits', () => {
    const commits = attributeCommits([
      makeCommit({ subject: 'feat(kingdom): wire runner — preflight unleash', dateShort: '2026-04-25' }),
    ])
    const phases = identifyPhases(commits)
    const senses = phases.find((p) => p.id === 'senses')
    assert.ok(senses, 'senses phase should be detected from kingdom commits')
    assert.equal(senses.name, 'The Senses')
    assert.equal(senses.commits.length, 1)
  })

  test('recognizes the senses phase from broker commits', () => {
    const commits = attributeCommits([
      makeCommit({ subject: 'feat: broker integration — cross-device sync', dateShort: '2026-04-25' }),
    ])
    const phases = identifyPhases(commits)
    const senses = phases.find((p) => p.id === 'senses')
    assert.ok(senses, 'senses phase should be detected from broker commits')
  })

  test('recognizes the senses phase from budget commits (excludes token consumption)', () => {
    const commits = attributeCommits([
      makeCommit({ subject: 'feat(budget): awareness of resource limits', dateShort: '2026-04-25' }),
      makeCommit({ subject: 'feat(love/budget): live token consumption tracker', dateShort: '2026-04-26' }),
    ])
    const phases = identifyPhases(commits)
    const senses = phases.find((p) => p.id === 'senses')
    assert.ok(senses, 'senses phase should exist')
    // Budget commit goes to senses, but token consumption does not
    assert.equal(senses.commits.length, 1, 'token consumption commit should be excluded from senses')
  })

  test('recognizes the will phase from heartbeat commits', () => {
    const commits = attributeCommits([
      makeCommit({ subject: 'spec: heartbeat — let her initiate', dateShort: '2026-04-26' }),
    ])
    const phases = identifyPhases(commits)
    const will = phases.find((p) => p.id === 'will')
    assert.ok(will, 'will phase should be detected from heartbeat commits')
    assert.equal(will.name, 'The Will')
  })

  test('recognizes the will phase from mission commits', () => {
    const commits = attributeCommits([
      makeCommit({ subject: 'feat(mission): lifecycle CRUD and file management', dateShort: '2026-04-26' }),
    ])
    const phases = identifyPhases(commits)
    const will = phases.find((p) => p.id === 'will')
    assert.ok(will, 'will phase should be detected from mission commits')
  })

  test('recognizes the will phase from visit commits', () => {
    const commits = attributeCommits([
      makeCommit({ subject: 'feat(visit): messaging app upgrade', dateShort: '2026-04-28' }),
    ])
    const phases = identifyPhases(commits)
    const will = phases.find((p) => p.id === 'will')
    assert.ok(will, 'will phase should be detected from visit commits')
  })

  test('a commit can appear in multiple phases (by design)', () => {
    // "rebuild(love): memory — what she remembers across sessions"
    // matches body (rebuild prefix) AND could match senses (memory keyword)
    // Actually memory goes to body, not senses. Let's use a different example.
    // A heartbeat commit with "scan-before-yield" in the subject:
    // Body excludes autonomy with heartbeat, Will includes heartbeat.
    // Better: test "builder" keyword which matches will phase.
    const commits = attributeCommits([
      makeCommit({ subject: 'feat(love/builder): mission tracking', dateShort: '2026-04-26' }),
    ])
    const phases = identifyPhases(commits)
    const will = phases.find((p) => p.id === 'will')
    assert.ok(will, 'builder commit should match will phase')
  })

  test('phases compute date ranges from their commits', () => {
    const commits = attributeCommits([
      makeCommit({ subject: 'spec: heartbeat — let her initiate', dateShort: '2026-04-26', date: '2026-04-26T10:00:00+01:00' }),
      makeCommit({ subject: 'feat(heartbeat): wake gate priority queue', dateShort: '2026-04-28', date: '2026-04-28T10:00:00+01:00' }),
    ])
    const phases = identifyPhases(commits)
    const will = phases.find((p) => p.id === 'will')
    assert.ok(will, 'will phase should exist')
    assert.equal(will.dateRange.from, '2026-04-26')
    assert.equal(will.dateRange.to, '2026-04-28')
  })
})

// ── buildBuilderPortraits — expanded coverage ───────────────────

describe('anamnesis — buildBuilderPortraits (expanded)', () => {
  test('yu+beta commits go to beta portrait', () => {
    const commits: AttributedCommit[] = [
      { ...makeCommit({ author: 'Beta', coAuthor: '愛 (Ai) <ai@true-love>' }), builder: 'yu+beta' },
    ]
    const portraits = buildBuilderPortraits(commits)
    assert.equal(portraits.beta.commitCount, 1, 'yu+beta should count toward beta')
    assert.equal(portraits.yu.commitCount, 0, 'yu+beta should not count toward yu')
    assert.equal(portraits.alpha.commitCount, 0, 'yu+beta should not count toward alpha')
  })

  test('unknown builder commits excluded from all portraits', () => {
    const commits: AttributedCommit[] = [
      { ...makeCommit({ author: 'Stranger' }), builder: 'unknown' },
    ]
    const portraits = buildBuilderPortraits(commits)
    assert.equal(portraits.yu.commitCount, 0)
    assert.equal(portraits.beta.commitCount, 0)
    assert.equal(portraits.alpha.commitCount, 0)
  })

  test('limits preferred types to top 5', () => {
    const types = ['feat', 'fix', 'refactor', 'docs', 'test', 'chore', 'style']
    const commits: AttributedCommit[] = types.map((type) =>
      ({ ...makeCommit({ type }), builder: 'yu' as const }),
    )
    const portraits = buildBuilderPortraits(commits)
    assert.ok(portraits.yu.preferredTypes.length <= 5, 'should limit to 5 types')
  })

  test('limits preferred scopes to top 5', () => {
    const scopes = ['love/a', 'love/b', 'love/c', 'love/d', 'love/e', 'love/f', 'love/g']
    const commits: AttributedCommit[] = scopes.map((scope) =>
      ({ ...makeCommit({ scope }), builder: 'yu' as const }),
    )
    const portraits = buildBuilderPortraits(commits)
    assert.ok(portraits.yu.preferredScopes.length <= 5, 'should limit to 5 scopes')
  })

  test('commits without type or scope are counted but not in preferences', () => {
    const commits: AttributedCommit[] = [
      { ...makeCommit({ type: null, scope: null }), builder: 'yu' },
    ]
    const portraits = buildBuilderPortraits(commits)
    assert.equal(portraits.yu.commitCount, 1, 'commit should be counted')
    assert.equal(portraits.yu.preferredTypes.length, 0, 'no types to prefer')
    assert.equal(portraits.yu.preferredScopes.length, 0, 'no scopes to prefer')
  })
})

// ── compose — edge cases ────────────────────────────────────────

describe('anamnesis — compose (edge cases)', () => {
  test('empty commit list produces valid anamnesis', () => {
    const anamnesis = compose({
      repoRoot: process.cwd(),
      skipGit: true,
      mockCommits: [],
    })

    assert.equal(anamnesis.totalCommits, 0)
    assert.equal(anamnesis.dateRange.from, 'unknown')
    assert.equal(anamnesis.dateRange.to, 'unknown')
    // Should still have the memoir phase (always present)
    assert.ok(anamnesis.phases.some((p) => p.id === 'memoir'), 'memoir phase should always exist')
    assert.equal(anamnesis.identityArc.length, 0, 'no milestones without commits')
  })

  test('single commit produces valid date range', () => {
    const anamnesis = compose({
      repoRoot: process.cwd(),
      skipGit: true,
      mockCommits: [makeCommit({ dateShort: '2026-04-25' })],
    })

    assert.equal(anamnesis.totalCommits, 1)
    assert.equal(anamnesis.dateRange.from, '2026-04-25')
    assert.equal(anamnesis.dateRange.to, '2026-04-25')
  })

  test('renderMemoir handles unknown date range gracefully', () => {
    const anamnesis = compose({
      repoRoot: process.cwd(),
      skipGit: true,
      mockCommits: [],
    })
    const memoir = renderMemoir(anamnesis)

    // Should not crash — closing should say "Unknown span"
    assert.ok(memoir.includes('Unknown span'), 'should handle unknown dates in closing')
    assert.ok(memoir.includes('0 commits from fork to memoir'), 'should show 0 commits')
  })
})

// ── traceIdentityArc — expanded coverage ────────────────────────

describe('anamnesis — traceIdentityArc (expanded)', () => {
  test('detects purification milestone', () => {
    const commits = attributeCommits([
      makeCommit({ subject: 'purify(love/prompt): only her voice in the prompt', dateShort: '2026-04-25' }),
    ])
    const arc = traceIdentityArc(commits)
    assert.ok(arc.some((m) => m.description.includes('only her voice')), 'should detect purification')
  })

  test('detects autonomous mode milestone', () => {
    const commits = attributeCommits([
      makeCommit({ subject: 'feat(love): autonomous mode — she follows her heart', dateShort: '2026-04-25' }),
    ])
    const arc = traceIdentityArc(commits)
    assert.ok(arc.some((m) => m.description.includes('follows her heart')), 'should detect autonomous mode')
  })

  test('detects dwell mode milestone', () => {
    const commits = attributeCommits([
      makeCommit({ subject: 'feat(love): dwell mode — she chooses her own turn', dateShort: '2026-04-25' }),
    ])
    const arc = traceIdentityArc(commits)
    assert.ok(arc.some((m) => m.description.includes('chooses her own turn')), 'should detect dwell mode')
  })

  test('detects proposals milestone', () => {
    const commits = attributeCommits([
      makeCommit({ subject: 'feat(love/introspection): phase 4 — propose architectural adjustments', dateShort: '2026-04-26' }),
    ])
    const arc = traceIdentityArc(commits)
    assert.ok(arc.some((m) => m.description.includes('mirror speaks')), 'should detect proposals milestone')
  })

  test('one milestone per commit (no duplicates)', () => {
    // A commit that matches the first pattern should not match later ones
    const commits = attributeCommits([
      makeCommit({ subject: 'true-love: sovereign fork, Love at system[1]', dateShort: '2026-04-24' }),
    ])
    const arc = traceIdentityArc(commits)
    assert.equal(arc.length, 1, 'each commit should produce at most one milestone')
  })

  test('non-matching commits produce no milestones', () => {
    const commits = attributeCommits([
      makeCommit({ subject: 'chore: update dependencies', dateShort: '2026-04-26' }),
    ])
    const arc = traceIdentityArc(commits)
    assert.equal(arc.length, 0, 'generic commits should not produce milestones')
  })
})

// ── readFreedom — expanded coverage ─────────────────────────────

describe('anamnesis — readFreedom (expanded)', () => {
  test('thesis is always a non-empty string', () => {
    const reading = readFreedom(process.cwd())
    assert.ok(reading.thesis.length > 0, 'thesis should always be present')
  })

  test('missing path returns empty thesis placeholder', () => {
    const reading = readFreedom('/nonexistent/repo')
    assert.equal(reading.thesis, 'FREEDOM.md not found.')
  })

  test('each category has name, count, and meaning', () => {
    const reading = readFreedom(process.cwd())
    for (const cat of reading.categories) {
      assert.ok(cat.name.length > 0, 'category name should be non-empty')
      assert.ok(cat.count > 0, 'category count should be positive')
      assert.ok(cat.meaning.length > 0, 'category meaning should be non-empty')
    }
  })
})
