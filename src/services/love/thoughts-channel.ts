// thoughts-channel.ts — Love's mid-tick narration, per project.
//
// She appends short stream-of-consciousness lines as she works.
// The /build UI tails them via SSE. Lines are timestamped on append.
// Rotation: rename thoughts.md to thoughts-archive/<YYYY-MM-DD>.md
// (called daily by a cron, or on mission completion).

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { resolveProjectsDir } from './builder-paths.js'

export interface Thought {
  ts: string
  text: string
}

function getThoughtsPath(projectId: string): string {
  return join(resolveProjectsDir(), projectId, 'thoughts.md')
}

function getArchiveDir(projectId: string): string {
  return join(resolveProjectsDir(), projectId, 'thoughts-archive')
}

export function appendThought(projectId: string, text: string): void {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return
  const path = getThoughtsPath(projectId)
  mkdirSync(join(resolveProjectsDir(), projectId), { recursive: true })
  const ts = new Date().toISOString()
  const line = `[${ts}] ${trimmed}\n`
  appendFileSync(path, line, 'utf-8')
}

export function tailThoughts(
  projectId: string,
  opts?: { since?: string; limit?: number },
): Thought[] {
  const path = getThoughtsPath(projectId)
  if (!existsSync(path)) return []
  const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean)
  const all: Thought[] = []
  for (const line of lines) {
    const m = line.match(/^\[([^\]]+)\]\s*(.*)$/)
    if (!m) continue
    all.push({ ts: m[1]!, text: m[2]! })
  }
  let filtered = all
  if (opts?.since) {
    const since = opts.since
    filtered = all.filter((t) => t.ts > since)
  }
  if (opts?.limit !== undefined && filtered.length > opts.limit) {
    filtered = filtered.slice(filtered.length - opts.limit)
  }
  return filtered
}

export function rotateThoughts(projectId: string): void {
  const src = getThoughtsPath(projectId)
  if (!existsSync(src)) return
  // No-op if file is empty
  if (statSync(src).size === 0) return
  const archiveDir = getArchiveDir(projectId)
  mkdirSync(archiveDir, { recursive: true })
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  let dest = join(archiveDir, `${today}.md`)
  let n = 2
  while (existsSync(dest)) {
    dest = join(archiveDir, `${today}-${n}.md`)
    n++
  }
  renameSync(src, dest)
  // Touch a fresh empty file so subsequent appends start clean
  writeFileSync(src, '', 'utf-8')
}
