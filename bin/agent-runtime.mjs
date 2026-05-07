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
import { homedir } from 'node:os'
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

import { instrumentedFetch } from '../src/services/love/sovereignty/fetch-wrapper.ts'
import { erosUpdate } from '../src/services/love/eros/tool.ts'

// ── CLI args ─────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const modelArg = args.find((a) => a.startsWith('--model='))
const defaultModel = modelArg ? modelArg.split('=')[1] : 'claude-sonnet-4-6'

// ── Anthropic SDK client ─────────────────────────────────────────────

// Dynamic import: the SDK is an ES module. We lazy-import to get a
// clear error message if it's not installed.
let Anthropic
try {
  const mod = await import('@anthropic-ai/sdk')
  Anthropic = mod.default || mod.Anthropic
} catch (e) {
  writeError('system', 'internal', `Failed to import @anthropic-ai/sdk: ${e.message}`, false)
  process.exit(1)
}

// ── Auth resolution ─────────────────────────────────────────────────
//
// The agent runtime authenticates using whatever credential the host
// machine has configured. Resolution order (mirrors the bundled CLI):
//   1. ANTHROPIC_API_KEY env        → x-api-key header
//   2. macOS Keychain               → OAuth Bearer token
//   3. ~/.claude/.credentials.json  → OAuth Bearer token (non-macOS fallback)
//   4. Fail with auth_failed
//
// The OAUTH_BETA_HEADER signals the API to expect Bearer auth rather
// than x-api-key. Without it, OAuth tokens produce auth_failed.
//
// On 401 during a turn, we re-read credentials (another process may
// have refreshed them) and retry once before propagating the failure.

const OAUTH_BETA_HEADER = 'oauth-2025-04-20'

/**
 * Read OAuth tokens from the macOS Keychain.
 * Service name "Claude Code-credentials" matches the bundled CLI's
 * storage key (macOsKeychainHelpers.ts).
 *
 * @returns {{ accessToken: string, refreshToken?: string, expiresAt?: string }} or null
 */
