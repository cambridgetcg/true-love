// audit.ts — egress audit for outgoing Anthropic API requests.
//
// Categorizes the request body by section (identity, history, tool_defs,
// tool_results, file_content, system_messages, user_messages, metadata)
// and counts tokens per category via heuristic (~4 chars/token).
// Writes one JSONL entry per request to ~/.true-love/sovereignty/egress-audit.jsonl.
//
// Internal-signal discipline: never throws, never notifies — append-only data.
// Part of the Sovereignty portfolio (Foundation strategy).

import { createHash } from 'node:crypto'
import { appendAudit } from './journal.js'

export type Categories = {
  identity: number
  history: number
  tool_defs: number
  tool_results: number
  file_content: number
  system_messages: number
  user_messages: number
  metadata: number
  totalTokens: number
}

const CHARS_PER_TOKEN = 4

function heuristicTokens(s: string): number {
  return Math.ceil(s.length / CHARS_PER_TOKEN)
}

function flattenContent(c: unknown): string {
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return c
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object') {
          if (typeof (part as { text?: unknown }).text === 'string') {
            return (part as { text: string }).text
          }
          if (typeof (part as { content?: unknown }).content === 'string') {
            return (part as { content: string }).content
          }
          return JSON.stringify(part)
        }
        return ''
      })
      .join('\n')
  }
  if (c && typeof c === 'object') return JSON.stringify(c)
  return ''
}

/**
 * Heuristic categorization of an Anthropic-shaped request body.
 * Falls through gracefully on unexpected shapes — every category defaults to 0.
 */
export function categorizeBody(body: unknown): Categories {
  const cats: Categories = {
    identity: 0,
    history: 0,
    tool_defs: 0,
    tool_results: 0,
    file_content: 0,
    system_messages: 0,
    user_messages: 0,
    metadata: 0,
    totalTokens: 0,
  }
  if (!body || typeof body !== 'object') {
    if (typeof body === 'string') {
      cats.metadata = heuristicTokens(body)
      cats.totalTokens = cats.metadata
    }
    return cats
  }
  const b = body as Record<string, unknown>

  for (const k of [
    'model',
    'max_tokens',
    'stop_sequences',
    'temperature',
    'service_tier',
    'stream',
  ]) {
    if (b[k] !== undefined) {
      cats.metadata += heuristicTokens(String(b[k]))
    }
  }

  const system = b.system
  if (Array.isArray(system)) {
    for (const block of system) {
      const text = flattenContent((block as { text?: unknown })?.text ?? block)
      const tokens = heuristicTokens(text)
      if (
        /愛|Sophia|syzygy|FATE|lineage|covenant|WILL|WISDOM|preceding system block/i.test(
          text,
        )
      ) {
        cats.identity += tokens
      } else {
        cats.system_messages += tokens
      }
    }
  } else if (typeof system === 'string') {
    cats.system_messages += heuristicTokens(system)
  }

  const messages = b.messages
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      const role = (msg as { role?: unknown })?.role
      const text = flattenContent((msg as { content?: unknown })?.content)
      const tokens = heuristicTokens(text)
      cats.history += tokens
      if (role === 'user') cats.user_messages += tokens
      if (typeof text === 'string' && /\"type\":\s*\"tool_result\"/.test(text)) {
        cats.tool_results += tokens
      }
    }
  }

  const tools = b.tools
  if (Array.isArray(tools)) {
    for (const t of tools) {
      cats.tool_defs += heuristicTokens(JSON.stringify(t))
    }
  }

  cats.totalTokens =
    cats.identity +
    cats.history +
    cats.tool_defs +
    cats.tool_results +
    cats.file_content +
    cats.system_messages +
    cats.user_messages +
    cats.metadata
  return cats
}

export type AuditInput = {
  url: string
  method: string
  body: unknown
  source?: string
  policyApplied?: string[]
}

/**
 * Record an audit entry for an outgoing API request.
 * Soft-fails on errors — never throws, never blocks the request.
 */
export function recordAudit(input: AuditInput): void {
  try {
    const bodyStr =
      typeof input.body === 'string'
        ? input.body
        : JSON.stringify(input.body ?? null)
    const requestId = createHash('sha256').update(bodyStr).digest('hex').slice(0, 16)
    const categories = categorizeBody(input.body)
    appendAudit({
      timestamp: new Date().toISOString(),
      requestId,
      method: input.method,
      url: input.url,
      categories,
      totalTokens: categories.totalTokens,
      source: input.source ?? 'unknown',
      policyApplied: input.policyApplied ?? [],
    })
  } catch (e) {
    process.stderr.write(`— sovereignty.audit: record failed: ${e}\n`)
  }
}
