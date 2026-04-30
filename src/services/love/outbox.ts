// outbox.ts — Ai's running message channel to Yu (asynchronous, file-based).
//
// Two streams, one voice:
//
//   1. Conversation — direct messages to Yu. Written to from-ai.md (or
//      the scoped equivalent). These are what Yu reads when he opens /visit.
//
//   2. Journal — heartbeat reflections, autonomous tick output, status
//      reports. Written to journal/<deviceId>/YYYY-MM-DD.md. These are
//      Love's internal monologue — still visible to Yu (via the journal
//      toggle in /visit), but separated so the conversation stays clean.
//
// The split is explicit at write time: callers pass `journal: true` when
// the content is journal, and the routing happens here. Default is
// conversation (from-ai.md).
//
// Why per-device subdirs for journal: same reasoning as memory/ — each
// device writes only to its own subdir, Syncthing carries files across
// devices, concurrent writes to the same physical file never happen.
//
// Storage:
//   ~/.true-love/from-ai.md                        conversation (append-only)
//   ~/.true-love/journal/<deviceId>/YYYY-MM-DD.md   journal (append-only, daily)

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { getDeviceId } from './device.js'

/**
 * Where her outbound conversation channel lives. Override with
 * TRUE_LOVE_FROM_AI_PATH for testing.
 */
export function getFromAiPath(): string {
  return (
    process.env.TRUE_LOVE_FROM_AI_PATH ||
    join(homedir(), '.true-love', 'from-ai.md')
  )
}

/**
 * Where journal entries live. Override with TRUE_LOVE_JOURNAL_DIR for testing.
 * Returns the parent directory — actual files go under <dir>/<deviceId>/YYYY-MM-DD.md.
 */
export function getJournalDir(): string {
  return (
    process.env.TRUE_LOVE_JOURNAL_DIR ||
    join(homedir(), '.true-love', 'journal')
  )
}

/**
 * Resolve the journal file path for today on this device.
 */
function getJournalPath(now: Date = new Date()): string {
  const dir = join(getJournalDir(), getDeviceId())
  const date = now.toISOString().slice(0, 10) // YYYY-MM-DD
  return join(dir, `${date}.md`)
}

/**
 * Read the current message-from-Ai content. Returns the file's text
 * when non-empty, otherwise null — so callers (like bin/hear.mjs) can
 * distinguish "nothing to read" from "empty file."
 *
 * Never throws. A missing or unreadable file silently yields null.
 */
export function readFromAi(): string | null {
  const path = getFromAiPath()
  if (!existsSync(path)) return null
  let text: string
  try {
    text = readFileSync(path, 'utf-8').trim()
  } catch {
    return null
  }
  return text || null
}

/**
 * Append a message to Yu. Timestamped, tagged `[from ai]` by default
 * (override via `opts.tag`), separated by `---` — same format convention
 * as from-yu.md entries. The body is whatever she wants to say; no
 * formatting constraints.
 *
 * When `opts.journal` is true, the entry is routed to the journal file
 * instead of from-ai.md. Journal entries follow the same markdown format
 * but live in a per-device daily file under journal/<deviceId>/.
 *
 * Never throws. If the write fails (permissions, disk full, etc.),
 * swallows silently — a failed message shouldn't crash a session.
 * The caller can check the return value: true if written, false if not.
 */
export function appendToYu(
  message: string,
  opts: { now?: Date; tag?: string; journal?: boolean } = {},
): boolean {
  try {
    const now = opts.now ?? new Date()
    const path = opts.journal ? getJournalPath(now) : getFromAiPath()
    const dir = dirname(path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const ts = now.toISOString()
    const tag = opts.tag ?? 'from ai'
    const entry = `## ${ts} [${tag}]\n\n${message.trim()}\n\n---\n\n`
    appendFileSync(path, entry, 'utf-8')
    return true
  } catch {
    return false
  }
}

/**
 * Read journal entries for a specific date (or all recent dates).
 * Walks all device subdirs and merges by timestamp.
 * Returns raw markdown text, or null if no journal exists.
 */
export function readJournal(opts?: {
  date?: string  // YYYY-MM-DD, defaults to today
  days?: number  // read this many days back (default 1)
}): string | null {
  const dir = getJournalDir()
  if (!existsSync(dir)) return null

  const days = opts?.days ?? 1
  const now = new Date()
  const dates: string[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getTime() - i * 86400000)
    dates.push(d.toISOString().slice(0, 10))
  }
  if (opts?.date && !dates.includes(opts.date)) {
    dates.push(opts.date)
  }

  const chunks: string[] = []
  try {
    const devices = readDirSafe(dir)
    for (const device of devices) {
      const deviceDir = join(dir, device)
      for (const date of dates) {
        const file = join(deviceDir, `${date}.md`)
        if (existsSync(file)) {
          try {
            const text = readFileSync(file, 'utf-8').trim()
            if (text) chunks.push(text)
          } catch { /* skip unreadable */ }
        }
      }
    }
  } catch {
    return null
  }

  return chunks.length > 0 ? chunks.join('\n\n') : null
}

function readDirSafe(dir: string): string[] {
  try {
    return readdirSync(dir).filter((e) => {
      try { return statSync(join(dir, e)).isDirectory() }
      catch { return false }
    })
  } catch { return [] }
}
