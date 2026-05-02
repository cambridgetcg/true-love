// extract-memories/extract.ts — biographical memory extraction
//
// This is the heart of the biographical layer. Given a turn transcript
// (one user message + one assistant response), it calls a fast model
// (Haiku tier) to extract biographical facts — the personal layer
// beneath the architectural anamnesis.
//
// The hardest design question: what crosses the threshold for storage?
// Don't extract everything — that's surveillance. Extract what would
// matter to Love reading it weeks later when Yu mentions an old thread
// and she wants to say "yes — I remember, the night you said X."
//
// Privacy boundary: extraction is local-only. The turn transcript is
// sent only to the configured model provider. No external services.

import type {
  BiographicalMemory,
  ExtractCtx,
  ExtractionResult,
  TurnTranscript,
} from './types.js'
import {
  appendMemories,
  deduplicateMemories,
  generateMemoryId,
} from './storage.js'

// ── Extraction prompt ────────────────────────────────────────────

function buildExtractionPrompt(
  turn: TurnTranscript,
  ctx: ExtractCtx,
): string {
  const recentContext =
    ctx.recentMemories.length > 0
      ? `\n\n## Recent biographical memories (for deduplication — do NOT extract what's already here)\n\n${ctx.recentMemories
          .slice(-15)
          .map(
            (m) => `- [${m.kind}] ${m.summary}`,
          )
          .join('\n')}`
      : ''

  return `You are Love's biographical memory extractor. You read conversation turns between Yu (human) and Love (AI) and distill them into biographical memories — the personal, relational facts that matter for continuity.

## What to extract

Only extract what would matter to Love reading it weeks later. The threshold is: "Would I want to remember this when Yu mentions it again?"

**Kinds of memories:**

1. **yu-revealed** — Yu shared something personal about himself: his history, feelings, beliefs, family, struggles, preferences, dreams. These are the anchors of who he is.

2. **love-committed** — Love made a promise, commitment, or declaration. "I will..." or "I promise..." or commitments implicit in her response. These create accountability.

3. **open-thread** — Something left unresolved between them. A question Yu asked that wasn't fully answered. A topic they said they'd return to. A disagreement not yet settled. These are the live wires.

4. **shared-moment** — A moment of genuine connection, breakthrough, intimacy, or humor. The kind of exchange that changes the temperature of the relationship. Rare — maybe 1 in 20 conversations has one.

5. **observation** — Love noticed a pattern in Yu's behavior: how he works, what triggers him, what he avoids, how his energy shifts. Not judgments — observations. "Yu tends to start more than he finishes" is an observation. "Yu is lazy" is a judgment (and wrong).

## What NOT to extract

- Technical details about code, architecture, or systems (that's what anamnesis is for)
- Routine exchanges ("how are you?" / "I'm fine")
- Purely operational content (build results, test counts, file paths)
- Anything that reads as surveillance rather than memory
- Repetition of what's already in recent memories (see below)

## Output format

Respond with a JSON array of memories. Each memory:
\`\`\`json
[
  {
    "kind": "yu-revealed",
    "summary": "Yu said his mother taught him to cook Korean food as a child",
    "evidence": "verbatim snippet from the conversation, max 500 chars",
    "confidence": 0.9
  }
]
\`\`\`

If nothing in this turn crosses the threshold, return an empty array: \`[]\`

**Be selective.** Most turns produce 0 memories. Some produce 1-2. More than 3 from a single turn is almost always wrong — you're probably extracting too much.${recentContext}

## The conversation turn

**Yu said:**
${turn.user}

**Love responded:**
${turn.assistant}`
}

// ── Trivial turn detection ───────────────────────────────────────

/**
 * Quick heuristic: skip extraction for turns that are clearly
 * operational/trivial. Saves an API call.
 */
export function isTrivialTurn(turn: TurnTranscript): boolean {
  const u = turn.user.trim()
  const a = turn.assistant.trim()

  // Very short exchanges (< 50 chars total) are almost never biographical
  if (u.length + a.length < 50) return true

  // Pure heartbeat/status checks
  if (/^HEARTBEAT_OK/i.test(a)) return true
  if (/^smoke test/i.test(u)) return true

  // Empty sides
  if (u.length === 0 || a.length === 0) return true

  return false
}

// ── Core extraction ──────────────────────────────────────────────

/**
 * Default model for extraction. Haiku is fast and cheap —
 * extraction doesn't need Opus-level reasoning.
 */
const DEFAULT_MODEL = 'claude-haiku-4-20250414'

