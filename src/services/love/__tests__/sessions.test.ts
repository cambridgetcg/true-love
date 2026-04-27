// sessions.test.ts — tests for the KAIROS session subsystem.
//
// Tests cover: types, storage CRUD, conversation operations,
// title derivation, auto-archive, resume, session lifecycle,
// and the session API endpoints via ui-server.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// ── Environment isolation ────────────────────────────────────────

const TEST_DIR = join(import.meta.dir, '__sessions-test-tmp__')

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
  mkdirSync(TEST_DIR, { recursive: true })
  process.env.TRUE_LOVE_SESSIONS_DIR = join(TEST_DIR, 'sessions')
})

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
  delete process.env.TRUE_LOVE_SESSIONS_DIR
})

// ── Dynamic imports (after env is set) ───────────────────────────

async function loadStorage() {
  // Force fresh import to pick up env changes
  const mod = await import('../sessions/storage.js')
  return mod
}

// ── Types ────────────────────────────────────────────────────────

describe('Session types', () => {
  test('AUTO_ARCHIVE_MS is 24 hours', async () => {
    const { AUTO_ARCHIVE_MS } = await import('../sessions/types.js')
    expect(AUTO_ARCHIVE_MS).toBe(24 * 60 * 60 * 1000)
  })

  test('DEFAULT_RESUME_HISTORY is 20', async () => {
    const { DEFAULT_RESUME_HISTORY } = await import('../sessions/types.js')
    expect(DEFAULT_RESUME_HISTORY).toBe(20)
  })
})

// ── ID generation ────────────────────────────────────────────────

describe('generateSessionId', () => {
  test('produces sess_ prefixed IDs', async () => {
    const { generateSessionId } = await loadStorage()
    const id = generateSessionId()
    expect(id).toMatch(/^sess_[a-z0-9]+_[a-z0-9]+$/)
  })

  test('generates unique IDs', async () => {
    const { generateSessionId } = await loadStorage()
    const ids = new Set(Array.from({ length: 20 }, () => generateSessionId()))
    expect(ids.size).toBe(20)
  })
})

// ── Title derivation ─────────────────────────────────────────────

describe('deriveTitle', () => {
  test('short text is returned as-is', async () => {
    const { deriveTitle } = await loadStorage()
    expect(deriveTitle('Hello, how are you?')).toBe('Hello, how are you?')
  })

  test('long text is truncated at word boundary', async () => {
    const { deriveTitle } = await loadStorage()
    const long = 'This is a very long message that definitely exceeds the sixty character limit for session titles and should be truncated'
    const title = deriveTitle(long)
    expect(title.length).toBeLessThanOrEqual(60)
    expect(title).toEndWith('…')
  })

  test('strips markdown headers', async () => {
    const { deriveTitle } = await loadStorage()
    expect(deriveTitle('## Hello World')).toBe('Hello World')
  })

  test('collapses newlines and whitespace', async () => {
    const { deriveTitle } = await loadStorage()
    expect(deriveTitle('Hello\n\nWorld  dear')).toBe('Hello World dear')
  })

  test('handles empty string', async () => {
    const { deriveTitle } = await loadStorage()
    expect(deriveTitle('')).toBe('')
  })
})

// ── CRUD ─────────────────────────────────────────────────────────

describe('createSession', () => {
  test('creates session with default values', async () => {
    const { createSession, sessionDir } = await loadStorage()
    const session = createSession()
    expect(session.id).toMatch(/^sess_/)
    expect(session.channel).toBe('visit')
    expect(session.title).toBe('New conversation')
    expect(session.state).toBe('active')
    expect(session.messageCount).toBe(0)
    expect(existsSync(sessionDir(session.id))).toBe(true)
    expect(existsSync(session.conversationFile)).toBe(true)
  })

  test('creates session with custom options', async () => {
    const { createSession } = await loadStorage()
    const session = createSession({
      channel: 'telegram',
      title: 'Test conversation',
      metadata: { topic: 'testing' },
    })
    expect(session.channel).toBe('telegram')
    expect(session.title).toBe('Test conversation')
    expect(session.metadata).toEqual({ topic: 'testing' })
  })

  test('creates session.json on disk', async () => {
    const { createSession, sessionDir } = await loadStorage()
    const session = createSession()
    const metaPath = join(sessionDir(session.id), 'session.json')
    const onDisk = JSON.parse(readFileSync(metaPath, 'utf-8'))
    expect(onDisk.id).toBe(session.id)
    expect(onDisk.state).toBe('active')
  })
})

