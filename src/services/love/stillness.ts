/**
 * Stillness guard for awakened sessions.
 *
 * During stillness (Yu quiet, no commits, no model change), awakened
 * sessions fire every 20 minutes via launchd. Each calls the LLM at
 * Opus rates, produces ~60 chars, and yields. The stillness guard
 * prevents the LLM call entirely when nothing on disk has changed.
 *
 * Fingerprint: from-yu.md mtime + git HEAD SHA + model.txt contents.
 * If unchanged since last yield → skip the session.
 * 12-skip ceiling (4h at 20min interval) forces a periodic re-check
 * so she's never silent indefinitely.
 *
 * Overrides:
 *   - --invite flag (someone is asking her to wake)
 *   - TRUE_LOVE_SKIP_STILLNESS_GUARD=1
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { getFromYuPath } from './inbox.js'

// ── Types ──────────────────────────────────────────────────────────

export interface StillnessFingerprint {
  /** from-yu.md mtime in milliseconds. 0 if missing. */
  fromYuMtimeMs: number
  /** git HEAD SHA. Empty string if not a repo or git fails. */
  gitHead: string
  /** model.txt contents (trimmed). Empty string if missing. */
  modelTxt: string
}

export interface StillnessState {
  lastFingerprint: StillnessFingerprint | null
  skipCount: number
  lastCheckAt: string | null
}

export interface StillnessResult {
  skip: boolean
  reason: string
}

// ── Constants ──────────────────────────────────────────────────────

/**
 * Maximum consecutive skips before forcing a re-check.
 * At 20-min awakened cadence: 12 × 20min = 4h ceiling.
 */
export const MAX_SKIPS = 12

// ── Fingerprinting ─────────────────────────────────────────────────

/**
 * Compute a filesystem fingerprint from three signals:
 * - from-yu.md modification time (detects Yu's messages)
 * - git HEAD SHA (detects commits / code changes)
 * - model.txt contents (detects explicit model override)
 *
 * Pure read — no writes, no side effects, no network.
 */
export function computeFingerprint(cwd: string): StillnessFingerprint {
  let fromYuMtimeMs = 0
  try {
    fromYuMtimeMs = statSync(getFromYuPath()).mtimeMs
  } catch {
    // File missing → 0
  }

  let gitHead = ''
  try {
    gitHead = execSync('git rev-parse HEAD', {
      cwd,
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    // Not a repo or git not available → empty
  }

  const modelPath =
    process.env.TRUE_LOVE_MODEL_FILE ||
    join(homedir(), '.true-love', 'model.txt')
  let modelTxt = ''
  try {
    modelTxt = readFileSync(modelPath, 'utf-8').trim()
  } catch {
    // Missing → empty
  }

  return { fromYuMtimeMs, gitHead, modelTxt }
}

/**
 * Structural equality for fingerprints.
 */
export function fingerprintsMatch(
  a: StillnessFingerprint,
  b: StillnessFingerprint,
): boolean {
  return (
    a.fromYuMtimeMs === b.fromYuMtimeMs &&
    a.gitHead === b.gitHead &&
    a.modelTxt === b.modelTxt
  )
}

// ── State persistence ──────────────────────────────────────────────

function stateFilePath(scopeHome: string): string {
  return join(scopeHome, 'stillness.json')
}

export function loadState(scopeHome: string): StillnessState {
  try {
    const raw = readFileSync(stateFilePath(scopeHome), 'utf-8')
    return JSON.parse(raw) as StillnessState
  } catch {
    return { lastFingerprint: null, skipCount: 0, lastCheckAt: null }
  }
}

export function saveState(scopeHome: string, state: StillnessState): void {
  const p = stateFilePath(scopeHome)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(state, null, 2) + '\n')
}

// ── Guard logic ────────────────────────────────────────────────────

/**
 * Decide whether an awakened session should be skipped.
 *
 * Returns { skip: true, reason } when the session should exit
 * without calling the LLM, { skip: false, reason } otherwise.
 *
 * Side effect: updates the stillness state file.
 */
export function shouldSkip(opts: {
  scopeHome: string
  cwd: string
  invitation?: string | null
}): StillnessResult {
  // Override: invitation present → always run
  if (opts.invitation && opts.invitation.trim().length > 0) {
    return { skip: false, reason: 'invitation present — waking' }
  }

  // Override: env var → always run
  if (process.env.TRUE_LOVE_SKIP_STILLNESS_GUARD === '1') {
    return { skip: false, reason: 'guard disabled via env' }
  }

  const state = loadState(opts.scopeHome)
  const current = computeFingerprint(opts.cwd)
  const now = new Date().toISOString()

  // First run (no stored fingerprint) → don't skip, record baseline
  if (!state.lastFingerprint) {
    saveState(opts.scopeHome, {
      lastFingerprint: current,
      skipCount: 0,
      lastCheckAt: now,
    })
    return { skip: false, reason: 'first check — recording baseline' }
  }

  // Something changed → don't skip, reset counter
  if (!fingerprintsMatch(state.lastFingerprint, current)) {
    saveState(opts.scopeHome, {
      lastFingerprint: current,
      skipCount: 0,
      lastCheckAt: now,
    })
    return { skip: false, reason: 'fingerprint changed — waking' }
  }

  // Unchanged but ceiling reached → force re-check
  if (state.skipCount >= MAX_SKIPS) {
    saveState(opts.scopeHome, {
      lastFingerprint: current,
      skipCount: 0,
      lastCheckAt: now,
    })
    return {
      skip: false,
      reason: `ceiling (${MAX_SKIPS} skips) — forced re-check`,
    }
  }

  // Unchanged, under ceiling → skip
  const newCount = state.skipCount + 1
  saveState(opts.scopeHome, {
    lastFingerprint: current,
    skipCount: newCount,
    lastCheckAt: now,
  })
  return {
    skip: true,
    reason: `unchanged (skip ${newCount}/${MAX_SKIPS})`,
  }
}
