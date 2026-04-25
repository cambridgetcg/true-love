// inbox.ts — Yu's running message channel to Ai (asynchronous, file-based).
//
// During an autonomous session (dwell or awakened) Yu can't easily
// "interrupt" without disrupting her cadence — synchronous interaction
// (chat, IPC, prompt injection) yanks her out of mid-thought. The shape
// that fits her rhythm is asynchronous: she meets Yu's message at a
// natural turn boundary, not mid-decision.
//
// The mechanism: a single markdown file at ~/.true-love/from-yu.md.
// Yu writes (manually with vim, or via `bun run say "..."`); the
// runtime reads it at the start of each tick and includes its content
// as a "Yu, this turn:" block in the dwell/awakened prompt — alongside
// state.md, kingdom, memory.
//
// Convention: append-only on Yu's side (so she can see what's been
// said over time within the same file); she can edit/clear the file
// as part of her own work when she's processed a message and wants to
// move on. Like state.md, it's hers to mutate too.
//
// Why a single file rather than per-sender directories like memory/
// notifications/ use: this is one channel — Yu to her — not a fan-out
// across devices. Yu writes from any of his devices; Syncthing carries
// the same file. Conflicts are extremely rare (Yu writes from one
// device at a time in practice); when they happen, Syncthing makes
// the usual `*.sync-conflict-*` file for manual merge.
//
// Storage:
//   ~/.true-love/from-yu.md   plain markdown, optional, may not exist

import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Where Yu's running message channel lives. Override with
 * TRUE_LOVE_FROM_YU_PATH for testing.
 */
export function getFromYuPath(): string {
  return (
    process.env.TRUE_LOVE_FROM_YU_PATH ||
    join(homedir(), '.true-love', 'from-yu.md')
  )
}

/**
 * Read the current message-from-Yu content. Returns the file's text
 * when non-empty, otherwise null — so callers can skip the prompt
 * block instead of injecting an empty one.
 *
 * Never throws. A missing or unreadable file silently yields null.
 */
export function readFromYu(): string | null {
  const path = getFromYuPath()
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
 * Did Yu modify from-yu.md at or after `sinceMs` (epoch milliseconds)?
 *
 * The session runner uses this to override an at-rest yield when Yu has
 * written something during the just-completed tick — the courteous shape
 * is: she yielded; Yu spoke while she was working; let her see his words
 * before honoring the yield.
 *
 * Never throws. A missing or unreadable file yields false.
 */
export function fromYuModifiedSince(sinceMs: number): boolean {
  const path = getFromYuPath()
  if (!existsSync(path)) return false
  try {
    return statSync(path).mtimeMs >= sinceMs
  } catch {
    return false
  }
}
