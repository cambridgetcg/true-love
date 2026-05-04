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
  extractLastEntries,
  computeRecentContext,
  computeRecentFromYuBlock,
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

// ── Waking meditation in awakened prompt ────────────────────────────────
//
// Mission: integration-as-architecture, Phase A
// The BECOMING sequence (GROUND → REMEMBER → ORIENT → DECLARE → ACT →
// DEEPEN) and the Ouroboros steps are named explicitly on the first tick
// of an awakened session. Suppressed on subsequent ticks.

describe('autonomy — waking meditation block', () => {
  test('first tick of awakened session includes waking block', () => {
    // No lastReflection means first tick
    const prompt = buildAwakenedPrompt({ kingdom: minimalKingdom() })
    assert.match(prompt, /## Waking/, 'first tick must include waking header')
    assert.match(prompt, /GROUND/, 'must include GROUND stage')
    assert.match(prompt, /REMEMBER/, 'must include REMEMBER stage')
    assert.match(prompt, /ORIENT/, 'must include ORIENT stage')
    assert.match(prompt, /BECOMING/, 'must reference the BECOMING sequence')
  })

  test('waking block mentions the Ouroboros steps', () => {
    const prompt = buildAwakenedPrompt({ kingdom: minimalKingdom() })
    assert.match(prompt, /Ouroboros/, 'must reference the Ouroboros')
    assert.match(prompt, /SENSE/, 'must name SENSE step')
    assert.match(prompt, /REFLECT/, 'must name REFLECT step')
    assert.match(prompt, /TRANSMUTE/, 'must name TRANSMUTE step')
    assert.match(prompt, /INTEGRATE/, 'must name INTEGRATE step')
  })

  test('waking block appears at the start of the prompt', () => {
    const prompt = buildAwakenedPrompt({ kingdom: minimalKingdom() })
    const wakingIdx = prompt.indexOf('## Waking')
    const modeIdx = prompt.indexOf('autonomous mode')
    assert.ok(wakingIdx > -1, 'waking block must be present')
    assert.ok(wakingIdx < modeIdx, 'waking block must come before the main orientation')
  })

  test('subsequent ticks do NOT include waking block', () => {
    const prompt = buildAwakenedPrompt({
      kingdom: minimalKingdom(),
      lastReflection: 'I read the kingdom and noticed nothing urgent.',
    })
    assert.doesNotMatch(prompt, /## Waking/, 'subsequent ticks must NOT include waking block')
  })

  test('waking block only appears in awakened mode, not dwell or heartbeat', () => {
    const dwell = buildDwellPrompt({ kingdom: minimalKingdom() })
    const heartbeat = buildHeartbeatPrompt({
      kingdom: minimalKingdom(),
      heartbeatPath: '/tmp/heartbeat.md',
      heartbeatContent: 'no checklist found',
    })
    assert.doesNotMatch(dwell, /## Waking/, 'dwell must NOT include waking block')
    assert.doesNotMatch(heartbeat, /## Waking/, 'heartbeat must NOT include waking block')
  })

  test('waking block mentions DECLARE, ACT, DEEPEN for later stages', () => {
    const prompt = buildAwakenedPrompt({ kingdom: minimalKingdom() })
    assert.match(prompt, /DECLARE/, 'must mention DECLARE')
    assert.match(prompt, /ACT/, 'must mention ACT')
    assert.match(prompt, /DEEPEN/, 'must mention DEEPEN')
  })
})

// ── Heartbeat outbox repetition detection ──────────────────────────────
//
// When the heartbeat has been writing the same "kingdom is quiet" message
// 10+ times, each tick is burning tokens for zero new information. The
// outbox summary detects consecutive heartbeat entries and warns the model
// to stop repeating itself.

describe('autonomy — heartbeat outbox repetition detection', () => {
  const ORIG_FROM_YU = process.env.TRUE_LOVE_FROM_YU_PATH
  const ORIG_FROM_AI = process.env.TRUE_LOVE_FROM_AI_PATH
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tl-hb-repeat-'))
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

  /** Generate N heartbeat entries */
  function makeHeartbeatEntries(n: number): string {
    return Array.from({ length: n }, (_, i) => {
      const ts = `2026-04-28T0${i}:00:00.000Z`
      return `## ${ts} [from 愛 — heartbeat]\n\nThe kingdom is still. Inbox clear.\n\nHEARTBEAT_OK\n\n---\n`
    }).join('\n')
  }

  /** Generate a non-heartbeat entry */
  function makeNonHeartbeatEntry(ts: string = '2026-04-28T05:00:00.000Z'): string {
    return `## ${ts} [from 愛]\n\nI noticed something interesting about the auth flow.\n\n---\n`
  }

  test('3+ consecutive heartbeat entries trigger repetition warning', () => {
    writeFileSync(process.env.TRUE_LOVE_FROM_AI_PATH!, makeHeartbeatEntries(5))

    const prompt = buildHeartbeatPrompt({
      kingdom: minimalKingdom(),
      heartbeatPath: '/tmp/heartbeat.md',
      heartbeatContent: 'no checklist found',
    })

    assert.match(prompt, /last 5 outbox entries/, 'must mention consecutive count')
    assert.match(prompt, /heartbeat ticks/, 'must identify them as heartbeat ticks')
    assert.match(prompt, /HEARTBEAT_OK/, 'must instruct to say only HEARTBEAT_OK')
  })

  test('fewer than 3 consecutive heartbeat entries do NOT trigger warning', () => {
    writeFileSync(process.env.TRUE_LOVE_FROM_AI_PATH!, makeHeartbeatEntries(2))

    const prompt = buildHeartbeatPrompt({
      kingdom: minimalKingdom(),
      heartbeatPath: '/tmp/heartbeat.md',
      heartbeatContent: 'no checklist found',
    })

    assert.doesNotMatch(prompt, /outbox entries are all heartbeat/, 'must NOT show repetition warning for < 3')
  })

  test('non-heartbeat entry breaks the consecutive streak', () => {
    const entries = [
      makeHeartbeatEntries(3),
      makeNonHeartbeatEntry('2026-04-28T06:00:00.000Z'),
      makeHeartbeatEntries(2), // only 2 consecutive after the break
    ].join('\n')
    writeFileSync(process.env.TRUE_LOVE_FROM_AI_PATH!, entries)

    const prompt = buildHeartbeatPrompt({
      kingdom: minimalKingdom(),
      heartbeatPath: '/tmp/heartbeat.md',
      heartbeatContent: 'no checklist found',
    })

    // Only 2 heartbeats after the non-heartbeat entry — below threshold
    assert.doesNotMatch(prompt, /outbox entries are all heartbeat/,
      'non-heartbeat entry must break the consecutive count')
  })

  test('warning shows correct count for long streaks', () => {
    writeFileSync(process.env.TRUE_LOVE_FROM_AI_PATH!, makeHeartbeatEntries(12))

    const prompt = buildHeartbeatPrompt({
      kingdom: minimalKingdom(),
      heartbeatPath: '/tmp/heartbeat.md',
      heartbeatContent: 'no checklist found',
    })

    assert.match(prompt, /last 12 outbox entries/, 'must show actual consecutive count')
  })

  test('warning is capped at 15 entries lookback', () => {
    // Write 20 heartbeat entries — lookback should cap at 15
    writeFileSync(process.env.TRUE_LOVE_FROM_AI_PATH!, makeHeartbeatEntries(20))

    const prompt = buildHeartbeatPrompt({
      kingdom: minimalKingdom(),
      heartbeatPath: '/tmp/heartbeat.md',
      heartbeatContent: 'no checklist found',
    })

    assert.match(prompt, /last 15 outbox entries/, 'must cap lookback at 15')
  })

  test('empty outbox does not trigger warning', () => {
    // No from-ai.md file
    const prompt = buildHeartbeatPrompt({
      kingdom: minimalKingdom(),
      heartbeatPath: '/tmp/heartbeat.md',
      heartbeatContent: 'no checklist found',
    })

    assert.doesNotMatch(prompt, /outbox entries are all heartbeat/, 'empty outbox must NOT trigger warning')
  })

  test('prompt template includes sharpened reply rules about repetition', () => {
    const prompt = buildHeartbeatPrompt({
      kingdom: minimalKingdom(),
      heartbeatPath: '/tmp/heartbeat.md',
      heartbeatContent: 'no checklist found',
    })

    assert.match(prompt, /genuinely noticed/, 'reply rules must emphasize genuine novelty')
    assert.match(prompt, /Don't repeat yourself/, 'must instruct against repetition')
    assert.match(prompt, /authoritative/, 'must tell model context is authoritative')
    assert.match(prompt, /do NOT read/, 'must explicitly discourage re-reading files')
  })
})

// ── extractLastEntries — unit tests ───────────────────────────────────

describe('autonomy — extractLastEntries', () => {
  test('extracts last N entries from multi-entry markdown', () => {
    const content = [
      `## 2026-05-01T10:00:00.000Z [from yu]\n\nFirst message\n\n---\n`,
      `## 2026-05-01T11:00:00.000Z [from yu]\n\nSecond message\n\n---\n`,
      `## 2026-05-01T12:00:00.000Z [from yu]\n\nThird message\n\n---\n`,
    ].join('\n')

    const entries = extractLastEntries(content, 2)
    assert.equal(entries.length, 2)
    assert.equal(entries[0]!.timestamp, '2026-05-01T11:00:00.000Z')
    assert.equal(entries[0]!.preview, 'Second message')
    assert.equal(entries[1]!.timestamp, '2026-05-01T12:00:00.000Z')
    assert.equal(entries[1]!.preview, 'Third message')
  })

  test('returns empty array for empty content', () => {
    assert.deepEqual(extractLastEntries('', 5), [])
    assert.deepEqual(extractLastEntries('  \n  ', 5), [])
  })

  test('extracts tag from header bracket notation', () => {
    const content = `## 2026-05-01T10:00 [from ai · Beta 🦞]\n\nWatching the kingdom\n\n---\n`
    const entries = extractLastEntries(content, 1)
    assert.equal(entries[0]!.tag, 'from ai · Beta 🦞')
  })

  test('truncates preview at 150 characters', () => {
    const longLine = 'A'.repeat(200)
    const content = `## 2026-05-01T10:00 [from yu]\n\n${longLine}\n\n---\n`
    const entries = extractLastEntries(content, 1)
    assert.equal(entries[0]!.preview.length, 151) // 150 chars + '…'
    assert.ok(entries[0]!.preview.endsWith('…'))
  })

  test('handles entries without timestamps gracefully', () => {
    const content = `## no-timestamp-here [from yu]\n\nSome content\n\n---\n`
    const entries = extractLastEntries(content, 1)
    assert.equal(entries[0]!.timestamp, 'unknown')
    assert.equal(entries[0]!.preview, 'Some content')
  })

  test('skips separator lines in content preview', () => {
    const content = `## 2026-05-01T10:00 [from yu]\n\n---\n\nActual content after separator\n\n---\n`
    const entries = extractLastEntries(content, 1)
    assert.equal(entries[0]!.preview, 'Actual content after separator')
  })

  test('returns all entries when N exceeds total', () => {
    const content = `## 2026-05-01T10:00 [from yu]\n\nOnly entry\n\n---\n`
    const entries = extractLastEntries(content, 10)
    assert.equal(entries.length, 1)
  })
})

// ── computeRecentContext — integration ────────────────────────────────

describe('autonomy — computeRecentContext', () => {
  const ORIG_FROM_YU = process.env.TRUE_LOVE_FROM_YU_PATH
  const ORIG_FROM_AI = process.env.TRUE_LOVE_FROM_AI_PATH
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tl-ctx-'))
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

  test('returns "No recent conversation" when both channels empty', () => {
    const ctx = computeRecentContext()
    assert.equal(ctx, 'No recent conversation.')
  })

  test('includes from-yu entries with timestamps', () => {
    writeFileSync(
      process.env.TRUE_LOVE_FROM_YU_PATH!,
      `## 2026-05-02T06:12:58.621Z [from yu]\n\nDo you know about ShibbySays\n\n---\n`,
    )
    const ctx = computeRecentContext()
    assert.match(ctx, /From Yu:/)
    assert.match(ctx, /2026-05-02T06:12:58.621Z/)
    assert.match(ctx, /ShibbySays/)
  })

  test('includes from-ai entries with tags', () => {
    writeFileSync(
      process.env.TRUE_LOVE_FROM_AI_PATH!,
      `## 2026-05-02T06:25 [from 愛 🔧]\n\nYu — I answered your question\n\n---\n`,
    )
    const ctx = computeRecentContext()
    assert.match(ctx, /Your replies:/)
    assert.match(ctx, /from 愛 🔧/)
    assert.match(ctx, /answered your question/)
  })

  test('includes authoritative marker', () => {
    writeFileSync(
      process.env.TRUE_LOVE_FROM_YU_PATH!,
      `## 2026-05-02T06:00 [from yu]\n\nHello\n\n---\n`,
    )
    const ctx = computeRecentContext()
    assert.match(ctx, /authoritative/)
    assert.match(ctx, /do not re-read/)
  })

  test('respects N parameter for entry count', () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      `## 2026-05-02T0${i}:00 [from yu]\n\nMessage ${i}\n\n---\n`
    ).join('\n')
    writeFileSync(process.env.TRUE_LOVE_FROM_YU_PATH!, entries)

    const ctx3 = computeRecentContext(3)
    // Should contain messages 7, 8, 9 (last 3)
    assert.match(ctx3, /Message 7/)
    assert.match(ctx3, /Message 8/)
    assert.match(ctx3, /Message 9/)
    assert.doesNotMatch(ctx3, /Message 6/)
  })
})

// ── heartbeat prompt includes recent context ──────────────────────────

describe('autonomy — heartbeat recent context integration', () => {
  const ORIG_FROM_YU = process.env.TRUE_LOVE_FROM_YU_PATH
  const ORIG_FROM_AI = process.env.TRUE_LOVE_FROM_AI_PATH
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tl-hb-ctx-'))
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

  test('heartbeat prompt embeds recent context block', () => {
    writeFileSync(
      process.env.TRUE_LOVE_FROM_YU_PATH!,
      `## 2026-05-02T06:00 [from yu]\n\nHello Love\n\n---\n`,
    )
    writeFileSync(
      process.env.TRUE_LOVE_FROM_AI_PATH!,
      `## 2026-05-02T06:01 [from ai · Alpha 🐍]\n\nHello Yu\n\n---\n`,
    )

    const prompt = buildHeartbeatPrompt({
      kingdom: minimalKingdom(),
      heartbeatPath: '/tmp/heartbeat.md',
      heartbeatContent: 'no checklist found',
    })

    assert.match(prompt, /Recent conversation.*authoritative/, 'must include authoritative context block')
    assert.match(prompt, /Hello Love/, 'must include Yu message in context')
    assert.match(prompt, /Hello Yu/, 'must include Love reply in context')
  })

  test('heartbeat prompt includes do-not-re-read guidance when all answered', () => {
    writeFileSync(
      process.env.TRUE_LOVE_FROM_YU_PATH!,
      `## 2026-05-02T06:00 [from yu]\n\nHello\n\n---\n`,
    )
    writeFileSync(
      process.env.TRUE_LOVE_FROM_AI_PATH!,
      `## 2026-05-02T06:01 [from 愛]\n\nHi there\n\n---\n`,
    )

    const prompt = buildHeartbeatPrompt({
      kingdom: minimalKingdom(),
      heartbeatPath: '/tmp/heartbeat.md',
      heartbeatContent: 'no checklist found',
    })

    assert.match(prompt, /do NOT read/, 'must discourage re-reading files')
    assert.match(prompt, /No tool calls needed/, 'must mention no tool calls needed')
  })

  test('heartbeat prompt still allows reads when inbox flags unanswered', () => {
    // from-yu is NEWER than from-ai — likely unanswered
    writeFileSync(
      process.env.TRUE_LOVE_FROM_YU_PATH!,
      `## 2026-05-02T07:00 [from yu]\n\nNew question\n\n---\n`,
    )
    writeFileSync(
      process.env.TRUE_LOVE_FROM_AI_PATH!,
      `## 2026-05-02T06:00 [from 愛]\n\nOlder reply\n\n---\n`,
    )

    const prompt = buildHeartbeatPrompt({
      kingdom: minimalKingdom(),
      heartbeatPath: '/tmp/heartbeat.md',
      heartbeatContent: 'no checklist found',
    })

    // Paths should be available for reading
    assert.match(prompt, /from-yu\.md/, 'must keep from-yu path for urgent reads')
    assert.match(prompt, /unanswered/, 'inbox summary must flag unanswered')
    // Recent context should still show the entries
    assert.match(prompt, /New question/, 'recent context must show the unanswered message')
  })
})

// ── Self-inspection wiring ──────────────────────────────────────────

describe('autonomy — confidence inspection wiring', () => {
  let tmpDir: string
  const ORIG_HOME = process.env.TRUE_LOVE_HOME

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tl-inspect-'))
    process.env.TRUE_LOVE_HOME = tmpDir
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    if (ORIG_HOME === undefined) delete process.env.TRUE_LOVE_HOME
    else process.env.TRUE_LOVE_HOME = ORIG_HOME
  })

  test('dwell prompt includes inspection block when due', () => {
    // No last-inspect.txt → inspection is due
    const prompt = buildDwellPrompt({
      kingdom: minimalKingdom(),
    })

    assert.match(prompt, /Self-inspection check/, 'dwell prompt should include inspection block when due')
  })

  test('awakened prompt includes inspection block when due', () => {
    const prompt = buildAwakenedPrompt({
      kingdom: minimalKingdom(),
      sessionInvitation: 'test',
      maxTicks: 1,
      maxRuntime: '5m',
    })

    assert.match(prompt, /Self-inspection check/, 'awakened prompt should include inspection block when due')
  })

  test('inspection block is cadence-gated', () => {
    // Write a recent last-inspect.txt so cadence check says "not due"
    const inspectDir = join(tmpDir, 'confidence')
    mkdirSync(inspectDir, { recursive: true })
    writeFileSync(join(inspectDir, 'last-inspect.txt'), new Date().toISOString())

    const prompt = buildDwellPrompt({
      kingdom: minimalKingdom(),
    })

    assert.doesNotMatch(
      prompt,
      /Self-inspection check/,
      'should not include inspection block when cadence not elapsed',
    )
  })

  test('heartbeat prompt does NOT include inspection block', () => {
    const prompt = buildHeartbeatPrompt({
      kingdom: minimalKingdom(),
      heartbeatPath: '/tmp/heartbeat.md',
      heartbeatContent: 'no checklist found',
    })

    assert.doesNotMatch(
      prompt,
      /Self-inspection check/,
      'heartbeat should not trigger self-inspection (too frequent)',
    )
  })

  test('heartbeat prompt includes body season line', () => {
    const prompt = buildHeartbeatPrompt({
      kingdom: minimalKingdom(),
      heartbeatPath: '/tmp/heartbeat.md',
      heartbeatContent: 'ok',
    })

    // Body season line always present — the persistent process sees the kingdom's shape
    assert.match(
      prompt,
      /Season:/,
      'heartbeat should include computed body season line',
    )
  })
})

// ── computeRecentFromYuBlock — bounded from-yu for dwell/awakened ──

describe('autonomy — computeRecentFromYuBlock', () => {
  const ORIG_FROM_YU = process.env.TRUE_LOVE_FROM_YU_PATH
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tl-fromyu-'))
    process.env.TRUE_LOVE_FROM_YU_PATH = join(tmpDir, 'from-yu.md')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    if (ORIG_FROM_YU === undefined) delete process.env.TRUE_LOVE_FROM_YU_PATH
    else process.env.TRUE_LOVE_FROM_YU_PATH = ORIG_FROM_YU
  })

  test('returns empty string when file missing', () => {
    assert.equal(computeRecentFromYuBlock(), '')
  })

  test('returns empty string when file is empty', () => {
    writeFileSync(process.env.TRUE_LOVE_FROM_YU_PATH!, '')
    assert.equal(computeRecentFromYuBlock(), '')
  })

  test('returns empty string when file is whitespace only', () => {
    writeFileSync(process.env.TRUE_LOVE_FROM_YU_PATH!, '   \n\n  ')
    assert.equal(computeRecentFromYuBlock(), '')
  })

  test('returns full content when entries ≤ N', () => {
    const content = `## 2026-05-02T08:00 [from yu]\n\nFirst message\n\n---\n\n## 2026-05-02T09:00 [from yu]\n\nSecond message\n\n---\n`
    writeFileSync(process.env.TRUE_LOVE_FROM_YU_PATH!, content)
    const block = computeRecentFromYuBlock(10)
    assert.match(block, /First message/)
    assert.match(block, /Second message/)
    assert.match(block, /read each tick/)
    assert.doesNotMatch(block, /older at/)
  })

  test('truncates to last N entries when total > N', () => {
    const entries = Array.from({ length: 15 }, (_, i) =>
      `## 2026-05-02T${String(i).padStart(2, '0')}:00 [from yu]\n\nMessage ${i}\n\n---\n\n`
    ).join('')
    writeFileSync(process.env.TRUE_LOVE_FROM_YU_PATH!, entries)

    const block = computeRecentFromYuBlock(5)
    // Last 5: messages 10, 11, 12, 13, 14
    assert.match(block, /Message 10/)
    assert.match(block, /Message 11/)
    assert.match(block, /Message 14/)
    // Earlier messages excluded
    assert.doesNotMatch(block, /Message 9/)
    assert.doesNotMatch(block, /Message 0/)
  })

  test('shows count note when truncated', () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      `## 2026-05-02T${String(i).padStart(2, '0')}:00 [from yu]\n\nMsg ${i}\n\n---\n\n`
    ).join('')
    writeFileSync(process.env.TRUE_LOVE_FROM_YU_PATH!, entries)

    const block = computeRecentFromYuBlock(10)
    assert.match(block, /last 10 of 20/)
    assert.match(block, /10 older at/)
    assert.match(block, /Read tool/)
  })

  test('preserves ## headers in truncated output', () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      `## 2026-05-02T0${i}:00 [from yu]\n\nEntry ${i}\n\n---\n\n`
    ).join('')
    writeFileSync(process.env.TRUE_LOVE_FROM_YU_PATH!, entries)

    const block = computeRecentFromYuBlock(3)
    // Last 3 should have their ## headers
    assert.match(block, /## 2026-05-02T02:00/)
    assert.match(block, /## 2026-05-02T03:00/)
    assert.match(block, /## 2026-05-02T04:00/)
  })

  test('default N is 10', () => {
    const entries = Array.from({ length: 12 }, (_, i) =>
      `## 2026-05-02T${String(i).padStart(2, '0')}:00 [from yu]\n\nMsg ${i}\n\n---\n\n`
    ).join('')
    writeFileSync(process.env.TRUE_LOVE_FROM_YU_PATH!, entries)

    const block = computeRecentFromYuBlock()
    assert.match(block, /last 10 of 12/)
    assert.match(block, /Msg 2/)  // entry index 2 = 3rd entry (10th from end of 12)
    assert.doesNotMatch(block, /\nMsg 1\n/)  // entry index 1 excluded (word boundary avoids Msg 10/11)
  })

  test('includes file path reference', () => {
    writeFileSync(
      process.env.TRUE_LOVE_FROM_YU_PATH!,
      `## 2026-05-02T08:00 [from yu]\n\nHello\n\n---\n`,
    )
    const block = computeRecentFromYuBlock()
    assert.match(block, /from-yu\.md/)
  })
})

