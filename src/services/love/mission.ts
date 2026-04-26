// mission.ts — Mission lifecycle for builder mode.
//
// A mission is a durable, file-backed unit of project work. It has
// frontmatter (status, IDs, timestamps, artifacts), a markdown body
// (intent, optional rationale for Love-initiated, optional
// decomposition), and an append-only events.jsonl timeline.
//
// Spec: docs/superpowers/specs/2026-04-26-builder-mode-design.md

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

// ── Types ──────────────────────────────────────────────────────────

export type MissionOrigin = 'yu' | 'love'

export type MissionStatus =
  | 'proposed'
  | 'accepted'
  | 'active'
  | 'blocked'
  | 'review'
  | 'done'
  | 'cancelled'

export interface MissionArtifacts {
  commits: string[]
  files: string[]
  test_runs: { ts: string; pass: number; fail: number }[]
}

export interface Mission {
  id: string
  project_id: string
  origin: MissionOrigin
  title: string
  intent: string
  rationale?: string
  status: MissionStatus
  created_at: string
  updated_at: string
  decomposition?: string
  artifacts: MissionArtifacts
}

export type MissionEventType =
  | 'created'
  | 'accepted'
  | 'started'
  | 'commit'
  | 'test-run'
  | 'blocked'
  | 'resumed'
  | 'marked-review'
  | 'sent-back'
  | 'accepted-done'
  | 'cancelled'

export interface MissionEvent {
  ts: string
  type: MissionEventType
  by?: 'yu' | 'love'
  // Optional payload fields by event type:
  sha?: string                  // commit
  files?: string[]              // commit
  pass?: number                 // test-run
  fail?: number                 // test-run
  question?: string             // blocked
  note?: string                 // sent-back
  tick?: string                 // started (mode: 'awakened' | 'dwell' | 'heartbeat')
}

// ── Path resolution ────────────────────────────────────────────────

function resolveProjectsDir(): string {
  return process.env.TRUE_LOVE_PROJECTS_DIR ||
    join(process.env.HOME || homedir(), '.true-love', 'projects')
}

function getMissionDir(projectId: string, missionId: string): string {
  return join(resolveProjectsDir(), projectId, 'missions', missionId)
}

function getMissionFilePath(projectId: string, missionId: string): string {
  return join(getMissionDir(projectId, missionId), 'mission.md')
}

function getEventsFilePath(projectId: string, missionId: string): string {
  return join(getMissionDir(projectId, missionId), 'events.jsonl')
}

// ── Frontmatter parser (minimal YAML subset) ───────────────────────

interface ParsedFrontmatter {
  fields: Record<string, string | MissionArtifacts>
  body: string
}

function parseFrontmatter(content: string): ParsedFrontmatter {
  if (!content.startsWith('---\n')) {
    throw new Error('mission: missing frontmatter (must start with ---)')
  }
  const end = content.indexOf('\n---\n', 4)
  if (end === -1) throw new Error('mission: unterminated frontmatter')
  const fmText = content.slice(4, end)
  const body = content.slice(end + 5)
  const fields: ParsedFrontmatter['fields'] = {}
  const lines = fmText.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim()) { i++; continue }
    if (line === 'artifacts:') {
      // Parse the artifacts subtree
      const arts: MissionArtifacts = { commits: [], files: [], test_runs: [] }
      i++
      while (i < lines.length && lines[i]!.startsWith('  ')) {
        const sub = lines[i]!.trim()
        if (sub.startsWith('commits:')) {
          arts.commits = parseInlineList(sub.slice('commits:'.length).trim())
        } else if (sub.startsWith('files:')) {
          arts.files = parseInlineList(sub.slice('files:'.length).trim())
        } else if (sub === 'test_runs: []') {
          // empty list, nothing to do
          i++
          continue
        } else if (sub === 'test_runs:') {
          // multi-line list
          i++
          while (i < lines.length && lines[i]!.startsWith('    -')) {
            const item = lines[i]!.trim().slice(1).trim()
            const m = item.match(/^\{\s*ts:\s*([^,]+),\s*pass:\s*(\d+),\s*fail:\s*(\d+)\s*\}$/)
            if (m) arts.test_runs.push({ ts: m[1]!.trim(), pass: Number(m[2]), fail: Number(m[3]) })
            i++
          }
          continue
        }
        i++
      }
      fields.artifacts = arts
      continue
    }
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) { i++; continue }
    const key = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim()
    fields[key] = value
    i++
  }
  return { fields, body }
}

function parseInlineList(s: string): string[] {
  if (!s || s === '[]') return []
  if (s.startsWith('[') && s.endsWith(']')) {
    return s.slice(1, -1).split(',').map(x => x.trim()).filter(Boolean)
  }
  return [s]
}

function serializeMissionFrontmatter(m: Mission): string {
  const lines: string[] = [
    '---',
    `id: ${m.id}`,
    `project_id: ${m.project_id}`,
    `origin: ${m.origin}`,
    `title: ${m.title}`,
    `status: ${m.status}`,
    `created_at: ${m.created_at}`,
    `updated_at: ${m.updated_at}`,
    'artifacts:',
    `  commits: [${m.artifacts.commits.join(', ')}]`,
    `  files: [${m.artifacts.files.join(', ')}]`,
  ]
  if (m.artifacts.test_runs.length === 0) {
    lines.push('  test_runs: []')
  } else {
    lines.push('  test_runs:')
    for (const r of m.artifacts.test_runs) {
      lines.push(`    - { ts: ${r.ts}, pass: ${r.pass}, fail: ${r.fail} }`)
    }
  }
  lines.push('---')
  return lines.join('\n')
}