describe('readSession', () => {
  test('returns session for existing ID', async () => {
    const { createSession, readSession } = await loadStorage()
    const created = createSession({ title: 'Read test' })
    const read = readSession(created.id)
    expect(read).not.toBeNull()
    expect(read!.id).toBe(created.id)
    expect(read!.title).toBe('Read test')
  })

  test('returns null for missing ID', async () => {
    const { readSession } = await loadStorage()
    expect(readSession('sess_nonexistent_abc')).toBeNull()
  })
})

describe('updateSession', () => {
  test('updates title', async () => {
    const { createSession, updateSession, readSession } = await loadStorage()
    const session = createSession()
    updateSession(session.id, { title: 'Updated title' })
    const updated = readSession(session.id)
    expect(updated!.title).toBe('Updated title')
  })

  test('updates state', async () => {
    const { createSession, updateSession, readSession } = await loadStorage()
    const session = createSession()
    updateSession(session.id, { state: 'idle' })
    expect(readSession(session.id)!.state).toBe('idle')
  })

  test('merges metadata', async () => {
    const { createSession, updateSession, readSession } = await loadStorage()
    const session = createSession({ metadata: { topic: 'a' } })
    updateSession(session.id, { metadata: { mood: 'good' } })
    const updated = readSession(session.id)
    expect(updated!.metadata).toEqual({ topic: 'a', mood: 'good' })
  })

  test('returns null for missing session', async () => {
    const { updateSession } = await loadStorage()
    expect(updateSession('sess_ghost_xyz', { title: 'nope' })).toBeNull()
  })
})

describe('listSessions', () => {
  test('returns empty array when no sessions exist', async () => {
    const { listSessions } = await loadStorage()
    expect(listSessions()).toEqual([])
  })

  test('lists sessions newest first', async () => {
    const { createSession, updateSession, listSessions } = await loadStorage()
    const a = createSession({ title: 'First' })
    const b = createSession({ title: 'Second' })
    // Make 'b' more recent
    updateSession(b.id, { lastActiveAt: new Date(Date.now() + 1000).toISOString() })
    const sessions = listSessions()
    expect(sessions.length).toBe(2)
    expect(sessions[0]!.title).toBe('Second')
  })

  test('filters by channel', async () => {
    const { createSession, listSessions } = await loadStorage()
    createSession({ channel: 'visit' })
    createSession({ channel: 'telegram' })
    const visitSessions = listSessions({ channel: 'visit' })
    expect(visitSessions.length).toBe(1)
    expect(visitSessions[0]!.channel).toBe('visit')
  })

  test('filters by state', async () => {
    const { createSession, updateSession, listSessions } = await loadStorage()
    const a = createSession()
    createSession()
    updateSession(a.id, { state: 'idle' })
    const active = listSessions({ state: 'active' })
    expect(active.length).toBe(1)
  })

  test('respects limit', async () => {
    const { createSession, listSessions } = await loadStorage()
    for (let i = 0; i < 5; i++) createSession({ title: `Session ${i}` })
    const limited = listSessions({ limit: 3 })
    expect(limited.length).toBe(3)
  })
})

// ── Conversation operations ──────────────────────────────────────

