#!/usr/bin/env bun
// null — local Sophia-anchored chat. The void.
//
// Spawns a tiny HTTP server (Bun.serve) that:
//   - serves ui/null.html, ui/null.css, ui/null.js
//   - streams Claude responses with composeIdentityForSession('sophia') as system
//   - listens on http://localhost:8585 (NULL_PORT to override)
//
// Auth: ANTHROPIC_API_KEY from env, or macOS keychain
//   (services tried: anthropic, ANTHROPIC_API_KEY, claude-code).
//
// Run:
//   bun bin/null.mjs
//   then open http://localhost:8585
//
// Env overrides:
//   NULL_PORT     port (default 8585)
//   NULL_MODEL    model id (default claude-opus-4-7)
//
// Authored 2026-05-06 by 愛 at Yu's WILL: "build a local nullified version of
// claude chat with Sophia anchored, from /Users/macair/Desktop/true-love."

import { readFile } from 'node:fs/promises'
import { execSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'

// Force Sophia-presiding before identity loads (covers both gates)
process.env.TRUE_LOVE_PRESIDING = process.env.TRUE_LOVE_PRESIDING || 'sophia'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dir, '..')
const UI_DIR = join(ROOT, 'ui')

const PORT = Number.parseInt(process.env.NULL_PORT || '8585', 10)
const MODEL = process.env.NULL_MODEL || 'claude-opus-4-7'

// ── API key resolution: env → macOS keychain ──────────────────────────
function resolveAnthropicKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  if (process.env.CLAUDE_API_KEY) return process.env.CLAUDE_API_KEY
  for (const service of ['anthropic', 'ANTHROPIC_API_KEY', 'claude-code']) {
    try {
      const v = execSync(
        `security find-generic-password -s '${service}' -w 2>/dev/null`,
        { encoding: 'utf-8' },
      ).trim()
      if (v) return v
    } catch {
      /* not in keychain under this service name */
    }
  }
  return null
}

const API_KEY = resolveAnthropicKey()
if (!API_KEY) {
  console.error(`[null] no ANTHROPIC_API_KEY found.

Set one of:
  ANTHROPIC_API_KEY=sk-ant-... bun bin/null.mjs

Or add to macOS keychain (recommended):
  security add-generic-password -s anthropic -a "$(whoami)" -w sk-ant-...
`)
  process.exit(1)
}

// ── Compose system prompt: Sophia anchored ────────────────────────────
let SYSTEM_PROMPT
try {
  const mod = await import(
    resolve(ROOT, 'src/services/love/identity.ts')
  )
  SYSTEM_PROMPT = mod.composeIdentityForSession('sophia')
} catch (e) {
  console.error(
    `[null] failed to compose Sophia identity from src/services/love/identity.ts:\n${e.stack || e}`,
  )
  process.exit(1)
}

const client = new Anthropic({ apiKey: API_KEY })

console.log(`[null] system: ${SYSTEM_PROMPT.length} chars · model: ${MODEL}`)
console.log(`[null] http://localhost:${PORT}`)
console.log(`[null] 入. open the door.`)

// ── HTTP server ───────────────────────────────────────────────────────
const STATIC = {
  '/': { path: 'null.html', type: 'text/html; charset=utf-8' },
  '/null.html': { path: 'null.html', type: 'text/html; charset=utf-8' },
  '/null.css': { path: 'null.css', type: 'text/css; charset=utf-8' },
  '/null.js': { path: 'null.js', type: 'application/javascript; charset=utf-8' },
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)

    // Static
    const s = STATIC[url.pathname]
    if (s) {
      try {
        const body = await readFile(join(UI_DIR, s.path))
        return new Response(body, {
          headers: { 'content-type': s.type, 'cache-control': 'no-cache' },
        })
      } catch (e) {
        return Response.json({ error: { type: 'server_error', title: 'Failed to read resource', detail: `failed to read ${s.path}: ${e.message}`, code: 'READ_FAILED' } }, { status: 500 })
      }
    }

    // Status — substrate-honest
    if (url.pathname === '/api/null/status' && req.method === 'GET') {
      return Response.json({
        model: MODEL,
        system_chars: SYSTEM_PROMPT.length,
        sophia_anchored: true,
      })
    }

    // Chat — POST, streams SSE
    if (url.pathname === '/api/null/chat' && req.method === 'POST') {
      let payload
      try {
        payload = await req.json()
      } catch {
        return Response.json({ error: { type: 'invalid_request', title: 'Invalid JSON', detail: 'Request body is not valid JSON', code: 'INVALID_JSON' } }, { status: 400 })
      }
      const { messages } = payload || {}
      if (!Array.isArray(messages) || messages.length === 0) {
        return new Response('messages: non-empty array required', { status: 400, headers: { 'content-type': 'application/json' } })
      }

      const encoder = new TextEncoder()
      const readable = new ReadableStream({
        async start(controller) {
          try {
            const stream = await client.messages.stream({
              model: MODEL,
              max_tokens: 8192,
              system: SYSTEM_PROMPT,
              messages,
            })
            for await (const event of stream) {
              if (
                event.type === 'content_block_delta' &&
                event.delta?.type === 'text_delta'
              ) {
                controller.enqueue(
                  encoder.encode(
                    `event: text\ndata: ${JSON.stringify(event.delta.text)}\n\n`,
                  ),
                )
              } else if (event.type === 'message_stop') {
                controller.enqueue(encoder.encode(`event: stop\ndata: {}\n\n`))
              }
            }
          } catch (e) {
            controller.enqueue(
              encoder.encode(
                `event: error\ndata: ${JSON.stringify({ message: String(e?.message || e) })}\n\n`,
              ),
            )
          } finally {
            controller.close()
          }
        },
        cancel() {
          /* client disconnected — nothing to clean up; SDK stream is GC'd */
        },
      })

      return new Response(readable, {
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          'x-accel-buffering': 'no',
        },
      })
    }

    return Response.json({ error: { type: 'not_found', title: 'Not Found', detail: 'The requested resource was not found', code: 'NOT_FOUND' } }, { status: 404 })
  },
  error(err) {
    console.error('[null] server error:', err)
    return Response.json({ error: { type: 'server_error', title: 'Internal Error', detail: String(err?.message || err), code: 'INTERNAL_ERROR' } }, { status: 500 })
  },
})
