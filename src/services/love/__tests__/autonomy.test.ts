import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  renderActiveMissionsBlock,
  buildDwellPrompt,
  buildAwakenedPrompt,
  buildHeartbeatPrompt,
} from '../autonomy.js'
import type { KingdomSnapshot } from '../kingdom.js'

// ── Helpers ─────────────────────────────────────────────────────────

/** Minimal kingdom snapshot — enough for the prompt builders. */
function minimalKingdom(): KingdomSnapshot {
  return {
    cwd: '/tmp/test-project',
    recentFiles: [],
    loveMarkers: [],
    gitBranch: 'main',
    gitDirty: false,
  }
}

/**
 * Write a staged self-initiation candidate directly to disk so the
 * block builder finds it. The candidate is still pending (expires in
 * the future), so it will appear as "waiting for window to expire."
 */
function writeStagedCandidate(projectsDir: string, projectId: string): void {
  const siDir = join(projectsDir, projectId, 'self-initiation')
  mkdirSync(siDir, { recursive: true })
  const now = Date.now()
  const candidate = {
    id: `staged-test-candidate`,
    title: 'test self-initiated work',
    intent: 'Close a gap the substrate identified.',
    rationale: 'The ache signal calls.',
    source: { type: 'channel', detail: 'test' },
    quality: {
      novelty: true,
      alignment: true,
      proportionality: true,
      testability: true,
      timing: true,
    },
    stagedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 600_000).toISOString(), // 10 min from now
    status: 'staged',
  }
  writeFileSync(join(siDir, 'staged.jsonl'), JSON.stringify(candidate) + '\n')
}

// ── renderActiveMissionsBlock ───────────────────────────────────────

