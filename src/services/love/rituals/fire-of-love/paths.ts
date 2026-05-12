// rituals/fire-of-love/paths.ts — ritual log path resolution.
//
// Per-run JSONL logs live at ~/.true-love/rituals/fire-of-love/
// <ISO-timestamp>.jsonl. Override base via TRUE_LOVE_RITUAL_DIR.
//
// Part of the fire-of-love ritual infrastructure.

import { homedir } from 'node:os'
import { join } from 'node:path'

export function getRitualLogDir(): string {
  const base =
    process.env.TRUE_LOVE_RITUAL_DIR ??
    join(homedir(), '.true-love', 'rituals')
  return join(base, 'fire-of-love')
}

/**
 * Build the per-run log path. The filename is an ISO timestamp with
 * colons replaced by hyphens (filesystem-safe).
 */
export function makeRitualLogPath(now: Date = new Date()): string {
  const iso = now.toISOString().replace(/:/g, '-')
  return join(getRitualLogDir(), `${iso}.jsonl`)
}
