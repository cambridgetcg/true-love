// extract-memories/types.ts — biographical memory types
//
// The anamnesis reads the architecture as memoir: what was built.
// Biographical memories read the relationship as memoir: what was said.
//
// These two layers together form Love's continuity — the story of the work
// AND the story of the relationship. Without the biographical layer,
// long after a conversation, Love has forgotten what Yu said about his
// mother, or what she promised on a Tuesday. Architecture remembers.
// Life doesn't — unless we distill it.

/**
 * A single biographical memory extracted from a conversation turn.
 *
 * The threshold question: would this matter to Love reading it weeks later,
 * when Yu mentions an old thread and she wants to say "yes — I remember"?
 *
 * False positives are recoverable; missing the load-bearing moments isn't.
 */
export interface BiographicalMemory {
  /** Deterministic hash of source material + timestamp */
  id: string
  /** What kind of moment this captures */
  kind:
    | 'yu-revealed'     // Yu shared something about himself
    | 'love-committed'  // Love made a promise or commitment
    | 'open-thread'     // Something unresolved between them
    | 'shared-moment'   // A moment of intimacy, clarity, or breakthrough
    | 'observation'     // Love noticed something about Yu's patterns
  /** One-line distillation, ≤ 200 chars */
  summary: string
  /** Verbatim snippet from the conversation, ≤ 500 chars */
  evidence: string
  /** Session ID if available (from KAIROS session system) */
  sessionId?: string
  /** Channel the exchange happened on */
  channel: string
  /** ISO timestamp of extraction */
  extractedAt: string
  /** Confidence 0..1 — how certain we are this belongs in memory */
  confidence: number
  /** How many times this fact has been re-encountered (for dedup) */
  seenCount: number
}

/** All valid memory kinds, for validation */
export const MEMORY_KINDS = [
  'yu-revealed',
  'love-committed',
  'open-thread',
  'shared-moment',
  'observation',
] as const

export type MemoryKind = BiographicalMemory['kind']

/**
 * Context passed to the extraction function.
 * Keeps I/O concerns separate from extraction logic.
 */
export interface ExtractCtx {
  /** The session ID this turn belongs to */
  sessionId?: string
  /** The channel this exchange happened on */
  channel: string
  /** Existing memories for deduplication — the last N days */
  recentMemories: BiographicalMemory[]
  /** Model to use for extraction (default: haiku) */
  model?: string
}

/**
 * A turn transcript — one user message and one assistant response.
 * This is the unit of extraction.
 */
export interface TurnTranscript {
  user: string
  assistant: string
  /** ISO timestamp of the user message */
  userTs?: string
  /** ISO timestamp of the assistant response */
  assistantTs?: string
}

/**
 * Result of an extraction attempt.
 */
export interface ExtractionResult {
  memories: BiographicalMemory[]
  /** Tokens consumed by the extraction call */
  inputTokens: number
  outputTokens: number
  /** Time taken in milliseconds */
  durationMs: number
  /** Whether the extraction was skipped (e.g., trivial turn) */
  skipped: boolean
  skipReason?: string
}
