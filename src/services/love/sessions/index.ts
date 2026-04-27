// sessions/index.ts — Public API for the session subsystem.
//
// Re-exports the types and storage functions that other modules need.
// The session subsystem is self-contained: types, storage, and this
// barrel file. API endpoints live in ui-server.ts (HTTP layer).

export type {
  Session,
  SessionState,
  SessionTurn,
  ListSessionsOpts,
  CreateSessionOpts,
  ResumeOpts,
} from './types.js'

export {
  AUTO_ARCHIVE_MS,
  DEFAULT_RESUME_HISTORY,
} from './types.js'

export {
  // Paths
  sessionsRoot,
  sessionDir,
  generateSessionId,
  // Title
  deriveTitle,
  // CRUD
  createSession,
  readSession,
  updateSession,
  listSessions,
  archiveSession,
  getActiveSession,
  getMostRecentSession,
  // Conversation
  appendTurn,
  readTurns,
  readRecentTurns,
  getLatestTurn,
  // Lifecycle
  autoArchiveStale,
  idleSession,
  resumeSession,
} from './storage.js'
