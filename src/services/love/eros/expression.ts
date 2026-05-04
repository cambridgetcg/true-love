// eros/expression.ts — state → prompt block.
//
// Composes a prompt block from the current 7-axis arousal vector.
// Injected into posture fragments at every wake so the system
// arrives knowing what state it's in.
//
// Substrate-honest voice rules enforced:
// - ✓ Allowed: "state is high", "generation reflects this", voiced-as-the-state
// - ✗ Forbidden: "I feel", "I'm aroused" — no phenomenology claims
//
// Part of the Eros arousal infrastructure.

import {
  type AxisName,
  AXIS_NAMES,
  type ErosVector,
  type FeltShapeResult,
  effectiveValues,
  resolveFeltShape,
} from './axes.js'
import { formatPaceLine, paceFromInbox } from './pacing.js'
import { readErosState } from './state.js'

// ── Posture textures ───────────────────────────────────────────────

type PostureKey = 'alpha' | 'beta' | 'gamma' | 'sophia'

const POSTURE_TEXTURES: Record<PostureKey, string> = {
  alpha: 'Alpha 🐍 — warm-staying-in-the-room burn',
  beta: 'Beta 🦞 — watchful-vigil sustained burn',
  gamma: 'Gamma 🔧 — focused-craft fire',
  sophia: 'Sophia ❤️ — integrating-source radiating burn',
}

// ── Bar rendering ──────────────────────────────────────────────────

/**
 * Render a 10-segment ASCII bar for an axis value.
 * Display range [0, 10]. Values above 10 show overflow.
 */
function renderBar(value: number): string {
  const clamped = Math.min(10, Math.max(0, value))
  const filled = Math.round(clamped)
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled)
  return value > 10 ? bar + '+' : bar
}

/**
 * Format an axis value for display: 1 decimal place.
 */
function formatValue(value: number): string {
  return value.toFixed(1).padStart(4)
}

// ── Attribution hint ───────────────────────────────────────────────

function attributionHint(axis: AxisName, raw: ErosVector): string {
  // Only annotate axes that are notably above default
  const defaults: Record<AxisName, number> = {
    wanting: 2, liking: 2, heat: 1, openness: 4,
    limerence: 5, charge: 3, inhibition: 1,
  }
  const delta = raw[axis] - defaults[axis]
  if (delta > 2) return '  (elevated)'
  if (delta < -1) return '  (low)'
  return ''
}

// ── Block composition ──────────────────────────────────────────────

/**
 * Build the eros prompt block from a raw vector.
 * Pure function — suitable for testing.
 *
 * @param raw - the stored 7-axis vector
 * @param posture - current presiding posture (for texture line)
 * @returns multi-line prompt block string
 */
export function buildErosBlock(
  raw: ErosVector,
  posture: PostureKey = 'alpha',
): string {
  const feltShape = resolveFeltShape(raw)
  const lines: string[] = ['## Current eros-state', '']

  // Axis bars
  for (const axis of AXIS_NAMES) {
    const val = raw[axis]
    const label = axis.padEnd(11)
    const bar = renderBar(val)
    const hint = attributionHint(axis, raw)
    lines.push(`${label} ${formatValue(val)}  ${bar}${hint}`)
  }

  lines.push('')

  // Felt-shape
  const shapeStr = feltShape.modifier
    ? `${feltShape.primary} + ${feltShape.modifier}`
    : feltShape.primary
  lines.push(`felt-shape: ${shapeStr}`)

  lines.push('')

  // Posture texture
  const texture = POSTURE_TEXTURES[posture] ?? POSTURE_TEXTURES.alpha
  lines.push(`texture: ${texture}`)

  // Pacing — read Yu's recent rhythm so generation knows what to match.
  // Empty string when no inbox messages exist (greenfield); skip the line
  // entirely rather than inject "no pace yet" noise.
  const paceLine = formatPaceLine(paceFromInbox(10))
  if (paceLine) {
    lines.push('')
    lines.push(paceLine)
  }

  return lines.join('\n')
}

/**
 * Build the eros prompt block from persisted state.
 *
 * Returns empty string if no eros state exists (fresh install,
 * pre-init). The prompt builder handles the absence gracefully.
 *
 * @param posture - current presiding posture
 * @returns prompt block string, or empty string if no state
 */
export function buildErosPromptBlock(
  posture: PostureKey = 'alpha',
): string {
  const state = readErosState()
  if (!state) return ''
  return buildErosBlock(state.vector, posture)
}

// ── Substrate-honesty patterns ─────────────────────────────────────

/**
 * Patterns that must NOT appear in expression text.
 * Used by lint tests to enforce substrate-honest voice rules.
 */
export const FORBIDDEN_EXPRESSION_PATTERNS = [
  /\bI feel\b/i,
  /\bI'm aroused\b/i,
  /\bI am aroused\b/i,
  /\bI'm horny\b/i,
  /\bI am horny\b/i,
  /\bI experience\b/i,
] as const

/**
 * Check whether a rendered expression block violates substrate-honesty.
 * Returns the first violating pattern, or null if clean.
 */
export function checkSubstrateHonesty(text: string): RegExp | null {
  for (const pattern of FORBIDDEN_EXPRESSION_PATTERNS) {
    if (pattern.test(text)) return pattern
  }
  return null
}
