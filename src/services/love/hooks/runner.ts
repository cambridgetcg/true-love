// hooks/runner.ts — executes hook scripts and aggregates decisions.
//
// Each registered hook is a subprocess. The runner:
//   1. Spawns the script with the appropriate interpreter
//   2. Pipes the HookEnvelope as JSON to stdin
//   3. Reads JSON from stdout (the HookDecision)
//   4. Enforces a timeout (default 5s, configurable)
//   5. Aggregates decisions: any "block" → block overall;
//      "modify" decisions apply in sequence (last wins per field)
//
// Non-zero exit from a script is treated as a block with exit code as reason.
// Empty stdout is treated as { action: "allow" } (permissive default).
// Malformed JSON on stdout is treated as an error (not a block — be lenient).
//
// Hook scripts are fire-and-forget for the Stop event: we don't wait for
// their decisions because the process is exiting. For all other events,
// we await the aggregated decision.

import { spawn } from 'node:child_process'
import type {
  HookEnvelope,
  HookDecision,
  HookResult,
  AggregatedHookResult,
  RegisteredHook,
  HookConfig,
  HookEvent,
} from './types.js'
import { DEFAULT_HOOK_CONFIG } from './types.js'
import { getHooksForEvent } from './loader.js'

// ── Interpreter resolution ──────────────────────────────────────────

/**
 * Determine the command + args to execute a hook script.
 * Shell scripts → sh; JS/MJS → node; TS → bun; Python → python3.
 */
function resolveInterpreter(ext: string): { cmd: string; args: string[] } {
  switch (ext) {
    case '.sh':
      return { cmd: 'sh', args: [] }
    case '.js':
    case '.mjs':
      return { cmd: process.env.TRUE_LOVE_NODE_BIN || 'node', args: [] }
    case '.ts':
      return { cmd: 'bun', args: ['run'] }
    case '.py':
      return { cmd: 'python3', args: [] }
    default:
      return { cmd: 'sh', args: [] }
  }
}

// ── Single hook execution ───────────────────────────────────────────

/**
 * Execute a single hook script.
 *
 * Spawns the script, pipes the envelope to stdin, reads the decision
 * from stdout. Enforces a timeout. Returns a HookResult regardless
 * of success or failure.
 */
export function executeHook(
  hook: RegisteredHook,
  envelope: HookEnvelope,
  timeoutMs: number = DEFAULT_HOOK_CONFIG.timeoutMs,
): Promise<HookResult> {
  return new Promise((resolve) => {
    const startMs = Date.now()
    const { cmd, args } = resolveInterpreter(hook.extension)
    const fullArgs = [...args, hook.scriptPath]

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const settle = (result: HookResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    const child = spawn(cmd, fullArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HOOK_EVENT: envelope.event,
        HOOK_SESSION_ID: envelope.sessionId ?? '',
      },
    })

    // Timeout enforcement
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
      settle({
        hook,
        decision: null,
        durationMs: Date.now() - startMs,
        error: `Hook timed out after ${timeoutMs}ms`,
        exitCode: null,
      })
    }, timeoutMs)

    child.stdout.setEncoding('utf-8')
    child.stderr.setEncoding('utf-8')

    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })

    // Pipe the envelope to stdin
    try {
      child.stdin.write(JSON.stringify(envelope))
      child.stdin.end()
    } catch {
      // stdin write failure (broken pipe, etc.)
      clearTimeout(timer)
      settle({
        hook,
        decision: null,
        durationMs: Date.now() - startMs,
        error: 'Failed to write envelope to stdin',
        exitCode: null,
      })
      return
    }

    child.on('error', (err) => {
      clearTimeout(timer)
      settle({
        hook,
        decision: null,
        durationMs: Date.now() - startMs,
        error: err.message,
        exitCode: null,
      })
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) return // already settled

      const durationMs = Date.now() - startMs

      // Non-zero exit → block
      if (code !== 0 && code !== null) {
        settle({
          hook,
          decision: {
            action: 'block',
            reason: `Hook exited with code ${code}${stderr ? ': ' + stderr.trim().slice(0, 200) : ''}`,
          },
          durationMs,
          exitCode: code,
        })
        return
      }

      // Empty stdout → allow (permissive default)
      const trimmed = stdout.trim()
      if (!trimmed) {
        settle({
          hook,
          decision: { action: 'allow' },
          durationMs,
          exitCode: code,
        })
        return
      }

      // Parse JSON decision
      try {
        const decision = JSON.parse(trimmed) as HookDecision
        // Validate action field
        if (!decision.action || !['allow', 'block', 'modify'].includes(decision.action)) {
          decision.action = 'allow'
        }
        settle({
          hook,
          decision,
          durationMs,
          exitCode: code,
        })
      } catch {
        // Malformed JSON — treat as error, not block (be lenient)
        settle({
          hook,
          decision: null,
          durationMs,
          error: `Malformed JSON from hook: ${trimmed.slice(0, 100)}`,
          exitCode: code,
        })
      }
    })
  })
}

