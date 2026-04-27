// hooks/types.ts — the extension-point contract for the true-love substrate.
//
// Hooks are subprocess calls: a script receives a JSON envelope on stdin,
// prints a JSON decision on stdout. They run in isolation (no shared
// memory with the runtime) and are language-agnostic (.sh, .js, .ts, .py).
//
// The seven hook events cover the session lifecycle:
//
//   SessionStart    — session opens (inject context, load state)
//   Stop            — session ends (drain tasks, save state, reflect)
//   PreToolUse      — before a substrate tick (can block, modify prompt)
//   PostToolUse     — after a substrate tick (can mutate result, log)
//   UserPromptSubmit — user sends a /visit message (preprocess, expand)
//   Notification    — outbox delivery (route: terminal, Telegram, etc.)
//   SubagentStop    — background task completes (record, chain, trigger)
//
// Design notes:
//   - Envelope schema is MINIMAL — just what's needed for the decision.
//   - Hook types are narrow: one lifecycle moment, one clear shape.
//   - Decisions aggregate: any "block" → block; modifications apply in order.
//   - Non-zero exit from a hook script is treated as block.
//   - Hooks must respond within a configurable timeout (default 5s).

/**
 * The seven lifecycle events where hooks fire.
 */
export type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'Stop'
  | 'Notification'
  | 'SubagentStop'

/** All valid hook event names. */
export const HOOK_EVENTS: readonly HookEvent[] = [
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'SessionStart',
  'Stop',
  'Notification',
  'SubagentStop',
] as const

/**
 * The JSON envelope piped to a hook script's stdin.
 *
 * Every envelope carries the event type and session context.
 * Event-specific fields are present only for their event type —
 * a SessionStart envelope has no `tool` field, etc.
 */
export interface HookEnvelope {
  /** Which lifecycle event is firing. */
  event: HookEvent

  /** Session identifier (device + timestamp based). */
  sessionId?: string

  /** Channel this event originates from (e.g. "visit", "telegram"). */
  channel?: string

  /** Timestamp of the event in ISO format. */
  timestamp: string

  // ── Event-specific payloads ────────────────────────────────────

  /** PreToolUse / PostToolUse: the tick being processed. */
  tool?: {
    /** Tick number within the session. */
    tick: number
    /** Mode: heartbeat, awakened, dwell. */
    mode: string
    /** The prompt about to be sent (PreToolUse) or that was sent (PostToolUse). */
    prompt?: string
    /** The model's response text (PostToolUse only). */
    result?: string
    /** Tool names used in this tick (PostToolUse only). */
    toolsUsed?: string[]
  }

  /** UserPromptSubmit: the incoming user message. */
  prompt?: {
    /** Raw message text. */
    text: string
    /** Who sent it. */
    sender: string
    /** Which channel it arrived on. */
    channel?: string
  }

  /** Notification: outbound alert. */
  notification?: {
    /** Notification category. */
    kind: string
    /** The message text. */
    text: string
    /** Target recipient or channel. */
    target?: string
  }

  /** SubagentStop: background task completion. */
  subagent?: {
    /** Task identifier. */
    taskId: string
    /** Exit code of the subprocess. */
    exitCode: number | null
    /** Summary of what the task produced. */
    summary?: string
  }

  /** SessionStart: session configuration. */
  session?: {
    /** Session mode: heartbeat, awakened, dwell. */
    mode: string
    /** Maximum ticks allowed. */
    maxTicks: number
    /** Invitation string, if any. */
    invitation?: string
    /** Working directory. */
    cwd: string
  }
}

/**
 * The JSON decision a hook script writes to stdout.
 *
 * The hook runner reads this and aggregates across all registered scripts.
 * Default (no output / empty output) is treated as { action: "allow" }.
 */
export interface HookDecision {
  /** What the hook decided. */
  action: 'allow' | 'block' | 'modify'

  /** Human-readable reason (required for block, optional otherwise). */
  reason?: string

  /** For PreToolUse modify: replacement prompt text. */
  modifiedPrompt?: string

  /** For PostToolUse modify: replacement result text. */
  modifiedResult?: string

  /** For UserPromptSubmit: additional context to inject before the message. */
  injectContext?: string

  /** For Notification modify: rewritten notification text. */
  modifiedText?: string
}

/**
 * A registered hook: an event type paired with a script path.
 */
export interface RegisteredHook {
  /** Which event this hook handles. */
  event: HookEvent
  /** Absolute path to the script. */
  scriptPath: string
  /** Script extension (for execution strategy). */
  extension: string
}

/**
 * Result of executing a single hook script.
 */
export interface HookResult {
  /** The registered hook that produced this result. */
  hook: RegisteredHook
  /** The decision the script returned (null if timeout/error). */
  decision: HookDecision | null
  /** Execution time in milliseconds. */
  durationMs: number
  /** Error message if the hook failed. */
  error?: string
  /** Exit code from the subprocess. */
  exitCode: number | null
}

/**
 * Aggregated result of firing all hooks for a single event.
 */
export interface AggregatedHookResult {
  /** The event that was fired. */
  event: HookEvent
  /** Individual results from each hook script. */
  results: HookResult[]
  /** The final aggregated decision. */
  decision: HookDecision
  /** Total time across all hooks. */
  totalDurationMs: number
  /** Whether any hook blocked the action. */
  blocked: boolean
}

/**
 * Hook subsystem configuration.
 */
export interface HookConfig {
  /** Whether hooks are enabled at all. */
  enabled: boolean
  /** Default timeout for hook scripts in milliseconds. */
  timeoutMs: number
  /** Primary hooks directory (global). */
  directory: string
  /** Per-project hooks directory pattern. */
  projectDirectory?: string
}

/** Sensible defaults. */
export const DEFAULT_HOOK_CONFIG: HookConfig = {
  enabled: true,
  timeoutMs: 5_000,
  directory: '~/.true-love/hooks',
}

/** Supported script extensions. */
export const HOOK_EXTENSIONS = ['.sh', '.js', '.mjs', '.ts', '.py'] as const
export type HookExtension = (typeof HOOK_EXTENSIONS)[number]
