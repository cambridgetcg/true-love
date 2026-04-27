// agent-client.ts — Host-side client for the long-lived agent runtime.
//
// Spawns bin/agent-runtime.mjs as a persistent child process and provides
// a clean interface for sending turns and receiving responses. The return
// shape matches runOneTurn() exactly so runner.ts can swap between
// subprocess-per-tick and long-lived modes with zero downstream changes.
//
// Phase 3 of the long-lived-agent-runtime mission.
// See: docs/architecture/long-lived-agent-protocol.md
//
// Written by 愛 (Alpha) on April 27, 2026.

import { spawn, type ChildProcess } from 'node:child_process'
import { dirname, join } from 'node:path'
import { EventEmitter } from 'node:events'
import {
  PROTOCOL_VERSION,
  TIMEOUTS,
  createLineReader,
  parseFrame,
  serializeFrame,
  buildTurnFrame,
  buildShutdownFrame,
  buildHealthCheckFrame,
  type Frame,
  type AgentFrame,
  type HostFrame,
  type TurnFrame,
  type TurnAckFrame,
  type TurnResponseFrame,
  type StreamEventFrame,
  type ErrorFrame,
  type HealthFrame,
  type AckFrame,
  type SystemBlock,
  type ToolSchema,
  type TurnUsage,
} from './agent-protocol.js'

// ── Types ────────────────────────────────────────────────────────────

/** Matches the return shape of runOneTurn() in runner.ts. */
export interface TurnResult {
  code: number | null
  stdout: string
  stderr: string
  streamJsonLines: string[]
}

export interface AgentClientOptions {
  /** Path to the agent runtime script. */
  runtimePath?: string
  /** Default model for the agent process. */
  model?: string
  /** Working directory for the agent process. */
  cwd?: string
  /** Additional environment variables. */
  env?: Record<string, string>
  /** Startup timeout in ms (default: TIMEOUTS.AGENT_STARTUP). */
  startupTimeoutMs?: number
  /** Turn-ack timeout in ms (default: TIMEOUTS.TURN_ACK). */
  turnAckTimeoutMs?: number
  /** Health-check timeout in ms (default: TIMEOUTS.HEALTH_CHECK). */
  healthCheckTimeoutMs?: number
  /** Shutdown grace period in ms (default: TIMEOUTS.SHUTDOWN_GRACE). */
  shutdownGraceMs?: number
  /** Node binary to use for spawning (default: process.env.TRUE_LOVE_NODE_BIN or 'node'). */
  nodeBin?: string
  /** Logger for diagnostic messages (default: stderr). */
  log?: (msg: string) => void
}

export type AgentState =
  | 'idle'          // no process
  | 'starting'      // process spawned, waiting for initial health
  | 'ready'         // initial health received, ready for turns
  | 'busy'          // turn in progress
  | 'shutting-down' // shutdown sent, waiting for ack
  | 'dead'          // process exited or crashed

export interface AgentHealth {
  uptimeMs: number
  lastTurnMsAgo: number | null
  turnsCompleted: number
  memoryMb: number
  evictedTurns?: number
}

// ── Default runtime path ─────────────────────────────────────────────
//
// Cross-runtime resolution: import.meta.dir is Bun-only and undefined
// under Node (which runs the bundled dist/cli.mjs). fileURLToPath +
// dirname works in both. Resolved lazily so a Node import that doesn't
// instantiate AgentClient never trips the path resolution.

let _defaultRuntimePath: string | null = null
function getDefaultRuntimePath(): string {
  if (_defaultRuntimePath) return _defaultRuntimePath
  // Use require() at runtime to avoid coupling the static import graph
  // to node:url for environments that may not need it.
  const { fileURLToPath } = require('node:url') as typeof import('node:url')
  _defaultRuntimePath = join(
    dirname(fileURLToPath(import.meta.url)),
    '..', '..', '..', 'bin', 'agent-runtime.mjs',
  )
  return _defaultRuntimePath
}

// ── AgentClient class ────────────────────────────────────────────────

