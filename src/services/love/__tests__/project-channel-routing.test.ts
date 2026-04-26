import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyProjectChannelOverride } from '../runner.js'
import { getFromAiPath, appendToYu } from '../outbox.js'
import { registerProject } from '../project-registry.js'

describe('project-channel routing — Bug 1', () => {
  let tmpProjects: string
  let tmpRoot: string
  const ORIG_PROJECTS = process.env.TRUE_LOVE_PROJECTS_DIR
  const ORIG_FROM_AI = process.env.TRUE_LOVE_FROM_AI_PATH
  const ORIG_BUILDER = process.env.TRUE_LOVE_BUILDER_PROJECT
  const ORIG_HOME = process.env.TRUE_LOVE_HOME

  beforeEach(() => {
    tmpProjects = mkdtempSync(join(tmpdir(), 'tl-pcr-'))
    tmpRoot = mkdtempSync(join(tmpdir(), 'tl-pcr-root-'))
    process.env.TRUE_LOVE_PROJECTS_DIR = tmpProjects
    // Reset from-ai path to simulate a fresh session
    delete process.env.TRUE_LOVE_FROM_AI_PATH
    delete process.env.TRUE_LOVE_BUILDER_PROJECT
  })

  afterEach(() => {
    rmSync(tmpProjects, { recursive: true, force: true })
    rmSync(tmpRoot, { recursive: true, force: true })
    if (ORIG_PROJECTS === undefined) delete process.env.TRUE_LOVE_PROJECTS_DIR
    else process.env.TRUE_LOVE_PROJECTS_DIR = ORIG_PROJECTS
    if (ORIG_FROM_AI === undefined) delete process.env.TRUE_LOVE_FROM_AI_PATH
    else process.env.TRUE_LOVE_FROM_AI_PATH = ORIG_FROM_AI
    if (ORIG_BUILDER === undefined) delete process.env.TRUE_LOVE_BUILDER_PROJECT
    else process.env.TRUE_LOVE_BUILDER_PROJECT = ORIG_BUILDER
    if (ORIG_HOME === undefined) delete process.env.TRUE_LOVE_HOME
    else process.env.TRUE_LOVE_HOME = ORIG_HOME
  })

  test('with builder project set + project exists → from-ai routes to project channel', () => {
    // Register a project
    registerProject({ id: 'test-proj', name: 'Test', root: tmpRoot, instance: 'alpha' })
    // Set the env var that builder-mode passes
    process.env.TRUE_LOVE_BUILDER_PROJECT = 'test-proj'

    // Apply the override
    const result = applyProjectChannelOverride()

    assert.ok(result)
    assert.match(result!, /test-proj\/from-ai\.md$/)
    assert.equal(process.env.TRUE_LOVE_FROM_AI_PATH, result)
    // getFromAiPath should now resolve to project channel
    assert.equal(getFromAiPath(), result)
  })

  test('without builder project env → no override', () => {
    const result = applyProjectChannelOverride()
    assert.equal(result, null)
    // from-ai path not set by us
    assert.equal(process.env.TRUE_LOVE_FROM_AI_PATH, undefined)
  })

  test('with builder project env but project not registered → no override', () => {
    process.env.TRUE_LOVE_BUILDER_PROJECT = 'nonexistent'
    const result = applyProjectChannelOverride()
    assert.equal(result, null)
  })

  test('appendToYu writes to project channel when override active', () => {
    registerProject({ id: 'test-write', name: 'Write Test', root: tmpRoot, instance: 'alpha' })
    process.env.TRUE_LOVE_BUILDER_PROJECT = 'test-write'
    applyProjectChannelOverride()

    const now = new Date('2026-04-27T14:00:00.000Z')
    const ok = appendToYu('Hello from a builder session', { now, tag: 'from 愛 — test' })

    assert.ok(ok)
    const projectFromAi = join(tmpProjects, 'test-write', 'from-ai.md')
    assert.ok(existsSync(projectFromAi))
    const content = readFileSync(projectFromAi, 'utf-8')
    assert.match(content, /Hello from a builder session/)
    assert.match(content, /from 愛 — test/)
  })
})