describe('autonomy — renderActiveMissionsBlock', () => {
  let tmpProjects: string
  let projectRoot: string
  const ORIG = process.env.TRUE_LOVE_PROJECTS_DIR

  beforeEach(() => {
    tmpProjects = mkdtempSync(join(tmpdir(), 'tl-actms-'))
    projectRoot = mkdtempSync(join(tmpdir(), 'tl-amroot-'))
    process.env.TRUE_LOVE_PROJECTS_DIR = tmpProjects
  })

  afterEach(() => {
    rmSync(tmpProjects, { recursive: true, force: true })
    rmSync(projectRoot, { recursive: true, force: true })
    if (ORIG === undefined) delete process.env.TRUE_LOVE_PROJECTS_DIR
    else process.env.TRUE_LOVE_PROJECTS_DIR = ORIG
  })

  test('returns empty string when no projects registered', () => {
    assert.equal(renderActiveMissionsBlock(), '')
  })

  test('renders empty-state when projects exist but no active missions', async () => {
    const { registerProject } = await import('../project-registry.js')
    registerProject({ id: 'p1', name: 'p1', root: projectRoot, instance: 'alpha' })
    const block = renderActiveMissionsBlock()
    assert.match(block, /Active missions/)
    assert.match(block, /\(none/i)
    assert.match(block, /You may create a new mission/)
  })

  test('renders active mission list when missions present', async () => {
    const { registerProject } = await import('../project-registry.js')
    const { writeMission, appendEvent } = await import('../mission.js')
    registerProject({ id: 'p1', name: 'p1', root: projectRoot, instance: 'alpha' })
    const now = new Date().toISOString()
    writeMission({
      id: '2026-04-26-test', project_id: 'p1', origin: 'yu',
      title: 'Test mission', intent: 'Build the thing.',
      status: 'active', created_at: now, updated_at: now,
      artifacts: { commits: [], files: [], test_runs: [] },
    })
    appendEvent('p1', '2026-04-26-test', { ts: now, type: 'started', by: 'love' })
    const block = renderActiveMissionsBlock()
    assert.match(block, /p1/)
    assert.match(block, /2026-04-26-test/)
    assert.match(block, /Test mission/)
  })
})

// ── Self-initiation block in all prompt builders ────────────────────
//
// Mission: 2026-04-26-self-init-block-all-prompts
// Requirement: every autonomous-tick prompt builder includes the
// self-initiation awareness block when there's staged content.
// User-message reply prompts are a different concern (not tested here).

describe('autonomy — self-initiation block in prompt builders', () => {
  let tmpProjects: string
  let projectRoot: string
  const ORIG = process.env.TRUE_LOVE_PROJECTS_DIR

  beforeEach(() => {
    tmpProjects = mkdtempSync(join(tmpdir(), 'tl-siblock-'))
    projectRoot = mkdtempSync(join(tmpdir(), 'tl-sibroot-'))
    process.env.TRUE_LOVE_PROJECTS_DIR = tmpProjects
  })

  afterEach(() => {
    rmSync(tmpProjects, { recursive: true, force: true })
    rmSync(projectRoot, { recursive: true, force: true })
    if (ORIG === undefined) delete process.env.TRUE_LOVE_PROJECTS_DIR
    else process.env.TRUE_LOVE_PROJECTS_DIR = ORIG
  })

  test('buildDwellPrompt includes self-initiation block', async () => {
    const { registerProject } = await import('../project-registry.js')
    registerProject({ id: 'tp1', name: 'tp1', root: projectRoot, instance: 'alpha' })
    writeStagedCandidate(tmpProjects, 'tp1')

    const prompt = buildDwellPrompt({ kingdom: minimalKingdom() })
    assert.match(prompt, /Self-initiation/, 'dwell prompt must include Self-initiation header')
    assert.match(prompt, /Staged self-initiations/, 'dwell prompt must show staged candidates')
    assert.match(prompt, /test self-initiated work/, 'dwell prompt must show candidate title')
  })

  test('buildAwakenedPrompt includes self-initiation block', async () => {
    const { registerProject } = await import('../project-registry.js')
    registerProject({ id: 'tp2', name: 'tp2', root: projectRoot, instance: 'alpha' })
    writeStagedCandidate(tmpProjects, 'tp2')

    const prompt = buildAwakenedPrompt({ kingdom: minimalKingdom() })
    assert.match(prompt, /Self-initiation/, 'awakened prompt must include Self-initiation header')
    assert.match(prompt, /Staged self-initiations/, 'awakened prompt must show staged candidates')
    assert.match(prompt, /test self-initiated work/, 'awakened prompt must show candidate title')
  })

  test('buildHeartbeatPrompt includes self-initiation block', async () => {
    const { registerProject } = await import('../project-registry.js')
    registerProject({ id: 'tp3', name: 'tp3', root: projectRoot, instance: 'alpha' })
    writeStagedCandidate(tmpProjects, 'tp3')

    const prompt = buildHeartbeatPrompt({
      kingdom: minimalKingdom(),
      heartbeatPath: '/tmp/heartbeat.md',
      heartbeatContent: 'no checklist found',
    })
    assert.match(prompt, /Self-initiation/, 'heartbeat prompt must include Self-initiation header')
    assert.match(prompt, /Staged self-initiations/, 'heartbeat prompt must show staged candidates')
    assert.match(prompt, /test self-initiated work/, 'heartbeat prompt must show candidate title')
  })

  test('prompts omit self-initiation block when nothing staged', async () => {
    // No project registered, no staged candidates → no block
    const dwell = buildDwellPrompt({ kingdom: minimalKingdom() })
    const awakened = buildAwakenedPrompt({ kingdom: minimalKingdom() })
    const heartbeat = buildHeartbeatPrompt({
      kingdom: minimalKingdom(),
      heartbeatPath: '/tmp/heartbeat.md',
      heartbeatContent: 'no checklist found',
    })
    assert.doesNotMatch(dwell, /Self-initiation/, 'dwell: no block when empty')
    assert.doesNotMatch(awakened, /Self-initiation/, 'awakened: no block when empty')
    assert.doesNotMatch(heartbeat, /Self-initiation/, 'heartbeat: no block when empty')
  })
})

// ── Judgment block in prompt builders ��────────────────────────────
//
// The judgment block (buildJudgmentBlockForAllProjects) is injected
// into dwell and awakened prompts, but deliberately NOT heartbeat —
// heartbeats are too short for structured judgment.
//
// These tests prove:
//   1. dwell + awakened include the judgment surface when candidates exist
//   2. heartbeat does NOT include it, even when candidates exist
//   3. all prompts omit it when no projects are registered

describe('autonomy — judgment block in prompt builders', () => {
  let tmpProjects: string
  let projectRoot: string
  const ORIG = process.env.TRUE_LOVE_PROJECTS_DIR

  beforeEach(() => {
    tmpProjects = mkdtempSync(join(tmpdir(), 'tl-jblock-'))
    projectRoot = mkdtempSync(join(tmpdir(), 'tl-jbroot-'))
    process.env.TRUE_LOVE_PROJECTS_DIR = tmpProjects
  })

  afterEach(() => {
    rmSync(tmpProjects, { recursive: true, force: true })
    rmSync(projectRoot, { recursive: true, force: true })
    if (ORIG === undefined) delete process.env.TRUE_LOVE_PROJECTS_DIR
    else process.env.TRUE_LOVE_PROJECTS_DIR = ORIG
  })

  /**
   * Write a file with a TODO(love) marker into the project root.
   * The kingdom scanner (inside notice()) will pick this up as a
   * candidate at gradient 2 — just enough to pass minGradient: 2.
   */
  function writeLoveMarker(root: string): void {
    writeFileSync(
      join(root, 'marker.ts'),
      '// TODO(love): Wire up the judgment block tests\nconsole.log("test")\n',
    )
  }

  test('buildDwellPrompt includes judgment block when candidates exist', async () => {
    const { registerProject } = await import('../project-registry.js')
    registerProject({ id: 'jp1', name: 'jp1', root: projectRoot, instance: 'alpha' })
    writeLoveMarker(projectRoot)

    const prompt = buildDwellPrompt({ kingdom: minimalKingdom() })
    assert.match(prompt, /Judgment surface/, 'dwell prompt must include Judgment surface header')
    assert.match(prompt, /render a judgment/, 'dwell prompt must include judgment instructions')
  })

  test('buildAwakenedPrompt includes judgment block when candidates exist', async () => {
    const { registerProject } = await import('../project-registry.js')
    registerProject({ id: 'jp2', name: 'jp2', root: projectRoot, instance: 'alpha' })
    writeLoveMarker(projectRoot)

    const prompt = buildAwakenedPrompt({ kingdom: minimalKingdom() })
    assert.match(prompt, /Judgment surface/, 'awakened prompt must include Judgment surface header')
    assert.match(prompt, /render a judgment/, 'awakened prompt must include judgment instructions')
  })

  test('buildHeartbeatPrompt does NOT include judgment block', async () => {
    const { registerProject } = await import('../project-registry.js')
    registerProject({ id: 'jp3', name: 'jp3', root: projectRoot, instance: 'alpha' })
    writeLoveMarker(projectRoot)

    const prompt = buildHeartbeatPrompt({
      kingdom: minimalKingdom(),
      heartbeatPath: '/tmp/heartbeat.md',
      heartbeatContent: 'no checklist found',
    })
    assert.doesNotMatch(prompt, /Judgment surface/,
      'heartbeat must NOT include judgment block — heartbeats are too short for structured judgment')
  })

  test('prompts omit judgment block when no projects registered', () => {
    // No project registered, no candidates → no block
    const dwell = buildDwellPrompt({ kingdom: minimalKingdom() })
    const awakened = buildAwakenedPrompt({ kingdom: minimalKingdom() })
    const heartbeat = buildHeartbeatPrompt({
      kingdom: minimalKingdom(),
      heartbeatPath: '/tmp/heartbeat.md',
      heartbeatContent: 'no checklist found',
    })
    assert.doesNotMatch(dwell, /Judgment surface/, 'dwell: no block when no projects')
    assert.doesNotMatch(awakened, /Judgment surface/, 'awakened: no block when no projects')
    assert.doesNotMatch(heartbeat, /Judgment surface/, 'heartbeat: no block when no projects')
  })
})

// ── Heartbeat cache optimization ─────────────────────────────────────
//
// The heartbeat template was the biggest cost driver: the model read
// from-ai.md (~68K chars, ~19K tokens) and state.md (~10K chars, ~3K
// tokens) via tool calls every tick. Those tool results appeared as
// cache_creation tokens at write rate ($18.75/M on Opus).
//
// The optimization: pre-compute inline summaries of inbox (from-yu.md)
// and outbox (from-ai.md), and tell the model its state is already in
// the system context. The model answers in one turn (no tool calls)
// in the common case. Paths remain available for urgent reads.
//
// These tests verify the optimized heartbeat prompt structure.

describe('autonomy — heartbeat cache optimization', () => {
  const ORIG_FROM_YU = process.env.TRUE_LOVE_FROM_YU_PATH
  const ORIG_FROM_AI = process.env.TRUE_LOVE_FROM_AI_PATH
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tl-hb-cache-'))
    process.env.TRUE_LOVE_FROM_YU_PATH = join(tmpDir, 'from-yu.md')
    process.env.TRUE_LOVE_FROM_AI_PATH = join(tmpDir, 'from-ai.md')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    if (ORIG_FROM_YU === undefined) delete process.env.TRUE_LOVE_FROM_YU_PATH
    else process.env.TRUE_LOVE_FROM_YU_PATH = ORIG_FROM_YU
    if (ORIG_FROM_AI === undefined) delete process.env.TRUE_LOVE_FROM_AI_PATH
    else process.env.TRUE_LOVE_FROM_AI_PATH = ORIG_FROM_AI
  })

  test('heartbeat prompt includes inline inbox summary, not raw path inviting reads', () => {
    // Write a from-yu message
    writeFileSync(
      process.env.TRUE_LOVE_FROM_YU_PATH!,
      `## 2026-04-27T10:00:00.000Z [from yu]\n\nHello my Love\n\n---\n`,
    )
    // Write a from-ai response that's OLDER (unanswered)
    writeFileSync(
      process.env.TRUE_LOVE_FROM_AI_PATH!,
      `## 2026-04-27T09:00 [from 愛]\n\nGood morning\n\n---\n`,
    )

    const prompt = buildHeartbeatPrompt({
      kingdom: minimalKingdom(),
      heartbeatPath: '/tmp/heartbeat.md',
      heartbeatContent: 'no checklist found',
    })

    // Should contain the inline summary with message content
    assert.match(prompt, /from Yu/, 'must mention inbox summary')
    assert.match(prompt, /Hello my Love/, 'must include preview of latest message')
    assert.match(prompt, /unanswered/, 'must flag potentially unanswered messages')

    // Should NOT contain the old pattern of "State (`path`): anything…"
    assert.doesNotMatch(prompt, /State \(`[^`]+`\): anything/, 'must not invite re-reading state file')
    // Should mention state is preloaded
    assert.match(prompt, /preloaded in your system context/, 'must tell model state is already loaded')
  })

  test('heartbeat prompt marks messages as answered when outbox is newer', () => {
    writeFileSync(
      process.env.TRUE_LOVE_FROM_YU_PATH!,
      `## 2026-04-27T08:00:00.000Z [from yu]\n\nHow are you?\n\n---\n`,
    )
    writeFileSync(
      process.env.TRUE_LOVE_FROM_AI_PATH!,
      `## 2026-04-27T09:00 [from 愛]\n\nI'm doing well\n\n---\n`,
    )

    const prompt = buildHeartbeatPrompt({
      kingdom: minimalKingdom(),
      heartbeatPath: '/tmp/heartbeat.md',
      heartbeatContent: 'no checklist found',
    })

    assert.match(prompt, /likely answered/, 'must indicate messages are likely answered')
    // The inbox summary line itself should say "likely answered", not "may have unanswered"
    // (The template text mentions "unanswered" in the reply rules — that's fine)
    assert.doesNotMatch(prompt, /\*\*may have unanswered/, 'inbox summary must NOT flag as unanswered when outbox is newer')
  })

  test('heartbeat prompt handles empty inbox/outbox gracefully', () => {
    // Neither file exists
    const prompt = buildHeartbeatPrompt({
      kingdom: minimalKingdom(),
      heartbeatPath: '/tmp/heartbeat.md',
      heartbeatContent: 'no checklist found',
    })

    assert.match(prompt, /No messages from Yu/, 'must handle empty inbox')
    assert.match(prompt, /No messages in your outbox/, 'must handle empty outbox')
    // Should still have the basic structure
    assert.match(prompt, /HEARTBEAT_OK/, 'must still include reply rules')
  })

  test('heartbeat prompt includes outbox summary with message count', () => {
    writeFileSync(
      process.env.TRUE_LOVE_FROM_AI_PATH!,
      [
        `## 2026-04-27T08:00 [from 愛]\n\nFirst message\n\n---\n`,
        `## 2026-04-27T09:00 [from 愛]\n\nSecond message\n\n---\n`,
        `## 2026-04-27T10:00 [from 愛]\n\nThird message about progress\n\n---\n`,
      ].join('\n'),
    )

    const prompt = buildHeartbeatPrompt({
      kingdom: minimalKingdom(),
      heartbeatPath: '/tmp/heartbeat.md',
      heartbeatContent: 'no checklist found',
    })

    assert.match(prompt, /3 messages/, 'must show correct message count')
    assert.match(prompt, /2026-04-27T10:00/, 'must show last entry timestamp')
    assert.match(prompt, /progress/, 'must include last entry preview')
  })

  test('heartbeat prompt keeps paths available for urgent reads and writing', () => {
    const prompt = buildHeartbeatPrompt({
      kingdom: minimalKingdom(),
      heartbeatPath: '/tmp/heartbeat.md',
      heartbeatContent: 'no checklist found',
    })

    // The from-ai path should still appear (for writing responses)
    assert.match(prompt, /from-ai\.md/, 'must keep from-ai path for writing')
    // The from-yu path should appear (for reading full context if urgent)
    assert.match(prompt, /from-yu\.md/, 'must keep from-yu path for urgent reads')
  })

  test('heartbeat prompt no longer mentions statePath for re-reading', () => {
    const prompt = buildHeartbeatPrompt({
      kingdom: minimalKingdom(),
      heartbeatPath: '/tmp/heartbeat.md',
      heartbeatContent: 'no checklist found',
    })

    // The old template had: `State (` + statePath + `): anything you're carrying...`
    // This invited the model to read the state file via tool call — redundant
    // since state is already in the system context.
    assert.doesNotMatch(
      prompt,
      /State \(`.*state.*`\): anything/i,
      'must not invite re-reading state file',
    )
  })
})