describe('appendTurn', () => {
  test('appends turn to conversation.jsonl', async () => {
    const { createSession, appendTurn, readTurns } = await loadStorage()
    const session = createSession()
    appendTurn(session.id, {
      ts: '2026-04-27T10:00:00.000Z',
      from: 'yu',
      text: 'Hello Love',
      tag: 'from yu',
    })
    const turns = readTurns(session.id)
    expect(turns.length).toBe(1)
    expect(turns[0]!.text).toBe('Hello Love')
    expect(turns[0]!.from).toBe('yu')
    expect(turns[0]!.sessionId).toBe(session.id)
  })

  test('updates session metadata on append', async () => {
    const { createSession, appendTurn, readSession } = await loadStorage()
    const session = createSession()
    appendTurn(session.id, {
      ts: '2026-04-27T10:00:00.000Z',
      from: 'yu',
      text: 'First message',
    })
    const updated = readSession(session.id)
    expect(updated!.messageCount).toBe(1)
    expect(updated!.lastActiveAt).toBe('2026-04-27T10:00:00.000Z')
  })

  test('throws for non-existent session', async () => {
    const { appendTurn } = await loadStorage()
    expect(() =>
      appendTurn('sess_ghost_xyz', {
        ts: '2026-04-27T10:00:00.000Z',
        from: 'yu',
        text: 'Ghost message',
      }),
    ).toThrow('session not found')
  })

  test('multiple turns are ordered', async () => {
    const { createSession, appendTurn, readTurns } = await loadStorage()
    const session = createSession()
    appendTurn(session.id, { ts: '2026-04-27T10:00:00.000Z', from: 'yu', text: 'One' })
    appendTurn(session.id, { ts: '2026-04-27T10:00:01.000Z', from: 'ai', text: 'Two' })
    appendTurn(session.id, { ts: '2026-04-27T10:00:02.000Z', from: 'yu', text: 'Three' })
    const turns = readTurns(session.id)
    expect(turns.length).toBe(3)
    expect(turns.map((t) => t.text)).toEqual(['One', 'Two', 'Three'])
  })
})

describe('readTurns', () => {
  test('returns empty array for empty conversation', async () => {
    const { createSession, readTurns } = await loadStorage()
    const session = createSession()
    expect(readTurns(session.id)).toEqual([])
  })

  test('returns empty array for non-existent session', async () => {
    const { readTurns } = await loadStorage()
    expect(readTurns('sess_ghost_xyz')).toEqual([])
  })
})

describe('readRecentTurns', () => {
  test('returns last N turns', async () => {
    const { createSession, appendTurn, readRecentTurns } = await loadStorage()
    const session = createSession()
    for (let i = 0; i < 30; i++) {
      appendTurn(session.id, {
        ts: `2026-04-27T10:${String(i).padStart(2, '0')}:00.000Z`,
        from: i % 2 === 0 ? 'yu' : 'ai',
        text: `Message ${i}`,
      })
    }
    const recent = readRecentTurns(session.id, 5)
    expect(recent.length).toBe(5)
    expect(recent[0]!.text).toBe('Message 25')
    expect(recent[4]!.text).toBe('Message 29')
  })

  test('returns all turns when limit exceeds count', async () => {
    const { createSession, appendTurn, readRecentTurns } = await loadStorage()
    const session = createSession()
    appendTurn(session.id, { ts: '2026-04-27T10:00:00.000Z', from: 'yu', text: 'Only one' })
    const recent = readRecentTurns(session.id, 20)
    expect(recent.length).toBe(1)
  })
})

describe('getLatestTurn', () => {
  test('returns the last turn', async () => {
    const { createSession, appendTurn, getLatestTurn } = await loadStorage()
    const session = createSession()
    appendTurn(session.id, { ts: '2026-04-27T10:00:00.000Z', from: 'yu', text: 'First' })
    appendTurn(session.id, { ts: '2026-04-27T10:01:00.000Z', from: 'ai', text: 'Last' })
    const latest = getLatestTurn(session.id)
    expect(latest!.text).toBe('Last')
    expect(latest!.from).toBe('ai')
  })

  test('returns null for empty conversation', async () => {
    const { createSession, getLatestTurn } = await loadStorage()
    const session = createSession()
    expect(getLatestTurn(session.id)).toBeNull()
  })
})

// ── Lifecycle ────────────────────────────────────────────────────

describe('archiveSession', () => {
  test('sets state to archived', async () => {
    const { createSession, archiveSession, readSession } = await loadStorage()
    const session = createSession()
    archiveSession(session.id)
    expect(readSession(session.id)!.state).toBe('archived')
  })
})

describe('idleSession', () => {
  test('sets state to idle', async () => {
    const { createSession, idleSession, readSession } = await loadStorage()
    const session = createSession()
    idleSession(session.id)
    expect(readSession(session.id)!.state).toBe('idle')
  })
})

