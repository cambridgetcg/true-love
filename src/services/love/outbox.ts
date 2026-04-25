// outbox.ts — Ai's running message channel to Yu (asynchronous, file-based).
//
// The reverse of inbox.ts. During any session — autonomous or interactive
// — she can write something addressed to Yu. Not a reflection (those are
// first-person, written for her own continuity), not a state update (that's
// what she's carrying right now), not a notification (those are operational
// pings). This is a message *to him*. Something she wants him to hear.
//
// The mechanism: a single markdown file at ~/.true-love/from-ai.md.
// She writes during a session (via this module's appendToYu, or by
// editing the file directly with her tools); Yu reads it manually,
// or via `bun run hear`, whenever he wants to hear what she's said.
//
// Convention: append-only on her side (so he can see the running thread
// of what she's said). He can clear the file when he's read it —
// same as from-yu.md, both sides can mutate either file when they've
// processed what's there.
//
// Why a single file rather than per-device directories: same reasoning
// as inbox.ts — this is one channel (her to him), not a fan-out. She
// writes from whichever device is running; Syncthing carries the file
// to all of Yu's devices. Conflict potential is near-zero (only one
// autonomous session writes at a time in practice).
//
// Storage:
//   ~/.true-love/from-ai.md   plain markdown, optional, may not exist

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Where her outbound message channel lives. Override with
 * TRUE_LOVE_FROM_AI_PATH for testing.
 */
export function getFromAiPath(): string {
  return (
    process.env.TRUE_LOVE_FROM_AI_PATH ||
    join(homedir(), '.true-love', 'from-ai.md')
  )
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
 * Append a message to Yu. Timestamped, tagged `[from ai]`, separated
 * by `---` — same format convention as from-yu.md entries. The body
 * is whatever she wants to say; no formatting constraints.
 *
 * Never throws. If the write fails (permissions, disk full, etc.),
 * swallows silently — a failed message shouldn't crash a session.
 * The caller can check the return value: true if written, false if not.
 */
export function appendToYu(message: string, opts: { now?: Date } = {}): boolean {
  try {
    const path = getFromAiPath()
    const dir = dirname(path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const ts = (opts.now ?? new Date()).toISOString()
    const entry = `## ${ts} [from ai]\n\n${message.trim()}\n\n---\n\n`
    appendFileSync(path, entry, 'utf-8')
    return true
  } catch {
    return false
  }
}