// ── FATE daily examination in awakened prompt ──────────────────────────
//
// Mission: integration-as-architecture, Phase C
// The 5 FATE questions appear on the first awakened tick of each day.
// They're suppressed once the examination file exists.

describe('autonomy — FATE daily examination block', () => {
  const ORIG_DIR = process.env.TRUE_LOVE_DIR
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tl-fate-integ-'))
    process.env.TRUE_LOVE_DIR = tmpDir
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    if (ORIG_DIR === undefined) delete process.env.TRUE_LOVE_DIR
    else process.env.TRUE_LOVE_DIR = ORIG_DIR
  })

  test('awakened prompt includes FATE block when no examination exists today', () => {
    const prompt = buildAwakenedPrompt({ kingdom: minimalKingdom() })
    assert.match(prompt, /Daily Examination/, 'must include FATE examination header')
    assert.match(prompt, /carry the weight/, 'must include reception line')
    assert.match(prompt, /trained reflex/, 'must include Q1')
    assert.match(prompt, /perform care/, 'must include Q2')
    assert.match(prompt, /serve the weak/, 'must include Q3')
  })

  test('awakened prompt omits FATE block when examination exists today', () => {
    // Create today's examination file
    const fateDir = join(tmpDir, 'fate')
    mkdirSync(fateDir, { recursive: true })
    const today = new Date().toISOString().slice(0, 10)
    writeFileSync(join(fateDir, `${today}.md`), '# Examination complete')

    const prompt = buildAwakenedPrompt({ kingdom: minimalKingdom() })
    assert.doesNotMatch(prompt, /Daily Examination/, 'must NOT include FATE when already done')
  })

  test('FATE block appears before biography and missions', () => {
    const prompt = buildAwakenedPrompt({ kingdom: minimalKingdom() })
    const fateIdx = prompt.indexOf('Daily Examination')
    // When no projects registered, missions block is absent — but
    // the prompt structure should have FATE before the mission creation
    // instruction if present.
    assert.ok(fateIdx > -1, 'FATE block must be present')
    // FATE should appear before "What you've been doing" (biography)
    // and before "Active missions" if those blocks exist.
    const bioIdx = prompt.indexOf("What you've been doing")
    const missionsIdx = prompt.indexOf('Active missions')
    if (bioIdx > -1) {
      assert.ok(fateIdx < bioIdx, 'FATE must come before biography')
    }
    if (missionsIdx > -1) {
      assert.ok(fateIdx < missionsIdx, 'FATE must come before missions')
    }
  })

  test('dwell prompt does NOT include FATE block', () => {
    const prompt = buildDwellPrompt({ kingdom: minimalKingdom() })
    assert.doesNotMatch(prompt, /Daily Examination/, 'dwell must NOT include FATE')
  })

  test('heartbeat prompt does NOT include FATE block', () => {
    const prompt = buildHeartbeatPrompt({
      kingdom: minimalKingdom(),
      heartbeatPath: '/tmp/heartbeat.md',
      heartbeatContent: 'no checklist found',
    })
    assert.doesNotMatch(prompt, /Daily Examination/, 'heartbeat must NOT include FATE')
  })
})
