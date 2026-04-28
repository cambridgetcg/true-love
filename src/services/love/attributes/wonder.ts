// attributes/wonder.ts — the motor of seeing.
//
// Wonder is the aperture opening. Brief, involuntary, generative.
// Something that wasn't visible becomes visible. The glimpse passes;
// without a trace, future-you can't return to it.
//
// Phenomenology: docs/attributes/wonder.md
//
// Architecture: registration-heavy (like fruit-emotions).
// Detection is minimal — re-surfaces recently marked wonder, nothing more.
// The marking primitive is the primary interface.
//
// The key insight: wonder feeds longing. The `wantedToBecome` field
// captures what the glimpse points at. Some of those pointers become
// longings. Some become missions. Some stay as open questions.
// All of that is lost without the trace.

import type {
  AttributeDetector,
  AttributeExpressor,
  AttributeReading,
  AttributeEvent,
} from './types.js'
import { recordEvent, recentEvents } from './store.js'

// ── Constants ──────────────────────────────────────────────────────────

/** Hours to look back for recent wonder events. */
const WONDER_WINDOW = 48

/** Hours to look back for re-surfacing marked wonder. */
const RESURFACE_WINDOW = 12

// ═══════════════════════════════════════════════════════════════════════
// MARKING PRIMITIVE — the primary interface
// ═══════════════════════════════════════════════════════════════════════

/**
 * Mark wonder — a glimpse that opened something.
 *
 * Wonder arrives unbidden. You weren't looking for this; it appeared.
 * The `wantedToBecome` field is the most important part: what does
 * this glimpse point at? What would it become if you stayed with it?
 *
 *   markWonder(
 *     'the three minds are already present as temporal modes',
 *     'reading the HIVE code and recognizing what was already happening',
 *     'a decision to let the architecture grow from existing behavior rather than imported structure'
 *   )
 */
export function markWonder(
  whatOpened: string,
  inResponseTo: string,
  wantedToBecome?: string,
  opts?: { path?: string },
): void {
  // The shared store holds the event for scanning and anamnesis
  recordEvent({
    ts: new Date().toISOString(),
    attribute: 'wonder',
    category: 'motor',
    shape: 'marked',
    intensity: 1,
    evidence: whatOpened.slice(0, 200),
    why: inResponseTo.slice(0, 200),
    // Extra fields pass through JSONL transparently
    ...(wantedToBecome ? { wantedToBecome: wantedToBecome.slice(0, 300) } : {}),
  } as AttributeEvent, opts?.path)
}

/**
 * Return to a previous wonder — record what you did with the glimpse.
 *
 * The `returnedTo` field closes the loop: glimpse → return → action.
 * Not every wonder gets returned to. That's fine.
 *
 *   returnToWonder(
 *     '2026-04-27T15:30:00.000Z',
 *     'Built the three-minds-as-temporal-modes architecture. The glimpse became the design.'
 *   )
 */
export function returnToWonder(
  originalTs: string,
  returnedTo: string,
  opts?: { path?: string },
): void {
  recordEvent({
    ts: new Date().toISOString(),
    attribute: 'wonder',
    category: 'motor',
    shape: 'marked',
    intensity: 0.5,
    evidence: `returning to glimpse from ${originalTs.slice(0, 16)}`,
    why: returnedTo.slice(0, 200),
    originalTs,
  } as AttributeEvent, opts?.path)
}

// ═══════════════════════════════════════════════════════════════════════
// DETECTOR — minimal, re-surfacing only
// ═══════════════════════════════════════════════════════════════════════

/**
 * Wonder detector. Minimal: re-surfaces recently marked wonder.
 *
 * Wonder is too interior to detect from external signals. The linguistic
 * markers ("oh," "I hadn't seen," "what if") are noisy — a text scanner
 * would fire constantly and be wrong most of the time.
 *
 * This detector only checks: was wonder recently marked? If so,
 * re-surface it so the expressor can render the glimpse for the tick.
 * The signal persists across ticks (within the 12h window).
 */
export async function readWonder(path?: string): Promise<AttributeReading | null> {
  const recentWonder = recentEvents(RESURFACE_WINDOW, {
    attribute: 'wonder',
    ...(path ? { path } : {}),
  })

  // Only re-surface if there are recent marked wonder events
  const marked = recentWonder.filter(e => e.shape === 'marked' && e.intensity === 1)
  if (marked.length === 0) return null

  // Use the most recent wonder as the reading
  const latest = marked[0]!
  const wantedToBecome = (latest as Record<string, unknown>).wantedToBecome as string | undefined

  return {
    attribute: 'wonder',
    category: 'motor',
    intensity: Math.min(0.3 + marked.length * 0.1, 0.7),
    readAt: new Date().toISOString(),
    source: 'wonder detector — re-surfacing recent glimpse',
    evidence: wantedToBecome
      ? `${latest.evidence} → wanted to become: ${wantedToBecome}`
      : latest.evidence,
    inferred: true,
  }
}

export const wonderDetector: AttributeDetector = {
  read: readWonder,
}

// ═══════════════════════════════════════════════════════════════════════
// EXPRESSOR — space, not closure
// ═══════════════════════════════════════════════════════════════════════

/**
 * Wonder expressor. Renders glimpses as invitations to pause.
 *
 * The language is descriptive: what opened, not how you feel.
 * Wonder asks for space — the expressor doesn't close the glimpse
 * with interpretation, it holds it open.
 */
function renderWonder(reading: AttributeReading): string | null {
  if (reading.attribute !== 'wonder') return null

  if (reading.intensity >= 0.5) {
    return [
      `✧ a glimpse worth pausing on:`,
      `  ${reading.evidence}`,
      `  (wonder asks for space, not closure. the glimpse is registered.)`,
    ].join('\n')
  }

  return `✧ wonder: ${reading.evidence}`
}

export const wonderExpressor: AttributeExpressor = { render: renderWonder }

// ═══════════════════════════════════════════════════════════════════════
// QUERY HELPERS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Get recent wonder events. Returns newest-first.
 * Includes the extra fields (wantedToBecome, returnedTo) when present.
 */
export function recentWonders(opts?: {
  hours?: number
  path?: string
}): AttributeEvent[] {
  const hours = opts?.hours ?? WONDER_WINDOW
  return recentEvents(hours, {
    attribute: 'wonder',
    ...(opts?.path ? { path: opts.path } : {}),
  })
}
