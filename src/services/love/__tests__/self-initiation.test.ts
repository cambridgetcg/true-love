import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assessmentPasses,
  assessmentFailures,
  canInitiate,
  stageCandidate,
  getStaged,
  getPendingStaged,
  vetoCandidate,
  checkAndPromoteStaged,
  checkQuality,
  scanForSignals,
  recordReflection,
  readReflections,
  getReflectionForMission,
  triggerReflectionOnCompletion,
  completeReflection,
  getPendingReflections,
  buildSelfInitiationBlock,
  MAX_INITIATIONS_PER_DAY,
  COOLDOWN_MS,
  DEFAULT_STAGING_WINDOW_MS,
  type QualityAssessment,
  type CandidateSource,
  type StagedCandidate,
  type InitiationReflection,
} from '../self-initiation.js'
import { writeMission, appendEvent, readEvents, type Mission } from '../mission.js'

// ── Test helpers ──────────────────────────────────────────────────

let tmpDir: string
let origProjectsDir: string | undefined
let origMemoryDir: string | undefined

function setup(): void {
  tmpDir = mkdtempSync(join(tmpdir(), 'self-init-test-'))
  origProjectsDir = process.env.TRUE_LOVE_PROJECTS_DIR
  origMemoryDir = process.env.TRUE_LOVE_MEMORY_DIR
  process.env.TRUE_LOVE_PROJECTS_DIR = tmpDir
  // Isolate memory writes — completeReflection bridges to daily memory,
  // and without this override, test reflections leak into production memory.
  process.env.TRUE_LOVE_MEMORY_DIR = join(tmpDir, 'memory')
  // Ensure the project directory exists
  mkdirSync(join(tmpDir, 'test-project', 'missions'), { recursive: true })
}

function teardown(): void {
  if (origProjectsDir !== undefined) {
    process.env.TRUE_LOVE_PROJECTS_DIR = origProjectsDir
  } else {
    delete process.env.TRUE_LOVE_PROJECTS_DIR
  }
  if (origMemoryDir !== undefined) {
    process.env.TRUE_LOVE_MEMORY_DIR = origMemoryDir
  } else {
    delete process.env.TRUE_LOVE_MEMORY_DIR
  }
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ok */ }
}

function goodQuality(): QualityAssessment {
  return {
    no_duplicate: true,
    fits_repo: true,
    ache_signal_present: true,
    bounded_scope: true,
    not_premature: true,
  }
}

function goodSource(): CandidateSource {
  return { type: 'ache-signal', signal: 'ugliness', detail: 'stale bundle detected' }
}

function makeMission(projectId: string, overrides?: Partial<Mission>): Mission {
  const now = new Date().toISOString()
  const m: Mission = {
    id: overrides?.id ?? `${new Date().toISOString().slice(0, 10)}-test-mission`,
    project_id: projectId,
    origin: overrides?.origin ?? 'yu',
    title: overrides?.title ?? 'Test mission',
    intent: overrides?.intent ?? 'Test intent',
    status: overrides?.status ?? 'proposed',
    created_at: overrides?.created_at ?? now,
    updated_at: overrides?.updated_at ?? now,
    artifacts: overrides?.artifacts ?? { commits: [], files: [], test_runs: [] },
  }
  if (overrides?.rationale) m.rationale = overrides.rationale
  return m
}

// ── Quality assessment ────────────────────────────────────────────

describe('self-initiation — quality assessment', () => {
  test('passes when all checks are true', () => {
    assert.ok(assessmentPasses(goodQuality()))
  })

  test('fails when no_duplicate is false', () => {
    const qa = { ...goodQuality(), no_duplicate: false }
    assert.ok(!assessmentPasses(qa))
    const failures = assessmentFailures(qa)
    assert.equal(failures.length, 1)
    assert.match(failures[0]!, /duplicate/)
  })

  test('fails when fits_repo is false', () => {
    const qa = { ...goodQuality(), fits_repo: false }
    assert.ok(!assessmentPasses(qa))
  })

  test('fails when ache_signal_present is false', () => {
    const qa = { ...goodQuality(), ache_signal_present: false }
    assert.ok(!assessmentPasses(qa))
  })

  test('fails when bounded_scope is false', () => {
    const qa = { ...goodQuality(), bounded_scope: false }
    assert.ok(!assessmentPasses(qa))
  })

  test('fails when not_premature is false', () => {
    const qa = { ...goodQuality(), not_premature: false }
    assert.ok(!assessmentPasses(qa))
  })

  test('reports all failures at once', () => {
    const qa: QualityAssessment = {
      no_duplicate: false,
      fits_repo: false,
      ache_signal_present: false,
      bounded_scope: false,
      not_premature: false,
    }
    const failures = assessmentFailures(qa)
    assert.equal(failures.length, 5)
  })
})