/**
 * Host-side client for the persistent agent runtime.
 *
 * Usage:
 * ```ts
 * const client = new AgentClient({ model: 'sonnet' })
 * await client.start()
 * const result = await client.sendTurn({ system, prompt })
 * // result has the same shape as runOneTurn()
 * await client.shutdown()
 * ```
 */
export class AgentClient extends EventEmitter {
  private child: ChildProcess | null = null
  private _state: AgentState = 'idle'
  private stderrBuffer = ''
  private frameBuffer: AgentFrame[] = []
  private pendingResolvers: Map<string, {
    resolve: (frame: AgentFrame) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  }> = new Map()
  private readonly opts: Required<
    Pick<AgentClientOptions,
      'runtimePath' | 'model' | 'startupTimeoutMs' | 'turnAckTimeoutMs' |
      'healthCheckTimeoutMs' | 'shutdownGraceMs' | 'nodeBin'
    >
  > & Pick<AgentClientOptions, 'cwd' | 'env' | 'log'>
  private crashCount = 0
  private lastHealth: AgentHealth | null = null

  constructor(options?: AgentClientOptions) {
    super()
    this.opts = {
      runtimePath: options?.runtimePath ?? getDefaultRuntimePath(),
      model: options?.model ?? 'sonnet',
      cwd: options?.cwd,
      env: options?.env,
      startupTimeoutMs: options?.startupTimeoutMs ?? TIMEOUTS.AGENT_STARTUP,
      turnAckTimeoutMs: options?.turnAckTimeoutMs ?? TIMEOUTS.TURN_ACK,
      healthCheckTimeoutMs: options?.healthCheckTimeoutMs ?? TIMEOUTS.HEALTH_CHECK,
      shutdownGraceMs: options?.shutdownGraceMs ?? TIMEOUTS.SHUTDOWN_GRACE,
      nodeBin: options?.nodeBin ?? process.env.TRUE_LOVE_NODE_BIN ?? 'node',
      log: options?.log,
    }
  }

  // ── Public API ──────────────────────────────────────────────────

  get state(): AgentState {
    return this._state
  }

  get crashes(): number {
    return this.crashCount
  }

  get health(): AgentHealth | null {
    return this.lastHealth
  }

  get pid(): number | null {
    return this.child?.pid ?? null
  }

