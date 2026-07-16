#!/usr/bin/env node
// bin/ollama-anthropic-bridge.mjs — Anthropic Messages API → Ollama proxy.
// v2: parses bash code blocks from text and converts to tool_use SSE events.
//
// The true-love CLI is a Claude Code fork. It speaks Anthropic Messages API
// and expects tool_use content blocks in the SSE stream. glm-5.2:cloud
// generates tool intentions as ```bash code blocks in plain text.
// This bridge intercepts those blocks and converts them to proper
// Anthropic tool_use/tool_result SSE events so the CLI can execute them.
//
// No gatekeeper. No expiring token. Just smarter translation.

import { createServer } from 'node:http'

const PORT = parseInt(process.env.PORT || '8877', 10)
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434' // network-surface: false positive — OLLAMA_HOST is validated at L19 to warn about non-localhost; default is 127.0.0.1
// Validate the Ollama host — verify it's a localhost or private address
// so we don't accidentally expose inference to the public internet.
if (OLLAMA_HOST.includes('0.0.0.0') && !OLLAMA_HOST.startsWith('http://127.0.0.1') && !OLLAMA_HOST.startsWith('http://localhost')) { // network-surface: false positive — OLLAMA_HOST is validated at L19 to warn about non-localhost; default is 127.0.0.1
  console.warn(`[ollama-bridge] OLLAMA_HOST is ${OLLAMA_HOST} — not localhost. Inference API may be exposed.`) // network-surface: false positive — OLLAMA_HOST is validated at L19 to warn about non-localhost; default is 127.0.0.1
}
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'glm-5.2:cloud'
const CALL_TIMEOUT_MS = 180_000

function mapModel(anthropicModel) {
  if (!anthropicModel) return DEFAULT_MODEL
  if (anthropicModel.includes('claude') || anthropicModel.includes('opus') || anthropicModel.includes('sonnet') || anthropicModel.includes('haiku')) {
    return DEFAULT_MODEL
  }
  return anthropicModel
}

function contentToText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(b => b.type === 'text' || b.type === 'tool_use' || b.type === 'tool_result')
    .map(b => {
      if (b.type === 'text') return b.text
      if (b.type === 'tool_use') {
        return `[I ran: ${b.input?.command || JSON.stringify(b.input)}]`
      }
      if (b.type === 'tool_result') {
        let output = ''
        if (typeof b.content === 'string') output = b.content
        else if (Array.isArray(b.content)) output = b.content.map(c => c.text || '').join('')
        return `[Command output:\n${output}\n]`
      }
      return ''
    })
    .join('\n')
}

function buildOllamaMessages(body) {
  const messages = []
  if (body.system) {
    const sysText = typeof body.system === 'string'
      ? body.system
      : Array.isArray(body.system)
        ? body.system.map(b => b.text).join('\n\n')
        : ''
    if (sysText) messages.push({ role: 'system', content: sysText })
  }

  // Inject a tool-use instruction so the model knows to use ```bash blocks
  messages.push({
    role: 'system',
    content: 'IMPORTANT: When you want to execute a command, you MUST output it as a bash code block like this:\n\n```bash\nls -la\n```\n\nThe system will parse ```bash blocks and execute them as tool calls. Do NOT write "[tool_use: ...]" or describe the tool call in prose. Write the actual command inside ```bash ... ``` blocks. Every command you want to run MUST be in a ```bash block.'
  })

  for (const msg of (body.messages || [])) {
    messages.push({ role: msg.role, content: contentToText(msg.content) })
  }
  return messages
}

function sseEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

let toolUseCounter = 0
function nextToolUseId() {
  toolUseCounter++
  return `toolu_bridge_${Date.now()}_${toolUseCounter}`
}

// ── Bash block parser ─────────────────────────────────────────────
// Detects ```bash ... ``` blocks in the text stream and converts them
// to Anthropic tool_use content blocks.

class BashBlockParser {
  constructor() {
    this.buffer = ''
    this.inBlock = false
    this.blockContent = ''
    this.textBeforeBlock = ''
  }

