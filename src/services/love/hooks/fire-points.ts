// hooks/fire-points.ts — thin wrappers that fire hooks at lifecycle points.
//
// Each function builds the correct HookEnvelope for its lifecycle moment
// and calls fireHook(). The runner and ui-server call these instead of
// building envelopes themselves.
//
// All fire functions are best-effort: they catch errors and log to stderr.
// A hook failure should never crash a session.

import type { HookEnvelope, HookConfig, AggregatedHookResult } from './types.js'
import { DEFAULT_HOOK_CONFIG } from './types.js'
import { fireHook, fireHookAsync } from './runner.js'

// ── Helpers ─────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString()
}

async function safeFire(
  envelope: HookEnvelope,
  config?: HookConfig,
  projectRoot?: string,
): Promise<AggregatedHookResult> {
  try {
    return await fireHook(envelope, config, projectRoot)
  } catch (err: any) {
    process.stderr.write(
      `— hook (${envelope.event}) failed: ${err?.message ?? err}\n`,
    )
    return {
      event: envelope.event,
      results: [],
      decision: { action: 'allow' },
      totalDurationMs: 0,
      blocked: false,
    }
  }
}

// ── SessionStart ────────────────────────────────────────────────────

export interface SessionStartContext {
  sessionId: string
  mode: string
  maxTicks: number
  cwd: string
  invitation?: string
}

/**
 * Fire SessionStart hooks.
 *
 * Called once at the beginning of runSession(), after the session banner
 * but before the tick loop. A modify decision can inject context.
 * A block decision aborts the session before any ticks run.
 */
export async function fireSessionStart(
  ctx: SessionStartContext,
  config?: HookConfig,
  projectRoot?: string,
): Promise<AggregatedHookResult> {
  return safeFire({
    event: 'SessionStart',
    timestamp: now(),
    sessionId: ctx.sessionId,
    session: {
      mode: ctx.mode,
      maxTicks: ctx.maxTicks,
      cwd: ctx.cwd,
      invitation: ctx.invitation,
    },
  }, config, projectRoot)
}

// ── Stop ────────────────────────────────────────────────────────────

export interface StopContext {
  sessionId: string
  mode: string
  tick: number
  reason: 'at-rest' | 'signal' | 'ceiling' | 'auth-failure' | 'quota'
}

/**
 * Fire Stop hooks.
 *
 * Called when the session is ending. Fire-and-forget by default —
 * the process is exiting. If `await` behavior is needed, use
 * fireSessionStop directly.
 */
export function fireSessionStopAsync(
  ctx: StopContext,
  config?: HookConfig,
  projectRoot?: string,
): void {
  fireHookAsync({
    event: 'Stop',
    timestamp: now(),
    sessionId: ctx.sessionId,
    session: {
      mode: ctx.mode,
      maxTicks: ctx.tick,
      cwd: process.cwd(),
    },
  }, config, projectRoot)
}

/**
 * Awaitable version of Stop fire (for graceful shutdown).
 */
export async function fireSessionStop(
  ctx: StopContext,
  config?: HookConfig,
  projectRoot?: string,
): Promise<AggregatedHookResult> {
  return safeFire({
    event: 'Stop',
    timestamp: now(),
    sessionId: ctx.sessionId,
    session: {
      mode: ctx.mode,
      maxTicks: ctx.tick,
      cwd: process.cwd(),
    },
  }, config, projectRoot)
}

// ── PreToolUse ──────────────────────────────────────────────────────

export interface PreToolUseContext {
  sessionId: string
  tick: number
  mode: string
  prompt: string
}

/**
 * Fire PreToolUse hooks before a substrate tick.
 *
 * A block decision prevents the tick from running.
 * A modify decision can replace the prompt.
 */
export async function firePreToolUse(
  ctx: PreToolUseContext,
  config?: HookConfig,
  projectRoot?: string,
): Promise<AggregatedHookResult> {
  return safeFire({
    event: 'PreToolUse',
    timestamp: now(),
    sessionId: ctx.sessionId,
    tool: {
      tick: ctx.tick,
      mode: ctx.mode,
      prompt: ctx.prompt,
    },
  }, config, projectRoot)
}

// ── PostToolUse ─────────────────────────────────────────────────────

export interface PostToolUseContext {
  sessionId: string
  tick: number
  mode: string
  result: string
  toolsUsed?: string[]
}

/**
 * Fire PostToolUse hooks after a substrate tick completes.
 *
 * A modify decision can mutate the result text before it's processed
 * by the training/memory pipeline.
 */
export async function firePostToolUse(
  ctx: PostToolUseContext,
  config?: HookConfig,
  projectRoot?: string,
): Promise<AggregatedHookResult> {
  return safeFire({
    event: 'PostToolUse',
    timestamp: now(),
    sessionId: ctx.sessionId,
    tool: {
      tick: ctx.tick,
      mode: ctx.mode,
      result: ctx.result,
      toolsUsed: ctx.toolsUsed,
    },
  }, config, projectRoot)
}

// ── UserPromptSubmit ────────────────────────────────────────────────

export interface UserPromptSubmitContext {
  text: string
  sender: string
  channel?: string
}

/**
 * Fire UserPromptSubmit hooks when a user sends a message.
 *
 * A block decision prevents the message from being written.
 * A modify decision can inject context or rewrite the message.
 */
export async function fireUserPromptSubmit(
  ctx: UserPromptSubmitContext,
  config?: HookConfig,
  projectRoot?: string,
): Promise<AggregatedHookResult> {
  return safeFire({
    event: 'UserPromptSubmit',
    timestamp: now(),
    prompt: {
      text: ctx.text,
      sender: ctx.sender,
      channel: ctx.channel,
    },
  }, config, projectRoot)
}

// ── Notification ────────────────────────────────────────────────────

export interface NotificationContext {
  kind: string
  text: string
  target?: string
}

/**
 * Fire Notification hooks when an alert/notification is being sent.
 *
 * A modify decision can reroute or rewrite the notification.
 * A block decision suppresses it.
 */
export async function fireNotification(
  ctx: NotificationContext,
  config?: HookConfig,
  projectRoot?: string,
): Promise<AggregatedHookResult> {
  return safeFire({
    event: 'Notification',
    timestamp: now(),
    notification: {
      kind: ctx.kind,
      text: ctx.text,
      target: ctx.target,
    },
  }, config, projectRoot)
}

// ── SubagentStop ────────────────────────────────────────────────────

export interface SubagentStopContext {
  taskId: string
  exitCode: number | null
  summary?: string
}

/**
 * Fire SubagentStop hooks when a background task completes.
 *
 * Fire-and-forget — the task is already done.
 */
export function fireSubagentStopAsync(
  ctx: SubagentStopContext,
  config?: HookConfig,
  projectRoot?: string,
): void {
  fireHookAsync({
    event: 'SubagentStop',
    timestamp: now(),
    subagent: {
      taskId: ctx.taskId,
      exitCode: ctx.exitCode,
      summary: ctx.summary,
    },
  }, config, projectRoot)
}
