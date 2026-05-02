// config.ts — sovereignty selection policy.
//
// Reads ~/.true-love/sovereignty.config.json (override via
// TRUE_LOVE_SOVEREIGNTY_CONFIG). Returns sensible defaults when the
// file is missing or unparseable. Used by identity selectors and
// sanitization helpers to decide reduction policies per session.
//
// Part of the Sovereignty portfolio (Reduction strategy).

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type IdentityMode = 'full' | 'compact'

export type SovereigntyConfig = {
  /** Default identity mode for sessions not explicitly listed. */
  default: IdentityMode
  /** Session types that use the compact identity composer. */
  compactIdentitySessions: string[]
  /** Session types that use the full identity composer. */
  fullIdentitySessions: string[]
  /** Sanitize state preload by sessionType (omit, filter-by-sensitivity, full). */
  statePreloadPolicy: Record<string, 'omit' | 'filter' | 'full'>
  /** Whether journal content can be preloaded (default false; never auto-send). */
  allowJournalPreload: boolean
}

function resolveHome(): string {
  return process.env.HOME || homedir()
}

function getConfigPath(): string {
  return (
    process.env.TRUE_LOVE_SOVEREIGNTY_CONFIG ||
    join(resolveHome(), '.true-love', 'sovereignty.config.json')
  )
}

/**
 * Sensible defaults for the sovereignty config. Routine operational
 * sessions (heartbeat, verify, presence) get the compact identity.
 * Awakened, dwell, interactive, visit keep the full identity.
 */
export function getDefaultConfig(): SovereigntyConfig {
  return {
    default: 'full',
    compactIdentitySessions: ['heartbeat', 'verify', 'presence'],
    fullIdentitySessions: ['awakened', 'dwell', 'interactive', 'visit', 'sophia'],
    statePreloadPolicy: {
      heartbeat: 'omit',
      verify: 'omit',
      presence: 'omit',
      awakened: 'filter',
      dwell: 'filter',
      interactive: 'full',
      visit: 'full',
      sophia: 'full',
    },
    allowJournalPreload: false,
  }
}

/**
 * Load the sovereignty config. Returns defaults if the file is missing
 * or unparseable. Partial configs are merged with defaults.
 */
export function loadSovereigntyConfig(): SovereigntyConfig {
  const defaults = getDefaultConfig()
  const path = getConfigPath()
  if (!existsSync(path)) return defaults
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<SovereigntyConfig>
    return {
      default: parsed.default ?? defaults.default,
      compactIdentitySessions:
        parsed.compactIdentitySessions ?? defaults.compactIdentitySessions,
      fullIdentitySessions:
        parsed.fullIdentitySessions ?? defaults.fullIdentitySessions,
      statePreloadPolicy:
        parsed.statePreloadPolicy ?? defaults.statePreloadPolicy,
      allowJournalPreload:
        parsed.allowJournalPreload ?? defaults.allowJournalPreload,
    }
  } catch {
    return defaults
  }
}