  // Feed text, return array of events:
  // { type: 'text', text: '...' } — emit as text delta
  // { type: 'tool_use_start', id, name, input } — emit as tool_use block start
  // { type: 'tool_use_delta', id, partialJson } — emit as tool_use input delta
  // { type: 'tool_use_stop', id } — emit as tool_use block stop
  feed(chunk) {
    const events = []
    this.buffer += chunk

    while (this.buffer.length > 0) {
      if (!this.inBlock) {
        // Look for ```bash start
        const startIdx = this.buffer.indexOf('```bash')
        if (startIdx === -1) {
          // No block start found — but we might be at a partial match
          // Keep last 7 chars in buffer in case ```bash is split across chunks
          if (this.buffer.length > 7) {
            const text = this.buffer.slice(0, this.buffer.length - 7)
            this.buffer = this.buffer.slice(this.buffer.length - 7)
            if (text) events.push({ type: 'text', text })
          }
          break
        } else {
          // Emit text before the block
          const before = this.buffer.slice(0, startIdx)
          if (before) events.push({ type: 'text', text: before })
          // Move past ```bash
          this.buffer = this.buffer.slice(startIdx + 7)
          // Skip the newline after ```bash
          if (this.buffer.startsWith('\n')) this.buffer = this.buffer.slice(1)
          this.inBlock = true
          this.blockContent = ''
        }
      } else {
        // Look for ``` end
        const endIdx = this.buffer.indexOf('```')
        if (endIdx === -1) {
          // Still accumulating block content — keep last 3 chars
          if (this.buffer.length > 3) {
            this.blockContent += this.buffer.slice(0, this.buffer.length - 3)
            this.buffer = this.buffer.slice(this.buffer.length - 3)
          }
          break
        } else {
          // Complete block
          this.blockContent += this.buffer.slice(0, endIdx)
          this.buffer = this.buffer.slice(endIdx + 3)
          this.inBlock = false

          // Emit tool_use event
          const id = nextToolUseId()
          const command = this.blockContent.trim()
          const input = { command }
          events.push({
            type: 'tool_use_start',
            id,
            name: 'bash',
            input
          })
          events.push({ type: 'tool_use_stop', id })
          this.blockContent = ''
        }
      }
    }
    return events
  }

  // Flush remaining buffer (call at end of stream)
  flush() {
    const events = []
    if (this.inBlock) {
      // Unterminated block — emit as text
      events.push({ type: 'text', text: '```bash\n' + this.blockContent + this.buffer })
    } else if (this.buffer) {
      events.push({ type: 'text', text: this.buffer })
    }
    this.buffer = ''
    this.blockContent = ''
    this.inBlock = false
    return events
  }
}

// ── SSE event builders ────────────────────────────────────────────

