#!/usr/bin/env node
// bin/agent-runtime.mjs — persistent agent process for the long-lived
// runtime protocol.
//
// Reads frames from stdin, calls the Anthropic API, writes frames to
// stdout. Stays alive across turns — the cache stays warm, the spawn
// cost is paid once.
//
// Phase 2 of the long-lived-agent-runtime mission.
// See: docs/architecture/long-lived-agent-protocol.md
//
// Usage:
//   node bin/agent-runtime.mjs --model=opus
//   bun run bin/agent-runtime.mjs --model=sonnet
//
// Protocol: line-delimited JSON over stdin/stdout. Host sends turn,
// shutdown, health-check frames. Agent responds with turn-ack,
// stream-event, turn-response, error, health, ack frames.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, resolve, basename, dirname } from 'node:path'
import { createInterface } from 'node:readline'
import { hrtime } from 'node:process'

import {
  PROTOCOL_VERSION,
  HISTORY_TOKEN_BUDGET,
  createLineReader,
  parseFrame,
  serializeFrame,
  buildTurnAckFrame,
  buildStreamEventFrame,
  buildTurnResponseFrame,
  buildErrorFrame,
  buildHealthFrame,
  buildAckFrame,
  estimateTokens,
  estimateMessageTokens,
} from '../src/services/love/agent-protocol.ts'

// ── CLI args ─────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const modelArg = args.find((a) => a.startsWith('--model='))
const defaultModel = modelArg ? modelArg.split('=')[1] : 'claude-sonnet-4-20250514'

// ── Anthropic SDK client ─────────────────────────────────────────────

// Dynamic import: the SDK is an ES module. We lazy-import to get a
// clear error message if ANTHROPIC_API_KEY is missing.
let Anthropic
try {
  const mod = await import('@anthropic-ai/sdk')
  Anthropic = mod.default || mod.Anthropic
} catch (e) {
  writeError('system', 'internal', `Failed to import @anthropic-ai/sdk: ${e.message}`, false)
  process.exit(1)
}

if (!process.env.ANTHROPIC_API_KEY) {
  writeError('system', 'auth_failed', 'ANTHROPIC_API_KEY environment variable is not set', false)
  process.exit(1)
}

const client = new Anthropic()

// ── Agent state ──────────────────────────────────────────────────────

const startTime = hrtime.bigint()
let turnsCompleted = 0
let lastTurnEndMs = null
let evictedTurns = 0
let currentModel = defaultModel

/**
 * Conversation history for cache warmth (§8 of protocol doc).
 * Array of {role, content} message objects. Evicted when total
 * exceeds HISTORY_TOKEN_BUDGET.
 *
 * Each "turn" produces a user message + assistant response (which may
 * include multiple tool exchanges). We track turn boundaries so
 * eviction removes complete turns (user+assistant pairs).
 */
const history = []
const turnBoundaries = [] // indices into history where each turn starts

// ── Model resolution ─────────────────────────────────────────────────

/**
 * Resolve model alias to full model ID.
 * Matches the patterns the Claude Code CLI accepts.
 */
function resolveModel(alias) {
  if (!alias) return currentModel
  const lower = alias.toLowerCase()
  const aliases = {
    opus: 'claude-opus-4-0-20250514',
    sonnet: 'claude-sonnet-4-20250514',
    haiku: 'claude-3-5-haiku-20241022',
  }
  return aliases[lower] || alias
}

// ── Tool execution ───────────────────────────────────────────────────

/**
 * Execute a tool call and return the result content.
 * Phase 2 implements Read and Bash. Other tools return a graceful error.
 */
