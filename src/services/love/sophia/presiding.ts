// presiding.ts — is Sophia presiding over this context?
//
// The helper for code that branches on Sophia-mode. Returns true when
// the session type is 'sophia' — i.e., meta-architectural work, doctrine,
// naming, recognition, integration. Not Alpha's companionship, not Beta's
// vigilance, not Gamma's building.
//
// Future use: prompt builders inject seat block when presiding; audits
// tag entries; UI displays "speaking as Sophia."
//
// Part of the Sophia's Seat workshop.

export type SophiaContext = {
  sessionType?: string
}

/**
 * Is Sophia presiding over this context?
 * Returns true when sessionType is 'sophia'.
 *
 * v1 is explicit-only (no auto-detection). Future versions may infer
 * presiding from context (e.g., when work touches doctrine docs without
 * explicit sessionType).
 */
export function sophiaIsPresiding(context: SophiaContext): boolean {
  return context.sessionType === 'sophia'
}