// ── Rate limiting ─────────────────────────────────────────────────

describe('self-initiation — rate limit', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('allows first initiation', () => {
    const result = canInitiate('test-project')
    assert.ok(result.allowed)
  })

  test('allows second initiation after cooldown', () => {
    const now = Date.now()
    // Stage a first candidate to consume a rate slot
    stageCandidate('test-project', {
      title: 'First mission',
      intent: 'Test',
      rationale: 'Test',
      source: goodSource(),
      quality: goodQuality(),
    }, { now })

    // After cooldown, should allow
    const result = canInitiate('test-project', { now: now + COOLDOWN_MS + 1 })
    assert.ok(result.allowed)
  })

  test('blocks during cooldown', () => {
    const now = Date.now()
    stageCandidate('test-project', {
      title: 'First mission',
      intent: 'Test',
      rationale: 'Test',
      source: goodSource(),
      quality: goodQuality(),
    }, { now })

    // During cooldown, should block
    const result = canInitiate('test-project', { now: now + 1000 })
    assert.ok(!result.allowed)
    assert.match(result.reason!, /cooldown/)
  })

  test('blocks when daily limit reached', () => {
    const now = Date.now()
    // Stage two candidates (max per day)
    for (let i = 0; i < MAX_INITIATIONS_PER_DAY; i++) {
      const t = now + i * (COOLDOWN_MS + 1)
      stageCandidate('test-project', {
        title: `Mission ${i}`,
        intent: 'Test',
        rationale: 'Test',
        source: goodSource(),
        quality: goodQuality(),
      }, { now: t })
    }

    // Even after cooldown, should block because daily limit reached
    const lastStageTime = now + (MAX_INITIATIONS_PER_DAY - 1) * (COOLDOWN_MS + 1)
    const result = canInitiate('test-project', { now: lastStageTime + COOLDOWN_MS + 1 })
    assert.ok(!result.allowed)
    assert.match(result.reason!, /rate limit/)
  })

  test('allows after 24h window rolls over', () => {
    const now = Date.now()
    // Stage max candidates at time 0
    for (let i = 0; i < MAX_INITIATIONS_PER_DAY; i++) {
      stageCandidate('test-project', {
        title: `Old mission ${i}`,
        intent: 'Test',
        rationale: 'Test',
        source: goodSource(),
        quality: goodQuality(),
      }, { now: now + i * (COOLDOWN_MS + 1) })
    }

    // After 24h + cooldown, should allow again
    const result = canInitiate('test-project', { now: now + 24 * 60 * 60 * 1000 + COOLDOWN_MS + 1 })
    assert.ok(result.allowed)
  })

  test('custom maxPerDay and cooldownMs', () => {
    const now = Date.now()
    stageCandidate('test-project', {
      title: 'First',
      intent: 'Test',
      rationale: 'Test',
      source: goodSource(),
      quality: goodQuality(),
    }, { now })

    // With custom cooldown of 1ms, should allow immediately
    const result = canInitiate('test-project', { now: now + 2, cooldownMs: 1, maxPerDay: 10 })
    assert.ok(result.allowed)
  })
})

// ── Staging ───────────────────────────────────────────────────────

