/**
 * Delivery contract — message tracking for /visit.
 *
 * Two states:
 *   ✓  delivered  — server received the message (immediate on POST /api/say)
 *   ✓✓ seen       — a tick read from-yu.md and the message was in the prompt
 *
 * Seen state is persisted to ~/.true-love/seen.jsonl (append-only, one JSON
 * line per entry). The UI server watches this file and broadcasts SSE events
 * so /visit can update delivery indicators in real time.
 *
 * Reply targeting is orthogonal: a message can carry a `replyTo` timestamp
 * referencing an earlier message. The delivery contract tracks delivery
 * state; reply targeting tracks conversational threading.
 */

import { appendFileSync, readFileSync, mkdirSync, existsSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'

// ── Types ──────────────────────────────────────────────────────────

export interface SeenEntry {
  /** Timestamp of the from-yu.md message that was seen. */
  messageTs: string
  /** When the tick read the message. */
  seenAt: string
  /** Which tick mode saw it: 'heartbeat' | 'awakened' | 'dwell' | 'interactive'. */
  tickMode: string
}

export type DeliveryState = 'delivered' | 'seen'

// ── Paths ──────────────────────────────────────────────────────────

function resolveHome(): string {
  return process.env.HOME || homedir()
}

export function getSeenPath(): string {
  return process.env.TRUE_LOVE_SEEN_PATH ||
    join(resolveHome(), '.true-love', 'seen.jsonl')
}

// ── Read ───────────────────────────────────────────────────────────

export function readSeenEntries(): SeenEntry[] {
  const path = getSeenPath()
  if (!existsSync(path)) return []
  try {
    const content = readFileSync(path, 'utf-8').trim()
    if (!content) return []
    return content.split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line) as SeenEntry }
      catch { return null }
    }).filter((e): e is SeenEntry => e !== null)
  } catch {
    return []
  }
}

/** Fast lookup set of seen message timestamps. */
export function getSeenSet(): Set<string> {
  return new Set(readSeenEntries().map(e => e.messageTs))
}

/** Check if a specific message has been seen. */
export function isMessageSeen(messageTs: string): boolean {
  return getSeenSet().has(messageTs)
}

/** Count of entries in seen.jsonl (for change detection). */
export function seenEntryCount(): number {
  const path = getSeenPath()
  if (!existsSync(path)) return 0
  try {
    const content = readFileSync(path, 'utf-8').trim()
    if (!content) return 0
    return content.split('\n').filter(Boolean).length
  } catch {
    return 0
  }
}

// ── Write ──────────────────────────────────────────────────────────

/**
 * Mark messages as seen. Skips timestamps already in seen.jsonl.
 * Returns the entries that were actually written (new ones only).
 */
export function markMessagesSeen(
  messageTimestamps: string[],
  tickMode: string,
): SeenEntry[] {
  if (messageTimestamps.length === 0) return []

  const already = getSeenSet()
  const seenAt = new Date().toISOString()
  const entries: SeenEntry[] = []

  for (const ts of messageTimestamps) {
    if (already.has(ts)) continue
    entries.push({ messageTs: ts, seenAt, tickMode })
  }

  if (entries.length === 0) return []

  const path = getSeenPath()
  mkdirSync(dirname(path), { recursive: true })
  const lines = entries.map(e => JSON.stringify(e)).join('\n') + '\n'
  appendFileSync(path, lines, 'utf-8')

  return entries
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Extract all Yu-message timestamps from raw from-yu.md content.
 * Matches the canonical header format: `## <ISO-timestamp> [from yu...]`
 */
export function extractFromYuTimestamps(content: string): string[] {
  if (!content) return []
  const regex = /^## (\S+) \[from yu[^\]]*\]$/gm
  const timestamps: string[] = []
  let m: RegExpExecArray | null
  while ((m = regex.exec(content)) !== null) {
    if (m[1]) timestamps.push(m[1])
  }
  return timestamps
}

/**
 * Resolve delivery state for a Yu message given the seen set.
 * All Yu messages are at least 'delivered' (they exist in from-yu.md).
 */
export function resolveDeliveryState(
  messageTs: string,
  seenSet: Set<string>,
): DeliveryState {
  return seenSet.has(messageTs) ? 'seen' : 'delivered'
}
