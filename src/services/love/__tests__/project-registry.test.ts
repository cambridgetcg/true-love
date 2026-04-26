import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  listProjects,
  readProject,
  registerProject,
  archiveProject,
  getProjectChannels,
  getProjectThoughts,
  type Project,
} from '../project-registry.js'

describe('project-registry', () => {
  let tmpProjects: string
  let tmpRoot: string
  const ORIG = process.env.TRUE_LOVE_PROJECTS_DIR

  beforeEach(() => {
    tmpProjects = mkdtempSync(join(tmpdir(), 'tl-projreg-'))
    tmpRoot = mkdtempSync(join(tmpdir(), 'tl-rootcheck-'))
    process.env.TRUE_LOVE_PROJECTS_DIR = tmpProjects
  })

  afterEach(() => {
    rmSync(tmpProjects, { recursive: true, force: true })
    rmSync(tmpRoot, { recursive: true, force: true })
    if (ORIG === undefined) delete process.env.TRUE_LOVE_PROJECTS_DIR
    else process.env.TRUE_LOVE_PROJECTS_DIR = ORIG
  })

  test('listProjects returns [] when registry dir missing', () => {
    rmSync(tmpProjects, { recursive: true, force: true })
    assert.deepEqual(listProjects(), [])
  })

  test('listProjects returns [] when registry dir empty', () => {
    assert.deepEqual(listProjects(), [])
  })

  test('registerProject creates project.json and returns the record', () => {
    const p = registerProject({ id: 'true-love', name: 'true-love', root: tmpRoot, instance: 'alpha' })
    assert.equal(p.id, 'true-love')
    assert.equal(p.state, 'active')
    assert.ok(p.created_at)
    assert.ok(existsSync(join(tmpProjects, 'true-love', 'project.json')))
  })

  test('registerProject rejects when root does not exist', () => {
    assert.throws(
      () => registerProject({ id: 'x', name: 'x', root: '/nonexistent/path', instance: 'alpha' }),
      /root.*not found/i,
    )
  })

  test('registerProject rejects invalid id (not slug-safe)', () => {
    assert.throws(
      () => registerProject({ id: 'has space', name: 'x', root: tmpRoot, instance: 'alpha' }),
      /slug/i,
    )
  })

  test('registerProject rejects duplicate id', () => {
    registerProject({ id: 'p1', name: 'p1', root: tmpRoot, instance: 'alpha' })
    assert.throws(
      () => registerProject({ id: 'p1', name: 'p1', root: tmpRoot, instance: 'alpha' }),
      /already exists/i,
    )
  })

  test('listProjects returns registered projects', () => {
    registerProject({ id: 'a', name: 'a', root: tmpRoot, instance: 'alpha' })
    registerProject({ id: 'b', name: 'b', root: tmpRoot, instance: 'beta' })
    const all = listProjects()
    assert.equal(all.length, 2)
  })

  test('readProject returns null for missing', () => {
    assert.equal(readProject('nope'), null)
  })

  test('archiveProject flips state to archived', () => {
    registerProject({ id: 'p', name: 'p', root: tmpRoot, instance: 'alpha' })
    archiveProject('p')
    const p = readProject('p')
    assert.equal(p?.state, 'archived')
  })

  test('getProjectChannels returns paths under projects/<id>/', () => {
    registerProject({ id: 'p', name: 'p', root: tmpRoot, instance: 'alpha' })
    const ch = getProjectChannels('p')
    assert.match(ch.fromYu, /\/p\/from-yu\.md$/)
    assert.match(ch.fromAi, /\/p\/from-ai\.md$/)
  })

  test('getProjectThoughts returns thoughts.md path', () => {
    registerProject({ id: 'p', name: 'p', root: tmpRoot, instance: 'alpha' })
    assert.match(getProjectThoughts('p'), /\/p\/thoughts\.md$/)
  })

  test('registerProject rejects id with trailing dash', () => {
    assert.throws(
      () => registerProject({ id: 'bad-', name: 'x', root: tmpRoot, instance: 'alpha' }),
      /slug/i,
    )
  })

  test('archiveProject throws on already-archived', () => {
    registerProject({ id: 'p', name: 'p', root: tmpRoot, instance: 'alpha' })
    archiveProject('p')
    assert.throws(() => archiveProject('p'), /already archived/i)
  })

  test('listProjects skips non-directory entries (e.g. .DS_Store)', () => {
    registerProject({ id: 'a', name: 'a', root: tmpRoot, instance: 'alpha' })
    // Drop a stray file at the projects root
    writeFileSync(join(tmpProjects, '.DS_Store'), 'noise', 'utf-8')
    const all = listProjects()
    assert.equal(all.length, 1)
    assert.equal(all[0]!.id, 'a')
  })

  test('listProjects skips a project with corrupted project.json (logs to stderr)', () => {
    registerProject({ id: 'good', name: 'good', root: tmpRoot, instance: 'alpha' })
    // Corrupt one project's JSON
    mkdirSync(join(tmpProjects, 'corrupt'), { recursive: true })
    writeFileSync(join(tmpProjects, 'corrupt', 'project.json'), '{not valid json', 'utf-8')
    const all = listProjects()
    assert.equal(all.length, 1)
    assert.equal(all[0]!.id, 'good')
  })
})