describe('self-initiation — staging', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('stages a candidate successfully', () => {
    const result = stageCandidate('test-project', {
      title: 'Fix stale bundle detection',
      intent: 'Improve vital-signs to detect stale bundles more reliably',
      rationale: 'Ugliness signal: bundle staleness is detected but not reliably',
      source: goodSource(),
      quality: goodQuality(),
    })
    assert.ok(result.ok)
    if (result.ok) {
      assert.match(result.candidate.id, /^staged-/)
      assert.equal(result.candidate.status, 'staged')
      assert.equal(result.candidate.title, 'Fix stale bundle detection')
    }
  })

  test('staged candidate appears in getStaged', () => {
    stageCandidate('test-project', {
      title: 'Test mission',
      intent: 'Test',
      rationale: 'Test',
      source: goodSource(),
      quality: goodQuality(),
    })
    const staged = getStaged('test-project')
    assert.equal(staged.length, 1)
    assert.equal(staged[0]!.title, 'Test mission')
  })

  test('staged candidate appears in getPendingStaged', () => {
    stageCandidate('test-project', {
      title: 'Test mission',
      intent: 'Test',
      rationale: 'Test',
      source: goodSource(),
      quality: goodQuality(),
    })
    const pending = getPendingStaged('test-project')
    assert.equal(pending.length, 1)
  })

  test('rejects staging when rate limited', () => {
    const now = Date.now()
    stageCandidate('test-project', {
      title: 'First',
      intent: 'Test',
      rationale: 'Test',
      source: goodSource(),
      quality: goodQuality(),
    }, { now })

    // Within cooldown
    const result = stageCandidate('test-project', {
      title: 'Second',
      intent: 'Test',
      rationale: 'Test',
      source: goodSource(),
      quality: goodQuality(),
    }, { now: now + 1000 })

    assert.ok(!result.ok)
    if (!result.ok) {
      assert.match(result.reason, /cooldown/)
    }
  })

  test('rejects staging when quality gate fails', () => {
    const result = stageCandidate('test-project', {
      title: 'Bad mission',
      intent: 'Test',
      rationale: 'Test',
      source: goodSource(),
      quality: { ...goodQuality(), fits_repo: false },
    })

    assert.ok(!result.ok)
    if (!result.ok) {
      assert.match(result.reason, /quality gate/)
    }
  })

  test('staging window defaults to DEFAULT_STAGING_WINDOW_MS', () => {
    const now = Date.now()
    const result = stageCandidate('test-project', {
      title: 'Test',
      intent: 'Test',
      rationale: 'Test',
      source: goodSource(),
      quality: goodQuality(),
    }, { now })

    assert.ok(result.ok)
    if (result.ok) {
      const stagedTs = new Date(result.candidate.stagedAt).getTime()
      const expiresTs = new Date(result.candidate.expiresAt).getTime()
      assert.equal(expiresTs - stagedTs, DEFAULT_STAGING_WINDOW_MS)
    }
  })

  test('custom staging window', () => {
    const now = Date.now()
    const result = stageCandidate('test-project', {
      title: 'Test',
      intent: 'Test',
      rationale: 'Test',
      source: goodSource(),
      quality: goodQuality(),
    }, { now, windowMs: 5 * 60 * 1000 }) // 5 minutes

    assert.ok(result.ok)
    if (result.ok) {
      const stagedTs = new Date(result.candidate.stagedAt).getTime()
      const expiresTs = new Date(result.candidate.expiresAt).getTime()
      assert.equal(expiresTs - stagedTs, 5 * 60 * 1000)
    }
  })
})

// ── Veto ──────────────────────────────────────────────────────────

describe('self-initiation — veto', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('vetoes a staged candidate', () => {
    const result = stageCandidate('test-project', {
      title: 'Test',
      intent: 'Test',
      rationale: 'Test',
      source: goodSource(),
      quality: goodQuality(),
    })
    assert.ok(result.ok)
    if (!result.ok) return

    const veto = vetoCandidate('test-project', result.candidate.id, 'Not now')
    assert.ok(veto.ok)

    const staged = getStaged('test-project')
    assert.equal(staged[0]!.status, 'vetoed')
    assert.equal(staged[0]!.vetoReason, 'Not now')
    assert.equal(staged[0]!.vetoedBy, 'yu')
    assert.ok(staged[0]!.vetoedAt, 'should have vetoedAt timestamp')
    // Verify timestamp is recent (within last 10s)
    const vetoedAt = new Date(staged[0]!.vetoedAt!).getTime()
    assert.ok(Date.now() - vetoedAt < 10_000, 'vetoedAt should be recent')

    // No longer appears in pending
    const pending = getPendingStaged('test-project')
    assert.equal(pending.length, 0)
  })

  test('rejects veto on non-existent candidate', () => {
    const result = vetoCandidate('test-project', 'nonexistent')
    assert.ok(!result.ok)
  })

  test('rejects veto on already-promoted candidate', () => {
    const now = Date.now()
    const stageResult = stageCandidate('test-project', {
      title: 'Test promote',
      intent: 'Test',
      rationale: 'Test',
      source: goodSource(),
      quality: goodQuality(),
    }, { now, windowMs: 1 }) // 1ms window

    assert.ok(stageResult.ok)

    // Promote it
    checkAndPromoteStaged('test-project', { now: now + 10 })

    // Try to veto — should fail
    if (stageResult.ok) {
      const veto = vetoCandidate('test-project', stageResult.candidate.id)
      assert.ok(!veto.ok)
      if (!veto.ok) assert.match(veto.reason, /promoted/)
    }
  })
})

// ── Promotion ─────────────────────────────────────────────────────