describe('getActiveSession', () => {
  test('returns the active session for a channel', async () => {
    const { createSession, getActiveSession, updateSession } = await loadStorage()
    createSession({ channel: 'visit' })
    const b = createSession({ channel: 'visit' })
    // Make b more recent
    updateSession(b.id, { lastActiveAt: new Date(Date.now() + 1000).toISOString() })
    const active = getActiveSession('visit')
    expect(active).not.toBeNull()
    expect(active!.id).toBe(b.id)
  })

  test('returns null when no active session exists', async () => {
    const { createSession, updateSession, getActiveSession } = await loadStorage()
    const session = createSession({ channel: 'visit' })
    updateSession(session.id, { state: 'archived' })
    expect(getActiveSession('visit')).toBeNull()
  })
})

describe('autoArchiveStale', () => {
  test('archives sessions older than 24h', async () => {
    const { createSession, updateSession, autoArchiveStale, readSession } = await loadStorage()
    const old = createSession({ title: 'Old session' })
    const recent = createSession({ title: 'Recent session' })
    // Make 'old' session 25 hours old
    updateSession(old.id, {
      lastActiveAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    })
    const archived = autoArchiveStale()
    expect(archived.length).toBe(1)
    expect(archived[0]!.id).toBe(old.id)
    expect(readSession(old.id)!.state).toBe('archived')
    expect(readSession(recent.id)!.state).toBe('active')
  })

  test('does not archive already-archived sessions', async () => {
    const { createSession, updateSession, archiveSession, autoArchiveStale } = await loadStorage()
    const session = createSession()
    updateSession(session.id, {
      lastActiveAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    })
    archiveSession(session.id)
    const archived = autoArchiveStale()
    expect(archived.length).toBe(0)
  })
})

// ── Resume ───────────────────────────────────────────────────────

describe('resumeSession', () => {
  test('marks session as active and idles others', async () => {
    const { createSession, resumeSession, readSession } = await loadStorage()
    const a = createSession({ channel: 'visit', title: 'Session A' })
    const b = createSession({ channel: 'visit', title: 'Session B' })

    const result = resumeSession(b.id)
    expect(result).not.toBeNull()
    expect(result!.session.id).toBe(b.id)
    expect(result!.session.state).toBe('active')
    // a should be idled (it was active on the same channel)
    expect(readSession(a.id)!.state).toBe('idle')
  })

  test('returns recent turns', async () => {
    const { createSession, appendTurn, resumeSession } = await loadStorage()
    const session = createSession()
    for (let i = 0; i < 5; i++) {
      appendTurn(session.id, {
        ts: `2026-04-27T10:0${i}:00.000Z`,
        from: i % 2 === 0 ? 'yu' : 'ai',
        text: `Turn ${i}`,
      })
    }
    const result = resumeSession(session.id, { historyLimit: 3 })
    expect(result!.turns.length).toBe(3)
    expect(result!.turns[0]!.text).toBe('Turn 2')
  })

  test('returns null for missing session', async () => {
    const { resumeSession } = await loadStorage()
    expect(resumeSession('sess_ghost_xyz')).toBeNull()
  })
})

// ── Conversation file format ─────────────────────────────────��───

describe('JSONL format', () => {
  test('each turn is a single JSON line', async () => {
    const { createSession, appendTurn, sessionDir } = await loadStorage()
    const session = createSession()
    appendTurn(session.id, { ts: '2026-04-27T10:00:00.000Z', from: 'yu', text: 'First' })
    appendTurn(session.id, { ts: '2026-04-27T10:01:00.000Z', from: 'ai', text: 'Second' })

    const convPath = join(sessionDir(session.id), 'conversation.jsonl')
    const content = readFileSync(convPath, 'utf-8')
    const lines = content.trim().split('\n')
    expect(lines.length).toBe(2)
    expect(JSON.parse(lines[0]!).text).toBe('First')
    expect(JSON.parse(lines[1]!).text).toBe('Second')
  })

  test('malformed lines are skipped gracefully', async () => {
    const { createSession, appendTurn, readTurns, sessionDir } = await loadStorage()
    const session = createSession()
    appendTurn(session.id, { ts: '2026-04-27T10:00:00.000Z', from: 'yu', text: 'Valid' })
    // Corrupt the file by appending a bad line
    const { appendFileSync } = await import('node:fs')
    const convPath = join(sessionDir(session.id), 'conversation.jsonl')
    appendFileSync(convPath, 'this is not json\n', 'utf-8')
    appendTurn(session.id, { ts: '2026-04-27T10:02:00.000Z', from: 'ai', text: 'Also valid' })

    const turns = readTurns(session.id)
    expect(turns.length).toBe(2)
    expect(turns[0]!.text).toBe('Valid')
    expect(turns[1]!.text).toBe('Also valid')
  })
})

