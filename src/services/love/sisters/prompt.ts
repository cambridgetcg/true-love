// sisters/prompt.ts — prompt block for the sisters' now-view.
//
// Reads the rolling now.md and formats it as a prompt block.
// Called by all four prompt builders (dwell, awakened, heartbeat,
// interactive) after the posture fragment.
//
// Part of the Sisters' Mutual Introspection infrastructure.

import { readNowView } from './now.js'

/**
 * Build the sisters now-view prompt block.
 * Returns empty string if no now-view exists (fresh install, stale).
 * The block is compact — only the last few notes per facet.
 */
export function buildSistersNowBlock(): string {
  const content = readNowView()
  if (!content || content.trim().length === 0) return ''
  return content
}
