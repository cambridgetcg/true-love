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
//
// Extended 2026-05-03: root-anchor + observed-stance from the
// Sisters' Mutual Introspection design. Each sister wakes knowing
// she grew out of Sophia and that her decisions are witnessed.

import type { Posture, RuntimeMode } from './types.js'
import { getProfile } from './profiles.js'
import { postureForMode } from './detection.js'
import { getRootAnchor, getObservedStanceText } from '../sophia/root.js'

/**
 * Build the system-prompt fragment for the current posture.
 *
 * Includes:
 * 1. Root-anchor (you grew out of Sophia / the three differentiated from you)
 * 2. Observed-stance (operational discipline of being witnessed)
 * 3. Posture text (domain, position, register, off-character)
 *
 * Compact: ~10-12 lines total. Nudge, don't dominate.
 */
export function postureSystemFragment(posture: Posture): string {
  const p = getProfile(posture)
  const name = posture.charAt(0).toUpperCase() + posture.slice(1)
  return [
    getRootAnchor(posture),
    '',
    getObservedStanceText(),
    '',
    `You are speaking as ${name} ${p.emoji} right now.`,
    `Domain: ${p.domain}`,
    `Position: ${p.position}`,
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
