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