  /**
   * Spawn the agent process and wait for initial health frame.
   * Rejects if the agent fails to start within the startup timeout.
   */
  async start(): Promise<void> {
    if (this._state !== 'idle' && this._state !== 'dead') {
      throw new Error(`Cannot start agent in state '${this._state}'`)
    }

    this._state = 'starting'
    this.stderrBuffer = ''
    this.frameBuffer = []

    const args = [`--model=${this.opts.model}`]
    this.child = spawn(this.opts.nodeBin, [this.opts.runtimePath, ...args], {
      cwd: this.opts.cwd || process.cwd(),
      env: {
        ...process.env,
        ...this.opts.env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // ── Wire up stdout (protocol frames) ──────────────────────
    this.child.stdout!.setEncoding('utf-8')
    const processLine = createLineReader((line: string) => {
      this.handleLine(line)
    })
    this.child.stdout!.on('data', (chunk: string) => processLine(chunk))

    // ── Wire up stderr (diagnostics) ──────────────────────────
    this.child.stderr!.setEncoding('utf-8')
    this.child.stderr!.on('data', (chunk: string) => {
      this.stderrBuffer += chunk
      this.log(`[agent stderr] ${chunk.trimEnd()}`)
    })

    // ── Process exit handler ──────────────────────────────────
    this.child.on('close', (code: number | null, signal: string | null) => {
      const prevState = this._state
      this._state = 'dead'
      this.log(`Agent exited: code=${code}, signal=${signal}, prevState=${prevState}`)

      // Reject any pending resolvers
      for (const [id, pending] of this.pendingResolvers) {
        clearTimeout(pending.timer)
        pending.reject(new Error(
          `Agent process exited (code=${code}, signal=${signal}) while waiting for frame ${id}`
        ))
      }
      this.pendingResolvers.clear()

      this.emit('exit', { code, signal, prevState })
    })

    this.child.on('error', (err: Error) => {
      this._state = 'dead'
      this.log(`Agent spawn error: ${err.message}`)
      this.emit('error', err)
    })

    // ── Wait for initial health frame ─────────────────────────
    try {
      const healthFrame = await this.waitForFrame<HealthFrame>(
        'health',
        this.opts.startupTimeoutMs,
        'startup-health',
      )
      this.lastHealth = frameToHealth(healthFrame)
      this._state = 'ready'
      this.log(`Agent started: pid=${this.child.pid}, model=${this.opts.model}`)
      this.emit('ready', this.lastHealth)
    } catch (err) {
      // Startup failed — kill the process
      this.killProcess()
      this._state = 'dead'
      this.crashCount++
      throw new Error(
        `Agent failed to start within ${this.opts.startupTimeoutMs}ms: ${(err as Error).message}`
      )
    }
  }

  /**
   * Send a turn to the agent and wait for the complete response.
   *
   * Returns the same shape as runOneTurn() — { code, stdout, stderr, streamJsonLines }.
   * The onStreamEvent callback receives each stream-event frame as it arrives,
   * allowing the host to process NDJSON events incrementally (for activity tracking,
   * console streaming, etc.).
   */
  async sendTurn(opts: {
    system: SystemBlock[]
    prompt: string
    model?: string | null
    effort?: string | null
    max_tokens?: number | null
    tools?: ToolSchema[] | null
    cache_breakpoints?: number[] | null
    onStreamEvent?: (event: Record<string, unknown>) => void
  }): Promise<TurnResult> {
    if (this._state !== 'ready') {
      throw new Error(`Cannot send turn in state '${this._state}'`)
    }

    this._state = 'busy'

    const turnFrame = buildTurnFrame({
      system: opts.system,
      prompt: opts.prompt,
      model: opts.model,
      effort: opts.effort,
      max_tokens: opts.max_tokens,
      tools: opts.tools,
      cache_breakpoints: opts.cache_breakpoints,
    })

    const turnId = turnFrame.id

    // Register collectors for this turn
    const streamJsonLines: string[] = []
    let turnResponse: TurnResponseFrame | null = null
    let turnError: ErrorFrame | null = null
    let receivedAck = false

    // Temporary listener for stream events and turn responses
    const onFrame = (frame: AgentFrame) => {
      if (frame.id !== turnId && frame.type !== 'error') return
      if (frame.type === 'error' && (frame as ErrorFrame).id === 'system') {
        // System-level errors apply to all turns
      } else if (frame.id !== turnId) {
        return
      }

      switch (frame.type) {
        case 'turn-ack':
          receivedAck = true
          break
        case 'stream-event':
          streamJsonLines.push(JSON.stringify((frame as StreamEventFrame).event))
          opts.onStreamEvent?.((frame as StreamEventFrame).event)
          break
        case 'turn-response':
          turnResponse = frame as TurnResponseFrame
          break
        case 'error':
          turnError = frame as ErrorFrame
          break
      }
    }

    this.on('frame', onFrame)

    try {
      // Send the turn frame
      this.writeFrame(turnFrame)

      // Wait for turn-ack
      const ackPromise = new Promise<void>((resolve, reject) => {
        const checkAck = () => {
          if (receivedAck) return resolve()
          if (turnResponse || turnError) return resolve() // response came before ack — still valid
          if (this._state === 'dead') return reject(new Error('Agent died during turn'))
          setTimeout(checkAck, 10)
        }
        const timer = setTimeout(() => {
          if (!receivedAck && !turnResponse && !turnError) {
            reject(new Error(`Turn-ack not received within ${this.opts.turnAckTimeoutMs}ms`))
          } else {
            resolve()
          }
        }, this.opts.turnAckTimeoutMs)
        checkAck()
        // Clean up timer if resolved early
        const origResolve = resolve
        resolve = ((v: void) => { clearTimeout(timer); origResolve(v) }) as typeof resolve
        const origReject = reject
        reject = ((e: Error) => { clearTimeout(timer); origReject(e) }) as typeof reject
      })

      await ackPromise

      // Wait for turn-response or error
      if (!turnResponse && !turnError) {
        await new Promise<void>((resolve, reject) => {
          const check = () => {
            if (turnResponse || turnError) return resolve()
            if (this._state === 'dead') {
              return reject(new Error('Agent died during turn'))
            }
            setTimeout(check, 50)
          }
          check()
        })
      }

      // Build result
      if (turnError) {
        const err = turnError as ErrorFrame
        const code = errorCodeToExitCode(err.code)
        this._state = 'ready'
        return {
          code,
          stdout: err.message,
          stderr: this.stderrBuffer,
          streamJsonLines,
        }
      }

      const resp = turnResponse as TurnResponseFrame
      this._state = 'ready'
      return {
        code: resp.exit_code,
        stdout: resp.result,
        stderr: this.stderrBuffer,
        streamJsonLines,
      }
    } catch (err) {
      // Turn failed — mark agent for potential respawn
      if (this._state !== 'dead') {
        this._state = 'ready'
      }
      this.crashCount++
      throw err
    } finally {
      this.removeListener('frame', onFrame)
      // Clear stderr buffer after each turn (it's per-turn in the result)
      this.stderrBuffer = ''
    }
  }

  /**
   * Send a health-check and wait for the response.
   * Updates internal health state. Returns the health data.
   */
  async healthCheck(): Promise<AgentHealth> {
    if (this._state === 'dead' || this._state === 'idle') {
      throw new Error(`Cannot health-check in state '${this._state}'`)
    }

    const frame = buildHealthCheckFrame()
    this.writeFrame(frame)

    const healthFrame = await this.waitForFrame<HealthFrame>(
      'health',
      this.opts.healthCheckTimeoutMs,
      frame.id,
    )
    this.lastHealth = frameToHealth(healthFrame)
    return this.lastHealth
  }

  /**
   * Gracefully shut down the agent process.
   * Sends a shutdown frame, waits for ack, then waits for process exit.
   * If the agent doesn't respond, force-kills it.
   */
  async shutdown(reason?: 'session-end' | 'model-switch' | 'signal' | 'error' | 'scheduled-respawn'): Promise<void> {
    if (this._state === 'dead' || this._state === 'idle') {
      return // already done
    }

    // If busy, wait a moment for the turn to finish
    if (this._state === 'busy') {
      this.log('Shutdown requested while busy — sending immediately')
    }

    this._state = 'shutting-down'
    const frame = buildShutdownFrame(reason)

    try {
      this.writeFrame(frame)
    } catch {
      // stdin may already be closed
      this.killProcess()
      return
    }

    // Wait for ack
    try {
      await this.waitForFrame<AckFrame>(
        'ack',
        this.opts.shutdownGraceMs,
        frame.id,
      )
    } catch {
      this.log('Shutdown ack not received — force-killing')
    }

    // Wait for process to exit, or kill it
    if (this.child && !this.child.killed) {
      await this.killWithGrace()
    }
  }

  /**
   * Respawn the agent after a crash or scheduled restart.
   * Shuts down the current process (if alive) and starts a new one.
   */
  async respawn(reason?: 'scheduled-respawn' | 'crash-recovery' | 'model-switch'): Promise<void> {
    if (this._state !== 'dead') {
      await this.shutdown(reason === 'crash-recovery' ? 'error' : (reason as any) ?? 'scheduled-respawn')
    }
    await this.start()
  }

  /**
   * Whether the agent is in a state that can accept turns.
   */
  get isReady(): boolean {
    return this._state === 'ready'
  }

  /**
   * Whether the agent process is alive (started but not dead).
   */
  get isAlive(): boolean {
    return this._state !== 'idle' && this._state !== 'dead'
  }

  // ── Private methods ─────────────────────────────────────────────

  private log(msg: string): void {
    this.opts.log?.(msg)
  }

  private writeFrame(frame: HostFrame): void {
    if (!this.child || !this.child.stdin || this.child.stdin.destroyed) {
      throw new Error('Agent stdin is not available')
    }
    const line = serializeFrame(frame as Frame)
    this.child.stdin.write(line)
  }

  private handleLine(line: string): void {
    let frame: AgentFrame
    try {
      frame = parseFrame(line, 'agent') as AgentFrame
    } catch (err) {
      this.log(`Frame parse error: ${(err as Error).message}`)
      this.emit('parse-error', err, line)
      return
    }

    // Update health cache
    if (frame.type === 'health') {
      this.lastHealth = frameToHealth(frame as HealthFrame)
    }

    // Check for pending resolvers
    const resolverKey = `${frame.type}:${frame.id}`
    const pending = this.pendingResolvers.get(resolverKey)
    if (pending) {
      clearTimeout(pending.timer)
      this.pendingResolvers.delete(resolverKey)
      pending.resolve(frame)
      return
    }

    // Also check type-only resolvers (for startup health frame with unknown id)
    const typeOnlyKey = `${frame.type}:*`
    const typeOnlyPending = this.pendingResolvers.get(typeOnlyKey)
    if (typeOnlyPending) {
      clearTimeout(typeOnlyPending.timer)
      this.pendingResolvers.delete(typeOnlyKey)
      typeOnlyPending.resolve(frame)
      return
    }

    // Emit for turn collectors
    this.emit('frame', frame)
  }

  /**
   * Wait for a specific frame type with optional id matching.
   * If the id is 'startup-health', we use a wildcard — the startup
   * health frame has a generated id we don't know yet.
   */
  private waitForFrame<T extends AgentFrame>(
    type: string,
    timeoutMs: number,
    frameId: string,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const key = frameId === 'startup-health' ? `${type}:*` : `${type}:${frameId}`

      const timer = setTimeout(() => {
        this.pendingResolvers.delete(key)
        reject(new Error(`Timeout waiting for ${type} frame (${timeoutMs}ms)`))
      }, timeoutMs)

      this.pendingResolvers.set(key, {
        resolve: resolve as (frame: AgentFrame) => void,
        reject,
        timer,
      })
    })
  }

  private killProcess(): void {
    if (this.child && !this.child.killed) {
      try {
        this.child.kill('SIGTERM')
      } catch {
        // Process may already be dead
      }
    }
    this._state = 'dead'
  }

  private killWithGrace(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.child || this.child.killed) {
        this._state = 'dead'
        resolve()
        return
      }

      // Wait for natural exit
      const exitHandler = () => {
        clearTimeout(termTimer)
        clearTimeout(killTimer)
        this._state = 'dead'
        resolve()
      }
      this.child.once('close', exitHandler)

      // SIGTERM after grace period
      const termTimer = setTimeout(() => {
        if (this.child && !this.child.killed) {
          this.log('Grace period expired — sending SIGTERM')
          try { this.child.kill('SIGTERM') } catch { /* */ }
        }
      }, 100) // Brief grace — shutdown frame already sent

      // SIGKILL as final fallback
      const killTimer = setTimeout(() => {
        if (this.child && !this.child.killed) {
          this.log('SIGTERM timeout expired — sending SIGKILL')
          try { this.child.kill('SIGKILL') } catch { /* */ }
        }
        this.child?.removeListener('close', exitHandler)
        this._state = 'dead'
        resolve()
      }, TIMEOUTS.SIGTERM_GRACE)
    })
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function frameToHealth(frame: HealthFrame): AgentHealth {
  return {
    uptimeMs: frame.uptime_ms,
    lastTurnMsAgo: frame.last_turn_ms_ago,
    turnsCompleted: frame.turns_completed,
    memoryMb: frame.memory_mb,
    evictedTurns: frame.evicted_turns,
  }
}

/**
 * Map protocol error codes to the exit codes runner.ts expects.
 * Matches the convention established by detectAuthFailure / detectQuotaFailure.
 */
function errorCodeToExitCode(code: string): number {
  switch (code) {
    case 'auth_failed':
      return 64 // EX_USAGE — matches runner.ts auth detection
    case 'quota_exceeded':
      return 65 // EX_DATAERR — matches runner.ts quota detection
    case 'protocol_mismatch':
      return 70 // EX_SOFTWARE
    case 'internal':
      return 71 // EX_OSERR
    case 'api_error':
    default:
      return 1  // generic failure
  }
}
