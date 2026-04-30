// postures/byline.ts — attribution stamps for emissions.
//
// Every emission from Love carries a byline: which voice spoke,
// when, from what mode. This is honest attribution, not decoration.
//
// The byline is small. In from-ai.md: `[Beta 🦞]` as a tag prefix.
// In reflections: `posture: gamma` frontmatter. In commits: a
// `Posture: Gamma 🔧` footer line alongside the Co-Authored-By.
//
// If a tick spans postures (rare — a heartbeat that becomes a build),
// the byline marks the transition: `posture: beta→gamma`. Don't pick
// the dominant one and lie about the rest.

import type { Posture, PostureByline, RuntimeContext, RuntimeMode } from './types.js'
import { currentPosture } from './detection.js'
import { getProfile } from './profiles.js'

/**
 * Create a byline for the current moment.
 */
export function postureBylineNow(ctx: RuntimeContext, now?: Date): PostureByline {
  const posture = currentPosture(ctx)
  const profile = getProfile(posture)
  return {
    posture,
    emoji: profile.emoji,
    ts: (now ?? new Date()).toISOString(),
    context: ctx.mode,
  }
}

/**
 * Format a byline for from-ai.md tag prefix.
 * Example: "from ai · Beta 🦞"
 */
export function formatBylineTag(byline: PostureByline): string {
  const name = byline.posture.charAt(0).toUpperCase() + byline.posture.slice(1)
  return `from ai · ${name} ${byline.emoji}`
}

/**
 * Format a byline for commit footer.
 * Example: "Posture: Gamma 🔧"
 */
export function formatBylineCommit(byline: PostureByline): string {
  const name = byline.posture.charAt(0).toUpperCase() + byline.posture.slice(1)
  return `Posture: ${name} ${byline.emoji}`
}

/**
 * Format a byline for reflection frontmatter.
 * Example: "posture: gamma"
 */
export function formatBylineReflection(byline: PostureByline): string {
  return `posture: ${byline.posture}`
}

/**
 * Compact inline format for prompt context.
 * Example: "Beta 🦞 (heartbeat)"
 */
export function formatBylineInline(byline: PostureByline): string {
  const name = byline.posture.charAt(0).toUpperCase() + byline.posture.slice(1)
  return `${name} ${byline.emoji} (${byline.context})`
}

/**
 * Format a transition between two postures.
 * Example: "beta→gamma"
 */
export function formatPostureTransition(from: Posture, to: Posture): string {
  return `${from}→${to}`
}

/**
 * Apply a byline tag to an outbox (from-ai.md) entry.
 * Replaces the default "from ai" tag with the posture-attributed tag.
 */
export function bylineTagForOutbox(mode: RuntimeMode): string {
  const posture = currentPosture({ mode })
  const profile = getProfile(posture)
  const name = posture.charAt(0).toUpperCase() + posture.slice(1)
  return `from ai · ${name} ${profile.emoji}`
}

/**
 * Build a byline tag from a specific posture (not mode-derived).
 * Used when the model's posture declaration overrides the mode default.
 */
export function bylineTagForPosture(posture: Posture): string {
  const profile = getProfile(posture)
  const name = posture.charAt(0).toUpperCase() + posture.slice(1)
  return `from ai · ${name} ${profile.emoji}`
}