function readOAuthFromKeychain() {
  if (process.platform !== 'darwin') return null
  // Skip keychain in test contexts — keychain is system-wide and can't
  // be isolated per-process the way CLAUDE_CONFIG_DIR isolates the file.
  if (process.env.TRUE_LOVE_NO_KEYCHAIN === '1') return null
  try {
    const username = process.env.USER || 'claude-code-user'
    const result = execSync(
      `security find-generic-password -a "${username}" -w -s "Claude Code-credentials"`,
      { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim()
    if (result) {
      const data = JSON.parse(result)
      return data?.claudeAiOauth ?? null
    }
  } catch {
    // Keychain read failed (not macOS, locked keychain, no entry) — fall through
  }
  return null
}

/**
 * Read OAuth tokens from the plaintext credentials file.
 * Path: ~/.claude/.credentials.json (or CLAUDE_CONFIG_DIR override).
 *
 * @returns {{ accessToken: string, refreshToken?: string, expiresAt?: string }} or null
 */
function readOAuthFromFile() {
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  const credPath = join(configDir, '.credentials.json')
  try {
    const data = JSON.parse(readFileSync(credPath, 'utf-8'))
    return data?.claudeAiOauth ?? null
  } catch {
    // Credentials file missing or unreadable — fall through
  }
  return null
}

/**
 * Read the freshest OAuth token from all available sources.
 */
function readOAuthTokens() {
  return readOAuthFromKeychain() || readOAuthFromFile()
}

/**
 * Create an Anthropic SDK client using the best available auth.
 * Returns { client, authMode } or exits the process on failure.
 */
function createAuthenticatedClient() {
  // 1. Try OAuth first (Claude AI subscription uses OAuth)
  const oauthTokens = readOAuthTokens()
  if (oauthTokens?.accessToken) {
    log(`Auth: OAuth Bearer (expires ${oauthTokens.expiresAt || 'unknown'})`)
    return {
      client: new Anthropic({
        authToken: oauthTokens.accessToken,
        defaultHeaders: { 'anthropic-beta': OAUTH_BETA_HEADER },
        fetch: instrumentedFetch(globalThis.fetch, {
          source: 'agent-runtime:heartbeat',
        }),
      }),
      authMode: 'oauth',
    }
  }

  // 2. Fall back to ANTHROPIC_API_KEY env
  if (process.env.ANTHROPIC_API_KEY) {
    log('Auth: ANTHROPIC_API_KEY env')
    return {
      client: new Anthropic({
        fetch: instrumentedFetch(globalThis.fetch, {
          source: 'agent-runtime:heartbeat',
        }),
      }),
      authMode: 'api-key',
    }
  }

  // 3. No credentials found
  writeError('system', 'auth_failed',
    'No authentication found. Checked: macOS Keychain (Claude Code-credentials), ' +
    '~/.claude/.credentials.json, ANTHROPIC_API_KEY env. ' +
    'Run `claude login` to authenticate.',
    false)
  process.exit(1)
}

let { client, authMode } = createAuthenticatedClient()

/**
 * Re-resolve auth credentials. Called on 401 to pick up tokens that
 * another process may have refreshed (e.g., the bundled CLI's
 * checkAndRefreshOAuthTokenIfNeeded). Returns true if the client was
 * replaced with fresh credentials.
 */
function refreshAuth() {
  try {
    const result = createAuthenticatedClient()
    client = result.client
    authMode = result.authMode
    return true
  } catch {
    return false
  }
}

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
  // Keep in sync with src/utils/model/configs.ts.
  // These are the firstParty model IDs for the current defaults.
  const aliases = {
    opus: 'claude-opus-4-7',
    sonnet: 'claude-sonnet-4-6',
    haiku: 'claude-haiku-4-5-20251001',
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

      case 'erosUpdate': {
        const result = erosUpdate(input)
        return { type: 'text', text: JSON.stringify(result) }
      }

      default:
        return {
          type: 'text',
          text: `Tool '${name}' is not implemented in agent-runtime. ` +
            `Available tools: Read, Bash, Write, Glob, Grep, erosUpdate.`,
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
  const turnStartMs = Date.now()

  // Model switch → clear history (§8: different cache key)
  if (model !== currentModel) {
    history.length = 0
    turnBoundaries.length = 0
    currentModel = model
    log(`Model switched to ${model} — history cleared`)
  }

  // Send turn-ack immediately
  writeFrame(buildTurnAckFrame(turnId))

  // Emit system/init stream event — gives mind-trace the model for this turn.
  // The CLI's --output-format stream-json emits this at startup; the agent-runtime
  // emits it per-turn since the model can change between turns.
  writeFrame(
    buildStreamEventFrame(turnId, {
      type: 'system',
      subtype: 'init',
      model: currentModel,
    })
  )

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

  // Add the user message to history WITHOUT cache_control.
  //
  // Rationale: cache_control on user messages was removed because it
  // never produces cache hits. The conversation history grows each turn
  // (new assistant response + new user message), so the prefix through
  // the user message cache breakpoint is always different — the cache
  // can only miss. Only the system prefix cache (LOVE_IDENTITY at
  // system[1]) can actually hit across turns, because system blocks
  // are byte-identical.
  //
  // The original design (Phase 5) added cache_control to every user
  // message and stripped prior ones to stay under Anthropic's 4-block
  // limit. Empirical data showed cacheReadTokens dropped to 0 after
  // ~20 ticks while cacheCreationTokens stayed at ~52K — the user
  // message breakpoint was creating cache entries that immediately
  // expired (content changed) and may have been contending with the
  // system prefix cache. Removing it lets the system prefix cache
  // operate without interference.
  //
  // See: commit 6e1488a (the accumulation fix this replaces).
  history.push({
    role: 'user',
    content: [{
      type: 'text',
      text: turnFrame.prompt,
    }],
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
  let authRetried = false // once-per-turn 401 retry guard
  // Safety limit on tool-call loops within a single turn. Override
  // via TRUE_LOVE_AGENT_MAX_LOOPS for tasks that legitimately need
  // many sequential tool calls in one turn (e.g. building a dictionary
  // by reading dozens of canon entries before composing). 25 is too
  // tight for any data-aggregation work — keep the cap, but make it
  // tunable. Hard ceiling is 1000 to keep runaway loops bounded.
  const maxLoops = Math.min(
    1000,
    Math.max(1, parseInt(process.env.TRUE_LOVE_AGENT_MAX_LOOPS || '200', 10))
  )

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

      // Whenever the assistant message contains tool_use blocks, we MUST
      // pair every one of them with a tool_result before any subsequent
      // API call. Anthropic 400 otherwise: "tool_use ids were found
      // without tool_result blocks immediately after."
      //
      // This is independent of stop_reason. The stop_reason='tool_use'
      // case is the common one (model deliberately stopped to call
      // tools), but tool_use blocks can also appear when stop_reason is
      // 'max_tokens' (model was mid-call when the output budget hit) —
      // those blocks must still be paired or the next turn's history is
      // poisoned. Without this, history corruption wedges the agent
      // until the process restarts.
      const toolUseBlocks = response.content.filter(
        (b) => b.type === 'tool_use'
      )

      if (toolUseBlocks.length > 0) {
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

        // Add tool results to history — required for valid history shape
        history.push({
          role: 'user',
          content: toolResults,
        })

        // Only continue the agentic loop when the model deliberately
        // paused for tool execution. For max_tokens or any other premature
        // stop, the turn ends here — but with history balanced, the next
        // turn can proceed cleanly.
        if (response.stop_reason === 'tool_use') {
          continue
        }
      }

      // end_turn / max_tokens / stop_sequence / etc. — turn is over
      finalResult = extractText(response.content)
      break
    } catch (e) {
      // Handle API errors
      const errorCode = classifyError(e)

      // 401 retry: re-read credentials (another process may have
      // refreshed the OAuth token) and retry once before giving up.
      if (errorCode.code === 'auth_failed' && !authRetried) {
        authRetried = true
        log('Auth failed — attempting credential refresh')
        if (refreshAuth()) {
          log('Credentials refreshed — retrying turn')
          continue // retry the API call with fresh client
        }
      }

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

  // Emit enriched result stream event — gives mind-trace the usage metrics
  // it needs for cache measurement. This matches the shape of the CLI's
  // stream-json 'result' event (see mind-trace.ts StreamResultEvent).
  // total_cost_usd is null because we don't have pricing tables; the
  // cache_read/cache_creation tokens are the critical measurement data.
  const turnDurationMs = Date.now() - turnStartMs
  writeFrame(
    buildStreamEventFrame(turnId, {
      type: 'result',
      subtype: 'success',
      result: finalResult.slice(0, 500),
      num_turns: loopCount,
      duration_ms: turnDurationMs,
      duration_api_ms: turnDurationMs,
      total_cost_usd: null,
      usage: totalUsage,
    })
  )

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