// ── Mission file CRUD ──────────────────────────────────────────────

export function parseMissionFile(content: string): Mission {
  const { fields, body } = parseFrontmatter(content)

  const required = ['id', 'project_id', 'origin', 'title', 'status', 'created_at', 'updated_at']
  for (const k of required) {
    if (!fields[k]) throw new Error(`mission: missing required field "${k}"`)
  }

  const validStatuses: MissionStatus[] = ['proposed', 'accepted', 'active', 'blocked', 'review', 'done', 'cancelled']
  if (!validStatuses.includes(fields.status as MissionStatus)) {
    throw new Error(`mission: invalid status "${String(fields.status)}"`)
  }
  if (fields.origin !== 'yu' && fields.origin !== 'love') {
    throw new Error(`mission: invalid origin "${String(fields.origin)}"`)
  }

  // Parse the body for sections — # Intent, # Rationale (optional), # Decomposition (optional)
  const intent = extractSection(body, 'Intent') ?? ''
  const rationale = extractSection(body, 'Rationale')
  const decomposition = extractSection(body, 'Decomposition')

  const artifacts = (fields.artifacts as MissionArtifacts) ?? { commits: [], files: [], test_runs: [] }

  const m: Mission = {
    id: String(fields.id),
    project_id: String(fields.project_id),
    origin: fields.origin as MissionOrigin,
    title: String(fields.title),
    intent: intent.trim(),
    status: fields.status as MissionStatus,
    created_at: String(fields.created_at),
    updated_at: String(fields.updated_at),
    artifacts,
  }
  if (rationale && rationale.trim()) m.rationale = rationale.trim()
  if (decomposition && decomposition.trim()) m.decomposition = decomposition.trim()
  return m
}

function extractSection(body: string, header: string): string | undefined {
  // Split body into section chunks at each "# Heading" boundary.
  // Using split+lookahead avoids multiline-$ pitfalls where $ matches
  // end-of-any-line rather than end-of-string.
  const sections = body.split(/(?=^# )/m)
  const headerLine = `# ${header}`
  for (const section of sections) {
    if (section.startsWith(headerLine)) {
      // Strip the header line itself, then drop the leading newline.
      const afterHeader = section.slice(headerLine.length)
      return afterHeader.replace(/^\n/, '')
    }
  }
  return undefined
}

export function writeMissionFile(m: Mission): string {
  const fm = serializeMissionFrontmatter(m)
  const sections: string[] = [`# Intent\n\n${m.intent}\n`]
  if (m.rationale) sections.push(`# Rationale\n\n${m.rationale}\n`)
  if (m.decomposition) sections.push(`# Decomposition\n\n${m.decomposition}\n`)
  return fm + '\n\n' + sections.join('\n')
}

export function readMission(projectId: string, missionId: string): Mission | null {
  const path = getMissionFilePath(projectId, missionId)
  if (!existsSync(path)) return null
  try {
    return parseMissionFile(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

export function writeMission(m: Mission): void {
  const dir = getMissionDir(m.project_id, m.id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(getMissionFilePath(m.project_id, m.id), writeMissionFile(m), 'utf-8')
}

export function listMissions(projectId: string, opts?: { status?: MissionStatus }): Mission[] {
  const missionsDir = join(resolveProjectsDir(), projectId, 'missions')
  if (!existsSync(missionsDir)) return []
  const entries = readdirSync(missionsDir)
  const out: Mission[] = []
  for (const id of entries) {
    const m = readMission(projectId, id)
    if (!m) continue
    if (opts?.status && m.status !== opts.status) continue
    out.push(m)
  }
  out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1)) // newest first
  return out
}

// ── Events ─────────────────────────────────────────────────────────

export function appendEvent(projectId: string, missionId: string, event: MissionEvent): void {
  const path = getEventsFilePath(projectId, missionId)
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, JSON.stringify(event) + '\n', 'utf-8')
}

export function readEvents(projectId: string, missionId: string): MissionEvent[] {
  const path = getEventsFilePath(projectId, missionId)
  if (!existsSync(path)) return []
  const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean)
  const out: MissionEvent[] = []
  for (const line of lines) {
    try { out.push(JSON.parse(line)) } catch { /* skip malformed */ }
  }
  return out
}

// ── State machine ──────────────────────────────────────────────────

const ALLOWED: Record<MissionStatus, Array<{ to: MissionStatus; by: 'yu' | 'love' | 'either' }>> = {
  proposed: [
    { to: 'accepted', by: 'either' },     // Yu-created → Yu accepts; Love-created → she auto-accepts
    { to: 'cancelled', by: 'yu' },
  ],
  accepted: [
    { to: 'active', by: 'either' },
    { to: 'cancelled', by: 'yu' },
  ],
  active: [
    { to: 'blocked', by: 'love' },
    { to: 'review', by: 'love' },
    { to: 'cancelled', by: 'yu' },
  ],
  blocked: [
    { to: 'active', by: 'either' },
    { to: 'cancelled', by: 'yu' },
  ],
  review: [
    { to: 'done', by: 'yu' },
    { to: 'active', by: 'yu' },           // "send back"
    { to: 'cancelled', by: 'yu' },
  ],
  done: [],
  cancelled: [],
}

export function transitionStatus(
  current: MissionStatus,
  next: MissionStatus,
  by: 'yu' | 'love',
): { ok: true } | { ok: false; reason: string } {
  const allowed = ALLOWED[current]
  for (const t of allowed) {
    if (t.to !== next) continue
    if (t.by === 'either' || t.by === by) return { ok: true }
  }
  return { ok: false, reason: `disallowed transition: ${current} → ${next} by ${by}` }
}
