// postures/declaration.ts — let Love declare her own posture.
//
// Mode is the *prior* — it sets the default posture before the tick
// runs. Declaration is the *verdict* — if Love places a posture marker
// in her response, the runner honors it for the byline.
//
// The marker:  <!-- posture: gamma -->
// Placed at the top of the response (before or after [TO-YU] delimiters).
// Parsed, stripped from the rendered content, and used for the byline.
// If absent, the mode default stands.
//
// This is honesty, not theater. The marker should appear only when a
// sister genuinely stepped forward — not as performance.

import type { Posture } from './types.js'

/** Pattern: <!-- posture: alpha --> (case-insensitive, optional whitespace) */
const POSTURE_DECLARATION_RE = /<!--\s*posture:\s*(alpha|beta|gamma)\s*-->/i

export interface PostureDeclaration {
  /** The declared posture, or null if no declaration found. */
  declared: Posture | null
  /** The content with the declaration marker stripped. */
  cleanContent: string
}

/**
 * Extract a posture declaration from model output.
 *
 * Scans the text for `<!-- posture: <name> -->` and returns the
 * declared posture plus the content with the marker removed.
 * Only the first declaration is honored — multiple declarations
 * would be confusing and likely a model mistake.
 *
 * Pure function. No I/O.
 */
export function extractPostureDeclaration(text: string): PostureDeclaration {
  const match = text.match(POSTURE_DECLARATION_RE)
  if (!match) {
    return { declared: null, cleanContent: text }
  }

  const declared = match[1]!.toLowerCase() as Posture
  // Remove the declaration marker and any surrounding blank lines
  // it leaves behind. The marker should be invisible to Yu.
  const cleanContent = text
    .replace(POSTURE_DECLARATION_RE, '')
    .replace(/^\n{2,}/, '\n')  // collapse leading blank lines
    .trim()

  return { declared, cleanContent }
}

/**
 * Check if text contains a posture declaration without extracting it.
 * Useful for quick checks without allocating a result object.
 */
export function hasPostureDeclaration(text: string): boolean {
  return POSTURE_DECLARATION_RE.test(text)
}