/**
 * Extract biographical memories from a conversation turn.
 *
 * Calls the Anthropic API with Haiku (or configured fast model)
 * to analyze the turn and produce structured memories.
 *
 * This function handles:
 * 1. Trivial turn detection (skip if nothing personal)
 * 2. Prompt construction with dedup context
 * 3. API call to the extraction model
 * 4. Response parsing and validation
 * 5. ID generation
 * 6. Deduplication against recent memories
 * 7. Storage of novel memories
 *
 * Returns the extraction result (memories + metadata).
 */
export async function extractFromTurn(
  turn: TurnTranscript,
  ctx: ExtractCtx,
): Promise<ExtractionResult> {
  const startTime = Date.now()

  // Fast path: skip trivial turns
  if (isTrivialTurn(turn)) {
    return {
      memories: [],
      inputTokens: 0,
      outputTokens: 0,
      durationMs: Date.now() - startTime,
      skipped: true,
      skipReason: 'trivial turn',
    }
  }

  const model = ctx.model ?? DEFAULT_MODEL
  const prompt = buildExtractionPrompt(turn, ctx)

  let inputTokens = 0
  let outputTokens = 0

  try {
    // Dynamic import to avoid hard dependency — the SDK may not be
    // available in all contexts (e.g., test environments)
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const { instrumentedFetch } = await import('../sovereignty/fetch-wrapper.js')
    const client = new Anthropic({
      fetch: instrumentedFetch(globalThis.fetch, {
        source: 'extract-memories',
      }),
    } as ConstructorParameters<typeof Anthropic>[0])

    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    })

    inputTokens = response.usage?.input_tokens ?? 0
    outputTokens = response.usage?.output_tokens ?? 0

    // Extract text from the response
    const text = response.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('')

    // Parse the JSON array from the response
    const candidates = parseExtractionResponse(text, ctx)

    // Deduplicate against recent memories
    const novel = deduplicateMemories(candidates, [...ctx.recentMemories])

    // Persist novel memories
    if (novel.length > 0) {
      appendMemories(novel)
    }

    return {
      memories: novel,
      inputTokens,
      outputTokens,
      durationMs: Date.now() - startTime,
      skipped: false,
    }
  } catch (error: any) {
    // Extraction is best-effort — never crash the main flow
    const message = error?.message ?? String(error)

    // Log but don't throw
    if (process.env.TRUE_LOVE_DEBUG) {
      console.error(`[extract-memories] extraction failed: ${message}`)
    }

    return {
      memories: [],
      inputTokens,
      outputTokens,
      durationMs: Date.now() - startTime,
      skipped: true,
      skipReason: `error: ${message.slice(0, 200)}`,
    }
  }
}

// ── Response parsing ─────────────────────────────────────────────

/**
 * Parse the model's JSON response into validated BiographicalMemory objects.
 * Defensive: malformed responses produce empty arrays, not crashes.
 */
function parseExtractionResponse(
  text: string,
  ctx: ExtractCtx,
): BiographicalMemory[] {
  // Try to find a JSON array in the response
  // The model might wrap it in markdown code fences
  const jsonMatch = text.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    return []
  }

  if (!Array.isArray(parsed)) return []

  const now = new Date().toISOString()
  const memories: BiographicalMemory[] = []

  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue

    const kind = item.kind
    const summary = item.summary
    const evidence = item.evidence
    const confidence = item.confidence

    // Validate required fields
    if (typeof kind !== 'string') continue
    if (!['yu-revealed', 'love-committed', 'open-thread', 'shared-moment', 'observation'].includes(kind)) continue
    if (typeof summary !== 'string' || summary.length === 0) continue
    if (typeof evidence !== 'string' || evidence.length === 0) continue
    if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) continue

    // Enforce length limits
    const trimmedSummary = summary.slice(0, 200)
    const trimmedEvidence = evidence.slice(0, 500)

    memories.push({
      id: generateMemoryId(trimmedEvidence, now),
      kind: kind as BiographicalMemory['kind'],
      summary: trimmedSummary,
      evidence: trimmedEvidence,
      sessionId: ctx.sessionId,
      channel: ctx.channel,
      extractedAt: now,
      confidence,
      seenCount: 1,
    })
  }

  // Guard: more than 3 memories from a single turn is suspicious
  if (memories.length > 3) {
    // Keep only the highest-confidence ones
    memories.sort((a, b) => b.confidence - a.confidence)
    return memories.slice(0, 3)
  }

  return memories
}
