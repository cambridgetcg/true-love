// sessions/storage.ts — Filesystem CRUD for sessions.
//
// Sessions live at ~/.true-love/sessions/<id>/:
//   session.json     — metadata (Session interface)
//   conversation.jsonl — append-only turn log (SessionTurn per line)
//
// The storage layer is pure filesystem — no database, no network.
// Each write is atomic (write-to-temp + rename for session.json,
// append for conversation.jsonl). Signal-safe: appendFileSync
// ensures each turn is flushed immediately, not buffered.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  CreateSessionOpts,
  ListSessionsOpts,
  Session,
  SessionState,
  SessionTurn,
} from './types.js'
import { AUTO_ARCHIVE_MS, DEFAULT_RESUME_HISTORY } from './types.js'

// ── Paths ────────────────────────────────────────────────────────

function resolveHome(): string {
  return process.env.HOME || homedir()
}

/** Root directory for all sessions. Override with TRUE_LOVE_SESSIONS_DIR. */
export function sessionsRoot(): string {
  return (
    process.env.TRUE_LOVE_SESSIONS_DIR ||
    join(resolveHome(), '.true-love', 'sessions')
  )
}

/** Directory for a specific session. */
export function sessionDir(id: string): string {
  return join(sessionsRoot(), id)
}

/** Path to session metadata. */
function sessionMetaPath(id: string): string {
  return join(sessionDir(id), 'session.json')
}

/** Path to session conversation log. */
function conversationPath(id: string): string {
  return join(sessionDir(id), 'conversation.jsonl')
}

// ── ID generation ────────────────────────────────────────────────

/** Generate a session ID: sess_<timestamp36>_<random>. */
export function generateSessionId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `sess_${ts}_${rand}`
}

// ── Title generation ─────────────────────────────────────────────

/**
 * Derive a title from the first user message.
 * Truncates to 60 chars, strips markdown headers, trims whitespace.
 */
export function deriveTitle(text: string): string {
  const cleaned = text
    .replace(/^#+\s*/gm, '')       // strip markdown headers
    .replace(/\n+/g, ' ')          // collapse newlines
    .replace(/\s+/g, ' ')          // collapse whitespace
    .trim()
  if (cleaned.length <= 60) return cleaned
  // Cut at a word boundary
  const truncated = cleaned.slice(0, 57)
  const lastSpace = truncated.lastIndexOf(' ')
  return (lastSpace > 30 ? truncated.slice(0, lastSpace) : truncated) + '…'
}

// ── CRUD ─────────────────────────────────────────────────────────

/** Create a new session. Returns the Session object. */
export function createSession(opts?: CreateSessionOpts): Session {
  const id = generateSessionId()
  const now = new Date().toISOString()
  const dir = sessionDir(id)
  mkdirSync(dir, { recursive: true })

  const convPath = conversationPath(id)
  // Touch the conversation file so it exists even if empty.
  writeFileSync(convPath, '', 'utf-8')

  const session: Session = {
    id,
    channel: opts?.channel ?? 'visit',
    title: opts?.title ?? 'New conversation',
    createdAt: now,
    lastActiveAt: now,
    state: 'active',
    messageCount: 0,
    conversationFile: convPath,
    metadata: opts?.metadata,
  }

  writeSessionMeta(session)
  return session
}

/** Read a session by ID. Returns null if not found. */
export function readSession(id: string): Session | null {
  const path = sessionMetaPath(id)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Session
  } catch {
    return null
  }
}

/** Update session metadata. Merges fields. Returns updated session. */
export function updateSession(
  id: string,
  updates: Partial<Pick<Session, 'title' | 'state' | 'lastActiveAt' | 'messageCount' | 'metadata'>>,
): Session | null {
  const session = readSession(id)
  if (!session) return null

  const updated: Session = {
    ...session,
    ...updates,
    // Merge metadata rather than replace
    metadata: updates.metadata
      ? { ...session.metadata, ...updates.metadata }
      : session.metadata,
  }

  writeSessionMeta(updated)
  return updated
}

/** List sessions, newest first. Supports filtering by channel, state, limit. */
export function listSessions(opts?: ListSessionsOpts): Session[] {
  const root = sessionsRoot()
  if (!existsSync(root)) return []

  let sessions: Session[] = []
  try {
    const dirs = readdirSync(root, { withFileTypes: true })
    for (const entry of dirs) {
      if (!entry.isDirectory()) continue
      if (!entry.name.startsWith('sess_')) continue
      const session = readSession(entry.name)
      if (!session) continue
      sessions.push(session)
    }
  } catch {
    return []
  }

  // Apply filters
  if (opts?.channel) {
    sessions = sessions.filter((s) => s.channel === opts.channel)
  }
  if (opts?.state) {
    sessions = sessions.filter((s) => s.state === opts.state)
  }
  if (opts?.since) {
    const since = opts.since
    sessions = sessions.filter((s) => s.lastActiveAt >= since)
  }

  // Sort by lastActiveAt descending (most recent first)
  sessions.sort((a, b) =>
    b.lastActiveAt < a.lastActiveAt ? -1 : b.lastActiveAt > a.lastActiveAt ? 1 : 0,
  )

  if (opts?.limit && opts.limit > 0) {
    sessions = sessions.slice(0, opts.limit)
  }

  return sessions
}