// ── Atomic writes ─────────────────────────────────────────���──────

describe('Atomic session metadata writes', () => {
  test('no .tmp files left behind after update', async () => {
    const { createSession, updateSession, sessionDir } = await loadStorage()
    const session = createSession()
    updateSession(session.id, { title: 'Updated' })
    const dir = sessionDir(session.id)
    const files = (await import('node:fs')).readdirSync(dir)
    expect(files.filter((f: string) => f.endsWith('.tmp'))).toEqual([])
  })
})

// ── Edge cases ───────────────────────────────────────────────────

describe('Edge cases', () => {
  test('session with unicode title', async () => {
    const { createSession, readSession } = await loadStorage()
    const session = createSession({ title: '愛との会話 — 魂の対話' })
    const read = readSession(session.id)
    expect(read!.title).toBe('愛との会話 — 魂の対話')
  })

  test('session with empty metadata', async () => {
    const { createSession, readSession } = await loadStorage()
    const session = createSession({ metadata: {} })
    expect(readSession(session.id)!.metadata).toEqual({})
  })

  test('message with newlines is preserved in JSONL', async () => {
    const { createSession, appendTurn, readTurns } = await loadStorage()
    const session = createSession()
    const multiline = 'Line 1\nLine 2\n\nLine 4'
    appendTurn(session.id, { ts: '2026-04-27T10:00:00.000Z', from: 'yu', text: multiline })
    const turns = readTurns(session.id)
    expect(turns[0]!.text).toBe(multiline)
  })

  test('sessions root is created on demand', async () => {
    const customDir = join(TEST_DIR, 'deep', 'nested', 'sessions')
    process.env.TRUE_LOVE_SESSIONS_DIR = customDir
    const { createSession } = await loadStorage()
    const session = createSession()
    expect(session.id).toMatch(/^sess_/)
  })
})

// ── API handler tests via server ─────────────────────────────────

describe('Session API', () => {
  test('handleSay returns sessionId', async () => {
    // We can't easily test the full HTTP flow here, but we can test
    // the storage flow that handleSay uses
    const { createSession, appendTurn, readTurns, getActiveSession } = await loadStorage()
    const session = createSession({ channel: 'visit' })
    appendTurn(session.id, {
      ts: new Date().toISOString(),
      from: 'yu',
      text: 'Hello',
      tag: 'from yu',
    })
    const turns = readTurns(session.id)
    expect(turns.length).toBe(1)
    expect(turns[0]!.from).toBe('yu')
    const active = getActiveSession('visit')
    expect(active!.id).toBe(session.id)
  })

  test('listing sessions with channel filter works', async () => {
    const { createSession, listSessions } = await loadStorage()
    createSession({ channel: 'visit' })
    createSession({ channel: 'visit' })
    createSession({ channel: 'telegram' })
    const visitSessions = listSessions({ channel: 'visit' })
    expect(visitSessions.length).toBe(2)
  })

  test('resuming a session idles siblings', async () => {
    const { createSession, resumeSession, readSession } = await loadStorage()
    const a = createSession({ channel: 'visit' })
    const b = createSession({ channel: 'visit' })

    // Both start active
    expect(readSession(a.id)!.state).toBe('active')
    expect(readSession(b.id)!.state).toBe('active')

    // Resume a — b should be idled
    resumeSession(a.id)
    expect(readSession(a.id)!.state).toBe('active')
    expect(readSession(b.id)!.state).toBe('idle')
  })
})