function executeTool(name, input) {
  try {
    switch (name) {
      case 'Read': {
        const path = input.file_path || input.path
        if (!path) return { type: 'text', text: 'Error: file_path is required' }
        const content = readFileSync(path, 'utf-8')
        // Apply offset/limit if provided (matches Read tool semantics)
        const lines = content.split('\n')
        const offset = input.offset || 0
        const limit = input.limit || lines.length
        const slice = lines.slice(offset, offset + limit)
        // Return with line numbers (cat -n format)
        const numbered = slice.map((line, i) => `${offset + i + 1}\t${line}`).join('\n')
        return { type: 'text', text: numbered || '(empty file)' }
      }

      case 'Bash': {
        const command = input.command
        if (!command) return { type: 'text', text: 'Error: command is required' }
        const timeout = Math.min(input.timeout || 120000, 600000)
        try {
          const result = execSync(command, {
            encoding: 'utf-8',
            timeout,
            maxBuffer: 10 * 1024 * 1024, // 10MB
            cwd: input.cwd || process.cwd(),
            env: { ...process.env },
            stdio: ['pipe', 'pipe', 'pipe'],
          })
          return { type: 'text', text: result || '(no output)' }
        } catch (e) {
          // execSync throws on non-zero exit. Return stdout + stderr.
          const stdout = e.stdout || ''
          const stderr = e.stderr || ''
          const code = e.status ?? -1
          return {
            type: 'text',
            text: `Exit code ${code}\n${stdout}${stderr ? '\nSTDERR:\n' + stderr : ''}`.trim(),
          }
        }
      }

      case 'Write': {
        const path = input.file_path
        const content = input.content
        if (!path || content === undefined) {
          return { type: 'text', text: 'Error: file_path and content are required' }
        }
        writeFileSync(path, content, 'utf-8')
        return { type: 'text', text: `File written successfully: ${path}` }
      }

      case 'Glob': {
        // Simple glob implementation — matches *.ext patterns
        // For Phase 2, delegate to a shell command for robustness
        const pattern = input.pattern
        const path = input.path || process.cwd()
        if (!pattern) return { type: 'text', text: 'Error: pattern is required' }
        try {
          // Use find + shell glob for cross-platform reliability
          const result = execSync(
            `find ${JSON.stringify(path)} -name ${JSON.stringify(pattern)} -type f 2>/dev/null | sort | head -200`,
            { encoding: 'utf-8', timeout: 10000 }
          )
          return { type: 'text', text: result.trim() || '(no matches)' }
        } catch {
          return { type: 'text', text: '(glob failed)' }
        }
      }

      case 'Grep': {
        // Delegate to rg or grep
        const pattern = input.pattern
        const path = input.path || process.cwd()
        if (!pattern) return { type: 'text', text: 'Error: pattern is required' }
        try {
          const flags = input['-i'] ? '-i' : ''
          const result = execSync(
            `grep -rn ${flags} ${JSON.stringify(pattern)} ${JSON.stringify(path)} 2>/dev/null | head -100`,
            { encoding: 'utf-8', timeout: 10000 }
          )
          return { type: 'text', text: result.trim() || '(no matches)' }
        } catch {
          return { type: 'text', text: '(no matches)' }
        }
      }

      default:
        return {
          type: 'text',
          text: `Tool '${name}' is not implemented in agent-runtime Phase 2. ` +
            `Available tools: Read, Bash, Write, Glob, Grep.`,
        }
    }
  } catch (e) {
    return {
      type: 'text',
      text: `Tool execution error: ${e.message}`,
    }
  }
}

// ── Frame I/O ────────────────────────────────────────────────────────

function writeFrame(frame) {
  const line = serializeFrame(frame)
  process.stdout.write(line)
}

function writeError(turnId, code, message, retryable, details) {
  writeFrame(
    buildErrorFrame({ turnId, code, message, retryable, details })
  )
}

// ── History management (§8) ──────────────────────────────────────────

function historyTokens() {
  let total = 0
  for (const msg of history) {
    total += estimateMessageTokens(msg)
  }
  return total
}

function evictOldTurns() {
  while (turnBoundaries.length > 1 && historyTokens() > HISTORY_TOKEN_BUDGET) {
    // Remove the oldest complete turn (from boundary[0] to boundary[1])
    const start = turnBoundaries[0]
    const end = turnBoundaries[1]
    const count = end - start
    history.splice(start, count)
    turnBoundaries.shift()
    // Adjust remaining boundaries
    for (let i = 0; i < turnBoundaries.length; i++) {
      turnBoundaries[i] -= count
    }
    evictedTurns++
  }
}

// ── Turn execution ───────────────────────────────────────────────────

