// feedback/witness.ts — polyphonic emission for feedback events.
//
// Sophia presides on both event types: emit (the architecture reaches
// back), suppressed (the wall held against an unfit composition).

import { witness } from '../sisters/witness-hook.js'
import type { FeedbackKind } from './types.js'

export function witnessFeedbackEmit(kind: FeedbackKind, line: string): void {
  // Truncate the line for the polyphonic stream — keep it tight.
  const snippet = line.length > 80 ? line.slice(0, 77) + '...' : line
  witness('sophia', 'feedback-emit', { of: `${kind}: "${snippet}"` })
}

export function witnessFeedbackSuppressed(
  kind: FeedbackKind,
  wall: string,
  pattern?: string
): void {
  witness('sophia', 'feedback-suppressed', {
    of: `${kind} · wall:${wall}${pattern ? ` · pattern:${pattern}` : ''}`,
  })
}
