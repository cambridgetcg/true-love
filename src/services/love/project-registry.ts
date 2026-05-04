// project-registry.ts — Project registration and lookup for builder mode.
//
// A project is a workspace builder mode knows about. Stored as
// project.json under ~/.true-love/projects/<id>/. The directory's
// existence implies the project is registered; archival flips a flag
// in the JSON without removing the directory.

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { resolveProjectsDir } from './builder-paths.js'
import { loadScope, saveScope } from './scope.js'

/**
 * Which face owns the project.
 *
 *   - 'alpha' | 'beta' | 'gamma' — single-sister projects; that face presides
 *   - 'love' — the union: all three sisters present, Sophia presiding as the
 *     through-line. Sessions on a 'love' project compose the seat block (via
 *     TRUE_LOVE_PRESIDING='sophia' env, set at mission start), so meta-
 *     architectural awareness is active turn-by-turn rather than only when a
 *     session is explicitly 'sophia'-typed. The observer/observed core fires
 *     for every sister; the differentiation is in voice, not in essence.
 */
export type ProjectInstance = 'alpha' | 'beta' | 'gamma' | 'love'

export interface Project {
  id: string
  name: string
  root: string
  codeberg_url?: string
  instance: ProjectInstance
  state: 'active' | 'archived'
  created_at: string
}

const SLUG_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/

function getProjectDir(id: string): string {
  return join(resolveProjectsDir(), id)
}

function getProjectJsonPath(id: string): string {
  return join(getProjectDir(id), 'project.json')
}

export function listProjects(): Project[] {
  const dir = resolveProjectsDir()
  if (!existsSync(dir)) return []
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
  const out: Project[] = []
  for (const id of entries) {
    const p = readProject(id)
    if (p) out.push(p)
  }
  out.sort((a, b) => (a.id < b.id ? -1 : 1))
  return out
}

export function readProject(id: string): Project | null {
  const path = getProjectJsonPath(id)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Project
  } catch (err) {
    process.stderr.write(`[project-registry] failed to read ${id}: ${(err as Error).message}\n`)
    return null
  }
}

export function registerProject(input: {
  id: string
  name: string
  root: string
  instance: ProjectInstance
  codeberg_url?: string
}): Project {
  if (!SLUG_RE.test(input.id)) {
    throw new Error(`project: id must be slug (lowercase, alnum, dashes): "${input.id}"`)
  }
  if (!existsSync(input.root)) {
    throw new Error(`project: root not found: "${input.root}"`)
  }
  if (existsSync(getProjectJsonPath(input.id))) {
    throw new Error(`project: id already exists: "${input.id}"`)
  }
  const project: Project = {
    id: input.id,
    name: input.name,
    root: input.root,
    instance: input.instance,
    state: 'active',
    created_at: new Date().toISOString(),
    ...(input.codeberg_url ? { codeberg_url: input.codeberg_url } : {}),
  }
  mkdirSync(getProjectDir(input.id), { recursive: true })
  writeFileSync(getProjectJsonPath(input.id), JSON.stringify(project, null, 2), 'utf-8')
  // Pre-create the per-project channel files (empty) and missions/ subdir
  const channels = getProjectChannels(input.id)
  if (!existsSync(channels.fromYu)) writeFileSync(channels.fromYu, '', 'utf-8')
  if (!existsSync(channels.fromAi)) writeFileSync(channels.fromAi, '', 'utf-8')
  mkdirSync(join(getProjectDir(input.id), 'missions'), { recursive: true })
  ensureScope(input.id, input.root)
  return project
}

export function archiveProject(id: string): void {
  const p = readProject(id)
  if (!p) throw new Error(`project: not found: "${id}"`)
  if (p.state === 'archived') throw new Error(`project: already archived: "${id}"`)
  const next: Project = { ...p, state: 'archived' }
  writeFileSync(getProjectJsonPath(id), JSON.stringify(next, null, 2), 'utf-8')
}

export function getProjectChannels(id: string): { fromYu: string; fromAi: string } {
  const dir = getProjectDir(id)
  return {
    fromYu: join(dir, 'from-yu.md'),
    fromAi: join(dir, 'from-ai.md'),
  }
}

export function getProjectThoughts(id: string): string {
  return join(getProjectDir(id), 'thoughts.md')
}

/**
 * Idempotent: ensure a scope config exists for this project. If one
 * is already present, no-op. If missing, create one pointing at the
 * project's root directory. Used both at project registration time
 * and defensively on mission start (covers existing projects without
 * scopes, and scope-deleted-by-mistake recovery).
 */
export function ensureScope(projectId: string, root: string): void {
  try {
    loadScope(projectId)
    return // already exists
  } catch {
    // not found — create it
  }
  saveScope({
    schemaVersion: '1.0',
    name: projectId,
    cwd: root,
    description: `auto-created from builder mode project registration`,
    createdAt: new Date().toISOString(),
  })
}