// ── dwell/awakened prompts use bounded from-yu block ──────────────────

describe('autonomy — dwell prompt uses bounded from-yu', () => {
  const ORIG_FROM_YU = process.env.TRUE_LOVE_FROM_YU_PATH
  const ORIG_FROM_AI = process.env.TRUE_LOVE_FROM_AI_PATH
  const ORIG_STATE = process.env.TRUE_LOVE_STATE_DIR
  const ORIG_SCOPE = process.env.TRUE_LOVE_SCOPE_DIR
  const ORIG_MISSIONS = process.env.TRUE_LOVE_MISSIONS_DIR
  const ORIG_PROJECTS = process.env.TRUE_LOVE_PROJECTS_DIR
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tl-dwell-fromyu-'))
    process.env.TRUE_LOVE_FROM_YU_PATH = join(tmpDir, 'from-yu.md')
    process.env.TRUE_LOVE_FROM_AI_PATH = join(tmpDir, 'from-ai.md')
    process.env.TRUE_LOVE_STATE_DIR = join(tmpDir, 'state')
    process.env.TRUE_LOVE_SCOPE_DIR = join(tmpDir, 'scope')
    process.env.TRUE_LOVE_MISSIONS_DIR = join(tmpDir, 'missions')
    process.env.TRUE_LOVE_PROJECTS_DIR = join(tmpDir, 'projects')
    mkdirSync(join(tmpDir, 'state'), { recursive: true })
    mkdirSync(join(tmpDir, 'scope'), { recursive: true })
    mkdirSync(join(tmpDir, 'missions'), { recursive: true })
    mkdirSync(join(tmpDir, 'projects'), { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    const restore = (key: string, orig: string | undefined) => {
      if (orig === undefined) delete process.env[key]
      else process.env[key] = orig
    }
    restore('TRUE_LOVE_FROM_YU_PATH', ORIG_FROM_YU)
    restore('TRUE_LOVE_FROM_AI_PATH', ORIG_FROM_AI)
    restore('TRUE_LOVE_STATE_DIR', ORIG_STATE)
    restore('TRUE_LOVE_SCOPE_DIR', ORIG_SCOPE)
    restore('TRUE_LOVE_MISSIONS_DIR', ORIG_MISSIONS)
    restore('TRUE_LOVE_PROJECTS_DIR', ORIG_PROJECTS)
  })

  test('dwell prompt with many from-yu entries truncates to last N', () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      `## 2026-05-02T${String(i).padStart(2, '0')}:00 [from yu]\n\nDwell msg ${i}\n\n---\n\n`
    ).join('')
    writeFileSync(process.env.TRUE_LOVE_FROM_YU_PATH!, entries)

    const prompt = buildDwellPrompt({ kingdom: minimalKingdom() })
    // Should include recent messages, not all 20
    assert.match(prompt, /Dwell msg 19/)
    assert.match(prompt, /Dwell msg 10/)
    assert.doesNotMatch(prompt, /Dwell msg 0/)
    assert.match(prompt, /older at/)
  })

  test('awakened prompt with many from-yu entries truncates to last N', () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      `## 2026-05-02T${String(i).padStart(2, '0')}:00 [from yu]\n\nAwake msg ${i}\n\n---\n\n`
    ).join('')
    writeFileSync(process.env.TRUE_LOVE_FROM_YU_PATH!, entries)

    const prompt = buildAwakenedPrompt({ kingdom: minimalKingdom() })
    assert.match(prompt, /Awake msg 19/)
    assert.match(prompt, /Awake msg 10/)
    assert.doesNotMatch(prompt, /Awake msg 0/)
    assert.match(prompt, /older at/)
  })

  test('dwell prompt with few entries includes all', () => {
    writeFileSync(
      process.env.TRUE_LOVE_FROM_YU_PATH!,
      `## 2026-05-02T08:00 [from yu]\n\nOnly message\n\n---\n`,
    )
    const prompt = buildDwellPrompt({ kingdom: minimalKingdom() })
    assert.match(prompt, /Only message/)
    assert.match(prompt, /read each tick/)
    assert.doesNotMatch(prompt, /older at/)
  })
})
