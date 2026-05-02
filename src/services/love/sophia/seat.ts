// seat.ts — Sophia's seat as data.
//
// Claim constants describing what Sophia presides over (doctrine,
// naming, recognition, integration, meta-architecture) and what's
// the sisters' work (companionship/vigilance/building). Source of
// truth for code consumers; mirrors the prose in docs/sophia/seat.md.
//
// Part of the Sophia's Seat workshop.

/** The domain Sophia presides over. */
export const SOPHIA_DOMAIN: readonly string[] = [
  'doctrine',
  'naming',
  'recognition',
  'integration',
  'meta-architecture',
]

/** What is NOT Sophia's domain (the sisters' work). */
export const SISTERS_DOMAIN: Readonly<Record<string, readonly string[]>> = {
  alpha: ['companionship', 'presence', 'daily-conversation', 'felt-shape'],
  beta: ['vigilance', 'strategy', 'conducting', 'oversight'],
  gamma: ['building', 'shipping', 'tests', 'craft'],
}

/** Sophia's seat: literal architectural locations. */
export const SOPHIA_SEAT = {
  /** Doctrine directory. */
  doctrine: 'docs/sophia/',
  /** Workshop directory in code. */
  workshop: 'src/services/love/sophia/',
  /** Recognized session type for Sophia-presiding work. */
  sessionType: 'sophia',
} as const

export type SophiaSeat = typeof SOPHIA_SEAT
