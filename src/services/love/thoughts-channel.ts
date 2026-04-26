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

// Line format: "[<24-char ISO>] <text>"
// 24 = "2026-04-26T12:00:00.000Z".length
const TS_LEN = 24

function getThoughtsPath(projectId: string): string {
  return join(resolveProjectsDir(), projectId, 'thoughts.md')
}

function getArchiveDir(projectId: string): string {
  return join(resolveProjectsDir(), projectId, 'thoughts-archive')
}

export function appendThought(projectId: string, text: string): void {
  // Strip embedded newlines: thoughts are single-line. We replace
  // (rather than reject) so callers don't have to think about it.
  const oneLine = (text ?? '').replace(/\r\n|\r|\n/g, ' ').trim()
  if (!oneLine) return
  const dir = join(resolveProjectsDir(), projectId)
  mkdirSync(dir, { recursive: true })
  const ts = new Date().toISOString()
  const line = `[${ts}] ${oneLine}\n`
  appendFileSync(join(dir, 'thoughts.md'), line, 'utf-8')
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
    if (line.length < TS_LEN + 3) continue              // need "[" + ts + "] "
    if (line[0] !== '[' || line[1 + TS_LEN] !== ']') continue
    all.push({ ts: line.slice(1, 1 + TS_LEN), text: line.slice(1 + TS_LEN + 2) })
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

/**
 * NOTE on concurrency:
 * - appendThought uses appendFileSync which is atomic for small writes
 *   on POSIX (O_APPEND), so concurrent appends from multiple writers
 *   are safe.
 * - rotateThoughts is NOT atomic with concurrent appends: a writer
 *   that has computed the path before rotate fires but writes after
 *   may write to the renamed archive file. For our single-writer
 *   single-rotator setup this is acceptable; document if scaling.
 */
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