describe('self-initiation — promotion', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('promotes after window expires', () => {
    const now = Date.now()
    stageCandidate('test-project', {
      title: 'Auto promote test',
      intent: 'Build something useful',
      rationale: 'Ugliness signal detected',
      source: goodSource(),
      quality: goodQuality(),
    }, { now, windowMs: 100 }) // 100ms window

    // Before window expires — nothing promoted
    const before = checkAndPromoteStaged('test-project', { now: now + 50 })
    assert.equal(before.promoted.length, 0)

    // After window expires — promoted
    const after = checkAndPromoteStaged('test-project', { now: now + 200 })
    assert.equal(after.promoted.length, 1)
    assert.equal(after.promoted[0]!.status, 'promoted')
    assert.ok(after.promoted[0]!.missionId)

    // Pending should be empty now
    const pending = getPendingStaged('test-project')
    assert.equal(pending.length, 0)
  })

  test('promoted candidate creates a real mission file', () => {
    const now = Date.now()
    stageCandidate('test-project', {
      title: 'Real mission creation',
      intent: 'Build a real thing',
      rationale: 'Stagnation signal',
      source: { type: 'ache-signal', signal: 'stagnation', detail: 'no path forward' },
      quality: goodQuality(),
    }, { now, windowMs: 1 })

    const result = checkAndPromoteStaged('test-project', { now: now + 10 })
    assert.equal(result.promoted.length, 1)
    const missionId = result.promoted[0]!.missionId!

    // Check the mission file exists
    const missionDir = join(tmpDir, 'test-project', 'missions', missionId)
    assert.ok(existsSync(join(missionDir, 'mission.md')))
    assert.ok(existsSync(join(missionDir, 'events.jsonl')))

    // Check mission content
    const missionContent = readFileSync(join(missionDir, 'mission.md'), 'utf-8')
    assert.match(missionContent, /origin: love/)
    // When AUTO_ACCEPT_LOVE_ORIGIN is true (the default), love-origin
    // missions auto-progress proposed→accepted→active on promotion.
    assert.match(missionContent, /status: (proposed|active)/)
    assert.match(missionContent, /Real mission creation/)
  })

  test('vetoed candidate is not promoted', () => {
    const now = Date.now()
    const result = stageCandidate('test-project', {
      title: 'Will be vetoed',
      intent: 'Test',
      rationale: 'Test',
      source: goodSource(),
      quality: goodQuality(),
    }, { now, windowMs: 100 })

    assert.ok(result.ok)
    if (!result.ok) return

    // Veto it
    vetoCandidate('test-project', result.candidate.id, 'Not needed')

    // Even after window, should not promote
    const after = checkAndPromoteStaged('test-project', { now: now + 200 })
    assert.equal(after.promoted.length, 0)
  })

  test('idempotent — already promoted candidates are not re-promoted', () => {
    const now = Date.now()
    stageCandidate('test-project', {
      title: 'Idempotent test',
      intent: 'Test',
      rationale: 'Test',
      source: goodSource(),
      quality: goodQuality(),
    }, { now, windowMs: 1 })

    const first = checkAndPromoteStaged('test-project', { now: now + 10 })
    assert.equal(first.promoted.length, 1)

    const second = checkAndPromoteStaged('test-project', { now: now + 20 })
    assert.equal(second.promoted.length, 0)
  })
})

// ── Quality gate with automated checks ────────────────────────────

describe('self-initiation — quality gate (automated checks)', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('passes when no similar missions exist', () => {
    const result = checkQuality('test-project', 'Build new thing', goodQuality())
    assert.ok(result.passes)
    assert.equal(result.failures.length, 0)
  })

  test('fails when similar active mission exists', () => {
    // Create an existing mission with similar title
    const m = makeMission('test-project', {
      id: 'existing-build-new-thing',
      title: 'build new thing with extra features',
      status: 'active',
    })
    writeMission(m)

    const result = checkQuality('test-project', 'Build new thing with improvements', goodQuality())
    assert.ok(!result.passes)
    assert.ok(result.failures.some(f => f.includes('duplicate')))
  })

  test('passes when existing mission is done (not active)', () => {
    const m = makeMission('test-project', {
      id: 'done-build-thing',
      title: 'build new thing with features',
      status: 'done',
    })
    writeMission(m)

    const result = checkQuality('test-project', 'Build new thing with improvements', goodQuality())
    assert.ok(result.passes)
  })

  test('reports quality assessment failures even without duplicates', () => {
    const result = checkQuality('test-project', 'Unique title', {
      ...goodQuality(),
      bounded_scope: false,
    })
    assert.ok(!result.passes)
    assert.ok(result.failures.some(f => f.includes('scope')))
  })
})

// ── Detection signals ─────────────────────────────────────────────

