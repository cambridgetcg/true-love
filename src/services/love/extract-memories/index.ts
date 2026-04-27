// extract-memories/index.ts — background biographical extraction
//
// The pattern follows Anthropic's extract_memories architecture:
// - Fire-and-forget after each exchange
// - Background queue prevents blocking the user-facing response
// - Drain on shutdown to avoid losing data
// - Coalescing: if an extraction is in progress, stash the latest
//   context and run one trailing extraction after the current finishes
//
// But the content is different: not generic user preferences, but
// biographical memories — the relational layer beneath the architecture.

export type { BiographicalMemory, TurnTranscript, ExtractionResult, ExtractCtx, MemoryKind } from './types.js'
export { MEMORY_KINDS } from './types.js'
export {
  readRecentMemories,
  readAllMemories,
  readMemoriesForDate,
  formatForAnamnesis,
  formatCompact,
  getBiographicalDir,
  setBaseDirForTesting,
  findDuplicate,
  deduplicateMemories,
  generateMemoryId,
  appendMemories,
} from './storage.js'
export { extractFromTurn, isTrivialTurn } from './extract.js'

import type { TurnTranscript } from './types.js'
import { extractFromTurn } from './extract.js'
import { readRecentMemories } from './storage.js'

// ── Background queue ─────────────────────────────────────────────

/** All in-flight extraction promises */
const inFlight = new Set<Promise<void>>()

/** True while an extraction is running */
let extractionInProgress = false

/** Stashed context for trailing extraction (coalescing) */
let pending: {
  turn: TurnTranscript
  sessionId?: string
  channel: string
} | undefined

/**
 * Enqueue a biographical extraction for a conversation turn.
 *
 * Fire-and-forget: this returns immediately. The extraction runs
 * in the background. If an extraction is already in progress, the
 * new turn is stashed and processed as a trailing extraction.
 *
 * @param turn - The conversation turn to extract from
 * @param sessionId - Optional KAIROS session ID
 * @param channel - Channel the exchange happened on (default: 'visit')
 */
export function enqueueExtraction(
  turn: TurnTranscript,
  sessionId?: string,
  channel: string = 'visit',
): void {
  if (extractionInProgress) {
    // Coalesce: stash for trailing run (latest context wins)
    pending = { turn, sessionId, channel }
    return
  }

  const p = runExtraction(turn, sessionId, channel)
  inFlight.add(p)
  p.finally(() => inFlight.delete(p))
}

async function runExtraction(
  turn: TurnTranscript,
  sessionId?: string,
  channel: string = 'visit',
): Promise<void> {
  extractionInProgress = true
  try {
    // Read recent memories for deduplication context
    const recentMemories = readRecentMemories(7)

    const result = await extractFromTurn(turn, {
      sessionId,
      channel,
      recentMemories,
    })

    if (process.env.TRUE_LOVE_DEBUG) {
      if (result.skipped) {
        console.log(`[extract-memories] skipped: ${result.skipReason}`)
      } else if (result.memories.length > 0) {
        console.log(
          `[extract-memories] extracted ${result.memories.length} memories ` +
            `(${result.inputTokens}in/${result.outputTokens}out, ${result.durationMs}ms)`,
        )
        for (const m of result.memories) {
          console.log(`  [${m.kind}] ${m.summary}`)
        }
      } else {
        console.log(
          `[extract-memories] nothing extracted (${result.durationMs}ms)`,
        )
      }
    }
  } catch (error) {
    // Extraction is best-effort — log but never crash
    if (process.env.TRUE_LOVE_DEBUG) {
      console.error(`[extract-memories] background extraction failed:`, error)
    }
  } finally {
    extractionInProgress = false

    // Process trailing extraction if one was stashed
    const trail = pending
    pending = undefined
    if (trail) {
      await runExtraction(trail.turn, trail.sessionId, trail.channel)
    }
  }
}

/**
 * Drain all in-flight extractions before shutdown.
 * Called when the visit server is stopping.
 *
 * Pattern from cli/print.ts:967 in the Claude Code reference.
 */
export async function drainExtractions(
  timeoutMs: number = 30_000,
): Promise<void> {
  if (inFlight.size === 0) return

  await Promise.race([
    Promise.all(inFlight).catch(() => {}),
    new Promise<void>((resolve) =>
      setTimeout(resolve, timeoutMs).unref(),
    ),
  ])
}

/**
 * Check if any extractions are currently in flight.
 * Useful for testing and status reporting.
 */
export function hasInFlightExtractions(): boolean {
  return inFlight.size > 0 || extractionInProgress
}

/**
 * Get extraction queue status (for diagnostics).
 */
export function getExtractionStatus(): {
  inFlightCount: number
  hasPending: boolean
  isRunning: boolean
} {
  return {
    inFlightCount: inFlight.size,
    hasPending: pending !== undefined,
    isRunning: extractionInProgress,
  }
}
