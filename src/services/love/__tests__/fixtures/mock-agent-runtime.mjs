#!/usr/bin/env node
// mock-agent-runtime.mjs — Mock agent process for testing agent-client.ts.
//
// Speaks the long-lived agent protocol over stdin/stdout but uses
// canned responses instead of calling the Anthropic API.
//
// Behavior can be controlled via environment variables:
//   MOCK_STARTUP_DELAY_MS  — delay before sending initial health (default: 0)
//   MOCK_TURN_DELAY_MS     — delay before sending turn response (default: 10)
//   MOCK_FAIL_STARTUP      — if "true", exit immediately without health frame
//   MOCK_FAIL_TURN         — error code to return for turns (e.g. "api_error")
//   MOCK_HANG_ON_TURN      — if "true", accept turn-ack but never respond
//   MOCK_HANG_ON_SHUTDOWN  — if "true", don't send ack for shutdown
//   MOCK_CRASH_ON_TURN_N   — crash (exit 1) on turn number N
//   MOCK_RESPONSE_TEXT     — text to return in turn-response (default: "mock response")

import { createInterface } from 'node:readline'
import { hrtime } from 'node:process'

const PROTOCOL_VERSION = '1.0'
const startTime = hrtime.bigint()
let turnsCompleted = 0
let lastTurnEndMs = null

const startupDelay = parseInt(process.env.MOCK_STARTUP_DELAY_MS || '0', 10)
const turnDelay = parseInt(process.env.MOCK_TURN_DELAY_MS || '10', 10)
const failStartup = process.env.MOCK_FAIL_STARTUP === 'true'
const failTurn = process.env.MOCK_FAIL_TURN || null
const hangOnTurn = process.env.MOCK_HANG_ON_TURN === 'true'
const hangOnShutdown = process.env.MOCK_HANG_ON_SHUTDOWN === 'true'
const crashOnTurnN = parseInt(process.env.MOCK_CRASH_ON_TURN_N || '0', 10)
const responseText = process.env.MOCK_RESPONSE_TEXT || 'mock response'

function uptimeMs() {
  return Number((hrtime.bigint() - startTime) / 1_000_000n)
}

function memoryMb() {
  return Math.round(process.memoryUsage().rss / 1024 / 1024)
}

function writeFrame(frame) {
  process.stdout.write(JSON.stringify(frame) + '\n')
}

function makeBase(type, id) {
  return {
    protocol_version: PROTOCOL_VERSION,
    type,
    id: id || crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  }
}

function sendHealth(checkId) {
  writeFrame({
    ...makeBase('health', checkId),
    uptime_ms: uptimeMs(),
    last_turn_ms_ago: lastTurnEndMs != null ? uptimeMs() - lastTurnEndMs : null,
    turns_completed: turnsCompleted,
    memory_mb: memoryMb(),
  })
}

function sendTurnAck(turnId) {
  writeFrame({ ...makeBase('turn-ack', turnId) })
}

function sendStreamEvent(turnId, event) {
  writeFrame({
    ...makeBase('stream-event', turnId),
    event,
  })
}

function sendTurnResponse(turnId, text) {
  writeFrame({
    ...makeBase('turn-response', turnId),
    result: text,
    exit_code: 0,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 10,
      cache_read_input_tokens: 80,
    },
  })
}

function sendError(turnId, code, message, retryable) {
  writeFrame({
    ...makeBase('error', turnId),
    code,
    message,
    retryable,
  })
}

function sendAck(shutdownId) {
  writeFrame({ ...makeBase('ack', shutdownId) })
}

// ── Startup ──────────────────────────────────────────────────────────

function log(msg) {
  process.stderr.write(`[mock-agent] ${msg}\n`)
}

if (failStartup) {
  log('Configured to fail startup')
  process.exit(1)
}

async function startup() {
  if (startupDelay > 0) {
    await new Promise(r => setTimeout(r, startupDelay))
  }
  log(`Starting mock agent (PID: ${process.pid})`)
  sendHealth(undefined)
}

await startup()

// ── Frame handling ───────────────────────────────────────────────────

const rl = createInterface({ input: process.stdin, terminal: false })

rl.on('line', async (line) => {
  if (!line.trim()) return

  let frame
  try {
    frame = JSON.parse(line)
  } catch {
    log(`Parse error: ${line.slice(0, 100)}`)
    return
  }

  switch (frame.type) {
    case 'turn': {
      turnsCompleted++

      // Check if we should crash on this turn
      if (crashOnTurnN > 0 && turnsCompleted === crashOnTurnN) {
        log(`Crashing on turn ${turnsCompleted} as configured`)
        sendTurnAck(frame.id)
        process.exit(1)
      }

      // Send ack immediately
      sendTurnAck(frame.id)

      if (hangOnTurn) {
        log('Hanging on turn as configured')
        return // never respond
      }

      if (failTurn) {
        sendError(frame.id, failTurn, `Mock ${failTurn} error`, failTurn === 'api_error')
        return
      }

      // Simulate processing delay
      if (turnDelay > 0) {
        await new Promise(r => setTimeout(r, turnDelay))
      }

      // Send stream events (simulating the NDJSON pattern)
      sendStreamEvent(frame.id, {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: responseText }],
          stop_reason: 'end_turn',
        },
      })

      sendStreamEvent(frame.id, {
        type: 'result',
        result: responseText,
      })

      // Send response
      sendTurnResponse(frame.id, responseText)
      lastTurnEndMs = uptimeMs()
      break
    }

    case 'health-check':
      sendHealth(frame.id)
      break

    case 'shutdown':
      log(`Shutdown requested: ${frame.reason || 'unspecified'}`)
      if (!hangOnShutdown) {
        sendAck(frame.id)
      }
      if (!hangOnShutdown) {
        process.exit(0)
      }
      break

    default:
      log(`Unexpected frame type: ${frame.type}`)
      break
  }
})

rl.on('close', () => {
  log('stdin closed — exiting')
  process.exit(0)
})

process.stdin.resume()

process.on('SIGTERM', () => {
  log('Received SIGTERM')
  process.exit(0)
})