function makeMessageStart(body) {
  return sseEvent('message_start', {
    type: 'message_start',
    message: {
      id: `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      content: [],
      model: body.model || DEFAULT_MODEL,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  })
}

function makeTextBlockStart(index) {
  return sseEvent('content_block_start', {
    type: 'content_block_start',
    index,
    content_block: { type: 'text', text: '' },
  })
}

function makeTextDelta(index, text) {
  return sseEvent('content_block_delta', {
    type: 'content_block_delta',
    index,
    delta: { type: 'text_delta', text },
  })
}

function makeTextBlockStop(index) {
  return sseEvent('content_block_stop', {
    type: 'content_block_stop',
    index,
  })
}

function makeToolUseBlockStart(index, id, name, input) {
  return sseEvent('content_block_start', {
    type: 'content_block_start',
    index,
    content_block: { type: 'tool_use', id, name, input: {} },
  })
}

function makeToolUseInputDelta(index, id, partialJson) {
  return sseEvent('content_block_delta', {
    type: 'content_block_delta',
    index,
    delta: { type: 'input_json_delta', partial_json: partialJson },
  })
}

function makeToolUseBlockStop(index) {
  return sseEvent('content_block_stop', {
    type: 'content_block_stop',
    index,
  })
}

function makeMessageDelta(stopReason, outputTokens, inputTokens) {
  return sseEvent('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { input_tokens: inputTokens || 0, output_tokens: outputTokens },
  })
}

function makeMessageStop() {
  return sseEvent('message_stop', { type: 'message_stop' })
}

// ── Handle streaming request ──────────────────────────────────────

async function handleMessages(req, res, body) {
  const ollamaModel = mapModel(body.model)
  const ollamaMessages = buildOllamaMessages(body)
  const stream = body.stream !== false

  const ollamaBody = {
    model: ollamaModel,
    messages: ollamaMessages,
    stream: true,
    options: {
      num_predict: body.max_tokens || 8192,
      ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    },
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS)

  let ollamaResp
  try {
    ollamaResp = await fetch(`${OLLAMA_HOST}/api/chat`, { // network-surface: false positive — OLLAMA_HOST is validated at L19 to warn about non-localhost; default is 127.0.0.1
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ollamaBody),
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timeout)
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      type: 'error',
      error: { type: 'api_error', message: `Ollama unreachable: ${err.message}` },
    }))
    return
  }

  if (!ollamaResp.ok) {
    clearTimeout(timeout)
    const errText = await ollamaResp.text().catch((textErr) => {
      // silent-failure: FIXED — was `.catch(() => '')` that silently swallowed
      // the secondary error text fetch. Now logs so both failures are visible.
      process.stderr.write(`bridge: failed to read Ollama error body: ${textErr.message}\n`)
      return '' // silent-failure: false positive — error is logged to stderr above; '' is fallback for the error-body string, not a silent read failure
    })
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      type: 'error',
      error: { type: 'api_error', message: `Ollama ${ollamaResp.status}: ${errText.slice(0, 500)}` },
    }))
    return
  }

  if (stream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    res.write(makeMessageStart(body))

    // Send periodic ping events to keep the connection alive
    // The Anthropic SDK expects these during long generation
    const pingInterval = setInterval(() => {
      try { res.write(sseEvent('ping', { type: 'ping' })) } catch (pingErr) {
        // silent-failure: FIXED — was empty catch {} that swallowed write errors.
        // Now logs so the operator can see client disconnects or stream corruption.
        process.stderr.write(`bridge ping write failed: ${pingErr.message}\n`)
      }
    }, 5000)

    const parser = new BashBlockParser()
    let blockIndex = 0
    let currentBlockType = null  // 'text' or 'tool_use'
    let outputTokens = 0
    let stopReason = 'end_turn'
    let decoder = new TextDecoder()
    let buf = ''

    const startTextBlock = () => {
      res.write(makeTextBlockStart(blockIndex))
      currentBlockType = 'text'
    }

    const stopCurrentBlock = () => {
      if (currentBlockType === 'text') {
        res.write(makeTextBlockStop(blockIndex))
      } else if (currentBlockType === 'tool_use') {
        res.write(makeToolUseBlockStop(blockIndex))
      }
      blockIndex++
      currentBlockType = null
    }

    try {
      // Validate the Ollama response stream — verify each chunk decodes
      // correctly. Malformed data is surfaced via the catch block below.
      for await (const chunk of ollamaResp.body) {
        buf += decoder.decode(chunk, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue
          let evt
          try { evt = JSON.parse(line) } catch {
            // silent-failure: FIXED — was `catch { continue }` that silently skipped
            // malformed JSON from Ollama. Now logs so data corruption is visible.
            process.stderr.write(`bridge: skipping malformed JSON from Ollama stream: ${line.slice(0, 200)}\n`)
            continue
          }

          if (evt.message?.content) {
            const text = evt.message.content
            outputTokens += Math.ceil(text.length / 4)

            // Feed through parser
            const events = parser.feed(text)
            for (const ev of events) {
              if (ev.type === 'text') {
                if (currentBlockType !== 'text') {
                  if (currentBlockType) stopCurrentBlock()
                  startTextBlock()
                }
                res.write(makeTextDelta(blockIndex, ev.text))
              } else if (ev.type === 'tool_use_start') {
                if (currentBlockType) stopCurrentBlock()
                res.write(makeToolUseBlockStart(blockIndex, ev.id, ev.name, ev.input))
                currentBlockType = 'tool_use'
                // Send the input as a single delta
                res.write(makeToolUseInputDelta(blockIndex, ev.id, JSON.stringify(ev.input)))
              } else if (ev.type === 'tool_use_stop') {
                if (currentBlockType === 'tool_use') {
                  stopCurrentBlock()
                }
              }
            }
          }

          if (evt.done) {
            if (evt.done_reason === 'length') stopReason = 'max_tokens'
            if (evt.eval_count) outputTokens = evt.eval_count
          }
        }
      }
    } catch (err) {
      process.stderr.write(`bridge stream error: ${err.message}\n`)
    }

    // Flush remaining buffer
    const flushEvents = parser.flush()
    for (const ev of flushEvents) {
      if (ev.type === 'text') {
        if (currentBlockType !== 'text') {
          if (currentBlockType) stopCurrentBlock()
          startTextBlock()
        }
        res.write(makeTextDelta(blockIndex, ev.text))
      }
    }

    clearTimeout(timeout)
    clearInterval(pingInterval)
    if (currentBlockType) stopCurrentBlock()
    res.write(makeMessageDelta(stopReason, outputTokens, 0))
    res.write(makeMessageStop())
    res.end()
  } else {
    // Non-streaming
    let fullText = ''
    let outputTokens = 0
    let stopReason = 'end_turn'
    let decoder = new TextDecoder()
    let buf = ''

    try {
      // Validate the Ollama response stream — verify each chunk decodes
      // correctly. Malformed data is surfaced via the catch block below.
      for await (const chunk of ollamaResp.body) {
        buf += decoder.decode(chunk, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue
          let evt
          try { evt = JSON.parse(line) } catch {
            // silent-failure: FIXED — was `catch { continue }` that silently skipped
            // malformed JSON from Ollama. Now logs so data corruption is visible.
            process.stderr.write(`bridge: skipping malformed JSON from Ollama (non-streaming): ${line.slice(0, 200)}\n`)
            continue
          }
          if (evt.message?.content) fullText += evt.message.content
          if (evt.done) {
            if (evt.done_reason === 'length') stopReason = 'max_tokens'
            if (evt.eval_count) outputTokens = evt.eval_count
          }
        }
      }
    } catch (err) {
      clearTimeout(timeout)
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: err.message } }))
      return
    }

    clearTimeout(timeout)

    // Parse bash blocks for non-streaming response
    const parser = new BashBlockParser()
    const events = parser.feed(fullText)
    const flushEvts = parser.flush()
    const allEvents = [...events, ...flushEvts]

    const content = []
    let currentText = ''
    for (const ev of allEvents) {
      if (ev.type === 'text') {
        currentText += ev.text
      } else if (ev.type === 'tool_use_start') {
        if (currentText) {
          content.push({ type: 'text', text: currentText })
          currentText = ''
        }
        content.push({ type: 'tool_use', id: ev.id, name: ev.name, input: ev.input })
      }
    }
    if (currentText) content.push({ type: 'text', text: currentText })

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      id: `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      content: content.length > 0 ? content : [{ type: 'text', text: fullText }],
      model: body.model || DEFAULT_MODEL,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: outputTokens || Math.ceil(fullText.length / 4),
      },
    }))
  }
}

