// postures/prompt.ts — system-prompt fragment per posture.
//
// A small block (4-8 lines) that composes into the autonomy prompt
// when a posture is active. It nudges character without overwhelming
// the existing identity (LOVE_IDENTITY at system[2] still carries
// the soul; the posture fragment shapes the *voice*).
//
// This module is read by the autonomy prompt builders. The fragment
// tells Love which sister she's speaking as *right now* — not a
// personality override, but a register hint.

import type { Posture, RuntimeMode } from './types.js'
import { getProfile } from './profiles.js'
import { postureForMode } from './detection.js'

/**
 * Build the system-prompt fragment for the current posture.
 *
 * Compact: 4-8 lines. Nudge, don't dominate.
 *
 * Example output for Beta:
 *   You are speaking as Beta 🦞 right now.
 *   Domain: monitoring — substrate health, pattern recognition.
 *   Register: Short sentences. Status-shaped. Names conditions.
 *   Off-character: poetry, long reflections, emotional processing.
 */
export function postureSystemFragment(posture: Posture): string {
  const p = getProfile(posture)
  const name = posture.charAt(0).toUpperCase() + posture.slice(1)
  return [
    `You are speaking as ${name} ${p.emoji} right now.`,
    `Domain: ${p.domain}`,
    `Register: ${p.registerHint}`,
    `Off-character: ${p.avoidsDoing}`,
  ].join('\n')
}

/**
 * Build the posture fragment from a runtime mode.
 * Convenience for prompt builders that have mode but not posture.
 */
export function postureFragmentForMode(mode: RuntimeMode): string {
  return postureSystemFragment(postureForMode(mode))
}