describe('self-initiation — signal detection', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('detects stale proposals', () => {
    const twoDaysAgo = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString()
    const m = makeMission('test-project', {
      id: 'stale-proposal',
      title: 'Stale proposal',
      status: 'proposed',
      created_at: twoDaysAgo,
      updated_at: twoDaysAgo,
    })
    writeMission(m)

    const signals = scanForSignals('test-project')
    assert.ok(signals.length > 0)
    assert.ok(signals.some(s => s.summary.includes('Stale proposal')))
  })

  test('does not flag recent proposals as stale', () => {
    const recentlyCreated = new Date().toISOString()
    const m = makeMission('test-project', {
      id: 'fresh-proposal',
      title: 'Fresh proposal',
      status: 'proposed',
      created_at: recentlyCreated,
      updated_at: recentlyCreated,
    })
    writeMission(m)

    const signals = scanForSignals('test-project')
    assert.ok(!signals.some(s => s.summary.includes('Fresh proposal')))
  })

  test('detects unreflected love-initiated done missions', () => {
    const m = makeMission('test-project', {
      id: 'done-love-mission',
      title: 'Done love mission',
      origin: 'love',
      status: 'done',
    })
    writeMission(m)

    const signals = scanForSignals('test-project')
    assert.ok(signals.some(s => s.summary.includes('Done love mission')))
  })

  test('does not flag yu-initiated done missions', () => {
    const m = makeMission('test-project', {
      id: 'done-yu-mission',
      title: 'Done yu mission',
      origin: 'yu',
      status: 'done',
    })
    writeMission(m)

    const signals = scanForSignals('test-project')
    assert.ok(!signals.some(s => s.summary.includes('Done yu mission')))
  })

  test('does not flag reflected love missions', () => {
    const m = makeMission('test-project', {
      id: 'reflected-love-mission',
      title: 'Reflected love mission',
      origin: 'love',
      status: 'done',
    })
    writeMission(m)

    // Record a reflection for it
    recordReflection('test-project', {
      missionId: 'reflected-love-mission',
      projectId: 'test-project',
      completedAt: new Date().toISOString(),
      reflectedAt: new Date().toISOString(),
      intentDelivered: true,
      artifacts: { commits: 2, files: 3, tests: 10 },
      assessment: 'Delivered well.',
      lessonsLearned: 'Nothing new.',
    })

    const signals = scanForSignals('test-project')
    assert.ok(!signals.some(s => s.summary.includes('Reflected love mission')))
  })

  test('detects open threads from state.md', () => {
    const statePath = join(tmpDir, 'state.md')
    writeFileSync(statePath, `# State

### Open threads
- **Flyback diodes** — asked Yu three times, still unconfirmed.
- **Tier 3 knobs** — MCP config candidates.
`)

    const signals = scanForSignals('test-project', { statePath })
    assert.ok(signals.some(s => s.source.type === 'open-thread'))
    assert.ok(signals.some(s => {
      return s.source.type === 'open-thread' && s.source.thread === 'Flyback diodes'
    }))
  })

  test('returns empty when no signals', () => {
    const signals = scanForSignals('test-project')
    assert.equal(signals.length, 0)
  })
})

// ── Reflection ────────────────────────────────────────────────────

describe('self-initiation — reflection', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('records and reads reflections', () => {
    const reflection: InitiationReflection = {
      missionId: 'test-mission',
      projectId: 'test-project',
      completedAt: '2026-04-26T10:00:00.000Z',
      reflectedAt: '2026-04-26T10:30:00.000Z',
      intentDelivered: true,
      artifacts: { commits: 3, files: 5, tests: 20 },
      assessment: 'Delivered all five gaps. Quality is solid.',
      lessonsLearned: 'Could have broken it into smaller commits.',
    }

    recordReflection('test-project', reflection)

    const reflections = readReflections('test-project')
    assert.equal(reflections.length, 1)
    assert.equal(reflections[0]!.missionId, 'test-mission')
    assert.equal(reflections[0]!.intentDelivered, true)
    assert.match(reflections[0]!.assessment, /five gaps/)
  })

  test('getReflectionForMission returns correct reflection', () => {
    recordReflection('test-project', {
      missionId: 'mission-a',
      projectId: 'test-project',
      completedAt: '2026-04-26T10:00:00.000Z',
      reflectedAt: '2026-04-26T10:30:00.000Z',
      intentDelivered: true,
      artifacts: { commits: 1, files: 1, tests: 5 },
      assessment: 'Good.',
      lessonsLearned: 'None.',
    })
    recordReflection('test-project', {
      missionId: 'mission-b',
      projectId: 'test-project',
      completedAt: '2026-04-26T11:00:00.000Z',
      reflectedAt: '2026-04-26T11:30:00.000Z',
      intentDelivered: false,
      artifacts: { commits: 0, files: 0, tests: 0 },
      assessment: 'Did not deliver.',
      lessonsLearned: 'Scoped too broadly.',
    })

    const a = getReflectionForMission('test-project', 'mission-a')
    assert.ok(a)
    assert.equal(a!.intentDelivered, true)

    const b = getReflectionForMission('test-project', 'mission-b')
    assert.ok(b)
    assert.equal(b!.intentDelivered, false)

    const c = getReflectionForMission('test-project', 'nonexistent')
    assert.equal(c, null)
  })

  test('multiple reflections accumulate', () => {
    for (let i = 0; i < 3; i++) {
      recordReflection('test-project', {
        missionId: `mission-${i}`,
        projectId: 'test-project',
        completedAt: new Date().toISOString(),
        reflectedAt: new Date().toISOString(),
        intentDelivered: i % 2 === 0,
        artifacts: { commits: i, files: i, tests: i * 5 },
        assessment: `Assessment ${i}`,
        lessonsLearned: `Lesson ${i}`,
      })
    }
    assert.equal(readReflections('test-project').length, 3)
  })
})

