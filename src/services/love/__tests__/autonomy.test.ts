import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderActiveMissionsBlock } from '../autonomy.js'

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