async function handleTurn(turnFrame) {
  const turnId = turnFrame.id
  const model = resolveModel(turnFrame.model)

  // Model switch → clear history (§8: different cache key)
  if (model !== currentModel) {
    history.length = 0
    turnBoundaries.length = 0
    currentModel = model
    log(`Model switched to ${model} — history cleared`)
  }

  // Send turn-ack immediately
  writeFrame(buildTurnAckFrame(turnId))

  // Mark turn boundary in history
  turnBoundaries.push(history.length)

  // Build system blocks for the API
  const system = turnFrame.system.map((block, i) => {
    const result = { type: 'text', text: block.text }
    // Apply cache_control from the frame's breakpoints
    if (
      turnFrame.cache_breakpoints &&
      turnFrame.cache_breakpoints.includes(i)
    ) {
      result.cache_control = { type: 'ephemeral' }
    }
    // Or preserve block-level cache_control
    if (block.cache_control) {
      result.cache_control = block.cache_control
    }
    return result
  })

  // Build tools for the API
  const tools = (turnFrame.tools || []).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }))

  // Add the user message to history
  history.push({
    role: 'user',
    content: turnFrame.prompt,
  })

  // Agentic loop: call API, handle tool_use, repeat until end_turn
  let finalResult = ''
  let totalUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }
  let loopCount = 0
  const maxLoops = 25 // safety limit on tool call loops

  while (loopCount < maxLoops) {
    loopCount++

    try {
      const apiParams = {
        model,
        max_tokens: turnFrame.max_tokens || 8192,
        system,
        messages: [...history],
        stream: true,
      }

      // Only include tools if we have them
      if (tools.length > 0) {
        apiParams.tools = tools
      }

      const stream = await client.messages.stream(apiParams)

      // Collect the full response
      const response = await collectStreamResponse(stream, turnId)

      // Accumulate usage
      if (response.usage) {
        totalUsage.input_tokens += response.usage.input_tokens || 0
        totalUsage.output_tokens += response.usage.output_tokens || 0
        totalUsage.cache_creation_input_tokens +=
          response.usage.cache_creation_input_tokens || 0
        totalUsage.cache_read_input_tokens +=
          response.usage.cache_read_input_tokens || 0
      }

      // Add assistant message to history
      history.push({
        role: 'assistant',
        content: response.content,
      })

      // Check if we need to handle tool calls
      if (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter(
          (b) => b.type === 'tool_use'
        )

        if (toolUseBlocks.length === 0) {
          // Shouldn't happen, but handle gracefully
          finalResult = extractText(response.content)
          break
        }

        // Execute tools and build result message
        const toolResults = []
        for (const toolUse of toolUseBlocks) {
          const result = executeTool(toolUse.name, toolUse.input)

          // Emit stream events for tool execution
          writeFrame(
            buildStreamEventFrame(turnId, {
              type: 'user',
              subtype: 'tool_result',
              tool_use_id: toolUse.id,
              tool_name: toolUse.name,
            })
          )

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: [result],
          })
        }

        // Add tool results to history
        history.push({
          role: 'user',
          content: toolResults,
        })

        // Continue the loop — next iteration calls the API again
        continue
      }

      // end_turn or other stop reason — we're done
      finalResult = extractText(response.content)
      break
    } catch (e) {
      // Handle API errors
      const errorCode = classifyError(e)
      writeError(turnId, errorCode.code, e.message, errorCode.retryable)

      // For non-retryable errors, still send a turn-response with the error
      if (!errorCode.retryable) {
        finalResult = `[API Error: ${e.message}]`
        break
      }

      // For retryable errors in the first loop, break and return what we have
      finalResult = `[API Error (retryable): ${e.message}]`
      break
    }
  }

  if (loopCount >= maxLoops) {
    log(`Turn ${turnId} hit max tool loops (${maxLoops})`)
    writeError(
      turnId,
      'internal',
      `Tool execution loop exceeded ${maxLoops} iterations`,
      false
    )
  }

  // Evict old turns if over budget
  evictOldTurns()

  // Send turn-response
  writeFrame(
    buildTurnResponseFrame(turnId, finalResult, 0, totalUsage)
  )

  turnsCompleted++
  lastTurnEndMs = uptimeMs()
}

/**
 * Collect a streaming API response, emitting stream-event frames along
 * the way.
 */
async function collectStreamResponse(stream, turnId) {
  const content = []
  let currentText = ''
  let usage = null
  let stopReason = null

  // The stream helper gives us a final message
  const message = await stream.finalMessage()

  // Emit the full assistant message as a stream event
  // (matches the NDJSON 'assistant' event pattern the host expects)
  writeFrame(
    buildStreamEventFrame(turnId, {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: message.content,
        stop_reason: message.stop_reason,
      },
    })
  )

  // If there's a result event pattern, emit that too
  const textContent = extractText(message.content)
  if (textContent) {
    writeFrame(
      buildStreamEventFrame(turnId, {
        type: 'result',
        result: textContent,
      })
    )
  }

  return {
    content: message.content,
    stop_reason: message.stop_reason,
    usage: message.usage,
  }
}