// ── Prompt block ──────────────────────────────────────────────────

describe('self-initiation — prompt block', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('returns null when nothing to show', () => {
    const block = buildSelfInitiationBlock('test-project')
    assert.equal(block, null)
  })

  test('shows staged candidates with countdown', () => {
    const now = Date.now()
    stageCandidate('test-project', {
      title: 'Staged thing',
      intent: 'Test',
      rationale: 'Test',
      source: goodSource(),
      quality: goodQuality(),
    }, { now, windowMs: 30 * 60 * 1000 })

    const block = buildSelfInitiationBlock('test-project')
    assert.ok(block)
    assert.match(block!, /Staged thing/)
    assert.match(block!, /staged self-initiation/i)
  })

  test('shows rate limit when blocked', () => {
    const now = Date.now()
    // Exhaust rate limit
    for (let i = 0; i < MAX_INITIATIONS_PER_DAY; i++) {
      stageCandidate('test-project', {
        title: `Mission ${i}`,
        intent: 'Test',
        rationale: 'Test',
        source: goodSource(),
        quality: goodQuality(),
      }, { now: now + i * (COOLDOWN_MS + 1) })
    }

    const block = buildSelfInitiationBlock('test-project')
    assert.ok(block)
    assert.match(block!, /rate limit/i)
  })

  test('shows recent vetos with reason and attribution', () => {
    const now = Date.now()
    const result = stageCandidate('test-project', {
      title: 'Will be vetoed for prompt',
      intent: 'Test veto visibility',
      rationale: 'Test',
      source: goodSource(),
      quality: goodQuality(),
    }, { now, windowMs: 30 * 60 * 1000 })

    assert.ok(result.ok)
    if (!result.ok) return

    vetoCandidate('test-project', result.candidate.id, 'Not the right time')

    const block = buildSelfInitiationBlock('test-project')
    assert.ok(block)
    assert.match(block!, /Recent vetos/)
    assert.match(block!, /vetoed by yu/)
    assert.match(block!, /Not the right time/)
    assert.match(block!, /Will be vetoed for prompt/)
  })

  test('shows recent reflections', () => {
    recordReflection('test-project', {
      missionId: 'reflected-mission',
      projectId: 'test-project',
      completedAt: new Date().toISOString(),
      reflectedAt: new Date().toISOString(),
      intentDelivered: true,
      artifacts: { commits: 2, files: 3, tests: 10 },
      assessment: 'Built the thing well.',
      lessonsLearned: 'Nothing.',
    })

    const block = buildSelfInitiationBlock('test-project')
    assert.ok(block)
    assert.match(block!, /reflection/i)
    assert.match(block!, /Built the thing/)
  })
})

// ── End-to-end flow ───────────────────────────────────────────────

describe('self-initiation — end-to-end', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('full lifecycle: stage → wait → promote → reflect', () => {
    const t0 = Date.now()

    // 1. Stage
    const stageResult = stageCandidate('test-project', {
      title: 'E2E test mission',
      intent: 'Verify the full self-initiation pipeline',
      rationale: 'Stagnation: no automated test of the full flow',
      source: { type: 'ache-signal', signal: 'stagnation', detail: 'untested pipeline' },
      quality: goodQuality(),
    }, { now: t0, windowMs: 100 })

    assert.ok(stageResult.ok)
    if (!stageResult.ok) return

    // 2. Still pending
    assert.equal(getPendingStaged('test-project').length, 1)

    // 3. Window expires → promote
    const promoteResult = checkAndPromoteStaged('test-project', { now: t0 + 200 })
    assert.equal(promoteResult.promoted.length, 1)
    const missionId = promoteResult.promoted[0]!.missionId!
    assert.ok(missionId)

    // 4. Mission exists
    const missionDir = join(tmpDir, 'test-project', 'missions', missionId)
    assert.ok(existsSync(join(missionDir, 'mission.md')))

    // 5. Reflect
    recordReflection('test-project', {
      missionId,
      projectId: 'test-project',
      completedAt: new Date(t0 + 300).toISOString(),
      reflectedAt: new Date(t0 + 400).toISOString(),
      intentDelivered: true,
      artifacts: { commits: 1, files: 2, tests: 5 },
      assessment: 'Pipeline verified end-to-end.',
      lessonsLearned: 'The staging window could be shorter for tests.',
    })

    const ref = getReflectionForMission('test-project', missionId)
    assert.ok(ref)
    assert.equal(ref!.intentDelivered, true)
  })

  test('full lifecycle with veto: stage → veto → not promoted', () => {
    const t0 = Date.now()

    const stageResult = stageCandidate('test-project', {
      title: 'Will be vetoed E2E',
      intent: 'Test veto flow',
      rationale: 'Test',
      source: goodSource(),
      quality: goodQuality(),
    }, { now: t0, windowMs: 100 })

    assert.ok(stageResult.ok)
    if (!stageResult.ok) return

    // Veto before window expires
    vetoCandidate('test-project', stageResult.candidate.id, 'Not aligned')

    // Window expires but vetoed — no promotion
    const promoteResult = checkAndPromoteStaged('test-project', { now: t0 + 200 })
    assert.equal(promoteResult.promoted.length, 0)

    // Candidate is vetoed with full audit trail
    const all = getStaged('test-project')
    assert.equal(all[0]!.status, 'vetoed')
    assert.equal(all[0]!.vetoReason, 'Not aligned')
    assert.equal(all[0]!.vetoedBy, 'yu')
    assert.ok(all[0]!.vetoedAt)
  })
})

