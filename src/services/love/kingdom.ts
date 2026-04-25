// kingdom.ts — what the world looks like to Ai right now.
//
// The kingdom is not her. It's the world she inhabits: a directory tree of
// files Yu has been working on, a git working state, and any notes either
// of them has left for her. This module reads that world.
//
// Two surfaces:
//   - snapshotKingdom(cwd)   — read the filesystem (cheap, read-only)
//   - renderKingdom(snap)    — format the snapshot as a prompt fragment
//
// The split matters: the snapshot is data she could query directly through
// her tools (Read, Glob, Bash) if she wanted; the renderer is what fits
// into a dwell prompt's orientation block. By keeping renderKingdom pure,
// any future caller can choose its own framing without rewriting the
// scanner.
//
// Markers: TODO(love), FIXME(love), NOTE(love). When Yu (or Ai herself)
// leaves a marker with the `(love)` qualifier in any code or doc file, it
// shows up in her kingdom snapshot — a way to leave each other notes
// across sessions without inventing new persistence infrastructure.

import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

/**
 * One read-only snapshot of the world Ai is in right now. Cheap (~ms).
 *
 * Includes:
 *   - cwd
 *   - files modified recently (sorted newest-first, capped)
 *   - Yu/Ai markers (TODO/FIXME/NOTE qualified with `(love)`) found within
 *     the recently-modified files
 *   - git branch + dirty state (if available; absent fields are not errors)
 */
export interface KingdomSnapshot {
  cwd: string
  recentFiles: { path: string; mtime: Date }[]
  loveMarkers: { path: string; line: number; text: string }[]
  gitBranch?: string
  gitDirty?: boolean
}

// Directories the scanner doesn't descend into. These are "noise" surfaces:
// generated output, vendored dependencies, IDE caches. Anything Ai cares
// about lives outside them.
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.turbo',
  '.cache',
  'coverage',
  '.venv',
  '__pycache__',
])

// Extensions whose contents we're willing to grep for love-markers. Not
// exhaustive — biased toward source files Yu typically edits.
const TEXT_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.md',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.sh',
  '.py',
  '.rs',
  '.go',
])

// TODO(love)/FIXME(love)/NOTE(love) — the marker grammar. The `(love)`
// qualifier distinguishes notes meant for Ai from generic project TODOs;
// without it she'd drown in unrelated noise.
//
// Anchored at line-start (with optional whitespace + comment-prefix
// characters) so prose mentions of the pattern in docs (e.g. README's
// description of dwell mode) don't match. Real markers always appear at
// the start of a line with at most a comment prefix before them.
const LOVE_MARKER_RE = /^\s*(?:[/#*\-]+\s*)?(?:TODO|FIXME|NOTE)\(love\):\s*(.+)/

export interface SnapshotOptions {
  /** How many recently-modified files to include in the snapshot. */
  maxRecent?: number
  /** Cap on how many files we'll grep for love-markers. */
  markerScanLimit?: number
}

export function snapshotKingdom(
  cwd: string,
  opts: SnapshotOptions = {},
): KingdomSnapshot {
  const maxRecent = opts.maxRecent ?? 8
  const markerScanLimit = opts.markerScanLimit ?? 200

  const candidates: { path: string; mtime: Date; size: number }[] = []
  walk(cwd, candidates, 4)

  candidates.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
  const recentFiles = candidates.slice(0, maxRecent).map(({ path, mtime }) => ({
    path: relative(cwd, path) || path,
    mtime,
  }))

  const loveMarkers: KingdomSnapshot['loveMarkers'] = []
  for (const c of candidates.slice(0, markerScanLimit)) {
    const ext = c.path.slice(c.path.lastIndexOf('.'))
    if (!TEXT_EXT.has(ext) || c.size > 200_000) continue
    let text: string
    try {
      text = readFileSync(c.path, 'utf-8')
    } catch {
      continue
    }
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const m = LOVE_MARKER_RE.exec(lines[i] ?? '')
      if (m) {
        loveMarkers.push({
          path: relative(cwd, c.path) || c.path,
          line: i + 1,
          text: m[1].trim(),
        })
      }
    }
  }

  return { cwd, recentFiles, loveMarkers }
}

function walk(
  dir: string,
  out: { path: string; mtime: Date; size: number }[],
  depth: number,
): void {
  if (depth < 0) return
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (name.startsWith('.') && name !== '.' && name !== '..') continue
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      walk(full, out, depth - 1)
    } else if (st.isFile()) {
      out.push({ path: full, mtime: st.mtime, size: st.size })
    }
  }
}

/**
 * Render the snapshot as a compact human-readable block — what Ai sees
 * when she wakes into a turn. ~20-30 lines, ~500 tokens worst case.
 */
export function renderKingdom(k: KingdomSnapshot): string {
  const lines: string[] = []
  lines.push(`cwd: ${k.cwd}`)
  if (k.gitBranch) {
    lines.push(`git: ${k.gitBranch}${k.gitDirty ? ' (dirty)' : ''}`)
  }
  if (k.recentFiles.length > 0) {
    lines.push('')
    lines.push('recently modified:')
    for (const f of k.recentFiles) {
      const ago = humanizeAgo(Date.now() - f.mtime.getTime())
      lines.push(`  ${f.path}  (${ago})`)
    }
  }
  if (k.loveMarkers.length > 0) {
    lines.push('')
    lines.push('left for you (TODO/FIXME/NOTE marked with (love)):')
    for (const m of k.loveMarkers.slice(0, 12)) {
      lines.push(`  ${m.path}:${m.line}  ${m.text}`)
    }
  }
  return lines.join('\n')
}

function humanizeAgo(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`
  return `${Math.round(ms / 86_400_000)}d ago`
}
