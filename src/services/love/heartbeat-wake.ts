// heartbeat-wake.ts — in-process wake-gate for the heartbeat mode.
//
// Multiple sources can request a heartbeat fire (the launchd timer is
// external; in-process callers might be: signal handlers, session
// at-rest hooks, ache/feeling daemons emitting arrival events). The
// wake-gate is the priority queue + coalesce window + retry-on-busy
// machinery that batches those requests and dispatches them to a
// registered handler.
//
// This is the v2-ready API surface. v1 has only one in-process caller
// (manual `requestHeartbeatNow` for testing). External launchd-fired
// heartbeats run via `bin/heartbeat.mjs` directly without using this
// gate — they're standalone processes.
//
// Pattern ported from openclaw's heartbeat-wake.ts (their
// implementation: ~250 lines, multi-tenant). Stripped of agentId/
// sessionKey targeting (Love is single-user), kept the priority
// queue + coalesce + retry skeleton.
//
// Spec: docs/superpowers/specs/2026-04-26-heartbeat-design.md

// ── Types ──────────────────────────────────────────────────────────

export type HeartbeatReason =
  | 'interval'
  | 'manual'
  | 'retry'
  | 'action'

export type SkipReason =
  | 'lock-held-by-session'
  | 'empty-heartbeat-file'
  | 'no-tasks-due'
  | 'kingdom-skip'
  | 'outside-active-hours'
  | 'requests-in-flight'

export type HeartbeatRunResult =
  | { status: 'ran'; durationMs: number; ack: boolean }
  | { status: 'skipped'; reason: SkipReason }
  | { status: 'failed'; reason: string }

export interface WakeRequest {
  reason: HeartbeatReason
  scope?: string
  requestedAt: number
}

export type HeartbeatWakeHandler = (req: WakeRequest) => Promise<HeartbeatRunResult>

// ── Constants ──────────────────────────────────────────────────────

const DEFAULT_COALESCE_MS = 250
const DEFAULT_RETRY_MS = 1_000

const REASON_PRIORITY: Record<HeartbeatReason, number> = {
  retry: 0,
  interval: 1,
  manual: 3,
  action: 3,
}

// ── Module state ───────────────────────────────────────────────────

let heartbeatsEnabled = true
let handler: HeartbeatWakeHandler | null = null
let handlerGeneration = 0

const pendingWakes = new Map<string, WakeRequest & { priority: number }>()

let timer: ReturnType<typeof setTimeout> | null = null
let timerDueAt: number | null = null
let timerKind: 'normal' | 'retry' | null = null
let scheduled = false
let running = false

// ── Public API ─────────────────────────────────────────────────────

export function areHeartbeatsEnabled(): boolean {
  return heartbeatsEnabled
}

export function setHeartbeatsEnabled(enabled: boolean): void {
  heartbeatsEnabled = enabled
}

/**
 * Enqueue a wake request. Coalesces with any other in-flight requests for
 * the same scope (the higher-priority request wins; same-priority later
 * request wins). Schedules the handler to fire after coalesceMs.
 *
 * Best-effort. Failure (e.g. handler not registered) keeps the request
 * queued — when a handler eventually registers, queued requests fire.
 */
export function requestHeartbeatNow(opts?: {
  reason?: HeartbeatReason
  scope?: string
  coalesceMs?: number
}): void {
  if (!heartbeatsEnabled) return
  queuePending({
    reason: opts?.reason ?? 'manual',
    scope: opts?.scope,
    requestedAt: Date.now(),
  })
  schedule(opts?.coalesceMs ?? DEFAULT_COALESCE_MS, 'normal')
}

/**
 * Register the handler that runs heartbeats. The runner sets this when it
 * boots into a long-running mode. Returns a disposer. Stale disposers
 * (from a prior registration) are no-ops.
 */
export function setHeartbeatWakeHandler(
  next: HeartbeatWakeHandler | null,
): () => void {
  handlerGeneration += 1
  const generation = handlerGeneration
  handler = next
  if (next) {
    // Reset stale module state from prior lifecycle (e.g. interrupted run).
    if (timer) clearTimeout(timer)
    timer = null
    timerDueAt = null
    timerKind = null
    running = false
    scheduled = false
    if (pendingWakes.size > 0) {
      schedule(DEFAULT_COALESCE_MS, 'normal')
    }
  }
  return () => {
    if (handlerGeneration !== generation) return
    if (handler !== next) return
    handlerGeneration += 1
    handler = null
  }
}

export function _resetHeartbeatWakeStateForTests(): void {
  if (timer) clearTimeout(timer)
  timer = null
  timerDueAt = null
  timerKind = null
  pendingWakes.clear()
  scheduled = false
  running = false
  handlerGeneration += 1
  handler = null
  heartbeatsEnabled = true
}

// ── Internals ──────────────────────────────────────────────────────

function priorityOf(reason: HeartbeatReason): number {
  return REASON_PRIORITY[reason] ?? 1
}

function scopeKey(scope?: string): string {
  return scope ?? '__default__'
}

function queuePending(req: WakeRequest): void {
  const key = scopeKey(req.scope)
  const priority = priorityOf(req.reason)
  const existing = pendingWakes.get(key)
  if (!existing) {
    pendingWakes.set(key, { ...req, priority })
    return
  }
  if (priority > existing.priority) {
    pendingWakes.set(key, { ...req, priority })
    return
  }
  if (priority === existing.priority && req.requestedAt >= existing.requestedAt) {
    pendingWakes.set(key, { ...req, priority })
  }
}

function schedule(coalesceMs: number, kind: 'normal' | 'retry'): void {
  const delay = Number.isFinite(coalesceMs) ? Math.max(0, coalesceMs) : DEFAULT_COALESCE_MS
  const dueAt = Date.now() + delay

  if (timer) {
    // Retry cooldown is a hard minimum — never collapse it with a normal call.
    if (timerKind === 'retry') return
    if (typeof timerDueAt === 'number' && timerDueAt <= dueAt) return
    clearTimeout(timer)
    timer = null
    timerDueAt = null
    timerKind = null
  }

  timerDueAt = dueAt
  timerKind = kind
  timer = setTimeout(async () => {
    timer = null
    timerDueAt = null
    timerKind = null
    scheduled = false
    if (!handler) return
    if (running) {
      scheduled = true
      schedule(delay, kind)
      return
    }

    const batch = Array.from(pendingWakes.values())
    pendingWakes.clear()
    running = true
    try {
      for (const pending of batch) {
        const req: WakeRequest = {
          reason: pending.reason,
          scope: pending.scope,
          requestedAt: pending.requestedAt,
        }
        const res = await handler(req)
        if (res.status === 'skipped' && res.reason === 'lock-held-by-session') {
          // Lock held — requeue and reschedule with retry cooldown.
          queuePending({
            reason: 'retry',
            scope: pending.scope,
            requestedAt: Date.now(),
          })
          schedule(DEFAULT_RETRY_MS, 'retry')
        }
      }
    } catch {
      for (const pending of batch) {
        queuePending({
          reason: 'retry',
          scope: pending.scope,
          requestedAt: Date.now(),
        })
      }
      schedule(DEFAULT_RETRY_MS, 'retry')
    } finally {
      running = false
      if (pendingWakes.size > 0 || scheduled) {
        schedule(delay, 'normal')
      }
    }
  }, delay)
  if (typeof timer.unref === 'function') timer.unref()
}