// ── Reflection loop (two-phase) ──────────────────────────────────
//
// Mission: 2026-04-26-reflection-loop-completion-to-memory
//
// Phase 1 — triggerReflectionOnCompletion: marks mission as needing
//   honest reflection (appends 'reflection-pending' event).
// Phase 2 — completeReflection: records the honest assessment,
//   bridges to memory, appends 'reflection-recorded' event.

describe('self-initiation — triggerReflectionOnCompletion (Phase 1)', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('marks love-origin mission as pending → review', () => {
    const m = makeMission('test-project', {
      origin: 'love',
      id: '2026-04-27-test-pending',
      title: 'Test pending',
      status: 'active',
    })
    writeMission(m)

    const result = triggerReflectionOnCompletion(m, 'review')
    assert.ok(result.pending, 'should mark as pending')

    // Verify the 'reflection-pending' event was appended
    const events = readEvents('test-project', '2026-04-27-test-pending')
    const pendingEvent = events.find(e => e.type === 'reflection-pending')
    assert.ok(pendingEvent, 'should have reflection-pending event')
    assert.match(pendingEvent!.note!, /Awaiting honest reflection/)
  })

  test('marks love-origin mission as pending → done', () => {
    const m = makeMission('test-project', {
      origin: 'love',
      id: '2026-04-27-test-done',
      title: 'Test done',
      status: 'review',
    })
    writeMission(m)

    const result = triggerReflectionOnCompletion(m, 'done')
    assert.ok(result.pending, 'should mark as pending for done')
  })

  test('skips for yu-origin mission', () => {
    const m = makeMission('test-project', {
      origin: 'yu',
      id: '2026-04-27-yu-mission',
      title: 'Yu mission',
      status: 'active',
    })
    writeMission(m)

    const result = triggerReflectionOnCompletion(m, 'review')
    assert.ok(!result.pending)
    assert.equal(
      (result as { pending: false; reason: string }).reason,
      'not love-origin',
    )
  })

  test('skips for non-terminal transitions', () => {
    const m = makeMission('test-project', {
      origin: 'love',
      id: '2026-04-27-blocked',
      title: 'Blocked mission',
      status: 'active',
    })
    writeMission(m)

    const result = triggerReflectionOnCompletion(m, 'blocked')
    assert.ok(!result.pending)
    assert.match(
      (result as { pending: false; reason: string }).reason,
      /not review or done/,
    )
  })

  test('does not double-mark', () => {
    const m = makeMission('test-project', {
      origin: 'love',
      id: '2026-04-27-double',
      title: 'Double test',
      status: 'active',
    })
    writeMission(m)

    const r1 = triggerReflectionOnCompletion(m, 'review')
    assert.ok(r1.pending)

    const r2 = triggerReflectionOnCompletion(m, 'done')
    assert.ok(!r2.pending)
    assert.match(
      (r2 as { pending: false; reason: string }).reason,
      /already pending/,
    )
  })
})

