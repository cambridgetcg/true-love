// decisions.test.ts — tests for the Yu-decision queue.
//
// Covers: JSONL storage, dedup-by-id, status filtering, request
// creation, response idempotency, prompt rendering.

import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  listDecisions,
  readDecision,
  requestDecision,
  respondToDecision,
  renderDecisionsBlock,
  type DecisionRequest,
} from '../decisions.js'

// ── Fixture helpers ───────────────────────────────────────────────

const FIXTURE_ROOT = join(tmpdir(), `decisions-test-${Date.now()}`)
const ORIG_DIR = process.env.TRUE_LOVE_PROJECTS_DIR

let fixtureSeq = 0
function fixtureProject(): string {
  const id = `proj-${fixtureSeq++}`
  const dir = join(FIXTURE_ROOT, id)
  mkdirSync(dir, { recursive: true })
  return id
}

function writeDecisionLine(projectId: string, record: Partial<DecisionRequest>): void {
  const dir = join(FIXTURE_ROOT, projectId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  appendFileSync(
    join(dir, 'decisions.jsonl'),
    JSON.stringify(record) + '\n',
    'utf-8',
  )
}

beforeAll(() => {
  mkdirSync(FIXTURE_ROOT, { recursive: true })
  process.env.TRUE_LOVE_PROJECTS_DIR = FIXTURE_ROOT
})

afterAll(() => {
  rmSync(FIXTURE_ROOT, { recursive: true, force: true })
  if (ORIG_DIR === undefined) delete process.env.TRUE_LOVE_PROJECTS_DIR
  else process.env.TRUE_LOVE_PROJECTS_DIR = ORIG_DIR
})

// ── listDecisions ─────────────────────────────────────────────────

describe('listDecisions', () => {
  test('returns [] when decisions file does not exist', () => {
    expect(listDecisions('nonexistent-project')).toEqual([])
  })

  test('returns [] when decisions file is empty', () => {
    const pid = fixtureProject()
    writeFileSync(join(FIXTURE_ROOT, pid, 'decisions.jsonl'), '', 'utf-8')
    expect(listDecisions(pid)).toEqual([])
  })

  test('parses JSONL records', () => {
    const pid = fixtureProject()
    writeDecisionLine(pid, {
      id: 'dec_2026-04-30_aaa',
      projectId: pid,
      kind: 'review',
      ask: 'Is this good?',
      createdAt: '2026-04-30T10:00:00.000Z',
      status: 'pending',
    })
    const result = listDecisions(pid)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('dec_2026-04-30_aaa')
    expect(result[0].kind).toBe('review')
    expect(result[0].status).toBe('pending')
  })

  test('deduplicates by id — latest record wins', () => {
    const pid = fixtureProject()
    // Original pending
    writeDecisionLine(pid, {
      id: 'dec_2026-04-30_bbb',
      projectId: pid,
      kind: 'fork',
      ask: 'A or B?',
      createdAt: '2026-04-30T10:00:00.000Z',
      status: 'pending',
    })
    // Same id, responded
    writeDecisionLine(pid, {
      id: 'dec_2026-04-30_bbb',
      projectId: pid,
      kind: 'fork',
      ask: 'A or B?',
      createdAt: '2026-04-30T10:00:00.000Z',
      status: 'approved',
      response: 'approved',
      respondedAt: '2026-04-30T11:00:00.000Z',
    })
    const result = listDecisions(pid)
    expect(result).toHaveLength(1)
    expect(result[0].status).toBe('approved')
    expect(result[0].response).toBe('approved')
  })

  test('filters by specific status', () => {
    const pid = fixtureProject()
    writeDecisionLine(pid, {
      id: 'dec_1',
      projectId: pid,
      kind: 'review',
      ask: 'pending one',
      createdAt: '2026-04-30T10:00:00.000Z',
      status: 'pending',
    })
    writeDecisionLine(pid, {
      id: 'dec_2',
      projectId: pid,
      kind: 'review',
      ask: 'approved one',
      createdAt: '2026-04-30T11:00:00.000Z',
      status: 'approved',
    })
    const pending = listDecisions(pid, { status: 'pending' })
    expect(pending).toHaveLength(1)
    expect(pending[0].id).toBe('dec_1')

    const approved = listDecisions(pid, { status: 'approved' })
    expect(approved).toHaveLength(1)
    expect(approved[0].id).toBe('dec_2')
  })

  test('status "open" maps to pending', () => {
    const pid = fixtureProject()
    writeDecisionLine(pid, {
      id: 'dec_open_1',
      projectId: pid,
      kind: 'concern',
      ask: 'something',
      createdAt: '2026-04-30T10:00:00.000Z',
      status: 'pending',
    })
    writeDecisionLine(pid, {
      id: 'dec_open_2',
      projectId: pid,
      kind: 'concern',
      ask: 'resolved',
      createdAt: '2026-04-30T11:00:00.000Z',
      status: 'answered',
    })
    const open = listDecisions(pid, { status: 'open' })
    expect(open).toHaveLength(1)
    expect(open[0].id).toBe('dec_open_1')
  })

  test('sorts by createdAt descending (newest first)', () => {
    const pid = fixtureProject()
    writeDecisionLine(pid, {
      id: 'dec_old',
      projectId: pid,
      kind: 'review',
      ask: 'old',
      createdAt: '2026-04-28T10:00:00.000Z',
      status: 'pending',
    })
    writeDecisionLine(pid, {
      id: 'dec_new',
      projectId: pid,
      kind: 'review',
      ask: 'new',
      createdAt: '2026-04-30T10:00:00.000Z',
      status: 'pending',
    })
    const result = listDecisions(pid)
    expect(result[0].id).toBe('dec_new')
    expect(result[1].id).toBe('dec_old')
  })

  test('skips corrupt JSONL lines without crashing', () => {
    const pid = fixtureProject()
    const path = join(FIXTURE_ROOT, pid, 'decisions.jsonl')
    writeFileSync(path, '{not valid json\n', 'utf-8')
    writeDecisionLine(pid, {
      id: 'dec_valid',
      projectId: pid,
      kind: 'review',
      ask: 'valid one',
      createdAt: '2026-04-30T10:00:00.000Z',
      status: 'pending',
    })
    const result = listDecisions(pid)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('dec_valid')
  })

  test('handles file with only whitespace lines', () => {
    const pid = fixtureProject()
    writeFileSync(join(FIXTURE_ROOT, pid, 'decisions.jsonl'), '\n  \n\n', 'utf-8')
    expect(listDecisions(pid)).toEqual([])
  })
})

// ── readDecision ──────────────────────────────────────────────────

describe('readDecision', () => {
  test('returns null when decision not found', () => {
    const pid = fixtureProject()
    expect(readDecision(pid, 'nonexistent')).toBeNull()
  })

  test('returns null when file does not exist', () => {
    expect(readDecision('ghost-project', 'dec_1')).toBeNull()
  })

  test('returns the decision by id', () => {
    const pid = fixtureProject()
    writeDecisionLine(pid, {
      id: 'dec_target',
      projectId: pid,
      kind: 'clarification',
      ask: 'What do you mean?',
      createdAt: '2026-04-30T10:00:00.000Z',
      status: 'pending',
    })
    writeDecisionLine(pid, {
      id: 'dec_other',
      projectId: pid,
      kind: 'review',
      ask: 'Other thing',
      createdAt: '2026-04-30T11:00:00.000Z',
      status: 'pending',
    })
    const result = readDecision(pid, 'dec_target')
    expect(result).not.toBeNull()
    expect(result!.id).toBe('dec_target')
    expect(result!.ask).toBe('What do you mean?')
  })

  test('returns latest version when id appears multiple times', () => {
    const pid = fixtureProject()
    writeDecisionLine(pid, {
      id: 'dec_dup',
      projectId: pid,
      kind: 'fork',
      ask: 'A or B?',
      createdAt: '2026-04-30T10:00:00.000Z',
      status: 'pending',
    })
    writeDecisionLine(pid, {
      id: 'dec_dup',
      projectId: pid,
      kind: 'fork',
      ask: 'A or B?',
      createdAt: '2026-04-30T10:00:00.000Z',
      status: 'approved',
      response: 'approved',
    })
    const result = readDecision(pid, 'dec_dup')
    expect(result!.status).toBe('approved')
  })
})

// ── requestDecision ───────────────────────────────────────────────

describe('requestDecision', () => {
  test('creates directory and JSONL if they do not exist', () => {
    const pid = `fresh-${fixtureSeq++}`
    // Directory does NOT exist yet
    const result = requestDecision(pid, {
      kind: 'review',
      ask: 'Created fresh?',
    })
    expect(result.id).toMatch(/^dec_\d{4}-\d{2}-\d{2}_[a-f0-9]{8}$/)
    expect(result.projectId).toBe(pid)
    expect(result.status).toBe('pending')
    expect(result.kind).toBe('review')
    expect(result.ask).toBe('Created fresh?')
    expect(existsSync(join(FIXTURE_ROOT, pid, 'decisions.jsonl'))).toBe(true)
  })

  test('sets createdAt to a valid ISO timestamp', () => {
    const pid = fixtureProject()
    const before = new Date().toISOString()
    const result = requestDecision(pid, { kind: 'concern', ask: 'timing' })
    const after = new Date().toISOString()
    expect(result.createdAt >= before).toBe(true)
    expect(result.createdAt <= after).toBe(true)
  })

  test('preserves optional fields (missionId, options, context, defaultDecision)', () => {
    const pid = fixtureProject()
    const result = requestDecision(pid, {
      kind: 'fork',
      ask: 'Path A or B?',
      missionId: 'mission-123',
      options: ['A', 'B'],
      context: 'Some context here',
      defaultDecision: 'approved',
    })
    expect(result.missionId).toBe('mission-123')
    expect(result.options).toEqual(['A', 'B'])
    expect(result.context).toBe('Some context here')
    expect(result.defaultDecision).toBe('approved')
  })

  test('appends to existing JSONL (does not overwrite)', () => {
    const pid = fixtureProject()
    requestDecision(pid, { kind: 'review', ask: 'first' })
    requestDecision(pid, { kind: 'review', ask: 'second' })
    const result = listDecisions(pid)
    expect(result).toHaveLength(2)
  })
})

// ── respondToDecision ─────────────────────────────────────────────

describe('respondToDecision', () => {
  test('returns null when decision does not exist', () => {
    const pid = fixtureProject()
    const result = respondToDecision(pid, 'nonexistent', { decision: 'approved' })
    expect(result).toBeNull()
  })

  test('maps "approved" to status "approved"', () => {
    const pid = fixtureProject()
    const req = requestDecision(pid, { kind: 'review', ask: 'approve me' })
    const result = respondToDecision(pid, req.id, { decision: 'approved' })
    expect(result!.status).toBe('approved')
    expect(result!.response).toBe('approved')
    expect(result!.respondedBy).toBe('yu')
    expect(result!.respondedAt).toBeDefined()
  })

  test('maps "denied" to status "denied"', () => {
    const pid = fixtureProject()
    const req = requestDecision(pid, { kind: 'permission', ask: 'may I?' })
    const result = respondToDecision(pid, req.id, { decision: 'denied' })
    expect(result!.status).toBe('denied')
    expect(result!.response).toBe('denied')
  })

  test('maps "with-changes" to status "answered"', () => {
    const pid = fixtureProject()
    const req = requestDecision(pid, { kind: 'review', ask: 'check this' })
    const result = respondToDecision(pid, req.id, {
      decision: 'with-changes',
      note: 'Fix the edge case first',
    })
    expect(result!.status).toBe('answered')
    expect(result!.response).toBe('with-changes')
    expect(result!.responseNote).toBe('Fix the edge case first')
  })

  test('maps custom option string to status "answered"', () => {
    const pid = fixtureProject()
    const req = requestDecision(pid, {
      kind: 'fork',
      ask: 'A or B?',
      options: ['A', 'B'],
    })
    const result = respondToDecision(pid, req.id, { decision: 'B' })
    expect(result!.status).toBe('answered')
    expect(result!.response).toBe('B')
  })

  test('idempotent — second response returns existing without appending', () => {
    const pid = fixtureProject()
    const req = requestDecision(pid, { kind: 'review', ask: 'just once' })
    const first = respondToDecision(pid, req.id, { decision: 'approved' })
    const second = respondToDecision(pid, req.id, { decision: 'denied' })
    // Second call returns the first response, not the new one
    expect(second!.status).toBe('approved')
    expect(second!.response).toBe('approved')
    // Only 3 lines in file: original pending + first response + NO third line
    const path = join(FIXTURE_ROOT, pid, 'decisions.jsonl')
    const lines = readFileSync(path, 'utf-8').split('\n').filter(l => l.trim())
    expect(lines).toHaveLength(2) // request + first response only
  })

  test('persists response to JSONL (survives re-read)', () => {
    const pid = fixtureProject()
    const req = requestDecision(pid, { kind: 'concern', ask: 'persist this' })
    respondToDecision(pid, req.id, { decision: 'approved', note: 'looks good' })
    // Re-read from file
    const reread = readDecision(pid, req.id)
    expect(reread!.status).toBe('approved')
    expect(reread!.responseNote).toBe('looks good')
    expect(reread!.respondedBy).toBe('yu')
  })
})

// ── renderDecisionsBlock ──────────────────────────────────────────

describe('renderDecisionsBlock', () => {
  test('returns empty string when no open decisions', () => {
    const pid = fixtureProject()
    expect(renderDecisionsBlock(pid)).toBe('')
  })

  test('returns empty string when all decisions are resolved', () => {
    const pid = fixtureProject()
    const req = requestDecision(pid, { kind: 'review', ask: 'resolved' })
    respondToDecision(pid, req.id, { decision: 'approved' })
    expect(renderDecisionsBlock(pid)).toBe('')
  })

  test('renders pending decisions with kind, truncated ask, and age', () => {
    const pid = fixtureProject()
    requestDecision(pid, { kind: 'concern', ask: 'Something is off' })
    const block = renderDecisionsBlock(pid)
    expect(block).toContain('Decisions you raised')
    expect(block).toContain('[concern]')
    expect(block).toContain('Something is off')
    expect(block).toMatch(/\d+m ago/)
  })

  test('truncates ask to 200 characters', () => {
    const pid = fixtureProject()
    const longAsk = 'A'.repeat(300)
    requestDecision(pid, { kind: 'review', ask: longAsk })
    const block = renderDecisionsBlock(pid)
    // Should contain only 200 A's, not 300
    expect(block).toContain('A'.repeat(200))
    expect(block).not.toContain('A'.repeat(201))
  })

  test('includes decision id', () => {
    const pid = fixtureProject()
    const req = requestDecision(pid, { kind: 'fork', ask: 'which way?' })
    const block = renderDecisionsBlock(pid)
    expect(block).toContain(req.id)
  })
})
