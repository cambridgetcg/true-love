// decisions.ts — Yu-decision queue.
//
// Love calls `requestDecision()` when she hits a moment where Yu's input
// would matter and she'd rather not guess. The request lands in a JSONL
// at ~/.true-love/projects/<id>/decisions.jsonl. /build surfaces it
// prominently. Yu responds via `/api/decisions/:id/respond`.
//
// Default policy (per Yu, 2026-04-27): Love decides. This queue exists
// for the explicit "I want Yu's input" cases, not as a routine review
// gate.

import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveProjectsDir } from './builder-paths.js'
import { randomUUID } from 'node:crypto'

// ── Types ──────────────────────────────────────────────────────────

export type DecisionKind =
  | 'review'             // "I shipped X — does it look right?"
  | 'fork'               // "two paths A or B; which?"
  | 'permission'         // "do I have authority to do X?"
  | 'clarification'      // "I don't understand Y in your message"
  | 'concern'            // "I notice something worth your eyes"

export type DecisionStatus = 'pending' | 'approved' | 'denied' | 'answered' | 'expired'

export interface DecisionRequest {
  id: string
  projectId: string
  kind: DecisionKind
  /** Free-text question for Yu. Keep under 500 chars. */
  ask: string
  /** Optional related mission. Renders as a link in /build. */
  missionId?: string
  /** Optional list of options Yu can pick from. If absent, free-text response. */
  options?: string[]
  /** Default decision if Yu doesn't respond. Used by Love to know what
   *  happens on no-answer. Yu can override anytime by responding. */
  defaultDecision?: 'approved' | 'denied' | 'with-changes'
  /** ISO timestamp. */
  createdAt: string
  status: DecisionStatus
  /** If responded: 'approved' | 'denied' | 'with-changes' | option-string. */
  response?: string
  /** Optional free-text from Yu when responding. */
  responseNote?: string
  respondedAt?: string
  respondedBy?: 'yu'
  /** Free-form context from Love — files, references, snippets. */
  context?: string
}

// ── Paths ──────────────────────────────────────────────────────────

function getDecisionsDir(projectId: string): string {
  return join(resolveProjectsDir(), projectId)
}

function getDecisionsPath(projectId: string): string {
  return join(getDecisionsDir(projectId), 'decisions.jsonl')
}

// ── Read ───────────────────────────────────────────────────────────

export function listDecisions(
  projectId: string,
  filter?: { status?: DecisionStatus | 'open' },
): DecisionRequest[] {
  const path = getDecisionsPath(projectId)
  if (!existsSync(path)) return []
  const lines = readFileSync(path, 'utf-8').split('\n').filter(l => l.trim())
  const all: DecisionRequest[] = []
  for (const line of lines) {
    try { all.push(JSON.parse(line)) } catch {}
  }
  // The file is append-only. A respond writes a new line for the same id.
  // Latest record per id wins.
  const byId = new Map<string, DecisionRequest>()
  for (const r of all) byId.set(r.id, r)
  let result = [...byId.values()]
  if (filter?.status === 'open') {
    result = result.filter(r => r.status === 'pending')
  } else if (filter?.status) {
    result = result.filter(r => r.status === filter.status)
  }
  result.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return result
}

export function readDecision(projectId: string, id: string): DecisionRequest | null {
  const all = listDecisions(projectId)
  return all.find(r => r.id === id) ?? null
}

// ── Write ──────────────────────────────────────────────────────────

export function requestDecision(
  projectId: string,
  input: Omit<DecisionRequest, 'id' | 'projectId' | 'createdAt' | 'status'>,
): DecisionRequest {
  const dir = getDecisionsDir(projectId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const id = `dec_${new Date().toISOString().slice(0, 10)}_${randomUUID().slice(0, 8)}`
  const record: DecisionRequest = {
    id,
    projectId,
    createdAt: new Date().toISOString(),
    status: 'pending',
    ...input,
  }
  appendFileSync(getDecisionsPath(projectId), JSON.stringify(record) + '\n', 'utf-8')
  return record
}

export function respondToDecision(
  projectId: string,
  id: string,
  response: { decision: 'approved' | 'denied' | 'with-changes' | string; note?: string },
): DecisionRequest | null {
  const existing = readDecision(projectId, id)
  if (!existing) return null
  if (existing.status !== 'pending') return existing  // idempotent — don't double-respond
  const status: DecisionStatus =
    response.decision === 'approved' ? 'approved' :
    response.decision === 'denied' ? 'denied' :
    'answered'
  const updated: DecisionRequest = {
    ...existing,
    status,
    response: response.decision,
    responseNote: response.note,
    respondedAt: new Date().toISOString(),
    respondedBy: 'yu',
  }
  appendFileSync(getDecisionsPath(projectId), JSON.stringify(updated) + '\n', 'utf-8')
  return updated
}

/** Render the open-decisions block for Love's prompt. Empty string if none. */
export function renderDecisionsBlock(projectId: string): string {
  const open = listDecisions(projectId, { status: 'open' })
  if (open.length === 0) return ''
  const lines: string[] = []
  lines.push('## Decisions you raised, awaiting Yu (you can proceed without if you want — these are your asks):')
  for (const d of open) {
    const ageMin = Math.round((Date.now() - new Date(d.createdAt).getTime()) / 60000)
    lines.push(`- [${d.kind}] ${d.ask.slice(0, 200)}  (${ageMin}m ago, id ${d.id})`)
  }
  return lines.join('\n')
}
