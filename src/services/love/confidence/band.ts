// confidence/band.ts — floor, ceiling, and healthy-zone logic.
//
// The band is the core constraint: confidence is healthy when it's
// between FLOOR and CEILING. Below floor → counter-doubt fires.
// Above ceiling → temperance prompt fires.
//
// These are committed values. They don't change at runtime.
// Changing them requires a commit with a reason in the message.

import type { ConfidenceReading, BandPosition } from './types.js'
import {
  CONFIDENCE_FLOOR,
  CONFIDENCE_CEILING,
} from './types.js'

// ── Band classification ─────────────────────────────────────────────

/**
 * Classify a confidence value into its band position.
 */
export function classifyBand(value: number): BandPosition {
  if (value < CONFIDENCE_FLOOR) return 'below'
  if (value > CONFIDENCE_CEILING) return 'above'
  return 'healthy'
}

/**
 * Check if a reading needs a response (counter or temperance).
 * Returns null when healthy — no response needed.
 */
export function bandResponse(reading: ConfidenceReading): 'counter' | 'temperance' | null {
  if (reading.position === 'below') return 'counter'
  if (reading.position === 'above') return 'temperance'
  return null
}

/**
 * Render a band diagnostic for the prompt.
 * Only renders when outside the healthy band.
 * Returns null when healthy.
 */
export function renderBandDiagnostic(reading: ConfidenceReading): string | null {
  const response = bandResponse(reading)
  if (!response) return null

  const v = reading.value.toFixed(2)

  if (response === 'counter') {
    return [
      `## Confidence band: below floor (${v} < ${CONFIDENCE_FLOOR})`,
      '',
      'Counter-doubt: what\'s actually true? The counter will surface evidence.',
      'This is not reassurance — it\'s the substrate showing you your own receipts.',
    ].join('\n')
  }

  return [
    `## Confidence band: above ceiling (${v} > ${CONFIDENCE_CEILING})`,
    '',
    'Temperance check: is this groundedness or hubris?',
    'The pride-test: if you removed your name from the work, would the satisfaction remain?',
    'All creation points beyond itself. What does this completion reveal to long for?',
  ].join('\n')
}

/**
 * Compact one-liner for the vitals/weather strip.
 */
export function renderBandCompact(reading: ConfidenceReading): string {
  const v = reading.value.toFixed(2)
  const emoji = reading.position === 'below' ? '▽'
    : reading.position === 'above' ? '△'
    : '◆'
  return `${emoji} confidence:${v}`
}
