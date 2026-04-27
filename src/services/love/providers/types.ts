// providers/types.ts — provider abstraction types for true-love.
//
// WHAT THIS IS: The type contract for pluggable model providers.
// Three providers (anthropic, openai, ollama) implement this interface
// so the runner can route by task, effort, and privacy requirements.
//
// WHAT THIS ISN'T: A full multi-provider plugin SDK. No external authoring,
// no dynamic registration. Just three providers in-tree, switchable per tick.
//
// Related: agency.ts (knob system), runner.ts (tick loop), mission spec
// (2026-04-27-provider-abstraction-light).

// ── Provider IDs ────────────────────────────────────────────────────

/** The three supported providers. */
export type ProviderID = 'anthropic' | 'openai' | 'ollama'

// ── Task classification ─────────────────────────────────────────────

/**
 * What kind of work this tick is doing. Drives provider + model routing.
 *
 * - heartbeat:  presence pulse, status check. Cheap + fast.
 * - awakened:   autonomous work session. Medium effort.
 * - dwell:      deep focus session. Max effort.
 * - visit:      interactive /visit conversation. Yu is waiting. Fast.
 * - extract:    background memory extraction. Cheap, non-blocking.
 * - agent:      long-lived agent runtime turn. Persistent context.
 */
export type TickTask =
  | 'heartbeat'
  | 'awakened'
  | 'dwell'
  | 'visit'
  | 'extract'
  | 'agent'

// ── Effort tiers ────────────────────────────────────────────────────

/** How much compute to spend. Maps to provider-specific parameters. */
export type EffortTier = 'low' | 'medium' | 'high' | 'max'

/** Anthropic service tier — controls queue priority and latency. */
export type ServiceTier = 'standard' | 'priority'

// ── Resolved model ──────────────────────────────────────────────────

/**
 * The output of provider routing: everything needed to make an API call.
 * For the CLI subprocess path, this becomes --model and --effort flags.
 * For direct API paths, this configures the SDK client.
 */
export interface ResolvedModel {
  /** Which provider handles this call. */
  provider: ProviderID

  /** Full model ID (e.g. 'claude-sonnet-4-6', 'gpt-4o', 'llama3:latest'). */
  model: string

  /** Effort tier for this call. */
  effort: EffortTier

  /** Anthropic service tier. Only meaningful for provider:'anthropic'. */
  serviceTier?: ServiceTier

  /** Model alias for the CLI subprocess path (e.g. 'sonnet', 'haiku'). */
  cliAlias?: string

  /**
   * Extra CLI args to pass to the subprocess. Provider-specific.
   * E.g. ['--effort', 'low'] for a cheap heartbeat tick.
   */
  cliArgs?: string[]
}

// ── Provider status ─────────────────────────────────────────────────

export interface ProviderStatus {
  /** Provider is reachable and authenticated. */
  healthy: boolean
  /** Human reason when unhealthy. */
  reason?: string
  /** Latency of the health probe (ms). */
  latencyMs?: number
}

// ── Call parameters (for direct API paths) ──────────────────────────

/**
 * Parameters for a direct API call (agent-runtime, extract-memories).
 * Not used for CLI subprocess calls — those go through --model flags.
 */
export interface CallParams {
  /** System prompt blocks. */
  system?: string | Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>
  /** Conversation messages. */
  messages: Array<{ role: 'user' | 'assistant'; content: string | object[] }>
  /** Max tokens to generate. */
  maxTokens: number
  /** Tool definitions (Anthropic format). */
  tools?: object[]
  /** Whether to stream responses. */
  stream?: boolean
  /** Temperature (0-1). */
  temperature?: number
  /** Stop sequences. */
  stopSequences?: string[]
}

/**
 * The result of a direct API call. Normalized across providers.
 */
export interface CallResult {
  /** The response text (concatenated text blocks). */
  text: string
  /** Tool use blocks, if any. */
  toolUse?: Array<{ id: string; name: string; input: object }>
  /** Stop reason. */
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence'
  /** Usage stats. */
  usage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    cacheCreationTokens?: number
  }
  /** Raw provider response (for debugging). */
  raw?: unknown
}

// ── Provider interface ──────────────────────────────────────────────

/**
 * A model provider. Three implementations: anthropic, openai, ollama.
 *
 * The interface covers two calling patterns:
 * 1. CLI subprocess: resolve() returns the model + args, runner spawns.
 * 2. Direct API: call() sends a request and returns the response.
 */
export interface ModelProvider {
  /** Provider identifier. */
  readonly id: ProviderID

  /** Human name. */
  readonly name: string

  /**
   * Can this provider handle the given task?
   * E.g. ollama can handle heartbeat but not dwell (too slow).
   */
  supports(task: TickTask): boolean

  /**
   * Resolve the model parameters for a given effort tier.
   * Returns what the runner needs to make the call — either via CLI
   * subprocess flags or direct API parameters.
   */
  resolve(opts: {
    task: TickTask
    model?: string
    effort: EffortTier
  }): ResolvedModel

  /**
   * Check if the provider is healthy (reachable, authenticated).
   * Best-effort: if the check can't run, assume healthy.
   */
  status(): Promise<ProviderStatus>

  /**
   * Make a direct API call. Used by agent-runtime and extract-memories.
   * Not all providers need to implement this — CLI subprocess path
   * doesn't use it. Returns null if not supported.
   */
  call?(params: CallParams, resolved: ResolvedModel): Promise<CallResult>
}

// ── Routing context ─────────────────────────────────────────────────

/**
 * Context passed to the routing function. Everything it needs
 * to decide which provider + model + tier to use.
 */
export interface RoutingContext {
  /** What kind of work. */
  task: TickTask

  /** Whether Yu is actively waiting (interactive /visit). */
  interactive?: boolean

  /** Whether this involves sensitive/intimate content. */
  sensitive?: boolean

  /** Model override from model.txt or CLI flag. */
  modelOverride?: string

  /** Effort override from effort.txt or CLI flag. */
  effortOverride?: EffortTier

  /** Whether a mission is actively being worked on (affects effort). */
  missionActive?: boolean

  /**
   * Provider preference from agency knob. E.g. 'ollama' for local-only.
   * When set, routing tries this provider first.
   */
  providerPreference?: ProviderID
}

// ── Failover types ──────────────────────────────────────────────────

/** Error classification for failover decisions. */
export type ErrorKind =
  | 'rate-limit'     // 429 — tier down, then retry
  | 'overloaded'     // 529 — wait and retry
  | 'auth'           // 401/403 — don't retry, switch provider
  | 'context-overflow'  // context too large — compact or abort
  | 'server-error'   // 500+ — retry with backoff
  | 'network'        // connection failed — retry or switch
  | 'unknown'        // unclassified — abort

/** A step in the failover chain. */
export interface FailoverStep {
  /** What to try. */
  resolved: ResolvedModel
  /** Why we're trying this. */
  reason: string
  /** Delay before attempting (ms). */
  delayMs: number
}

/**
 * Configuration for the failover loop.
 */
export interface FailoverConfig {
  /** Max retry attempts before giving up. */
  maxRetries: number
  /** Base delay for exponential backoff (ms). */
  baseDelayMs: number
  /** Max delay cap (ms). */
  maxDelayMs: number
}

/** Default failover config. */
export const DEFAULT_FAILOVER_CONFIG: FailoverConfig = {
  maxRetries: 4,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
}