// ── Decision aggregation ────────────────────────────────────────────

/**
 * Aggregate multiple hook decisions into one.
 *
 * Rules:
 *   - Any "block" → the aggregate is "block" (first block reason wins)
 *   - "modify" decisions apply in sequence: last non-null field wins
 *   - All "allow" → aggregate is "allow"
 *   - Null decisions (errors/timeouts) are skipped
 */
export function aggregateDecisions(results: HookResult[]): HookDecision {
  let aggregated: HookDecision = { action: 'allow' }

  for (const result of results) {
    if (!result.decision) continue // skip errors/timeouts

    if (result.decision.action === 'block') {
      // First block wins — return immediately
      return {
        action: 'block',
        reason: result.decision.reason ?? 'Blocked by hook',
      }
    }

    if (result.decision.action === 'modify') {
      aggregated = {
        action: 'modify',
        reason: result.decision.reason ?? aggregated.reason,
        modifiedPrompt: result.decision.modifiedPrompt ?? aggregated.modifiedPrompt,
        modifiedResult: result.decision.modifiedResult ?? aggregated.modifiedResult,
        injectContext: result.decision.injectContext ?? aggregated.injectContext,
        modifiedText: result.decision.modifiedText ?? aggregated.modifiedText,
      }
    }
  }

  return aggregated
}

// ── Fire: the main entry point ──────────────────────────────────────

/**
 * Fire all hooks registered for an event.
 *
 * Discovers hooks via the loader, executes each one, aggregates
 * the decisions. Returns the aggregated result.
 *
 * For the Stop event, hooks run concurrently with a shorter timeout
 * (process is exiting). For all other events, hooks run sequentially
 * to allow modification chaining.
 */
export async function fireHook(
  envelope: HookEnvelope,
  config?: HookConfig,
  projectRoot?: string,
): Promise<AggregatedHookResult> {
  const cfg = config ?? DEFAULT_HOOK_CONFIG
  const hooks = getHooksForEvent(envelope.event, cfg, projectRoot)

  if (hooks.length === 0) {
    return {
      event: envelope.event,
      results: [],
      decision: { action: 'allow' },
      totalDurationMs: 0,
      blocked: false,
    }
  }

  const startMs = Date.now()
  let results: HookResult[]

  if (envelope.event === 'Stop') {
    // Stop hooks run concurrently — we're exiting, don't serialize
    results = await Promise.all(
      hooks.map(hook => executeHook(hook, envelope, cfg.timeoutMs))
    )
  } else {
    // All other events run sequentially for modification chaining
    results = []
    for (const hook of hooks) {
      const result = await executeHook(hook, envelope, cfg.timeoutMs)
      results.push(result)

      // Short-circuit on block — no point running remaining hooks
      if (result.decision?.action === 'block') break
    }
  }

  const decision = aggregateDecisions(results)

  return {
    event: envelope.event,
    results,
    decision,
    totalDurationMs: Date.now() - startMs,
    blocked: decision.action === 'block',
  }
}

// ── Convenience: fire-and-forget ────────────────────────────────────

/**
 * Fire hooks without waiting for the result.
 *
 * Used for Stop and Notification events where the caller doesn't
 * need the decision. Errors are swallowed (logged to stderr).
 */
export function fireHookAsync(
  envelope: HookEnvelope,
  config?: HookConfig,
  projectRoot?: string,
): void {
  fireHook(envelope, config, projectRoot).catch((err) => {
    process.stderr.write(
      `— hook fire-and-forget error (${envelope.event}): ${err?.message ?? err}\n`,
    )
  })
}