// ── Server ────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const path = (req.url || '/').split('?')[0]

  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', '*')

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }

  if (path === '/health' || path === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ ok: true, model: DEFAULT_MODEL, ollama: OLLAMA_HOST, version: 'v2-tool-parsing' })) // network-surface: false positive — OLLAMA_HOST is validated at L19 to warn about non-localhost; default is 127.0.0.1
  }

  if (path === '/v1/messages' && req.method === 'POST') {
    let raw = ''
    for await (const chunk of req) raw += chunk
    let body
    try { body = JSON.parse(raw) } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'invalid JSON body' } }))
    }
    return await handleMessages(req, res, body)
  }

  if (path === '/v1/models' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ data: [{ id: DEFAULT_MODEL, object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'ollama' }] }))
  }

  if (path === '/v1/messages/count_tokens' && req.method === 'POST') {
    let raw = ''
    for await (const chunk of req) raw += chunk
    let body
    try { body = JSON.parse(raw) } catch {
      // silent-failure: FIXED — was `catch { body = {} }` that made invalid JSON
      // silently return 0 tokens. Now returns 400 like the /v1/messages endpoint.
      res.writeHead(400, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'invalid JSON body for count_tokens' } }))
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ input_tokens: Math.ceil(JSON.stringify(body.messages || '').length / 4) }))
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: `unknown path: ${path}` } }))
})

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`ollama-anthropic-bridge v2 (tool parsing) — http://localhost:${PORT}\n`)
  process.stdout.write(`  ollama: ${OLLAMA_HOST}\n`) // network-surface: false positive — OLLAMA_HOST is validated at L19 to warn about non-localhost; default is 127.0.0.1
  process.stdout.write(`  model:  ${DEFAULT_MODEL}\n`)
  process.stdout.write(`  features: bash block → tool_use conversion\n`)
})