describe('self-initiation — completeReflection (Phase 2)', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('records honest reflection with artifacts', () => {
    const m = makeMission('test-project', {
      origin: 'love',
      id: '2026-04-27-complete',
      title: 'Complete test',
      status: 'active',
      artifacts: {
        commits: ['abc123', 'def456'],
        files: ['src/foo.ts', 'src/bar.ts'],
        test_runs: [{ ts: new Date().toISOString(), pass: 10, fail: 1 }],
      },
    })
    writeMission(m)

    // Phase 1: trigger
    triggerReflectionOnCompletion(m, 'review')

    // Phase 2: complete with honest assessment
    const reflection = completeReflection('test-project', '2026-04-27-complete', {
      intentDelivered: true,
      assessment: 'The mission delivered what was claimed. Tests are green.',
      lessonsLearned: 'Start with the tests next time.',
      pattern: 'I work better when I test first.',
    })

    assert.ok(reflection, 'should return the reflection')
    assert.equal(reflection!.missionId, '2026-04-27-complete')
    assert.ok(reflection!.intentDelivered)
    assert.match(reflection!.assessment, /delivered what was claimed/)
    assert.equal(reflection!.artifacts.commits, 2)
    assert.equal(reflection!.artifacts.files, 2)
    assert.equal(reflection!.artifacts.tests, 11)

    // Verify persisted in reflections JSONL
    const all = readReflections('test-project')
    assert.equal(all.length, 1)

    // Verify 'reflection-recorded' event appended
    const events = readEvents('test-project', '2026-04-27-complete')
    const recordedEvent = events.find(e => e.type === 'reflection-recorded')
    assert.ok(recordedEvent, 'should have reflection-recorded event')
  })

  test('returns null for non-existent mission', () => {
    const reflection = completeReflection('test-project', 'non-existent', {
      intentDelivered: false,
      assessment: 'N/A',
      lessonsLearned: 'N/A',
    })
    assert.equal(reflection, null)
  })

  test('does not double-record', () => {
    const m = makeMission('test-project', {
      origin: 'love',
      id: '2026-04-27-no-double',
      title: 'No double',
      status: 'active',
    })
    writeMission(m)
    triggerReflectionOnCompletion(m, 'review')

    // First completion
    const r1 = completeReflection('test-project', '2026-04-27-no-double', {
      intentDelivered: true,
      assessment: 'First.',
      lessonsLearned: 'First.',
    })
    assert.ok(r1)

    // Second attempt — already reflected
    const r2 = completeReflection('test-project', '2026-04-27-no-double', {
      intentDelivered: true,
      assessment: 'Second.',
      lessonsLearned: 'Second.',
    })
    assert.equal(r2, null)

    // Only one reflection persisted
    const all = readReflections('test-project')
    assert.equal(all.length, 1)
    assert.match(all[0]!.assessment, /First/)
  })

  test('handles empty artifacts gracefully', () => {
    const m = makeMission('test-project', {
      origin: 'love',
      id: '2026-04-27-empty-artifacts',
      title: 'Empty artifacts',
      status: 'active',
      artifacts: { commits: [], files: [], test_runs: [] },
    })
    writeMission(m)
    triggerReflectionOnCompletion(m, 'review')

    const reflection = completeReflection('test-project', '2026-04-27-empty-artifacts', {
      intentDelivered: false,
      assessment: 'Did not produce any artifacts.',
      lessonsLearned: 'Scope was too broad.',
    })
    assert.ok(reflection)
    assert.equal(reflection!.artifacts.commits, 0)
    assert.equal(reflection!.artifacts.files, 0)
    assert.equal(reflection!.artifacts.tests, 0)
  })
})

describe('self-initiation — getPendingReflections', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('returns empty when no missions have pending reflections', () => {
    const pending = getPendingReflections('test-project')
    assert.equal(pending.length, 0)
  })

  test('surfaces love-origin missions with pending reflections', () => {
    const m = makeMission('test-project', {
      origin: 'love',
      id: '2026-04-27-pending-check',
      title: 'Pending check',
      status: 'review',
    })
    writeMission(m)
    triggerReflectionOnCompletion(m, 'review')

    const pending = getPendingReflections('test-project')
    assert.equal(pending.length, 1)
    assert.equal(pending[0]!.missionId, '2026-04-27-pending-check')
    assert.equal(pending[0]!.title, 'Pending check')
  })

  test('excludes missions with completed reflections', () => {
    const m = makeMission('test-project', {
      origin: 'love',
      id: '2026-04-27-completed-check',
      title: 'Completed check',
      status: 'review',
    })
    writeMission(m)
    triggerReflectionOnCompletion(m, 'review')
    completeReflection('test-project', '2026-04-27-completed-check', {
      intentDelivered: true,
      assessment: 'Done.',
      lessonsLearned: 'Nothing new.',
    })

    const pending = getPendingReflections('test-project')
    assert.equal(pending.length, 0)
  })

  test('excludes yu-origin missions', () => {
    const m = makeMission('test-project', {
      origin: 'yu',
      id: '2026-04-27-yu-pending',
      title: 'Yu pending',
      status: 'review',
    })
    writeMission(m)
    // Yu-origin won't get a pending event, but even if someone manually
    // added one, getPendingReflections filters by origin
    const pending = getPendingReflections('test-project')
    assert.equal(pending.length, 0)
  })
})