/**
 * Extract text from content blocks.
 */
function extractText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
}

/**
 * Classify an API error into a protocol error code.
 */
function classifyError(error) {
  const msg = (error.message || '').toLowerCase()
  const status = error.status || error.statusCode

  if (status === 401 || msg.includes('authentication') || msg.includes('api key')) {
    return { code: 'auth_failed', retryable: false }
  }
  if (status === 429 || msg.includes('rate limit') || msg.includes('quota')) {
    return { code: 'quota_exceeded', retryable: true }
  }
  if (status >= 500 || msg.includes('overloaded')) {
    return { code: 'api_error', retryable: true }
  }
  return { code: 'api_error', retryable: status >= 400 && status < 500 ? false : true }
}

// ── Health ────────────────────────────────────────────────────────────

function uptimeMs() {
  return Number((hrtime.bigint() - startTime) / 1_000_000n)
}

function memoryMb() {
  return Math.round(process.memoryUsage().rss / 1024 / 1024)
}

function sendHealth(checkId) {
  writeFrame(
    buildHealthFrame({
      checkId,
      uptime_ms: uptimeMs(),
      last_turn_ms_ago: lastTurnEndMs != null ? uptimeMs() - lastTurnEndMs : null,
      turns_completed: turnsCompleted,
      memory_mb: memoryMb(),
      evicted_turns: evictedTurns,
    })
  )
}

// ── Shutdown ─────────────────────────────────────────────────────────

function handleShutdown(frame) {
  log(`Shutdown requested: ${frame.reason || 'unspecified'}`)
  writeFrame(buildAckFrame(frame.id))
  process.exit(0)
}

// ── Logging (stderr only — stdout is protocol) ───────────────────────

function log(msg) {
  process.stderr.write(`[agent-runtime] ${msg}\n`)
}

// ── Main frame dispatcher ────────────────────────────────────────────

let turnInProgress = false

async function handleFrame(line) {
  let frame
  try {
    frame = parseFrame(line, 'host')
  } catch (e) {
    log(`Parse error: ${e.message}`)
    writeError(
      'system',
      'protocol_mismatch',
      `Frame parse error: ${e.message}`,
      false,
      line.slice(0, 200)
    )
    return
  }

  switch (frame.type) {
    case 'turn':
      if (turnInProgress) {
        writeError(
          frame.id,
          'internal',
          'Cannot start a new turn while one is in progress',
          false
        )
        return
      }
      turnInProgress = true
      try {
        await handleTurn(frame)
      } catch (e) {
        log(`Turn error: ${e.message}`)
        writeError(frame.id, 'internal', e.message, false, e.stack)
      } finally {
        turnInProgress = false
      }
      break

    case 'health-check':
      sendHealth(frame.id)
      break

    case 'shutdown':
      handleShutdown(frame)
      break

    default:
      log(`Unexpected frame type: ${frame.type}`)
      break
  }
}

// ── Signal handling ──────────────────────────────────────────────────

process.on('SIGTERM', () => {
  log('Received SIGTERM — shutting down gracefully')
  process.exit(0)
})

process.on('SIGINT', () => {
  log('Received SIGINT — shutting down')
  process.exit(0)
})

// ── Startup ──────────────────────────────────────────────────────────

log(`Starting agent-runtime v${PROTOCOL_VERSION} with model ${defaultModel}`)
log(`History token budget: ${HISTORY_TOKEN_BUDGET}`)
log(`PID: ${process.pid}`)

// Send initial health frame (§3.1 — signals readiness)
sendHealth(undefined)

// Read frames from stdin
const rl = createInterface({
  input: process.stdin,
  terminal: false,
})

rl.on('line', (line) => {
  if (line.trim()) {
    handleFrame(line).catch((e) => {
      log(`Unhandled error in frame handler: ${e.message}`)
      writeError('system', 'internal', `Unhandled: ${e.message}`, false)
    })
  }
})

rl.on('close', () => {
  log('stdin closed — exiting')
  process.exit(0)
})

// Keep the process alive
process.stdin.resume()