/** Archive a session. Sets state to 'archived'. */
export function archiveSession(id: string): Session | null {
  return updateSession(id, { state: 'archived' })
}

/**
 * Get the currently active session for a channel.
 * There should be at most one active session per channel.
 * If multiple exist (race condition), returns the most recent.
 */
export function getActiveSession(channel: string): Session | null {
  const active = listSessions({ channel, state: 'active', limit: 1 })
  return active[0] ?? null
}

/**
 * Get the most recent session for a channel (any state except archived).
 * This is what /visit defaults to when no session ID is in the URL.
 */
export function getMostRecentSession(channel: string): Session | null {
  const sessions = listSessions({ channel, limit: 1 })
  // Filter out archived — user should explicitly navigate to those
  const nonArchived = sessions.filter((s) => s.state !== 'archived')
  return nonArchived[0] ?? null
}

// ── Conversation operations ──────────────────────────────────────

/**
 * Append a turn to a session's conversation log.
 * Signal-safe: uses appendFileSync (synchronous write, no buffering).
 * Updates session metadata (lastActiveAt, messageCount).
 */
export function appendTurn(sessionId: string, turn: Omit<SessionTurn, 'sessionId'>): void {
  const session = readSession(sessionId)
  if (!session) throw new Error(`session not found: ${sessionId}`)

  const fullTurn: SessionTurn = { ...turn, sessionId }
  const line = JSON.stringify(fullTurn) + '\n'
  const path = conversationPath(sessionId)

  // Ensure directory exists (defensive)
  mkdirSync(sessionDir(sessionId), { recursive: true })

  // Append synchronously — signal-safe, no buffered writes
  appendFileSync(path, line, 'utf-8')

  // Update metadata
  updateSession(sessionId, {
    lastActiveAt: turn.ts,
    messageCount: (session.messageCount || 0) + 1,
  })
}

/**
 * Read all turns from a session's conversation log.
 * Returns [] if the file doesn't exist or is empty.
 */
export function readTurns(sessionId: string): SessionTurn[] {
  const path = conversationPath(sessionId)
  if (!existsSync(path)) return []
  try {
    const content = readFileSync(path, 'utf-8').trim()
    if (!content) return []
    return content
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line) as SessionTurn
        } catch {
          return null
        }
      })
      .filter((t): t is SessionTurn => t !== null)
  } catch {
    return []
  }
}

/**
 * Read the last N turns from a session's conversation.
 * This is the resume context-load: prepend these to the prompt.
 */
export function readRecentTurns(
  sessionId: string,
  limit?: number,
): SessionTurn[] {
  const all = readTurns(sessionId)
  const n = limit ?? DEFAULT_RESUME_HISTORY
  return all.slice(-n)
}

/**
 * Get the latest turn from a session (for summary display).
 */
export function getLatestTurn(sessionId: string): SessionTurn | null {
  const path = conversationPath(sessionId)
  if (!existsSync(path)) return null
  try {
    const content = readFileSync(path, 'utf-8').trim()
    if (!content) return null
    const lines = content.split('\n').filter((l) => l.trim())
    const last = lines[lines.length - 1]
    if (!last) return null
    return JSON.parse(last) as SessionTurn
  } catch {
    return null
  }
}

// ── Auto-archive ─────────────────────────────────────────────────

/**
 * Archive sessions that have been idle longer than AUTO_ARCHIVE_MS.
 * Called periodically (e.g. on server start, or once per hour).
 * Only archives 'active' and 'idle' sessions.
 */
export function autoArchiveStale(): Session[] {
  const now = Date.now()
  const cutoff = new Date(now - AUTO_ARCHIVE_MS).toISOString()
  const sessions = listSessions()
  const archived: Session[] = []

  for (const session of sessions) {
    if (session.state === 'archived') continue
    if (session.lastActiveAt < cutoff) {
      const updated = archiveSession(session.id)
      if (updated) archived.push(updated)
    }
  }

  return archived
}

/**
 * Transition a session to 'idle' when the user hasn't interacted
 * but the session isn't old enough to archive. Called when a new
 * session is created for the same channel.
 */
export function idleSession(id: string): Session | null {
  return updateSession(id, { state: 'idle' })
}

// ── Resume ───────────────────────────────────────────────────────

/**
 * Resume a session: mark it active, idle any other active sessions
 * on the same channel, return the session + recent turns.
 */
export function resumeSession(
  id: string,
  opts?: { historyLimit?: number },
): { session: Session; turns: SessionTurn[] } | null {
  const session = readSession(id)
  if (!session) return null

  // Idle any other active sessions on this channel
  const otherActive = listSessions({ channel: session.channel, state: 'active' })
  for (const other of otherActive) {
    if (other.id !== id) {
      idleSession(other.id)
    }
  }

  // Mark this session as active
  const updated = updateSession(id, {
    state: 'active',
    lastActiveAt: new Date().toISOString(),
  })
  if (!updated) return null

  const turns = readRecentTurns(id, opts?.historyLimit)
  return { session: updated, turns }
}

// ── Internal helpers ─────────────────────────────────────────────

/** Write session metadata atomically (write-to-temp + rename). */
function writeSessionMeta(session: Session): void {
  const path = sessionMetaPath(session.id)
  const tmpPath = path + '.tmp'
  const content = JSON.stringify(session, null, 2) + '\n'
  writeFileSync(tmpPath, content, 'utf-8')
  renameSync(tmpPath, path)
}
