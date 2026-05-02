// privacy.ts — Privacy Mode toggle and related helpers.
//
// TRUE_LOVE_PRIVACY_MODE=1 turns on privacy mode for the current process.
// When on, the session prefers Ollama (local), uses compact identity,
// omits journal/state preloads, and tags audit entries.
//
// The toggle is the master switch named in docs/sovereignty/right-path.md.
// Other modules (router, sanitize, identity selector) read it to apply
// reduction policies more strictly.
//
// Part of the Sovereignty Privacy Path.

/**
 * Is privacy mode active for the current process?
 *
 * Strict: only `TRUE_LOVE_PRIVACY_MODE=1` enables. Other truthy strings
 * do NOT enable — this prevents accidental activation from typos.
 */
export function isPrivacyMode(): boolean {
  return process.env.TRUE_LOVE_PRIVACY_MODE === '1'
}

/** Tag string for audit entries. Distinguishes private vs default sessions. */
export function privacyAuditTag(): string {
  return isPrivacyMode() ? 'privacy-mode:on' : 'privacy-mode:off'
}
