// sessions/types.ts — Session types for the KAIROS pattern.
//
// A session is a named, bounded conversation. Today's /visit is one
// endless thread; sessions give it structure. Each session has an ID,
// a conversation log (JSONL), and metadata (title, timestamps, state).
//
// Sessions are channel-scoped: the visit channel has its own session
// list, and future channels (telegram, voice) will have theirs.
//
// The KAIROS name comes from the Claude Code leaked source, where
// session-continuation is gated behind the KAIROS feature flag.

// ── Session metadata ────────────���────────────────────────────────

/** A conversation session — the unit of continuity. */
export interface Session {
  /** Unique session identifier: 'sess_<random>' format. */
  id: string
  /** Which channel owns this session: 'visit' | 'telegram' | ... */
  channel: string
  /** Human-readable title, auto-generated from first user message. */
  title: string
  /** ISO timestamp of session creation. */
  createdAt: string
  /** ISO timestamp of last activity (message sent or received). */
  lastActiveAt: string
  /** Session lifecycle state. */
  state: SessionState
  /** Number of turns in the conversation. */
  messageCount: number
  /** Absolute path to the conversation JSONL file. */
  conversationFile: string
  /** Freeform metadata: topic tags, longing-thread references, etc. */
  metadata?: Record<string, unknown>
}

/** Session lifecycle states. */
export type SessionState = 'active' | 'idle' | 'archived'

// ── Conversation turns ──────────���────────────────────────────────

/** A single turn in a session conversation. Stored as JSONL lines. */
export interface SessionTurn {
  /** ISO timestamp of the turn. */
  ts: string
  /** Who spoke: 'yu' for the human, 'ai' for Love. */
  from: 'yu' | 'ai'
  /** The message text (plaintext or markdown). */
  text: string
  /** Message tag (e.g. 'from yu', 'from 愛 — heartbeat'). */
  tag?: string
  /** Session this turn belongs to. */
  sessionId: string
  /** If this turn is a reply, the timestamp of the referenced message. */
  replyTo?: string
}

// ── Configuration ────────────────────────────────────────────────

/** Options for listing sessions. */
export interface ListSessionsOpts {
  /** Filter by channel. */
  channel?: string
  /** Filter by state. */
  state?: SessionState
  /** Maximum number of sessions to return (most recent first). */
  limit?: number
  /** Only sessions active after this ISO timestamp. */
  since?: string
}

/** Options for creating a session. */
export interface CreateSessionOpts {
  /** Which channel. Default: 'visit'. */
  channel?: string
  /** Initial title. Auto-generated if omitted. */
  title?: string
  /** Freeform metadata. */
  metadata?: Record<string, unknown>
}

/** Options for resuming a session. */
export interface ResumeOpts {
  /** Maximum turns to load from conversation history. Default: 20. */
  historyLimit?: number
}

/** Auto-archive threshold in milliseconds (24 hours). */
export const AUTO_ARCHIVE_MS = 24 * 60 * 60 * 1000

/** Default number of turns to load on resume. */
export const DEFAULT_RESUME_HISTORY = 20
